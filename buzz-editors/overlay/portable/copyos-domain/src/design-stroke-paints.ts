import { designFontVariationSettings } from './design-font-variations.ts'
import { designFontFeatureSettings } from './design-font-features.ts'
import svgpath from 'svgpath'
import { nodeCssFontFamily } from './design-node-css-font.ts'
import { designTextHtmlContent } from './design-text-html.ts'
import type { DesignTextHtmlOptions } from './design-text-html.ts'
import { designTextSegments } from './design-text-runs.ts'
import { designStrokeStyle } from './design-stroke-style.ts'
/** Stroke paint authoring retains live resources and independent geometry ownership. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { applyDesignInstanceStroke, designStrokePaintGeometry } from './design-stroke.ts'
import { designColorCssValue } from './design-color.ts'
import { editDesignNodes, editDesignInstanceStroke, designGradientDefinition, designImageDefinition, designRectanglePath, designTextOverflow, designNodePaints } from './design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignPaint } from './types.ts'
/** Read bottom-to-top stroke paints, using one opaque legacy paint without baking composite stroke opacity.
 * @param node - Authored or resolved node.
 * @returns Explicit stack (including empty), or a stable legacy paint keyed by the layer identity.
 */
export function designNodeStrokePaints(node: CopyOSDesignNode): CopyOSDesignPaint[] {
  return node.strokes ?? [{ id: node.id, color: node.stroke, opacity: 1, visible: true,
    variableId: node.strokeVariableId ?? null }]
}
/** Read editable effective stroke paints without baking active-mode RGB or alpha values.
 * @param document - Complete authored document.
 * @param nodeOrId - Stored/selected node or identity; document storage remains the authority.
 * @returns Independent raw stack inheriting the current main when no local stack is owned.
 */
export function designAuthoredStrokePaints(document: CopyOSDesignDocument, nodeOrId: CopyOSDesignNode | string): CopyOSDesignPaint[] {
  const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
  const node = document.nodes.find(item => item.id === id)
  if (!node) throw new Error('Stroke layer not found')
  const source = node.kind === 'instance' ? document.nodes.find(item => item.id === node.componentId) : undefined
  return structuredClone(designNodeStrokePaints(source ? applyDesignInstanceStroke(source, node) : node))
}
/** Edit/capture a stroke stack without flattening references, geometry or composite opacity.
 * @param document - Complete native document.
 * @param nodeId - Stored ordinary layer or linked instance identity.
 * @param paints - New bottom-to-top stack; empty owns no paint, undefined restores legacy/inherited stack.
 * @param newId - Optional allocator; inherited/legacy capture receives fresh paint/stop identities, owned edits retain identities.
 * @returns Independent candidate; native validation checks all paints/resources/modes before save.
 */
export function editDesignStrokePaints(document: CopyOSDesignDocument, nodeId: string,
  paints: readonly CopyOSDesignPaint[] | undefined, newId: () => string = randomUUID): CopyOSDesignDocument {
  const node = document.nodes.find(item => item.id === nodeId)
  if (!node) throw new Error('Stroke layer not found')
  if (paints === undefined) return node.kind === 'instance' ? editDesignInstanceStroke(document, nodeId, { strokes: undefined }) :
    editDesignNodes(document, [{ id: nodeId, strokes: undefined }])
  const authored = new Map(designAuthoredStrokePaints(document, nodeId).map(paint => [paint.id, paint]))
  const capture = node.kind === 'instance' ? node.instanceStroke?.strokes === undefined : node.strokes === undefined
  const rawColor = (color: string, binding: string | null | undefined, fallback: string | undefined) =>
    binding && !/^#[\da-f]{6}$/i.test(color) ? fallback ?? designColorCssValue(color)?.value ?? color : color
  const strokes = paints.map((paint) => {
    const prior = authored.get(paint.id)
    return { ...structuredClone(paint), id: capture ? newId() : paint.id,
      color: rawColor(paint.color, paint.variableId, prior?.color),
      gradient: paint.gradient ? { ...structuredClone(paint.gradient), stops: paint.gradient.stops.map(stop => ({
        ...stop, id: capture ? newId() : stop.id,
        color: rawColor(stop.color, stop.variableId, prior?.gradient?.stops.find(item => item.id === stop.id)?.color),
      })) } : undefined }
  })
  return node.kind === 'instance' ? editDesignInstanceStroke(document, nodeId, { strokes }) :
    editDesignNodes(document, [{ id: nodeId, strokes }])
}

