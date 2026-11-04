/**
 * Build the editor plugins: Docs, Canvas, Page Builder and All Editors.
 *
 *   node plugin-package/build.mjs ui <out-dir>
 *       Editor UI bundles, one per plugin: ui-<plugin>.mjs.gz (platform independent).
 *   node plugin-package/build.mjs runtime <out-dir>
 *       The shared backend for this machine's OS: runtime-<platform>-<arch>.tar.gz.
 *       Run `pnpm editors:build` first.
 *   node plugin-package/build.mjs plugins <repo-root> --tag <tag> --sums <SHA256SUMS> [--base-url <url>]
 *       Each plugin folder's manifest.json, plugin.js, LICENSE and notices. The manifest's
 *       launchers download the release assets on first use and check them against SHA256SUMS,
 *       whose own hash is written into the manifest.
 *
 * Release assets (ui-*, runtime-*, SHA256SUMS) are published together as one GitHub Release.
 */
import {mkdir,writeFile,readFile,copyFile,rm,chmod,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join,dirname} from 'node:path';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeNotices} from './notices.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repository='Lucas10-ctrl/Buzz-plugins';
const description=what=>`${what} with native Buzz agent collaboration. Downloads its runtime on first use.`;
// brandTool: Buzz refuses two plugins adding the same agent tool, so each plugin names its own.
// Page Builder (and All Editors, which includes it) keep buzz_brand because the worker's guides use it.
// Install either All Editors or the single editors, not both: they share tool names.
const targets={
 'docs':{id:'lucas.docs',name:'Docs',pages:['docs'],brandTool:'buzz_docs_brand',pageBuilder:'lucas.page-builder',description:description('Docs editor: drafts, suggested edits and comment threads')},
 'canvas':{id:'lucas.canvas',name:'Canvas',pages:['canvas'],brandTool:'buzz_canvas_brand',pageBuilder:'lucas.page-builder',description:description('Canvas design editor: build from copy, marks and asset generation')},
 'page-builder':{id:'lucas.page-builder',name:'Page Builder',pages:['pages'],brandTool:'buzz_brand',pageBuilder:'lucas.page-builder',description:description('Page Builder: sections, website clones and Shopify/Vercel export')},
 'all-editors':{id:'lucas.editors',name:'All Editors',pages:['docs','canvas','pages'],brandTool:'buzz_brand',pageBuilder:'lucas.editors',description:description('Docs, Canvas and Page Builder in one plugin')},
};
const platforms=['linux-x64','darwin-arm64','darwin-x64','win32-x64'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const [mode,out,...rest]=process.argv.slice(2);
const option=name=>{const i=rest.indexOf(name);return i<0?undefined:rest[i+1]};
if(!out)throw Error('usage: build.mjs ui|runtime|plugins <dir> [options]');
const output=resolve(out);

if(mode==='ui'){
 const {build,loadConfigFromFile}=await import('vite');
 const React=await import('react');
 const reactNames=Object.keys(React).filter(key=>key!=='default'&&/^[A-Za-z_$][\w$]*$/.test(key));
 const reactId='\0buzz-injected-react', jsxId='\0buzz-injected-jsx';
 const config=(await loadConfigFromFile({command:'build',mode:'production'},resolve(root,'vite.config.ts'))).config;
 await mkdir(output,{recursive:true});
 for(const [folder,target]of Object.entries(targets)){
  const result=await build({...config,configFile:false,root,logLevel:'warn',
   plugins:[{name:'buzz-injected-react',enforce:'pre',resolveId(id){if(id==='react')return reactId;if(id==='react/jsx-runtime'||id==='react/jsx-dev-runtime')return jsxId;},load(id){
     if(id===reactId)return `const React=__buzzReact;export default React;export const {${reactNames.join(',')}}=React;`;
     if(id===jsxId)return `export {jsx,jsxs,Fragment,jsx as jsxDEV} from ${JSON.stringify(join(root,'node_modules/react/cjs/react-jsx-runtime.production.js'))};`;
   },transform(code,id){
     if(id.includes('/src/bundled/editor-lab/'))code=code.replaceAll('local.editor-lab',target.id).replaceAll('buzz_brand',target.brandTool);
     if(id.endsWith('/src/bundled/editor-lab/index.tsx'))code=`import {EditorHostProviders} from ${JSON.stringify(join(root,'plugin-package/providers.tsx'))};\n`+code.replaceAll('<Suspense','<EditorHostProviders ctx={ctx}><Suspense').replaceAll('</Suspense>','</Suspense></EditorHostProviders>');
     if(id.endsWith('/features/messages/encode-webp.ts'))return {code:`import InlineWorker from './webp-encoder.worker.ts?worker&inline';\n`+code.replace(/new Worker\(\s*new URL\("\.\/webp-encoder\.worker\.ts", import\.meta\.url\),\s*\{ type: "module" \},\s*\)/u,'new InlineWorker()'),map:null};
     if(id.endsWith('/design-system/icons/BestieMark.tsx'))return {code:code.replace(/new URL\("[^"\n]+bestie\.png", import\.meta\.url\)\s*\.href/u,JSON.stringify('data:image/png;base64,'+readFileSync(join(root,'public/bestie.png')).toString('base64'))),map:null};
     if(id.includes('/src/bundled/editor-lab/'))return {code,map:null};
   }},...config.plugins],
   define:{...config.define,'process.env.NODE_ENV':JSON.stringify('production'),
    __BUZZ_EDITOR_PAGES__:JSON.stringify(target.pages),
    __BUZZ_PAGE_BUILDER_PLUGIN__:JSON.stringify(target.pageBuilder),
    __BUZZ_EDITOR_LAUNCHER__:'true'},
   build:{write:false,assetsInlineLimit:Infinity,cssCodeSplit:false,minify:true,
     lib:{entry:resolve(root,'src/bundled/editor-lab/index.tsx'),name:'BuzzEditorsSource',formats:['iife']},
     rollupOptions:{output:{inlineDynamicImports:true}},
   },
  });
  const files=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);
  const chunks=files.filter(f=>f.type==='chunk'),css=files.filter(f=>f.type==='asset'&&f.fileName.endsWith('.css')).map(f=>f.source).join('\n');
  if(chunks.length!==1)throw Error('Plugin must have exactly one JavaScript module');
  const unexpected=files.filter(f=>f.type==='asset'&&!f.fileName.endsWith('.css'));
  if(unexpected.length)throw Error(`Plugin has unsupported external assets: ${unexpected.map(f=>f.fileName)}`);
  const code=`// ${target.name}: initialize imported components only after the host supplies React.\nexport const inject=["react","host","pages","agents","relay","conversation","panels","navigation","settingsCards"];\nexport function apply(ctx){const __buzzReact=ctx.react;\n${chunks[0].code}\nconst sheet=document.createElement('style');sheet.dataset.buzzEditors=${JSON.stringify(target.id)};sheet.textContent=${JSON.stringify(css)};ctx.effect(()=>{document.head.append(sheet);return()=>sheet.remove()});return BuzzEditorsSource.apply(ctx)}\n`;
  await writeFile(join(output,`ui-${folder}.mjs.gz`),gzipSync(code,{level:9}));
  console.log(`Built ui-${folder}.mjs.gz (${code.length} JS characters)`);
 }
}else if(mode==='runtime'){
 const platform=`${process.platform}-${process.arch}`;
 if(!platforms.includes(platform))throw Error(`Unsupported platform: ${platform}`);
 const exe=process.platform==='win32'?'.exe':'';
 const cargo=process.env.BUZZ_CARGO??join(root,'bin','cargo');
 execFileSync(cargo,['build','--locked','--release','-p','buzz-editor-credentials','--features','packaged-plugin'],{cwd:root,stdio:'inherit'});
 const target=resolve(root,process.env.CARGO_TARGET_DIR??'target');
 const files={
  [`buzz-editor-host${exe}`]:join(root,'src-tauri/resources/bin',`buzz-editor-host${exe}`),
  'editor-bootstrap.mjs':join(root,'src-tauri/resources/bin/editor-bootstrap.mjs'),
  'editor-host.tgz':join(root,'src-tauri/resources/bin/editor-host.tgz'),
  [`buzz-editor-credentials${exe}`]:join(target,'release',`buzz-editor-credentials${exe}`),
  'media-support.mjs':join(root,'portable/editor-host/dist/editor-host/src/media-support.js'),
  'launch.mjs':join(root,'plugin-package/launch.mjs'),
  'LICENSE':join(root,'portable/COPYOS-LICENSE'),
 };
 const stage=await mkdtemp(join(tmpdir(),'buzz-editor-runtime-'));
 try{
  for(const [name,from]of Object.entries(files)){await copyFile(from,join(stage,name));if(name.startsWith('buzz-editor-'))await chmod(join(stage,name),0o755)}
  await mkdir(output,{recursive:true});
  const {create}=await import('tar');
  await create({file:join(output,`runtime-${platform}.tar.gz`),cwd:stage,gzip:{level:9},portable:true},Object.keys(files));
 }finally{await rm(stage,{recursive:true,force:true})}
 console.log(`Built runtime-${platform}.tar.gz`);
}else if(mode==='plugins'){
 const tag=option('--tag'),sums=option('--sums');
 if(!tag||!sums)throw Error('plugins needs --tag and --sums');
 if(!/^[A-Za-z0-9._-]+$/.test(tag))throw Error('Invalid tag');
 const base=option('--base-url')??`https://github.com/${repository}/releases/download/${tag}`;
 if(!/^https?:\/\/[^\s'"$`\\]+$/.test(base))throw Error('Invalid base URL');
 const sumsText=await readFile(resolve(sums),'utf8'),sumsHash=digest(sumsText);
 const listed=new Set(sumsText.trim().split('\n').map(line=>line.slice(66)));
 const loader=await readFile(join(root,'plugin-package/loader.mjs'),'utf8');
 for(const [folder,target]of Object.entries(targets)){
  for(const name of [`ui-${folder}.mjs.gz`,...platforms.map(p=>`runtime-${p}.tar.gz`)])
   if(!listed.has(name))throw Error(`SHA256SUMS is missing ${name}`);
  const dir=join(output,folder);
  await mkdir(dir,{recursive:true});
  const ui=`ui-${folder}.mjs.gz`;
  const manifest={id:target.id,name:target.name,apiVersion:1,description:target.description,host:{processes:[
   unixLauncher('editor-ui','ui',{tag,base,sumsHash,ui}),
   unixLauncher('editor-repository','repository',{tag,base,sumsHash,ui}),
   windowsLauncher('editor-ui-win','ui',{tag,base,sumsHash,ui}),
   windowsLauncher('editor-repository-win','repository',{tag,base,sumsHash,ui}),
  ]}};
  if(manifest.description.length>280)throw Error(`Description too long: ${folder}`);
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(dir,'plugin.js'),loader.replaceAll('Buzz Editors',target.name));
  await writeNotices(dir);
  console.log(`Wrote ${folder}/manifest.json (${target.id}, ${tag})`);
 }
}else throw Error(`Unknown mode: ${mode}`);

/** Split a script into host-process arguments of at most 1000 bytes, only at line ends. */
function pack(lines){
 const parts=[];let part='';
 for(const line of lines){
  if(line.length>1000)throw Error(`Launcher line too long (${line.length}): ${line.slice(0,60)}`);
  if((part+line+'\n').length>1000){parts.push(part);part=''}
  part+=line+'\n';
 }
 if(part)parts.push(part);
 return parts;
}

/** macOS and Linux: sh downloads, verifies and unpacks the release once per user, then runs it. */
function unixLauncher(id,mode,{tag,base,sumsHash,ui}){
 const script=[
  'set -e',
  '# Buzz on Linux runs as an AppImage whose LD_LIBRARY_PATH breaks system tools such as curl. Set it aside for the download, restore it for the editor.',
  'if [ -n "${LD_LIBRARY_PATH+x}" ]; then L="$LD_LIBRARY_PATH"; unset LD_LIBRARY_PATH; fi',
  'case "$(uname -s)-$(uname -m)" in',
  'Linux-x86_64) p=linux-x64; A="${XDG_DATA_HOME:-$HOME/.local/share}";;',
  'Darwin-arm64) p=darwin-arm64; A="$HOME/Library/Application Support";;',
  'Darwin-x86_64) p=darwin-x64; A="$HOME/Library/Application Support";;',
  '*) echo "Unsupported computer: $(uname -sm). Buzz editors run on macOS, Linux x64 and Windows x64." >&2; exit 1;;',
  'esac',
  `R="$A/buzz-editors/${tag}/$p"; U='${base}'; mkdir -p "$R"`,
  'h() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64; }',
  'g() { f="$R/$1"; [ -f "$f" ] && return 0; t="$f.$$"',
  ' curl -fsSL --retry 3 "$U/$1" -o "$t" || { rm -f "$t"; echo "Could not download $1 from GitHub." >&2; exit 1; }',
  ` if [ "$1" = SHA256SUMS ]; then e=${sumsHash}; else e="$(grep " $1\\$" "$R/SHA256SUMS" | cut -c1-64)"; fi`,
  ' [ "$(h "$t")" = "$e" ] || { rm -f "$t"; echo "Downloaded $1 failed its checksum." >&2; exit 1; }',
  ' mv -f "$t" "$f"; }',
  `g SHA256SUMS; g "runtime-$p.tar.gz"; g ${ui}`,
  'D="$R/rt"',
  'if [ ! -d "$D" ]; then x="$D.$$"; mkdir "$x"; tar -xzf "$R/runtime-$p.tar.gz" -C "$x" 2>/dev/null; if [ -d "$D" ]; then rm -rf "$x"; else mv "$x" "$D"; fi; fi',
  `if [ "$m" = ui ]; then a="$R/${ui}"; else a="$A/xyz.block.buzz.desktop/editor-workspaces"; fi`,
  'if [ -n "${L+x}" ]; then export LD_LIBRARY_PATH="$L"; fi',
  'exec "$D/buzz-editor-host" "$D/launch.mjs" "$m" "$a"',
 ];
 const args=['-c','m=$1; shift; s=; for a; do s="$s$a"; done; eval "$s"','sh',mode,...pack(script)];
 if(args.length>16)throw Error('Launcher needs too many arguments');
 return {id,program:'sh',args};
}

/** Windows: PowerShell joins the arguments after -Command with spaces. No double quotes: Windows argument quoting would alter them. */
function windowsLauncher(id,mode,{tag,base,sumsHash,ui}){
 const script=[
  `$m='${mode}';`,
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';",
  '[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;',
  `$R=Join-Path $env:LOCALAPPDATA (Join-Path 'buzz-editors' (Join-Path '${tag}' 'win32-x64')); $U='${base}/';`,
  'New-Item -ItemType Directory -Force -Path $R | Out-Null;',
  'function H($f) { (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower() };',
  'function G($n) { $f=Join-Path $R $n; if (Test-Path -LiteralPath $f) { return }; $t=$f+$PID;',
  " try { Invoke-WebRequest -UseBasicParsing -Uri ($U+$n) -OutFile $t } catch { [Console]::Error.WriteLine('Could not download '+$n+' from GitHub: '+$_.Exception.Message); exit 1 };",
  ` if ($n -eq 'SHA256SUMS') { $e='${sumsHash}' } else { $e=(Get-Content -LiteralPath (Join-Path $R 'SHA256SUMS') | Where-Object { $_.EndsWith(' '+$n) } | ForEach-Object { $_.Substring(0,64) }) };`,
  " if ((H $t) -ne $e) { Remove-Item -LiteralPath $t; [Console]::Error.WriteLine('Downloaded '+$n+' failed its checksum.'); exit 1 }; Move-Item -Force -LiteralPath $t -Destination $f };",
  `G 'SHA256SUMS'; G 'runtime-win32-x64.tar.gz'; G '${ui}';`,
  "$D=Join-Path $R 'rt';",
  "if (-not (Test-Path -LiteralPath $D)) { $x=$D+$PID; New-Item -ItemType Directory -Path $x | Out-Null; & tar.exe -xzf (Join-Path $R 'runtime-win32-x64.tar.gz') -C $x; if (Test-Path -LiteralPath $D) { Remove-Item -Recurse -Force -LiteralPath $x } else { Move-Item -LiteralPath $x -Destination $D } };",
  `if ($m -eq 'ui') { $a=Join-Path $R '${ui}' } else { $a=Join-Path $env:APPDATA (Join-Path 'xyz.block.buzz.desktop' 'editor-workspaces') };`,
  "$q=[char]34; $i=New-Object System.Diagnostics.ProcessStartInfo (Join-Path $D 'buzz-editor-host.exe'); $i.UseShellExecute=$false;",
  "$i.Arguments=$q+(Join-Path $D 'launch.mjs')+$q+' '+$m+' '+$q+$a+$q;",
  '$c=[System.Diagnostics.Process]::Start($i); $c.WaitForExit(); exit $c.ExitCode',
 ];
 for(const line of script)if(line.includes('"'))throw Error('Windows launcher must not contain double quotes');
 const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',...pack(script).map(part=>part.replaceAll('\n',' ').trim())];
 if(args.length>16)throw Error('Launcher needs too many arguments');
 return {id,program:'powershell',args};
}
