/** Exact current-document CSS names preserve local resource identities during native CSS reimport. */
import { designTokenCssNames } from './design-token-css-names.ts'
import type { CopyOSDesignDocument } from './types.ts'
interface DesignTokenImportNames {
  document: CopyOSDesignDocument
  properties: Record<string, string>[]
  retained: Set<string>[]
  restore: (document: CopyOSDesignDocument) => CopyOSDesignDocument
}
/** Normalize exact canonical names and unambiguous existing names without inferring identities from arbitrary UUID text.
 * @param document - Current resources whose shared export registry supplies the only canonical identities.
 * @param sets - Base and contextual CSS declarations.
 * @param exported - Exact previous native declarations for Base or recognized mode sets; other contexts do not retain implicit ownership.
 * @returns Temporary canonical-name library and declarations, or an explicit conflict for the whole import plan.
 */
export function prepareDesignTokenImportNames(document: CopyOSDesignDocument,
  sets: readonly Readonly<Record<string, string>>[], exported: readonly (Readonly<Record<string, string>> | undefined)[],
): DesignTokenImportNames | { conflict: string } {
  const registry = designTokenCssNames(document), canonical = new Set([...registry.color.values(), ...registry.number.values()])
  const names = new Map<string, string>(), counts = new Map<string, number>(), originals = new Map<string, string>()
  for (const [kind, values] of [['color', document.variables], ['number', document.numberVariables ?? []]] as const)
    for (const value of values) {
      const target = (registry[kind].get(value.id) ?? value.name)
      names.set(target, target); originals.set(`${kind}:${value.id}`, value.name)
      counts.set(value.name, (counts.get(value.name) ?? 0) + 1)
    }
  const active = sets.some(properties => Object.entries(properties).some(([name, value]) => canonical.has(name) ||
    [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(match => canonical.has((match[1] ?? '')))))
  if (!active) return { document, properties: sets.map(value => ({ ...value })),
    retained: sets.map(() => new Set()), restore: value => value }
  for (const [kind, values] of [['color', document.variables], ['number', document.numberVariables ?? []]] as const)
    for (const value of values)
      if (!canonical.has(value.name) && counts.get(value.name) === 1 && /^--[\w-]+$/.test(value.name))
        names.set(value.name, (registry[kind].get(value.id) ?? value.name))
  const rewrite = (value: string) => value.replace(/var\(\s*(--[\w-]+)/g,
    (whole, name: string) => whole.replace(name, names.get(name) ?? name))
  const properties: Record<string, string>[] = [], retained: Set<string>[] = []
  for (const [index, input] of sets.entries()) {
    const output: Record<string, string> = {}, keep = new Set<string>(), assigned = new Set<string>()
    for (const [name, raw] of Object.entries(input)) {
      if (!canonical.has(name) && (counts.get(name) ?? 0) > 1)
        return { conflict: `CSS token import was rolled back: ${name} matches ambiguous existing resources.` }
      if ([...raw.matchAll(/var\(\s*(--[\w-]+)/g)].some(match => !canonical.has((match[1] ?? '')) && (counts.get((match[1] ?? '')) ?? 0) > 1))
        return { conflict: 'CSS token import was rolled back: a variable reference matches ambiguous existing resources.' }
      const target = names.get(name) ?? name, value = rewrite(raw)
      // Native friendly exports alias their own canonical declaration; persisting that alias would create a self-cycle.
      if (name !== target && new RegExp(`^var\\(\\s*${target}\\s*\\)$`).test(value.trim())) continue
      if (assigned.has(target)) return { conflict: `CSS token import was rolled back: conflicting canonical and named declarations for ${target}.` }
      assigned.add(target)
      if (canonical.has(name) && exported[index]?.[name] === raw.trim()) keep.add(target)
      else output[target] = value
    }
    properties.push(output); retained.push(keep)
  }
  return { document: { ...document,
    variables: document.variables.map(value => ({ ...value, name: registry.color.get(value.id) ?? value.name })),
    numberVariables: document.numberVariables?.map(value => ({ ...value, name: registry.number.get(value.id) ?? value.name })),
  }, properties, retained, restore: value => ({ ...value,
    variables: value.variables.map(resource => ({ ...resource, name: originals.get(`color:${resource.id}`) ?? resource.name })),
    numberVariables: value.numberVariables?.map(resource => ({ ...resource, name: originals.get(`number:${resource.id}`) ?? resource.name })),
  }) }
}
