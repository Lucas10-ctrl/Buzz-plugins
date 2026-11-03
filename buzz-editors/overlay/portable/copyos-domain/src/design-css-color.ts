/** Static CSS colors normalized to the native document's sRGB palette with full-precision alpha. */
import {
  color,
  serializeRGB,
  ColorNotation,
  SyntaxFlag,
} from '@csstools/css-color-parser'
import {
  parseComponentValue,
  parseListOfComponentValues,
  replaceComponentValues,
  isFunctionNode,
  isSimpleBlockNode,
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  type ComponentValue,
} from '@csstools/css-parser-algorithms'
import {
  tokenize,
  isTokenNumber,
  isTokenPercentage,
  isTokenDimension,
  isTokenIdent,
  isTokenComma,
  isTokenFunction,
  isTokenOpenParen,
  isTokenOpenSquare,
  isTokenOpenCurly,
  isTokenCloseParen,
  isTokenCloseSquare,
  isTokenCloseCurly,
  type CSSToken,
} from '@csstools/css-tokenizer'
import { designColorVariableCss, type DesignColorValue } from './design-color.ts'
import type { DesignCssAlias } from './design-css-number.ts'

/** Convert a context-independent color without discarding non-opaque alpha.
 * @param raw - One CSS value; relative variables and environment-dependent colors remain unresolved.
 * @returns A normalized sRGB CSS color, or null for unsupported/invalid values.
 * Wide-gamut colors are mapped to sRGB before eight-bit channel quantization; alpha is retained independently at full numeric precision.
 */
export function designCssColor(raw: string): string | null {
  const values = parseValues(raw)
  const value=values ? convertColor(values.flatMap(value => value.tokens())) : null
  return value?designColorVariableCss(value):null
}

function convertColor(tokens: CSSToken[]): DesignColorValue | null {
  let depth = 0
  for (const token of tokens) {
    if (
      (isTokenFunction(token) ||
        isTokenOpenParen(token) ||
        isTokenOpenSquare(token) ||
        isTokenOpenCurly(token)) &&
      ++depth > 64
    )
      return null
    if (
      (isTokenCloseParen(token) ||
        isTokenCloseSquare(token) ||
        isTokenCloseCurly(token)) &&
      --depth < 0
    )
      return null
    if (
      isTokenFunction(token) &&
      ['var', 'env', 'light-dark'].includes(token[4].value.toLowerCase())
    )
      return null
    if (
      isTokenIdent(token) &&
      ['currentcolor', 'none', 'infinity', '-infinity', 'nan'].includes(
        token[4].value.toLowerCase(),
      )
    )
      return null
  }
  if (depth !== 0) return null
  if (
    tokens.some(
      token =>
        (isTokenNumber(token) ||
          isTokenPercentage(token) ||
          isTokenDimension(token)) &&
        !Number.isFinite(token[4].value),
    )
  )
    return null
  const component = parseComponentValue(tokens)
  if (!component) return null
  // Direct RGB channels clamp at parsed-value time, before containing mixes or relative-color math.
  const normalized = replaceComponentValues([[component]], (value) => {
    if (
      !isFunctionNode(value) ||
      !['rgb', 'rgba'].includes(value.getName().toLowerCase())
    )
      return
    const rgb = color(value)
    if (
      !rgb ||
      rgb.syntaxFlags.has(SyntaxFlag.RelativeColorSyntax) ||
      typeof rgb.alpha !== 'number' ||
      rgb.channels.every(channel => channel >= 0 && channel <= 1)
    )
      return
    const channels = rgb.channels.map(
      channel => Math.max(0, Math.min(1, channel)) * 255,
    )
    // The general serializer can simplify almost-opaque alpha; retain its exact numeric value here.
    return parseComponentValue(
      tokenize({ css: `rgb(${channels.join(' ')} / ${rgb.alpha})` }),
    )
  })[0]?.[0]
  const parsed = normalized && color(normalized)
  if (!parsed || typeof parsed.alpha!=='number' || !Number.isFinite(parsed.alpha)) return null
  const alpha=parsed.alpha
  if (
    parsed.colorNotation === ColorNotation.RGB &&
    !parsed.syntaxFlags.has(SyntaxFlag.ColorMix) &&
    !parsed.syntaxFlags.has(SyntaxFlag.RelativeColorSyntax)
  )
    parsed.channels = parsed.channels.map(channel =>
      Math.max(0, Math.min(1, channel)),
    ) as typeof parsed.channels
  const rgb = color(serializeRGB(parsed))
  return rgb && rgb.channels.every(Number.isFinite)
    ? { ...(alpha===1?{}:{ alpha }),value:'#' +
        rgb.channels
          .map(channel =>
            Math.round(
              (Math.max(0, Math.min(1, channel)) + Number.EPSILON) * 255,
            )
              .toString(16)
              .padStart(2, '0'),
          )
          .join('') }
    : null
}

