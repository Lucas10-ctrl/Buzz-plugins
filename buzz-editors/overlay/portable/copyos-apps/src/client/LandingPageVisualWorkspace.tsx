/** Visual, chat-first landing-page canvas derived from the approved OpenDesign prototype. */

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Modal, Menu, MenuItemButton, Tooltip, IconSparkleRegular, IconPlusOutlineRegular,
  IconEditOutlineRegular, IconChevronDownOutlineRegular, IconEllipsisOutlineRegular, IconTrashOutlineRegular,
  IconFlatListOutlineRegular, IconNewChatOutlineRegular, IconChevronUpOutlineRegular,
  IconListPenOutlineRegular, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSReusableSectionDocument,
  CopyOSPageDocument,
  CopyOSPageComment,
  CopyOSPageSection,
  CopyOSPageSectionTemplateId,
  CopyOSPageSectionVariant,
} from '../../../copyos-domain/src/types.ts'
import type {
  PageWorkspaceActions,
  SectionPromptIntent,
} from './LandingPageWorkspace.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'
import recoveryCss from './LandingPageRecovery.module.css'
import { guardTextCopies, keepDesktopTextCopies, BREAKPOINT_VARIANT_QUERY, textCopyKeys, textCopyLabel, type TextCopyGuard } from './page-text-copies.ts'
import { measureSectionFrameHeight } from './section-frame-layout.ts'
import { useEditorChrome } from '../EditorChrome.tsx'
import { PagePreviewAssets, localProjectPath, type PageAssetView } from '../PagePreviewAssets.ts'
import { resolvePreviewDeclarationUrls, resolvePreviewStyleUrls } from '../PagePreviewStyles.ts'
import { PREVIEW_FONT_MARKER } from '../PagePreviewFonts.ts'
import { usePagePreviewFonts, type PreviewFontReport } from '../usePagePreviewFonts.ts'

type Translate = (key: CopyOSFoundationLocaleKey) => string

interface Props {
  readonly workspaceId: string
  readonly projectPath?: string
  readonly pageId?: string
  readonly initialPageId?: string
  readonly openPageRequest?: { readonly requestId: string; readonly pageId: string }
  readonly onNavigationReady?: (ready: boolean) => void
  readonly onReturn?: (selectedPageId: string | null) => void
  readonly t: Translate
  readonly actions: PageWorkspaceActions
  readonly onPromptSection?: (intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string) => void | Promise<void>
  /** Prepare the host composer without submitting a message. */
  readonly onStagePromptSection?: (intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string) => void | Promise<void>
}

interface SectionTemplate {
  readonly id: CopyOSPageSectionTemplateId
  readonly family: string
  readonly title: string
  readonly description: string
  readonly html: string
}

interface LibrarySectionTemplate extends Omit<SectionTemplate, 'id'> {
  readonly id: string
  readonly templateId: CopyOSPageSectionTemplateId
  readonly reusable: boolean
}

interface ElementTemplate {
  readonly id: string
  readonly mark: string
  readonly title: string
  readonly description: string
  readonly html: string
}

interface ExistingElementDragPayload {
  readonly kind: 'element'
  readonly sourceSectionId: string
  readonly sourceVariantId: string
  readonly sourceHtml: string
  readonly blockId: string
  readonly elementHtml: string
}

interface ElementMoveRequest extends ExistingElementDragPayload {
  readonly targetSectionId: string
  readonly targetVariantId: string
  readonly targetHtml: string
}

interface ElementSelection {
  readonly id?: string
  readonly sectionId?: string
  readonly variantId?: string
  readonly index: number
  readonly tag: string
  readonly label: string
  readonly width: number
  readonly height: number
  readonly font: string
  readonly lineHeight: string
  readonly color: string
  readonly computedStyle?: Pick<CSSStyleDeclaration, 'fontSize' | 'fontFamily' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'textAlign' | 'direction' | 'color'>
  readonly spacing?: SpacingValues
  /** Whether the element's text holds a separate copy per breakpoint; text edits change only the copy shown at the current viewport. */
  readonly textCopies?: boolean
  /** Whether the element is a disclosure question (summary) or inside one, which double-click edits. */
  readonly question?: boolean
  readonly viewportLeft: number
  readonly viewportTop: number
}

interface HtmlHistoryChange {
  readonly sectionId: string
  readonly variantId: string
  readonly beforeHtml: string
  readonly afterHtml: string
}

interface HtmlHistoryEntry {
  readonly kind: 'html'
  readonly pageId: string
  readonly label: string
  readonly changes: readonly HtmlHistoryChange[]
}

interface MoveHistoryEntry {
  readonly kind: 'move'
  readonly pageId: string
  readonly label: string
  readonly sectionId: string
  readonly beforeIndex: number
  readonly afterIndex: number
}

interface HtmlRecoveryDraft {
  readonly label: string
  readonly changes: readonly HtmlHistoryChange[]
  readonly expectedRevision: number
  readonly onAccepted?: ((page: CopyOSPageDocument) => void) | undefined
}

type BuilderHistoryEntry = HtmlHistoryEntry | MoveHistoryEntry
type SectionSurface = 'white' | 'soft' | 'accent' | 'dark'
type SectionSpacing = 'none' | 'compact' | 'comfortable' | 'spacious'
type SectionAlignment = 'left' | 'center'
type SectionSpacingEdge = 'both' | 'top' | 'bottom'
type SpacingValues = Pick<CSSStyleDeclaration, 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft' | 'marginTop' | 'marginBottom'>
interface SectionSpacingMeasurement {
  readonly targetId?: string
  readonly variantId: string
  readonly targetIndex: number
  readonly paddingTop: string
  readonly paddingBottom: string
}
type DesignScope = 'section' | 'element'
type ReviewMode = 'mark' | 'place-comment' | 'comment' | null
type MarkTool = 'box' | 'pen' | 'text'
type MarkShape = { readonly sectionId: string } & (
  | { readonly id: string; readonly kind: 'box'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly id: string; readonly kind: 'pen'; readonly points: readonly { readonly x: number; readonly y: number }[] }
  | { readonly id: string; readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string }
  | { readonly id: string; readonly kind: 'image'; readonly x: number; readonly y: number; readonly src: string; readonly name: string })
type ElementDesignProperty = 'fontSize' | 'fontFamily' | 'fontWeight' | 'lineHeight' | 'alignment'
  | 'letterSpacing' | 'color' | 'background' | 'width' | 'maxWidth' | 'height' | 'minHeight'
  | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  | 'marginTop' | 'marginBottom' | 'radius'

// Renderer cursor artwork follows Buzz's Tabler MessageCircle outline, with an opaque fill for contrast over page content.
const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" fill="white" stroke="#0f0f0f" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 3 20, crosshair`

const SECTION_DRAG_TYPE = 'application/x-copyos-section'
const SECTION_TEMPLATE_DRAG_TYPE = 'application/x-copyos-section-template'
const ELEMENT_DRAG_TYPE = 'application/x-copyos-element'
const ELEMENT_TEMPLATE_DRAG_TYPE = 'application/x-copyos-element-template'
// Desktop renders sections of pages converted from Canvas at least this wide, and wider than any max-width media rule in
// the page, so desktop rules and breakpoint copies apply; narrower canvases scale the frames down. Other pages fill the canvas.
const DESKTOP_VIEWPORT_WIDTH = 1280
// Marks the temporary editing span that double-click wraps around a disclosure question's shown text.
const QUESTION_EDITOR_ATTRIBUTE = 'data-copyos-question-editor'
const EDITABLE_ELEMENT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,article,a,button,label,figure,figcaption,ul,li'
const STYLEABLE_ELEMENT_SELECTOR = `${EDITABLE_ELEMENT_SELECTOR},div,span,strong,em,img,video,svg,hr`

function elementTemplates(t: Translate): readonly ElementTemplate[] {
  return [
    {
      id: 'heading', mark: 'H', title: t('builderVisualHeading'), description: t('builderVisualAddANewEditableSectionHeading'),
      html: '<h2 style="margin:24px 0 0;font-size:34px;line-height:1.08;letter-spacing:-.04em">New section heading</h2>',
    },
    {
      id: 'paragraph', mark: '¶', title: t('designerSemanticsParagraph'), description: t('builderVisualAddSupportingCopyThatCanBeEditedDirectly'),
      html: '<p style="max-width:58ch;margin:14px 0 0;color:#61666b;font-size:15px;line-height:1.65">Add clear supporting copy here.</p>',
    },
    {
      id: 'button', mark: '↗', title: t('builderVisualButton'), description: t('builderVisualAddAConversionFocusedCallToAction'),
      html: '<a href="#" style="display:inline-block;margin-top:20px;padding:12px 17px;border-radius:8px;background:#121418;color:#fff;font-weight:700;text-decoration:none">Call to action</a>',
    },
    {
      id: 'image', mark: '▧', title: t('builderVisualImageBlock'), description: t('builderVisualAddAnEditableVisualPlaceholderAndCaption'),
      html: '<figure style="margin:24px 0 0"><div style="min-height:220px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(145deg,#edf3fe,#dfe8fb);color:#53698e;font:700 13px system-ui">Add image</div><figcaption style="margin-top:8px;color:#7b8087;font:12px system-ui">Image caption</figcaption></figure>',
    },
    {
      id: 'list', mark: '☷', title: t('builderVisualBulletList'), description: t('builderVisualAddThreeConciseBenefitsOrProofPoints'),
      html: '<ul style="margin:20px 0 0;padding-left:22px;color:#333;font-size:15px;line-height:1.7"><li>First benefit or proof point</li><li>Second benefit or proof point</li><li>Third benefit or proof point</li></ul>',
    },
    {
      id: 'divider', mark: '—', title: t('builderVisualDivider'), description: t('builderVisualCreateASubtleVisualBreakInsideTheSection'),
      html: '<hr style="margin:28px 0;border:0;border-top:1px solid rgba(0,0,0,.12)">',
    },
  ]
}

const EMPTY_PAGE = { title: '', slug: '' }
const EMPTY_VARIANT = { label: '', html: '' }

/** Render the prototype-grade visual canvas inside the native Harness right workspace. */
export function LandingPageVisualWorkspace(props: Props): ReactNode {
  return <LandingPageVisualWorkspaceBody key={props.workspaceId} {...props} />
}

