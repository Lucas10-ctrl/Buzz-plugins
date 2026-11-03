/** Passage threads, human review, and explicit assistant requests in the document margin. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocCommentAction, CopyOSDocCommentDraft, CopyOSDocCommentThread, CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import { SuggestionCard } from './DocsSuggestionCard.tsx'
import { readCommentDrafts, saveCommentDraft, readReplyDraft, saveReplyDraft, type DocsRecoveredComment } from './DocsCommentDrafts.ts'
import css from './DocsWorkspace.module.css'
import { DocsCommentEditor } from './DocsCommentEditor.tsx'
import { readCommentEditDraft } from './DocsCommentDrafts.ts'

type Locale = PropsLocale<'copyosFoundation'>
type Props = Locale & {
  readonly resolveAsset?: DocsAssetResolver | undefined
  readonly open: boolean
  readonly document: CopyOSDocDocument
  readonly draft: CopyOSDocCommentDraft | null
  readonly draftDetached?: boolean
  readonly draftStorageFailed: boolean
  readonly draftPrefix: string
  readonly restoreDraft: (draft: CopyOSDocCommentDraft) => void
  readonly active: string | null
  readonly canComment: boolean
  readonly canAsk: boolean
  readonly assistantWorking: boolean
  readonly labels: Parameters<typeof MarkdownText>[0]['labels']
  readonly apply: (action: CopyOSDocCommentAction) => Promise<CopyOSDocDocument>
  readonly ask: (thread: CopyOSDocCommentThread) => Promise<void>
  readonly review: (id: string, decision: 'accept' | 'reject', replacement?: string) => Promise<void>
  readonly select: (id: string) => void
  readonly close: () => void
  readonly cancelDraft: () => void
  readonly threadLink: (id: string) => string
  readonly copyLink: (id: string) => Promise<void>
}
const mentionsAssistant = (text: string): boolean => /@(assistant|claude)\b/iu.test(text)
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Show open/resolved threads, retained detached anchors, replies and reviewable changes. */
export function DocsComments(props: Props): ReactNode {
  const { t, document, draft, active, labels, canComment } = props
  const [filter, setFilter] = useState<'open' | 'resolved' | 'mentions' | 'assistant'>('open')
  const [recovered, setRecovered] = useState(() => canComment ? readCommentDrafts(props.draftPrefix) : [])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { if (draft && props.open) setFilter('open') }, [draft?.id, props.open])
  useEffect(() => {
    if (!active || !props.open) return
    const thread = document.comments?.find(item => item.id === active)
    if (thread) setFilter(thread.resolved ? 'resolved' : 'open')
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-thread-id="${active}"]`)?.scrollIntoView({ block: 'nearest' }))
  }, [active, props.open])
  const threads = (document.comments ?? []).filter((thread) => {
    if (filter === 'open') return !thread.resolved
    if (filter === 'resolved') return thread.resolved
    if (filter === 'mentions') return thread.mentioned
    return thread.assistant !== undefined || thread.messages.some(item => item.author === 'assistant')
  })
  const groups = [threads.filter(thread => !thread.detached), threads.filter(thread => thread.detached)]
  const unsent = canComment ? recovered.filter(item => item.draft.id !== draft?.id
    && !document.comments?.some(thread => thread.id === item.draft.id)) : []
  return <aside hidden={!props.open} className={css.commentsPanel} aria-label={t('docsComments')}>
    <header className={css.commentsHeader}><h2>{t('docsComments')}</h2><button type="button" onClick={props.close} aria-label={t('docsCloseComments')}>×</button></header>
    <div className={css.commentFilters}>
      {(['open', 'resolved', 'mentions', 'assistant'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value}
        onClick={() => { setFilter(value) }}>{t(value === 'open' ? 'docsCommentsOpen' : value === 'resolved' ? 'docsCommentsResolved' : value === 'mentions' ? 'docsCommentsMentions' : 'docsCommentsAssistant')}</button>)}
    </div>
    <div ref={list} className={css.commentList}>
      {props.draftStorageFailed ? <p className={css.sectionError} role="alert">{t('docsFeedbackNotSaved')}</p> : null}
      {unsent.length
        ? <section aria-label={t('docsUnsentComments')} className={css.recoveredComments}>
          <h3>{t('docsUnsentComments')}</h3>
          {unsent.map(item => <button type="button" key={item.draft.id} onClick={() => { props.restoreDraft(item.draft) }}>
            <strong>{item.draft.quote || document.blocks.find(block => block.id === item.draft.blockId)?.label
                || t('docsCommentSection')}</strong>{' '}<span>{item.text}</span>
          </button>)}
        </section> : null}
      {draft && canComment ? <NewCommentForm key={draft.id} {...props} draft={draft}
        initialText={recovered.find(item => item.draft.id === draft.id)?.text ?? ''}
        changed={(value) => {
          setRecovered(items => [...items.filter(item => item.draft.id !== draft.id), ...(value ? [value] : [])])
        }} /> : null}
      {!threads.length && !draft && !unsent.length ? <p className={css.commentsEmpty}>
        {t(filter === 'open' ? 'docsCommentsEmpty' : 'docsCommentsNoMatch')}</p> : null}
      {groups.map((group, index) => group.length ? <section key={index}>
        {index === 1 ? <h3 className={css.detachedHeading}>{t('docsCommentsDetached')}</h3> : null}
        {group.map(thread => <ThreadCard key={thread.id} {...props} thread={thread} active={active === thread.id} labels={labels}
          reopened={() => { setFilter('open') }} />)}
      </section> : null)}
      {!draft && canComment ? <p className={css.commentsTip}>{t('docsCommentsSelectHint')}</p> : null}
    </div>
  </aside>
}
function NewCommentForm(props: Props & { readonly draft: CopyOSDocCommentDraft
  readonly initialText: string
  readonly changed: (value: DocsRecoveredComment | null) => void }): ReactNode {
  const { t, draft, canAsk } = props
  const [text, setText] = useState(props.initialText), [error, setError] = useState(''), [posting, setPosting] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!props.open) return
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => { cancelAnimationFrame(frame) }
  }, [props.open])
  const persist = (value: string): void => {
    try { saveCommentDraft(props.draftPrefix, draft, value); setError('') }
    catch (cause: unknown) { setError(t('docsFeedbackNotSaved')); console.warn('Unable to save an unsent comment', cause) }
    props.changed(value.trim() ? { draft, text: value } : null)
  }
  return <form className={css.commentDraft} onSubmit={(event) => {
    event.preventDefault(); if (!text.trim() || posting || props.draftDetached) return
    setPosting(true); setError('')
    void props.apply({ type: 'create', draft, text: text.trim(), requestAssistant: canAsk && mentionsAssistant(text) })
      .then(() => { persist(''); props.cancelDraft(); props.select(draft.id) })
      .catch((cause: unknown) => { setError(errorText(cause)) }).finally(() => { setPosting(false) })
  }}>
    <blockquote>{draft.quote || props.document.blocks.find(block => block.id === draft.blockId)?.label || t('docsCommentSection')}</blockquote>
    {props.draftDetached ? <p role="status">{t('docsDraftReattachHint')}</p> : null}
    <textarea ref={input} aria-label={t('docsWriteComment')} placeholder={t('docsWriteComment')} value={text} maxLength={5000} disabled={posting}
      rows={3} onChange={(event) => { setText(event.target.value); persist(event.target.value) }} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} />
    {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
    {canAsk ? <small>{t('docsCommentMentionHint')}</small> : null}
    <div className={css.commentFormActions}><Button size="sm" variant="outline" disabled={posting}
      onClick={() => { persist(''); props.cancelDraft() }}>{t('docsCancel')}</Button>
    <Button size="sm" variant="primary" type="submit" disabled={posting || !text.trim() || props.draftDetached}>{t('docsPostComment')}</Button></div>
  </form>
}
function ThreadCard({ thread, active, t, document, labels, canComment, canAsk, assistantWorking,
  apply, ask, review, select, copyLink, threadLink, reopened, resolveAsset, draftPrefix }:
  Omit<Props, 'active'> & { readonly thread: CopyOSDocCommentThread; readonly active: boolean; readonly reopened: () => void }): ReactNode {
  const [recovered] = useState(() => {
    const saved = canComment ? readReplyDraft(draftPrefix, thread.id) : null
    return saved && !thread.messages.some(message => message.id === saved.id) ? saved : null
  })
  const [reply, setReply] = useState(recovered?.text ?? '')
  const [editing, setEditing] = useState<{ id: string; token: string; focus: boolean } | null>(() => {
    let latest: { id: string; updatedAt: number } | undefined
    if (canComment) for (const message of thread.messages) {
      if (!message.canEdit || message.deleted) continue
      const saved = readCommentEditDraft(draftPrefix, thread.id, message.id)
      if (saved && saved.text.trim() !== message.text && (!latest || saved.updatedAt > latest.updatedAt))
        latest = { id: message.id, updatedAt: saved.updatedAt }
    }
    return latest ? { id: latest.id, token: randomUUID(), focus: false } : null
  })
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const replyIdentity = useRef<{ id: string; text: string } | null>(recovered)
  const run = (operation: () => Promise<unknown>): void => {
    setPending(true); setError('')
    void operation().catch((cause: unknown) => { setError(errorText(cause)) }).finally(() => { setPending(false) })
  }
  return <article className={css.commentThread} data-thread-id={thread.id} data-active={active}>
    <a href={threadLink(thread.id)} className={css.commentQuote} onClick={(event) => { event.preventDefault(); select(thread.id) }}>
      {thread.detached ? <small>{t('docsCommentDetachedHint')}</small> : null}
      <blockquote>{thread.quote || t('docsCommentSection')}</blockquote>
    </a>
    <div className={css.threadActions}>
      {canComment ? <button type="button" disabled={pending} onClick={() => { run(async () => {
        await apply({ type: 'resolve', threadId: thread.id, resolved: !thread.resolved })
        if (thread.resolved) reopened()
      }) }}>
        {t(thread.resolved ? 'docsReopenComment' : 'docsResolveComment')}</button> : null}
      <button type="button" onClick={() => { run(async () => { await copyLink(thread.id); setCopied(true) }) }}>{t(copied ? 'docsCopied' : 'docsCopyCommentLink')}</button>
    </div>
    {thread.messages.map(message => <section key={message.id} className={css.commentMessage}>
      <div className={css.commentByline}><strong>{t(message.author === 'assistant' ? 'docsCommentAssistant' : message.mine ? 'docsCommentYou' : 'docsCommentCollaborator')}</strong>
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        {message.editedAt ? <small>{t('docsCommentEdited')}</small> : null}</div>
      {editing?.id === message.id && canComment && message.canEdit && !message.deleted ? <DocsCommentEditor key={editing.token}
        message={message} threadId={thread.id} draftPrefix={draftPrefix} t={t} apply={apply} focus={editing.focus}
        close={(notice) => {
          const token = editing.token
          setEditing(value => value?.token === token ? null : value)
          if (notice) setError(notice)
        }} /> : message.deleted ? <p className={css.deletedComment}>{t('docsCommentDeleted')}
        {canComment && message.canDelete ? <button type="button" onClick={() => { run(() => apply({ type: 'undelete', threadId: thread.id, messageId: message.id })) }}>{t('docsUndo')}</button> : null}</p>
        : <div className={css.commentText}><MarkdownText text={message.text} labels={labels} /></div>}
      {!message.deleted ? <div className={css.commentMessageActions}>
        {message.reactions.map(reaction => <button type="button" key={reaction.emoji} aria-pressed={reaction.mine} disabled={!canComment || pending}
          aria-label={t(reaction.count === 1 ? 'docsCommentReactionSingle' : 'docsCommentReaction',
            { emoji: reaction.emoji, count: String(reaction.count) })}
          onClick={() => { run(() => apply({ type: 'react', threadId: thread.id, messageId: message.id, emoji: reaction.emoji })) }}>{reaction.emoji} {reaction.count}</button>)}
        {canComment ? <details className={css.reactionPicker}><summary aria-label={t('docsReactComment')}>☺</summary><div>
          {['👍', '❤️', '🎉', '👀', '✅', '❓'].map(emoji => <button key={emoji} type="button" aria-label={t('docsAddReaction', { emoji })}
            onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); run(() => apply({ type: 'react', threadId: thread.id, messageId: message.id, emoji })) }}>{emoji}</button>)}
        </div></details> : null}
        {canComment && message.canEdit ? <button type="button" onClick={() => {
          setEditing({ id: message.id, token: randomUUID(), focus: true })
        }}>{t('docsEditComment')}</button> : null}
        {canComment && message.canDelete ? <button type="button" disabled={pending} onClick={() => { run(() => apply({ type: 'delete', threadId: thread.id, messageId: message.id })) }}>{t('docsDeleteComment')}</button> : null}
      </div> : null}
    </section>)}
    {document.suggestions?.filter(item => item.threadId === thread.id && item.state === 'pending').map(item =>
      <SuggestionCard resolveAsset={resolveAsset} key={item.id} suggestion={item} t={t} labels={labels} disabled={!canComment || document.access === 'commenter'}
        review={(decision, replacement) => review(item.id, decision, replacement)} />)}
    {thread.assistant?.state === 'pending' ? <p className={css.commentThinking} role="status">✧ {t(assistantWorking ? 'docsCommentThinking' : 'docsCommentWaiting')}</p> : null}
    {thread.assistant?.state === 'failed' ? <p className={css.sectionError}>{t('docsCommentReplyFailed')}</p> : null}
    {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
    {!thread.resolved && canAsk ? <button type="button" className={css.askThread} disabled={pending || (thread.assistant?.state === 'pending' && assistantWorking)}
      onClick={() => { run(() => ask(thread)) }}>✧ {t(thread.assistant?.state === 'failed' || thread.assistant?.state === 'cancelled' || thread.assistant?.state === 'pending' ? 'docsCommentRetryAssistant' : 'docsAskAssistant')}</button> : null}
    {!thread.resolved && canComment ? <form className={css.commentReply} onSubmit={(event) => {
      event.preventDefault(); if (!reply.trim() || pending) return
      if (!replyIdentity.current || replyIdentity.current.text !== reply)
        replyIdentity.current = { id: randomUUID(), text: reply }
      const identity = replyIdentity.current
      run(async () => { await apply({ type: 'reply', threadId: thread.id, id: identity.id, text: identity.text.trim(),
        requestAssistant: canAsk && mentionsAssistant(reply) })
      try { saveReplyDraft(draftPrefix, thread.id, null) }
      catch (cause: unknown) { console.warn('Unable to clear a posted reply draft', cause) }
      setReply(''); replyIdentity.current = null })
    }}>
      <textarea rows={1} value={reply} maxLength={5000} disabled={pending}
        aria-label={t('docsReplyComment')} placeholder={t('docsReplyComment')}
        onChange={(event) => {
          const text = event.target.value; setReply(text)
          replyIdentity.current = { id: randomUUID(), text }
          try { saveReplyDraft(draftPrefix, thread.id, replyIdentity.current); setError('') }
          catch (cause: unknown) { setError(t('docsFeedbackNotSaved')); console.warn('Unable to save an unsent reply', cause) }
        }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
        }} />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !reply.trim()}>{t('docsPostReply')}</Button>
    </form> : null}
  </article>
}
