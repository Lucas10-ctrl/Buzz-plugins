/** Verified embedded Kiwi Hyperlink url/guid fields become explicit text-range destinations. */
import { designTextHyperlinkUrlAllowed } from './design-text-hyperlink.ts'
import { normalizeDesignTextRuns } from './design-text-runs.ts'
import type { CopyOSDesignNode, CopyOSDesignTextHyperlink, CopyOSDesignTextRun } from './types.ts'
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** Import whole-text and explicit style-table hyperlink records without guessing CMS or ambiguous encodings.
 * @param raw - Decoded record from the file's embedded schema.
 * @param base - Imported plain text and existing sparse visual styles.
 * @param ids - Imported stored-node GUID to UUID mapping.
 * @param warn - Qualified import-review sink.
 * @returns Supported merged runs; unknown destinations preserve existing visual styles and require review.
 */
export function importFigTextHyperlinks(raw: object, base: CopyOSDesignNode, ids: ReadonlyMap<string, string>,
  warn: (message: string) => void): CopyOSDesignTextRun[] | undefined {
  const target = (entry: object): CopyOSDesignTextHyperlink | undefined => {
    if (!('hyperlink' in entry)) return
    const value = entry.hyperlink
    if (!object(value) || value.cmsTarget !== undefined || value.url !== undefined && value.guid !== undefined) {
      warn('Unsupported or ambiguous text hyperlink metadata requires review'); return
    }
    if (typeof value.url === 'string' && designTextHyperlinkUrlAllowed(value.url)) {
      if (value.openInNewTab === false) warn('Text URL links open in a new tab in CopyOS; same-tab import behavior requires review')
      return { type: 'URL', value: value.url }
    }
    if (object(value.guid) && typeof value.guid.sessionID === 'number' && typeof value.guid.localID === 'number' &&
      Number.isSafeInteger(value.guid.sessionID) && Number.isSafeInteger(value.guid.localID)) {
      const id = ids.get(`${value.guid.sessionID}:${value.guid.localID}`)
      if (id) return { type: 'NODE', value: id }
    }
    warn('Unsupported, unsafe or missing text hyperlink destination requires review')
  }
  let runs = base.textRuns
  const apply = (start: number, end: number, hyperlink: CopyOSDesignTextHyperlink): void => {
    const points = [...new Set([0, base.text.length, start, end, ...(runs ?? []).flatMap(run => [run.start, run.end])])]
      .sort((left, right) => left - right)
    const output: CopyOSDesignTextRun[] = []
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index], to = points[index + 1]
      if (from === undefined || to === undefined || from === to) continue
      const source = runs?.find(run => run.start <= from && run.end >= to)?.style ?? {}
      const style = from >= start && to <= end ? { ...source, hyperlink } : source
      if (Object.keys(style).length) output.push({ start: from, end: to, style })
    }
    try { runs = normalizeDesignTextRuns(base.text, output) }
    catch { warn('Invalid hyperlink character boundaries require review; previous text runs retained') }
  }
  const whole = target(raw)
  if (whole && base.text.length) apply(0, base.text.length, whole)
  const data = 'textData' in raw && object(raw.textData) ? raw.textData : undefined
  if (data && Array.isArray(data.styleOverrideTable) && Array.isArray(data.characterStyleIDs) &&
    data.characterStyleIDs.length <= base.text.length) {
    if (data.styleOverrideTable.length > 10000 || data.characterStyleIDs.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)) {
      warn('Invalid or oversized hyperlink style identities require review'); return runs
    }
    const entries = data.styleOverrideTable.filter(object)
    if (entries.some(entry => typeof entry.styleID !== 'number' || !Number.isSafeInteger(entry.styleID) || entry.styleID < 1) ||
      new Set(entries.map(entry => entry.styleID)).size !== entries.length) {
      warn('Ambiguous hyperlink style identities require review'); return runs
    }
    const styles = new Map(entries.map(entry => [entry.styleID, entry]))
    let ranges = 0
    for (let start = 0; start < data.characterStyleIDs.length;) {
      const id: unknown = data.characterStyleIDs[start]
      let end = start + 1
      while (end < data.characterStyleIDs.length && data.characterStyleIDs[end] === id) end++
      const entry = styles.get(id), link = entry && target(entry)
      if (link) {
        if (++ranges > 1000) { warn('Hyperlink run budget exceeded; remaining links require review'); break }
        apply(start, end, link)
      }
      start = end
    }
  }
  return runs
}
