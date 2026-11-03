/** Bounded font-family metadata; local enumeration runs only after an explicit user gesture. */
export interface DesignerFontChoice {
  value: string
  name: string
  source: 'document' | 'bundled' | 'local'
  available: boolean
}
const genericFamilies = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])
let localFamilies: readonly string[] | null = null
let pendingLocal: Promise<readonly string[]> | null = null

/** Validate a bounded CSS family stack without replacing its original quoting or fallbacks.
 * @param value - User-authored font-family declaration value.
 * @returns Trimmed original value, or null for invalid or empty declarations.
 */
export function normalizeDesignerFont(value: string): string | null {
  const text = value.trim()
  if (!text || text.length > 200 || /[\x00-\x1f\x7f]/.test(text)) return null
  const tokens: string[] = []
  let start = 0,
    quote = '',
    escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index)
    if (escaped) {
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === ',') {
      tokens.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  if (quote || escaped) return null
  tokens.push(text.slice(start).trim())
  if (
    tokens.some(
      token =>
        !token ||
        (token[0] === '"' || token[0] === "'"
          ? token.length < 3 ||
            token.at(-1) !== token[0] ||
            !/^(['"])(?:\\.|(?!\1)[^\\])*\1$/.test(token)
          : !token
            .split(/ +/)
            .every(word =>
              /^-?(?:[_\p{L}]|--)[\p{L}\p{N}_-]*$/u.test(word),
            )),
    )
  )
    return null
  if (
    tokens.length > 1 &&
    tokens.some(token =>
      /^(inherit|initial|unset|revert|revert-layer)$/i.test(token),
    )
  )
    return null
  const cssApi:
    { supports?: (property: string, value: string) => boolean } | undefined =
      typeof CSS === 'undefined' ? undefined : CSS
  if (cssApi?.supports && !cssApi.supports('font-family', text)) return null
  return text
}

/** Display the first family while keeping the complete CSS stack in its choice value.
 * @param value - CSS family stack.
 * @returns Unquoted first-family name.
 */
export function designerFontName(value: string): string {
  const first =
    value
      .match(/^\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)/)?.[1]
      ?.trim() ?? value
  return first[0] === '"' || first[0] === "'"
    ? first.slice(1, -1).replace(/\\([\\"'])/g, '$1')
    : first
}

/** Read only already-loaded web FontFace entries; this does not test installed fonts or initiate loads.
 * @returns Bounded known-loaded family names.
 */
export function designerLoadedWebFonts(): readonly string[] {
  const names = new Set<string>()
  const fontDocument: Partial<Document> = document
  let scanned = 0
  fontDocument.fonts?.forEach((face) => {
    if (scanned++ >= 2000 || face.status !== 'loaded') return
    const value = normalizeDesignerFont(face.family)
    if (value) names.add(designerFontName(value))
  })
  return [...names]
}

/** Detect the metadata enumeration API without requesting permission.
 * @returns Whether this browser exposes local font access.
 */
export function designerLocalFontsSupported(): boolean {
  const fontWindow: Window & {
    queryLocalFonts?: () => Promise<readonly { family: string }[]>
  } = window
  return typeof fontWindow.queryLocalFonts === 'function'
}

/** Read metadata previously authorized in this page; no font files or persistent storage are used.
 * @returns Cached local family names, or an empty list before authorization.
 */
export function designerCachedLocalFonts(): readonly string[] {
  return localFamilies ?? []
}

/** Enumerate local family metadata only from a user-click handler; font bytes are never read.
 * @returns At most 1000 unique families from the first 5000 API records, cached in memory.
 */
export function loadDesignerLocalFonts(): Promise<readonly string[]> {
  if (localFamilies) return Promise.resolve(localFamilies)
  if (pendingLocal) return pendingLocal
  const fontWindow: Window & {
    queryLocalFonts?: () => Promise<readonly { family: string }[]>
  } = window
  if (!fontWindow.queryLocalFonts)
    return Promise.reject(new Error('Local font access unavailable'))
  const request = fontWindow.queryLocalFonts()
  pendingLocal = request
    .then((records) => {
      const names = new Set<string>()
      for (
        let index = 0;
        index < Math.min(5000, records.length) && names.size < 1000;
        index++
      ) {
        const family = records[index]?.family.trim()
        if (family && family.length <= 150 && !/[\x00-\x1f\x7f]/.test(family))
          names.add(family)
      }
      localFamilies = [...names].sort((a, b) => a.localeCompare(b))
      return localFamilies
    })
    .finally(() => {
      pendingLocal = null
    })
  return pendingLocal
}

/** Build bounded choices without claiming unresolved document families are installed.
 * @param families - Stored document CSS stacks.
 * @param loaded - Known-loaded web family names.
 * @param local - Explicitly enumerated local family names.
 * @returns Unique CSS values with clean names and source/preview metadata.
 */
export function designerFontChoices(
  families: readonly string[],
  loaded: readonly string[],
  local: readonly string[],
): DesignerFontChoice[] {
  const known = new Set([
    'inter',
    ...loaded.slice(0, 2000).map(name => name.toLowerCase()),
    ...local.slice(0, 1000).map(name => name.toLowerCase()),
  ])
  const choices = new Map<string, DesignerFontChoice>()
  const add = (value: string, source: DesignerFontChoice['source']): void => {
    const valid = normalizeDesignerFont(value)
    if (!valid) return
    const name = designerFontName(valid)
    if (choices.has(name.toLowerCase())) return
    choices.set(name.toLowerCase(), {
      value: valid,
      name,
      source,
      available:
        known.has(name.toLowerCase()) ||
        genericFamilies.has(name.toLowerCase()),
    })
  }
  for (const family of families.slice(0, 2000)) add(family, 'document')
  add('Inter, sans-serif', 'bundled')
  for (const family of loaded.slice(0, 2000)) {
    if (family.toLowerCase() === 'copyosinter') continue
    add(JSON.stringify(family), 'bundled')
  }
  for (const family of local.slice(0, 1000))
    add(JSON.stringify(family), 'local')
  return [...choices.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value),
  )
}
