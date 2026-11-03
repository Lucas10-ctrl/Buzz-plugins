/** Portable CopyOS project records and browser-safe projections. */

import type { DesignPageElementMapping, DesignPageCompilationWarning } from './design-page-compiler.ts'

/** Current on-disk CopyOS project schema version. */
export const COPYOS_PROJECT_VERSION = 1 as const

/** Editable scene primitives supported by Page Designer. */
export type CopyOSDesignNodeKind =
  | 'frame'
  | 'group'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'image'
  | 'component'
  | 'component-set'
  | 'instance'
  | 'path'
  | 'boolean'

/** Ordered constructive geometry operation; subtraction removes later operands from the first. */
export type CopyOSDesignBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude'

/** One OpenType feature: four ASCII alphanumeric tag characters and an integer value from 0 through 65535. */
export interface CopyOSDesignFontFeature { tag: string; value: number }

/** One authored variable-font axis with a four-character ASCII tag and finite coordinate. */
export interface CopyOSDesignFontVariation { tag: string; value: number }

/** One axis read from the bundled font's variation table; coordinates use the font's design units. */
export interface CopyOSDesignFontAxis { tag: string; name: string; min: number; default: number; max: number }

/** Metadata for the trusted bundled face only; unavailable never implies that an installed font lacks axes. */
export type CopyOSDesignFontMetadata =
  | { state: 'available'; family: string; source: 'bundled'; sha256: string; axes: CopyOSDesignFontAxis[] }
  | { state: 'unavailable'; family: string; reason: 'unknown-family' }

/** Read-only bundled metadata lookup scoped to a registered CopyOS project; family has at most 200 characters. */
export interface CopyOSDesignFontMetadataRequest { workspaceId: string; family: string }

/** Aspect ratios accepted by the configured Higgsfield text-to-image model. */
export type CopyOSGenerationAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3'
/** Output tier; Higgsfield bills each image by tier. */
export type CopyOSGenerationResolution = '720p' | '1080p'
/** Generation lifecycle. `submitting` is saved before the billable request is sent and never resent automatically. */
export type CopyOSGenerationStatus = 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'
/** One downloaded result stored in the project; `file` is relative to the project root. */
export interface CopyOSGenerationImage { file: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number }
/** Durable generation record stored at `.copyos/generations/<id>.json`; the server keeps polling until a terminal status. */
export interface CopyOSGenerationRecord {
  id: string
  provider: 'higgsfield'
  model: string
  prompt: string
  aspectRatio: CopyOSGenerationAspectRatio
  resolution: CopyOSGenerationResolution
  /** Provider request identity; null until Higgsfield accepts the submission. */
  requestId: string | null
  status: CopyOSGenerationStatus
  /** Failure or cancellation detail shown to the user; null when none. */
  error: string | null
  /** True after the user asked Higgsfield to cancel; the status changes only when the provider reports it. */
  cancelRequested: boolean
  images: CopyOSGenerationImage[]
  createdAt: string
  updatedAt: string
}
/** Submit one billable text-to-image generation; prompt has 1–4000 characters. */
export interface CopyOSGenerationStartRequest {
  workspaceId: string
  prompt: string
  aspectRatio: CopyOSGenerationAspectRatio
  resolution: CopyOSGenerationResolution
}
/** List a project's generation records, newest first. */
export interface CopyOSGenerationListRequest { workspaceId: string }
/** Generation records, newest first. */
export interface CopyOSGenerationListValue { generations: CopyOSGenerationRecord[] }
/** Ask Higgsfield to cancel one queued or running generation. */
export interface CopyOSGenerationCancelRequest { workspaceId: string; id: string }
/** Read one saved result image of a completed generation. */
export interface CopyOSGenerationImageRequest { workspaceId: string; id: string; index: number }
/** Saved result image as a data URL that Canvas image layers accept. */
export interface CopyOSGenerationImageValue { dataUrl: string; mimeType: CopyOSGenerationImage['mimeType'] }
/** Store one PNG, JPEG, WebP or GIF image in a project for design image fields. */
export interface CopyOSDesignImagePutRequest { workspaceId: string; dataBase64: string }
/** Stored image reference (`copyos-asset:<sha256>.<ext>`) for a design image field. */
export interface CopyOSDesignImagePutValue { url: string }
/** Copy referenced image files into a project from the project a pasted selection came from. */
export interface CopyOSDesignImageCopyRequest { workspaceId: string; sourceWorkspaceId: string; urls: string[] }
/** One stored project image file. */
export interface CopyOSDesignImageFile {
  /** `<sha256>.<ext>` inside `assets/images/`. */
  fileName: string
  /** File size in bytes. */
  bytes: number
}
/** One installed project font file: a single face, or a variable face covering a weight range. */
export interface CopyOSDesignFontFace {
  /** CSS family name designs use for this face. */
  family: string
  style: 'normal' | 'italic'
  /** Lowest weight the file provides; equal to `weightMax` for a static face. */
  weightMin: number
  weightMax: number
  /** File name inside `assets/fonts/`: `<sha256>.<ttf|otf|woff|woff2>`. */
  file: string
  /** `google`: installed from Google Fonts (Latin characters); `upload`: supplied by the user. */
  source: 'google' | 'upload'
  bytes: number
}
/** Installed project fonts. */
export interface CopyOSDesignFontList { faces: CopyOSDesignFontFace[] }
/** List a project's installed fonts. */
export interface CopyOSDesignFontListRequest { workspaceId: string }
/** Install font families that designs use from Google Fonts into the project. */
export interface CopyOSDesignFontInstallRequest {
  workspaceId: string
  /** CSS family names, at most 20; families already installed are skipped. */
  families: string[]
}
/** Faces installed by one request, and requested families Google Fonts does not provide. */
export interface CopyOSDesignFontInstallValue { faces: CopyOSDesignFontFace[]; unavailable: string[] }
/** Add a user-supplied font file (TTF, OTF, WOFF or WOFF2) to the project. */
export interface CopyOSDesignFontUploadRequest {
  workspaceId: string
  fileName: string
  /** Base64 file bytes, at most 10 MB decoded. */
  dataBase64: string
}
/** Read one installed font file. */
export interface CopyOSDesignFontReadRequest {
  workspaceId: string
  /** File name from {@link CopyOSDesignFontFace.file}. */
  file: string
}
/** One font file's bytes. */
export interface CopyOSDesignFontReadValue { dataBase64: string; mimeType: string }
/**
 * Where a Canvas review comment is pinned. `layer`: a point inside one layer, in that layer's local CSS pixels; `point`: scene
 * coordinates on the page. `pageId` is the design page, or null for the implicit first page.
 */
export type CopyOSDesignCommentTarget =
  | { kind: 'layer'; pageId: string | null; nodeId: string; nodeName: string; x: number; y: number }
  | { kind: 'point'; pageId: string | null; x: number; y: number }
/** One Canvas review comment, stored beside the design and never inside it. */
export interface CopyOSDesignComment {
  id: string
  /** Trimmed text of 1–4000 characters. */
  body: string
  status: 'open' | 'resolved'
  target: CopyOSDesignCommentTarget
  createdAt: string
  updatedAt: string
}
/** Review comments of one design, oldest first. */
export interface CopyOSDesignCommentList { designId: string; comments: CopyOSDesignComment[] }
/** Read one design's review comments. */
export interface CopyOSDesignCommentListRequest { workspaceId: string; designId: string }
/** Add a review comment to an existing design; a design holds at most 2000 comments. */
export interface CopyOSDesignCommentCreateRequest { workspaceId: string; designId: string; body: string; target: CopyOSDesignCommentTarget }
/** Resolve or reopen one design review comment. */
export interface CopyOSDesignCommentStatusRequest {
  workspaceId: string
  designId: string
  commentId: string
  status: 'open' | 'resolved'
}
/** Delete one design review comment. */
export interface CopyOSDesignCommentDeleteRequest { workspaceId: string; designId: string; commentId: string }
/** One saved Canvas template: a copy of one top-level artboard shared by every workspace. */
export interface CopyOSDesignTemplateSummary {
  id: string
  title: string
  category: string
  description: string
  /** Artboard size in CSS pixels when saved. */
  width: number
  height: number
  sourceWorkspaceName: string
  sourceDesignTitle: string
  createdAt: string
  /** `data:image/png;base64,` preview at most 480 pixels wide, or null when it could not be rendered. */
  thumbnail: string | null
}
/** List the shared template library from a registered workspace. */
export interface CopyOSDesignTemplateListRequest { workspaceId: string }
/** Every saved template, newest first. */
export interface CopyOSDesignTemplateList { templates: CopyOSDesignTemplateSummary[] }
/** Save one visible top-level frame of a saved design revision as a shared template. */
export interface CopyOSDesignTemplateSaveRequest {
  workspaceId: string
  designId: string
  /** Visible top-level frame in the saved design. */
  nodeId: string
  /** 1–120 characters. */
  title: string
  /** 1–60 characters. */
  category: string
  /** At most 1000 characters. */
  description: string
}
/** Read one template with its layers. */
export interface CopyOSDesignTemplateReadRequest { workspaceId: string; templateId: string }
/** One template and its validated clipboard snapshot, whose images are embedded as `data:` URLs. */
export interface CopyOSDesignTemplateRead { template: CopyOSDesignTemplateSummary; snapshot: CopyOSDesignClipboardSnapshot }
/** Delete one template from the shared library. */
export interface CopyOSDesignTemplateDeleteRequest { workspaceId: string; templateId: string }
/** Find stored images that no project file and no listed outside reference uses. */
export interface CopyOSDesignImageUnusedRequest {
  workspaceId: string
  /** Image references or file names an open editor still holds, such as its Undo history and unsaved draft. */
  keep: string[]
}
/** Stored image files, sorted by name. */
export interface CopyOSDesignImageUnusedValue { files: CopyOSDesignImageFile[] }
/** Delete confirmed unused images; each is checked again before deletion. */
export interface CopyOSDesignImageRemoveRequest {
  workspaceId: string
  /** Image references or file names an open editor still holds. */
  keep: string[]
  /** Files the user confirmed for deletion. */
  fileNames: string[]
}
/** Generation provider settings the client needs; never includes the secret. */
export interface CopyOSGenerationSettings {
  provider: 'higgsfield'
  /** Credentials-service reference holding `KEY_ID:KEY_SECRET`. */
  credentialRef: string
  model: string
}

