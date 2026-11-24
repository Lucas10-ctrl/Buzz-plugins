/**
 * SVG import for scripts (Figma's `figma.createNodeFromSvg`): an SVG document becomes a list of vector layers in the SVG's own
 * coordinate space, with transforms, viewBox scaling, inherited presentation attributes and basic shapes resolved to path data.
 * Linear and radial gradient fills become Figma gradient paints; patterns and gradient strokes fall back to their first colour,
 * and text is reported, so nothing is dropped silently.
 */
import { parse, type HTMLElement } from 'node-html-parser'
import svgpath from 'svgpath'

/** One drawable shape from the SVG, as path data in the SVG's user units after the viewBox mapping. */
export interface DesignSvgShape {
  name: string
  d: string
  fillRule: 'nonzero' | 'evenodd'
  fill: { color: string; opacity: number; gradient?: DesignSvgGradient } | null
  stroke: { color: string; opacity: number; width: number; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; dashes: number[] } | null
  opacity: number
}

/** A gradient fill in the SVG's outer coordinate space: a line from `from` to `to`, or an ellipse at `from` with radii `rx`/`ry`. */
export interface DesignSvgGradient {
  type: 'linear' | 'radial'
  from: { x: number; y: number }
  to: { x: number; y: number }
  rx: number
  ry: number
  stops: { position: number; color: string; opacity: number }[]
  /** The shape's bounding box in the same space: gradient paints are laid out over it (object bounding box). */
  box: { x: number; y: number; width: number; height: number }
}

/** The whole import. */
export interface DesignSvgImport {
  width: number
  height: number
  shapes: DesignSvgShape[]
  /** What could not be imported exactly, in plain words. */
  warnings: string[]
}

type Style = Record<string, string>
const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'color', 'visibility', 'display']
const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', none: 'none', transparent: 'none' }

function number(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A CSS colour as #rrggbb plus alpha, or null for none. */
function color(value: string, current: string, gradients: Map<string, string>, warnings: Set<string>): { color: string; alpha: number } | null {
  let text = value.trim().toLowerCase()
  if (text === 'currentcolor') text = current.trim().toLowerCase()
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(text)
  if (url) {
    const stop = gradients.get(url[1] ?? '')
    warnings.add('Patterns and gradient strokes inside the SVG were drawn with their first colour; set a GRADIENT_LINEAR paint on the vector for the real look.')
    text = stop ?? '#000000'
  }
  text = NAMED[text] ?? text
  if (text === 'none' || text === '') return null
  let match = /^#([0-9a-f]{3,8})$/.exec(text)
  if (match) {
    let hex = match[1] ?? ''
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('')
    return { color: `#${hex.slice(0, 6)}`, alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 }
  }
  match = /^rgba?\(([^)]+)\)$/.exec(text)
  if (match) {
    const parts = (match[1] ?? '').split(/[\s,/]+/).filter(Boolean)
    const channel = (part: string | undefined) => Math.max(0, Math.min(255, part?.endsWith('%') ? number(part) * 2.55 : number(part)))
    const hex = parts.slice(0, 3).map(part => Math.round(channel(part)).toString(16).padStart(2, '0')).join('')
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? number(parts[3]) / 100 : number(parts[3], 1)
    return { color: `#${hex}`, alpha }
  }
  warnings.add(`The colour "${value}" is not understood; it was drawn black.`)
  return { color: '#000000', alpha: 1 }
}

function ownStyle(element: HTMLElement): Style {
  const style: Style = {}
  for (const [key, value] of Object.entries(element.attributes)) style[key.toLowerCase()] = value
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const at = declaration.indexOf(':')
    if (at > 0) style[declaration.slice(0, at).trim().toLowerCase()] = declaration.slice(at + 1).trim()
  }
  return style
}