/** Build a stroke paint server in physical layer coordinates, independent of ring/stroke bounding boxes.
 * @param paint - Resolved solid/gradient/image paint.
 * @param id - Caller-owned channel-namespaced paint identity.
 * @param width - Nominal source layer width.
 * @param height - Nominal source layer height.
 * @returns Definition markup; solid paints need none.
 */
export function designStrokePaintDefinition(paint: CopyOSDesignPaint, id: string, width: number, height: number): string {
  if (paint.image) return designImageDefinition(paint.image, id, width, height)
  if (!paint.gradient) return ''
  return designGradientDefinition(paint.gradient, id, []).replace('gradientTransform="',
    `gradientUnits="userSpaceOnUse" gradientTransform="scale(${width} ${height}) `)
}
/** Composite exact browser glyph outlines with the same paint stack used for vector strokes.
 * @param node - Resolved text source; SourceAlpha must be its white CSS text-stroke, with transparent glyph fill.
 * @param id - Filter identity.
 * @param paintsId - Local SVG group containing bottom-to-top physical paint rectangles.
 * @param glyphId - Local browser-rendered white glyph fill for inside/outside clipping.
 * @returns SVG filter definition; text wrapping remains in the original browser foreignObject.
 */
export function designTextStrokeFilterDefinition(node: CopyOSDesignNode, id: string, paintsId: string, glyphId: string): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const box = designStrokePaintGeometry(node).bounds
  const bounds = `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`
  const image = (target: string, result: string) => `<feImage href="#${escape(target)}" ${bounds} preserveAspectRatio="none" result="${result}"/>`
  const alignment = node.strokeAlign ?? 'center'
  return `<filter id="${escape(id)}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${bounds} color-interpolation-filters="sRGB">` +
    (alignment === 'center' ? '' : image(glyphId, 'glyph') + `<feComposite in="SourceAlpha" in2="glyph" operator="${alignment === 'inside' ? 'in' : 'out'}" result="outline"/>`) +
    image(paintsId, 'paints') + `<feComposite in="paints" in2="${alignment === 'center' ? 'SourceAlpha' : 'outline'}" operator="in"/></filter>`
}

function designGlyphMarkup(node: CopyOSDesignNode, strokeWidth?: number, overflowVisible = true,
  options: DesignTextHtmlOptions = {}): string {
  const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const overflow = designTextOverflow(node)
  const vertical = node.verticalAlign && node.verticalAlign !== 'top' && (!node.textSizing || node.textSizing === 'fixed')
  const text = designTextHtmlContent(node, { mode: strokeWidth === undefined ? 'mask' : 'stroke-mask', ...options })
  return `<foreignObject${options.mode === 'link-overlay' ? ' pointer-events="none"' : ' aria-hidden="true" pointer-events="none"'} width="${node.width}" height="${node.height}" overflow="${overflowVisible || (node.textWrap === false && !overflow) ? 'visible' : 'hidden'}"><div xmlns="http://www.w3.org/1999/xhtml" style="${vertical ? `min-height:100%;display:flex;flex-direction:column;justify-content:${node.verticalAlign === 'center' ? 'center' : 'flex-end'};` : ''}"><div style="color:${strokeWidth === undefined ? 'white' : 'transparent'};-webkit-text-fill-color:${strokeWidth === undefined ? 'white' : 'transparent'};-webkit-text-stroke:${strokeWidth ?? 0}px white;font-family:${esc(nodeCssFontFamily(node.fontFamily))};font-size:${node.fontSize}px;font-weight:${node.fontWeight};font-feature-settings:${esc(designFontFeatureSettings(node.fontFeatures))};font-variation-settings:${esc(designFontVariationSettings(node.fontVariations))};font-style:${node.fontStyle ?? 'normal'};text-decoration:none;text-transform:${node.textCase ?? 'none'};letter-spacing:${node.letterSpacing ?? 0}px;line-height:${node.lineHeight};text-align:${node.textAlign};white-space:${node.textWrap === false || node.textSizing === 'auto-width' ? 'pre' : 'pre-wrap'};overflow-wrap:break-word;${overflow ? `${overflow.nowrap ? 'display:block;width:100%;' : `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${overflow.lines};`}overflow:hidden;text-overflow:ellipsis;max-height:${overflow.height}px;` : ''}">${text}</div></div></foreignObject>`
}

