/** Session ownership while a document replaces the native chat column. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Requested session and the document editor currently mounted in the main panel. */
export interface DocsPresentationState {
  readonly requested: SessionId | null
  readonly shown: SessionId | null
  readonly conversationOpen: boolean
}

/** Plugin-owned presentation state shared by the session tab and main document panel. */
export interface DocsPresentation {
  readonly state: HostObservable<DocsPresentationState>
  /**
   * @param sessionId - Session whose document should replace native chat.
   * @param conversationOpen - Reveal the accepted request and its response.
   */
  readonly request: (sessionId: SessionId, conversationOpen?: boolean) => void
  /** @param sessionId - Session whose main editor is mounting. @returns Release for this editor occurrence. */
  readonly show: (sessionId: SessionId) => () => void
}

/** Create presentation state for one plugin instance.
 * @returns Observable session identities and their lifecycle writers.
 */
export function createDocsPresentation(): DocsPresentation {
  const state = createSnapshotStore<DocsPresentationState>({ requested: null, shown: null, conversationOpen: false })
  let occurrence = 0
  return {
    state,
    request: (sessionId, conversationOpen = false) => { state.set({ ...state.getSnapshot(), requested: sessionId, conversationOpen }) },
    show: (sessionId) => {
      const owned = ++occurrence
      state.set({ ...state.getSnapshot(), shown: sessionId })
      return () => {
        if (owned === occurrence) state.set({ ...state.getSnapshot(), shown: null })
      }
    },
  }
}
