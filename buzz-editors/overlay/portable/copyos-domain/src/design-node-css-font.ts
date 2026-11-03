/** CSS family tokenization preserves quoted commas, escapes and generic keyword identity. */
import { tokenize, isTokenIdent, isTokenString, isTokenComma, isTokenWhitespace,
  isTokenComment, isTokenEOF } from '@csstools/css-tokenizer'
const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])
const quote = (value: string): string => '"' + value.replace(/["\\\x00-\x1f\x7f]/g,
  char => `\\${char.codePointAt(0)?.toString(16)} `) + '"'
/** Serialize an authored font-family list without interpreting quoted separators as fallback families.
 * @param value - CSS font-family list; malformed input is retained as one escaped family name.
 * @returns Safe CSS preserving generic versus named families and decoded CSS escapes.
 */
export function nodeCssFontFamily(value: string): string {
  const groups: { names: string[]; quoted: boolean }[] = [{ names: [], quoted: false }]
  let valid = true
  const tokens = tokenize({ css: value }, { onParseError: () => { valid = false } })
  for (const token of tokens) {
    const group = groups.at(-1)
    if (!group) return quote(value)
    if (isTokenWhitespace(token) || isTokenComment(token) || isTokenEOF(token)) continue
    if (isTokenComma(token)) { groups.push({ names: [], quoted: false }); continue }
    if (isTokenString(token) && !group.names.length) { group.names.push(token[4].value); group.quoted = true }
    else if (isTokenIdent(token) && !group.quoted) group.names.push(token[4].value)
    else valid = false
  }
  if (!valid || groups.some(group => !group.names.length)) return quote(value)
  return groups.map((group) => {
    const name = group.names.join(' ')
    return !group.quoted && generic.has(name.toLowerCase()) ? name.toLowerCase() : quote(name)
  }).join(', ')
}
