/** Indexed contextual descendant lookup shared by linked layout controls. */
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignInstanceOverride } from './types.ts'
import type { DesignRenderContext, createDesignRenderScene } from './design-model.ts'
import { designComponentPropertyContextPath } from './design-component-properties.ts'

/** Effective descendant and its exact authored override identity, without counterfactual layout work. */
export interface DesignInstanceContext {
  stored: CopyOSDesignNode
  node: CopyOSDesignNode
  parent: CopyOSDesignNode
  context: DesignRenderContext
  locked: boolean
  record: CopyOSDesignInstanceOverride | undefined
  effectivePath: string[]
  overridePath: string[]
  parentPath: string[] | null
}

/** Prepare reusable lookups against one immutable document and shared render scene.
 * @param document - Complete authored library; replace the reader when this object changes.
 * @param scene - Render scene for exactly this document snapshot.
 * @param options - Internal current-only lookups may omit record indexing when only rendered geometry is required.
 * @returns Cached current-context lookup; this never removes overrides or renders inherited counterfactual scenes.
 */
export function createDesignInstanceContextLookup(document: CopyOSDesignDocument, scene: ReturnType<typeof createDesignRenderScene>,
  options: { includeRecord?: boolean } = {}):
(id: string, path: readonly string[]) => DesignInstanceContext | undefined {
  const storedNodes = new Map(document.nodes.map(node => [node.id, node]))
  const records = new Map<string, { aliases: Map<string, CopyOSDesignInstanceOverride>; offset: number }>()
  const results = new Map<string, DesignInstanceContext | undefined>()
  return (id, path) => {
    const cacheKey = JSON.stringify([id, path])
    if (results.has(cacheKey)) return results.get(cacheKey)
    const locate = (): DesignInstanceContext | undefined => {
      const stored = storedNodes.get(id)
      if (stored?.kind !== 'instance' || !path.length || path.length > 64) return
      // A one-hop identity is unchanged by nested source swaps; contextual ancestry is still checked below.
      const effectivePath = path.length === 1 ? [...path] :
        designComponentPropertyContextPath(document, stored, path) ?? [...path]
      let owner = scene.root.byId.get(id), context = scene.root, locked = !!owner?.locked
      let rootParent = owner?.parentId
      const rootAncestors = new Set<string>()
      while (rootParent && !rootAncestors.has(rootParent) && rootAncestors.size < 64) {
        rootAncestors.add(rootParent)
        const ancestor = scene.root.byId.get(rootParent)
        locked ||= !!ancestor?.locked
        rootParent = ancestor?.parentId
      }
      for (const [index, targetId] of effectivePath.entries()) {
        if (!owner?.componentId) return
        const linked = scene.instance(owner, context)
        if (!linked) return
        context = linked
        const node = context.byId.get(targetId), rootId = owner.componentId
        if (!node || node.id === rootId) return
        let parent = node.parentId, found = false
        const seen = new Set<string>()
        locked ||= node.locked
        while (parent && !seen.has(parent) && seen.size < 64) {
          seen.add(parent)
          const ancestor = context.byId.get(parent)
          locked ||= !!ancestor?.locked
          if (parent === rootId) { found = true; break }
          parent = ancestor?.parentId ?? null
        }
        if (!found) return
        if (index !== effectivePath.length - 1) {
          if (node.kind !== 'instance') return
          owner = node
          continue
        }
        const parentNode = context.byId.get(node.parentId ?? '')
        if (!parentNode) return
        let record: CopyOSDesignInstanceOverride | undefined
        if (options.includeRecord !== false) {
          let indexRecords = records.get(id)
          if (!indexRecords) { indexRecords = { aliases: new Map(), offset: 0 }; records.set(id, indexRecords) }
          const key = JSON.stringify(effectivePath)
          record = indexRecords.aliases.get(key)
          while (!record && indexRecords.offset < (stored.instanceOverrides?.length ?? 0)) {
            const candidate = stored.instanceOverrides?.[indexRecords.offset++]
            if (!candidate) break
            const canonical = candidate.path.length === 1 ? candidate.path :
              designComponentPropertyContextPath(document, stored, candidate.path)
            for (const alias of [JSON.stringify(candidate.path), ...(canonical ? [JSON.stringify(canonical)] : [])])
              if (!indexRecords.aliases.has(alias)) indexRecords.aliases.set(alias, candidate)
            record = indexRecords.aliases.get(key)
          }
        }
        const prefix = effectivePath.slice(0, -1)
        return { stored, node, parent: parentNode, context, locked, record, effectivePath: [...effectivePath],
          overridePath: [...record?.path ?? effectivePath],
          parentPath: parentNode.id === rootId ? prefix.length ? prefix : null : [...prefix, parentNode.id] }
      }
    }
    const result = locate()
    results.set(cacheKey, result)
    return result
  }
}
