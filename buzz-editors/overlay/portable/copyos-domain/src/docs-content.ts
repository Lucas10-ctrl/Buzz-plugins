/** One shared text retains character identities across visible section boundaries. */
import * as Y from 'yjs'
import { diffChars } from 'diff'

/** Visible section content, independent of its location in the shared text. */
export interface DocContentValue {
  readonly id: string
  readonly label: string
  readonly content: string
  readonly tabId?: string
}
/** One section's current source interval in its shared text. */
export interface DocContentSpan { readonly text: Y.Text; readonly from: number; readonly to: number }
/** Source-relative location resolved independently of a removed section identity. */
export interface DocContentLocation {
  readonly blockId: string
  readonly span: DocContentSpan
  readonly range: { readonly from: number; readonly to: number }
}
type Anchor = { readonly start: string; readonly end: string }
function isAnchor(value: unknown): value is Anchor {
  return typeof value === 'object' && value !== null && 'start' in value && typeof value.start === 'string'
    && 'end' in value && typeof value.end === 'string'
}
function sectionAnchor(doc: Y.Doc, row: Y.Map<unknown>): Anchor | undefined {
  const start = row.get('start'), end = row.get('end')
  if (typeof start !== 'string' || typeof end !== 'string') return undefined
  const repair = doc.getMap<unknown>('sectionAnchorRepairs').get(String(row.get('id')))
  if (repair === undefined) return { start, end }
  if (typeof repair !== 'object' || repair === null || !('expected' in repair) || !isAnchor(repair.expected)
    || !('target' in repair) || !isAnchor(repair.target)) throw new Error('Invalid restored document section interval.')
  return repair.expected.start === start && repair.expected.end === end ? repair.target : { start, end }
}
const encode = (position: Y.RelativePosition): string => btoa(String.fromCharCode(...Y.encodeRelativePosition(position)))
const decode = (value: string): Y.RelativePosition =>
  Y.decodeRelativePosition(Uint8Array.from(atob(value), character => character.charCodeAt(0)))
function rows(doc: Y.Doc): Y.Map<unknown>[] {
  return doc.getArray<Y.Map<unknown>>('blocks').toArray().map((row, index) => ({ row,
    position: typeof row.get('position') === 'number' ? Number(row.get('position')) : index * 1024,
  })).sort((a, b) => a.position - b.position || String(a.row.get('id')).localeCompare(String(b.row.get('id')))).map(item => item.row)
}
/** Identify the shared-text representation before accepting a writer's update.
 * @param doc - Hydrated document.
 * @returns Current content generation.
 */
export function docContentVersion(doc: Y.Doc): 1 | 2 { return doc.getMap('content').get('version') === 2 ? 2 : 1 }
/** Resolve one tab's shared text without tying it to section identities.
 * @param doc - Hydrated generation-two document.
 * @param tabId - Explicit tab identity, or the implicit main tab.
 * @returns Shared text for this tab.
 */
export function docContentBody(doc: Y.Doc, tabId?: string): Y.Text {
  const main = doc.getMap('content').get('mainTab')
  return doc.getText(tabId && tabId !== main ? `body:${tabId}` : 'body')
}
/** Resolve one section's source interval, retaining legacy reads for migration.
 * @param doc - Hydrated document.
 * @param id - Stable section identity.
 * @returns Source text and absolute offsets, or undefined after section removal.
 */
export function docContentSpan(doc: Y.Doc, id: string): DocContentSpan | undefined {
  const row = doc.getArray<Y.Map<unknown>>('blocks').toArray().find(row => row.get('id') === id)
  if (!row) return undefined
  if (docContentVersion(doc) === 1) {
    const text = row.get('text')
    return text instanceof Y.Text ? { text, from: 0, to: text.length } : undefined
  }
  const anchor = sectionAnchor(doc, row),
    text = docContentBody(doc, typeof row.get('tabId') === 'string' ? String(row.get('tabId')) : undefined)
  if (!anchor) return undefined
  const from = Y.createAbsolutePositionFromRelativePosition(decode(anchor.start), doc)
  const to = Y.createAbsolutePositionFromRelativePosition(decode(anchor.end), doc)
  return from?.type === text && to?.type === text && to.index >= from.index
    ? { text, from: from.index, to: to.index } : undefined
}
/** Read section Markdown without copying its characters into another shared text.
 * @param doc - Hydrated document.
 * @param id - Stable section identity.
 * @returns Current source, or undefined for an absent section.
 */
