/** Exercise the packaged native runtime outside the checkout and without provider credentials. */
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawn}from'node:child_process';import{once}from'node:events';import{createHash}from'node:crypto';
const packageRoot=resolve('../buzz-editors-plugin-package'),root=await mkdtemp(join(tmpdir(),'buzz-packaged-backend-'));
const manifest=JSON.parse(await readFile(join(packageRoot,'frontend/manifest.template.json'),'utf8'));
const child=spawn(join(packageRoot,'backend/buzz-editor-host'),[...manifest.host.processes[0].args,root],{cwd:tmpdir(),stdio:['pipe','pipe','pipe']});
let buffer='',stderr='',sequence=0;const waiting=new Map();let ready;
const startup=new Promise((resolve,reject)=>{ready={resolve,reject}});
child.stderr.on('data',chunk=>stderr+=chunk);
child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),message=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(message.type==='ready')ready.resolve();else if(message.type==='result'){const gate=waiting.get(message.id);waiting.delete(message.id);message.ok?gate.resolve(message.value):gate.reject(Error(message.error))}else ready.reject(Error(message.error))}});
const exited=once(child,'exit');child.on('error',error=>ready.reject(error));
const timeout=setTimeout(()=>{child.kill('SIGTERM');ready.reject(Error('Packaged worker did not complete its smoke within 30 seconds'))},30000);
const call=(operation,input)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,operation,input})+'\n')});
try{
 await startup;
 const media=await call('checkMediaSupport',null);
 if(typeof media.available!=='boolean'||typeof media.instruction!=='string')throw Error('Missing packaged media dependency check');
 const page=await call('createPage',{workspaceId:'packaged-check',title:'Packaged worker check'});
 const clone=await call('clonePage',{workspaceId:'packaged-check',pageId:page.id,expectedRevision:page.revision});
 if(clone.id===page.id)throw Error('Clone did not create an independent page');
 await call('deletePage',{workspaceId:'packaged-check',pageId:clone.id,expectedRevision:clone.revision});
 await call('restorePage',{workspaceId:'packaged-check',pageId:clone.id,expectedRevision:clone.revision});
 const pages=await call('listPages','packaged-check');if(pages.length!==2)throw Error('Unexpected page state after restore');
 child.stdin.end();const [code]=await exited;if(code!==0)throw Error(`Packaged worker exited ${code}: ${stderr}`);
 const checksum=createHash('sha256').update(await readFile(join(packageRoot,'backend/editor-ui.mjs.gz'))).digest('hex');
 console.log(JSON.stringify({outsideCheckout:true,workerExit:code,pageCloneDeleteRestore:true,mediaSupport:media.available,uiPayloadSha256:checksum}));
}finally{clearTimeout(timeout);if(child.exitCode===null){child.kill('SIGTERM');await exited}await rm(root,{recursive:true,force:true})}
