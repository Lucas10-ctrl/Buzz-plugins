import { normalizeDesignFontVariations } from './design-font-variations.ts'
import { normalizeDesignFontFeatures } from './design-font-features.ts'
import { designTextHyperlinkSchema } from './design-text-hyperlink.ts'
/** Sparse UTF-16 inline formatting and lossless edits shared by native and interactive text consumers. */
import type { CopyOSDesignNode, CopyOSDesignTextRun, CopyOSDesignTextRunStyle } from './types.ts'

/** Supported inline style reset fields; null reveals the current base text style. */
export type DesignTextRunStylePatch = { [K in keyof CopyOSDesignTextRunStyle]?: CopyOSDesignTextRunStyle[K] | null }
/** Complete effective typography for one contiguous piece of authored text. */
export interface DesignTextSegment {
  start: number
  end: number
  text: string
  style: { [K in keyof Omit<CopyOSDesignTextRunStyle, 'fill' | 'hyperlink'>]-?: Exclude<CopyOSDesignTextRunStyle[K], undefined> } &
    { fill?: string | undefined; hyperlink?: CopyOSDesignTextRunStyle['hyperlink'] }
}
const keys = ['hyperlink', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatures', 'fontVariations', 'lineHeight', 'letterSpacing', 'textDecoration', 'fill'] as const
const styleKey = (style: CopyOSDesignTextRunStyle) => JSON.stringify(keys.map(key => key === 'hyperlink' ? style.hyperlink ? [style.hyperlink.type, style.hyperlink.value] : null : style[key] ?? null))
/** Check an offset without splitting a UTF-16 surrogate pair.
 * @param text - Authored text.
 * @param offset - UTF-16 offset including either endpoint.
 * @returns Whether the offset is an integer character boundary.
 */
export function designTextBoundary(text: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xD800 && text.charCodeAt(offset - 1) <= 0xDBFF &&
    text.charCodeAt(offset) >= 0xDC00 && text.charCodeAt(offset) <= 0xDFFF)
}
function range(text: string, start: number, end: number): void {
  if (!designTextBoundary(text, start) || !designTextBoundary(text, end) || end < start)
    throw new Error('Text ranges require ordered UTF-16 character boundaries')
}
/** Canonicalize sparse formatting without resolving inherited base values.
 * @param text - Authored text whose UTF-16 offsets the runs address.
 * @param runs - At most 1000 nonoverlapping runs; order is canonicalized.
 * @returns Independent sorted runs with adjacent equal styles merged and empty styles removed.
 */
export function normalizeDesignTextRuns(text: string, runs: readonly CopyOSDesignTextRun[] = []): CopyOSDesignTextRun[] {
  if (text.length > 100000 || runs.length > 1000) throw new Error('Text exceeds its content or inline-run budget')
  const result: CopyOSDesignTextRun[] = []
  let previousEnd = 0
  for (const run of [...runs].sort((a, b) => a.start - b.start)) {
    range(text, run.start, run.end)
    if (run.end === run.start || run.start < previousEnd) throw new Error('Text runs require nonempty nonoverlapping ranges')
    previousEnd = run.end
    for (const key of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const) {
      const value = run.style[key]
      const [minimum, maximum] = key === 'fontSize' ? [1, 1000] as const : key === 'fontWeight' ? [100, 900] as const :
        key === 'lineHeight' ? [0.5, 10] as const : [-1000, 1000] as const
      if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum ||
        key === 'fontWeight' && !Number.isInteger(value))) throw new Error('Invalid inline numeric typography')
    }
    if (run.style.fontFamily !== undefined && (!run.style.fontFamily.length || run.style.fontFamily.length > 200) ||
      run.style.fill !== undefined && !/^#[a-fA-F0-9]{6}$/.test(run.style.fill)) throw new Error('Invalid inline font family or solid color')
    if (run.style.hyperlink !== undefined && !designTextHyperlinkSchema.safeParse(run.style.hyperlink).success)
      throw new Error('Invalid text hyperlink')
    const normalized = { ...run.style, ...(run.style.fontFeatures !== undefined
      ? { fontFeatures: normalizeDesignFontFeatures(run.style.fontFeatures) } : {}),
    ...(run.style.fontVariations !== undefined ? { fontVariations: normalizeDesignFontVariations(run.style.fontVariations) } : {}) }
    const style = Object.fromEntries(keys.flatMap(key => run.style[key] === undefined ? [] : [[key, normalized[key]]]))
    if (!Object.keys(style).length) continue
    const previous = result.at(-1)
    if (previous?.end === run.start && styleKey(previous.style) === styleKey(style)) previous.end = run.end
    else result.push({ start: run.start, end: run.end, style })
  }
  return result
}
function compactRuns(runs: readonly CopyOSDesignTextRun[]): CopyOSDesignTextRun[] {
  const result: CopyOSDesignTextRun[] = []
  for (const run of [...runs].sort((left, right) => left.start - right.start)) {
    const previous = result.at(-1)
    if (previous?.end === run.start && styleKey(previous.style) === styleKey(run.style)) previous.end = run.end
    else result.push({ ...run })
  }
  return result
}
/** Expand inherited gaps into complete effective inline typography without changing authored runs.
 * @param node - Effective text after shared styles and numeric bindings.
 * @returns Ordered segments covering all authored characters, including inherited gaps.
 */