/** A reusable text style; paint and text alignment remain independent. */
export interface CopyOSDesignTextStyle {
  id: string
  name: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  /** Whole feature list; omission inherits, empty uses font defaults, and value zero disables a tag. */
  fontFeatures?: CopyOSDesignFontFeature[] | undefined
  /** Whole axis list; omission inherits and an empty list selects font defaults. */
  fontVariations?: CopyOSDesignFontVariation[] | undefined
  fontStyle: 'normal' | 'italic'
}

/** An editable gradient; transforms map normalized node coordinates into paint space. */
export interface CopyOSDesignGradient {
  type: 'linear' | 'radial'
  stops: {
    id?: string | undefined
    position: number
    color: string
    opacity: number
    variableId?: string | null | undefined
  }[]
  transform: number[]
}

/** Raster content within a shape's fill stack. */
export interface CopyOSDesignImagePaint {
  url: string
  scaleMode: 'fill' | 'fit' | 'stretch' | 'crop' | 'tile'
  sourceWidth?: number | undefined
  sourceHeight?: number | undefined
  /** Scale relative to Fill sizing in Crop; ignored by other modes. */
  zoom?: number | undefined
  /** Image-center displacement as fractions of the layer dimensions. */
  offsetX?: number | undefined
  offsetY?: number | undefined
  rotation?: number | undefined
  /** Tile size as a fraction of the source's original pixel dimensions. */
  tileScale?: number | undefined
}

/** CSS-native paint compositing operators; unsupported Figma operators are not approximated. */
export type CopyOSDesignPaintBlendMode =
  | 'normal' | 'darken' | 'multiply' | 'color-burn' | 'lighten' | 'screen' | 'color-dodge'
  | 'overlay' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity' | 'plus-lighter'

/** Layer output modes; pass-through leaves descendant paint blending connected to the underlying scene. */
export type CopyOSDesignLayerBlendMode = CopyOSDesignPaintBlendMode | 'pass-through'

/** Captured outer width/height proportion, independent of dimensions and numeric resources. */
export interface CopyOSDesignAspectRatio { x: number; y: number }

/** A paint in an ordered fill or stroke stack; absent image and gradient means a solid color. */
export interface CopyOSDesignPaint {
  /** Missing values use normal source-over compositing. */
  blendMode?: CopyOSDesignPaintBlendMode | undefined
  id: string
  color: string
  opacity: number
  visible: boolean
  variableId: string | null
  gradient?: CopyOSDesignGradient | undefined
  image?: CopyOSDesignImagePaint | undefined
}

/** Numeric properties that can reference a shared design token. */
export type CopyOSDesignNumberProperty =
  | 'width'
  | 'strokeWidth'
  | 'strokeTopWidth'
  | 'strokeRightWidth'
  | 'strokeBottomWidth'
  | 'strokeLeftWidth'
  | 'height'
  | 'minWidth'
  | 'maxWidth'
  | 'minHeight'
  | 'maxHeight'
  | 'gap'
  | 'padding'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'radius'
  | 'radiusTopLeft'
  | 'radiusTopRight'
  | 'radiusBottomRight'
  | 'radiusBottomLeft'
  | 'crossGap'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'paragraphSpacing'

/** Bounded numeric formulas refer to resource identities, never names or executable source. */
export type CopyOSDesignNumberExpression =
  | { kind:'literal';value:number;unit:'px'|'number' }
  | { kind:'reference';variableId:string }
  | { kind:'binary';operator:'+'|'-'|'*'|'/';left:CopyOSDesignNumberExpression;right:CopyOSDesignNumberExpression }
  | { kind:'min'|'max';args:CopyOSDesignNumberExpression[] }
  | { kind:'clamp';min:CopyOSDesignNumberExpression;preferred:CopyOSDesignNumberExpression;max:CopyOSDesignNumberExpression }

/** A shared pixel or unitless value; bindings retain identity when its value changes. */
export interface CopyOSDesignNumberVariable {
  /** Omitted/null uses alias or literal; a formula owns its live numeric dependencies. */
  expression?: CopyOSDesignNumberExpression | null | undefined
  /** Optional source in the same collection; otherwise use the literal value. */
  aliasId?: string | null | undefined
  id: string
  name: string
  value: number
  unit: 'px' | 'number'
}

/** One grid track; Fill values are fractional weights and Hug ignores the literal. */
export interface CopyOSDesignGridTrack {
  sizing: 'fixed' | 'hug' | 'fill'
  value: number
  variableId?: string | null | undefined
}
/** Grid columns are explicit; rows can grow to accommodate content. */
export interface CopyOSDesignGrid {
  columns: CopyOSDesignGridTrack[]
  rows: CopyOSDesignGridTrack[]
  autoRows: boolean
  autoPosition: boolean
  implicitRow: CopyOSDesignGridTrack
}
/** Local root grid fields; each owned array replaces its complete source axis. */
export type CopyOSDesignInstanceGrid = { [K in keyof CopyOSDesignGrid]?: CopyOSDesignGrid[K] | undefined }
/** One-based cell anchors; spans remain active under automatic placement. */
export interface CopyOSDesignGridCell {
  column?: number | undefined
  row?: number | undefined
  columnSpan?: number | undefined
  rowSpan?: number | undefined
  horizontalAlign?: 'start' | 'center' | 'end' | undefined
  verticalAlign?: 'start' | 'center' | 'end' | undefined
}

/** Frame-relative resize rules; absent references are captured when a document is parsed. */
export interface CopyOSDesignConstraints {
  horizontal: 'left' | 'right' | 'left-right' | 'center' | 'scale'
  vertical: 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'
  referenceWidth?: number | undefined
  referenceHeight?: number | undefined
}

/** Instance-local sizing ownership; absent metadata retains every legacy local property. */
export type CopyOSDesignInstanceSizingProperty =
  | 'width' | 'height' | 'widthSizing' | 'heightSizing' | 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'

/** A named, stable variant axis with explicit string choices; sparse combinations are allowed. */
export interface CopyOSDesignVariantAxis {
  id: string
  name: string
  values: string[]
}
/** One concrete component's choice on a parent set's axis. */
export interface CopyOSDesignVariantValue {
  axisId: string
  value: string
}

/** A reusable component control targeting descendant text, visibility or nested main-component fields. */
export type CopyOSDesignComponentProperty =
  | { id: string; name: string; type: 'text'; defaultValue: string; targets: string[][] }
  | { id: string; name: string; type: 'boolean'; defaultValue: boolean; targets: string[][] }
  | { id: string; name: string; type: 'instance-swap'; defaultValue: string; targets: string[][]; preferredValues?: string[] | undefined }

/** An explicit instance-local component control value; absent records inherit the definition default. */
export interface CopyOSDesignComponentPropertyValue {
  propertyId: string
  value: string | boolean
}

/** Explicit local root strokes; omitted keys inherit. Local scalar width masks source sides before local side overrides. */
export interface CopyOSDesignInstanceStroke {
  /** Whole-stack ownership; omitted inherits, empty suppresses every stroke paint. */
  strokes?: CopyOSDesignPaint[] | undefined
  stroke?: string | undefined
  strokeVariableId?: string | null | undefined
  strokeOpacity?: number | undefined
  strokeAlign?: 'inside' | 'center' | 'outside' | undefined
  strokeDash?: number | undefined
  strokeCap?: 'butt' | 'round' | 'square' | undefined
  strokeJoin?: 'miter' | 'round' | 'bevel' | undefined
  /** SVG miter-length/width ratio, distinct from the inspector's angle in degrees. */
  strokeMiterLimit?: number | undefined
  /** Alternating physical dash/gap pairs; empty explicitly owns solid. */
  strokeDashes?: number[] | undefined
  strokeDashOffset?: number | undefined
  strokeWidth?: number | undefined
  strokeTopWidth?: number | undefined
  strokeRightWidth?: number | undefined
  strokeBottomWidth?: number | undefined
  strokeLeftWidth?: number | undefined
}

