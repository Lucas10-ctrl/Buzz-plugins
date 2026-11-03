import type { CopyOSDesignNumberExpression, CopyOSDesignDocument } from './types.ts'
import { designTokenCssNames } from './design-token-css-names.ts'
import { evaluateDesignNumberExpression } from './design-number-expression.ts'
/** Dimension-aware numeric CSS evaluation for design-token imports; never executes CSS. */
export interface DesignCssNumber {
  value: number
  unit: 'px' | 'number'
  computed?: boolean
  rootRelative?: boolean
  expression?: CopyOSDesignNumberExpression
  referenceId?: string
}
/** Numeric conversion context; unknown root sizes prevent rem conversion. */
export interface DesignCssNumberContext {
  rootFontSize: number | null
  /** Emit a bounded typed expression; omitted retains the original evaluated-only result. */
  compile?: boolean
  percentageBasis?: number
  lookup?: (name: string) => DesignCssNumber | 'other' | undefined
}
/** One complete var() reference; fallback text remains unevaluated until needed. */
export interface DesignCssAlias {
  name: string
  fallback?: string
}
function variable(
  raw: string,
  start: number,
): (DesignCssAlias & { end: number }) | undefined {
  const head = /^var\(\s*(--[\w-]+)\s*/i.exec(raw.slice(start))
  if (!head?.[1]) return undefined
  let end = start + head[0].length
  if (raw[end] === ')') return { name: head[1], end: end + 1 }
  if (raw[end] !== ',') return undefined
  const from = ++end
  let depth = 0
  for (; end < raw.length; end++) {
    if (raw[end] === '(') depth++
    if (raw[end] === ')') {
      if (!depth)
        return {
          name: head[1],
          fallback: raw.slice(from, end).trim(),
          end: end + 1,
        }
      depth--
    }
  }
  return undefined
}
/** Recognize a single CSS reference without accepting trailing expressions.
 * @param raw - Complete trimmed declaration value, without comments.
 * @returns Reference and optional fallback, or undefined for other expressions.
 */
export function designCssAlias(raw: string): DesignCssAlias | undefined {
  const value = variable(raw, 0)
  return value?.end === raw.length
    ? {
      name: value.name,
      ...(value.fallback !== undefined ? { fallback: value.fallback } : {}),
    }
    : undefined
}
/** Evaluate bounded CSS numeric expressions with compatible dimensions.
 * @param raw - Number, absolute/rem length, calc(), min(), max() or clamp() expression.
 * @param context - Root conversion and custom-property resolution; percentages require an explicit basis.
 * @returns Finite pixel/unitless result, or undefined for unresolved or incompatible values.
 */
export function designCssNumber(
  raw: string,
  context: DesignCssNumberContext,
): DesignCssNumber | undefined {
  return parseCssNumber(raw, context, false)
}
function parseCssNumber(
  raw: string,
  context: DesignCssNumberContext,
  intermediate: boolean,
): DesignCssNumber | undefined {
  if (raw.length > (context.compile ? 32768 : 5000)) return undefined
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
  if (/^[a-z]+\(/i.test(source)) {
    let level = 0
    for (let i = source.indexOf('('); i < source.length; i++) {
      if (source[i] === '(') level++
      if (source[i] === ')' && --level === 0 && i !== source.length - 1)
        return undefined
    }
    if (level !== 0) return undefined
  } else if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?[a-z%]*$/i.test(source)
  )
    return undefined
  let position = 0,
    depth = 0,
    steps = 0
  const space = (): void => {
    while (/\s/.test(source[position] ?? '') && position < source.length)
      position++
  }
  const bounded = (
    value: DesignCssNumber | undefined,
  ): DesignCssNumber | undefined =>
    value && Number.isFinite(value.value) && (context.compile || Math.abs(value.value) <= 1000000)
      ? { ...value, expression: value.expression ?? { kind: 'literal', value: value.value, unit: value.unit } }
      : undefined
  const references = new Map<string, DesignCssNumber>()
  const expressionOf = (value: DesignCssNumber): CopyOSDesignNumberExpression => value.expression ?? {
    kind: 'literal', value: value.value, unit: value.unit,
  }
  const calculate = (
    expression: CopyOSDesignNumberExpression,
    rootRelative = false,
  ): DesignCssNumber | undefined => {
    const result = evaluateDesignNumberExpression(expression, id => references.get(id))
    return result ? bounded({ ...result, expression, computed: true, rootRelative }) : undefined
  }
  const combine = (
    a: DesignCssNumber,
    b: DesignCssNumber,
    operator: '+' | '-' | '*' | '/',
  ): DesignCssNumber | undefined => calculate({
    kind: 'binary', operator, left: expressionOf(a), right: expressionOf(b),
  }, !!(a.rootRelative || b.rootRelative))
  const atom = (): DesignCssNumber | undefined => {
    if (++steps > 512 || ++depth > 64) return undefined
    try {
      space()
      if (source[position] === '(') {
        position++
        const value = expression()
        space()
        if (source[position++] !== ')') return undefined
        return value
      }
      const reference = variable(source, position)
      if (reference) {
        position = reference.end
        const target = context.lookup?.(reference.name)
        if (target === 'other') return undefined
        if (target) {
          if (target.referenceId) references.set(target.referenceId, target)
          return { value: target.value, unit: target.unit,
            ...(target.rootRelative !== undefined ? { rootRelative: target.rootRelative } : {}),
            expression: target.referenceId ? { kind: 'reference', variableId: target.referenceId }
              : { kind: 'literal', value: target.value, unit: target.unit } }
        }
        return reference.fallback !== undefined ? parseCssNumber(reference.fallback, { ...context, lookup: (name) => {
          const result = context.lookup?.(name)
          if (result && result !== 'other' && result.referenceId) references.set(result.referenceId, result)
          return result
        } }, true) : undefined
      }
      const call = /^(calc|min|max|clamp)\(/i.exec(source.slice(position))
      if (call) {
        position += call[0].length
        const args: DesignCssNumber[] = []
        while (true) {
          const value = expression()
          if (!value) return undefined
          args.push(value)
          space()
          if (source[position] !== ',') break
          position++
        }
        if (
          source[position++] !== ')' ||
          args.some(v => v.unit !== args[0]?.unit)
        )
          return undefined
        const name = (call[1] ?? '').toLowerCase(),
          first = args[0]
        if (
          !first ||
          (name === 'calc' && args.length !== 1) ||
          (name === 'clamp' && args.length !== 3)
        )
          return undefined
        if (name === 'calc') return { ...first, expression: expressionOf(first), computed: true }
        if (name === 'clamp') {
          const preferred = args[1], max = args[2]
          if (!preferred || !max) return undefined
          return calculate({ kind: 'clamp', min: expressionOf(first), preferred: expressionOf(preferred), max: expressionOf(max) },
            args.some(value => value.rootRelative))
        }
        return calculate({ kind: name === 'min' ? 'min' : 'max', args: args.map(expressionOf) },
          args.some(value => value.rootRelative))
      }
      const number =
        /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)/i.exec(
          source.slice(position),
        )
      if (!number) return undefined
      position += number[0].length
      const value = Number(number[1]),
        unit = (number[2] ?? '').toLowerCase()
      if (!unit || unit === 'px')
        return bounded({ value, unit: unit ? 'px' : 'number' })
      if (unit === 'rem' && context.rootFontSize !== null)
        return bounded({
          value: value * context.rootFontSize,
          unit: 'px',
          computed: true,
          rootRelative: true,
        })
      if (unit === '%' && context.percentageBasis !== undefined)
        return bounded({
          value: (value * context.percentageBasis) / 100,
          unit: 'px',
          computed: true,
        })
      if (unit === 'em' && context.percentageBasis !== undefined)
        return bounded({
          value: value * context.percentageBasis,
          unit: 'px',
          computed: true,
        })
      const absolute: Record<string, number> = {
        in: 96,
        cm: 96 / 2.54,
        mm: 96 / 25.4,
        q: 96 / 101.6,
        pt: 96 / 72,
        pc: 16,
      }
      const scale = absolute[unit]
      return scale === undefined
        ? undefined
        : bounded({ value: value * scale, unit: 'px', computed: true })
    } finally {
      depth--
    }
  }
  const product = (): DesignCssNumber | undefined => {
    let value = atom()
    space()
    while (value && ['*', '/'].includes(source[position] ?? '')) {
      const operator = source[position++] as '*' | '/',
        next = atom()
      value = next ? combine(value, next, operator) : undefined
      space()
    }
    return value
  }
  const expression = (): DesignCssNumber | undefined => {
    let value = product()
    space()
    while (value && ['+', '-'].includes(source[position] ?? '')) {
      if (
        !/\s/.test(source[position - 1] ?? '') ||
        !/\s/.test(source[position + 1] ?? '')
      )
        return undefined
      const operator = source[position++] as '+' | '-',
        next = product()
      value = next ? combine(value, next, operator) : undefined
      space()
    }
    return value
  }
  const value = expression()
  space()
  if (position !== source.length || !value || ((!context.compile || !intermediate) && Math.abs(value.value) > 1000000)) return undefined
  if (context.compile) {
    if (!value.expression || !evaluateDesignNumberExpression(value.expression, id => references.get(id))) return undefined
    return value
  }
  const { expression: _expression, referenceId: _referenceId, ...evaluated } = value
  return evaluated
}
/** Find custom-property dependency cycles, including references in fallback branches.
 * @param properties - Raw declarations from one CSS context.
 * @returns Names whose computed custom-property value is invalid because of a cycle.
 */
export function designCssCycles(
  properties: Readonly<Record<string, string>>,
): Set<string> {
  const cyclic = new Set<string>(),
    visited = new Set<string>(),
    path: string[] = []
  const visit = (name: string): void => {
    const index = path.indexOf(name)
    if (index >= 0) {
      for (const member of path.slice(index)) cyclic.add(member)
      return
    }
    if (visited.has(name) || path.length >= 64) return
    path.push(name)
    const raw = (properties[name] ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const match of raw.matchAll(/var\(\s*(--[\w-]+)/gi))
      if (match[1] && properties[match[1]] !== undefined) visit(match[1])
    path.pop()
    visited.add(name)
  }
  for (const name of Object.keys(properties)) visit(name)
  return cyclic
}
/** Resolve a root font declaration against a 16px initial-font assumption.
 * @param raw - Root font declaration; omitted uses the initial size.
 * @param properties - Custom properties in the same context.
 * @returns Pixel size, or null when the root declaration cannot be resolved safely.
 */
export function designCssRootFontSize(
  raw: string | undefined,
  properties: Readonly<Record<string, string>>,
): number | null {
  if (raw === undefined) return 16
  const cyclic = designCssCycles(properties),
    active = new Set<string>()
  const cache = new Map<string, DesignCssNumber | 'other' | undefined>()
  const lookup = (name: string): DesignCssNumber | 'other' | undefined => {
    if (cyclic.has(name)) return undefined
    if (active.has(name) || active.size >= 64) return 'other'
    if (cache.has(name)) return cache.get(name)
    const value = properties[name]
    if (value === undefined) return undefined
    active.add(name)
    const result = evaluate(value)
    active.delete(name)
    cache.set(name, result)
    return result
  }
  const evaluate = (value: string): DesignCssNumber | 'other' | undefined => {
    const text = value.replace(/\/\*[\s\S]*?\*\//g, ' ').trim(),
      alias = designCssAlias(text)
    if (alias)
      return (
        lookup(alias.name) ??
        (alias.fallback === undefined ? undefined : evaluate(alias.fallback))
      )
    return (
      designCssNumber(text, {
        rootFontSize: 16,
        percentageBasis: 16,
        lookup,
      }) ?? 'other'
    )
  }
  const result = evaluate(raw)
  return result &&
    result !== 'other' &&
    result.value >= 0 &&
    (result.unit === 'px' || result.value === 0)
    ? result.value
    : null
}

/** Build numeric formula names from the same canonical and friendly registry as CSS export.
 * @param document - Current numeric and color resource identities and names.
 * @returns Preferred insertion names, accepted exact names and ambiguous raw names; canonical names always remain usable.
 */
export function designCssNumberRegistry(document: CopyOSDesignDocument): {
  byId: ReadonlyMap<string, string>
  byName: ReadonlyMap<string, string>
  ambiguous: ReadonlySet<string>
} {
  const names = designTokenCssNames(document)
  const byId = new Map(names.number), byName = new Map<string, string>(), counts = new Map<string, number>()
  for (const resource of [...document.variables, ...(document.numberVariables ?? [])])
    counts.set(resource.name, (counts.get(resource.name) ?? 0) + 1)
  for (const [id, name] of names.number) byName.set(name, id)
  for (const [id, name] of names.friendlyNumber) { byId.set(id, name); byName.set(name, id) }
  return { byId, byName, ambiguous: new Set([...counts].filter(([name, count]) => count > 1 && !byName.has(name)).map(([name]) => name)) }
}
