import { normalizeDesignFontVariations } from './design-font-variations.ts'
import { designTextMetricRuns } from './design-text-runs.ts'
/** Node-only SkParagraph measurement; the browser model never loads this WASM runtime. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { create as readFont } from 'fontkit'
import type { Canvas, CanvasKit, CanvasKitInitOptions, Paragraph, ParagraphBuilder, TextStyle } from 'canvaskit-wasm'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { tokenize, isTokenIdent, isTokenString, isTokenComma, isTokenWhitespace, isTokenComment, isTokenEOF } from '@csstools/css-tokenizer'
import { designTextSegments } from './design-text-runs.ts'
import { designTextBaselineSignature } from './design-baseline.ts'
import { designTextLayoutSignature } from './design-text-layout.ts'
import { designTextOverflowSignature } from './design-text-overflow.ts'
import type { CopyOSDesignNode, CopyOSDesignTextMeasurementEngine } from './types.ts'
import type { DesignSvgTextLine } from './design-svg-text.ts'
/** Draws laid-out paragraphs onto a canvas in layer coordinates; `color` resolves a run fill or the layer's base color. */
interface TextPainter { canvas: Canvas; offsetY: number; color: (fill: string | undefined) => Float32Array }
type RegisteredFace = { family: string; weight: number; style: 'normal' | 'italic'; alias: string; variations: { axis: string; value: number }[] }
import type { DesignMeasurementFont, DesignTextMeasurer, DesignTextMeasurerOptions, DesignTextMeasurementResult } from './design-text-measurement-types.ts'
export type { DesignMeasurementFont, DesignTextMeasurer, DesignTextMeasurerOptions, DesignTextMeasurementResult } from './design-text-measurement-types.ts'