/** A scene node; coordinates are relative to its parent. */
export interface CopyOSDesignNode {
  /** Omission passes through for ordinary layers and inherits the current main for linked roots. */
  blendMode?: CopyOSDesignLayerBlendMode | undefined
  id: string
  parentId: string | null
  /** Imported Figma page; absent in single-page designs. */
  pageId?: string | undefined
  /** Existing Page Builder page in the same project; valid only on an empty top-level frame, independent of its Figma pageId. */
  pageLink?: {
    pageId: string
    /** Browser-measured display height only; omission/false uses stored height, which remains the fixed fallback. */
    autoHeight?: boolean | undefined
  } | undefined
  /** Explicit page-conversion semantics; omission emits generic containers, paragraphs and layer-name image alternatives. */
  semantics?: CopyOSDesignSemantics | undefined
  /** Marks a top-level frame as a narrower layout of another top-level artboard, applied at or below maxWidth CSS pixels. */
  breakpoint?: { sourceFrameId: string; maxWidth: number } | undefined
  /** Layer of the breakpoint's source artboard that this breakpoint layer restyles; unresolved references are reported at conversion. */
  breakpointSourceId?: string | undefined
  /** Omitted/null inherits; base explicitly selects Base; otherwise selects a mode UUID. */
  tokenModeId?: string | null | undefined
  numericBindings?: Partial<Record<CopyOSDesignNumberProperty, string>> | undefined
  fillOpacity?: number | undefined
  strokeOpacity?: number | undefined
  /** Live shared stroke color; the stored stroke remains the unbound literal. */
  strokeVariableId?: string | null | undefined
  /** Imported fixed geometry is retained until auto layout is explicitly edited. */
  preserveLayout?: boolean | undefined
  /** Live constructive geometry; valid only on Boolean containers. */
  booleanOperation?: CopyOSDesignBooleanOperation | undefined
  pathData?:
    | { width: number; height: number; paths: { d: string; fillRule: 'nonzero' | 'evenodd' }[] }
    | undefined
  gradient?: CopyOSDesignGradient | undefined
  shadow?: { x: number; y: number; blur: number; color: string; opacity: number } | undefined
  /** Ordered effects; absent retains legacy drop shadow, empty explicitly disables effects. */
  effects?: CopyOSDesignEffect[] | undefined
  /** Linked local style; null requires an explicit detached effects array. */
  effectStyleId?: string | null | undefined
  /** Optional additions preserve existing version-one documents without changing imported layout. */
  constraints?: CopyOSDesignConstraints | undefined
  grid?: CopyOSDesignGrid | undefined
  /** Local root grid fields; omitted axes/config inherit, raw grid remains a fallback only. */
  instanceGrid?: CopyOSDesignInstanceGrid | null | undefined
  gridCell?: CopyOSDesignGridCell | undefined
  layoutWrap?: 'none' | 'wrap' | undefined
  crossGap?: number | undefined
  alignContent?: 'start' | 'center' | 'end' | 'between' | 'stretch' | undefined
  radiusTopLeft?: number | undefined
  radiusTopRight?: number | undefined
  radiusBottomRight?: number | undefined
  radiusBottomLeft?: number | undefined
  widthSizing?: 'fixed' | 'hug' | 'fill' | undefined
  heightSizing?: 'fixed' | 'hug' | 'fill' | undefined
  paddingTop?: number | undefined
  paddingRight?: number | undefined
  paddingBottom?: number | undefined
  paddingLeft?: number | undefined
  alignItems?: 'start' | 'center' | 'end' | 'baseline' | undefined
  justifyContent?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly' | undefined
  /** Paint the first stack child above later children without changing flow or layer order. */
  itemReverseZIndex?: boolean | undefined
  /** Missing/legacy retains earlier CopyOS sizing; css applies padding floors and content-area Fill. */
  layoutSizingModel?: 'legacy' | 'css' | undefined
  /** Own inside strokes participate in layout; defaults on for css sizing and off for legacy. */
  strokesIncludedInLayout?: boolean | undefined
  absolutePosition?: boolean | undefined
  minWidth?: number | undefined
  maxWidth?: number | undefined
  minHeight?: number | undefined
  maxHeight?: number | undefined
  flipX?: boolean | undefined
  flipY?: boolean | undefined
  textStyleId?: string | null | undefined
  textDecoration?: 'none' | 'underline' | 'line-through' | undefined
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined
  /** Sparse inline formatting; absent uses the base style throughout. */
  textRuns?: CopyOSDesignTextRun[] | undefined
  textSizing?: 'fixed' | 'auto-width' | 'auto-height' | undefined
  /** Measured intrinsic text size, reused only for its exact text/style/allocated-width signature. */
  textLayoutMetrics?: CopyOSDesignTextLayoutMetrics | undefined
  /** Ending ellipsis clips presentation; authored text remains intact. */
  textTruncation?: 'disabled' | 'ending' | undefined
  /** Positive visible-line cap when ending truncation is enabled; null removes the cap. */
  maxLines?: number | null | undefined
  /** Recent measurements for exact text/style/geometry signatures and explicit engines, including linked instances. */
  textBaselineMetrics?: CopyOSDesignTextBaselineMetrics[] | undefined
  verticalAlign?: 'top' | 'center' | 'bottom' | undefined
  paragraphSpacing?: number | undefined
  fills?: CopyOSDesignPaint[] | undefined
  /** Bottom-to-top stroke paints; omitted uses legacy scalar stroke, empty means no paint. */
  strokes?: CopyOSDesignPaint[] | undefined
  strokeAlign?: 'inside' | 'center' | 'outside' | undefined
  strokeDash?: number | undefined
  strokeCap?: 'butt' | 'round' | 'square' | undefined
  strokeJoin?: 'miter' | 'round' | 'bevel' | undefined
  /** SVG miter-length/width ratio, distinct from the inspector's angle in degrees. */
  strokeMiterLimit?: number | undefined
  /** Alternating physical dash/gap pairs; empty explicitly owns solid. */
  strokeDashes?: number[] | undefined
  strokeDashOffset?: number | undefined
  kind: CopyOSDesignNodeKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  fill: string
  stroke: string
  strokeWidth: number
  /** Missing sides use strokeWidth; explicit zero disables that side. */
  strokeTopWidth?: number | undefined
  strokeRightWidth?: number | undefined
  strokeBottomWidth?: number | undefined
  strokeLeftWidth?: number | undefined
  /** Omission inherits all main stroke properties; null explicitly resets local ownership. */
  instanceStroke?: CopyOSDesignInstanceStroke | null | undefined
  radius: number
  text: string
  textWrap?: boolean | undefined
  letterSpacing?: number | undefined
  /** Whole feature list; omission inherits, empty uses font defaults, and value zero disables a tag. */
  fontFeatures?: CopyOSDesignFontFeature[] | undefined
  /** Whole axis list; omission inherits and an empty list selects font defaults. */
  fontVariations?: CopyOSDesignFontVariation[] | undefined
  fontStyle?: 'normal' | 'italic' | undefined
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  textAlign: 'left' | 'center' | 'right'
  imageUrl: string
  layout: 'none' | 'row' | 'column' | 'grid'
  gap: number
  padding: number
  clip: boolean
  componentId: string | null
  componentSet?: { axes: CopyOSDesignVariantAxis[] } | undefined
  variantValues?: CopyOSDesignVariantValue[] | undefined
  /** Main-local controls or shared set controls whose paths begin with a member component identity. */
  componentProperties?: CopyOSDesignComponentProperty[] | undefined
  componentPropertyValues?: CopyOSDesignComponentPropertyValue[] | undefined
  /** Omitted ordinary ratios are unlocked; omitted linked ratios inherit, while null explicitly unlocks. */
  targetAspectRatio?: CopyOSDesignAspectRatio | null | undefined
  /** Omitted retains legacy local sizing; an empty array inherits all main defaults. Numeric bindings own their values. */
  instanceSizingOverrides?: CopyOSDesignInstanceSizingProperty[] | undefined
  /** Descendant overrides; nested instance IDs precede the final source layer ID. */
  instanceOverrides?: CopyOSDesignInstanceOverride[] | undefined
  /** Root spacing and stack settings; grid spacing applies while incompatible flow settings remain dormant. */
  instanceLayout?: CopyOSDesignInstanceLayout | null | undefined
  fillVariableId: string | null
}

/** One ordered source-alpha drop shadow; stack order is bottom to top. */
export interface CopyOSDesignDropShadow {
  id: string
  type: 'drop-shadow'
  visible: boolean
  x: number
  y: number
  blur: number
  color: string
  /** Intrinsic literal color alpha, independent from shadow opacity; omitted means one. */
  colorAlpha?: number | undefined
  /** Live RGBA resource; color and colorAlpha remain authored literal fallbacks. */
  colorVariableId?: string | undefined
  opacity: number
  spread: number
  /** Live numeric resources retain these literal fallbacks; opacity is unitless from zero to one. */
  numericBindings?: Partial<Record<'x' | 'y' | 'blur' | 'spread' | 'opacity', string | undefined>> | undefined
}

/** One normal inner shadow sharing the same finite geometry and color fields as a drop shadow. */
export interface CopyOSDesignInnerShadow extends Omit<CopyOSDesignDropShadow, 'type'> {
  type: 'inner-shadow'
}

/** Ordered authored shadows; at most eight of each type occur within one stack. */
export type CopyOSDesignShadow = CopyOSDesignDropShadow | CopyOSDesignInnerShadow

/** Uniform whole-layer blur; radius uses the native effect scale, with Gaussian sigma equal to radius / 2. */
export interface CopyOSDesignLayerBlur {
  id: string
  type: 'layer-blur'
  visible: boolean
  radius: number
  /** Pixel-valued radius resource; radius remains the authored literal fallback. */
  numericBindings?: { radius?: string | undefined } | undefined
}

/** Ordered supported effects; shadow order is retained within each type and layer blur applies after composition. */
export type CopyOSDesignEffect = CopyOSDesignShadow | CopyOSDesignLayerBlur

/** Reusable local effect stack; consumers resolve its resource references in their own token mode. */
export interface CopyOSDesignEffectStyle {
  id: string
  name: string
  description?: string | undefined
  effects: CopyOSDesignEffect[]
}

/** Explicit external website or stored-layer text destination. */
export type CopyOSDesignTextHyperlink = { type: 'URL'; value: string } | { type: 'NODE'; value: string }

/**
 * Text headings and field labels; container landmarks, lists, disclosures, modal dialogs, forms and form fields; list items,
 * summaries and buttons on text or containers.
 */
export type CopyOSDesignSemanticElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'header' | 'nav' | 'main' | 'footer' | 'aside' | 'section'
  | 'article' | 'ul' | 'ol' | 'li' | 'details' | 'summary' | 'button' | 'dialog' | 'form' | 'input' | 'textarea' | 'label'

/**
 * Submitted field of an `input` or `textarea` layer. `name` is the submission key the development handoff connects; `type`
 * applies to inputs only and defaults to text.
 */
export interface CopyOSDesignSemanticField {
  name: string
  type?: 'text' | 'email' | 'tel' | 'url' | 'number' | undefined
  required?: boolean | undefined
}

/**
 * Native browser action of a button layer, addressed by stored layer identity: `show-modal` and `close` require a dialog target,
 * `toggle-popover` requires a popover target. Conversion emits HTML invoker commands; no script or backend action is generated.
 */
export interface CopyOSDesignSemanticCommand {
  type: 'show-modal' | 'close' | 'toggle-popover'
  target: string
}

/**
 * Authored HTML meaning for page conversion, independent of layer names and visual styling.
 * Headings and labels require text; landmarks, lists, disclosures, dialogs, popovers, forms and fields require containers and exclude
 * links. Links and buttons contain no other links, buttons or fields; forms contain no other forms. List children are all list items; a
 * disclosure's first child is its summary.
 */
export interface CopyOSDesignSemantics {
  element?: CopyOSDesignSemanticElement | undefined
  /** Image alternative (empty marks decorative), or link, button, dialog, landmark, form or field name; other layers reject labels. */
  label?: string | undefined
  /** Whole-layer navigation destination; NODE targets stored layers and resolves only within the converted artboard. */
  link?: CopyOSDesignTextHyperlink | undefined
  /** Disclosure starts expanded; valid only with element details, and omission starts collapsed. */
  open?: boolean | undefined
  /** Exclusive disclosure group name; valid only with element details. Opening one disclosure closes the others of its group. */
  group?: string | undefined
  /** Button action; valid only with element button. */
  command?: CopyOSDesignSemanticCommand | undefined
  /** Container shown only while opened by a button, as a light-dismiss popover; combines only with no element, nav, ul or ol. */
  popover?: boolean | undefined
  /** Submitted field; required with element input or textarea and valid only with them. */
  field?: CopyOSDesignSemanticField | undefined
  /** Stored layer of the input or textarea this label names; valid only with element label. */
  labelFor?: string | undefined
  /** Button submits its enclosing form; valid only with element button inside a form and never with a command. */
  submit?: boolean | undefined
}

