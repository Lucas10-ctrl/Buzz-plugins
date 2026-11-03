/** A local Word download is the handoff to Google's own document import workflow. */
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocsWorkspace.module.css'

/** Show the supported manual handoff without uploading document content.
 * @param props - Local download action, current operation state and close callback.
 * @returns An accessible dialog linking to Google Docs and its import documentation.
 */
export function DocsGoogleHandoff({ t, pending, error, download, close }: PropsLocale<'copyosFoundation'> & {
  readonly pending: boolean
  readonly error: string
  readonly download: () => void
  readonly close: () => void
}) {
  return <Modal open title={t('docsGoogleDocs')} closeLabel={t('docsClose')} onClose={close} onKeyDownCapture={(event) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
    const first = controls[0], last = controls.at(-1), active = document.activeElement
    if (!controls.some(control => control === active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus()
    }
  }}>
    <div className={css.googleHandoff}>
      <ol><li>{t('docsGoogleDownloadStep')}</li><li>{t('docsGoogleUploadStep')}</li></ol>
      <p>{t('docsGoogleZipHint')}</p>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">{t('docsExporting')}</p> : null}
      <div><Button autoFocus disabled={pending} onClick={download}>{t('docsGoogleDownloadWord')}</Button>
        <a href="https://docs.google.com/document/" target="_blank" rel="noopener noreferrer">{t('docsGoogleOpen')}</a></div>
      <a href="https://support.google.com/docs/answer/9406611" target="_blank" rel="noopener noreferrer">{t('docsGoogleHelp')}</a>
    </div>
  </Modal>
}
