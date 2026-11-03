/** Check the package installer and public plugin-manager import in a disposable profile. */
import{mkdtemp,rm,readFile,mkdir,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{execFileSync}from'node:child_process';
const scratch=await mkdtemp(join(tmpdir(),'buzz-editor-install-check-')),installer=resolve('../buzz-editors-plugin-package/install.mjs');
const options={env:{...process.env,XDG_DATA_HOME:scratch},encoding:'utf8'};
try{
 const planned=JSON.parse(execFileSync(process.execPath,[installer,'--dry-run'],options));
 await mkdir(join(scratch,'buzz-editor-lab','workspaces','test'),{recursive:true});
 await writeFile(join(scratch,'buzz-editor-lab','workspaces','test','saved.txt'),'saved work');
 execFileSync(process.execPath,[installer,'--copy-lab-data'],options);
 if(await readFile(join(planned.dataRoot,'workspaces','test','saved.txt'),'utf8')!=='saved work')throw Error('Saved-work copy failed');
 const manifest=JSON.parse(await readFile(join(planned.importFolder,'manifest.json'),'utf8'));
 if(manifest.id!=='buzz.editors'||manifest.host.processes.some(p=>p.bundled))throw Error('Package still depends on app-bundled editor resources');
 const result=execFileSync(resolve('target/debug/buzzodz'),['--home',join(scratch,'plugin-manager'),'--profile','acceptance','plugin','install',planned.importFolder],options);
 console.log(result.trim());
 const listed=execFileSync(resolve('target/debug/buzzodz'),['--home',join(scratch,'plugin-manager'),'--profile','acceptance','plugin','list'],options);
 if(!listed.includes('buzz.editors'))throw Error('Plugin import did not appear in the catalogue');
 console.log('Package prepared and imported in a disposable profile; normal Buzz was not changed.');
}finally{await rm(scratch,{recursive:true,force:true})}
