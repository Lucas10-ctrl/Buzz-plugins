/** Suite document library, continuous editor and reviewable assistant collaboration. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconClockOutlineRegular, IconDeliverDocRegular, IconPaperclipOutlineRegular, IconPlusOutlineRegular,
  IconNewChatOutlineRegular, IconSparkleRegular, IconLinkOutlineRegular, IconPanelLeftOutlineRegular, IconEllipsisOutlineRegular,
  IconShareOutlineRegular, Menu, Tooltip, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { readDocsRoute, type DocsRoute } from './DocsRoute.ts'
import type { CopyOSDocCommentDraft, CopyOSDocCommentThread, CopyOSDocCommentAction, CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'
import type { DocsModel, DocsSnapshot } from './DocsModel.ts'
import css from './DocsWorkspace.module.css'
import type { DocsRequestPresentation } from './DocsAssistantRequest.ts'
import { isBlankDocForOutline } from './DocsAssistantRequest.ts'
import { printDoc } from './DocsPrint.ts'
import { DocsLibrary } from './DocsLibrary.tsx'
import { DocsCommentMargin, DocsComments } from './DocsComments.tsx'
import { docsShortAgo, useDocsNow } from './DocsTime.ts'
import { useEditorChrome } from '../EditorChrome.tsx'
import { commentDraftPrefix, readCommentDrafts, readReplyDraft } from './DocsCommentDrafts.ts'
import { assistantDraftKey, clearAssistantDraft, readAssistantDraft, saveAssistantDraft, watchAssistantDraftClear,
  type DocsAssistantDraft } from './DocsAssistantDrafts.ts'
import { SuggestionCard } from './DocsSuggestionCard.tsx'
import type { DocsPageSelectionPart } from './DocsPageEditor.ts'
import type { DocsTextRange } from './DocsSourceMap.ts'
import { DocsTabs } from './DocsTabs.tsx'
import { DocsHistory } from './DocsHistory.tsx'
import { DocsGoogleHandoff } from './DocsGoogleHandoff.tsx'
import { DocsPresence } from './DocsPresence.tsx'
import { DocsRichBlock } from './DocsRichBlock.tsx'
import { StrategyStageBar } from './StrategyStageBar.tsx'
import { isStrategyDocument } from '../../../copyos-domain/src/docs-strategy.ts'

/** Host callbacks used by the original document workspace; no Session or slot host is required. */
export interface DocsAppActions {
  readonly startDocs: DocsModel['start']
  readonly stopDocs: DocsModel['stop']
  readonly importDocFile: DocsModel['importFile']
  readonly uploadDocFiles: DocsModel['uploadFiles']
  readonly attachDocFiles: DocsModel['attachFiles']
  readonly resolveDocAsset: DocsModel['resolveAsset']
  readonly listDocHistory: DocsModel['history']
  readonly readDocHistory: DocsModel['version']
  readonly nameDocVersion: DocsModel['nameVersion']
  readonly restoreDocVersion: DocsModel['restore']
  readonly focusComment: DocsModel['focusComment']
  readonly commentDraft: DocsModel['commentDraft']
  readonly discardCommentDraft: DocsModel['discardCommentDraft']
  readonly recoverLegacyDoc: DocsModel['recoverLegacyDraft']
  readonly commentDoc: DocsModel['comment']
  readonly flushDocs: DocsModel['flush']
  readonly reviewDoc: DocsModel['review']
  readonly setDocCursor: DocsModel['setCursor']
  readonly anchorDocPassage: DocsModel['anchorPassage']
  readonly locateDocPassage: DocsModel['locatePassage']
  readonly editDoc: DocsModel['edit']
  readonly editDocPage: DocsModel['editPage']
  readonly captureDocEdit: DocsModel['captureEdit']
  readonly addDocBlock: DocsModel['add']
  readonly moveDocBlock: DocsModel['move']
  readonly undoDoc: DocsModel['undoLocal']
  readonly redoDoc: DocsModel['redoLocal']
  readonly duplicateDoc: DocsModel['duplicate']
  readonly trashDoc: DocsModel['trash']
  readonly refreshDocLibrary: DocsModel['refreshLibrary']
  readonly selectDoc: DocsModel['select']
  readonly selectDocTab: DocsModel['selectTab']
  readonly addDocTab: DocsModel['addTab']
  readonly renameDocTab: DocsModel['renameTab']
  readonly moveDocTab: DocsModel['moveTab']
  readonly createDoc: DocsModel['create']
  readonly controlDoc: DocsModel['control']
  readonly stopAssistant: () => Promise<void>
  readonly shareDoc: DocsModel['share']
  readonly exportDoc: DocsModel['export']
  readonly draftDoc: (workspaceId: string, prompt: string, docId?: string, threadId?: string,
    presentation?: DocsRequestPresentation) => Promise<void>
}
/** Original document workspace inputs with host-owned observable selectors. */
export type DocsAppProps = DocsAppActions & PropsLocale<'copyosFoundation'> & {
  readonly useDocs: <T>(selector: (state: DocsSnapshot) => T) => T
  readonly useDocsRoute: <T>(selector: (route: DocsRoute | null) => T) => T
  readonly workspaceId: string
  /** Workspace name for the breadcrumb. */
  readonly workspaceTitle?: string | undefined
  /** Host workspace controls, shown at the top of the document list and above the library. */
  readonly workspacePicker?: ReactNode
  readonly documentLink?: ((route: DocsRoute) => string) | undefined
  readonly session?: boolean
  readonly assistantWorking?: boolean
  readonly conversation?: ((expanded: boolean) => ReactNode) | undefined
  readonly assistantBlocked?: boolean
  readonly initialConversationOpen?: boolean
  readonly focusDocument?: () => void
  readonly leaveDocument?: () => void
  /** Host-owned picker that moves the open document to another workspace. */
  readonly moveDocument?: Readonly<{ label: string; open: (docId: string) => void }>
}