function LandingPageVisualWorkspaceBody({ workspaceId, projectPath, pageId, initialPageId, openPageRequest, onNavigationReady, onReturn, t, actions, onPromptSection, onStagePromptSection }: Props): ReactNode {
  const { Button: ChromeButton, PlusIcon: ChromePlusIcon, ActionMenu, PagePicker } = useEditorChrome()
  const [reusableSections, setReusableSections] = useState<readonly CopyOSReusableSectionDocument[]>([])
  const [libraryError, setLibraryError] = useState('')
  const [reusableError, setReusableError] = useState('')
  const libraryRequest = useRef(0)
  const [reusableTarget, setReusableTarget] = useState<CopyOSPageSection | null>(null)
  const [reusableDraft, setReusableDraft] = useState({ title: '', category: 'Reusable', description: '' })
  const [libraryTarget, setLibraryTarget] = useState<{ readonly section: CopyOSReusableSectionDocument; readonly action: 'move' | 'delete' } | null>(null)
  const [libraryCategory, setLibraryCategory] = useState('')
  const [libraryMutationError, setLibraryMutationError] = useState('')
  const [libraryMutationBusy, setLibraryMutationBusy] = useState(false)
  const libraryMutationLock = useRef(false)
  const libraryCategoryListId = useId()
  const [pages, setPages] = useState<readonly CopyOSPageDocument[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletePageTarget, setDeletePageTarget] = useState<CopyOSPageDocument | null>(null)
  const [deletedPage, setDeletedPage] = useState<{page: CopyOSPageDocument; workspaceId: string} | null>(null)

  const [savedState, setSavedState] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [mode, setMode] = useState<'build' | 'preview'>('build')
  const [breakpoint, setBreakpoint] = useState<'desktop' | 'mobile'>('desktop')
  const [drawer, setDrawer] = useState<'structure' | 'templates' | 'elements' | 'design' | 'comments' | 'variations' | 'compare' | null>(null)
  const [libraryDragging, setLibraryDragging] = useState(false)
  const [insertIndex, setInsertIndex] = useState(0)
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateFamily, setTemplateFamily] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pageDraft, setPageDraft] = useState(EMPTY_PAGE)
  const [variantTarget, setVariantTarget] = useState<string | null>(null)
  const [variantDraft, setVariantDraft] = useState(EMPTY_VARIANT)
  const [previewVariantId, setPreviewVariantId] = useState<string | null>(null)
  const [compareVariantId, setCompareVariantId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<CopyOSPageSection | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CopyOSPageSection | null>(null)
  const [moreSectionId, setMoreSectionId] = useState<string | null>(null)
  const [rewriteSectionId, setRewriteSectionId] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<ElementSelection | null>(null)
  const selectedElementRef = useRef(selectedElement)
  selectedElementRef.current = selectedElement
  const [spacingEdge, setSpacingEdge] = useState<SectionSpacingEdge>('both')
  const [sectionSpacing, setSectionSpacing] = useState<Record<string, SectionSpacingMeasurement>>({})
  const [designScope, setDesignScope] = useState<DesignScope>('section')
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [reviewDraft, setReviewDraft] = useState('')
  const [markTool, setMarkTool] = useState<MarkTool>('box')
  const [markShapes, setMarkShapes] = useState<readonly MarkShape[]>([])
  const [markRedo, setMarkRedo] = useState<readonly MarkShape[]>([])
  const [activeMark, setActiveMark] = useState<MarkShape | null>(null)
  const [commentPosition, setCommentPosition] = useState<{ readonly left: number; readonly top: number } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [outlineMenuId, setOutlineMenuId] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState('')
  const [shopifyExportStarted, setShopifyExportStarted] = useState(false)
  const [chatNotice, setChatNotice] = useState(false)
  const [undoStack, setUndoStack] = useState<readonly BuilderHistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<readonly BuilderHistoryEntry[]>([])
  const [legacyPreviewCss, setPreviewCss] = useState('')
  const [assetView, setAssetView] = useState<PageAssetView>()
  const [fontErrors, setFontErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const reportFontErrors = useCallback<PreviewFontReport>((owner, errors) => {
    const text = errors.join('; ')
    setFontErrors(previous => {
      if ((previous.get(owner) ?? '') === text) return previous
      const next = new Map(previous); if (text) next.set(owner, text); else next.delete(owner); return next
    })
  }, [])
  const assetViewOwner = useRef<PageAssetView | undefined>(undefined)
  const readPageAsset = actions.readPageAsset
  const [assetSession, setAssetSession] = useState<PagePreviewAssets>()
  useEffect(() => {
    assetViewOwner.current?.release(); assetViewOwner.current = undefined
    setAssetView(undefined)
    if (readPageAsset === undefined) { setAssetSession(undefined); return }
    const session = new PagePreviewAssets((path, version) => readPageAsset(workspaceId, path, version))
    setAssetSession(session)
    return () => { assetViewOwner.current?.release(); assetViewOwner.current = undefined; session.dispose() }
  }, [readPageAsset, workspaceId])
  const [htmlDrafts, setHtmlDrafts] = useState<Readonly<Record<string, HtmlRecoveryDraft>>>({})
  const htmlDraftsRef = useRef<Readonly<Record<string, HtmlRecoveryDraft>>>({})
  const dirtyFrames = useRef(new Set<string>())
  const hasDirtyFrames = useCallback(() => dirtyFrames.current.size > 0, [])
  const [agentPending, setAgentPending] = useState(false)
  const agentPendingRef = useRef(false)
  const handledNavigation = useRef<string>()
  const navigationLookup = useRef<string>()
  const saveBusy = useRef(false)
  const pageRequest = useRef(0)
  const operationOwner = useRef(0)
  const pagesRef = useRef<readonly CopyOSPageDocument[]>([])
  const selectedPageIdRef = useRef<string | null>(pageId ?? initialPageId ?? null)
  const requestedPageId = useRef(pageId)
  requestedPageId.current = pageId
  const libraryRef = useRef<HTMLElement>(null)
  const selectedSectionRef = useRef<HTMLElement>(null)
  const [canvasScroll, setCanvasScroll] = useState<HTMLDivElement | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  useEffect(() => {
    if (canvasScroll === null) return
    const measure = (): void => {
      const style = getComputedStyle(canvasScroll)
      setCanvasWidth(canvasScroll.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight))
    }
    const observer = new ResizeObserver(measure); observer.observe(canvasScroll); measure()
    return () => { observer.disconnect() }
  }, [canvasScroll])
  const markImageInputRef = useRef<HTMLInputElement>(null)
  const markCanvasRef = useRef<SVGSVGElement>(null)
  const commentCardRef = useRef<HTMLDivElement>(null)

  const loadReusableSections = useCallback(async () => {
    if (libraryMutationLock.current) return
    const request = ++libraryRequest.current
    try {
      const sections = await actions.listReusableSections(workspaceId)
      if (request !== libraryRequest.current) return
      setReusableSections(sections); setLibraryError('')
    } catch (loadError: unknown) { if (request === libraryRequest.current) setLibraryError(errorMessage(loadError)) }
  }, [actions, workspaceId])

  useEffect(() => {
    setReusableSections([]); void loadReusableSections()
    return () => { libraryRequest.current++ }
  }, [loadReusableSections])

  const load = useCallback(async (background = false) => {
    if (saveBusy.current || agentPendingRef.current || hasDirtyFrames() || Object.keys(htmlDraftsRef.current).length > 0) return
    const request = ++pageRequest.current
    if (!background) { setPhase('loading'); setError('') }
    try {
      const next = await actions.listPages(workspaceId)
      if (request !== pageRequest.current || hasDirtyFrames()) return
      const previous = pagesRef.current
      const previousId = selectedPageIdRef.current
      const previousPage = previous.find(page => page.id === previousId)
      const previousIds = new Set(previous.map(page => page.id))
      const newlyCreated = background ? next.find(page => !previousIds.has(page.id)) : undefined
      const nextId = requestedPageId.current ?? (newlyCreated !== undefined && (previousPage?.sections.length ?? 0) === 0
        ? newlyCreated.id
        : previousId !== null && next.some(page => page.id === previousId)
          ? previousId
          : next[0]?.id ?? null)
      const nextPage = next.find(page => page.id === nextId)
      if (previousPage && nextPage && (previousPage.revision ?? 0) !== (nextPage.revision ?? 0)) {
        setUndoStack([]); setRedoStack([])
      }
      if (nextId !== previousId) operationOwner.current++
      pagesRef.current = next
      selectedPageIdRef.current = nextId
      setPages(next)
      setSelectedPageId(nextId)
      setPhase('ready')
    } catch (loadError: unknown) {
      if (request === pageRequest.current && !background) { setError(errorMessage(loadError)); setPhase('error') }
    }
  }, [actions, workspaceId, hasDirtyFrames])

  useEffect(() => {
    void load()
    const refresh = (): void => { if (document.visibilityState === 'visible') void load(true) }
    const timer = window.setInterval(refresh, 3_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      pageRequest.current++; operationOwner.current++
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  const choosePage = (pageId: string): void => {
    operationOwner.current++
    selectedPageIdRef.current = pageId
    setSelectedPageId(pageId); setSelectedSectionId(null); setSelectedElement(null)
    setReviewMode(null); setReviewDraft(''); setDrawer(null); setLibraryDragging(false)
    setSaving(false); setExportPath(''); setError(''); setSavedState(htmlDraftsRef.current[pageId] ? 'unsaved' : 'saved')
  }

  useLayoutEffect(() => {
    if (pageId === undefined || phase === 'loading' || saveBusy.current || agentPendingRef.current || hasDirtyFrames()
      || Object.keys(htmlDraftsRef.current).length > 0 || selectedPageIdRef.current === pageId) return
    operationOwner.current++
    selectedPageIdRef.current = pageId
    setSelectedPageId(pageId); setSelectedSectionId(null); setSelectedElement(null); setError('')
    void load(phase !== 'error')
  }, [pageId, phase, saving, savedState, agentPending, htmlDrafts, hasDirtyFrames, load])

  const selectedPage = useMemo(() => pages.find(page => page.id === selectedPageId), [pages, selectedPageId])
  const desktopWidth = useMemo(() => desktopViewportWidth(selectedPage), [selectedPage])
  const previewStylesheets = useMemo(() => selectedPage === undefined ? [] : collectPageStylesheets(selectedPage), [selectedPage])
  const previewCss = useMemo(() => assetSession === undefined ? legacyPreviewCss : previewStylesheets.map(path => {
    const source = assetView?.stylesheets.get(localProjectPath(path, '') ?? '')
    return source === undefined ? '' : rewriteCssAssetUrls(source, '', path, assetView)
  }).join('\n'), [assetSession, assetView, legacyPreviewCss, previewStylesheets])
  useEffect(() => {
    if (assetSession === undefined || hasDirtyFrames() || Object.keys(htmlDraftsRef.current).length > 0) return
    let live = true
    const sources = [...(selectedPage?.sections.flatMap(section => section.variants.map(variant => variant.html)) ?? []),
      ...reusableSections.map(section => section.html)]
    void assetSession.prepare(sources, true).then(next => {
      if (!live || hasDirtyFrames() || Object.keys(htmlDraftsRef.current).length > 0) { next.release(); return }
      const previous = assetViewOwner.current
      if (previous?.revision === next.revision
        && [...previous.stylesheets.keys()].join('\0') === [...next.stylesheets.keys()].join('\0')
        && [...previous.inlineStyles.keys()].join('\0') === [...next.inlineStyles.keys()].join('\0')
        && previous.errors.join('\0') === next.errors.join('\0')) { next.release(); return }
      assetViewOwner.current = next; setAssetView(next); previous?.release()
    })
    return () => { live = false }
  }, [assetSession, selectedPage, reusableSections, savedState, hasDirtyFrames])
  const selectedSection = selectedPage?.sections.find(section => section.id === selectedSectionId)
  const selectedVariant = selectedSection?.variants.find(variant => variant.id === selectedSection.selectedVariantId)
  const measuredSpacing = selectedSectionId === null ? undefined : sectionSpacing[selectedSectionId]
  const currentSpacing = measuredSpacing?.variantId === selectedVariant?.id ? measuredSpacing : undefined
  const selectedDesign = readSectionDesign(selectedVariant?.html ?? '', currentSpacing)
  const selectedSpacingPreset = spacingEdge === 'top' ? selectedDesign.spacingTop
    : spacingEdge === 'bottom' ? selectedDesign.spacingBottom
      : selectedDesign.spacingTop === selectedDesign.spacingBottom ? selectedDesign.spacingTop : ''
  const selectedElementDesign = readElementDesign(selectedVariant?.html ?? '', selectedElement?.index ?? -1, selectedElement?.spacing, selectedElement?.id, selectedElement?.computedStyle)
  const selectionExists = (): boolean => {
    if (selectedElement === null || selectedVariant === undefined) return false
    if (selectedElement.id !== undefined && (!selectedPage
      || !resolvePageOwner(selectedPage, selectedElement.sectionId, selectedElement.variantId)
      || selectedElement.sectionId !== selectedSection?.id || selectedElement.variantId !== selectedVariant.id)) { setError(t('pageElementTargetMissing')); return false }
    const template = document.createElement('template'); template.innerHTML = selectedVariant.html
    if (resolveStyleElement(template.content, selectedElement.index, selectedElement.id)) return true
    setError(t('pageElementTargetMissing')); return false
  }

  useLayoutEffect(() => {
    if (selectedElement?.id === undefined) return
    if (selectedVariant === undefined || selectedSection === undefined) {
      setSelectedElement(null); setError(t('pageElementTargetMissing')); return
    }
    if (!selectedPage || !resolvePageOwner(selectedPage, selectedElement.sectionId, selectedElement.variantId)
      || selectedElement.sectionId !== selectedSection.id || selectedElement.variantId !== selectedVariant.id) {
      setSelectedElement(null); setReviewMode(null); setError(t('pageElementTargetMissing')); return
    }
    const template = document.createElement('template'); template.innerHTML = selectedVariant.html
    const element = resolveStyleElement(template.content, selectedElement.index, selectedElement.id)
    if (!element) {
      setSelectedElement(null); setReviewMode(null); setMarkShapes([]); setError(t('pageElementTargetMissing')); return
    }
    const index = styleableElements(template.content).indexOf(element)
    // The selection label shows the copy visible in the editing frame, which may be any breakpoint copy.
    const labels = [textCopyLabel(element), ...textCopyKeys(element).map(key => textCopyLabel(element, key))]
      .map(text => text.slice(0, 44) || element.tagName.toLowerCase())
    const label = labels.includes(selectedElement.label) ? selectedElement.label : labels[0] ?? element.tagName.toLowerCase()
    if (index !== selectedElement.index || selectedElement.sectionId !== selectedSection.id
      || selectedElement.variantId !== selectedVariant.id || label !== selectedElement.label) {
      setSelectedElement({ ...selectedElement, index, sectionId: selectedSection.id, variantId: selectedVariant.id,
        label, tag: element.tagName.toLowerCase() })
    }
  }, [selectedElement, selectedVariant, selectedSection, selectedPage, t])

  const variantSection = selectedPage?.sections.find(section => section.id === variantTarget)
  const libraryTemplates = useMemo<readonly LibrarySectionTemplate[]>(() => reusableSections.map(section => ({
    id: `reusable:${section.id}`, templateId: 'custom-html', family: section.category,
    title: section.title, description: section.description, html: section.html, reusable: true,
  })), [reusableSections])
  const templateFamilies = useMemo(() => [...new Set([...libraryTemplates.map(template => template.family), 'Reusable', 'Problem Agitation'])], [libraryTemplates])
  const libraryCategoryOptions = [...new Set([...templateFamilies, 'Offer Boxes'])]
  const openLibraryManagement = (templateId: string, action: 'move' | 'delete'): void => {
    if (libraryMutationLock.current) return
    const section = reusableSections.find(item => `reusable:${item.id}` === templateId)
    if (section === undefined) return
    setLibraryCategory(section.category); setLibraryMutationError(''); setLibraryTarget({ section, action })
  }
  const commitLibraryManagement = async (): Promise<void> => {
    if (libraryTarget === null || libraryMutationLock.current) return
    const target = libraryTarget
    const category = libraryCategory.trim()
    if (target.action === 'move' && category === '') return
    const move = actions.moveReusableSection
    const remove = actions.deleteReusableSection
    if ((target.action === 'move' && move === undefined)
      || (target.action === 'delete' && remove === undefined)) return
    libraryMutationLock.current = true
    setLibraryMutationBusy(true); setLibraryMutationError('')
    const request = ++libraryRequest.current
    try {
      if (target.action === 'move' && move !== undefined) {
        const moved = await move({ workspaceId, sectionId: target.section.id, category })
        if (request !== libraryRequest.current) return
        setReusableSections(current => current.map(item => item.id === moved.id ? moved : item))
        setTemplateFamily(moved.category); setTemplateQuery('')
      } else if (remove !== undefined) {
        await remove({ workspaceId, sectionId: target.section.id, confirmDelete: true })
        if (request !== libraryRequest.current) return
        setReusableSections(current => current.filter(item => item.id !== target.section.id))
      }
      setLibraryTarget(null)
    } catch (mutationError: unknown) {
      if (request === libraryRequest.current) setLibraryMutationError(errorMessage(mutationError))
    } finally {
      libraryMutationLock.current = false
      setLibraryMutationBusy(false)
    }
  }
  const activeTemplateFamily = templateFamilies.includes(templateFamily) ? templateFamily : templateFamilies[0]
  const familyLabel = (family: string): string => family === 'Offer Boxes' ? t('offerBoxes')
    : family === 'Reusable' ? t('reusableSections') : family === 'Problem Agitation' ? t('problemAgitation') : family
  const matchingTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase()
    return libraryTemplates.filter(template => (query !== '' || template.family === activeTemplateFamily)
      && (query === '' || `${template.family} ${template.title} ${template.description}`.toLowerCase().includes(query)))
  }, [libraryTemplates, activeTemplateFamily, templateQuery])

  useEffect(() => {
    if (selectedPage === undefined) { setSelectedSectionId(null); return }
    setSelectedSectionId(current => current !== null && selectedPage.sections.some(section => section.id === current)
      ? current
      : selectedPage.sections[0]?.id ?? null)
  }, [selectedPage])

  useEffect(() => {
    const controller = new AbortController()
    if (assetSession !== undefined || projectPath === undefined || previewStylesheets.length === 0) {
      setPreviewCss('')
      return () => { controller.abort() }
    }
    void Promise.all(previewStylesheets.map(async (stylesheet) => {
      const url = projectAssetUrl(projectPath, stylesheet)
      if (url === null) return ''
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return ''
      return rewriteCssAssetUrls(await response.text(), projectPath, stylesheet)
    })).then((styles) => { if (!controller.signal.aborted) setPreviewCss(styles.filter(Boolean).join('\n')) })
      .catch(() => { if (!controller.signal.aborted) setPreviewCss('') })
    return () => { controller.abort() }
  }, [previewStylesheets, projectPath, assetSession])

  // Close stale selection actions before the new toolbar becomes interactive.
  useLayoutEffect(() => {
    setPreviewVariantId(null); setCompareVariantId(null); setMoreSectionId(null); setRewriteSectionId(null)
  }, [selectedSectionId])

  useLayoutEffect(() => { setMoreSectionId(null); setRewriteSectionId(null) }, [selectedElement?.index])

  useEffect(() => { setCommentPosition(null) }, [selectedElement?.index, selectedElement?.viewportLeft, selectedElement?.viewportTop])

  useEffect(() => {
    setUndoStack([]); setRedoStack([]); setSelectedElement(null); setDesignScope('section'); setReviewMode(null); setReviewDraft('')
    setMarkShapes([]); setMarkRedo([]); setActiveMark(null)
  }, [selectedPageId])

  useEffect(() => {
    if (drawer === null && !exportOpen && moreSectionId === null && reviewMode === null) return
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || exportOpen) return
      setDrawer(null); setLibraryDragging(false); setExportOpen(false); setMoreSectionId(null); setReviewMode(null); setReviewDraft(''); setCommentPosition(null)
    }
    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if ((drawer === 'templates' || drawer === 'elements') && !libraryRef.current?.contains(target)) setDrawer(null)
      if (reviewMode === 'comment' && commentCardRef.current !== null
        && !commentCardRef.current.contains(target)
        && !(target instanceof Element && target.closest('[title="Pin a durable comment to an element"]') !== null)) {
        setReviewMode(null); setReviewDraft('')
      }
    }
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('pointerdown', dismissOnOutsidePointer)
    return () => {
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [drawer, exportOpen, moreSectionId, reviewMode])

  const replacePage = (page: CopyOSPageDocument): void => {
    const next = pagesRef.current.map(item => item.id === page.id ? page : item)
    pagesRef.current = next
    setPages(next)
  }

  const retainDraft = (pageId: string, draft: HtmlRecoveryDraft | undefined): void => {
    const next = { ...htmlDraftsRef.current }
    if (draft) next[pageId] = draft
    else {
      const remaining = Object.fromEntries(Object.entries(next).filter(([id]) => id !== pageId))
      htmlDraftsRef.current = remaining; setHtmlDrafts(remaining); return
    }
    htmlDraftsRef.current = next; setHtmlDrafts(next)
  }

  const runSave = async (operation: (current: () => boolean) => Promise<CopyOSPageDocument>): Promise<CopyOSPageDocument | undefined> => {
    if (saveBusy.current || (selectedPageIdRef.current !== null && htmlDraftsRef.current[selectedPageIdRef.current])) return undefined
    const owner = operationOwner.current
    const current = (): boolean => owner === operationOwner.current
    saveBusy.current = true; pageRequest.current++
    setSaving(true); setSavedState('saving'); setError('')
    try {
      const page = await operation(current)
      if (!current()) return undefined
      replacePage(page); setSavedState('saved'); return page
    }
    catch (saveError: unknown) { if (current()) { setError(errorMessage(saveError)); setSavedState('unsaved') } }
    finally { saveBusy.current = false; if (current()) setSaving(false) }
  }

  const remember = (entry: BuilderHistoryEntry): void => {
    setUndoStack(current => [...current.slice(-39), entry]); setRedoStack([])
  }

  const saveHtmlChanges = async (
    label: string,
    changes: readonly HtmlHistoryChange[],
    record = true,
    retryRevision?: number,
    onAccepted?: (page: CopyOSPageDocument) => void,
  ): Promise<boolean> => {
    if (selectedPage === undefined || changes.length === 0 || saveBusy.current) return false
    if (htmlDraftsRef.current[selectedPage.id] && retryRevision === undefined) {
      setError(t('pageDraftRecoveryHint')); return false
    }
    const expectedRevision = retryRevision ?? selectedPage.revision ?? 0
    if (changes.some(change => selectedPage.sections.find(section => section.id === change.sectionId)
      ?.variants.find(variant => variant.id === change.variantId)?.html !== change.beforeHtml)) {
      setError(t('pageHistoryConflict')); return false
    }
    const owner = operationOwner.current
    const current = (): boolean => owner === operationOwner.current
    const pageId = selectedPage.id
    if (record) retainDraft(pageId, { label, changes, expectedRevision, onAccepted })
    saveBusy.current = true; pageRequest.current++
    setSaving(true); setSavedState('saving'); setError('')
    try {
      const page = await actions.updatePageSectionVariants({
        workspaceId, pageId, expectedRevision,
        changes: changes.map(change => ({ sectionId: change.sectionId, variantId: change.variantId, html: change.afterHtml })),
      })
      if (!current()) { retainDraft(pageId, undefined); return false }
      onAccepted?.(page)
      replacePage(page); retainDraft(pageId, undefined)
      if (record) remember({ kind: 'html', pageId, label, changes })
      setSavedState('saved')
      return true
    } catch (saveError: unknown) {
      if (current()) {
        if (record) retainDraft(pageId, { label, changes, expectedRevision, onAccepted })
        setError(errorMessage(saveError)); setSavedState('unsaved')
      }
      return false
    } finally {
      saveBusy.current = false; if (current()) setSaving(false)
    }
  }

  const createPage = async (draft = pageDraft, openLibrary = false): Promise<void> => {
    if (requestedPageId.current !== undefined) return
    await runSave(async (current) => {
      const page = await actions.createPage({ workspaceId, title: draft.title, ...(draft.slug.trim() === '' ? {} : { slug: draft.slug }) })
      if (!current()) return page
      pagesRef.current = [page, ...pagesRef.current]; selectedPageIdRef.current = page.id
      setPages(pagesRef.current); setSelectedPageId(page.id); setPageDraft(EMPTY_PAGE); setCreateOpen(false); setPhase('ready')
      if (openLibrary) { setInsertIndex(0); setDrawer('templates') }
      setUndoStack([]); setRedoStack([])
      return page
    })
  }

  const addTemplate = async (template: LibrarySectionTemplate, atIndex: number): Promise<void> => {
    if (selectedPage === undefined) return
    await runSave(async (current) => {
      const page = await actions.addPageSection({
        workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        title: template.title, templateId: template.templateId,
        label: t('originalVariation'), html: freshHtmlElementIds(template.html), toIndex: atIndex,
      })
      if (!current()) return page
      const added = page.sections.find(section => !selectedPage.sections.some(previous => previous.id === section.id))
      setSelectedSectionId(added?.id ?? null); setDrawer(null); setTemplateQuery('')
      setUndoStack([]); setRedoStack([])
      return page
    })
  }

  const saveReusableSection = async (): Promise<void> => {
    const variant = reusableTarget?.variants.find(item => item.id === reusableTarget.selectedVariantId)
    if (variant === undefined || saving) return
    setSaving(true); setReusableError('')
    try {
      const html = restoreProjectAssetUrls(`${previewCss === '' ? '' : `<style>${previewCss}</style>`}${variant.html}`, projectPath, assetView)
      const section = await actions.saveReusableSection({ workspaceId, ...reusableDraft, html })
      libraryRequest.current++
      setReusableSections(current => [section, ...current]); setReusableTarget(null)
      setTemplateFamily(section.category); setTemplateQuery(''); setInsertIndex(selectedPage?.sections.length ?? 0); setDrawer('templates')
    } catch (saveError: unknown) { setReusableError(errorMessage(saveError)) }
    finally { setSaving(false) }
  }

  const deleteSelectedElement = async (): Promise<void> => {
    if (selectedSection === undefined || selectedVariant === undefined || selectedElement === null || saving) return
    if (!selectionExists()) return
    const html = deleteElementHtml(selectedVariant.html, selectedElement.index, selectedElement.id)
    if (html === selectedVariant.html) return
    if (await saveHtmlChanges(t('deleteSelectedElement'), [{ sectionId: selectedSection.id,
      variantId: selectedVariant.id, beforeHtml: selectedVariant.html, afterHtml: html }])) setSelectedElement(null)
  }

  const duplicateSection = async (section: CopyOSPageSection): Promise<void> => {
    if (selectedPage === undefined) return
    const selected = section.variants.find(variant => variant.id === section.selectedVariantId)
    if (selected === undefined) return
    const index = selectedPage.sections.findIndex(item => item.id === section.id)
    const page = await runSave(async () => await actions.addPageSection({
      workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
      title: t('builderVisualCopyTitle').replace('{title}', section.title), templateId: section.templateId,
      label: selected.label, html: freshHtmlElementIds(selected.html), toIndex: index + 1,
    }))
    if (page !== undefined) { setUndoStack([]); setRedoStack([]) }
  }

  const moveSection = async (sectionId: string, toIndex: number): Promise<void> => {
    if (selectedPage === undefined) return
    const beforeIndex = selectedPage.sections.findIndex(section => section.id === sectionId)
    const afterIndex = Math.max(0, Math.min(toIndex, selectedPage.sections.length - 1))
    if (beforeIndex < 0) return
    const page = await runSave(async () => await actions.movePageSection({
      workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0, sectionId, toIndex: afterIndex,
    }))
    if (page !== undefined && beforeIndex !== afterIndex) remember({
      kind: 'move', pageId: selectedPage.id, label: t('toolbarMoveSection'), sectionId, beforeIndex, afterIndex,
    })
  }

  const moveSectionToGap = (sectionId: string, gap: number): void => {
    const from = selectedPage?.sections.findIndex(section => section.id === sectionId) ?? -1
    if (from >= 0) void moveSection(sectionId, gap > from ? gap - 1 : gap)
  }

  const renameSection = async (): Promise<void> => {
    if (selectedPage === undefined || renameTarget === null || renameDraft.trim() === '') return
    await runSave(async (current) => {
      const page = await actions.renamePageSection({
        workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        sectionId: renameTarget.id, title: renameDraft.trim(),
      })
      if (!current()) return page
      setRenameTarget(null); setRenameDraft('')
      return page
    })
  }

  const deleteSection = async (): Promise<void> => {
    if (selectedPage === undefined || deleteTarget === null) return
    await runSave(async (current) => {
      const page = await actions.deletePageSection({
        workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        sectionId: deleteTarget.id,
      })
      if (!current()) return page
      setDeleteTarget(null); setSelectedSectionId(null); setMoreSectionId(null)
      setUndoStack([]); setRedoStack([])
      return page
    })
  }

  const commitVariantHtml = async (section: CopyOSPageSection, variant: CopyOSPageSectionVariant, html: string): Promise<void> => {
    if (selectedPage === undefined || html.trim() === '' || html === variant.html) return
    await saveHtmlChanges(`Edit ${section.title}`, [{
      sectionId: section.id, variantId: variant.id, beforeHtml: variant.html, afterHtml: html,
    }])
  }

  const addVariant = async (): Promise<void> => {
    if (selectedPage === undefined || variantTarget === null) return
    await runSave(async (current) => {
      const page = await actions.addPageSectionVariant({ workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        sectionId: variantTarget, ...variantDraft, html: freshHtmlElementIds(variantDraft.html) })
      if (!current()) return page
      setVariantTarget(null); setVariantDraft(EMPTY_VARIANT)
      setUndoStack([]); setRedoStack([])
      return page
    })
  }

  const addElement = async (element: ElementTemplate): Promise<void> => {
    if (selectedPage === undefined || selectedSection === undefined) return
    const variant = selectedSection.variants.find(item => item.id === selectedSection.selectedVariantId)
    if (variant === undefined) return
    const html = appendElementHtml(variant.html, element.html)
    if (await saveHtmlChanges(`Add ${element.title}`, [{
      sectionId: selectedSection.id, variantId: variant.id, beforeHtml: variant.html, afterHtml: html,
    }])) setDrawer(null)
  }

  const moveElementAcrossSections = async (request: ElementMoveRequest): Promise<void> => {
    if (selectedPage === undefined || request.sourceSectionId === request.targetSectionId) return
    const sourceBeforeHtml = selectedPage.sections.find(section => section.id === request.sourceSectionId)
      ?.variants.find(variant => variant.id === request.sourceVariantId)?.html
    if (sourceBeforeHtml === undefined) return
    const sourceHtml = removeElementHtml(request.sourceHtml, request.blockId)
    if (sourceHtml === request.sourceHtml) return
    const targetBeforeHtml = selectedPage.sections.find(section => section.id === request.targetSectionId)
      ?.variants.find(variant => variant.id === request.targetVariantId)?.html
    if (targetBeforeHtml === undefined) return
    const transferred = document.createElement('template'); transferred.innerHTML = request.elementHtml
    const subtreeIds = new Set([...transferred.content.querySelectorAll('[data-copyos-block-id]')]
      .map(element => element.getAttribute('data-copyos-block-id')))
    await saveHtmlChanges('Move element', [{
      sectionId: request.targetSectionId, variantId: request.targetVariantId,
      beforeHtml: targetBeforeHtml, afterHtml: request.targetHtml,
    }, {
      sectionId: request.sourceSectionId, variantId: request.sourceVariantId,
      beforeHtml: sourceBeforeHtml, afterHtml: sourceHtml,
    }], true, undefined, (page) => {
      const selection = selectedElementRef.current
      const owner = resolvePageOwner(page, request.targetSectionId, request.targetVariantId)
      setSelectedSectionId(request.targetSectionId)
      if (owner && owner.section.selectedVariantId === owner.variant.id && selection?.id !== undefined
        && selection.sectionId === request.sourceSectionId && selection.variantId === request.sourceVariantId
        && subtreeIds.has(selection.id)) {
        const content = document.createElement('template'); content.innerHTML = owner.variant.html
        const element = resolveStyleElement(content.content, -1, selection.id)
        setSelectedElement(element ? { ...selection, sectionId: request.targetSectionId, variantId: request.targetVariantId,
          index: styleableElements(content.content).indexOf(element) } : null)
      } else setSelectedElement(null)
    })
  }

  const selectVariant = async (sectionId: string, variantId: string): Promise<void> => {
    if (selectedPage === undefined) return
    const page = await runSave(async () => await actions.selectPageSectionVariant({
      workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0, sectionId, variantId,
    }))
    if (page !== undefined) { setUndoStack([]); setRedoStack([]) }
  }

  const exportPage = async (format: 'html' | 'copy' | 'json' | 'vercel'): Promise<void> => {
    if (selectedPage === undefined) return
    setError(''); setExportPath(''); setExportOpen(false)
    try { setExportPath((await actions.exportPage({ workspaceId, pageId: selectedPage.id, format })).path) }
    catch (exportError: unknown) { setError(errorMessage(exportError)) }
  }

  const openTemplates = (index: number): void => {
    setInsertIndex(index); setTemplateQuery(''); setDrawer('templates'); void loadReusableSections()
  }

  const handleCanvasDrop = (kind: 'section' | 'template', id: string, index: number): void => {
    if (kind === 'template') {
      const template = libraryTemplates.find(item => item.id === id)
      if (template !== undefined) void addTemplate(template, index)
      return
    }
    void moveSection(id, index)
  }

  const changeSectionDesign = async (
    property: 'surface' | 'spacing' | 'alignment',
    value: SectionSurface | SectionSpacing | SectionAlignment,
  ): Promise<void> => {
    if (selectedSection === undefined) return
    const variant = selectedSection.variants.find(item => item.id === selectedSection.selectedVariantId)
    if (variant === undefined) return
    if (property === 'spacing' && currentSpacing?.targetId !== undefined) {
      const template = document.createElement('template'); template.innerHTML = variant.html
      if (!resolvePageElement(template.content, currentSpacing.targetId)) { setError(t('pageElementTargetMissing')); return }
    }
    const html = updateSectionDesign(variant.html, property, value, spacingEdge, currentSpacing?.targetIndex, currentSpacing?.targetId)
    if (html === variant.html) return
    await saveHtmlChanges(`Change ${selectedSection.title} design`, [{
      sectionId: selectedSection.id, variantId: variant.id, beforeHtml: variant.html, afterHtml: html,
    }])
  }

  const changeElementDesign = async (property: ElementDesignProperty, value: string): Promise<void> => {
    if (selectedSection === undefined || selectedVariant === undefined || selectedElement === null) return
    if (!selectionExists()) return
    const html = updateElementDesign(selectedVariant.html, selectedElement.index, property, value, selectedElement.id)
    if (html === selectedVariant.html) return
    await saveHtmlChanges(`Style ${selectedElement.label}`, [{
      sectionId: selectedSection.id, variantId: selectedVariant.id,
      beforeHtml: selectedVariant.html, afterHtml: html,
    }])
  }

  const addComment = async (): Promise<void> => {
    if (selectedPage === undefined || selectedSection === undefined || selectedVariant === undefined
      || selectedElement === null || reviewDraft.trim() === '') return
    if (!selectionExists()) return
    const page = await runSave(async () => await actions.addPageComment({
      workspaceId,
      pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
      sectionId: selectedSection.id,
      variantId: selectedVariant.id,
      elementIndex: selectedElement.index,
      ...(selectedElement.id === undefined ? {} : { elementId: selectedElement.id }),
      elementLabel: selectedElement.label,
      body: reviewDraft.trim(),
    }))
    if (page !== undefined) { setReviewDraft(''); setReviewMode(null) }
  }

  const setCommentStatus = async (commentId: string, status: 'open' | 'resolved'): Promise<void> => {
    if (selectedPage === undefined) return
    await runSave(async () => await actions.setPageCommentStatus({
      workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0, commentId, status,
    }))
  }

  const stageMarkedPrompt = async (draft = false): Promise<void> => {
    if (selectedPage === undefined || selectedSection === undefined) return
    if (selectedElement !== null && !selectionExists()) return
    const dimensions = selectedElement === null ? '' : `${Math.round(selectedElement.width)} × ${Math.round(selectedElement.height)} px`
    const markSummary = markShapes.length === 0 ? '' : t('builderVisualMarkupSummary').replace('{boxes}', String(markShapes.filter(shape => shape.kind === 'box').length))
      .replace('{strokes}', String(markShapes.filter(shape => shape.kind === 'pen').length))
      .replace('{notes}', String(markShapes.filter(shape => shape.kind === 'text').length))
      .replace('{images}', String(markShapes.filter(shape => shape.kind === 'image').length))
    const bounds = markCanvasRef.current?.getBoundingClientRect()
    const annotations = markShapes.map(shape => shape.kind === 'image'
      ? { kind: shape.kind, sectionId: shape.sectionId, x: shape.x, y: shape.y, width: 240, height: 180, imageAttached: false }
      : shape)
    const markedSections = selectedPage.sections.filter(section => markShapes.some(shape => shape.sectionId === section.id))
    const note = [
      selectedElement === null ? '' : `Selected ${selectedElement.tag.toUpperCase()} element “${selectedElement.label}” (${dimensions}).`,
      `Page: ${selectedPage.id}. Sections: ${(markedSections.length ? markedSections : [selectedSection]).map(section => `${section.title} (${section.id})`).join(", ")}.`,
      markSummary,
      annotations.length === 0 ? '' : `Markup coordinates in CSS pixels from the Builder overlay origin (viewport ${Math.round(bounds?.width ?? 0)} × ${Math.round(bounds?.height ?? 0)}): ${JSON.stringify(annotations)}`,
      markShapes.some(shape => shape.kind === 'image') ? 'Image overlays were not attached; ask for the source image before using it.' : '',
      reviewDraft.trim(),
    ].filter(Boolean).join(' ')
    const owner = operationOwner.current
    if (await stageSectionPrompt('customize', selectedPage.title,
      markedSections.length ? markedSections.map(section => section.title).join(' + ')
        : selectedElement === null ? selectedSection.title : `${selectedSection.title} → ${selectedElement.label}`, note, draft)
      && owner === operationOwner.current) closeReviewMode()
  }

  const stageCommentPrompt = async (): Promise<void> => {
    if (selectedPage === undefined || selectedSection === undefined || selectedElement === null || reviewDraft.trim() === '') return
    if (!selectionExists()) return
    const note = `Comment on ${selectedElement.tag.toUpperCase()} “${selectedElement.label}”: ${reviewDraft.trim()}`
    const owner = operationOwner.current
    if (await stageSectionPrompt('customize', selectedPage.title, `${selectedSection.title} → ${selectedElement.label}`, note)
      && owner === operationOwner.current) closeReviewMode()
  }

  const closeReviewMode = (): void => {
    setReviewMode(null); setReviewDraft(''); setActiveMark(null); setMarkShapes([]); setMarkRedo([]); setCommentPosition(null)
  }

  const openReviewMode = (next: 'comment' | 'mark'): void => {
    if (agentPendingRef.current) return
    setReviewMode(current => current === next || (next === 'comment' && current === 'place-comment')
      ? null : next === 'comment' ? 'place-comment' : next)
    setPreviewVariantId(null)
    setReviewDraft(''); setDrawer(null); setMoreSectionId(null); setMarkShapes([]); setMarkRedo([]); setActiveMark(null); setCommentPosition(null)
  }

  const beginMark = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || agentPendingRef.current) return
    const section = canvasScroll === null ? undefined : [...canvasScroll.querySelectorAll<HTMLElement>(`article.${css.visualSection}`)]
      .find(element => {
        const box = element.getBoundingClientRect()
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
      })
    if (section?.dataset.copyosSectionId === undefined) return
    if (section.dataset.copyosSectionId !== selectedSectionId) { setSelectedSectionId(section.dataset.copyosSectionId); setSelectedElement(null) }
    const sectionId = section.dataset.copyosSectionId
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const id = `mark-${Date.now()}-${markShapes.length}`
    if (markTool === 'text') {
      const text = reviewDraft.trim() || t('builderVisualTextNote')
      setMarkShapes(current => [...current, { id, sectionId, kind: 'text', ...point, text }])
      setMarkRedo([])
      return
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    setActiveMark(markTool === 'box'
      ? { id, sectionId, kind: 'box', ...point, width: 0, height: 0 }
      : { id, sectionId, kind: 'pen', points: [point] })
  }

  const moveMark = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    setActiveMark((current) => {
      if (current === null) return null
      if (current.kind === 'box') return { ...current, width: point.x - current.x, height: point.y - current.y }
      if (current.kind === 'pen') return { ...current, points: [...current.points, point] }
      return current
    })
  }

  const finishMark = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activeMark === null) return
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const keep = activeMark.kind === 'box'
      ? Math.abs(activeMark.width) > 4 && Math.abs(activeMark.height) > 4
      : activeMark.kind !== 'pen' || activeMark.points.length > 1
    if (keep) setMarkShapes(current => [...current, activeMark])
    setMarkRedo([]); setActiveMark(null)
  }

  const addMarkImage = (file: File | undefined): void => {
    if (file === undefined || !file.type.startsWith('image/')) return
    const sectionId = selectedSectionId, owner = operationOwner.current
    if (sectionId === null) return
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string' || owner !== operationOwner.current) return
      const bounds = markCanvasRef.current?.getBoundingClientRect()
      if (bounds === undefined) return
      setMarkShapes(current => [...current, {
        id: `mark-${Date.now()}-${current.length}`, sectionId, kind: 'image', x: Math.max(0, bounds.width / 2 - 120),
        y: Math.max(0, bounds.height / 2 - 90), src: reader.result as string, name: file.name,
      }])
      setMarkRedo([])
    })
    reader.readAsDataURL(file)
  }

  const beginCommentDrag = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const card = commentCardRef.current
    if (card === null) return
    event.preventDefault()
    const rect = card.getBoundingClientRect()
    const origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    const move = (moveEvent: PointerEvent): void => {
      setCommentPosition({
        left: Math.min(Math.max(8, origin.left + moveEvent.clientX - origin.x), Math.max(8, window.innerWidth - rect.width - 8)),
        top: Math.min(Math.max(8, origin.top + moveEvent.clientY - origin.y), Math.max(8, window.innerHeight - rect.height - 8)),
      })
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true })
  }

  const replayHistory = async (direction: 'undo' | 'redo'): Promise<void> => {
    const source = direction === 'undo' ? undoStack : redoStack
    const entry = source.at(-1)
    if (entry === undefined || selectedPage === undefined || entry.pageId !== selectedPage.id || saving) return
    let applied = false
    if (entry.kind === 'html') {
      const changes = entry.changes.map(change => direction === 'undo'
        ? { ...change, beforeHtml: change.afterHtml, afterHtml: change.beforeHtml }
        : change)
      applied = await saveHtmlChanges(`${direction === 'undo' ? 'Undo' : 'Redo'} ${entry.label}`, changes, false)
    } else {
      const expectedIndex = direction === 'undo' ? entry.afterIndex : entry.beforeIndex
      if (selectedPage.sections.findIndex(section => section.id === entry.sectionId) !== expectedIndex) {
        setError(t('pageHistoryConflict')); return
      }
      const toIndex = direction === 'undo' ? entry.beforeIndex : entry.afterIndex
      applied = (await runSave(async () => await actions.movePageSection({
        workspaceId, pageId: entry.pageId, expectedRevision: selectedPage.revision ?? 0,
        sectionId: entry.sectionId, toIndex,
      }))) !== undefined
    }
    if (!applied) return
    if (direction === 'undo') {
      setUndoStack(current => current.slice(0, -1)); setRedoStack(current => [...current, entry])
    } else {
      setRedoStack(current => current.slice(0, -1)); setUndoStack(current => [...current, entry])
    }
  }

  const handleBuilderKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
    event.preventDefault()
    void replayHistory(event.shiftKey ? 'redo' : 'undo')
  }

  const stageSectionPrompt = async (
    intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string, draft = false,
  ): Promise<boolean> => {
    setChatNotice(false); setShopifyExportStarted(false)
    if (agentPendingRef.current || pageId !== undefined && returnBlocked()) {
      setError(t('canvasReturnPending')); return false
    }
    const handoff = draft ? onStagePromptSection : onPromptSection
    if (handoff === undefined) { setError(t('builderAgentUnavailable')); return false }
    const owner = operationOwner.current
    const current = (): boolean => operationOwner.current === owner
    agentPendingRef.current = true; setAgentPending(true); pageRequest.current++; setError('')
    try {
      const pending = note === undefined ? handoff(intent, pageTitle, sectionTitle)
        : handoff(intent, pageTitle, sectionTitle, note)
      if (pending !== undefined) await pending
      if (!current()) return false
      setShopifyExportStarted(intent === 'export-shopify'); setChatNotice(true)
      return true
    } catch (handoffError: unknown) {
      if (current()) setError(errorMessage(handoffError))
      return false
    } finally { agentPendingRef.current = false; setAgentPending(false) }
  }

  const returnBlocked = (): boolean => phase === 'loading' || saveBusy.current || saving || agentPendingRef.current || hasDirtyFrames()
    || Object.keys(htmlDraftsRef.current).length > 0
    || phase === 'ready' && requestedPageId.current !== undefined && selectedPageIdRef.current !== requestedPageId.current
  const navigationReady = phase === 'ready' && !returnBlocked()
  useEffect(() => { onNavigationReady?.(navigationReady) }, [onNavigationReady, navigationReady])
  useEffect(() => () => { onNavigationReady?.(false) }, [onNavigationReady])
  useEffect(() => {
    if (!openPageRequest || !navigationReady || handledNavigation.current === openPageRequest.requestId
      || pageId !== undefined && pageId !== openPageRequest.pageId) return
    if (!pagesRef.current.some(page => page.id === openPageRequest.pageId)) {
      if (navigationLookup.current !== openPageRequest.requestId) {
        navigationLookup.current = openPageRequest.requestId; void load(true)
      }
      return
    }
    handledNavigation.current = openPageRequest.requestId
    choosePage(openPageRequest.pageId); setSelectedSectionId(null); setSelectedElement(null)
  }, [openPageRequest, navigationReady, pageId, pages, load])
  const managePage = async (kind: 'clone' | 'delete' | 'restore', page: CopyOSPageDocument): Promise<void> => {
    if (returnBlocked()) return
    const action = kind === 'clone' ? actions.clonePage : kind === 'delete' ? actions.deletePage : actions.restorePage
    if (!action) return
    const owner = operationOwner.current
    saveBusy.current = true; setSaving(true); setError(''); pageRequest.current++
    try {
      const result = await action({workspaceId,pageId:page.id,expectedRevision:page.revision ?? 0})
      if (owner !== operationOwner.current) return
      saveBusy.current = false; setSaving(false); setDeletePageTarget(null)
      if (kind === 'delete') {
        setDeletedPage({page:result,workspaceId})
        pagesRef.current = pagesRef.current.filter(item => item.id !== page.id); setPages(pagesRef.current)
        choosePage(pagesRef.current[0]?.id ?? '')
      } else {
        pagesRef.current = [result, ...pagesRef.current.filter(item => item.id !== result.id)]; setPages(pagesRef.current); choosePage(result.id)
        if (kind === 'restore') setDeletedPage(null)
      }
    } catch (cause: unknown) { if (owner === operationOwner.current) setError(errorMessage(cause)) }
    finally { saveBusy.current = false; setSaving(false) }
  }
  const renderDeletedPage = (): ReactNode => deletedPage?.workspaceId === workspaceId ? <div role="status">
    {t('builderPageDeleted')} <ChromeButton variant="ghost" size="sm" disabled={returnBlocked()} onClick={() => {void managePage('restore',deletedPage.page)}}>{t('builderRestorePage')}</ChromeButton>
  </div> : null
  const renderReturn = (): ReactNode => onReturn === undefined ? null : <>
    <ChromeButton variant="outline" size="sm" disabled={returnBlocked()} onClick={() => { if (!returnBlocked()) onReturn(selectedPageIdRef.current) }}>{t('returnToCanvas')}</ChromeButton>
    {returnBlocked() ? <p role="status">{t('canvasReturnPending')}</p> : null}
  </>
  if (phase === 'loading') return <div className={css.builderState}>{renderReturn()}<p>{t('pagesLoading')}</p></div>
  const recoveryDraft = selectedPage === undefined ? undefined : htmlDrafts[selectedPage.id]

  if (phase === 'error') return <div className={css.builderState}>{renderReturn()}<p>{t('assetOperationFailed')} {error}</p><Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button></div>
  if (pageId !== undefined && selectedPage === undefined) return <div className={css.builderState}>
    {renderReturn()}<p role="alert">{t('canvasBuilderPageMissing')}</p>
    <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button>
  </div>
  if (pages.length === 0) {
    return <div className={css.builderEmpty}>{renderReturn()}{renderDeletedPage()}<Button variant="primary" onClick={() => {
      void createPage({ title: t('untitledPage'), slug: '' }, true)
    }}>{t('addSection')}</Button>{renderCreatePageModal()}</div>
  }

  return (
    <section className={css.visualBuilder} onKeyDown={handleBuilderKeyDown}>
      {renderDeletedPage()}
      <Modal closeLabel={t('cancel')} open={deletePageTarget !== null} onClose={() => {if (!saving) setDeletePageTarget(null)}} title={t('builderDeletePageTitle')}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => setDeletePageTarget(null)}>{t('cancel')}</Button>
          <Button variant="primary" disabled={saving || returnBlocked()} onClick={() => {if (deletePageTarget) void managePage('delete',deletePageTarget)}}>{t('builderDeletePage')}</Button></div>}>
        <p>{deletePageTarget?.title}</p><p>{t('builderDeletePageDescription')}</p>
      </Modal>
      <nav className={css.builderToolbar} aria-label={t('builderVisualBuilderViews')}>
        <div className={css.builderDocumentBar}>
          <div className={css.builderContext}>
            {pageId === undefined ? null : renderReturn()}
            <PagePicker label={t('page')} value={selectedPageId ?? ''}
              options={pages.map(page=>({value:page.id,label:page.title}))}
              disabled={pageId !== undefined || returnBlocked()}
              onValueChange={value=>{if(!returnBlocked() && requestedPageId.current===undefined)choosePage(value)}}
              newLabel={t('newPage')} importLabel={t('builderImportPage')}
              actionsDisabled={returnBlocked()}
              onNew={pageId === undefined ? ()=>{if(!returnBlocked())setCreateOpen(true)} : undefined}
              onImport={pageId !== undefined || onReturn === undefined ? undefined : ()=>{if(!returnBlocked())onReturn(selectedPageIdRef.current)}}
              actions={[
                ...(actions.clonePage ? [{label:t('builderClonePage'),disabled:returnBlocked(),onSelect:()=>{if(selectedPage)void managePage('clone',selectedPage)}}] : []),
                ...(actions.deletePage ? [{label:t('builderDeletePage'),disabled:returnBlocked(),danger:true,onSelect:()=>{if(selectedPage && !returnBlocked())setDeletePageTarget(selectedPage)}}] : []),
              ]}/>
            <span className={css.builderSaveState} data-saving={savedState === 'saving'}>
              {savedState === 'saving' ? t('savingAsset') : savedState === 'unsaved' ? t('designerUnsaved') : t('saved')}
            </span>
            <button type="button" className={css.builderRefreshPages} aria-label={t('builderVisualRefreshPages')} title={t('builderVisualRefreshPages')}
              disabled={returnBlocked()} onClick={() => { if (!returnBlocked()) void load(true) }}>↻</button>
          </div>
          <div className={css.builderHistoryControls} aria-label={t('builderVisualCanvasHistory')}>
            <button type="button" aria-label={t('builderVisualUndoCanvasChange')} title={undoStack.at(-1)?.label ?? t('builderVisualNothingToUndo')}
              disabled={saving || undoStack.length === 0} onClick={() => { void replayHistory('undo') }}>↶</button>
            <button type="button" aria-label={t('builderVisualRedoCanvasChange')} title={redoStack.at(-1)?.label ?? t('builderVisualNothingToRedo')}
              disabled={saving || redoStack.length === 0} onClick={() => { void replayHistory('redo') }}>↷</button>
          </div>
          <span className={css.builderToolbarSpacer} />
          <div className={css.builderHostExport}>
          <ActionMenu open={exportOpen} onOpenChange={setExportOpen}
            label={t('designerExport')} ariaLabel={t('builderVisualExportPage')}
            groups={[
              { label: t('builderVisualDownload'), items: [
                { label: t('builderVisualStandaloneHTML'), onSelect: () => { void exportPage('html') } },
              ] },
              { label: t('builderVisualPlatforms'), items: [
                { label: t('shopifyLiquidExport'), disabled: onPromptSection === undefined, onSelect: () => {
                  if (selectedPage === undefined) return
                  setExportOpen(false); void stageSectionPrompt('export-shopify', selectedPage.title, selectedPage.id)
                } },
                { label: t('builderVisualVercelProject'), onSelect: () => { void exportPage('vercel') } },
              ] },
              { label: t('builderVisualCopyData'), items: [
                { label: t('builderVisualPageCopy'), onSelect: () => { void exportPage('copy') } },
                { label: t('builderVisualSectionJSON'), onSelect: () => { void exportPage('json') } },
              ] },
            ]} />
          </div>
        </div>
        <div className={css.builderCanvasBar}>
          <div className={css.builderCanvasTools}>
            <div className={css.builderSegmented}>
              <button type="button" data-active={mode === 'build'} onClick={() => { setMode('build') }}>{t('builderVisualBuild')}</button>
              <button type="button" data-active={mode === 'preview'} onClick={() => { setMode('preview'); setDrawer(null) }}>{t('designerPreview')}</button>
            </div>
            <span className={css.toolbarDivider} aria-hidden="true" />
            <label className={css.builderViewportPicker}>
              <select aria-label={t('builderViewport')} value={breakpoint}
                onChange={(event) => { setBreakpoint(event.currentTarget.value as 'desktop' | 'mobile') }}>
                <option value="desktop">{t('builderVisualDesktop')}</option><option value="mobile">{t('canvasConversionMobile')}</option>
              </select>
            </label>
            <Tooltip label={t('builderStructure')} portal side="bottom" delayMs={400}>
              <button type="button" aria-label={t('builderStructure')} data-active={drawer === 'structure'}
                onClick={() => { setDrawer(current => current === 'structure' ? null : 'structure') }}><IconFlatListOutlineRegular size={16} /></button>
            </Tooltip>
          </div>
          <span className={css.builderToolbarSpacer} />
          <div className={css.builderReviewTools} aria-label={t('designerHeaderTools')} hidden={mode !== 'build'}>
            <ChromeButton variant={drawer === 'templates' ? 'subtle' : 'ghost'} size="sm" aria-expanded={drawer === 'templates'}
              onClick={() => { openTemplates(selectedPage?.sections.length ?? 0) }}>
              <ChromePlusIcon size={16} />{t('addSection')}
            </ChromeButton>
            <ChromeButton variant={drawer === 'elements' ? 'subtle' : 'ghost'} size="sm" aria-expanded={drawer === 'elements'} disabled={selectedSection === undefined}
              onClick={() => { setDrawer('elements') }}>
              <ChromePlusIcon size={16} />{t('addElement')}
            </ChromeButton>
            <ChromeButton variant={drawer === 'design' ? 'subtle' : 'ghost'} size="sm" aria-expanded={drawer === 'design'} disabled={selectedSection === undefined}
              onClick={() => { setDesignScope(selectedElement === null ? 'section' : 'element'); setDrawer('design') }}>
              {t('toolbarStyle')}
            </ChromeButton>
            <span className={css.toolbarDivider} aria-hidden="true" />
            {mode === 'build' ? <>
              <Tooltip label={t('builderComment')} portal side="bottom" delayMs={400}>
                <button type="button" aria-label={t('builderComment')} data-active={reviewMode === 'comment' || reviewMode === 'place-comment'}
                  aria-pressed={reviewMode === 'comment' || reviewMode === 'place-comment'}
                  title={t('builderVisualPinADurableCommentToAnElement')} onClick={() => { openReviewMode('comment') }}><IconNewChatOutlineRegular size={16} /></button>
              </Tooltip>
              <Tooltip label={t('builderMark')} portal side="bottom" delayMs={400}>
                <button type="button" aria-label={t('builderMark')} data-active={reviewMode === 'mark'} aria-pressed={reviewMode === 'mark'}
                  title={t('builderVisualMarkAnElementAndAddVisualDirectionTo')} onClick={() => { openReviewMode('mark') }}><IconListPenOutlineRegular size={16} /></button>
              </Tooltip>
              <Tooltip label={t('builderComments')} portal side="bottom" delayMs={400}>
                <button type="button" aria-label={t('builderComments')} data-active={drawer === 'comments'} title={t('builderVisualReviewPageComments')}
                  onClick={() => { setReviewMode(null); setDrawer(current => current === 'comments' ? null : 'comments') }}>
                  <span>{(selectedPage?.comments ?? []).filter(comment => comment.status === 'open').length}</span>
                </button>
              </Tooltip>
            </> : null}
          </div>
        </div>
      </nav>

      {error === '' ? null : <p className={css.builderError} role="alert">{t('assetOperationFailed')} {error}</p>}
      {assetView === undefined || assetView.errors.length === 0 ? null : <p className={css.builderError} role="status">{t('assetOperationFailed')} {assetView.errors.slice(0, 5).join('; ')}</p>}
      {fontErrors.size === 0 ? null : <p className={css.builderError} role="status">{t('assetOperationFailed')} {[...fontErrors.values()].slice(0, 5).join('; ')}</p>}
      {recoveryDraft && selectedPage ? <section className={recoveryCss.panel} aria-label={t('pageDraftRecovery')}>
        <strong>{t('pageDraftRecovery')}</strong><p>{t('pageDraftRecoveryHint')}</p>
        {recoveryDraft.changes.map((change, index) => <label key={`${change.sectionId}:${change.variantId}`}>
          {selectedPage.sections.find(section => section.id === change.sectionId)?.title ?? change.sectionId}
          <textarea aria-label={`${t('pageDraftHtml')} ${index + 1}`} value={change.afterHtml} disabled={saving}
            onChange={(event) => { retainDraft(selectedPage.id, { ...recoveryDraft, changes: recoveryDraft.changes.map((item, position) =>
              position === index ? { ...item, afterHtml: event.target.value } : item) }) }} />
        </label>)}
        <div className={recoveryCss.actions}>
          <Button variant="outline" disabled={saving} onClick={() => {
            void saveHtmlChanges(recoveryDraft.label, recoveryDraft.changes, true, recoveryDraft.expectedRevision, recoveryDraft.onAccepted)
          }}>{t('pageDraftRetry')}</Button>
          <Button variant="outline" disabled={saving} onClick={() => {
            retainDraft(selectedPage.id, undefined); setSavedState('saved'); setUndoStack([]); setRedoStack([]); void load()
          }}>{t('pageDraftDiscard')}</Button>
        </div>
      </section> : null}
      {exportPath === '' ? null : <p className={css.builderSuccess} role="status">{t('exportedTo')} {exportPath}</p>}
      {chatNotice ? <div className={css.builderChatNotice} role="status">
        <span>✦</span><p>{t(shopifyExportStarted ? 'shopifyExportStarted' : 'chatPromptReady')}</p>
        <button type="button" aria-label={t('builderVisualDismissChatPromptNotice')} onClick={() => { setChatNotice(false) }}>×</button>
      </div> : null}
      {reviewMode === 'place-comment' ? <div className={css.reviewModeHint} role="status">
        <span>▣</span>
        <p>{t('commentPlacementHint')}</p>
        <button type="button" onClick={closeReviewMode}>{t('cancel')}</button>
      </div> : null}

      <div className={css.visualBuilderBody}>
        <div ref={setCanvasScroll} className={css.builderCanvasScroll} data-comment-placement={reviewMode === 'place-comment'}
          style={reviewMode === 'place-comment' ? { cursor: COMMENT_CURSOR } : undefined}>
          <div className={css.builderPageFrame} data-breakpoint={breakpoint} data-preview={mode === 'preview'}
            style={breakpoint === 'desktop' && desktopWidth !== undefined && canvasWidth > 0 && canvasWidth < desktopWidth ? {
              '--builder-frame-width': `${desktopWidth}px`, '--builder-frame-zoom': String(canvasWidth / desktopWidth),
            } as CSSProperties : undefined}>
            {mode === 'preview' && selectedPage !== undefined
              ? <FullPagePreviewFrame t={t} page={selectedPage} {...(projectPath === undefined ? {} : { projectPath })}
                previewCss={previewCss} assets={assetView} reportFontErrors={reportFontErrors} />
              : null}
            {selectedPage?.sections.length === 0 && mode === 'build' ? <div className={css.builderBlankCanvas}>
              <button type="button" onClick={() => { openTemplates(0) }}>＋ {t('addSection')}</button>
            </div> : null}
            {mode === 'build' ? selectedPage?.sections.map((section, index) => {
              const variant = section.variants.find(item => item.id === section.selectedVariantId)
              return (
                <div key={section.id}>
                  <InsertionZone t={t} index={index} active={drawer === 'templates' && insertIndex === index}
                    onOpen={() => { openTemplates(index) }}
                    onDrop={(kind, id) => { handleCanvasDrop(kind, id, index) }} />
                  <article ref={section.id === selectedSectionId ? selectedSectionRef : undefined}
                    className={css.visualSection} data-copyos-section-id={section.id} data-selected={section.id === selectedSectionId}
                    onClick={(event) => {
                      setSelectedSectionId(section.id); setPreviewVariantId(null)
                      if (!(event.target instanceof Element) || event.target.closest('[role=toolbar]') === null) {
                        setSelectedElement(null); setDesignScope('section')
                      }
                    }}>
                    {section.id === selectedSectionId && reviewMode !== 'place-comment' ? (
                      <SelectionToolbar sectionRef={selectedSectionRef} selection={selectedElement} label={t('builderVisualSectionActions').replace('{title}', section.title)}>
                        <Menu portal compact open={rewriteSectionId === section.id} onClose={() => { setRewriteSectionId(null) }}
                          anchor={<button type="button" className={css.toolbarRewrite}
                            aria-haspopup="menu" aria-expanded={rewriteSectionId === section.id}
                            onClick={() => {
                              setMoreSectionId(null); setRewriteSectionId(current => current === section.id ? null : section.id)
                            }}>
                            <IconSparkleRegular size={14} />{t('toolbarRewrite')}<IconChevronDownOutlineRegular size={10} />
                          </button>}>
                          <MenuItemButton disabled={agentPending} onSelect={() => {
                            void stageSectionPrompt('rewrite', selectedPage.title, section.title).then((accepted) => { if (accepted) setRewriteSectionId(null) })
                          }}>{t('toolbarRewrite')}</MenuItemButton>
                          <MenuItemButton disabled={agentPending} onSelect={() => {
                            void stageSectionPrompt('variations', selectedPage.title, section.title).then((accepted) => {
                              if (accepted) { setRewriteSectionId(null); setDrawer('variations') }
                            })
                          }}>{t('toolbarGenerateVariations')}</MenuItemButton>
                          <MenuItemButton onSelect={() => { setRewriteSectionId(null); setDrawer('variations') }}>{t('toolbarViewVariations')}</MenuItemButton>
                        </Menu>
                        <span className={css.toolbarDivider} aria-hidden="true" />
                        <Tooltip label={t('toolbarAddElement')} portal side="top" delayMs={400}>
                          <button type="button" aria-label={t('toolbarAddElement')} onClick={() => { setDrawer('elements') }}>
                            <IconPlusOutlineRegular size={14} /><span className={css.toolbarActionLabel}>{t('toolbarAdd')}</span>
                          </button>
                        </Tooltip>
                        <Tooltip label={t('toolbarStyle')} portal side="top" delayMs={400}>
                          <button type="button" aria-label={t('toolbarStyle')} onClick={() => {
                            setDesignScope(selectedElement === null ? 'section' : 'element'); setDrawer('design')
                          }}><IconEditOutlineRegular size={14} /><span className={css.toolbarActionLabel}>{t('toolbarStyle')}</span></button>
                        </Tooltip>
                        <Tooltip label={t('toolbarMoveSection')} portal side="top" delayMs={400}>
                          <button type="button" aria-label={t('builderVisualMoveSectionTitle').replace('{title}', section.title)} draggable
                            onClick={() => { setDrawer('structure') }}
                            onDragStart={(event) => {
                              event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData(SECTION_DRAG_TYPE, section.id)
                            }}
                            onKeyDown={(event) => {
                              if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                              event.preventDefault(); void moveSection(section.id, index + (event.key === 'ArrowUp' ? -1 : 1))
                            }}><span aria-hidden="true">⠿</span><span className={css.toolbarActionLabel}>{t('toolbarMove')}</span></button>
                        </Tooltip>
                        <Menu portal compact align="end" open={moreSectionId === section.id} onClose={() => { setMoreSectionId(null) }}
                          anchor={<button type="button" aria-label={t('builderVisualMoreSectionActions').replace('{title}', section.title)}
                            aria-haspopup="menu" aria-expanded={moreSectionId === section.id}
                            onClick={() => {
                              setRewriteSectionId(null); setMoreSectionId(current => current === section.id ? null : section.id)
                            }}>
                            <IconEllipsisOutlineRegular size={16} /></button>}>
                          <MenuItemButton onSelect={() => { setDrawer('structure'); setMoreSectionId(null) }}>{t('toolbarReorderSection')}</MenuItemButton>
                          <MenuItemButton disabled={saving} onSelect={() => { void duplicateSection(section); setMoreSectionId(null) }}>{t('toolbarDuplicateSection')}</MenuItemButton>
                          <MenuItemButton disabled={saving} onSelect={() => {
                            setReusableError(''); setReusableTarget(section); setReusableDraft({ title: section.title, category: 'Reusable', description: '' }); setMoreSectionId(null)
                          }}>{t('saveReusableSection')}</MenuItemButton>
                          <MenuItemButton onSelect={() => { setRenameTarget(section); setRenameDraft(section.title); setMoreSectionId(null) }}>{t('toolbarRenameSection')}</MenuItemButton>
                          <MenuItemButton danger onSelect={() => { setDeleteTarget(section); setMoreSectionId(null) }}>{t('toolbarDeleteSection')}</MenuItemButton>
                        </Menu>
                        {selectedElement !== null ? <>
                          <span className={css.toolbarDivider} aria-hidden="true" />
                          <Tooltip label={t('deleteSelectedElement')} portal side="top" delayMs={400}>
                            <button type="button" className={css.toolbarDelete} aria-label={t('deleteSelectedElement')} disabled={saving}
                              onClick={() => { void deleteSelectedElement() }}><IconTrashOutlineRegular size={16} /></button>
                          </Tooltip>
                        </> : null}
                      </SelectionToolbar>
                    ) : null}
                    {(() => {
                      const preview = section.id === selectedSectionId && previewVariantId !== null
                        ? section.variants.find(item => item.id === previewVariantId)
                        : undefined
                      const visibleVariant = preview ?? variant
                      return visibleVariant === undefined ? null : (
                        <EditableSectionFrame t={t} key={`${visibleVariant.id}:${mode}`} title={section.title} html={visibleVariant.html}
                          {...(projectPath === undefined ? {} : { projectPath })} previewCss={previewCss} assets={assetView} reportFontErrors={reportFontErrors}
                          sectionId={section.id} variantId={visibleVariant.id}
                          editable={preview === undefined}
                          commentPlacement={reviewMode === 'place-comment'} onCancelCommentPlacement={closeReviewMode}
                          selectedElementId={section.id === selectedSectionId ? selectedElement?.id : undefined}
                          selectedElementIndex={section.id === selectedSectionId ? selectedElement?.index ?? null : null}
                          onMeasureSpacing={(measurement) => {
                            setSectionSpacing((current) => {
                              const previous = current[section.id]
                              if (previous?.variantId === measurement.variantId && previous.targetIndex === measurement.targetIndex
                                && previous.targetId === measurement.targetId
                                && previous.paddingTop === measurement.paddingTop
                                && previous.paddingBottom === measurement.paddingBottom) return current
                              return { ...current, [section.id]: measurement }
                            })
                          }}
                          onSelect={() => {
                            if (selectedSectionId !== section.id) setSelectedElement(null)
                            setSelectedSectionId(section.id); setMoreSectionId(null); setExportOpen(false)
                          }}
                          onSelectElement={(element) => {
                            setSelectedSectionId(section.id)
                            setSelectedElement({ ...element, sectionId: section.id, variantId: visibleVariant.id })
                            if (reviewMode === 'place-comment') setReviewMode('comment')
                            if (drawer === 'design') setDesignScope('element')
                          }}
                          onDirty={(dirty) => {
                            const key = `${selectedPage.id}:${section.id}:${visibleVariant.id}`
                            if (dirty) {
                              if (!dirtyFrames.current.has(key)) { pageRequest.current++; dirtyFrames.current.add(key) }
                              setSavedState('unsaved')
                            } else {
                              dirtyFrames.current.delete(key)
                              if (!hasDirtyFrames() && !saveBusy.current && !htmlDraftsRef.current[selectedPage.id]) setSavedState('saved')
                            }
                          }}
                          onCommit={(html) => { void commitVariantHtml(section, visibleVariant, html) }}
                          onMoveAcrossSections={(request) => { void moveElementAcrossSections(request) }} />)
                    })()}
                    {section.id === selectedSectionId ? (
                      <div className={css.builderVariationBar}>
                        {section.variants.map(item => <button key={item.id} type="button" data-active={item.id === section.selectedVariantId}
                          onClick={() => { void selectVariant(section.id, item.id) }}>{item.label}</button>)}
                        <button type="button" onClick={() => { setVariantTarget(section.id); setVariantDraft({ label: '', html: variant?.html ?? '' }) }}>＋ {t('addVariation')}</button>
                      </div>
                    ) : null}
                  </article>
                </div>
              )
            }) : null}
            {mode === 'build' && (selectedPage?.sections.length ?? 0) > 0 ? <InsertionZone t={t} index={selectedPage?.sections.length ?? 0}
              active={drawer === 'templates' && insertIndex === (selectedPage?.sections.length ?? 0)}
              onOpen={() => { openTemplates(selectedPage?.sections.length ?? 0) }}
              onDrop={(kind, id) => { handleCanvasDrop(kind, id, selectedPage?.sections.length ?? 0) }} /> : null}
          </div>
        </div>

        {drawer === 'structure' ? (
          <aside className={`${css.builderDrawer} ${css.structureDrawer}`} aria-label={t('builderStructure')}>
            <div className={css.builderDrawerHeader}><strong>{t('builderStructure')}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <div className={css.structureSummary}><IconFlatListOutlineRegular size={18} />
              <div><strong>{selectedPage?.title}</strong><small>{selectedPage?.sections.length === 1 ? t('structureSingleSection')
                : t('structureSectionCount').replace('{count}', String(selectedPage?.sections.length ?? 0))}</small></div>
            </div>
            <p>{t('structureHint')}</p>
            <div className={css.builderOutline}>
              {selectedPage?.sections.map((section, index) => (
                <Fragment key={section.id}>
                  <OutlineInsertionZone t={t} index={index} onDrop={(sectionId) => { moveSectionToGap(sectionId, index) }} />
                  <div className={css.builderOutlineRow} data-active={section.id === selectedSectionId} draggable
                    onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes(SECTION_DRAG_TYPE)) event.preventDefault() }}
                    onDrop={(event) => {
                      const id = event.dataTransfer.getData(SECTION_DRAG_TYPE)
                      if (id === '') return
                      event.preventDefault(); event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      moveSectionToGap(id, index + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0))
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(SECTION_DRAG_TYPE, section.id)
                    }}>
                    <span className={css.outlineDragHandle} aria-hidden="true">⠿</span><button className={css.outlineSectionSelect} type="button" aria-label={section.title} aria-current={section.id === selectedSectionId ? 'true' : undefined} onClick={() => {
                      setSelectedSectionId(section.id); setSelectedElement(null); setDesignScope('section'); setDrawer(null)
                    }}><span className={css.outlineSectionNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      <span className={css.outlineSectionTitle}>{section.title}</span></button>
                    <Tooltip label={t('moveSectionUp')} portal side="top" delayMs={400}><button type="button" disabled={saving || index === 0} aria-label={`${t('moveSectionUp')}: ${section.title}`}
                      onClick={() => { void moveSection(section.id, index - 1) }}>
                      <IconChevronUpOutlineRegular size={14} /></button></Tooltip>
                    <Tooltip label={t('moveSectionDown')} portal side="top" delayMs={400}><button type="button" disabled={saving || index === selectedPage.sections.length - 1} aria-label={`${t('moveSectionDown')}: ${section.title}`}
                      onClick={() => { void moveSection(section.id, index + 1) }}>
                      <IconChevronDownOutlineRegular size={14} /></button></Tooltip>
                    <Menu portal compact align="end" open={outlineMenuId === section.id} onClose={() => { setOutlineMenuId(null) }}
                      anchor={<button type="button" aria-label={`${t('structureSectionActions')}: ${section.title}`} aria-haspopup="menu" aria-expanded={outlineMenuId === section.id}
                        onClick={() => { setOutlineMenuId(current => current === section.id ? null : section.id) }}>
                        <IconEllipsisOutlineRegular size={16} /></button>}>
                      <MenuItemButton onSelect={() => { setOutlineMenuId(null); setRenameTarget(section); setRenameDraft(section.title) }}>{t('toolbarRenameSection')}</MenuItemButton>
                      <MenuItemButton disabled={saving} onSelect={() => { setOutlineMenuId(null); void duplicateSection(section) }}>{t('toolbarDuplicateSection')}</MenuItemButton>
                      <MenuItemButton danger onSelect={() => { setOutlineMenuId(null); setDeleteTarget(section) }}>{t('toolbarDeleteSection')}</MenuItemButton>
                    </Menu>
                  </div>
                </Fragment>
              ))}
              <OutlineInsertionZone t={t} index={selectedPage?.sections.length ?? 0}
                onDrop={(sectionId) => { moveSectionToGap(sectionId, selectedPage?.sections.length ?? 0) }} />
            </div>
            <div className={css.builderDrawerActions}>
              <button type="button" className={css.builderDrawerAction}
                onClick={() => { openTemplates(selectedPage?.sections.length ?? 0) }}><IconPlusOutlineRegular size={14} />{t('addSection')}</button>
            </div>
          </aside>
        ) : null}

        {drawer === 'templates' ? (
          <aside ref={libraryRef} className={`${css.builderDrawer} ${css.builderLibraryModal} ${css.sectionLibraryModal}`} role="dialog" aria-modal="false" aria-label={t('addSection')}>
            <div className={css.builderDrawerHeader}><button type="button" onClick={() => { setDrawer('structure') }}>‹</button><strong>{t('addSection')}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <div className={css.elementLibraryIntro}><p>{t('savedSectionsOnly')}</p></div>
            <input className={css.templateSearch} value={templateQuery} aria-label={t('searchSavedSections')} placeholder={t('searchSavedSections')}
              onChange={(event) => { setTemplateQuery(event.currentTarget.value) }} />
            {libraryError === '' ? null : <p role="alert">{t('reusableSectionsFailed')} {libraryError}
              <Button variant="outline" onClick={() => { void loadReusableSections() }}>{t('retry')}</Button></p>}
            <div className={css.templateBrowser}>
              <nav aria-label={t('builderVisualSectionTypes')}>
                {templateFamilies.map(family => <button key={family} type="button" data-active={family === activeTemplateFamily}
                  onClick={() => { setTemplateFamily(family); setTemplateQuery('') }}>
                  <span>{familyLabel(family)}</span><small>{libraryTemplates.filter(item => item.family === family).length}</small>
                </button>)}
              </nav>
              <div className={css.visualTemplateList} aria-label={t('designerTemplates')}>
                {matchingTemplates.length === 0 && libraryError === '' ? <p>{t(libraryTemplates.length === 0 ? 'noSavedSections' : 'noMatchingSavedSections')}</p> : null}
                {matchingTemplates.map(template => (
                  <div key={template.id} className={css.libraryTemplateCard}>
                    <button type="button" draggable className={css.libraryTemplateInsert} aria-label={template.title}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData(SECTION_TEMPLATE_DRAG_TYPE, template.id)
                      }}
                      onClick={() => { void addTemplate(template, insertIndex) }}>
                      <TemplateThumbnail template={template} projectPath={projectPath} previewCss={previewCss} assets={assetView} />
                      <strong>{template.title}</strong><span className={css.templateCategory}>{familyLabel(template.family)}</span>
                      {template.description === '' ? null : <small>{template.description}</small>}
                    </button>
                    <div className={css.libraryTemplateActions} role="group" aria-label={`${t('librarySectionActions')}: ${template.title}`}>
                      <button type="button" disabled={libraryMutationBusy || actions.moveReusableSection === undefined}
                        aria-label={`${t('moveLibrarySection')}: ${template.title}`}
                        onClick={() => { openLibraryManagement(template.id, 'move') }}>{t('moveLibrarySection')}</button>
                      <button type="button" disabled={libraryMutationBusy || actions.deleteReusableSection === undefined}
                        aria-label={`${t('deleteLibrarySection')}: ${template.title}`}
                        onClick={() => { openLibraryManagement(template.id, 'delete') }}>{t('deleteLibrarySection')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className={css.askCopyOSButton} onClick={() => {
              void stageSectionPrompt('add-section', selectedPage?.title ?? 'Landing page', `position ${insertIndex + 1}`)
            }}>✦ <span>{t('builderVisualAskCopyOSToAddASection')}</span> →</button>
          </aside>
        ) : null}

        {drawer === 'elements' && selectedSection !== undefined ? (
          <aside ref={libraryRef} className={`${css.builderDrawer} ${css.builderLibraryModal} ${css.elementLibraryModal}`}
            role="dialog" aria-modal="false" aria-label={t('addElement')} style={libraryDragging ? { opacity: 0.15, pointerEvents: 'none' } : undefined}
            onDragStart={() => { setLibraryDragging(true) }} onDragEnd={(event) => { setLibraryDragging(false); if (event.dataTransfer.dropEffect !== 'none') setDrawer(null) }}>
            <div className={css.builderDrawerHeader}><strong>{t('addElement')}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <div className={css.elementLibraryIntro}>
              <p>{t('elementLibraryHint')}</p>
              <span>{t('elementLibraryTarget')} <strong>{selectedSection.title}</strong></span>
            </div>
            <div className={css.elementTemplateGrid}>
              {elementTemplates(t).map(element => (
                <button key={element.id} type="button" draggable disabled={saving}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy'
                    // WebKitGTK needs a standard drag target to deliver the custom payload to the frame.
                    event.dataTransfer.setData('text/plain', element.title)
                    event.dataTransfer.setData(ELEMENT_TEMPLATE_DRAG_TYPE, JSON.stringify({
                      kind: 'template', templateId: element.id, html: element.html,
                    }))
                  }}
                  onClick={() => { void addElement(element) }}>
                  <span className={css.elementPreview} data-kind={element.id} aria-hidden="true">
                    {element.id === 'heading' ? t('designerShortFontSize') : element.id === 'button' ? <span>{element.title}</span>
                      : <><i /><i /><i /></>}
                  </span>
                  <span className={css.elementTemplateCopy}><strong>{element.title}</strong><small>{element.description}</small></span>
                  <IconPlusOutlineRegular className={css.elementTemplateAdd} size={14} />
                </button>
              ))}
            </div>
          </aside>
        ) : null}

        {drawer === 'design' && selectedSection !== undefined && selectedVariant !== undefined ? (
          <aside className={`${css.builderDrawer} ${css.designDrawer}`} aria-label={t('builderVisualSectionDesign')}>
            <div className={css.builderDrawerHeader}><strong>{t('builderVisualDesign')}{' '}{selectedSection.title}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <div className={css.designScopeTabs} role="tablist" aria-label={t('builderVisualDesignTarget')}>
              <button type="button" role="tab" aria-selected={designScope === 'section'} data-active={designScope === 'section'}
                onClick={() => { setDesignScope('section') }}>{t('builderVisualSection')}</button>
              <button type="button" role="tab" aria-selected={designScope === 'element'} data-active={designScope === 'element'}
                disabled={selectedElement === null} onClick={() => { setDesignScope('element') }}>{t('designerSemanticsElement')}</button>
            </div>
            {designScope === 'section' ? <>
              <p>{t('builderVisualAdjustTheSectionAsAWholeSelectText')}</p>
              <DesignControl label={t('builderVisualSurface')} value={selectedDesign.surface}
                options={[['white', 'White'], ['soft', 'Soft'], ['accent', 'Accent'], ['dark', 'Dark']]}
                onChange={(value) => { void changeSectionDesign('surface', value as SectionSurface) }} />
              <DesignControl label={t('spacingEdges')} value={spacingEdge}
                options={[['both', t('spacingBoth')], ['top', t('spacingTopOnly')], ['bottom', t('spacingBottomOnly')]]}
                onChange={(value) => { setSpacingEdge(value as SectionSpacingEdge) }} />
              <DesignControl label={t('builderVisualSpacing')} value={selectedSpacingPreset}
                options={[['none', t('spacingNone')], ['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]}
                onChange={(value) => { void changeSectionDesign('spacing', value as SectionSpacing) }} />
              <DesignControl label={t('builderVisualAlignment')} value={selectedDesign.alignment}
                options={[['left', 'Left'], ['center', 'Center']]}
                onChange={(value) => { void changeSectionDesign('alignment', value as SectionAlignment) }} />
            </> : selectedElement !== null ? <>
              <div className={css.designSelectionSummary}>
                <span>{selectedElement.tag.toUpperCase()}</span>
                <div><strong>{selectedElement.label}</strong><small>{t('designSelectedElement')}</small></div>
              </div>
              {selectedElement.textCopies === true ? <p className={css.designHint}>{t('designTextCopies')}</p> : null}
              {selectedElement.question === true ? <p className={css.designHint}>{t('designQuestionEdit')}</p> : null}
              <section className={css.designPropertyGroup}><h4>{t('designTypography')}</h4>
                <DesignSelectGrid>
                  <DesignSelect label={t('builderVisualFont')} value={selectedElementDesign.fontFamily}
                    options={[['inherit', 'Inherit'], ['system-ui', 'Sans'], ['Georgia, serif', 'Serif'], ['ui-monospace, monospace', 'Mono']]}
                    onChange={(value) => { void changeElementDesign('fontFamily', value) }} />
                  <DesignSelect label={t('builderVisualSize')} value={selectedElementDesign.fontSize}
                    options={[['12px', '12 px'], ['14px', '14 px'], ['16px', '16 px'], ['18px', '18 px'], ['24px', '24 px'], ['32px', '32 px'], ['48px', '48 px'], ['64px', '64 px']]}
                    onChange={(value) => { void changeElementDesign('fontSize', value) }} />
                  <DesignSelect label={t('designerWeight')} value={selectedElementDesign.fontWeight}
                    options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']]}
                    onChange={(value) => { void changeElementDesign('fontWeight', value) }} />
                  <DesignSelect label={t('designerLineHeight')} value={selectedElementDesign.lineHeight}
                    options={[['1', 'Tight'], ['1.2', 'Snug'], ['1.5', 'Normal'], ['1.7', 'Relaxed']]}
                    onChange={(value) => { void changeElementDesign('lineHeight', value) }} />
                  <DesignValueInput invalidMessage={t('builderVisualUseACSSSizeSuchAs24px50')} label={t('designerLetterSpacing')} value={selectedElementDesign.letterSpacing} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('letterSpacing', value) }} />
                  <DesignControl label={t('designerTextAlign')} value={selectedElementDesign.alignment}
                    options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]}
                    onChange={(value) => { void changeElementDesign('alignment', value) }} />
                </DesignSelectGrid>
              </section>
              <section className={css.designPropertyGroup}><h4>{t('designAppearance')}</h4>
                <div className={css.designColorRow}>
                  <label><span>{t('builderVisualTextColor')}</span><input type="color" aria-label={t('builderVisualTextColor')} value={selectedElementDesign.color}
                    onChange={(event) => { void changeElementDesign('color', event.currentTarget.value) }} /></label>
                  <label><span>{t('builderVisualBackground')}</span><input type="color" aria-label={t('builderVisualElementBackgroundColor')} value={selectedElementDesign.background}
                    onChange={(event) => { void changeElementDesign('background', event.currentTarget.value) }} /></label>
                </div>
                <DesignControl label={t('builderVisualCorners')} value={selectedElementDesign.radius}
                  options={[['0px', 'None'], ['6px', 'S'], ['12px', 'M'], ['999px', 'Pill']]}
                  onChange={(value) => { void changeElementDesign('radius', value) }} />
              </section>
              <section className={css.designPropertyGroup}><h4>{t('builderVisualSize')}</h4>
                <DesignControl label={t('builderVisualWidthPreset')} value={selectedElementDesign.width}
                  options={[['auto', 'Auto'], ['50%', '50%'], ['75%', '75%'], ['100%', 'Fill']]}
                  onChange={(value) => { void changeElementDesign('width', value) }} />
                <DesignSelectGrid>
                  <DesignValueInput invalidMessage={t('builderVisualUseACSSSizeSuchAs24px50')} label={t('designerWidth')} value={selectedElementDesign.width} placeholder={t('builderVisualAuto')}
                    onChange={(value) => { void changeElementDesign('width', value) }} />
                  <DesignValueInput invalidMessage={t('builderVisualUseACSSSizeSuchAs24px50')} label={t('builderVisualMaxWidth')} value={selectedElementDesign.maxWidth} placeholder={t('builderVisualNone')}
                    onChange={(value) => { void changeElementDesign('maxWidth', value) }} />
                  <DesignValueInput invalidMessage={t('builderVisualUseACSSSizeSuchAs24px50')} label={t('designerHeight')} value={selectedElementDesign.height} placeholder={t('builderVisualAuto')}
                    onChange={(value) => { void changeElementDesign('height', value) }} />
                  <DesignValueInput invalidMessage={t('builderVisualUseACSSSizeSuchAs24px50')} label={t('builderVisualMinHeight')} value={selectedElementDesign.minHeight} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('minHeight', value) }} />
                </DesignSelectGrid>
              </section>
              <section className={css.designPropertyGroup}><h4>{t('builderVisualSpacing')}</h4>
                <div className={css.designSpacingMap}>
                  <DesignValueInput spacing="padding" invalidMessage={t('spacingInputError')} label={t('builderVisualPaddingTop')} value={selectedElementDesign.paddingTop} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('paddingTop', value) }} />
                  <DesignValueInput spacing="padding" invalidMessage={t('spacingInputError')} label={t('builderVisualPaddingRight')} value={selectedElementDesign.paddingRight} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('paddingRight', value) }} />
                  <DesignValueInput spacing="padding" invalidMessage={t('spacingInputError')} label={t('builderVisualPaddingBottom')} value={selectedElementDesign.paddingBottom} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('paddingBottom', value) }} />
                  <DesignValueInput spacing="padding" invalidMessage={t('spacingInputError')} label={t('builderVisualPaddingLeft')} value={selectedElementDesign.paddingLeft} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('paddingLeft', value) }} />
                  <span className={css.designSpacingCenter} aria-hidden="true"><span /></span>
                </div>
                <DesignSelectGrid>
                  <DesignValueInput spacing="margin" invalidMessage={t('spacingInputError')} label={t('builderVisualMarginTop')} value={selectedElementDesign.marginTop} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('marginTop', value) }} />
                  <DesignValueInput spacing="margin" invalidMessage={t('spacingInputError')} label={t('builderVisualMarginBottom')} value={selectedElementDesign.marginBottom} placeholder={t('builderVisual0px')}
                    onChange={(value) => { void changeElementDesign('marginBottom', value) }} />
                </DesignSelectGrid>
              </section>

            </> : null}
            {designScope === 'element' && selectedElement !== null ? <Button variant="outline" disabled={saving}
              onClick={() => { void deleteSelectedElement() }}>{t('deleteSelectedElement')}</Button> : null}
            <button type="button" className={css.designChatButton} onClick={() => {
              void stageSectionPrompt('customize', selectedPage?.title ?? '', selectedSection.title).then((accepted) => { if (accepted) setDrawer(null) })
            }}>✦ <span>{t('builderVisualCustomizeFurtherWithChat')}</span> →</button>
          </aside>
        ) : null}

        {drawer === 'comments' ? (
          <aside className={`${css.builderDrawer} ${css.commentsDrawer}`} aria-label={t('builderVisualPageComments')}>
            <div className={css.builderDrawerHeader}><strong>{t('commentsTitle')}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <div className={css.commentsOverview}>
              <div><IconNewChatOutlineRegular size={18} /><span>{t('commentsSummary')
                .replace('{open}', String((selectedPage?.comments ?? []).filter(comment => comment.status === 'open').length))
                .replace('{resolved}', String((selectedPage?.comments ?? []).filter(comment => comment.status === 'resolved').length))}</span></div>
              <button type="button" onClick={() => { openReviewMode('comment') }}><IconPlusOutlineRegular size={14} />{t('commentsAdd')}</button>
            </div>
            <p>{t('commentsPrivacy')}</p>
            {(selectedPage?.comments ?? []).length === 0 ? <div className={css.commentsEmpty}>
              <IconNewChatOutlineRegular size={26} /><strong>{t('commentsEmpty')}</strong><p>{t('commentsEmptyHint')}</p>
            </div> : <div className={css.commentList}>
              {[...(selectedPage?.comments ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((comment) => {
                const target = selectedPage === undefined ? undefined : resolveCommentElement(selectedPage, comment)
                return <article key={comment.id} data-resolved={comment.status === 'resolved'}>
                  <div className={css.commentCardMeta}>
                    <span>{selectedPage?.sections.find(section => section.id === comment.sectionId)?.title ?? selectedPage?.title}</span>
                    <span className={css.commentStatus}>{t(comment.status === 'open' ? 'commentsOpen' : 'commentsResolved')}</span></div>
                  <header><button type="button" disabled={target === undefined || saving}
                    title={target === undefined ? t('pageCommentTargetMissing') : undefined} onClick={() => {
                      if (target === undefined || selectedPage === undefined) return
                      const select = (): void => {
                        setSelectedSectionId(target.section.id)
                        setSelectedElement({ ...(typeof comment.elementId === 'string' ? { id: comment.elementId } : {}), sectionId: target.section.id, variantId: target.variant.id,
                          index: target.index, tag: target.element.tagName.toLowerCase(), label: comment.elementLabel,
                          width: 0, height: 0, font: '', lineHeight: '', color: '', viewportLeft: 24, viewportTop: 96 })
                        setDrawer(null)
                      }
                      if (target.section.selectedVariantId === target.variant.id) select()
                      else void runSave(async () => await actions.selectPageSectionVariant({ workspaceId, pageId: selectedPage.id,
                        expectedRevision: selectedPage.revision ?? 0, sectionId: target.section.id, variantId: target.variant.id,
                      })).then((page) => { if (page !== undefined) select() })
                    }}>{comment.elementLabel}</button></header>
                  {target === undefined ? <p>{t('pageCommentTargetMissing')}</p> : null}
                  <p>{comment.body}</p>
                  <footer><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                    <button type="button" disabled={saving} onClick={() => {
                      void setCommentStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open')
                    }}>{comment.status === 'open' ? <IconCheckOutlineRegular size={14} /> : null}{t(comment.status === 'open' ? 'commentsResolve' : 'commentsReopen')}</button></footer>
                </article>
              })}
            </div>}
          </aside>
        ) : null}

        {drawer === 'variations' && selectedSection !== undefined ? (
          <aside className={css.builderDrawer}>
            <div className={css.builderDrawerHeader}><strong>{selectedSection.title} {t('builderVisualVariations')}</strong><button type="button" onClick={() => { setDrawer(null); setPreviewVariantId(null) }}>×</button></div>
            <p>{t('builderVisualPreviewCompareRefineOrApplyAStoredDirection')}</p>
            <button type="button" className={css.builderDrawerAction} onClick={() => { void load() }}>{t('builderVisualRefreshVariations')}</button>
            <div className={css.variationCards}>
              {selectedSection.variants.map((item, index) => (
                <article key={item.id} data-previewing={previewVariantId === item.id}>
                  <div><small>0{index + 1}</small><strong>{item.label}</strong>
                    {item.id === selectedSection.selectedVariantId ? <span>{t('builderVisualApplied')}</span> : null}</div>
                  <SectionCopyPreview html={item.html} />
                  <footer>
                    <button type="button" onClick={() => { setPreviewVariantId(current => current === item.id ? null : item.id) }}>
                      {previewVariantId === item.id ? t('builderVisualClearPreview') : t('designerPreview')}
                    </button>
                    <button type="button" onClick={() => { setCompareVariantId(item.id); setDrawer('compare') }}>{t('builderVisualCompare')}</button>
                    <button type="button" onClick={() => { void stageSectionPrompt('refine', selectedPage?.title ?? '', `${selectedSection.title} — ${item.label}`) }}>{t('builderVisualRefine')}</button>
                    <button type="button" disabled={item.id === selectedSection.selectedVariantId}
                      onClick={() => { void selectVariant(selectedSection.id, item.id); setPreviewVariantId(null) }}>{t('designerApplyLayoutVersion')}</button>
                  </footer>
                </article>
              ))}
            </div>
          </aside>
        ) : null}

        {drawer === 'compare' && selectedSection !== undefined ? (
          <aside className={`${css.builderDrawer} ${css.compareDrawer}`}>
            <div className={css.builderDrawerHeader}><button type="button" onClick={() => { setDrawer('variations') }}>‹</button><strong>{t('builderVisualCompareVariations')}</strong><button type="button" onClick={() => { setDrawer(null) }}>×</button></div>
            <VariationComparison t={t} section={selectedSection} candidateId={compareVariantId} />
          </aside>
        ) : null}
      </div>

      {reviewMode === 'comment' && selectedElement !== null && selectedSection !== undefined ? createPortal(
        <div ref={commentCardRef} className={css.elementCommentCard} role="dialog" aria-label={t('builderVisualCommentOnSelectedElement')}
          style={commentPosition ?? {
            left: Math.min(Math.max(12, selectedElement.viewportLeft + selectedElement.width + 14), Math.max(12, window.innerWidth - 430)),
            top: Math.min(Math.max(72, selectedElement.viewportTop - 18), Math.max(72, window.innerHeight - 560)),
          }}>
          <header>
            <span className={css.commentDragHandle} onPointerDown={beginCommentDrag}>⠿</span>
            <strong>{selectedSection.title} · {selectedElement.tag}</strong>
            <button type="button" onClick={() => { setReviewMode(null); setDrawer('comments') }}>{t('builderVisualViewAllComments')}</button>
          </header>
          <dl>
            <dt>{t('builderVisualSize')}</dt><dd>{Math.round(selectedElement.width)}×{Math.round(selectedElement.height)}</dd>
            <dt>{t('designerBlendColor')}</dt><dd><i style={{ background: selectedElement.color }} />{selectedElement.color}</dd>
            <dt>{t('builderVisualFont')}</dt><dd>{selectedElement.font || t('designerEffectsInherited')}</dd>
            <dt>{t('builderVisualLine')}</dt><dd>{selectedElement.lineHeight}</dd>
          </dl>
          <textarea aria-label={t('builderVisualCommentOnThisElement')} autoFocus rows={5} value={reviewDraft} disabled={agentPending} placeholder={t('builderVisualCommentOnThisElement')}
            onChange={(event) => { setReviewDraft(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeReviewMode()
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void addComment() }
            }} />
          <footer>
            <button type="button" className={css.commentUtilityButton} title={t('builderVisualCloseComment')} onClick={closeReviewMode}>×</button>
            <span />
            <button type="button" disabled={reviewDraft.trim() === '' || agentPending} onClick={() => { void stageCommentPrompt() }}>{t('designerSendToChat')}</button>
            <button type="button" className={css.commentPrimaryButton} disabled={reviewDraft.trim() === '' || saving}
              onClick={() => { void addComment() }}>{t('builderVisualComment')}</button>
          </footer>
        </div>, document.body) : null}

      {reviewMode === 'mark' ? (
        <div className={css.markOverlay} role="dialog" aria-label={t('builderVisualMarkPage')}>
          <svg ref={markCanvasRef} className={css.markCanvas} style={{ cursor: 'crosshair' }}
            onPointerDown={beginMark} onPointerMove={moveMark}
            onPointerUp={finishMark} onPointerCancel={finishMark}>
            {[...markShapes, ...(activeMark === null ? [] : [activeMark])].map((shape) => {
              if (shape.kind === 'box') return <rect key={shape.id}
                x={Math.min(shape.x, shape.x + shape.width)} y={Math.min(shape.y, shape.y + shape.height)}
                width={Math.abs(shape.width)} height={Math.abs(shape.height)} />
              if (shape.kind === 'pen') return <polyline key={shape.id}
                points={shape.points.map(point => `${point.x},${point.y}`).join(' ')} />
              if (shape.kind === 'text') return <text key={shape.id} x={shape.x} y={shape.y}>{shape.text}</text>
              return <image key={shape.id} href={shape.src} x={shape.x} y={shape.y} width="240" height="180" preserveAspectRatio="xMidYMid meet" />
            })}
          </svg>
          <div className={css.markToolbar}>
            <div className={css.markToolGroup}>
              <button type="button" data-active={markTool === 'box'} title={t('builderVisualBoxSelect')} onClick={() => { setMarkTool('box') }}>□</button>
              <button type="button" data-active={markTool === 'pen'} title={t('builderVisualDraw')} onClick={() => { setMarkTool('pen') }}>⌁</button>
              <button type="button" data-active={markTool === 'text'} title={t('builderVisualTextMark')} onClick={() => { setMarkTool('text') }}>{t('designerTextIcon')}</button>
            </div>
            <button type="button" title={t('builderVisualUndoMark')} disabled={agentPending || markShapes.length === 0} onClick={() => {
              setMarkShapes((current) => {
                const last = current.at(-1); if (last !== undefined) setMarkRedo(redo => [...redo, last]); return current.slice(0, -1)
              })
            }}>↶</button>
            <button type="button" title={t('builderVisualRedoMark')} disabled={agentPending || markRedo.length === 0} onClick={() => {
              setMarkRedo((current) => {
                const last = current.at(-1); if (last !== undefined) setMarkShapes(shapes => [...shapes, last]); return current.slice(0, -1)
              })
            }}>↷</button>
            <button type="button" title={t('builderVisualAttachImage')} disabled={agentPending} onClick={() => { markImageInputRef.current?.click() }}>▧＋</button>
            <input ref={markImageInputRef} className={css.visuallyHidden} type="file" accept="image/*"
              onChange={(event) => { addMarkImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <input aria-label={t('builderVisualAddANoteForThisMark')} className={css.markNoteInput} value={reviewDraft} disabled={agentPending} placeholder={t('builderVisualAddANoteForThisMark')}
              onChange={(event) => { setReviewDraft(event.currentTarget.value) }}
              onKeyDown={(event) => { if (event.key === 'Escape') closeReviewMode(); if (event.key === 'Enter') void stageMarkedPrompt() }} />
            <button type="button" title={t('builderVisualAddMarkToChatInput')} disabled={agentPending || markShapes.length === 0 && reviewDraft.trim() === ''}
              onClick={() => { void stageMarkedPrompt(true) }}>↧</button>
            <button type="button" title={t('builderVisualQueueMarkInChat')} disabled={agentPending || markShapes.length === 0 && reviewDraft.trim() === ''}
              onClick={() => { void stageMarkedPrompt(true) }}>☷</button>
            <button type="button" className={css.markSendButton} title={t('builderVisualSendMarkToChat')}
              disabled={agentPending || markShapes.length === 0 && reviewDraft.trim() === ''} onClick={() => { void stageMarkedPrompt() }}>▶</button>
            <button type="button" title={t('builderVisualCloseMarkMode')} onClick={closeReviewMode}>×</button>
          </div>
        </div>) : null}

      {renderCreatePageModal()}
      <datalist id={libraryCategoryListId}>
        {libraryCategoryOptions.map(category => <option key={category} value={category}>{familyLabel(category)}</option>)}
      </datalist>
      <Modal open={libraryTarget !== null} onClose={() => { if (!libraryMutationBusy) setLibraryTarget(null) }} closeLabel={t('cancel')}
        title={t(libraryTarget?.action === 'delete' ? 'deleteLibrarySectionTitle' : 'moveLibrarySection')}
        description={t(libraryTarget?.action === 'delete' ? 'deleteLibrarySectionDescription' : 'moveLibrarySectionDescription')}
        className={css.assetDialog as string} contentClassName={css.assetDialogContent as string}
        footer={<div className={css.modalActions}>
          <Button variant="outline" disabled={libraryMutationBusy} onClick={() => { setLibraryTarget(null) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={libraryMutationBusy || libraryTarget?.action === 'move' && libraryCategory.trim() === ''}
            onClick={() => { void commitLibraryManagement() }}>{libraryMutationBusy ? t('savingAsset') : t(libraryTarget?.action === 'delete' ? 'deleteLibrarySection' : 'moveLibrarySection')}</Button>
        </div>}>
        <p><strong>{libraryTarget?.section.title}</strong></p>
        {libraryMutationError === '' ? null : <p className={css.assetError} role="alert">{libraryMutationError}</p>}
        {libraryTarget?.action !== 'move' ? null : <label className={css.formField}><span>{t('reusableSectionCategory')}</span>
          <input maxLength={60} list={libraryCategoryListId} value={libraryCategory} disabled={libraryMutationBusy}
            placeholder={t('libraryCategoryPlaceholder')} onChange={(event) => { setLibraryCategory(event.currentTarget.value) }} />
        </label>}
      </Modal>
      <Modal open={reusableTarget !== null} onClose={() => { if (!saving) setReusableTarget(null) }} closeLabel={t('cancel')}
        title={t('saveReusableSection')} description={t('reusableSectionDescription')} className={css.assetDialog as string}
        contentClassName={css.assetDialogContent as string}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => { setReusableTarget(null) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={saving || reusableDraft.title.trim() === '' || reusableDraft.category.trim() === ''} onClick={() => { void saveReusableSection() }}>{saving ? t('savingAsset') : t('saveReusableSection')}</Button></div>}>
        {reusableError === '' ? null : <p className={css.assetError} role="alert">{reusableError}</p>}
        <div className={css.assetForm}>
          <label className={css.formField}><span>{t('reusableSectionName')}</span><input maxLength={160} value={reusableDraft.title}
            onChange={(event) => {
              const value = event.currentTarget.value
              setReusableDraft(current => ({ ...current, title: value }))
            }} /></label>
          <label className={css.formField}><span>{t('reusableSectionCategory')}</span><input value={reusableDraft.category}
            maxLength={60} list={libraryCategoryListId} placeholder={t('libraryCategoryPlaceholder')}
            onChange={(event) => {
              const value = event.currentTarget.value
              setReusableDraft(current => ({ ...current, category: value }))
            }} /></label>
          <label className={css.formField}><span>{t('reusableSectionSummary')}</span><textarea rows={3} maxLength={500} value={reusableDraft.description}
            onChange={(event) => {
              const value = event.currentTarget.value
              setReusableDraft(current => ({ ...current, description: value }))
            }} /></label>
        </div>
      </Modal>
      <Modal open={variantSection !== undefined} onClose={() => { if (!saving) setVariantTarget(null) }} closeLabel={t('cancel')}
        title={t('addVariation')} description={variantSection?.title ?? ''} className={css.codeDialog as string}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => { setVariantTarget(null) }}>{t('cancel')}</Button><Button variant="primary" disabled={saving} onClick={() => { void addVariant() }}>{saving ? t('savingAsset') : t('saveVariation')}</Button></div>}>
        <div className={css.assetForm}>
          <label className={css.formField}><span>{t('variationLabel')}</span><input value={variantDraft.label} onChange={(event) => { const value = event.currentTarget.value; setVariantDraft(current => ({ ...current, label: value })) }} /></label>
          <label className={css.formField}><span>{t('sectionHtml')}</span><textarea className={css.codeEditor} rows={16} value={variantDraft.html} onChange={(event) => { const value = event.currentTarget.value; setVariantDraft(current => ({ ...current, html: value })) }} /></label>
        </div>
      </Modal>
      <Modal open={renameTarget !== null} onClose={() => { if (!saving) setRenameTarget(null) }} closeLabel={t('cancel')}
        title={t('toolbarRenameSection')} description={renameTarget?.title ?? ''} className={css.assetDialog as string}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => { setRenameTarget(null) }}>{t('cancel')}</Button><Button variant="primary" disabled={saving || renameDraft.trim() === ''} onClick={() => { void renameSection() }}>{t('designerRename')}</Button></div>}>
        <label className={css.formField}><span>{t('reusableSectionName')}</span><input value={renameDraft}
          onChange={(event) => { setRenameDraft(event.currentTarget.value) }} /></label>
      </Modal>
      <Modal open={deleteTarget !== null} onClose={() => { if (!saving) setDeleteTarget(null) }} closeLabel={t('cancel')}
        title={t('builderVisualDeleteSection')} description={deleteTarget?.title ?? ''} className={css.assetDialog as string}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => { setDeleteTarget(null) }}>{t('cancel')}</Button><Button variant="primary" disabled={saving} onClick={() => { void deleteSection() }}>{t('toolbarDeleteSection')}</Button></div>}>
        <p>{t('builderVisualThisRemovesTheSectionAndAllOfIts')}</p>
      </Modal>
    </section>
  )

  function renderCreatePageModal(): ReactNode {
    if (pageId !== undefined) return null
    return (
      <Modal open={createOpen} onClose={() => { if (!saving) setCreateOpen(false) }} closeLabel={t('cancel')}
        title={t('newPage')} description={t('newPageDescription')} className={css.assetDialog as string}
        footer={<div className={css.modalActions}><Button variant="outline" disabled={saving} onClick={() => { setCreateOpen(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={saving} onClick={() => { void createPage() }}>{saving ? t('savingAsset') : t('savePage')}</Button></div>}>
        <div className={css.assetForm}>
          <label className={css.formField}><span>{t('pageTitle')}</span><input value={pageDraft.title} onChange={(event) => { const value = event.currentTarget.value; setPageDraft(current => ({ ...current, title: value })) }} /></label>
          <label className={css.formField}><span>{t('pageSlug')}</span><input value={pageDraft.slug} onChange={(event) => { const value = event.currentTarget.value; setPageDraft(current => ({ ...current, slug: value })) }} /></label>
        </div>
      </Modal>
    )
  }
}

function OutlineInsertionZone({ index, onDrop, t }: { t: Translate; index: number; onDrop: (sectionId: string) => void }): ReactNode {
  const [active, setActive] = useState(false)
  const accepts = (event: ReactDragEvent<HTMLDivElement>): boolean => Array.from(event.dataTransfer.types).includes(SECTION_DRAG_TYPE)
  return <div className={css.builderOutlineInsertion} data-active={active} aria-label={t('builderVisualMoveSectionPosition').replace('{position}', String(index + 1))}
    onDragEnter={(event) => { if (accepts(event)) { event.preventDefault(); setActive(true) } }}
    onDragOver={(event) => { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false) }}
    onDrop={(event) => {
      if (!accepts(event)) return
      event.preventDefault(); setActive(false)
      const sectionId = event.dataTransfer.getData(SECTION_DRAG_TYPE)
      if (sectionId !== '') onDrop(sectionId)
    }} />
}

function InsertionZone({ index, active, onOpen, onDrop, t }: {
  t: Translate
  index: number
  active: boolean
  onOpen: () => void
  onDrop: (kind: 'section' | 'template', id: string) => void
}): ReactNode {
  const [dragActive, setDragActive] = useState(false)
  const accepts = (event: ReactDragEvent<HTMLDivElement>): boolean => Array.from(event.dataTransfer.types).includes(SECTION_DRAG_TYPE)
    || Array.from(event.dataTransfer.types).includes(SECTION_TEMPLATE_DRAG_TYPE)
  return (
    <div className={css.builderInsertion} data-active={active || dragActive}
      onDragEnter={(event) => { if (accepts(event)) { event.preventDefault(); setDragActive(true) } }}
      onDragOver={(event) => { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(SECTION_DRAG_TYPE) ? 'move' : 'copy' } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
      onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
        if (!accepts(event)) return
        event.preventDefault(); setDragActive(false)
        const sectionId = event.dataTransfer.getData(SECTION_DRAG_TYPE)
        if (sectionId !== '') { onDrop('section', sectionId); return }
        const templateId = event.dataTransfer.getData(SECTION_TEMPLATE_DRAG_TYPE)
        if (templateId !== '') onDrop('template', templateId)
      }}>
      <button type="button" aria-label={t('builderVisualAddSectionPosition').replace('{position}', String(index + 1))} onClick={onOpen}>＋</button>
    </div>
  )
}

