import { designAuthoredEffects, applyDesignEffectStyle } from './design-effect-values.ts'
import { designEffectNumberConfigurationValid, designEffectColorConfigurationValid } from './design-token-values.ts'
/** Ordered shadow ownership preserves scalar legacy documents and canonical linked paths. */
import { designEffectsSchema, designEffectStyleSchema } from './design-effects-schema.ts'
export { designDropShadowSchema, designInnerShadowSchema, designShadowSchema, designLayerBlurSchema, designEffectSchema, designEffectsSchema } from './design-effects-schema.ts'
import { createDesignRenderScene, createDesignInstanceContextReader, editDesignNodes } from './design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignEffect, CopyOSDesignInstanceOverride, CopyOSDesignLayerBlur } from './types.ts'
type Scene = ReturnType<typeof createDesignRenderScene>
/** Expected user-edit failures remain distinct from programming or rendering errors. */
export class DesignEffectsEditError extends Error {
  /** Create a recoverable effect-authoring failure.
   * @param code - Failed target, lock, stack validation or aggregate/override budget.
   * @param message - Internal diagnostic; clients render localized messages by code.
   */
  constructor(readonly code: 'target' | 'locked' | 'stack' | 'budget', message: string) { super(message) }
}
/** Read explicit effect stacks, adapting legacy scalar shadows without modifying their owner.
 * @param node - Effective node after linked inheritance.
 * @returns An independent stack including hidden effects; empty explicit arrays suppress legacy shadows.
 */
export function designNodeEffects(node: Pick<CopyOSDesignNode, 'id' | 'effects' | 'shadow'>): CopyOSDesignEffect[] {
  if (node.effects !== undefined) return node.effects.map((effect) => {
    const copy = { ...effect }
    if (effect.numericBindings) copy.numericBindings = { ...effect.numericBindings }
    return copy
  })
  return node.shadow ? [{ id: node.id, type: 'drop-shadow', visible: true, ...node.shadow, spread: 0 }] : []
}
/** Read authored uniform blur without treating hidden or zero-radius entries as absent ownership.
 * @param node - Effective node after linked inheritance.
 * @returns An independent blur entry including visibility, or undefined when no layer blur is authored.
 */
export function designNodeLayerBlur(node: Pick<CopyOSDesignNode, 'id' | 'effects' | 'shadow'>): CopyOSDesignLayerBlur | undefined {
  return designNodeEffects(node).find(effect => effect.type === 'layer-blur')
}
/** Project linked-root effects without interpreting raw scalar snapshots as local ownership.
 * @param source - Prepared current main root.
 * @param instance - Stored or effective linked root; an explicit array owns the stack.
 * @returns Main-root copy with the effective stack and legacy scalar fallback.
 */
export function applyDesignInstanceEffects(source: CopyOSDesignNode, instance: CopyOSDesignNode): CopyOSDesignNode {
  if (instance.effectStyleId !== undefined) return { ...source, effectStyleId: instance.effectStyleId,
    effects: instance.effects, shadow: source.shadow }
  if (instance.effects !== undefined) return { ...source, effectStyleId: null, effects: instance.effects, shadow: source.shadow }
  return source
}
/** Current and inherited effect data remains separate from authored local stack ownership. */
export interface DesignEffectsContext {
  node: CopyOSDesignNode
  stored: CopyOSDesignNode
  effects: CopyOSDesignEffect[]
  /** Effective stack with authored literal fallbacks and live binding identities. */
  authoredEffects: CopyOSDesignEffect[]
  sourceEffects: CopyOSDesignEffect[]
  localEffects: CopyOSDesignEffect[] | undefined
  owned: boolean
  effectStyleId: string | null
  effectStyleOwned: boolean
  localEffectStyleId: string | null | undefined
  legacyShadow: CopyOSDesignNode['shadow']
  locked: boolean
  overridePath: string[] | null
  effectiveModeId: string | null
}
/** Cached current-only data explicitly omits inherited effects rather than inventing an empty source stack. */
export type DesignEffectsCurrentContext = Omit<DesignEffectsContext, 'sourceEffects'> & { sourceEffectsIncluded: false }
/** Cached effects data identifies whether precise inherited effects were requested. */
export type DesignEffectsReadContext = DesignEffectsCurrentContext | (DesignEffectsContext & { sourceEffectsIncluded: true })
type EffectsReader<Result extends DesignEffectsReadContext> = (id: string, path?: readonly string[]) => Result | undefined

