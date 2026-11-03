/** Tab metadata shares the document's Yjs update; old documents retain one implicit main tab. */
import * as Y from 'yjs'
import { z } from 'zod'
import type { CopyOSDocTab } from './types.ts'

/** Saved tab identity and user-authored name; array order is the visible order. */
export const docTabSchema = z.object({ id: z.uuid(), title: z.string().max(200) }).strict()

/**
 * Resolve deterministic tab order from shared metadata and reject ambiguous identities.
 * @param doc - Hydrated document.
 * @returns Explicit saved tabs; an empty list denotes the legacy main tab.
 */
export function readDocTabs(doc: Y.Doc): CopyOSDocTab[] {
  const tabs = Array.from(doc.getMap<Y.Map<unknown>>('tabs').entries()).map(([id, row], index) => ({
    tab: docTabSchema.parse({ id, title: row.get('title') }),
    position: row.get('position') === undefined ? index * 1024 : z.number().parse(row.get('position')),
  })).sort((a, b) => a.position - b.position || a.tab.id.localeCompare(b.tab.id)).map(item => item.tab)
  z.array(docTabSchema).max(50).parse(tabs)
  return tabs
}

/**
 * Replace tab metadata during a history restore, retaining maps for surviving identities.
 * @param doc - Live shared document.
 * @param tabs - Snapshot tab metadata in display order.
 */
export function restoreDocTabs(doc: Y.Doc, tabs: readonly CopyOSDocTab[]): void {
  const rows = doc.getMap<Y.Map<unknown>>('tabs'), wanted = new Set(tabs.map(tab => tab.id))
  for (const id of rows.keys()) if (!wanted.has(id)) rows.delete(id)
  tabs.forEach((tab, index) => {
    let row = rows.get(tab.id)
    if (!row) { row = new Y.Map<unknown>(); rows.set(tab.id, row) }
    row.set('title', tab.title); row.set('position', index * 1024)
  })
}
