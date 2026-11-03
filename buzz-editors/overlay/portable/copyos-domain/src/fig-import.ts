import { importFigFontFeatures } from './fig-font-features.ts'
import { importFigTextHyperlinks } from './fig-text-hyperlinks.ts'
import { importFigGrids } from './fig-grid.ts'
import { importFigEffects } from './fig-effects.ts'
/** Decode native Figma containers into editable CopyOS scenes. */
import { randomUUID } from 'node:crypto'
import { unzipSync } from 'fflate'
import { decodeFigKiwiCanvas } from '@open-pencil/kiwi/fig/parse'
import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import type { Color, GUID } from '@open-pencil/kiwi/fig'
import { DESIGN_NODE_NAME_MAX_LENGTH } from './design-variant-names.ts'
import { importFigVariants } from './fig-variants.ts'
import { figVectorNetwork, figVectorNetworkPaths } from './fig-vector-network.ts'
import { FIG_AUTO_LINE_HEIGHT, figLineHeightRatio, importFigTextRuns } from './fig-text-runs.ts'
import { createDesignNode } from './design-model.ts'
import { designStrokeSupportsEdges } from './design-stroke.ts'
import type {
  CopyOSDesignDocument,
  CopyOSDesignCanvasBackground,
  CopyOSDesignConstraints,
  CopyOSDesignNode,
  CopyOSDesignNodeKind,
  CopyOSDesignImagePaint,
  CopyOSDesignPaint,
  CopyOSDesignPaintBlendMode,
  CopyOSDesignLayerBlendMode,
  CopyOSDesignInstanceStroke,
} from './types.ts'

