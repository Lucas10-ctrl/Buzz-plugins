import { applyDesignInstanceGrid } from './design-instance-grid.ts'
import { applyDesignInstanceStroke, designStrokeWeights } from './design-stroke.ts'
/** Frame-local padding and inside strokes shared by stack, grid and instance sizing. */
import { applyDesignInstanceLayout } from './design-instance-layout.ts'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignNumberProperty,
} from './types.ts'
import {
  designModeResources,
  designNodeModeIds,
  type DesignModeContext,
} from './design-token-modes.ts'
import { resolveDesignNumberVariables } from './design-token-values.ts'
/** Applied content insets and the updated model's minimum outer dimensions. */
export interface DesignLayoutBox {
  left: number
  right: number
  top: number
  bottom: number
  widthFloor: number
  heightFloor: number
}
/** Calculate one frame's own content insets; stroke inclusion never inherits from its parent.
 * @param node - Resolved layout frame, with effective numeric resource values.
 * @returns Applied padding/inside-stroke insets, or zero for free/preserved geometry.
 */
export function designLayoutBox(node: CopyOSDesignNode): DesignLayoutBox {
  const active =
    node.kind !== 'instance' && node.layout !== 'none' && !node.preserveLayout
  const stroke =
    active &&
    node.strokeAlign === 'inside' &&
    (node.strokesIncludedInLayout ?? node.layoutSizingModel === 'css')
      ? designStrokeWeights(node)
      : { left:0,right:0,top:0,bottom:0 }
  const left = active ? (node.paddingLeft ?? node.padding) + stroke.left : 0,
    right = active ? (node.paddingRight ?? node.padding) + stroke.right : 0,
    top = active ? (node.paddingTop ?? node.padding) + stroke.top : 0,
    bottom = active ? (node.paddingBottom ?? node.padding) + stroke.bottom : 0
  return {
    left,
    right,
    top,
    bottom,
    widthFloor: node.layoutSizingModel === 'css' ? left + right : 0,
    heightFloor: node.layoutSizingModel === 'css' ? top + bottom : 0,
  }
}
/** Clamp a dimension to authored bounds, then respect the updated padding/stroke floor.
 * @param node - Layer carrying its own min/max bounds.
 * @param axis - Outer dimension to size.
 * @param value - Requested outer size.
 * @param box - Applied layout metrics, optionally resolved from a component template.
 * @returns Outer size; updated padding/stroke floors take precedence over maximum bounds.
 */
export function designLayoutSize(
  node: CopyOSDesignNode,
  axis: 'width' | 'height',
  value: number,
  box = designLayoutBox(node),
): number {
  return Math.max(
    1,
    axis === 'width' ? box.widthFloor : box.heightFloor,
    axis === 'width' ? (node.minWidth ?? 1) : (node.minHeight ?? 1),
    Math.min(
      axis === 'width' ? (node.maxWidth ?? 100000) : (node.maxHeight ?? 100000),
      value,
    ),
  )
}
/** Resolve component-root layout metrics in each instance's inherited or explicit mode.
 * @param document - Native scene and numeric resource library.
 * @param context - Optional root mode for a rendered component subtree.
 * @param templates - Component library, including masters outside a rendered subtree.
 * @returns Instance identities mapped to their component's content insets and sizing floors.
 */
export function designInstanceLayoutBoxes(
  document: CopyOSDesignDocument,
  context?: DesignModeContext,
  templates: readonly CopyOSDesignNode[] = document.nodes,
): ReadonlyMap<string, DesignLayoutBox> {
  const instances = document.nodes.filter(
    n => n.kind === 'instance' && n.componentId,
  )
  if (!instances.length) return new Map()
  const modes = designNodeModeIds(document, context),
    nodes = new Map(templates.map(n => [n.id, n])),
    numbers = new Map<string | null, Map<string, number>>(),
    cache = new Map<string, DesignLayoutBox>(),
    result = new Map<string, DesignLayoutBox>()
  for (const node of instances) {
    if (!node.componentId) continue
    const source = nodes.get(node.componentId)
    if (!source) continue
    const mode = modes.get(node.id) ?? null,
      key = JSON.stringify([source.id, mode, node.instanceGrid, node.instanceStroke,
        node.instanceLayout, node.numericBindings, node.instanceSizingOverrides])
    let box = cache.get(key)
    if (!box) {
      let values = numbers.get(mode)
      if (!values) {
        values = new Map(
          resolveDesignNumberVariables(
            designModeResources(document, mode).numberVariables,
          ).map(v => [v.id, v.value]),
        )
        numbers.set(mode, values)
      }
      const resolved = { ...applyDesignInstanceGrid(applyDesignInstanceStroke(applyDesignInstanceLayout(source, node, values), node),node) }
      for (const [property, id] of Object.entries(
        resolved.numericBindings ?? {},
      )) {
        const value = values.get(id)
        if (value !== undefined)
          resolved[property as CopyOSDesignNumberProperty] = value
      }
      box = designLayoutBox(resolved)
      cache.set(key, box)
    }
    result.set(node.id, box)
  }
  return result
}
