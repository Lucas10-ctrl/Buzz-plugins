/** Selector-aware custom-property inventory; parsing never executes imported CSS. */
import postcss, { type Declaration, type Rule } from 'postcss'
import type { CopyOSStyleGuideTokenContext } from './types.ts'
function rootFontSelector(selector: string): boolean {
  const text = selector.trim()
  if (!/^(?::root|html)(?=[.#[:]|$)/i.test(text)) return false
  let depth = 0,
    quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[' || char === '(') depth++
    if (char === ']' || char === ')') depth--
    if (
      !depth &&
      (/\s|[>+~|]/.test(char ?? '') || text.slice(i, i + 2) === '::')
    )
      return false
  }
  return depth === 0 && !quote
}
/** Extract base custom properties and separately named selector/conditional contexts.
 * @param css - Source stylesheet, limited by the owning style-guide repository.
 * @returns Root values, bounded scoped contexts and review warnings.
 */
export function extractStyleTokenContexts(css: string): {
  rootFontSize?: string | undefined
  customProperties: Record<string, string>
  customPropertyContexts?: CopyOSStyleGuideTokenContext[]
  customPropertyWarnings?: string[]
} {
  const root = postcss.parse(css, { from: undefined })
  type Entry = { value: string; important: boolean; priority: number }
  const base = new Map<string, Entry>(),
    contexts = new Map<
      string,
      { context: CopyOSStyleGuideTokenContext; values: Map<string, Entry> }
    >(),
    warnings = new Set<string>()
  const put = (
    map: Map<string, Entry>,
    decl: Declaration,
    priority = 0,
  ): void => {
    if (
      !/^--[\w-]+$/.test(decl.prop) &&
      decl.prop.toLowerCase() !== 'font-size'
    )
      return
    const property =
      decl.prop.toLowerCase() === 'font-size' ? 'font-size' : decl.prop
    if (
      property !== 'font-size' &&
      !map.has(property) &&
      map.size - Number(map.has('font-size')) >= 128
    ) {
      warnings.add('Custom properties are limited to 128 per context')
      return
    }
    const next = {
        value: decl.value.trim().slice(0, 500),
        important: decl.important,
        priority,
      },
      old = map.get(property)
    if (
      !old ||
      (next.important && !old.important) ||
      (next.important === old.important && next.priority >= old.priority)
    )
      map.set(property, next)
  }
  root.walkDecls(/^(--|font-size$)/i, (decl) => {
    const selectors: string[] = [],
      conditions: string[] = [],
      rules: Rule[] = []
    let parent = decl.parent
    while (parent && parent.type !== 'root') {
      if (parent.type === 'rule') {
        selectors.unshift(parent.selector)
        rules.unshift(parent)
      } else {
        if (
          [
            'keyframes',
            '-webkit-keyframes',
            'font-face',
            'property',
            'starting-style',
          ].includes(parent.name.toLowerCase())
        ) {
          warnings.add(
            `Custom properties inside @${parent.name} require review`,
          )
          return
        }
        if (parent.name.toLowerCase() === 'layer')
          warnings.add('CSS layer ordering requires review')
        else conditions.unshift(`@${parent.name} ${parent.params}`.trim())
      }
      parent = parent.parent
      if (selectors.length > 16 || conditions.length > 16) {
        warnings.add('CSS contexts deeper than 16 levels require review')
        return
      }
    }
    const isFont = decl.prop.toLowerCase() === 'font-size'
    if (
      isFont &&
      (rules.length !== 1 || !rules[0]?.selectors.some(rootFontSelector))
    )
      return
    if (!selectors.length) {
      if (decl.parent?.type === 'root') put(base, decl)
      else warnings.add('Custom properties without a selector require review')
      return
    }
    const rule = rules.at(-1)
    const global =
      !conditions.length &&
      rules.length === 1 &&
      rule?.selectors.some(s => [':root', 'html'].includes(s.trim()))
    if (global)
      put(
        base,
        decl,
        rule?.selectors.includes(':root')
          ? 10
          : rule?.selectors.includes('*')
            ? 0
            : 1,
      )
    const onlyGlobal = rule?.selectors.every(s =>
      [':root', 'html'].includes(s.trim()),
    )
    if (global && onlyGlobal) return
    if (
      selectors.some(s => s.length > 500) ||
      conditions.some(s => s.length > 500)
    ) {
      warnings.add(
        'CSS context labels longer than 500 characters require review',
      )
      return
    }
    const key = JSON.stringify({ selectors, conditions })
    let group = contexts.get(key)
    if (!group) {
      if (contexts.size >= 32) {
        warnings.add('CSS contexts are limited to 32')
        return
      }
      group = {
        context: {
          key,
          name: [...conditions, ...selectors].join(' · ').slice(0, 200),
          selectors,
          conditions,
          customProperties: {},
        },
        values: new Map(),
      }
      contexts.set(key, group)
      for (const ancestor of rules.slice(0, -1))
        for (const node of ancestor.nodes)
          if (node.type === 'decl' && node.prop.startsWith('--'))
            put(group.values, node)
    }
    put(group.values, decl)
  })
  const customProperties = Object.fromEntries(
    [...base]
      .filter(([name]) => name !== 'font-size')
      .map(([name, value]) => [name, value.value]),
  )
  const scoped = [...contexts.values()].map(({ context, values }) => ({
    ...context,
    ...(values.has('font-size')
      ? { rootFontSize: values.get('font-size')?.value }
      : {}),
    customProperties: Object.fromEntries(
      [...values]
        .filter(([name]) => name !== 'font-size')
        .map(([name, value]) => [name, value.value]),
    ),
  }))
  return {
    customProperties,
    ...(base.has('font-size')
      ? { rootFontSize: base.get('font-size')?.value }
      : {}),
    ...(scoped.length ? { customPropertyContexts: scoped } : {}),
    ...(warnings.size
      ? { customPropertyWarnings: [...warnings].slice(0, 64) }
      : {}),
  }
}