const MAX_ARCHIVE_BYTES = 100_000_000
const FIG_PAINT_BLEND_MODES = new Map<string, CopyOSDesignPaintBlendMode>([
  ['NORMAL', 'normal'], ['DARKEN', 'darken'], ['MULTIPLY', 'multiply'], ['COLOR_BURN', 'color-burn'],
  ['LIGHTEN', 'lighten'], ['SCREEN', 'screen'], ['LINEAR_DODGE', 'plus-lighter'], ['COLOR_DODGE', 'color-dodge'],
  ['OVERLAY', 'overlay'], ['SOFT_LIGHT', 'soft-light'], ['HARD_LIGHT', 'hard-light'], ['DIFFERENCE', 'difference'],
  ['EXCLUSION', 'exclusion'], ['HUE', 'hue'], ['SATURATION', 'saturation'], ['COLOR', 'color'], ['LUMINOSITY', 'luminosity'],
])
function paintBlendMode(paint: Paint, channel: 'fill' | 'stroke', warn: (message: string) => void): CopyOSDesignPaintBlendMode {
  const raw = paint.blendMode ?? 'NORMAL', mode = FIG_PAINT_BLEND_MODES.get(raw)
  if (mode) return mode
  warn(`Unsupported ${raw} ${channel} paint blend mode requires review; imported as Normal`)
  return 'normal'
}
function layerBlendMode(raw: string, warn: (message: string) => void): CopyOSDesignLayerBlendMode {
  if (raw === 'PASS_THROUGH') return 'pass-through'
  const mode = FIG_PAINT_BLEND_MODES.get(raw)
  if (mode) return mode
  warn(`Unsupported ${raw} layer blend mode requires review; imported as Normal`)
  return 'normal'
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function savedGuid(value: unknown): GUID | undefined {
  if (!record(value) || typeof value.sessionID !== 'number' || typeof value.localID !== 'number') return
  if (![value.sessionID, value.localID].every(part => Number.isInteger(part) && part >= 0 && part <= 0xffffffff)) return
  return { sessionID: value.sessionID, localID: value.localID }
}
function importInstanceStyleOverrides(
  nodes: CopyOSDesignNode[], sources: readonly NodeChange[], ids: ReadonlyMap<string, string>, warn: (message: string) => void,
): void {
  const byId = new Map(nodes.map(node => [node.id, node])), rawById = new Map(sources.map(raw => [guid(raw.guid), raw]))
  const children = new Map<string, NodeChange[]>()
  for (const raw of sources) {
    const parent = guid(raw.parentIndex?.guid), siblings = children.get(parent) ?? []
    siblings.push(raw); children.set(parent, siblings)
  }
  const matches = (raw: NodeChange, key: GUID): boolean => {
    const alias = savedGuid(raw.overrideKey)
    return guid(raw.guid) === guid(key) || (guid(alias) !== '4294967295:4294967295' && guid(alias) === guid(key))
  }
  for (const raw of sources) {
    const data = raw.symbolData
    if (!data || !('symbolOverrides' in data)) continue
    const overrides: readonly unknown[] = Array.isArray(data.symbolOverrides) ? data.symbolOverrides : []
    if (overrides.some(value => record(value) && value.effects !== undefined))
      warn('Native symbolic effect overrides require review; unverified effect ownership is not imported')
    const owner = byId.get(ids.get(guid(raw.guid)) ?? '')
    const claims = overrides.filter(value => record(value) && (typeof value.blendMode === 'string' ||
      ['strokeCap', 'strokeJoin', 'miterLimit', 'dashPattern', 'minSize', 'maxSize', 'targetAspectRatio'].some(key => value[key] !== undefined)))
    if (!claims.length) continue
    if (owner?.kind !== 'instance' || !owner.componentId) {
      warn('Native style overrides on independent instance frames require review')
      continue
    }
    for (const claim of claims) {
      if (!record(claim)) continue
      if (claim.targetAspectRatio !== undefined) {
        warn('Native symbolic aspect ratio overrides require review; unverified ratio claims are not imported')
        if (typeof claim.blendMode !== 'string' &&
          !['strokeCap', 'strokeJoin', 'miterLimit', 'dashPattern', 'minSize', 'maxSize'].some(key => claim[key] !== undefined)) continue
      }
      if (claim.minSize !== undefined || claim.maxSize !== undefined)
        warn('Native symbolic minimum and maximum size overrides require review; unverified bound claims are not imported')
      const category = typeof claim.blendMode === 'string' ? 'blend' : 'stroke geometry'
      const pathValue = record(claim.guidPath) ? claim.guidPath.guids : undefined
      const parts: readonly unknown[] = Array.isArray(pathValue) ? pathValue : []
      const path = parts.map(savedGuid)
      if (!Array.isArray(pathValue) || path.length > 64 || path.some(part => !part)) {
        warn(`Unresolved native instance ${category} override path requires review`); continue
      }
      let source = rawById.get(guid(data.symbolID))
      const canonical: string[] = []
      let valid = !!source
      for (let index = 0; index < path.length; index++) {
        const key = path[index]
        if (!key || !source) { valid = false; break }
        if (index === 0 && matches(source, key)) continue
        const found: NodeChange[] = [], queue = [...children.get(guid(source.guid)) ?? []], seen = new Set<string>()
        while (queue.length) {
          const candidate = queue.pop()
          if (!candidate || seen.has(guid(candidate.guid))) continue
          seen.add(guid(candidate.guid))
          if (matches(candidate, key)) found.push(candidate)
          if (candidate.type !== 'INSTANCE') queue.push(...children.get(guid(candidate.guid)) ?? [])
        }
        const target = found.length === 1 ? found[0] : undefined, id = ids.get(guid(target?.guid))
        if (!target || !id) { valid = false; break }
        canonical.push(id)
        if (index < path.length - 1) {
          const nested = byId.get(id)
          if (nested?.kind !== 'instance') { valid = false; break }
          source = rawById.get(guid(target.symbolData?.symbolID))
        }
      }
      if (!valid) { warn(`Unresolved or ambiguous native instance ${category} override path requires review`); continue }
      const strokeFields = readStrokeStyle(claim, warn)
      if (!canonical.length) {
        const accepted: CopyOSDesignInstanceStroke = {}
        for (const key of ['strokeCap', 'strokeJoin', 'strokeMiterLimit', 'strokeDashes'] as const) {
          const value = strokeFields[key], prior = owner.instanceStroke?.[key]
          if (value === undefined) continue
          if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(value))
            warn('Conflicting native root stroke geometry values require review; first explicit value is retained')
          else Object.assign(accepted, { [key]: value })
        }
        Object.assign(owner, accepted)
        if (Object.keys(accepted).length) owner.instanceStroke = { ...owner.instanceStroke, ...accepted }
      } else if (Object.keys(strokeFields).length)
        warn('Native instance descendant stroke geometry overrides require review; symbolic geometry claims are not imported')
      if (typeof claim.blendMode !== 'string') continue
      const mode = layerBlendMode(claim.blendMode, warn)
      if (!canonical.length) {
        if (raw.blendMode !== undefined && owner.blendMode !== mode)
          warn('Conflicting native root blend values require review; explicit layer value is retained')
        else if (raw.blendMode === undefined && owner.blendMode !== undefined && owner.blendMode !== mode)
          warn('Conflicting native root blend values require review; first value is retained')
        else if (raw.blendMode === undefined) owner.blendMode = mode
        continue
      }
      const existing = owner.instanceOverrides?.find(value => JSON.stringify(value.path) === JSON.stringify(canonical))
      if (existing?.blendMode !== undefined && existing.blendMode !== mode) {
        warn('Conflicting native descendant blend values require review; first value is retained'); continue
      }
      if (existing) existing.blendMode = mode
      else owner.instanceOverrides = [...owner.instanceOverrides ?? [], { path: canonical, blendMode: mode }]
    }
  }
}
function guid(value: GUID | undefined): string {
  return value ? `${value.sessionID}:${value.localID}` : ''
}
function unit(value: number | undefined, fallback = 1): number {
  return Math.max(0, Math.min(1, value ?? fallback))
}
function independentStroke(
  raw:NodeChange,node:CopyOSDesignNode,warn:(message:string)=>void,
):void {
  if (['borderTopHidden','borderRightHidden','borderBottomHidden','borderLeftHidden'].some(key=>raw[key]===true))
    warn('Native hidden-edge stroke flags require review; their rendering semantics are not interpreted')
  if (raw.borderStrokeWeightsIndependent!==true) return
  if (!designStrokeSupportsEdges(node)) {
    warn('Independent stroke weights on nonrectangular layers require review; uniform stroke is retained')
    return
  }
  const values:number[]=[]
  for (const key of ['borderTopWeight','borderRightWeight','borderBottomWeight','borderLeftWeight']) {
    const value=raw[key] ?? 0
    if (typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1000) {
      warn('Invalid independent stroke weights require review; uniform stroke is retained')
      return
    }
    values.push(value)
  }
  const edges={ strokeTopWidth:values[0] ?? 0,strokeRightWidth:values[1] ?? 0,
    strokeBottomWidth:values[2] ?? 0,strokeLeftWidth:values[3] ?? 0 }
  Object.assign(node,edges)
  const visible=(paints:Paint[]|undefined)=>paints?.some(paint=>paint.visible!==false) ?? false
  if (node.kind==='instance') {
    node.instanceStroke={ ...node.instanceStroke,...edges }
    if (raw.strokePaints!==undefined) {
      node.instanceStroke={ ...node.instanceStroke,...edges,stroke:node.stroke,
        strokeOpacity:node.strokes ? 1 : visible(raw.strokePaints)?node.strokeOpacity:0,
        strokeAlign:node.strokeAlign ?? 'center' }
    }
  } else if (!visible(raw.strokePaints) && !node.strokes) node.strokeOpacity=0
}
function readStrokeStyle(raw: NodeChange, warn: (message: string) => void): CopyOSDesignInstanceStroke {
  const fields: CopyOSDesignInstanceStroke = {}
  if (raw.strokeCap !== undefined) {
    const caps = new Map<string, NonNullable<CopyOSDesignInstanceStroke['strokeCap']>>([
      ['NONE', 'butt'], ['ROUND', 'round'], ['SQUARE', 'square'],
    ])
    fields.strokeCap = caps.get(raw.strokeCap) ?? 'butt'
    if (!caps.has(raw.strokeCap)) warn(`Unsupported ${raw.strokeCap} stroke cap requires review; imported as Butt`)
  }
  if (raw.strokeJoin !== undefined) {
    const joins = new Map<string, NonNullable<CopyOSDesignInstanceStroke['strokeJoin']>>([
      ['MITER', 'miter'], ['ROUND', 'round'], ['BEVEL', 'bevel'],
    ])
    fields.strokeJoin = joins.get(raw.strokeJoin) ?? 'miter'
    if (!joins.has(raw.strokeJoin)) warn(`Unsupported ${raw.strokeJoin} stroke join requires review; imported as Miter`)
  }
  if (raw.miterLimit !== undefined) {
    if (typeof raw.miterLimit === 'number' && Number.isFinite(raw.miterLimit) && raw.miterLimit >= 1 && raw.miterLimit <= 1000)
      fields.strokeMiterLimit = raw.miterLimit
    else warn('Invalid or unsupported native stroke miter limit requires review; inherited or default limit is retained')
  }
  if (raw.dashPattern !== undefined) {
    const pattern = raw.dashPattern
    if (!Array.isArray(pattern) || pattern.some(value => !Number.isFinite(value) || value < 0 || value > 1000))
      warn('Invalid or unsupported native stroke dash pattern requires review; inherited or solid pattern is retained')
    else if (pattern.length && pattern.every(value => value === 0)) {
      fields.strokeDashes = []
      warn('All-zero native stroke dash pattern is imported as explicit Solid')
    } else {
      const even = pattern.length % 2 ? [...pattern, ...pattern] : [...pattern]
      if (even.length > 100)
        warn('Native stroke dash pattern exceeds the editable limit; inherited or solid pattern is retained')
      else fields.strokeDashes = even
    }
  }
  const vector = raw.vectorData
  const table: readonly unknown[] = record(vector) && Array.isArray(vector.styleOverrideTable) ? vector.styleOverrideTable : []
  if (table.some(value => record(value) &&
    ((value.strokeCap !== undefined && value.strokeCap !== (raw.strokeCap ?? 'NONE')) ||
      (value.strokeJoin !== undefined && value.strokeJoin !== (raw.strokeJoin ?? 'MITER')))))
    warn('Differing per-vertex stroke styles require review; saved uniform layer settings are retained')
  return fields
}
function importStrokeStyle(raw: NodeChange, node: CopyOSDesignNode, warn: (message: string) => void): void {
  const fields = readStrokeStyle(raw, warn)
  Object.assign(node, fields)
  if (node.kind === 'instance' && Object.keys(fields).length) node.instanceStroke = { ...node.instanceStroke, ...fields }
}
/**
 * Report whether imported text should keep wrapping inside its fixed box.
 * Figma text whose saved layout is one line without a newline imports without wrapping, so small font-metric
 * differences cannot push its last word onto a clipped second line; other text, and text without saved lines, keeps wrapping.
 * @param raw - Decoded TEXT record with optional `derivedTextData.baselines`.
 * @returns False only for saved single-line text without a newline.
 */