function TemplateThumbnail({ template, projectPath, previewCss, assets }: {
  template: Pick<SectionTemplate, 'title' | 'html'>
  projectPath: string | undefined
  previewCss: string
  assets?: PageAssetView | undefined
}): ReactNode {
  useLayoutEffect(() => assets?.retain(), [assets])
  const source = buildPreviewDocument(template.html, projectPath, `${previewCss}\nhtml{overflow:hidden!important}body{margin:0}`, assets)
    .replace(PREVIEW_FONT_MARKER, (whole, id: string) => {
      const face = assets?.fontFaces.get(id)
      return face === undefined || assets === undefined ? whole : resolvePreviewStyleUrls(face.css, assets.urls).replace(/<\/style/giu, '<\\/style')
    })
  return <span className={css.templateThumbnail} aria-hidden="true">
    <iframe title={template.title} tabIndex={-1} sandbox="" loading="lazy"
      srcDoc={source} />
  </span>
}

function DesignControl({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
}): ReactNode {
  return <fieldset className={css.designControl}><legend>{label}</legend><div>
    {options.map(([option, optionLabel]) => <button key={option} type="button" data-active={value === option}
      aria-pressed={value === option} onClick={() => { onChange(option) }}>{optionLabel}</button>)}
  </div></fieldset>
}

function DesignSelectGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className={css.designSelectGrid}>{children}</div>
}

function DesignSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
}): ReactNode {
  const values = new Set(options.map(([option]) => option))
  return <label className={css.designSelect}><span>{label}</span><select aria-label={label} value={value}
    onChange={(event) => { onChange(event.currentTarget.value) }}>
    {!values.has(value) && value !== '' ? <option value={value}>{value}</option> : null}
    {options.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}
  </select></label>
}

function DesignValueInput({ label, value, placeholder, spacing, invalidMessage, onChange }: {
  spacing?: 'padding' | 'margin'
  invalidMessage: string
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { setDraft(value); setInvalid(false) }, [value])
  const commit = (): void => {
    const raw = draft.trim()
    const next = spacing && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? `${raw}px` : raw
    const style = document.createElement('span').style
    const property = spacing === 'padding' ? 'padding-top' : 'margin-top'
    if (spacing !== undefined) style.setProperty(property, next)
    if (!validCssSize(next) || (spacing !== undefined && style.getPropertyValue(property) === '')) {
      setInvalid(true); return
    }
    setInvalid(false); setDraft(next)
    if (next !== value) onChange(next)
  }
  return <label className={css.designValueInput} data-invalid={invalid}>
    <span>{label}</span>
    <input aria-label={label} value={draft} placeholder={placeholder}
      onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false) }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { setDraft(value); setInvalid(false); event.currentTarget.blur() }
      }} />
    {invalid ? <small>{invalidMessage}</small> : null}
  </label>
}

