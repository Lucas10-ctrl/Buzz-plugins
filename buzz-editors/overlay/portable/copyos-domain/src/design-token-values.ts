import { designEffectNumberBindings, designEffectNumberLimits, designEffectBindingsValid, designEffectColorBindings, designEffectColorBindingsValid, designEffectResourceOwners } from './design-effect-values.ts'
import { designNumberExpressionReferences, designNumberExpressionValid, evaluateDesignNumberExpression, designNumberExpressionCss, designTokenCssNames } from './design-number-expression.ts'
import { prepareDesignTokenImportNames } from './design-token-import-names.ts'
import { designAuthoredGridTracks } from './design-instance-grid.ts'
/** Shared token identities, alias resolution and CSS translation for native designs. */
import {
  designCssAlias,
  designCssNumber,
  designCssCycles,
} from './design-css-number.ts'
import { designNodeSizingLimitsValid } from './design-size-validation.ts'
import { designCanvasBackgroundsValid } from './design-canvas-background.ts'
import { designColorVariableCss } from './design-color.ts'
import { createDesignCssColorResolver } from './design-css-color.ts'
import type {
  CopyOSDesignNode,
  CopyOSDesignDocument,
  CopyOSDesignVariable,
  CopyOSDesignNumberVariable,
  CopyOSDesignNumberProperty,
  CopyOSDesignGridTrack,
  CopyOSDesignNumberExpression,
  CopyOSDesignEffect,
} from './types.ts'
import {
  designNodeModeIds,
  designModeResources,
  setDesignColorVariable,
  setDesignNumberVariable,
} from './design-token-modes.ts'
/** Bound grid track descriptors used by numeric-token validation and editing limits. */
function gridTrackBindings(
  document: CopyOSDesignDocument,
): { id: string; unit: 'px' | 'number'; min: number; max: number }[] {
  return document.nodes.flatMap(n => designAuthoredGridTracks(n).flatMap(t =>
    t.variableId ? [{ id:t.variableId,unit:t.sizing==='fill'?'number' as const:'px' as const,
      min:t.sizing==='fill'?.01:1,max:t.sizing==='fill'?1000:100000 }] : []))
}
/** Enumerate authored descendant spacing refs, including dormant ownership. */
function descendantLayoutBindings(document: CopyOSDesignDocument): { id: string; min: number; max: number }[] {
  return document.nodes.flatMap(node => (node.instanceOverrides ?? []).flatMap(record =>
    Object.entries(record.layoutBindings ?? {}).flatMap(([key, id]) => id ?
      [{ id, min: key === 'gap' ? -10000 : 0, max: 10000 }] : [])))
}
/** Resolve eligible track resources once for each mode rather than once per UI row.
 * @param document - Scene and complete numeric mode library.
 * @returns Allowed pixel/fractional identities across all modes.
 */
export function designGridTrackTokens(document: CopyOSDesignDocument): {
  fixed: Set<string>
  fill: Set<string>
} {
  const modes = [null, ...(document.tokenModes ?? []).map(m => m.id)].map(
    mode =>
      new Map(
        resolveDesignNumberVariables(
          designModeResources(document, mode).numberVariables,
        ).map(v => [v.id, v]),
      ),
  )
  const ids = document.numberVariables?.map(v => v.id) ?? []
  const eligible = (unit: 'px' | 'number', min: number, max: number) =>
    new Set(
      ids.filter(id =>
        modes.every((mode) => {
          const v = mode.get(id)
          return !!v && v.unit === unit && v.value >= min && v.value <= max
        }),
      ),
    )
  return {
    fixed: eligible('px', 1, 100000),
    fill: eligible('number', 0.01, 1000),
  }
}
/** Check a track token across every named mode before offering a binding.
 * @param document - Scene and numeric resources.
 * @param id - Numeric resource identity.
 * @param sizing - Fixed pixel track or unitless fractional weight.
 * @returns Whether all effective values fit the track's unit and range.
 */
export function designGridTrackTokenAllowed(
  document: CopyOSDesignDocument,
  id: string,
  sizing: CopyOSDesignGridTrack['sizing'],
): boolean {
  return sizing !== 'hug' && designGridTrackTokens(document)[sizing].has(id)
}
/** Numeric domains shared by resource editing and layout bindings. */
export const designNumberPropertyLimits: Readonly<
  Record<CopyOSDesignNumberProperty, readonly [number, number]>
