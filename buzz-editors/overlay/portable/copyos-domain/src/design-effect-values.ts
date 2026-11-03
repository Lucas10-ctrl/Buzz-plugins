import { designColorCssValue } from './design-color.ts'
/** Numeric effect resources are resolved independently of model/layout imports. */
import type { CopyOSDesignEffect, CopyOSDesignNode, CopyOSDesignNumberVariable, CopyOSDesignShadow, CopyOSDesignDocument, CopyOSDesignEffectStyle } from './types.ts'
const authored = Symbol('authoredEffect')
type ResolvedEffect = CopyOSDesignEffect & { [authored]?: CopyOSDesignEffect }
/** Numeric effect fields have separate dimension and unitless domains. */
export type DesignEffectNumberProperty = 'x' | 'y' | 'blur' | 'spread' | 'opacity' | 'radius'
/** Read the required unit and finite literal range for a field supported by this effect.
 * @param effect - Authored effect type.
 * @param key - Requested numeric effect field.
 * @returns Unit and inclusive bounds, or undefined for fields belonging to a different effect type.
 */
export function designEffectNumberLimits(effect: CopyOSDesignEffect, key: string): { unit: 'number' | 'px'; min: number; max: number } | undefined {
  if (effect.type === 'layer-blur') return key === 'radius' ? { unit: 'px', min: 0, max: 10000 } : undefined
  switch (key) {
    case 'x': case 'y': return { unit: 'px', min: -1000000, max: 1000000 }
    case 'blur': return { unit: 'px', min: 0, max: 10000 }
    case 'spread': return { unit: 'px', min: -10000, max: 10000 }
    case 'opacity': return { unit: 'number', min: 0, max: 1 }
    default: return undefined
  }
}
/** Recover raw fallback values from a resolved stack without serializing its transient bookkeeping.
 * @param effects - Authored or resolved effects.
 * @returns Independent effects and binding maps, retaining literal fallbacks.
 */
export function designAuthoredEffects(effects: readonly CopyOSDesignEffect[]): CopyOSDesignEffect[] {
  return effects.map((effect) => {
    const raw = (effect as ResolvedEffect)[authored] ?? effect
    const result = { ...raw }
    if (raw.numericBindings) result.numericBindings = { ...raw.numericBindings }
    return result
  })
}
/** Resolve an effect stack once in the target layer's effective mode.
 * @param effects - Authored or previously resolved effects.
 * @param values - Fully resolved numeric values for that mode.
 * @param colors - Canonical RGBA resource colors for the same mode; omission retains literal color fallbacks.
 * @returns Resolved independent effects carrying transient raw fallback data across contextual node copies.
 */
export function resolveDesignEffects(effects: readonly CopyOSDesignEffect[] | undefined,
  values: ReadonlyMap<string, number>, colors: ReadonlyMap<string, string> = new Map()): CopyOSDesignEffect[] | undefined {
  return effects && designAuthoredEffects(effects).map((effect) => {
    if (!Object.values(effect.numericBindings ?? {}).some(Boolean) &&
      (effect.type === 'layer-blur' || !effect.colorVariableId)) return effect
    const resolved: ResolvedEffect = { ...effect, [authored]: effect }
    for (const [key, id] of Object.entries(effect.numericBindings ?? {})) {
      const value = id ? values.get(id) : undefined
      if (value !== undefined) Object.assign(resolved, { [key]: value })
    }
    if (effect.type !== 'layer-blur' && resolved.type !== 'layer-blur' && effect.colorVariableId) {
      const color = designColorCssValue(colors.get(effect.colorVariableId) ?? '')
      if (color) { resolved.color = color.value; resolved.colorAlpha = color.alpha ?? 1 }
    }
    return resolved
  })
}
/** Enumerate all authored effect bindings, including hidden and dormant descendant stacks.
 * @param node - Stored owner with optional descendant overrides.
 * @returns Resource identities with their required units and inclusive property bounds.
 */
