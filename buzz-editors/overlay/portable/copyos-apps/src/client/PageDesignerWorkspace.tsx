import { designerWebsiteBuildPrompt } from './DesignerWebsiteBuildPrompt.ts'
/** Native scene designer with project storage, linked components and shared color variables. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useCallback,
  type SetStateAction,
  useLayoutEffect,
  type CSSProperties,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react'
import {
  createDesignNode,
  designPageLinksValid,
  createDesignBoolean,
  fitDesignBooleans,
  designBooleansDocumentValid,
  designBooleanSelection,
  setDesignBooleanOperation,
  ungroupDesignBoolean,
  flattenDesignBoolean,
  parseDesignPathContours,
  reconcileDesignTextHyperlinks,
  designAutoLayoutSuggestionContext,
  suggestDesignAutoLayout,
  type DesignAutoLayoutSuggestionResult,
  setDesignGridCellAlignment,
  type DesignGridCellAlignmentIntent,
  setDesignLayoutVersion,
  type DesignLayoutVersionScope,
  type DesignLayoutVersionModel,
  designNodeCss,
  designTextRangeContext,
  designFontFeatureSettings,
  designFontVariationSettings,
  designTextRunsDocumentValid,
  designEffectsDocumentValid,
  designEffectOpacity,
  designEffectsFilter,
  designLayerBlurFilter,
  designEffectsPassFilter,
  designTextEffectsSourceSvg,
  designEffectsLayerFilter,
  designNodeEffects,
  designSizingContext,
  setDesignSizingPolicy,
  designCanvasBackground,
  resolveDesignCanvasBackground,
  designChildrenInPaintOrder,
  editDesignNodes,
  rebaseDesignDocument,
  editDesignInstanceLayout,
  createDesignInstanceGridCellReader,
  snapshotDesignGeometry,
  captureDesignClipboard,
  importDesignClipboard,
  designImageUrls,
  isDesignImageAssetReference,
  mapDesignImageUrls,
  duplicateDesignNode,
  pruneDesignComponentProperties,
  reconcileDesignComponentProperties,
  reconcileDesignVariants,
  DESIGN_NODE_NAME_MAX_LENGTH,
  designComponentPropertiesValid,
  designComponentGraphValid,
  designVariantsValid,
  combineDesignComponentsAsVariants,
  addDesignVariant,
  dissolveDesignComponentSet,
  designComponentSetDefault,
  designReferencedComponentIds,
  ignoreDesignChildConstraints,
  designDescendants,
  exportDesignSvg,
  designGradientTransform,
  designLayerBlendStyle,
  designTextFillSvg,
  designNodePaints,
  designAuthoredStrokePaints,
  designStrokePaintSvg,
  designTextPaint,
  designTextBaselineSignature,
  designTextOverflow,
  designTextStyleValues,
  designGradientPoints,
  moveDesignGradientHandle,
  designRectanglePath,
  resolveDesignNodes,
  createDesignRenderScene,
  createDesignInstanceContextReader,
  designTextMeasurementCacheCharacters,
  constrainDesignAspectSize,
  designAspectRatioEligible,
  createDesignVisualBounds,
  designGridGeometry,
  designInstanceLayoutBoxes,
  designGridDocumentValid,
  designSizingLimitsValid,
  moveDesignGridNode,
  resizeDesignGridTrack,
  resizeDesignGridCell,
  detachDesignInstance,
  swapDesignInstances,
  resolveDesignModeColors,
  restoreDesignTokenColorLiterals,
  reorderDesignFlowNode,
  addDesignAutoLayout,
  designAutoLayoutContext,
  setDesignAutoLayoutFlow,
  setDesignAutoLayoutAlignment,
  setDesignAutoLayoutPadding,
  type DesignPaddingTarget,
  type DesignPaddingValues,
  type DesignAutoLayoutAlignmentIntent,
  type DesignAlignmentTarget,
  DesignAutoLayoutEditError,
  removeDesignAutoLayout,
  designTextLayoutSignature,
  importDesignStyleGuideTokens,
  exportDesignCss,
  designColorVariableCss,
} from '../../../copyos-domain/src/design-model.ts'
import type {
  CopyOSPageDocument,
  CopyOSDesignPagePreviewRequest,
  CopyOSDesignPagePreview,
  CopyOSDesignPageBuildRequest,
  CopyOSDesignPageBuildResult,
  CopyOSDesignPageUpdateApplyRequest,
  CopyOSDesignPageUpdateRequest,
  CopyOSDesignPageUpdateResult,
  CopyOSDesignPageUpdateReview,
  CopyOSDesignDocument,
  CopyOSDesignFontMetadata,
  CopyOSDesignFontMetadataRequest,
  CopyOSDesignFontFace,
  CopyOSDesignFontInstallRequest,
  CopyOSDesignFontInstallValue,
  CopyOSDesignFontList,
  CopyOSDesignFontListRequest,
  CopyOSCopyDocument,
  CopyOSDesignClipboardSnapshot,
  CopyOSDesignComment,
  CopyOSDesignCommentTarget,
  CopyOSDesignCommentList,
  CopyOSDesignCommentListRequest,
  CopyOSDesignCommentCreateRequest,
  CopyOSDesignCommentStatusRequest,
  CopyOSDesignCommentDeleteRequest,
  CopyOSDesignTemplateList,
  CopyOSDesignTemplateListRequest,
  CopyOSDesignTemplateSaveRequest,
  CopyOSDesignTemplateSummary,
  CopyOSDesignTemplateReadRequest,
  CopyOSDesignTemplateRead,
  CopyOSDesignTemplateDeleteRequest,
  CopyOSDesignFontReadRequest,
  CopyOSDesignFontReadValue,
  CopyOSDesignFontUploadRequest,
  CopyOSDesignNode,
  CopyOSDesignNodeKind,
  CopyOSDesignCreateRequest,
  CopyOSDesignSaveRequest,
  CopyOSDesignImportRequest,
  CopyOSStyleGuideDocument,
  CopyOSDesignImageCopyRequest,
  CopyOSDesignImageRemoveRequest,
  CopyOSDesignImageUnusedRequest,
  CopyOSDesignImageUnusedValue,
  CopyOSDesignImagePutRequest,
  CopyOSDesignImagePutValue,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { DesignerBooleanControls, designerBooleanReason } from './DesignerBooleanControls.tsx'
import { DesignerPageConversionReview } from './DesignerPageConversionReview.tsx'
import { DesignerImageCleanup } from './DesignerImageCleanup.tsx'
import { DesignerBreakpoints } from './DesignerBreakpoints.tsx'
import { DesignerArtboardOutput } from './DesignerArtboardOutput.tsx'
import { indexedDbDesignerDraftStore, type DesignerDraftStore, type DesignerDurableDraft } from './DesignerDraftStore.ts'
import { DesignerPageUpdateReview, type DesignerPageUpdateResolutions } from './DesignerPageUpdateReview.tsx'
import { CanvasPagePreview } from './CanvasPagePreview.tsx'
import { LandingPageWorkspace, buildPageActionPrompt, type PageWorkspaceActions, type SectionPromptIntent } from './LandingPageWorkspace.tsx'
import { DesignerVectorEditor } from './DesignerVectorEditor.tsx'
import { DesignerGeneration, type DesignerGenerationActions } from './DesignerGeneration.tsx'
import { exportDesignSvgWithEditableText } from './DesignerSvgTextLines.ts'
import { createDesignerImageAssets, designImageReplacements, DesignerImageAssetsContext, projectFileImageReader,
  type DesignerImageAssets } from './DesignerImageAssets.ts'
import { useDesignerCrop } from './useDesignerCrop.tsx'
import { DesignerImagePattern } from './DesignerImagePattern.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import { Tooltip, IconDownloadOutlineRegular, IconChevronDownOutlineRegular, type MenuEntry, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerContextMenu } from './DesignerContextMenu.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerHeaderTools, type DesignerReviewMode } from './DesignerHeaderTools.tsx'
import { DesignerCommentsPanel, DesignerReviewOverlay, designerCommentPoint, designerLayersInRegion,
  type DesignerSceneBox } from './DesignerReview.tsx'
import { DesignerBuildFromCopy, designerBuildPrompt, type DesignerBuildRequest } from './DesignerBuildFromCopy.tsx'
import { DesignerTemplatesPanel, type DesignerTemplateActions } from './DesignerTemplatesPanel.tsx'
import { rasterizeDesignArtboard } from './DesignerRasterExport.ts'
import { DesignerToolbar, type DesignerTool } from './DesignerToolbar.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerLayerNameField } from './DesignerLayerNameField.tsx'
import { DESIGNER_LAYER_ROW_HEIGHT, useDesignerLayerWindow } from './DesignerLayerWindow.ts'
import { DesignerTokens } from './DesignerTokens.tsx'
import { DesignerFontReview } from './DesignerFontReview.tsx'
import { designerProjectFontCss, useDesignerProjectFonts, type DesignerProjectFontActions } from './DesignerProjectFonts.ts'
import { DesignerInstanceGridCell, DesignerInstanceCellChooser } from './DesignerInstanceGridCell.tsx'
import { editDesignerStrokeGradient } from './DesignerStrokeEdits.ts'
import { DesignerPageBackground } from './DesignerPageBackground.tsx'
import { DesignerColorResource } from './DesignerColorResource.tsx'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { DesignerModeSelect } from './DesignerModeSelect.tsx'
import { DesignerGridOverlay } from './DesignerGridOverlay.tsx'
import {
  DesignerLayoutOverlay,
  type LayoutField,
} from './DesignerLayoutOverlay.tsx'
import { designerClipboardEditableTarget, readDesignerClipboard, readDesignerClipboardOS, writeDesignerClipboard, writeDesignerClipboardOS } from './DesignerClipboard.ts'
import { designerCanvasContextTarget, type DesignerCanvasContextTarget } from './DesignerCanvasContext.ts'
import { DesignerCodePanel } from './DesignerCodePanel.tsx'
import { DesignerEffects } from './DesignerEffects.tsx'
import { DesignerAutoLayoutSuggestion } from './DesignerAutoLayoutSuggestion.tsx'
import { DesignerLayoutVersion } from './DesignerLayoutVersion.tsx'
import { DesignerSemantics, DesignerSemanticsMulti } from './DesignerSemantics.tsx'
import { DesignerInspector } from './DesignerInspector.tsx'
import { DesignerSaveAdmission } from './DesignerSaveAdmission.ts'
import { DesignerFontMetadataProvider } from './DesignerFontMetadata.tsx'
import { designerAuthoredContentKey } from './DesignerFileSwitch.ts'
import { DesignerInlinePanelHost, InlineDesignText } from './DesignerInlineText.tsx'
import { DesignerTextMetrics } from './DesignerTextMetrics.tsx'
import { DesignerMeasureBatchEnd, DesignerMeasureBatchStart } from './DesignerMeasureBatch.ts'
import { designerMovesOnly } from './DesignerMoveOnly.ts'
import { createDesignerSceneBoxes, designerCullRegion, designerCullState } from './DesignerViewportCull.ts'
import { DESIGNER_CLICK_LAYER_SIZE, designerDrawnBox, designerDrawTarget, designerSceneToLocal,
  type DesignerDrawTarget } from './DesignerDrawTarget.ts'
import {
  readDesignerViewState,
  saveDesignerViewState,
  designerPageViewKey,
} from './DesignerViewState.ts'
import interFont from './fonts/Inter-latin.woff2'
import css from './PageDesignerWorkspace.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string
// Identifies the saved document state a page conversion or update was reviewed against.
interface ConversionOwner { id: string; generation: number; key: string; action: number }
/** Comparison of one saved source artboard with its converted page, keyed by design, frame and both revisions. */
interface PageSyncState { key: string; state: 'checking' | 'current' | 'stale' | 'error'; changes: number; edits: number; conflicts: number }
/** Project-backed operations shared with the agent's design tools. */
export interface PageDesignerActions {
  readonly previewDesignPage?: ((request: CopyOSDesignPagePreviewRequest) => Promise<CopyOSDesignPagePreview>) | undefined
  readonly buildDesignPage?: ((request: CopyOSDesignPageBuildRequest) => Promise<CopyOSDesignPageBuildResult>) | undefined
  readonly reviewDesignPageUpdate?: ((request: CopyOSDesignPageUpdateRequest) => Promise<CopyOSDesignPageUpdateReview>) | undefined
  readonly applyDesignPageUpdate?: ((request: CopyOSDesignPageUpdateApplyRequest) => Promise<CopyOSDesignPageUpdateResult>) | undefined
  readonly getDesignFontMetadata?: (request: CopyOSDesignFontMetadataRequest) => Promise<CopyOSDesignFontMetadata>
  /** Project fonts: list, install from Google Fonts, upload and read; any absent disables project fonts. */
  readonly listDesignFonts?: ((request: CopyOSDesignFontListRequest) => Promise<CopyOSDesignFontList>) | undefined
  readonly installDesignFonts?: ((request: CopyOSDesignFontInstallRequest) => Promise<CopyOSDesignFontInstallValue>) | undefined
  readonly uploadDesignFont?: ((request: CopyOSDesignFontUploadRequest) => Promise<CopyOSDesignFontFace>) | undefined
  readonly readDesignFont?: ((request: CopyOSDesignFontReadRequest) => Promise<CopyOSDesignFontReadValue>) | undefined
  /** Review comments stored beside the design; omission hides Comment and View comments. */
  readonly listDesignComments?: ((request: CopyOSDesignCommentListRequest) => Promise<CopyOSDesignCommentList>) | undefined
  readonly addDesignComment?: ((request: CopyOSDesignCommentCreateRequest) => Promise<CopyOSDesignComment>) | undefined
  readonly setDesignCommentStatus?: ((request: CopyOSDesignCommentStatusRequest) => Promise<CopyOSDesignComment>) | undefined
  readonly deleteDesignComment?: ((request: CopyOSDesignCommentDeleteRequest) => Promise<{ deleted: true }>) | undefined
  /** Shared artboard templates; omission hides Templates. */
  readonly listDesignTemplates?: ((request: CopyOSDesignTemplateListRequest) => Promise<CopyOSDesignTemplateList>) | undefined
  readonly saveDesignTemplate?: ((request: CopyOSDesignTemplateSaveRequest) => Promise<CopyOSDesignTemplateSummary>) | undefined
  readonly readDesignTemplate?: ((request: CopyOSDesignTemplateReadRequest) => Promise<CopyOSDesignTemplateRead>) | undefined
  readonly deleteDesignTemplate?: ((request: CopyOSDesignTemplateDeleteRequest) => Promise<{ deleted: true }>) | undefined
  /** Higgsfield image generation; absent hides the Generate image section. */
  readonly generation?: DesignerGenerationActions | undefined
  /** Store one image as a project file; absent keeps new images embedded until the server converts them on save. */
  readonly putDesignImage?: ((request: CopyOSDesignImagePutRequest) => Promise<CopyOSDesignImagePutValue>) | undefined
  /** Copy referenced project image files from the project a pasted selection came from. */
  readonly copyDesignImages?: ((request: CopyOSDesignImageCopyRequest) => Promise<void>) | undefined
  /** List project images nothing uses; absent hides Clean up unused images. */
  readonly findUnusedDesignImages?: ((request: CopyOSDesignImageUnusedRequest) => Promise<CopyOSDesignImageUnusedValue>) | undefined
  /** Delete confirmed unused project images; returns the files deleted. */
  readonly removeUnusedDesignImages?: ((request: CopyOSDesignImageRemoveRequest) => Promise<CopyOSDesignImageUnusedValue>) | undefined
  readonly decodeDesignClipboard?: (
    request: { workspaceId: string; dataBase64: string },
  ) => Promise<{ document: CopyOSDesignDocument; selectedIds: string[] }>
  readonly getStyleGuide?: (
    workspaceId: string,
  ) => Promise<CopyOSStyleGuideDocument | undefined>
  readonly importDesign: (
    request: CopyOSDesignImportRequest,
  ) => Promise<CopyOSDesignDocument>
  readonly listDesigns: (
    workspaceId: string,
  ) => Promise<readonly CopyOSDesignDocument[]>
  readonly createDesign: (
    request: CopyOSDesignCreateRequest,
  ) => Promise<CopyOSDesignDocument>
  readonly saveDesign: (
    request: CopyOSDesignSaveRequest,
  ) => Promise<CopyOSDesignDocument>
}
/** Selected layers named in one chat note; more are counted, not listed. */
const SELECTION_MENTION_LAYERS = 50

/**
 * Model-visible chat note identifying the design, its saved revision and the selected layers.
 * @param t - Translator for the note label.
 * @param doc - Open design.
 * @param revision - Saved revision the agent should read.
 * @param layers - Selected layers in selection order.
 * @returns One line of text with a JSON payload.
 */
export function designSelectionMention(t: Translate, doc: CopyOSDesignDocument, revision: number,
  layers: readonly CopyOSDesignNode[]): string {
  const payload = {
    design_id: doc.id, design_title: doc.title, revision,
    layers: layers.slice(0, SELECTION_MENTION_LAYERS).map(layer => ({ id: layer.id, name: layer.name, kind: layer.kind })),
    ...(layers.length > SELECTION_MENTION_LAYERS ? { more_layers: layers.length - SELECTION_MENTION_LAYERS } : {}),
  }
  return `${t('designerSelectionMentionLabel')} ${JSON.stringify(payload)}\n`
}

function selectionMentionSummary(t: Translate, layers: readonly CopyOSDesignNode[]): string {
  if (!layers.length) return t('designerMentionWholeDesign')
  const names = layers.slice(0, 2).map(layer => layer.name).join(', ')
  return layers.length > 2 ? `${names} +${String(layers.length - 2)}` : names
}

/** Chat panel width bounds in CSS pixels; the conversation needs more room than the layers list. */
const CHAT_PANEL_WIDTH = { initial: 380, min: 300, max: 640 } as const
interface Props {
  workspaceId: string
  actions: PageDesignerActions
  pageActions?: PageWorkspaceActions | undefined
  projectPath?: string | undefined
  /** Host-owned scoped image transport; replaces the original authenticated file route. */
  readProjectImage?: ((path: string) => Promise<Blob>) | undefined
  /** Keep expanded Canvas inside the owning Buzz pane instead of taking over the host window. */
  contained?: boolean | undefined
  t: Translate
  onStartAgent?: ((prompt: string) => Promise<void>) | undefined
  /** Hand the original structured copy brief to the host's own agent tools. */
  /** Admit the original structured brief through the host; abort pending admission when its panel closes. */
  onBuildFromCopy?: ((request: DesignerBuildRequest, design: { id: string; title: string }, signal: AbortSignal) => Promise<void>) | undefined
  /** Host-specific tool/guide instructions retain the original website-building brief. */
  websiteBuildPrompt?: typeof designerWebsiteBuildPrompt | undefined
  colorScheme?: 'light' | 'dark' | undefined
  /** Durable unsaved-work store; omission uses this origin's IndexedDB. */
  draftStore?: DesignerDraftStore | undefined
  /** `session`: fills its container beside a chat and starts collapsed; `page` (default): the project panel, starting full-window. */
  layout?: 'page' | 'session' | undefined
  /** The session's chat, shown as the left rail's Chat panel; omission removes the Chat button. */
  chat?: ReactNode | undefined
  /** Replace the session's chat column with this Canvas and its Chat panel; omission removes the top-bar button. */
  onOpenFullWindow?: (() => void) | undefined
  /** Return from the full-window Canvas to the session's chat column; omission removes the top-bar button. */
  onExitFullWindow?: (() => void) | undefined
  /** Leave this Canvas through its owning Harness tab or workspace. */
  onBackToHarness?: (() => void) | undefined
  /** Insert a visible note naming the design and selected layers into the chat draft; returns false when the draft is locked. */
  onMentionSelection?: ((text: string) => boolean) | undefined
  /** Attach a picture to the chat draft; returns the refusal message, or null once attached. Omission sends Mark notes without one. */
  onAttachPicture?: ((file: File) => string | null) | undefined
  /** The project's copy library for Build from copy; omission offers only pasted copy. */
  listCopy?: (() => Promise<readonly CopyOSCopyDocument[]>) | undefined
}
/** Undo/Redo stacks of a file the user switched away from, valid only for the saved revision and content it was left with. */
interface KeptFileHistory { past: CopyOSDesignDocument[]; future: CopyOSDesignDocument[]; key: string; revision: number }
interface History {
  present: CopyOSDesignDocument
  past: CopyOSDesignDocument[]
  future: CopyOSDesignDocument[]
}
type Tool = DesignerTool
// Keep unsaved scenes recoverable when navigating between CopyOS sections.
let propertyClipboard: Partial<CopyOSDesignNode> | null = null
const drafts = new Map<
  string,
  { history: History; savedKey: string; revision: number }
>()
let indexedDraftStore: DesignerDraftStore | undefined
const browserDraftStore = (): DesignerDraftStore => indexedDraftStore ??= indexedDbDesignerDraftStore()
interface Gesture {
  mode:
    | 'move'
    | 'resize'
    | 'pan'
    | 'marquee'
    | 'create'
    | 'gradient'
    | 'grid-track'
    | 'layout-spacing'
  startX: number
  startY: number
  original: History
  ids: string[]
  panX: number
  panY: number
  gradient?: {
    role: 'fill' | 'stroke'
    nodeId: string
    paintId: string
    point: 'start' | 'end' | 'cross'
    matrix: number[]
    width: number
    height: number
    paint: NonNullable<
      import('../../../copyos-domain/src/types.ts').CopyOSDesignPaint['gradient']
    >
  }
  gridMatrix?: number[] | undefined
  gridTrack?: {
    nodeId: string
    axis: 'columns' | 'rows'
    index: number
    size: number
    matrix: number[]
  }
  layoutSpacing?: {
    displayed: CopyOSDesignNode
    nodeId: string
    field: LayoutField
    value: number
    axis: 'x' | 'y'
    direction: number
    matrix: number[]
  }
  handle?: string
  createdId?: string
  /** Board receiving the layer being drawn, and the drag start in its coordinates. */
  createTarget?: DesignerDrawTarget
  createStart?: { x: number; y: number }
  /** Set once the pointer travels far enough to count as a drag rather than a click. */
  createMoved?: boolean
  additive?: boolean
}
const kindKeys: Record<CopyOSDesignNodeKind, CopyOSFoundationLocaleKey> = {
  frame: 'designerFrame',
  group: 'designerGroup',
  boolean: 'designerBoolean',
  rectangle: 'designerRectangle',
  ellipse: 'designerEllipse',
  text: 'designer.text',
  image: 'designerImage',
  component: 'designerComponent',
  'component-set': 'designerComponentSet',
  instance: 'designerInstance',
  path: 'designerPath',
}
let labelContext: OffscreenCanvasRenderingContext2D | null | undefined
/**
 * Truncate an artboard label to its frame's on-screen width so neighbouring labels never overlap.
 * @param text - Complete label.
 * @param width - Available screen pixels at the 12 px label size.
 * @returns The label, or its longest prefix with an ellipsis that fits; unmeasurable environments keep the full label.
 */
