/** Content-free browser-local usage totals; no document identities or network reporting. */
export type DocsUsageEvent = 'shared' | 'exported' | 'suggestionAccepted' | 'commentPosted' | 'stopped'
/** Local baseline since storage was first initialized. Counts describe completed UI operations. */
export interface DocsUsage {
  readonly since: string
  readonly counts: Readonly<Record<DocsUsageEvent, number>>
  readonly outlines: { readonly count: number; readonly totalMs: number; readonly lastMs: number }
}
const key = 'copyos.docs.usage.v1'
const empty = (): DocsUsage => ({ since: new Date().toISOString(),
  counts: { shared: 0, exported: 0, suggestionAccepted: 0, commentPosted: 0, stopped: 0 },
  outlines: { count: 0, totalMs: 0, lastMs: 0 } })
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local document usage')
  return value as Record<string, unknown>
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid local document usage count')
  return value
}
/** Read a baseline snapshot; unavailable or malformed storage reports no baseline.
 * @returns Valid counters without document content, or null when storage cannot be read.
 */
export function readDocsUsage(): DocsUsage | null {
  try {
    const source = localStorage.getItem(key)
    if (source === null) return null
    const value = record(JSON.parse(source)), counts = record(value.counts), outlines = record(value.outlines)
    if (typeof value.since !== 'string' || !Number.isFinite(Date.parse(value.since))) throw new Error('Invalid local document usage date')
    return { since: value.since, counts: { shared: count(counts.shared), exported: count(counts.exported),
      suggestionAccepted: count(counts.suggestionAccepted), commentPosted: count(counts.commentPosted), stopped: count(counts.stopped) },
    outlines: { count: count(outlines.count), totalMs: count(outlines.totalMs), lastMs: count(outlines.lastMs) } }
  } catch (error: unknown) { console.warn('Unable to read local document usage', error); return null }
}
/** Record one completed operation or an observed semantic outline delay, without blocking the document.
 * @param event - Completed local action, or outline observation with elapsed milliseconds.
 */
export function recordDocsUsage(event: DocsUsageEvent | { readonly outlineMs: number }): void {
  try {
    const current = readDocsUsage() ?? empty()
    const next: DocsUsage = typeof event === 'string'
      ? { ...current, counts: { ...current.counts, [event]: current.counts[event] + 1 } }
      : { ...current, outlines: { count: current.outlines.count + 1,
        totalMs: current.outlines.totalMs + Math.round(event.outlineMs), lastMs: Math.round(event.outlineMs) } }
    localStorage.setItem(key, JSON.stringify(next))
  } catch (error: unknown) { console.warn('Unable to save local document usage', error) }
}