function figTextSoftWraps(raw: NodeChange): boolean {
  const characters = raw.textData?.characters ?? ''
  const baselines = raw.derivedTextData?.baselines
  return !characters || baselines?.length !== 1 || characters.trimEnd().includes('\n')
}
/** Capture a basic LINE shaft as one editable path; later edits use native path geometry. */
function importStraightLine(raw: NodeChange, node: CopyOSDesignNode, warn: (message: string) => void): boolean {
  if (raw.type !== 'LINE' || !raw.size || !Number.isFinite(raw.size.x) || !Number.isFinite(raw.size.y) ||
    Math.abs(raw.size.x) > 100000 || Math.abs(raw.size.y) > 100000) return false
  const width = raw.size.x, height = raw.size.y, length = Math.hypot(width, height)
  const ux = length ? width / length : 0, uy = length ? height / length : 0
  const weight = node.strokeWidth
  // OpenPencil's pinned LINE renderer puts the whole weight on one side and caps inside the declared length.
  const inset = node.strokeCap === 'round' || node.strokeCap === 'square' ? Math.min(weight, length) / 2 : 0
  const start = { x: ux * inset + uy * weight / 2, y: uy * inset - ux * weight / 2 }
  const end = { x: width - ux * inset + uy * weight / 2, y: height - uy * inset - ux * weight / 2 }
  node.pathData = { width: node.width, height: node.height,
    paths: [{ d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, fillRule: 'nonzero' }] }
  node.strokeAlign = 'center'
  const m = raw.transform
  if (m && Math.abs(Math.hypot(m.m00, m.m10) - 1) < .001 && Math.abs(Math.hypot(m.m01, m.m11) - 1) < .001 &&
    Math.abs(m.m00 * m.m01 + m.m10 * m.m11) < .001) {
    node.flipY = m.m00 * m.m11 - m.m01 * m.m10 < 0
    // Center-based native transforms must retain the raw origin even when a zero-height box is normalized to one pixel.
    node.x = m.m02 + m.m00 * node.width / 2 + m.m01 * node.height / 2 - node.width / 2
    node.y = m.m12 + m.m10 * node.width / 2 + m.m11 * node.height / 2 - node.height / 2
  }
  warn('Native LINE is imported as an editable path; future cap, weight and dash edits use native path behavior')
  return true
}
type FigSizeBound = 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'
/** Preserve the verified OptionalVector ratio owner without inferring a lock from saved dimensions. */
function readAspectRatio(raw: NodeChange, warn: (message: string) => void): { x: number; y: number } | null | undefined {
  const wrapper: unknown = raw.targetAspectRatio
  if (wrapper === undefined) {
    if (raw.proportionsConstrained !== undefined)
      warn('Legacy native proportional-resize flags require review; no persistent aspect ratio is inferred')
    return undefined
  }
  if (!record(wrapper)) {
    warn('Unsupported native aspect ratio requires review; the ratio is not imported')
    return undefined
  }
  if (wrapper.value === undefined) return null
  const value = wrapper.value
  if (!record(value) || typeof value.x !== 'number' || typeof value.y !== 'number' ||
    ![value.x, value.y].every(part => Number.isFinite(part) && part > 0 && part <= 100000) ||
    (!Number.isFinite(value.x / value.y) || value.x / value.y <= 0)) {
    warn('Unsupported native aspect ratio requires review; the ratio is not imported')
    return undefined
  }
  if (raw.type === 'TEXT' && raw.textAutoResize !== undefined && raw.textAutoResize !== 'NONE') {
    warn('Native aspect ratio on auto-resizing text requires review; the incompatible ratio is not imported')
    return undefined
  }
  return { x: value.x, y: value.y }
}
/** Read the verified zero-minimum and infinite-maximum wire sentinels without fabricating literal ownership. */
function readSizeBounds(raw: NodeChange, warn: (message: string) => void): Partial<Pick<CopyOSDesignNode, FigSizeBound>> {
  const fields: Partial<Pick<CopyOSDesignNode, FigSizeBound>> = {}
  for (const [wire, prefix] of [['minSize', 'min'], ['maxSize', 'max']] as const) {
    const bounds = raw[wire]
    if (bounds === undefined) continue
    for (const [axis, suffix] of [['x', 'Width'], ['y', 'Height']] as const) {
      const key = `${prefix}${suffix}` as FigSizeBound, value = bounds.value?.[axis]
      if (value === undefined || prefix === 'min' && value === 0 || prefix === 'max' && value === Infinity) fields[key] = undefined
      else if (Number.isFinite(value) && value >= (prefix === 'min' ? 0 : 1) && value <= 100000) fields[key] = value
      else warn('Unsupported native size bound requires review; the bound is not imported')
    }
  }
  for (const [min, max] of [['minWidth', 'maxWidth'], ['minHeight', 'maxHeight']] as const) {
    if (fields[min] !== undefined && fields[max] !== undefined && fields[min] > fields[max]) {
      if (min === 'minWidth') { delete fields.minWidth; delete fields.maxWidth }
      else { delete fields.minHeight; delete fields.maxHeight }
      warn('Inverted native size bounds require review; incompatible axis bounds are not imported')
    }
  }
  return fields
}
function editableFrame(node:CopyOSDesignNode):void {
  if (node.instanceStroke) Object.assign(node,node.instanceStroke)
  node.kind='frame'
  node.componentId=null
  delete node.instanceStroke
}
function hex(color: Color | undefined): string {
  return (
    '#' +
    [color?.r ?? 0, color?.g ?? 0, color?.b ?? 0]
      .map(v =>
        Math.round(unit(v) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}
function hash(value: string | Uint8Array): string {
  return typeof value === 'string'
    ? value.toLowerCase()
    : Buffer.from(value).toString('hex')
}
function raster(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length > 6_000_000) return undefined
  const mime =
    bytes[0] === 137 && bytes[1] === 80
      ? 'png'
      : bytes[0] === 255 && bytes[1] === 216
        ? 'jpeg'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
          ? 'webp'
          : String.fromCharCode(...bytes.slice(0, 3)) === 'GIF'
            ? 'gif'
            : undefined
  return mime
    ? `data:image/${mime};base64,${Buffer.from(bytes).toString('base64')}`
    : undefined
}
/** Decode Figma's fill geometry opcodes, whose coordinates use the node's local space. */
function pathCommands(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const output: string[] = []
  while (offset < bytes.length) {
    const opcode = bytes[offset++]
    const count =
      opcode === 0
        ? 0
        : opcode === 1 || opcode === 2
          ? 2
          : opcode === 3
            ? 4
            : opcode === 4
              ? 6
              : -1
    if (count < 0 || offset + count * 4 > bytes.length)
      throw new Error('Unsupported vector command data')
    const numbers: number[] = []
    for (let i = 0; i < count; i++) {
      const value = view.getFloat32(offset, true)
      if (!Number.isFinite(value)) throw new Error('Invalid vector coordinate')
      numbers.push(value)
      offset += 4
    }
    output.push(`${['Z', 'M', 'L', 'Q', 'C'][opcode ?? 0]}${numbers.join(' ')}`)
  }
  return output.join(' ')
}

/** Largest corner radius a native layer stores; any radius at least half the shape's shorter side draws the same full rounding. */
const MAX_CORNER_RADIUS = 100000

/**
 * Figma writes very large radii (often far above 100,000) for fully rounded pills; keep them within the native limit.
 * @param value - Raw Figma radius.
 * @returns A finite radius from 0 to 100,000; non-finite large values become the maximum.
 */
function figCornerRadius(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(MAX_CORNER_RADIUS, Math.max(0, value))
}

/**
 * Read a zipped or raw fig-kiwi file without contacting Figma.
 * @param bytes - Original .fig bytes; call inside the bounded import worker.
 * @param fileName - Display name of the local file.
 * @returns a new independent document with an import report.
 */
export function decodeFigDocument(
  bytes: Uint8Array,
  fileName: string,
): CopyOSDesignDocument {
  if (bytes.byteLength > 25_000_000)
    throw new Error(
      'Figma imports are limited to 25 MB per file. Export a smaller file or page.',
    )
  const images = new Map<string, Uint8Array>()
  let canvas = bytes
  if (bytes[0] === 80 && bytes[1] === 75) {
    let total = 0
    const archive = unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize
        if (total > MAX_ARCHIVE_BYTES)
          throw new Error(
            'Figma archive expands beyond the 100 MB import limit',
          )
        return (
          entry.name === 'canvas.fig' ||
          entry.name === 'canvas' ||
          entry.name.startsWith('images/')
        )
      },
    })
    const candidate = archive['canvas.fig'] ?? archive.canvas
    if (!candidate)
      throw new Error(
        'This archive does not contain a Figma canvas.fig document',
      )
    canvas = candidate
    for (const [name, data] of Object.entries(archive))
      if (name.startsWith('images/') && data.length)
        images.set(name.slice(7).split('.')[0] ?? '', data)
  }
  if (
    canvas.length < 20 ||
    new TextDecoder().decode(canvas.slice(0, 8)) !== 'fig-kiwi'
  )
    throw new Error('This is not a native Figma .fig file')
  const { nodeChanges, blobs } = decodeFigKiwiCanvas(canvas)
  return convertFigRecords(nodeChanges, blobs, images, fileName).document
}