/** Render the complete stroke-only stack shared by canvas and standalone SVG.
 * @param node - Resolved source geometry and paints in the current contextual mode.
 * @param id - Unique caller-owned render-context identity, separate from fill paint servers.
 * @returns Internal SVG children with paint definitions and exactly one composite stroke opacity.
 */
export function designStrokePaintSvg(node: CopyOSDesignNode, id: string): string {
  const paints = designNodeStrokePaints(node).filter(paint => paint.visible && paint.opacity > 0)
  const config = designStrokePaintGeometry(node), style = designStrokeStyle(node)
  const dashArray = node.strokeDashes ? (style.dashes.length ? style.dashes.join(' ') : 'none') : node.strokeDash ?? 0
  const strokeOptions = `stroke-linecap="${style.cap}" stroke-linejoin="${style.join}" stroke-miterlimit="${style.miterLimit}" stroke-dasharray="${dashArray}" stroke-dashoffset="${style.dashOffset}"`
  if (!paints.length || !(node.strokeOpacity ?? 1) || !(config.ring?.path || config.width > 0)) return ''
  const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const prefix = `stroke-${id}`, box = config.bounds
  const bounds = `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`
  const server = (paint: CopyOSDesignPaint) => `${prefix}-paint-${paint.id}`
  const color = (paint: CopyOSDesignPaint) => paint.gradient || paint.image ? `url(#${server(paint)})` : esc(paint.color)
  let defs = paints.map(paint => designStrokePaintDefinition(paint, server(paint), node.width, node.height)).join('')
  const geometry = (attributes: string): string => {
    if ((node.kind === 'path' || node.kind === 'boolean') && node.pathData) {
      const sx = node.width / node.pathData.width, sy = node.height / node.pathData.height
      return node.pathData.paths.map((path, index) => {
        const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(path.d)
        if (parsed.err) return `<g data-copyos-invalid-stroke-path="${index}"><desc>Invalid stroke path omitted; authored geometry retained.</desc></g>`
        return `<path d="${esc(parsed.scale(sx, sy).toString())}" fill-rule="${path.fillRule}" ${attributes}/>`
      }).join('')
    }
    if (node.kind === 'ellipse') return `<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" ${attributes}/>`
    return `<path d="${designRectanglePath(node)}" ${attributes}/>`
  }
  let shape = ''
  if (node.kind === 'text') {
    const glyph = (outline: boolean) => designGlyphMarkup(node, outline ? config.width : undefined)
    const viewport = `width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" overflow="visible"`
    defs += `<svg id="${prefix}-glyph" ${viewport}>${glyph(false)}</svg>`
    shape = paints.map((paint, index) => {
      const paintId = `${prefix}-paints-${index}`, filterId = `${prefix}-filter-${index}`
      defs += `<svg id="${paintId}" ${viewport}><rect ${bounds} fill="${color(paint)}" opacity="${paint.opacity}"/></svg>` +
        designTextStrokeFilterDefinition(node, filterId, paintId, `${prefix}-glyph`)
      return `<g style="mix-blend-mode:${paint.blendMode ?? 'normal'}"><g filter="url(#${filterId})">${glyph(true)}</g></g>`
    }).join('')
  } else if (config.ring) {
    const ring = config.ring
    if (style.dashes.length) {
      const sides = ring.dashSides.map((side, index) => {
        const clip = `${prefix}-dash-side-${index}`
        defs += `<clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><path d="${side.clip}"/></clipPath>`
        return `<g clip-path="url(#${clip})"><path d="${ring.outline}" fill="none" stroke="white" stroke-width="${side.width}" ${strokeOptions}/></g>`
      }).join('')
      defs += `<mask id="${prefix}-dash" maskUnits="userSpaceOnUse" ${bounds}>${sides}</mask>`
    }
    shape = paints.map(paint => `<path d="${ring.path}" fill-rule="evenodd" fill="${color(paint)}" opacity="${paint.opacity}" style="mix-blend-mode:${paint.blendMode ?? 'normal'}"${style.dashes.length ? ` mask="url(#${prefix}-dash)"` : ''}/>`).join('')
  } else {
    if (config.alignment !== 'center') {
      defs += `<clipPath id="${prefix}-inside">${geometry('')}</clipPath><mask id="${prefix}-outside" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/>${geometry('fill="black"')}</mask>`
    }
    const clipping = config.alignment === 'inside' ? ` clip-path="url(#${prefix}-inside)"` : config.alignment === 'outside' ? ` mask="url(#${prefix}-outside)"` : ''
    defs += `<mask id="${prefix}-outline" maskUnits="userSpaceOnUse" ${bounds}><g${clipping}>${geometry(`fill="none" stroke="white" stroke-width="${config.width}" ${strokeOptions}`)}</g></mask>`
    shape = paints.map(paint => `<rect ${bounds} fill="${color(paint)}" opacity="${paint.opacity}" mask="url(#${prefix}-outline)" style="mix-blend-mode:${paint.blendMode ?? 'normal'}"/>`).join('')
  }
  return `<defs>${defs}</defs><g opacity="${node.strokeOpacity ?? 1}">${shape}</g>`
}