function validCssSize(value: string): boolean {
  return /^(?:auto|none|fit-content|max-content|min-content|0|-?\d+(?:\.\d+)?(?:px|%|rem|em|vw|vh|ch))$/i.test(value)
}

function readSectionDesign(html: string, measured?: SectionSpacingMeasurement): {
  surface: SectionSurface
  spacingTop: SectionSpacing
  spacingBottom: SectionSpacing
  alignment: SectionAlignment
} {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const root = template.content.querySelector('section') ?? template.content.firstElementChild
  if (!(root instanceof HTMLElement)) return { surface: 'white', spacingTop: 'none', spacingBottom: 'none', alignment: 'left' }
  const savedSurface = root.dataset.copyosSurface as SectionSurface | undefined
  const background = `${root.style.background} ${root.style.backgroundColor}`.toLowerCase()
  const surface: SectionSurface = savedSurface
    ?? (background.includes('#111') || background.includes('rgb(17') ? 'dark'
      : background.includes('edf3fe') || background.includes('rgb(237') ? 'accent'
        : background.includes('f7f7f5') || background.includes('f3f1ff') ? 'soft' : 'white')
  const spacingTarget = measured?.targetId !== undefined ? resolvePageElement(template.content, measured.targetId)
    : measured !== undefined && measured.targetIndex >= 0 ? styleableElements(template.content)[measured.targetIndex] : root
  const classifySpacing = (value: string): SectionSpacing => {
    const padding = Number.parseFloat(value || '0')
    return padding === 0 ? 'none' : padding <= 45 ? 'compact' : padding >= 72 ? 'spacious' : 'comfortable'
  }
  const spacingTop = classifySpacing(spacingTarget?.style.paddingTop || measured?.paddingTop || '0')
  const spacingBottom = classifySpacing(spacingTarget?.style.paddingBottom || measured?.paddingBottom || '0')
  const alignment = (root.dataset.copyosAlignment as SectionAlignment | undefined)
    ?? (root.style.textAlign === 'center' ? 'center' : 'left')
  return { surface, spacingTop, spacingBottom, alignment }
}

