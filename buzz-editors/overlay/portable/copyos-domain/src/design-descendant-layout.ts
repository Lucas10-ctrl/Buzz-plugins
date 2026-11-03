/** Mode-aware, nonserialized layout overlays for ordinary linked descendants. */
import { applyDesignInstanceLayout } from './design-instance-layout.ts'
import type { CopyOSDesignInstanceLayout, CopyOSDesignInstanceLayoutBindings, CopyOSDesignNode } from './types.ts'
const pendingLayout = Symbol('copyos.descendant-layout')
type PendingNode = CopyOSDesignNode & { [pendingLayout]?: {
  source: CopyOSDesignNode
  layout: CopyOSDesignInstanceLayout | undefined
  bindings: CopyOSDesignInstanceLayoutBindings | undefined
} }
/** Prepare a descendant overlay before its inherited mode palette is known.
 * @param source - Raw contextual descendant with inherited layout and bindings.
 * @param layout - Local literals/settings; unsupported flow fields remain dormant.
 * @param bindings - Local spacing UUID references.
 * @returns Transient node; a private Symbol survives preparation spreads and is consumed before layout/serialization.
 */
export function prepareDesignDescendantLayout(source: CopyOSDesignNode, layout: CopyOSDesignInstanceLayout | undefined,
  bindings: CopyOSDesignInstanceLayoutBindings | undefined): CopyOSDesignNode {
  const projected = applyDesignInstanceLayout(source, { ...source, kind: 'instance',
    instanceLayout: layout,
    numericBindings: Object.fromEntries(Object.entries(bindings ?? {}).filter(([, id]) => id !== undefined)) }, new Map())
  return { ...projected, [pendingLayout]: { source, layout, bindings } } as PendingNode
}
/** Resolve a prepared overlay using the same palette as ordinary numeric token substitution.
 * @param node - Prepared contextual node or ordinary authored node.
 * @param numbers - Resolved resource values for this node's effective mode.
 * @returns Node with only layout/binding fields overlaid; private preparation metadata is removed.
 */
export function resolveDesignDescendantLayout(node: CopyOSDesignNode, numbers: ReadonlyMap<string, number>): CopyOSDesignNode {
  const pending = (node as PendingNode)[pendingLayout]
  if (!pending) return node
  const source = resolveDesignDescendantLayout(pending.source, numbers)
  const applied = applyDesignInstanceLayout(source, { ...source, kind: 'instance',
    instanceLayout: pending.layout,
    numericBindings: Object.fromEntries(Object.entries(pending.bindings ?? {}).filter(([, id]) => id !== undefined)) }, numbers)
  const result: PendingNode = { ...node, layout: applied.layout, gap: applied.gap, crossGap: applied.crossGap,
    padding: applied.padding, paddingTop: applied.paddingTop, paddingRight: applied.paddingRight,
    paddingBottom: applied.paddingBottom, paddingLeft: applied.paddingLeft, alignItems: applied.alignItems,
    justifyContent: applied.justifyContent, layoutWrap: applied.layoutWrap, alignContent: applied.alignContent,
    numericBindings: applied.numericBindings, preserveLayout: node.preserveLayout === false ? false : applied.preserveLayout }
  Reflect.deleteProperty(result, pendingLayout)
  return result
}
