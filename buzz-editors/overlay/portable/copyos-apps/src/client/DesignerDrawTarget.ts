/** Place layers drawn with the Frame and shape tools: inside the board under the pointer, at whole pixels, 100 × 100 on a click. */
import { designSvgNodeMatrix, type DesignSvgMatrix } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'

/** Size of a layer created by a click without a drag, as in Figma. */
export const DESIGNER_CLICK_LAYER_SIZE = 100

/** Parent chosen for a drawn layer and the transform from its coordinates to scene coordinates. */
export interface DesignerDrawTarget {
  /** Board that receives the layer; null places it at the top level of the page. */
  readonly parentId: string | null
  /** Parent-to-scene transform; the identity at the top level. */
  readonly matrix: DesignSvgMatrix
  /** True when the parent arranges children with auto layout, so the layer must opt out of the flow to stay where it was drawn. */
  readonly autoLayout: boolean
}

const identity: DesignSvgMatrix = [1, 0, 0, 1, 0, 0]

/**
 * Map a scene point into the coordinates of the layer whose transform is given.
 * @param matrix - Layer-to-scene transform.
 * @param point - Scene point.
 * @returns The point in the layer's coordinates.
 */
export function designerSceneToLocal(matrix: DesignSvgMatrix, point: { x: number; y: number }): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix
  const det = a * d - b * c
  const x = point.x - e, y = point.y - f
  return { x: (d * x - c * y) / det, y: (a * y - b * x) / det }
}

/**
 * Find the frontmost, deepest board that contains a scene point.
 * @param roots - Top-level layers of the active page in paint order (later layers paint above earlier ones).
 * @param children - Laid-out children of a layer in paint order.
 * @param accepts - Whether a frame or component may receive drawn layers (visible, unlocked, editable).
 * @param point - Scene point where drawing starts.
 * @returns The receiving board, or the page when no accepted board contains the point.
 */
export function designerDrawTarget(
  roots: readonly CopyOSDesignNode[],
  children: (id: string) => readonly CopyOSDesignNode[],
  accepts: (node: CopyOSDesignNode) => boolean,
  point: { x: number; y: number },
): DesignerDrawTarget {
  let target: DesignerDrawTarget = { parentId: null, matrix: identity, autoLayout: false }
  let layers = roots, parent = identity
  for (;;) {
    let next: CopyOSDesignNode | undefined
    for (const node of [...layers].reverse()) {
      if (next) break
      if ((node.kind !== 'frame' && node.kind !== 'component') || !accepts(node)) continue
      const matrix = designSvgNodeMatrix(parent, node), local = designerSceneToLocal(matrix, point)
      if (local.x < 0 || local.y < 0 || local.x > node.width || local.y > node.height) continue
      next = node
      target = { parentId: node.id, matrix, autoLayout: node.layout !== 'none' }
      parent = matrix
    }
    if (!next) return target
    layers = children(next.id)
  }
}

/**
 * Compute a drawn layer's box in its parent's coordinates, snapped to whole pixels.
 * @param start - Drag start in parent coordinates.
 * @param end - Current pointer in parent coordinates; null for a click without a drag.
 * @returns The box; a click yields a {@link DESIGNER_CLICK_LAYER_SIZE} square centred on the click.
 */
export function designerDrawnBox(
  start: { x: number; y: number },
  end: { x: number; y: number } | null,
): { x: number; y: number; width: number; height: number } {
  if (!end) {
    const half = DESIGNER_CLICK_LAYER_SIZE / 2
    return { x: Math.round(start.x - half), y: Math.round(start.y - half),
      width: DESIGNER_CLICK_LAYER_SIZE, height: DESIGNER_CLICK_LAYER_SIZE }
  }
  const left = Math.round(Math.min(start.x, end.x)), top = Math.round(Math.min(start.y, end.y))
  return { x: left, y: top, width: Math.max(1, Math.round(Math.max(start.x, end.x)) - left),
    height: Math.max(1, Math.round(Math.max(start.y, end.y)) - top) }
}
