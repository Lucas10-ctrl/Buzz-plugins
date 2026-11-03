/** Session-bound real conversation reused inside a document's floating assistant panel. */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime, PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Real transcript for the document's retained assistant session, with a host-owned scoped composer. */
    'copyos.docs.conversation': { kind: 'single'; scope: 'session' }
  }
}
function DocsChatView({ renderSlot }: ConversationViewsProps): ReactNode {
  return renderSlot('conversation.session', { view: 'chat' })
}
/** Render the real session transcript without creating a second native input owner.
 * @param props - Bound session sources and reusable Conversation Factory renderer.
 * @returns The existing Chat target with the document host supplying its scoped input.
 */
export function DocsConversation(props: Pick<PropsRuntime<'copyos.docs.conversation'>, 'useSession'> & PropsRenderFactories): ReactNode {
  const state = props.useSession(value => value)
  return props.renderFactorySlot('conversation.content', { variant: 'embedded',
    phase: state.openState === 'loading' ? 'settling' : 'active', hero: false, composer: false,
  }, { slots: { views: DocsChatView } })
}
/** Retain a known owner chat only for the document panel's lifetime.
 * @param props - Authorized associated session, provider, child renderer and retention callback.
 * @returns The bound conversation, or no transcript until its session is retained.
 */
export function DocsConversationHost({ sessionId, retain, SessionProvider, renderSlot, visible }: {
  readonly visible: boolean
  readonly sessionId: SessionId | null
  readonly retain: (sessionId: SessionId) => SessionReference
  readonly SessionProvider: PropsRenderSlots<'copyos.docs.conversation'>['SessionProvider']
  readonly renderSlot: PropsRenderSlots<'copyos.docs.conversation'>['renderSlot']
}): ReactNode {
  const [reference, setReference] = useState<SessionReference | null>(null)
  useEffect(() => {
    if (sessionId === null) return
    const next = retain(sessionId); setReference(next)
    return () => { setReference(null); next.release() }
  }, [sessionId, retain])
  if (!reference || reference.sessionId !== sessionId) return null
  return <SessionProvider session={reference}>{visible ? renderSlot('copyos.docs.conversation', {}) : null}</SessionProvider>
}
