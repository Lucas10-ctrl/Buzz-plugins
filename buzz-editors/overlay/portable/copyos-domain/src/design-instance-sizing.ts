/** Explicit ownership distinguishes inherited instance defaults from stored local fallback snapshots. */
import type {
  CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignInstanceSizingProperty,
} from './types.ts'

/** Root dimensions, policies and bounds that can independently inherit from a linked main. */
export const DESIGN_INSTANCE_SIZING_KEYS = [
  'width', 'height', 'widthSizing', 'heightSizing', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
] as const satisfies readonly CopyOSDesignInstanceSizingProperty[]
export type { CopyOSDesignInstanceSizingProperty as DesignInstanceSizingProperty } from './types.ts'

/** Check local ownership without confusing inherited fallback snapshots with explicit values.
 * @param node - Stored linked instance.
 * @param key - Sizing property.
 * @returns True for legacy ownership, explicit mask ownership or a matching local numeric binding.
 */
export function designInstanceSizingOwns(node: CopyOSDesignNode, key: CopyOSDesignInstanceSizingProperty): boolean {
  return node.instanceSizingOverrides === undefined || node.instanceSizingOverrides.includes(key) ||
    (key !== 'widthSizing' && key !== 'heightSizing' && !!node.numericBindings?.[key])
}

function defaultPolicy(source: CopyOSDesignNode, axis: 'width' | 'height'): 'fixed' | 'hug' | 'fill' {
  return source[`${axis}Sizing`] ?? (source.layout === 'row' && axis === 'width' ||
    (source.layout === 'column' || source.layout === 'grid') && axis === 'height' ? 'hug' : 'fixed')
}

/** Resolve authored main defaults in the instance mode without importing the main’s parent allocation.
 * @param source - Authored component root from the component library.
 * @param instance - Stored or contextual instance with its local ownership metadata.
 * @param numbers - Alias-resolved numeric values in the instance mode.
 * @returns Instance projection with effective dimensions, policies and bounds; authored metadata stays unchanged.
 */
export function resolveDesignInstanceSizing(
  source: CopyOSDesignNode,
  instance: CopyOSDesignNode,
  numbers: ReadonlyMap<string, number>,
): CopyOSDesignNode {
  if (instance.instanceSizingOverrides === undefined) return instance
  const result = { ...instance }
  for (const key of DESIGN_INSTANCE_SIZING_KEYS) {
    const owner = designInstanceSizingOwns(instance, key) ? instance : source
    if (key === 'widthSizing' || key === 'heightSizing') {
      result[key] = owner === instance ? (instance[key] ?? 'fixed') : defaultPolicy(source, key === 'widthSizing' ? 'width' : 'height')
    } else {
      const binding = owner.numericBindings?.[key]
      Object.assign(result, { [key]: (binding ? numbers.get(binding) : undefined) ?? owner[key] })
    }
  }
  return result
}

/** Apply explicit sizing edits and record ownership only when the instance uses the new metadata.
 * @param node - Stored node before editing; absent metadata retains legacy local sizing.
 * @param fields - Explicit edits; a supplied ownership mask is authoritative.
 * @returns Edited node; literal dimensions freeze their axis unless an explicit policy was supplied.
 */
export function markDesignInstanceSizingEdit(node: CopyOSDesignNode, fields: Partial<CopyOSDesignNode>): CopyOSDesignNode {
  if (node.kind !== 'instance') return { ...node, ...fields }
  if (fields.kind && fields.kind !== 'instance') return { ...node, ...fields, instanceSizingOverrides: undefined }
  if ('instanceSizingOverrides' in fields) return { ...node, ...fields }
  const edits = { ...fields }
  const clearAxes = (['width', 'height'] as const).filter(axis =>
    fields[`${axis}Sizing`] === 'hug' || fields[`${axis}Sizing`] === 'fill' ||
    (axis in fields && !fields.numericBindings?.[axis]))
  if (clearAxes.some(axis => (fields.numericBindings ?? node.numericBindings)?.[axis]))
    edits.numericBindings = Object.fromEntries(Object.entries(fields.numericBindings ?? node.numericBindings ?? {}).filter(([key]) =>
      !clearAxes.some(axis => axis === key)))
  const ownership = new Set(node.instanceSizingOverrides ?? []), policies: Partial<CopyOSDesignNode> = {}
  for (const key of DESIGN_INSTANCE_SIZING_KEYS) if (key in fields) ownership.add(key)
  for (const axis of ['width', 'height'] as const) {
    const policy = `${axis}Sizing` as const
    if (fields[policy] === 'hug' || fields[policy] === 'fill') ownership.delete(axis)
    const binding = fields.numericBindings?.[axis]
    const changedBinding = !!binding && binding !== node.numericBindings?.[axis]
    if ((axis in fields || changedBinding) && !(policy in fields)) {
      policies[policy] = 'fixed'
      ownership.add(policy)
    }
  }
  return { ...node, ...edits, ...policies,
    ...(node.instanceSizingOverrides !== undefined
      ? { instanceSizingOverrides: DESIGN_INSTANCE_SIZING_KEYS.filter(key => ownership.has(key)) } : {}) }

}

/** Restore selected sizing properties to source inheritance without changing root spacing or content.
 * @param document - Native scene.
 * @param id - Linked instance identity.
 * @param keys - Properties to reset; omitted resets all dimensions, policies and bounds.
 * @returns New scene; legacy subset resets retain local ownership of every other sizing property.
 */
export function resetDesignInstanceSizing(
  document: CopyOSDesignDocument,
  id: string,
  keys: readonly CopyOSDesignInstanceSizingProperty[] = DESIGN_INSTANCE_SIZING_KEYS,
): CopyOSDesignDocument {
  const node = document.nodes.find(item => item.id === id)
  if (node?.kind !== 'instance') return document
  const removed = new Set(keys)
  const instanceSizingOverrides = DESIGN_INSTANCE_SIZING_KEYS.filter(key =>
    !removed.has(key) && (node.instanceSizingOverrides === undefined || node.instanceSizingOverrides.includes(key)))
  const numericBindings = Object.fromEntries(Object.entries(node.numericBindings ?? {}).filter(([key]) =>
    !keys.some(property => property === key)))
  if (JSON.stringify(node.instanceSizingOverrides) === JSON.stringify(instanceSizingOverrides) &&
    JSON.stringify(node.numericBindings ?? {}) === JSON.stringify(numericBindings)) return document
  return { ...document, nodes: document.nodes.map(item => item.id === id ? {
    ...item, instanceSizingOverrides, numericBindings,
  } : item) }
}