/** Sparse inline formatting, inherited from the effective text layer when omitted. */
export interface CopyOSDesignTextRunStyle {
  hyperlink?: CopyOSDesignTextHyperlink | undefined
  fontFamily?: string | undefined
  fontSize?: number | undefined
  fontWeight?: number | undefined
  /** Whole feature list; omission inherits, empty uses font defaults, and value zero disables a tag. */
  fontFeatures?: CopyOSDesignFontFeature[] | undefined
  /** Whole axis list; omission inherits and an empty list selects font defaults. */
  fontVariations?: CopyOSDesignFontVariation[] | undefined
  fontStyle?: 'normal' | 'italic' | undefined
  lineHeight?: number | undefined
  letterSpacing?: number | undefined
  textDecoration?: 'none' | 'underline' | 'line-through' | undefined
  /** Literal solid color replaces the base text paints only within this range. */
  fill?: string | undefined
}

/** UTF-16 half-open inline range; sorted nonoverlapping ranges never split a surrogate pair. */
export interface CopyOSDesignTextRun {
  start: number
  end: number
  style: CopyOSDesignTextRunStyle
}

/** Instance-local root spacing and stack settings; dimensions and grid tracks remain independent. */
export interface CopyOSDesignInstanceLayout {
  layout?: 'row' | 'column' | undefined
  gap?: number | undefined
  crossGap?: number | undefined
  padding?: number | undefined
  paddingTop?: number | undefined
  paddingRight?: number | undefined
  paddingBottom?: number | undefined
  paddingLeft?: number | undefined
  alignItems?: 'start' | 'center' | 'end' | 'baseline' | undefined
  justifyContent?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly' | undefined
  layoutWrap?: 'none' | 'wrap' | undefined
  alignContent?: 'start' | 'center' | 'end' | 'between' | 'stretch' | undefined
}

/** Instance-local content, visibility or contextual nested main; omitted properties inherit from the component. */
export interface CopyOSDesignInstanceOverride {
  /** Whole-stack descendant effect ownership; empty explicitly disables inherited shadows. */
  effects?: CopyOSDesignEffect[] | undefined
  /** Linked local style; null requires an explicit detached effects array. */
  effectStyleId?: string | null | undefined
  /** Explicit contextual layer blending; omission reveals current inherited behavior. */
  blendMode?: CopyOSDesignLayerBlendMode | undefined
  path: string[]
  text?: string | undefined
  /** Whole-array formatting ownership; empty explicitly removes inherited runs. */
  textRuns?: CopyOSDesignTextRun[] | undefined
  /** Whole-list descendant feature ownership, independent of inherited text styles. */
  fontFeatures?: CopyOSDesignFontFeature[] | undefined
  /** Whole axis list; omission inherits and an empty list selects font defaults. */
  fontVariations?: CopyOSDesignFontVariation[] | undefined
  visible?: boolean | undefined
  componentId?: string | undefined
  textLayoutMetrics?: CopyOSDesignTextLayoutMetrics | undefined
  /** Contextual measured baselines remain local to this instance path. */
  textBaselineMetrics?: CopyOSDesignTextBaselineMetrics[] | undefined
  /** Independent descendant cell ownership; unset fields inherit and automatic grids ignore anchors. */
  gridCell?: CopyOSDesignInstanceGridCell | undefined
  /** Independent descendant grid configuration; each track array owns its complete axis. */
  grid?: CopyOSDesignInstanceGrid | undefined
  /** Descendant stack/grid spacing settings; incompatible flow fields remain dormant. */
  layout?: CopyOSDesignInstanceLayout | undefined
  /** Independent live spacing token ownership, separate from geometry bindings. */
  layoutBindings?: CopyOSDesignInstanceLayoutBindings | undefined
}

/** Live pixel-token references for descendant layout spacing only. */
export type CopyOSDesignInstanceLayoutBindings = {
  [K in 'gap' | 'crossGap' | 'padding' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft']?: string | undefined
}

/** Linked descendant cell fields; placement remains governed by the effective parent grid. */
export type CopyOSDesignInstanceGridCell = {
  [K in keyof CopyOSDesignGridCell]?: CopyOSDesignGridCell[K] | undefined
}

/** Explicit font identity used by a native paragraph engine, independent of document token identities. */
export interface CopyOSDesignTextMeasurementFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  sha256: string
}

/** Native paragraph backend identity; omission on legacy caches denotes browser measurement. */
export interface CopyOSDesignTextMeasurementEngine {
  name: 'skparagraph'
  version: string
  /** Increment when the host paragraph/CSS mapping changes independently of the engine release. */
  layoutVersion?: number | undefined
  fonts: CopyOSDesignTextMeasurementFont[]
}

/** First baseline for one exact input signature and measurement engine. */
export interface CopyOSDesignTextBaselineMetrics {
  signature: string
  baseline: number
  engine?: CopyOSDesignTextMeasurementEngine | undefined
}

/** Measured text dimensions; stale input signatures leave authored dimensions unchanged. */
export interface CopyOSDesignTextLayoutMetrics {
  signature: string
  width: number
  height: number
  engine?: CopyOSDesignTextMeasurementEngine | undefined
  /** Exact fitting lines, including paragraph gaps, for a matching constrained text layout. */
  overflow?: { signature: string; lines: number; height: number } | undefined
}

/** Independent alpha ownership; number variables provide percentages clamped to 0–100 before conversion to alpha. */
export type CopyOSDesignColorAlphaSource = { kind: 'literal' } | { kind: 'number'; variableId: string }

/** A named color token shared by nodes within a design. */
export interface CopyOSDesignVariable {
  /** Optional source in the same collection; otherwise use the literal value. */
  aliasId?: string | null | undefined
  id: string
  name: string
  value: string
  alpha?: number | undefined
  /** Null/omitted retains legacy whole-color aliases; literal owns alpha without detaching the RGB alias. */
  alphaSource?: CopyOSDesignColorAlphaSource | null | undefined
}

/** A named set of overrides for existing shared resource identities. */
export interface CopyOSDesignTokenMode {
  id: string
  name: string
  sourceKey?: string | undefined
  variables: {
    id: string
    value?: string | undefined
    alpha?: number | undefined
    alphaSource?: CopyOSDesignColorAlphaSource | null | undefined
    aliasId?: string | null | undefined
  }[]
  numberVariables: {
    id:string
    value?:number|undefined
    aliasId?:string|null|undefined
    expression?:CopyOSDesignNumberExpression|null|undefined
  }[]
}

/** Solid editor-only page backing; shared color alpha multiplies its authored opacity. */
export interface CopyOSDesignCanvasBackground {
  color: string
  opacity: number
  visible: boolean
  variableId?: string | null | undefined
}

/** Portable Page Designer file with optimistic revision checks. */
export interface CopyOSDesignDocument {
  schema: 'copyos.design'
  version: 1
  id: string
  title: string
  revision: number
  nodes: CopyOSDesignNode[]
  variables: CopyOSDesignVariable[]
  numberVariables?: CopyOSDesignNumberVariable[] | undefined
  tokenModes?: CopyOSDesignTokenMode[] | undefined
  activeTokenModeId?: string | null | undefined
  textStyles?: CopyOSDesignTextStyle[] | undefined
  effectStyles?: CopyOSDesignEffectStyle[] | undefined
  canvasBackground?: CopyOSDesignCanvasBackground | undefined
  pages?: {
    id: string
    name: string
    tokenModeId?: string | null | undefined
    canvasBackground?: CopyOSDesignCanvasBackground | undefined
  }[] | undefined
  source?: { format: 'fig'; fileName: string; warnings: string[]; importedAt: string } | undefined
  createdAt: string
  updatedAt: string
}

/** Internal immutable layer clipboard with distinct selected-copy and referenced-library roles. */
export interface CopyOSDesignClipboardSnapshot {
  schema: 'copyos.design-clipboard'
  version: 1
  sourceWorkspaceId: string
  sourceDesignId: string
  rootIds: string[]
  rootModes: { id: string; tokenModeId: string | null }[]
  rootSizing: { id: string; widthSizing: 'fixed' | 'hug' | 'fill'; heightSizing: 'fixed' | 'hug' | 'fill' }[]
  selectedNodes: CopyOSDesignNode[]
  library: CopyOSDesignDocument
}

/** Placement and source identity for one atomic layer import; omitted parent means a canvas root. */
export interface CopyOSDesignClipboardImportOptions {
  destinationWorkspaceId: string
  pageId?: string | undefined
  parentId?: string | null | undefined
  offset?: { x: number; y: number } | undefined
  position?: { x: number; y: number } | undefined
  replaceIds?: readonly string[] | undefined
}

/** Imported selected roots are separate from reusable masters and the dedicated dependency page. */
export interface CopyOSDesignClipboardImportResult {
  /** Machine-readable count for localized paste disclosure; omitted when no internal links were removed. */
  removedNodeLinks?: number | undefined
  /** Explicit disclosures when uncopied external node destinations cannot survive cross-document paste. */
  notices?: string[] | undefined
  document: CopyOSDesignDocument
  selectedIds: string[]
  dependencyIds: string[]
  dependencyPageId: string | null
  activePageId: string | null
}

/** List Page Designer files in one project. */
export interface CopyOSDesignListRequest {
  readonly workspaceId: string
}
/** Read one saved native design from a registered project. */
export interface CopyOSDesignReadRequest {
  readonly workspaceId: string
  readonly designId: string
}
/** Current project design roster. */
export interface CopyOSDesignListValue {
  readonly designs: readonly CopyOSDesignDocument[]
}
/** Create an empty designer document. */
export interface CopyOSDesignCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly canvasBackground?: CopyOSDesignCanvasBackground | undefined
}
/** Save a document only when its read revision still matches. */
export interface CopyOSDesignSaveRequest {
  readonly workspaceId: string
  readonly document: CopyOSDesignDocument
}

