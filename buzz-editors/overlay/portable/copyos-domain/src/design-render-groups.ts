/** Partition a stored layer list into independently laid-out top-level trees for incremental scene builds. */
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

/** One top-level tree in stored order. */
export interface DesignRenderGroup {
  /** Top-level layer, or a layer whose parent is absent. */
  root: CopyOSDesignNode
  /** Root and every descendant, in stored document order. */
  members: CopyOSDesignNode[]
  /** True when the tree holds a main, a component set, or a layer that an instance or swap references. */
  template: boolean
  /** True when the tree's layout reads other trees: it is a template tree or holds an instance. */
  readsTemplates: boolean
}

/** Stored layers split by top-level tree. */
export interface DesignRenderPartition {
  groups: DesignRenderGroup[]
  /** Group index of each stored layer, aligned with `document.nodes`. */
  groupOf: number[]
  /** Template tree members in stored order; instance layout reads only these layers. */
  templates: CopyOSDesignNode[]
}

/** Document fields, besides `nodes`, that token resolution and layout read. */
export const DESIGN_LAYOUT_DOCUMENT_FIELDS = [
  'variables', 'numberVariables', 'tokenModes', 'activeTokenModeId', 'textStyles', 'effectStyles', 'pages',
] as const satisfies readonly (keyof CopyOSDesignDocument)[]

/** Read the layout-relevant document fields for identity comparison.
 * @param document - Native scene.
 * @returns Field values in `DESIGN_LAYOUT_DOCUMENT_FIELDS` order.
 */
export function designLayoutDocumentFields(document: CopyOSDesignDocument): readonly unknown[] {
  return DESIGN_LAYOUT_DOCUMENT_FIELDS.map(key => document[key])
}

/** Compare two lists by element identity.
 * @param left - First list.
 * @param right - Second list.
 * @returns True when both lists hold the same values in the same order.
 */
export function sameDesignItems(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

/** Split stored layers into top-level trees.
 * @param nodes - Stored layer list.
 * @returns Trees in first-member order; undefined when duplicate identities or parent cycles
 *   make a split differ from whole-document layout.
 */
export function partitionDesignRenderGroups(nodes: readonly CopyOSDesignNode[]): DesignRenderPartition | undefined {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) return undefined
  const rootOf = new Map<string, string>()
  for (const node of nodes) {
    const path: string[] = []
    let current = node, root: string | undefined
    while (root === undefined) {
      const known = rootOf.get(current.id)
      if (known !== undefined) { root = known; break }
      path.push(current.id)
      if (path.length > nodes.length) return undefined
      const parent = current.parentId === null ? undefined : byId.get(current.parentId)
      if (!parent) root = current.id
      else current = parent
    }
    for (const id of path) rootOf.set(id, root)
  }
  const groups: DesignRenderGroup[] = [], indexOf = new Map<string, number>(), groupOf: number[] = []
  for (const node of nodes) {
    const root = rootOf.get(node.id) ?? node.id
    let index = indexOf.get(root)
    if (index === undefined) {
      index = groups.length
      indexOf.set(root, index)
      groups.push({ root: byId.get(root) ?? node, members: [], template: false, readsTemplates: false })
    }
    const group = groups[index]
    if (!group) return undefined
    group.members.push(node)
    if (node.kind === 'component' || node.kind === 'component-set') group.template = true
    if (node.kind === 'instance') group.readsTemplates = true
    groupOf.push(index)
  }
  const referenced = (id: string | null | undefined) => {
    const root = id ? rootOf.get(id) : undefined
    const group = root === undefined ? undefined : groups[indexOf.get(root) ?? -1]
    if (group) group.template = true
  }
  for (const node of nodes) if (node.kind === 'instance') {
    referenced(node.componentId)
    for (const override of node.instanceOverrides ?? []) referenced(override.componentId)
  }
  const templates: CopyOSDesignNode[] = []
  for (const group of groups) if (group.template) { group.readsTemplates = true; templates.push(...group.members) }
  if (templates.length) {
    const order = new Map(nodes.map((node, index) => [node, index]))
    templates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }
  return { groups, groupOf, templates }
}