> = {
  width: [1, 100000],
  strokeWidth: [0, 1000],
  strokeTopWidth: [0, 1000],
  strokeRightWidth: [0, 1000],
  strokeBottomWidth: [0, 1000],
  strokeLeftWidth: [0, 1000],
  height: [1, 100000],
  minWidth: [0, 100000],
  maxWidth: [1, 100000],
  minHeight: [0, 100000],
  maxHeight: [1, 100000],
  gap: [-10000, 10000],
  padding: [0, 10000],
  paddingTop: [0, 10000],
  paddingRight: [0, 10000],
  paddingBottom: [0, 10000],
  paddingLeft: [0, 10000],
  radius: [0, 100000],
  radiusTopLeft: [0, 100000],
  radiusTopRight: [0, 100000],
  radiusBottomRight: [0, 100000],
  radiusBottomLeft: [0, 100000],
  crossGap: [0, 10000],
  fontSize: [1, 1000],
  fontWeight: [100, 900],
  lineHeight: [0.5, 10],
  letterSpacing: [-1000, 1000],
  paragraphSpacing: [0, 10000],
}
function numberLimits(
  property: CopyOSDesignNumberProperty,
  node?: Pick<CopyOSDesignNode, 'layout'>,
): readonly [number, number] {
  return property === 'gap' && node?.layout === 'grid'
    ? [0, 10000]
    : designNumberPropertyLimits[property]
}
/** Resolve color aliases while retaining resource identities and stored references.
 * @param variables - One color collection.
 * @param numbers - Raw numeric resources in the same mode; omitted supports colors without number alpha sources.
 * @returns Resources with complete effective RGB/alpha; invalid alias graphs or alpha throw.
 */
export function resolveDesignColorVariables(
  variables: readonly CopyOSDesignVariable[],
  numbers: readonly CopyOSDesignNumberVariable[] = [],
): CopyOSDesignVariable[] {
  const numeric = new Map(resolveDesignNumberVariables(numbers).map(value => [value.id, value]))
  const byId = new Map(variables.map(value => [value.id, value]))
  const cache = new Map<string, CopyOSDesignVariable>(), active = new Set<string>()
  const visit = (value: CopyOSDesignVariable): CopyOSDesignVariable => {
    const known = cache.get(value.id)
    if (known) return known
    if (active.has(value.id)) throw new Error('Cyclic token alias')
    active.add(value.id)
    if (value.alpha !== undefined && (!Number.isFinite(value.alpha) || value.alpha < 0 || value.alpha > 1))
      throw new Error('Invalid color alpha')
    if (value.alphaSource !== undefined && value.alphaSource !== null) {
      const source = value.alphaSource, fields = Object.keys(source)
      if ((source.kind === 'literal' && fields.length !== 1) ||
        (source.kind === 'number' && (fields.length !== 2 || !('variableId' in source))) ||
        !['literal', 'number'].includes(source.kind)) throw new Error('Invalid color alpha source')
    }
    let next = { ...value }
    if (value.aliasId) {
      const source = byId.get(value.aliasId)
      if (!source) throw new Error('Missing token alias target')
      const target = visit(source)
      next = { ...next, value: target.value, alpha: target.alpha ?? 1 }
    }
    if (value.alphaSource?.kind === 'literal') next.alpha = value.alpha ?? 1
    else if (value.alphaSource?.kind === 'number') {
      const source = numeric.get(value.alphaSource.variableId)
      if (!source || source.unit !== 'number' || !Number.isFinite(source.value))
        throw new Error('Color alpha source requires an existing finite unitless number token')
      next.alpha = Math.max(0, Math.min(100, source.value)) / 100
    }
    active.delete(value.id)
    cache.set(value.id, next)
    return next
  }
  return variables.map(visit)
}
/** Resolve complete RGBA values using the numeric and color resources of one mode.
 * @param document - Native scene and token library.
 * @param modeId - Named mode or null for Base; omitted selects the document mode.
 * @returns Resolved colors retaining authored identities, aliases and alpha-source metadata.
 */