export function designTextSegments(node: CopyOSDesignNode): DesignTextSegment[] {
  const base = { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight,
    fontStyle: node.fontStyle ?? 'normal', lineHeight: node.lineHeight, letterSpacing: node.letterSpacing ?? 0,
    textDecoration: node.textDecoration ?? 'none', fontVariations: normalizeDesignFontVariations(node.fontVariations ?? []), fontFeatures: normalizeDesignFontFeatures(node.fontFeatures ?? []) } as const
  const result: DesignTextSegment[] = []
  const append = (start: number, end: number, style: CopyOSDesignTextRunStyle = {}) => {
    if (end > start) {
      const effective = { ...base }
      for (const key of keys) if (style[key] !== undefined) Object.assign(effective, { [key]: style[key] })
      result.push({ start, end, text: node.text.slice(start, end), style: effective })
    }
  }
  let start = 0
  for (const run of node.textRuns ?? []) { append(start, run.start); append(run.start, run.end, run.style); start = run.end }
  append(start, node.text.length)
  return result
}
function changed(node: CopyOSDesignNode, text: string, runs: CopyOSDesignTextRun[]): CopyOSDesignNode {
  if (node.text === text && JSON.stringify(node.textRuns ?? []) === JSON.stringify(runs)) return node
  const sameMetrics = node.text === text && JSON.stringify(designTextMetricRuns(node)) ===
    JSON.stringify(designTextMetricRuns({ ...node, textRuns: runs }))
  return { ...node, text, textRuns: runs, ...(!sameMetrics ? { textLayoutMetrics: undefined, textBaselineMetrics: undefined } : {}) }
}
/** Replace a character range while preserving unaffected formatting and inheriting insertion-point style.
 * @param node - Authored or contextual text layer.
 * @param start - Inclusive UTF-16 character boundary.
 * @param end - Exclusive UTF-16 character boundary.
 * @param text - Replacement text; insertions use the preceding character's sparse style.
 * @returns New text with rebased runs and invalidated measurements; replacement uses its first replaced character's style.
 */
export function replaceDesignTextRange(node: CopyOSDesignNode, start: number, end: number, text: string): CopyOSDesignNode {
  range(node.text, start, end)
  const content = node.text.slice(0, start) + text + node.text.slice(end), delta = text.length - (end - start)
  const runs = normalizeDesignTextRuns(node.text, node.textRuns), output: CopyOSDesignTextRun[] = []
  const point = start === end ? Math.max(0, start - 1) : start
  const inserted = runs.find(run => run.start <= point && point < run.end)?.style
  for (const run of runs) {
    if (run.start < start) output.push({ start: run.start, end: Math.min(run.end, start), style: run.style })
    if (run.end > end) output.push({ start: Math.max(run.start, end) + delta, end: run.end + delta, style: run.style })
  }
  if (text.length && inserted) output.push({ start, end: start + text.length, style: inserted })
  return changed(node, content, normalizeDesignTextRuns(content, compactRuns(output)))
}
/** Rebase formatting for a plain whole-content edit using one minimal prefix/suffix replacement.
 * @param node - Current effective text and sparse formatting.
 * @param text - New plain text.
 * @returns Edited layer; unaffected prefix/suffix styles remain live.
 */