/** Render independent browser glyph fills so pass-through paint modes can interact with the external backdrop.
 * @param node - Resolved text source, retaining its exact typography and text layout.
 * @param id - Unique renderer identity; servers are namespaced separately from the stroke channel.
 * @returns Stroke-free SVG children; callers retain node opacity, layer blend, clipping and editability ownership.
 */
export function designTextFillSvg(node: CopyOSDesignNode, id: string): string {
  if (node.kind !== 'text') return ''
  const paints = designNodePaints(node).filter(paint => paint.visible && paint.opacity > 0)
  const colored = designTextSegments(node).map((segment, index) => ({ segment, index })).filter(item => item.segment.style.fill)
  if (!paints.length && !colored.length) return ''
  const box = designStrokePaintGeometry({ ...node, strokeWidth: 0 }).bounds
  const bounds = `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`
  const viewport = `width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`
  const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  let defs = ''
  const shapes = paints.map((paint, index) => {
    const prefix = `text-fill-${id}-${index}`, server = `${prefix}-paint`, source = `${prefix}-source`, filter = `${prefix}-filter`
    defs += designStrokePaintDefinition(paint, server, node.width, node.height)
    const color = paint.image || paint.gradient ? `url(#${server})` : esc(paint.color)
    defs += `<svg id="${source}" ${viewport}><rect ${bounds} fill="${color}" opacity="${paint.opacity}"/></svg>` +
      `<filter id="${filter}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${bounds} color-interpolation-filters="sRGB"><feImage href="#${source}" ${bounds} preserveAspectRatio="none" result="paint"/><feComposite in="paint" in2="SourceAlpha" operator="in"/></filter>`
    return `<g style="mix-blend-mode:${paint.blendMode ?? 'normal'}"><g filter="url(#${filter})">${designGlyphMarkup(node, undefined, false, { mode: 'base-mask' })}</g></g>`
  }).join('')
  const runShapes = colored.map(({ segment, index }) => {
    const prefix = `text-run-${id}-${index}`, source = `${prefix}-source`, filter = `${prefix}-filter`
    defs += `<svg id="${source}" ${viewport}><rect ${bounds} fill="${esc(segment.style.fill ?? '')}"/></svg>` +
      `<filter id="${filter}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${bounds} color-interpolation-filters="sRGB"><feImage href="#${source}" ${bounds} preserveAspectRatio="none" result="paint"/><feComposite in="paint" in2="SourceAlpha" operator="in"/></filter>`
    return `<g filter="url(#${filter})">${designGlyphMarkup(node, undefined, false, { mode: 'run-mask', runIndex: index })}</g>`
  }).join('')
  return `<defs>${defs}</defs>${shapes}${runShapes}`
}

/** Render one semantic link overlay using the exact shared glyph typography, case, wrapping and overflow.
 * @param node - Effective text; masks and painted glyphs remain noninteractive and contain no anchors.
 * @returns Transparent inline hyperlink content for explicit standalone exports, without duplicate painted glyphs.
 */
export function designTextLinkSvg(node: CopyOSDesignNode): string {
  return node.kind === 'text' && node.textRuns?.some(run => run.style.hyperlink) ?
    designGlyphMarkup(node, undefined, false, { mode: 'link-overlay' }) : ''
}
