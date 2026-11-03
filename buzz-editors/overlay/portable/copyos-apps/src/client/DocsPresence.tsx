/** Pane identities and jump controls for currently authorized document readers. */
import type { ReactNode } from 'react'
import { IconUserOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocsPresencePeer } from './DocsModel.ts'
import css from './DocsWorkspace.module.css'

/** Resolve a pane label without implying an authenticated person's profile.
 * @param peer - Current server-derived role and pane identity.
 * @param t - Document interface translator.
 * @returns Localized role and short pane ID.
 */
export function docsPeerLabel(peer: DocsPresencePeer, t: PropsLocale<'copyosFoundation'>['t']): string {
  const key = peer.role === 'owner' ? 'docsPresenceOwner' : peer.role === 'editor' ? 'docsPresenceEditor'
    : peer.role === 'commenter' ? 'docsPresenceCommenter' : 'docsPresenceViewer'
  return `${t(key)} · ${peer.id.slice(0, 4)}`
}
/** Show up to three open panes and an overflow list, each with a keyboard-accessible jump.
 * @param props - Authorized peers, availability, translator and navigation callback.
 * @returns People controls, or no chrome when alone and available.
 */
export function DocsPresence({ peers, unavailable, jump, t }: PropsLocale<'copyosFoundation'> & {
  readonly peers: readonly DocsPresencePeer[]
  readonly unavailable: boolean
  readonly jump: (peer: DocsPresencePeer) => void
}): ReactNode {
  const button = (peer: DocsPresencePeer): ReactNode => {
    const label = docsPeerLabel(peer, t)
    return <Tooltip key={peer.id} label={t('docsPresenceJump', { name: label })} portal>
      <button type="button" className={css.presenceAvatar} aria-label={t('docsPresenceJump', { name: label })}
        onClick={() => { jump(peer) }}><span className={css.presenceAvatarMark}><IconUserOutlineRegular size={16} /></span></button>
    </Tooltip>
  }
  return <div className={css.presence} role="group" aria-label={t('docsPresencePeople')}>
    {peers.slice(0, 3).map(button)}
    {peers.length > 3 ? <details className={css.presenceOverflow}>
      <summary aria-label={t('docsPresenceMore', { count: peers.length - 3 })}>+{peers.length - 3}</summary>
      <div>{peers.slice(3).map(button)}</div>
    </details> : null}
    {unavailable ? <span className={css.presenceUnavailable} role="status">{t('docsPresenceUnavailable')}</span> : null}
  </div>
}
