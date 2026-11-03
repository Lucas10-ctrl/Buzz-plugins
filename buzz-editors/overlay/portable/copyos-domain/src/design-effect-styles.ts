/** Local effect styles preserve complete authored stacks while each consumer resolves its own token mode. */
import { designEffectStyleSchema } from './design-effects-schema.ts'
import { designAuthoredEffects, resolveDesignEffects } from './design-effect-values.ts'
import { designEffectsDocumentValid, editDesignEffectsBatch, DesignEffectsEditError, type DesignEffectsChange } from './design-effects.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignNumberVariables, resolveDesignColorVariables } from './design-token-values.ts'
import { designColorVariableCss } from './design-color.ts'
import type { CopyOSDesignDocument, CopyOSDesignEffectStyle, CopyOSDesignEffect } from './types.ts'
/** Ordinary/root or canonical linked-descendant target for style application and detachment. */
export interface DesignEffectStyleTarget { nodeId: string; path?: readonly string[] | undefined }
/** Reusable definition with raw fallbacks and the same stack resolved in one explicit mode. */
export interface DesignEffectStyleContext {
  style: CopyOSDesignEffectStyle
  authoredEffects: CopyOSDesignEffect[]
  effects: CopyOSDesignEffect[]
  effectiveModeId: string | null
}
/** Read a local style without fabricating a layer or borrowing a selected owner's geometry.
 * @param document - Immutable local library.
 * @param id - Style identity.
 * @param modeId - Explicit mode, null for Base; omission selects the document mode.
 * @returns Authored and resolved stacks, or undefined when the style does not exist.
 */
export function designEffectStyleContext(document: CopyOSDesignDocument, id: string,
  modeId: string | null = document.activeTokenModeId ?? null): DesignEffectStyleContext | undefined {
  const style = document.effectStyles?.find(value => value.id === id)
  if (!style) return
  if (modeId && !document.tokenModes?.some(mode => mode.id === modeId)) throw new DesignEffectsEditError('target', 'Token mode was not found')
  const resources = designModeResources(document, modeId)
  const numbers = new Map(resolveDesignNumberVariables(resources.numberVariables).map(value => [value.id, value.value]))
  const colors = new Map(resolveDesignColorVariables(resources.variables, resources.numberVariables)
    .map(value => [value.id, designColorVariableCss(value)]))
  return { style, authoredEffects: designAuthoredEffects(style.effects),
    effects: resolveDesignEffects(style.effects, numbers, colors) ?? [], effectiveModeId: modeId }
}
/** One atomic resource/consumer edit; definitions are updated before deletion snapshots and target edits. */
export interface DesignEffectStyleResourceChanges {
  upsertStyles?: readonly CopyOSDesignEffectStyle[] | undefined
  removeStyleIds?: readonly string[] | undefined
  changes?: readonly DesignEffectsChange[] | undefined
}
/** Stage style updates, preserve deleted styles at explicit consumers, then apply mixed target edits and validate the final result.
 * @param document - Admitted graph/resources; immutable effect candidates may temporarily exceed effect capacities.
 * @param edits - Definitions, deletions and unique effective target edits; detachment uses post-upsert authored properties.
 * @returns Final validated effect ownership; resource mutations can update locked consumers, while target edits respect locks.
 */
