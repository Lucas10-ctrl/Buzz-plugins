import { designNodeLayerBlur } from './design-effects.ts'
import { designEffectsShadowBoxes } from './design-effects-render.ts'
import { designStrokeStyle, designStrokeAlignment } from './design-stroke-style.ts'
import { designNodeStrokePaints } from './design-stroke-paints.ts'
import { designStrokeGeometry, designStrokeWeights } from './design-stroke.ts'
/** Conservative painted geometry shared by canvas filters and standalone SVG viewports. */
import { svgPathBbox } from 'svg-path-bbox'
import { designTextLayoutSignature } from './design-text-layout.ts'
import { designTextOverflow } from './design-text-overflow.ts'
import type { CopyOSDesignNode } from './types.ts'
import type { createDesignRenderScene, DesignRenderContext } from './design-model.ts'

/** Axis-aligned envelope in the queried layer's local coordinate space. */
export interface DesignVisualBox { x: number; y: number; width: number; height: number }
/** SourceGraphic and its finite three-standard-deviation drop-shadow envelope. */
export interface DesignNodeVisualBounds {
  content: DesignVisualBox | null
  visual: DesignVisualBox | null
  filter: DesignVisualBox | null
}
type Point = { x: number; y: number }
type Polygon = Point[]
type Entry = DesignNodeVisualBounds & { polygons: Polygon[]; depth: number }

function rectangle(box: DesignVisualBox): Polygon {
  return [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }]
}
function envelope(polygons: readonly Polygon[]): DesignVisualBox | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const polygon of polygons) for (const point of polygon) {
    left = Math.min(left, point.x); top = Math.min(top, point.y)
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y)
  }
  return Number.isFinite(left) ? { x: left || 0, y: top || 0, width: right - left, height: bottom - top } : null
}
function transformed(polygons: readonly Polygon[], node: CopyOSDesignNode): Polygon[] {
  const radians = node.rotation * Math.PI / 180
  const cardinal = (value: number) => Math.abs(value - Math.round(value)) < 1e-12 ? Math.round(value) : value
  const cos = cardinal(Math.cos(radians)), sin = cardinal(Math.sin(radians))
  return polygons.map(polygon => polygon.map((point) => {
    const x = (node.flipX ? node.width - point.x : point.x) - node.width / 2
    const y = (node.flipY ? node.height - point.y : point.y) - node.height / 2
    return { x: node.x + node.width / 2 + cos * x - sin * y, y: node.y + node.height / 2 + sin * x + cos * y }
  }))
}
function clipped(polygon: Polygon, width: number, height: number): Polygon {
  let result = polygon
  for (const [axis, edge, direction] of [['x', 0, 1], ['x', width, -1], ['y', 0, 1], ['y', height, -1]] as const) {
    const input = result
    result = []
    if (!input.length) break
    let previous = input[input.length - 1]
    if (!previous) continue
    for (const current of input) {
      const currentInside = (current[axis] - edge) * direction >= 0
      const previousInside = (previous[axis] - edge) * direction >= 0
      if (currentInside !== previousInside) {
        const fraction = (edge - previous[axis]) / (current[axis] - previous[axis])
        result.push({ x: previous.x + (current.x - previous.x) * fraction,
          y: previous.y + (current.y - previous.y) * fraction })
      }
      if (currentInside) result.push(current)
      previous = current
    }
  }
  return result
}
function shapeBox(node: CopyOSDesignNode, stroke = 0): DesignVisualBox {
  if ((node.kind === 'path' || node.kind === 'boolean') && node.pathData) {
    const sx = node.width / node.pathData.width, sy = node.height / node.pathData.height
    const boxes = node.pathData.paths.map((path) => {
      let bounds: ReturnType<typeof svgPathBbox>
      try { bounds = svgPathBbox(path.d) } catch (error) {
        // Native path strings can be incomplete; retain their authored envelope rather than failing export.
        if (!(error instanceof Error)) throw error
        return rectangle({ x: 0, y: 0, width: node.width, height: node.height })
      }
      const [left, top, right, bottom] = bounds
      if (!bounds.every(Number.isFinite)) return []
      const style = designStrokeStyle(node), alignment = designStrokeAlignment(node)
      const half = stroke * (alignment === 'center' ? .5 : 1)
      const outset = alignment === 'inside' ? 0 : Math.max(half * (style.join === 'miter' ? style.miterLimit : 1),
        style.cap === 'square' ? half * Math.SQRT2 : half)
      return rectangle({ x: left * sx - outset, y: top * sy - outset,
        width: (right - left) * sx + outset * 2, height: (bottom - top) * sy + outset * 2 })
    })
    return envelope(boxes) ?? { x: 0, y: 0, width: node.width, height: node.height }
  }
  let width = node.width, height = node.height
  if (node.kind === 'text' && node.textWrap === false && !designTextOverflow(node) &&
      node.textLayoutMetrics?.signature === designTextLayoutSignature(node)) {
    width = Math.max(width, node.textLayoutMetrics.width)
    height = Math.max(height, node.textLayoutMetrics.height)
  }
  const alignment = designStrokeAlignment(node), style = designStrokeStyle(node)
  const capOutset = style.supported && style.cap === 'square' && style.dashes.length ?
    stroke * (alignment === 'center' ? .5 : 1) * Math.SQRT2 : 0
  const outset = Math.max(alignment === 'inside' ? 0 : alignment === 'outside' ? stroke : stroke / 2, capOutset)
  return { x: -outset, y: -outset, width: width + outset * 2, height: height + outset * 2 }
}

