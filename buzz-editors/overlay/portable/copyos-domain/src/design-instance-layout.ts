/** Inherited component-root spacing and stack settings shared by measurement and rendered scenes. */
import type { CopyOSDesignInstanceLayout, CopyOSDesignNode } from './types.ts'

/** Supported local root settings; no geometry, sizing, grid tracks or descendant edits. */
export const DESIGN_INSTANCE_LAYOUT_KEYS = [
  'layout', 'gap', 'crossGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'alignItems', 'justifyContent', 'layoutWrap', 'alignContent',
] as const satisfies readonly (keyof CopyOSDesignInstanceLayout)[]

/** Existing node numeric bindings that override linked root spacing rather than instance geometry. */
export const DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS = [
  'gap', 'crossGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
] as const satisfies readonly (keyof CopyOSDesignInstanceLayout)[]

/** Local root setting status after checking the source flow and active numeric values. */
export interface DesignInstanceLayoutEligibility {
  activeKeys: (keyof CopyOSDesignInstanceLayout)[]
  dormantKeys: (keyof CopyOSDesignInstanceLayout)[]
}

/** Classify local settings without dropping values that a later source flow or mode can restore.
 * @param source - Current component root.
 * @param instance - Linked instance carrying literals and numeric bindings.
 * @param numbers - Alias-resolved resource values in the rendered instance mode.
 * @returns Active settings and retained dormant settings; negative grid gap locals inherit the source gap.
 */
export function instanceLayoutEligibility(
  source: CopyOSDesignNode | undefined,
  instance: CopyOSDesignNode,
  numbers: ReadonlyMap<string, number>,
): DesignInstanceLayoutEligibility {
  const activeKeys: (keyof CopyOSDesignInstanceLayout)[] = [], dormantKeys: (keyof CopyOSDesignInstanceLayout)[] = []
  for (const key of DESIGN_INSTANCE_LAYOUT_KEYS) {
    const numeric = DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.find(property => property === key)
    const binding = numeric ? instance.numericBindings?.[numeric] : undefined
    const literal = instance.instanceLayout?.[key]
    if (literal === undefined && !binding) continue
    const grid = source?.layout === 'grid'
    const value = binding ? numbers.get(binding) : literal
    const active = source && (source.layout === 'row' || source.layout === 'column' ||
      (grid && numeric && (key !== 'gap' || (typeof value === 'number' && value >= 0))))
    ;(active ? activeKeys : dormantKeys).push(key)
  }
  return { activeKeys, dormantKeys }
}

/** Apply local root settings before resolving inherited numeric resources.
 * @param source - Component root with authored settings and numeric references.
 * @param instance - Linked instance whose local settings take precedence.
 * @param numbers - Alias-resolved resource values in the instance mode.
 * @returns Effective root; unsupported flow settings and negative grid gaps remain dormant.
 */
export function applyDesignInstanceLayout(
  source: CopyOSDesignNode,
  instance: CopyOSDesignNode,
  numbers: ReadonlyMap<string, number>,
): CopyOSDesignNode {
  const { activeKeys } = instanceLayoutEligibility(source, instance, numbers)
  const fields = Object.fromEntries(Object.entries(instance.instanceLayout ?? {}).filter(([key, value]) =>
    value !== undefined && activeKeys.some(property => property === key)))
  const bindings = Object.fromEntries(DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.flatMap((key) => {
    const id = instance.numericBindings?.[key]
    return id && activeKeys.includes(key) ? [[key, id]] : []
  }))
  if (!Object.keys(fields).length && !Object.keys(bindings).length) return source
  return {
    ...source,
    ...fields,
    preserveLayout: false,
    numericBindings: {
      ...Object.fromEntries(Object.entries(source.numericBindings ?? {}).filter(([key]) => !(key in fields))),
      ...bindings,
    },
  }
}