/** Prepare precise inherited effects reads and reuse indexes/results for one immutable document.
 * @param document - Authored validated scene; replace the reader when this snapshot changes.
 * @param scene - Optional render scene from exactly this document.
 * @param options - Omission includes precise inherited effects; false skips counterfactual scenes and omits sourceEffects.
 * @returns Cached borrowed contexts; consumers must not mutate their arrays or scene nodes.
 */
export function createDesignEffectsReader(document: CopyOSDesignDocument, scene?: Scene,
  options?: { includeSourceEffects?: true }): EffectsReader<DesignEffectsContext & { sourceEffectsIncluded: true }>
/** Prepare current-only effects reads without inherited counterfactual scene work.
 * @param document - Authored validated scene; replace the reader when this snapshot changes.
 * @param scene - Optional render scene from exactly this document.
 * @param options - Explicit false omits sourceEffects and marks sourceEffectsIncluded:false.
 * @returns Cached borrowed current contexts; no inherited source stack is represented.
 */
export function createDesignEffectsReader(document: CopyOSDesignDocument, scene: Scene | undefined,
  options: { includeSourceEffects: false }): EffectsReader<DesignEffectsCurrentContext>
/** Prepare cached effects reads when source inclusion is selected dynamically.
 * @param document - Authored validated scene.
 * @param scene - Optional render scene from exactly this immutable document.
 * @param options - Whether to calculate precise inherited source effects.
 * @returns Cached borrowed contexts discriminated by sourceEffectsIncluded.
 */
export function createDesignEffectsReader(document: CopyOSDesignDocument, scene: Scene | undefined,
  options: { includeSourceEffects?: boolean }): EffectsReader<DesignEffectsReadContext>
export function createDesignEffectsReader(document: CopyOSDesignDocument, scene: Scene = createDesignRenderScene(document),
  options: { includeSourceEffects?: boolean } = {}): EffectsReader<DesignEffectsReadContext> {
  const includeSourceEffects = options.includeSourceEffects !== false
  const storedNodes = new Map(document.nodes.map(node => [node.id, node]))
  const styles = new Map(document.effectStyles?.map(style => [style.id, style]))
  const readContext = createDesignInstanceContextReader(document, scene)
  const results = new Map<string, DesignEffectsReadContext | undefined>()
  return (id, path = []) => {
    const key = JSON.stringify([id, path])
    if (results.has(key)) return results.get(key)
    const locate = (): DesignEffectsReadContext | undefined => {
      const stored = storedNodes.get(id)
      if (!stored) return
      if (path.length) {
        const current = readContext(id, path)
        if (!current) return
        const physical = current.node.kind === 'instance'
          ? scene.instance(current.node, current.context)?.byId.get(current.node.componentId ?? '') ?? current.node : current.node
        const base = { node: physical, stored, effects: designNodeEffects(physical),
          authoredEffects: designAuthoredEffects(designNodeEffects(physical)),
          localEffects: current.record?.effects,
          owned: current.record?.effects !== undefined || current.record?.effectStyleId !== undefined,
          effectStyleId: physical.effectStyleId ?? null, effectStyleOwned: current.record?.effectStyleId !== undefined,
          localEffectStyleId: current.record?.effectStyleId, legacyShadow: current.node.shadow,
          locked: current.locked, overridePath: current.overridePath, effectiveModeId: current.context.modes.get(current.node.id) ?? null }
        if (!includeSourceEffects) return { ...base, sourceEffectsIncluded: false }
        let source = current.node
        if (current.record?.effects !== undefined || current.record?.effectStyleId !== undefined) {
          const route = JSON.stringify(current.overridePath)
          const inherited = { ...document, nodes: document.nodes.map(node => node.id !== id ? node : { ...node,
            instanceOverrides: node.instanceOverrides?.map(record => JSON.stringify(record.path) !== route ? record :
              { ...record, effects: undefined, effectStyleId: undefined }) }) }
          source = createDesignInstanceContextReader(inherited)(id, current.effectivePath)?.node ?? current.node
        }
        return { ...base, sourceEffects: designNodeEffects(source), sourceEffectsIncluded: true }
      }
      const node = scene.root.byId.get(id)
      if (!node) return
      let parent: CopyOSDesignNode | undefined = node, locked = false
      const seen = new Set<string>()
      while (parent && !seen.has(parent.id)) {
        locked ||= parent.locked; seen.add(parent.id)
        parent = scene.root.byId.get(parent.parentId ?? '')
      }
      const physical = node.kind === 'instance' ? scene.instance(node, scene.root)?.byId.get(node.componentId ?? '') ?? node : node
      const base = { node: physical, stored, effects: designNodeEffects(physical),
        authoredEffects: designAuthoredEffects(designNodeEffects(physical)),
        localEffects: stored.effects,
        owned: stored.effectStyleId !== undefined || stored.effects !== undefined || stored.kind !== 'instance' && stored.shadow !== undefined,
        effectStyleId: physical.effectStyleId ?? null, effectStyleOwned: stored.effectStyleId !== undefined,
        localEffectStyleId: stored.effectStyleId,
        legacyShadow: node.shadow, locked, overridePath: null, effectiveModeId: scene.root.modes.get(node.id) ?? null }
      if (!includeSourceEffects) return { ...base, sourceEffectsIncluded: false }
      const source = stored.kind === 'instance' ? storedNodes.get(stored.componentId ?? '') : undefined
      return { ...base, sourceEffects: source ? designNodeEffects(applyDesignEffectStyle(source, styles)) : [],
        sourceEffectsIncluded: true }
    }
    const result = locate()
    results.set(key, result)
    return result
  }
}
/** Read one ordinary, linked-root or linked-descendant stack with precise inheritance and locks.
 * @param document - Authored validated scene.
 * @param id - Stored layer or outer instance identity.
 * @param path - Optional descendant path; ordinary ancestors are omitted and nested instances remain.
 * @param scene - Reusable current scene from exactly this immutable document.
 * @returns Resolved and authored ownership with the existing precise sourceEffects fields.
 */