function parseValues(raw: string): ComponentValue[] | undefined {
  if (raw.length > 5000) return
  const status = { invalid: false }
  const onParseError = (): void => {
    status.invalid = true
  }
  const tokens = tokenize({ css: raw }, { onParseError })
  let depth = 0
  for (const token of tokens) {
    if (
      (isTokenFunction(token) ||
        isTokenOpenParen(token) ||
        isTokenOpenSquare(token) ||
        isTokenOpenCurly(token)) &&
      ++depth > 64
    )
      return
    if (
      (isTokenCloseParen(token) ||
        isTokenCloseSquare(token) ||
        isTokenCloseCurly(token)) &&
      --depth < 0
    )
      return
  }
  if (depth !== 0) return
  const values = parseListOfComponentValues(tokens, { onParseError })
  return status.invalid ? undefined : values
}

function variable(
  values: ComponentValue[],
): { name: string; fallback?: ComponentValue[] } | undefined {
  const comma = values.findIndex(
    value => isTokenNode(value) && isTokenComma(value.value),
  )
  const head = (comma < 0 ? values : values.slice(0, comma)).filter(
    value => !isWhiteSpaceOrCommentNode(value),
  )
  const first = head[0]
  if (
    head.length !== 1 ||
    !first ||
    !isTokenNode(first) ||
    !isTokenIdent(first.value) ||
    !first.value[4].value.startsWith('--') ||
    first.value[4].value.length <= 2
  )
    return
  return {
    name: first.value[4].value,
    ...(comma >= 0 ? { fallback: values.slice(comma + 1) } : {}),
  }
}

/** A computed color snapshot and the raw custom properties that supplied its tokens. */
export interface DesignCssComputedColor {
  value: string
  alpha?: number | undefined
  dependencies: string[]
}

/** Cached, bounded custom-property substitution for one CSS context. */
export interface DesignCssColorResolver {
  /** Names participating in dependency cycles, including unused fallback branches. */
  cyclic: ReadonlySet<string>
  /** Resolve one static color, or null when context, invalid syntax or limits prevent it. */
  resolve: (raw: string) => DesignCssComputedColor | null
  /** Recognize one complete var() including escaped function and property identifiers. */
  alias: (raw: string) => DesignCssAlias | undefined
}

/** Resolve colors from raw CSS token lists without requiring channel lists to be native tokens.
 * @param properties - Declarations in one merged Base/mode CSS context.
 * @param lookup - Existing native literal for a name absent from the CSS inventory.
 * @returns Cached resolver; substitution retains token boundaries, rejects cycles and never executes CSS.
 */