/** Review a native artboard at an exact saved revision before building its page. */
export interface CopyOSDesignPagePreviewRequest {
  readonly workspaceId: string
  readonly designId: string
  readonly nodeId: string
  readonly expectedRevision: number
  readonly title?: string | undefined
}
/** Commit exactly the authoritative compilation identified by a reviewed preview hash. */
export interface CopyOSDesignPageBuildRequest extends CopyOSDesignPagePreviewRequest {
  readonly previewHash: string
}
/** Durable record linking a built page to its source artboard, preserved original scene and recovery snapshot. */
export interface CopyOSPageConversion {
  readonly version: 1
  readonly compilerVersion: 1
  readonly sourceDesignId: string
  readonly sourceFrameId: string
  readonly sourceRevision: number
  readonly linkedFrameId: string
  readonly snapshotPath: string
  /** Exact HTML generated for sourceRevision and the base for later design updates; older conversions recompile snapshotPath instead. */
  readonly generatedPath?: string | undefined
  readonly previewHash: string
  readonly mapping: readonly DesignPageElementMapping[]
}
/** Reviewed editable HTML, or an already-built page whose Builder edits must be preserved. */
export type CopyOSDesignPagePreview =
  | { readonly state: 'ready'; readonly designId: string; readonly nodeId: string; readonly sourceRevision: number; readonly previewHash: string; readonly html: string; readonly width: number; readonly height: number; readonly mapping: readonly DesignPageElementMapping[]; readonly warnings: readonly DesignPageCompilationWarning[]; readonly fonts: readonly string[]; readonly title: string }
  | { readonly state: 'existing'; readonly designId: string; readonly nodeId: string; readonly designRevision: number; readonly pageId: string; readonly linkedFrameId: string | null; readonly title: string }
/** Review the converted page of a native artboard against that artboard's current saved revision. */
export interface CopyOSDesignPageUpdateRequest {
  readonly workspaceId: string
  readonly designId: string
  readonly nodeId: string
  readonly expectedRevision: number
  /** Per-conflict choices previewed as `selectedHtml`; unlisted conflicts keep the page version in that preview. */
  readonly resolutions?: Readonly<Record<string, 'keep-page' | 'use-design'>> | undefined
}
/** Apply exactly the reviewed merge; each conflict needs a resolutions entry or the default resolution; resolutions name only conflicts. */
export interface CopyOSDesignPageUpdateApplyRequest extends CopyOSDesignPageUpdateRequest {
  readonly expectedPageRevision: number
  readonly previewHash: string
  readonly resolution?: 'keep-page' | 'use-design' | undefined
}
/** One merged element; key is a design element identity or `style:<n>` for a top-level stylesheet. */
export interface CopyOSDesignPageUpdateElement {
  readonly key: string
  /** Source layer, or null for stylesheets and elements absent from both mappings. */
  readonly nodeId: string | null
  readonly name: string
}
/** Converted page identity and the design revision a review compared. */
export interface CopyOSDesignPageUpdateIdentity {
  readonly designId: string
  readonly nodeId: string
  readonly pageId: string
  readonly pageRevision: number
  readonly sourceRevision: number
}
/** Classified merge of the current design into an edited page; HTML previews each conflict policy. */
export interface CopyOSDesignPageUpdatePlan extends CopyOSDesignPageUpdateIdentity {
  readonly state: 'update'
  readonly previousSourceRevision: number
  readonly previewHash: string
  readonly width: number
  readonly height: number
  readonly designChanges: readonly CopyOSDesignPageUpdateElement[]
  readonly pageEdits: readonly CopyOSDesignPageUpdateElement[]
  readonly conflicts: readonly CopyOSDesignPageUpdateElement[]
  /** Design-added elements whose parent keeps its page version under that policy, so they have no placement. */
  readonly unplaced: { readonly 'keep-page': readonly CopyOSDesignPageUpdateElement[]; readonly 'use-design': readonly CopyOSDesignPageUpdateElement[] }
  readonly html: { readonly 'keep-page': string; readonly 'use-design': string }
  /** Merge using the request's per-conflict resolutions, present only when they were supplied. */
  readonly selectedHtml?: string | undefined
  readonly warnings: readonly DesignPageCompilationWarning[]
}
/** A page already matching its design needs no update. */
export type CopyOSDesignPageUpdateReview = (CopyOSDesignPageUpdateIdentity & { readonly state: 'current' }) | CopyOSDesignPageUpdatePlan
/** Saved merged page; the design document is unchanged. */
export interface CopyOSDesignPageUpdateResult {
  readonly page: CopyOSPageDocument
  readonly designChanges: number
  readonly pageEdits: number
  readonly conflicts: number
}
/** Committed page and design; a missing existing linked view is never silently recreated. */
export interface CopyOSDesignPageBuildResult {
  readonly state: 'created' | 'existing'
  readonly design: CopyOSDesignDocument
  readonly page: CopyOSPageDocument
  readonly linkedFrameId: string | null
}

/** Copy source layers into a revision-checked target in registered CopyOS workspaces. */
export interface CopyOSDesignCopyLayersRequest {
  /** Registered target workspace; omitted sourceWorkspaceId uses this workspace too. */
  readonly workspaceId: string
  readonly sourceWorkspaceId?: string | undefined
  readonly sourceDesignId: string
  readonly targetDesignId: string
  readonly targetRevision: number
  readonly rootIds: readonly string[]
  /** Existing target page; omission uses the destination's implicit or first page. */
  readonly pageId?: string | undefined
  /** Optional selected-bounds origin; supply both finite coordinates or neither. */
  readonly x?: number | undefined
  readonly y?: number | undefined
}

/** A single saved import, with selected roots separate from imported library masters. */
export interface CopyOSDesignCopyLayersValue {
  /** Number of uncopied internal text-link ranges removed during transfer, present only when positive. */
  readonly removedNodeLinks?: number | undefined
  /** Bounded-category disclosures for native references removed during cross-document copying. */
  readonly notices?: readonly string[] | undefined
  readonly id: string
  readonly revision: number
  readonly selectedIds: readonly string[]
  readonly dependencyIds: readonly string[]
  readonly dependencyPageId: string | null
  readonly activePageId: string | null
}

/** Editable clipboard scene including reusable dependencies and authoritative selected native roots. */
export interface FigClipboardDecodeResult {
  document: CopyOSDesignDocument
  selectedIds: string[]
}

/** Decode clipboard bytes for a registered project without saving a new document. */
export interface CopyOSDesignClipboardDecodeRequest {
  readonly workspaceId: string
  readonly dataBase64: string
}

/** Import a local Figma archive into an independent native design. */
export interface CopyOSDesignImportRequest {
  readonly workspaceId: string
  readonly fileName: string
  readonly fileBase64: string
}
/** Workflow choices shown when a project starts a new session. */
export type CopyOSWorkflowId =
  | 'quick-chat'
  | 'docs'
  | 'copywriter'
  | 'landing-page-builder'
  | 'canvas'
  | 'website-clone'
  | 'existing-page'
  | 'strategy'
  | 'cro-analyst'
  | 'ad-scriptwriter'
  | 'creative-strategist'
  | 'researcher'

/** Portable project manifest stored at the root of a user-owned folder. */
export interface CopyOSProjectDocument {
  readonly schema: 'copyos.project'
  readonly version: typeof COPYOS_PROJECT_VERSION
  readonly projectId: string
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}
/** Project projection returned to the browser. */
export interface CopyOSProjectView extends CopyOSProjectDocument {
  readonly workspaceId: string
  readonly path: string
}

/** Create or adopt one CopyOS project folder. */
export interface CopyOSProjectCreateRequest {
  readonly path: string
  readonly name?: string
}

/** Replace a Workspace registration with a different project folder; files and session logs stay in place. */
export interface CopyOSProjectChangeFolderRequest {
  readonly workspaceId: string
  readonly path: string
}

/** Complete current project roster. */
export interface CopyOSProjectListValue {
  readonly projects: readonly CopyOSProjectView[]
}

/** Current project-level visual system schema version. */
export const COPYOS_STYLE_GUIDE_VERSION = 1 as const

/** Custom properties belonging to one explicit selector/conditional context. */
export interface CopyOSStyleGuideTokenContext {
  readonly key: string
  readonly name: string
  readonly selectors: readonly string[]
  readonly conditions: readonly string[]
  readonly rootFontSize?: string | undefined
  readonly customProperties: Readonly<Record<string, string>>
}

/** Portable design tokens extracted from imported CSS. */
export interface CopyOSStyleGuideTokens {
  readonly colors: readonly string[]
  readonly fonts: readonly string[]
  readonly fontSizes: readonly string[]
  readonly fontWeights: readonly string[]
  readonly lineHeights: readonly string[]
  readonly letterSpacings: readonly string[]
  readonly spacing: readonly string[]
  readonly radii: readonly string[]
  readonly shadows: readonly string[]
  readonly breakpoints: readonly string[]
  readonly contentWidths: readonly string[]
  readonly durations: readonly string[]
  readonly easings: readonly string[]
  readonly rootFontSize?: string | undefined
  readonly customProperties: Readonly<Record<string, string>>
  readonly customPropertyContexts?: readonly CopyOSStyleGuideTokenContext[] | undefined
  readonly customPropertyWarnings?: readonly string[] | undefined
}

/** One project-wide style guide shared by every page and agent session. */
export interface CopyOSStyleGuideDocument {
  readonly schema: 'copyos.style-guide'
  readonly version: typeof COPYOS_STYLE_GUIDE_VERSION
  readonly name: string
  readonly sourceType: 'css' | 'file' | 'website'
  readonly sourceLabel: string
  readonly sourceUrl?: string | undefined
  readonly css: string
  readonly tokens: CopyOSStyleGuideTokens
  readonly createdAt: string
  readonly updatedAt: string
}

/** Read the current project style guide, when one has been created. */
export interface CopyOSStyleGuideGetRequest {
  readonly workspaceId: string
}

/** Optional current project style guide. */
export interface CopyOSStyleGuideGetValue {
  readonly styleGuide?: CopyOSStyleGuideDocument | undefined
}

/** Create or replace the project style guide from user-owned CSS. */
export interface CopyOSStyleGuideSaveRequest {
  readonly workspaceId: string
  readonly name: string
  readonly sourceType: 'css' | 'file' | 'website'
  readonly sourceLabel: string
  readonly sourceUrl?: string
  readonly css: string
}

