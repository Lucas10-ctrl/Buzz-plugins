/** Concise document collaboration requests, projected only from their exact logged envelope. */
import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocsRequestEnvelope } from './DocsAssistantRequest.ts'
import css from './DocsRequestMessage.module.css'

/** Navigation supplied by the current Session's document pane. */
export interface DocsRequestMessageInjected {
  readonly openDocument: (request: DocsRequestEnvelope, inPage: boolean) => Promise<void>
}
type Props = PropsRuntime<'conversation.chat.userMessage'> & PropsLocale<'copyosFoundation'>
  & InjectFace<DocsRequestMessageInjected> & { readonly matched: DocsRequestEnvelope }
/** Render the user request and target separately from the inspectable model instructions. */
export function DocsRequestMessage({ matched, renderActions, openDocument, usePanelInfo, t }: Props): ReactNode {
  const inPage = usePanelInfo(state => state.activePanelId !== null)
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false)
  return <div className={css.row} role="group" aria-label={t('docsDocumentRequest')}>
    <div className={css.bubble}>
      <button className={css.target} disabled={pending} onClick={() => {
        setPending(true); setFailed(false)
        void openDocument(matched, inPage).catch(() => { setFailed(true) }).finally(() => { setPending(false) })
      }}><IconDeliverDocRegular size={16} /><span>{matched.title || t('docsUntitled')}</span></button>
      {failed ? <p className={css.failure} role="alert">{t('docsOpenFailed')}</p> : null}
      <p>{matched.request}</p>
      <div className={css.scope}>{t(matched.scope === 'draft' ? 'docsDraftDocument' : matched.scope === 'selection' ? 'docsSelection'
        : matched.scope === 'section' || (matched.scope === 'continue' && matched.blockId) ? 'docsCurrentSection'
          : matched.scope === 'comment' ? 'docsComment' : 'docsWholeDocument')}</div>
      {matched.editMode === 'apply' ? <div className={css.scope}>{t('docsApplyMode')}</div> : null}
      {matched.quote ? <blockquote>{matched.quote}</blockquote> : null}
      <details className={css.context}>
        <summary>{t('docsRequestDetails')}</summary>
        <pre>{matched.context}</pre>
      </details>
    </div>
    {renderActions?.(matched.request)}
  </div>
}