/** Path data for a basic shape element, or undefined. */
function shapePath(tag: string, a: Style): string | undefined {
  if (tag === 'path') return a.d
  if (tag === 'rect') {
    const x = number(a.x), y = number(a.y), w = number(a.width), h = number(a.height)
    if (w <= 0 || h <= 0) return undefined
    let rx = a.rx !== undefined ? number(a.rx) : a.ry !== undefined ? number(a.ry) : 0
    let ry = a.ry !== undefined ? number(a.ry) : rx
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2)
    if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
    return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
      `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = number(a.cx), cy = number(a.cy)
    const rx = tag === 'circle' ? number(a.r) : number(a.rx), ry = tag === 'circle' ? number(a.r) : number(a.ry)
    if (rx <= 0 || ry <= 0) return undefined
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
  }
  if (tag === 'line') return `M${number(a.x1)} ${number(a.y1)}L${number(a.x2)} ${number(a.y2)}`
  if (tag === 'polyline' || tag === 'polygon') {
    const values = (a.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
    if (values.length < 4) return undefined
    const points: string[] = []
    for (let i = 0; i + 1 < values.length; i += 2) points.push(`${String(values[i])} ${String(values[i + 1])}`)
    return `M${points.join('L')}${tag === 'polygon' ? 'Z' : ''}`
  }
  return undefined
}

/**
 * Parse an SVG document into vector shapes.
 * @param source - SVG markup (`<svg …>…</svg>`).
 * @returns Its size and shapes in the SVG's outer coordinate space (viewBox already mapped to width × height).
 * @throws {Error} With Figma-like wording when the markup is not an SVG.
 */
export function importDesignSvg(source: string): DesignSvgImport {
  const root = parse(String(source), { lowerCaseTagName: false, comment: false }).querySelector('svg')
  if (!root) throw new Error('Failed to parse SVG: the string has no <svg> element')
  const attributes = ownStyle(root)
  const box = (attributes.viewbox ?? '').trim().split(/[\s,]+/).map(Number)
  const hasBox = box.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0
  const width = number(attributes.width, hasBox ? box[2] : 100) || 100, height = number(attributes.height, hasBox ? box[3] : 100) || 100
  const warnings = new Set<string>()
  // viewBox → viewport (preserveAspectRatio xMidYMid meet, the SVG default).
  let rootTransform = ''
  if (hasBox) {
    const [bx = 0, by = 0, bw = 1, bh = 1] = box
    const scale = Math.min(width / bw, height / bh)
    rootTransform = `translate(${String((width - bw * scale) / 2)} ${String((height - bh * scale) / 2)}) scale(${String(scale)}) translate(${String(-bx)} ${String(-by)})`
  }
  const gradients = new Map<string, string>()
  const gradientElements = new Map<string, HTMLElement>()
  // The selector engine lower-cases tag names, so camel-case SVG tags are matched by hand.
  const tagOf = (element: HTMLElement): string => element.rawTagName?.replace(/^svg:/, '') ?? ''
  for (const gradient of root.querySelectorAll('*').filter(element => ['linearGradient', 'radialGradient', 'pattern'].includes(tagOf(element)))) {
    const stop = gradient.querySelector('stop')
    const id = gradient.getAttribute('id')
    if (id) {
      gradients.set(id.toLowerCase(), (stop && (ownStyle(stop)['stop-color'] ?? '#000000')) ?? '#000000')
      gradientElements.set(id.toLowerCase(), gradient)
    }
  }
  /** A gradient's attributes and stops, following href to the gradient it extends. */
  const gradientOf = (id: string, depth = 0): { tag: string; attributes: Style; stops: HTMLElement[] } | undefined => {
    const element = gradientElements.get(id)
    if (!element || depth > 8) return undefined
    const tag = element.rawTagName?.replace(/^svg:/, '') ?? ''
    if (tag === 'pattern') return undefined
    const attributes = ownStyle(element)
    const stops = element.querySelectorAll('stop')
    const href = (attributes.href ?? attributes['xlink:href'] ?? '').replace(/^#/, '').toLowerCase()
    const parent = href ? gradientOf(href, depth + 1) : undefined
    return { tag, attributes: { ...parent?.attributes, ...attributes }, stops: stops.length ? stops : parent?.stops ?? [] }
  }
  /** Map a point through an SVG transform list. */
  const through = (transform: string, x: number, y: number): { x: number; y: number } => {
    if (!transform.trim()) return { x, y }
    const moved = /M\s*([-\d.e+]+)[\s,]+([-\d.e+]+)/i.exec(svgpath(`M${String(x)} ${String(y)}`).transform(transform).toString())
    return { x: number(moved?.[1], x), y: number(moved?.[2], y) }
  }
  /** Bounding box of path data in its own coordinates (end and control points; enough for objectBoundingBox gradients). */
  const boundsOf = (d: string): { x: number; y: number; width: number; height: number } => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let cx = 0, cy = 0
    const add = (x: number, y: number) => {
      if (Number.isFinite(x) && Number.isFinite(y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    }
    svgpath(d).abs().unarc().iterate((segment: (string | number)[]) => {
      const command = String(segment[0]).toUpperCase()
      if (command === 'H') { cx = Number(segment[1]); add(cx, cy); return }
      if (command === 'V') { cy = Number(segment[1]); add(cx, cy); return }
      for (let i = 1; i + 1 < segment.length; i += 2) { cx = Number(segment[i]); cy = Number(segment[i + 1]); add(cx, cy) }
    })
    return Number.isFinite(minX) ? { x: minX, y: minY, width: Math.max(maxX - minX, 1e-6), height: Math.max(maxY - minY, 1e-6) } : { x: 0, y: 0, width: 1, height: 1 }
  }
  /** A gradient fill for a shape, in the SVG's outer coordinates, or undefined when the paint is not a usable gradient. */
  const gradientFill = (value: string, d: string, transform: string): DesignSvgGradient | undefined => {
    const id = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(value.trim())?.[1]?.toLowerCase()
    const found = id ? gradientOf(id) : undefined
    if (!found || !found.stops.length) return undefined
    const a = found.attributes
    const userSpace = a.gradientunits === 'userSpaceOnUse'
    const bounds = userSpace ? { x: 0, y: 0, width: 1, height: 1 } : boundsOf(d)
    const length = (raw: string | undefined, fallback: number, size: number): number => {
      if (raw === undefined) return fallback
      const value = number(raw, fallback)
      return raw.trim().endsWith('%') ? (userSpace ? value / 100 * size : value / 100) : value
    }
    // Gradient space → shape space (bounding box for objectBoundingBox) → the gradient's own transform → the SVG's outer space.
    const place = (x: number, y: number) => {
      const own = through(a.gradienttransform ?? '', x, y)
      return through(transform, bounds.x + own.x * bounds.width, bounds.y + own.y * bounds.height)
    }
    const stops = found.stops.map(stop => {
      const style = ownStyle(stop)
      const parsed = color(style['stop-color'] ?? '#000000', '#000000', gradients, warnings) ?? { color: '#000000', alpha: 0 }
      const offset = style.offset ?? '0'
      const position = Math.max(0, Math.min(1, offset.trim().endsWith('%') ? number(offset) / 100 : number(offset)))
      return { position, color: parsed.color, opacity: parsed.alpha * (style['stop-opacity'] === undefined ? 1 : number(style['stop-opacity'], 1)) }
    })
    if (found.tag === 'radialGradient') {
      const cx = length(a.cx, userSpace ? width / 2 : 0.5, width), cy = length(a.cy, userSpace ? height / 2 : 0.5, height)
      const r = length(a.r, userSpace ? Math.hypot(width, height) / Math.SQRT2 / 2 : 0.5, Math.hypot(width, height) / Math.SQRT2)
      const centre = place(cx, cy), edgeX = place(cx + r, cy), edgeY = place(cx, cy + r)
      return { type: 'radial', from: centre, to: edgeX, rx: Math.hypot(edgeX.x - centre.x, edgeX.y - centre.y),
        ry: Math.hypot(edgeY.x - centre.x, edgeY.y - centre.y), stops, box: { x: 0, y: 0, width: 1, height: 1 } }
    }
    const from = place(length(a.x1, 0, width), length(a.y1, 0, height))
    const to = place(length(a.x2, userSpace ? width : 1, width), length(a.y2, 0, height))
    return { type: 'linear', from, to, rx: 0, ry: 0, stops, box: { x: 0, y: 0, width: 1, height: 1 } }
  }
  const symbols = new Map<string, HTMLElement>()
  for (const element of root.querySelectorAll('[id]')) symbols.set(element.getAttribute('id') ?? '', element)
  const shapes: DesignSvgShape[] = []
  const walk = (element: HTMLElement, inherited: Style, transform: string, opacity: number, depth: number): void => {
    if (depth > 64) return
    const tag = element.rawTagName?.replace(/^svg:/, '') ?? ''
    if (['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'symbol', 'style', 'title', 'desc', 'metadata', 'filter'].includes(tag)) return
    const own = ownStyle(element)
    const style: Style = { ...inherited }
    for (const key of INHERITED) if (own[key] !== undefined) style[key] = own[key]
    if (style.display === 'none' || style.visibility === 'hidden') return
    const next = [transform, element === root ? rootTransform : '', own.transform ?? ''].filter(Boolean).join(' ')
    const layerOpacity = opacity * (own.opacity === undefined ? 1 : number(own.opacity, 1))
    if (own['clip-path'] || own.mask) warnings.add('Clip paths and masks inside the SVG are not applied; mask with isMask on a Canvas layer instead.')
    if (own.filter) warnings.add('SVG filters are not applied; use Canvas effects (DROP_SHADOW, LAYER_BLUR) instead.')
    if (tag === 'text' || tag === 'tspan') { warnings.add('Text inside the SVG was left out; add it as a TEXT layer.'); return }
    if (tag === 'image') { warnings.add('Pictures inside the SVG were left out; use an IMAGE fill.'); return }
    if (tag === 'use') {
      const href = (own.href ?? own['xlink:href'] ?? '').replace(/^#/, '')
      const target = symbols.get(href)
      if (target) {
        const offset = `translate(${String(number(own.x))} ${String(number(own.y))})`
        const children = target.rawTagName === 'symbol' ? target.childNodes : [target]
        for (const child of children) if ((child as HTMLElement).rawTagName) walk(child as HTMLElement, style, `${next} ${offset}`, layerOpacity, depth + 1)
      }
      return
    }
    const d = shapePath(tag, own)
    if (d) {
      const path = svgpath(d).transform(next || 'translate(0 0)').unarc().round(3).toString()
      const current = style.color ?? '#000000'
      const fillValue = style.fill ?? '#000000'
      const gradient = tag === 'line' || tag === 'polyline' && style.fill === undefined ? undefined : gradientFill(fillValue, d, next)
      const fill = tag === 'line' || tag === 'polyline' && style.fill === undefined ? null
        : gradient ? { color: gradient.stops[0]?.color ?? '#000000', alpha: 1 } : color(fillValue, current, gradients, warnings)
      const stroke = style.stroke ? color(style.stroke, current, gradients, warnings) : null
      const scale = (() => { const m = /scale\(\s*([\d.e+-]+)/.exec(next); return m ? Math.abs(number(m[1], 1)) : 1 })()
      shapes.push({
        name: own.id ?? tag,
        d: path,
        fillRule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
        fill: fill ? { color: fill.color, opacity: fill.alpha * (style['fill-opacity'] === undefined ? 1 : number(style['fill-opacity'], 1)),
          ...(gradient ? { gradient: { ...gradient, box: boundsOf(path) } } : {}) } : null,
        stroke: stroke ? { color: stroke.color, opacity: stroke.alpha * (style['stroke-opacity'] === undefined ? 1 : number(style['stroke-opacity'], 1)),
          width: number(style['stroke-width'], 1) * scale,
          cap: style['stroke-linecap'] === 'round' ? 'round' : style['stroke-linecap'] === 'square' ? 'square' : 'butt',
          join: style['stroke-linejoin'] === 'round' ? 'round' : style['stroke-linejoin'] === 'bevel' ? 'bevel' : 'miter',
          dashes: (style['stroke-dasharray'] ?? '').split(/[\s,]+/).map(Number).filter(value => Number.isFinite(value) && value > 0).map(value => value * scale) } : null,
        opacity: layerOpacity,
      })
      return
    }
    for (const child of element.childNodes) if ((child as HTMLElement).rawTagName) walk(child as HTMLElement, style, next, layerOpacity, depth + 1)
  }
  walk(root, {}, '', 1, 0)
  return { width, height, shapes, warnings: [...warnings] }
}