export function designEffectsContext(document: CopyOSDesignDocument, id: string, path: readonly string[] = [],
  scene: Scene = createDesignRenderScene(document)): DesignEffectsContext | undefined {
  const result = createDesignEffectsReader(document, scene)(id, path)
  if (!result) return
  const { sourceEffectsIncluded: _included, ...context } = result
  return context
}
/** Check stack identity/domain limits and the document's authored effect budget.
 * @param document - Candidate containing ordinary/root and descendant stacks.
 * @returns Whether each stack is valid and the document contains at most 10000 authored effects.
 */
export function designEffectsDocumentValid(document: CopyOSDesignDocument): boolean {
  const styles = document.effectStyles ?? []
  if (styles.length > 1000 || new Set(styles.map(style => style.id)).size !== styles.length ||
    styles.some(style => !designEffectStyleSchema.safeParse(style).success)) return false
  const ids = new Set(styles.map(style => style.id))
  let total = styles.reduce((sum, style) => sum + style.effects.length, 0)
  for (const node of document.nodes) for (const owner of [node, ...node.instanceOverrides ?? []]) {
    if (owner.effectStyleId && (!ids.has(owner.effectStyleId) || owner.effects !== undefined)) return false
    if (owner.effectStyleId === null && owner.effects === undefined) return false
    if (owner.effects !== undefined) {
      total += owner.effects.length
      if (!designEffectsSchema.safeParse(owner.effects).success) return false
    }
  }
  if (total > 10000) return false
  return designEffectNumberConfigurationValid(document) && designEffectColorConfigurationValid(document)
}
/** One complete stack replacement or inheritance reset, addressed by its stored owner and optional contextual path. */
export type DesignEffectsChange = { nodeId: string; path?: readonly string[] | undefined } & (
  { effects: readonly CopyOSDesignEffect[] | null } | { effectStyleId: string } | { detachStyle: true }
)
/** Replace complete effect stacks atomically using one input scene and final ownership limits.
 * @param document - Validated immutable input; target aliases and locks are admitted against this snapshot.
 * @param changes - Unique effective targets; null resets ordinary legacy data or linked ownership, while [] owns none.
 * @returns One candidate with provided effect identities preserved; empty batches return the original document.
 */
