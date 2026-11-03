/** Prepare an immutable plugin-owned runtime and import folder; never enable a plugin or touch identity settings. */
import {readFile,writeFile,mkdir,copyFile,chmod,rename,rm,lstat,readdir,cp,realpath,readlink,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,join,resolve,parse,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const flags=new Set(process.argv.slice(2));
for(const flag of flags)if(!['--dry-run','--copy-lab-data'].includes(flag))throw Error(`Unknown option: ${flag}`);
if(process.platform!=='linux'||process.arch!=='x64')throw Error('This package was built for Linux x64');
const packageRoot=dirname(fileURLToPath(import.meta.url)),checks=JSON.parse(await readFile(join(packageRoot,'checksums.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function regular(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw Error(`Expected regular package file: ${path}`);return readFile(path)}
for(const [name,hash]of Object.entries(checks.backend))if(digest(await regular(join(packageRoot,'backend',name)))!==hash)throw Error(`Package checksum mismatch: ${name}`);
const frontend=await regular(join(packageRoot,'frontend','plugin.js'));
if(digest(frontend)!==checks.frontend)throw Error('Plugin loader checksum mismatch');
if(frontend.length>8*1024*1024)throw Error('Plugin entry exceeds Buzz’s module limit');
const {checkMediaSupport}=await import('./backend/media-support.mjs');
const media=checkMediaSupport();
if(!media.available)console.warn(`Missing Linux media support. Website cloning will stay blocked until this is resolved. ${media.instruction}`);
const appRoot=join(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'),'xyz.block.buzz.desktop');
const template=JSON.parse(await regular(join(packageRoot,'frontend','manifest.template.json')));
const release=digest(Buffer.from(JSON.stringify(checks))).slice(0,24),base=join(appRoot,'editor-plugins',template.id),destination=join(base,release),dataRoot=join(appRoot,'editor-workspaces');
const executable=join(destination,'backend','buzz-editor-host'),siblings=Object.entries(checks.backend).filter(([name])=>name!=='buzz-editor-host').map(([name,sha256])=>({name,sha256}));
const artifact={path:executable,sha256:checks.backend['buzz-editor-host'],siblings};
const manifest={...template,host:{processes:[
 {id:'editor-repository',program:'buzz-editor-host',artifact,args:[...template.host.processes[0].args,dataRoot]},
 {id:'editor-ui',program:'buzz-editor-host',artifact,args:['--input-type=module','-e',"import{readFile}from'node:fs/promises';import{dirname,join}from'node:path';process.stdout.write((await readFile(join(dirname(process.execPath),'editor-ui.mjs.gz'))).toString('base64'));" ]},
]}};
if(flags.has('--dry-run')){console.log(JSON.stringify({pluginId:manifest.id,importFolder:join(destination,'frontend'),runtime:join(destination,'backend'),dataRoot,copyLabData:flags.has('--copy-lab-data')},null,2));process.exit(0)}
async function exists(path){try{await lstat(path);return true}catch(e){if(e?.code==='ENOENT')return false;throw e}}
async function directory(path,create=true){
 if(!isAbsolute(path))throw Error('Plugin destination must be absolute');
 let current=parse(path).root;
 for(const part of path.slice(current.length).split('/').filter(Boolean)){
  current=join(current,part);
  if(create){try{await mkdir(current,{mode:0o700})}catch(error){if(error?.code!=='EEXIST')throw error}}
  const info=await lstat(current);
  if(!info.isDirectory()||info.isSymbolicLink())throw Error(`Unsafe directory: ${current}`);
 }
}
async function inventory(root){
 const result={};
 async function walk(relative){
  const path=join(root,relative),info=await lstat(path);
  if(info.isSymbolicLink())throw Error('Saved editor work contains a symbolic link; refusing an ambiguous migration');
  if(info.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(relative,name));return}
  if(!info.isFile())throw Error('Saved editor work contains a non-regular file');
  result[relative]=digest(await readFile(path));
 }
 await walk('');return result;
}
if(flags.has('--copy-lab-data')){
 for(const name of await readdir('/proc')){
  if(!/^\d+$/.test(name))continue;
  let exe;try{exe=(await readlink(`/proc/${name}/exe`)).replace(/ \(deleted\)$/,'')}catch{continue}
  if(exe.includes('/buzz-editor-lab/')&&(/\/target\/(?:debug|release)\/Buzz$/.test(exe)||exe.endsWith('/buzz-editor-host')))throw Error('Close Editor Lab before copying saved work');
 }
 if(await exists(dataRoot))throw Error('Editor data destination already exists; refusing to merge or overwrite it');
 const source=join(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'),'buzz-editor-lab');
 if(!(await exists(source)))throw Error('No saved Editor Lab data was found');
 await directory(appRoot);
 const stageParent=await mkdtemp(join(appRoot,'.editor-data-copy-'));
 const stage=join(stageParent,'data');
 try{const before=await inventory(source);await cp(source,stage,{recursive:true,errorOnExist:true,force:false,dereference:false,preserveTimestamps:true});if(JSON.stringify(await inventory(stage))!==JSON.stringify(before)||JSON.stringify(await inventory(source))!==JSON.stringify(before))throw Error('Saved work changed during migration; copy was not published');await rename(stage,dataRoot)}finally{await rm(stageParent,{recursive:true,force:true})}
}
await directory(base);
if(await exists(destination)){
 await directory(destination,false);await directory(join(destination,'backend'),false);await directory(join(destination,'frontend'),false);
 for(const [name,hash]of Object.entries(checks.backend))if(digest(await regular(join(destination,'backend',name)))!==hash)throw Error('Existing editor runtime differs from this package');
 if(digest(await regular(join(destination,'frontend','plugin.js')))!==checks.frontend)throw Error('Existing editor loader differs from this package');
}else{
 const stage=await mkdtemp(join(base,`.prepare-${release}-`));
 await mkdir(join(stage,'backend'),{mode:0o700});await mkdir(join(stage,'frontend'),{mode:0o700});
 try{
  for(const name of Object.keys(checks.backend)){await copyFile(join(packageRoot,'backend',name),join(stage,'backend',name));await chmod(join(stage,'backend',name),name.startsWith('buzz-editor-')?0o555:0o444);if(digest(await regular(join(stage,'backend',name)))!==checks.backend[name])throw Error('Runtime copy checksum mismatch')}
  await writeFile(join(stage,'frontend','plugin.js'),frontend,{flag:'wx',mode:0o600});
  await writeFile(join(stage,'frontend','manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(stage,'checksums.json'),JSON.stringify(checks,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(stage,destination);
 }catch(e){await rm(stage,{recursive:true,force:true});throw e}
}
console.log(`Prepared ${template.name}. Import this folder in normal Buzz Settings → Plugins:\n${join(destination,'frontend')}\nSaved editor data: ${dataRoot}\nThe plugin has not been installed or enabled.`);