function updateSectionDesign(
  html: string,
  property: 'surface' | 'spacing' | 'alignment',
  value: SectionSurface | SectionSpacing | SectionAlignment,
  edge: SectionSpacingEdge = 'both',
  spacingTargetIndex = -1,
  spacingTargetId?: string,
): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const root = template.content.querySelector('section') ?? template.content.firstElementChild
  if (!(root instanceof HTMLElement)) return html
  if (property === 'surface') {
    const surface = value as SectionSurface
    const colors: Record<SectionSurface, readonly [string, string]> = {
      white: ['#ffffff', '#0f1115'], soft: ['#f7f7f5', '#0f1115'],
      accent: ['#edf3fe', '#17233d'], dark: ['#111111', '#ffffff'],
    }
    root.dataset.copyosSurface = surface
    root.style.background = colors[surface][0]
    root.style.color = colors[surface][1]
  } else if (property === 'spacing') {
    const spacing = value as SectionSpacing
    const target = spacingTargetId !== undefined ? resolvePageElement(template.content, spacingTargetId)
      : spacingTargetIndex >= 0 ? styleableElements(template.content)[spacingTargetIndex] : root
    if (!target) return html
    const paddings: Record<SectionSpacing, string> = { none: '0px', compact: '36px', comfortable: '58px', spacious: '82px' }
    root.removeAttribute('data-copyos-spacing')
    target.dataset.copyosSpacingContainer = 'true'
    if (edge !== 'bottom') target.style.paddingTop = paddings[spacing]
    if (edge !== 'top') target.style.paddingBottom = paddings[spacing]
  } else {
    const alignment = value as SectionAlignment
    root.dataset.copyosAlignment = alignment
    root.style.textAlign = alignment
  }
  return template.innerHTML.trim()
}

/**
 * Desktop frame width for a page converted from Canvas: DESKTOP_VIEWPORT_WIDTH or one pixel above its widest max-width
 * media rule. Undefined for other pages, whose Desktop frames fill the canvas unscaled.
 */
function desktopViewportWidth(page: CopyOSPageDocument | undefined): number | undefined {
  if (page?.conversion === undefined) return undefined
  let width = DESKTOP_VIEWPORT_WIDTH
  for (const section of page.sections) {
    const html = section.variants.find(variant => variant.id === section.selectedVariantId)?.html ?? ''
    for (const match of html.matchAll(/@media[^{]*?max-width\s*:\s*(\d+(?:\.\d+)?)px/g))
      width = Math.max(width, Math.ceil(Number(match[1])) + 1)
  }
  return width
}

/** Page pixels per frame CSS pixel; the Desktop viewport zooms frames below 1. */
function frameScale(frame: HTMLIFrameElement): number {
  // clientWidth stays in the frame's unzoomed CSS pixels; the bounding rect includes CSS zoom.
  return frame.clientWidth > 0 ? frame.getBoundingClientRect().width / frame.clientWidth : 1
}

/** The nearest styleable element at or above `node`, skipping breakpoint copy wrappers, which display:contents makes unstylable. */
function styleTarget(node: Element): HTMLElement | null {
  let target = node.closest<HTMLElement>(STYLEABLE_ELEMENT_SELECTOR)
  while (target?.matches(BREAKPOINT_VARIANT_QUERY) === true)
    target = target.parentElement?.closest<HTMLElement>(STYLEABLE_ELEMENT_SELECTOR) ?? null
  return target
}

function editableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(EDITABLE_ELEMENT_SELECTOR)]
    .filter(element => element.parentElement?.closest(EDITABLE_ELEMENT_SELECTOR) === null)
}

// Positions are local to one render; selections and comments resolve by data-copyos-block-id. They equal styleIndex in the page
// element reader (copyos-projects page-elements.ts) only before the first h4–h6 or label, which have no legacy styleIndex.
function styleableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(STYLEABLE_ELEMENT_SELECTOR)]
}

function resolvePageElement(root: ParentNode, id: string): HTMLElement | undefined {
  const matches = [...root.querySelectorAll<HTMLElement>('[data-copyos-block-id]')].filter(element => element.dataset.copyosBlockId === id)
  return matches.length === 1 ? matches[0] : undefined
}

function resolveStyleElement(root: ParentNode, index: number, id?: string): HTMLElement | undefined {
  const elements = styleableElements(root)
  if (id === undefined) return elements[index]
  const matches = elements.filter(element => element.dataset.copyosBlockId === id)
  return matches.length === 1 ? matches[0] : undefined
}

function resolvePageOwner(page: CopyOSPageDocument, sectionId?: string, variantId?: string): {
  section: CopyOSPageSection
  variant: CopyOSPageSectionVariant
} | undefined {
  const sections = page.sections.filter(section => section.id === sectionId)
  const section = sections.length === 1 ? sections[0] : undefined
  if (!section) return undefined
  const variants = section.variants.filter(variant => variant.id === variantId)
  const variant = variants.length === 1 ? variants[0] : undefined
  return variant ? { section, variant } : undefined
}

function resolveCommentElement(page: CopyOSPageDocument, comment: CopyOSPageComment): {
  section: CopyOSPageSection
  variant: CopyOSPageSectionVariant
  element: HTMLElement
  index: number
} | undefined {
  const elementId = comment.elementId
  if (typeof elementId !== 'string') return undefined
  const owner = resolvePageOwner(page, comment.sectionId, comment.variantId)
  if (!owner) return undefined
  const { section, variant } = owner
  const template = document.createElement('template'); template.innerHTML = variant.html
  const element = resolveStyleElement(template.content, -1, elementId)
  return element ? { section, variant, element, index: styleableElements(template.content).indexOf(element) } : undefined
}

function freshHtmlElementIds(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html
  for (const element of template.content.children) freshElementIds(element)
  return template.innerHTML
}

function freshElementIds(root: Element): void {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.matches('style,script,link,meta,title,base,template,noscript')) continue
    element.setAttribute('data-copyos-block-id', `block-${randomUUID()}`)
  }
}

function colorValue(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(normalized)
  if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.min(255, Number(channel)).toString(16).padStart(2, '0')).join('')}`
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split('').map(character => `${character}${character}`).join('')}`
  }
  return fallback
}

function readElementDesign(html: string, index: number, measured?: SpacingValues, id?: string, computed?: ElementSelection['computedStyle']): {
  fontSize: string
  fontFamily: string
  fontWeight: string
  lineHeight: string
  letterSpacing: string
  alignment: string
  color: string
  background: string
  width: string
  maxWidth: string
  height: string
  minHeight: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
  marginTop: string
  marginBottom: string
  radius: string
} {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const element = resolveStyleElement(template.content, index, id)
  const tag = element?.tagName.toLowerCase() ?? 'p'
  const heading = /^h[1-3]$/.test(tag)
  const alignment = element?.style.textAlign || computed?.textAlign || 'left'
  const rtl = computed?.direction === 'rtl'
  return {
    fontSize: element?.style.fontSize || computed?.fontSize || (heading ? '32px' : '16px'),
    fontFamily: element?.style.fontFamily || computed?.fontFamily || 'inherit',
    fontWeight: element?.style.fontWeight || computed?.fontWeight || (heading || tag === 'strong' ? '700' : '400'),
    lineHeight: element?.style.lineHeight || computed?.lineHeight || (heading ? '1.2' : '1.5'),
    letterSpacing: element?.style.letterSpacing || computed?.letterSpacing || '0px',
    alignment: alignment === 'start' ? (rtl ? 'right' : 'left') : alignment === 'end' ? (rtl ? 'left' : 'right') : alignment,
    color: colorValue(element?.style.color || computed?.color || '', '#0f1115'),
    background: colorValue(element?.style.backgroundColor ?? '', '#ffffff'),
    width: element?.style.width || 'auto',
    maxWidth: element?.style.maxWidth || 'none',
    height: element?.style.height || 'auto',
    minHeight: element?.style.minHeight || '0px',
    paddingTop: element?.style.paddingTop || measured?.paddingTop || '0px',
    paddingRight: element?.style.paddingRight || measured?.paddingRight || '0px',
    paddingBottom: element?.style.paddingBottom || measured?.paddingBottom || '0px',
    paddingLeft: element?.style.paddingLeft || measured?.paddingLeft || '0px',
    marginTop: element?.style.marginTop || measured?.marginTop || '0px',
    marginBottom: element?.style.marginBottom || measured?.marginBottom || '0px',
    radius: element?.style.borderRadius || '0px',
  }
}

function updateElementDesign(html: string, index: number, property: ElementDesignProperty, value: string, id?: string): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const element = resolveStyleElement(template.content, index, id)
  if (element === undefined) return html
  const propertyNames: Record<ElementDesignProperty, keyof CSSStyleDeclaration> = {
    fontSize: 'fontSize', fontFamily: 'fontFamily', fontWeight: 'fontWeight', lineHeight: 'lineHeight',
    letterSpacing: 'letterSpacing', alignment: 'textAlign', color: 'color', background: 'backgroundColor',
    width: 'width', maxWidth: 'maxWidth', height: 'height', minHeight: 'minHeight',
    paddingTop: 'paddingTop', paddingRight: 'paddingRight', paddingBottom: 'paddingBottom', paddingLeft: 'paddingLeft',
    marginTop: 'marginTop', marginBottom: 'marginBottom', radius: 'borderRadius',
  }
  const styleProperty = propertyNames[property]
  Reflect.set(element.style, styleProperty, value)
  return template.innerHTML.trim()
}

function appendElementHtml(html: string, elementHtml: string): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const target = template.content.querySelector('section') ?? template.content.firstElementChild
  if (target === null) return `${html.trim()}\n${elementHtml}`
  const inserted = document.createElement('template')
  inserted.innerHTML = elementHtml
  for (const element of inserted.content.children) freshElementIds(element)
  target.append(inserted.content)
  return template.innerHTML.trim()
}

/**
 * Remove the selected canvas element while retaining a valid empty section.
 * @param html - Persisted section HTML without editor handles.
 * @param index - Selection index shared with the style inspector.
 * @param id - Stable element identity; a missing identity never falls back to the index.
 * @returns the edited HTML, or the original when the selection is stale.
 */