export function editDesignEffectsBatch(document: CopyOSDesignDocument, changes: readonly DesignEffectsChange[]): CopyOSDesignDocument {
  if (!changes.length) return document
  const scene = createDesignRenderScene(document)
  const readContext = createDesignInstanceContextReader(document, scene)
  const storedNodes = new Map(document.nodes.map(node => [node.id, node]))
  const targets = new Set<string>()
  const styleIds = new Set(document.effectStyles?.map(style => style.id))
  const owners = new Map<string, { node: CopyOSDesignNode; records?: Map<string, CopyOSDesignInstanceOverride> }>()
  for (const change of changes) {
    const stored = storedNodes.get(change.nodeId), path = change.path ?? []
    if (!stored) throw new DesignEffectsEditError('target', 'Effect target was not found')
    let route: readonly string[] = [], effectivePath: readonly string[] = [], locked = false
    let effective: CopyOSDesignNode | undefined
    let localStyleId = stored.effectStyleId
    if (path.length) {
      const current = readContext(change.nodeId, path)
      if (!current) throw new DesignEffectsEditError('target', 'Effect target was not found')
      effective = current.node.kind === 'instance' ? scene.instance(current.node, current.context)?.byId.get(current.node.componentId ?? '') : current.node
      localStyleId = current.record?.effectStyleId
      route = current.overridePath
      effectivePath = current.effectivePath
      locked = current.locked
    } else {
      let current = scene.root.byId.get(change.nodeId)
      if (!current) throw new DesignEffectsEditError('target', 'Effect target was not found')
      effective = current.kind === 'instance' ? scene.instance(current, scene.root)?.byId.get(current.componentId ?? '') : current
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        locked ||= current.locked
        seen.add(current.id)
        current = scene.root.byId.get(current.parentId ?? '')
      }
    }
    if (locked) throw new DesignEffectsEditError('locked', 'Effect target is locked')
    const targetKey = JSON.stringify([change.nodeId, effectivePath])
    if (targets.has(targetKey)) throw new DesignEffectsEditError('target', 'Duplicate effect target')
    targets.add(targetKey)
    const requested = 'effects' in change ? change.effects : 'detachStyle' in change
      ? effective && designAuthoredEffects(designNodeEffects(effective)) : undefined
    const styleId = 'effectStyleId' in change ? change.effectStyleId : requested === null ? undefined :
      typeof effective?.effectStyleId === 'string' || localStyleId === null || 'detachStyle' in change ? null : undefined
    if (typeof styleId === 'string' && !styleIds.has(styleId))
      throw new DesignEffectsEditError('target', 'Effect style was not found')
    if ('detachStyle' in change && !requested) throw new DesignEffectsEditError('target', 'Effect target was not found')
    const parsed = requested == null ? undefined : designEffectsSchema.safeParse(requested)
    if (parsed && !parsed.success) throw new DesignEffectsEditError('stack', 'Invalid effect stack')
    const stack = parsed?.data
    let owner = owners.get(stored.id)
    if (!owner) { owner = { node: stored }; owners.set(stored.id, owner) }
    if (!path.length) {
      owner.node = { ...owner.node, effects: stack, effectStyleId: styleId,
        ...(stored.kind !== 'instance' && requested === null ? { shadow: undefined } : {}) }
      continue
    }
    owner.records ??= new Map((stored.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
    const key = JSON.stringify(route), previous = owner.records.get(key)
    const next = { ...previous, path: [...route], effects: stack, effectStyleId: styleId }
    const retained = Object.entries(next).some(([field, value]) => field !== 'path' && value !== undefined)
    if (retained) owner.records.set(key, next)
    else owner.records.delete(key)
  }
  const updates: (Partial<CopyOSDesignNode> & { id: string })[] = []
  for (const [id, owner] of owners) {
    const node = owner.node
    if (owner.records) {
      if (owner.records.size > 1000) throw new DesignEffectsEditError('budget', 'Instance exceeds 1000 overrides')
      const records = [...owner.records.values()]
      updates.push({ id, effects: node.effects, effectStyleId: node.effectStyleId, shadow: node.shadow,
        instanceOverrides: records.length ? records : undefined })
    } else updates.push({ id, effects: node.effects, effectStyleId: node.effectStyleId, shadow: node.shadow })
  }
  const candidate = editDesignNodes(document, updates)
  if (!designEffectsDocumentValid(candidate)) throw new DesignEffectsEditError('budget', 'Invalid effect stack or document effect budget')
  if (candidate.nodes.reduce((total, node) => total + (node.instanceOverrides?.length ?? 0), 0) > 10000)
    throw new DesignEffectsEditError('budget', 'Design exceeds 10000 instance overrides')
  return candidate
}
/** Edit one complete effect stack without changing paints, content or other override ownership.
 * @param document - Current scene; failed validation never modifies it.
 * @param id - Stored layer or outer linked owner.
 * @param effects - Ordered local stack; null clears ordinary legacy/stack data or restores linked inheritance.
 * @param path - Optional canonical or authored descendant path.
 * @returns Updated immutable candidate; invalid domains, targets, locks and budgets throw.
 */
export function editDesignEffects(document: CopyOSDesignDocument, id: string,
  effects: readonly CopyOSDesignEffect[] | null, path: readonly string[] = []): CopyOSDesignDocument {
  return editDesignEffectsBatch(document, [{ nodeId: id, path, effects }])
}