export function docContentSource(doc: Y.Doc, id: string): string | undefined {
  const span = docContentSpan(doc, id)
  return span?.text.toJSON().slice(span.from, span.to)
}
/** Capture a source-relative passage in the underlying shared text.
 * @param span - Section source interval.
 * @param from - Section-relative start.
 * @param to - Section-relative end.
 * @returns Encoded shared-text anchors.
 */
export function docContentAnchor(span: DocContentSpan, from: number, to: number): Anchor {
  if (from < 0 || to < from || span.from + to > span.to) throw new Error('Document passage is outside its section.')
  return { start: encode(Y.createRelativePositionFromTypeIndex(span.text, span.from + from)),
    end: encode(Y.createRelativePositionFromTypeIndex(span.text, span.from + to, from === to ? 0 : -1)) }
}
/** Resolve a passage after section joins without searching for repeated text.
 * @param doc - Hydrated document.
 * @param id - Original or last projected section identity.
 * @param anchor - Shared passage boundaries.
 * @returns Current section and section-relative source offsets, or undefined for removed text.
 */
export function docContentLocation(doc: Y.Doc, id: string, anchor: Anchor): DocContentLocation | undefined {
  const candidates = rows(doc).map(row => ({ blockId: String(row.get('id')), span: docContentSpan(doc, String(row.get('id'))) }))
  let from: Y.AbsolutePosition | null, to: Y.AbsolutePosition | null
  try {
    from = Y.createAbsolutePositionFromRelativePosition(decode(anchor.start), doc)
    to = Y.createAbsolutePositionFromRelativePosition(decode(anchor.end), doc)
  } catch (_error) { return undefined /* Malformed imported anchors remain detached. */ }
  if (!from || !to || from.type !== to.type || to.index < from.index) return undefined
  if (docContentVersion(doc) === 2 && !candidates.some(item => item.span?.text === from.type)) return undefined
  const match = candidates.find(item => item.blockId === id && item.span?.text === from.type
    && item.span.from <= from.index && item.span.to >= to.index)
    ?? candidates.find(item => item.span?.text === from.type && item.span.from <= from.index && item.span.to >= to.index)
  return match?.span ? { blockId: match.blockId, span: match.span,
    range: { from: from.index - match.span.from, to: to.index - match.span.from } } : undefined
}
/** Resolve every visible section intersected by a passage in one tab's shared text.
 * @param doc - Hydrated document.
 * @param anchor - Relative start and end of the complete passage.
 * @returns Ordered section-relative intersections, excluding removed text and section separators.
 */
export function docContentLocations(doc: Y.Doc, anchor: Anchor): readonly DocContentLocation[] {
  let from: Y.AbsolutePosition | null, to: Y.AbsolutePosition | null
  try {
    from = Y.createAbsolutePositionFromRelativePosition(decode(anchor.start), doc)
    to = Y.createAbsolutePositionFromRelativePosition(decode(anchor.end), doc)
  } catch (_error) { return [] /* Invalid imported anchors remain detached. */ }
  if (!from || !to || from.type !== to.type || to.index < from.index) return []
  const start = from, end = to
  return rows(doc).flatMap((row) => {
    const blockId = String(row.get('id')), span = docContentSpan(doc, blockId)
    if (!span || span.text !== start.type) return []
    const left = Math.max(span.from, start.index), right = Math.min(span.to, end.index)
    return right > left ? [{ blockId, span, range: { from: left - span.from, to: right - span.from } }] : []
  })
}
function set(row: Y.Map<unknown>, key: string, value: unknown): void { if (row.get(key) !== value) row.set(key, value) }
function replace(text: Y.Text, value: string): void {
  const before = text.toJSON()
  if (before === value) return
  if (!before) { text.insert(0, value); return }
  if (!value) { text.delete(0, text.length); return }
  const changes = diffChars(before, value, { timeout: 100 })
  if (!changes) throw new Error('This document edit is too complex to merge. Apply it in smaller parts.')
  let offset = 0
  for (const change of changes) {
    if (change.removed) text.delete(offset, change.value.length)
    else if (change.added) { text.insert(offset, change.value); offset += change.value.length }
    else offset += change.value.length
  }
}
/** Initialize one body from legacy section texts before publishing generation two.
 * @param doc - Legacy document; callers capture old anchor offsets before initialization.
 * @param mainTabId - Document identity used by the implicit main tab.
 */