export function editDesignEffectStyleResources(document: CopyOSDesignDocument,
  edits: DesignEffectStyleResourceChanges): CopyOSDesignDocument {
  const styles = new Map((document.effectStyles ?? []).map(style => [style.id, style]))
  const upserts = new Set<string>()
  for (const input of edits.upsertStyles ?? []) {
    const parsed = designEffectStyleSchema.safeParse(input)
    if (!parsed.success || upserts.has(input.id)) throw new DesignEffectsEditError('stack', 'Invalid or duplicate effect style')
    upserts.add(input.id); styles.set(input.id, parsed.data)
  }
  const removed = new Set(edits.removeStyleIds ?? [])
  if (removed.size !== (edits.removeStyleIds?.length ?? 0)) throw new DesignEffectsEditError('target', 'Duplicate effect style deletion')
  for (const id of removed) if (!styles.has(id)) throw new DesignEffectsEditError('target', 'Effect style was not found')
  const materialize = <T extends { effectStyleId?: string | null | undefined; effects?: CopyOSDesignEffect[] | undefined }>
  (owner: T): T => {
    if (!owner.effectStyleId || !removed.has(owner.effectStyleId)) return owner
    const style = styles.get(owner.effectStyleId)
    if (!style) throw new DesignEffectsEditError('target', 'Effect style was not found')
    return { ...owner, effectStyleId: null, effects: designAuthoredEffects(style.effects) }
  }
  const nodes = removed.size ? document.nodes.map(node => ({ ...materialize(node),
    instanceOverrides: node.instanceOverrides?.map(materialize) })) : document.nodes
  for (const id of removed) styles.delete(id)
  const definitions = [...styles.values()]
  const staged = { ...document, effectStyles: definitions.length ? definitions : undefined, nodes }
  const candidate = editDesignEffectsBatch(staged, edits.changes ?? [])
  if (!designEffectsDocumentValid(candidate)) throw new DesignEffectsEditError('budget', 'Invalid effect styles, resources or authored effect budget')
  return candidate
}
/** Create a reusable local stack without assigning it to a consumer.
 * @param document - Local library.
 * @param style - New UUID, metadata and complete authored stack.
 * @returns Document containing the definition; duplicate identities and invalid effects/resources reject.
 */
export function createDesignEffectStyle(document: CopyOSDesignDocument, style: CopyOSDesignEffectStyle): CopyOSDesignDocument {
  if (document.effectStyles?.some(value => value.id === style.id)) throw new DesignEffectsEditError('target', 'Effect style already exists')
  return editDesignEffectStyleResources(document, { upsertStyles: [style] })
}
/** Update shared metadata or effects without rewriting consumers or capturing their current-mode values.
 * @param document - Local library.
 * @param id - Existing definition identity.
 * @param patch - Name, description or complete authored effects; undefined description clears it.
 * @returns Updated definition and live consumers, including locked layers.
 */
export function updateDesignEffectStyle(document: CopyOSDesignDocument, id: string,
  patch: Partial<Omit<CopyOSDesignEffectStyle, 'id'>>): CopyOSDesignDocument {
  const style = document.effectStyles?.find(value => value.id === id)
  if (!style) throw new DesignEffectsEditError('target', 'Effect style was not found')
  return editDesignEffectStyleResources(document, { upsertStyles: [{ ...style, ...patch }] })
}
/** Delete a local style while materializing its raw stack only at explicit consumers.
 * @param document - Local library and consumers.
 * @param id - Existing definition identity.
 * @returns Consumers keep token refs/fallbacks and appearance; inherited consumers continue following their source.
 */
export function removeDesignEffectStyle(document: CopyOSDesignDocument, id: string): CopyOSDesignDocument {
  return editDesignEffectStyleResources(document, { removeStyleIds: [id] })
}
/** Bind one shared complete stack to unique editable targets atomically.
 * @param document - Local library and scene.
 * @param targets - Ordinary/root or contextual descendant targets.
 * @param styleId - Existing definition identity.
 * @returns Style ownership with local literal stacks removed; source and siblings remain unchanged.
 */
export function applyDesignEffectStyleBatch(document: CopyOSDesignDocument, targets: readonly DesignEffectStyleTarget[],
  styleId: string): CopyOSDesignDocument {
  return editDesignEffectStyleResources(document, { changes: targets.map(target => ({ ...target, effectStyleId: styleId })) })
}
/** Detach styles by capturing complete authored stacks while retaining every token reference and literal fallback.
 * @param document - Local library and scene.
 * @param targets - Unique editable owners or contextual descendants.
 * @returns Literal whole-stack ownership; future shared edits no longer affect these targets.
 */
export function detachDesignEffectStyleBatch(document: CopyOSDesignDocument,
  targets: readonly DesignEffectStyleTarget[]): CopyOSDesignDocument {
  return editDesignEffectStyleResources(document, { changes: targets.map(target => ({ ...target, detachStyle: true })) })
}
