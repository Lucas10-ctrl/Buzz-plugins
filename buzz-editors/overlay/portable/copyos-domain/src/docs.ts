import { docTabSchema, readDocTabs, restoreDocTabs } from './docs-tabs.ts'
import type { CopyOSDocTabCreateRequest } from './types.ts'
import { renderDocWord } from './docs-word.ts'
import { docsChartsToMarkdown } from './docs-chart-markdown.ts'
import { assertAssistantStrategyEdit } from './docs-strategy.ts'
/** Suite Docs: atomic portable storage, Yjs text merging and epoch-fenced agent actions. */
import { zipSync } from 'fflate'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import * as Y from 'yjs'
import { z } from 'zod'
import { docAssetSchema, docAssetReferences, projectDocAsset, storeDocAsset, readDocAsset } from './docs-assets.ts'
import type { CopyOSDocImportRequest, CopyOSDocAsset, CopyOSDocAssetPutRequest, CopyOSDocAssetReadRequest, CopyOSDocAssetReadValue } from './types.ts'
import { renderDocPdf } from './docs-pdf.ts'
import { docContentSpan, docContentSource, docContentAnchor, docContentLocation, initializeDocContent,
  writeDocContent, replaceDocSection } from './docs-content.ts'
import { docCommentSchema, docCommentActor, validateDocCommentMoves, docCommentTarget, projectDocComments, applyDocComment, replyDocComment } from './docs-comments.ts'
import type { CopyOSDocCommentRequest, CopyOSDocCommentReplyRequest } from './types.ts'
import { CopyOSDocHistoryStore } from './docs-history.ts'
import { isBlankDocForOutline } from './docs-request.ts'
import type {
  CopyOSDocPresenceRequest, CopyOSDocPresenceValue, CopyOSDocPresencePeer,
  CopyOSDocDocument,
  CopyOSDocCreateRequest,
  CopyOSDocReadRequest, CopyOSDocDuplicateRequest, CopyOSDocTrashRequest,
  CopyOSDocExportValue,
  CopyOSDocSuggestRequest,
  CopyOSDocReviewRequest, CopyOSDocHistoryVersion, CopyOSDocHistoryEntry, CopyOSDocHistoryListRequest,
  CopyOSDocHistoryListValue, CopyOSDocHistoryReadRequest, CopyOSDocHistoryReadValue, CopyOSDocHistoryNameRequest, CopyOSDocRestoreRequest,
} from './types.ts'

const block = z
  .object({
    id: z.uuid(),
    tabId: z.uuid().optional(),
    label: z.string().max(200),
    content: z.string().max(200_000),
    state: z.enum(['ready', 'pending', 'writing', 'paused', 'failed']),
  })
  .strict()
const suggestion = z
  .object({
    id: z.uuid(),
    blockId: z.uuid(),
    threadId: z.uuid().optional(),
    before: z.string().max(200_000),
    after: z.string().max(200_000),
    note: z.string().max(2000),
    state: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: z.iso.datetime(),
    reviewedAt: z.iso.datetime().optional(),
    anchorStart: z.string(),
    anchorEnd: z.string(),
  })
  .strict()
