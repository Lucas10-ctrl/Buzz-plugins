/** Text-only document history: one atomic snapshot per committed content revision. */
import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { docTabSchema } from './docs-tabs.ts'
import type { CopyOSDocHistoryVersion, CopyOSDocHistoryListValue } from './types.ts'

const snapshot = z.object({
  schema: z.literal('copyos.doc.history'), version: z.literal(1),
  entry: z.object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    savedAt: z.iso.datetime(), actor: z.enum(['user', 'assistant', 'system']), name: z.string().max(120),
    sessionId: z.string().max(200).optional(), restoredFrom: z.number().int().nonnegative().optional(),
  }).strict(),
  tabs: z.array(docTabSchema).max(50).default([]),
  title: z.string().max(200),
  blocks: z.array(z.object({ tabId: z.uuid().optional(), id: z.uuid(), label: z.string().max(200), content: z.string().max(200_000),
    state: z.enum(['ready', 'pending', 'writing', 'paused', 'failed']) }).strict()).max(500),
}).strict()
function directory(root: string, docId: string): string {
  return join(root, '.copywriter', 'doc-history', z.uuid().parse(docId))
}
function file(root: string, docId: string, revision: number): string {
  return join(directory(root, docId), `${z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(revision)}.json`)
}
function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

/** History storage called only under the document repository's mutation queue. */
export class CopyOSDocHistoryStore {
  /** Publish one snapshot atomically; orphaned future revisions remain hidden until the head commits.
   * @param root - Project root.
   * @param docId - Document identity.
   * @param value - Revision content and attribution.
   */
  async put(root: string, docId: string, value: CopyOSDocHistoryVersion): Promise<void> {
    const path = file(root, docId, value.entry.revision), temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(directory(root, docId), { recursive: true })
    await writeFile(temporary, JSON.stringify(snapshot.parse({ schema: 'copyos.doc.history', version: 1, ...value })), { flag: 'wx', mode: 0o600 })
    try { await rename(temporary, path) } catch (error: unknown) { await unlink(temporary); throw error }
  }
  /** Preserve the current head when history is first opened for an older document.
   * @param root - Project root.
   * @param docId - Document identity.
   * @param value - Current head to preserve if absent.
   */
  async ensure(root: string, docId: string, value: CopyOSDocHistoryVersion): Promise<void> {
    try { await this.get(root, docId, value.entry.revision) }
    catch (error: unknown) { if (!isMissing(error)) throw error; await this.put(root, docId, value) }
  }
  /** Read one validated snapshot without exposing current sharing or review state.
   * @param root - Project root.
   * @param docId - Document identity.
   * @param revision - Saved content revision.
   * @returns Saved text and timeline metadata.
   */
  async get(root: string, docId: string, revision: number): Promise<CopyOSDocHistoryVersion> {
    const value = snapshot.parse(JSON.parse(await readFile(file(root, docId, revision), 'utf8')))
    if (value.entry.revision !== revision) throw new Error('Document history revision does not match its filename')
    const { schema: _schema, version: _version, ...content } = value
    const { sessionId, restoredFrom, ...entry } = value.entry
    return { ...content, blocks: content.blocks.map(({ tabId, ...block }) => ({ ...block, ...(tabId === undefined ? {} : { tabId }) })),
      entry: { ...entry,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(restoredFrom === undefined ? {} : { restoredFrom }),
      } }
  }
  /** List a bounded page, excluding uncommitted future snapshots.
   * @param root - Project root.
   * @param docId - Document identity.
   * @param head - Latest committed content revision.
   * @param before - Optional exclusive revision cursor.
   * @returns Up to fifty timeline entries and an older-page cursor.
   */
  async list(root: string, docId: string, head: number, before?: number): Promise<CopyOSDocHistoryListValue> {
    const limit = before === undefined ? head + 1 : z.number().int().nonnegative().parse(before)
    const files = await readdir(directory(root, docId))
    const revisions = files.filter(name => /^(0|[1-9]\d*)\.json$/u.test(name)).map(name => Number(name.slice(0, -5)))
      .filter(revision => Number.isSafeInteger(revision) && revision <= head && revision < limit).sort((a, b) => b - a)
    const entries = await Promise.all(revisions.slice(0, 50).map(async revision => (await this.get(root, docId, revision)).entry))
    const last = entries.at(-1)
    return { entries, headRevision: head, ...(revisions.length > 50 && last !== undefined ? { nextBefore: last.revision } : {}) }
  }
}
