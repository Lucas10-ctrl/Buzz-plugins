/** Leave Canvas layer subtrees that cannot reach the visible canvas out of the rendered SVG. */
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  designSvgNodeMatrix,
  type DesignNodeVisualBounds,
  type DesignSvgMatrix,
  type DesignVisualBox,
} from '../../../copyos-domain/src/design-model.ts'

/** How a layer subtree's painted scene box relates to the rendered region. */
export type DesignerCullState = 'out' | 'in' | 'partial'

/** Scene region rendered for a canvas view. Tiles are the smallest square with a power-of-√2 side covering the
 * viewport; the region spans three tiles per axis centred on the tile holding the viewport centre, so it keeps at least
 * half a viewport of margin on every side and changes only after the centre moves to another tile or the zoom crosses a
 * power of √2.
 * @param view - Canvas translation (screen pixels) and zoom the scene is painted with.
 * @param size - Canvas element size in screen pixels; null or empty before the first measurement.
 * @returns Region in scene coordinates with a stable `key`, or null when the canvas size is unknown (render everything).
 */
export function designerCullRegion(
  view: { x: number; y: number; zoom: number },
  size: { width: number; height: number } | null,
): (DesignVisualBox & { key: string }) | null {
  if (!size || size.width <= 0 || size.height <= 0 || !(view.zoom > 0)) return null
  const width = size.width / view.zoom, height = size.height / view.zoom
  const tile = 2 ** (Math.ceil(Math.log2(Math.max(width, height)) * 2) / 2)
  const centreX = -view.x / view.zoom + width / 2, centreY = -view.y / view.zoom + height / 2
  const region = {
    x: (Math.floor(centreX / tile) - 1) * tile,
    y: (Math.floor(centreY / tile) - 1) * tile,
    width: tile * 3,
    height: tile * 3,
  }
  return { ...region, key: `${region.x},${region.y},${region.width}` }
}

/** Scene boxes of root-context layer subtrees, memoized per scene.
 * @param byId - Root-context layers by id; parents resolve through `parentId`.
 * @param bounds - Local painted bounds whose `visual` box already contains descendants, clipping and effects.
 * @returns Lookup of the axis-aligned scene box covering a layer subtree's paint and the layer's own rectangle, or null
 *   when it paints nothing or is unknown.
 */
export function createDesignerSceneBoxes(
  byId: ReadonlyMap<string, CopyOSDesignNode>,
  bounds: (node: CopyOSDesignNode) => DesignNodeVisualBounds,
): (id: string) => DesignVisualBox | null {
  const matrices = new Map<string, DesignSvgMatrix | null>()
  const boxes = new Map<string, DesignVisualBox | null>()
  const matrix = (id: string, depth: number): DesignSvgMatrix | null => {
    const known = matrices.get(id)
    if (known !== undefined) return known
    const node = byId.get(id)
    const parent = !node || depth > 256 ? null : node.parentId === null ? [1, 0, 0, 1, 0, 0] satisfies DesignSvgMatrix
      : matrix(node.parentId, depth + 1)
    const value = node && parent ? designSvgNodeMatrix(parent, node) : null
    matrices.set(id, value)
    return value
  }
  return (id) => {
    const known = boxes.get(id)
    if (known !== undefined) return known
    const node = byId.get(id), m = matrix(id, 0)
    const local = node && m ? bounds(node) : null
    const painted = local?.filter ?? local?.visual
    // The layer's own rectangle stays a hit target even where nothing paints.
    const box = node && painted ? {
      x: Math.min(0, painted.x), y: Math.min(0, painted.y),
      width: Math.max(node.width, painted.x + painted.width) - Math.min(0, painted.x),
      height: Math.max(node.height, painted.y + painted.height) - Math.min(0, painted.y),
    } : null
    let value: DesignVisualBox | null = null
    if (m && box) {
      const xs: number[] = [], ys: number[] = []
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height]] as const
      for (const [x, y] of corners) {
        xs.push(m[0] * x + m[2] * y + m[4])
        ys.push(m[1] * x + m[3] * y + m[5])
      }
      const x = Math.min(...xs), y = Math.min(...ys)
      value = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    boxes.set(id, value)
    return value
  }
}

/** Classify a subtree's scene box against the rendered region.
 * @param box - Subtree scene box; null when unknown.
 * @param region - Rendered region; null renders everything.
 * @returns `out` when nothing can reach the region, `in` when everything lies inside it, `partial` otherwise
 *   (also for an unknown box, which is never culled).
 */
export function designerCullState(box: DesignVisualBox | null, region: DesignVisualBox | null): DesignerCullState {
  if (!region) return 'in'
  if (!box) return 'partial'
  if (box.x > region.x + region.width || box.x + box.width < region.x ||
    box.y > region.y + region.height || box.y + box.height < region.y) return 'out'
  return box.x >= region.x && box.y >= region.y && box.x + box.width <= region.x + region.width &&
    box.y + box.height <= region.y + region.height ? 'in' : 'partial'
}
