// @vitest-environment jsdom
import {Context} from '@deepseek-ai/cordis';
import * as React from 'react';
import {afterEach,expect,it} from 'vitest';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {PagesService} from '../src/features/pages/service';
import {provideNavigation} from '../src/features/navigation/service';
import {ConversationService} from '../src/features/conversation/service';
let directory;
afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true})});
it('loads the relocated packaged UI with host React, registers the three pages and disposes them',async()=>{
 const packageRoot=resolve('../buzz-editors-plugin-package');
 const code=gunzipSync(await readFile(join(packageRoot,'backend','editor-ui.mjs.gz'))).toString('utf8');
 directory=await mkdtemp(join(tmpdir(),'buzz-editors-package-'));
 // The payload has only two declaration exports; evaluate its unchanged IIFE inside this host realm.
 const declarations=code.replace(/^export const inject=/m,'const inject=').replace(/^export function apply/m,'function apply');
 const editors=new Function(declarations+';return {inject,apply}')();
 const root=new Context();root.provide('react',React);
 root.provide('pluginStatus',{isActive:()=>true,subscribe:()=>()=>{}});
 root.provide('host',{});const pages=new PagesService(root);provideNavigation(root);
 root.provide('agents',{addTool:()=>{}});root.provide('relay',{snapshot:()=>({}),subscribe:()=>()=>{}});
 new ConversationService(root);root.provide('panels',{});root.provide('settingsCards',{register:()=>()=>{}});
 const scope=root.extend({pluginOwner:{id:'buzz.editors',revision:'package-test'}}),fiber=scope.plugin(editors);
 try{
   await fiber.await();
   expect(pages.snapshot().map(p=>p.title)).toEqual(['Docs','Canvas','Page Builder']);
   expect(document.querySelector('[data-buzz-editors]')).not.toBeNull();
   await fiber.dispose();expect(pages.snapshot()).toEqual([]);expect(document.querySelector('[data-buzz-editors]')).toBeNull();
 }finally{await root.fiber.dispose()}
},20000);
