/** Property ownership and variant-scoped projections preserve stable shared identities without duplicating stored definitions. */
import type { CopyOSDesignComponentProperty, CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
import { designInstanceOverrideTarget } from './design-instance-overrides.ts'
type Library = { readonly nodes: readonly CopyOSDesignNode[] }
// Validation looks up definitions for every layer; builders only append to arrays they own, so a length change invalidates.
const nodeIndexes = new WeakMap<readonly CopyOSDesignNode[], { length: number; byId: Map<string, CopyOSDesignNode> }>()
function firstNodeById(nodes: readonly CopyOSDesignNode[], id: string): CopyOSDesignNode | undefined {
  let index = nodeIndexes.get(nodes)
  if (!index || index.length !== nodes.length) {
    const byId = new Map<string, CopyOSDesignNode>()
    for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
    index = { length: nodes.length, byId }
    nodeIndexes.set(nodes, index)
  }
  return index.byId.get(id)
}
/** Read reusable definitions visible on a main, projecting shared set targets into that variant's override space.
 * @param document - Complete authored library.
 * @param componentId - Main component or component-set identity.
 * @returns Shared definitions followed by local definitions; inactive shared controls retain empty targets and their identity.
 */
export function designComponentPropertyDefinitions(document: Library, componentId: string): CopyOSDesignComponentProperty[] {
  const source = firstNodeById(document.nodes, componentId)
  if (!source) return []
  const parent = source.kind === 'component' && source.parentId !== null ? firstNodeById(document.nodes, source.parentId) : undefined
  const set = parent?.kind === 'component-set' ? parent : undefined
  return [...(set?.componentProperties ?? []).map(property => ({ ...property,
    targets: property.targets.filter(path => path[0] === componentId).map(path => path.slice(1)) })),
  ...source.componentProperties ?? []]
}
/** Locate the stored owner of a globally unique property identity.
 * @param document - Authored library.
 * @param propertyId - Reusable control identity.
 * @returns The defining main or set, without guessing from display names.
 */
export function designComponentPropertyOwner(document: Library, propertyId: string): CopyOSDesignNode | undefined {
  return document.nodes.find(node => node.componentProperties?.some(property => property.id === propertyId))
}
/** Resolve a definition target in its owner's authored path space.
 * @param document - Complete library.
 * @param owner - Stored main or component set.
 * @param path - Main-relative override path, or set path prefixed by a direct variant identity.
 * @returns Valid descendant; variant roots themselves cannot be property targets.
 */
export function designComponentPropertyTarget(document: Library, owner: CopyOSDesignNode
  , path: readonly string[]): CopyOSDesignNode | undefined {
  if (owner.kind === 'component-set') {
    const member = document.nodes.find(node => node.id === path[0] && node.parentId === owner.id && node.kind === 'component')
    return member && path.length > 1
      ? designInstanceOverrideTarget(document.nodes, { ...member, kind: 'instance', componentId: member.id }, path.slice(1)) : undefined
  }
  return designInstanceOverrideTarget(document.nodes, { ...owner, kind: 'instance', componentId: owner.id }, path)
}
/** Materialize a departing/copied variant's shared controls without changing source ownership or geometry.
 * @param document - Complete authored library.
 * @param componentId - Variant becoming standalone.
 * @param newId - Fresh property identity allocator.
 * @returns Existing local and fresh projected shared definitions plus old-to-local shared identity mappings.
 */
export function materializeDesignComponentPropertyDefinitions(document: Library, componentId: string, newId: () => string)
  : { properties: CopyOSDesignComponentProperty[]; ids: Map<string, string> } {
  const owner = document.nodes.find(node => node.id === componentId)
  const ids = new Map<string, string>()
  const properties = designComponentPropertyDefinitions(document, componentId).map((property) => {
    if (owner?.componentProperties?.some(local => local.id === property.id)) return property
    const id = newId()
    if (document.nodes.some(node => node.id === id
      || node.componentProperties?.some(value => value.id === id)) || [...ids.values()].includes(id))
      throw new Error('Materialized component property identity must be fresh')
    ids.set(property.id, id)
    return { ...property, id, targets: property.targets.map(path => [...path]) }
  })
  return { properties, ids }
}
/** Preserve reusable controls when authored variants leave their set, including raw native reparenting.
 * @param before - Validated library before the membership change.
 * @param after - Candidate library after reparenting/deleting a set container.
 * @param newId - Property allocator; omitted uses the platform UUID generator.
 * @returns Candidate with fresh local definitions and source-specific instance value mappings; repeated reconciliation is idempotent.
 */
export function materializeDesignComponentDepartures(before: Library, after: CopyOSDesignDocument,
  newId: () => string = () => globalThis.crypto.randomUUID()): CopyOSDesignDocument {
  let nodes = after.nodes
  for (const previous of before.nodes) {
    if (previous.kind !== 'component') continue
    const set = before.nodes.find(node => node.id === previous.parentId && node.kind === 'component-set')
    if (!set?.componentProperties?.length) continue
    const current = nodes.find(node => node.id === previous.id && node.kind === 'component')
    if (!current || (current.parentId === set.id && nodes.some(node => node.id === set.id && node.kind === 'component-set'))) continue
    const shared = designComponentPropertyDefinitions(before, previous.id)
      .filter(property => set.componentProperties?.some(value => value.id === property.id))
    const ids = new Map<string, string>(), properties = [...current.componentProperties ?? []]
    for (const property of shared) {
      const existing = properties.find(value => value.name.trim() === property.name.trim() && value.type === property.type)
      const id = existing?.id ?? newId()
      if (!existing && (nodes.some(node => node.id === id || node.componentProperties?.some(value => value.id === id)) ||
        properties.some(value => value.id === id))) throw new Error('Materialized component property identity must be fresh')
      ids.set(property.id, id)
      if (!existing) properties.push({ ...property, id, targets: property.targets.filter(path =>
        designInstanceOverrideTarget(nodes, { ...current, kind: 'instance', componentId: current.id }, path)) })
    }
    nodes = nodes.map(node => node.id === current.id ? { ...node, componentProperties: properties } :
      node.kind === 'instance' && node.componentId === current.id ? { ...node,
        componentPropertyValues: node.componentPropertyValues?.map(value => ({ ...value,
          propertyId: ids.get(value.propertyId) ?? value.propertyId })) } : node)
  }
  return { ...after, nodes }
}