const recordSchema = z
  .object({
    sessionId: z.string().max(200).optional(),
    schema: z.literal('copyos.doc'),
    version: z.union([z.literal(1), z.literal(2)]),
    trashedAt: z.iso.datetime().optional(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    id: z.uuid(),
    title: z.string().max(200),
    blocks: z.array(block).max(500),
    tabs: z.array(docTabSchema).max(50).default([]),
    sync: z.string().max(8_000_000),
    epoch: z.number().int().nonnegative(),
    stopped: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    assets: z.array(docAssetSchema).max(64).default([]),
    comments: z.array(docCommentSchema).max(500).default([]),
    suggestions: z.array(suggestion).max(1000).default([]),
    links: z.array(z.object({ hash: z.string(), role: z.enum(['viewer', 'commenter', 'editor']) })).max(100),
  })
  .strict()
const upgradedRecord = Symbol('upgraded-doc-content')
type Record = z.infer<typeof recordSchema> & { readonly [upgradedRecord]?: true }
const history = new CopyOSDocHistoryStore()
const queues = new Map<string, Promise<unknown>>()
const sha = (token: string): string => createHash('sha256').update(token).digest('hex')

async function serial<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  queues.set(path, next)
  try {
    return await next
  } finally {
    if (queues.get(path) === next) queues.delete(path)
  }
}
function pathFor(root: string, id: string): string {
  return join(root, 'docs', `${z.uuid().parse(id)}.doc.json`)
}
function hydrate(record: Record): Y.Doc {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(record.sync, 'base64'))
    return doc
  } catch (error) {
    doc.destroy()
    throw error
  }
}
function refresh(record: Record, doc: Y.Doc): void {
  initializeDocContent(doc, record.id)
  record.version = 2
  const missing = doc.getArray<Y.Map<unknown>>('blocks').toArray().some(row => !docContentSpan(doc, String(row.get('id'))))
  if (missing) {
    const values = doc.getArray<Y.Map<unknown>>('blocks').toArray().map((row, index) => ({ row,
      position: typeof row.get('position') === 'number' ? Number(row.get('position')) : index * 1024,
    })).sort((a, b) => a.position - b.position).map(({ row }) => {
      const old = row.get('text')
      return { id: String(row.get('id')), label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '',
        content: docContentSource(doc, String(row.get('id'))) ?? (old instanceof Y.Text ? old.toJSON() : ''),
        ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}) }
    })
    writeDocContent(doc, values)
  }
  record.title = doc.getText('title').toJSON()
  record.tabs = readDocTabs(doc)
  const rows = doc
    .getArray<Y.Map<unknown>>('blocks')
    .toArray()
    .map((row, index) => ({
      row,
      position: row.get('position') === undefined ? index * 1024 : z.number().parse(row.get('position')),
    }))
    .sort((a, b) => a.position - b.position || String(a.row.get('id')).localeCompare(String(b.row.get('id'))))
    .map(item => item.row)
  const old = new Map(record.blocks.map(b => [b.id, b]))
  record.blocks = rows.map((row) => {
    const id = z.uuid().parse(row.get('id')), content = docContentSource(doc, id)
    if (content === undefined) throw new Error('Document block text is invalid')
    return {
      id,
      ...(row.get('tabId') === undefined ? {} : { tabId: z.uuid().parse(row.get('tabId')) }),
      label: z.string().max(200).parse(row.get('label')),
      content,
      state: old.get(id)?.state ?? 'ready',
    }
  })
  if (new Set(record.blocks.map(b => b.id)).size !== record.blocks.length)
    throw new Error('Duplicate document block identity')
  const tabIds = new Set(record.tabs.length ? record.tabs.map(tab => tab.id) : [record.id])
  if (record.blocks.some(block => !tabIds.has(block.tabId ?? record.id))) throw new Error('Document block refers to a missing tab')
  record.sync = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  recordSchema.parse(record)
}
function projection(record: Record, role: 'owner' | 'viewer' | 'commenter' | 'editor' = 'owner', actor = 'owner'): CopyOSDocDocument {
  const { links: _links, schema: _schema, version: _version, sessionId, trashedAt, suggestions, comments, assets, ...value } = record
  const referenced = docAssetReferences(record.blocks.map(block => block.content).join('\n'))
  const doc = comments.length || suggestions.length ? hydrate(record) : null
  let publicComments: NonNullable<CopyOSDocDocument['comments']> = []
  let publicSuggestions: NonNullable<CopyOSDocDocument['suggestions']> = []
  try {
    if (doc) {
      publicComments = projectDocComments(comments, doc, actor, role === 'owner')
      publicSuggestions = suggestions.map(({ anchorStart, anchorEnd, reviewedAt, threadId, ...item }) => {
        const origin = { blockId: item.blockId, section: false, anchor: { start: anchorStart, end: anchorEnd } }
        const source = { id: item.id, ...origin }, target = docCommentTarget(doc, source, 'suggestion')
        return { ...item, blockId: target.blockId, anchor: target.anchor,
          ...(target === source ? {} : { anchorOrigin: origin }),
          ...(threadId === undefined ? {} : { threadId }),
          ...(reviewedAt === undefined ? {} : { reviewedAt }) }
      })
    }
  }
  finally { doc?.destroy() }
  return {
    ...value,
    blocks: record.blocks.map(({ tabId, ...block }) => ({ ...block, ...(tabId === undefined ? {} : { tabId }) })),
    tabs: record.tabs.length ? record.tabs : [{ id: record.id, title: '' }],
    ...(trashedAt === undefined ? {} : { trashedAt }),
    assets: assets.filter(asset => referenced.has(asset.id)).map(projectDocAsset),
    comments: publicComments,
    access: role,
    suggestions: publicSuggestions,
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

function access(record: Record, token: string | undefined, edit = false): 'owner' | 'viewer' | 'commenter' | 'editor' {
  if (record.trashedAt !== undefined && (token !== undefined || edit)) throw new Error('This document is in Trash. Restore it before making changes.')
  if (token === undefined) return 'owner' // The owning CopyOS host connection is authenticated by the gateway.
  const link = record.links.find(link => link.hash === sha(token))
  if (!link || (edit && link.role !== 'editor'))
    throw new Error('This document link does not grant access to this action')
  return link.role
}
async function read(path: string): Promise<Record> {
  const raw = await readFile(path, 'utf8'), record = recordSchema.parse(JSON.parse(raw))
  if (record.version === 2) return record
  const folder = join(path, '..', '..', '.copywriter', 'doc-format-backups', record.id)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  try { await writeFile(join(folder, `${sha(raw)}.v1.json`), raw, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
  const doc = hydrate(record)
  try {
    const comments = record.comments.map((thread) => {
      const target = docCommentTarget(doc, thread), location = docContentLocation(doc, target.blockId, target.anchor)
      return { thread, target, location }
    })
    const proposals = record.suggestions.map((item) => {
      const target = docCommentTarget(doc, { id: item.id, blockId: item.blockId, section: false,
        anchor: { start: item.anchorStart, end: item.anchorEnd } }, 'suggestion')
      return { item, location: docContentLocation(doc, target.blockId, target.anchor) }
    })
    initializeDocContent(doc, record.id)
    for (const { thread, target, location } of comments) {
      const span = location && docContentSpan(doc, location.blockId)
      if (!span) continue
      thread.blockId = location.blockId; thread.section = target.section
      thread.anchor = docContentAnchor(span, location.range.from, location.range.to)
    }
    for (const { item, location } of proposals) {
      const span = location && docContentSpan(doc, location.blockId)
      if (!span) continue
      const anchor = docContentAnchor(span, location.range.from, location.range.to)
      item.blockId = location.blockId; item.anchorStart = anchor.start; item.anchorEnd = anchor.end
    }
    for (const kind of ['comment', 'suggestion']) {
      doc.getMap(`${kind}AnchorMoves`).clear(); doc.getMap(`${kind}AnchorRepairs`).clear()
    }
    refresh(record, doc)
    Object.defineProperty(record, upgradedRecord, { value: true })
    return record
  } finally { doc.destroy() }
}
type Attribution = Pick<CopyOSDocHistoryEntry, 'actor'> & Partial<Pick<CopyOSDocHistoryEntry, 'sessionId' | 'restoredFrom'>>
function historical(record: Record, attribution: Attribution = { actor: 'system' }): CopyOSDocHistoryVersion {
  return { entry: { revision: record.revision, savedAt: record.updatedAt, name: '', ...attribution },
    title: record.title, tabs: record.tabs,
    blocks: record.blocks.map(({ tabId, ...block }) => ({ ...block, ...(tabId === undefined ? {} : { tabId }) })) }
}
function contentKey(record: Record): string { return JSON.stringify([record.title, record.tabs, record.blocks]) }
async function save(path: string, record: Record, attribution: Attribution = { actor: 'user' }): Promise<void> {
  let previous: Record | undefined
  try { previous = await read(path) }
  catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  const root = join(path, '..', '..')
  const changed = attribution.restoredFrom !== undefined || previous === undefined || contentKey(previous) !== contentKey(record)
  if (changed && previous !== undefined) await history.ensure(root, record.id, historical(previous))
  if (!(record[upgradedRecord] && attribution.actor === 'system' && !changed)) record.updatedAt = new Date().toISOString()
  record.revision = (previous?.revision ?? 0) + (changed ? 1 : 0)
  if (changed) await history.put(root, record.id, historical(record, attribution))
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(recordSchema.parse(record)), { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) }
  catch (error: unknown) { await unlink(temporary); throw error }
}
function replaceText(text: Y.Text, value: string): void {
  const old = text.toJSON()
  let start = 0, end = 0
  while (start < old.length && start < value.length && old[start] === value[start]) start++
  while (end < old.length - start && end < value.length - start && old[old.length - 1 - end] === value[value.length - 1 - end]) end++
  if (old.length - start - end > 0) text.delete(start, old.length - start - end)
  if (value.length - start - end > 0) text.insert(start, value.slice(start, value.length - end))
}

/** Named document actions shared by the authenticated browser and scoped agent tools. */
export class CopyOSDocRepository {
  private readonly presenceRooms = new Map<string, Map<string, { peer: CopyOSDocPresencePeer; actor: string }>>()
  /** Exchange short-lived pane presence after checking current document access; nothing is persisted.
   * @param root - Registered project root.
   * @param input - Pane identity and tab/cursor, or null state to leave.
   * @returns Other authorized panes active in the last twenty seconds.
   */
  async presence(root: string, input: Omit<CopyOSDocPresenceRequest, 'workspaceId'>): Promise<CopyOSDocPresenceValue> {
    const anchor = z.object({ start: z.string().min(4).max(2048), end: z.string().min(4).max(2048) }).strict()
    const request = z.object({ docId: z.uuid(), token: z.string().max(200).optional(), peerId: z.uuid(),
      state: z.object({ tabId: z.uuid(), cursor: z.object({ blockId: z.uuid(), anchor }).strict().optional() }).strict().nullable(),
    }).strict().parse(input)
    const path = pathFor(root, request.docId), record = await read(path), role = access(record, request.token)
    if (record.trashedAt !== undefined) throw new Error('Restore this document before joining its presence room.')
    const now = Date.now(), actor = request.token === undefined ? 'owner' : sha(request.token)
    const allowed = new Set(['owner', ...record.links.map(link => link.hash)])
    for (const [key, peers] of this.presenceRooms) {
      for (const [id, value] of peers) {
        if (now - value.peer.seenAt >= 20_000 || (key === path && !allowed.has(value.actor))) peers.delete(id)
      }
      if (!peers.size) this.presenceRooms.delete(key)
    }
    let room = this.presenceRooms.get(path)
    const previous = room?.get(request.peerId)
    if (previous && previous.actor !== actor) throw new Error('This pane identity belongs to another document reader.')
    if (request.state === null) room?.delete(request.peerId)
    else {
      const tabs = record.tabs.length ? record.tabs : [{ id: record.id }]
      if (!tabs.some(tab => tab.id === request.state?.tabId)) throw new Error('This presence tab no longer exists.')
      const cursor = request.state.cursor
      if (cursor) {
        const block = record.blocks.find(block => block.id === cursor.blockId)
        if (!block || (block.tabId ?? record.id) !== request.state.tabId) throw new Error('This cursor block is not in the current tab.')
        for (const encoded of [cursor.anchor.start, cursor.anchor.end]) {
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
            throw new Error('Invalid document cursor anchor.')
          try { Y.decodeRelativePosition(Buffer.from(encoded, 'base64')) }
          catch { throw new Error('Invalid document cursor anchor.') }
        }
      }
      if (!room) {
        if (this.presenceRooms.size >= 256) throw new Error('Live presence is busy. Try again shortly.')
        room = new Map(); this.presenceRooms.set(path, room)
      }
      if (!previous && room.size >= 64) throw new Error('This document has reached its live presence limit.')
      room.set(request.peerId, { actor, peer: { id: request.peerId, role, seenAt: now,
        tabId: request.state.tabId, ...(cursor ? { cursor } : {}) } })
    }
    const tabIds = new Set(record.tabs.length ? record.tabs.map(tab => tab.id) : [record.id])
    const doc = hydrate(record)
    try {
      return { peers: Array.from(room?.values() ?? []).flatMap(({ peer }) => {
        if (peer.id === request.peerId || !tabIds.has(peer.tabId)) return []
        const { cursor, ...rest } = peer
        const location = cursor ? docContentLocation(doc, cursor.blockId, cursor.anchor) : undefined
        const block = record.blocks.find(block => block.id === location?.blockId && (block.tabId ?? record.id) === peer.tabId)
        return [{ ...rest, ...(cursor && block ? { cursor: { ...cursor, blockId: block.id } } : {}) }]
      }).sort((a, b) => a.id.localeCompare(b.id)) }
    } finally { doc.destroy() }
  }

  /** List document projections without disclosing link capabilities.
   * @param root - Project root.
   * @param trashed - Select recoverable trash rather than active documents.
   * @returns Saved documents.
   */
  async list(root: string, trashed = false): Promise<readonly CopyOSDocDocument[]> {
    await mkdir(join(root, 'docs'), { recursive: true })
    const files = (await readdir(join(root, 'docs'))).filter(f => /^[a-f0-9-]+\.doc\.json$/u.test(f))
    const records = await Promise.all(files.map((file) => {
      const path = join(root, 'docs', file)
      return serial(path, async () => {
        const record = await read(path)
        if (record[upgradedRecord]) await save(path, record, { actor: 'system' })
        return record
      })
    }))
    const desired = z.boolean().parse(trashed)
    return records.filter(record => (record.trashedAt !== undefined) === desired)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(record => projection(record))
  }
  /** Read one validated document.
   * @param root - Project root.
   * @param request - Document and optional capability.
   * @returns Document projection.
   */
  async get(root: string, request: Omit<CopyOSDocReadRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    const path = pathFor(root, request.docId)
    return serial(path, async () => {
      const record = await read(path), role = access(record, request.token)
      if (record[upgradedRecord]) await save(path, record, { actor: 'system' })
      return projection(record, role, docCommentActor(request.token))
    })
  }
  /** Persist the outline in one commit before any section writing.
   * @param root - Project root.
   * @param input - Title and planned sections.
   * @param initialContent - Validated import body, allowed only without outline placeholders.
   * @returns Saved outline or imported document.
   */
  async create(root: string, input: Omit<CopyOSDocCreateRequest, 'workspaceId'>, initialContent?: string): Promise<CopyOSDocDocument> {
    const request = z
      .object({
        sessionId: z.string().max(200).optional(),
        title: z.string().trim().min(1).max(200),
        sections: z.array(z.string().trim().min(1).max(200)).max(100),
      })
      .parse(input)
    const initial = initialContent === undefined ? '' : z.string().max(200_000).parse(initialContent)
    if (initialContent !== undefined && request.sections.length) throw new Error('Imported content cannot use outline placeholders.')
    const doc = new Y.Doc(),
      now = new Date().toISOString()
    const record: Record = {
      schema: 'copyos.doc',
      version: 1,
      revision: 0,
      id: randomUUID(),
      title: request.title,
      blocks: [],
      tabs: [],
      sync: '',
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      epoch: 0,
      stopped: false,
      links: [],
      suggestions: [],
      assets: [],
      comments: [],
      createdAt: now,
      updatedAt: now,
    }
    try {
      doc.getText('title').insert(0, request.title)
      for (const label of request.sections.length ? request.sections : ['']) {
        const row = new Y.Map<unknown>(),
          id = randomUUID()
        row.set('id', id)
        row.set('label', label)
        row.set('text', new Y.Text(initial))
        doc.getArray<Y.Map<unknown>>('blocks').push([row])
        record.blocks.push({ id, label, content: initial, state: label ? 'pending' : 'ready' })
      }
      refresh(record, doc)
      await mkdir(join(root, 'docs'), { recursive: true })
      await save(pathFor(root, record.id), record, request.sessionId === undefined ? { actor: 'user' } : { actor: 'assistant', sessionId: request.sessionId })
      return projection(record)
    } finally {
      doc.destroy()
    }
  }
  /** Import bounded UTF-8 Markdown or text in the initial atomic document commit.
   * @param root - Registered project root.
   * @param request - Filename and encoded file content.
   * @returns A private ready-to-edit document, without copying link capabilities.
   */
  async import(root: string, request: Omit<CopyOSDocImportRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    const name = z.string().min(1).max(200).regex(/\.(?:md|markdown|txt)$/iu).parse(request.name)
    const encoded = z.string().max(266_668)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u).parse(request.dataBase64)
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length > 200_000) throw new Error('Imported documents must be 200 KB or smaller.')
    let body = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '')
    let title = name.replace(/^.*[\\/]/u, '').replace(/\.(?:md|markdown|txt)$/iu, '').trim() || 'Imported document'
    if (/\.(?:md|markdown)$/iu.test(name)) {
      const heading = /^# ([^\r\n]+)(?:\r?\n|$)/u.exec(body)
      if (heading) {
        title = (heading[1] ?? title).replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').replace(/[*_`]/gu, '').trim() || title
        body = body.slice(heading[0].length).replace(/^\r?\n/u, '')
      }
    } else body = body.replace(/[\\`*_{}[\]()#+\-.!>|]/gu, '\\$&')
    return this.create(root, { title: title.slice(0, 200), sections: [] }, body)
  }
  /** Copy the saved body into a fresh private document; discussion and history stay with the source.
   * @param root - Project root.
   * @param request - Source document and localized copy title.
   * @returns Independent copy with new document and block identities.
   */
  async duplicate(root: string, request: Omit<CopyOSDocDuplicateRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    if (request.token !== undefined) throw new Error('Only the document owner can duplicate a document')
    return serial(pathFor(root, request.docId), async () => {
      const source = await read(pathFor(root, request.docId))
      access(source, undefined, true)
      const title = z.string().trim().min(1).max(200).parse(request.title)
      const referenced = docAssetReferences(source.blocks.map(block => block.content).join('\n'))
      const doc = new Y.Doc(), now = new Date().toISOString()
      const copy: Record = {
        schema: 'copyos.doc', version: 1, revision: 0, id: randomUUID(), title, blocks: [], tabs: [], sync: '', epoch: 0,
        stopped: true, links: [], suggestions: [], comments: [], assets: source.assets.filter(asset => referenced.has(asset.id)),
        createdAt: now, updatedAt: now,
      }
      try {
        doc.getText('title').insert(0, title)
        const tabIds = new Map(source.tabs.map(tab => [tab.id, tab.id === source.id ? copy.id : randomUUID()]))
        restoreDocTabs(doc, source.tabs.map(tab => ({ ...tab, id: tabIds.get(tab.id) ?? copy.id })))
        for (const block of source.blocks) {
          const id = randomUUID(), row = new Y.Map<unknown>()
          row.set('id', id); row.set('label', block.label); row.set('text', new Y.Text(block.content))
          if (block.tabId) row.set('tabId', tabIds.get(block.tabId))
          doc.getArray<Y.Map<unknown>>('blocks').push([row])
          copy.blocks.push({ id, label: block.label, content: block.content, state: 'ready' })
        }
        refresh(copy, doc)
        await save(pathFor(root, copy.id), copy)
        return projection(copy)
      } finally { doc.destroy() }
    })
  }
  /** Fill an existing blank document with an outline, fencing earlier requests and retaining its identity.
   * @param root - Authorized project root.
   * @param request - Current human-authorized empty section and epoch, ordered headings and actual Session attribution.
   * @returns Saved outline; changed content, discussion, tabs or writing epoch reject without saving. A changed title is retained.
   */
  async outline(root: string, request: {
    docId: string
    blockId: string
    epoch: number
    sections: readonly string[]
    sessionId: string
    title?: { before: string; after: string }
  }): Promise<CopyOSDocDocument> {
    const input = z.object({ docId: z.uuid(), blockId: z.uuid(), epoch: z.number().int().nonnegative(),
      sections: z.array(z.string().trim().min(1).max(200)).min(1).max(100), sessionId: z.string().min(1).max(200),
      title: z.object({ before: z.string().max(200), after: z.string().trim().min(1).max(200) }).optional() }).parse(request)
    return serial(pathFor(root, input.docId), async () => {
      const path = pathFor(root, input.docId), record = await read(path)
      access(record, undefined, true)
      if (record.stopped || record.epoch !== input.epoch || !isBlankDocForOutline(record) || record.blocks[0]?.id !== input.blockId)
        throw new Error('This page is no longer blank or its writing request changed. Read it again and propose edits without replacing existing work.')
      const doc = hydrate(record)
      try {
        const tabId = record.blocks[0].tabId
        const blocks = input.sections.map((label, index) => ({ id: index === 0 ? input.blockId : randomUUID(), label,
          content: '', state: 'pending' as const, ...(tabId === undefined ? {} : { tabId }) }))
        if (input.title && record.title === input.title.before) {
          const title = doc.getText('title'); title.delete(0, title.length); title.insert(0, input.title.after)
        }
        record.blocks = blocks; record.epoch++; record.sessionId ??= input.sessionId
        writeDocContent(doc, blocks)
        refresh(record, doc)
        await save(path, record, { actor: 'assistant', sessionId: input.sessionId })
        return projection(record)
      } finally { doc.destroy() }
    })
  }
  /** Move a document, its history and its attachments to another workspace, keeping its identity.
   * @param root - Source project root.
   * @param targetRoot - Destination project root.
   * @param request - Owner request naming the document.
   * @returns The document as saved in the destination; pending assistant work is fenced as for Trash.
   */
  async move(root: string, targetRoot: string, request: { docId: string; token?: string }): Promise<CopyOSDocDocument> {
    if (request.token !== undefined) throw new Error('Only the document owner can move a document')
    if (root === targetRoot) throw new Error('This document is already in that workspace.')
    const source = pathFor(root, request.docId), target = pathFor(targetRoot, request.docId)
    return serial(source, () => serial(target, async () => {
      let record: Record
      try { record = await read(source) }
      catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('This document is not in the current workspace.')
        throw error
      }
      try { await readFile(target); throw new Error('A document with this identity already exists in that workspace.') }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      record.epoch++; record.stopped = true
      for (const block of record.blocks) if (block.state === 'writing' || block.state === 'pending') block.state = 'paused'
      for (const thread of record.comments) if (thread.assistant?.state === 'pending') thread.assistant.state = 'cancelled'
      // Attachments are content-addressed and may be shared, so copy them and leave the source files.
      for (const asset of record.assets) {
        const name = asset.imageRef ? asset.imageRef.slice('copyos-asset:'.length) : asset.id
        const folder = asset.imageRef ? join('assets', 'images') : join('docs', 'files')
        await mkdir(join(targetRoot, folder), { recursive: true })
        try { await cp(join(root, folder, name), join(targetRoot, folder, name), { force: false, errorOnExist: false }) }
        catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      }
      const historyFrom = join(root, '.copywriter', 'doc-history', record.id)
      const historyTo = join(targetRoot, '.copywriter', 'doc-history', record.id)
      await mkdir(join(targetRoot, '.copywriter', 'doc-history'), { recursive: true, mode: 0o700 })
      try { await cp(historyFrom, historyTo, { recursive: true, force: false, errorOnExist: false }) }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      await mkdir(join(targetRoot, 'docs'), { recursive: true })
      const temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(recordSchema.parse(record)), { flag: 'wx', mode: 0o600 })
      try { await rename(temporary, target) }
      catch (error: unknown) { await unlink(temporary); throw error }
      await unlink(source)
      await rm(historyFrom, { recursive: true, force: true })
      this.presenceRooms.delete(source)
      return projection(record)
    }))
  }
  /** Change recoverable trash state, fencing pending assistant work while retaining document data.
   * @param root - Project root.
   * @param request - Owner request and desired trash state.
   * @returns Saved document; repeating the same state is a no-op.
   */
  async trash(root: string, request: Omit<CopyOSDocTrashRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    if (request.token !== undefined) throw new Error('Only the document owner can manage Trash')
    const trashed = z.boolean().parse(request.trashed)
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), record = await read(path)
      if ((record.trashedAt !== undefined) === trashed) return projection(record)
      if (trashed) {
        record.trashedAt = new Date().toISOString()
        record.epoch++; record.stopped = true
        for (const block of record.blocks) if (block.state === 'writing' || block.state === 'pending') block.state = 'paused'
        for (const thread of record.comments) if (thread.assistant?.state === 'pending') thread.assistant.state = 'cancelled'
      } else delete record.trashedAt
      await save(path, record)
      return projection(record)
    })
  }
  /** Add a tab outline atomically while preserving existing text and shared discussion.
   * @param root - Authorized project root.
   * @param input - Current epoch, tab name and planned section labels.
   * @returns Saved document with the new tab and its placeholders.
   */
  async createTab(root: string, input: Omit<CopyOSDocTabCreateRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, input.docId), async () => {
      const path = pathFor(root, input.docId), record = await read(path), role = access(record, input.token, true)
      const request = z.object({ title: z.string().trim().min(1).max(200), sections: z.array(z.string().trim().min(1).max(200)).max(100),
        epoch: z.number().int().nonnegative() }).parse(input)
      if (record.stopped || record.epoch !== request.epoch) throw new Error('Writing stopped. Read the document again before adding a tab.')
      const doc = hydrate(record)
      try {
        const tabs = record.tabs.length ? record.tabs : [{ id: record.id, title: '' }], tabId = randomUUID()
        restoreDocTabs(doc, [...tabs, { id: tabId, title: request.title }])
        for (const label of request.sections.length ? request.sections : ['']) {
          const row = new Y.Map<unknown>()
          row.set('id', randomUUID()); row.set('tabId', tabId); row.set('label', label); row.set('text', new Y.Text())
          row.set('position', (record.blocks.length + doc.getArray('blocks').length) * 1024)
          doc.getArray<Y.Map<unknown>>('blocks').push([row])
          record.blocks.push({ id: String(row.get('id')), tabId, label, content: '', state: label ? 'pending' : 'ready' })
        }
        refresh(record, doc); await save(path, record, { actor: 'assistant',
          ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }) })
        return projection(record, role, docCommentActor(input.token))
      } finally { doc.destroy() }
    })
  }
  /** Append assistant-owned planned sections to the end of the main tab while preserving existing text and discussion.
   * @param root - Authorized project root.
   * @param request - Document, current epoch, section labels and the Session that writes them.
   * @returns Saved document with the new placeholders; a stopped document or changed epoch rejects without saving.
   */
  async appendSections(root: string, request: { docId: string; epoch: number; sections: readonly string[]; sessionId: string }):
  Promise<CopyOSDocDocument> {
    const input = z.object({ docId: z.uuid(), epoch: z.number().int().nonnegative(),
      sections: z.array(z.string().trim().min(1).max(200)).min(1).max(20), sessionId: z.string().min(1).max(200) }).parse(request)
    return serial(pathFor(root, input.docId), async () => {
      const path = pathFor(root, input.docId), record = await read(path)
      access(record, undefined, true)
      if (record.stopped || record.epoch !== input.epoch) throw new Error('Writing stopped. Read the document again before adding sections.')
      const doc = hydrate(record)
      try {
        const rows = doc.getArray<Y.Map<unknown>>('blocks')
        const last = Math.max(-1024, ...rows.toArray().map((row, index) => typeof row.get('position') === 'number' ? Number(row.get('position')) : index * 1024))
        input.sections.forEach((label, index) => {
          const row = new Y.Map<unknown>(), id = randomUUID()
          row.set('id', id); row.set('label', label); row.set('text', new Y.Text()); row.set('position', last + (index + 1) * 1024)
          rows.push([row])
          record.blocks.push({ id, label, content: '', state: 'pending' })
        })
        refresh(record, doc)
        await save(path, record, { actor: 'assistant', sessionId: input.sessionId })
        return projection(record)
      } finally { doc.destroy() }
    })
  }
  /** Store an attachment only after checking editor authority and the document's resource budget.
   * @param root - Registered project root.
   * @param request - Document, optional link capability, original name and base64 bytes.
   * @returns Public metadata for the uploaded file.
   */
  async putAsset(root: string, request: Omit<CopyOSDocAssetPutRequest, 'workspaceId'>): Promise<CopyOSDocAsset> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), record = await read(path)
      access(record, request.token, true)
      const asset = await storeDocAsset(root, request), existing = record.assets.find(value => value.id === asset.id)
      if (existing) return projectDocAsset(existing)
      if (record.assets.length >= 64) throw new Error('This document has reached its attachment limit.')
      if (record.assets.reduce((sum, value) => sum + value.size, asset.size) > 32_000_000)
        throw new Error('This document has reached its attachment size limit.')
      record.assets.push(asset)
      await save(path, record)
      return projectDocAsset(asset)
    })
  }
  /** Read verified bytes after validating the document and manifest scope.
   * @param root - Registered project root.
   * @param request - Document, optional capability and attachment hash.
   * @returns Original attachment bytes; readers cannot inspect removed or uninserted files.
   */
  async readAsset(root: string, request: Omit<CopyOSDocAssetReadRequest, 'workspaceId'>): Promise<CopyOSDocAssetReadValue> {
    const record = await read(pathFor(root, request.docId)), role = access(record, request.token)
    const asset = record.assets.find(value => value.id === request.assetId)
    const referenced = docAssetReferences(record.blocks.map(block => block.content).join('\n')).has(request.assetId)
    if (!asset || ((role === 'viewer' || role === 'commenter') && !referenced)) throw new Error('This attachment is not available in this document.')
    return { asset: projectDocAsset(asset), dataBase64: (await readDocAsset(root, asset)).toString('base64') }
  }
  /** Merge a browser update while retaining every streaming section's text, label and effective tab.
   * @param root - Project root.
   * @param request - Document, capability and Yjs delta.
   * @returns Saved projection; changes to a streaming section reject without saving.
   */
  async sync(
    root: string,
    request: Omit<CopyOSDocReadRequest, 'workspaceId'> & { update: string; contentVersion: 2 },
  ): Promise<CopyOSDocDocument> {
    const path = pathFor(root, request.docId)
    return serial(path, async () => {
      const record = await read(path)
      const role = access(record, request.token, true)
      if (!z.literal(2).safeParse(request.contentVersion).success)
        throw new Error('Reload this document before saving. Its shared editing format has changed.')
      z.string()
        .max(8_000_000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/u)
        .parse(request.update)
      const doc = hydrate(record),
        before = record.blocks.filter(b => b.state === 'writing')
      try {
        Y.applyUpdate(doc, Buffer.from(request.update, 'base64'))
        if (doc.getMap('content').get('version') !== 2 || doc.getMap('content').get('mainTab') !== record.id)
          throw new Error('Invalid shared document content metadata.')
        validateDocCommentMoves(doc, record.comments)
        validateDocCommentMoves(doc, record.suggestions.map(item => ({ id: item.id, blockId: item.blockId, section: false,
          anchor: { start: item.anchorStart, end: item.anchorEnd } })), 'suggestion')
        refresh(record, doc)
        for (const original of before) {
          const after = record.blocks.find(b => b.id === original.id)
          if (!after || after.content !== original.content || after.label !== original.label
            || (after.tabId ?? record.id) !== (original.tabId ?? record.id))
            throw new Error('The assistant is writing this section. Edit another section or stop writing first.')
        }
        await save(path, record)
        return projection(record, role, docCommentActor(request.token))
      } finally {
        doc.destroy()
      }
    })
  }
  /** Fence late writes when stopped; resume retains completed text.
   * @param root - Project root.
   * @param request - Document and stop state.
   * @returns Updated document.
   */
  async control(
    root: string,
    request: Omit<CopyOSDocReadRequest, 'workspaceId'> & { stopped: boolean },
  ): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId),
        record = await read(path)
      const role = access(record, request.token, true)
      record.epoch++
      record.stopped = request.stopped
      if (request.stopped) for (const thread of record.comments) if (thread.assistant?.state === 'pending') thread.assistant.state = 'cancelled'
      record.blocks = record.blocks.map(b => (b.state === 'writing' ? { ...b, state: 'paused' } : b))
      await save(path, record)
      return projection(record, role, docCommentActor(request.token))
    })
  }
  /** Append one agent chunk to a placeholder without replacing human text.
   * @param root - Project root.
   * @param request - Section, read epoch, content delta and settlement state.
   * @returns Saved document.
   */
  async write(
    root: string,
    request: { docId: string; blockId: string; epoch: number; content: string; done: boolean; failed?: boolean },
  ): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId),
        record = await read(path)
      if (record.stopped || record.epoch !== request.epoch)
        throw new Error('Writing stopped. Read the document again before continuing.')
      const current = record.blocks.find(b => b.id === request.blockId)
      if (!current || current.state === 'ready') throw new Error('Section is complete or missing. Do not overwrite it.')
      const doc = hydrate(record)
      try {
        const row = doc
          .getArray<Y.Map<unknown>>('blocks')
          .toArray()
          .find(b => b.get('id') === request.blockId)
        if (!row || !docContentSpan(doc, request.blockId)) throw new Error('Missing section text')
        const content = z.string().max(200_000).parse(request.content)
        assertAssistantStrategyEdit(current.content, current.content + content)
        replaceDocSection(doc, request.blockId, current.content + content)
        current.state = request.failed ? 'failed' : request.done ? 'ready' : 'writing'
        refresh(record, doc)
        await save(path, record, { actor: 'assistant', ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }) })
        return projection(record)
      } finally {
        doc.destroy()
      }
    })
  }
  /** Apply one explicitly authorized assistant replacement atomically, preserving unrelated text.
   * The tool boundary must first authenticate the current human request and its document/section scope.
   * @param root - Calling agent's authorized project root.
   * @param request - Exact passage, original request epoch and actual calling Session attribution.
   * @returns Saved document; mismatched epochs, ambiguous passages and locked sections remain unchanged.
   */
  async applyEdit(root: string, request: {
    docId: string
    blockId: string
    before: string
    after: string
    epoch: number
    sessionId: string
    start?: number
    tabId?: string
  }): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), record = await read(path)
      access(record, undefined, true)
      const input = z.object({ blockId: z.uuid(), before: z.string().max(200_000), after: z.string().max(200_000),
        epoch: z.number().int().nonnegative(), sessionId: z.string().min(1).max(200),
        start: z.number().int().nonnegative().optional() }).parse(request)
      if (record.epoch !== input.epoch) throw new Error('Writing stopped or restarted. Send a new request before applying an edit.')
      const block = record.blocks.find(item => item.id === input.blockId)
      if (!block || block.state !== 'ready') throw new Error('Read a completed, editable section before applying an edit.')
      if (request.tabId !== undefined && (block.tabId ?? record.id) !== z.uuid().parse(request.tabId))
        throw new Error('This section is outside the requested document tab.')
      const start = input.start ?? (input.before === '' ? block.content.length : block.content.indexOf(input.before))
      if (start < 0 || start > block.content.length || block.content.slice(start, start + input.before.length) !== input.before)
        throw new Error('The passage changed. Your text is preserved; read it again before applying an edit.')
      if (input.start === undefined && input.before !== '' && block.content.indexOf(input.before, start + 1) >= 0)
        throw new Error('The passage appears more than once. Supply its exact start offset from the document read.')
      const next = block.content.slice(0, start) + input.after + block.content.slice(start + input.before.length)
      if (next.length > 200_000) throw new Error('The edited section exceeds the document text limit.')
      assertAssistantStrategyEdit(block.content, next)
      const doc = hydrate(record)
      try {
        doc.transact(() => { replaceDocSection(doc, input.blockId, next) })
        refresh(record, doc)
        await save(path, record, { actor: 'assistant', sessionId: input.sessionId })
        return projection(record)
      } finally { doc.destroy() }
    })
  }
  /** Propose a passage edit with Yjs anchors that survive edits around the passage.
   * @param root - Project root.
   * @param request - Existing section, exact old text and proposed replacement.
   * @returns Document with a pending suggestion; body text remains unchanged.
   */
  async suggest(root: string, request: Omit<CopyOSDocSuggestRequest, 'workspaceId'> & { expectedEpoch?: number; expectedTabId?: string }): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId),
        record = await read(path),
        role = access(record, request.token, true)
      if (request.expectedEpoch !== undefined && (record.stopped || record.epoch !== request.expectedEpoch))
        throw new Error('Writing stopped or restarted. Send a new request before suggesting an edit.')
      const input = z
        .object({
          blockId: z.uuid(),
          threadId: z.uuid().optional(), commentRequestId: z.uuid().optional(),
          before: z.string().max(200_000),
          after: z.string().max(200_000),
          note: z.string().max(2000),
          start: z.number().int().nonnegative().optional(),
        })
        .parse(request)
      if (input.threadId !== undefined) {
        const thread = record.comments.find(item => item.id === input.threadId)
        if (!thread || thread.resolved || thread.assistant?.state !== 'pending' ||
          thread.assistant.id !== input.commentRequestId || thread.assistant.requestedBy !== 'owner')
          throw new Error('This comment request was cancelled or resolved. Read the thread before suggesting a change.')
      }
      const block = record.blocks.find(item => item.id === input.blockId)
      if (!block || block.state === 'writing') throw new Error('Read an editable section before proposing an edit.')
      if (request.expectedTabId !== undefined && (block.tabId ?? record.id) !== request.expectedTabId)
        throw new Error('This section is outside the requested document tab.')
      const start = input.start ?? (input.before === '' ? block.content.length : block.content.indexOf(input.before))
      if (start < 0 || block.content.slice(start, start + input.before.length) !== input.before)
        throw new Error('The passage changed. Read it again before suggesting an edit.')
      if (input.start === undefined && input.before !== '' && block.content.indexOf(input.before, start + 1) >= 0)
        throw new Error('The passage appears more than once. Supply its exact start offset from the document read.')
      const doc = hydrate(record)
      try {
        const span = docContentSpan(doc, input.blockId)
        if (!span) throw new Error('Missing section text')
        const text = span.text
        record.suggestions.push({
          id: randomUUID(),
          blockId: input.blockId,
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
          before: input.before,
          after: input.after,
          note: input.note,
          state: 'pending',
          createdAt: new Date().toISOString(),
          anchorStart: Buffer.from(
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, span.from + start)),
          ).toString('base64'),
          anchorEnd: Buffer.from(
            Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(
                text,
                span.from + start + input.before.length,
                input.before.length === 0 ? 0 : -1,
              ),
            ),
          ).toString('base64'),
        })
        await save(path, record)
        return projection(record, role, docCommentActor(request.token))
      } finally {
        doc.destroy()
      }
    })
  }
  /** Accept or reject an assistant edit; changed or removed passages reject acceptance without writes.
   * @param root - Project root.
   * @param request - Suggestion and review decision, with an optional edited replacement.
   * @returns Document with the reviewed suggestion and any accepted text.
   */
  async review(root: string, request: Omit<CopyOSDocReviewRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId),
        record = await read(path),
        role = access(record, request.token, true)
      const proposed = record.suggestions.find(item => item.id === request.suggestionId)
      if (!proposed || proposed.state !== 'pending')
        throw new Error('This suggestion has already been reviewed or is missing.')
      if (request.decision === 'reject') {
        proposed.state = 'rejected'
        proposed.reviewedAt = new Date().toISOString()
        await save(path, record)
        return projection(record, role, docCommentActor(request.token))
      }
      const doc = hydrate(record)
      try {
        const target = docCommentTarget(doc, { id: proposed.id, blockId: proposed.blockId, section: false,
          anchor: { start: proposed.anchorStart, end: proposed.anchorEnd } }, 'suggestion')
        if (record.blocks.find(item => item.id === target.blockId)?.state === 'writing')
          throw new Error('Stop writing this section before accepting an edit.')
        const text = docContentSpan(doc, target.blockId)?.text
        const from = Y.createAbsolutePositionFromRelativePosition(
          Y.decodeRelativePosition(Buffer.from(target.anchor.start, 'base64')),
          doc,
        )
        const to = Y.createAbsolutePositionFromRelativePosition(
          Y.decodeRelativePosition(Buffer.from(target.anchor.end, 'base64')),
          doc,
        )
        if (
          !(text instanceof Y.Text) ||
          !from ||
          !to ||
          from.type !== text ||
          to.type !== text ||
          to.index < from.index ||
          text.toJSON().slice(from.index, to.index) !== proposed.before
        )
          throw new Error(
            'The passage changed since this suggestion. Your text is preserved; ask for an updated suggestion.',
          )
        const replacement = z
          .string()
          .max(200_000)
          .parse(request.replacement ?? proposed.after)
        text.delete(from.index, to.index - from.index)
        text.insert(from.index, replacement)
        proposed.after = replacement
        proposed.state = 'accepted'
        const thread = record.comments.find(item => item.id === proposed.threadId)
        if (thread) {
          thread.resolved = true
          if (thread.assistant?.state === 'pending') thread.assistant.state = 'cancelled'
        }
        proposed.reviewedAt = new Date().toISOString()
        refresh(record, doc)
        await save(path, record, { actor: 'assistant', ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }) })
        return projection(record, role, docCommentActor(request.token))
      } finally {
        doc.destroy()
      }
    })
  }
  /** Apply one human comment action with commenter-or-editor authority.
   * @param root - Project root.
   * @param request - Document, capability and typed comment action.
   * @returns Current document with public threads and ownership flags.
   */
  async comment(root: string, request: Omit<CopyOSDocCommentRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), record = await read(path), role = access(record, request.token)
      if (record.trashedAt !== undefined) throw new Error('Restore this document from Trash before commenting.')
      if (role === 'viewer') throw new Error('This document link does not allow comments.')
      const doc = hydrate(record)
      try { applyDocComment(record.comments, doc, request.action, docCommentActor(request.token), role === 'owner') }
      finally { doc.destroy() }
      await save(path, record)
      return projection(record, role, docCommentActor(request.token))
    })
  }
  /** Post an assistant answer only to an explicit pending owner request.
   * @param root - Authorized tool project root.
   * @param request - Thread, request id, answer and scoped Session attribution.
   * @returns Updated document; stale replies are refused before persistence.
   */
  async replyComment(root: string, request: CopyOSDocCommentReplyRequest): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), record = await read(path)
      access(record, undefined, true)
      replyDocComment(record.comments, request)
      await save(path, record)
      return projection(record)
    })
  }
  /** List content revisions after validating editor authority; viewer links cannot reveal deleted text.
   * @param root - Project root.
   * @param request - Document and optional older-page cursor.
   * @returns A bounded timeline page.
   */
  async listHistory(root: string, request: Omit<CopyOSDocHistoryListRequest, 'workspaceId'>): Promise<CopyOSDocHistoryListValue> {
    return serial(pathFor(root, request.docId), async () => {
      const current = await read(pathFor(root, request.docId))
      access(current, request.token, true)
      await history.ensure(root, current.id, historical(current))
      return history.list(root, current.id, current.revision, request.before)
    })
  }
  /** Read one committed version and its predecessor for highlighted comparison.
   * @param root - Project root.
   * @param request - Document and revision.
   * @returns Saved text projections without link or suggestion metadata.
   */
  async readHistory(root: string, request: Omit<CopyOSDocHistoryReadRequest, 'workspaceId'>): Promise<CopyOSDocHistoryReadValue> {
    return serial(pathFor(root, request.docId), async () => {
      const current = await read(pathFor(root, request.docId))
      access(current, request.token, true)
      const revision = z.number().int().nonnegative().max(current.revision).parse(request.revision)
      await history.ensure(root, current.id, historical(current))
      const version = await history.get(root, current.id, revision)
      let previous: CopyOSDocHistoryVersion | undefined
      if (revision > 0) {
        try { previous = await history.get(root, current.id, revision - 1) }
        catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      }
      return { version, ...(previous === undefined ? {} : { previous }) }
    })
  }
  /** Name a committed version without modifying text or changing its content revision.
   * @param root - Project root.
   * @param request - Document, revision and name, empty to clear.
   * @returns Updated timeline entry.
   */
  async nameHistory(root: string, request: Omit<CopyOSDocHistoryNameRequest, 'workspaceId'>): Promise<CopyOSDocHistoryEntry> {
    return serial(pathFor(root, request.docId), async () => {
      const current = await read(pathFor(root, request.docId))
      access(current, request.token, true)
      const revision = z.number().int().nonnegative().max(current.revision).parse(request.revision)
      await history.ensure(root, current.id, historical(current))
      const version = await history.get(root, current.id, revision)
      const named = { ...version, entry: { ...version.entry, name: z.string().trim().max(120).parse(request.name) } }
      await history.put(root, current.id, named)
      return named.entry
    })
  }
  /** Restore text through the live Yjs graph, keep current permissions, and fence old agent writes.
   * @param root - Project root.
   * @param request - Saved version and expected current content revision.
   * @returns A new head revision; previous versions remain available.
   */
  async restore(root: string, request: Omit<CopyOSDocRestoreRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId), current = await read(path), role = access(current, request.token, true)
      if (z.number().int().nonnegative().parse(request.expectedRevision) !== current.revision)
        throw new Error('The document changed while you reviewed history. Your text is safe; reopen history before restoring.')
      const revision = z.number().int().nonnegative().max(current.revision).parse(request.revision)
      await history.ensure(root, current.id, historical(current))
      const version = await history.get(root, current.id, revision), doc = hydrate(current)
      try {
        doc.transact(() => {
          replaceText(doc.getText('title'), version.title)
          restoreDocTabs(doc, version.tabs ?? [])
          writeDocContent(doc, version.blocks)
        })
        current.blocks = version.blocks.map(block => ({ ...block, state: block.state === 'ready' ? 'ready' : 'paused' }))
        current.epoch++; current.stopped = true
        refresh(current, doc)
        await save(path, current, { actor: 'user', restoredFrom: revision })
        return projection(current, role, docCommentActor(request.token))
      } finally { doc.destroy() }
    })
  }
  /** Issue a capability or revoke all document links.
   * @param root - Project root.
   * @param request - Owner request and desired role.
   * @returns New link token.
   */
  async share(
    root: string,
    request: Omit<CopyOSDocReadRequest, 'workspaceId'> & { role: 'restricted' | 'viewer' | 'commenter' | 'editor' },
  ): Promise<{ token: string; role: 'restricted' | 'viewer' | 'commenter' | 'editor' }> {
    if (request.token !== undefined) throw new Error('Only the document owner can manage sharing')
    return serial(pathFor(root, request.docId), async () => {
      const path = pathFor(root, request.docId),
        record = await read(path),
        token = randomBytes(32).toString('base64url')
      access(record, undefined, true)
      if (request.role === 'restricted') record.links = []
      else record.links.push({ hash: sha(token), role: request.role })
      await save(path, record)
      return { token: request.role === 'restricted' ? '' : token, role: request.role }
    })
  }
  /** Export the saved projection on the host.
   * @param root - Project root.
   * @param request - Document and format.
   * @returns Base64 download bytes and content type.
   */
  async export(
    root: string,
    request: Omit<CopyOSDocReadRequest, 'workspaceId'> & { format: 'markdown' | 'pdf' | 'word' },
  ): Promise<CopyOSDocExportValue> {
    const saved = await this.get(root, request), tabs = saved.tabs ?? []
    const doc: CopyOSDocDocument = tabs.length < 2 ? saved : { ...saved, blocks: tabs.flatMap(tab => [
      { id: tab.id, label: tab.title || 'Tab 1', content: '', state: 'ready' as const },
      ...saved.blocks.filter(block => (block.tabId ?? saved.id) === tab.id),
    ]) }
    const savedMarkdown = `# ${doc.title}\n\n${doc.blocks.map(b => `${b.label ? `## ${b.label}\n\n` : ''}${b.content}`).join('\n\n')}\n`
    const markdown = request.format === 'markdown' ? docsChartsToMarkdown(savedMarkdown) : savedMarkdown
    const references = docAssetReferences(markdown)
    if (references.size !== (doc.assets?.length ?? 0)) throw new Error('An attachment is unavailable. Restore or remove its reference before exporting.')
    const loaded = await Promise.all((doc.assets ?? []).map(async (asset) => {
      const value = await this.readAsset(root, { ...request, assetId: asset.id })
      return { ...asset, bytes: Buffer.from(value.dataBase64, 'base64') }
    }))
    const filename = doc.title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 100) || 'document'
    if (request.format === 'word') {
      const files: { [path: string]: Uint8Array } = {}, paths = new Map<string, string>()
      for (const asset of loaded.filter(item => !item.image)) {
        const suffix = /\.[a-z0-9]{1,12}$/iu.exec(asset.name)?.[0].toLowerCase() ?? '.bin'
        const path = `files/${asset.id}${suffix}`
        paths.set(`copyos-doc-asset:${asset.id}`, path); files[path] = asset.bytes
      }
      const bytes = await renderDocWord(doc, new Map(loaded.map(asset => [`copyos-doc-asset:${asset.id}`, asset])), paths)
      if (paths.size) {
        files[`${filename}.docx`] = bytes
        return { content: Buffer.from(zipSync(files)).toString('base64'), mime: 'application/zip', filename: `${filename}.zip` }
      }
      return { content: bytes.toString('base64'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${filename}.docx` }
    }
    if (request.format === 'markdown' && loaded.length) {
      let portable = markdown
      const files: { [path: string]: Uint8Array } = {}
      for (const asset of loaded) {
        const extension = asset.image ? ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[asset.mime] ?? '.bin')
          : /\.[a-z0-9]{1,12}$/iu.exec(asset.name)?.[0].toLowerCase() ?? '.bin'
        const path = `assets/${asset.id}${extension}`
        portable = portable.replaceAll(`copyos-doc-asset:${asset.id}`, path)
        files[path] = asset.bytes
      }
      files[`${filename}.md`] = Buffer.from(portable)
      return { content: Buffer.from(zipSync(files)).toString('base64'), mime: 'application/zip', filename: `${filename}.zip` }
    }
    if (request.format === 'markdown')
      return {
        content: Buffer.from(markdown).toString('base64'),
        mime: 'text/markdown;charset=utf-8',
        filename: `${filename}.md`,
      }
    return {
      content: (await renderDocPdf(doc, new Map(loaded.map(asset => [`copyos-doc-asset:${asset.id}`, asset])))).toString('base64'),
      mime: 'application/pdf',
      filename: `${filename}.pdf`,
    }
  }
}