export function resolveDesignModeColors(
  document: CopyOSDesignDocument,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignVariable[] {
  const resources = designModeResources(document, modeId)
  return resolveDesignColorVariables(resources.variables, resources.numberVariables)
}
/** Unbind numeric alpha while retaining the current appearance and live RGB alias.
 * @param document - Native scene and token library.
 * @param id - Existing color identity.
 * @param modeId - Destination mode or null for Base; omitted selects the document mode.
 * @returns Candidate with effective alpha stored as an explicitly owned literal.
 */
export function unbindDesignColorAlpha(
  document: CopyOSDesignDocument,
  id: string,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignDocument {
  const color = resolveDesignModeColors(document, modeId).find(value => value.id === id)
  if (!color) throw new Error('Color resource not found')
  return setDesignColorVariable(document, id, { alpha: color.alpha ?? 1, alphaSource: { kind: 'literal' } }, modeId)
}
/** Reset only color alpha ownership, retaining RGB and alias edits.
 * @param document - Native scene and token library.
 * @param id - Existing color resource identity.
 * @param modeId - Override mode or null for Base; omitted selects the document mode.
 * @returns Base legacy alpha defaults, or mode alpha inheritance with empty overrides pruned.
 */
export function resetDesignColorAlpha(
  document: CopyOSDesignDocument,
  id: string,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignDocument {
  if (!document.variables.some(value => value.id === id)) throw new Error('Color resource not found')
  if (modeId === null) return { ...document, variables: document.variables.map((value) => {
    if (value.id !== id) return value
    const { alpha: _alpha, alphaSource: _source, ...rest } = value
    return rest
  }) }
  if (!document.tokenModes?.some(mode => mode.id === modeId)) throw new Error('Token mode not found')
  return { ...document, tokenModes: document.tokenModes.map(mode => mode.id !== modeId ? mode : {
    ...mode, variables: mode.variables.flatMap((value) => {
      if (value.id !== id) return [value]
      const { alpha: _alpha, alphaSource: _source, ...rest } = value
      return rest.value !== undefined || rest.aliasId !== undefined ? [rest] : []
    }),
  }) }
}
/** Check numeric alpha candidates without restricting their reusable numeric ranges.
 * @param document - Native scene with every named mode.
 * @param id - Numeric token identity.
 * @returns Whether the token resolves to a finite unitless percentage in Base and every mode.
 */
export function designColorAlphaTokenAllowed(document: CopyOSDesignDocument, id: string): boolean {
  try {
    return [null, ...(document.tokenModes ?? []).map(mode => mode.id)].every((modeId) => {
      const resources = designModeResources(document, modeId)
      const token = resolveDesignNumberVariables(resources.numberVariables).find(value => value.id === id)
      return !!token && token.unit === 'number' && Number.isFinite(token.value)
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}
/** Resolve the shared alias/formula dependency graph without recursive resource expansion.
 * @param variables - One numeric collection.
 * @returns Resources with effective values; invalid references, cycles, units or arithmetic throw.
 */
export function resolveDesignNumberVariables(
  variables: readonly CopyOSDesignNumberVariable[],
): CopyOSDesignNumberVariable[] {
  if (variables.length>500) throw new Error('Numeric collection exceeds 500 resources')
  const inputs=new Map(variables.map(value=>[value.id,value])),resolved=new Map<string,CopyOSDesignNumberVariable>()
  if (inputs.size!==variables.length) throw new Error('Duplicate numeric resource')
  const state=new Map<string,number>()
  const dependencies=(value:CopyOSDesignNumberVariable):string[]=>{
    if (value.aliasId && value.expression) throw new Error('Numeric alias and expression are mutually exclusive')
    if (value.expression && !designNumberExpressionValid(value.expression)) throw new Error('Invalid numeric expression')
    return value.aliasId?[value.aliasId]:value.expression?designNumberExpressionReferences(value.expression):[]
  }
  for (const value of variables) {
    const pending:{ id:string;ready:boolean }[]=[{ id:value.id,ready:false }]
    while (pending.length) {
      const frame=pending.pop()
      if (!frame || state.get(frame.id)===2) continue
      const resource=inputs.get(frame.id)
      if (!resource) throw new Error('Missing numeric dependency target')
      if (!frame.ready) {
        if (state.get(frame.id)===1) throw new Error('Cyclic numeric alias or expression')
        state.set(frame.id,1);pending.push({ id:frame.id,ready:true })
        for (const dependency of dependencies(resource).reverse()) {
          if (!inputs.has(dependency)) throw new Error('Missing numeric dependency target')
          pending.push({ id:dependency,ready:false })
        }
        continue
      }
      const effective=resource.aliasId?resolved.get(resource.aliasId):resource.expression?
        evaluateDesignNumberExpression(resource.expression,id=>resolved.get(id)):resource
      if (!effective || !Number.isFinite(effective.value) || Math.abs(effective.value)>1000000)
        throw new Error('Invalid or out-of-range numeric expression')
      if (effective.unit!==resource.unit || !['px','number'].includes(resource.unit)) throw new Error('Incompatible token unit in numeric dependency')
      resolved.set(resource.id,{ ...resource,value:effective.value });state.set(resource.id,2)
    }
  }
  return variables.map(value=>resolved.get(value.id) ?? value)
}
/** Find the allowed literal range for a token, including every dependent alias binding.
 * @param document - Current scene and resources.
 * @param id - Numeric resource identity.
 * @returns Direct/alias binding bounds and integer requirements. Expression-dependent domains are checked on the full candidate,
 * without approximating an inverse range.
 */
export function designNumberTokenBounds(
  document: CopyOSDesignDocument,
  id: string,
): { min: number; max: number; integer: boolean } {
  let min = -1000000,
    max = 1000000,
    integer = false
  const base = document.activeTokenModeId == null
  const candidate = setDesignNumberVariable(document, id, { aliasId: null })
  const contexts = base
    ? [null, ...(document.tokenModes ?? []).map(m => m.id)]
    : [document.activeTokenModeId ?? null]
  for (const modeId of contexts) {
    const override = modeId
      ? document.tokenModes
        ?.find(m => m.id === modeId)
        ?.numberVariables.find(v => v.id === id)
      : undefined
    if (base && override && (override.value !== undefined || override.aliasId))
      continue
    const resources = designModeResources(candidate, modeId).numberVariables,
      affected = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const v of resources)
        if (v.aliasId && affected.has(v.aliasId) && !affected.has(v.id)) {
          affected.add(v.id)
          changed = true
        }
    }
    for (const track of gridTrackBindings(document))
      if (affected.has(track.id)) {
        min = Math.max(min, track.min)
        max = Math.min(max, track.max)
      }
    for (const binding of designEffectResourceOwners(document).flatMap(designEffectNumberBindings)) if (affected.has(binding.id)) {
      min = Math.max(min, binding.min)
      max = Math.min(max, binding.max)
    }
    for (const binding of descendantLayoutBindings(document)) if (affected.has(binding.id)) {
      min = Math.max(min, binding.min)
      max = Math.min(max, binding.max)
    }
    for (const n of document.nodes)
      for (const [property, binding] of Object.entries(n.numericBindings ?? {}))
        if (binding && affected.has(binding)) {
          const limits = numberLimits(property as CopyOSDesignNumberProperty, n)
          min = Math.max(min, limits[0])
          max = Math.min(max, limits[1])
          integer ||= property === 'fontWeight'
        }
  }
  return { min, max, integer }
}
/** Check a proposed alias without allowing cycles, incompatible units or invalid bound values.
 * @param document - Current scene and resources.
 * @param kind - Resource collection.
 * @param id - Aliased resource identity.
 * @param targetId - Proposed source resource identity.
 * @returns Whether the alias can be offered in the resource editor.
 */
export function designTokenAliasAllowed(
  document: CopyOSDesignDocument,
  kind: 'color' | 'number',
  id: string,
  targetId: string,
): boolean {
  const active = designModeResources(document),
    resources = kind === 'color' ? active.variables : active.numberVariables
  if (id === targetId || !resources.some(v => v.id === id)) return false
  const target = resources.find(v => v.id === targetId)
  if (!target) return false
  const candidate =
    kind === 'color'
      ? setDesignColorVariable(document, id, { aliasId: targetId })
      : setDesignNumberVariable(document, id, { aliasId: targetId })
  return designTokenConfigurationValid(candidate)
}

/** Validate every mode's alias graph and effective numeric bindings.
 * @param document - Candidate native scene.
 * @returns Whether all resource configurations can render within the bound property domains.
 */
export function designTokenConfigurationValid(
  document: CopyOSDesignDocument,
): boolean {
  try {
    if (!designCanvasBackgroundsValid(document)) return false
    designNodeModeIds(document)
    if (
      document.nodes.some(
        n =>
          n.grid &&
          [...n.grid.columns, ...n.grid.rows, n.grid.implicitRow].some(
            t => t.sizing === 'hug' && t.variableId,
          ),
      )
    )
      return false
    if (
      document.activeTokenModeId &&
      !document.tokenModes?.some(m => m.id === document.activeTokenModeId)
    )
      return false
    for (const modeId of [
      null,
      ...(document.tokenModes ?? []).map(m => m.id),
    ]) {
      const resources = designModeResources(document, modeId)
      const colors = resolveDesignColorVariables(resources.variables, resources.numberVariables)
      if (!designEffectColorBindingsValid(designEffectResourceOwners(document), new Set(colors.map(value => value.id)))) return false
      const resolved = new Map(
        resolveDesignNumberVariables(resources.numberVariables).map(v => [
          v.id,
          v,
        ]),
      )
      if (!designEffectBindingsValid(designEffectResourceOwners(document), resolved)) return false
      for (const track of gridTrackBindings(document)) {
        const token = resolved.get(track.id)
        if (
          !token ||
          token.unit !== track.unit ||
          token.value < track.min ||
          token.value > track.max
        )
          return false
      }
      for (const binding of descendantLayoutBindings(document)) {
        const token = resolved.get(binding.id)
        if (!token || token.unit !== 'px' || token.value < binding.min || token.value > binding.max) return false
      }
      for (const n of document.nodes)
        for (const [key, id] of Object.entries(n.numericBindings ?? {})) {
          const token = id ? resolved.get(id) : undefined
          if (!token) return false
          const limits = numberLimits(key as CopyOSDesignNumberProperty, n)
          if (
            token.unit !==
              (['fontWeight', 'lineHeight'].includes(key) ? 'number' : 'px') ||
            token.value < limits[0] ||
            token.value > limits[1] ||
            (key === 'fontWeight' && !Number.isInteger(token.value))
          )
            return false
        }
      const values = new Map([...resolved].map(([id, token]) => [id, token.value]))
      const nodes = new Map(document.nodes.map(node => [node.id, node]))
      for (const node of document.nodes) {
        const source = node.kind === 'instance' ? nodes.get(node.componentId ?? '') : undefined
        if (!designNodeSizingLimitsValid(node, source, values)) return false
      }
    }
    return true
  } catch (error) {
    // CSS imports are untrusted; an invalid candidate must leave the current resources intact.
    if (error instanceof Error) return false
    throw error
  }
}
type ParsedValue =
  | {
    kind: 'color'
    value: string
    alpha?: number | undefined
    aliasName?: string
    converted?: boolean
    dependencies?: string[]
  }
  | {
    kind: 'number'
    value: number
    unit: 'px' | 'number'
    aliasName?: string
    computed?: boolean
    rootRelative?: boolean
    expression?: CopyOSDesignNumberExpression
  }
/** Read exact trusted native export declarations for identity-preserving reimport.
 * @param document - Current authored resources.
 * @param modeId - Base or an existing explicit mode.
 * @returns Shared-export CSS values keyed by canonical and friendly names.
 */
export function designExportedTokenValues(document: CopyOSDesignDocument, modeId: string | null): Record<string, string> {
  return Object.fromEntries([...exportDesignCss({ ...document, activeTokenModeId: modeId }, false)
    .matchAll(/^  (--[\w-]+): (.*);$/gm)].map(match => [match[1] ?? '', match[2] ?? '']))
}
/** Import CSS values while recognizing only exact current-document canonical identities.
 * @param document - Current native scene.
 * @param properties - CSS declarations, never executed.
 * @param newId - Allocator for genuinely new resources.
 * @param rootFontSize - Captured root size, or null for unresolved rem values.
 * @returns Existing result format; canonical conflicts retain the original scene and report the rejected plan.
 */
export function importDesignStyleTokens(document: CopyOSDesignDocument, properties: Readonly<Record<string, string>>,
  newId: () => string, rootFontSize: number | null = 16,
): { document: CopyOSDesignDocument; skipped: string[]; review: string[]; rawDependencies: string[] } {
  const prepared = prepareDesignTokenImportNames(document, [properties], [designExportedTokenValues(document, null)])
  if ('conflict' in prepared) return { document, skipped: Object.keys(properties), review: [prepared.conflict], rawDependencies: [] }
  const result = planDesignStyleTokens(prepared.document, prepared.properties[0] ?? {}, newId, rootFontSize)
  return { document: result.conflict ? document : prepared.restore(result.document), skipped: result.skipped,
    review: result.review, rawDependencies: result.rawDependencies }
}
/** Import literal custom properties and live aliases without replacing stable resource identities.
 * @param document - Current native scene.
 * @param properties - CSS inventory, never executed; missing-variable fallbacks may contain literals or aliases.
 * @param newId - Identity allocator for new names.
 * @param rootFontSize - Root font size for rem conversion, default 16px; null leaves root-relative values unresolved.
 * @returns Imported scene, rejected names in source order, accepted raw color dependencies and review notices.
 */
export function planDesignStyleTokens(
  document: CopyOSDesignDocument,
  properties: Readonly<Record<string, string>>,
  newId: () => string,
  rootFontSize: number | null = 16,
): {
  document: CopyOSDesignDocument
  skipped: string[]
  review: string[]
  rawDependencies: string[]
  conflict?: string
} {
  const colors = resolveDesignColorVariables(document.variables, document.numberVariables ?? []),
    numbers = resolveDesignNumberVariables(document.numberVariables ?? [])
  const existingNames = new Map<string, number>()
  for (const resource of [...document.variables, ...(document.numberVariables ?? [])])
    existingNames.set(resource.name, (existingNames.get(resource.name) ?? 0) + 1)
  const invalid = Symbol('unsupported'),
    cache = new Map<string, ParsedValue | typeof invalid | undefined>()
  const colorResolver = createDesignCssColorResolver(properties, (name) => {
    if ((existingNames.get(name) ?? 0) > 1) return undefined
    const color = colors.find(v => v.name === name)
    if (color) return designColorVariableCss(color)
    const number = numbers.find(v => v.name === name)
    return number
      ? `${number.value}${number.unit === 'px' ? 'px' : ''}`
      : undefined
  })
  const cyclic = new Set([
    ...designCssCycles(properties),
    ...colorResolver.cyclic,
  ])
  const resolve = (
    name: string,
    seen: Set<string>,
  ): ParsedValue | typeof invalid | undefined => {
    if ((existingNames.get(name) ?? 0) > 1) return invalid
    if (cyclic.has(name)) return undefined
    if (seen.has(name) || seen.size >= 64) return invalid
    if (cache.has(name)) return cache.get(name)
    const raw = properties[name]
    if (raw === undefined) {
      const c = colors.find(v => v.name === name)
      if (c) return { kind: 'color', value: c.value,alpha:c.alpha }
      const n = numbers.find(v => v.name === name)
      return n ? { kind: 'number', value: n.value, unit: n.unit } : undefined
    }
    const next = new Set(seen)
    next.add(name)
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
    const value =
      stripped.toLowerCase() === 'initial' ? undefined : parse(stripped, next)
    cache.set(name, value)
    return value
  }
  const parse = (
    raw: string,
    seen: Set<string>,
  ): ParsedValue | typeof invalid | undefined => {
    const alias = designCssAlias(raw) ?? colorResolver.alias(raw)
    if (alias) {
      const target = resolve(alias.name, seen)
      if (target === invalid) return invalid
      if (target) return { ...target, aliasName: alias.name }
      return alias.fallback !== undefined
        ? parse(alias.fallback, seen)
        : undefined
    }
    const color = colorResolver.resolve(raw)
    if (color)
      return {
        kind: 'color',
        value: color.value,
        alpha: color.alpha,
        converted: !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(raw),
        dependencies: color.dependencies,
      }
    const number = designCssNumber(raw, {
      rootFontSize,
      compile: true,
      lookup: (name) => {
        const target = resolve(name, seen)
        return !target
          ? undefined
          : target === invalid
            ? 'other'
            : target.kind === 'number'
              ? { ...target, referenceId: name }
              : 'other'
      },
    })
    if (number) return { kind: 'number', ...number }
    return invalid
  }
  const plans = new Map<string, ParsedValue>(),
    rejected = new Set<string>()
  for (const name of Object.keys(properties)) {
    const value = resolve(name, new Set())
    if (
      !/^--[\w-]+$/.test(name) ||
      name.length > 120 ||
      !value ||
      value === invalid
    )
      rejected.add(name)
    else plans.set(name, value)
  }
  const registry = designTokenCssNames(document), expectedKinds = new Map([
    ...[...registry.color.values()].map(name => [name, 'color'] as const),
    ...[...registry.number.values()].map(name => [name, 'number'] as const),
  ])
  for (const [name, value] of plans) if (expectedKinds.has(name) && expectedKinds.get(name) !== value.kind) {
    const conflict = `CSS token import was rolled back: ${name} changes the kind of an existing canonical resource.`
    return { document, skipped: Object.keys(properties), review: [conflict], rawDependencies: [], conflict }
  }
  const numberIds = new Map((document.numberVariables ?? []).map(value => [value.name, value.id]))
  for (const [name, value] of plans) if (value.kind === 'number' && !numberIds.has(name)) numberIds.set(name, newId())
  const mapExpression = (expression: CopyOSDesignNumberExpression): CopyOSDesignNumberExpression | undefined => {
    if (expression.kind === 'literal') return expression
    if (expression.kind === 'reference') {
      const variableId = numberIds.get(expression.variableId)
      return variableId ? { kind: 'reference', variableId } : undefined
    }
    if (expression.kind === 'binary') {
      const left = mapExpression(expression.left), right = mapExpression(expression.right)
      return left && right ? { ...expression, left, right } : undefined
    }
    if (expression.kind === 'clamp') {
      const min = mapExpression(expression.min), preferred = mapExpression(expression.preferred), max = mapExpression(expression.max)
      return min && preferred && max ? { ...expression, min, preferred, max } : undefined
    }
    const args = expression.args.map(mapExpression)
    return args.every((value): value is CopyOSDesignNumberExpression => !!value) ? { ...expression, args } : undefined
  }
  let current = document
  const done = new Set<string>(),
    active = new Set<string>()
  const apply = (name: string): void => {
    if (done.has(name)) return
    const value = plans.get(name)
    if (!value) return
    if (active.has(name)) {
      rejected.add(name)
      return
    }
    active.add(name)
    if (value.aliasName) apply(value.aliasName)
    if (value.kind === 'number' && !value.aliasName && value.expression)
      for (const dependency of designNumberExpressionReferences(value.expression)) apply(dependency)
    active.delete(name)
    done.add(name)
    const opposite =
      value.kind === 'color' ? current.numberVariables : current.variables
    if (opposite?.some(v => v.name === name)) {
      rejected.add(name)
      return
    }
    let candidate: CopyOSDesignDocument
    if (value.kind === 'color') {
      const prior = current.variables.find(v => v.name === name),
        target = value.aliasName
          ? current.variables.find(v => v.name === value.aliasName)
          : undefined
      if (value.aliasName && !target) {
        rejected.add(name)
        return
      }
      const variables = [...current.variables],
        next = {
          id: prior?.id ?? newId(),
          name,
          value: value.value,
          ...(value.alpha!==undefined && value.alpha!==1?{ alpha:value.alpha }:{ alpha:undefined }),
          aliasId: target?.id ?? null,
        }
      if (prior) variables[variables.indexOf(prior)] = next
      else variables.push(next)
      candidate = { ...current, variables }
    } else {
      const variables = [...(current.numberVariables ?? [])],
        prior = variables.find(v => v.name === name),
        target = value.aliasName
          ? variables.find(v => v.name === value.aliasName)
          : undefined
      if (value.aliasName && (!target || target.unit !== value.unit)) {
        rejected.add(name)
        return
      }
      const expression = !value.aliasName && value.expression?.kind !== 'literal' && value.expression
        ? mapExpression(value.expression) : undefined
      if (value.expression && !value.aliasName && value.expression.kind !== 'literal' && !expression) {
        rejected.add(name)
        return
      }
      const next = {
        id: prior?.id ?? numberIds.get(name) ?? newId(),
        name,
        value: value.value,
        unit: value.unit,
        aliasId: target?.id ?? null,
        expression: expression ?? null,
      }
      if (prior) variables[variables.indexOf(prior)] = next
      else variables.push(next)
      candidate = { ...current, numberVariables: variables }
    }
    if (value.kind === 'color' && (
      candidate.variables.length > 500 ||
      !designTokenConfigurationValid(candidate)
    )) {
      rejected.add(name)
      return
    }
    current = candidate
  }
  const numericPlans = [...plans].filter(([, value]) => value.kind === 'number').map(([name]) => name)
  for (const name of numericPlans) apply(name)
  const numericBundleRejected = numericPlans.length > 0 && (numericPlans.some(name => rejected.has(name)) ||
    (current.numberVariables?.length ?? 0) > 500 || !designTokenConfigurationValid(current))
  if (numericBundleRejected) {
    current = document
    for (const name of numericPlans) rejected.add(name)
  }
  for (const [name, value] of plans) if (value.kind === 'color') apply(name)
  const review: string[] = numericBundleRejected
    ? ['Numeric CSS token changes were rejected together because their complete dependency bundle is invalid; previous numeric resources were retained.']
    : []
  const rawDependencies = new Set<string>()
  for (const [name, value] of plans)
    if (!rejected.has(name) && value.kind === 'color')
      for (const dependency of value.dependencies ?? [])
        rawDependencies.add(dependency)
  if (rawDependencies.size)
    review.push(
      'CSS colors with embedded variables import as computed values; token edits do not recalculate them. Please reimport to recalculate per mode. Raw channel inputs remain in the CSS inventory; direct aliases remain live.',
    )
  if (
    [...plans].some(
      ([name, value]) =>
        !rejected.has(name) && value.kind === 'number' && value.computed,
    )
  )
    review.push(
      'Supported CSS math imports as live numeric expressions with stable token references. Absolute and rem lengths are captured as pixel literals; reimport to update conversion context. Direct aliases remain live.',
    )
  if (
    [...plans].some(
      ([name, value]) =>
        !rejected.has(name) && value.kind === 'color' && value.converted,
    ) ||
    [...rejected].some(name =>
      /^(?:#|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(|transparent$|currentcolor$)/i.test(
        properties[name]?.trim() ?? '',
      ),
    )
  )
    review.push(
      'CSS colors import as 8-bit sRGB channels with full-precision alpha. RGB gamut and precision may change; context-dependent colors remain unresolved. Direct aliases remain live.',
    )
  return {
    document: current,
    skipped: Object.keys(properties).filter(name => rejected.has(name)),
    rawDependencies: [...rawDependencies],
    review,
  }
}
/** Emit stable canonical variables and safe original CSS names, retaining alias relationships.
 * @param document - Native scene resources.
 * @param includeModes - Include explicit mode selectors for standalone exports.
 * @returns Root variables with optional mode rules; UUID variables prevent name collisions.
 */
export function exportDesignCss(
  document: CopyOSDesignDocument,
  includeModes = true,
): string {
  const names=designTokenCssNames(document)
  const declarations = (modeId: string | null): string => {
    const resources = designModeResources(document, modeId)
    resolveDesignNumberVariables(resources.numberVariables)
    resolveDesignColorVariables(resources.variables,resources.numberVariables)
    return [...resources.variables, ...resources.numberVariables]
      .flatMap((v) => {
        const numeric=typeof v.value==='number',canonical=(numeric?names.number:names.color).get(v.id)
        const friendly=(numeric?names.friendlyNumber:names.friendlyColor).get(v.id)
        let declaration: string
        if (typeof v.value === 'number') {
          const literal = `${v.value}${'unit' in v && v.unit === 'px' ? 'px' : ''}`
          const number=v as CopyOSDesignNumberVariable
          declaration = number.expression?designNumberExpressionCss(number.expression,id=>names.number.get(id) ?? ''):
            v.aliasId ? `var(${names.number.get(v.aliasId)})` : literal
        } else {
          const color = v as CopyOSDesignVariable
          if (!color.alphaSource) declaration = color.aliasId
            ? `var(${names.color.get(color.aliasId)})` : designColorVariableCss(color)
          else {
            const alpha = color.alphaSource.kind === 'number'
              ? `clamp(0, calc(var(${names.number.get(color.alphaSource.variableId)}) / 100), 1)` : String(color.alpha ?? 1)
            const channels = color.aliasId ? `from var(${names.color.get(color.aliasId)}) r g b`
              : [1, 3, 5].map(index => Number.parseInt(color.value.slice(index, index + 2), 16)).join(' ')
            declaration = `rgb(${channels} / ${alpha})`
          }
        }
        return [
          `  ${canonical}: ${declaration};`,
          ...(friendly ? [`  ${friendly}: var(${canonical});`] : []),
        ]
      })
      .join('\n')
  }
  const active = document.activeTokenModeId ?? null
  return (
    ':root {\n' +
    declarations(active) +
    '\n}\n' +
    (includeModes && document.tokenModes?.length
      ? `\n:root[data-copyos-mode="base"], [data-copyos-mode="base"] {\n${declarations(null)}\n}\n` +
        document.tokenModes
          .map(
            m =>
              `\n:root[data-copyos-mode="${m.id}"], [data-copyos-mode="${m.id}"] {\n${declarations(m.id)}\n}\n`,
          )
          .join('')
      : '')
  )
}
/** Check whether a numeric resource can bind a property in every mode.
 * @param document - Current native scene and mode library.
 * @param id - Numeric resource identity.
 * @param property - Proposed bound property.
 * @param node - Optional target layer, which restricts grid gaps to nonnegative values.
 * @returns Whether every effective value has the required unit and domain.
 */
export function designNumberTokenSupportsProperty(
  document: CopyOSDesignDocument,
  id: string,
  property: CopyOSDesignNumberProperty,
  node?: Pick<CopyOSDesignNode, 'layout'>,
): boolean {
  const limits = numberLimits(property, node)
  return [null, ...(document.tokenModes ?? []).map(m => m.id)].every(
    (modeId) => {
      const token = resolveDesignNumberVariables(
        designModeResources(document, modeId).numberVariables,
      ).find(v => v.id === id)
      return (
        !!token &&
        token.unit ===
          (['fontWeight', 'lineHeight'].includes(property) ? 'number' : 'px') &&
        token.value >= limits[0] &&
        token.value <= limits[1] &&
        (property !== 'fontWeight' || Number.isInteger(token.value))
      )
    },
  )
}

const effectModeCache = new WeakMap<CopyOSDesignDocument, ReadonlyMap<string, CopyOSDesignNumberVariable>[]>()
function effectModeNumbers(document: CopyOSDesignDocument): ReadonlyMap<string, CopyOSDesignNumberVariable>[] {
  let modes = effectModeCache.get(document)
  if (!modes) {
    modes = [null, ...(document.tokenModes ?? []).map(mode => mode.id)].map(mode => new Map(
      resolveDesignNumberVariables(designModeResources(document, mode).numberVariables).map(value => [value.id, value])))
    effectModeCache.set(document, modes)
  }
  return modes
}
/** Validate authored effect resources across Base and every named mode without constructing render scenes.
 * @param document - Complete authored resource library and effect stacks.
 * @returns Whether aliases and expressions resolve to compatible finite effect values in every mode.
 */
export function designEffectNumberConfigurationValid(document: CopyOSDesignDocument): boolean {
  if (!designEffectResourceOwners(document).some(node => designEffectNumberBindings(node).length)) return true
  try {
    return effectModeNumbers(document).every(values => designEffectBindingsValid(designEffectResourceOwners(document), values))
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}
/** Check a numeric token's unit and domain in every mode before offering an effect binding.
 * @param document - Numeric library including inactive modes, aliases and expressions.
 * @param variableId - Candidate resource identity.
 * @param key - Effect field to bind.
 * @param effect - Authored effect determining the eligible fields.
 * @returns Whether all resolved values fit the field; opacity accepts unitless zero to one.
 */
export function designEffectNumberTokenSupportsProperty(document: CopyOSDesignDocument, variableId: string,
  key: string, effect: CopyOSDesignEffect): boolean {
  const limits = designEffectNumberLimits(effect, key)
  if (!limits) return false
  try {
    return effectModeNumbers(document).every((values) => {
      const value = values.get(variableId)
      return !!value && value.unit === limits.unit && value.value >= limits.min && value.value <= limits.max
    })
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

/** Validate live shadow colors, aliases and numeric alpha sources across every mode without building render scenes.
 * @param document - Authored effect stacks and complete resource library.
 * @returns Whether every referenced color exists and all mode color graphs resolve.
 */
export function designEffectColorConfigurationValid(document: CopyOSDesignDocument): boolean {
  if (!designEffectResourceOwners(document).some(node => designEffectColorBindings(node).length)) return true
  try {
    return [null, ...(document.tokenModes ?? []).map(mode => mode.id)].every((mode) => {
      const resources = designModeResources(document, mode)
      const colors = resolveDesignColorVariables(resources.variables, resources.numberVariables)
      return designEffectColorBindingsValid(designEffectResourceOwners(document), new Set(colors.map(value => value.id)))
    })
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}
