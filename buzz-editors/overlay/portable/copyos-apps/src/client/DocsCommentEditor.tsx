/** Posted-comment composition survives reload and checks the original server version before saving. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorChrome } from '../EditorChrome.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocCommentAction, CopyOSDocCommentMessage, CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'
import { clearCommentEditDraft, readCommentEditDraft, saveCommentEditDraft, type DocsCommentEditDraft } from './DocsCommentDrafts.ts'
import css from './DocsWorkspace.module.css'

/** Edit one owned message while preserving failed saves and newer compositions in other panes. */
export function DocsCommentEditor({ message, threadId, draftPrefix, t, apply, close, focus = false }: PropsLocale<'copyosFoundation'> & {
  readonly message: CopyOSDocCommentMessage
  readonly threadId: string
  readonly draftPrefix: string
  readonly apply: (action: CopyOSDocCommentAction) => Promise<CopyOSDocDocument>
  readonly close: (notice?: string) => void
  readonly focus?: boolean
}): ReactNode {
  const { Button, TextField } = useEditorChrome()
  const [draft, setDraft] = useState<DocsCommentEditDraft>(() => {
    const saved = readCommentEditDraft(draftPrefix, threadId, message.id)
    return saved && saved.text.trim() !== message.text ? saved
      : { before: message.text, editedAt: message.editedAt ?? null, text: message.text, updatedAt: Date.now() }
  })
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focus) return
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => { cancelAnimationFrame(frame) }
  }, [focus])
  const conflict = (message.text !== draft.before || (message.editedAt ?? null) !== draft.editedAt)
    && message.text !== draft.text.trim()
  const persist = (value: DocsCommentEditDraft): void => {
    setDraft(value)
    try { saveCommentEditDraft(draftPrefix, threadId, message.id, value); setError('') }
    catch (cause: unknown) { setError(t('docsFeedbackNotSaved')); console.warn('Unable to save a comment edit draft', cause) }
  }
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (pending || conflict || !draft.text.trim() || !message.canEdit || message.deleted) return
    const submitted = draft
    setPending(true); setError('')
    void apply({ type: 'edit', threadId, messageId: message.id, text: submitted.text.trim(),
      expectedText: submitted.before, expectedEditedAt: submitted.editedAt }).then(() => {
      let notice: string | undefined
      try { clearCommentEditDraft(draftPrefix, threadId, message.id, submitted) }
      catch (cause: unknown) { notice = t('docsCommentEditCleanupFailed'); console.warn('Unable to clear a saved comment edit', cause) }
      close(notice)
    }).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setPending(false) })
  }}>
    {conflict ? <div className={css.commentEditConflict} role="status">
      <p>{t('docsCommentEditChanged')}</p>
      <strong>{t('docsCommentCurrent')}</strong><blockquote tabIndex={0} aria-label={t('docsCommentCurrent')}>{message.text}</blockquote>
      <Button type="button" size="sm" variant="outline" disabled={pending || !message.canEdit || message.deleted}
        onClick={() => {
          persist({ ...draft, before: message.text, editedAt: message.editedAt ?? null, updatedAt: Date.now() })
          input.current?.focus()
        }}>{t('docsCommentReviewCurrent')}</Button>
    </div> : null}
    <TextField textareaRef={input} label={t('docsEditComment')} labelVisibility="hidden" value={draft.text} maxLength={5000} rows={3}
      disabled={pending || !message.canEdit || message.deleted}
      onValueChange={(text) => { persist({ ...draft, text, updatedAt: Date.now() }) }}
      onTextareaKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.currentTarget.form?.requestSubmit()
        }
      }} />
    {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
    <div className={css.commentFormActions}>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
        try { clearCommentEditDraft(draftPrefix, threadId, message.id, draft) }
        catch (cause: unknown) {
          console.warn('Unable to discard a comment edit draft', cause); close(t('docsCommentEditDiscardFailed')); return
        }
        close()
      }}>{t('docsCancel')}</Button>
      <Button size="sm" variant="prominent" type="submit" disabled={pending || conflict || !draft.text.trim() || !message.canEdit || message.deleted}>
        {t('docsSaveComment')}
      </Button>
    </div>
  </form>
}
