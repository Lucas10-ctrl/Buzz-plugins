// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {createElement} from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi}from'vitest';
import {EditorHostProviders} from '../plugin-package/providers';
import {ComposerModels}from'../src/features/messages/ComposerModels';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('connects the real composer model and session controls to the host agent service',async()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}));
 const pubkey='a'.repeat(64),agent={key:'strategist-key',pubkey,name:'Strategist',type:'codex'};
 const snapshot={agents:[agent]},models=vi.fn(async()=>({current:'model-one',models:[{id:'model-one',label:'Model one',efforts:[]},{id:'model-two',label:'Model two',efforts:[]}]}));
 const types=[{key:'codex',models,sessionControls:{scope:()=> 'channel',subscribe:()=>()=>{}}}];
 const session=vi.fn(async()=>{}),agents={snapshot:()=>snapshot,types:()=>types,subscribe:()=>()=>{},find:()=>agent,sessionState:()=> 'idle',session};
 const profiles={snapshot:()=>new Map(),subscribe:()=>()=>{},ensure:async()=>{}};
 render(createElement(EditorHostProviders,{ctx:{agents},children:createElement(ComposerModels,{pubkeys:[pubkey],profiles,media:{},value:{},disabled:false,onChange(){},onResolved(){},startsThread:false,place:{scope:'scope',channelId:'dm'}})}));
 fireEvent.click(await screen.findByRole('button',{name:'Model, effort, and session controls'}));
 await screen.findByText('Model one');
 fireEvent.click(await screen.findByRole('button',{name:'Compact session',exact:true}));
 await waitFor(()=>expect(session).toHaveBeenCalledWith('strategist-key',{scope:'scope',channelId:'dm'},'compact'));
 expect(models).toHaveBeenCalledWith(agent);
});