/** Collect transformed paint envelopes without repeatedly walking linked instance trees.
 * @param scene - The same resolved scene used by the renderer.
 * @returns Memoized local content/filter envelopes and a tight union of requested root envelopes.
 */
export function createDesignVisualBounds(scene: ReturnType<typeof createDesignRenderScene>): {
  node: (node: CopyOSDesignNode, context?: DesignRenderContext) => DesignNodeVisualBounds
  roots: (roots: readonly CopyOSDesignNode[]) => DesignVisualBox
} {
  const cache = new WeakMap<DesignRenderContext, Map<string, Entry>>()
  const empty = (): Entry => ({ content: null, visual: null, filter: null, polygons: [], depth: 0 })
  const collect = (node: CopyOSDesignNode, context: DesignRenderContext, depth = 0): Entry => {
    if (!node.visible || node.opacity <= 0 || depth >= 64) return empty()
    let entries = cache.get(context)
    if (!entries) { entries = new Map(); cache.set(context, entries) }
    const existing = entries.get(node.id)
    if (existing && existing.depth <= depth) return existing
    const instance = scene.instance(node, context), current = instance ?? context
    const base = instance?.byId.get(node.componentId ?? '') ?? node
    if (base.kind === 'boolean' && !base.pathData?.paths.length) return empty()
    const sx = instance ? node.width / base.width : 1, sy = instance ? node.height / base.height : 1
    const scaled = (polygons: Polygon[]): Polygon[] => polygons.map(polygon => polygon.map(point => ({ x: point.x * sx, y: point.y * sy })))
    let paints: Polygon[] = []
    const fills = base.fills ?? [{ visible: true, opacity: base.fillOpacity ?? 1 }]
    if (base.kind !== 'group' && !(base.kind === 'boolean' && !base.pathData?.paths.length) && ((base.kind === 'text' && base.text.length > 0) || fills.some(p => p.visible && p.opacity > 0)))
      paints.push(...scaled([rectangle(shapeBox(base))]))
    for (const child of base.kind === 'boolean' ? [] : current.children.get(base.id) ?? [])
      paints.push(...scaled(transformed(collect(child, current, depth + 1).polygons, child)))
    if (node.clip) paints = paints.map(polygon => clipped(polygon, node.width, node.height)).filter(polygon => polygon.length)
    if (base.kind !== 'group' && Math.max(...Object.values(designStrokeWeights(base))) > 0 &&
      (base.strokeOpacity ?? 1) > 0 && designNodeStrokePaints(base).some(paint => paint.visible && paint.opacity > 0)) {
      let strokes = scaled([rectangle(designStrokeGeometry(base)?.bounds ?? shapeBox(base, base.strokeWidth))])
      // Text and paths retain their existing content clip; frame borders sit above that clip.
      if (node.clip && !['rectangle', 'ellipse', 'frame', 'component', 'component-set', 'image'].includes(base.kind))
        strokes = strokes.map(polygon => clipped(polygon, node.width, node.height)).filter(polygon => polygon.length)
      paints.push(...strokes)
    }
    const content = envelope(paints)
    let filter: DesignVisualBox | null = null
    if (content) {
      const shadows = designEffectsShadowBoxes({ ...base, clip: node.clip }, content)
      if (shadows.length) { paints.push(...shadows.map(rectangle)); filter = envelope(paints) }
      const blur = designNodeLayerBlur(base), painted = envelope(paints)
      if (blur?.visible && painted) {
        const outset = blur.radius * 1.5
        filter = { x: painted.x - outset, y: painted.y - outset,
          width: painted.width + outset * 2, height: painted.height + outset * 2 }
        paints = [rectangle(filter)]
      }
    }
    const entry = { content, filter, visual: envelope(paints), polygons: paints, depth }
    entries.set(node.id, entry)
    return entry
  }
  return {
    node: (node, context = scene.root) => collect(node, context),
    roots: (roots) => {
      const bounds = envelope(roots.flatMap(node => transformed(collect(node, scene.root).polygons, node)))
      if (!bounds) return { x: 0, y: 0, width: 1, height: 1 }
      // Round outwards so serialization cannot remove a fractional edge pixel.
      const x = Math.floor(bounds.x * 1e6) / 1e6, y = Math.floor(bounds.y * 1e6) / 1e6
      return { x, y, width: Math.max(1, Math.ceil((bounds.x + bounds.width) * 1e6) / 1e6 - x),
        height: Math.max(1, Math.ceil((bounds.y + bounds.height) * 1e6) / 1e6 - y) }
    },
  }
}