/** Current portable marketing-asset schema version. */
export const COPYOS_ASSET_VERSION = 1 as const

/** Asset families supported by the first CopyOS authoring workspace. */
export type CopyOSAssetKind = 'brief' | 'copy'

/** Shared durable metadata for every portable CopyOS asset. */
export interface CopyOSAssetBase {
  readonly schema: 'copyos.asset'
  readonly version: typeof COPYOS_ASSET_VERSION
  readonly id: string
  readonly title: string
  readonly status: 'draft'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Structured creative brief stored as readable Markdown with YAML frontmatter. */
export interface CopyOSBriefDocument extends CopyOSAssetBase {
  readonly kind: 'brief'
  readonly objective: string
  readonly audience: string
  readonly offer: string
  readonly proof: string
  readonly cta: string
}

/** One independently selectable body inside a copy asset. */
export interface CopyOSCopyVariant {
  readonly id: string
  readonly label: string
  readonly body: string
  readonly createdAt: string
}

/** Copy asset whose alternatives remain together in one portable file. */
export interface CopyOSCopyDocument extends CopyOSAssetBase {
  readonly kind: 'copy'
  readonly briefId?: string | undefined
  readonly selectedVariantId: string
  readonly variants: readonly CopyOSCopyVariant[]
}

/** Portable asset returned by the CopyOS project Remote. */
export type CopyOSAssetDocument = CopyOSBriefDocument | CopyOSCopyDocument

/** Read one or both asset families from a project Workspace. */
export interface CopyOSAssetListRequest {
  readonly workspaceId: string
  readonly kind?: CopyOSAssetKind
}

/** A project asset file that is not a valid CopyOS asset, skipped by listing. */
export interface CopyOSInvalidAssetFile {
  /** Path relative to the project root. */
  readonly path: string
  /** Why the file was rejected, such as missing YAML frontmatter or a failed field check. */
  readonly error: string
}

/** Complete current portable asset roster for one project. */
export interface CopyOSAssetListValue {
  readonly assets: readonly CopyOSAssetDocument[]
  /** Files in the asset directories that could not be read as assets; the valid assets are listed without them. */
  readonly invalid: readonly CopyOSInvalidAssetFile[]
}

/** Create a structured brief inside one project. */
export interface CopyOSBriefCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly objective: string
  readonly audience: string
  readonly offer: string
  readonly proof: string
  readonly cta: string
}

/** Create a copy asset with its first selected variation. */
export interface CopyOSCopyCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly label: string
  readonly body: string
  readonly briefId?: string
}

/** Add an alternative body to an existing copy asset and select it. */
export interface CopyOSCopyVariantCreateRequest {
  readonly workspaceId: string
  readonly assetId: string
  readonly label: string
  readonly body: string
}

/** Current on-disk landing-page schema version. */
export const COPYOS_PAGE_VERSION = 1 as const

/** Built-in coded section families available in the first page builder. */
export type CopyOSPageSectionTemplateId =
  | 'hero-centered'
  | 'hero-split'
  | 'hero-editorial'
  | 'proof-bar'
  | 'proof-metrics'
  | 'benefit-grid'
  | 'benefit-steps'
  | 'testimonial'
  | 'testimonial-pair'
  | 'comparison'
  | 'pricing'
  | 'faq'
  | 'cta-banner'
  | 'cta-proof'
  | 'custom-html'

/** One independently selectable HTML variation for a page section. */
export interface CopyOSPageSectionVariant {
  readonly id: string
  readonly label: string
  readonly html: string
  readonly createdAt: string
}

/** One reorderable coded section inside a landing page. */
export interface CopyOSPageSection {
  readonly id: string
  readonly title: string
  readonly templateId: CopyOSPageSectionTemplateId
  readonly selectedVariantId: string
  readonly variants: readonly CopyOSPageSectionVariant[]
}

/** Durable review note pinned to one element in a selected section variation. */
export interface CopyOSPageComment {
  /** Stable target within section/variation; null is unresolved, omission is a legacy positional note. */
  readonly elementId?: string | null | undefined
  readonly id: string
  readonly sectionId: string
  readonly variantId: string
  readonly elementIndex: number
  readonly elementLabel: string
  readonly body: string
  readonly status: 'open' | 'resolved'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Portable landing page stored as structured JSON in the project. */
export interface CopyOSPageDocument {
  /** Monotonic safe integer; missing legacy revisions are read as zero. */
  readonly revision?: number | undefined
  readonly schema: 'copyos.page'
  readonly version: typeof COPYOS_PAGE_VERSION
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly status: 'draft'
  readonly sections: readonly CopyOSPageSection[]
  /** Optional for backwards compatibility with pages created before review notes existed. */
  readonly comments?: readonly CopyOSPageComment[] | undefined
  /** Original scene and compiled element mapping for an explicitly built native artboard. */
  readonly conversion?: CopyOSPageConversion | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

/** Add a review note to a precise element in one section variation. */
export interface CopyOSPageCommentCreateRequest {
  /** Existing stable element id. Omission resolves the legacy style index against the read page. */
  readonly elementId?: string | undefined
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly variantId: string
  readonly elementIndex: number
  readonly elementLabel: string
  readonly body: string
}

/** Resolve or reopen one durable page review note. */
export interface CopyOSPageCommentStatusRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly commentId: string
  readonly status: 'open' | 'resolved'
}

/** Read every landing page in one project. */
export interface CopyOSPageListRequest {
  readonly workspaceId: string
}

/** Complete landing-page roster for one project. */
export interface CopyOSPageListValue {
  readonly pages: readonly CopyOSPageDocument[]
}

/** Create an empty landing page. */
export interface CopyOSPageCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly slug?: string
}

/** Add a coded section with its first selected copy variation. */
export interface CopyOSPageSectionCreateRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly title: string
  readonly templateId: CopyOSPageSectionTemplateId
  readonly label: string
  readonly html: string
  /** Optional zero-based insertion point; omitted values append. */
  readonly toIndex?: number
}

/** Add and select another HTML variation for one page section. */
export interface CopyOSPageSectionVariantCreateRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly label: string
  readonly html: string
}

/** Choose which stored variation a section uses. */
export interface CopyOSPageSectionVariantSelectRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly variantId: string
}

/** Persist direct canvas edits to one existing HTML variation. */
export interface CopyOSPageSectionVariantUpdateRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly variantId: string
  readonly html: string
}

/** Replace 1–100 unique section/variation HTML targets atomically at one required saved revision. */
export interface CopyOSPageVariantsUpdateRequest {
  readonly workspaceId: string
  readonly pageId: string
  readonly expectedRevision: number
  readonly changes: readonly { readonly sectionId: string; readonly variantId: string; readonly html: string }[]
}

/** Rename one landing-page section without changing its content. */
export interface CopyOSPageSectionRenameRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly title: string
}

/** Delete one landing-page section. */
export interface CopyOSPageSectionDeleteRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
}

/** Move a section to a zero-based destination inside its page. */
export interface CopyOSPageSectionMoveRequest {
  /** Compare against the saved revision; omission preserves unguarded legacy mutation behavior. */
  readonly expectedRevision?: number | undefined
  readonly workspaceId: string
  readonly pageId: string
  readonly sectionId: string
  readonly toIndex: number
}

/** Export the selected version of every section as one standalone HTML file. */
export interface CopyOSPageExportRequest {
  readonly workspaceId: string
  readonly pageId: string
  readonly format?: 'html' | 'copy' | 'json' | 'shopify' | 'vercel'
}

/** Host path created by a page export. */
export interface CopyOSPageExportValue {
  readonly path: string
}

/** Current on-disk brand and research schema version. */
export const COPYOS_KNOWLEDGE_VERSION = 1 as const

/** Durable strategic knowledge families shared by CopyOS workflows. */
export type CopyOSKnowledgeKind = 'brand' | 'research'

/** Shared durable metadata for brand and research records. */
export interface CopyOSKnowledgeBase {
  readonly schema: 'copyos.knowledge'
  readonly version: typeof COPYOS_KNOWLEDGE_VERSION
  readonly id: string
  readonly title: string
  readonly status: 'active'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Reusable brand positioning, voice, and claim guardrails. */
export interface CopyOSBrandDocument extends CopyOSKnowledgeBase {
  readonly kind: 'brand'
  readonly positioning: string
  readonly audience: string
  readonly voice: string
  readonly differentiators: string
  readonly guardrails: string
}

/** Evidence-bearing research note with its source kept explicit. */
export interface CopyOSResearchDocument extends CopyOSKnowledgeBase {
  readonly kind: 'research'
  readonly topic: string
  readonly source: string
  readonly evidence: string
  readonly insight: string
  readonly tags: readonly string[]
}

/** Any portable strategic knowledge record. */
export type CopyOSKnowledgeDocument = CopyOSBrandDocument | CopyOSResearchDocument

/** List one or both strategic knowledge families. */
export interface CopyOSKnowledgeListRequest {
  readonly workspaceId: string
  readonly kind?: CopyOSKnowledgeKind
}

/** Complete strategic knowledge roster for one project. */
export interface CopyOSKnowledgeListValue {
  readonly records: readonly CopyOSKnowledgeDocument[]
}

/** Create a reusable brand profile. */
export interface CopyOSBrandCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly positioning: string
  readonly audience: string
  readonly voice: string
  readonly differentiators: string
  readonly guardrails: string
}

/** Create a sourced research note. */
export interface CopyOSResearchCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly topic: string
  readonly source: string
  readonly evidence: string
  readonly insight: string
  readonly tags: readonly string[]
}

/** Current on-disk ad-script schema version. */
export const COPYOS_SCRIPT_VERSION = 1 as const

/** Common paid and organic video channels supported by CopyOS scripts. */
export type CopyOSScriptChannel = 'meta' | 'tiktok' | 'youtube' | 'linkedin' | 'other'

/** Video frame choices kept explicit for visual direction. */
export type CopyOSScriptAspectRatio = '9:16' | '1:1' | '16:9' | 'other'