export function deleteElementHtml(html: string, index: number, id?: string): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const element = resolveStyleElement(template.content, index, id)
  if (element === undefined) return html
  element.remove()
  return template.innerHTML.trim() || '<section></section>'
}

function removeElementHtml(html: string, blockId: string): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const element = [...template.content.querySelectorAll<HTMLElement>('[data-copyos-block-id]')]
    .find(item => item.dataset.copyosBlockId === blockId)
  if (element === undefined) return html
  element.remove()
  return template.innerHTML.trim()
}

/** Collect project-local stylesheets once and apply them to every isolated section frame. */
export function collectPageStylesheets(page: CopyOSPageDocument): readonly string[] {
  const stylesheets = new Set<string>()
  for (const section of page.sections) {
    for (const variant of section.variants) {
      for (const match of variant.html.matchAll(/<link\b[^>]*>/giu)) {
        const tag = match[0]
        const rel = /\brel\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.toLowerCase().split(/\s+/u) ?? []
        const href = /\bhref\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]
        if (href !== undefined && rel.includes('stylesheet') && localProjectPath(href, '') !== null) stylesheets.add(href)
      }
    }
  }
  return [...stylesheets]
}

/** Resolve one portable asset through the active host's preview resources. */
export function projectAssetUrl(projectPath: string, value: string, baseFile = '', assets?: PageAssetView): string | null {
  const relative = localProjectPath(value, baseFile)
  if (relative === null) return null
  if (assets !== undefined) return assets.urls.get(relative) ?? null
  return `/api/file?path=${encodeURIComponent(`${projectPath.replace(/\/+$/u, '')}/${relative}`)}`
}

/** Point CSS url() references at the same authenticated project-file endpoint. */
export function rewriteCssAssetUrls(source: string, projectPath: string, baseFile = '', assets?: PageAssetView): string {
  return source.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu, (whole, _quote: string, value: string) => {
    const url = projectAssetUrl(projectPath, value, baseFile, assets)
    return url === null ? whole : `url("${url}")`
  })
}

function rewriteSrcset(value: string, projectPath: string, assets?: PageAssetView): string {
  if (value.includes('data:')) return value
  return value.split(',').map((candidate) => {
    const [source = '', ...descriptor] = candidate.trim().split(/\s+/u)
    const url = projectAssetUrl(projectPath, source, '', assets)
    return `${url ?? source}${descriptor.length === 0 ? '' : ` ${descriptor.join(' ')}`}`
  }).join(', ')
}

