/** Named typography snapshots from authored workspace CSS; token inventories never become invented style combinations. */
import postcss from 'postcss'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { designCssNumber, designCssRootFontSize, type DesignCssNumber } from './design-css-number.ts'
import type { CopyOSDesignTextStyle, CopyOSStyleGuideDocument } from './types.ts'

const unsupportedProperties = new Set(['font', 'font-feature-settings', 'font-variation-settings', 'font-stretch',
  'font-kerning', 'font-optical-sizing', 'font-variant', 'font-variant-ligatures', 'font-variant-caps',
  'font-variant-numeric', 'font-variant-position', 'font-variant-east-asian', 'font-variant-alternates', 'font-variant-emoji',
  'text-transform', 'text-decoration'])
const properties = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'])

/**
 * Read explicit typography recipes without executing CSS or changing the workspace guide.
 * @param guide - Saved workspace CSS and its custom-property inventory.
 * @returns Up to 128 named immutable style snapshots and the number of unsupported or incomplete typography rules.
 */
export function designBrandTypography(guide: CopyOSStyleGuideDocument): { styles: CopyOSDesignTextStyle[]; skipped: number } {
  if (guide.css.length > 1_000_000) throw new Error('Workspace typography CSS exceeds 1000000 characters')
  const root = postcss.parse(guide.css, { from: undefined })
  const rules = new Map<string, Map<string, string>>()
  const important = new Map<string, Set<string>>()
  let skipped = 0
  root.walkRules((rule) => {
    const declarations = new Map<string, { value: string; important: boolean }>()
    for (const child of rule.nodes) {
      if (child.type !== 'decl') continue
      const key = child.prop.toLowerCase()
      if ((properties.has(key) || unsupportedProperties.has(key)) && (!declarations.get(key)?.important || child.important))
        declarations.set(key, { value: child.value, important: child.important })
    }
    if (!declarations.size) return
    if (rule.parent?.type !== 'root' || [...declarations.keys()].some(key => unsupportedProperties.has(key))) { skipped++; return }
    const selectors = rule.selectors
    for (const selector of selectors) {
      const key = selector.trim()
      const current = rules.get(key) ?? new Map<string, string>()
      const priorities = important.get(key) ?? new Set<string>()
      for (const [property, declaration] of declarations) {
        if (priorities.has(property) && !declaration.important) continue
        current.set(property, declaration.value)
        if (declaration.important) priorities.add(property)
      }
      important.set(key, priorities); rules.set(key, current)
    }
  })
  // A declaration on body owns that inherited base, even when root is written later in the stylesheet.
  const base = new Map([...rules.get('html') ?? [], ...rules.get(':root') ?? [], ...rules.get('body') ?? []])
  const variables = guide.tokens.customProperties
  const rootSize = designCssRootFontSize(guide.tokens.rootFontSize, variables)
  const active = new Set<string>(), cache = new Map<string, DesignCssNumber | 'other' | undefined>()
  const lookup = (name: string): DesignCssNumber | 'other' | undefined => {
    if (active.has(name) || active.size > 32) return undefined
    if (cache.has(name)) return cache.get(name)
    const raw = variables[name]
    if (raw === undefined) return undefined
    active.add(name)
    const value = designCssNumber(raw, { rootFontSize: rootSize, lookup }) ?? 'other'
    active.delete(name); cache.set(name, value)
    return value
  }
  const numeric = (raw: string) => designCssNumber(raw, { rootFontSize: rootSize, lookup })
  const fontFamily = (raw: string, depth = 0): string | undefined => {
    if (depth > 32) return undefined
    const alias = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(raw.trim())
    if (alias?.[1]) return fontFamily(variables[alias[1]] ?? alias[2] ?? '', depth + 1)
    const value = raw.trim()
    return value && value.length <= 300 && !/\b(?:var|url)\(|[;{}]|^(?:inherit|initial|unset|revert)$/i.test(value) ? value : undefined
  }
  const styles: CopyOSDesignTextStyle[] = []
  for (const [selector, authored] of rules) {
    // A root-font-only declaration is conversion context, not a named text recipe.
    if (selector === '*' || (selector === ':root' || selector === 'html') &&
      !authored.has('font-family') && !authored.has('line-height')) continue
    if (selector !== ':root' && !/^(?:[a-z][\w-]*|[.#][\w-]+)$/i.test(selector)) { skipped++; continue }
    const values = selector === ':root' || selector === 'html' ? authored : new Map([...base, ...authored])
    const family = fontFamily(values.get('font-family') ?? '')
    const size = numeric(values.get('font-size') ?? '')
    const weightRaw = values.get('font-weight') ?? ''
    const weight = numeric(weightRaw === 'normal' ? '400' : weightRaw === 'bold' ? '700' : weightRaw)
    const heightRaw = values.get('line-height')
    const height = heightRaw ? numeric(heightRaw) : undefined
    const spacingRaw = values.get('letter-spacing') ?? '0px'
    const spacing = numeric(spacingRaw === 'normal' ? '0px' : spacingRaw)
    const slant = values.get('font-style') ?? 'normal'
    const lineHeight = height && size ? height.unit === 'px' ? height.value / size.value : height.value : undefined
    if (!family || !size || size.unit !== 'px' || size.value < 1 || size.value > 1000 || !weight || weight.unit !== 'number' ||
      !Number.isInteger(weight.value) || weight.value < 1 || weight.value > 1000 || !spacing ||
      spacing.unit !== 'px' && spacing.value !== 0 || Math.abs(spacing.value) > 1000 ||
      !lineHeight || lineHeight < .5 || lineHeight > 10 || slant !== 'normal' && slant !== 'italic' || styles.length >= 128) {
      skipped++; continue
    }
    const fields: Omit<CopyOSDesignTextStyle, 'id'> = { name: `${guide.name} / ${selector}`.slice(0, 200), fontFamily: family, fontSize: size.value, fontWeight: weight.value,
      lineHeight, letterSpacing: spacing.value, fontStyle: slant }
    const hex = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([guide.name, fields]))))
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    styles.push({ id, ...fields })
  }
  return { styles, skipped }
}