/** One strategically distinct, independently selectable ad-script variation. */
export interface CopyOSScriptVariant {
  readonly id: string
  readonly label: string
  readonly angle: string
  readonly hook: string
  readonly beats: string
  readonly visualDirection: string
  readonly spokenCopy: string
  readonly onScreenText: string
  readonly proof: string
  readonly cta: string
  readonly createdAt: string
}

/** Portable ad script with channel constraints and grouped variations. */
export interface CopyOSScriptDocument {
  readonly schema: 'copyos.script'
  readonly version: typeof COPYOS_SCRIPT_VERSION
  readonly id: string
  readonly title: string
  readonly status: 'draft'
  readonly channel: CopyOSScriptChannel
  readonly durationSeconds: number
  readonly aspectRatio: CopyOSScriptAspectRatio
  readonly briefId?: string | undefined
  readonly selectedVariantId: string
  readonly variants: readonly CopyOSScriptVariant[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Read every ad script in one project. */
export interface CopyOSScriptListRequest {
  readonly workspaceId: string
}

/** Complete ad-script roster for one project. */
export interface CopyOSScriptListValue {
  readonly scripts: readonly CopyOSScriptDocument[]
}

/** Create an ad script with its first selected variation. */
export interface CopyOSScriptCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly channel: CopyOSScriptChannel
  readonly durationSeconds: number
  readonly aspectRatio: CopyOSScriptAspectRatio
  readonly briefId?: string
  readonly label: string
  readonly angle: string
  readonly hook: string
  readonly beats: string
  readonly visualDirection: string
  readonly spokenCopy: string
  readonly onScreenText: string
  readonly proof: string
  readonly cta: string
}

/** Add and select another complete variation on an ad script. */
export interface CopyOSScriptVariantCreateRequest {
  readonly workspaceId: string
  readonly scriptId: string
  readonly label: string
  readonly angle: string
  readonly hook: string
  readonly beats: string
  readonly visualDirection: string
  readonly spokenCopy: string
  readonly onScreenText: string
  readonly proof: string
  readonly cta: string
}

/** Current on-disk CRO experiment schema version. */
export const COPYOS_EXPERIMENT_VERSION = 1 as const

/** Project artifact families that a CRO experiment can evaluate. */
export type CopyOSExperimentArtifactKind = 'page' | 'copy' | 'script' | 'other'

/** Lifecycle states for one measurable experiment. */
export type CopyOSExperimentStatus = 'draft' | 'running' | 'completed'

/** Human-reviewed final result without an inferred significance claim. */
export interface CopyOSExperimentResult {
  readonly controlVisitors: number
  readonly controlConversions: number
  readonly variantVisitors: number
  readonly variantConversions: number
  readonly outcome: 'control' | 'variant' | 'inconclusive'
  readonly analysis: string
  readonly recordedAt: string
}

/** Portable CRO experiment linking a hypothesis to a project artifact and measurable result. */
export interface CopyOSExperimentDocument {
  readonly schema: 'copyos.experiment'
  readonly version: typeof COPYOS_EXPERIMENT_VERSION
  readonly id: string
  readonly title: string
  readonly status: CopyOSExperimentStatus
  readonly artifactKind: CopyOSExperimentArtifactKind
  readonly artifactId?: string | undefined
  readonly hypothesis: string
  readonly primaryMetric: string
  readonly audience: string
  readonly controlLabel: string
  readonly controlDescription: string
  readonly variantLabel: string
  readonly variantDescription: string
  readonly result?: CopyOSExperimentResult | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

/** Read every CRO experiment in one project. */
export interface CopyOSExperimentListRequest {
  readonly workspaceId: string
}

/** Complete CRO experiment roster for one project. */
export interface CopyOSExperimentListValue {
  readonly experiments: readonly CopyOSExperimentDocument[]
}

/** Create a draft CRO experiment with explicit control and treatment definitions. */
export interface CopyOSExperimentCreateRequest {
  readonly workspaceId: string
  readonly title: string
  readonly artifactKind: CopyOSExperimentArtifactKind
  readonly artifactId?: string
  readonly hypothesis: string
  readonly primaryMetric: string
  readonly audience: string
  readonly controlLabel: string
  readonly controlDescription: string
  readonly variantLabel: string
  readonly variantDescription: string
}

/** Start a draft experiment. */
export interface CopyOSExperimentStartRequest {
  readonly workspaceId: string
  readonly experimentId: string
}

/** Complete a running experiment with observed sample counts and a reviewed outcome. */
export interface CopyOSExperimentResultRequest {
  readonly workspaceId: string
  readonly experimentId: string
  readonly controlVisitors: number
  readonly controlConversions: number
  readonly variantVisitors: number
  readonly variantConversions: number
  readonly outcome: 'control' | 'variant' | 'inconclusive'
  readonly analysis: string
}

/** Current on-disk session-to-artifact relationship schema version. */
export const COPYOS_SESSION_LINK_VERSION = 1 as const

/** Portable artifact families that one CopyOS Session can create or change. */
export type CopyOSLinkedArtifactKind =
  | 'brand'
  | 'research'
  | 'brief'
  | 'copy'
  | 'page'
  | 'script'
  | 'experiment'

/** One artifact touched by a model tool during a CopyOS Session. */
export interface CopyOSSessionArtifactLink {
  readonly kind: CopyOSLinkedArtifactKind
  readonly id: string
  readonly title: string
  readonly linkedAt: string
}

/** Portable relationship index for one Harness Session. */
export interface CopyOSSessionLinkDocument {
  readonly schema: 'copyos.session-links'
  readonly version: typeof COPYOS_SESSION_LINK_VERSION
  readonly sessionId: string
  readonly artifacts: readonly CopyOSSessionArtifactLink[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Read every durable Session relationship for one project. */
export interface CopyOSSessionLinkListRequest {
  readonly workspaceId: string
}

/** Complete Session relationship roster for one project. */
export interface CopyOSSessionLinkListValue {
  readonly sessions: readonly CopyOSSessionLinkDocument[]
}

/** Filesystem layer that owns a reusable CopyOS skill. */
export type CopyOSSkillScope = 'project' | 'global'

/** Reusable Harness skill exposed through the CopyOS project interface. */
export interface CopyOSSkillDocument {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
  readonly scope: CopyOSSkillScope
  readonly enabled: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly workflows: readonly CopyOSWorkflowId[]
  readonly path: string
}

/** Read project and universal CopyOS skills visible while working in one project. */
export interface CopyOSSkillListRequest {
  readonly workspaceId: string
}

/** Complete editable skill roster for one project. */
export interface CopyOSSkillListValue {
  readonly skills: readonly CopyOSSkillDocument[]
}

/** Create or replace one project or universal CopyOS skill. */
export interface CopyOSSkillSaveRequest {
  readonly workspaceId: string
  readonly scope: CopyOSSkillScope
  readonly originalName?: string
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
  readonly enabled: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly workflows: readonly CopyOSWorkflowId[]
}

/** Import one complete Markdown skill into a project or universal CopyOS skill root. */
export interface CopyOSSkillImportRequest {
  readonly workspaceId: string
  readonly scope: CopyOSSkillScope
  readonly markdown: string
}

/** Enable or disable one skill without deleting its files or resources. */
export interface CopyOSSkillEnabledRequest {
  readonly workspaceId: string
  readonly scope: CopyOSSkillScope
  readonly name: string
  readonly enabled: boolean
}

/** A portable, independent copy of one reusable page section. */
export interface CopyOSReusableSectionDocument {
  readonly schema: 'copyos.reusable-section'
  readonly version: 1
  readonly id: string
  readonly title: string
  readonly category: string
  readonly description: string
  readonly html: string
  readonly createdAt: string
}

/** Fields saved from the selected section into its workspace library. */
export interface CopyOSReusableSectionSaveRequest {
  readonly workspaceId: string
  readonly title: string
  readonly category: string
  readonly description: string
  readonly html: string
}

/** Move an existing shared section without changing its identity or content. */
export interface CopyOSReusableSectionMoveRequest {
  readonly workspaceId: string
  readonly sectionId: string
  readonly category: string
}

/** Remove a shared library entry, leaving inserted page copies untouched. */
export interface CopyOSReusableSectionDeleteRequest {
  readonly workspaceId: string
  readonly sectionId: string
  readonly confirmDelete: boolean
}

/** Saved sections available to every page in the workspace. */
export interface CopyOSReusableSectionListValue {
  readonly sections: readonly CopyOSReusableSectionDocument[]
}

/** One document tab; blocks, comments and history retain document-wide identities. */
export interface CopyOSDocTab { readonly id: string; readonly title: string }
/** Add an outline in a new tab without changing existing sections. */
export interface CopyOSDocTabCreateRequest extends CopyOSDocReadRequest {
  readonly title: string
  readonly sections: readonly string[]
  readonly epoch: number
}
/** Suite document block; Markdown content is merged as a Y.Text on the server. */
export interface CopyOSDocBlock {
  readonly tabId?: string
  readonly id: string
  readonly label: string
  readonly content: string
  readonly state: 'ready' | 'pending' | 'writing' | 'paused' | 'failed'
}
/** Portable document projection; sync contains the complete Yjs update as base64. */
/** One assistant-proposed passage edit; accepting it validates its live text anchor. */
export interface CopyOSDocSuggestion {
  readonly anchor: CopyOSDocCommentAnchor
  readonly anchorOrigin?: CopyOSDocCommentTarget
  readonly threadId?: string
  readonly id: string
  readonly blockId: string
  readonly before: string
  readonly after: string
  readonly note: string
  readonly state: 'pending' | 'accepted' | 'rejected'
  readonly createdAt: string
  readonly reviewedAt?: string
}
/** Propose one passage change without changing the document. */
export interface CopyOSDocSuggestRequest extends CopyOSDocReadRequest {
  readonly threadId?: string
  readonly commentRequestId?: string
  readonly blockId: string
  readonly before: string
  readonly after: string
  readonly note: string
  readonly start?: number
}
/** Accept an anchored proposal, optionally editing the replacement, or reject it. */
export interface CopyOSDocReviewRequest extends CopyOSDocReadRequest {
  readonly suggestionId: string
  readonly decision: 'accept' | 'reject'
  readonly replacement?: string
}
/** Portable document projection, including server-derived access and pending assistant edits. */
export interface CopyOSDocDocument {
  readonly tabs?: readonly CopyOSDocTab[]
  readonly assets?: readonly CopyOSDocAsset[]
  readonly trashedAt?: string
  readonly revision: number
  readonly access?: 'owner' | 'viewer' | 'commenter' | 'editor'
  readonly comments?: readonly CopyOSDocCommentThread[]
  readonly suggestions?: readonly CopyOSDocSuggestion[]
  readonly sessionId?: string
  readonly id: string
  readonly title: string
  readonly blocks: readonly CopyOSDocBlock[]
  readonly sync: string
  readonly epoch: number
  readonly stopped: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
/** List documents inside one registered workspace. */
export interface CopyOSDocListRequest { readonly workspaceId: string; readonly trashed?: boolean }
/** Full document list in most-recently-edited order. */
export interface CopyOSDocListValue { readonly documents: readonly CopyOSDocDocument[] }
/** Create a blank document or a complete outline before drafting sections. */
export interface CopyOSDocCreateRequest {
  readonly sessionId?: string
  readonly workspaceId: string
  readonly title: string
  readonly sections: readonly string[]
}
/** Read a document; link tokens restrict access to their granted role. */
export interface CopyOSDocReadRequest {
  readonly workspaceId: string
  readonly docId: string
  readonly token?: string
}
/** Copy saved body text to an independent, private document with fresh block identities. */
export interface CopyOSDocDuplicateRequest extends CopyOSDocReadRequest { readonly title: string }
/** Move a document to recoverable trash, or restore it without losing its history. */
export interface CopyOSDocTrashRequest extends CopyOSDocReadRequest { readonly trashed: boolean }
/** Public metadata for an immutable document-scoped image or file. */
export interface CopyOSDocAsset {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly mime: string
  readonly image: boolean
}
/** Import a UTF-8 Markdown or plain-text file as a new private document. */
export interface CopyOSDocImportRequest { readonly workspaceId: string; readonly name: string; readonly dataBase64: string }
/** Upload one attachment with editor authority. */
export interface CopyOSDocAssetPutRequest extends CopyOSDocReadRequest { readonly name: string; readonly dataBase64: string }
/** Read one attachment from an authorized document manifest. */
export interface CopyOSDocAssetReadRequest extends CopyOSDocReadRequest { readonly assetId: string }
/** Verified bytes and metadata returned only after document permission checks. */
export interface CopyOSDocAssetReadValue { readonly asset: CopyOSDocAsset; readonly dataBase64: string }
/** An ephemeral cursor anchored to one block's shared text. */
export interface CopyOSDocPresenceCursor {
  readonly blockId: string
  readonly anchor: CopyOSDocCommentAnchor
}
/** One open pane's current tab and optional text cursor; never part of saved content. */
export interface CopyOSDocPresenceState {
  readonly tabId: string
  readonly cursor?: CopyOSDocPresenceCursor
}
/** Announce a pane or leave its room with null state, using current document access. */
export interface CopyOSDocPresenceRequest extends CopyOSDocReadRequest {
  readonly peerId: string
  readonly state: CopyOSDocPresenceState | null
}
/** A currently authorized pane; identity is a pane ID, not a verified person's profile. */
export interface CopyOSDocPresencePeer extends CopyOSDocPresenceState {
  readonly id: string
  readonly role: 'owner' | 'viewer' | 'commenter' | 'editor'
  readonly seenAt: number
}
/** Other active panes in the document; stale or revoked panes are excluded. */
export interface CopyOSDocPresenceValue { readonly peers: readonly CopyOSDocPresencePeer[] }
/** Submit a commutative Yjs update; protected generation metadata cannot be changed. */
export interface CopyOSDocSyncRequest extends CopyOSDocReadRequest { readonly update: string; readonly contentVersion: 2 }
/** Stop or resume drafting, invalidating all writes from a previous epoch. */
export interface CopyOSDocControlRequest extends CopyOSDocReadRequest { readonly stopped: boolean }
/** Create or revoke a document link; restricted clears every issued token. */
export interface CopyOSDocShareRequest extends CopyOSDocReadRequest { readonly role: 'restricted' | 'viewer' | 'commenter' | 'editor' }
/** A newly issued, revocable link capability; never included in document projections. */
export interface CopyOSDocShareValue { readonly token: string; readonly role: 'restricted' | 'viewer' | 'commenter' | 'editor' }
/** Server-rendered export bytes, ready for download. */
export interface CopyOSDocExportValue { readonly content: string; readonly mime: string; readonly filename: string }
/** Export the persisted document as Markdown, PDF or editable Word. */
export interface CopyOSDocExportRequest extends CopyOSDocReadRequest { readonly format: 'markdown' | 'pdf' | 'word' }

/** Opaque Yjs passage boundaries, shared so queued local edits can move highlights immediately. */
export interface CopyOSDocCommentAnchor { readonly start: string; readonly end: string }
/** Emoji counts and the requesting reader's reaction state. */
export interface CopyOSDocCommentReaction { readonly emoji: string; readonly count: number; readonly mine: boolean }
/** One human or assistant reply; deleted messages retain their identity for undo and replies. */
export interface CopyOSDocCommentMessage {
  readonly id: string
  readonly author: 'user' | 'assistant'
  readonly mine: boolean
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly text: string
  readonly deleted: boolean
  readonly createdAt: string
  readonly editedAt?: string
  readonly reactions: readonly CopyOSDocCommentReaction[]
}
/** The latest explicit assistant request for one thread. */
export interface CopyOSDocCommentAssistant {
  readonly id: string
  readonly messageId: string
  readonly state: 'pending' | 'answered' | 'failed' | 'cancelled'
}
/** Original passage identity retained when an undoable page edit moves an anchored thread. */
export interface CopyOSDocCommentTarget {
  readonly blockId: string
  readonly section: boolean
  readonly anchor: CopyOSDocCommentAnchor
}
/** A durable passage thread, including detached originals and capability-derived ownership. */
export interface CopyOSDocCommentThread {
  readonly anchorOrigin?: CopyOSDocCommentTarget
  readonly id: string
  readonly blockId: string
  readonly quote: string
  readonly section: boolean
  readonly anchor: CopyOSDocCommentAnchor
  /** Current offsets in blockId; ranges carries additional sections of the same passage. */
  readonly range?: { readonly from: number; readonly to: number }
  /** Section-relative highlights when one passage crosses visible section separators. */
  readonly ranges?: readonly { readonly blockId: string; readonly from: number; readonly to: number }[]
  readonly detached: boolean
  readonly resolved: boolean
  readonly mentioned: boolean
  readonly createdAt: string
  readonly messages: readonly CopyOSDocCommentMessage[]
  readonly assistant?: CopyOSDocCommentAssistant
}
/** A client-generated thread identity and anchored selection, captured before the user starts typing a comment. */
export interface CopyOSDocCommentDraft {
  readonly id: string
  readonly blockId: string
  readonly quote: string
  readonly section: boolean
  readonly anchor: CopyOSDocCommentAnchor
}
/** Human comment actions. Edits compare the original text and edit timestamp; identical saved results are retryable.
 * Assistant attribution is only available to the scoped reply tool.
 */
export type CopyOSDocCommentAction =
  | { readonly type: 'create'; readonly draft: CopyOSDocCommentDraft; readonly text: string; readonly requestAssistant?: boolean }
  | { readonly type: 'reply'; readonly threadId: string; readonly id: string; readonly text: string; readonly requestAssistant?: boolean }
  | { readonly type: 'edit'
    readonly threadId: string
    readonly messageId: string
    readonly text: string
    readonly expectedText: string
    readonly expectedEditedAt: string | null }
  | { readonly type: 'delete' | 'undelete'; readonly threadId: string; readonly messageId: string }
  | { readonly type: 'resolve'; readonly threadId: string; readonly resolved: boolean }
  | { readonly type: 'react'; readonly threadId: string; readonly messageId: string; readonly emoji: string }
  | { readonly type: 'ask'; readonly threadId: string }
  | { readonly type: 'assistant-failed'; readonly threadId: string; readonly requestId: string }
/** Apply one human action under the document's mutation queue. */
export interface CopyOSDocCommentRequest extends CopyOSDocReadRequest { readonly action: CopyOSDocCommentAction }
/** Reply to a specific pending request; stale, cancelled and resolved requests reject late replies. */
export interface CopyOSDocCommentReplyRequest {
  readonly docId: string
  readonly threadId: string
  readonly requestId: string
  readonly text: string
  readonly sessionId: string
}

/** One saved text revision; session metadata groups related assistant changes in the timeline. */
export interface CopyOSDocHistoryEntry {
  readonly revision: number
  readonly savedAt: string
  readonly actor: 'user' | 'assistant' | 'system'
  readonly name: string
  readonly sessionId?: string
  readonly restoredFrom?: number
}
/** A saved text projection, independent of current permissions and review state. */
export interface CopyOSDocHistoryVersion {
  readonly tabs?: readonly CopyOSDocTab[]
  readonly entry: CopyOSDocHistoryEntry
  readonly title: string
  readonly blocks: readonly CopyOSDocBlock[]
}
/** Fifty newest matching revisions and a cursor for older entries. */
export interface CopyOSDocHistoryListValue {
  readonly headRevision: number
  readonly entries: readonly CopyOSDocHistoryEntry[]
  readonly nextBefore?: number
}
/** Read history before an optional exclusive revision cursor. */
export interface CopyOSDocHistoryListRequest extends CopyOSDocReadRequest { readonly before?: number }
/** Address one saved revision. */
export interface CopyOSDocHistoryReadRequest extends CopyOSDocReadRequest { readonly revision: number }
/** One version and its predecessor for highlighted comparison. */
export interface CopyOSDocHistoryReadValue {
  readonly version: CopyOSDocHistoryVersion
  readonly previous?: CopyOSDocHistoryVersion
}
/** Name a saved revision without changing document text. */
export interface CopyOSDocHistoryNameRequest extends CopyOSDocHistoryReadRequest { readonly name: string }
/** Restore saved text as a new revision, refusing intervening content changes. */
export interface CopyOSDocRestoreRequest extends CopyOSDocHistoryReadRequest { readonly expectedRevision: number }

/** Create a Suite strategy document whose Strategy tab holds one unfinished section per strategy stage. */
export interface CopyOSStrategyDocCreateRequest {
  readonly workspaceId: string
  /** Session whose document view selects the new document. */
  readonly sessionId?: string | undefined
  readonly title: string
}