export function createDesignCssColorResolver(
  properties: Readonly<Record<string, string>>,
  lookup: (name: string) => string | undefined = () => undefined,
): DesignCssColorResolver {
  const missing = Symbol('missing'),
    unsupported = Symbol('unsupported')
  type Expanded = {
    tokens: CSSToken[]
    dependencies: Set<string>
    referenceDepth: number
  }
  type Result = Expanded | typeof missing | typeof unsupported
  const trees = new Map(
    Object.entries(properties).map(([name, raw]) => [name, parseValues(raw)]),
  )
  const references = (values: ComponentValue[]): string[] =>
    values.flatMap((value) => {
      if (!isFunctionNode(value) && !isSimpleBlockNode(value)) return []
      const own =
        isFunctionNode(value) && value.getName().toLowerCase() === 'var'
          ? variable(value.value)?.name
          : undefined
      return [...(own ? [own] : []), ...references(value.value)]
    })
  const graph = new Map(
    [...trees].map(([name, values]) => [
      name,
      values ? references(values) : [],
    ]),
  )
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
    for (const target of graph.get(name) ?? [])
      if (trees.has(target)) visit(target)
    path.pop()
    visited.add(name)
  }
  for (const name of trees.keys()) visit(name)
  const cache = new Map<string, Expanded | typeof missing>()
  let steps = 0
  const active = new Set<string>()
  const resolve = (name: string): Result => {
    if (cyclic.has(name)) return missing
    if (active.has(name) || active.size >= 64 || ++steps > 10000)
      return unsupported
    const cached = cache.get(name)
    if (cached)
      return cached === missing || active.size + cached.referenceDepth < 64
        ? cached
        : unsupported
    const values = trees.has(name)
      ? trees.get(name)
      : parseValues(lookup(name) ?? 'initial')
    if (!values) return unsupported
    const meaningful = values.filter(
      value => !isWhiteSpaceOrCommentNode(value),
    )
    const keyword =
      meaningful.length === 1 &&
      meaningful[0] &&
      isTokenNode(meaningful[0]) &&
      isTokenIdent(meaningful[0].value)
        ? meaningful[0].value[4].value.toLowerCase()
        : null
    if (keyword === 'initial') return missing
    if (
      keyword &&
      ['inherit', 'unset', 'revert', 'revert-layer'].includes(keyword)
    )
      return unsupported
    active.add(name)
    const result = expand(values)
    active.delete(name)
    if (result !== unsupported) cache.set(name, result)
    return result
  }
  const expand = (values: ComponentValue[]): Result => {
    const tokens: CSSToken[] = [],
      dependencies = new Set<string>()
    let length = 0,
      referenceDepth = 0
    const append = (part: CSSToken[]): boolean => {
      for (const token of part) {
        length += token[1].length
        if (length > 5000) return false
        tokens.push(token)
      }
      return true
    }
    for (const value of values) {
      if (++steps > 10000) return unsupported
      if (isFunctionNode(value) && value.getName().toLowerCase() === 'var') {
        const source = variable(value.value)
        if (!source) return missing
        let result = resolve(source.name)
        if (result === missing && source.fallback !== undefined)
          result = expand(source.fallback)
        if (result === missing || result === unsupported) return result
        if (!append(result.tokens)) return unsupported
        dependencies.add(source.name)
        for (const name of result.dependencies) dependencies.add(name)
        referenceDepth = Math.max(referenceDepth, result.referenceDepth + 1)
      } else if (isFunctionNode(value) || isSimpleBlockNode(value)) {
        const result = expand(value.value)
        if (result === missing || result === unsupported) return result
        const start = isFunctionNode(value) ? value.name : value.startToken
        if (!append([start, ...result.tokens, value.endToken]))
          return unsupported
        for (const name of result.dependencies) dependencies.add(name)
        referenceDepth = Math.max(referenceDepth, result.referenceDepth)
      } else if (!append(value.tokens())) return unsupported
    }
    return { tokens, dependencies, referenceDepth }
  }
  return {
    cyclic,
    alias: (raw) => {
      const values = parseValues(raw)?.filter(
          value => !isWhiteSpaceOrCommentNode(value),
        ),
        first = values?.[0]
      if (
        values?.length !== 1 ||
        !first ||
        !isFunctionNode(first) ||
        first.getName().toLowerCase() !== 'var'
      )
        return
      const source = variable(first.value)
      return source
        ? {
          name: source.name,
          ...(source.fallback !== undefined
            ? {
              fallback: source.fallback
                .map(value => value.toString())
                .join(''),
            }
            : {}),
        }
        : undefined
    },
    resolve: (raw) => {
      steps = 0
      const values = parseValues(raw)
      if (!values) return null
      const result = expand(values)
      if (
        result === missing ||
        result === unsupported ||
        result.referenceDepth > 64
      )
        return null
      const value = convertColor(result.tokens)
      return value ? { ...value, dependencies: [...result.dependencies] } : null
    },
  }
}
