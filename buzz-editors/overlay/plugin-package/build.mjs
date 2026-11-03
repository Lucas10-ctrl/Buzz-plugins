/** Build API-v1's single-module frontend using Buzz's injected React instance. */
import {build,loadConfigFromFile} from 'vite';
import * as React from 'react';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=process.cwd(), output=resolve(root,'../buzz-editors-plugin-package');
const reactNames=Object.keys(React).filter(key=>key!=='default'&&/^[A-Za-z_$][\w$]*$/.test(key));
const reactId='\0buzz-injected-react', jsxId='\0buzz-injected-jsx';
const config=(await loadConfigFromFile({command:'build',mode:'production'},resolve(root,'vite.config.ts'))).config;
const result=await build({...config,configFile:false,
 plugins:[{name:'buzz-injected-react',enforce:'pre',resolveId(id){if(id==='react')return reactId;if(id==='react/jsx-runtime'||id==='react/jsx-dev-runtime')return jsxId;},load(id){
   if(id===reactId)return `const React=__buzzReact;export default React;export const {${reactNames.join(',')}}=React;`;
   if(id===jsxId)return `export {jsx,jsxs,Fragment,jsx as jsxDEV} from ${JSON.stringify(join(root,'node_modules/react/cjs/react-jsx-runtime.production.js'))};`;
 },transform(code,id){
   if(id.includes('/src/bundled/editor-lab/'))code=code.replaceAll('local.editor-lab','buzz.editors');
   if(id.endsWith('/src/bundled/editor-lab/index.tsx'))code=`import {EditorHostProviders} from ${JSON.stringify(join(root,'plugin-package/providers.tsx'))};\n`+code.replaceAll('<Suspense','<EditorHostProviders ctx={ctx}><Suspense').replaceAll('</Suspense>','</Suspense></EditorHostProviders>');
   if(id.endsWith('/features/messages/encode-webp.ts'))return {code:`import InlineWorker from './webp-encoder.worker.ts?worker&inline';\n`+code.replace(/new Worker\(\s*new URL\("\.\/webp-encoder\.worker\.ts", import\.meta\.url\),\s*\{ type: "module" \},\s*\)/u,'new InlineWorker()'),map:null};
   if(id.endsWith('/design-system/icons/BestieMark.tsx'))return {code:code.replace(/new URL\("[^"\n]+bestie\.png", import\.meta\.url\)\s*\.href/u,JSON.stringify('data:image/png;base64,'+readFileSync(join(root,'public/bestie.png')).toString('base64'))),map:null};
   if(id.includes('/src/bundled/editor-lab/'))return {code,map:null};
 }},...config.plugins],
 define:{...config.define,'process.env.NODE_ENV':JSON.stringify('production')},
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
const code=`// Buzz Editors: initialize imported components only after the host supplies React.\nexport const inject=["react","host","pages","agents","relay","conversation","panels","navigation","settingsCards"];\nexport function apply(ctx){const __buzzReact=ctx.react;\n${chunks[0].code}\nconst sheet=document.createElement('style');sheet.dataset.buzzEditors='';sheet.textContent=${JSON.stringify(css)};ctx.effect(()=>{document.head.append(sheet);return()=>sheet.remove()});return BuzzEditorsSource.apply(ctx)}\n`;
await mkdir(join(output,'frontend'),{recursive:true});
await mkdir(join(output,'backend'),{recursive:true});
await writeFile(join(output,'backend','editor-ui.mjs.gz'),gzipSync(code,{level:9}));
await writeFile(join(output,'frontend','plugin.js'),await readFile(join(root,'plugin-package/loader.mjs'),'utf8'));
const source=JSON.parse(await readFile(join(root,'src/bundled/editor-lab/manifest.json'),'utf8'));
const manifest={...source,id:'buzz.editors',name:'Buzz Editors',description:'Page Builder, Canvas and Docs with native Buzz agent collaboration. Linux x64 preview.'};
// Native paths are resolved by the package installer, never by the plugin module.
await writeFile(join(output,'frontend','manifest.template.json'),JSON.stringify(manifest,null,2)+'\n');
await mkdir(join(output,'backend'),{recursive:true});
const backendFiles=['buzz-editor-host','editor-bootstrap.mjs','editor-host.tgz','buzz-editor-credentials','media-support.mjs'];
execFileSync(join(root,'bin/cargo'),['build','--locked','--release','-p','buzz-editor-credentials','--features','packaged-plugin'],{cwd:root,stdio:'inherit'});
const hashes={};
for(const name of backendFiles){await copyFile(name==='media-support.mjs'?join(root,'portable/editor-host/dist/editor-host/src/media-support.js'):name==='buzz-editor-credentials'?join(root,'target/release/buzz-editor-credentials'):join(root,'src-tauri/resources/bin',name),join(output,'backend',name));hashes[name]=createHash('sha256').update(await readFile(join(output,'backend',name))).digest('hex')}
hashes['editor-ui.mjs.gz']=createHash('sha256').update(await readFile(join(output,'backend','editor-ui.mjs.gz'))).digest('hex');
await writeFile(join(output,'checksums.json'),JSON.stringify({frontend:createHash('sha256').update(await readFile(join(output,'frontend','plugin.js'))).digest('hex'),backend:hashes},null,2)+'\n');
await copyFile(join(root,'plugin-package/install.mjs'),join(output,'install.mjs'));
await copyFile(join(root,'plugin-package/README.md'),join(output,'README.md'));
await copyFile(join(root,'LICENSE'),join(output,'LICENSE'));
console.log(`Packaged ${code.length} JS characters with injected React, inline CSS, and ${backendFiles.length} backend files at ${output}`);
