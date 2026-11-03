import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {Context} from '@deepseek-ai/cordis';
import {PagesService} from '../src/features/pages/service';
import {provideNavigation} from '../src/features/navigation/service';
import {ConversationService} from '../src/features/conversation/service';
import * as plugin from '../plugin-package/loader.mjs';
import '../src/shared/styles/globals.css';
const scope=new Context();
scope.provide('react',React);
scope.provide('pluginStatus',{isActive:()=>true,subscribe:()=>()=>{}});
const encoded=await (await fetch('/.scratch/editor-ui.b64')).text();
scope.provide('host',{spawn:async(id,callbacks)=>{
 if(id!=='editor-ui')throw Error('Native repository execution is checked separately');
 const exited=new Promise<number>(resolve=>queueMicrotask(()=>{callbacks.onStdout(encoded);resolve(0)}));
 return {exited,kill:async()=>{},write:async()=>{},end:async()=>{}};
}});
const pages=new PagesService(scope);provideNavigation(scope);
const none=()=>()=>{},solo={status:'ready',data:{sections:[],assignments:{}}},choices={selectable:[]};
const connection={status:'disconnected',scope:null,session:{soloPreferences:{snapshot:()=>solo,subscribe:none,ensure(){}},agentChoices:{snapshot:()=>choices,subscribe:none,ensure(){}},directMessages:{available:false}}};
const emptyAgents={agents:[]},emptyTypes=[];
scope.provide('agents',{addTool:()=>{},snapshot:()=>emptyAgents,types:()=>emptyTypes,subscribe:none,joinable:()=>[]});scope.provide('relay',{snapshot:()=>connection,subscribe:none});
new ConversationService(scope);scope.provide('panels',{});scope.provide('settingsCards',{register:()=>()=>{}});
const fiber=scope.extend({pluginOwner:{id:'buzz.editors',revision:'package-proof'}}).plugin(plugin);
const output=document.getElementById('output');
try{
 await fiber.await();
 const view=createRoot(output!);
 const select=(id:string)=>{const page=pages.snapshot().find(p=>p.id===id);if(!page)throw Error('Missing packaged page');view.render(React.createElement(page.component))};
 for(const page of pages.snapshot()){
  const button=document.createElement('button');button.textContent=page.title;button.onclick=()=>select(page.id);document.getElementById('controls')!.append(button);
 }
 const theme=document.createElement('button');theme.textContent='Toggle preview theme';theme.onclick=()=>{document.documentElement.dataset.colorMode=document.documentElement.dataset.colorMode==='dark'?'light':'dark'};document.getElementById('controls')!.append(theme);
 select('pages');
 document.documentElement.dataset.packageReady='true';
}catch(error){output!.textContent=String(error);document.documentElement.dataset.packageError='true';throw error}
