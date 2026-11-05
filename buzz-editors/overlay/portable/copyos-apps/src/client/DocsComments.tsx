/** Passage threads, human review, and explicit assistant requests in the document margin. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconCheckOutlineRegular, IconLinkOutlineRegular, MarkdownText, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEditorChrome } from '../EditorChrome.tsx'
import { docsShortAgo, useDocsNow } from './DocsTime.ts'
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
  readonly heading?: string
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
    <header className={css.commentsHeader}><h2>{props.heading ?? t('docsComments')}</h2><button type="button" onClick={props.close} aria-label={t('docsCloseComments')}>×</button></header>
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
const marginGap = 12

/** Open threads beside the passages they discuss, each card lined up with its highlight and pushed down to avoid overlap.
 * Detached threads, unsent drafts and filters stay in the All comments panel.
 */
export function DocsCommentMargin(props: Props & { readonly anchors: RefObject<HTMLElement | null>; readonly openAll: () => void }): ReactNode {
  const { t, document, draft, active, canComment } = props
  const margin = useRef<HTMLDivElement>(null)
  const [tops, setTops] = useState<Readonly<Record<string, number>>>({})
  const [height, setHeight] = useState(0)
  const threads = (document.comments ?? []).filter(thread => !thread.resolved && !thread.detached)
  const [recovered, setRecovered] = useState(() => canComment ? readCommentDrafts(props.draftPrefix) : [])
  const hidden = (document.comments ?? []).filter(thread => !thread.resolved && thread.detached).length
    + (canComment ? recovered.filter(item => item.draft.id !== draft?.id && !document.comments?.some(thread => thread.id === item.draft.id)).length : 0)
  const showDraft = !!draft && canComment && !threads.some(thread => thread.id === draft.id)
  const ids = [...threads.map(thread => thread.id), ...(showDraft ? [draft.id] : [])].join(' ')
  useLayoutEffect(() => {
    const root = props.anchors.current, aside = margin.current
    if (!root || !aside) return
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const base = aside.getBoundingClientRect().top
        const cards = [...aside.querySelectorAll<HTMLElement>('[data-margin-id]')].map((element) => {
          const id = element.dataset.marginId ?? '', block = element.dataset.marginBlock ?? ''
          const anchor = root.querySelector(`[data-doc-comment="${CSS.escape(id)}"]`)
            ?? root.querySelector(`[id="doc-block-${CSS.escape(block)}"]`)
          const box = anchor?.getBoundingClientRect()
          return { id, height: element.offsetHeight, want: box && box.height > 0 ? box.top - base : Number.NaN }
        }).filter(card => !Number.isNaN(card.want)).sort((a, b) => a.want - b.want)
        const next: Record<string, number> = {}
        const focus = cards.findIndex(card => card.id === active || card.id === draft?.id)
        const place = cards.map(card => card.want)
        if (focus >= 0) {
          for (let index = focus - 1; index >= 0; index--)
            place[index] = Math.min(place[index] ?? 0, (place[index + 1] ?? 0) - (cards[index]?.height ?? 0) - marginGap)
        }
        let bottom = 0
        cards.forEach((card, index) => {
          const top = Math.max(place[index] ?? 0, bottom)
          next[card.id] = Math.round(top); bottom = top + card.height + marginGap
        })
        setTops(current => Object.keys(next).length === Object.keys(current).length
          && Object.entries(next).every(([key, value]) => current[key] === value) ? current : next)
        setHeight(Math.ceil(bottom))
      })
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    resize?.observe(root)
    for (const card of aside.querySelectorAll('[data-margin-id]')) resize?.observe(card)
    const mutations = new MutationObserver(measure)
    mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-doc-comment', 'hidden'] })
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); mutations.disconnect() }
  }, [ids, active, props.anchors])
  return <aside ref={margin} className={css.commentMargin} aria-label={t('docsComments')} style={{ minHeight: height }}>
    {hidden ? <button type="button" className={css.marginMore} onClick={props.openAll}>
      {t('docsCommentsMore', { count: String(hidden) })}</button> : null}
    {threads.map(thread => <div key={thread.id} className={css.marginSlot} data-margin-id={thread.id} data-margin-block={thread.blockId}
      data-placed={tops[thread.id] !== undefined} style={{ top: tops[thread.id] ?? 0 }}>
      <ThreadCard {...props} thread={thread} active={active === thread.id} compact reopened={() => {}} />
    </div>)}
    {showDraft ? <div key={draft.id} className={css.marginSlot} data-margin-id={draft.id} data-margin-block={draft.blockId}
      data-placed={tops[draft.id] !== undefined} style={{ top: tops[draft.id] ?? 0 }}>
      <NewCommentForm key={draft.id} {...props} draft={draft} compact
        initialText={recovered.find(item => item.draft.id === draft.id)?.text ?? ''}
        changed={(value) => {
          setRecovered(items => [...items.filter(item => item.draft.id !== draft.id), ...(value ? [value] : [])])
        }} />
    </div> : null}
  </aside>
}
function NewCommentForm(props: Props & { readonly draft: CopyOSDocCommentDraft
  readonly initialText: string
  readonly changed: (value: DocsRecoveredComment | null) => void
  readonly compact?: boolean }): ReactNode {
  const { t, draft, canAsk } = props
  const { Button } = useEditorChrome()
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
    {props.compact ? null : <blockquote>{draft.quote || props.document.blocks.find(block => block.id === draft.blockId)?.label || t('docsCommentSection')}</blockquote>}
    {props.draftDetached ? <p role="status">{t('docsDraftReattachHint')}</p> : null}
    <textarea ref={input} aria-label={t('docsWriteComment')} placeholder={t('docsWriteComment')} value={text} maxLength={5000} disabled={posting}
      rows={3} onChange={(event) => { setText(event.target.value); persist(event.target.value) }} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} />
    {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
    {canAsk ? <small>{t('docsCommentMentionHint')}</small> : null}
    <div className={css.commentFormActions}><Button type="button" size="sm" variant="ghost" disabled={posting}
      onClick={() => { persist(''); props.cancelDraft() }}>{t('docsCancel')}</Button>
    <Button size="sm" variant="prominent" type="submit" disabled={posting || !text.trim() || props.draftDetached}>{t('docsPostComment')}</Button></div>
  </form>
}
function ThreadCard({ thread, active, t, document, labels, canComment, canAsk, assistantWorking,
  apply, ask, review, select, copyLink, threadLink, reopened, resolveAsset, draftPrefix, compact = false }:
  Omit<Props, 'active'> & { readonly thread: CopyOSDocCommentThread; readonly active: boolean; readonly reopened: () => void
    readonly compact?: boolean }): ReactNode {
  const now = useDocsNow()
  const { Button } = useEditorChrome()
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
  const expanded = !compact || active
  return <article className={css.commentThread} data-thread-id={thread.id} data-active={active} data-compact={compact}
    onClick={(event) => {
      if (!compact || active || (event.target instanceof Element && event.target.closest('a, button, textarea, input, summary, form, details'))) return
      select(thread.id)
    }}>
    {compact ? null : <a href={threadLink(thread.id)} className={css.commentQuote} onClick={(event) => { event.preventDefault(); select(thread.id) }}>
      {thread.detached ? <small>{t('docsCommentDetachedHint')}</small> : null}
      <blockquote>{thread.quote || t('docsCommentSection')}</blockquote>
    </a>}
    <div className={css.threadActions}>
      {canComment ? thread.resolved ? <button type="button" disabled={pending} onClick={() => { run(async () => {
        await apply({ type: 'resolve', threadId: thread.id, resolved: false }); reopened()
      }) }}>{t('docsReopenComment')}</button>
        : <Tooltip label={t('docsResolveComment')} portal><button type="button" className={css.threadIcon} disabled={pending}
          aria-label={t('docsResolveComment')} onClick={() => { run(() => apply({ type: 'resolve', threadId: thread.id, resolved: true })) }}>
          <IconCheckOutlineRegular size={16} /></button></Tooltip> : null}
      <Tooltip label={t(copied ? 'docsCopied' : 'docsCopyCommentLink')} portal><button type="button" className={css.threadIcon}
        aria-label={t(copied ? 'docsCopied' : 'docsCopyCommentLink')}
        onClick={() => { run(async () => { await copyLink(thread.id); setCopied(true) }) }}><IconLinkOutlineRegular size={16} /></button></Tooltip>
    </div>
    {thread.messages.map((message) => { const name = t(message.author === 'assistant' ? 'docsCommentAssistant'
      : message.mine ? 'docsCommentYou' : 'docsCommentCollaborator')
    return <section key={message.id} className={css.commentMessage}>
      <span className={css.commentAvatar} data-agent={message.author === 'assistant'} aria-hidden="true">
        {message.author === 'assistant' ? '✧' : name.slice(0, 1)}</span>
      <div className={css.commentBody}>
      <div className={css.commentByline}><strong>{name}</strong>
        <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}>
          {docsShortAgo(message.createdAt, now) || t('docsCommentNow')}</time>
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
        {canComment && message.canEdit ? <button type="button" aria-label={t('docsEditComment')} onClick={() => {
          setEditing({ id: message.id, token: randomUUID(), focus: true })
        }}>{t('docsEditShort')}</button> : null}
        {canComment && message.canDelete ? <button type="button" disabled={pending} aria-label={t('docsDeleteComment')} onClick={() => { run(() => apply({ type: 'delete', threadId: thread.id, messageId: message.id })) }}>{t('docsDeleteShort')}</button> : null}
      </div> : null}
      </div>
    </section> })}
    {document.suggestions?.filter(item => item.threadId === thread.id && item.state === 'pending').map(item =>
      <SuggestionCard resolveAsset={resolveAsset} key={item.id} suggestion={item} t={t} labels={labels} disabled={!canComment || document.access === 'commenter'}
        review={(decision, replacement) => review(item.id, decision, replacement)} />)}
    {thread.assistant?.state === 'pending' ? <p className={css.commentThinking} role="status">✧ {t(assistantWorking ? 'docsCommentThinking' : 'docsCommentWaiting')}</p> : null}
    {thread.assistant?.state === 'failed' ? <p className={css.sectionError}>{t('docsCommentReplyFailed')}</p> : null}
    {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
    {expanded && !thread.resolved && canAsk ? <button type="button" className={css.askThread} disabled={pending || (thread.assistant?.state === 'pending' && assistantWorking)}
      onClick={() => { run(() => ask(thread)) }}>✧ {t(thread.assistant?.state === 'failed' || thread.assistant?.state === 'cancelled' || thread.assistant?.state === 'pending' ? 'docsCommentRetryAssistant' : 'docsAskAssistant')}</button> : null}
    {(expanded || reply) && !thread.resolved && canComment ? <form className={css.commentReply} onSubmit={(event) => {
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
      <Button type="submit" size="sm" variant="subtle" disabled={pending || !reply.trim()}>{t('docsPostReply')}</Button>
    </form> : null}
  </article>
}