/** Decoded native scene and original GUID mapping for clipboard root admission. */
export interface FigRecordConversionResult {
  document: CopyOSDesignDocument
  ids: ReadonlyMap<string, string>
}

/**
 * Convert decoded records without choosing clipboard selection or importing external resources.
 * @param nodeChanges - Decoded Figma records, including their page ancestors.
 * @param blobs - Embedded binary resources.
 * @param images - Archive images indexed by hash.
 * @param fileName - Display name used by the native import report.
 * @returns Editable scene and source GUID to native identity mapping.
 */
export function convertFigRecords(nodeChanges: readonly NodeChange[], blobs: readonly Uint8Array[],
  images: ReadonlyMap<string, Uint8Array>, fileName: string): FigRecordConversionResult {
  if (nodeChanges.length > 100_000)
    throw new Error(
      'The Figma file contains too many records. Import a smaller file.',
    )
  // A file can contain several changes for one node; the last known fields win.
  const records = new Map<string, NodeChange>()
  for (const change of nodeChanges) {
    const key = guid(change.guid)
    if (key) records.set(key, { ...records.get(key), ...change })
  }
  const warnings = new Map<string, number>()
  const warn = (reason: string): void => {
    warnings.set(reason, (warnings.get(reason) ?? 0) + 1)
  }
  const ordered = [...records.values()]
    .filter(n => n.phase !== 'REMOVED')
    .sort((a, b) =>
      (a.parentIndex?.position ?? '') < (b.parentIndex?.position ?? '')
        ? -1
        : (a.parentIndex?.position ?? '') > (b.parentIndex?.position ?? '')
          ? 1
          : 0,
    )
  const canvases = ordered.filter(n => n.type === 'CANVAS' && !n.internalOnly)
  const pages = canvases.map((n) => {
    let canvasBackground: CopyOSDesignCanvasBackground | undefined
    if (n.backgroundColor !== undefined || n.backgroundOpacity !== undefined || n.backgroundEnabled !== undefined) {
      const color = n.backgroundColor, opacity = n.backgroundOpacity, enabled = n.backgroundEnabled
      const validColor = (value: unknown): value is Color => typeof value === 'object' && value !== null &&
        ['r', 'g', 'b', 'a'].every(key => key in value &&
          typeof value[key as keyof typeof value] === 'number' && Number.isFinite(value[key as keyof typeof value]))
      if ((color === undefined || validColor(color)) &&
        (opacity === undefined || (typeof opacity === 'number' && Number.isFinite(opacity))) &&
        (enabled === undefined || typeof enabled === 'boolean')) {
        canvasBackground = { color: color ? hex(color) : '#f5f5f5',
          opacity: unit(opacity) * unit(color?.a), visible: enabled ?? true }
      } else warn('Invalid canvas background fields use the native default')
    }
    return { id: randomUUID(), name: (n.name || 'Page').slice(0, 200),
      ...(canvasBackground ? { canvasBackground } : {}) }
  })
  if (!pages.length) pages.push({ id: randomUUID(), name: 'Page 1' })
  const pageIds = new Map(
    canvases.map((n, i) => [guid(n.guid), pages[i]?.id ?? pages[0]?.id ?? '']),
  )
  const pageFor = (n: NodeChange): string | undefined => {
    let key = guid(n.parentIndex?.guid)
    const seen = new Set<string>()
    while (key && !seen.has(key)) {
      seen.add(key)
      if (pageIds.has(key)) return pageIds.get(key)
      const parent = records.get(key)
      if (!parent || parent.internalOnly) return undefined
      key = guid(parent.parentIndex?.guid)
    }
    return undefined
  }
  const supported: Record<string, CopyOSDesignNodeKind> = {
    FRAME: 'frame',
    GROUP: 'group',
    SECTION: 'frame',
    RECTANGLE: 'rectangle',
    ROUNDED_RECTANGLE: 'rectangle',
    ELLIPSE: 'ellipse',
    TEXT: 'text',
    SYMBOL: 'component',
    COMPONENT: 'component',
    INSTANCE: 'instance',
    VECTOR: 'path',
    BOOLEAN_OPERATION: 'path',
    STAR: 'path',
    REGULAR_POLYGON: 'path',
    LINE: 'path',
  }
  const visual = ordered.filter(
    n =>
      !n.internalOnly &&
      n.type !== 'DOCUMENT' &&
      n.type !== 'CANVAS' &&
      pageFor(n),
  )
  if (visual.length > 25000)
    throw new Error(
      'This file has more than 25000 editable layers. Export fewer pages from Figma.',
    )
  const ids = new Map(visual.map(n => [guid(n.guid), randomUUID()]))
  const nodes: CopyOSDesignNode[] = []
  const boundClaims = new Map<string, FigSizeBound[]>()
  const boundedRaw = new Set<string>()
  for (const raw of visual) {
    const id = ids.get(guid(raw.guid))
    if (!id) continue
    const kind = supported[raw.type ?? ''] ?? 'frame'
    if (!supported[raw.type ?? ''])
      warn(
        `Unsupported ${raw.type ?? 'unknown'} nodes retained as editable containers`,
      )
    if ((raw.name?.length ?? 0) > DESIGN_NODE_NAME_MAX_LENGTH)
      warn('Layer names beyond 32768 characters are shortened during import')
    const node = createDesignNode(
      kind,
      id,
      (raw.name || raw.type || 'Layer').slice(0, DESIGN_NODE_NAME_MAX_LENGTH),
    )
    node.pageId = pageFor(raw)
    node.parentId = ids.get(guid(raw.parentIndex?.guid)) ?? null
    const size = raw.size ?? raw.derivedTextData?.layoutSize
    node.width = Math.max(1, Math.min(100000, Math.abs(size?.x ?? 100)))
    node.height = Math.max(1, Math.min(100000, Math.abs(size?.y ?? 100)))
    const m = raw.transform
    node.rotation = m ? (Math.atan2(m.m10, m.m00) * 180) / Math.PI : 0
    const angle = (node.rotation * Math.PI) / 180
    // CopyOS rotates around the center; Figma stores the local origin's affine transform.
    node.x =
      (m?.m02 ?? 0) +
      (Math.cos(angle) * node.width) / 2 -
      (Math.sin(angle) * node.height) / 2 -
      node.width / 2
    node.y =
      (m?.m12 ?? 0) +
      (Math.sin(angle) * node.width) / 2 +
      (Math.cos(angle) * node.height) / 2 -
      node.height / 2
    if (
      m &&
      (Math.abs(Math.hypot(m.m00, m.m10) - 1) > 0.001 ||
        Math.abs(Math.hypot(m.m01, m.m11) - 1) > 0.001 ||
        m.m00 * m.m11 - m.m01 * m.m10 < 0)
    )
      warn('Affine scale, skew, or reflection requires review')
    node.visible = raw.visible ?? true
    node.locked = raw.locked ?? false
    node.opacity = unit(raw.opacity)
    node.radius = figCornerRadius(raw.cornerRadius ?? raw.rectangleTopLeftCornerRadius ?? 0)
    if (
      raw.rectangleCornerRadiiIndependent ||
      (raw.rectangleCornerRadiiIndependent !== false &&
        [
          raw.rectangleTopLeftCornerRadius,
          raw.rectangleTopRightCornerRadius,
          raw.rectangleBottomRightCornerRadius,
          raw.rectangleBottomLeftCornerRadius,
        ].some(v => v !== undefined))
    ) {
      node.radiusTopLeft = figCornerRadius(raw.rectangleTopLeftCornerRadius ?? node.radius)
      node.radiusTopRight = figCornerRadius(raw.rectangleTopRightCornerRadius ?? node.radius)
      node.radiusBottomRight = figCornerRadius(raw.rectangleBottomRightCornerRadius ?? node.radius)
      node.radiusBottomLeft = figCornerRadius(raw.rectangleBottomLeftCornerRadius ?? node.radius)
    }
    node.clip =
      raw.clipsContent ??
      (['FRAME', 'SYMBOL', 'COMPONENT', 'INSTANCE'].includes(raw.type ?? '') &&
        raw.frameMaskDisabled === false)
    if (node.layoutSizingModel) node.layoutSizingModel = 'legacy'
    const stackMode: unknown = raw.stackMode
    node.layout =
      raw.stackMode === 'HORIZONTAL'
        ? 'row'
        : raw.stackMode === 'VERTICAL'
          ? 'column'
          : 'none'
    if ('bordersTakeSpace' in raw) {
      if (typeof raw.bordersTakeSpace === 'boolean')
        node.strokesIncludedInLayout = raw.bordersTakeSpace
      else warn('Invalid native stroke layout inclusion requires review')
    }
    if ('stackLayoutVersion' in raw)
      warn(
        'Native layout sizing versions require review; saved geometry is retained until choosing a sizing model',
      )
    node.preserveLayout = node.layout !== 'none'
    node.layoutWrap = raw.stackWrap === 'WRAP' ? 'wrap' : 'none'
    node.crossGap = Math.max(
      0,
      raw.stackCounterSpacing ?? raw.stackSpacing ?? 0,
    )
    node.absolutePosition = raw.stackPositioning === 'ABSOLUTE'
    node.gap = Math.max(-10000, Math.min(10000, raw.stackSpacing ?? 0))
    if (
      'stackReverseZIndex' in raw &&
      typeof raw.stackReverseZIndex === 'boolean'
    )
      node.itemReverseZIndex = raw.stackReverseZIndex
    node.padding = Math.max(
      0,
      raw.stackPadding ?? raw.stackHorizontalPadding ?? 0,
    )
    node.paddingLeft = Math.max(0, raw.stackHorizontalPadding ?? node.padding)
    node.paddingTop = Math.max(0, raw.stackVerticalPadding ?? node.padding)
    node.paddingRight = Math.max(0, raw.stackPaddingRight ?? node.paddingLeft)
    node.paddingBottom = Math.max(0, raw.stackPaddingBottom ?? node.paddingTop)
    // Figma omits the primary sizing field for Hug; an instance without it follows its main component.
    const primarySizing = raw.stackPrimarySizing ?? (raw.type === 'INSTANCE'
      ? records.get(guid(raw.symbolData?.symbolID))?.stackPrimarySizing : undefined)
    if (node.layout !== 'none')
      node[node.layout === 'row' ? 'widthSizing' : 'heightSizing'] =
        primarySizing === 'FIXED' ? 'fixed' : 'hug'
    if (raw.stackCounterSizing && stackMode !== 'GRID')
      node[node.layout === 'row' ? 'heightSizing' : 'widthSizing'] =
        raw.stackCounterSizing === 'FIXED' ? 'fixed' : 'hug'
    const counter = raw.stackCounterAlignItems ?? raw.stackCounterAlign
    node.alignItems =
      counter === 'BASELINE' && node.layout === 'row'
        ? 'baseline'
        : counter === 'CENTER' ? 'center' : counter === 'MAX' ? 'end' : 'start'
    const primary = raw.stackPrimaryAlignItems ?? raw.stackJustify
    node.justifyContent =
      primary === 'CENTER'
        ? 'center'
        : primary === 'MAX'
          ? 'end'
          : primary === 'SPACE_BETWEEN'
            ? 'between'
            : primary === 'SPACE_EVENLY'
              ? 'evenly'
              : 'start'
    const parentRaw = records.get(guid(raw.parentIndex?.guid))
    if (node.parentId && (raw.horizontalConstraint || raw.verticalConstraint)) {
      const horizontal = raw.horizontalConstraint ?? 'MIN',
        vertical = raw.verticalConstraint ?? 'MIN'
      const horizontalRules: Partial<
        Record<string, CopyOSDesignConstraints['horizontal']>
      > = {
        MIN: 'left',
        MAX: 'right',
        CENTER: 'center',
        STRETCH: 'left-right',
        SCALE: 'scale',
        FIXED_MIN: 'left',
        FIXED_MAX: 'right',
      } as const
      const verticalRules: Partial<
        Record<string, CopyOSDesignConstraints['vertical']>
      > = {
        MIN: 'top',
        MAX: 'bottom',
        CENTER: 'center',
        STRETCH: 'top-bottom',
        SCALE: 'scale',
        FIXED_MIN: 'top',
        FIXED_MAX: 'bottom',
      } as const
      node.constraints = {
        horizontal: horizontalRules[horizontal] ?? 'left',
        vertical: verticalRules[vertical] ?? 'top',
        referenceWidth: Math.max(
          1,
          Math.min(100000, Math.abs(parentRaw?.size?.x ?? 100)),
        ),
        referenceHeight: Math.max(
          1,
          Math.min(100000, Math.abs(parentRaw?.size?.y ?? 100)),
        ),
      }
      if (!(horizontal in horizontalRules) || !(vertical in verticalRules))
        warn('Unknown resize constraints use leading-edge pins')
      if (parentRaw?.layoutGrids?.length)
        warn(
          'Constraints use frame bounds; layout-guide-relative positioning requires review',
        )
      if (parentRaw?.type === 'GROUP')
        warn(
          'Grouped constraints use immediate group bounds; frame-relative group constraints require review',
        )
    }
    const parentStack = parentRaw?.stackMode
    if (
      (raw.stackChildPrimaryGrow ?? 0) > 0 &&
      parentStack &&
      (parentStack === 'HORIZONTAL' || parentStack === 'VERTICAL')
    )
      node[parentStack === 'HORIZONTAL' ? 'widthSizing' : 'heightSizing'] =
        'fill'
    if (
      raw.stackChildAlignSelf === 'STRETCH' &&
      parentStack &&
      (parentStack === 'HORIZONTAL' || parentStack === 'VERTICAL')
    )
      node[parentStack === 'HORIZONTAL' ? 'heightSizing' : 'widthSizing'] =
        'fill'
    const fills = raw.fillPaints ?? raw.backgroundPaints ?? []
    const fillBlendModes = new Map(fills.map(paint => [paint, paintBlendMode(paint, 'fill', warn)]))
    const fill = fills.filter(paint => paint.visible !== false).at(-1)
    node.fill = hex(fill?.color)
    node.fillOpacity = fill ? unit(fill.opacity) * unit(fill.color?.a) : 0
    const gradientPaint = (paint: Paint): CopyOSDesignNode['gradient'] => {
      if (paint.type !== 'GRADIENT_LINEAR' && paint.type !== 'GRADIENT_RADIAL')
        return undefined
      const t = paint.transform
      const stops = (paint.stops ?? []).map(stop => ({
        id: randomUUID(),
        position: unit(stop.position),
        color: hex(stop.color),
        opacity: unit(stop.color.a),
      }))
      return stops.length
        ? {
          type: paint.type === 'GRADIENT_LINEAR' ? 'linear' : 'radial',
          stops,
          transform: t
            ? [t.m00, t.m10, t.m01, t.m11, t.m02, t.m12]
            : [1, 0, 0, 1, 0, 0],
        }
        : undefined
    }
    const imagePaint = (paint: Paint): CopyOSDesignImagePaint | undefined => {
      if (paint.type !== 'IMAGE') return undefined
      const image = paint.image
      const data = image
        ? (images.get(hash(image.hash)) ??
          (image.dataBlob !== undefined ? blobs[image.dataBlob] : undefined))
        : undefined
      const url = raster(data)
      if (!url) {
        warn('Missing or unsupported embedded raster images')
        return undefined
      }
      const mode = paint.imageScaleMode
      if (mode && !['FILL', 'FIT', 'STRETCH'].includes(mode))
        warn('Image crop and tile transforms require review; imported as Fill')
      return {
        url,
        scaleMode:
          mode === 'FIT' ? 'fit' : mode === 'STRETCH' ? 'stretch' : 'fill',
      }
    }
    if (
      fills.length &&
      fills.every(p =>
        ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'IMAGE'].includes(
          p.type,
        ),
      ) &&
      (fills.length > 1 || fills[0]?.type === 'IMAGE' ||
        fills.some(paint => paint.visible === false || fillBlendModes.get(paint) !== 'normal'))
    )
      node.fills = fills.map(p => ({
        id: randomUUID(),
        color: hex(p.color),
        opacity:
          p.type === 'SOLID'
            ? unit(p.opacity) * unit(p.color?.a)
            : unit(p.opacity),
        visible: p.visible !== false,
        blendMode: fillBlendModes.get(p),
        variableId: null,
        gradient: gradientPaint(p),
        image: imagePaint(p),
      }))
    else if (fills.length > 1)
      warn('Mixed fill stacks use their top visible paint')
    const applyPaint = (paint: Paint): void => {
      if (!node.fills && fillBlendModes.get(paint) !== 'normal' &&
        ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'IMAGE'].includes(paint.type))
        node.fills = [{ id: randomUUID(), color: hex(paint.color),
          opacity: paint.type === 'SOLID' ? unit(paint.opacity) * unit(paint.color?.a) : unit(paint.opacity),
          visible: paint.visible !== false, variableId: null, blendMode: fillBlendModes.get(paint),
          gradient: gradientPaint(paint), image: imagePaint(paint) }]
      if (
        paint.type === 'GRADIENT_LINEAR' ||
        paint.type === 'GRADIENT_RADIAL'
      ) {
        node.gradient = gradientPaint(paint)
        node.fillOpacity = unit(paint.opacity)
      } else if (paint.type === 'IMAGE') {
        if (!node.fills) {
          const image = imagePaint(paint)
          if (image)
            node.fills = [
              {
                id: randomUUID(),
                color: '#ffffff',
                opacity: unit(paint.opacity),
                visible: true,
                variableId: null,
                image,
              },
            ]
        }
      } else if (paint.type !== 'SOLID') warn(`Unsupported ${paint.type} paint`)
    }
    if (fill) applyPaint(fill)
    if (fill?.colorVar?.value?.alias)
      warn(
        'Variable colors use saved values; native variable links are not imported',
      )
    if (raw.variableConsumptionMap?.entries?.length)
      warn(
        'Variable bindings use saved values; native variable links are not imported',
      )
    if (raw.styleIdForFill && !fills.length)
      warn('Linked fill styles without saved paint values require review')
    if (raw.prototypeInteractions?.length)
      warn('Prototype interactions are not imported')
    if (node.preserveLayout)
      warn(
        'Auto layout retains saved geometry; changing layout settings applies CopyOS layout rules',
      )
    const stroke = raw.strokePaints?.filter(p => p.visible !== false).at(-1)
    node.stroke = hex(stroke?.color)
    if (stroke)
      node.strokeAlign =
        raw.strokeAlign === 'INSIDE'
          ? 'inside'
          : raw.strokeAlign === 'OUTSIDE'
            ? 'outside'
            : 'center'
    node.strokeWidth = stroke ? Math.max(0, raw.strokeWeight ?? 1) : 0
    node.strokeOpacity = unit(stroke?.opacity) * unit(stroke?.color?.a)
    if (raw.strokePaints !== undefined) {
      const paints: CopyOSDesignPaint[] = []
      for (const paint of raw.strokePaints) {
        const blendMode = paintBlendMode(paint, 'stroke', warn)
        const gradient = gradientPaint(paint)
        const image = imagePaint(paint)
        if (paint.type !== 'SOLID' && !gradient && !image) {
          warn(`Unsupported or incomplete ${paint.type} stroke paint is omitted`)
          continue
        }
        if (paint.colorVar?.value?.alias)
          warn('Variable colors use saved values; native variable links are not imported')
        paints.push({
          id: randomUUID(), color: hex(paint.color),
          opacity: paint.type === 'SOLID' ? unit(paint.opacity) * unit(paint.color?.a) : unit(paint.opacity),
          visible: paint.visible !== false, variableId: null, gradient, image, blendMode,
        })
      }
      node.strokes = paints
      node.strokeOpacity = 1
      // Keep hidden paints editable without losing their authored stroke geometry.
      node.strokeWidth = Math.max(0, raw.strokeWeight ?? 1)
      node.strokeAlign = raw.strokeAlign === 'INSIDE' ? 'inside' : raw.strokeAlign === 'OUTSIDE' ? 'outside' : 'center'
      if (node.kind === 'instance')
        node.instanceStroke = { strokes: paints, strokeOpacity: 1,
          ...(raw.strokeWeight !== undefined && raw.borderStrokeWeightsIndependent !== true ? { strokeWidth: node.strokeWidth } : {}),
          ...(raw.strokeAlign !== undefined ? { strokeAlign: node.strokeAlign } : {}) }
    }
    independentStroke(raw,node,warn)
    importStrokeStyle(raw,node,warn)
    if (node.kind === 'instance') delete node.strokes
    node.effects = importFigEffects(raw, node, warn)
    if (raw.mask) warn('Mask relationships require review')
    if (raw.blendMode !== undefined) node.blendMode = layerBlendMode(raw.blendMode, warn)
    else delete node.blendMode
    if (raw.type === 'TEXT') {
      node.text = raw.textData?.characters ?? ''
      node.fontFamily = raw.fontName?.family ?? 'Inter'
      node.textWrap = raw.textAutoResize !== 'WIDTH_AND_HEIGHT' && figTextSoftWraps(raw)
      node.letterSpacing = Math.max(
        -1000,
        Math.min(
          1000,
          (raw.letterSpacing?.value ?? 0) *
            (raw.letterSpacing?.units === 'PERCENT'
              ? (raw.fontSize ?? 16) / 100
              : 1),
        ),
      )
      node.fontSize = Math.max(1, Math.min(1000, raw.fontSize ?? 16))
      const style = raw.fontName?.style.toLowerCase() ?? ''
      node.fontStyle =
        style.includes('italic') || style.includes('oblique')
          ? 'italic'
          : 'normal'
      node.fontWeight = Math.max(
        100,
        Math.min(
          900,
          Math.round(
            raw.fontWeight ??
              (style.includes('semibold') || style.includes('demibold')
                ? 600
                : style.includes('extrabold')
                  ? 800
                  : style.includes('black') || style.includes('heavy')
                    ? 900
                    : style.includes('bold')
                      ? 700
                      : style.includes('medium')
                        ? 500
                        : style.includes('extralight')
                          ? 200
                          : style.includes('light')
                            ? 300
                            : style.includes('thin')
                              ? 100
                              : 400),
          ),
        ),
      )
      const lineHeight = raw.lineHeight && figLineHeightRatio(raw.lineHeight, node.fontSize, warn)
      node.lineHeight = lineHeight === undefined ? FIG_AUTO_LINE_HEIGHT : Math.max(0.5, Math.min(10, lineHeight))
      node.textAlign =
        raw.textAlignHorizontal === 'CENTER'
          ? 'center'
          : raw.textAlignHorizontal === 'RIGHT'
            ? 'right'
            : 'left'
      node.fontFeatures = importFigFontFeatures(raw, warn)
      node.textRuns = importFigTextRuns(raw, node, warn)
      node.textRuns = importFigTextHyperlinks(raw, node, ids, warn)
      if (raw.textData?.characters && raw.textPathStart)
        warn('Text on a path uses editable straight text')
    }
    if (node.kind === 'path') {
      try {
        const paths = (
          raw.fillGeometry?.length
            ? raw.fillGeometry
            : (raw.strokeGeometry ?? [])
        ).flatMap((g) => {
          const blob =
            g.commandsBlob === undefined ? undefined : blobs[g.commandsBlob]
          return blob
            ? [
              {
                d: pathCommands(blob),
                fillRule:
                    g.windingRule === 'ODD'
                      ? ('evenodd' as const)
                      : ('nonzero' as const),
              },
            ]
            : []
        })
        const network = paths.length ? undefined : figVectorNetwork(raw.vectorData)
        const networkBlob = network ? blobs[network.blob] : undefined
        const networkPaths = network && networkBlob
          ? figVectorNetworkPaths(networkBlob, Number.isNaN(network.width) ? 1 : node.width / network.width,
            Number.isNaN(network.height) ? 1 : node.height / network.height)
          : []
        if (paths.length || networkPaths.length)
          node.pathData = { width: node.width, height: node.height, paths: paths.length ? paths : networkPaths }
        else if (!importStraightLine(raw, node, warn)) {
          node.kind = 'rectangle'
          warn('Vector layers without saved geometry use editable bounds')
        }
      } catch {
        node.kind = 'rectangle'
        warn('Unsupported vector geometry uses editable bounds')
      }
    }
    if (node.kind === 'instance') {
      const componentId = ids.get(guid(raw.symbolData?.symbolID))
      if (
        componentId &&
        ['SYMBOL', 'COMPONENT'].includes(
          records.get(guid(raw.symbolData?.symbolID))?.type ?? '',
        )
      )
        node.componentId = componentId
      else {
        editableFrame(node)
        warn(
          'Instances with unavailable masters are imported as independent frames',
        )
      }
    }
    if (raw.minSize !== undefined || raw.maxSize !== undefined) {
      const bounds = readSizeBounds(raw, warn)
      Object.assign(node, bounds)
      boundClaims.set(node.id, Object.keys(bounds) as FigSizeBound[])
      boundedRaw.add(node.id)
    }
    const ratio = readAspectRatio(raw, warn)
    if (ratio !== undefined) Object.assign(node, { targetAspectRatio: ratio })
    nodes.push(node)
  }
  const parentIds = new Set(nodes.map(node => node.parentId))
  // Saved instance children include overrides. Keep those editable instead of discarding them.
  for (const node of nodes)
    if (node.kind === 'instance' && parentIds.has(node.id)) {
      if (node.blendMode === undefined) node.blendMode = nodes.find(source => source.id === node.componentId)?.blendMode
      if (node.targetAspectRatio === undefined)
        node.targetAspectRatio = nodes.find(source => source.id === node.componentId)?.targetAspectRatio
      editableFrame(node)
      warn(
        'Instances with explicit overrides are imported as independent editable frames',
      )
    }
  const byId = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes)
    if (node.parentId) {
      const parent = byId.get(node.parentId)
      if (parent && !['frame', 'group', 'component'].includes(parent.kind)) {
        editableFrame(parent)
      }
    }
  for (const node of nodes) {
    const source = node.kind === 'instance' ? byId.get(node.componentId ?? '') : undefined
    if (!source || !boundedRaw.has(node.id) && !boundedRaw.has(source.id)) continue
    const claims = new Set(boundClaims.get(node.id) ?? [])
    for (const [min, max] of [['minWidth', 'maxWidth'], ['minHeight', 'maxHeight']] as const) {
      const minimum = claims.has(min) ? node[min] : source[min], maximum = claims.has(max) ? node[max] : source[max]
      if ((minimum ?? 0) > (maximum ?? 100000)) {
        claims.delete(min); claims.delete(max)
        if (min === 'minWidth') { delete node.minWidth; delete node.maxWidth }
        else { delete node.minHeight; delete node.maxHeight }
        warn('Incompatible native instance size bounds require review; source axis bounds are inherited')
      }
    }
    node.instanceSizingOverrides = ['width', 'height', 'widthSizing', 'heightSizing', ...claims]
  }
  importFigGrids(nodes, new Map(visual.flatMap((raw) => {
    const id = ids.get(guid(raw.guid))
    return id ? [[id, raw] as const] : []
  })), warn)
  importInstanceStyleOverrides(nodes, visual, ids, warn)
  const variantNodes = importFigVariants(nodes, new Map(visual.flatMap((raw) => {
    const id = ids.get(guid(raw.guid))
    return id ? [[id, raw] as const] : []
  })), warn)
  const now = new Date().toISOString()
  const document: CopyOSDesignDocument = {
    schema: 'copyos.design',
    version: 1,
    id: randomUUID(),
    title: fileName.replace(/\.fig$/i, '').slice(0, 160) || 'Imported design',
    revision: 0,
    nodes: variantNodes,
    variables: [],
    pages,
    source: {
      format: 'fig',
      fileName: fileName.slice(0, 255),
      importedAt: now,
      warnings: [...warnings]
        .slice(0, 99)
        .map(([reason, count]) => `${reason} (${count})`),
    },
    createdAt: now,
    updatedAt: now,
  }
  return { document, ids }
}