export function rebaseDesignTextRuns(node: CopyOSDesignNode, text: string): CopyOSDesignNode {
  if (text === node.text) return node
  let start = 0, oldEnd = node.text.length, newEnd = text.length
  while (start < oldEnd && start < newEnd && node.text[start] === text[start]) start++
  while (!designTextBoundary(node.text, start) || !designTextBoundary(text, start)) start--
  while (oldEnd > start && newEnd > start && node.text[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd-- }
  while (!designTextBoundary(node.text, oldEnd) || !designTextBoundary(text, newEnd)) { oldEnd++; newEnd++ }
  return replaceDesignTextRange(node, start, oldEnd, text.slice(start, newEnd))
}
/** Set or reset sparse formatting within a range without materializing inherited styles.
 * @param node - Authored or contextual text layer.
 * @param start - Inclusive UTF-16 boundary.
 * @param end - Exclusive UTF-16 boundary; an empty selection changes nothing.
 * @param patch - Requested fields; null clears all sparse formatting within the range.
 * @returns Layer with canonical runs and invalidated measurements.
 */
export function styleDesignTextRange(node: CopyOSDesignNode, start: number, end: number,
  patch: DesignTextRunStylePatch | null): CopyOSDesignNode {
  range(node.text, start, end)
  if (start === end) return node
  const runs = normalizeDesignTextRuns(node.text, node.textRuns), points = [...new Set([0, node.text.length, start, end,
      ...runs.flatMap(run => [run.start, run.end])])].sort((a, b) => a - b), output: CopyOSDesignTextRun[] = []
  let index = 0
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1]
    if (from === undefined || to === undefined) continue
    while ((runs[index]?.end ?? Infinity) <= from) index++
    const current = runs[index]
    const inherited = current && current.start <= from ? current.style : {}
    const style = { ...inherited }
    if (from >= start && to <= end) {
      if (patch === null) for (const key of keys) { if (key !== 'hyperlink') Reflect.deleteProperty(style, key) }
      else for (const key of keys) if (Object.hasOwn(patch, key)) {
        const value = patch[key]
        if (value === null || value === undefined) Reflect.deleteProperty(style, key)
        else Object.assign(style, { [key]: value })
      }
    }
    if (from >= start && to <= end && patch?.hyperlink && style.textDecoration === undefined) style.textDecoration = 'underline'
    if (Object.keys(style).length) output.push({ start: from, end: to, style })
  }
  return changed(node, node.text, normalizeDesignTextRuns(node.text, compactRuns(output)))
}

/** Canonical shaping runs exclude links and paint-only changes, and merge identical adjacent typography.
 * @param node - Current text and sparse runs.
 * @returns Only metric-affecting sparse typography, or undefined when all text uses its base typography.
 */
export function designTextMetricRuns(node: Pick<CopyOSDesignNode, 'textRuns'>): CopyOSDesignTextRun[] | undefined {
  const runs = (node.textRuns ?? []).flatMap((run) => {
    const { hyperlink: _link, fill: _fill, textDecoration: _decoration, ...style } = run.style
    return Object.keys(style).length ? [{ ...run, style: { ...style,
      ...(style.fontFeatures !== undefined ? { fontFeatures: normalizeDesignFontFeatures(style.fontFeatures) } : {}),
      ...(style.fontVariations !== undefined ? { fontVariations: normalizeDesignFontVariations(style.fontVariations) } : {}) } }] : []
  })
  const result = compactRuns(runs)
  return result.length ? result : undefined
}