export function designEffectNumberBindings(node: Pick<CopyOSDesignNode, 'effects' | 'instanceOverrides'>): { id: string; unit: 'px' | 'number'; min: number; max: number }[] {
  return [node.effects, ...(node.instanceOverrides ?? []).map(record => record.effects)].flatMap(stack =>
    (stack ?? []).flatMap(effect => Object.entries(effect.numericBindings ?? {}).flatMap(([key, id]) => {
      const limits = designEffectNumberLimits(effect, key)
      return id && limits ? [{ id, ...limits }] : []
    })))
}
/** Validate effect resources against one fully resolved mode.
 * @param nodes - Stored owners, including their descendant stacks.
 * @param values - Mode's resolved numeric resources, including aliases and expressions.
 * @returns Whether every reference exists and fits its required unit and property domain.
 */
export function designEffectBindingsValid(nodes: readonly Pick<CopyOSDesignNode, 'effects' | 'instanceOverrides'>[],
  values: ReadonlyMap<string, CopyOSDesignNumberVariable>): boolean {
  return nodes.every(node => designEffectNumberBindings(node).every((binding) => {
    const value = values.get(binding.id)
    return !!value && value.unit === binding.unit && value.value >= binding.min && value.value <= binding.max
  }))
}

/** Read a shadow's intrinsic color alpha without multiplying independent effect opacity.
 * @param effect - Authored or effective shadow.
 * @returns Intrinsic alpha; existing shadows without a separate color alpha retain one.
 */
export function designEffectColorAlpha(effect: CopyOSDesignShadow): number {
  return effect.colorAlpha ?? 1
}
/** Compose intrinsic resource/literal alpha with independently resolved shadow opacity exactly once.
 * @param effect - Effective shadow after color and numeric mode resolution.
 * @returns Alpha used by renderer floods and visible-shadow bounds; authored fields remain unchanged.
 */
export function designEffectOpacity(effect: CopyOSDesignShadow): number {
  return effect.opacity * designEffectColorAlpha(effect)
}
/** Enumerate live shadow color resources, including hidden and dormant descendant stacks.
 * @param node - Stored owner and descendant overrides.
 * @returns Referenced color resource identities; layer blur has no color fields.
 */
export function designEffectColorBindings(node: Pick<CopyOSDesignNode, 'effects' | 'instanceOverrides'>): string[] {
  return [node.effects, ...(node.instanceOverrides ?? []).map(record => record.effects)].flatMap(stack =>
    (stack ?? []).flatMap(effect => effect.type !== 'layer-blur' && effect.colorVariableId ? [effect.colorVariableId] : []))
}
/** Check effect color identities against a mode's resolved color library.
 * @param nodes - Authored owners and descendant stacks.
 * @param colors - Existing mode-resolved resource identities; alias and numeric alpha validation belongs to the color resolver.
 * @returns Whether every shadow color reference exists, including hidden and dormant effects.
 */
export function designEffectColorBindingsValid(nodes: readonly Pick<CopyOSDesignNode, 'effects' | 'instanceOverrides'>[], colors: ReadonlySet<string>): boolean {
  return nodes.every(node => designEffectColorBindings(node).every(id => colors.has(id)))
}

/** Enumerate authored effect resource owners, counting style definitions once rather than once per consumer.
 * @param document - Stored nodes and reusable local definitions.
 * @returns Literal node/override owners followed by style definitions.
 */
export function designEffectResourceOwners(document: CopyOSDesignDocument): Pick<CopyOSDesignNode, 'effects' | 'instanceOverrides'>[] {
  return [...document.nodes, ...document.effectStyles ?? []]
}
/** Resolve a linked style to its authored stack before any token values are applied.
 * @param node - Prepared owner with its inherited style reference already selected.
 * @param styles - Local style definitions indexed by identity.
 * @returns A node copy with the current style's raw effects, or the unchanged literal owner.
 */
export function applyDesignEffectStyle(node: CopyOSDesignNode, styles: ReadonlyMap<string, CopyOSDesignEffectStyle>): CopyOSDesignNode {
  if (!node.effectStyleId) return node
  const style = styles.get(node.effectStyleId)
  if (!style) throw new Error('Missing effect style')
  return { ...node, effects: designAuthoredEffects(style.effects) }
}