export function DocsApp(props: DocsAppProps): ReactNode {
  const { t, workspaceId, startDocs, stopDocs } = props
  const state = props.useDocs(s => s)
  const linkedRoute = props.useDocsRoute(value => value)
  const route = props.session ? null : linkedRoute
  const doc = state.document
  const tabs = doc?.tabs ?? (doc ? [{ id: doc.id, title: '' }] : [])
  const activeTab = state.activeTab ?? tabs[0]?.id ?? null
  const blocks = doc?.blocks.filter(block => (block.tabId ?? doc.id) === activeTab) ?? []
  const [commentsOpen, setCommentsOpen] = useState(false), [commentDraft, setCommentDraft] = useState<CopyOSDocCommentDraft | null>(null)
  const activeComment = state.activeThread, setActiveComment = props.focusComment
  const [focusAfterSection, setFocusAfterSection] = useState<string>()
  const [focusPassage, setFocusPassage] = useState<{ blockId: string; range: DocsTextRange; key: string }>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [googleHandoff, setGoogleHandoff] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(() => !props.session && !route?.docId && !new URLSearchParams(location.hash.slice(1)).has('doc'))
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(() => localStorage.getItem('copyos.docs.rail') !== 'false')
  const [allComments, setAllComments] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const now = useDocsNow()
  const { Button: ChromeButton, DocumentIcon } = useEditorChrome()
  const pagesButton = useRef<HTMLButtonElement>(null)
  const pagesId = useId()
  const [wide, setWide] = useState(() => localStorage.getItem('copyos.docs.wide') === 'true')
  const libraryButton = useRef<HTMLButtonElement>(null)
  const openDocument = async (id: string): Promise<void> => {
    await props.selectDoc(id)
    setLibraryOpen(false)
    requestAnimationFrame(() => titleInput.current?.focus())
  }

  const [reading, setReading] = useState(false),
    [shareOpen, setShareOpen] = useState(false),
    [moreOpen, setMoreOpen] = useState(false)
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer'),
    [copied, setCopied] = useState(false)
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [conversationOpen, setConversationOpen] = useState(props.initialConversationOpen ?? false)
  const [assistantFocused, setAssistantFocused] = useState(false)
  const [assistantHovered, setAssistantHovered] = useState(false)
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  useEffect(() => { setAssistantMenuOpen(false); setAssistantHovered(false) }, [doc?.id, activeTab, libraryOpen])
  useEffect(() => { if (props.assistantBlocked) { setConversationOpen(true); setCommentsOpen(false) } }, [props.assistantBlocked])
  const [small, setSmall] = useState(() => matchMedia('(max-width: 767px)').matches)
  useEffect(() => { if (small) setPagesOpen(false) }, [small])
  const toggleRail = (open: boolean): void => {
    setPagesOpen(open)
    if (!small) localStorage.setItem('copyos.docs.rail', String(open))
  }
  const [marginRoom, setMarginRoom] = useState(false)
  useEffect(() => {
    const element = scroll.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { setMarginRoom(element.clientWidth >= 980) })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [!!doc, libraryOpen])
  const marginMode = marginRoom && !small
  const marginComments = marginMode && !allComments
  const panelOpen = marginMode ? allComments : commentsOpen
  const workspaceRoot = useRef<HTMLElement>(null)
  const [mobileEditing, setMobileEditing] = useState(false)
  const [askTarget, setAskTarget] = useState<DocsAssistantDraft['target']>(null)
  const [wholeDocument, setWholeDocument] = useState(false)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const currentSection = wholeDocument ? undefined : blocks.find(block => block.id === sectionId)
  const composerTarget: DocsAssistantDraft['target'] = askTarget ?? (currentSection ? { blockId: currentSection.id, quote: '' } : null)
  const requestDraftKey = doc && activeTab ? assistantDraftKey(workspaceId, doc.id, activeTab) : ''
  const [requestDraft, setRequestDraft] = useState<DocsAssistantDraft & { key: string; missingScope: boolean }>({ key: '', text: '', target: null, missingScope: false })
  const [draftNotSaved, setDraftNotSaved] = useState(false)
  const brief = requestDraft.key === requestDraftKey ? requestDraft.text : ''
  const editMode = requestDraft.key === requestDraftKey ? requestDraft.editMode ?? 'suggest' : 'suggest'
  const selectedPassages = composerTarget?.selections ?? (composerTarget?.selection
    ? [{ blockId: composerTarget.blockId, ...composerTarget.selection }] : [])
  const selectionChanged = editMode === 'apply' && !!composerTarget?.quote && (!selectedPassages.length
    || selectedPassages.some(part => blocks.find(block => block.id === part.blockId)?.content.slice(part.start,
      part.start + part.before.length) !== part.before))
  const missingDraftScope = requestDraft.key === requestDraftKey && (requestDraft.missingScope
    || (askTarget !== null && !blocks.some(block => block.id === askTarget.blockId))
    || (askTarget?.selections?.some(part => !blocks.some(block => block.id === part.blockId)) ?? false))
  const currentRequestDraft = useRef<DocsAssistantDraft>({ text: '', target: null })
  currentRequestDraft.current = { text: brief, editMode, target: missingDraftScope ? askTarget ?? requestDraft.target : composerTarget }
  const setBrief = (text: string): void => { setRequestDraft(current => ({ ...current, key: requestDraftKey, text })) }
  const confirmDraftScope = (): void => { setRequestDraft(current => ({ ...current, missingScope: false })) }
  const composerScope = composerTarget ? composerTarget.quote ? 'selection' : 'section' : 'document'
  const scopeLabel = t(composerScope === 'selection' ? 'docsSelection'
    : composerScope === 'section' ? 'docsCurrentSection' : 'docsWholeDocument')
  const showAssistantControls = conversationOpen || assistantFocused || assistantHovered || assistantMenuOpen
    || !!brief.trim() || askTarget !== null
    || missingDraftScope || editMode === 'apply'
  useEffect(() => { setAskTarget(null); setSectionId(null); setWholeDocument(false) }, [activeTab])
  const commentsButton = useRef<HTMLButtonElement>(null)
  const optionsButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const askInput = useRef<HTMLTextAreaElement>(null)
  const assistantDock = useRef<HTMLElement>(null)
  useDismissOnOutsidePointer(assistantDock, conversationOpen && !assistantMenuOpen, setConversationOpen)
  const focusAfterSend = useRef<{ input: HTMLTextAreaElement; key: string } | null>(null)
  useEffect(() => {
    if (pending || !focusAfterSend.current) return
    const saved = focusAfterSend.current
    focusAfterSend.current = null
    if (saved.key === requestDraftKey && saved.input === askInput.current && saved.input.isConnected && !saved.input.disabled
      && (document.activeElement === document.body || document.activeElement === saved.input))
      saved.input.focus({ preventScroll: true })
  }, [pending, requestDraftKey, props.assistantBlocked])
  const importInput = useRef<HTMLInputElement>(null)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const suggestionsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!state.revealVersion) return
    setLibraryOpen(false); setHistoryOpen(false); setMobileEditing(false)
    if (state.activeThread) setCommentsOpen(true)
    else requestAnimationFrame(() => articleRef.current?.focus({ preventScroll: true }))
  }, [state.revealVersion])
  const ask = (blockId?: string, quote = '', range?: DocsTextRange, parts?: readonly DocsPageSelectionPart[], instruction?: string): void => {
    confirmDraftScope()
    if (!instruction) setConversationOpen(true)
    if (instruction) {
      setRequestDraft(current => ({ ...current, key: requestDraftKey, editMode: 'suggest' }))
      setBrief(brief.trim() ? `${brief}\n\n${instruction}` : instruction)
    }
    setMobileEditing(false)
    setWholeDocument(false)
    const content = doc?.blocks.find(block => block.id === blockId)?.content
    const selections = parts?.flatMap((part) => {
      const source = doc?.blocks.find(block => block.id === part.blockId)?.content
      return source === undefined ? [] : [{ blockId: part.blockId, start: part.range.from,
        before: source.slice(part.range.from, part.range.to) }]
    })
    setAskTarget(blockId ? { blockId, quote, ...(selections && selections.length > 1 ? { selections }
      : range && content !== undefined && range.to > range.from
        ? { selection: { before: content.slice(range.from, range.to), start: range.from } } : {}) } : null)
    requestAnimationFrame(() => askInput.current?.focus())
  }
  useEffect(() => {
    if (!doc) return
    setAskTarget(null)
    setMobileEditing(false)
    setHistoryOpen(false)
    const requested = route?.threadId ?? new URLSearchParams(location.hash.slice(1)).get('thread') ?? state.activeThread
    const mayRecover = doc.access !== 'viewer' && doc.trashedAt === undefined
    const prefix = commentDraftPrefix(workspaceId, doc.id)
    const replyThread = mayRecover ? doc.comments?.find((item) => {
      if (item.resolved) return false
      const saved = readReplyDraft(prefix, item.id)
      return saved && !item.messages.some(message => message.id === saved.id)
    }) : undefined
    const thread = doc.comments?.some(item => item.id === requested) ? requested : replyThread?.id ?? null
    const recovered = mayRecover
      && readCommentDrafts(prefix).some(item => !doc.comments?.some(saved => saved.id === item.draft.id))
    setActiveComment(thread); setCommentsOpen(thread !== null || recovered); setCommentDraft(null)
    setShareOpen(false)
    setMoreOpen(false)
  }, [doc?.id])
  useEffect(() => {
    if (doc?.access === 'commenter' || doc?.access === 'editor') setCommentsOpen(true)
  }, [doc?.id, doc?.access])
  useEffect(() => {
    if (!requestDraftKey) return
    let saved: DocsAssistantDraft | null = null
    let recovered = true
    try { saved = readAssistantDraft(requestDraftKey); setDraftNotSaved(false) }
    catch (cause) { recovered = false; console.warn('Unable to recover a document request', cause); setDraftNotSaved(true) }
    const missingScope = saved?.target != null && (!blocks.some(block => block.id === saved.target?.blockId)
      || (saved.target.selections?.some(part => !blocks.some(block => block.id === part.blockId)) ?? false))
    setRequestDraft({ key: recovered ? requestDraftKey : '', text: saved?.text ?? '', target: saved?.target ?? null, missingScope,
      ...(saved?.editMode === undefined ? {} : { editMode: saved.editMode }) })
    setAskTarget(missingScope ? null : saved?.target ?? null)
    setWholeDocument(saved?.target === null)
    return watchAssistantDraftClear(requestDraftKey, () => currentRequestDraft.current, () => {
      setRequestDraft({ key: requestDraftKey, text: '', target: null, missingScope: false })
      setAskTarget(null)
    })
  }, [requestDraftKey])
  useEffect(() => {
    if (!requestDraftKey || requestDraft.key !== requestDraftKey) return
    try {
      saveAssistantDraft(requestDraftKey, currentRequestDraft.current)
      setDraftNotSaved(false)
    } catch (cause) { console.warn('Unable to save a document request', cause); setDraftNotSaved(true) }
  }, [requestDraftKey, requestDraft.key, brief, editMode, missingDraftScope, composerTarget?.blockId, composerTarget?.quote,
    composerTarget?.selection?.before, composerTarget?.selection?.start, composerTarget?.selections])
  useEffect(() => { if (activeComment) setCommentsOpen(true) }, [activeComment])
  const createDocument = async (): Promise<void> => {
    await props.createDoc(t('docsUntitled'))
    setLibraryOpen(false)
    requestAnimationFrame(() => { titleInput.current?.focus(); titleInput.current?.select() })
  }
  const canComment = doc?.access !== 'viewer' && doc !== null && doc.trashedAt === undefined
    && state.status !== 'error' && state.status !== 'offline'
  const canAsk = doc !== null && doc.trashedAt === undefined && doc.access !== 'viewer' && doc.access !== 'commenter' && doc.access !== 'editor'
  const initialBlock = doc?.blocks[0]
  const initialDraft = initialBlock !== undefined && doc !== null && isBlankDocForOutline(doc) && (composerTarget === null
    || (!composerTarget.quote && composerTarget.blockId === initialBlock.id))
  const beginComment = (blockId: string, quote = '', range?: DocsTextRange, parts?: readonly DocsPageSelectionPart[]): void => {
    try {
      const reattachId = commentDraft && state.detachedCommentDraftIds?.includes(commentDraft.id) ? commentDraft.id : undefined
      setCommentDraft(props.commentDraft(blockId, quote, range, reattachId, parts))
      setCommentsOpen(true); setActiveComment(null)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const selectComment = (id: string): void => {
    setActiveComment(id); setCommentsOpen(true)
    const thread = doc?.comments?.find(item => item.id === id)
    if (thread && !thread.detached) {
      const block = doc?.blocks.find(item => item.id === thread.blockId)
      if (block && doc) props.selectDocTab(block.tabId ?? doc.id)
    }
    if (thread && !thread.detached) requestAnimationFrame(() => {
      scroll.current?.querySelector(`[id="doc-block-${thread.blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }
  const documentLink = (params: URLSearchParams): string => {
    const intent = readDocsRoute(params.toString())
    return intent && props.documentLink ? props.documentLink({ ...intent, token: intent.token ?? route?.token }) : `${location.origin}${location.pathname}#${params}`
  }
  const threadLink = (id: string): string => {
    const params = new URLSearchParams(location.hash.slice(1))
    params.set('suite', 'docs'); params.set('workspace', workspaceId)
    params.set('doc', doc?.id ?? ''); params.set('thread', id)
    const blockId = doc?.comments?.find(thread => thread.id === id)?.blockId
    const block = doc?.blocks.find(item => item.id === blockId)
    if (block && doc) params.set('tab', block.tabId ?? doc.id)
    return documentLink(params)
  }
  const sendThread = async (document: CopyOSDocDocument, threadId: string): Promise<void> => {
    const thread = document.comments?.find(item => item.id === threadId), request = thread?.assistant
    if (!request || request.state !== 'pending') return
    try { await props.draftDoc(workspaceId, t('docsCommentAssistantAction', { id: document.id, thread: threadId, request: request.id }), document.id, threadId, { title: document.title,
      request: thread.messages.find(message => message.id === request.messageId)?.text || t('docsAskAssistant'), scope: 'comment', quote: thread.quote }) }
    catch {
      await props.commentDoc({ type: 'assistant-failed', threadId, requestId: request.id })
      setError(t('docsCommentReplyFailed'))
    }
  }
  const applyComment = async (action: CopyOSDocCommentAction): Promise<CopyOSDocDocument> => {
    const document = await props.commentDoc(action)
    if (action.type === 'create' && action.requestAssistant) await sendThread(document, action.draft.id)
    else if ((action.type === 'reply' && action.requestAssistant) || action.type === 'ask') await sendThread(document, action.threadId)
    return document
  }
  const askThread = async (thread: CopyOSDocCommentThread): Promise<void> => {
    if (thread.assistant?.state === 'pending') await props.commentDoc({ type: 'assistant-failed', threadId: thread.id, requestId: thread.assistant.id })
    await applyComment({ type: 'ask', threadId: thread.id })
  }
  const pendingSuggestions = doc?.suggestions?.filter(item => item.state === 'pending') ?? []

  const unthreadedSuggestions = pendingSuggestions
    .filter(item => item.threadId === undefined && blocks.some(block => block.id === item.blockId))
  const readOnly = state.readOnly || reading
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true)
  const [below, setBelow] = useState(false)
  useEffect(() => {
    let mounted = true
    const open = (): void => {
      void startDocs(workspaceId, route?.docId, route?.token).catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    const restore = (event: PageTransitionEvent): void => { if (event.persisted) open() }
    open()
    window.addEventListener('pagehide', stopDocs)
    window.addEventListener('pageshow', restore)
    return () => {
      mounted = false
      window.removeEventListener('pagehide', stopDocs)
      window.removeEventListener('pageshow', restore)
      stopDocs()
    }
  }, [workspaceId, startDocs, stopDocs, route?.docId, route?.token])
  useEffect(() => {
    if (!route || doc?.id !== route.docId) return
    if (route.tabId) props.selectDocTab(route.tabId)
    if (route.threadId) props.focusComment(route.threadId)
    if (route.passage) {
      const target = props.locateDocPassage(route.passage)
      if (target) {
        props.selectDocTab(target.tabId)
        setFocusPassage({ blockId: target.blockId, range: target.range, key: `${route.passage.start}:${route.passage.end}` })
      }
    }
  }, [route?.docId, route?.tabId, route?.threadId, route?.passage?.start, route?.passage?.end, doc?.id])
  useEffect(() => {
    const query = matchMedia('(max-width: 767px)')
    const root = workspaceRoot.current
    const listener = (): void => {
      const width = root?.getBoundingClientRect().width ?? 0
      setSmall(width > 0 ? width <= 767 : query.matches)
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(listener)
    if (root) observer?.observe(root)
    listener(); query.addEventListener('change', listener)
    return () => { observer?.disconnect(); query.removeEventListener('change', listener) }
  }, [])
  useEffect(() => {
    const viewport = window.visualViewport
    const update = (): void => {
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
      workspaceRoot.current?.style.setProperty('--docs-keyboard-inset', `${inset}px`)
    }
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update)
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update) }
  }, [])
  const writing = doc?.blocks.find(b => b.state === 'writing')
  useEffect(() => {
    if (!writing) {
      setBelow(false)
      return
    }
    if (follow.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' })
    else setBelow(true)
  }, [writing?.content, writing?.id])
  const run = (operation: () => Promise<unknown>): void => {
    setError('')
    setPending(true)
    void operation()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        setPending(false)
      })
  }
  const resume = (blockId?: string): void => {
    if (!doc || !canAsk || pending || props.assistantWorking) return
    const target = blockId === undefined ? undefined : doc.blocks.find(block => block.id === blockId)
    if (blockId !== undefined && (!target || target.state === 'ready' || target.state === 'writing')) return
    run(async () => {
      if (doc.stopped) await props.controlDoc(false)
      await props.draftDoc(workspaceId, target
        ? t('docsContinueSectionAction', { id: doc.id, block: target.id }) : t('docsContinueAction', { id: doc.id }), doc.id, undefined,
      { title: doc.title, request: target ? t(target.state === 'failed' ? 'docsRetrySection' : 'docsResumeSection', {
        section: target.label || t('docsCurrentSection'),
      }) : t('docsContinue'), scope: 'continue',
      ...(target ? { blockId: target.id, tabId: target.tabId ?? doc.id } : {}) })
    })
  }
  const askStrategy = (prompt: string, request: string): void => {
    if (!doc || !canAsk || pending || props.assistantWorking) return
    run(async () => {
      if (doc.stopped) await props.controlDoc(false)
      await props.draftDoc(workspaceId, prompt, doc.id, undefined, { title: doc.title, request, scope: 'continue' })
    })
  }
  const download = (format: 'markdown' | 'pdf' | 'word', restoreFocus = true): void => {
    if (pending) return
    setMoreOpen(false)
    if (restoreFocus) requestAnimationFrame(() => optionsButton.current?.focus())
    run(async () => {
      setExporting(true)
      try {
        const value = await props.exportDoc(format),
          bytes = Uint8Array.from(atob(value.content), c => c.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: value.mime })), anchor = document.createElement('a')
        anchor.href = url; anchor.download = value.filename; anchor.click()
        setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
      } finally { setExporting(false) }
    })
  }
  const labels = useMemo(
    () => ({ code: { copyLabel: t('docsCopyLink'), copiedLabel: t('docsCopied') }, footnotes: t('docsFootnotes') }),
    [t],
  )
  const waiting = doc?.blocks.some(b => b.state !== 'ready')
  const commentProps = (document: CopyOSDocDocument) => ({
    resolveAsset: props.resolveDocAsset, document, t,
    draft: state.commentDrafts.find(item => item.id === commentDraft?.id) ?? commentDraft, active: activeComment,
    draftDetached: !!commentDraft && (state.detachedCommentDraftIds?.includes(commentDraft.id) ?? false),
    draftStorageFailed: state.commentDraftStorageFailed,
    draftPrefix: commentDraftPrefix(workspaceId, document.id),
    restoreDraft: (draft: CopyOSDocCommentDraft): void => {
      const current = state.commentDrafts.find(item => item.id === draft.id) ?? draft
      setCommentDraft(current); setCommentsOpen(true)
      const block = document.blocks.find(item => item.id === current.blockId)
      if (block) props.selectDocTab(block.tabId ?? document.id)
    },
    canComment, canAsk, assistantWorking: props.assistantWorking ?? false, labels, apply: applyComment, ask: askThread,
    review: props.reviewDoc, select: selectComment,
    close: (): void => {
      if (marginMode) setAllComments(false); else setCommentsOpen(false)
      requestAnimationFrame(() => commentsButton.current?.focus())
    },
    cancelDraft: (): void => { if (commentDraft) props.discardCommentDraft(commentDraft.id); setCommentDraft(null) },
    threadLink,
    copyLink: async (id: string): Promise<void> => { await navigator.clipboard.writeText(threadLink(id)) },
  })
  return (
    <section ref={workspaceRoot} className={`${css.workspace} ${libraryOpen ? css.libraryOpen : ''} ${wide ? css.wide : ''}`}
      onPointerDownCapture={(event) => { if (event.target !== askInput.current) focusAfterSend.current = null }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length || event.defaultPrevented) return
        event.preventDefault()
        if (!readOnly && doc) run(() => props.attachDocFiles(Array.from(event.dataTransfer.files)))
      }}>
      <input ref={importInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden aria-label={t('docsImport')}
        onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file) run(async () => { await props.importDocFile(file); setLibraryOpen(false) })
        }} />
      <input ref={attachmentInput} type="file" multiple hidden aria-label={t('docsAttachFile')} onChange={(event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = ''
        if (files.length) run(() => props.attachDocFiles(files))
      }} />
      {libraryOpen && props.workspacePicker ? <div className={css.libraryWorkspace}>{props.workspacePicker}</div> : null}
      {libraryOpen ? <DocsLibrary importFile={() => { importInput.current?.click() }} t={t}
        documents={state.documents} trashedDocuments={state.trashedDocuments}
        restore={(id) => { run(async () => {
          await props.trashDoc(id, false); await openDocument(id)
        }) }} currentId={doc?.id} loading={state.status === 'loading'}
        pending={pending} error={error || state.error} open={(id) => { run(() => openDocument(id)) }}
        create={() => { run(createDocument) }} close={doc ? () => {
          setLibraryOpen(false); requestAnimationFrame(() => libraryButton.current?.focus())
        } : undefined} /> : null}
      <div className={css.shell} hidden={libraryOpen}>
      {pagesOpen && doc ? <nav id={pagesId} className={css.pagesNav} aria-label={t('docsPages')}
        onKeyDown={(event) => { if (event.key === 'Escape' && small) { toggleRail(false); pagesButton.current?.focus() } }}>
        <div className={css.pagesHeading}><strong>{t('docsDocsRail')}</strong>
          {canAsk ? <Tooltip label={t('docsNew')} portal><button type="button" className={css.headerTool} aria-label={t('docsNew')} disabled={pending}
            onClick={() => { run(async () => { await createDocument(); if (small) setPagesOpen(false) }) }}><IconPlusOutlineRegular size={16} /></button></Tooltip> : null}
          <Tooltip label={t('docsHideDocs')} portal><button type="button" className={css.headerTool} aria-label={t('docsHideDocs')}
            onClick={() => { toggleRail(false); requestAnimationFrame(() => pagesButton.current?.focus()) }}><IconPanelLeftOutlineRegular size={16} /></button></Tooltip>
        </div>
        {props.workspacePicker ? <div className={css.railWorkspaceRow}>{props.workspacePicker}</div> : null}
        <div className={css.pagesList}>{(state.documents.some(item => item.id === doc.id) ? state.documents : [doc, ...state.documents]).map((item) => {
          const current = item.id === doc.id ? doc : item, ago = docsShortAgo(current.updatedAt, now)
          return <button key={item.id} type="button" disabled={pending}
            aria-current={item.id === doc.id ? 'page' : undefined} title={current.title || t('docsUntitled')}
            onClick={() => { run(async () => { await openDocument(item.id); if (small) setPagesOpen(false) }) }}>
            <span className={css.pageIcon} aria-hidden="true"><DocumentIcon size={16} /></span>
            <span className={css.pageText}><strong>{current.title || t('docsUntitled')}</strong>
              <small>{ago ? t('docsEditedAgo', { time: ago }) : t('docsEditedNow')}</small></span>
          </button>
        })}</div>
        {!route?.token && !new URLSearchParams(location.hash.slice(1)).has('token') ? <button ref={libraryButton} type="button" className={css.pagesAll}
          onClick={() => { run(async () => { await props.refreshDocLibrary(); setLibraryOpen(true) }) }}>{t('docsAll')}</button> : null}
      </nav> : null}
      <div className={css.main}>
      <header className={css.topbar} hidden={libraryOpen}>
        <div className={css.breadcrumb}>
          {!pagesOpen || small ? <Tooltip label={t('docsShowDocs')} portal><button ref={pagesButton} type="button" className={css.headerTool}
            aria-label={t('docsShowDocs')} aria-expanded={pagesOpen} aria-controls={pagesId} disabled={!doc}
            onClick={() => { toggleRail(!pagesOpen); setOutlineOpen(false) }}><IconPanelLeftOutlineRegular size={16} /></button></Tooltip> : null}
          {props.workspaceTitle ? <><span className={css.crumbWorkspace}>{props.workspaceTitle}</span>
            <span className={css.crumbDivider} aria-hidden="true">/</span></> : null}
          <strong className={css.crumbTitle} title={doc?.title}>{doc ? doc.title || t('docsUntitled') : t('docsDocsRail')}</strong>
          <span className={css.saveState} role="status">
            {exporting ? t('docsExporting') : state.status === 'saving' ? t('docsSaving')
              : state.status === 'offline' ? t('docsOffline') : state.status === 'loading' ? t('docsLoading')
                : state.status === 'saved' ? doc ? docsShortAgo(doc.updatedAt, now)
                  ? t('docsEditedAgo', { time: docsShortAgo(doc.updatedAt, now) }) : t('docsEditedNow') : t('docsSaved')
                  : t('docsError')}
          </span>
        </div>
        <div className={css.topActions}>
          {doc ? <DocsPresence t={t} peers={state.peers} unavailable={state.presenceUnavailable} jump={(peer) => {
            props.selectDocTab(peer.tabId)
            requestAnimationFrame(() => {
              const block = peer.cursor && workspaceRoot.current?.querySelector<HTMLElement>(`[id="doc-block-${peer.cursor.blockId}"]`)
              const target = block || titleInput.current
              target?.scrollIntoView({ block: 'center', behavior: 'instant' })
            })
          }} /> : null}
          {(writing || props.assistantWorking) && !state.readOnly ? (
            <>
              <span className={css.writing} aria-live="polite">
                {writing ? t('docsWriting', { section: writing.label }) : t('docsAssistantWorking')}
              </span>
              <button
                onClick={() => {
                  run(async () => { await props.controlDoc(true); await props.stopAssistant() })
                }}
              >
                {t('docsStop')}
              </button>
            </>
          ) : null}
          {pendingSuggestions.length ? (
            <button
              className={css.reviewCount}
              onClick={() => {
                const first = pendingSuggestions[0], block = doc?.blocks.find(item => item.id === first?.blockId)
                if (first && block && doc) props.selectDocTab(block.tabId ?? doc.id)
                if (first?.threadId === undefined) requestAnimationFrame(() => suggestionsRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
                else { const id = pendingSuggestions[0]?.threadId; if (id) selectComment(id) }
              }}
            >
              {t('docsReviewCount', { count: String(pendingSuggestions.length) })}
            </button>
          ) : null}
          {doc ? <Tooltip label={marginMode ? t('docsAllComments') : t('docsCommentsCount', { count: String(doc.comments?.filter(thread => !thread.resolved).length ?? 0) })} portal>
            <button ref={commentsButton} className={css.headerTool} aria-label={t(marginMode ? 'docsAllComments' : 'docsComments')} aria-pressed={panelOpen}
              onClick={() => { if (marginMode) setAllComments(!allComments); else setCommentsOpen(!commentsOpen) }}>
              <IconNewChatOutlineRegular size={16} />
              {doc.comments?.filter(thread => !thread.resolved).length || null}
            </button>
          </Tooltip> : null}
          {doc && canAsk ? (
            <Tooltip label={t('docsAskAssistant')} portal><button
              className={css.askTopButton}
              onClick={() => {
                ask()
              }}
              aria-label={t('docsAskAssistant')}
            >
              <IconSparkleRegular size={16} />
            </button></Tooltip>
          ) : null}
          {doc && !state.readOnly ? <span className={css.headerLabelled}><ChromeButton type="button" variant="ghost" size="sm"
            aria-label={t('docsHistory')} onClick={() => { setHistoryOpen(true) }}>
            <IconClockOutlineRegular size={16} /><span className={css.headerLabel}>{t('docsHistoryShort')}</span></ChromeButton></span> : null}
          {doc && !route?.token ? <span className={css.headerLabelled}><ChromeButton type="button" variant="ghost" size="sm"
            aria-label={t('docsCopyDocLink')} onClick={() => { run(async () => {
              await props.flushDocs()
              const params = new URLSearchParams(location.hash.slice(1))
              params.set('suite', 'docs'); params.set('workspace', workspaceId); params.set('doc', doc.id)
              for (const key of ['tab', 'thread', 'anchorStart', 'anchorEnd', 'token', 'role']) params.delete(key)
              await navigator.clipboard.writeText(documentLink(params))
              setLinkCopied(true); setTimeout(() => { setLinkCopied(false) }, 1600)
            }) }}>
            <IconLinkOutlineRegular size={16} /><span className={css.headerLabel}>{t(linkCopied ? 'docsCopied' : 'docsLink')}</span></ChromeButton></span> : null}
          {doc && canAsk ? <span className={css.headerLabelled}><ChromeButton type="button" variant="ghost" size="sm" aria-label={t('docsShare')}
            onClick={() => { setCopied(false); setShareOpen(true) }}>
            <IconShareOutlineRegular size={16} /><span className={css.headerLabel}>{t('docsShare')}</span></ChromeButton></span> : null}
          {doc ? (
            <div className={css.popoverAnchor}>
              <button
                ref={optionsButton}
                className={css.headerTool}
                aria-label={t('docsMore')}
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen(!moreOpen)
                }}
              >
                <IconEllipsisOutlineRegular size={16} />
              </button>
              {moreOpen ? (
                <div className={css.menu}>
                  {!route?.token && !new URLSearchParams(location.hash.slice(1)).has('token') ? <button disabled={pending} onClick={() => { setMoreOpen(false); run(async () => {
                    await props.refreshDocLibrary(); setLibraryOpen(true)
                  }) }}>{t('docsAll')}</button> : null}
                  {props.focusDocument ? <button disabled={pending} onClick={() => { run(async () => {
                    await props.flushDocs(); setMoreOpen(false); props.focusDocument?.()
                  }) }}>{t('docsFocusDocument')}</button> : null}
                  {props.leaveDocument ? <button disabled={pending} onClick={() => { run(async () => {
                    await props.flushDocs(); setMoreOpen(false); props.leaveDocument?.()
                  }) }}>{t('docsBackToChat')}</button> : null}
                  {!state.readOnly ? (
                    <button
                      onClick={() => {
                        setReading(!reading)
                        setMoreOpen(false)
                      }}
                    >
                      {t(reading ? 'docsEdit' : 'docsRead')}
                    </button>
                  ) : null}
                  {!readOnly ? <button onClick={() => { setMoreOpen(false); if (attachmentInput.current) {
                    attachmentInput.current.accept = ''; attachmentInput.current.click()
                  } }}>{t('docsAttachFile')}</button> : null}
                  {canAsk ? <>
                    <hr className={css.menuSeparator} />
                    <button disabled={pending} onClick={() => { setMoreOpen(false); run(createDocument) }}>{t('docsNew')}</button>
                    <button onClick={() => { setMoreOpen(false); importInput.current?.click() }}>{t('docsImport')}</button>
                    <button disabled={pending} onClick={() => { setMoreOpen(false); run(async () => {
                      await props.duplicateDoc(t('docsCopyTitle', { title: doc.title }).slice(0, 200))
                      requestAnimationFrame(() => { titleInput.current?.focus(); titleInput.current?.select() })
                    }) }}>{t('docsDuplicateDocument')}</button>
                    {props.moveDocument ? <button disabled={pending} onClick={() => { run(async () => {
                      await props.flushDocs(); setMoreOpen(false); props.moveDocument?.open(doc.id)
                    }) }}>{props.moveDocument.label}</button> : null}
                    <button disabled={pending} onClick={() => { setMoreOpen(false); run(async () => {
                      await props.trashDoc(doc.id, true); setLibraryOpen(true)
                    }) }} data-danger="true">{t('docsMoveTrash')}</button>
                  </> : null}
                  <hr className={css.menuSeparator} />
                  {!readOnly && tabs.length === 1 ? <button onClick={() => {
                    setMoreOpen(false); props.addDocTab(t('docsTabNumber', { number: '2' }))
                  }}>{t('docsNewTab')}</button> : null}
                  <button aria-pressed={outlineOpen} onClick={() => { setOutlineOpen(!outlineOpen); setMoreOpen(false); requestAnimationFrame(() => optionsButton.current?.focus()) }}>{t('docsOutline')}</button>
                  <button aria-pressed={wide} onClick={() => {
                    const value = !wide; setWide(value); localStorage.setItem('copyos.docs.wide', String(value)); setMoreOpen(false); requestAnimationFrame(() => optionsButton.current?.focus())
                  }}>{t(wide ? 'docsStandardWidth' : 'docsWideWidth')}</button>
                  <hr className={css.menuSeparator} />
                  <button disabled={pending} onClick={() => { setMoreOpen(false); run(async () => {
                    await props.flushDocs()
                    if (articleRef.current) await printDoc(articleRef.current, doc, t('docsPrintImageFailed'), t('docsTabNumber', { number: '1' }))
                  }) }}>{t('docsPrint')}</button>
                  <button disabled={pending}
                    onClick={() => {
                      download('markdown')
                    }}
                  >
                    {t(doc.assets?.length ? 'docsMarkdownBundle' : 'docsMarkdown')}
                  </button>
                  <button disabled={pending}
                    onClick={() => {
                      download('pdf')
                    }}
                  >
                    {t('docsPdf')}
                  </button>
                  <button disabled={pending} onClick={() => { download('word') }}>
                    {t(doc.assets?.some(asset => !asset.image) ? 'docsWordBundle' : 'docsWord')}
                  </button>
                  <button disabled={pending} onClick={() => { setMoreOpen(false); setGoogleHandoff(true) }}>{t('docsGoogleDocs')}</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {error || state.error ? (
        <div className={css.error} role="alert">
          {error || state.error}
        </div>
      ) : null}
      {doc && state.legacyRecoverySource !== null ? <div className={css.legacyRecovery} role="alert">
        <span>{t('docsLegacyRecoveryMessage')}</span>
        <button type="button" disabled={pending} onClick={() => { run(() => props.recoverLegacyDoc(t('docsLegacyRecoveryTab'))) }}>
          {t('docsLegacyRecoveryAction')}</button>
        <button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([state.legacyRecoverySource ?? ''], { type: 'text/markdown;charset=utf-8' }))
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${doc.title}.recovered.md`
          anchor.click(); setTimeout(() => { URL.revokeObjectURL(url) }, 0)
        }}>{t('docsLegacyRecoveryDownload')}</button>
      </div> : null}
      {doc?.trashedAt !== undefined && !libraryOpen ? <div className={css.trashBanner} role="status">
        <span>{t('docsInTrash')}</span>
        <button disabled={pending} onClick={() => { run(() => props.trashDoc(doc.id, false)) }}>{t('docsRestore')}</button>
      </div> : null}
      {doc && !libraryOpen ? <div hidden={tabs.length === 1}><DocsTabs tabs={tabs} active={activeTab} readOnly={readOnly} t={t}
        select={props.selectDocTab} add={(title) => {
          props.addDocTab(title)
          requestAnimationFrame(() => articleRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [contenteditable="true"]')?.focus())
        }} rename={props.renameDocTab} move={props.moveDocTab}
        copyLink={async (id) => {
          await props.flushDocs()
          const params = new URLSearchParams(location.hash.slice(1))
          params.set('suite', 'docs'); params.set('workspace', workspaceId); params.set('doc', doc.id); params.set('tab', id)
          await navigator.clipboard.writeText(documentLink(params))
        }} /></div> : null}
      <div className={css.documentBody} hidden={libraryOpen}>
        {outlineOpen && doc ? <nav className={css.outline} aria-label={t('docsOutline')}>
          <div><strong>{t('docsOutline')}</strong><button aria-label={t('docsCloseOutline')} onClick={() => { setOutlineOpen(false); optionsButton.current?.focus() }}>×</button></div>
          {blocks.map((block, index) => isStrategyDocument(doc) && block.state === 'pending' ? null : <button key={block.id} title={block.label || block.content.split('\n')[0]} onClick={() => {
            scroll.current?.querySelector(`[id="doc-block-${block.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            if (matchMedia('(max-width: 1023px)').matches) { setOutlineOpen(false); optionsButton.current?.focus() }
          }}>{block.label || block.content.split('\n').find(line => line.trim())?.replace(/^#{1,6}\s+/u, '') || t('docsSectionNumber', { number: String(index + 1) })}</button>)}
        </nav> : null}
        <div
          ref={scroll}
          data-doc-selection-surface
          className={css.scroll}
          onScroll={(e) => {
            const el = e.currentTarget
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
          }}
        >
          {!doc ? (
            <div className={css.empty}>
              <IconDeliverDocRegular size={36} />
              <h1>{t(props.assistantWorking ? 'docsPlanning' : 'docsEmpty')}</h1>
              <p>{t(props.assistantWorking ? 'docsPlanningHint' : 'docsEmptyHint')}</p>
              {state.status === 'loading' || props.assistantWorking ? (
                <div className={css.skeleton} />
              ) : (
                <button
                  className={css.primary}
                  disabled={pending}
                  onClick={() => {
                    run(createDocument)
                  }}
                >
                  {t('docsNew')}
                </button>
              )}
            </div>
          ) : (
            <div className={css.page} data-margin={marginComments}>
            <article ref={articleRef} tabIndex={-1} aria-label={doc.title || t('docsUntitled')} className={css.document}
              onFocusCapture={(event) => { if (small && event.target !== event.currentTarget) setMobileEditing(true) }}
              onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMobileEditing(false) }}>
              <textarea rows={1}
                className={css.title}
                ref={titleInput}
                aria-label={t('docsDocumentTitle')}
                value={doc.title}
                maxLength={200}
                readOnly={readOnly}
                onChange={(e) => {
                  props.editDoc('title', e.target.value.replace(/\r?\n/gu, ' '))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    articleRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
                  }
                }}
                placeholder={t('docsUntitled')}
              />
              {initialDraft && (pending || props.assistantWorking) ? <p className={css.initialPlanning} role="status">{t('docsPlanningHint')}</p> : null}
              {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`docs-tab-panel-${tab.id}`}
                aria-labelledby={`docs-tab-${tab.id}`} hidden={tab.id !== activeTab}
                className={isStrategyDocument(doc) ? css.strategyPage : undefined}>
                <DocsRichBlock content="" captureEdit={props.captureDocEdit} focusAfterSection={focusAfterSection}
                  focusPassage={focusPassage} editable={!libraryOpen && !readOnly && tab.id === activeTab}
                  comments={doc.comments ?? []} activeComment={activeComment} onCommentSelect={selectComment}
                  peers={state.peers} resolveAsset={props.resolveDocAsset} onUploadFiles={!readOnly ? props.uploadDocFiles : undefined}
                  onChange={() => {}} onFocus={() => {}} onExit={() => {}}
                  onUndo={props.undoDoc} onRedo={props.redoDoc} t={t}
                  page={{ blocks: doc.blocks.filter(block => (block.tabId ?? doc.id) === tab.id), assistantEdits: state.assistantEdits,
                    editable: !libraryOpen && !readOnly && tab.id === activeTab, canAsk: !libraryOpen && canAsk && tab.id === activeTab, t,
                    stopped: doc.stopped, recovering: pending || !!props.assistantWorking,
                    update: (values, boundary, move) => { if (tab.id === activeTab) props.editDocPage(values, boundary, move) },
                    activate: (id) => { if (id) { setSectionId(id); setWholeDocument(false); confirmDraftScope() } },
                    cursor: (id, range) => { props.setDocCursor(id ?? null, range) },
                    ask: (id, quote, range, parts, instruction) => { ask(id, quote, range, parts, instruction) },
                    comment: canComment ? (id, quote, range, parts) => { beginComment(id, quote, range, parts) } : undefined,
                    selectComment, move: props.moveDocBlock, add: props.addDocBlock, resume,
                    copyLink: async (id, range) => {
                      const anchor = props.anchorDocPassage(id, range)
                      if (!anchor) throw new Error(t('docsReferenceChanged'))
                      await props.flushDocs()
                      const params = new URLSearchParams(location.hash.slice(1))
                      params.set('suite', 'docs'); params.set('workspace', workspaceId); params.set('doc', doc.id); params.set('tab', tab.id)
                      params.delete('thread'); params.set('anchorStart', anchor.start); params.set('anchorEnd', anchor.end)
                      await navigator.clipboard.writeText(documentLink(params))
                    },
                  }} />
              </div>)}
              {unthreadedSuggestions.length ? (
                <section ref={suggestionsRef} className={css.suggestions} aria-label={t('docsSuggestedEdits')}>
                  <div className={css.suggestionHeading}>
                    <strong>✧ {t('docsSuggestedEdits')}</strong>
                    <span>{unthreadedSuggestions.length}</span>
                  </div>
                  {unthreadedSuggestions.map(item => (
                    <SuggestionCard
                      key={item.id}
                      suggestion={item}
                      labels={labels}
                      resolveAsset={props.resolveDocAsset}
                      t={t}
                      disabled={pending || state.readOnly}
                      review={(decision, replacement) => {
                        return props.reviewDoc(item.id, decision, replacement)
                      }}
                    />
                  ))}
                </section>
              ) : null}
              {!readOnly ? (
                <Tooltip label={t('docsAdd')} portal><button
                  className={css.addBlock}
                  onClick={() => {
                    const last = blocks.at(-1)
                    props.addDocBlock()
                    if (last) setFocusAfterSection(last.id)
                  }}
                  aria-label={t('docsAdd')}
                >
                  <IconPlusOutlineRegular size={17} />
                </button></Tooltip>
              ) : null}
              {!readOnly && isStrategyDocument(doc) ? (
                <StrategyStageBar document={doc} canAsk={canAsk} busy={pending || (props.assistantWorking ?? false)} t={t}
                  ask={askStrategy} />
              ) : !readOnly && canAsk && !writing && waiting ? (
                <button className={css.continue} disabled={pending || props.assistantWorking} onClick={() => { resume() }}>
                  ↗ {t('docsContinue')}
                </button>
              ) : null}
            </article>
            {marginComments ? <DocsCommentMargin key={doc.id} anchors={articleRef} openAll={() => { setAllComments(true) }}
              {...commentProps(doc)} open /> : null}
            </div>
          )}
        </div>
        {doc ? <DocsComments key={doc.id} {...commentProps(doc)} {...(marginComments ? { draft: null } : {})} open={panelOpen} heading={marginMode ? t('docsAllComments') : undefined} /> : null}
      </div>
      {doc && canAsk && !(small && (commentsOpen || mobileEditing)) ? (
        <section
          ref={assistantDock}
          className={css.assistantDock}
          hidden={libraryOpen}
          data-resting={!showAssistantControls}
          data-conversation-open={conversationOpen}
          onMouseEnter={() => { setAssistantHovered(true) }}
          onMouseLeave={() => { setAssistantHovered(false) }}
          aria-label={t('docsAskAssistant')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && conversationOpen && !assistantMenuOpen) {
              event.stopPropagation(); setConversationOpen(false)
            }
          }}
          onFocusCapture={(event) => { setAssistantFocused(event.target === askInput.current
            || (event.target instanceof Element && event.target.matches(':focus-visible'))) }}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAssistantFocused(false) }}
        >
          {props.conversation ? <section className={css.assistantConversation} hidden={!conversationOpen}
            aria-label={t('docsConversation')}>{props.conversation(conversationOpen)}</section> : null}
          <div className={css.askScope} hidden={!showAssistantControls}>
            {initialDraft ? <span>{t('docsDraftDocument')}</span> : <>
              <select aria-label={t('docsEditMode')} value={editMode} disabled={pending} onChange={(event) => {
                const mode = event.target.value
                if (mode === 'suggest' || mode === 'apply') setRequestDraft(current => ({ ...current, key: requestDraftKey, editMode: mode }))
              }}>
                <option value="suggest">{t('docsSuggestMode')}</option>
                <option value="apply">{t('docsApplyMode')}</option>
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  confirmDraftScope()
                  setAskTarget(null)
                  setWholeDocument(true)
                }}
                title={composerTarget?.quote || currentSection?.label || scopeLabel}
              >
                {scopeLabel}
                {composerTarget ? ' ×' : ''}
              </button>
            </>}
          </div>
          <form aria-label={t('docsAskAssistant')}
            onSubmit={(event) => {
              event.preventDefault()
              if (!brief.trim() || pending || props.assistantBlocked || missingDraftScope || selectionChanged) return
              const input = askInput.current
              focusAfterSend.current = input && document.activeElement === input ? { input, key: requestDraftKey } : null
              setConversationOpen(true)
              run(async () => {
                await props.flushDocs()
                const draftingDoc = initialDraft && doc.stopped ? await props.controlDoc(false) : doc
                const instruction = initialDraft ? t('docsDraftExistingAction', { id: doc.id, instruction: brief.trim() })
                  : t(editMode === 'apply' ? 'docsDirectAction' : 'docsCollaborateAction', { id: doc.id, instruction: brief.trim() })
                const target = initialDraft ? '' : composerTarget
                  ? composerTarget.selections ? t('docsPassagesAction', { parts: JSON.stringify(composerTarget.selections) })
                    : composerTarget.quote ? t('docsPassageAction', { block: composerTarget.blockId, quote: composerTarget.quote })
                      : t('docsSectionAction', { block: composerTarget.blockId })
                  : t('docsWholeDocumentAction')
                await props.draftDoc(workspaceId, target ? `${instruction}\n${target}` : instruction, doc.id, undefined,
                  { title: doc.title, request: brief.trim(), epoch: draftingDoc.epoch, tabId: activeTab ?? doc.id,
                    ...(initialDraft ? { scope: 'draft', renameTitle: doc.title === t('docsUntitled'), blockId: initialBlock.id }
                      : { scope: composerScope, editMode, ...(composerTarget ? { blockId: composerTarget.blockId } : {}) }),
                    ...(composerTarget?.selection ? { selection: composerTarget.selection } : {}),
                    ...(composerTarget?.selections ? { selections: composerTarget.selections } : {}),
                    ...(composerTarget?.quote ? { quote: composerTarget.quote } : {}) })
                try { clearAssistantDraft(requestDraftKey, { text: brief, editMode, target: composerTarget }) }
                catch (cause) { console.warn('Unable to clear an accepted document request', cause); setDraftNotSaved(true) }
              })
            }}
          >
            {askTarget ? (
              <blockquote className={css.askQuote}>
                {askTarget.quote || doc.blocks.find(b => b.id === askTarget.blockId)?.label}
              </blockquote>
            ) : null}
            <div className={css.askInputRow}>
              <Menu open={assistantMenuOpen && !libraryOpen} side="top" portal autoFocus compact
                onClose={() => { setAssistantMenuOpen(false) }}
                items={[{ id: 'image', label: t('docsInsertImage'), disabled: readOnly || pending },
                  { id: 'file', label: t('docsAttachFile'), icon: <IconPaperclipOutlineRegular size={16} />, disabled: readOnly || pending }]}
                onSelect={(id) => {
                  setAssistantMenuOpen(false)
                  if (!attachmentInput.current || readOnly || pending) return
                  attachmentInput.current.accept = id === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : ''
                  attachmentInput.current.click()
                }}
                anchor={<Tooltip label={t('docsAddToPage')} portal side="top"><button type="button" className={css.assistantTool}
                  disabled={readOnly || pending} aria-label={t('docsAddToPage')} aria-haspopup="menu" aria-expanded={assistantMenuOpen}
                  onClick={() => { setAssistantMenuOpen(!assistantMenuOpen) }}><IconPlusOutlineRegular size={17} /></button></Tooltip>} />
              <textarea
                ref={askInput}
                rows={1}
                disabled={pending || props.assistantBlocked}
                value={brief}
                onChange={(event) => {
                  setBrief(event.target.value)
                }}
                placeholder={t('docsCollaboratePlaceholder')}
                aria-label={t('docsCollaboratePlaceholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              {props.conversation ? <Tooltip label={t(conversationOpen ? 'docsCollapseConversation' : 'docsExpandConversation')} portal side="top">
                <button type="button" className={css.assistantTool} disabled={props.assistantBlocked} aria-expanded={conversationOpen}
                  aria-label={t(conversationOpen ? 'docsCollapseConversation' : 'docsExpandConversation')}
                  onClick={() => { setConversationOpen(!conversationOpen) }}><IconClockOutlineRegular size={16} /></button>
              </Tooltip> : null}
              <button className={css.sendButton} data-ready={!!brief.trim()} disabled={pending || props.assistantBlocked || !brief.trim() || missingDraftScope || selectionChanged} aria-label={t('docsSendAssistant')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
              </button>
            </div>
            <p hidden={!conversationOpen && editMode !== 'apply'}>{t(initialDraft ? 'docsPlanningHint'
              : editMode === 'apply' ? 'docsDirectHint' : 'docsSuggestionsHint')}</p>
            {selectionChanged ? <p role="alert">{t('docsDirectSelectionChanged')}</p> : null}
            {missingDraftScope ? <p role="alert">{t('docsRequestScopeMissing')}</p> : null}
            {draftNotSaved ? <p role="alert">{t('docsFeedbackNotSaved')}</p> : null}
          </form>
        </section>
      ) : null}
      </div>
      </div>
      {historyOpen && doc ? <DocsHistory key={doc.id} docId={doc.id} t={t} resolveAsset={props.resolveDocAsset}
        load={props.listDocHistory} read={props.readDocHistory}
        name={props.nameDocVersion} restore={props.restoreDocVersion} onClose={() => {
          setHistoryOpen(false); requestAnimationFrame(() => optionsButton.current?.focus())
        }} /> : null}
      {googleHandoff && doc ? <DocsGoogleHandoff t={t} pending={pending} error={error}
        download={() => { download('word', false) }} close={() => {
          setGoogleHandoff(false); requestAnimationFrame(() => optionsButton.current?.focus())
        }} /> : null}
      {below ? (
        <button
          className={css.below}
          onClick={() => {
            follow.current = true
            setBelow(false)
            scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          {t('docsWriting', { section: writing?.label ?? '' })} ↓
        </button>
      ) : null}
      {shareOpen ? (
        <div
          className={css.backdrop}
          onClick={() => {
            setShareOpen(false)
          }}
        >
          <section
            className={css.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="docs-share-title"
            onClick={(e) => {
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShareOpen(false)
            }}
          >
            <div className={css.dialogHeading}>
              <h2 id="docs-share-title">{t('docsShare')}</h2>
              <button
                autoFocus
                onClick={() => {
                  setShareOpen(false)
                }}
                aria-label={t('docsClose')}
              >
                ×
              </button>
            </div>
            <strong>{doc?.title}</strong>
            <p>{t('docsPrivate')}</p>
            <p className={css.shareHint}>{t('docsShareHint')}</p>
            <select
              aria-label={t('docsShare')}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as 'viewer' | 'commenter' | 'editor')
                setCopied(false)
              }}
            >
              <option value="viewer">{t('docsViewer')}</option>
              <option value="commenter">{t('docsCommenter')}</option>
              <option value="editor">{t('docsEditor')}</option>
            </select>
            <button
              className={css.primary}
              disabled={pending}
              onClick={() => {
                run(async () => {
                  const value = await props.shareDoc(role)
                  const params = new URLSearchParams({
                    suite: 'docs',
                    workspace: workspaceId,
                    doc: doc?.id ?? '',
                    token: value.token,
                    role,
                  })
                  await navigator.clipboard.writeText(documentLink(params))
                  setCopied(true)
                })
              }}
            >
              {t(copied ? 'docsCopied' : 'docsCopyLink')}
            </button>
            <button
              className={css.revoke}
              disabled={pending}
              onClick={() => {
                run(async () => {
                  await props.shareDoc('restricted')
                  setCopied(false)
                  setShareOpen(false)
                })
              }}
            >
              {t('docsRevoke')}
            </button>
          </section>
        </div>
      ) : null}
    </section>
  )
}

