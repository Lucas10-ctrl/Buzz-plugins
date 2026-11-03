/** Layer blending controls descendant isolation while linked ownership follows existing typed override paths. */
export { DESIGN_LAYER_BLEND_MODES, designLayerBlendModeSchema } from './design-paint-blend.ts'
import { createDesignRenderScene, createDesignInstanceContextReader, editDesignNodes } from './design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignLayerBlendMode, CopyOSDesignPaintBlendMode } from './types.ts'
/** Read a resolved layer mode with the ordinary absent-field default.
 * @param node - Resolved node, with linked source inheritance already projected.
 * @returns Effective layer mode; omitted ordinary values pass through.
 */
export function designNodeLayerBlendMode(node: Pick<CopyOSDesignNode, 'blendMode'>): CopyOSDesignLayerBlendMode {
  return node.blendMode ?? 'pass-through'
}
/** Map layer modes to shared Canvas/SVG CSS without turning pass-through into an isolated group.
 * @param node - Resolved layer.
 * @returns Isolation and output-composite mode; non-default group opacity/filter/masks retain their CSS isolation semantics.
 */
export function designLayerBlendStyle(node: Pick<CopyOSDesignNode, 'blendMode'>): {
  isolation: 'auto' | 'isolate'
  mixBlendMode: CopyOSDesignPaintBlendMode
} {
  const mode = designNodeLayerBlendMode(node)
  return mode === 'pass-through' ? { isolation: 'auto', mixBlendMode: 'normal' } : { isolation: 'isolate', mixBlendMode: mode }
}
/** Edit ordinary or linked-root blend ownership without touching paints, opacity or descendants.
 * @param document - Complete authored scene.
 * @param id - Stored node identity.
 * @param blendMode - Explicit local mode; undefined restores pass-through or linked inheritance.
 * @returns Independent candidate; save validation remains authoritative.
 */
export function editDesignLayerBlendMode(document: CopyOSDesignDocument, id: string,
  blendMode: CopyOSDesignLayerBlendMode | undefined): CopyOSDesignDocument {
  return editDesignNodes(document, [{ id, blendMode }])
}
/** Merge contextual blend edits without rendering intermediate documents.
 * @param instance - Stored linked owner.
 * @param edits - Canonical existing override paths; null removes only blend ownership.
 * @returns Owner retaining all unrelated content, grid, layout, swap and measurement metadata.
 */
export function mergeDesignInstanceBlendModes(instance: CopyOSDesignNode,
  edits: readonly { path: readonly string[]; blendMode: CopyOSDesignLayerBlendMode | null }[]): CopyOSDesignNode {
  if (instance.kind !== 'instance' || !edits.length) return instance
  const records = new Map((instance.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
  for (const edit of edits) {
    const key = JSON.stringify(edit.path), record = { ...records.get(key), path: [...edit.path], blendMode: edit.blendMode ?? undefined }
    if (Object.entries(record).some(([field, value]) => field !== 'path' && value !== undefined)) records.set(key, record)
    else records.delete(key)
  }
  return { ...instance, instanceOverrides: records.size ? [...records.values()] : undefined }
}
/** Edit a linked descendant's layer mode through the same canonical path used by rendering and inspection.
 * @param document - Complete authored scene.
 * @param instanceId - Stored outer linked owner.
 * @param path - Contextual target path, including nested instance hops.
 * @param blendMode - Explicit mode, or null to reveal current inherited behavior.
 * @returns Candidate preserving the source and sibling instances.
 */
export function editDesignInstanceBlendMode(document: CopyOSDesignDocument, instanceId: string, path: readonly string[],
  blendMode: CopyOSDesignLayerBlendMode | null): CopyOSDesignDocument {
  const target = createDesignInstanceContextReader(document)(instanceId, path)
  if (!target) throw new Error('Instance blend target not found')
  const next = mergeDesignInstanceBlendModes(target.stored, [{ path: target.overridePath, blendMode }])
  return editDesignNodes(document, [{ id: instanceId, instanceOverrides: next.instanceOverrides }])
}
/** Current layer appearance and explicit ownership, including inherited linked contexts. */
export interface DesignLayerBlendContext {
  node: CopyOSDesignNode
  stored: CopyOSDesignNode
  owned: boolean
  localBlendMode: CopyOSDesignLayerBlendMode | undefined
  effectiveBlendMode: CopyOSDesignLayerBlendMode
  sourceBlendMode: CopyOSDesignLayerBlendMode
  locked: boolean
  overridePath: string[] | null
  parentPath: string[] | null
}
/** Read effective and inherited layer blending without treating a resolved projection as authored ownership.
 * @param document - Complete authored scene.
 * @param id - Stored ordinary/root layer or outer linked owner.
 * @param path - Optional descendant contextual path.
 * @param scene - Shared current render scene, avoiding repeated current-tree construction.
 * @returns Ownership metadata; owned contextual targets use one counterfactual scene to expose precise inherited behavior.
 */
export function designLayerBlendContext(document: CopyOSDesignDocument, id: string, path?: readonly string[],
  scene = createDesignRenderScene(document)): DesignLayerBlendContext | undefined {
  const stored = document.nodes.find(node => node.id === id)
  if (!stored) return
  if (path?.length) {
    const target = createDesignInstanceContextReader(document, scene)(id, path)
    if (!target) return
    const localBlendMode = target.record?.blendMode
    let source = target.node
    if (localBlendMode !== undefined) {
      const reset = editDesignNodes(document, [{ id, instanceOverrides: mergeDesignInstanceBlendModes(stored,
        [{ path: target.overridePath, blendMode: null }]).instanceOverrides }])
      source = createDesignInstanceContextReader(reset)(id, path)?.node ?? source
    }
    return { node: target.node, stored, owned: localBlendMode !== undefined, localBlendMode,
      effectiveBlendMode: designNodeLayerBlendMode(target.node), sourceBlendMode: designNodeLayerBlendMode(source), locked: target.locked,
      overridePath: target.overridePath, parentPath: target.parentPath }
  }
  const node = scene.root.byId.get(id)
  if (!node) return
  const source = stored.kind === 'instance' ? document.nodes.find(item => item.id === stored.componentId) : undefined
  let locked = stored.locked, parentId = stored.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId) && seen.size < 64) {
    seen.add(parentId)
    const parent = scene.root.byId.get(parentId)
    locked ||= !!parent?.locked
    parentId = parent?.parentId ?? null
  }
  return { node, stored, owned: stored.blendMode !== undefined, localBlendMode: stored.blendMode,
    effectiveBlendMode: designNodeLayerBlendMode(node), sourceBlendMode: designNodeLayerBlendMode(source ?? {}),
    locked, overridePath: null, parentPath: null }
}
