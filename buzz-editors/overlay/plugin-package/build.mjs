/**
 * Build Docs, Canvas and Page Builder as three standalone API-v1 plugins.
 *
 *   bin/node plugin-package/build.mjs [output-root] [docs|canvas|page-builder ...]
 *
 * output-root defaults to the Buzz-plugins checkout next to this lab. Each plugin
 * folder gets its own frontend, backend runtime, checksums and installer. All three
 * share the same saved-work folder, so they can be installed together or alone.
 */
import {build,loadConfigFromFile} from 'vite';
import * as React from 'react';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {writeNotices} from './notices.mjs';

// brandTool: Buzz refuses two plugins adding the same agent tool, so each plugin names its own.
// Page Builder keeps buzz_brand because the shared worker's guides refer to it.
const targets={
 'docs':{id:'lucas.docs',name:'Docs',pages:['docs'],brandTool:'buzz_docs_brand',description:'Docs editor with native Buzz agent collaboration: drafts, suggested edits and comment threads. Linux x64 preview.'},
 'canvas':{id:'lucas.canvas',name:'Canvas',pages:['canvas'],brandTool:'buzz_canvas_brand',description:'Canvas design editor with native Buzz agent collaboration: build from copy, marks and asset generation. Linux x64 preview.'},
 'page-builder':{id:'lucas.page-builder',name:'Page Builder',pages:['pages'],brandTool:'buzz_brand',description:'Page Builder with native Buzz agent collaboration: sections, website clones and Shopify/Vercel export. Linux x64 preview.'},
};
const root=process.cwd();
const [outArg,...picked]=process.argv.slice(2);
const outputRoot=resolve(root,outArg||'../../Buzz-plugins');
for(const name of picked)if(!targets[name])throw Error(`Unknown plugin: ${name}. Choose from ${Object.keys(targets).join(', ')}`);
const chosen=picked.length?picked:Object.keys(targets);

const reactNames=Object.keys(React).filter(key=>key!=='default'&&/^[A-Za-z_$][\w$]*$/.test(key));
const reactId='\0buzz-injected-react', jsxId='\0buzz-injected-jsx';
const config=(await loadConfigFromFile({command:'build',mode:'production'},resolve(root,'vite.config.ts'))).config;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function bundle(target){
 const result=await build({...config,configFile:false,logLevel:'warn',
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
   __BUZZ_PAGE_BUILDER_PLUGIN__:JSON.stringify(targets['page-builder'].id)},
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
 return `// ${target.name}: initialize imported components only after the host supplies React.\nexport const inject=["react","host","pages","agents","relay","conversation","panels","navigation","settingsCards"];\nexport function apply(ctx){const __buzzReact=ctx.react;\n${chunks[0].code}\nconst sheet=document.createElement('style');sheet.dataset.buzzEditors=${JSON.stringify(target.id)};sheet.textContent=${JSON.stringify(css)};ctx.effect(()=>{document.head.append(sheet);return()=>sheet.remove()});return BuzzEditorsSource.apply(ctx)}\n`;
}

// The native runtime is identical for every plugin: build it once.
execFileSync(join(root,'bin/cargo'),['build','--locked','--release','-p','buzz-editor-credentials','--features','packaged-plugin'],{cwd:root,stdio:'inherit'});
const backendSources={
 'buzz-editor-host':join(root,'src-tauri/resources/bin/buzz-editor-host'),
 'editor-bootstrap.mjs':join(root,'src-tauri/resources/bin/editor-bootstrap.mjs'),
 'editor-host.tgz':join(root,'src-tauri/resources/bin/editor-host.tgz'),
 'buzz-editor-credentials':join(root,'target/release/buzz-editor-credentials'),
 'media-support.mjs':join(root,'portable/editor-host/dist/editor-host/src/media-support.js'),
};
const source=JSON.parse(await readFile(join(root,'src/bundled/editor-lab/manifest.json'),'utf8'));
const loader=await readFile(join(root,'plugin-package/loader.mjs'),'utf8');

for(const folder of chosen){
 const target=targets[folder],output=join(outputRoot,folder);
 const code=await bundle(target);
 await mkdir(join(output,'frontend'),{recursive:true});
 await mkdir(join(output,'backend'),{recursive:true});
 await writeFile(join(output,'backend','editor-ui.mjs.gz'),gzipSync(code,{level:9}));
 const entry=loader.replaceAll('Buzz Editors',target.name);
 await writeFile(join(output,'frontend','plugin.js'),entry);
 // Native paths are resolved by the package installer, never by the plugin module.
 const manifest={...source,id:target.id,name:target.name,description:target.description};
 await writeFile(join(output,'frontend','manifest.template.json'),JSON.stringify(manifest,null,2)+'\n');
 const hashes={};
 for(const [name,from]of Object.entries(backendSources)){await copyFile(from,join(output,'backend',name));hashes[name]=digest(await readFile(join(output,'backend',name)))}
 hashes['editor-ui.mjs.gz']=digest(await readFile(join(output,'backend','editor-ui.mjs.gz')));
 await writeFile(join(output,'checksums.json'),JSON.stringify({frontend:digest(entry),backend:hashes},null,2)+'\n');
 await copyFile(join(root,'plugin-package/install.mjs'),join(output,'install.mjs'));
 await writeNotices(output);
 console.log(`Packaged ${target.name} (${target.id}): ${code.length} JS characters at ${output}`);
}
