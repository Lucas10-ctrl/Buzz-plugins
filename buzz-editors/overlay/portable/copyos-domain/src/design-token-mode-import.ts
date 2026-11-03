/** CSS contexts become explicit design modes rather than replacing Base values. */
import { prepareDesignTokenImportNames } from './design-token-import-names.ts'
import { designCssRootFontSize } from './design-css-number.ts'
import type {
  CopyOSDesignDocument,
  CopyOSStyleGuideTokens,
  CopyOSDesignTokenMode,
  CopyOSDesignNumberExpression,
} from './types.ts'
import {
  planDesignStyleTokens, designExportedTokenValues,
  designTokenConfigurationValid,
  resolveDesignNumberVariables,
} from './design-token-values.ts'
/** Import root tokens and bounded selector/conditional contexts into a native library.
 * @param document - Current native scene, retaining existing IDs and modes.
 * @param tokens - Parsed project CSS inventory.
 * @param newId - Allocator for new resource and mode identities.
 * @returns Scene, imported value count and qualified skipped/review items.
 */
export function importDesignStyleGuideTokens(
  document: CopyOSDesignDocument,
  tokens: CopyOSStyleGuideTokens,
  newId: () => string,
): { document: CopyOSDesignDocument; imported: number; skipped: string[] } {
  const original = document, contexts = tokens.customPropertyContexts ?? []
  const exportedMode = (context: (typeof contexts)[number]): string | null | undefined => {
    if (context.conditions.length || context.selectors.length !== 1) return
    for (const id of ['base', ...(document.tokenModes ?? []).map(mode => mode.id)])
      if (context.selectors[0] === `:root[data-copyos-mode="${id}"], [data-copyos-mode="${id}"]`) return id === 'base' ? null : id
  }
  const baseContext = contexts.find(context => exportedMode(context) === null)
  const modeContexts = contexts.filter(context => exportedMode(context) !== null)
  const prepared = prepareDesignTokenImportNames(document,
    [{ ...tokens.customProperties, ...baseContext?.customProperties }, ...modeContexts.map(context => context.customProperties)],
    [designExportedTokenValues(document, null), ...modeContexts.map((context) => {
      const modeId = exportedMode(context)
      return modeId === undefined ? undefined : designExportedTokenValues(document, modeId)
    })])
  if ('conflict' in prepared) return { document, imported: 0, skipped: [prepared.conflict] }
  const modeIds = new Map(modeContexts.map(context => [context.key, exportedMode(context)]))
  const retained = new Map(modeContexts.map((context, index) => [context.key, prepared.retained[index + 1] ?? new Set<string>()]))
  document = prepared.document
  tokens = { ...tokens, customProperties: prepared.properties[0] ?? {}, customPropertyContexts: modeContexts.map((context, index) => ({
    ...context, customProperties: prepared.properties[index + 1] ?? {},
  })) }
  const rootSize = designCssRootFontSize(
    tokens.rootFontSize,
    tokens.customProperties,
  )
  const base = planDesignStyleTokens(
    { ...document, nodes: [], tokenModes: [], activeTokenModeId: null },
    tokens.customProperties,
    newId,
    rootSize,
  )
  if (base.conflict) return { document: original, imported: 0, skipped: base.review }
  let current = { ...base.document, nodes: document.nodes, tokenModes: document.tokenModes },
    imported = Object.keys(tokens.customProperties).length - base.skipped.length
  const skipped = [
    ...base.skipped,
    ...base.review,
    ...(tokens.customPropertyWarnings ?? []),
  ]
  if (
    base.review.length &&
    Object.values(tokens.customProperties).some(v => /[\d.]rem\b/i.test(v))
  )
    skipped.push(
      tokens.rootFontSize === undefined
        ? 'Root font size assumes 16px; selector matching and browser font preferences are not evaluated.'
        : `Root font size: ${tokens.rootFontSize} (evaluated with a 16px initial font size).`,
    )
  if (tokens.rootFontSize !== undefined && rootSize === null)
    skipped.push(
      'Root font size is unresolved; rem tokens require a known root size.',
    )
  for (const context of tokens.customPropertyContexts ?? []) {
    const names = new Set(
      [...current.variables, ...(current.numberVariables ?? [])].map(
        v => v.name,
      ),
    )
    const known = Object.fromEntries(
      Object.entries(context.customProperties).filter(([name]) =>
        names.has(name),
      ),
    )
    const properties = {
      ...tokens.customProperties,
      ...context.customProperties,
    }
    const contextRootSize = designCssRootFontSize(
      context.rootFontSize ?? tokens.rootFontSize,
      properties,
    )
    if (contextRootSize === null)
      skipped.push(
        `${context.name}: root font size is unresolved; rem tokens require a known root size.`,
      )
    const variant = planDesignStyleTokens(
      { ...current, nodes: [], activeTokenModeId: null, tokenModes: [] },
      properties,
      newId,
      contextRootSize,
    )
    if (variant.conflict) return { document: original, imported: 0, skipped: [...skipped, ...variant.review] }
    const rejected = new Set(variant.skipped)
    const baseNumberIds = new Set(current.numberVariables?.map(value => value.id))
    const contextNumbers = new Map(resolveDesignNumberVariables(variant.document.numberVariables ?? []).map(value => [value.id, value]))
    const captured = new Set<string>()
    const contextualExpression = (expression: CopyOSDesignNumberExpression): CopyOSDesignNumberExpression => {
      if (expression.kind === 'literal') return expression
      if (expression.kind === 'reference') {
        if (baseNumberIds.has(expression.variableId)) return expression
        const value = contextNumbers.get(expression.variableId)
        if (!value) return expression
        captured.add(value.name)
        return { kind: 'literal', value: value.value, unit: value.unit }
      }
      if (expression.kind === 'binary') return { ...expression,
        left: contextualExpression(expression.left), right: contextualExpression(expression.right) }
      if (expression.kind === 'clamp') return { ...expression,
        min: contextualExpression(expression.min), preferred: contextualExpression(expression.preferred),
        max: contextualExpression(expression.max) }
      return { ...expression, args: expression.args.map(contextualExpression) }
    }
    for (const notice of variant.review)
      skipped.push(`${context.name}: ${notice}`)
    const dependencies = new Set(variant.rawDependencies)
    for (const name of Object.keys(context.customProperties))
      if (!names.has(name) && !dependencies.has(name))
        skipped.push(`${context.name}: ${name} (no Base token)`)
    for (const name of rejected)
      if (!dependencies.has(name)) skipped.push(`${context.name}: ${name}`)
    const importedModeId = modeIds.get(context.key)
    const old = importedModeId === undefined ? current.tokenModes?.find(m => m.sourceKey === context.key) :
      current.tokenModes?.find(m => m.id === importedModeId)
    const keep = retained.get(context.key) ?? new Set<string>()
    const colors = new Map<
        string,
        CopyOSDesignTokenMode['variables'][number]
      >(),
      numbers = new Map<
        string,
        CopyOSDesignTokenMode['numberVariables'][number]
      >()
    const retainRejected = (name: string): void => {
      const colorId = current.variables.find(v => v.name === name)?.id,
        numberId = current.numberVariables?.find(v => v.name === name)?.id
      const color = old?.variables.find(v => v.id === colorId),
        number = old?.numberVariables.find(v => v.id === numberId)
      if (color) colors.set(color.id, color)
      if (number) numbers.set(number.id, number)
    }
    for (const value of old?.variables ?? [])
      if (keep.has(current.variables.find(resource => resource.id === value.id)?.name ?? '')) colors.set(value.id, value)
    for (const value of old?.numberVariables ?? [])
      if (keep.has(current.numberVariables?.find(resource => resource.id === value.id)?.name ?? '')) numbers.set(value.id, value)
    let count = 0
    for (const name of Object.keys(properties)) {
      if (keep.has(name)) continue
      if (rejected.has(name)) {
        retainRejected(name)
        continue
      }
      const color = variant.document.variables.find(v => v.name === name)
      if (!names.has(name)) continue
      if (color) {
        const source = current.variables.find(v => v.id === color.id)
        if (
          color.aliasId &&
          !current.variables.some(v => v.id === color.aliasId)
        ) {
          skipped.push(
            `${context.name}: ${name} alias target has no Base token; imported as a value`,
          )
          color.aliasId = null
        }
        if (
          !(name in known) &&
          source &&
          (source.aliasId ?? null) === (color.aliasId ?? null) &&
          (color.aliasId || (source.value === color.value && (source.alpha ?? 1)===(color.alpha ?? 1)))
        )
          continue
        colors.set(color.id, {
          id: color.id,
          value: color.value,
          alpha: color.alpha ?? 1,
          alphaSource: null,
          aliasId: color.aliasId ?? null,
        })
        count++
        continue
      }
      const number = variant.document.numberVariables?.find(
          v => v.name === name,
        ),
        source = current.numberVariables?.find(v => v.name === name)
      if (number && source && number.unit === source.unit) {
        const expression = number.expression ? contextualExpression(number.expression) : null
        if (
          number.aliasId &&
          !current.numberVariables?.some(v => v.id === number.aliasId)
        ) {
          skipped.push(
            `${context.name}: ${name} alias target has no Base token; imported as a value`,
          )
          number.aliasId = null
        }
        if (
          !(name in known) &&
          (source.aliasId ?? null) === (number.aliasId ?? null) &&
          JSON.stringify(source.expression ?? null) === JSON.stringify(expression) &&
          (number.aliasId || expression || source.value === number.value)
        )
          continue
        numbers.set(number.id, {
          id: number.id,
          value: number.value,
          aliasId: number.aliasId ?? null,
          expression,
        })
        count++
      } else {
        retainRejected(name)
        skipped.push(`${context.name}: ${name} (incompatible mode unit)`)
      }
    }
    if (captured.size) skipped.push(`${context.name}: numeric dependencies without Base resources were captured as literals: ${[...captured].join(', ')}`)
    if (!count && !old) continue
    if (!old && (current.tokenModes?.length ?? 0) >= 32) {
      skipped.push(`${context.name}: mode limit reached`)
      continue
    }
    const mode: CopyOSDesignTokenMode = {
      id: old?.id ?? newId(),
      name: old?.name ?? context.name,
      ...(importedModeId === undefined ? { sourceKey: context.key } : old?.sourceKey !== undefined ? { sourceKey: old.sourceKey } : {}),
      variables: [...colors.values()],
      numberVariables: [...numbers.values()],
    }
    const candidate = {
      ...current,
      tokenModes: old
        ? current.tokenModes?.map(m => (m.id === old.id ? mode : m))
        : [...(current.tokenModes ?? []), mode],
    }
    current = candidate
    imported += count
  }
  if (
    tokens.customPropertyContexts?.length &&
    skipped.some(
      v =>
        v.includes('Supported CSS math') ||
        v.includes('CSS colors with embedded variables'),
    )
  )
    skipped.push(
      'CSS expressions are evaluated together for each token mode; DOM inheritance and selector matching require review.',
    )
  if (!designTokenConfigurationValid(current)) {
    skipped.push('The CSS token import was rolled back because the complete Base and mode plan violates existing bindings or resource constraints; previous resources and modes were retained.')
    return { document: original, imported: 0, skipped }
  }
  const active = document.activeTokenModeId ?? null
  return {
    document: prepared.restore({
      ...current,
      activeTokenModeId:
        active && current.tokenModes?.some(m => m.id === active)
          ? active
          : null,
    }),
    imported,
    skipped,
  }
}