// CanvasKit ships a CommonJS function with an ESM default declaration; use its actual Node entry.
const loader: unknown = createRequire(import.meta.url)('canvaskit-wasm')
if (typeof loader !== 'function') throw new Error('CanvasKit did not expose its Node initializer')
const CanvasKitInit = loader as (options?: CanvasKitInitOptions) => Promise<CanvasKit>
let runtime: Promise<CanvasKit> | undefined
const loadRuntime = (): Promise<CanvasKit> => runtime ??= CanvasKitInit({
  locateFile: () => fileURLToPath(import.meta.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
})

/** Load the identical OFL Inter Latin variable font shipped by the browser, with explicit normal-weight coverage.
 * @returns Nine catalog entries over the same bytes, representing the font's supported 100–900 weight axis.
 */
export async function loadBundledDesignMeasurementFonts(): Promise<DesignMeasurementFont[]> {
  const data = new Uint8Array(await readFile(new URL('../fonts/Inter-latin.woff2', import.meta.url)))
  return Array.from({ length: 9 }, (_, index) => ({ family: 'Inter', weight: (index + 1) * 100, style: 'normal', data }))
}

function families(value: string): string[] | null {
  const groups: { names: string[]; quoted: boolean }[] = [{ names: [], quoted: false }]
  let valid = true
  for (const token of tokenize({ css: value }, { onParseError: () => { valid = false } })) {
    const group = groups.at(-1)
    if (!group) return null
    if (isTokenWhitespace(token) || isTokenComment(token) || isTokenEOF(token)) continue
    if (isTokenComma(token)) { groups.push({ names: [], quoted: false }); continue }
    if (isTokenString(token) && !group.names.length) { group.names.push(token[4].value); group.quoted = true }
    else if (isTokenIdent(token) && !group.quoted) group.names.push(token[4].value)
    else valid = false
  }
  return valid && groups.every(group => group.names.length) ? groups.map(group => group.names.join(' ')) : null
}

/** Initialize an explicit font provider for real wrapping, shaping and line metrics without a browser or GPU.
 * @param options - Caller-supplied font bytes and finite text/line work limits; no system-font lookup is performed.
 * @returns A disposable measurer whose failures never contain guessed metrics. Its engine identity distinguishes native caches.
 */
export async function createDesignTextMeasurer(options: DesignTextMeasurerOptions): Promise<DesignTextMeasurer> {
  const maxTextLength = options.maxTextLength ?? 200000, maxLines = options.maxLines ?? 200000
  if (!Number.isInteger(maxTextLength) || maxTextLength < 1 || maxTextLength > 200000 ||
    !Number.isInteger(maxLines) || maxLines < 1 || maxLines > 200000) throw new Error('Invalid text measurement budget')
  if (!options.fonts.length || options.fonts.length > 32) throw new Error('Provide 1–32 explicit measurement fonts')
  let bytes = 0
  const identities = new Set<string>()
  for (const font of options.fonts) {
    bytes += font.data.byteLength
    const id = `${font.family.toLowerCase()}\0${font.weight}\0${font.style}`
    if (!font.family.trim() || font.family.length > 200 || !Number.isInteger(font.weight) || font.weight < 1 || font.weight > 1000 ||
      !['normal', 'italic'].includes(font.style) || !font.data.length || font.data.length > 32000000 || identities.has(id))
      throw new Error('Invalid or duplicate measurement font')
    identities.add(id)
  }
  if (bytes > 64000000) throw new Error('Measurement font catalog exceeds its byte budget')
  const ck = await loadRuntime(), provider = ck.TypefaceFontProvider.Make()
  const engine: CopyOSDesignTextMeasurementEngine = { name: 'skparagraph', version: '0.42.0', layoutVersion: 2, fonts: [] }
  let catalog: RegisteredFace[]
  try { catalog = options.fonts.map((font, index): RegisteredFace => {
    const data = font.data.slice()
    let parsed: ReturnType<typeof readFont>
    try { parsed = readFont(Buffer.from(data)) }
    catch (error) { throw new Error('Unreadable measurement font', { cause: error }) }
    if ('fonts' in parsed) throw new Error('Measurement font collections require an individual face')
    const weight = parsed.variationAxes.wght, italic = parsed.variationAxes.ital, slant = parsed.variationAxes.slnt
    const actualItalic = parsed['OS/2'].fsSelection.italic || parsed.italicAngle !== 0
    const variableNormal = !!italic && italic.min <= 0 && italic.max >= 0 || !!slant && slant.min <= 0 && slant.max >= 0
    const variableItalic = !!italic && italic.min <= 1 && italic.max >= 1 || !!slant && (slant.min < 0 || slant.max > 0)
    if ((weight ? font.weight < weight.min || font.weight > weight.max : font.weight !== parsed['OS/2'].usWeightClass) ||
      (font.style === 'italic' ? !actualItalic && !variableItalic : actualItalic && !variableNormal)) {
      throw new Error('Measurement font does not provide its declared weight or style')
    }
    const face = ck.Typeface.MakeFreeTypeFaceFromData(data.buffer)
    if (!face) throw new Error('Unreadable measurement font')
    face.delete()
    const alias = `CopyOSMeasurement${index}`
    provider.registerFont(data, alias)
    if (provider.countFamilies() !== index + 1) throw new Error('Measurement font registration failed')
    engine.fonts.push({ family: font.family, weight: font.weight, style: font.style, sha256: bytesToHex(sha256(data)) })
    return { family: font.family, weight: font.weight, style: font.style, alias, variations: [
      ...(weight ? [{ axis: 'wght', value: font.weight }] : []),
      ...(italic ? [{ axis: 'ital', value: font.style === 'italic' ? 1 : 0 }] : []),
      ...(slant ? [{ axis: 'slnt', value: font.style === 'italic' ? slant.min < 0 ? slant.min : slant.max : 0 }] : []),
    ] }
  }) } catch (error) { provider.delete(); throw error }
  let disposed = false
  /** Placement of the most recent layout: the vertical-alignment shift and the truncation height, when truncated. */
  let placement: { shift: number; overflowHeight: number | undefined; missing: number[] } =
    { shift: 0, overflowHeight: undefined, missing: [] }
  return {
    engine,
    dispose() { if (!disposed) { disposed = true; provider.delete() } },
    measure: node => layout(node, null, null),
    lines(node) {
      const lines: DesignSvgTextLine[] = []
      return layout(node, lines, null, true).state === 'measured' ? lines : undefined
    },
    paint(node, paint, scale) {
      if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error('Text paint scale must be within 0–4')
      const measured = layout(node, null, null, true)
      if (measured.state !== 'measured') return undefined
      const { shift, overflowHeight, missing } = placement
      const width = Math.max(node.width, measured.layout.width), height = Math.max(node.height, measured.layout.height + shift)
      const surface = ck.MakeSurface(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)))
      if (!surface) throw new Error('Text paint surface could not be created')
      try {
        const canvas = surface.getCanvas()
        canvas.clear(ck.TRANSPARENT)
        canvas.scale(scale, scale)
        if (overflowHeight !== undefined) canvas.clipRect(ck.XYWHRect(0, shift, width, overflowHeight), ck.ClipOp.Intersect, true)
        const base = ck.multiplyByAlpha(ck.parseColorString(paint.color), paint.opacity)
        const painted = layout(node, null, { canvas, offsetY: shift,
          color: fill => fill === undefined ? base : ck.parseColorString(fill) }, true)
        if (painted.state !== 'measured') return undefined
        const image = surface.makeImageSnapshot()
        try {
          const png = image.encodeToBytes()
          return png ? { png, width, height, missingCodepoints: missing } : undefined
        } finally { image.delete() }
      } finally { surface.delete() }
    },
  }
  /**
   * One paragraph-engine pass; `collect` receives the visible lines in layer coordinates and `painter` draws them, when supplied.
   * Drawing passes `allowMissingGlyphs`, so characters the fonts lack are reported in `placement` instead of refusing the layer.
   */
  function layout(node: CopyOSDesignNode, collect: DesignSvgTextLine[] | null, painter: TextPainter | null,
    allowMissingGlyphs = false): DesignTextMeasurementResult {
    if (disposed) throw new Error('Text measurer is disposed')
    if (node.kind !== 'text' || !Number.isFinite(node.fontSize) || node.fontSize <= 0 || !Number.isFinite(node.lineHeight) ||
        node.lineHeight <= 0 || !Number.isFinite(node.width) || node.width <= 0 || node.textCase === 'capitalize' || node.text.includes('\t'))
      return { state: 'unavailable', code: 'unsupported-style' }
    if (node.text.length > maxTextLength) return { state: 'unavailable', code: 'budget' }
    const metricRuns = designTextMetricRuns(node)
    const segments = designTextSegments({ ...node, textRuns: metricRuns })
    const baseSegment = { start: 0, end: 0, text: '', style: {
      fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight,
      fontStyle: node.fontStyle ?? 'normal', lineHeight: node.lineHeight,
      fontFeatures: node.fontFeatures ?? [], fontVariations: normalizeDesignFontVariations(node.fontVariations ?? []), letterSpacing: node.letterSpacing ?? 0, textDecoration: node.textDecoration ?? 'none',
    } }
    const requestedSegments = segments.length ? segments : [baseSegment]
    const styles: TextStyle[] = []
    for (const segment of [baseSegment, ...requestedSegments]) {
      const value = segment.style, names = families(value.fontFamily)
      if (!names?.length) return { state: 'unavailable', code: 'unsupported-style' }
      const family = names[0] ?? '', requested = catalog.filter(font => font.family.toLowerCase() === family.toLowerCase())
      if (!requested.length) return { state: 'unavailable', code: 'missing-family', family }
      const primary = requested.find(font => font.weight === value.fontWeight && font.style === value.fontStyle)
      if (!primary) return { state: 'unavailable', code: 'missing-style', family }
      const fallback = names.slice(1).flatMap(name => catalog.filter(font => font.family.toLowerCase() === name.toLowerCase() &&
          font.weight === value.fontWeight && font.style === value.fontStyle))
      styles.push({ fontFamilies: [primary, ...fallback].map(font => font.alias), fontSize: value.fontSize,
        fontStyle: { weight: { value: value.fontWeight }, slant: value.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright },
        fontFeatures: value.fontFeatures.map(feature => ({ name: feature.tag, value: feature.value })),
        fontVariations: [...new Map([...primary.variations, ...value.fontVariations.map(item => ({ axis: item.tag, value: item.value }))]
          .map(item => [item.axis, item])).values()], heightMultiplier: value.lineHeight,
        halfLeading: true, letterSpacing: value.letterSpacing,
        ...(painter ? { color: painter.color('fill' in value && typeof value.fill === 'string' ? value.fill : undefined),
          decoration: value.textDecoration === 'underline' ? ck.UnderlineDecoration : value.textDecoration === 'line-through' ? ck.LineThroughDecoration : ck.NoDecoration,
        } : {}) })
    }
    const transform = (value: string) => node.textCase === 'uppercase' ? value.toUpperCase() : node.textCase === 'lowercase' ? value.toLowerCase() : value
    const transformed = transform(node.text)
    if (transformed.length > maxTextLength) return { state: 'unavailable', code: 'budget' }
    const transformedOffsets = new Map<number, number>([[0, 0]])
    // Case conversion can change UTF-16 lengths; engine offsets map back to the source code point that produced them.
    const sourceOffsets: number[] = [0]
    let sourceOffset = 0, transformedOffset = 0
    for (const point of node.text) {
      const before = transformedOffset
      sourceOffset += point.length; transformedOffset += transform(point).length
      for (let offset = before + 1; offset < transformedOffset; offset++) sourceOffsets[offset] = sourceOffset - point.length
      transformedOffsets.set(sourceOffset, transformedOffset)
      sourceOffsets[transformedOffset] = sourceOffset
    }
    const toSource = (offset: number): number => sourceOffsets[Math.min(Math.max(0, offset), sourceOffsets.length - 1)] ?? node.text.length
    const noWrap = node.textSizing === 'auto-width' || node.textWrap === false
    const spacing = node.paragraphSpacing ?? 0, paragraphs = spacing > 0 ? node.text.split('\n') : [node.text]
    if (paragraphs.length > maxLines) return { state: 'unavailable', code: 'budget' }
    const style = styles[0]
    if (!style?.fontFamilies) throw new Error('Missing prepared base measurement style')
    const fontFamilies = style.fontFamilies
    const rich = !!metricRuns?.length
    let paragraphOffset = 0
    let width = 0, height = 0, baseline = 0, lineCount = 0
    const collected: (DesignSvgTextLine & { bottom: number })[] = []
    const bottoms: number[] = []
    const unresolved = new Set<number>()
    for (const [index, content] of paragraphs.entries()) {
      let builder: ParagraphBuilder | undefined, paragraph: Paragraph | undefined
      try {
        builder = ck.ParagraphBuilder.MakeFromFontProvider(new ck.ParagraphStyle({ textStyle: style,
          strutStyle: { strutEnabled: true, fontFamilies, fontSize: node.fontSize,
            fontStyle: { weight: { value: node.fontWeight }, slant: node.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright },
            heightMultiplier: node.lineHeight, halfLeading: true, forceStrutHeight: !rich },
          textAlign: node.textAlign === 'center' ? ck.TextAlign.Center : node.textAlign === 'right' ? ck.TextAlign.Right : ck.TextAlign.Left }), provider)
        for (const [segmentIndex, segment] of requestedSegments.entries()) {
          const start = Math.max(paragraphOffset, segment.start), end = Math.min(paragraphOffset + content.length, segment.end)
          if (start >= end) continue
          const runStyle = styles[segmentIndex + 1]
          if (!runStyle) throw new Error('Missing prepared run measurement style')
          builder.pushStyle(new ck.TextStyle(runStyle))
          builder.addText(transformed.slice(transformedOffsets.get(start), transformedOffsets.get(end)))
          builder.pop()
        }
        const paragraphStart = transformedOffsets.get(paragraphOffset) ?? 0
        paragraphOffset += content.length + (spacing > 0 ? 1 : 0)
        paragraph = builder.build()
        // Intrinsic width is measured by the engine; 1e9 is a finite nonwrapping layout domain, never a guessed character width.
        paragraph.layout(noWrap ? 1e9 : node.width)
        for (const point of paragraph.unresolvedCodepoints()) unresolved.add(point)
        const lines = paragraph.getLineMetrics()
        lineCount += Math.max(lines.length, content ? 0 : 1)
        if (lineCount > maxLines) return { state: 'unavailable', code: 'budget' }
        if (index === 0) baseline = paragraph.getAlphabeticBaseline()
        width = Math.max(width, noWrap ? paragraph.getMaxIntrinsicWidth() : Math.max(paragraph.getLongestLine(), node.width))
        let lineBottom = height
        for (const line of lines) { lineBottom += line.height; bottoms.push(lineBottom) }
        if (collect || painter) {
          // A nonwrapping layout aligns inside its 1e9 domain; lines are read again at the layer's own width.
          if (noWrap) paragraph.layout(Math.max(node.width, Math.ceil(paragraph.getMaxIntrinsicWidth())))
          painter?.canvas.drawParagraph(paragraph, 0, height + painter.offsetY)
        }
        if (collect) {
          let bottom = height
          for (const line of paragraph.getLineMetrics()) {
            bottom += line.height
            collected.push({ start: toSource(paragraphStart + line.startIndex), end: toSource(paragraphStart + line.endIndex),
              x: line.left, baseline: height + line.baseline, bottom })
          }
        }
        // Empty DOM content retains min-height:1em; explicit empty paragraph blocks retain one declared line.
        const emptyHeight = spacing > 0 ? node.fontSize * node.lineHeight : node.fontSize
        if (!content && !lines.length) bottoms.push(height + emptyHeight)
        height += content ? paragraph.getHeight() : emptyHeight
        if (index < paragraphs.length - 1) height += spacing
      } finally { paragraph?.delete(); builder?.delete() }
    }
    if (unresolved.size && !allowMissingGlyphs) return { state: 'unavailable', code: 'missing-glyph', family: families(requestedSegments[0]?.style.fontFamily ?? node.fontFamily)?.[0] ?? node.fontFamily, codepoints: [...unresolved].slice(0, 256) }
    width = Math.max(1, Math.ceil(width)); height = Math.max(1, Math.ceil(height))
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(baseline) || width > 100000 || height > 100000)
      return { state: 'unavailable', code: 'budget' }
    const fixed = !node.textSizing || node.textSizing === 'fixed'
    const available = fixed ? node.height : node.maxHeight ?? Infinity
    let visibleLines = 0, visibleHeight = 0
    for (const bottom of bottoms) {
      if (visibleLines >= (node.maxLines ?? Infinity) || bottom > available + 0.01) break
      visibleLines++; visibleHeight = bottom
    }
    const overflow = node.textTruncation === 'ending' && (Number.isFinite(available) || node.maxLines != null)
      ? { signature: designTextOverflowSignature(node), lines: Math.max(1, visibleLines),
        height: Math.max(1, Math.min(available, visibleHeight || node.fontSize * node.lineHeight)) } : undefined
    const verticalSpace = fixed && node.verticalAlign !== 'top' ? Math.max(0, node.height - Math.min(height, overflow?.height ?? height)) : 0
    const shift = node.verticalAlign === 'bottom' ? verticalSpace : node.verticalAlign === 'center' ? verticalSpace / 2 : 0
    baseline += shift
    placement = { shift, overflowHeight: overflow?.height, missing: [...unresolved].slice(0, 256) }
    if (collect) {
      const shown = overflow ? collected.slice(0, overflow.lines) : collected
      const truncated = collected.length > shown.length
      for (const [index, line] of shown.entries()) {
        collect.push({ start: line.start, end: line.end, x: line.x, baseline: line.baseline + shift,
          ...(truncated && index === shown.length - 1 ? { ellipsis: true } : {}) })
      }
    }
    return { state: 'measured', layout: { signature: designTextLayoutSignature(node), width, height, engine,
      ...(overflow ? { overflow } : {}) }, baseline: { signature: designTextBaselineSignature(node), baseline, engine } }
  }
}