function rewriteProjectAssetUrls(source: string, projectPath: string, assets?: PageAssetView): string {
  if (assets !== undefined) {
    const template = document.createElement('template'); template.innerHTML = source
    for (const node of template.content.querySelectorAll('[style]'))
      node.setAttribute('style', resolvePreviewDeclarationUrls(node.getAttribute('style') ?? '', assets.urls))
    source = template.innerHTML
  }
  const withoutLocalStylesheets = source.replace(/<link\b[^>]*>/giu, (tag) => {
    const rel = /\brel\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.toLowerCase().split(/\s+/u) ?? []
    const href = /\bhref\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]
    return href !== undefined && rel.includes('stylesheet') && localProjectPath(href, '') !== null ? '' : tag
  })
  const attributes = withoutLocalStylesheets.replace(/\b(src|poster)\s*=\s*(["'])([^"']+)\2/giu,
    (whole, name: string, quote: string, value: string) => {
      const url = projectAssetUrl(projectPath, value, '', assets)
      return url === null ? whole : `${name}=${quote}${url}${quote}`
    }).replace(/\bsrcset\s*=\s*(["'])([^"']+)\1/giu,
    (_whole, quote: string, value: string) => `srcset=${quote}${rewriteSrcset(value, projectPath, assets)}${quote}`)
    // SVG images name their source in href; converted Canvas artboards use them for cropped and tiled image fills.
    .replace(/<image\b[^>]*>/giu, tag => tag.replace(/\b((?:xlink:)?href)\s*=\s*(["'])([^"']+)\2/giu,
      (whole, name: string, quote: string, value: string) => {
        const url = projectAssetUrl(projectPath, value, '', assets)
        return url === null ? whole : `${name}=${quote}${url}${quote}`
      }))
  return rewriteCssAssetUrls(attributes, projectPath, '', assets)
}

/** Create the isolated frame document while sharing project CSS and local assets. */
export function buildPreviewDocument(source: string, projectPath: string | undefined, previewCss: string, assets?: PageAssetView): string {
  if (assets !== undefined) source = source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu,
    (whole, open: string, css: string, close: string) => {
      const compiled = assets.inlineStyles.get(css);
      return compiled === undefined ? whole : `${open}${compiled.replace(/<\/style/giu, '<\\/style')}${close}`;
    })
  const html = projectPath === undefined && assets === undefined ? source : rewriteProjectAssetUrls(source, projectPath ?? '', assets)
  const safeCss = previewCss.replaceAll('</style', '<\\/style')
  const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${safeCss === '' ? '' : `<style>${safeCss}</style>`}</head><body>${html}</body></html>`
  return documentHtml
}

/** Blocks authored scripts before parsing page content while admitting parent-owned WebKit editing callbacks. */
function buildEditableFrameDocument(source: string, projectPath: string | undefined, previewCss: string, assets?: PageAssetView): string {
  // WebKit blocks parent event listeners under sandbox's script flag (bugs.webkit.org/218086).
  // A first-head CSP blocks page scripts, inline handlers and nested active content instead.
  return buildPreviewDocument(source, projectPath, previewCss, assets).replace('<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'">`)
}

/** Join the selected variant of every section into document order for full-page Preview. */
export function selectedPageHtml(page: CopyOSPageDocument): string {
  return page.sections.map(section => section.variants.find(variant => variant.id === section.selectedVariantId)?.html ?? '').join('\n')
}

/** Build one isolated document so page-level layout and interactions work across sections. */
export function buildFullPagePreviewDocument(
  page: CopyOSPageDocument,
  projectPath: string | undefined,
  previewCss: string,
  assets?: PageAssetView,
): string {
  return buildPreviewDocument(selectedPageHtml(page), projectPath, previewCss, assets)
}

function FullPagePreviewFrame({ page, projectPath, previewCss, assets, reportFontErrors, t }: {
  readonly t: Translate
  readonly page: CopyOSPageDocument
  readonly projectPath?: string
  readonly previewCss: string
  readonly assets?: PageAssetView | undefined
  readonly reportFontErrors: PreviewFontReport
}): ReactNode {
  useLayoutEffect(() => assets?.retain(), [assets])
  const frameRef = useRef<HTMLIFrameElement>(null)
  usePagePreviewFonts(frameRef, assets, reportFontErrors)
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    let dispose: (() => void) | undefined
    const configure = (): void => {
      dispose?.()
      if (frame.contentDocument !== null) dispose = installBuilderInteractionRuntime(frame.contentDocument)
    }
    frame.addEventListener('load', configure)
    if (frame.contentDocument?.readyState === 'complete') configure()
    return () => { frame.removeEventListener('load', configure); dispose?.() }
  }, [page, previewCss, projectPath])
  return <iframe ref={frameRef} className={css.fullPagePreviewFrame} title={t('builderVisualPagePreview').replace('{title}', page.title)}
    sandbox="allow-same-origin" srcDoc={buildFullPagePreviewDocument(page, projectPath, previewCss, assets)} />
}

/** Convert preview-only API URLs back to portable project-relative paths before saving. */
export function restoreProjectAssetUrls(source: string, projectPath: string | undefined, assets?: PageAssetView): string {
  if (assets !== undefined) source = source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu,
    (whole, open: string, css: string, close: string) => {
      for (const [original, compiled] of assets.inlineStyles)
        if (css === compiled.replace(/<\/style/giu, '<\\/style')) return `${open}${original}${close}`;
      return whole;
    })
  if (assets !== undefined) for (const [path, url] of assets.urls) source = source.replaceAll(url, path)
  if (assets !== undefined) source = source.replace(PREVIEW_FONT_MARKER, (whole, id: string) => assets.fontFaces.get(id)?.css ?? whole)
  if (projectPath === undefined) return source
  const root = `${projectPath.replace(/\/+$/u, '')}/`
  return source.replace(/(?:https?:\/\/[^/"'()\s<>]+)?\/api\/file\?path=([^"'()\s<>]+)/giu,
    (whole, encoded: string) => {
      try {
        const absolute = decodeURIComponent(encoded).split(/[?#]/u, 1)[0] ?? ''
        return absolute.startsWith(root) ? absolute.slice(root.length) : whole
      } catch { return whole }
    })
}

function parseJson(value: string): unknown {
  if (value === '') return null
  try { return JSON.parse(value) }
  catch { return null }
}

function readElementTemplatePayload(value: string): { readonly kind: 'template'; readonly html: string } | null {
  const parsed = parseJson(value)
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as { readonly kind?: unknown; readonly html?: unknown }
  return candidate.kind === 'template' && typeof candidate.html === 'string'
    ? { kind: 'template', html: candidate.html }
    : null
}

function readExistingElementPayload(value: string): ExistingElementDragPayload | null {
  const parsed = parseJson(value)
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Partial<Record<keyof ExistingElementDragPayload, unknown>>
  return candidate.kind === 'element'
    && typeof candidate.sourceSectionId === 'string'
    && typeof candidate.sourceVariantId === 'string'
    && typeof candidate.sourceHtml === 'string'
    && typeof candidate.blockId === 'string'
    && typeof candidate.elementHtml === 'string'
    ? {
      kind: 'element',
      sourceSectionId: candidate.sourceSectionId,
      sourceVariantId: candidate.sourceVariantId,
      sourceHtml: candidate.sourceHtml,
      blockId: candidate.blockId,
      elementHtml: candidate.elementHtml,
    }
    : null
}

/** Install safe, declarative interactions without executing arbitrary section scripts in Build mode. */
export function installBuilderInteractionRuntime(document: Document): () => void {
  const frameWindow = document.defaultView
  if (frameWindow === null) return () => undefined
  const style = document.createElement('style')
  style.dataset.copyosInteractionStyle = 'true'
  style.textContent = [
    '.benefit-list .benefit-row{cursor:pointer}',
    '.benefit-list .benefit-row:not(.active)>p{display:none}',
    '[data-copyos-accordion-item]{cursor:pointer}',
    '[data-copyos-accordion-item]:not([data-copyos-expanded=true])>[data-copyos-accordion-panel]{display:none}',
  ].join('')
  document.head.append(style)

  const setGenericAccordionState = (item: HTMLElement, expanded: boolean): void => {
    item.dataset.copyosExpanded = String(expanded)
    item.classList.toggle('active', expanded)
    item.setAttribute('aria-expanded', String(expanded))
    const trigger = item.querySelector<HTMLElement>('[data-copyos-accordion-trigger]')
    trigger?.setAttribute('aria-expanded', String(expanded))
    const mediaId = item.dataset.copyosMedia
    const section = item.closest<HTMLElement>('section')
    if (expanded && mediaId !== undefined && section !== null) {
      for (const media of section.querySelectorAll<HTMLElement>('[data-copyos-accordion-media]')) {
        media.hidden = media.dataset.copyosAccordionMedia !== mediaId
      }
    }
  }
  const activateFeatureMenu = (menu: HTMLElement): void => {
    const list = menu.closest<HTMLElement>('[data-features-accordion]')
    const section = menu.closest<HTMLElement>('section') ?? menu.parentElement
    const input = menu.querySelector<HTMLInputElement>(':scope > input')
    if (list === null || input === null) return
    for (const candidate of list.querySelectorAll<HTMLInputElement>('.drop-menu > input')) candidate.checked = candidate === input
    const activeId = menu.dataset.dropId
    if (section !== null && activeId !== undefined) {
      for (const panel of section.querySelectorAll<HTMLElement>('[data-feature-image]')) {
        panel.hidden = panel.dataset.featureImage !== activeId
      }
    }
  }
  const handleClick = (event: Event): void => {
    const target = event.target instanceof frameWindow.Element ? event.target : null
    if (target === null || target.closest('.copyos-element-handle') !== null) return

    const genericItem = target.closest<HTMLElement>('[data-copyos-accordion-item]')
    if (genericItem !== null) {
      const group = genericItem.closest<HTMLElement>('[data-copyos-accordion]')
      const expanded = genericItem.dataset.copyosExpanded === 'true'
      if (group !== null && !group.hasAttribute('data-copyos-accordion-multiple')) {
        for (const item of group.querySelectorAll<HTMLElement>('[data-copyos-accordion-item]')) {
          setGenericAccordionState(item, false)
        }
      }
      setGenericAccordionState(genericItem, !expanded)
      return
    }

    const featureMenu = target.closest<HTMLElement>('[data-features-accordion] .drop-menu')
    if (featureMenu !== null) {
      event.preventDefault()
      activateFeatureMenu(featureMenu)
      return
    }

    const benefitRow = target.closest<HTMLElement>('.benefit-list .benefit-row')
    if (benefitRow !== null) {
      const list = benefitRow.parentElement
      if (list !== null) {
        for (const row of list.querySelectorAll<HTMLElement>(':scope > .benefit-row')) {
          const active = row === benefitRow
          row.classList.toggle('active', active)
          row.setAttribute('aria-expanded', String(active))
        }
      }
      return
    }

    const faqButton = target.closest<HTMLElement>('.faq-item > button')
    if (faqButton !== null) {
      const item = faqButton.closest<HTMLElement>('.faq-item')
      if (item !== null) {
        const expanded = item.classList.toggle('open')
        faqButton.setAttribute('aria-expanded', String(expanded))
      }
      return
    }

    const tab = target.closest<HTMLElement>('[role=tab],.tabs .tab')
    if (tab !== null) {
      const tabList = tab.closest<HTMLElement>('[role=tablist],.tabs')
      for (const candidate of tabList?.querySelectorAll<HTMLElement>('[role=tab],.tab') ?? []) {
        const active = candidate === tab
        candidate.classList.toggle('active', active)
        candidate.setAttribute('aria-selected', String(active))
      }
    }
  }
  document.addEventListener('click', handleClick)
  return () => { document.removeEventListener('click', handleClick); style.remove() }
}

/** Keep element actions anchored across iframe, canvas, and window scrolling. */
function SelectionToolbar({ sectionRef, selection, label, children }: {
  sectionRef: RefObject<HTMLElement | null>
  selection: ElementSelection | null
  label: string
  children: ReactNode
}): ReactNode {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 0, visible: false })
  useEffect(() => {
    if (selection === null) return
    const section = sectionRef.current
    const toolbar = toolbarRef.current
    if (section === null || toolbar === null) return
    const frame = section.querySelector('iframe')
    const canvas = section.closest(`.${css.builderCanvasScroll}`)
    const update = (): void => {
      const selected = frame?.contentDocument?.querySelector('[data-copyos-selected]')
      const rect = selected?.getBoundingClientRect()
      const frameRect = frame?.getBoundingClientRect()
      const scale = frame ? frameScale(frame) : 1
      const left = rect && frameRect ? frameRect.left + rect.left * scale : selection.viewportLeft
      const top = rect && frameRect ? frameRect.top + rect.top * scale : selection.viewportTop
      const width = rect ? rect.width * scale : selection.width
      const height = rect ? rect.height * scale : selection.height
      const bounds = canvas?.getBoundingClientRect()
      const clip = bounds && bounds.width > 0 ? {
        left: Math.max(0, bounds.left), right: Math.min(window.innerWidth, bounds.right),
        top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom),
      } : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
      const size = toolbar.getBoundingClientRect()
      const margin = 8
      const mobile = window.innerWidth <= 640
      const above = top - size.height - margin
      const below = top + height + margin
      setPosition({
        maxWidth: Math.max(0, (mobile ? window.innerWidth : clip.right - clip.left) - margin * 2),
        left: mobile ? margin : Math.max(clip.left + margin, Math.min(left, clip.right - size.width - margin)),
        top: mobile ? window.innerHeight - size.height - margin : Math.max(clip.top + margin, Math.min(
          above >= clip.top + margin ? above : below + size.height <= clip.bottom - margin ? below : clip.top + margin,
          clip.bottom - size.height - margin)),
        visible: top + height >= clip.top && top <= clip.bottom && left + width >= clip.left && left <= clip.right,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar); observer.observe(section)
    if (frame?.contentDocument?.body) observer.observe(frame.contentDocument.body)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    frame?.contentDocument?.addEventListener('scroll', update, true)
    const refresh = window.requestAnimationFrame(update)
    return () => {
      observer.disconnect(); window.cancelAnimationFrame(refresh)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      frame?.contentDocument?.removeEventListener('scroll', update, true)
    }
  }, [sectionRef, selection])
  const toolbar = <div ref={toolbarRef} className={`${css.visualSectionToolbar} ${selection === null ? '' : css.elementSelectionToolbar}`}
    role="toolbar" aria-label={label} onClick={(event) => { event.stopPropagation() }} style={selection === null ? undefined : {
      left: position.left, top: position.top, maxWidth: position.maxWidth, visibility: position.visible ? 'visible' : 'hidden',
    }}>{children}</div>
  return selection === null ? toolbar : createPortal(toolbar, document.body)
}

function EditableSectionFrame({
  title, html, projectPath, previewCss, assets, reportFontErrors, sectionId, variantId, editable, selectedElementIndex, selectedElementId, t,
  onSelect, onSelectElement, onMeasureSpacing, onCommit, onDirty, onMoveAcrossSections, commentPlacement, onCancelCommentPlacement,
}: {
  title: string
  html: string
  t: Translate
  projectPath?: string
  previewCss: string
  assets?: PageAssetView | undefined
  reportFontErrors: PreviewFontReport
  sectionId: string
  variantId: string
  editable: boolean
  selectedElementIndex: number | null
  selectedElementId?: string | undefined
  commentPlacement: boolean
  onCancelCommentPlacement: () => void
  onSelect: () => void
  onSelectElement: (element: ElementSelection) => void
  onMeasureSpacing: (measurement: SectionSpacingMeasurement) => void
  onCommit: (html: string) => void
  onDirty: (dirty: boolean) => void
  onMoveAcrossSections: (request: ElementMoveRequest) => void
}): ReactNode {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(180)
  const lastHtml = useRef(html)
  const comparisonHtml = useRef<string | null>(null)
  const changed = useRef(false)
  const dirtyCallback = useRef(onDirty)
  dirtyCallback.current = onDirty
  const commitCallback = useRef(onCommit)
  commitCallback.current = onCommit
  const selectCallback = useRef(onSelect)
  selectCallback.current = onSelect
  const selectElementCallback = useRef(onSelectElement)
  selectElementCallback.current = onSelectElement
  const preservedSelection = useRef<{ document: Document; range: Range; backward: boolean } | undefined>(undefined)
  const moveCallback = useRef(onMoveAcrossSections)
  moveCallback.current = onMoveAcrossSections
  useEffect(() => {
    const clearDirty = dirtyCallback.current
    return () => { clearDirty(false) }
  }, [sectionId, variantId])
  const measureSpacingRef = useRef(onMeasureSpacing)
  measureSpacingRef.current = onMeasureSpacing

  const [renderedFrame, setFrame] = useState(() => ({ source: buildEditableFrameDocument(html, projectPath, previewCss, assets), assets }))
  const frameSource = renderedFrame.source
  const frameConfiguration = useRef({ editable, frameSource, sectionId, variantId, commentPlacement })
  frameConfiguration.current = { editable, frameSource, sectionId, variantId, commentPlacement }
  useLayoutEffect(() => renderedFrame.assets?.retain(), [renderedFrame.assets])
  usePagePreviewFonts(frameRef, renderedFrame.assets, reportFontErrors)
  const frameAssets = useRef({ projectPath, previewCss, assets })
  useEffect(() => {
    // Keep the focused editor stable before its first input, as well as while it has unsaved text.
    const focusedEditor = frameRef.current?.contentDocument?.activeElement?.closest('[contenteditable="true"],[contenteditable="plaintext-only"]')
    if (changed.current || focusedEditor) return
    if (html === lastHtml.current && projectPath === frameAssets.current.projectPath
      && previewCss === frameAssets.current.previewCss && assets === frameAssets.current.assets) return
    lastHtml.current = html; comparisonHtml.current = null
    frameAssets.current = { projectPath, previewCss, assets }
    setFrame({ source: buildEditableFrameDocument(html, projectPath, previewCss, assets), assets })
  })

  const configure = (): (() => void) | undefined => {
    if (!changed.current) comparisonHtml.current = null
    const frame = frameRef.current
    const document = frame?.contentDocument
    if (frame === null || document === undefined || document === null) return undefined
    const head = document.head, body = document.body
    if (document.readyState !== 'complete' || head === null || body === null) return undefined
    const frameWindow = document.defaultView
    if (frameWindow === null) return undefined
    const style = document.createElement('style')
    style.dataset.copyosEditorStyle = 'true'
    style.textContent = [
      'html,body{margin:0;min-height:1px;overflow:hidden}',
      '*{box-sizing:border-box}a{cursor:default}',
      commentPlacement ? `html,body,body *{cursor:${COMMENT_CURSOR}!important;user-select:none!important}` : '',
      '[data-copyos-element][data-copyos-editor-positioned]{position:relative}',
      '[data-copyos-element][contenteditable=true]:hover{outline:2px solid rgba(65,118,230,.16);outline-offset:2px}',
      '[data-copyos-element][contenteditable=true]:focus{outline:2px solid #4176e6;outline-offset:2px}',
      '[data-copyos-element][data-copyos-selected=true]{outline:2px solid #4176e6;outline-offset:2px}',
      '.copyos-element-handle{position:fixed;z-index:20;display:none;width:24px;height:24px;padding:0;',
      'border:1px solid rgba(0,0,0,.14);border-radius:6px;background:rgba(255,255,255,.96);color:#61666b;',
      'font:12px system-ui;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.1)}',

      '.copyos-element-handle:active{cursor:grabbing}.copyos-element-dragging{opacity:.42}',
      '.copyos-element-drop-marker{position:fixed;z-index:2147483647;display:none;border-radius:999px;',
      'background:#4176e6;pointer-events:none;box-shadow:0 0 0 3px rgba(65,118,230,.16)}',
      '.copyos-element-drop-marker[data-visible=true]{display:block}',
    ].join('')
    head.append(style)
    const marker = document.createElement('div')
    marker.className = 'copyos-element-drop-marker'
    marker.setAttribute('aria-hidden', 'true')
    body.append(marker)
    const disposeInteractions = installBuilderInteractionRuntime(document)
    let dragged: HTMLElement | null = null
    let disposed = false
    let markerTarget: HTMLElement | null = null
    let markerBefore = false
    const candidates = editableElements(body)
    const styleCandidates = styleableElements(body)
    const newBlockId = (): string => `block-${randomUUID()}`
    const ensureBlockId = (element: Element): string => {
      const existing = element.getAttribute('data-copyos-block-id')
      if (existing !== null) return existing
      const id = newBlockId(); element.setAttribute('data-copyos-block-id', id); return id
    }
    const unwrapQuestion = (host: Element): void => { host.replaceWith(...host.childNodes) }
    const cleanEditorMarkup = (root: HTMLElement): void => {
      root.querySelectorAll(`[${QUESTION_EDITOR_ATTRIBUTE}]`).forEach(unwrapQuestion)
      root.querySelectorAll('.copyos-element-handle,.copyos-element-drop-marker').forEach((node) => { node.remove() })
      root.querySelectorAll<HTMLElement>('[data-copyos-selected]').forEach((node) => { node.removeAttribute('data-copyos-selected') })
      root.querySelectorAll<HTMLElement>('[data-copyos-element]').forEach((node) => {
        node.removeAttribute('data-copyos-element'); node.removeAttribute('contenteditable')
        node.removeAttribute('data-copyos-editor-positioned')
        node.classList.remove('copyos-element-dragging')
        if (node.className === '') node.removeAttribute('class')
      })
    }
    // scrollHeight on <html> is at least the iframe viewport: it cannot shrink after a collapse.
    const resize = (): void => {
      if (disposed || frame.contentDocument !== document || !frame.isConnected) return
      setHeight(measureSectionFrameHeight(document))
      const root = body.querySelector<HTMLElement>('section') ?? body.firstElementChild
      if (!(root instanceof frameWindow.HTMLElement)) return
      const marked = root.hasAttribute('data-copyos-spacing-container') ? root
        : root.querySelector<HTMLElement>('[data-copyos-spacing-container]')
      const content = [...root.children].filter(child => !child.matches('style,script,link'))
      const computed = frameWindow.getComputedStyle(root)
      const child = content.length === 1 && content[0]?.matches('div,main,article') ? content[0] : undefined
      const target = marked ?? (Number.parseFloat(computed.paddingTop || '0') === 0
        && Number.parseFloat(computed.paddingBottom || '0') === 0 ? child ?? root : root)
      const padding = frameWindow.getComputedStyle(target)
      measureSpacingRef.current({ variantId, targetId: ensureBlockId(target), targetIndex: styleCandidates.indexOf(target as HTMLElement),
        paddingTop: padding.paddingTop, paddingBottom: padding.paddingBottom })
    }
    const serialize = (): string => {
      const clone = body.cloneNode(true) as HTMLElement
      cleanEditorMarkup(clone)
      const source = document.createElement('template')
      source.innerHTML = lastHtml.current
      const existingStylesheets = new Set([...clone.querySelectorAll('link')].map(link => link.getAttribute('href')))
      const stylesheets = [...source.content.querySelectorAll('link[rel~="stylesheet"]')]
        .filter(link => !existingStylesheets.has(link.getAttribute('href')))
        .map(link => link.outerHTML).join('')
      return stylesheets + restoreProjectAssetUrls(clone.innerHTML.trim(), projectPath, renderedFrame.assets)
    }
    const serializeElement = (element: HTMLElement): string => {
      const clone = element.cloneNode(true) as HTMLElement
      clone.removeAttribute('data-copyos-element'); clone.removeAttribute('contenteditable')
      clone.removeAttribute('data-copyos-editor-positioned')
      clone.removeAttribute('data-copyos-selected')
      clone.classList.remove('copyos-element-dragging')
      clone.querySelectorAll('.copyos-element-handle').forEach((node) => { node.remove() })
      clone.querySelectorAll<HTMLElement>('[data-copyos-selected]').forEach((node) => { node.removeAttribute('data-copyos-selected') })
      if (clone.className === '') clone.removeAttribute('class')
      return clone.outerHTML
    }
    const commit = (): void => {
      if (disposed || !changed.current) return
      copyGuards.forEach((guard) => { guard.repair(true) })
      const next = serialize()
      changed.current = false
      if (next !== '' && next !== comparisonHtml.current) {
        lastHtml.current = next; comparisonHtml.current = next; commitCallback.current(next)
      }
      dirtyCallback.current(false)
    }
    const hideMarker = (): void => {
      marker.dataset.visible = 'false'; markerTarget = null; markerBefore = false
    }
    const acceptsElement = (dataTransfer: DataTransfer | null): boolean => dataTransfer !== null
      && (Array.from(dataTransfer.types).includes(ELEMENT_DRAG_TYPE)
        || Array.from(dataTransfer.types).includes(ELEMENT_TEMPLATE_DRAG_TYPE))
    const placeMarker = (event: globalThis.DragEvent): void => {
      const eventTarget = event.target instanceof frameWindow.Element ? event.target : null
      const target = eventTarget?.closest<HTMLElement>('[data-copyos-element]') ?? null
      if (target === dragged) { hideMarker(); return }
      markerTarget = target
      if (target === null) {
        const container = document.querySelector<HTMLElement>('section') ?? body
        const rect = container.getBoundingClientRect()
        markerBefore = false
        Object.assign(marker.style, { left: `${rect.left + 12}px`, top: `${Math.max(rect.top, rect.bottom - 2)}px`, width: `${Math.max(32, rect.width - 24)}px`, height: '3px' })
      } else {
        const rect = target.getBoundingClientRect()
        const parentStyle = target.parentElement === null ? null : frameWindow.getComputedStyle(target.parentElement)
        const horizontal = parentStyle !== null && (parentStyle.display.includes('grid')
          || (parentStyle.display.includes('flex') && !parentStyle.flexDirection.startsWith('column')))
        markerBefore = horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2
        Object.assign(marker.style, horizontal
          ? { left: `${markerBefore ? rect.left : rect.right - 2}px`, top: `${rect.top + 4}px`, width: '3px', height: `${Math.max(24, rect.height - 8)}px` }
          : { left: `${rect.left + 8}px`, top: `${markerBefore ? rect.top : rect.bottom - 2}px`, width: `${Math.max(32, rect.width - 16)}px`, height: '3px' })
      }
      marker.dataset.visible = 'true'
    }
    const insertAtMarker = (element: HTMLElement): void => {
      if (markerTarget === null) {
        const container = document.querySelector<HTMLElement>('section') ?? body
        container.append(element)
        return
      }
      markerTarget.parentElement?.insertBefore(element, markerBefore ? markerTarget : markerTarget.nextSibling)
    }
    const createElement = (elementHtml: string): HTMLElement | null => {
      const template = document.createElement('template')
      template.innerHTML = elementHtml.trim()
      const element = template.content.firstElementChild
      return element instanceof frameWindow.HTMLElement ? element : null
    }
    for (const element of styleCandidates) ensureBlockId(element)
    const selectedStyleElement = resolveStyleElement(body, selectedElementIndex ?? -1, selectedElementId)
    if (selectedStyleElement !== undefined) selectedStyleElement.dataset.copyosSelected = 'true'
    const handleTargets = new Map<Element, HTMLElement>()
    const handleDisposers: (() => void)[] = []
    const shownCopy = (copy: HTMLElement): boolean => frameWindow.getComputedStyle(copy).display !== 'none'
    const copyGuards = new Map<HTMLElement, TextCopyGuard>()
    for (const element of candidates) {
      element.dataset.copyosElement = 'true'
      ensureBlockId(element)
      if (editable) element.contentEditable = 'true'
      if (!editable) continue
      const guard = guardTextCopies(element, shownCopy)
      if (guard !== undefined) copyGuards.set(element, guard)
      const handle = document.createElement('span')
      handle.textContent = '⠿'; handle.contentEditable = 'false'; handle.draggable = true; handle.tabIndex = 0
      handle.className = 'copyos-element-handle'; handle.setAttribute('aria-label', `Move ${element.tagName.toLowerCase()}`)
      handle.setAttribute('role', 'button')
      handle.addEventListener('dragstart', (event) => {
        dragged = element; element.classList.add('copyos-element-dragging')
        const blockId = ensureBlockId(element)
        const payload: ExistingElementDragPayload = {
          kind: 'element', sourceSectionId: sectionId, sourceVariantId: variantId,
          sourceHtml: serialize(), blockId, elementHtml: serializeElement(element),
        }
        if (event.dataTransfer !== null) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', `buzz-builder-element:${blockId}`)
          event.dataTransfer.setData(ELEMENT_DRAG_TYPE, JSON.stringify(payload))
        }
      })
      handle.addEventListener('dragend', () => {
        element.classList.remove('copyos-element-dragging'); dragged = null; hideMarker()
      })
      handleTargets.set(handle, element)
      const showHandle = (): void => {
        const bounds = element.getBoundingClientRect()
        Object.assign(handle.style, { display: 'block', left: `${bounds.left + 2}px`, top: `${bounds.top + 2}px` })
      }
      const hideHandle = (event: MouseEvent): void => { if (event.relatedTarget !== handle) handle.style.display = 'none' }
      handleDisposers.push(() => { element.removeEventListener('mouseenter', showHandle); element.removeEventListener('mouseleave', hideHandle) })
      element.addEventListener('mouseenter', showHandle)
      element.addEventListener('mouseleave', hideHandle)
      handle.addEventListener('mouseleave', () => { handle.style.display = 'none' })
      body.append(handle)
    }

    const handleDocumentDragOver = (event: globalThis.DragEvent): void => {
      if (!editable || !acceptsElement(event.dataTransfer)) return
      event.preventDefault(); event.stopPropagation()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(ELEMENT_TEMPLATE_DRAG_TYPE) ? 'copy' : 'move'
      placeMarker(event)
    }
    const handleDocumentDrop = (event: globalThis.DragEvent): void => {
      if (!editable || !acceptsElement(event.dataTransfer)) return
      event.preventDefault(); event.stopPropagation()
      const templatePayload = event.dataTransfer?.getData(ELEMENT_TEMPLATE_DRAG_TYPE) ?? ''
      if (templatePayload !== '') {
        selectCallback.current()
        const parsed = readElementTemplatePayload(templatePayload)
        const element = parsed === null ? null : createElement(parsed.html)
        if (element !== null) {
          freshElementIds(element); insertAtMarker(element); changed.current = true; hideMarker(); resize(); commit()
        }
        return
      }
      const existingPayload = readExistingElementPayload(event.dataTransfer?.getData(ELEMENT_DRAG_TYPE) ?? '')
      if (existingPayload === null) return
      if (existingPayload.sourceSectionId === sectionId && existingPayload.sourceVariantId === variantId) {
        selectCallback.current()
        const element = dragged ?? [...document.querySelectorAll<HTMLElement>('[data-copyos-block-id]')]
          .find(item => item.dataset.copyosBlockId === existingPayload.blockId) ?? null
        if (element !== null && element !== markerTarget) {
          insertAtMarker(element); changed.current = true; hideMarker(); resize(); commit()
        }
        return
      }
      const element = createElement(existingPayload.elementHtml)
      if (element === null) return
      element.dataset.copyosBlockId = existingPayload.blockId
      insertAtMarker(element); hideMarker(); resize()
      moveCallback.current({
        ...existingPayload, targetSectionId: sectionId, targetVariantId: variantId, targetHtml: serialize(),
      })
    }
    const copyGuardFor = (event: Event): TextCopyGuard | undefined => {
      const host = event.target instanceof frameWindow.Element ? event.target.closest<HTMLElement>('[data-copyos-element]') : null
      return host === null ? undefined : copyGuards.get(host)
    }
    const questionEditor = (target: EventTarget | null): HTMLElement | null =>
      target instanceof frameWindow.Node ? (target instanceof frameWindow.Element ? target : target.parentElement)
        ?.closest<HTMLElement>(`[${QUESTION_EDITOR_ATTRIBUTE}]`) ?? null : null
    // A disclosure question toggles its answer on click, Space and Enter and swallows Space as an editing host, so double-click
    // wraps its shown text in a temporary inline editing span instead; single clicks keep opening and closing the answer.
    const handleDoubleClick = (event: MouseEvent): void => {
      if (!editable || commentPlacement) return
      const eventTarget = event.target instanceof frameWindow.Element ? event.target : null
      const question = eventTarget?.closest<HTMLElement>('details > summary') ?? null
      if (question === null || question.closest('[contenteditable=true]') !== null) return
      const container = [...question.querySelectorAll<HTMLElement>(BREAKPOINT_VARIANT_QUERY)].find(shownCopy) ?? question
      const host = document.createElement('span')
      host.setAttribute(QUESTION_EDITOR_ATTRIBUTE, 'true'); host.contentEditable = 'true'
      host.append(...container.childNodes); container.append(host)
      host.focus()
      // Older engines and jsdom lack caretPositionFromPoint; the caret then goes to the end of the question.
      const caret = 'caretPositionFromPoint' in document ? document.caretPositionFromPoint(event.clientX, event.clientY) : null
      const selection = document.getSelection()
      if (selection === null) return
      if (caret && host.contains(caret.offsetNode)) selection.collapse(caret.offsetNode, caret.offset)
      else { selection.selectAllChildren(host); selection.collapseToEnd() }
    }
    const handleQuestionKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') questionEditor(event.target)?.blur()
    }
    // A paragraph break would clone the shown copy wrapper into a new block; line breaks stay inside the copy.
    const handleBeforeInput = (event: InputEvent): void => {
      if (questionEditor(event.target) !== null) { if (event.inputType === 'insertParagraph') event.preventDefault(); return }
      const guard = copyGuardFor(event)
      if (guard === undefined) return
      if (event.inputType === 'insertParagraph') { event.preventDefault(); return }
      guard.capture()
    }
    const handleInput = (event: Event): void => {
      copyGuardFor(event)?.repair()
      changed.current = true; dirtyCallback.current(true); resize()
    }
    const handleFocusOut = (event: FocusEvent): void => {
      const question = questionEditor(event.target)
      if (question !== null) unwrapQuestion(question)
      commit()
    }
    const selectTarget = (target: HTMLElement | null): void => {
      selectCallback.current()
      if (target === null) return
      const index = styleCandidates.indexOf(target)
      const shownKey = [...target.querySelectorAll<HTMLElement>(BREAKPOINT_VARIANT_QUERY)].find(shownCopy)?.dataset.copyosTextVariant
      const text = textCopyLabel(target, shownKey)
      const rect = target.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const scale = frameScale(frame)
      const computed = frameWindow.getComputedStyle(target)
      selectElementCallback.current({
        id: ensureBlockId(target), sectionId, variantId,
        index,
        tag: target.tagName.toLowerCase(),
        label: text.slice(0, 44) || target.tagName.toLowerCase(),
        width: rect.width * scale,
        height: rect.height * scale,
        font: `${computed.fontSize} ${computed.fontWeight} ${computed.fontFamily.split(',')[0] ?? ''}`.trim(),
        lineHeight: computed.lineHeight,
        color: computed.color,
        computedStyle: { fontSize: computed.fontSize, fontFamily: computed.fontFamily, fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing, textAlign: computed.textAlign, direction: computed.direction, color: computed.color },
        spacing: { paddingTop: computed.paddingTop, paddingRight: computed.paddingRight,
          paddingBottom: computed.paddingBottom, paddingLeft: computed.paddingLeft,
          marginTop: computed.marginTop, marginBottom: computed.marginBottom },
        textCopies: shownKey !== undefined,
        question: editable && target.closest('details > summary') !== null,
        viewportLeft: frameRect.left + rect.left * scale,
        viewportTop: frameRect.top + rect.top * scale,
      })
    }
    const selectedTextTarget = (): HTMLElement | null => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
      const ancestor = selection.getRangeAt(0).commonAncestorContainer
      if (!body.contains(ancestor)) return null
      const element = ancestor instanceof frameWindow.Element ? ancestor : ancestor.parentElement
      if (!element || element.closest(`[${QUESTION_EDITOR_ATTRIBUTE}]`)) return null
      return styleTarget(element)
    }
    const handleTextSelection = (event: Event): void => {
      if (!editable || commentPlacement || event instanceof frameWindow.KeyboardEvent && event.isComposing) return
      if (event.target instanceof frameWindow.Element && event.target.closest('input,textarea,select,.copyos-element-handle')) return
      const target = selectedTextTarget()
      if (target !== null) selectTarget(target)
    }
    const handleClick = (event: Event): void => {
      if (commentPlacement) { event.preventDefault(); event.stopImmediatePropagation() }
      // Clicks inside an edited question place the caret; they neither toggle the answer nor change the selection.
      if (questionEditor(event.target) !== null) { event.preventDefault(); return }
      const eventTarget = event.target instanceof frameWindow.Element ? event.target : null
      const handle = eventTarget?.closest('.copyos-element-handle')
      const selectionTarget = (handle === undefined || handle === null ? undefined : handleTargets.get(handle)) ?? eventTarget
      const hit = selectionTarget ? styleTarget(selectionTarget) : null
      const textTarget = commentPlacement || handle ? null : selectedTextTarget()
      const target = textTarget && eventTarget && textTarget.contains(eventTarget) ? textTarget : hit
      if (eventTarget !== null && eventTarget.closest('a,button:not(.copyos-element-handle):not([popovertarget])') !== null) event.preventDefault()
      selectTarget(target)
    }
    const handleDocumentDragLeave = (event: globalThis.DragEvent): void => { if (event.relatedTarget === null) hideMarker() }
    const handlePlacementPointer = (event: Event): void => { if (commentPlacement) event.preventDefault() }
    const handlePlacementKey = (event: KeyboardEvent): void => {
      if (commentPlacement && event.key === 'Escape') { event.preventDefault(); onCancelCommentPlacement() }
    }
    comparisonHtml.current ??= serialize()
    document.addEventListener('pointerdown', handlePlacementPointer, true)
    document.addEventListener('keydown', handlePlacementKey)
    document.addEventListener('beforeinput', handleBeforeInput)
    document.addEventListener('dblclick', handleDoubleClick)
    document.addEventListener('keydown', handleQuestionKey)
    document.addEventListener('input', handleInput)
    document.addEventListener('focusout', handleFocusOut)
    document.addEventListener('click', handleClick, commentPlacement)
    document.addEventListener('pointerup', handleTextSelection)
    document.addEventListener('keyup', handleTextSelection)
    document.addEventListener('dragenter', handleDocumentDragOver)
    document.addEventListener('dragover', handleDocumentDragOver)
    document.addEventListener('drop', handleDocumentDrop)
    document.addEventListener('dragleave', handleDocumentDragLeave)
    const observer = new ResizeObserver(resize); observer.observe(body); resize()
    return () => {
      disposed = true
      handleDisposers.forEach((dispose) => { dispose() })
      observer.disconnect(); disposeInteractions(); cleanEditorMarkup(body); marker.remove(); style.remove()
      document.removeEventListener('beforeinput', handleBeforeInput)
      document.removeEventListener('dblclick', handleDoubleClick); document.removeEventListener('keydown', handleQuestionKey)
      document.removeEventListener('pointerup', handleTextSelection); document.removeEventListener('keyup', handleTextSelection)
      document.removeEventListener('input', handleInput); document.removeEventListener('focusout', handleFocusOut); document.removeEventListener('click', handleClick, commentPlacement)
      document.removeEventListener('pointerdown', handlePlacementPointer, true); document.removeEventListener('keydown', handlePlacementKey)
      document.removeEventListener('dragenter', handleDocumentDragOver); document.removeEventListener('dragover', handleDocumentDragOver); document.removeEventListener('drop', handleDocumentDrop); document.removeEventListener('dragleave', handleDocumentDragLeave)
    }
  }

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    let dispose: (() => void) | undefined
    const onLoad = (): void => {
      const held = preservedSelection.current
      preservedSelection.current = undefined
      dispose?.(); dispose = configure()
      const body = frame.contentDocument?.body
      if (body && held && held.document === body.ownerDocument && !held.range.collapsed
        && body.contains(held.range.startContainer) && body.contains(held.range.endContainer)) {
        const range = held.range
        held.document.getSelection()?.setBaseAndExtent(
          held.backward ? range.endContainer : range.startContainer, held.backward ? range.endOffset : range.startOffset,
          held.backward ? range.startContainer : range.endContainer, held.backward ? range.startOffset : range.endOffset,
        )
      }
    }
    frame.addEventListener('load', onLoad)
    if (frame.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      frame.removeEventListener('load', onLoad)
      const document = frame.contentDocument, selection = document?.getSelection(), next = frameConfiguration.current
      const outlineOnly = next.editable === editable && next.frameSource === frameSource && next.sectionId === sectionId
        && next.variantId === variantId && next.commentPlacement === commentPlacement
      if (outlineOnly && document && selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0).cloneRange()
        preservedSelection.current = { document, range, backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset }
      } else preservedSelection.current = undefined
      dispose?.()
    }
  }, [editable, frameSource, sectionId, selectedElementIndex, selectedElementId, variantId, commentPlacement])

  return <iframe ref={frameRef} className={css.visualSectionFrame} style={{ height }} title={t('builderVisualSectionCanvas').replace('{title}', title)}
    sandbox="allow-same-origin allow-scripts" srcDoc={frameSource} />
}

function SectionCopyPreview({ html }: { html: string }): ReactNode {
  const template = document.createElement('template'); template.innerHTML = html
  keepDesktopTextCopies(template.content)
  const copy = template.innerHTML
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .trim()
  return <p className={css.variationCopyPreview}>{copy.length > 260 ? `${copy.slice(0, 257)}…` : copy}</p>
}

function VariationComparison({ section, candidateId, t }: {
  t: Translate
  section: CopyOSPageSection
  candidateId: string | null
}): ReactNode {
  const current = section.variants.find(item => item.id === section.selectedVariantId)
  const candidate = section.variants.find(item => item.id === candidateId)
  if (current === undefined || candidate === undefined) return <p>{t('builderVisualSelectAVariationToCompare')}</p>
  return (
    <div className={css.variationComparison}>
      <article><small>{t('builderVisualCurrent')}{' '}{current.label}</small><iframe title={t('builderVisualCurrentVariation')} sandbox="allow-same-origin" srcDoc={current.html} /></article>
      <article data-candidate="true"><small>{t('builderVisualCandidate')}{' '}{candidate.label}</small><iframe title={t('builderVisualCandidateVariation')} sandbox="allow-same-origin" srcDoc={candidate.html} /></article>
    </div>
  )
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