export function initializeDocContent(doc: Y.Doc, mainTabId: string): void {
  if (docContentVersion(doc) === 2) return
  const values = rows(doc).map((row) => {
    const text = row.get('text')
    if (!(text instanceof Y.Text)) throw new Error('Missing legacy document section text.')
    return { id: String(row.get('id')), label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '', content: text.toJSON(),
      ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}) }
  })
  doc.getMap('content').set('version', 2)
  doc.getMap('content').set('mainTab', mainTabId)
  writeDocContent(doc, values)
}
/** Apply page source edits while retaining unchanged character identities across sections.
 * @param doc - Generation-two document.
 * @param values - Complete ordered sections, including untouched tabs.
 */
export function writeDocContent(doc: Y.Doc, values: readonly DocContentValue[]): void {
  if (docContentVersion(doc) !== 2) throw new Error('Initialize shared document content before editing it.')
  const groups = new Map<Y.Text, DocContentValue[]>()
  for (const value of values) {
    const body = docContentBody(doc, value.tabId), group = groups.get(body) ?? []
    group.push(value); groups.set(body, group)
  }
  const array = doc.getArray<Y.Map<unknown>>('blocks'), existing = new Map(rows(doc).map(row => [String(row.get('id')), row]))
  for (const [body, group] of groups) replace(body, group.map(value => value.content).join('\n\n'))

  const wanted = new Set(values.map(value => value.id))
  for (let index = array.length - 1; index >= 0; index--) if (!wanted.has(String(array.get(index).get('id')))) array.delete(index, 1)
  const offsets = new Map<Y.Text, number>()
  values.forEach((value, index) => {
    const body = docContentBody(doc, value.tabId), offset = offsets.get(body) ?? 0
    let row = existing.get(value.id)
    if (!row) { row = new Y.Map(); row.set('id', value.id); array.push([row]) }
    set(row, 'label', value.label); set(row, 'position', index * 1024)
    if (value.tabId !== undefined) set(row, 'tabId', value.tabId)
    else if (row.has('tabId')) row.delete('tabId')
    set(row, 'start', encode(Y.createRelativePositionFromTypeIndex(body, offset, -1)))
    set(row, 'end', encode(Y.createRelativePositionFromTypeIndex(body, offset + value.content.length)))
    offsets.set(body, offset + value.content.length + 2)
    if (row.has('text')) row.delete('text')
  })
}
/** Replace one section without rebuilding unrelated section text.
 * @param doc - Hydrated document.
 * @param id - Stable section identity.
 * @param value - New Markdown source.
 */
export function replaceDocSection(doc: Y.Doc, id: string, value: string): void {
  const span = docContentSpan(doc, id)
  if (!span) throw new Error('Missing document section text.')
  if (docContentVersion(doc) === 1) { replace(span.text, value); return }
  writeDocContent(doc, rows(doc).map(row => ({ id: String(row.get('id')), label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '',
    content: row.get('id') === id ? value : docContentSource(doc, String(row.get('id'))) ?? '',
    ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}) })))
}

/** Persist canonical section intervals after local Undo/Redo recreates separator characters.
 * @param doc - Local generation-two document, before publishing its next update.
 */
export function canonicalizeDocContent(doc: Y.Doc): void {
  const repairs = doc.getMap<unknown>('sectionAnchorRepairs')
  doc.transact(() => {
    for (const row of rows(doc)) {
      const span = docContentSpan(doc, String(row.get('id'))), start = row.get('start'), end = row.get('end')
      if (!span || typeof start !== 'string' || typeof end !== 'string') continue
      const target = { start: encode(Y.createRelativePositionFromTypeIndex(span.text, span.from, -1)),
        end: encode(Y.createRelativePositionFromTypeIndex(span.text, span.to)) }
      if (start === target.start && end === target.end) continue
      const value = { expected: { start, end }, target }, id = String(row.get('id'))
      if (JSON.stringify(repairs.get(id)) !== JSON.stringify(value)) repairs.set(id, value)
    }
  })
}