function fitCanvasLabel(text: string, width: number): string {
  // OffscreenCanvas measures text without a DOM canvas; environments without it keep full labels.
  labelContext ??= typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  const context = labelContext
  if (!context) return text
  context.font = '12px Inter, CopyOSInter, sans-serif'
  if (context.measureText(text).width <= width) return text
  let low = 0, high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${text.slice(0, middle)}…`).width <= width) low = middle
    else high = middle - 1
  }
  return low ? `${text.slice(0, low).trimEnd()}…` : ''
}
// Context reaches reused artboard elements, so zoom changes update their labels without re-rendering the artboards.
const CanvasZoomContext = createContext(1)
// Wheel pan and zoom repaint the scene only after the wheel rests or at this interval; a composited transform covers the steps between.
const WHEEL_PAINT_IDLE_MS = 120
const WHEEL_PAINT_MAX_MS = 250
/**
 * SVG transform placing a layer at its position, rotation and flips. Identity rotation and flips are omitted so a move
 * changes a translation only, which Chromium applies without repainting the scene.
 */
function designNodeTransform(node: Pick<CopyOSDesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'flipX' | 'flipY'>): string {
  let transform = `translate(${node.x} ${node.y})`
  if (node.rotation) transform += ` rotate(${node.rotation} ${node.width / 2} ${node.height / 2})`
  if (node.flipX || node.flipY)
    transform += ` translate(${node.flipX ? node.width : 0} ${node.flipY ? node.height : 0}) scale(${node.flipX ? -1 : 1} ${node.flipY ? -1 : 1})`
  return transform
}
/** The scene's untransformed client box: the canvas container the SVG fills, since wheel gestures transform the SVG itself. */
function sceneBox(svg: SVGSVGElement): DOMRect {
  return (svg.parentElement ?? svg).getBoundingClientRect()
}
/** Artboard name above its top edge at a constant 12 screen pixels, truncated to the artboard's on-screen width. */
function ArtboardLabel({ text, width, component }: { text: string; width: number; component: boolean }): ReactNode {
  const zoom = useContext(CanvasZoomContext)
  return <text y={-12} fill={component ? '#a277f5' : '#666879'} fontSize={12 / zoom}>
    <title>{text}</title>
    {fitCanvasLabel(text, width * zoom)}
  </text>
}
// The scene reuses laid-out layer objects of unchanged top-level trees, so their serialization is reused by identity.
const serializedLayouts = new WeakMap<CopyOSDesignNode, { nodes: readonly CopyOSDesignNode[]; layout: string }>()
const nodeLayoutHashes = new WeakMap<CopyOSDesignNode, string>()
/** FNV-1a hash of a string, continuing from `hash`. */
function layoutHash(text: string, hash: number): number {
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  return hash
}
/** Two independent 32-bit hashes of a string, so equal keys mean equal content in practice. */
function layoutKey(text: string): string {
  return layoutHash(text, 0x811c9dc5).toString(36) + '.' + layoutHash(text, 0x2b6e1f4d).toString(36)
}
/** Whether two layer records hold equal values; layout resolution rebuilds unchanged nested values, so differing
 * references fall back to comparing their JSON. */
function sameLayerValues(left: CopyOSDesignNode, right: CopyOSDesignNode): boolean {
  const keys = Object.keys(left) as (keyof CopyOSDesignNode)[]
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && (Object.is(left[key], right[key]) || JSON.stringify(left[key]) === JSON.stringify(right[key])))
}
/**
 * Key every node's subtree by its own JSON and its children's keys, so a layer's rendered element can be reused while
 * nothing beneath it changed. Nodes are replaced, never mutated, so each node object's JSON is hashed once; a new object
 * whose values equal the previous scene's layer with the same id keeps that layer's hash.
 * @param childrenById - Computed children per parent id.
 * @param previous - Layers and hashes of the previous call by id; replaced with this call's layers.
 * @returns Per-node subtree key and whether the subtree holds instances or linked page screens.
 */
function subtreeLayoutKeys(childrenById: ReadonlyMap<string | null, readonly CopyOSDesignNode[]>,
  previous: Map<string, { node: CopyOSDesignNode; hash: string }>):
Map<string, { key: string; instances: boolean; pages: boolean }> {
  const result = new Map<string, { key: string; instances: boolean; pages: boolean }>()
  const seen = new Map<string, { node: CopyOSDesignNode; hash: string }>()
  const visit = (node: CopyOSDesignNode, depth: number): { key: string; instances: boolean; pages: boolean } => {
    let own = nodeLayoutHashes.get(node)
    if (own === undefined) {
      const before = previous.get(node.id)
      own = before && sameLayerValues(before.node, node) ? before.hash : layoutKey(JSON.stringify(node))
      nodeLayoutHashes.set(node, own)
    }
    seen.set(node.id, { node, hash: own })
    const children = (depth < 256 ? childrenById.get(node.id) ?? [] : []).map(child => visit(child, depth + 1))
    const entry = { key: children.length ? layoutKey(own + children.map(child => child.key).join()) : own,
      instances: node.kind === 'instance' || children.some(child => child.instances),
      pages: !!node.pageLink || children.some(child => child.pages) }
    result.set(node.id, entry)
    return entry
  }
  for (const top of childrenById.get(null) ?? []) visit(top, 0)
  previous.clear()
  for (const [id, entry] of seen) previous.set(id, entry)
  return result
}
function serializedLayout(nodes: readonly CopyOSDesignNode[]): string {
  const root = nodes[0]
  if (!root) return '[]'
  const cached = serializedLayouts.get(root)
  if (cached && cached.nodes.length === nodes.length && cached.nodes.every((node, index) => node === nodes[index])) return cached.layout
  const layout = JSON.stringify(nodes)
  serializedLayouts.set(root, { nodes, layout })
  return layout
}
// Documents and nodes are replaced, never mutated, so each document's key and each node's JSON are computed once.
const contentKeys = new WeakMap<CopyOSDesignDocument, string>()
const nodeKeys = new WeakMap<CopyOSDesignNode, string>()
const KEYLESS_DOCUMENT_FIELDS = new Set(['id', 'revision', 'createdAt', 'updatedAt'])
/**
 * JSON of a document without identity, revision and timestamps, byte-identical to JSON.stringify of that content; saved
 * keys are parsed back into documents. Unchanged nodes reuse their cached JSON.
 */
function contentKey(doc: CopyOSDesignDocument): string {
  const cached = contentKeys.get(doc)
  if (cached !== undefined) return cached
  const fields: string[] = []
  for (const [name, value] of Object.entries(doc)) {
    if (KEYLESS_DOCUMENT_FIELDS.has(name)) continue
    if (name === 'nodes') {
      fields.push(`"nodes":[${doc.nodes.map((node) => {
        let json = nodeKeys.get(node)
        if (json === undefined) { json = JSON.stringify(node); nodeKeys.set(node, json) }
        return json
      }).join(',')}]`)
      continue
    }
    // JSON.stringify returns undefined for undefined values, which it omits from objects.
    const json = JSON.stringify(value) as string | undefined
    if (json !== undefined) fields.push(`${JSON.stringify(name)}:${json}`)
  }
  const key = `{${fields.join(',')}}`
  contentKeys.set(doc, key)
  return key
}
function download(value: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([value], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Admit measured caches atomically without exceeding the shared native metadata budget. */
/** Pending text measurement edits for one document state; node reads see earlier patches of the same batch. */
interface TextMeasurementBatch {
  readonly present: CopyOSDesignDocument
  scene: () => ReturnType<typeof createDesignRenderScene>
  context: () => ReturnType<typeof createDesignInstanceContextReader>
  node: (id: string) => CopyOSDesignNode | undefined
  /** Measurement caches are dropped together when they exceed the cache bound; measured sizes are always kept. */
  patch: (update: Parameters<typeof editDesignNodes>[1][number], kind?: 'cache' | 'size') => void
  signatureBytes: number
  overrideCount: number
}
/** One reported measurement, checked against the batch's document before it is stored. */
interface TextMeasurementJob { documentId: string | undefined; run: (batch: TextMeasurementBatch) => void }

// Measurements reported together resolve the document once, instead of once per text layer.
function applyTextMeasurementJobs(present: CopyOSDesignDocument, jobs: readonly TextMeasurementJob[]): CopyOSDesignDocument {
  let scene: ReturnType<typeof createDesignRenderScene> | undefined
  let context: ReturnType<typeof createDesignInstanceContextReader> | undefined
  let byId: Map<string, CopyOSDesignNode> | undefined
  const patches = { cache: new Map<string, Parameters<typeof editDesignNodes>[1][number]>(),
    size: new Map<string, Parameters<typeof editDesignNodes>[1][number]>() }
  const batch: TextMeasurementBatch = {
    present,
    scene: () => scene ??= createDesignRenderScene(present),
    context: () => context ??= createDesignInstanceContextReader(present),
    node: id => (byId ??= new Map(present.nodes.map(node => [node.id, node]))).get(id),
    patch: (update, kind = 'cache') => {
      const stored = batch.node(update.id)
      patches[kind].set(update.id, { ...patches[kind].get(update.id), ...update })
      if (stored) byId?.set(update.id, { ...stored, ...update } as CopyOSDesignNode)
    },
    signatureBytes: textLayoutSignatureBytes(present),
    overrideCount: present.nodes.reduce((sum, node) => sum + (node.instanceOverrides?.length ?? 0), 0),
  }
  for (const job of jobs) if (job.documentId === present.id) job.run(batch)
  const sizes = [...patches.size.values()]
  if (!patches.cache.size) return sizes.length ? editDesignNodes(present, sizes) : present
  const ids = new Set([...patches.cache.keys(), ...patches.size.keys()])
  const next = editDesignNodes(present, [...ids].map(id => ({ ...patches.cache.get(id), ...patches.size.get(id), id })))
  if (designTextMeasurementCacheCharacters(next) <= 8000000) return next
  return sizes.length ? editDesignNodes(present, sizes) : present
}

function textLayoutSignatureBytes(document: CopyOSDesignDocument): number {
  return document.nodes.reduce(
    (sum, node) =>
      sum +
      (node.textLayoutMetrics?.signature.length ?? 0) +
      (node.textLayoutMetrics?.overflow?.signature.length ?? 0) +
      (node.instanceOverrides ?? []).reduce(
        (total, override) =>
          total +
          (override.textLayoutMetrics?.signature.length ?? 0) +
          (override.textLayoutMetrics?.overflow?.signature.length ?? 0),
        0,
      ),
    0,
  )
}

/** Render a complete Page Designer workspace within the CopyOS project. */
// One element holds the workspace-wide contexts so adding a context does not re-indent the workspace tree.
function DesignerWorkspaceProviders({ imageAssets, children, ...font }: { imageAssets: DesignerImageAssets | null; children: ReactNode }
  & ComponentProps<typeof DesignerFontMetadataProvider>): ReactNode {
  return (
    <DesignerImageAssetsContext.Provider value={imageAssets}>
      <DesignerFontMetadataProvider {...font}>{children}</DesignerFontMetadataProvider>
    </DesignerImageAssetsContext.Provider>
  )
}
export function PageDesignerWorkspace({
  workspaceId,
  actions,
  pageActions,
  projectPath,
  readProjectImage,
  contained = false,
  t,
  onStartAgent,
  onBuildFromCopy,
  websiteBuildPrompt = designerWebsiteBuildPrompt,
  chat,
  onOpenFullWindow,
  onExitFullWindow,
  onBackToHarness,
  onMentionSelection,
  onAttachPicture,
  listCopy,
  colorScheme = 'light',
  draftStore = browserDraftStore(),
  layout = 'page',
}: Props): ReactNode {
  const [recovery, setRecovery] = useState<{ draft: DesignerDurableDraft; saved: CopyOSDesignDocument } | null>(null)
  const [durableReady, setDurableReady] = useState(false)
  const [linkedPages, setLinkedPages] = useState<readonly CopyOSPageDocument[]>([])
  const [pageReadError, setPageReadError] = useState('')
  const [pagesLoading, setPagesLoading] = useState(false)
  const [openedPageId, setOpenedPageId] = useState<string | null>(null)
  const [openingPage, setOpeningPage] = useState(false)
  const [pageConversion, setPageConversion] = useState<Extract<CopyOSDesignPagePreview, { state: 'ready' }> | null>(null)
  const [conversionSource, setConversionSource] = useState<CopyOSDesignDocument | null>(null)
  const [conversionTitle, setConversionTitle] = useState('')
  const [conversionError, setConversionError] = useState('')
  const [conversionBusy, setConversionBusy] = useState<'preview' | 'build' | null>(null)
  const conversionFlight = useRef(false)
  const [pageUpdate, setPageUpdate] = useState<{
    review: Extract<CopyOSDesignPageUpdateReview, { state: 'update' }>
    page: CopyOSPageDocument
    owner: ConversionOwner
  } | null>(null)
  const [pageUpdateNotice, setPageUpdateNotice] = useState('')
  const [pageSync, setPageSync] = useState<PageSyncState | null>(null)
  const pageUpdateRef = useRef(pageUpdate)
  pageUpdateRef.current = pageUpdate
  const conversionOwner = useRef<ConversionOwner | null>(null)
  const [pageAgentError, setPageAgentError] = useState('')
  const [pageResources, setPageResources] = useState<Record<string, 'loading' | 'ready' | 'error'>>({})
  const [pageLayouts, setPageLayouts] = useState<Record<string, { key: string; height: number; state: 'ready' | 'error' }>>({})
  const [pageResourceEpoch, setPageResourceEpoch] = useState<Record<string, number>>({})
  const pageReadVersion = useRef(0)
  const pageReadActive = useRef<number | null>(null)
  const [files, setFiles] = useState<readonly CopyOSDesignDocument[]>([])
  const [history, setHistory] = useState<History | null>(null)
  const [imageAssets, setImageAssets] = useState<DesignerImageAssets | null>(null)
  const imageAssetsRef = useRef(imageAssets)
  imageAssetsRef.current = imageAssets
  const putDesignImage = actions.putDesignImage
  useEffect(() => {
    if (projectPath === undefined && readProjectImage === undefined) { setImageAssets(null); return }
    const assets = createDesignerImageAssets({ read: readProjectImage ?? projectFileImageReader(projectPath!),
      put: putDesignImage ? async dataBase64 => (await putDesignImage({ workspaceId, dataBase64 })).url : undefined })
    setImageAssets(assets)
    return () => { assets.dispose() }
  }, [projectPath, readProjectImage, workspaceId, putDesignImage])
  // Exports and copies leave the project, so project image references become embedded images first.
  // A document without references is used at once, so downloads and clipboard writes stay in the user's click.
  const selfContained = (document: CopyOSDesignDocument, use: (document: CopyOSDesignDocument) => void): void => {
    const assets = imageAssetsRef.current
    if (!assets || !designImageUrls(document).some(isDesignImageAssetReference)) { use(document); return }
    assets.embed(document).then(use, (failure: unknown) => { setError(message(failure)) })
  }
  const storeImage = (dataUrl: string): Promise<string> =>
    imageAssetsRef.current ? imageAssetsRef.current.store(dataUrl) : Promise.resolve(dataUrl)
  const fileHistories = useRef(new Map<string, KeptFileHistory>())
  const textMeasurementJobs = useRef<TextMeasurementJob[]>([])
  // Reports from one task or commit render once; the layout effect then applies them in one document edit before paint.
  const [textMeasurementReports, setTextMeasurementReports] = useState(0)
  const applyTextMeasurements = useCallback((jobs: readonly TextMeasurementJob[]): void => {
    if (!jobs.length) return
    setHistory((current) => {
      if (!current) return current
      const present = applyTextMeasurementJobs(current.present, jobs)
      return present === current.present ? current : { ...current, present }
    })
  }, [])
  const queueTextMeasurement = useCallback((documentId: string | undefined, run: TextMeasurementJob['run'], immediate = false): void => {
    if (immediate) { applyTextMeasurements([{ documentId, run }]); return }
    textMeasurementJobs.current.push({ documentId, run })
    setTextMeasurementReports(value => value + 1)
  }, [applyTextMeasurements])
  useLayoutEffect(() => {
    const jobs = textMeasurementJobs.current
    textMeasurementJobs.current = []
    applyTextMeasurements(jobs)
  }, [textMeasurementReports, applyTextMeasurements])
  const [selection, setSelectionState] = useState<string[]>([])
  const [instanceCells, setInstanceCells] = useState<{ documentId: string; instanceId: string; paths: string[][] } | null>(null)
  const setSelection = useCallback((next: SetStateAction<string[]>): void => {
    setInstanceCells(null)
    setSelectionState(next)
  }, [])
  const [tool, setTool] = useState<Tool>('select')
  // Header panels and review modes: one panel at a time; Comment and Mark own canvas pointer input while active.
  const [headerPanel, setHeaderPanel] = useState<'templates' | 'build' | 'comments' | null>(null)
  const [reviewMode, setReviewMode] = useState<DesignerReviewMode>(null)
  const [designComments, setDesignComments] = useState<CopyOSDesignComment[]>([])
  const [view, setView] = useState({ x: 50, y: 50, zoom: 0.65 })
  // The view the scene was last painted with while a wheel gesture is pending; null when the paint matches `view`.
  const [paintedView, setPaintedView] = useState<typeof view | null>(null)
  const wheelPaint = useRef<{ timer: number; since: number } | null>(null)
  useEffect(() => () => { if (wheelPaint.current) clearTimeout(wheelPaint.current.timer) }, [])
  const painted = paintedView ?? view
  const wheelScale = view.zoom / painted.zoom
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [switchingFile, setSwitchingFile] = useState(false)
  const documentGeneration = useRef(0)
  const userActionVersion = useRef(0)
  const workspaceRef = useRef(workspaceId)
  workspaceRef.current = workspaceId
  const filesRef = useRef(files)
  filesRef.current = files
  const pendingFileSwitch = useRef<{
    ownerId: string
    workspaceId: string
    generation: number
    actionVersion: number
    authoredKey: string
    targetId: string
  } | null>(null)
  const processingFileSwitch = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [vectorEdit, setVectorEdit] = useState<{ nodeId: string; documentId: string; page: string } | null>(null)
  const [vectorToolbar, setVectorToolbar] = useState<HTMLSpanElement | null>(null)
  const [textDirty, setTextDirty] = useState(false)
  const [linkRequest, setLinkRequest] = useState<{ target:string;serial:number }|null>(null)
  const textCaret = useRef<{ x: number; y: number } | null>(null)
  const [context, setContext] = useState<{
    x: number
    y: number
    worldX: number
    worldY: number
  } | null>(null)
  const [, refreshClipboard] = useState(0)
  const clipboardOperation = useRef(0)
  const clipboardContext = useRef({ page: '', selection: '' })
  const [conversionNotice, setConversionNotice] = useState<{ owner: string; warnings: string[] } | null>(null)
  const [spacePan, setSpacePan] = useState(false)
  const [pixelSnap, setPixelSnap] = useState(false)
  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamePage, setRenamePage] = useState<string | null>(null)
  const selectionAnchor = useRef<string | null>(null)
  const pageViews = useRef(new Map<string, typeof view>())
  const [viewReadyKey, setViewReadyKey] = useState('')
  const [panelWidths, setPanelWidths] = useState({ left: 240, right: 240 })
  const [preview, setPreview] = useState(false)
  // The project panel and the full-window Canvas with its Chat panel start covering the window.
  const [expanded, setExpanded] = useState(layout === 'page' || chat !== undefined)
  const [tokenName, setTokenName] = useState('')
  const [tokenColor, setTokenColor] = useState('#7564ed')
  const [tokenAlpha, setTokenAlpha] = useState(1)
  const [filter, setFilter] = useState('')
  const [requestedPage, setActivePage] = useState('')
  const [leftTab, setLeftTab] = useState<'layers' | 'assets'>('layers')
  // The Chat panel replaces the layers and assets panels while open and uses its own, wider width.
  const [chatOpen, setChatOpen] = useState(true)
  const [inlinePanelHost, setInlinePanelHost] = useState<HTMLElement | null>(null)
  const [chatWidth, setChatWidth] = useState<number>(CHAT_PANEL_WIDTH.initial)
  // Set when the chat draft refused the note (a submission is in flight); the next selection change re-enables it.
  const [mentionLocked, setMentionLocked] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'design' | 'code'>('design')
  const inspectorId = useId()
  const [importing, setImporting] = useState(false)
  const [tokenNotice, setTokenNotice] = useState('')
  const [rebaseNotice, setRebaseNotice] = useState('')
  useEffect(() => { setRebaseNotice('') }, [workspaceId, history?.present.id])
  const [tokenReview, setTokenReview] = useState<readonly string[]>([])
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentStarting, setAgentStarting] = useState(false)
  const [gradientEdit, setGradientEdit] = useState<{
    role: 'fill' | 'stroke'
    nodeId: string
    paintId: string
  } | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [clipboardNotice, setClipboardNotice] = useState<{ owner:string;count:number }|null>(null)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const figUpload = useRef<HTMLInputElement>(null)
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const exportMenu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `@font-face{font-family:Inter;src:url("${interFont}") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}@font-face{font-family:CopyOSInter;src:url("${interFont}") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}`
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])
  const revision = useRef(0)
  const savingRef = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  useEffect(() => {
    const cancel = (): void => {
      const current = gesture.current
      if (!current) return
      gesture.current = null
      setHistory(current.original)
      setMarquee(null)
      setSpacePan(false)
    }
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
    }
  }, [])
  const workspaceElement = useRef<HTMLElement>(null)
  const previousCellSelection = useRef<string | null>(null)
  const canvas = useRef<SVGSVGElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  // React wheel listeners are passive, so Ctrl/Cmd+wheel and trackpad pinch over the canvas would also zoom the browser page.
  useEffect(() => {
    const block = (event: WheelEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.target instanceof Node && canvas.current?.contains(event.target)) event.preventDefault()
    }
    document.addEventListener('wheel', block, { passive: false })
    return () => { document.removeEventListener('wheel', block) }
  }, [])
  const editTransaction = useRef<History | null>(null)
  // Save settles all synchronous editor callbacks; every attempted commit must accept.
  const saveAdmissions = useRef<boolean[] | null>(null)
  const reportSaveAdmission = useCallback((accepted: boolean): boolean => {
    const admissions = saveAdmissions.current
    if (!admissions) return false
    admissions.push(accepted)
    return true
  }, [])
  const layoutReviewOrigin = useRef<CopyOSDesignDocument | null>(null)
  const layoutReviewContext = useRef('')
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [suggestionMarkers, setSuggestionMarkers] = useState<{ document: CopyOSDesignDocument; ids: readonly string[] } | null>(null)
  const historyRef = useRef(history)
  const [imageCleanupOpen, setImageCleanupOpen] = useState(false)
  const { findUnusedDesignImages, removeUnusedDesignImages } = actions
  const imageCleanup = useMemo(() => {
    if (!findUnusedDesignImages || !removeUnusedDesignImages) return null
    // Images that only this window's Undo/Redo stacks, unsaved drafts or the browser draft store still name must survive a cleanup.
    const held = async (): Promise<string[]> => {
      const documents: CopyOSDesignDocument[] = []
      const current = historyRef.current
      if (current) documents.push(current.present, ...current.past, ...current.future)
      for (const kept of fileHistories.current.values()) documents.push(...kept.past, ...kept.future)
      for (const draft of drafts.values()) documents.push(draft.history.present, ...draft.history.past, ...draft.history.future)
      const stored = await draftStore.read(workspaceId)
      if (stored) documents.push(stored.document)
      return [...new Set(documents.flatMap(document => designImageUrls(document).filter(isDesignImageAssetReference)))]
    }
    return {
      find: async () => (await findUnusedDesignImages({ workspaceId, keep: await held() })).files,
      remove: async (fileNames: string[]) => (await removeUnusedDesignImages({ workspaceId, keep: await held(), fileNames })).files,
    }
  }, [findUnusedDesignImages, removeUnusedDesignImages, workspaceId, draftStore])
  historyRef.current = history
  const doc = history?.present ?? null
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const hasCanvas = !!doc
  useEffect(() => {
    const element = canvas.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box)
        setCanvasSize(size => size?.width === box.width && size.height === box.height ? size : { width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [hasCanvas])
  const hasPageScreens = !!doc?.nodes.some(node => node.pageLink)
  const refreshLinkedPages = useCallback(async (): Promise<void> => {
    if (!pageActions || pageReadActive.current === pageReadVersion.current) return
    const version = ++pageReadVersion.current
    pageReadActive.current = version
    setPagesLoading(true)
    try {
      const pages = await pageActions.listPages(workspaceId)
      if (version !== pageReadVersion.current) return
      setLinkedPages(pages); setPageReadError('')
    } catch (failure: unknown) {
      if (version === pageReadVersion.current) setPageReadError(message(failure))
    } finally {
      if (version === pageReadVersion.current) { pageReadActive.current = null; setPagesLoading(false) }
    }
  }, [pageActions, workspaceId])
  useEffect(() => {
    if (!pageActions || openedPageId || !hasPageScreens) return
    void refreshLinkedPages()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshLinkedPages() }, 3000)
    return () => { pageReadVersion.current++; window.clearInterval(timer) }
  }, [pageActions, openedPageId, hasPageScreens, refreshLinkedPages])
  useEffect(() => {
    if (!openedPageId) workspaceElement.current?.focus({ preventScroll: true })
  }, [openedPageId])
  const layoutReviewAtRender = layoutReviewOrigin.current
  useEffect(() => {
    setSuggestionMarkers(current => current && current.document !== doc ? null : current)
  }, [doc])
  const activePage = doc?.pages?.length
    ? (doc.pages.some(page => page.id === requestedPage) ? requestedPage : doc.pages[0]?.id ?? '')
    : ''
  clipboardContext.current = { page: activePage, selection: JSON.stringify(selection) }
  useEffect(() => () => { clipboardOperation.current++ }, [])
  const resolvedColors = useMemo(
    () =>
      doc
        ? resolveDesignModeColors(doc)
        : [],
    [doc],
  )
  const committedDocument =
    editTransaction.current?.present ?? gesture.current?.original.present ?? doc
  const dirty =
    committedDocument !== null && contentKey(committedDocument) !== savedKey
  useEffect(() => { setPageLayouts({}) }, [doc?.id, workspaceId])
  const sourceScene = useMemo(() => doc ? createDesignRenderScene(doc) : null, [doc])
  const pageLayoutKey = (node: CopyOSDesignNode, page: CopyOSPageDocument): string =>
    JSON.stringify([doc?.id, node.id, page.id, page.revision, page.updatedAt, node.width, pageResourceEpoch[node.id] ?? 0])
  const renderScene = useMemo(() => {
    if (!doc || !sourceScene) return null
    const nodes = doc.nodes.map((node) => {
      if (!node.pageLink?.autoHeight) return node
      const page = linkedPages.find(item => item.id === node.pageLink?.pageId)
      const computed = sourceScene.root.byId.get(node.id)
      if (!page || !computed) return node
      const key = JSON.stringify([doc.id, node.id, page.id, page.revision, page.updatedAt, computed.width,
        pageResourceEpoch[node.id] ?? 0])
      const layout = pageLayouts[node.id]
      if (!layout || layout.key !== key || layout.state !== 'ready') return node
      const { height: _height, minHeight: _minimum, maxHeight: _maximum, ...numericBindings } = node.numericBindings ?? {}
      return { ...node, height: layout.height, heightSizing: 'fixed' as const, minHeight: undefined, maxHeight: undefined,
        numericBindings }
    })
    return nodes.some((node, index) => node !== doc.nodes[index]) ? createDesignRenderScene({ ...doc, nodes }) : sourceScene
  }, [doc, sourceScene, linkedPages, pageLayouts, pageResourceEpoch])
  // Keyed by content so edits that keep layer names and text families keep these lists' identity for reused artboards.
  const textLinkKey = useMemo(() => JSON.stringify(doc?.nodes.map(node => [node.id, node.name]) ?? []), [doc?.nodes])
  const textLinkTargets = useMemo(() => (JSON.parse(textLinkKey) as [string, string][]).map(([id, name]) => ({ id, name })),
    [textLinkKey])
  const textFamilyKey = useMemo(() => JSON.stringify([...new Set(doc?.nodes.flatMap(node => node.kind === 'text' ? [node.fontFamily] : []))]),
    [doc?.nodes])
  const textFamilies = useMemo(() => JSON.parse(textFamilyKey) as string[], [textFamilyKey])
  const projectFontActions = useMemo((): DesignerProjectFontActions | undefined => {
    const { listDesignFonts, installDesignFonts, uploadDesignFont, readDesignFont } = actions
    if (!listDesignFonts || !installDesignFonts || !uploadDesignFont || !readDesignFont) return undefined
    return {
      list: async () => (await listDesignFonts({ workspaceId })).faces,
      install: families => installDesignFonts({ workspaceId, families }),
      upload: (fileName, dataBase64) => uploadDesignFont({ workspaceId, fileName, dataBase64 }),
      read: file => readDesignFont({ workspaceId, file }),
    }
  }, [actions, workspaceId])
  const projectFonts = useDesignerProjectFonts(workspaceId, doc ?? null, projectFontActions)
  const readInstanceCell = useMemo(
    () => doc && renderScene ? createDesignInstanceGridCellReader(doc, renderScene, { includeSourceCell: false }) : null,
    [doc, renderScene],
  )
  const visualBounds = useMemo(
    () => (renderScene ? createDesignVisualBounds(renderScene) : null),
    [renderScene],
  )
  const computed = renderScene?.root.nodes ?? []
  const computedById = useMemo(
    () => new Map(computed.map(n => [n.id, n])),
    [computed],
  )
  const sceneBoxes = useMemo(
    () => (visualBounds ? createDesignerSceneBoxes(computedById, node => visualBounds.node(node)) : null),
    [computedById, visualBounds],
  )
  const childrenById = useMemo(() => {
    const map = new Map<string | null, CopyOSDesignNode[]>()
    for (const node of computed) {
      const siblings = map.get(node.parentId) ?? []
      siblings.push(node)
      map.set(node.parentId, siblings)
    }
    return map
  }, [computed])
  useEffect(() => {
    if (doc && requestedPage !== activePage) setActivePage(activePage)
  }, [doc, requestedPage, activePage])
  const sceneNodes = computed.filter(
    n => (n.pageId ?? doc?.pages?.[0]?.id ?? '') === activePage,
  )
  const storedNodes = useMemo(() => new Map(doc?.nodes.map(n => [n.id, n]) ?? []), [doc])
  const isLocked = (node: CopyOSDesignNode): boolean => {
    let current: CopyOSDesignNode | undefined = node
    while (current) {
      if (current.locked) return true
      current = current.parentId === null ? undefined : storedNodes.get(current.parentId)
    }
    return false
  }
  const selected = doc?.nodes.find(n => n.id === selection[0])
  const conversionSources = useMemo(() => {
    const result = new Map<string, CopyOSPageDocument | null>()
    for (const page of linkedPages) {
      if (page.conversion?.sourceDesignId !== doc?.id || !page.conversion) continue
      const sourceId = page.conversion.sourceFrameId
      result.set(sourceId, result.has(sourceId) ? null : page)
    }
    return result
  }, [linkedPages, doc?.id])
  const builtPageForSelection = selected ? conversionSources.get(selected.id) : undefined
  // The selected source artboard, or the source of the selected linked screen, whose saved output is compared with its page.
  const pageSyncSource = !selected || !doc ? null : builtPageForSelection ? { frameId: selected.id, page: builtPageForSelection }
    : (() => {
      const page = selected.pageLink ? linkedPages.find(item => item.id === selected.pageLink?.pageId) : undefined
      return page?.conversion?.sourceDesignId === doc.id && conversionSources.get(page.conversion.sourceFrameId) === page
        ? { frameId: page.conversion.sourceFrameId, page } : null
    })()
  const pageSyncKey = pageSyncSource && doc && !dirty && !saving && actions.reviewDesignPageUpdate
    ? `${doc.id}:${pageSyncSource.frameId}:${revision.current}:${pageSyncSource.page.id}:${pageSyncSource.page.revision ?? 0}` : null
  useEffect(() => {
    const review = actions.reviewDesignPageUpdate, source = pageSyncSource
    if (!pageSyncKey || !review || !source || !doc) return
    if (pageSync?.key === pageSyncKey && pageSync.state !== 'error') return
    let live = true
    setPageSync({ key: pageSyncKey, state: 'checking', changes: 0, edits: 0, conflicts: 0 })
    review({ workspaceId, designId: doc.id, nodeId: source.frameId, expectedRevision: revision.current }).then((result) => {
      if (!live) return
      setPageSync(result.state === 'current' ? { key: pageSyncKey, state: 'current', changes: 0, edits: 0, conflicts: 0 }
        : { key: pageSyncKey, state: 'stale', changes: result.designChanges.length, edits: result.pageEdits.length,
          conflicts: result.conflicts.length })
    }, (failure: unknown) => {
      // A failed comparison is shown as unknown; Update page from design reports the specific error.
      void failure
      if (live) setPageSync({ key: pageSyncKey, state: 'error', changes: 0, edits: 0, conflicts: 0 })
    })
    return () => { live = false }
  }, [pageSyncKey])
  const pageSyncStatus = !pageSyncSource ? null : dirty ? t('canvasPageSyncUnsaved')
    : !pageSync || pageSync.key !== pageSyncKey || pageSync.state === 'checking' ? t('canvasPageSyncChecking')
      : pageSync.state === 'current' ? t('canvasPageSyncCurrent')
        : pageSync.state === 'error' ? t('canvasPageSyncFailed')
          : t('canvasPageSyncStale').replace('{changes}', String(pageSync.changes)).replace('{edits}', String(pageSync.edits))
            .replace('{conflicts}', String(pageSync.conflicts))
  const selectedLocked = selected ? isLocked(selected) : false
  const activeCells = doc && instanceCells?.documentId === doc.id && selection.length === 1 &&
    selection[0] === instanceCells.instanceId ? instanceCells : null
  const cellSelectionKey = activeCells ? `${activeCells.instanceId}:${JSON.stringify(activeCells.paths)}` : null
  useLayoutEffect(() => {
    const previous = previousCellSelection.current
    if (!editing && cellSelectionKey !== previous && (cellSelectionKey || previous))
      workspaceElement.current?.focus({ preventScroll: true })
    previousCellSelection.current = cellSelectionKey
  }, [cellSelectionKey, editing])
  const selectInstanceCell = (instanceId: string, path: string[], additive = false): void => {
    if (!doc || !readInstanceCell) return
    const target = readInstanceCell(instanceId, path)
    if (!target) return
    setSelectionState([instanceId])
    setInstanceCells((previous) => {
      const sameOwner = previous?.documentId === doc.id && previous.instanceId === instanceId
      const sameParent = sameOwner && previous.paths.every((prior) => {
        const context = readInstanceCell(instanceId, prior)
        return context?.parent.id === target.parent.id &&
          JSON.stringify(prior.slice(0, -1)) === JSON.stringify(path.slice(0, -1))
      })
      const key = JSON.stringify(path)
      const paths = additive && sameParent
        ? previous.paths.some(prior => JSON.stringify(prior) === key)
          ? previous.paths.filter(prior => JSON.stringify(prior) !== key)
          : [...previous.paths, path]
        : [path]
      return paths.length ? { documentId: doc.id, instanceId, paths } : null
    })
    setContext(null)
  }

  const openCanvasContext = (event: ReactMouseEvent<SVGElement>, target: DesignerCanvasContextTarget | undefined): void => {
    event.preventDefault()
    event.stopPropagation()
    const box = canvas.current ? sceneBox(canvas.current) : undefined
    workspaceElement.current?.focus({ preventScroll: true })
    if (target?.instanceId && target.instancePath && readInstanceCell?.(target.instanceId, target.instancePath)) {
      selectInstanceCell(target.instanceId, target.instancePath)
    } else if (target && doc?.nodes.some(node => node.id === target.nodeId)) {
      setInstanceCells(null)
      if (!selection.includes(target.nodeId)) setSelection([target.nodeId])
    }
    setContext({ x: event.clientX, y: event.clientY,
      worldX: (event.clientX - (box?.left ?? 0) - view.x) / view.zoom,
      worldY: (event.clientY - (box?.top ?? 0) - view.y) / view.zoom })
  }

  const choose = (file: CopyOSDesignDocument): void => {
    crop.cancel()
    if (fileMenu.current) fileMenu.current.open = false
    setTokenNotice('')
    setTokenReview([])
    documentGeneration.current++
    pendingFileSwitch.current = null
    setSwitchingFile(false)
    const leaving = historyRef.current
    if (leaving && leaving.present.id !== file.id && (leaving.past.length || leaving.future.length)) {
      fileHistories.current.delete(`${workspaceId}:${leaving.present.id}`)
      fileHistories.current.set(`${workspaceId}:${leaving.present.id}`,
        { past: leaving.past, future: leaving.future, key: contentKey(leaving.present), revision: revision.current })
      for (const key of fileHistories.current.keys()) {
        if (fileHistories.current.size <= 8) break
        fileHistories.current.delete(key)
      }
    }
    // A file reopened at the revision and content it was left with keeps its Undo/Redo stacks.
    const kept = fileHistories.current.get(`${workspaceId}:${file.id}`)
    fileHistories.current.delete(`${workspaceId}:${file.id}`)
    const chosen = kept && kept.revision === file.revision && kept.key === contentKey(file)
      ? { present: file, past: kept.past, future: kept.future } : { present: file, past: [], future: [] }
    historyRef.current = chosen
    setHistory(chosen)
    restoreCanvasNavigation(file)
    setEditing(null)
    setTextDirty(false)
    savedKeyRef.current = contentKey(file)
    setSavedKey(savedKeyRef.current)
    revision.current = file.revision
    setConflict(false)
    setError('')
  }
  const restoreCanvasNavigation = (file: CopyOSDesignDocument): void => {
    const saved = readDesignerViewState(workspaceId)
    for (const previous of saved?.views ?? [])
      pageViews.current.set(
        designerPageViewKey(previous.fileId, previous.pageId),
        previous,
      )
    const preferred =
      saved?.fileId === file.id
        ? saved.pageId
        : saved?.views.findLast(v => v.fileId === file.id)?.pageId
    const pageId =
      preferred !== undefined &&
      (file.pages?.length
        ? file.pages.some(p => p.id === preferred)
        : preferred === '')
        ? preferred
        : (file.pages?.[0]?.id ?? '')
    setActivePage(pageId)
    setSelection(
      saved?.fileId === file.id && saved.pageId === pageId
        ? saved.selection.filter(id =>
          file.nodes.some(
            n =>
              n.id === id &&
                (n.pageId ?? file.pages?.[0]?.id ?? '') === pageId,
          ),
        )
        : [],
    )
    if (saved) {
      setPanelWidths(saved.panelWidths)
      setPixelSnap(saved.pixelSnap)
      setLeftTab(saved.leftTab)
      setInspectorTab(saved.inspectorTab ?? 'design')
    }
  }
  useEffect(() => {
    let active = true
    void actions
      .listDesigns(workspaceId)
      .then((items) => {
        if (active) {
          setFiles(items)
          const draft = drafts.get(workspaceId)
          if (draft) {
            setHistory(draft.history)
            restoreCanvasNavigation(draft.history.present)
            setSavedKey(draft.savedKey)
            revision.current = draft.revision
            if (
              items.find(f => f.id === draft.history.present.id)?.revision !==
              draft.revision
            ) {
              setConflict(true)
              setError(t('designerDraftConflict'))
            }
            setDurableReady(true)
            setPhase('ready')
            return
          }
          // Unsaved work from a previous load is offered for an explicit decision before any new draft replaces it.
          return draftStore.read(workspaceId).then((found) => {
            if (!active) return
            const saved = found && items.find(item => item.id === found.document.id)
            if (found && saved && contentKey(found.document) !== contentKey(saved)) {
              choose(saved)
              setRecovery({ draft: found, saved })
            } else {
              if (found) void draftStore.clear(workspaceId)
              const preferred = readDesignerViewState(workspaceId)
              const file = items.find(item => item.id === preferred?.fileId) ?? items[0]
              if (file) choose(file)
            }
            setDurableReady(true)
            setPhase('ready')
          })
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(message(e))
          setPhase('error')
        }
      })
    return () => {
      active = false
    }
  }, [actions, workspaceId])
  useEffect(() => {
    if (!history) return
    if (dirty)
      drafts.set(workspaceId, {
        history:
          editTransaction.current ?? gesture.current?.original ?? history,
        savedKey,
        revision: revision.current,
      })
    else drafts.delete(workspaceId)
  }, [history, savedKey, dirty, workspaceId])
  useEffect(() => {
    if (!durableReady || recovery || !committedDocument) return
    if (!dirty) { void draftStore.clear(workspaceId); return }
    const document = committedDocument, from = revision.current
    const timer = setTimeout(() => {
      void draftStore.write({ version: 1, workspaceId, revision: from, document, savedAt: new Date().toISOString() })
    }, 300)
    return () => { clearTimeout(timer) }
  }, [committedDocument, dirty, durableReady, recovery, workspaceId, draftStore])
  const restoreRecovery = (): void => {
    if (!recovery || historyRef.current?.present.id !== recovery.saved.id) return
    const restored = { present: { ...recovery.draft.document, revision: revision.current },
      past: [historyRef.current.present], future: [] }
    historyRef.current = restored
    setHistory(restored)
    setRecovery(null)
  }
  const recoverAsCopy = async (): Promise<void> => {
    if (!recovery) return
    try {
      const created = await actions.createDesign({ workspaceId, title: t('designerRecoveryCopyTitle').replace('{title}', recovery.draft.document.title) })
      const copy = await actions.saveDesign({ workspaceId, document: { ...recovery.draft.document, id: created.id, title: created.title,
        revision: created.revision, createdAt: created.createdAt, updatedAt: created.updatedAt } })
      setFiles(current => [copy, ...current.filter(file => file.id !== copy.id)])
      choose(copy)
      setRecovery(null)
      void draftStore.clear(workspaceId)
    } catch (failure: unknown) { setError(message(failure)) }
  }
  const booleanDocumentAccepted = (next: CopyOSDesignDocument): boolean => {
    if (!next.nodes.some(node => node.kind === 'boolean')) return true
    if (designBooleansDocumentValid(next)) return true
    setError(t('designerBooleanUnsupported')); return false
  }
  const previewDocument = (next: CopyOSDesignDocument): void => {
    if (!designPageLinksValid(next)) { setError(t('canvasPageLinkInvalid')); return }
    if (!booleanDocumentAccepted(next)) return
    if (!designTextRunsDocumentValid(next)) { setError(t('designerInlineFormattingInvalid')); return }
    if (!designEffectsDocumentValid(next)) { setError(t('designerEffectsInvalid')); return }
    if (!designComponentPropertiesValid(next)) {
      setError(t('designerPropertyInvalid'))
      return
    }
    if (!designVariantsValid(next)) {
      setError(t('designerVariantInvalid'))
      return
    }
    if (!designComponentGraphValid(next)) {
      setError(t('designerComponentGraphInvalid'))
      return
    }
    if (!designSizingLimitsValid(next)) {
      setError(t('designerInvalidSizeLimits'))
      return
    }
    const current = historyRef.current
    if (!current) return
    editTransaction.current ??= current
    const updated = { ...current, present: next }
    historyRef.current = updated
    setHistory(updated)
  }
  const cancelPreview = (): void => {
    setSuggestionMarkers(null)
    layoutReviewOrigin.current = null
    if (editTransaction.current) {
      historyRef.current = editTransaction.current
      setHistory(editTransaction.current)
    }
    editTransaction.current = null
  }
  const exitVectorEdit = (): void => {
    cancelPreview()
    setVectorEdit(null)
    workspaceElement.current?.focus({ preventScroll: true })
  }
  const enterVectorEdit = (node: CopyOSDesignNode, linked = false): void => {
    if (linked) { setError(t('designerVectorLinked')); return }
    if (!doc || isLocked(node) || node.kind !== 'path' || !node.pathData) return
    try {
      const contours = parseDesignPathContours(node.pathData)
      if (contours.reduce((count, contour) => count + contour.anchors.length, 0) > 1000) {
        setError(t('designerVectorTooLarge')); return
      }
    } catch { setError(t('designerVectorInvalid')); return }
    cancelPreview()
    setEditing(null)
    setGradientEdit(null)
    setTool('select')
    setSelection([node.id])
    setVectorEdit({ nodeId: node.id, documentId: doc.id, page: activePage })
  }
  useEffect(() => {
    if (vectorEdit && (doc?.id !== vectorEdit.documentId || activePage !== vectorEdit.page ||
      selection.length !== 1 || selection[0] !== vectorEdit.nodeId || preview || tool !== 'select' ||
      !doc.nodes.some(node => node.id === vectorEdit.nodeId && !isLocked(node) && node.pathData))) {
      setVectorEdit(null)
    }
  }, [doc, activePage, selection, vectorEdit, preview, tool])
  const updateVectorPath = (nodeId: string, pathData: NonNullable<CopyOSDesignNode['pathData']>, transient: boolean): void => {
    const latest = historyRef.current?.present
    const target = latest?.nodes.find(node => node.id === nodeId)
    if (!latest || !target || target.kind !== 'path') return
    let ancestor: CopyOSDesignNode | undefined = target
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor.id)) {
      if (ancestor.locked || ancestor.kind === 'instance') return
      visited.add(ancestor.id)
      const parentId: string | null = ancestor.parentId
      ancestor = latest.nodes.find(node => node.id === parentId)
    }
    try {
      if (parseDesignPathContours(pathData).reduce((count, contour) => count + contour.anchors.length, 0) > 1000) {
        setError(t('designerVectorTooLarge')); return
      }
    } catch { setError(t('designerVectorInvalid')); return }
    const next = { ...latest, nodes: latest.nodes.map(node => node.id === nodeId ? { ...node, pathData } : node) }
    if (transient) previewDocument(next)
    else commit(next)
  }
  const retainRemovedLayerFocus = (next: CopyOSDesignDocument): void => {
    const active = document.activeElement
    const row = active instanceof Element ? active.closest('[data-layer-id]') : null
    const workspace = workspaceElement.current
    if (!row || !workspace?.contains(row) || next.nodes.some(node => node.id === row.getAttribute('data-layer-id'))) return
    workspace.focus({ preventScroll: true })
  }
  const commit = (next: CopyOSDesignDocument, acceptedLayoutOrigin?: CopyOSDesignDocument): boolean => {
    const admissions = saveAdmissions.current
    const attempt = admissions?.length
    admissions?.push(false)
    userActionVersion.current++
    setRebaseNotice('')
    const pendingLayout = layoutReviewOrigin.current ?? layoutReviewAtRender
    if (pendingLayout && acceptedLayoutOrigin !== pendingLayout) {
      cancelPreview()
      setError(t('designerLayoutReviewInterrupted'))
      return false
    }
    const before = editTransaction.current ?? historyRef.current
    if (!before) return false
    if (!designPageLinksValid(next)) { setError(t('canvasPageLinkInvalid')); return false }
    if (next.nodes.some(node => node.kind === 'boolean')) next = fitDesignBooleans(next)
    if (!booleanDocumentAccepted(next)) { cancelPreview(); return false }
    // Moving layers cannot change the outcome of the document-wide checks below, which cost ~100 ms on large files.
    if (!designerMovesOnly(before.present, next)) {
      next = reconcileDesignTextHyperlinks(before.present, next)
      if (!designTextRunsDocumentValid(next)) { setError(t('designerInlineFormattingInvalid')); return false }
      if (!designEffectsDocumentValid(next)) { setError(t('designerEffectsInvalid')); return false }
      if (!designGridDocumentValid(next)) {
        setError(t('designerGridLimit'))
        return false
      }
      try {
        next = reconcileDesignVariants(before.present, next)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        setError(t('designerVariantInvalid'))
        return false
      }
      try {
        next = reconcileDesignComponentProperties(before.present, next)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        setError(t('designerPropertyInvalid'))
        return false
      }
      if (!designComponentPropertiesValid(next)) {
        setError(t('designerPropertyInvalid'))
        return false
      }
      if (!designVariantsValid(next)) {
        setError(t('designerVariantInvalid'))
        return false
      }
      if (!designComponentGraphValid(next)) {
        setError(t('designerComponentGraphInvalid'))
        return false
      }
      if (!designSizingLimitsValid(next)) {
        setError(t('designerInvalidSizeLimits'))
        return false
      }
    }
    const wasPreview = editTransaction.current !== null
    editTransaction.current = null
    if (contentKey(next) === contentKey(before.present)) {
      if (wasPreview) setHistory(before)
      if (admissions && attempt !== undefined) admissions[attempt] = true
      return true
    }
    const updated = {
      present: next,
      past: [...before.past.slice(-99), before.present],
      future: [],
    }
    retainRemovedLayerFocus(next)
    historyRef.current = updated
    setHistory(updated)
    setError('')
    if (admissions && attempt !== undefined) admissions[attempt] = true
    return true
  }
  const previewLayoutVersion = (next: CopyOSDesignDocument): void => {
    layoutReviewOrigin.current ??= editTransaction.current?.present ?? historyRef.current?.present ?? null
    previewDocument(next)
  }
  const layoutVersionContextKey = JSON.stringify([
    doc?.id, revision.current, activePage, selection, activeCells, committedDocument?.activeTokenModeId,
  ])
  layoutReviewContext.current = layoutVersionContextKey
  const applyLayoutVersion = (before: CopyOSDesignDocument, scope: DesignLayoutVersionScope, model: DesignLayoutVersionModel): boolean => {
    const current = editTransaction.current?.present ?? historyRef.current?.present
    if (current !== before || layoutReviewOrigin.current !== before) return false
    if (scope.type === 'page' ? scope.pageId !== (activePage || null) : !!activeCells ||
      JSON.stringify(scope.nodeIds) !== JSON.stringify(selection)) return false
    try {
      const next = setDesignLayoutVersion(before, scope, model)
      if (next === before) { cancelPreview(); return true }
      layoutReviewOrigin.current = null
      return commit(next, before)
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      cancelPreview()
      setError(t('designerAutoLayoutUnavailable'))
      return false
    }
  }
  const previewSuggestion = (result: DesignAutoLayoutSuggestionResult): void => {
    previewLayoutVersion(result.document)
    setSuggestionMarkers({ document:result.document, ids:result.createdIds })
  }
  const applySuggestion = (
    before: CopyOSDesignDocument, ids: readonly string[], allocations: readonly string[], contextKey: string,
  ): boolean => {
    const current = editTransaction.current?.present ?? historyRef.current?.present
    if (contextKey !== layoutReviewContext.current || current !== before || layoutReviewOrigin.current !== before || activeCells ||
      JSON.stringify(ids) !== JSON.stringify(selection)) return false
    try {
      let allocationIndex = 0
      const result = suggestDesignAutoLayout(before, ids, () => {
        const value = allocations[allocationIndex++]
        return value ?? ''
      })
      if (allocationIndex !== allocations.length) { cancelPreview(); setError(t('designerAutoLayoutUnavailable')); return false }
      layoutReviewOrigin.current = null
      if (!commit(result.document, before)) return false
      setSelection(result.selection)
      setSuggestionMarkers({ document:result.document, ids:result.createdIds })
      return true
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      cancelPreview()
      setError(t('designerAutoLayoutUnavailable'))
      return false
    }
  }
  const crop = useDesignerCrop({
    doc,
    getDocument: () => historyRef.current?.present ?? null,
    preview: previewDocument,
    commit,
    cancelPreview,
    select: (id) => {
      previousSelection.current = id
      setSelection([id])
      setGradientEdit(null)
      setEditing(null)
      setContext(null)
      setTool('select')
    },
    selectionKey: selection.join(','),
    zoom: view.zoom,
    t,
    error: setError,
  })
  const liveInteraction = useRef({ editing, textDirty, crop: crop.active })
  liveInteraction.current = { editing, textDirty, crop: crop.active }
  useEffect(() => {
    if (editing || textDirty || crop.active) userActionVersion.current++
  }, [editing, textDirty, crop.active])
  const previousSelection = useRef(selection.join(','))
  const savedKeyRef = useRef(savedKey)
  savedKeyRef.current = savedKey
  useLayoutEffect(() => {
    const key = selection.join(',')
    if (previousSelection.current !== key) {
      cancelPreview()
      setGradientEdit(null)
    }
    previousSelection.current = key
  }, [selection])
  useLayoutEffect(
    () => () => {
      const before =
        editTransaction.current ??
        (gesture.current && !['pan', 'marquee'].includes(gesture.current.mode)
          ? gesture.current.original
          : null)
      if (!before) return
      editTransaction.current = null
      gesture.current = null
      if (contentKey(before.present) !== savedKeyRef.current)
        drafts.set(workspaceId, {
          history: before,
          savedKey: savedKeyRef.current,
          revision: revision.current,
        })
      else drafts.delete(workspaceId)
    },
    [workspaceId],
  )
  const applyNodeEdits = (updates: Parameters<typeof editDesignNodes>[1]): boolean => {
    if (!doc) return false
    try {
      return commit(editDesignNodes(doc, updates))
    } catch (error) {
      if (!(error instanceof Error) || !updates.some(update => typeof update.name === 'string' &&
        doc.nodes.some(node => node.id === update.id && node.variantValues))) throw error
      setError(t('designerVariantNameInvalid'))
      return false
    }
  }
  const patch = (id: string, fields: Partial<CopyOSDesignNode>): boolean => {
    if (
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'letterSpacing',
      ].some(key => key in fields) &&
      !('textStyleId' in fields)
    )
      fields.textStyleId = null
    if (
      Object.keys(fields).some(k =>
        /^(grid|layout|gap|crossGap|padding|widthSizing|heightSizing|alignItems|justifyContent|alignContent|strokesIncludedInLayout)/.test(
          k,
        ),
      )
    )
      fields.preserveLayout = false
    const existing = doc?.nodes.find(n => n.id === id)
    if (doc && existing)
      return applyNodeEdits([
        {
          id,
          ...(doc.nodes.find(n => n.id === id)?.textStyleId &&
            fields.textStyleId === null
            ? designTextStyleValues(computedById.get(id) ?? existing)
            : {}),
          ...fields,
        },
      ])
    return false
  }

  const patchSelection = (fields: Partial<CopyOSDesignNode>): boolean => {
    if (!doc) return false
    if (
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'letterSpacing',
      ].some(key => key in fields) &&
      !('textStyleId' in fields)
    )
      fields.textStyleId = null
    if ('width' in fields) fields.widthSizing = 'fixed'
    if ('height' in fields) fields.heightSizing = 'fixed'
    if ('radius' in fields)
      Object.assign(fields, {
        radiusTopLeft: undefined,
        radiusTopRight: undefined,
        radiusBottomRight: undefined,
        radiusBottomLeft: undefined,
      })
    const layoutEdit = Object.keys(fields).some(k =>
      /^(grid|layout|gap|crossGap|padding|widthSizing|heightSizing|alignItems|justifyContent|alignContent|strokesIncludedInLayout)/.test(
        k,
      ),
    )
    return applyNodeEdits(
      doc.nodes.flatMap(n =>
        selection.includes(n.id) && !isLocked(n)
          ? {
            id: n.id,
            ...(n.textStyleId && fields.textStyleId === null
              ? designTextStyleValues(computedById.get(n.id) ?? n)
              : {}),
            ...fields,
            ...(n.pageLink?.autoHeight && ['height', 'heightSizing', 'minHeight', 'maxHeight'].some(key => key in fields)
              ? { pageLink: { ...n.pageLink, autoHeight: false } } : {}),
            ...(n.kind !== 'text' ? { fontFeatures: undefined, fontVariations: undefined } : {}),
            ...(n.kind === 'text' &&
                ('height' in fields || 'width' in fields)
              ? {
                textSizing:
                        'height' in fields
                          ? 'fixed'
                          : n.textSizing === 'auto-width'
                            ? 'auto-height'
                            : n.textSizing,
                ...('height' in fields && n.textSizing === 'auto-width'
                  ? { widthSizing: 'fixed' as const }
                  : {}),
              }
              : {}),
            numericBindings:
                  fields.numericBindings ??
                  Object.fromEntries(
                    Object.entries(n.numericBindings ?? {}).filter(
                      ([key]) => !(key in fields),
                    ),
                  ),
            ...(layoutEdit ? { preserveLayout: false } : {}),
          }
          : [],
      ),
    )
  }
  const importTokens = async (): Promise<void> => {
    if (!doc || !actions.getStyleGuide) return
    try {
      const guide = await actions.getStyleGuide(workspaceId)
      if (!guide) {
        setTokenReview([])
        setTokenNotice(t('designerNoStyleGuide'))
        return
      }
      const latest = historyRef.current?.present
      if (!latest || latest.id !== doc.id) return
      const result = importDesignStyleGuideTokens(
        latest,
        guide.tokens,
        randomUUID,
      )
      commit(result.document)
      setTokenNotice(
        t('designerTokensImportedCount').replace(
          '{count}',
          String(result.imported),
        ),
      )
      setTokenReview(result.skipped)
    } catch (e) {
      setError(message(e))
    }
  }
  const save = async (): Promise<boolean> => {
    crop.finish()
    const snapshot =
      editTransaction.current?.present ??
      gesture.current?.original.present ??
      historyRef.current?.present
    if (!snapshot || savingRef.current || conflict) return false
    const ownerGeneration = documentGeneration.current
    const ownerWorkspace = workspaceId
    savingRef.current = true
    setSaving(true)
    try {
      const result = await actions.saveDesign({
        workspaceId,
        document: { ...snapshot, revision: revision.current },
      })
      if (workspaceRef.current !== ownerWorkspace || historyRef.current?.present.id !== snapshot.id ||
        documentGeneration.current !== ownerGeneration) return false
      revision.current = result.revision
      // The server stores embedded images as project files; adopting its references keeps later saves small.
      const replacements = designImageReplacements(snapshot, result)
      const adopt = (document: CopyOSDesignDocument): CopyOSDesignDocument =>
        replacements.size ? mapDesignImageUrls(document, url => replacements.get(url) ?? url) : document
      if (replacements.size) setHistory(current => current?.present.id === snapshot.id
        ? { present: adopt(current.present), past: current.past.map(adopt), future: current.future.map(adopt) } : current)
      savedKeyRef.current = contentKey(adopt(snapshot))
      setSavedKey(savedKeyRef.current)
      setFiles(current => [
        result,
        ...current.filter(f => f.id !== result.id),
      ])
      setError('')
      return true
    } catch (e) {
      if (workspaceRef.current === ownerWorkspace && historyRef.current?.present.id === snapshot.id &&
        documentGeneration.current === ownerGeneration) {
        setError(message(e))
        setConflict(true)
      }
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const openPageScreen = async (nodeId: string): Promise<void> => {
    const owner = historyRef.current?.present
    const node = owner?.nodes.find(item => item.id === nodeId)
    if (!owner || !node?.pageLink || !pageActions || openingPage || savingRef.current || conflict ||
      editing || textDirty || gesture.current || editTransaction.current || crop.active) return
    const pageId = node.pageLink.pageId
    if (!linkedPages.some(page => page.id === pageId)) { setError(t('canvasBuilderPageMissing')); return }
    const version = userActionVersion.current, generation = documentGeneration.current
    setOpeningPage(true)
    try {
      if (contentKey(owner) !== savedKeyRef.current && !await save()) return
      const current = historyRef.current?.present
      if (!current || current.id !== owner.id || workspaceRef.current !== workspaceId ||
        documentGeneration.current !== generation || userActionVersion.current !== version ||
        contentKey(current) !== contentKey(owner)) return
      setContext(null); setPageAgentError(''); setOpenedPageId(pageId)
    } finally { setOpeningPage(false) }
  }
  const currentConversionOwner = (current: CopyOSDesignDocument): ConversionOwner =>
    ({ id: current.id, generation: documentGeneration.current, key: contentKey(current), action: userActionVersion.current })
  const conversionOwnerCurrent = (owner: ConversionOwner): boolean => workspaceRef.current === workspaceId &&
    documentGeneration.current === owner.generation && historyRef.current?.present.id === owner.id &&
    contentKey(historyRef.current.present) === owner.key && userActionVersion.current === owner.action
  useEffect(() => {
    workspaceElement.current?.toggleAttribute('inert', pageConversion !== null || pageUpdate !== null)
  }, [pageConversion, pageUpdate])
  useEffect(() => { setPageUpdateNotice('') }, [selection, doc?.id])
  const reviewPageUpdate = async (sourceFrameId: string): Promise<void> => {
    const current = historyRef.current?.present
    if (!current || !actions.reviewDesignPageUpdate || !actions.applyDesignPageUpdate || conversionFlight.current || savingRef.current ||
      conflict || editing || textDirty || gesture.current || editTransaction.current || crop.active) return
    conversionFlight.current = true; setConversionBusy('preview'); setError(''); setConversionError(''); setPageUpdateNotice('')
    const owner = currentConversionOwner(current), stillCurrent = (): boolean => conversionOwnerCurrent(owner)
    try {
      if (owner.key !== savedKeyRef.current && !await save()) return
      if (!stillCurrent()) return
      const review = await actions.reviewDesignPageUpdate({ workspaceId, designId: current.id, nodeId: sourceFrameId,
        expectedRevision: revision.current })
      if (!stillCurrent()) return
      if (review.state === 'current') { setPageUpdateNotice(t('canvasUpdateCurrent')); return }
      const page = pageActions ? (await pageActions.listPages(workspaceId)).find(item => item.id === review.pageId) : undefined
      if (!page || !stillCurrent()) return
      setPageUpdate({ review, page, owner })
    } catch (failure: unknown) {
      if (stillCurrent()) setError(message(failure))
    } finally { conversionFlight.current = false; setConversionBusy(null) }
  }
  const previewPageUpdate = useCallback(async (resolutions: DesignerPageUpdateResolutions): Promise<string> => {
    const candidate = pageUpdateRef.current
    if (!candidate || !actions.reviewDesignPageUpdate) throw new Error(t('canvasUpdateInterrupted'))
    const { review } = candidate
    const result = await actions.reviewDesignPageUpdate({ workspaceId, designId: review.designId, nodeId: review.nodeId,
      expectedRevision: review.sourceRevision, resolutions })
    if (result.state !== 'update' || result.previewHash !== review.previewHash || result.pageRevision !== review.pageRevision ||
      result.selectedHtml === undefined) throw new Error(t('canvasUpdateInterrupted'))
    return result.selectedHtml
  }, [actions, workspaceId, t])
  const applyPageUpdate = async (resolutions: DesignerPageUpdateResolutions | undefined): Promise<void> => {
    const candidate = pageUpdate, current = historyRef.current?.present
    if (!candidate || !current || !actions.applyDesignPageUpdate || conversionFlight.current) return
    const { review, owner } = candidate
    if (!conversionOwnerCurrent(owner)) { setConversionError(t('canvasUpdateInterrupted')); return }
    conversionFlight.current = true; setConversionBusy('build'); setConversionError('')
    try {
      const result = await actions.applyDesignPageUpdate({ workspaceId, designId: review.designId, nodeId: review.nodeId,
        expectedRevision: review.sourceRevision, expectedPageRevision: review.pageRevision, previewHash: review.previewHash,
        ...(resolutions ? { resolutions } : {}) })
      setLinkedPages(items => [result.page, ...items.filter(item => item.id !== result.page.id)])
      setPageUpdate(null)
      setPageUpdateNotice(t('canvasUpdateApplied').replace('{design}', String(result.designChanges)).replace('{page}', String(result.pageEdits))
        .replace('{conflicts}', String(result.conflicts)))
    } catch (failure: unknown) { setConversionError(message(failure)) }
    finally { conversionFlight.current = false; setConversionBusy(null) }
  }
  const reviewPageConversion = async (completeWebsite = false): Promise<void> => {
    const current = historyRef.current?.present
    const target = current?.nodes.find(node => node.id === selection[0])
    if (!current || !target || target.kind !== 'frame' || target.parentId !== null || target.pageLink ||
      !actions.previewDesignPage || !actions.buildDesignPage || !pageActions || conversionFlight.current || savingRef.current ||
      conflict || editing || textDirty || gesture.current || editTransaction.current || crop.active) return
    conversionFlight.current = true; setConversionBusy('preview'); setError(''); setConversionError('')
    const owner = currentConversionOwner(current), stillCurrent = (): boolean => conversionOwnerCurrent(owner)
    try {
      if (owner.key !== savedKeyRef.current && !await save()) return
      if (!stillCurrent()) return
      if (onStartAgent && (!builtPageForSelection || completeWebsite)) {
        await onStartAgent(websiteBuildPrompt(workspaceId, current.id, target.id, revision.current))
        setChatOpen(true)
        return
      }
      const result = await actions.previewDesignPage({ workspaceId, designId: current.id, nodeId: target.id,
        expectedRevision: revision.current })
      if (!stillCurrent()) return
      if (result.state === 'existing') { setOpenedPageId(result.pageId); return }
      conversionOwner.current = owner
      setConversionSource(current); setConversionTitle(result.title); setPageConversion(result)
    } catch (failure: unknown) {
      if (stillCurrent()) setError(message(failure))
    } finally { conversionFlight.current = false; setConversionBusy(null) }
  }
  const buildPageConversion = async (): Promise<void> => {
    const candidate = pageConversion, owner = conversionOwner.current, current = historyRef.current?.present
    if (!candidate || !owner || !current || !actions.buildDesignPage || conversionFlight.current || !conversionTitle.trim()) return
    if (workspaceRef.current !== workspaceId || documentGeneration.current !== owner.generation || current.id !== owner.id ||
      contentKey(current) !== owner.key || userActionVersion.current !== owner.action) {
      setConversionError(t('canvasConversionInterrupted')); return
    }
    conversionFlight.current = true; setConversionBusy('build'); setConversionError('')
    try {
      const result = await actions.buildDesignPage({ workspaceId, designId: candidate.designId, nodeId: candidate.nodeId,
        expectedRevision: candidate.sourceRevision, previewHash: candidate.previewHash, title: conversionTitle.trim() })
      if (workspaceRef.current !== workspaceId || documentGeneration.current !== owner.generation ||
        historyRef.current?.present.id !== owner.id || contentKey(historyRef.current.present) !== owner.key ||
        userActionVersion.current !== owner.action) return
      const saved = result.design
      revision.current = saved.revision
      savedKeyRef.current = contentKey(saved); setSavedKey(savedKeyRef.current)
      setHistory({ present: saved, past: [], future: [] }); setConflict(false)
      setFiles(items => [saved, ...items.filter(item => item.id !== saved.id)])
      setLinkedPages(items => [result.page, ...items.filter(item => item.id !== result.page.id)])
      setSelection([result.linkedFrameId ?? candidate.nodeId]); setPageConversion(null); setConversionSource(null)
      conversionOwner.current = null
      const screen = saved.nodes.find(node => node.id === result.linkedFrameId)
      if (screen) setView({ x: 40 - screen.x * 0.35, y: 40 - screen.y * 0.35, zoom: 0.35 })
      setOpenedPageId(result.page.id)
    } catch (failure: unknown) { setConversionError(message(failure)) }
    finally { conversionFlight.current = false; setConversionBusy(null) }
  }
  const completeFileSwitch = async (): Promise<void> => {
    if (processingFileSwitch.current) return
    processingFileSwitch.current = true
    setSwitchingFile(true)
    try {
      while (pendingFileSwitch.current) {
        const intent = pendingFileSwitch.current
        const current = historyRef.current?.present
        const interaction = liveInteraction.current
        if (!current || current.id !== intent.ownerId || workspaceRef.current !== intent.workspaceId ||
          documentGeneration.current !== intent.generation || userActionVersion.current !== intent.actionVersion ||
          designerAuthoredContentKey(current) !== intent.authoredKey || interaction.editing || interaction.textDirty ||
          interaction.crop || gesture.current || editTransaction.current) {
          pendingFileSwitch.current = null
          setError(t('designerSaveBeforeSwitch'))
          return
        }
        if (contentKey(current) !== savedKeyRef.current) {
          if (!await save()) { pendingFileSwitch.current = null; return }
          continue
        }
        const target = filesRef.current.find(file => file.id === intent.targetId)
        pendingFileSwitch.current = null
        if (target) choose(target)
      }
    } finally {
      processingFileSwitch.current = false
      setSwitchingFile(false)
    }
  }
  const guardFileSwitchDraft = (event: { target: EventTarget | null }): void => {
    if (event.target instanceof Element &&
      !event.target.closest('[data-designer-file-chooser]')) userActionVersion.current++
  }
  const requestFileSwitch = (targetId: string): void => {
    const current = historyRef.current?.present
    const target = filesRef.current.find(file => file.id === targetId)
    if (!current || !target) return
    if (targetId === current.id) { pendingFileSwitch.current = null; return }
    if (pendingFileSwitch.current) {
      pendingFileSwitch.current.targetId = targetId
      return
    }
    const key = contentKey(current)
    if (liveInteraction.current.textDirty || liveInteraction.current.crop || gesture.current || editTransaction.current) {
      setError(t('designerSaveBeforeSwitch'))
      return
    }
    if (key === savedKeyRef.current && !savingRef.current) {
      choose(target)
      return
    }
    // savedKey is produced only by contentKey inside this component and its in-memory drafts.
    const authored = designerAuthoredContentKey(current)
    if (!savedKeyRef.current || (savingRef.current && !processingFileSwitch.current) || conflict ||
      authored !== designerAuthoredContentKey(JSON.parse(savedKeyRef.current) as CopyOSDesignDocument)) {
      setError(t('designerSaveBeforeSwitch'))
      return
    }
    pendingFileSwitch.current = { ownerId: current.id, workspaceId, generation: documentGeneration.current,
      actionVersion: userActionVersion.current, authoredKey: authored, targetId }
    void completeFileSwitch()
  }
  useEffect(() => {
    if (
      !dirty ||
      saving ||
      conflict ||
      gesture.current ||
      editing ||
      editTransaction.current
    )
      return
    const timer = setTimeout(() => {
      void save()
    }, 700)
    return () => {
      clearTimeout(timer)
    }
  }, [history, dirty, saving, conflict, editing])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => {
      if (dirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
  // Reapply unsaved edits on the newer saved revision; overlapping changes keep the conflict and name what overlaps.
  const reloadKeepingChanges = async (): Promise<void> => {
    const local = historyRef.current?.present
    if (!local || savingRef.current || editTransaction.current || gesture.current || liveInteraction.current.editing ||
      liveInteraction.current.textDirty || liveInteraction.current.crop) return
    const base = files.find(file => file.id === local.id && file.revision === revision.current)
    if (!base) { setError(t('designerRebaseUnavailable')); return }
    const ownerGeneration = documentGeneration.current, ownerWorkspace = workspaceId, ownerKey = contentKey(local)
    try {
      const items = await actions.listDesigns(workspaceId)
      const latest = historyRef.current?.present
      if (workspaceRef.current !== ownerWorkspace || documentGeneration.current !== ownerGeneration || !latest ||
        contentKey(latest) !== ownerKey) return
      const remote = items.find(file => file.id === local.id)
      if (!remote) { setError(t('designerRebaseMissing')); return }
      const result = rebaseDesignDocument(base, local, remote)
      if (result.state === 'conflict') {
        const names = result.conflicts.slice(0, 5).map(conflict => conflict.name).join(', ')
        setError(t('designerRebaseConflict').replace('{items}', result.conflicts.length > 5 ? `${names}, …` : names))
        return
      }
      setFiles(items)
      revision.current = remote.revision
      savedKeyRef.current = contentKey(remote)
      setSavedKey(savedKeyRef.current)
      const next = { present: result.document, past: [], future: [] }
      historyRef.current = next
      setHistory(next)
      setSelection(ids => ids.filter(id => result.document.nodes.some(node => node.id === id)))
      setConflict(false)
      setError('')
      setRebaseNotice(t('designerRebaseApplied'))
    } catch (failure: unknown) {
      if (workspaceRef.current === ownerWorkspace && documentGeneration.current === ownerGeneration) setError(message(failure))
    }
  }
  const reload = async (discard = false): Promise<void> => {
    const initial = historyRef.current?.present
    const ownerGeneration = documentGeneration.current
    const ownerWorkspace = workspaceId
    const ownerActionVersion = userActionVersion.current
    try {
      const items = await actions.listDesigns(workspaceId)
      const latest = historyRef.current?.present
      if (workspaceRef.current !== ownerWorkspace || documentGeneration.current !== ownerGeneration ||
        latest?.id !== initial?.id) return
      if (!discard && userActionVersion.current !== ownerActionVersion) return
      setFiles(items)
      if (
        !discard &&
        initial &&
        latest &&
        contentKey(initial) !== contentKey(latest)
      )
        return
      const current =
        items.find(f => f.id === initial?.id) ??
        (!initial ? items[0] : undefined)
      if (!current) return
      if (discard || !initial) {
        choose(current)
        return
      }
      if (current.revision <= revision.current) return
      if (
        editTransaction.current ||
        gesture.current ||
        liveInteraction.current.editing ||
        liveInteraction.current.textDirty ||
        liveInteraction.current.crop ||
        savingRef.current
      )
        return
      setHistory({ present: current, past: [], future: [] })
      setSelection(ids =>
        ids.filter(id => current.nodes.some(n => n.id === id)),
      )
      revision.current = current.revision
      setSavedKey(contentKey(current))
      setConflict(false)
      setError('')
    } catch (e) {
      if (workspaceRef.current === ownerWorkspace && documentGeneration.current === ownerGeneration &&
        historyRef.current?.present.id === initial?.id) setError(message(e))
    }
  }
  useEffect(() => {
    if (!doc || dirty || saving) return
    const refresh = (): void => {
      void reload()
    }
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
    }
  }, [doc?.id, dirty, saving])
  const create = async (): Promise<void> => {
    if (dirty || savingRef.current) {
      setError(t('designerSaveBeforeSwitch'))
      return
    }
    try {
      const file = await actions.createDesign({
        workspaceId,
        title: t('designerUntitled'),
        canvasBackground: { color: colorScheme === 'dark' ? '#1e1e1e' : '#f5f5f5', opacity: 1, visible: true },
      })
      setFiles(items => [file, ...items])
      choose(file)
    } catch (e) {
      setError(message(e))
    }
  }
  // Drawn layers join the board under the pointer; inside auto layout they keep the drawn position instead of joining the flow.
  const drawPlacement = (target: DesignerDrawTarget): Pick<CopyOSDesignNode, 'parentId' | 'absolutePosition'> =>
    ({ parentId: target.parentId, ...(target.autoLayout ? { absolutePosition: true } : {}) })
  const drawTargetAt = (position: { x: number; y: number }): DesignerDrawTarget =>
    designerDrawTarget(sceneNodes.filter(node => node.parentId === null), id => childrenById.get(id) ?? [],
      node => storedNodes.has(node.id) && node.visible && !node.pageLink && !isLocked(node), position)
  const add = (
    kind: CopyOSDesignNodeKind,
    point?: { x: number; y: number },
    target?: DesignerDrawTarget,
  ): void => {
    if (!doc) return
    const node = createDesignNode(kind, randomUUID(), t(kindKeys[kind]))
    if (activePage) node.pageId = activePage
    if (kind === 'text') node.text = t('designerNewText')
    if (point) {
      node.x = Math.round(point.x)
      node.y = Math.round(point.y)
      if (target) Object.assign(node, drawPlacement(target))
    } else if (
      selected &&
      !selected.pageLink &&
      !isLocked(selected) &&
      ['frame', 'group', 'component'].includes(selected.kind)
    ) {
      node.parentId = selected.id
      node.x = 24
      node.y = 24
      if (kind === 'frame') {
        node.width = 360
        node.height = 600
      }
    } else {
      node.x = 80 + doc.nodes.filter(n => n.parentId === null).length * 40
      node.y = 80
    }
    commit({ ...doc, nodes: [...doc.nodes, node] })
    setSelection([node.id])
    setTool('select')
    if (kind === 'text') {
      textCaret.current = null
      setEditing(node.id)
    }
  }
  // Generated images enter like uploaded ones: one history step, inside the selected frame when there is one.
  const placeImage = (image: { dataUrl: string; name: string }): void => {
    if (!doc) return
    const target = selected && !selected.pageLink && !isLocked(selected) && ['frame', 'group', 'component'].includes(selected.kind)
      ? selected : undefined
    const element = new Image()
    element.onload = async () => {
      const node = createDesignNode('image', randomUUID(), image.name || t('designerImage'))
      node.imageUrl = await storeImage(image.dataUrl)
      if (activePage) node.pageId = activePage
      node.width = Math.min(element.naturalWidth, target ? target.width : 1200)
      node.height = (node.width * element.naturalHeight) / element.naturalWidth
      setHistory((current) => {
        if (current?.present.id !== doc.id) return current
        const parent = target && current.present.nodes.some(n => n.id === target.id) ? target : undefined
        if (parent) node.parentId = parent.id
        else { node.x = 80 + current.present.nodes.filter(n => n.parentId === null).length * 40; node.y = 80 }
        return { present: { ...current.present, nodes: [...current.present.nodes, node] },
          past: [...current.past.slice(-99), current.present], future: [] }
      })
      setSelection([node.id])
    }
    element.src = image.dataUrl
  }
  const remove = (): void => {
    if (!doc) return
    const ids = new Set(
      selection.filter(id =>
        doc.nodes.some(n => n.id === id && !isLocked(n)),
      ),
    )
    for (const id of [...ids])
      for (const child of designDescendants(doc.nodes, id)) ids.add(child)
    const components = doc.nodes.filter(
      n => ids.has(n.id) && n.kind === 'component',
    )
    const references = designReferencedComponentIds(doc, ids)
    if (components.some(component => references.has(component.id))) {
      setError(t('designerComponentInUse'))
      return
    }
    commit(pruneDesignComponentProperties({
      ...doc,
      nodes: doc.nodes
        .filter(n => !ids.has(n.id))
        .map(n =>
          n.instanceOverrides
            ? {
              ...n,
              instanceOverrides: n.instanceOverrides.filter(
                o => !o.path.some(id => ids.has(id)),
              ),
            }
            : n,
        ),
    }, doc))
    setSelection([])
  }
  const selectedRoots = (): CopyOSDesignNode[] =>
    doc?.nodes.filter(
      n =>
        selection.includes(n.id) &&
        !selection.some(
          id => id !== n.id && designDescendants(doc.nodes, id).has(n.id),
        ),
    ) ?? []
  const clipboardOwner = (): (() => boolean) => {
    const owner = { document: doc, workspace: workspaceId, generation: documentGeneration.current,
      page: activePage, selection: JSON.stringify(selection), action: userActionVersion.current, operation: ++clipboardOperation.current }
    return () => historyRef.current?.present === owner.document && workspaceRef.current === owner.workspace &&
      documentGeneration.current === owner.generation && userActionVersion.current === owner.action &&
      clipboardContext.current.page === owner.page &&
      clipboardContext.current.selection === owner.selection && clipboardOperation.current === owner.operation
  }
  const copyLayers = async (cut = false): Promise<void> => {
    if (!doc) return
    const roots = selectedRoots()
    if (!roots.length) return
    const current = clipboardOwner()
    try {
      const captured = captureDesignClipboard(doc, roots.map(node => node.id), { sourceWorkspaceId: workspaceId }, randomUUID)
      await writeDesignerClipboardOS(captured)
      if (!current()) { setError(t('designerClipboardStale')); return }
      if (cut) remove()
    } catch {
      setError(t('designerClipboardOSWriteFailed'))
    }
  }
  const copyToEvent = (event: ReactClipboardEvent, cut: boolean): void => {
    if (designerClipboardEditableTarget(event.target) || !doc) return
    if (vectorEdit) { event.preventDefault(); return }
    const roots = selectedRoots()
    if (!roots.length) return
    event.preventDefault()
    try {
      const snapshot = captureDesignClipboard(doc, roots.map(node => node.id), { sourceWorkspaceId: workspaceId }, randomUUID)
      const payload = writeDesignerClipboard(snapshot)
      event.clipboardData.setData('text/html', payload.html)
      event.clipboardData.setData('text/plain', payload.text)
      if (cut) remove()
    } catch {
      setError(t('designerClipboardOSWriteFailed'))
    }
  }
  const pasteFromOS = async (html: string | undefined, replace = false, offset = true): Promise<void> => {
    if (!doc) return
    const current = clipboardOwner()
    // Each stage names its own failure: clipboard permission, unrecognized or oversized content, or Figma conversion.
    let source: string
    try { source = html ?? await readDesignerClipboardOS() } catch (failure: unknown) {
      setError(t(failure instanceof Error && failure.message === 'Unsupported design clipboard'
        ? 'designerClipboardUnsupported' : 'designerClipboardOSReadFailed'))
      return
    }
    let payload: ReturnType<typeof readDesignerClipboard>
    try { payload = readDesignerClipboard(source) } catch (failure: unknown) {
      setError(t(failure instanceof Error && /exceeds limit|size/.test(failure.message) ? 'designerClipboardTooLarge' : 'designerClipboardUnsupported'))
      return
    }
    try {
      let snapshot: ReturnType<typeof captureDesignClipboard>
      let converted = false, imagesMissing = false
      let warnings: string[] = []
      if (payload.type === 'native') {
        snapshot = payload.snapshot
        const references = [...new Set([...designImageUrls(snapshot.library),
          ...designImageUrls({ ...snapshot.library, nodes: snapshot.selectedNodes })])]
          .filter(isDesignImageAssetReference)
        if (references.length && snapshot.sourceWorkspaceId !== workspaceId) {
          try {
            if (!actions.copyDesignImages) throw new Error('Project image copying unavailable')
            await actions.copyDesignImages({ workspaceId, sourceWorkspaceId: snapshot.sourceWorkspaceId, urls: references })
          } catch (failure: unknown) {
            // The layers still paste; their images stay empty until the files exist in this project.
            void failure
            imagesMissing = true
          }
        }
      } else {
        if (!actions.decodeDesignClipboard) throw new Error('Figma decoder unavailable')
        let decoded: Awaited<ReturnType<typeof actions.decodeDesignClipboard>>
        try { decoded = await actions.decodeDesignClipboard({ workspaceId, dataBase64: payload.dataBase64 }) } catch (failure: unknown) {
          setError(`${t('designerClipboardFigmaDecodeFailed')} ${message(failure)}`)
          return
        }
        snapshot = captureDesignClipboard(decoded.document, decoded.selectedIds, { sourceWorkspaceId: workspaceId }, randomUUID)
        converted = true
        warnings = (decoded.document.source?.warnings ?? []).slice(0, 100).map(warning => warning.slice(0, 1000))
      }
      if (!current()) { setError(t('designerClipboardStale')); return }
      const bounds = canvas.current ? sceneBox(canvas.current) : undefined
      const roots = snapshot.selectedNodes.filter(node => snapshot.rootIds.includes(node.id))
      const minX = Math.min(...roots.map(node => node.x)), minY = Math.min(...roots.map(node => node.y))
      const width = Math.max(...roots.map(node => node.x + node.width)) - minX
      const height = Math.max(...roots.map(node => node.y + node.height)) - minY
      const position = converted && !replace && bounds && bounds.width > 0 && bounds.height > 0
        ? { x: (bounds.width / 2 - view.x) / view.zoom - width / 2,
          y: (bounds.height / 2 - view.y) / view.zoom - height / 2 } : undefined
      if (pasteLayers(snapshot, replace, offset, position)) {
        setConversionNotice(converted ? { owner: doc.id, warnings } : null)
        if (imagesMissing) setError(t('designerClipboardImagesMissing'))
      }
    } catch (failure: unknown) {
      setError(`${t('designerClipboardPasteFailed')} ${message(failure)}`)
    }
  }
  const pasteLayers = (snapshot: ReturnType<typeof captureDesignClipboard>, replace = false, offset = true,
    externalPosition?: { x: number; y: number }): boolean => {
    if (!doc || !snapshot.rootIds.length) {
      setError(t('designerClipboardEmpty'))
      return false
    }
    const target = replace && selected ? computedById.get(selected.id) : undefined
    const replaceIds = replace
      ? selectedRoots()
        .filter(node => !isLocked(node))
        .map(node => node.id)
      : []
    const removed = new Set(replaceIds)
    for (const id of replaceIds)
      for (const child of designDescendants(doc.nodes, id)) removed.add(child)
    const references = designReferencedComponentIds(doc, removed)
    if (
      doc.nodes.some(
        node => removed.has(node.id) && node.kind === 'component' && references.has(node.id),
      )
    ) {
      setError(t('designerComponentInUse'))
      return false
    }
    try {
      const position = externalPosition ?? (target
        ? { x: target.x, y: target.y }
        : !offset && context
          ? { x: context.worldX, y: context.worldY }
          : undefined)
      const imported = importDesignClipboard(
        doc,
        snapshot,
        {
          destinationWorkspaceId: workspaceId,
          ...(activePage ? { pageId: activePage } : {}),
          ...(target?.parentId ? { parentId: target.parentId } : {}),
          ...(position ? { position } : {}),
          ...(replaceIds.length ? { replaceIds } : {}),
        },
        randomUUID,
      )
      if (!commit(imported.document)) return false
      setClipboardNotice(imported.removedNodeLinks ? { owner:doc.id,count:imported.removedNodeLinks } : null)
      if (imported.removedNodeLinks) setShowReport(false)
      setSelection(imported.selectedIds)
      if (!doc.pages?.length && imported.activePageId)
        pageViews.current.set(designerPageViewKey(doc.id, imported.activePageId), view)
      setActivePage(imported.activePageId ?? '')
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setError(t('designerClipboardPasteFailed'))
      return false
    }
  }
  const duplicate = (): void => {
    if (!doc) return
    let next = doc
    const added: string[] = []
    for (const root of selectedRoots()) {
      if (isLocked(root)) continue
      const nodes = duplicateDesignNode(next, root.id, randomUUID)
      const copied = nodes
        .slice(next.nodes.length)
        .find(n => n.parentId === root.parentId)
      if (copied) added.push(copied.id)
      next = { ...next, nodes }
    }
    if (commit(next)) setSelection(added)
  }
  const undo = (): void => {
    userActionVersion.current++
    const previous = history?.past.at(-1)
    if (!history || !previous) return
    retainRemovedLayerFocus(previous)
    setHistory({
      present: previous,
      past: history.past.slice(0, -1),
      future: [history.present, ...history.future],
    })
    setSelectionState(ids =>
      ids.filter(id => previous.nodes.some(n => n.id === id)),
    )
  }
  const redo = (): void => {
    userActionVersion.current++
    if (!history?.future[0]) return
    retainRemovedLayerFocus(history.future[0])
    setHistory({
      present: history.future[0],
      past: [...history.past, history.present],
      future: history.future.slice(1),
    })
    setSelectionState(ids =>
      ids.filter(id => history.future[0]?.nodes.some(n => n.id === id)),
    )
  }
  const changeBoolean = (operation: 'union' | 'subtract' | 'intersect' | 'exclude'): void => {
    if (!doc || activeCells) return
    try {
      const next = selected?.kind === 'boolean' && selection.length === 1
        ? setDesignBooleanOperation(doc, selection, operation)
        : createDesignBoolean(doc, selection, operation, randomUUID())
      if (next !== doc) {
        commit(next)
        if (selected?.kind !== 'boolean' || selection.length !== 1) {
          const added = next.nodes.find(node => !doc.nodes.some(old => old.id === node.id))
          if (added) setSelection([added.id])
        }
      }
    } catch { setError(t('designerBooleanFailed')) }
  }
  const releaseBoolean = (flatten: boolean): void => {
    if (!doc || selected?.kind !== 'boolean' || selectedLocked) return
    try {
      const children = doc.nodes.filter(node => node.parentId === selected.id).map(node => node.id)
      const next = flatten ? flattenDesignBoolean(doc, selected.id) : ungroupDesignBoolean(doc, selected.id)
      if (next !== doc) { commit(next); if (!flatten) setSelection(children) }
    } catch { setError(t('designerBooleanFailed')) }
  }
  const group = (kind: 'group' | 'frame' = 'group'): void => {
    if (!doc || !selected || selection.length < (kind === 'frame' ? 1 : 2))
      return
    const items = computed.filter(n => selection.includes(n.id))
    const snapshot = snapshotDesignGeometry(doc, selection)
    if (items.some(n => n.parentId !== selected.parentId || isLocked(n))) {
      setError(t('designerSameParent'))
      return
    }
    const node = createDesignNode(
      kind,
      randomUUID(),
      t(kind === 'group' ? 'designerGroup' : 'designerFrame'),
    )
    node.clip = false
    node.parentId = selected.parentId
    node.pageId = selected.pageId
    node.x = Math.min(...items.map(n => n.x))
    node.y = Math.min(...items.map(n => n.y))
    node.width = Math.max(...items.map(n => n.x + n.width)) - node.x
    node.height = Math.max(...items.map(n => n.y + n.height)) - node.y
    commit({
      ...doc,
      nodes: [
        ...snapshot.nodes.map(n =>
          selection.includes(n.id)
            ? {
              ...n,
              parentId: node.id,
              x: n.x - node.x,
              y: n.y - node.y,
              ...(n.constraints
                ? {
                  constraints: {
                    ...n.constraints,
                    referenceWidth: node.width,
                    referenceHeight: node.height,
                  },
                }
                : {}),
            }
            : n,
        ),
        node,
      ],
    })
    setSelection([node.id])
  }
  const ungroup = (): void => {
    if (selected?.kind === 'boolean') { releaseBoolean(false); return }
    if (
      !doc ||
      !selected ||
      selectedLocked ||
      !['group', 'boolean'].includes(selected.kind) ||
      selected.rotation !== 0
    )
      return
    const snapshot = snapshotDesignGeometry(
      doc,
      doc.nodes.filter(n => n.parentId === selected.id).map(n => n.id),
    )
    const groupNode = computedById.get(selected.id) ?? selected,
      targetParent = computedById.get(selected.parentId ?? '')
    commit({
      ...doc,
      nodes: snapshot.nodes
        .filter(n => n.id !== selected.id)
        .map(n =>
          n.parentId === selected.id
            ? {
              ...n,
              parentId: selected.parentId,
              x: n.x + groupNode.x,
              y: n.y + groupNode.y,
              ...(n.constraints && targetParent
                ? {
                  constraints: {
                    ...n.constraints,
                    referenceWidth: targetParent.width,
                    referenceHeight: targetParent.height,
                  },
                }
                : {}),
            }
            : n,
        ),
    })
    setSelection([])
  }
  const combineVariants = (): boolean => {
    if (!doc || selection.some((id) => {
      const node = doc.nodes.find(item => item.id === id)
      return !node || isLocked(node)
    })) return false
    try {
      const names = doc.nodes.filter(node => selection.includes(node.id)).map(node => node.name.split('/').map(part => part.trim()))
      const prefix = names[0]?.[0]
      const sharedPrefix = names.every(parts => parts.length > 1 && parts[0] === prefix)
      const result = combineDesignComponentsAsVariants(doc, selection, randomUUID, {
        ...(!sharedPrefix ? { name: t('designerVariantSetName') } : {}),
        axisName: t('designerVariantName'),
      })
      if (!commit(result.document)) return false
      setSelection([result.selection])
      return true
    } catch {
      setError(t('designerVariantInvalid'))
      return false
    }
  }
  const addVariant = (sourceId: string): boolean => {
    if (!doc) return false
    const source = doc.nodes.find(node => node.id === sourceId)
    if (!source || isLocked(source)) return false
    try {
      const result = addDesignVariant(doc, sourceId, randomUUID)
      if (!commit(result.document)) return false
      setSelection([result.selection])
      return true
    } catch {
      setError(t('designerVariantInvalid'))
      return false
    }
  }
  const dissolveVariants = (): boolean => {
    if (!doc || !selected || isLocked(selected) || selected.kind !== 'component-set') return false
    const members = doc.nodes.filter(node => node.parentId === selected.id)
    if (members.some(isLocked)) return false
    try {
      if (!commit(dissolveDesignComponentSet(doc, selected.id))) return false
      setSelection(members.map(node => node.id))
      return true
    } catch {
      setError(t('designerVariantInvalid'))
      return false
    }
  }
  const instantiate = (asset: CopyOSDesignNode): void => {
    if (!doc) return
    const component = asset.kind === 'component-set' ? designComponentSetDefault(doc, asset.id) : asset
    if (!component || component.kind !== 'component') return
    const resolved = computedById.get(component.id) ?? component
    const node = {
      ...component,
      id: randomUUID(),
      parentId: null,
      kind: 'instance' as const,
      componentSet: undefined,
      variantValues: undefined,
      componentProperties: undefined,
      componentPropertyValues: undefined,
      instanceOverrides: undefined,
      layout: 'none' as const,
      layoutSizingModel: undefined,
      strokesIncludedInLayout: undefined,
      numericBindings: {},
      width: resolved.width,
      height: resolved.height,
      widthSizing:
        (component.widthSizing ??
          (component.layout === 'row' ? 'hug' : 'fixed')) === 'hug'
          ? ('hug' as const)
          : ('fixed' as const),
      heightSizing:
        (component.heightSizing ??
          (component.layout === 'column' ? 'hug' : 'fixed')) === 'hug'
          ? ('hug' as const)
          : ('fixed' as const),
      pageId: activePage || undefined,
      visible: true,
      locked: false,
      componentId: component.id,
      name: asset.kind === 'component-set' ? asset.name : component.name,
      instanceSizingOverrides: [],
      x: asset.x + asset.width + 48,
      y: asset.y,
    }
    if (commit({ ...doc, nodes: [...doc.nodes, node] })) setSelection([node.id])
  }
  const order = (direction: -1 | 1): void => {
    if (!doc || !selected) return
    const nodes = [...doc.nodes]
    const index = nodes.findIndex(n => n.id === selected.id)
    let target = index + direction
    while (nodes[target] && nodes[target]?.parentId !== selected.parentId)
      target += direction
    const current = nodes[index]
    const other = nodes[target]
    if (current && other) {
      ;[nodes[index], nodes[target]] = [other, current]
      commit({ ...doc, nodes })
    }
  }
  const align = (
    axis: 'x' | 'y',
    position: 'start' | 'center' | 'end' = 'start',
  ): void => {
    if (!doc || !selected) return
    const items = computed.filter(n => selection.includes(n.id))
    if (items.some(n => n.parentId !== selected.parentId)) {
      setError(t('designerSameParent'))
      return
    }
    const gridParent = computedById.get(selected.parentId ?? '')
    if (
      gridParent?.layout === 'grid' &&
      items.every(n => !n.absolutePosition)
    ) {
      changeGridCellAlignment(selection, axis === 'x' ? { type:'spatial',horizontal:position } : { type:'spatial',vertical:position })
      return
    }
    const dimension = axis === 'x' ? 'width' : 'height'
    const parent = computedById.get(selected.parentId ?? '')
    const low = items.length === 1 ? 0 : Math.min(...items.map(n => n[axis]))
    const high =
      items.length === 1
        ? (parent?.[dimension] ?? selected[axis] + selected[dimension])
        : Math.max(...items.map(n => n[axis] + n[dimension]))
    commit(
      editDesignNodes(
        doc,
        computed.flatMap(n =>
          selection.includes(n.id) && !isLocked(n)
            ? {
              id: n.id,
              [axis]:
                  position === 'start'
                    ? low
                    : position === 'center'
                      ? (low + high - n[dimension]) / 2
                      : high - n[dimension],
            }
            : [],
        ),
      ),
    )
  }
  const distribute = (axis: 'x' | 'y'): void => {
    if (!doc) return
    const items = selectedRoots().sort((a, b) => a[axis] - b[axis])
    if (
      items.length < 3 ||
      items.some(n => isLocked(n) || n.parentId !== items[0]?.parentId)
    )
      return
    const dimension = axis === 'x' ? 'width' : 'height'
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return
    const gap =
      (last[axis] +
        last[dimension] -
        first[axis] -
        items.reduce((v, n) => v + n[dimension], 0)) /
      (items.length - 1)
    let cursor = first[axis]
    const positions = new Map<string, number>()
    for (const n of items) {
      positions.set(n.id, cursor)
      cursor += n[dimension] + gap
    }
    commit(
      editDesignNodes(
        doc,
        [...positions].map(([id, value]) => ({ id, [axis]: value })),
      ),
    )
  }

  const movePage = (id: string): void => {
    if (!doc) return
    const ids = new Set(selection)
    for (const n of selectedRoots())
      for (const child of designDescendants(doc.nodes, n.id)) ids.add(child)
    commit({
      ...doc,
      nodes: doc.nodes.map(n =>
        ids.has(n.id)
          ? {
            ...n,
            pageId: id,
            parentId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
          }
          : n,
      ),
    })
    setActivePage(id)
  }
  const extremeOrder = (front: boolean): void => {
    if (!doc) return
    const moving = doc.nodes.filter(
      n => selection.includes(n.id) && !isLocked(n),
    )
    const other = doc.nodes.filter(n => !moving.includes(n))
    commit({
      ...doc,
      nodes: front ? [...other, ...moving] : [...moving, ...other],
    })
  }
  const point = (
    e: ReactPointerEvent<SVGSVGElement>,
  ): { x: number; y: number } => {
    const rect = sceneBox(e.currentTarget)
    return {
      x: (e.clientX - rect.left - view.x) / view.zoom,
      y: (e.clientY - rect.top - view.y) / view.zoom,
    }
  }
  const startMove = (
    e: ReactPointerEvent<SVGGElement>,
    hit: CopyOSDesignNode,
    mode: 'move' | 'resize',
    handle = 'se',
  ): void => {
    if (mode === 'resize' && hit.pageLink?.autoHeight && /[ns]/.test(handle)) return
    if (crop.active) {
      crop.finish()
      e.stopPropagation()
      return
    }
    let node = hit
    if (
      mode === 'move' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !selection.includes(hit.id)
    ) {
      let parent = computedById.get(node.parentId ?? '')
      while (parent && !selection.includes(parent.id)) {
        node = parent
        parent = computedById.get(parent.parentId ?? '')
      }
    }
    if (
      !history ||
      node.locked ||
      preview ||
      editing ||
      tool !== 'select' ||
      spacePan ||
      e.button !== 0
    )
      return
    e.stopPropagation()
    e.preventDefault()
    if (e.shiftKey && selection.includes(node.id) && mode === 'move') {
      setSelection(selection.filter(id => id !== node.id))
      return
    }
    const ids = selection.includes(node.id)
      ? selection
      : e.shiftKey
        ? [...selection, node.id]
        : [node.id]
    setSelection(ids)
    userActionVersion.current++
    gesture.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      original: historyRef.current ?? history,
      ids,
      panX: view.x,
      panY: view.y,
      handle,
      gridMatrix: (() => {
        if (computedById.get(node.parentId ?? '')?.layout !== 'grid')
          return undefined
        const matrix = e.currentTarget.parentElement
          ?.closest<SVGGElement>(`[data-design-node="${node.parentId}"]`)
          ?.getScreenCTM()
          ?.inverse()
        return matrix ? [matrix.a, matrix.b, matrix.c, matrix.d] : undefined
      })(),
    }
    // Browser click targeting follows pointer capture; keep nested text as the double-click target.
    const captureLayer =
      mode === 'move' && e.target instanceof Element
        ? e.target.closest<SVGGElement>('[data-design-node]')
        : null
    const captureTarget = captureLayer ?? e.currentTarget
    captureTarget.setPointerCapture(e.pointerId)
  }
  const editLayoutSpacing = (
    document: CopyOSDesignDocument,
    displayed: CopyOSDesignNode,
    field: LayoutField,
    value: number,
    modifiers?: { altKey: boolean; shiftKey: boolean },
  ): CopyOSDesignDocument => {
    const nodeId = displayed.id
    const node = document.nodes.find(n => n.id === nodeId)
    if (!node) return document
    const opposite: Record<
      'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft',
      'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
    > = {
      paddingTop: 'paddingBottom',
      paddingBottom: 'paddingTop',
      paddingLeft: 'paddingRight',
      paddingRight: 'paddingLeft',
    }
    const fields: LayoutField[] =
      field === 'gap' || field === 'crossGap' || !modifiers?.altKey
        ? [field]
        : modifiers.shiftKey
          ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
          : [field, opposite[field]]
    const bounded = Math.max(
      field === 'gap' && displayed.layout !== 'grid' ? -10000 : 0,
      Math.min(10000, value),
    )
    const changed = fields.filter(
      key =>
        (displayed[key] ??
          (key === 'crossGap'
            ? Math.max(0, displayed.gap)
            : displayed.padding)) !== bounded,
    )
    if (!changed.length) return document
    if (node.kind === 'instance')
      return editDesignInstanceLayout(
        document,
        nodeId,
        Object.fromEntries(changed.map(key => [key, bounded])),
      )
    return editDesignNodes(document, [
      {
        id: nodeId,
        ...Object.fromEntries(changed.map(key => [key, bounded])),
        preserveLayout: false,
        numericBindings: Object.fromEntries(
          Object.entries(node.numericBindings ?? {}).filter(
            ([key]) => !changed.includes(key as LayoutField),
          ),
        ),
      },
    ])
  }

  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (crop.onMove(e)) return
    const g = gesture.current
    const canvasElement = canvas.current
    if (!g || !canvasElement) return
    if (g.mode === 'layout-spacing' && g.layoutSpacing) {
      const info = g.layoutSpacing
      const [a = 1, b = 0, c = 0, d = 1] = info.matrix
      const dx = e.clientX - g.startX,
        dy = e.clientY - g.startY
      const delta =
        info.direction * (info.axis === 'x' ? a * dx + c * dy : b * dx + d * dy)
      const step = e.shiftKey ? 10 : 1
      const value = Math.round((info.value + delta) / step) * step
      if (Math.hypot(dx, dy) < 3 || value === info.value) {
        setHistory(g.original)
        return
      }
      setHistory({
        ...g.original,
        present: editLayoutSpacing(
          g.original.present,
          info.displayed,
          info.field,
          value,
          e,
        ),
      })
      return
    }
    if (g.mode === 'grid-track' && g.gridTrack) {
      const info = g.gridTrack,
        [a = 1, b = 0, c = 0, d = 1] = info.matrix
      const dx = e.clientX - g.startX,
        dy = e.clientY - g.startY
      const delta = info.axis === 'columns' ? a * dx + c * dy : b * dx + d * dy
      const step = e.shiftKey ? 10 : 1,
        size = Math.max(
          1,
          Math.min(100000, Math.round((info.size + delta) / step) * step),
        )
      setHistory({
        ...g.original,
        present: resizeDesignGridTrack(
          g.original.present,
          info.nodeId,
          info.axis,
          info.index,
          size,
        ),
      })
      return
    }
    if (g.mode === 'gradient' && g.gradient) {
      const info = g.gradient,
        [a = 1, b = 0, c = 0, d = 1] = info.matrix
      const origin = designGradientPoints(info.paint)[info.point]
      const dx = e.clientX - g.startX,
        dy = e.clientY - g.startY
      const point = {
        x: Math.max(
          -10,
          Math.min(10, origin.x + (a * dx + c * dy) / info.width),
        ),
        y: Math.max(
          -10,
          Math.min(10, origin.y + (b * dx + d * dy) / info.height),
        ),
      }
      const gradient = moveDesignGradientHandle(
        info.paint,
        info.point,
        point,
        info.width,
        info.height,
        e.shiftKey,
      )
      if (gradient === info.paint) return
      setHistory({
        ...g.original,
        present: info.role === 'stroke' ? editDesignerStrokeGradient(g.original.present, info.nodeId, info.paintId, gradient) : {
          ...g.original.present,
          nodes: g.original.present.nodes.map(n =>
            n.id === info.nodeId
              ? {
                ...n,
                gradient: undefined,
                fills: designNodePaints(n).map(p =>
                  p.id === info.paintId ? { ...p, gradient } : p,
                ),
              }
              : n,
          ),
        },
      })
      return
    }
    const dx = (e.clientX - g.startX) / view.zoom
    const dy = (e.clientY - g.startY) / view.zoom
    if (g.mode === 'pan') {
      setView(v => ({
        ...v,
        x: g.panX + dx * v.zoom,
        y: g.panY + dy * v.zoom,
      }))
      return
    }
    const roots = g.ids.filter(
      id =>
        !g.ids.some(
          parent =>
            parent !== id &&
            designDescendants(g.original.present.nodes, parent).has(id),
        ),
    )
    if (g.mode === 'marquee') {
      const rect = canvasElement.getBoundingClientRect()
      const x = (g.startX - rect.left - view.x) / view.zoom
      const y = (g.startY - rect.top - view.y) / view.zoom
      const box = {
        x: Math.min(x, x + dx),
        y: Math.min(y, y + dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }
      setMarquee(box)
      const hits = sceneNodes
        .filter(
          n =>
            n.parentId === null &&
            n.visible &&
            !isLocked(n) &&
            n.x < box.x + box.width &&
            n.x + n.width > box.x &&
            n.y < box.y + box.height &&
            n.y + n.height > box.y,
        )
        .map(n => n.id)
      setSelection(g.additive ? [...new Set([...g.ids, ...hits])] : hits)
      return
    }
    if (g.mode === 'create') {
      const target = g.createTarget, start = g.createStart
      if (!target || !start) return
      // Movement under 3 screen pixels stays a click, which gets the default size on release.
      if (!g.createMoved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) return
      g.createMoved = true
      const rect = canvasElement.getBoundingClientRect()
      const end = designerSceneToLocal(target.matrix,
        { x: (e.clientX - rect.left - view.x) / view.zoom, y: (e.clientY - rect.top - view.y) / view.zoom })
      const box = designerDrawnBox(start, end), rising = (end.x - start.x) * (end.y - start.y) < 0
      setHistory(current => current ? { ...current, present: { ...current.present,
        nodes: current.present.nodes.map(n => n.id === g.createdId ? { ...n, ...box,
          ...(n.kind === 'path' ? { pathData: { width: box.width, height: box.height, paths: [{
            d: rising ? `M 0 ${box.height} L ${box.width} 0` : `M 0 0 L ${box.width} ${box.height}`, fillRule: 'nonzero' as const }] } } : {}),
        } : n) } } : current)
      return
    }
    if (g.mode === 'resize' && roots.length === 1) {
      const original = resolveDesignNodes(g.original.present),
        child = original.find(n => n.id === roots[0]),
        parent = original.find(n => n.id === child?.parentId)
      if (
        child &&
        parent?.layout === 'grid' &&
        !child.absolutePosition &&
        child.rotation === 0 &&
        !(e.ctrlKey && child.targetAspectRatio && designAspectRatioEligible(child))
      ) {
        const handle = g.handle ?? 'se',
          horizontal =
            child.widthSizing === 'fill' &&
            (handle.includes('e') || handle.includes('w')),
          vertical =
            child.heightSizing === 'fill' &&
            (handle.includes('n') || handle.includes('s'))
        if (horizontal || vertical) {
          const geometry = designGridGeometry(
              parent,
              original.filter(n => n.parentId === parent.id),
              {},
              designInstanceLayoutBoxes(g.original.present),
            ),
            position = geometry.placements.find(p => p.id === child.id)
          if (!position) return
          const [a = 1 / view.zoom, b = 0, c = 0, d = 1 / view.zoom] =
              g.gridMatrix ?? [],
            sx = e.clientX - g.startX,
            sy = e.clientY - g.startY
          const x = a * sx + c * sy,
            y = b * sx + d * sy
          const closest = (values: number[], point: number): number =>
            values.reduce(
              (best, value, i) =>
                Math.abs(value - point) < Math.abs((values[best] ?? 0) - point)
                  ? i
                  : best,
              0,
            )
          const cell: {
            columnSpan?: number
            rowSpan?: number
            column?: number
            row?: number
          } = {}
          if (horizontal) {
            if (handle.includes('w')) {
              cell.column = Math.min(
                position.column + position.columnSpan,
                closest(geometry.columnOffsets, child.x + x) + 1,
              )
              cell.columnSpan =
                position.column + position.columnSpan - cell.column + 1
            } else
              cell.columnSpan = Math.max(
                1,
                closest(
                  geometry.columnOffsets.map(
                    (offset, i) => offset + (geometry.columns[i] ?? 0),
                  ),
                  child.x + child.width + x,
                ) +
                  1 -
                  position.column,
              )
          }
          if (vertical) {
            const rowSize = Math.max(
                1,
                geometry.rows.at(-1) ?? child.height / position.rowSpan,
              ),
              ends = geometry.rowOffsets.map(
                (offset, i) => offset + (geometry.rows[i] ?? 0),
              )
            for (
              let i = ends.length;
              i < Math.min(4096, geometry.rows.length + 64);
              i++
            )
              ends.push(
                (ends.at(-1) ?? parent.paddingTop ?? parent.padding) +
                  rowSize +
                  (parent.crossGap ?? parent.gap),
              )
            if (handle.includes('n')) {
              cell.row = Math.min(
                position.row + position.rowSpan,
                closest(geometry.rowOffsets, child.y + y) + 1,
              )
              cell.rowSpan = position.row + position.rowSpan - cell.row + 1
            } else
              cell.rowSpan = Math.max(
                1,
                closest(ends, child.y + child.height + y) + 1 - position.row,
              )
          }
          let next = resizeDesignGridCell(g.original.present, child.id, cell)
          const fixedWidth =
            !horizontal &&
            (handle.includes('e') || handle.includes('w')) &&
            x !== 0
          const fixedHeight =
            !vertical &&
            (handle.includes('n') || handle.includes('s')) &&
            y !== 0
          if (fixedWidth || fixedHeight) {
            const stored = next.nodes.find(n => n.id === child.id)
            if (stored) next = editDesignNodes(next, [{
              id: child.id,
              ...(fixedWidth ? {
                width: Math.max(child.minWidth ?? 1, Math.min(child.maxWidth ?? 100000,
                  child.width + x * (handle.includes('w') ? -1 : 1))),
                widthSizing: 'fixed' as const,
              } : {}),
              ...(fixedHeight ? {
                height: Math.max(child.minHeight ?? 1, Math.min(child.maxHeight ?? 100000,
                  child.height + y * (handle.includes('n') ? -1 : 1))),
                heightSizing: 'fixed' as const,
              } : {}),
              ...(stored.kind === 'text' ? {
                textSizing: fixedHeight ? 'fixed' as const :
                  stored.heightSizing === 'hug' ? 'auto-height' as const : 'fixed' as const,
              } : {}),
              numericBindings: Object.fromEntries(Object.entries(stored.numericBindings ?? {}).filter(([key]) =>
                !(fixedWidth && key === 'width') && !(fixedHeight && key === 'height'))),
            }])
          }
          if (!designGridDocumentValid(next)) {
            setError(t('designerGridLimit'))
            return
          }
          setHistory({ ...g.original, present: next })
          return
        }
      }
    }
    if (g.mode === 'move' && roots.length === 1) {
      const original = resolveDesignNodes(g.original.present),
        child = original.find(n => n.id === roots[0]),
        parent = original.find(n => n.id === child?.parentId)
      if (
        child &&
        parent &&
        parent.layout !== 'none' &&
        !parent.preserveLayout &&
        !child.absolutePosition
      ) {
        if (parent.layout === 'grid') {
          const geometry = designGridGeometry(
            parent,
            original.filter(n => n.parentId === parent.id),
            {},
            designInstanceLayoutBoxes(g.original.present),
          )
          const [a = 1 / view.zoom, b = 0, c = 0, d = 1 / view.zoom] =
            g.gridMatrix ?? []
          const screenX = e.clientX - g.startX,
            screenY = e.clientY - g.startY
          const x = child.x + a * screenX + c * screenY,
            y = child.y + b * screenX + d * screenY
          const closest = (offsets: number[], position: number): number =>
            offsets.reduce(
              (best, offset, i) =>
                Math.abs(offset - position) <
                Math.abs((offsets[best] ?? 0) - position)
                  ? i
                  : best,
              0,
            )
          const column = closest(geometry.columnOffsets, x)
          const last = geometry.rowOffsets.length - 1
          const row = closest(
            [
              ...geometry.rowOffsets,
              (geometry.rowOffsets[last] ?? 0) +
                (geometry.rows[last] ?? 0) +
                (parent.crossGap ?? parent.gap),
            ],
            y,
          )
          const next = moveDesignGridNode(
            g.original.present,
            child.id,
            Math.max(1, column + 1),
            Math.max(1, row + 1),
          )
          if (!designGridDocumentValid(next)) {
            setError(t('designerGridLimit'))
            return
          }
          setHistory({ ...g.original, present: next })
          return
        }
        const row = parent.layout === 'row',
          position = row
            ? child.x + child.width / 2 + dx
            : child.y + child.height / 2 + dy
        const siblings = original.filter(
          n =>
            n.parentId === parent.id &&
            n.visible &&
            !n.absolutePosition &&
            n.id !== child.id,
        )
        const index = siblings.filter((n) => {
          if (parent.layoutWrap !== 'wrap')
            return (row ? n.x + n.width / 2 : n.y + n.height / 2) < position
          const cross = row
            ? child.y + child.height / 2 + dy
            : child.x + child.width / 2 + dx
          const start = row ? n.y : n.x,
            end = start + (row ? n.height : n.width)
          return (
            cross >= end ||
            (cross >= start &&
              (row ? n.x + n.width / 2 : n.y + n.height / 2) < position)
          )
        }).length
        setHistory({
          ...g.original,
          present: reorderDesignFlowNode(g.original.present, child.id, index),
        })
        return
      }
    }
    const snap = pixelSnap && !e.altKey ? 1 : 0.01
    const originalScene = createDesignRenderScene(g.original.present)
    const originalGeometry = originalScene.root.nodes
    const updates = originalGeometry.flatMap((n) => {
      if (!roots.includes(n.id) || n.locked) return []
      const parent = computed.find(p => p.id === n.parentId)
      if (
        g.mode === 'move' &&
        parent?.layout !== undefined &&
        parent.layout !== 'none' &&
        !parent.preserveLayout &&
        !n.absolutePosition
      )
        return []
      let rotation = g.mode === 'resize' ? n.rotation : 0
      let ancestor = parent
      while (ancestor) {
        rotation += ancestor.rotation
        ancestor = computed.find(p => p.id === ancestor?.parentId)
      }
      const radians = (rotation * Math.PI) / 180
      const x = dx * Math.cos(radians) + dy * Math.sin(radians)
      const y = -dx * Math.sin(radians) + dy * Math.cos(radians)
      if (g.mode === 'move') {
        const constrainedX = e.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : x
        const constrainedY = e.shiftKey && Math.abs(dx) > Math.abs(dy) ? 0 : y
        return {
          id: n.id,
          x: Math.round((n.x + constrainedX) / snap) * snap,
          y: Math.round((n.y + constrainedY) / snap) * snap,
        }
      }
      const handle = g.handle ?? 'se'
      const west = handle.includes('w'),
        north = handle.includes('n')
      let width =
        handle === 'n' || handle === 's'
          ? n.width
          : Math.max(1, n.width + x * (west ? -1 : 1) * (e.altKey ? 2 : 1))
      let height =
        handle === 'e' || handle === 'w'
          ? n.height
          : Math.max(1, n.height + y * (north ? -1 : 1) * (e.altKey ? 2 : 1))
      const driver = handle === 'n' || handle === 's' ? 'height' : handle === 'e' || handle === 'w' ? 'width' :
        Math.abs((width - n.width) / n.width) >= Math.abs((height - n.height) / n.height) ? 'width' : 'height'
      const savedRatio = designAspectRatioEligible(n) ? n.targetAspectRatio : null
      const transientRatio = n.kind === 'boolean' || !savedRatio && e.shiftKey ? { x: n.width, y: n.height } : null
      const constrained = constrainDesignAspectSize(
        { ...n, targetAspectRatio: n.kind === 'boolean' ? transientRatio : e.ctrlKey ? null : savedRatio ?? transientRatio },
        { width, height }, driver, originalScene.root.layoutBoxes.get(n.id),
      )
      width = constrained.width
      height = constrained.height
      const changedWidth = Math.abs(width - n.width) > 0.000001
      const changedHeight = Math.abs(height - n.height) > 0.000001
      const coupled = (n.kind === 'boolean' || !!savedRatio) && (changedWidth || changedHeight)
      const stored = g.original.present.nodes.find(node => node.id === n.id) ?? n
      return {
        id: n.id,
        ...(changedWidth || coupled ? { width, widthSizing: 'fixed' as const } : {}),
        ...(changedHeight || coupled ? { height, heightSizing: 'fixed' as const } : {}),
        ...(n.kind === 'text' && (changedWidth || changedHeight) ? { textSizing: 'fixed' as const } : {}),
        numericBindings: Object.fromEntries(
          Object.entries(stored.numericBindings ?? {}).filter(
            ([key]) => !((changedWidth || coupled) && key === 'width') && !((changedHeight || coupled) && key === 'height'),
          ),
        ),
        x:
          n.x - (e.altKey ? (width - n.width) / 2 : west ? width - n.width : 0),
        y:
          n.y -
          (e.altKey ? (height - n.height) / 2 : north ? height - n.height : 0),
      }
    })
    const next = editDesignNodes(g.original.present, updates, { normalizeAspect: false })
    setHistory({
      ...g.original,
      present:
        g.mode === 'resize' && (e.ctrlKey || e.metaKey)
          ? ignoreDesignChildConstraints(g.original.present, next, roots)
          : next,
    })
  }
  // A click without a drag gives a drawn layer a default size centred on the click; a line becomes a horizontal 100 px line.
  const clickSized = (document: CopyOSDesignDocument, id: string | undefined, start: { x: number; y: number }): CopyOSDesignDocument => ({
    ...document,
    nodes: document.nodes.map((n) => {
      if (n.id !== id) return n
      if (n.kind !== 'path') return { ...n, ...designerDrawnBox(start, null) }
      const width = DESIGNER_CLICK_LAYER_SIZE
      return { ...n, x: Math.round(start.x - width / 2), y: Math.round(start.y), width, height: 1,
        pathData: { width, height: 1, paths: [{ d: `M 0 0 L ${width} 0`, fillRule: 'nonzero' as const }] } }
    }),
  })
  const endGesture = (): void => {
    if (crop.onEnd()) return
    const g = gesture.current
    gesture.current = null
    setMarquee(null)
    if (g && g.mode !== 'pan' && g.mode !== 'marquee')
      setHistory((current) => {
        if (!current) return current
        const present = g.mode === 'create' && !g.createMoved && g.createStart ? clickSized(current.present, g.createdId, g.createStart)
          : current.present
        return contentKey(present) !== contentKey(g.original.present)
          ? { present, past: [...g.original.past.slice(-99), g.original.present], future: [] }
          : current
      })
  }
  const zoomAtCenter = (next: number | ((current: number) => number)): void => {
    const box = canvas.current ? sceneBox(canvas.current) : undefined
    setView((v) => {
      const zoom = Math.max(
        0.05,
        Math.min(4, typeof next === 'function' ? next(v.zoom) : next),
      )
      const x = (box?.width ?? 0) / 2,
        y = (box?.height ?? 0) / 2
      return {
        zoom,
        x: x - ((x - v.x) * zoom) / v.zoom,
        y: y - ((y - v.y) * zoom) / v.zoom,
      }
    })
  }
  const fit = (): void => {
    const roots = sceneNodes.filter(n => n.parentId === null && n.visible)
    if (!roots.length || !canvas.current) return
    const left = Math.min(...roots.map(n => n.x))
    const top = Math.min(...roots.map(n => n.y))
    const right = Math.max(...roots.map(n => n.x + n.width))
    const bottom = Math.max(...roots.map(n => n.y + n.height))
    const box = sceneBox(canvas.current)
    const zoom = Math.max(
      0.05,
      Math.min(
        1.2,
        (box.width - 100) / (right - left),
        (box.height - 100) / (bottom - top),
      ),
    )
    setView({ x: 50 - left * zoom, y: 50 - top * zoom, zoom })
  }
  useEffect(() => {
    if (!doc) return
    const key = designerPageViewKey(doc.id, activePage)
    const stored = pageViews.current.get(key)
    if (stored) setView(stored)
    else fit()
    setViewReadyKey(key)
  }, [doc?.id, activePage, expanded])
  useEffect(() => {
    if (
      !doc ||
      phase !== 'ready' ||
      viewReadyKey !== designerPageViewKey(doc.id, activePage)
    )
      return
    pageViews.current.set(viewReadyKey, view)
    saveDesignerViewState(workspaceId, {
      fileId: doc.id,
      pageId: activePage,
      selection,
      view: { fileId: doc.id, pageId: activePage, ...view },
      panelWidths,
      pixelSnap,
      leftTab,
      inspectorTab,
    })
  }, [
    doc?.id,
    activePage,
    viewReadyKey,
    phase,
    view,
    selection,
    panelWidths,
    pixelSnap,
    leftTab,
    inspectorTab,
    workspaceId,
  ])
  const editable =
    !!selection.length &&
    !!doc &&
    !doc.nodes.filter(n => selection.includes(n.id)).some(isLocked)
  const booleanSelection = doc ? designBooleanSelection(doc, selection.length === 1 && selected?.kind === 'boolean' ? doc.nodes.filter(node => node.parentId === selected.id).map(node => node.id) : selection) : { eligible: false }
  const booleanSelected = selection.length === 1 && selected?.kind === 'boolean'
  const booleanEnabled = !activeCells && booleanSelection.eligible
  const booleanReason = !booleanEnabled ? designerBooleanReason(activeCells ? 'component' : booleanSelection.reason, t) : undefined
  const booleanMenu: MenuItem[] = [
    ...(['union', 'subtract', 'intersect', 'exclude'] as const).map(operation => ({
      id: `boolean:${operation}`, label: t(({ union: 'designerBooleanUnion', subtract: 'designerBooleanSubtract', intersect: 'designerBooleanIntersect', exclude: 'designerBooleanExclude' } as const)[operation]),
      disabled: !booleanEnabled,
    })),
    ...(booleanReason ? [{ id: 'boolean-reason', label: booleanReason, disabled: true }] : []),
  ]
  const runBooleanCommand = (id: string): void => {
    const operation = id.slice('boolean:'.length)
    if (operation === 'union' || operation === 'subtract' || operation === 'intersect' || operation === 'exclude') changeBoolean(operation)
  }
  const cssDocument = editTransaction.current?.present ?? doc
  const cssResults = useMemo(() => {
    if (!cssDocument || inspectorTab !== 'code' && !context) return []
    const owners = activeCells
      ? activeCells.paths.flatMap((path) => {
        const layer = readInstanceCell?.(activeCells.instanceId, path)
        return layer ? [{ nodeId: activeCells.instanceId, instancePath: path, label: layer.node.name }] : []
      })
      : selection.flatMap((nodeId) => {
        const node = cssDocument.nodes.find(layer => layer.id === nodeId)
        return node ? [{ nodeId, instancePath: [] as string[], label: node.name }] : []
      })
    return owners.map(({ label, ...owner }) => ({ label, projection: designNodeCss(cssDocument, owner) }))
  }, [cssDocument, selection, activeCells, readInstanceCell, inspectorTab, context])
  const selectedCss = cssResults.map(result => result.projection.css).join('\n\n')
  const copyText = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (_error) {
      setError(t('designerClipboardFailed'))
    }
  }
  const layoutContext = useMemo(
    () => doc ? designAutoLayoutContext(doc, selection) : undefined,
    [doc, selection],
  )
  const suggestionContext = useMemo(
    () => committedDocument ? designAutoLayoutSuggestionContext(committedDocument, selection) : null,
    [committedDocument, selection],
  )
  const changeAutoLayout = (action: 'add' | 'remove' | 'removeAll' | 'row' | 'column' | 'grid'): void => {
    if (!doc || activeCells) return
    try {
      const result = action === 'add'
        ? addDesignAutoLayout(doc, selection, randomUUID())
        : {
          document: action === 'row' || action === 'column' || action === 'grid'
            ? setDesignAutoLayoutFlow(doc, selection, action)
            : removeDesignAutoLayout(doc, selection, { recursive: action === 'removeAll' }),
          selection: undefined,
        }
      if (result.document === doc) return
      if (commit(result.document) && result.selection) setSelection([result.selection])
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      setError(t('designerAutoLayoutUnavailable'))
    }
  }
  const changeGridCellAlignment = (
    targets: readonly (string | DesignAlignmentTarget)[],
    intent: DesignGridCellAlignmentIntent,
  ): boolean => {
    if (!doc) return false
    try {
      const next = setDesignGridCellAlignment(doc, targets, intent)
      return next !== doc ? commit(next) : false
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      setError(t('designerGridCellAlignmentUnavailable'))
      return false
    }
  }
  const changeAutoLayoutAlignment = (
    targets: readonly (string | DesignAlignmentTarget)[],
    intent: DesignAutoLayoutAlignmentIntent,
  ): boolean => {
    if (!doc) return false
    try {
      const next = setDesignAutoLayoutAlignment(doc, targets, intent)
      return next !== doc ? commit(next) : false
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      setError(t('designerAutoLayoutUnavailable'))
      return false
    }
  }
  const changeAutoLayoutPadding = (targets: readonly DesignPaddingTarget[], values: DesignPaddingValues): boolean => {
    if (!doc) return false
    try {
      const next = setDesignAutoLayoutPadding(doc, targets, values)
      return next === doc || commit(next)
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      setError(t('designerAutoLayoutUnavailable'))
      return false
    }
  }
  const commands: Record<
    string,
    {
      labelKey: CopyOSFoundationLocaleKey
      enabled: boolean
      run: () => void
      shortcut?: string
    }
  > = {
    copyLayers: {
      labelKey: 'designerCopy',
      enabled: !!selected,
      run: () => { void copyLayers() },
      shortcut: '⌘ C',
    },
    cut: {
      labelKey: 'designerCut',
      enabled: editable,
      run: () => {
        void copyLayers(true)
      },
      shortcut: '⌘ X',
    },
    paste: {
      labelKey: 'designerPasteHere',
      enabled: !!doc,
      run: () => {
        void pasteFromOS(undefined, false, false)
      },
      shortcut: '⌘ V',
    },
    pasteReplace: {
      labelKey: 'designerPasteReplace',
      enabled: editable,
      run: () => {
        void pasteFromOS(undefined, true)
      },
      shortcut: '⇧ ⌘ R',
    },
    copySvg: {
      labelKey: 'designerCopySvg',
      enabled: !!selected && !doc?.nodes.some(node => selection.includes(node.id) && node.pageLink),
      run: () => {
        if (doc?.nodes.some(node => selection.includes(node.id) && node.pageLink)) { setError(t('canvasPageScreenSvgHint')); return }
        if (doc) {
          const ids = new Set(selection)
          for (const n of selectedRoots())
            for (const id of designDescendants(doc.nodes, n.id)) ids.add(id)
          selfContained({
            ...doc,
            nodes: doc.nodes
              .filter(n => ids.has(n.id))
              .map(n =>
                selection.includes(n.id) ? { ...n, parentId: null } : n,
              ),
          }, (copied) => { void copyText(exportDesignSvg(copied)) })
        }
      },
    },
    copySvgFigma: {
      labelKey: 'designerCopySvgFigma',
      enabled: !!selected && !doc?.nodes.some(node => selection.includes(node.id) && node.pageLink),
      run: () => {
        if (doc?.nodes.some(node => selection.includes(node.id) && node.pageLink)) { setError(t('canvasPageScreenSvgHint')); return }
        if (doc) {
          const ids = new Set(selection)
          for (const n of selectedRoots())
            for (const id of designDescendants(doc.nodes, n.id)) ids.add(id)
          selfContained({
            ...doc,
            nodes: doc.nodes.filter(n => ids.has(n.id)).map(n => selection.includes(n.id) ? { ...n, parentId: null } : n),
          }, (copied) => { void copyText(exportDesignSvgWithEditableText(copied, undefined, {}, globalThis.document)) })
        }
      },
    },
    copyCss: {
      labelKey: 'designerCopyCss',
      enabled: !!selectedCss,
      run: () => { void copyText(selectedCss) },
    },
    copyText: {
      labelKey: 'designerCopyText',
      enabled: !!selected,
      run: () => {
        void copyText(
          doc?.nodes
            .filter(n => selection.includes(n.id) && n.kind === 'text')
            .map(n => n.text)
            .join('\n') ?? '',
        )
      },
    },
    copyProperties: {
      labelKey: 'designerCopyProperties',
      enabled: !!selected,
      run: () => {
        if (selected) {
          const {
            fill,
            fillOpacity,
            fills,
            stroke,
            strokeWidth,
            radius,
            opacity,
            fontFamily,
            fontSize,
            fontWeight,
            lineHeight,
            letterSpacing,
          } = selected
          const fontFeatures = (computedById.get(selected.id) ?? selected).fontFeatures ?? []
          const fontVariations = (computedById.get(selected.id) ?? selected).fontVariations ?? []
          propertyClipboard = {
            fill,
            fillOpacity,
            fills,
            stroke,
            strokeWidth,
            radius,
            opacity,
            ...(selected.kind === 'text' ? { fontFamily, fontSize, fontWeight, fontFeatures, fontVariations,
              lineHeight, letterSpacing } : {}),
          }
          refreshClipboard(v => v + 1)
        }
      },
    },
    pasteProperties: {
      labelKey: 'designerPasteProperties',
      enabled: editable && !!propertyClipboard,
      run: () => {
        if (propertyClipboard) patchSelection(propertyClipboard)
      },
    },
    duplicate: {
      labelKey: 'designerDuplicate',
      enabled: editable,
      run: duplicate,
      shortcut: '⌘ D',
    },
    group: {
      labelKey: 'designerGroupSelection',
      enabled: editable && selection.length > 1,
      run: () => {
        group()
      },
      shortcut: '⌘ G',
    },
    frame: {
      labelKey: 'designerFrameSelection',
      enabled: editable,
      run: () => {
        group('frame')
      },
      shortcut: '⌥ ⌘ G',
    },
    ungroup: {
      labelKey: 'designerUngroup',
      enabled:
        editable && (selected?.kind === 'boolean' || selected?.kind === 'group' && selected.rotation === 0),
      run: ungroup,
      shortcut: '⇧ ⌘ G',
    },
    front: {
      labelKey: 'designerBringFront',
      enabled: editable,
      run: () => {
        extremeOrder(true)
      },
      shortcut: ']',
    },
    back: {
      labelKey: 'designerSendBack',
      enabled: editable,
      run: () => {
        extremeOrder(false)
      },
      shortcut: '[',
    },
    forward: {
      labelKey: 'designerForward',
      enabled: editable,
      run: () => {
        order(1)
      },
    },
    backward: {
      labelKey: 'designerBackward',
      enabled: editable,
      run: () => {
        order(-1)
      },
    },
    visibility: {
      labelKey: 'designerShowHide',
      enabled: !!selected,
      run: () => {
        if (doc)
          commit({
            ...doc,
            nodes: doc.nodes.map(n =>
              selection.includes(n.id)
                ? { ...n, visible: !selected?.visible }
                : n,
            ),
          })
      },
      shortcut: '⇧ ⌘ H',
    },
    lock: {
      labelKey: 'designerLockUnlock',
      enabled: !!selected,
      run: () => {
        if (doc)
          commit({
            ...doc,
            nodes: doc.nodes.map(n =>
              selection.includes(n.id)
                ? { ...n, locked: !selected?.locked }
                : n,
            ),
          })
      },
      shortcut: '⇧ ⌘ L',
    },
    flipX: {
      labelKey: 'designerFlipHorizontal',
      enabled: editable,
      run: () => {
        patchSelection({ flipX: !selected?.flipX })
      },
      shortcut: '⇧ H',
    },
    flipY: {
      labelKey: 'designerFlipVertical',
      enabled: editable,
      run: () => {
        patchSelection({ flipY: !selected?.flipY })
      },
      shortcut: '⇧ V',
    },
    combineVariants: {
      labelKey: 'designerCombineVariants',
      enabled: editable && selection.length > 1 && selection.every((id) => {
        const node = doc.nodes.find(item => item.id === id)
        return node?.kind === 'component' && node.parentId === selected?.parentId &&
          doc.nodes.find(parent => parent.id === node.parentId)?.kind !== 'component-set'
      }),
      run: combineVariants,
    },
    addVariant: {
      labelKey: 'designerAddVariant',
      enabled: editable && selection.length === 1 && (selected?.kind === 'component' || selected?.kind === 'component-set'),
      run: () => { if (selected) addVariant(selected.id) },
    },
    dissolveVariants: {
      labelKey: 'designerDissolveVariants',
      enabled: editable && selection.length === 1 && selected?.kind === 'component-set',
      run: dissolveVariants,
    },
    component: {
      labelKey: 'designerMakeComponent',
      enabled:
        editable &&
        selection.length === 1 &&
        ['frame', 'group'].includes(selected?.kind ?? ''),
      run: () => {
        patchSelection({ kind: 'component' })
      },
      shortcut: '⌥ ⌘ K',
    },
    removeLayout: {
      labelKey:'designerRemoveAutoLayout',enabled:!activeCells&&!!layoutContext?.canRemove,
      run:()=>{ changeAutoLayout('remove') },shortcut:'⌥ ⇧ A',
    },
    removeAllLayout: {
      labelKey:'designerRemoveAllAutoLayout',enabled:!activeCells&&!!layoutContext?.canRemoveAll,
      run:()=>{ changeAutoLayout('removeAll') },
    },
    suggestLayout: {
      labelKey: 'designerSuggestAutoLayout', enabled: !activeCells && !!suggestionContext?.canSuggest,
      run: () => { cancelPreview(); setSuggestionOpen(true) },
      shortcut: /Mac|iPhone|iPad/.test(navigator.platform) ? 'Ctrl+Shift+A' : 'Ctrl+Alt+Shift+A',
    },
    addLayout: {
      labelKey:'designerAddAutoLayout',enabled:!activeCells&&!!layoutContext?.canAdd,
      run:()=>{ changeAutoLayout('add') },shortcut:'⇧ A',
    },
    selectAll: {
      labelKey: 'designerSelectAll',
      enabled: !!doc,
      run: () => {
        setSelection(
          sceneNodes
            .filter(n => !isLocked(n) && n.visible && n.parentId === null)
            .map(n => n.id),
        )
      },
      shortcut: '⌘ A',
    },
    delete: {
      labelKey: 'designerDelete',
      enabled: editable,
      run: remove,
      shortcut: '⌫',
    },
    goMain: {
      labelKey: 'designerGoMain',
      enabled: selected?.kind === 'instance',
      run: () => {
        const main = doc?.nodes.find(n => n.id === selected?.componentId)
        if (main) {
          setActivePage(main.pageId ?? '')
          setSelection([main.id])
        }
      },
    },
    detach: {
      labelKey: 'designerDetachInstance',
      enabled: editable && selected?.kind === 'instance',
      run: () => {
        if (doc && selected)
          commit(detachDesignInstance(doc, selected.id, randomUUID))
      },
    },
  }
  const runCommand = (id: string): void => {
    if (activeCells && id !== 'copyCss') { setContext(null); return }
    const command = commands[id]
    if (command?.enabled) command.run()
    setContext(null)
  }
  const menuItem = (id: string): MenuItem => {
    const c = commands[id]
    if (!c) throw new Error('Unknown designer command')
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform)
      ? c.shortcut?.replaceAll(' ', '')
      : c.shortcut
        ?.replaceAll('⌘ ', 'Ctrl+')
        .replaceAll('⌥ ', 'Alt+')
        .replaceAll('⇧ ', 'Shift+')
        .replaceAll('Alt+Ctrl+', 'Ctrl+Alt+')
        .replaceAll('Shift+Ctrl+', 'Ctrl+Shift+')

    return {
      id,
      label: (
        <span className={css.commandLabel}>
          <span>{t(c.labelKey)}</span>
          {shortcut ? <kbd aria-hidden="true">{shortcut}</kbd> : null}
        </span>
      ),
      disabled: !c.enabled || !!activeCells && id !== 'copyCss',
    }
  }
  const menuEntries: MenuEntry[] = [
    ...['copyLayers', 'cut', 'paste', 'pasteReplace'].map(menuItem),
    {
      id: 'clipboard',
      label: t('designerCopyPasteAs'),
      submenu: ['copyCss', 'copySvg', 'copySvgFigma', 'copyText', 'copyProperties', 'pasteProperties']
        .map(menuItem)
        .filter(
          (v): v is Exclude<MenuEntry, { type: string }> => !('type' in v),
        ),
    },
    { type: 'separator', id: 'selection-divider' },
    {
      id: 'select-layer',
      label: t('designerSelectLayer'),
      disabled: !!activeCells,
      // Only an open context menu shows this list; building it walks every layer's lock ancestry.
      submenu: (context ? sceneNodes : [])
        .filter(n => n.visible && !isLocked(n))
        .slice()
        .reverse()
        .slice(0, 100)
        .map(n => ({ id: `select:${n.id}`, label: n.name })),
    },
    {
      id: 'move-page',
      label: t('designerMoveToPage'),
      disabled: !editable || !!activeCells,
      submenu:
        doc?.pages?.map(page => ({
          id: `page:${page.id}`,
          label: page.name,
          disabled: page.id === activePage,
        })) ?? [],
    },
    ...['front', 'back'].map(menuItem),
    { type: 'separator', id: 'structure-divider' },
    { id: 'boolean', label: t('designerBoolean'), submenu: booleanMenu },
    ...['group', 'frame', 'ungroup', 'duplicate'].map(menuItem),
    ...(booleanSelected ? [{ id: 'boolean-flatten', label: t('designerBooleanFlatten'), disabled: !editable }] : []),
    { type: 'separator', id: 'layout-divider' },
    { id:'more-layout',label:t('designerMoreLayout'),disabled:!!activeCells || (!layoutContext?.canRemoveAll && !suggestionContext?.canSuggest),submenu:[menuItem('suggestLayout'),menuItem('removeAllLayout')] },
    ...['addLayout', 'removeLayout', 'component', 'combineVariants', 'addVariant', 'dissolveVariants', 'goMain', 'detach'].map(
      menuItem,
    ),
    { type: 'separator', id: 'state-divider' },
    ...['visibility', 'lock', 'flipX', 'flipY', 'delete'].map(menuItem),
  ]
  const openTextLink = (): void => {
    if (!doc || selection.length !== 1 || selectedLocked) return
    let target: string | undefined
    if (activeCells) {
      const path = activeCells.paths.length === 1 ? activeCells.paths[0] : undefined
      const cell = path ? readInstanceCell?.(activeCells.instanceId,path) : undefined
      if (cell?.node.kind === 'text' && !cell.locked) target = [activeCells.instanceId,...cell.effectivePath].join('-')
    } else if (selected?.kind === 'text') target = selected.id
    if (!target) return
    textCaret.current = null
    setEditing(target)
    setLinkRequest(previous => ({ target,serial:(previous?.serial??0)+1 }))
  }
  const captureSave = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey ||
      event.nativeEvent.isComposing || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    event.stopPropagation()
    if (saveAdmissions.current) return
    const admissions: boolean[] = []
    saveAdmissions.current = admissions
    try {
      const target = event.target
      if (target instanceof HTMLElement) target.blur()
      if (admissions.some(accepted => !accepted)) {
        if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
        return
      }
      const workspace = workspaceElement.current
      workspace?.focus({ preventScroll: true })
      if (!workspace || document.activeElement !== workspace || admissions.some(accepted => !accepted)) return
    } finally {
      saveAdmissions.current = null
    }
    void save()
  }
  const keyDown = (e: KeyboardEvent): void => {
    // Portaled menus retain React ancestry; their keys belong to menu navigation.
    if (e.target instanceof Element && e.target.closest('[role="menu"], [data-designer-fill-menu-open="true"]')) return
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    )
      return
    if (vectorEdit && e.key === 'Escape') {
      e.preventDefault(); exitVectorEdit(); return
    }
    if (vectorEdit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault(); return
    }
    if (vectorEdit && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault(); return
    }
    if (!vectorEdit && e.key === 'Enter' && selection.length === 1 && selected?.pageLink &&
      (e.target === e.currentTarget || e.target instanceof SVGElement ||
        e.target instanceof Element && e.target.closest('[data-layer-id]'))) {
      e.preventDefault(); void openPageScreen(selected.id); return
    }
    if (!vectorEdit && e.key === 'Enter' && selected?.kind === 'path') {
      e.preventDefault(); enterVectorEdit(selected); return
    }
    if (crop.onKey(e)) return
    if (e.key === ' ') {
      e.preventDefault()
      setSpacePan(true)
      return
    }
    if (e.key === 'Escape' && gesture.current) {
      setHistory(gesture.current.original)
      gesture.current = null
      setMarquee(null)
      return
    }
    const mod = e.ctrlKey || e.metaKey
    if (mod && ['c', 'x', 'v'].includes(e.key.toLowerCase())) return
    if (mod && e.shiftKey && e.key.toLowerCase() === 'u') {
      e.preventDefault(); openTextLink(); return
    }
    if (activeCells && !editing && !(mod && e.key.toLowerCase() === 'z')) {
      if (e.key === 'Escape') { e.preventDefault(); setInstanceCells(null); setContext(null) }
      else if (mod || ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']'].includes(e.key)) e.preventDefault()
      return
    }
    const suggestShortcut = e.ctrlKey && !e.metaKey && e.shiftKey && e.key.toLowerCase() === 'a' &&
      (/Mac|iPhone|iPad/.test(navigator.platform) ? !e.altKey : e.altKey)
    const shortcut =
      suggestShortcut ? 'suggestLayout' : !mod && e.shiftKey && e.key.toLowerCase() === 'a'
        ? e.altKey
          ? 'removeLayout'
          : 'addLayout'
        : mod && e.key.toLowerCase() === 'a'
          ? 'selectAll'
          : mod && e.key.toLowerCase() === 'c'
            ? 'copyLayers'
            : mod && e.key.toLowerCase() === 'x'
              ? 'cut'
              : mod && e.key.toLowerCase() === 'v'
                ? 'paste'
                : mod && e.altKey && e.key.toLowerCase() === 'g'
                  ? 'frame'
                  : mod && e.altKey && e.key.toLowerCase() === 'k'
                    ? 'component'
                    : mod && e.shiftKey && e.key.toLowerCase() === 'h'
                      ? 'visibility'
                      : mod && e.shiftKey && e.key.toLowerCase() === 'l'
                        ? 'lock'
                        : e.shiftKey && e.key.toLowerCase() === 'h'
                          ? 'flipX'
                          : e.shiftKey && e.key.toLowerCase() === 'v'
                            ? 'flipY'
                            : e.key === ']'
                              ? mod
                                ? 'forward'
                                : 'front'
                              : e.key === '['
                                ? mod
                                  ? 'backward'
                                  : 'back'
                                : null
    if (shortcut) {
      e.preventDefault()
      runCommand(shortcut)
      return
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicate()
    } else if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      if (e.shiftKey) ungroup()
      else group()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove()
    } else if (e.key === 'Escape') {
      if (context) setContext(null)
      else if (editing) setEditing(null)
      else {
        setSelection([])
        setTool('select')
        setContext(null)
      }
    } else if (
      doc &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    ) {
      e.preventDefault()
      const flowParent = selected
        ? computedById.get(selected.parentId ?? '')
        : undefined
      if (
        selection.length === 1 &&
        selected &&
        flowParent &&
        flowParent.layout !== 'none' &&
        !flowParent.preserveLayout &&
        !selected.absolutePosition
      ) {
        if (flowParent.layout === 'grid') {
          const cell = computedById.get(selected.id)?.gridCell
          commit(
            moveDesignGridNode(
              doc,
              selected.id,
              (cell?.column ?? 1) +
                (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0),
              (cell?.row ?? 1) +
                (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0),
            ),
          )
          return
        }
        const siblings = computed.filter(
          n =>
            n.parentId === flowParent.id && n.visible && !n.absolutePosition,
        )
        const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        commit(
          reorderDesignFlowNode(
            doc,
            selected.id,
            siblings.findIndex(n => n.id === selected.id) +
              (backward ? -1 : 1),
          ),
        )
        return
      }
      const amount = e.shiftKey ? 10 : 1
      commit(
        editDesignNodes(
          doc,
          computed.flatMap(n =>
            selection.includes(n.id) && !isLocked(n)
              ? {
                id: n.id,
                x:
                    n.x +
                    (e.key === 'ArrowLeft'
                      ? -amount
                      : e.key === 'ArrowRight'
                        ? amount
                        : 0),
                y:
                    n.y +
                    (e.key === 'ArrowUp'
                      ? -amount
                      : e.key === 'ArrowDown'
                        ? amount
                        : 0),
              }
              : [],
          ),
        ),
      )
    } else {
      const shortcuts: Record<string, Tool> = {
        v: 'select',
        h: 'hand',
        f: 'frame',
        r: 'rectangle',
        o: 'ellipse',
        t: 'text',
        l: 'line',
      }
      const next = shortcuts[e.key.toLowerCase()]
      if (next && !mod && !e.altKey) setTool(next)
    }
  }
  const importFig = async (file: File): Promise<void> => {
    if (dirty || savingRef.current) {
      setError(t('designerSaveBeforeSwitch'))
      return
    }
    if (!/\.fig$/i.test(file.name) || file.size > 25_000_000) {
      setError(t('designerFigLimit'))
      return
    }
    setImporting(true)
    setError('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string')
            resolve(reader.result.slice(reader.result.indexOf(',') + 1))
          else reject(new Error(t('designerFigInvalid')))
        }
        reader.onerror = () => {
          reject(new Error(t('designerFigInvalid')))
        }
        reader.readAsDataURL(file)
      })
      const imported = await actions.importDesign({
        workspaceId,
        fileName: file.name,
        fileBase64: base64,
      })
      setFiles(items => [imported, ...items])
      choose(imported)
      setShowReport(true)
    } catch (error) {
      setError(message(error))
    } finally {
      setImporting(false)
    }
  }
  const addPage = (): void => {
    if (!doc) return
    const existing = doc.pages ?? [
      { id: randomUUID(), name: t('designerPageOne') },
    ]
    const page = {
      id: randomUUID(),
      name: `${t('designerPage')} ${existing.length + 1}`,
      canvasBackground: designCanvasBackground(doc, activePage),
    }
    const first = existing[0]
    commit({
      ...doc,
      pages: [...existing, page],
      nodes: doc.nodes.map(n => (n.pageId ? n : { ...n, pageId: first?.id })),
    })
    setActivePage(page.id)
    setSelection([])
  }
  // Reused artboard subtrees keep the event handlers from the render that created them, so those handlers
  // reach component actions through this ref and always act on the current document and state.
  const liveLayerActions = useRef({ startMove, selectInstanceCell, openCanvasContext, openPageScreen, enterVectorEdit,
    queueTextMeasurement, pageLayoutKey, isLocked, commit, updateVectorPath, cancelPreview, crop })
  liveLayerActions.current = { startMove, selectInstanceCell, openCanvasContext, openPageScreen, enterVectorEdit,
    queueTextMeasurement, pageLayoutKey, isLocked, commit, updateVectorPath, cancelPreview, crop }
  const layerActions = useMemo(() => {
    type Actions = typeof liveLayerActions.current
    return {
      startMove: (...args: Parameters<Actions['startMove']>) => { liveLayerActions.current.startMove(...args) },
      selectInstanceCell: (...args: Parameters<Actions['selectInstanceCell']>) => { liveLayerActions.current.selectInstanceCell(...args) },
      openCanvasContext: (...args: Parameters<Actions['openCanvasContext']>) => { liveLayerActions.current.openCanvasContext(...args) },
      openPageScreen: (...args: Parameters<Actions['openPageScreen']>) => liveLayerActions.current.openPageScreen(...args),
      enterVectorEdit: (...args: Parameters<Actions['enterVectorEdit']>) => { liveLayerActions.current.enterVectorEdit(...args) },
      queueTextMeasurement: (...args: Parameters<Actions['queueTextMeasurement']>) => { liveLayerActions.current.queueTextMeasurement(...args) },
      pageLayoutKey: (...args: Parameters<Actions['pageLayoutKey']>) => liveLayerActions.current.pageLayoutKey(...args),
      isLocked: (...args: Parameters<Actions['isLocked']>) => liveLayerActions.current.isLocked(...args),
      commit: (...args: Parameters<Actions['commit']>) => liveLayerActions.current.commit(...args),
      updateVectorPath: (...args: Parameters<Actions['updateVectorPath']>) => { liveLayerActions.current.updateVectorPath(...args) },
      cancelPreview: () => { liveLayerActions.current.cancelPreview() },
      beginCrop: (...args: Parameters<Actions['crop']['begin']>) => { liveLayerActions.current.crop.begin(...args) },
    }
  }, [])
  // Instances render their component's current content, which can live in any artboard.
  const componentLayout = useMemo(() => {
    const layouts: string[] = []
    for (const root of computed) {
      if (root.kind !== 'component' && root.kind !== 'component-set') continue
      const nodes: CopyOSDesignNode[] = [], pending = [root]
      for (let next = pending.pop(); next; next = pending.pop()) {
        nodes.push(next)
        pending.push(...(childrenById.get(next.id) ?? []))
      }
      layouts.push(serializedLayout(nodes))
    }
    return layouts.join('\n')
  }, [computed, childrenById])
  const previousLayerHashes = useRef(new Map<string, { node: CopyOSDesignNode; hash: string }>())
  const nestedSubtrees = useMemo(() => subtreeLayoutKeys(childrenById, previousLayerHashes.current), [childrenById])
  const renderedTopLevel = useRef(new Map<string, { inputs: readonly unknown[]; element: ReactNode }>())
  useEffect(() => {
    for (const id of renderedTopLevel.current.keys()) if (!nestedSubtrees.has(id)) renderedTopLevel.current.delete(id)
  }, [nestedSubtrees])
  const renderedNested = useRef(new Map<string, { inputs: readonly unknown[]; element: ReactNode }>())
  useEffect(() => {
    for (const id of renderedNested.current.keys()) if (!nestedSubtrees.has(id)) renderedNested.current.delete(id)
  }, [nestedSubtrees])
  const baselineSignatures = new Map<string, Set<string>>()
  const contextIds = new WeakMap<NonNullable<typeof renderScene>['root'], number>()
  let contextCount = 0
  const renderNode = (
    node: CopyOSDesignNode,
    inheritedLock = false,
    instanceChild = false,
    visited = new Set<string>(),
    context = renderScene?.root,
    prefix = '',
    instanceOwner?: { id: string; path: string[] },
  ): ReactNode => {
    const { startMove, selectInstanceCell, openCanvasContext, openPageScreen, enterVectorEdit, queueTextMeasurement,
      pageLayoutKey, isLocked, commit, updateVectorPath, cancelPreview, beginCrop } = layerActions
    if (!context || !node.visible) return null
    let contextId = contextIds.get(context)
    if (contextId === undefined) {
      contextId = contextCount++
      contextIds.set(context, contextId)
    }
    const contextualId = `${contextId}:${node.id}`
    if (visited.has(contextualId) || visited.size >= 64) return null
    const seen = new Set(visited)
    seen.add(contextualId)
    const instance = renderScene?.instance(node, context)
    const source = instance?.byId.get(node.componentId ?? '')
    const current = instance ?? context
    const renderId = prefix + node.id
    const cellPath = instanceOwner ? [...instanceOwner.path, node.id] : null
    const selectedCell = !!instanceOwner && activeCells?.instanceId === instanceOwner.id &&
      activeCells.paths.some(path => JSON.stringify(path) === JSON.stringify(cellPath))
    const base = source ?? node
    const effectNode = { ...base, clip: node.clip }
    const hasInnerEffects = designNodeEffects(effectNode).some(effect =>
      effect.type === 'inner-shadow' && effect.visible && designEffectOpacity(effect) > 0)
    const effectBounds = visualBounds?.node(node, context)
    const effectSourceBounds = effectBounds?.content ?? { x: 0, y: 0, width: node.width, height: node.height }
    const effectSourceId = `stroke-source-${renderId}`
    const liveTextEffects = hasInnerEffects && base.kind === 'text' && editing === renderId
    const effectFilter = hasInnerEffects ? undefined : designEffectsFilter(effectNode, `shadow-${renderId}`, effectBounds?.filter ?? undefined)
    const layerBlurFilter = designLayerBlurFilter(effectNode, `layer-blur-${renderId}`, effectBounds?.filter ?? undefined)
    const dropEffectsPass = hasInnerEffects && base.kind === 'text' && !liveTextEffects ? designEffectsPassFilter(effectNode, `drop-pass-${renderId}`, 'drop-shadow', undefined, effectSourceBounds, effectBounds?.filter ?? undefined) : undefined
    const innerEffectsPass = hasInnerEffects && base.kind === 'text' && !liveTextEffects ? designEffectsPassFilter(effectNode, `inner-pass-${renderId}`, 'inner-shadow', undefined, effectSourceBounds) : undefined
    const layerEffectsFilter = hasInnerEffects && (base.kind !== 'text' || liveTextEffects) ? designEffectsLayerFilter(effectNode, `layer-effects-${renderId}`,
      effectSourceBounds, effectBounds?.filter ?? undefined, base.kind === 'group' || liveTextEffects ? undefined : effectSourceId) : undefined
    const effectPassRect = (filter: typeof effectFilter): ReactNode => filter ? <g aria-hidden="true" pointerEvents="none"
      filter={`url(#${filter.id})`}><g clipPath={node.clip ? `url(#clip-${renderId})` : undefined}
        dangerouslySetInnerHTML={{ __html: designTextEffectsSourceSvg(base, `clone-${filter.id}`) }} /></g> : null
    let captureBaseline = false
    if (base.kind === 'text') {
      const baselineOwner = instanceOwner ? `${instanceOwner.id}:${JSON.stringify(cellPath)}` : base.id
      const signatures = baselineSignatures.get(baselineOwner) ?? new Set<string>()
      const signature = designTextBaselineSignature(base)
      captureBaseline = signatures.has(signature) || signatures.size < 32
      if (captureBaseline) signatures.add(signature)
      baselineSignatures.set(baselineOwner, signatures)
    }
    const locked = node.locked || inheritedLock
    const layoutNode: CopyOSDesignNode =
      source && node.kind === 'instance'
        ? {
          ...source,
          id: node.id,
          locked,
          visible: node.visible,
          width: node.width,
          height: node.height,
        }
        : node
    const paints = designNodePaints(base).filter(p => p.visible)
    const gradientPaints = gradientEdit?.role === 'stroke' && gradientEdit.nodeId === node.id && doc
      ? designAuthoredStrokePaints(doc, node.id).filter(paint => paint.visible) : paints
    const editingGradient =
      gradientEdit?.nodeId === node.id &&
      gradientPaints.some(p => p.id === gradientEdit.paintId && p.gradient)
    // Only text layers use it; for image paints it would URL-encode the full embedded raster on every render.
    const textPaint: ReturnType<typeof designTextPaint> = base.kind === 'text' ? designTextPaint(base, []) : { color: 'currentColor' }
    const booleanOperand = context.byId.get(node.parentId ?? '')?.kind === 'boolean'
    const renderedPaints =
      base.kind === 'text'
        ? [paints.at(-1)]
        : paints.length
          ? paints
          : [undefined]
    const selectionColor =
      node.kind === 'component' || node.kind === 'instance' || node.kind === 'component-set'
        ? '#9959f2'
        : '#0d99ff'
    const vectorEditing = !instanceChild && vectorEdit?.nodeId === node.id
    const chosen =
      !vectorEditing && !preview && !crop.active && !instanceChild && !activeCells && selection.includes(node.id)
    const children = designChildrenInPaintOrder(
      base,
      current.children.get(base.id) ?? [],
    )
    const strokeMarkup = base.kind === 'text' && editing === renderId ? '' : designStrokePaintSvg(base, renderId)
    const strokeVisible = strokeMarkup.length > 0
    const supportsAlignedStroke = ['rectangle', 'ellipse', 'frame', 'component', 'component-set', 'image'].includes(base.kind)
    const outerFrameStroke = node.clip && supportsAlignedStroke && strokeVisible && base.strokeAlign !== 'inside'
    const sourceScale = source ? `scale(${node.width / source.width} ${node.height / source.height})` : undefined
    const renderedStroke = strokeVisible ? <g data-designer-stroke-paints="true" aria-hidden="true" pointerEvents="none"
      dangerouslySetInnerHTML={{ __html: strokeMarkup }} /> : null
    const sizeFromEdge = (event: ReactMouseEvent<SVGElement>, edge: string): void => {
      if (!doc || node.pageLink || locked || editing || preview || tool !== 'select' || spacePan) return
      event.preventDefault()
      event.stopPropagation()
      if (edge.length !== 1) return
      const axis = edge === 'e' || edge === 'w' ? 'width' : 'height'
      const active = gesture.current
      const base = active?.mode === 'resize' && contentKey(historyRef.current?.present ?? doc) === contentKey(active.original.present)
        ? active.original.present : historyRef.current?.present ?? doc
      gesture.current = null
      const context = designSizingContext(base, node.id)
      const policy = event.altKey ? 'fill' : 'hug'
      if (!context || context.locked || !(policy === 'hug' ? context.axis[axis].canHug : context.axis[axis].canFill)) return
      commit(setDesignSizingPolicy(base, [node.id], axis, policy))
    }
    const linkedPage = node.pageLink ? linkedPages.find(page => page.id === node.pageLink?.pageId) : undefined
    return (
      <g
        key={node.id}
        style={designLayerBlendStyle(node)}
        data-design-node={node.id}
        data-instance-owner={instanceOwner?.id}
        data-instance-path={cellPath ? JSON.stringify(cellPath) : undefined}
        transform={designNodeTransform(node)}
        opacity={node.opacity}
        onPointerDown={(e) => {
          if (instanceOwner && cellPath && !preview && e.button === 0 && !spacePan &&
            (e.ctrlKey || e.metaKey || activeCells?.instanceId === instanceOwner.id)) {
            e.preventDefault(); e.stopPropagation()
            selectInstanceCell(instanceOwner.id, cellPath, e.shiftKey)
            return
          }
          if (!instanceChild && !locked && !vectorEditing) startMove(e, node, 'move')
        }}
        onContextMenu={(e) => {
          if (!instanceOwner || !cellPath || preview || !canvas.current) return
          openCanvasContext(e, designerCanvasContextTarget(canvas.current, e.target, e.clientX, e.clientY))
        }}
        onDoubleClick={(e) => {
          if (node.pageLink && !instanceChild && !preview) { e.preventDefault(); e.stopPropagation(); void openPageScreen(node.id); return }
          if (node.kind === 'path' && !preview && !locked) {
            e.preventDefault(); e.stopPropagation(); enterVectorEdit(node, !!instanceOwner || instanceChild); return
          }
          if (instanceOwner && cellPath && node.kind !== 'text' && !preview) {
            e.stopPropagation(); selectInstanceCell(instanceOwner.id, cellPath); return
          }
          const imagePaint = paints.findLast(p => !!p.image)
          if (
            !preview &&
            !locked &&
            !instanceChild &&
            node.kind !== 'text' &&
            node.kind !== 'instance' &&
            imagePaint
          ) {
            e.stopPropagation()
            beginCrop(node.id, imagePaint.id)
            return
          }
          if (!preview && !locked && !instanceChild) {
            e.stopPropagation()
            setSelection([node.id])
          }
          if (!preview && !locked && node.kind === 'text') {
            e.stopPropagation()
            textCaret.current = { x: e.clientX, y: e.clientY }
            setSelection([instanceOwner?.id ?? node.id])
            setEditing(renderId)
          }
        }}
      >
        <defs>
          <clipPath id={`clip-${renderId}`}>
            <path
              d={designRectanglePath({
                ...base,
                width: node.width,
                height: node.height,
              })}
            />
          </clipPath>
          {paints.map(paint =>
            paint.image ? (
              <DesignerImagePattern
                key={paint.id}
                id={`image-${renderId}-${paint.id}`}
                image={paint.image}
                width={base.width}
                height={base.height}
              />
            ) : paint.gradient ? (
              paint.gradient.type === 'linear' ? (
                <linearGradient
                  key={paint.id}
                  id={`gradient-${renderId}-${paint.id}`}
                  gradientTransform={designGradientTransform(
                    paint.gradient.transform,
                  )}
                  x1="0"
                  y1="0.5"
                  x2="1"
                  y2="0.5"
                >
                  {[...paint.gradient.stops]
                    .sort((a, b) => a.position - b.position)
                    .map((stop, i) => (
                      <stop
                        key={stop.id ?? i}
                        offset={stop.position}
                        stopColor={stop.color}
                        stopOpacity={stop.opacity}
                      />
                    ))}
                </linearGradient>
              ) : (
                <radialGradient
                  key={paint.id}
                  id={`gradient-${renderId}-${paint.id}`}
                  gradientTransform={designGradientTransform(
                    paint.gradient.transform,
                  )}
                  cx="0.5"
                  cy="0.5"
                  r="0.5"
                >
                  {[...paint.gradient.stops]
                    .sort((a, b) => a.position - b.position)
                    .map((stop, i) => (
                      <stop
                        key={stop.id ?? i}
                        offset={stop.position}
                        stopColor={stop.color}
                        stopOpacity={stop.opacity}
                      />
                    ))}
                </radialGradient>
              )
            ) : null,
          )}
          {hasInnerEffects && base.kind !== 'text' && base.kind !== 'group' ? <svg id={effectSourceId} x={0} y={0}
            width={effectSourceBounds.width} height={effectSourceBounds.height}
            viewBox={`${effectSourceBounds.x} ${effectSourceBounds.y} ${effectSourceBounds.width} ${effectSourceBounds.height}`} overflow="visible">
            <g clipPath={node.clip && !outerFrameStroke ? `url(#clip-${renderId})` : undefined}><g transform={sourceScale}
              dangerouslySetInnerHTML={{ __html: designStrokePaintSvg(base, `sample-stroke-${renderId}`) }} /></g>
          </svg> : null}
          {[dropEffectsPass, innerEffectsPass, layerEffectsFilter, layerBlurFilter].map(filter => filter ? <filter key={filter.id} id={filter.id} filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB" x={filter.x} y={filter.y} width={filter.width} height={filter.height}
            dangerouslySetInnerHTML={{ __html: filter.markup }} /> : null)}
          {effectFilter ? (
            <filter id={effectFilter.id} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"
              x={effectFilter.x} y={effectFilter.y} width={effectFilter.width} height={effectFilter.height}
              dangerouslySetInnerHTML={{ __html: effectFilter.markup }} />
          ) : null}
        </defs>
        <rect
          width={node.width}
          height={node.height}
          fill="transparent"
          pointerEvents={locked || booleanOperand || base.kind === 'boolean' ? 'none' : 'all'}
        />
        <g filter={layerBlurFilter ? `url(#${layerBlurFilter.id})` : undefined}>
          {effectPassRect(dropEffectsPass)}
          <g filter={effectFilter ? `url(#${effectFilter.id})` : undefined}>
            <g filter={layerEffectsFilter ? `url(#${layerEffectsFilter.id})` : undefined}>
              {layerEffectsFilter ? <rect x={effectSourceBounds.x} y={effectSourceBounds.y}
                width={effectSourceBounds.width} height={effectSourceBounds.height} fill="transparent" pointerEvents="none" /> : null}
              <g clipPath={node.clip ? `url(#clip-${renderId})` : undefined}>
                <g transform={sourceScale}>
                  {renderedPaints.map((paint) => {
                    const shapeProps = {
                      fill: paint
                        ? paint.image
                          ? `url(#image-${renderId}-${paint.id})`
                          : paint.gradient
                            ? `url(#gradient-${renderId}-${paint.id})`
                            : paint.color
                        : 'transparent',
                      fillOpacity: booleanOperand ? 0 : paint?.opacity ?? 0,
                      stroke: booleanOperand ? '#0d99ff' : 'none',
                      strokeWidth: booleanOperand ? 1 : 0,
                      vectorEffect: booleanOperand ? 'non-scaling-stroke' : undefined,
                      strokeOpacity: base.strokeOpacity ?? 1,
                      strokeDasharray: base.strokeDash || undefined,
                    }
                    return (
                      <g key={paint?.id ?? node.id} pointerEvents={booleanOperand ? 'none' : undefined} data-designer-paint={paint?.id} style={{ mixBlendMode: base.kind === 'text' ? 'normal' : paint?.blendMode ?? 'normal' }}>
                        {(base.kind === 'path' || base.kind === 'boolean') && base.pathData ? (
                          <g
                            transform={`scale(${base.width / base.pathData.width} ${base.height / base.pathData.height})`}
                          >
                            {base.pathData.paths.map((path, i) => (
                              <path
                                key={i}
                                d={path.d}
                                fillRule={path.fillRule}
                                {...shapeProps}
                              />
                            ))}
                          </g>
                        ) : base.kind === 'ellipse' ? (
                          <ellipse
                            cx={base.width / 2}
                            cy={base.height / 2}
                            rx={base.width / 2}
                            ry={base.height / 2}
                            {...shapeProps}
                          />
                        ) : base.kind === 'text' ? (
                          <>
                            {editing !== renderId ? <g data-designer-text-fills="true" aria-hidden="true" pointerEvents="none" dangerouslySetInnerHTML={{ __html: designTextFillSvg(base, renderId) }} /> : null}
                            <foreignObject
                              opacity={editing === renderId ? 1 : 0}
                              width={base.width}
                              height={base.height}
                              overflow={
                                editing === renderId ||
                          (base.textWrap === false && !designTextOverflow(base))
                                  ? 'visible'
                                  : 'hidden'
                              }
                            >
                              {editing !== renderId ? (
                                <DesignerTextMetrics
                                  node={base}
                                  captureBaseline={captureBaseline}
                                  onSize={
                                    !!base.textLayoutMetrics?.engine || (base.textSizing && base.textSizing !== 'fixed') || base.textTruncation === 'ending'
                                      ? (size) => {
                                        const metrics = {
                                          signature: designTextLayoutSignature(base),
                                          ...(size.overflow ? { overflow: size.overflow } : {}),
                                          width: Math.max(1, Math.min(100000, size.width)),
                                          height: Math.max(1, Math.min(100000, size.height)),
                                        }
                                        const fitted = size.overflow
                                        if (!instanceOwner) {
                                          queueTextMeasurement(doc?.id, (batch) => {
                                            const stored = batch.node(base.id)
                                            if (!stored || JSON.stringify(stored.textLayoutMetrics) === JSON.stringify(metrics)) return
                                            const arranged = batch.scene().root.byId.get(stored.id) ?? stored
                                            if (designTextLayoutSignature(arranged) !== metrics.signature) return
                                            const bytes = batch.signatureBytes - (stored.textLayoutMetrics?.signature.length ?? 0) -
                                                (stored.textLayoutMetrics?.overflow?.signature.length ?? 0) +
                                                metrics.signature.length + (fitted?.signature.length ?? 0)
                                            if (bytes > 8000000) return
                                            batch.signatureBytes = bytes
                                            batch.patch({ id: base.id, textLayoutMetrics: metrics })
                                          })
                                          return
                                        }
                                        const path = [...instanceOwner.path, base.id]
                                        queueTextMeasurement(doc?.id, (batch) => {
                                          const stored = batch.node(instanceOwner.id)
                                          if (!stored || stored.kind !== 'instance') return
                                          const contextual = batch.context()(stored.id, path)
                                          if (!contextual || designTextLayoutSignature(contextual.node) !== metrics.signature) return
                                          const canonicalPath = contextual.overridePath
                                          const records = stored.instanceOverrides ?? []
                                          const previous = records.find(o => JSON.stringify(o.path) === JSON.stringify(canonicalPath))
                                          if (!previous?.textLayoutMetrics?.engine &&
                                              JSON.stringify(previous?.textLayoutMetrics?.overflow) === JSON.stringify(metrics.overflow) &&
                                              previous?.textLayoutMetrics?.signature === metrics.signature &&
                                              Math.abs(previous.textLayoutMetrics.width - metrics.width) < 0.5 &&
                                              Math.abs(previous.textLayoutMetrics.height - metrics.height) < 0.5) return
                                          if (!previous && (records.length >= 1000 || batch.overrideCount >= 10000)) return
                                          const nextBytes = batch.signatureBytes - (previous?.textLayoutMetrics?.signature.length ?? 0) -
                                              (previous?.textLayoutMetrics?.overflow?.signature.length ?? 0) + metrics.signature.length +
                                              (metrics.overflow?.signature.length ?? 0)
                                          if (nextBytes > 8000000) return
                                          batch.signatureBytes = nextBytes
                                          if (!previous) batch.overrideCount += 1
                                          const next = { ...previous, path: canonicalPath, textLayoutMetrics: metrics }
                                          const instanceOverrides = previous
                                            ? records.map(o => o === previous ? next : o) : [...records, next]
                                          batch.patch({ id: stored.id, instanceOverrides })
                                        })
                                      }
                                      : undefined
                                  }
                                  onMeasure={(metrics) => {
                                    queueTextMeasurement(doc?.id, (batch) => {
                                      const stored = batch.node(instanceOwner?.id ?? base.id)
                                      if (!stored) return
                                      const path = instanceOwner ? [...instanceOwner.path, base.id] : null
                                      const contextual = path ? batch.context()(stored.id, path) : null
                                      if (path && !contextual) return
                                      const currentText = contextual?.node ?? batch.scene().root.byId.get(stored.id) ?? stored
                                      if (designTextBaselineSignature(currentText) !== metrics.signature) return
                                      const records = stored.instanceOverrides ?? []
                                      const previous = contextual ? records.find(record =>
                                        JSON.stringify(record.path) === JSON.stringify(contextual.overridePath)) : undefined
                                      const caches = (contextual ? previous?.textBaselineMetrics : stored.textBaselineMetrics) ?? []
                                      const browser = caches.find(cache => cache.signature === metrics.signature && !cache.engine)
                                      if (browser && Math.abs(browser.baseline - metrics.baseline) < 0.001) return
                                      if (!browser && caches.length >= 32) return
                                      const measured = browser
                                        ? caches.map(cache => cache === browser ? metrics : cache) : [...caches, metrics]
                                      if (contextual) {
                                        if (!previous && (records.length >= 1000 || batch.overrideCount >= 10000)) return
                                        if (!previous) batch.overrideCount += 1
                                        const next = { ...previous, path: contextual.overridePath, textBaselineMetrics: measured }
                                        batch.patch({ id: stored.id, instanceOverrides: previous
                                          ? records.map(record => record === previous ? next : record) : [...records, next] })
                                        return
                                      }
                                      batch.patch({ id: stored.id, textBaselineMetrics: measured })
                                    })
                                  }}
                                />
                              ) : null}
                              <div
                                style={{
                                  minHeight:
                              base.verticalAlign &&
                              base.verticalAlign !== 'top' &&
                              (!base.textSizing || base.textSizing === 'fixed')
                                ? '100%'
                                : undefined,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent:
                              base.verticalAlign === 'center'
                                ? 'center'
                                : base.verticalAlign === 'bottom'
                                  ? 'flex-end'
                                  : undefined,
                                }}
                              >
                                <InlineDesignText
                                  intrinsicWidth={base.textSizing === 'auto-width'}
                                  node={base}
                                  ownerKey={`${doc?.id}:${renderId}`}
                                  t={t}
                                  linkTargets={textLinkTargets}
                                  linkRequest={linkRequest?.target === renderId ? linkRequest.serial : 0}
                                  linkContextKey={`${doc?.id}:${revision.current}:${doc?.activeTokenModeId??'base'}`}
                                  onFollowLink={(targetId) => {
                                    const target = historyRef.current?.present.nodes.find(node => node.id === targetId)
                                    if (!target) return false
                                    setActivePage(target.pageId ?? historyRef.current?.present.pages?.[0]?.id ?? '')
                                    setSelection([target.id])
                                    return true
                                  }}
                                  families={textFamilies}
                                  overflow={designTextOverflow(base)}
                                  onMeasure={(width, height) => {
                                    if (
                                      !base.textSizing ||
                                base.textSizing === 'fixed' ||
                                instanceChild
                                    )
                                      return
                                    // The text being edited resizes immediately; other layers report in batches.
                                    queueTextMeasurement(doc?.id, (batch) => {
                                      const n = batch.node(node.id)
                                      if (!n) return
                                      const nextWidth = base.textSizing === 'auto-width' ? Math.max(1, width) : base.width
                                      const nextHeight = Math.max(1, height)
                                      if ((base.textSizing !== 'auto-width' || Math.abs(n.width - nextWidth) < 1) &&
                                        Math.abs(n.height - nextHeight) < 1) return
                                      batch.patch({ id: node.id, ...(base.textSizing === 'auto-width' ? { width: nextWidth } : {}),
                                        height: nextHeight }, 'size')
                                    }, editing === renderId)
                                  }}
                                  active={editing === renderId && !locked}
                                  caret={textCaret.current}
                                  label={t('designerCanvasTextContent')}
                                  onDirty={() => {
                                    userActionVersion.current++
                                    setTextDirty(true)
                                  }}
                                  onFinish={(value, edited) => {
                                    const current = historyRef.current?.present
                                    if (!current || current.id !== doc?.id) return false
                                    if (!edited) { setTextDirty(false); setEditing(null); return true }
                                    let accepted = true
                                    if (instanceOwner) {
                                      const stored = current.nodes.find(node => node.id === instanceOwner.id)
                                      const path = [...instanceOwner.path, base.id]
                                      const context = designTextRangeContext(current, instanceOwner.id, path)
                                      if (!stored || !context || context.locked) return false
                                      if (value.text !== context.node.text ||
                                    JSON.stringify(value.textRuns) !== JSON.stringify(context.node.textRuns ?? [])) {
                                        const records = stored.instanceOverrides ?? []
                                        const previous = records.find(record =>
                                          JSON.stringify(record.path) === JSON.stringify(context.overridePath))
                                        const next = { ...previous, path: context.overridePath,
                                          ...(value.text !== context.node.text ? { text: value.text } : {}),
                                          ...(value.textRuns.length || context.node.textRuns?.length || previous?.textRuns !== undefined
                                            ? { textRuns: value.textRuns } : {}) }
                                        accepted = commit(editDesignNodes(current, [{ id: stored.id, instanceOverrides: previous
                                          ? records.map(record => record === previous ? next : record) : [...records, next] }]))
                                      }
                                    } else {
                                      const stored = current.nodes.find(item => item.id === node.id)
                                      if (!stored || isLocked(stored)) return false
                                      if (value.text !== stored.text ||
                                    JSON.stringify(value.textRuns) !== JSON.stringify(stored.textRuns ?? []))
                                        accepted = commit(editDesignNodes(current, [{ id: node.id, text: value.text,
                                          ...(value.textRuns.length || stored.textRuns !== undefined
                                            ? { textRuns: value.textRuns } : {}) }]))
                                    }
                                    if (accepted) { setTextDirty(false); setEditing(null) }
                                    return accepted
                                  }}
                                  style={{
                                    color: textPaint.color,
                                    backgroundImage: textPaint.backgroundImage,
                                    backgroundBlendMode: textPaint.backgroundBlendMode,
                                    backgroundClip: textPaint.backgroundImage
                                      ? 'text'
                                      : undefined,
                                    WebkitBackgroundClip: textPaint.backgroundImage
                                      ? 'text'
                                      : undefined,
                                    backgroundSize: `${base.width}px ${base.height}px`,
                                    backgroundRepeat: 'no-repeat',
                                    caretColor: paint?.color ?? base.fill,
                                    fontFamily: base.fontFamily,
                                    fontStyle: base.fontStyle ?? 'normal',
                                    fontFeatureSettings: designFontFeatureSettings(base.fontFeatures),
                                    fontVariationSettings: designFontVariationSettings(base.fontVariations),
                                    letterSpacing: base.letterSpacing ?? 0,
                                    textDecoration: base.textDecoration,
                                    textTransform: base.textCase,
                                    fontSize: base.fontSize,
                                    fontWeight: base.fontWeight,
                                    lineHeight: base.lineHeight,
                                    textAlign: base.textAlign,
                                    width:
                                base.textSizing === 'auto-width'
                                  ? 'max-content'
                                  : base.width,
                                    whiteSpace:
                                base.textSizing === 'auto-width' ||
                                base.textWrap === false
                                  ? 'pre'
                                  : 'pre-wrap',
                                    overflowWrap: 'break-word',
                                  }}
                                />
                              </div>
                            </foreignObject>
                          </>
                        ) : (
                          <path
                            d={designRectanglePath(base)}
                            {...shapeProps}
                            fill={
                              base.kind === 'group' ? 'transparent' : shapeProps.fill
                            }
                          />
                        )}
                      </g>
                    )
                  })}
                  {!hasInnerEffects && !outerFrameStroke ? renderedStroke : null}
                  {children.filter(child => base.kind !== 'boolean' || selection.includes(child.id) || !!doc && selection.some(id => designDescendants(doc.nodes, child.id).has(id)) || !!vectorEdit && vectorEdit.nodeId === child.id).map(child =>
                    !source && !instanceChild && !instanceOwner && !prefix && current === renderScene?.root
                      ? renderNested(child, locked, seen)
                      : renderNode(
                        child,
                        locked,
                        instanceChild || !!source,
                        seen,
                        current,
                        source ? renderId + '-' : prefix,
                        source
                          ? instanceOwner
                            ? {
                              id: instanceOwner.id,
                              path: [...instanceOwner.path, node.id],
                            }
                            : { id: node.id, path: [] }
                          : instanceOwner,
                      ),
                  )}
                </g>
              </g>
              {hasInnerEffects && base.kind === 'group' ? <g transform={sourceScale}>{renderedStroke}</g> : null}
            </g>
            {hasInnerEffects ? effectPassRect(innerEffectsPass) : null}
            {hasInnerEffects && base.kind !== 'group' ? <g clipPath={node.clip && !outerFrameStroke ? `url(#clip-${renderId})` : undefined}>
              <g transform={sourceScale}>{renderedStroke}</g></g>
              : !hasInnerEffects && outerFrameStroke ? <g transform={sourceScale}>{renderedStroke}</g> : null}
          </g>
        </g>
        {node.pageLink ? <foreignObject width={node.width} height={node.height} pointerEvents="none" clipPath={`url(#clip-${renderId})`} data-canvas-page-screen={node.pageLink.pageId}>
          {linkedPage ? <CanvasPagePreview
            key={`${node.id}:${pageResourceEpoch[node.id] ?? 0}`} page={linkedPage} width={node.width} height={node.height}
            autoHeight={node.pageLink.autoHeight && !openedPageId}
            onLayout={(layout) => {
              if (historyRef.current?.present.id !== doc?.id || !node.pageLink?.autoHeight) return
              const key = pageLayoutKey(node, linkedPage)
              setPageLayouts(current => current[node.id]?.key === key && current[node.id]?.height === layout.height &&
                current[node.id]?.state === layout.state ? current
                : { ...current, [node.id]: { key, height: layout.height, state: layout.state } })
            }}
            onResourceState={(state) => {
              setPageResources(current => current[node.id] === state ? current : { ...current, [node.id]: state })
            }}
            title={node.name} {...(projectPath === undefined ? {} : { projectPath })} />
            : <div className={css.pageScreenPlaceholder} role="status">{pagesLoading ? t('designerLoading') : t('canvasBuilderPageMissing')}</div>}
        </foreignObject> : null}
        {vectorEditing && node.pathData && doc ? <DesignerVectorEditor
          key={`${doc.id}:${node.id}`} pathData={node.pathData} width={node.width} height={node.height}
          zoom={view.zoom} t={t} toolbar={vectorToolbar}
          onPreview={(pathData) => { updateVectorPath(node.id, pathData, true) }}
          onCommit={(pathData) => { updateVectorPath(node.id, pathData, false) }}
          onCancel={cancelPreview}
        /> : null}
        {!preview &&
        node.parentId === null &&
        ['frame', 'component', 'component-set'].includes(node.kind) ? (
            <ArtboardLabel text={`${node.name}${conversionSources.get(node.id) ? ` · ${t('canvasConversionOriginal')}` : ''}`}
              width={node.width} component={node.kind === 'component' || node.kind === 'component-set'} />
          ) : null}
        {selectedCell && !preview ? <rect width={node.width} height={node.height} fill="none" stroke="#0d99ff" strokeWidth={1.5 / view.zoom} pointerEvents="none" data-instance-cell-selection="true" /> : null}
        {!instanceChild && !preview ? (
          <rect
            width={node.width}
            height={node.height}
            fill="transparent"
            stroke={chosen ? selectionColor : 'transparent'}
            strokeWidth={1.5 / view.zoom}
            pointerEvents="none"
            onPointerDown={(e) => {
              if (!locked) startMove(e, node, 'move')
            }}
            onDoubleClick={(e) => {
              if (!locked && node.kind === 'text') {
                e.stopPropagation()
                textCaret.current = { x: e.clientX, y: e.clientY }
                setSelection([node.id])
                setEditing(node.id)
              }
            }}
          />
        ) : null}
        {!preview &&
        !instanceChild &&
        layoutNode.layout === 'grid' &&
        !layoutNode.preserveLayout &&
        (chosen || (node.kind !== 'instance' && children.some(child => selection.includes(child.id)))) ? (
            <DesignerGridOverlay
              boxes={current.layoutBoxes}
              node={layoutNode}
              children={children}
              zoom={view.zoom}
              color={selectionColor}
              handles={chosen && !locked && node.kind !== 'instance'}
              t={t}
              onResize={(axis, index, size) => {
                if (doc)
                  commit(resizeDesignGridTrack(doc, node.id, axis, index, size))
              }}
              onStart={(e, axis, index, size) => {
                if (
                  !history ||
                locked ||
                editing ||
                tool !== 'select' ||
                e.button !== 0
                )
                  return
                e.preventDefault()
                e.stopPropagation()
                const matrix = e.currentTarget
                  .closest<SVGGElement>('[data-design-node]')
                  ?.getScreenCTM()
                  ?.inverse()
                if (!matrix) return
                e.currentTarget.setPointerCapture(e.pointerId)
                gesture.current = {
                  mode: 'grid-track',
                  startX: e.clientX,
                  startY: e.clientY,
                  original: historyRef.current ?? history,
                  ids: [node.id],
                  panX: view.x,
                  panY: view.y,
                  gridTrack: {
                    nodeId: node.id,
                    axis,
                    index,
                    size,
                    matrix: [matrix.a, matrix.b, matrix.c, matrix.d],
                  },
                }
              }}
            />
          ) : null}
        {chosen &&
        selection.length === 1 &&
        !locked &&
        !editing &&
        !editingGradient &&
        !crop.active &&
        !spacePan &&
        tool === 'select' &&
        (node.kind !== 'instance' ||
          ['row', 'column', 'grid'].includes(layoutNode.layout)) &&
        layoutNode.layout !== 'none' ? (
            <DesignerLayoutOverlay
              color="#f248bd"
              node={layoutNode}
              parentId={base.id}
              children={current.children.get(base.id) ?? []}
              lines={current.stackLines.get(base.id)}
              zoom={view.zoom}
              activeField={
                gesture.current?.layoutSpacing?.nodeId === node.id
                  ? gesture.current.layoutSpacing.field
                  : undefined
              }
              labels={{
                paddingTop: t('designerPaddingTop'),
                paddingRight: t('designerPaddingRight'),
                paddingBottom: t('designerPaddingBottom'),
                paddingLeft: t('designerPaddingLeft'),
                gap: t(layoutNode.layout === 'grid' ? 'designerGridColumnGap' : 'designerGap'),
                crossGap: t(layoutNode.layout === 'grid' ? 'designerGridRowGap' : 'designerCrossGap'),
              }}
              onChange={(field, value, modifiers) => {
                if (doc)
                  commit(
                    editLayoutSpacing(doc, layoutNode, field, value, modifiers),
                  )
              }}
              onStart={(e, field, value) => {
                if (!history || e.button !== 0) return
                const matrix = e.currentTarget
                  .closest<SVGGElement>('[data-design-node]')
                  ?.getScreenCTM()
                  ?.inverse()
                if (!matrix) return
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                gesture.current = {
                  mode: 'layout-spacing',
                  startX: e.clientX,
                  startY: e.clientY,
                  original: historyRef.current ?? history,
                  ids: [node.id],
                  panX: view.x,
                  panY: view.y,
                  layoutSpacing: {
                    displayed: layoutNode,
                    nodeId: node.id,
                    field,
                    value,
                    axis:
                    field === 'crossGap'
                      ? layoutNode.layout === 'column'
                        ? 'x'
                        : 'y'
                      : field === 'gap'
                        ? layoutNode.layout === 'column'
                          ? 'y'
                          : 'x'
                        : field === 'paddingLeft' || field === 'paddingRight'
                          ? 'x'
                          : 'y',
                    direction:
                    field === 'paddingRight' || field === 'paddingBottom'
                      ? -1
                      : 1,
                    matrix: [matrix.a, matrix.b, matrix.c, matrix.d],
                  },
                }
              }}
            />
          ) : null}
        {chosen && !locked && gradientEdit?.nodeId === node.id
          ? (() => {
            const paint = gradientPaints.find(p => p.id === gradientEdit.paintId)
            if (!paint?.gradient) return null
            const gradient = paint.gradient,
              points = designGradientPoints(gradient)
            const handles =
              gradient.type === 'radial'
                ? (['start', 'end', 'cross'] as const)
                : (['start', 'end'] as const)
            return (
              <g data-designer-paint-handle="true" data-designer-paint-role={gradientEdit.role}>
                <line
                  x1={points.start.x * node.width}
                  y1={points.start.y * node.height}
                  x2={points.end.x * node.width}
                  y2={points.end.y * node.height}
                  stroke="#ffffff"
                  strokeWidth={3 / view.zoom}
                  pointerEvents="none"
                />
                <line
                  x1={points.start.x * node.width}
                  y1={points.start.y * node.height}
                  x2={points.end.x * node.width}
                  y2={points.end.y * node.height}
                  stroke="#9959f2"
                  strokeWidth={1 / view.zoom}
                  pointerEvents="none"
                />
                {gradient.type === 'radial' ? (
                  <line
                    x1={points.start.x * node.width}
                    y1={points.start.y * node.height}
                    x2={points.cross.x * node.width}
                    y2={points.cross.y * node.height}
                    stroke="#9959f2"
                    strokeWidth={1 / view.zoom}
                    pointerEvents="none"
                  />
                ) : null}
                {handles.map(handle => (
                  <circle
                    key={handle}
                    role="button"
                    tabIndex={0}
                    aria-label={t(
                      handle === 'start'
                        ? 'designerGradientStartHandle'
                        : handle === 'end'
                          ? 'designerGradientEndHandle'
                          : 'designerGradientCrossHandle',
                    )}
                    cx={points[handle].x * node.width}
                    cy={points[handle].y * node.height}
                    r={5 / view.zoom}
                    fill="white"
                    stroke="#9959f2"
                    strokeWidth={2 / view.zoom}
                    style={{ cursor: 'crosshair' }}
                    onKeyDown={(e) => {
                      if (
                        ![
                          'ArrowLeft',
                          'ArrowRight',
                          'ArrowUp',
                          'ArrowDown',
                        ].includes(e.key)
                      )
                        return
                      e.preventDefault()
                      e.stopPropagation()
                      if (!doc) return
                      const amount = e.shiftKey ? 10 : 1
                      const target = {
                        x:
                            points[handle].x +
                            (e.key === 'ArrowLeft'
                              ? -amount
                              : e.key === 'ArrowRight'
                                ? amount
                                : 0) /
                              node.width,
                        y:
                            points[handle].y +
                            (e.key === 'ArrowUp'
                              ? -amount
                              : e.key === 'ArrowDown'
                                ? amount
                                : 0) /
                              node.height,
                      }
                      const next = moveDesignGradientHandle(
                        gradient,
                        handle,
                        target,
                        node.width,
                        node.height,
                      )
                      commit(gradientEdit.role === 'stroke' ? editDesignerStrokeGradient(doc, node.id, paint.id, next) : {
                        ...doc,
                        nodes: doc.nodes.map(n =>
                          n.id === node.id
                            ? {
                              ...n,
                              gradient: undefined,
                              fills: designNodePaints(n).map(p =>
                                p.id === paint.id
                                  ? { ...p, gradient: next }
                                  : p,
                              ),
                            }
                            : n,
                        ),
                      })
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const layer =
                          e.currentTarget.closest<SVGGElement>(
                            '[data-design-node]',
                          ),
                        matrix = layer?.getScreenCTM()?.inverse()
                      if (!matrix || !history) return
                      e.currentTarget.setPointerCapture(e.pointerId)
                      gesture.current = {
                        mode: 'gradient',
                        startX: e.clientX,
                        startY: e.clientY,
                        original: historyRef.current ?? history,
                        ids: [node.id],
                        panX: view.x,
                        panY: view.y,
                        gradient: {
                          role: gradientEdit.role,
                          nodeId: node.id,
                          paintId: paint.id,
                          point: handle,
                          matrix: [
                            matrix.a,
                            matrix.b,
                            matrix.c,
                            matrix.d,
                            matrix.e,
                            matrix.f,
                          ],
                          width: node.width,
                          height: node.height,
                          paint: gradient,
                        },
                      }
                    }}
                  />
                ))}
              </g>
            )
          })()
          : null}
        {chosen && !locked && node.kind !== 'boolean' && !editingGradient ? (['n', 'e', 's', 'w'] as const).filter(edge => !node.pageLink?.autoHeight || edge === 'e' || edge === 'w').map((edge) => {
          // Cap each band at a third of the on-screen size so thin layers keep a hittable middle for selection and text editing.
          const vertical = edge === 'e' || edge === 'w', inset = 8 / view.zoom
          const thickness = Math.min(8, (vertical ? node.width : node.height) * view.zoom / 3) / view.zoom
          return <g key={`edge-${edge}`} data-designer-sizing-edge={edge}
            onDoubleClick={(event) => { sizeFromEdge(event, edge) }}
            onPointerDown={(event) => { startMove(event, node, 'resize', edge) }}>
            <rect fill="transparent" pointerEvents="all"
              x={vertical ? (edge === 'e' ? node.width : 0) - thickness / 2 : inset}
              y={vertical ? inset : (edge === 's' ? node.height : 0) - thickness / 2}
              width={vertical ? thickness : Math.max(0, node.width - inset * 2)}
              height={vertical ? Math.max(0, node.height - inset * 2) : thickness}
              style={{ cursor: `${edge}-resize` }} />
          </g>
        }) : null}
        {chosen && !locked && !editingGradient
          ? (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).filter(handle => (!node.pageLink?.autoHeight || handle === 'e' || handle === 'w') &&
            (node.kind !== 'boolean' || handle.length === 2)).map(
            handle => (
              <g
                key={handle}
                data-designer-resize-handle={handle}
                onDoubleClick={(event) => { sizeFromEdge(event, handle) }}
                onPointerDown={(e) => {
                  startMove(e, node, 'resize', handle)
                }}
              >
                <rect
                  x={
                    (handle.includes('w')
                      ? 0
                      : handle.includes('e')
                        ? node.width
                        : node.width / 2) -
                      3 / view.zoom
                  }
                  y={
                    (handle.includes('n')
                      ? 0
                      : handle.includes('s')
                        ? node.height
                        : node.height / 2) -
                      3 / view.zoom
                  }
                  width={6 / view.zoom}
                  height={6 / view.zoom}
                  fill="white"
                  stroke={selectionColor}
                  strokeWidth={1 / view.zoom}
                  style={{ cursor: `${handle}-resize` }}
                />
              </g>
            ),
          )
          : null}
      </g>
    )
  }
  // A layer subtree whose inputs are unchanged returns its previous element, so React skips reconciling it. Subtrees holding
  // the selection or an active edit always render fresh, down to the edited layer; their unchanged siblings are reused, so a
  // page drawn as one large artboard re-renders only the selected path. Zoom is not an input: idle layers read it only through
  // ArtboardLabel's context, transparent hit-target strokes and non-scaling boolean operand outlines.
  // Subtrees that cannot reach the canvas region around the viewport are not mounted; the region only changes after
  // panning past its margin or zooming past a power-of-two step, so idle subtrees keep their cached elements meanwhile.
  const cullRegion = designerCullRegion(painted, canvasSize)
  const activeLayers = new Set<string>()
  for (const id of [...selection, gradientEdit?.nodeId, vectorEdit?.nodeId, activeCells?.instanceId])
    for (let current = id === undefined ? undefined : computedById.get(id); current && !activeLayers.has(current.id);
      current = current.parentId === null ? undefined : computedById.get(current.parentId)) activeLayers.add(current.id)
  const documentFields: unknown[] = []
  if (doc) for (const [key, value] of Object.entries(doc)) if (key !== 'nodes') { const field: unknown = value; documentFields.push(key, field) }
  const reuseRendered = (cache: Map<string, { inputs: readonly unknown[]; element: ReactNode }>, id: string,
    subtree: { layout: string; instances: boolean; pages: boolean } | undefined, extra: readonly unknown[],
    render: () => ReactNode): ReactNode => {
    const cull = activeLayers.has(id) ? 'in' : designerCullState(sceneBoxes?.(id) ?? null, cullRegion)
    if (cull === 'out') return null
    if (!subtree || !doc || activeLayers.has(id)) {
      cache.delete(id)
      return render()
    }
    const inputs = [cull === 'partial' ? cullRegion?.key : cull, subtree.layout, subtree.instances ? componentLayout : null, preview, tool, spacePan, editing,
      !!activeCells, crop.active, t, linkRequest, revision.current, textFamilies, textLinkTargets, ...extra,
      ...(subtree.pages ? [linkedPages, pagesLoading, openedPageId, pageResourceEpoch[id] ?? 0, projectPath] : []), ...documentFields]
    const previous = cache.get(id)
    if (previous && previous.inputs.length === inputs.length && previous.inputs.every((value, index) => Object.is(value, inputs[index])))
      return previous.element
    const element = render()
    cache.set(id, { inputs, element })
    return element
  }
  const renderTopLevel = (node: CopyOSDesignNode): ReactNode => {
    const entry = nestedSubtrees.get(node.id)
    return reuseRendered(renderedTopLevel.current, node.id, entry && { layout: entry.key, instances: entry.instances, pages: entry.pages },
      [conversionSources.get(node.id) ?? null], () => renderNode(node))
  }
  function renderNested(node: CopyOSDesignNode, inheritedLock: boolean, visited: Set<string>): ReactNode {
    const entry = nestedSubtrees.get(node.id)
    return reuseRendered(renderedNested.current, node.id, entry && { layout: entry.key, instances: entry.instances, pages: entry.pages },
      [inheritedLock], () => renderNode(node, inheritedLock, false, visited))
  }
  const chatShown = chat !== undefined && chatOpen && !preview
  // Review comments live beside the design file, so they never change its revision or conflict with unsaved edits.
  const [selectedComment, setSelectedComment] = useState<string | null>(null)
  const [commentError, setCommentError] = useState<string | null>(null)
  const designId = doc?.id
  useEffect(() => {
    setDesignComments([]); setSelectedComment(null); setCommentError(null)
    const list = actions.listDesignComments
    if (!designId || !list) return
    let active = true
    list({ workspaceId, designId }).then((value) => { if (active) setDesignComments(value.comments) },
      (failure: unknown) => { if (active) setCommentError(message(failure)) })
    return () => { active = false }
  }, [actions.listDesignComments, workspaceId, designId])
  const addComment = async (target: CopyOSDesignCommentTarget, body: string): Promise<boolean> => {
    if (!designId || !actions.addDesignComment) return false
    try {
      const comment = await actions.addDesignComment({ workspaceId, designId, body, target })
      setDesignComments(items => [...items, comment]); setCommentError(null); setSelectedComment(comment.id)
      return true
    } catch (failure) { setError(message(failure)); return false }
  }
  const changeComment = (comment: CopyOSDesignComment, status: CopyOSDesignComment['status'] | 'delete'): void => {
    if (!designId) return
    const request = { workspaceId, designId, commentId: comment.id }
    const done = status === 'delete'
      ? actions.deleteDesignComment?.(request).then(() => { setDesignComments(items => items.filter(item => item.id !== comment.id)) })
      : actions.setDesignCommentStatus?.({ ...request, status }).then((next) => {
        setDesignComments(items => items.map(item => item.id === next.id ? next : item))
      })
    done?.catch((failure: unknown) => { setCommentError(message(failure)) })
  }
  const commentNote = (target: CopyOSDesignCommentTarget, body: string): string =>
    `${t('designerCommentMentionLabel')} ${JSON.stringify({ design_id: designId, design_title: doc?.title,
      ...target.kind === 'layer' ? { layer: { id: target.nodeId, name: target.nodeName } } : { point: { x: Math.round(target.x), y: Math.round(target.y) } } })}\n${body}\n`
  const showComment = (comment: CopyOSDesignComment): void => {
    setSelectedComment(comment.id)
    if (comment.target.pageId !== null && comment.target.pageId !== activePage) setActivePage(comment.target.pageId)
    if (comment.target.kind === 'layer' && computedById.has(comment.target.nodeId)) setSelection([comment.target.nodeId])
    const point = designerCommentPoint(computedById, comment.target), box = canvas.current ? sceneBox(canvas.current) : undefined
    if (point && box) setView(v => ({ ...v, x: box.width / 2 - point.x * v.zoom, y: box.height / 2 - point.y * v.zoom }))
  }
  // Mark: the artboard under most of the region is drawn for that region only, with project fonts, and attached beside the note.
  const sendMark = async (region: DesignerSceneBox, note: string, signal: AbortSignal): Promise<boolean> => {
    if (!doc || !onMentionSelection) return false
    const owner = currentConversionOwner(doc), markRevision = revision.current
    const roots = sceneNodes.filter(node => node.parentId === null && node.visible)
    const overlap = (node: CopyOSDesignNode): number =>
      Math.max(0, Math.min(node.x + node.width, region.x + region.width) - Math.max(node.x, region.x)) *
      Math.max(0, Math.min(node.y + node.height, region.y + region.height) - Math.max(node.y, region.y))
    const artboard = roots.filter(node => node.kind === 'frame' && !node.pageLink).sort((a, b) => overlap(b) - overlap(a))[0]
    const layers = designerLayersInRegion(computedById, childrenById, roots, region)
    let attached = false
    if (artboard && overlap(artboard) > 0 && onAttachPicture) {
      const x = Math.max(0, region.x - artboard.x), y = Math.max(0, region.y - artboard.y)
      const crop = { x, y, width: Math.min(artboard.width - x, region.x + region.width - artboard.x - x),
        height: Math.min(artboard.height - y, region.y + region.height - artboard.y - y) }
      try {
        const scale = crop.width * 2 <= 2400 && crop.height * 2 <= 2400 ? 2 : 1
        const picture = await rasterizeDesignArtboard(doc, artboard.id, { format: 'png', scale, fontUrl: interFont,
          fontCss: designerProjectFontCss(workspaceId), region: crop })
        if (signal.aborted) return false
        if (!conversionOwnerCurrent(owner)) { setError(t('designerClipboardStale')); return false }
        const refused = onAttachPicture(new File([picture.blob], `${artboard.name.slice(0, 60) || 'Canvas'} mark.png`, { type: 'image/png' }))
        if (refused) setError(refused)
        else attached = true
      } catch (failure) {
        if (signal.aborted || !conversionOwnerCurrent(owner)) return false
        setError(message(failure))
      }
    }
    if (signal.aborted) return false
    if (!conversionOwnerCurrent(owner)) { setError(t('designerClipboardStale')); return false }
    const text = `${t('designerMarkMentionLabel')} ${JSON.stringify({ design_id: doc.id, design_title: doc.title, revision: markRevision,
      ...artboard ? { artboard: { id: artboard.id, name: artboard.name } } : {},
      region: { x: Math.round(region.x - (artboard?.x ?? 0)), y: Math.round(region.y - (artboard?.y ?? 0)),
        width: Math.round(region.width), height: Math.round(region.height), relative_to: artboard ? 'artboard' : 'page' },
      layers: layers.map(node => ({ id: node.id, name: node.name, kind: node.kind })), picture_attached: attached })}\n${note}\n`
    if (!onMentionSelection(text)) { setError(t('designerChatDraftLocked')); return false }
    setReviewMode(null)
    return true
  }
  const selectedArtboard = selection.length === 1 ? computedById.get(selection[0] ?? '') : undefined
  const templateArtboard = selectedArtboard?.parentId === null && selectedArtboard.kind === 'frame' && !selectedArtboard.pageLink
    ? { id: selectedArtboard.id, name: selectedArtboard.name } : null
  const templateActions = useMemo((): DesignerTemplateActions | undefined => {
    const { listDesignTemplates: list, readDesignTemplate: read, saveDesignTemplate: save, deleteDesignTemplate: remove } = actions
    if (!list || !read || !save || !remove || !designId) return undefined
    return {
      list: async () => (await list({ workspaceId })).templates,
      read: async templateId => (await read({ workspaceId, templateId })).snapshot,
      save: (nodeId, details) => save({ workspaceId, designId, nodeId, ...details }),
      remove: async (templateId) => { await remove({ workspaceId, templateId }) },
    }
  }, [actions, workspaceId, designId])
  // A template lands to the right of the page's artboards, top-aligned with them.
  const insertTemplate = (snapshot: CopyOSDesignClipboardSnapshot): boolean => {
    const roots = sceneNodes.filter(node => node.parentId === null)
    const position = roots.length
      ? { x: Math.max(...roots.map(node => node.x + node.width)) + 80, y: Math.min(...roots.map(node => node.y)) }
      : { x: 0, y: 0 }
    return pasteLayers(snapshot, false, false, position)
  }
  useEffect(() => { setMentionLocked(false) }, [selection, onMentionSelection])
  const resizeLeft = (delta: number): void => {
    if (chatShown) setChatWidth(width => Math.max(CHAT_PANEL_WIDTH.min, Math.min(CHAT_PANEL_WIDTH.max, width + delta)))
    else setPanelWidths(v => ({ ...v, left: Math.max(200, Math.min(400, v.left + delta)) }))
  }
  // The layers list mounts only the rows near its viewport; collapsed layers hide their descendants.
  const layerListRows = useMemo(() => {
    const rows: { node: CopyOSDesignNode; depth: number }[] = []
    const firstPage = doc?.pages?.[0]?.id ?? ''
    const visit = (parentId: string | null, depth: number): void => {
      const children = childrenById.get(parentId) ?? []
      for (let index = children.length - 1; index >= 0; index--) {
        const node = children[index]
        if (!node || (node.pageId ?? firstPage) !== activePage) continue
        rows.push({ node, depth })
        if (!collapsed.has(node.id)) visit(node.id, depth + 1)
      }
    }
    visit(null, 0)
    return rows
  }, [childrenById, collapsed, activePage, doc?.pages])
  const layerListIndex = useMemo(() => new Map(layerListRows.map((row, index) => [row.node.id, index])), [layerListRows])
  const [focusedLayer, setFocusedLayer] = useState<string | null>(null)
  const layerWindow = useDesignerLayerWindow(layerListRows.length,
    [renaming, focusedLayer].flatMap(id => id === null ? [] : [layerListIndex.get(id) ?? -1]))
  const revealLayer = layerWindow.reveal
  const lastSelected = selection.at(-1)
  const liveLayerListIndex = useRef(layerListIndex)
  liveLayerListIndex.current = layerListIndex
  // Reveal only when the selection changes, so a scrolled list stays put while the selected layer is edited.
  useEffect(() => {
    const index = lastSelected === undefined ? undefined : liveLayerListIndex.current.get(lastSelected)
    if (index !== undefined) revealLayer(index)
  }, [lastSelected, revealLayer])
  const layerRow = (n: CopyOSDesignNode, depth: number, index: number): ReactNode => (
    <div
      key={n.id}
      className={`${css.layer} ${selection.includes(n.id) ? css.activeLayer : ''}`}
      style={{ top: index * DESIGNER_LAYER_ROW_HEIGHT, paddingLeft: 12 + depth * 14 }}
      data-layer-id={n.id}
      onContextMenu={(e) => {
        e.preventDefault()
        if (crop.active) return
        if (!selection.includes(n.id)) setSelection([n.id])
        setContext({
          x: e.clientX,
          y: e.clientY,
          worldX: n.x,
          worldY: n.y,
        })
      }}
      draggable={!isLocked(n)}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-copyos-layer', n.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-copyos-layer'))
          e.preventDefault()
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData(
          'application/x-copyos-layer',
        )
        if (
          !doc ||
            !source ||
            source === n.id ||
            designDescendants(doc.nodes, source).has(n.id)
        )
          return
        e.preventDefault()
        e.stopPropagation()
        const sourceNode = doc.nodes.find(v => v.id === source)
        if (!sourceNode || isLocked(n)) return
        const nodes = doc.nodes.filter(v => v.id !== source)
        const index = nodes.findIndex(v => v.id === n.id)
        nodes.splice(index + 1, 0, {
          ...sourceNode,
          parentId: n.parentId,
          pageId: n.pageId,
        })
        commit({ ...doc, nodes })
      }}
    >
      {(childrenById.get(n.id)?.length ?? 0) > 0 ? (
        <button
          type="button"
          className={css.expandLayer}
          aria-label={`${t(collapsed.has(n.id) ? 'designerExpandLayer' : 'designerCollapseLayer')} ${n.name}`}
          onClick={() => {
            setCollapsed((current) => {
              const next = new Set(current)
              if (next.has(n.id)) next.delete(n.id)
              else next.add(n.id)
              return next
            })
          }}
        >
          <span
            style={{
              transform: collapsed.has(n.id)
                ? undefined
                : 'rotate(90deg)',
            }}
          >
            <Icon name="chevron" />
          </span>
        </button>
      ) : (
        <span className={css.layerSpacer} />
      )}
      <button
        type="button"
        className={`${css.layerName} ${n.kind === 'component' || n.kind === 'instance' || n.kind === 'component-set' ? css.componentName : ''}`}
        onClick={(e) => {
          if (e.shiftKey && selectionAnchor.current) {
            const ordered = [...sceneNodes].reverse().map(v => v.id)
            const a = ordered.indexOf(selectionAnchor.current),
              b = ordered.indexOf(n.id)
            setSelection(
              ordered.slice(Math.min(a, b), Math.max(a, b) + 1),
            )
          } else if (e.ctrlKey || e.metaKey)
            setSelection(
              selection.includes(n.id)
                ? selection.filter(id => id !== n.id)
                : [...selection, n.id],
            )
          else {
            setSelection([n.id])
            selectionAnchor.current = n.id
          }
        }}
      >
        <Icon
          name={
            n.kind === 'component' || n.kind === 'instance' || n.kind === 'component-set'
              ? n.kind === 'component-set' ? 'component-set' : 'component'
              : n.kind === 'text'
                ? 'text'
                : n.kind === 'frame'
                  ? 'frame'
                  : n.kind === 'path'
                    ? 'path'
                    : 'rectangle'
          }
        />{' '}
        {renaming === n.id ? (
          <DesignerLayerNameField
            autoFocus
            label={t('designerRenameLayer')}
            value={n.name}
            maxLength={DESIGN_NODE_NAME_MAX_LENGTH}
            onCommit={name => patch(n.id, { name })}
            onDone={() => {
              setRenaming(null)
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation()
              setRenaming(n.id)
            }}
          >
            {n.name}
          </span>
        )}
        {suggestionMarkers?.document === doc && suggestionMarkers.ids.includes(n.id) ?
          <Tooltip label={t('designerSuggestNewFrame')} portal><span aria-hidden="true"
            data-designer-suggested-frame={n.id} className={css.suggestedFrameDot} /></Tooltip> : null}
        {n.tokenModeId ? (
          <span
            aria-hidden="true"
            className={css.modeBadge}
            title={
              doc?.tokenModes?.find(m => m.id === n.tokenModeId)
                ?.name ?? t('designerBaseMode')
            }
          >
            {doc?.tokenModes?.find(m => m.id === n.tokenModeId)?.name ??
                t('designerBaseMode')}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        title={t('designerVisibility')}
        aria-label={`${t('designerVisibility')} ${n.name}`}
        onClick={() => {
          patch(n.id, { visible: !n.visible })
        }}
      >
        {n.visible ? '◉' : '○'}
      </button>
      <button
        type="button"
        title={t('designerLock')}
        aria-label={`${t('designerLock')} ${n.name}`}
        onClick={() => {
          patch(n.id, { locked: !n.locked })
        }}
      >
        {n.locked ? '●' : '·'}
      </button>
    </div>
  )
  if (phase === 'loading') return <p role="status">{t('designerLoading')}</p>
  const currentPages = doc?.pages ?? [{ id: '', name: t('designerPageOne') }]
  return (
    <DesignerWorkspaceProviders imageAssets={imageAssets} workspaceId={workspaceId} readFontMetadata={actions.getDesignFontMetadata}>
      <DesignerSaveAdmission.Provider value={reportSaveAdmission}>
        {imageCleanup && imageCleanupOpen ? <DesignerImageCleanup find={imageCleanup.find} remove={imageCleanup.remove} t={t}
          onClose={() => { setImageCleanupOpen(false) }} /> : null}
        {pageConversion && conversionSource ? <DesignerPageConversionReview preview={pageConversion} source={conversionSource}
          title={conversionTitle} onTitle={setConversionTitle} busy={conversionBusy === 'build'} error={conversionError} t={t}
          {...(projectPath === undefined ? {} : { projectPath })}
          onBuild={() => { void buildPageConversion() }} onClose={() => {
            if (conversionFlight.current) return
            setPageConversion(null); setConversionSource(null); conversionOwner.current = null
          }} /> : null}
        {pageUpdate ? <DesignerPageUpdateReview review={pageUpdate.review} page={pageUpdate.page} busy={conversionBusy === 'build'}
          error={conversionError} t={t} {...(projectPath === undefined ? {} : { projectPath })}
          onPreview={previewPageUpdate} onApply={(resolutions) => { void applyPageUpdate(resolutions) }} onClose={() => {
            if (conversionFlight.current) return
            setPageUpdate(null); setConversionError('')
          }} /> : null}
        {openedPageId && pageAgentError ? <p role="alert">{pageAgentError}</p> : null}
        {/* Outside a session tab the Builder fills the window, as an expanded Canvas does, instead of the workspace section box. */}
        {openedPageId && pageActions ? <div className={layout === 'session' ? css.pageBuilderHost : css.pageBuilderFullScreen}>
          <LandingPageWorkspace workspaceId={workspaceId} pageId={openedPageId}
            layout="session" t={t} actions={pageActions} {...(projectPath === undefined ? {} : { projectPath })}
            {...(onStartAgent === undefined ? {} : { onPromptSection: async (
              intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string,
            ) => {
              try {
                await onStartAgent(`${buildPageActionPrompt(t, intent, pageTitle, sectionTitle, note)}\n\n${t('canvasPageIdentity')}: ${openedPageId}`)
              } catch (failure: unknown) { setPageAgentError(message(failure)); throw failure }
            } })}
            onReturn={() => { setOpenedPageId(null) }} /></div> : null}
        <section
          ref={workspaceElement}
          aria-hidden={pageConversion ? true : undefined}
          className={`${css.workspace} ${layout === 'session' ? css.sessionLayout : ''} ${expanded ? css.expanded : ''} ${contained ? css.contained : ''} ${preview ? css.previewMode : ''}`}
          style={
            {
              display: openedPageId ? 'none' : undefined,
              '--designer-left-width': `${chatShown ? chatWidth : panelWidths.left}px`,
              '--designer-right-width': `${panelWidths.right}px`,
            } as CSSProperties
          }
          tabIndex={0}
          onKeyDownCapture={captureSave}
          onKeyDown={keyDown}
          onCopy={(event) => { copyToEvent(event, false) }}
          onCut={(event) => { copyToEvent(event, true) }}
          onPaste={(event) => {
            if (event.defaultPrevented || designerClipboardEditableTarget(event.target)) return
            const html = event.clipboardData.getData('text/html')
            // Ordinary text, screenshots and other apps' HTML are not layer imports.
            // Explicit Paste/Import commands still explain unsupported clipboard formats.
            if (!/\((?:copyos-design-clipboard|figma)\)/.test(html)) return
            event.preventDefault()
            void pasteFromOS(html)
          }}
          onInputCapture={guardFileSwitchDraft}
          onChangeCapture={guardFileSwitchDraft}
          onDropCapture={guardFileSwitchDraft}
          onFocusCapture={(e) => {
            if (
              crop.active &&
            e.target !== e.currentTarget &&
            e.target instanceof Element &&
            !e.target.closest(
              '[data-designer-crop-ui],[data-designer-crop-overlay],[data-designer-canvas],[data-designer-crop-view]',
            )
            )
              crop.finish()
          }}
          onPointerDownCapture={(e) => {
            if (
              crop.active &&
            e.target instanceof Element &&
            !e.target.closest(
              '[data-designer-crop-ui],[data-designer-crop-overlay],[data-designer-canvas],[data-designer-crop-view]',
            )
            )
              crop.finish()
            if (
              e.target instanceof Element &&
            e.target.closest('svg') &&
            !e.target.closest(
              '[contenteditable="true"],[contenteditable="plaintext-only"],input,textarea,select,button',
            )
            )
              e.currentTarget.focus({ preventScroll: true })
          }}
          onKeyUp={(e) => {
            if (e.key === ' ') setSpacePan(false)
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setSpacePan(false)
          }}
          aria-label={t('designerTitle')}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files[0]
            if (file) {
              e.preventDefault()
              void importFig(file)
            }
          }}
        >
          <aside className={css.rail} aria-label={t('designerNavigation')}>
            {onBackToHarness || onExitFullWindow ? <Tooltip label={t('designerBackToHarness')} portal>
              <button type="button" className={css.harnessBack} aria-label={t('designerBackToHarness')}
                onClick={onBackToHarness ?? onExitFullWindow}><Icon name="back-arrow" /></button>
            </Tooltip> : null}
            <span className={css.railRule} />
            {/* Chat is the first rail entry and the panel shown when the Canvas opens with a chat; in the session tab it opens
                the full window with that chat. */}
            {chat === undefined && !onOpenFullWindow ? null : <>
              <button type="button" aria-label={t('designerChat')} title={t(chat === undefined ? 'designerOpenFullWindow' : 'designerChat')}
                aria-pressed={chatShown}
                onClick={() => { if (chat === undefined) onOpenFullWindow?.(); else { setChatOpen(true); setPreview(false) } }}>
                <Icon name="chat" />
              </button>
              <span>{t('designerChat')}</span>
            </>}
            <button
              type="button"
              aria-label={t('designerFileTab')}
              title={t('designerFileTab')}
              aria-pressed={leftTab === 'layers' && !chatShown}
              onClick={() => {
                setLeftTab('layers')
                setChatOpen(false)
              }}
            >
              <Icon name="file" />
            </button>
            <span>{t('designerFileTab')}</span>
            <button
              type="button"
              aria-label={t('designerAssets')}
              title={t('designerAssets')}
              aria-pressed={leftTab === 'assets' && !chatShown}
              onClick={() => {
                setLeftTab('assets')
                setChatOpen(false)
              }}
            >
              <Icon name="assets" />
            </button>
            <span>{t('designerAssets')}</span>
            {/* Outside a session the Canvas has no chat; this button expands it over the window or returns it to the workspace. */}
            {onOpenFullWindow || onExitFullWindow ? null : <div className={css.railBottom}>
              <button type="button" aria-label={t(expanded ? 'designerCollapse' : 'designerExpand')}
                title={t(expanded ? 'designerCollapse' : 'designerExpand')}
                onClick={() => { setExpanded(!expanded) }}><Icon name={expanded ? 'shrink' : 'expand'} /></button>
            </div>}
          </aside>
          <header className={css.topBar}>
            <div className={css.topBarContext}>
              <select
                aria-label={t('designerDocument')}
                data-designer-file-chooser="true"
                value={doc?.id ?? ''}
                disabled={(saving && !switchingFile) || importing}
                onChange={(e) =>{  requestFileSwitch(e.currentTarget.value) }}
              >
                <option value="" disabled>
                  {t('designerChoose')}
                </option>
                {files.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
              <span className={css.saveStatus} role="status">
                {importing
                  ? t('designerImporting')
                  : saving
                    ? t('designerSaving')
                    : dirty || textDirty
                      ? t('designerUnsaved')
                      : t('designerSaved')}
              </span>
              <details ref={fileMenu} className={css.fileMenu}>
                <summary
                  aria-label={t('designerFileMenu')}
                  title={t('designerFileMenu')}
                >
                  <Icon name="more" />
                </summary>
                <div className={css.menuBody}>
                  <button
                    type="button"
                    onClick={() => {
                      void create()
                    }}
                    disabled={saving || importing}
                  >
                    {t('designerNew')}
                  </button>
                  <button
                    type="button"
                    onClick={() => figUpload.current?.click()}
                    disabled={saving || importing}
                  >
                    {t('designerImportFig')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void reload()
                    }}
                    disabled={dirty || saving}
                  >
                    {t('designerReload')}
                  </button>
                  <button
                    type="button"
                    disabled={!doc?.source}
                    onClick={() => {
                      setShowReport(!showReport)
                    }}
                  >
                    {t('designerImportReport')}
                  </button>
                  {onExitFullWindow ? <button type="button" onClick={onExitFullWindow}>{t('designerExitFullWindow')}</button> : null}
                  {imageCleanup ? <button type="button" onClick={() => {
                    if (fileMenu.current) fileMenu.current.open = false
                    setImageCleanupOpen(true)
                  }}>{t('designerCleanUpImages')}</button> : null}
                </div>
              </details>
            </div>
            <div className={css.topBarSwitch} role="group" aria-label={t('designerViewMode')}>
              <button type="button" aria-pressed={!preview} disabled={!doc} onClick={() => { setPreview(false) }}>{t('designerEdit')}</button>
              <button type="button" aria-pressed={preview} disabled={!doc} onClick={() => { setPreview(true) }}>{t('designerPreview')}</button>
            </div>
            {vectorEdit ? <><span ref={setVectorToolbar} /><button type="button" aria-label={t('designerVectorDone')}
              title={t('designerVectorEditing')}
              onClick={exitVectorEdit}>{t('designerDone')}</button></> : null}
            <span className={css.topBarSpacer} />
            {doc && !preview ? <DesignerHeaderTools t={t} disabled={saving || conflict || editing !== null}
              templatesOpen={headerPanel === 'templates'}
              onTemplates={templateActions ? () => { setReviewMode(null); setHeaderPanel(panel => panel === 'templates' ? null : 'templates') } : undefined}
              importItems={[
                { id: 'figma-paste', label: t('designerImportFigmaPaste'), run: () => { void pasteFromOS(undefined, false, false) } },
                { id: 'fig-file', label: t('designerImportFigFile'), disabled: importing, run: () => { figUpload.current?.click() } },
                { id: 'image', label: t('designerImportImage'), run: () => { upload.current?.click() } },
              ]}
              buildOpen={headerPanel === 'build'}
              onBuildFromCopy={onStartAgent ? () => { setReviewMode(null); setHeaderPanel(panel => panel === 'build' ? null : 'build') } : undefined}
              reviewMode={reviewMode} markAvailable={onMentionSelection !== undefined}
              onReviewMode={(mode) => { setHeaderPanel(panel => panel === 'comments' && mode === 'comment' ? panel : null); setReviewMode(mode) }}
              commentsOpen={headerPanel === 'comments'}
              onToggleComments={actions.listDesignComments ? () => { setReviewMode(null); setHeaderPanel(panel => panel === 'comments' ? null : 'comments') } : undefined}
              openComments={designComments.filter(comment => comment.status === 'open').length}
            /> : null}
            <details ref={exportMenu} className={css.exportMenu}>
              <summary aria-label={t('designerExport')} title={t('designerExport')}>
                <IconDownloadOutlineRegular size={14} />{t('designerExport')}<IconChevronDownOutlineRegular size={10} />
              </summary>
              <div className={css.menuBody} onClick={() => { if (exportMenu.current) exportMenu.current.open = false }}>
                <button
                  type="button"
                  disabled={!doc || sceneNodes.some(node => node.pageLink)}
                  title={sceneNodes.some(node => node.pageLink) ? t('canvasPageScreenSvgHint') : undefined}
                  onClick={() => {
                    if (doc)
                      selfContained(doc, (exported) => {
                        download(
                          exportDesignSvg(exported, activePage, { links:true }),
                          `${doc.title}.svg`,
                          'image/svg+xml',
                        )
                      })
                  }}
                >
                  {t('designerExportSvg')}
                </button>
                <button
                  type="button"
                  disabled={!doc || sceneNodes.some(node => node.pageLink)}
                  title={sceneNodes.some(node => node.pageLink) ? t('canvasPageScreenSvgHint') : t('designerExportSvgFigmaHint')}
                  onClick={() => {
                    if (doc)
                      selfContained(doc, (exported) => {
                        download(exportDesignSvgWithEditableText(exported, activePage, {}, globalThis.document), `${doc.title} (Figma).svg`, 'image/svg+xml')
                      })
                  }}
                >
                  {t('designerExportSvgFigma')}
                </button>
                <button
                  type="button"
                  disabled={!doc}
                  onClick={() => {
                    if (doc)
                      selfContained(doc, (exported) => {
                        download(
                          JSON.stringify(
                            { ...exported, revision: revision.current },
                            null,
                            2,
                          ),
                          `${doc.title}.design.json`,
                          'application/json',
                        )
                      })
                  }}
                >
                  {t('designerExportJson')}
                </button>
                <button
                  type="button"
                  disabled={!doc}
                  onClick={() => {
                    if (doc)
                      download(
                        exportDesignCss(doc),
                        `${doc.title}.tokens.css`,
                        'text/css',
                      )
                  }}
                >
                  {t('designerExportCss')}
                </button>
              </div>
            </details>
          </header>
          {recovery ? (
            <div className={css.error} role="alert">
              {t(recovery.draft.revision === recovery.saved.revision ? 'designerRecoveryAvailable' : 'designerRecoveryStale')
                .replace('{title}', recovery.draft.document.title).replace('{time}', new Date(recovery.draft.savedAt).toLocaleString())}
              {recovery.draft.revision === recovery.saved.revision
                ? <button type="button" onClick={restoreRecovery}>{t('designerRecoveryRestore')}</button>
                : <button type="button" onClick={() => { void recoverAsCopy() }}>{t('designerRecoveryCopy')}</button>}
              <button type="button" onClick={() => { setRecovery(null); void draftStore.clear(workspaceId) }}>{t('designerRecoveryDiscard')}</button>
            </div>
          ) : null}
          {rebaseNotice && !error ? <p role="status" className={css.hint}>{rebaseNotice}</p> : null}
          {error ? (
            <div className={css.error} role="alert">
              {error}
              {conflict ? (
                <>
                  <button type="button" onClick={() => { void reloadKeepingChanges() }}>{t('designerRebaseKeep')}</button>
                  <button
                    type="button"
                    onClick={() => {
                      void reload(true)
                    }}
                  >
                    {t('designerDiscardReload')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConflict(false)
                      setError('')
                    }}
                  >
                    {t('designerRetrySave')}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                aria-label={t('designerDone')}
                onClick={() => {
                  setError('')
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ) : null}
          <aside className={css.left}>
            <div
              role="separator"
              aria-label={t('designerLayers')}
              aria-orientation="vertical"
              tabIndex={0}
              className={css.resizeLeft}
              onKeyDown={(e) => {
                if (e.key.startsWith('Arrow')) {
                  e.preventDefault()
                  resizeLeft(e.key === 'ArrowRight' ? 10 : -10)
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) resizeLeft(e.movementX)
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
              }}
            />
            {chat === undefined ? null : <div className={css.chatPanel} hidden={!chatShown} data-designer-chat="">
              {onMentionSelection && doc ? <div className={css.chatContext}>
                <span>{selectionMentionSummary(t, selection.flatMap(id => computedById.get(id) ?? []))}</span>
                <button type="button" disabled={mentionLocked} onClick={() => {
                  setMentionLocked(!onMentionSelection(designSelectionMention(t, doc, revision.current,
                    selection.flatMap(id => computedById.get(id) ?? []))))
                }}>{t('designerMentionSelection')}</button>
              </div> : null}
              {chat}
            </div>}
            {chatShown ? null : leftTab === 'layers' ? (
              <>
                <div className={css.panelHeading}>
                  <h3>{t('designerPages')}</h3>
                  {committedDocument ? <DesignerLayoutVersion compact doc={committedDocument} scope={{ type:'page',pageId:activePage || null }}
                    contextKey={layoutVersionContextKey} t={t} preview={previewLayoutVersion} cancelPreview={cancelPreview}
                    apply={applyLayoutVersion} /> : null}
                  <button
                    type="button"
                    aria-label={t('designerSearch')}
                    title={t('designerSearch')}
                    onClick={() => {
                      setLeftTab('assets')
                    }}
                  >
                    <Icon name="search" />
                  </button>
                  <button
                    type="button"
                    disabled={!doc}
                    aria-label={t('designerAddPage')}
                    title={t('designerAddPage')}
                    onClick={addPage}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                <div className={css.pages}>
                  {currentPages.map(page => (
                    <button
                      type="button"
                      key={page.id}
                      aria-pressed={page.id === activePage}
                      onClick={() => {
                        if (!doc) return
                        pageViews.current.set(
                          designerPageViewKey(doc.id, activePage),
                          view,
                        )
                        setActivePage(page.id)
                        const previous = pageViews.current.get(
                          designerPageViewKey(doc.id, page.id),
                        )
                        if (previous) setView(previous)
                        setSelection([])
                      }}
                    >
                      {renamePage === page.id ? (
                        <input
                          autoFocus
                          aria-label={t('designerRenamePage')}
                          defaultValue={page.name}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') setRenamePage(null)
                          }}
                          onBlur={(e) => {
                            if (doc && e.currentTarget.value.trim())
                              commit({
                                ...doc,
                                pages: doc.pages?.map(p =>
                                  p.id === page.id
                                    ? {
                                      ...p,
                                      name: e.currentTarget.value
                                        .trim()
                                        .slice(0, 200),
                                    }
                                    : p,
                                ),
                              })
                            setRenamePage(null)
                          }}
                        />
                      ) : (
                        <span
                          onDoubleClick={() => {
                            setRenamePage(page.id)
                          }}
                        >
                          {page.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className={css.panelHeading}>
                  <h3>{t('designerLayers')}</h3>
                  <button
                    type="button"
                    aria-label={t('designerCollapseAll')}
                    title={t('designerCollapseAll')}
                    onClick={() => {
                      setCollapsed(
                        new Set(
                          sceneNodes
                            .filter(
                              n => (childrenById.get(n.id)?.length ?? 0) > 0,
                            )
                            .map(n => n.id),
                        ),
                      )
                    }}
                  >
                    ≡
                  </button>
                </div>
                <div className={css.layers} ref={layerWindow.viewport} onScroll={layerWindow.onScroll}
                  onFocus={(e) => { setFocusedLayer(e.target.closest('[data-layer-id]')?.getAttribute('data-layer-id') ?? null) }}
                  onBlur={(e) => {
                    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocusedLayer(null)
                  }}>
                  <div className={css.layerRows} style={{ height: layerWindow.height }}>
                    {layerWindow.indices.map((index) => {
                      const row = layerListRows[index]
                      return row ? layerRow(row.node, row.depth, index) : null
                    })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={css.panelHeading}>
                  <h3>{t('designerAssets')}</h3>
                  <Icon name="search" />
                </div>
                <input
                  className={css.search}
                  aria-label={t('designerSearch')}
                  placeholder={t('designerSearch')}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.currentTarget.value)
                  }}
                />
                {filter ? (
                  <div className={css.searchResults}>
                    {sceneNodes
                      .filter(n =>
                        n.name.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map(n => (
                        <button
                          type="button"
                          key={n.id}
                          onClick={() => {
                            setSelection([n.id])
                            setLeftTab('layers')
                          }}
                        >
                          {n.name}
                        </button>
                      ))}
                  </div>
                ) : null}
              </>
            )}
            <div className={css.assetShelf} hidden={leftTab !== 'assets' || chatShown}>
              <h3>{t('designerAssets')}</h3>
              <div className={css.assetGrid}>
                {(['frame', 'rectangle', 'ellipse', 'text'] as const).map(
                  kind => (
                    <button
                      type="button"
                      key={kind}
                      onClick={() => {
                        add(kind)
                      }}
                    >
                      <Icon name={kind} />
                      {t(kindKeys[kind])}
                    </button>
                  ),
                )}
                <button type="button" onClick={() => upload.current?.click()}>
                  <Icon name="image" />
                  {t('designerImage')}
                </button>
              </div>
              {doc && actions.generation ? (
                <DesignerGeneration workspaceId={workspaceId} actions={actions.generation} t={t} place={placeImage} />
              ) : null}
              <h3>{t('designerComponents')}</h3>
              {doc?.nodes
                .filter(n => n.kind === 'component-set' || (n.kind === 'component' && storedNodes.get(n.parentId ?? '')?.kind !== 'component-set'))
                .map(n => (
                  <button
                    type="button"
                    className={css.component}
                    key={n.id}
                    onClick={() => {
                      instantiate(n)
                    }}
                  >
                    <Icon name={n.kind === 'component-set' ? 'component-set' : 'component'} />
                    {n.name}
                    <Icon name="plus" />
                  </button>
                ))}
              {leftTab === 'assets' ? (
                <>
                  <h3>{t('designerVariables')}</h3>
                  {doc &&
                  resolvedColors.map(v => (
                    <DesignerColorResource
                      key={`${doc.activeTokenModeId ?? 'base'}:${v.id}`}
                      doc={doc} variable={v} colors={resolvedColors} t={t} showName
                      commit={commit} preview={previewDocument} cancelPreview={cancelPreview}
                    />
                  ))}
                  <div className={css.newToken}>
                    <input
                      aria-label={t('designerTokenName')}
                      placeholder={t('designerTokenName')}
                      value={tokenName}
                      onChange={(e) => {
                        setTokenName(e.currentTarget.value)
                      }}
                    />
                    <DesignerPopover
                      label={t('designerFill')}
                      closeLabel={t('designerDone')}
                      trigger={<DesignerSwatch className={css.paintSwatch}
                        paint={designColorVariableCss({ value: tokenColor, alpha: tokenAlpha })} />}
                    >
                      <DesignerColorPicker color={tokenColor} opacity={tokenAlpha} resources={[]} t={t}
                        opacityLabel={t('designerColorAlpha')}
                        onPreview={() => undefined}
                        onCancel={() => undefined}
                        onVariable={() => undefined}
                        onCommit={(value, alpha) => { setTokenColor(value); setTokenAlpha(alpha) }} />
                    </DesignerPopover>
                    <button
                      type="button"
                      aria-label={t('designerAddVariable')}
                      disabled={!doc || !tokenName.trim()}
                      onClick={() => {
                        if (doc)
                          commit({
                            ...doc,
                            variables: [
                              ...doc.variables,
                              {
                                id: randomUUID(),
                                name: tokenName.trim().slice(0, 120),
                                value: tokenColor,
                                alpha: tokenAlpha,
                              },
                            ],
                          })
                        setTokenName('')
                      }}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </aside>
          <DesignerInlinePanelHost.Provider value={inlinePanelHost}>
            <main className={css.canvas} style={doc ? {
              '--designer-canvas-paint': resolveDesignCanvasBackground(doc, activePage).cssColor,
            } as CSSProperties : undefined}>
              {doc ? <DesignerMeasureBatchStart /> : null}
              {doc ? (
                <svg
                  ref={canvas}
                  data-designer-canvas="true"
                  aria-label={t('designerCanvas')}
                  className={css.scene}
                  style={{
                    ...paintedView ? {
                      transform: `translate(${view.x - wheelScale * painted.x}px, ${view.y - wheelScale * painted.y}px) scale(${wheelScale})`,
                    } : {},
                    cursor:
                  spacePan || tool === 'hand'
                    ? 'grab'
                    : tool === 'select'
                      ? 'default'
                      : 'crosshair',
                  }}
                  onPointerDown={(e) => {
                    if (
                      crop.active &&
                  !spacePan &&
                  tool !== 'hand' &&
                  e.button === 0
                    ) {
                      crop.finish()
                      return
                    }
                    if (!history) return
                    if (e.button === 2) return
                    if (tool === 'hand' || spacePan || e.button === 1) {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      gesture.current = {
                        mode: 'pan',
                        original: historyRef.current ?? history,
                        startX: e.clientX,
                        startY: e.clientY,
                        ids: [],
                        panX: view.x,
                        panY: view.y,
                      }
                    } else if (!preview && tool !== 'select') {
                      const position = point(e), target = drawTargetAt(position)
                      const start = designerSceneToLocal(target.matrix, position)
                      if (tool === 'text') add('text', start, target)
                      else {
                        const n = {
                          ...createDesignNode(
                            tool === 'line' ? 'path' : tool,
                            randomUUID(),
                            t(tool === 'line' ? 'designerLine' : kindKeys[tool]),
                          ),
                          ...(tool === 'line'
                            ? {
                              pathData: {
                                width: 1,
                                height: 1,
                                paths: [
                                  {
                                    d: 'M 0 0 L 1 1',
                                    fillRule: 'nonzero' as const,
                                  },
                                ],
                              },
                              strokeWidth: 1,
                              strokeCap: 'round' as const,
                              fillOpacity: 0,
                            }
                            : {}),
                          x: Math.round(start.x),
                          y: Math.round(start.y),
                          width: 1,
                          height: 1,
                          pageId: activePage || undefined,
                          ...drawPlacement(target),
                        }
                        setHistory({
                          ...history,
                          present: {
                            ...history.present,
                            nodes: [...history.present.nodes, n],
                          },
                        })
                        setSelection([n.id])
                        setTool('select')
                        e.currentTarget.setPointerCapture(e.pointerId)
                        gesture.current = {
                          mode: 'create',
                          original: historyRef.current ?? history,
                          startX: e.clientX,
                          startY: e.clientY,
                          ids: [n.id],
                          createdId: n.id,
                          createTarget: target,
                          createStart: start,
                          panX: view.x,
                          panY: view.y,
                        }
                      }
                    } else if (!preview) {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      gesture.current = {
                        mode: 'marquee',
                        original: historyRef.current ?? history,
                        startX: e.clientX,
                        startY: e.clientY,
                        ids: selection,
                        panX: view.x,
                        panY: view.y,
                        additive: e.shiftKey,
                      }
                      if (!e.shiftKey) setSelection([])
                    }
                  }}
                  onContextMenuCapture={(event) => {
                    if (!(event.target instanceof Element) || !event.target.closest('[data-designer-layout-overlay]')) return
                    openCanvasContext(event, designerCanvasContextTarget(event.currentTarget, event.target, event.clientX, event.clientY))
                  }}
                  onContextMenu={(event) => {
                    openCanvasContext(event, designerCanvasContextTarget(event.currentTarget, event.target, event.clientX, event.clientY))
                  }}
                  onPointerMove={move}
                  onPointerUp={endGesture}
                  onPointerCancel={() => {
                    if (crop.onEnd(true)) return
                    if (gesture.current) setHistory(gesture.current.original)
                    gesture.current = null
                    setMarquee(null)
                  }}
                  onWheel={(e) => {
                    const now = performance.now(), pending = wheelPaint.current
                    if (pending) clearTimeout(pending.timer)
                    if (pending && now - pending.since >= WHEEL_PAINT_MAX_MS) { setPaintedView(null); wheelPaint.current = null }
                    else {
                      if (!pending) setPaintedView(view)
                      wheelPaint.current = {
                        since: pending?.since ?? now,
                        timer: window.setTimeout(() => { wheelPaint.current = null; setPaintedView(null) }, WHEEL_PAINT_IDLE_MS),
                      }
                    }
                    if (e.ctrlKey || e.metaKey) {
                      const box = sceneBox(e.currentTarget)
                      const x = e.clientX - box.left
                      const y = e.clientY - box.top
                      setView((v) => {
                        const zoom = Math.max(
                          0.05,
                          Math.min(4, v.zoom * Math.exp(-e.deltaY * 0.005)),
                        )
                        return {
                          zoom,
                          x: x - ((x - v.x) * zoom) / v.zoom,
                          y: y - ((y - v.y) * zoom) / v.zoom,
                        }
                      })
                    } else
                      setView(v => ({
                        ...v,
                        x: v.x - e.deltaX,
                        y: v.y - e.deltaY,
                      }))
                  }}
                >
                  <g transform={`translate(${painted.x} ${painted.y}) scale(${painted.zoom})`}>
                    <g data-designer-scene="true" style={{ isolation: 'isolate' }} opacity={crop.active ? 0.3 : 1}>
                      <CanvasZoomContext.Provider value={painted.zoom}>
                        {sceneNodes
                          .filter(n => n.parentId === null)
                          .map(n => renderTopLevel(n))}
                      </CanvasZoomContext.Provider>
                    </g>
                    {crop.overlay}
                    {marquee ? (
                      <rect
                        {...marquee}
                        fill="#0d99ff"
                        fillOpacity={0.08}
                        stroke="#0d99ff"
                        strokeWidth={1 / view.zoom}
                        pointerEvents="none"
                      />
                    ) : null}
                  </g>
                </svg>
              ) : null}
              {doc ? <DesignerMeasureBatchEnd /> : (
                <div className={css.empty}>
                  <Icon name="file" />
                  <h2>{t('designerEmpty')}</h2>
                  <p>{t('designerEmptyHint')}</p>
                  <button
                    type="button"
                    className={css.primary}
                    onClick={() => figUpload.current?.click()}
                  >
                    {t('designerImportFig')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void create()
                    }}
                  >
                    {t('designerNew')}
                  </button>
                </div>
              )}
              {doc && !sceneNodes.length ? (
                <div className={css.canvasHint}>{t('designerCanvasHint')}</div>
              ) : null}
              {conversionNotice && doc && conversionNotice.owner === doc.id ? <div className={css.importReport} role="status">
                <div><span>{t('designerClipboardFigmaConverted')}</span>
                  <button type="button" aria-label={t('designerDone')} onClick={() => { setConversionNotice(null); workspaceElement.current?.focus({ preventScroll: true }) }}>
                    <Icon name="close" /></button></div>
                {conversionNotice.warnings.length ? <ul>
                  {conversionNotice.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul> : null}
              </div> : null}
              {clipboardNotice && clipboardNotice.owner === doc?.id ? <div className={css.importReport} role="status">
                <div><span>{t('designerLinkClipboardRemoved').replace('{count}',String(clipboardNotice.count))}</span>
                  <button type="button" aria-label={t('designerDone')} onClick={() => { setClipboardNotice(null) }}><Icon name="close"/></button></div>
              </div> : null}
              {showReport && doc?.source ? (
                <div className={css.importReport} role="status">
                  <div>
                    <strong>{t('designerImportReport')}</strong>
                    <button
                      type="button"
                      aria-label={t('designerDone')}
                      onClick={() => {
                        setShowReport(false)
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <p>
                    {doc.source.fileName} · {doc.nodes.length} {t('designerLayers')} ·{' '}
                    {doc.pages?.length ?? 1} {t('designerPages')}
                  </p>
                  {doc.source.warnings.length ? (
                    <ul>
                      {doc.source.warnings.map(w => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t('designerImportSuccess')}</p>
                  )}
                  <p>{t('designerImportFontNote')}</p>
                </div>
              ) : null}
              {crop.toolbar}
              {doc && !preview ? <DesignerReviewOverlay t={t} view={view} mode={reviewMode} byId={computedById} pageId={activePage || null}
                comments={designComments} selectedComment={selectedComment}
                onSelectComment={(id) => { const comment = designComments.find(item => item.id === id); if (comment) { setHeaderPanel('comments'); showComment(comment) } }}
                onAddComment={addComment}
                onSendComment={onMentionSelection ? (target, body) => onMentionSelection(commentNote(target, body)) : undefined}
                onMark={sendMark} onCancel={() => { setReviewMode(null) }}
                onWheel={(event) => { canvas.current?.dispatchEvent(new WheelEvent(event.type, event)) }} /> : null}
              {headerPanel === 'comments' && doc ? <DesignerCommentsPanel t={t} comments={designComments} selected={selectedComment} error={commentError}
                onSelect={showComment} onStatus={(comment, status) => { changeComment(comment, status) }}
                onDelete={(comment) => { if (globalThis.confirm(t('designerDeleteCommentConfirm'))) changeComment(comment, 'delete') }}
                onPlace={() => { setReviewMode('comment') }} onClose={() => { setHeaderPanel(null) }} /> : null}
              {headerPanel === 'templates' && doc && templateActions ? <DesignerTemplatesPanel t={t} actions={templateActions}
                artboard={templateArtboard} unsaved={dirty || textDirty} onInsert={insertTemplate}
                onClose={() => { setHeaderPanel(null) }} /> : null}
              {headerPanel === 'build' && doc && onStartAgent ? <DesignerBuildFromCopy t={t} reference={templateArtboard} listCopy={listCopy}
                onSubmit={(request, signal) => onBuildFromCopy ? onBuildFromCopy(request, { id: doc.id, title: doc.title }, signal) : onStartAgent(designerBuildPrompt(request, { id: doc.id, title: doc.title }))}
                onClose={() => { setHeaderPanel(null) }} /> : null}
            </main>
          </DesignerInlinePanelHost.Provider>
          <aside className={css.inspector}>
            <div className={css.inspectorTabs}>
              <div className={css.designTabs} role="tablist" aria-label={t('designerProperties')}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault(); event.stopPropagation()
                  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                  const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                  tabs[next]?.focus(); tabs[next]?.click()
                }}>
                {(['design', 'code'] as const).map(tab => <button key={tab} type="button" role="tab"
                  id={`${inspectorId}-${tab}-tab`} aria-selected={inspectorTab === tab}
                  aria-controls={`${inspectorId}-${tab}-panel`} tabIndex={inspectorTab === tab ? 0 : -1}
                  onClick={() => { cancelPreview(); setInspectorTab(tab) }}>
                  {t(tab === 'design' ? 'designerDesignTab' : 'designerCodeTab')}
                </button>)}
              </div>
              <div className={css.zoom}>
                <DesignerPopover
                  cropView
                  label={t('designerZoom')}
                  closeLabel={t('designerDone')}
                  trigger={
                    <>
                      <span>{Math.round(view.zoom * 100)}%</span>
                      <Icon name="down" />
                    </>
                  }
                >
                  <div className={css.zoomMenu}>
                    <DesignerNumberField
                      label={t('designerZoom')}
                      short="%"
                      value={Math.round(view.zoom * 100)}
                      mixed={t('designerMixed')}
                      min={5}
                      max={400}
                      onCommit={(value) => {
                        zoomAtCenter(value / 100)
                      }}
                    />
                    <button type="button" onClick={fit}>
                      {t('designerFit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        zoomAtCenter(v => v * 1.2)
                      }}
                    >
                      {t('designerZoomIn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        zoomAtCenter(v => v / 1.2)
                      }}
                    >
                      {t('designerZoomOut')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        zoomAtCenter(1)
                      }}
                    >
                      {t('designerResetZoom')}
                    </button>
                    <label className={css.check}>
                      <input
                        type="checkbox"
                        checked={pixelSnap}
                        onChange={(e) => {
                          setPixelSnap(e.currentTarget.checked)
                        }}
                      />
                      {t('designerPixelSnap')}
                    </label>
                  </div>
                </DesignerPopover>
              </div>
            </div>
            <div className={css.propertiesBody} role="tabpanel" id={`${inspectorId}-${inspectorTab}-panel`}
              aria-labelledby={`${inspectorId}-${inspectorTab}-tab`}>
              {/* Text formatting docks here while a text layer is edited on the canvas, so it never covers the design. */}
              <div ref={setInlinePanelHost} />
              {selected?.pageLink && pageActions ? <section className={css.pageScreenActions}>
                <h3>{t('canvasLinkedPage')}</h3>
                <p>{linkedPages.find(page => page.id === selected.pageLink?.pageId)?.title ?? t('canvasBuilderPageMissing')}</p>
                {pageReadError ? <p role="alert">{pageReadError}</p> : null}
                {pageResources[selected.id] === 'loading' ? <p role="status">{t('canvasPageResourcesLoading')}</p> : null}
                {pageResources[selected.id] === 'error' ? <div role="alert"><p>{t('canvasPageResourcesFailed')}</p>
                  <button type="button" onClick={() => { setPageResourceEpoch(value => ({ ...value, [selected.id]: (value[selected.id] ?? 0) + 1 })) }}>{t('designerReload')}</button></div> : null}
                <label><input type="checkbox" checked={selected.pageLink.autoHeight === true}
                  disabled={selectedLocked || saving || openingPage || conflict || editing !== null || textDirty}
                  onChange={(event) => {
                    if (!doc || !selected.pageLink) return
                    const autoHeight = event.currentTarget.checked
                    commit(editDesignNodes(doc, [{ id: selected.id, pageLink: { ...selected.pageLink, autoHeight },
                      ...(!autoHeight ? { height: computedById.get(selected.id)?.height ?? selected.height } : {}) }]))
                  }} />{t('canvasFitPageHeight')}</label>
                <p>{t('canvasFitPageHeightHint')}</p>
                {(() => {
                  const page = linkedPages.find(item => item.id === selected.pageLink?.pageId)
                  const shown = computedById.get(selected.id)
                  return selected.pageLink.autoHeight && page && shown && pageLayouts[selected.id]?.key === pageLayoutKey(shown, page) && pageLayouts[selected.id]?.state === 'error'
                    ? <div role="alert"><p>{t('canvasFitPageHeightFailed')}</p>
                      <button type="button" onClick={() => {
                        setPageResourceEpoch(value => ({ ...value, [selected.id]: (value[selected.id] ?? 0) + 1 }))
                      }}>{t('designerReload')}</button></div> : null
                })()}
                <button type="button" className={css.primary} disabled={openingPage || saving || conflict || textDirty || editing !== null ||
                !linkedPages.some(page => page.id === selected.pageLink?.pageId)}
                onClick={() => { void openPageScreen(selected.id) }}>{t('canvasOpenPageBuilder')}</button>
                {(() => {
                  const source = linkedPages.find(page => page.id === selected.pageLink?.pageId)?.conversion
                  const updatable = !!actions.reviewDesignPageUpdate && !!actions.applyDesignPageUpdate
                  return source?.sourceDesignId === doc?.id && source && updatable ? <>
                    <button type="button" title={t('canvasUpdateFromDesignHint')}
                      disabled={conversionBusy !== null || saving || openingPage || conflict || editing !== null || textDirty}
                      onClick={() => { void reviewPageUpdate(source.sourceFrameId) }}>{t('canvasUpdateFromDesign')}</button>
                    {pageSyncStatus && !pageUpdateNotice ? <p className={css.hint} aria-live="polite">{pageSyncStatus}</p> : null}
                    {pageUpdateNotice ? <p role="status">{pageUpdateNotice}</p> : null}
                  </> : null
                })()}
                <button type="button" disabled={selectedLocked || saving || openingPage || conflict}
                  title={t('canvasUnlinkPageHint')} onClick={() => {
                    if (doc) commit(editDesignNodes(doc, [{ id: selected.id, pageLink: undefined }]))
                  }}>{t('canvasUnlinkPage')}</button>
              </section> : null}
              {inspectorTab === 'code' ? <DesignerCodePanel document={cssDocument} results={cssResults} text={selectedCss}
                copy={() => { void copyText(selectedCss) }}
                copyTokens={() => { if (cssDocument) void copyText(exportDesignCss(cssDocument, true)) }} t={t} /> : doc ? (
                <>
                  {selected ? (
                    <>
                      {activeCells ? <DesignerInstanceGridCell doc={doc} instanceId={activeCells.instanceId} paths={activeCells.paths}
                        rootLocked={selectedLocked} t={t} commit={commit}
                        setPadding={changeAutoLayoutPadding} setLayoutAlignment={changeAutoLayoutAlignment}
                        setCellAlignment={changeGridCellAlignment}
                        preview={previewDocument} cancelPreview={cancelPreview}
                        onBack={() => { setInstanceCells(null) }}
                        onSelect={(path, additive) => { selectInstanceCell(activeCells.instanceId, path, additive) }} /> : <>
                        {selected.kind === 'instance' ? <DesignerInstanceCellChooser key={`${doc.id}:${selected.id}`} doc={doc} instanceId={selected.id} t={t}
                          onSelect={(path, additive) => { selectInstanceCell(selected.id, path, additive) }} /> : null}
                        {booleanSelected || selection.length > 1 ? <DesignerBooleanControls
                          selected={booleanSelected ? selected : undefined} enabled={booleanEnabled}
                          reason={booleanReason} t={t} onOperation={changeBoolean} onUngroup={() => { releaseBoolean(false) }}
                          onFlatten={() => { releaseBoolean(true) }} /> : null}
                        <DesignerInspector
                          workspaceTypography={actions.getStyleGuide ? { workspaceId, getStyleGuide: actions.getStyleGuide } : undefined}
                          cropImage={(paintId, metadata) => {
                            crop.begin(selected.id, paintId, metadata)
                          }}
                          doc={doc}
                          items={[
                            {
                              ...restoreDesignTokenColorLiterals(computedById.get(selected.id) ?? selected),
                              locked: selectedLocked,
                            },
                            ...computed
                              .filter(
                                n =>
                                  n.id !== selected.id && selection.includes(n.id),
                              )
                              .map(n => ({ ...restoreDesignTokenColorLiterals(n), locked: isLocked(n) })),
                          ]}
                          t={t}
                          combineVariants={combineVariants}
                          addVariant={addVariant}
                          dissolveVariants={dissolveVariants}
                          swapComponent={(componentId) => {
                            if (selection.some((id) => {
                              const stored = doc.nodes.find(n => n.id === id)
                              return !stored || stored.kind !== 'instance' || isLocked(stored)
                            })) return
                            try {
                              const next = swapDesignInstances(doc, selection.map(nodeId => ({ nodeId, componentId })))
                              if (next !== doc) commit(next)
                            } catch {
                              setError(t('designerSwapFailed'))
                            }
                          }}
                          goToMain={(componentId) => {
                            const main = doc.nodes.find(n => n.id === componentId && n.kind === 'component')
                            if (main) {
                              setActivePage(main.pageId ?? '')
                              setSelection([main.id])
                            }
                          }}
                          suggestionOpen={suggestionOpen}
                          dismissSuggestion={() => { setSuggestionOpen(false) }}
                          suggestionControl={committedDocument ? <DesignerAutoLayoutSuggestion doc={committedDocument}
                            ids={selection} contextKey={layoutVersionContextKey} open={suggestionOpen}
                            canSuggest={!!suggestionContext?.canSuggest} t={t} onOpenChange={setSuggestionOpen}
                            preview={previewSuggestion} cancelPreview={cancelPreview} apply={applySuggestion} /> : null}
                          layoutVersionControl={committedDocument ? <DesignerLayoutVersion doc={committedDocument}
                            scope={{ type:'selection',nodeIds:selection }} contextKey={layoutVersionContextKey} t={t}
                            preview={previewLayoutVersion} cancelPreview={cancelPreview} apply={applyLayoutVersion} /> : null}
                          patch={patchSelection}
                          commit={commit}
                          preview={previewDocument}
                          cancelPreview={cancelPreview}
                          align={align}
                          distribute={distribute}
                          addLayout={() => {
                            runCommand('addLayout')
                          }}
                          setPadding={changeAutoLayoutPadding}
                          setLayoutAlignment={changeAutoLayoutAlignment}
                          setCellAlignment={changeGridCellAlignment}
                          setLayoutFlow={(flow) => { changeAutoLayout(flow) }}
                          removeLayout={(recursive) => {
                            runCommand(recursive?'removeAllLayout':'removeLayout')
                          }}
                          editGradient={(paintId, open, role = 'fill') => {
                            if (
                              !open &&
                          gesture.current?.mode === 'gradient' &&
                          gesture.current.gradient?.paintId === paintId && gesture.current.gradient.role === role
                            ) {
                              setHistory(gesture.current.original)
                              gesture.current = null
                            }
                            setGradientEdit(current =>
                              open
                                ? { nodeId: selected.id, paintId, role }
                                : current?.paintId === paintId && current.role === role
                                  ? null
                                  : current,
                            )
                          }}
                        />
                        {selection.length === 1 ? <DesignerSemantics key={selected.id} doc={doc} node={selected} t={t} commit={commit}
                          disabled={selectedLocked || saving || conflict || editing !== null || textDirty} />
                          : <DesignerSemanticsMulti doc={doc} t={t} commit={commit}
                            nodes={selection.map(id => doc.nodes.find(node => node.id === id))
                              .filter((node): node is CopyOSDesignNode => !!node)}
                            disabled={selectedLocked || saving || conflict || editing !== null || textDirty} />}
                      </>}
                      {/* Board-level extras follow the design properties. */}
                      {selected.kind === 'frame' && selected.parentId === null && !selected.pageLink &&
                        !(selected.breakpoint && doc.nodes.some(node => node.id === selected.breakpoint?.sourceFrameId)) &&
                        actions.previewDesignPage && actions.buildDesignPage && pageActions ? <section className={css.pageScreenActions}>
                          <h3>{t(builtPageForSelection ? 'canvasConversionOriginal' : 'canvasConversionSection')}</h3>
                          <p>{t(builtPageForSelection ? 'canvasConversionSourceBuiltHint' : 'canvasConversionSourceHint')}</p>
                          <button type="button" className={css.primary}
                            disabled={conversionBusy !== null || saving || conflict || editing !== null || textDirty || selectedLocked}
                            onClick={() => { void reviewPageConversion() }}>{conversionBusy === 'preview'
                              ? t('canvasConversionPreparing') : t(builtPageForSelection ? 'canvasOpenBuiltPage' : 'canvasBuildPage')}</button>
                          {builtPageForSelection && onStartAgent ? <button type="button"
                            disabled={conversionBusy !== null || saving || conflict || editing !== null || textDirty || selectedLocked}
                            onClick={() => { void reviewPageConversion(true) }}>{t('canvasCompleteWebsite')}</button> : null}
                          {builtPageForSelection && actions.reviewDesignPageUpdate && actions.applyDesignPageUpdate ? <>
                            <button type="button" title={t('canvasUpdateFromDesignHint')}
                              disabled={conversionBusy !== null || saving || conflict || editing !== null || textDirty}
                              onClick={() => { void reviewPageUpdate(selected.id) }}>{t('canvasUpdateFromDesign')}</button>
                            {pageSyncStatus && !pageUpdateNotice ? <p className={css.hint} aria-live="polite">{pageSyncStatus}</p> : null}
                            {pageUpdateNotice ? <p role="status">{pageUpdateNotice}</p> : null}
                          </> : null}
                        </section> : null}
                      <DesignerBreakpoints doc={doc} node={selected} t={t} commit={commit}
                        disabled={selectedLocked || saving || conflict || editing !== null || textDirty || conversionBusy !== null}
                        select={(frame) => {
                          setSelection([frame.id])
                          setView(current => ({ ...current, x: 40 - frame.x * current.zoom, y: 40 - frame.y * current.zoom }))
                        }} />
                      <DesignerArtboardOutput doc={doc} node={computedById.get(selected.id) ?? selected} t={t} commit={commit}
                        revision={revision.current} unsaved={dirty}
                        frames={selection.map(id => computedById.get(id)).filter((frame): frame is CopyOSDesignNode => frame?.kind === 'frame' &&
                          frame.parentId === null && !frame.pageLink && frame.visible)}
                        fontUrl={interFont} fontCss={designerProjectFontCss(workspaceId)}
                        disabled={selectedLocked || saving || conflict || editing !== null || textDirty || conversionBusy !== null}
                        select={(frame) => {
                          setSelection([frame.id])
                          setView(current => ({ ...current, x: 40 - frame.x * current.zoom, y: 40 - frame.y * current.zoom }))
                        }} />
                    </>
                  ) : (
                    <>
                      <div className={css.propertySection}>
                        <label className={css.field}>
                          <span>{t('designerDocument')}</span>
                          <input
                            value={doc.title}
                            maxLength={160}
                            onChange={(e) => {
                              if (e.currentTarget.value.trim())
                                commit({ ...doc, title: e.currentTarget.value })
                            }}
                          />
                        </label>
                        <p className={css.hint}>{t('designerSelectHint')}</p>
                        {doc.pages?.some(p => p.id === activePage) ? (
                          <DesignerModeSelect
                            doc={doc}
                            value={
                              doc.pages.find(p => p.id === activePage)
                                ?.tokenModeId
                            }
                            inheritedModeId={doc.activeTokenModeId ?? null}
                            label={t('designerPageMode')}
                            t={t}
                            onChange={(tokenModeId) => {
                              commit({
                                ...doc,
                                pages: doc.pages?.map(p =>
                                  p.id === activePage ? { ...p, tokenModeId } : p,
                                ),
                              })
                            }}
                          />
                        ) : null}
                      </div>
                      <DesignerPageBackground key={`${doc.id}:${activePage}`} doc={doc} pageId={activePage} t={t}
                        commit={commit} preview={previewDocument} cancelPreview={cancelPreview} />
                      <DesignerEffects key={`${doc.id}:effect-library`} doc={doc} owners={[]} t={t} commit={commit}
                        preview={previewDocument} cancelPreview={cancelPreview}/>
                      <div className={css.propertySection}>
                        <h3>{t('designerVariables')}</h3>
                        {resolvedColors.map(v => (
                          <DesignerColorResource
                            key={`${doc.activeTokenModeId ?? 'base'}:${v.id}`}
                            doc={doc} variable={v} colors={resolvedColors} t={t} showName
                            commit={commit} preview={previewDocument} cancelPreview={cancelPreview}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  <DesignerFontReview doc={doc} t={t} commit={commit} cancelPreview={cancelPreview}
                    {...(projectFontActions ? { projectFonts } : {})} />
                  <DesignerPopover
                    label={t('designerTokens')}
                    onDismiss={cancelPreview}
                    closeLabel={t('designerDone')}
                    trigger={
                      <>
                        <Icon name="styles" />
                        {t('designerTokens')}
                      </>
                    }
                  >
                    <DesignerTokens
                      doc={doc}
                      node={
                        selection.length === 1 && selected
                          ? computedById.get(selected.id)
                          : undefined
                      }
                      t={t}
                      commit={commit}
                      preview={previewDocument}
                      cancelPreview={cancelPreview}
                      patch={selected ? patchSelection : undefined}
                      importTokens={() => {
                        void importTokens()
                      }}
                      notice={tokenNotice}
                      review={tokenReview}
                    />
                  </DesignerPopover>
                  <details className={css.agentHint}>
                    <summary>{t('designerAgentTitle')}</summary>
                    <p>{t('designerAgentHint')}</p>
                    <code>{doc.id}</code>
                    {onStartAgent ? (
                      <form
                        className={css.agentComposer}
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (!agentPrompt.trim() || agentStarting) return
                          setAgentStarting(true)
                          void (async () => {
                            try {
                              if ((dirty || textDirty) && !(await save())) return
                              await onStartAgent(
                                `${t('designerAgentInstructions')}\n${JSON.stringify({ design_id: doc.id, revision: revision.current, selected_node_ids: selection })}\n${agentPrompt.trim()}`,
                              )
                              setAgentPrompt('')
                            } catch (e) {
                              setError(message(e))
                            } finally {
                              setAgentStarting(false)
                            }
                          })()
                        }}
                      >
                        <textarea
                          aria-label={t('designerAgentRequest')}
                          placeholder={t('designerAgentRequest')}
                          value={agentPrompt}
                          onChange={(e) => {
                            setAgentPrompt(e.currentTarget.value)
                          }}
                          disabled={agentStarting}
                        />
                        <button
                          type="submit"
                          disabled={
                            !agentPrompt.trim() ||
                          agentStarting ||
                          conflict ||
                          saving
                          }
                        >
                          {t(
                            agentStarting
                              ? 'sessionStarting'
                              : 'designerEditWithAgent',
                          )}
                        </button>
                      </form>
                    ) : null}
                  </details>
                </>
              ) : (
                <div className={css.propertySection}>
                  <p>{t('designerEmptyHint')}</p>
                  <button type="button" onClick={() => figUpload.current?.click()}>
                    {t('designerImportFig')}
                  </button>
                </div>
              )}
            </div>
          </aside>
          {doc && !crop.active ? (
            <DesignerToolbar
              tool={tool}
              setTool={setTool}
              t={t}
              image={() => {
                upload.current?.click()
              }}
              assets={() => {
                setLeftTab('assets')
              }}
              undo={undo}
              redo={redo}
              canUndo={!!history?.past.length}
              canRedo={!!history?.future.length}
              booleanMenu={booleanMenu}
              onBoolean={runBooleanCommand}
              more={[
                ...['duplicate', 'group', 'ungroup', 'delete'].map(menuItem),
                { id: 'fit', label: t('designerFit') },
              ]}
              onMore={(id) => {
                if (id === 'fit') fit()
                else runCommand(id)
              }}
            />
          ) : null}
          {context ? (
            <DesignerContextMenu
              x={context.x}
              y={context.y}
              items={menuEntries}
              onClose={() => {
                setContext(null)
              }}
              onSelect={(id) => {
                if (id.startsWith('boolean:')) { runBooleanCommand(id); setContext(null); return }
                if (id === 'boolean-flatten') { releaseBoolean(true); setContext(null); return }
                if (activeCells && id !== 'copyCss') { setContext(null); return }
                if (id.startsWith('select:')) {
                  setSelection([id.slice(7)])
                  setContext(null)
                } else if (id.startsWith('page:')) {
                  movePage(id.slice(5))
                  setContext(null)
                } else runCommand(id)
              }}
            />
          ) : null}
          <input
            hidden
            ref={figUpload}
            type="file"
            accept=".fig"
            aria-label={t('designerImportFig')}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) void importFig(file)
            }}
          />
          {doc ? (
            <>
              <input
                hidden
                ref={upload}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  if (file.size > 5_000_000) {
                    setError(t('designerImageTooLarge'))
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => {
                    if (typeof reader.result !== 'string') return
                    const imageUrl = reader.result
                    const image = new Image()
                    image.onload = async () => {
                      const n = createDesignNode('image', randomUUID(), file.name)
                      n.imageUrl = await storeImage(imageUrl)
                      if (activePage) n.pageId = activePage
                      n.width = Math.min(image.width, 1200)
                      n.height = (n.width * image.height) / image.width
                      setHistory(current =>
                        current?.present.id === doc.id
                          ? {
                            present: {
                              ...current.present,
                              nodes: [...current.present.nodes, n],
                            },
                            past: [...current.past.slice(-99), current.present],
                            future: [],
                          }
                          : current,
                      )
                      setSelection([n.id])
                    }
                    image.src = reader.result
                  }
                  reader.readAsDataURL(file)
                  e.currentTarget.value = ''
                }}
              />
            </>
          ) : null}
        </section>
      </DesignerSaveAdmission.Provider>
    </DesignerWorkspaceProviders>
  )
}
