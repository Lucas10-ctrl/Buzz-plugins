/** Bridge the host services into this independently bundled React tree. */
import type {ReactNode} from 'react';
import type {PluginModule} from '../src/plugins/api';
import {AgentsContext} from '../src/features/agents/react';
import {AgentAvatarArtworkProvider} from '../src/features/agents/AgentAvatarArtworkProvider';
import {ToastProvider} from '../src/shared/design-system/ui/Toast';
import {ModalWindowDragProvider} from '../src/shared/design-system/ui/ModalWindowDrag';
import {modalWindowDragHandlers} from '../src/app/shell/title-bar';
import {isTauri} from '@tauri-apps/api/core';
type Ctx=Parameters<PluginModule['apply']>[0];
export function EditorHostProviders({ctx,children}:{ctx:Ctx;children:ReactNode}) {
 return <AgentsContext.Provider value={ctx.agents}><AgentAvatarArtworkProvider>
  <ModalWindowDragProvider value={isTauri()?modalWindowDragHandlers:undefined}>
   <ToastProvider>{children}</ToastProvider>
  </ModalWindowDragProvider>
 </AgentAvatarArtworkProvider></AgentsContext.Provider>;
}
