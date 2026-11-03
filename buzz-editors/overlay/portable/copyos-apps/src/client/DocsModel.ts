/** React-free document mirror; Yjs merges server drafts with locally queued text edits. */
import * as Y from 'yjs'
import { docContentVersion, docContentBody, docContentSpan, docContentSource, docContentAnchor, docContentLocation,
  docContentLocations, writeDocContent, replaceDocSection, canonicalizeDocContent } from '../../../copyos-domain/src/docs-content.ts'
import { DocsLocalCommentAnchors } from './DocsLocalCommentAnchors.ts'
import { recordDocsUsage } from './DocsUsage.ts'
import { commentDraftPrefix } from './DocsCommentDrafts.ts'
import { docsCommentTarget } from './DocsCommentAnchors.ts'
import type { DocsPageValue, DocsPageSelectionPart, DocsPageMove } from './DocsPageEditor.ts'
import { docsAssetMarkdown, type DocsAssetSource } from './DocsAssetTypes.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  CopyOSDocCommentAction, CopyOSDocCommentDraft, CopyOSDocCommentRequest, CopyOSDocCommentThread,
  CopyOSDocCommentTarget, CopyOSDocCommentAnchor,
  CopyOSDocPresenceRequest, CopyOSDocPresenceValue, CopyOSDocPresencePeer, CopyOSDocPresenceCursor,
  CopyOSDocDocument,
  CopyOSDocImportRequest, CopyOSDocAsset, CopyOSDocAssetPutRequest, CopyOSDocAssetReadRequest, CopyOSDocAssetReadValue,
  CopyOSDocReadRequest, CopyOSDocDuplicateRequest, CopyOSDocTrashRequest,
  CopyOSDocSyncRequest,
  CopyOSDocControlRequest,
  CopyOSDocCreateRequest,
  CopyOSDocShareRequest,
  CopyOSDocShareValue,
  CopyOSDocExportRequest,
  CopyOSDocExportValue,
  CopyOSDocReviewRequest, CopyOSDocHistoryEntry, CopyOSDocHistoryListRequest, CopyOSDocHistoryListValue,
  CopyOSDocHistoryReadRequest, CopyOSDocHistoryReadValue, CopyOSDocHistoryNameRequest, CopyOSDocRestoreRequest,
} from '../../../copyos-domain/src/types.ts'

/** Transport callbacks owned by the CopyOS browser plugin. */
export interface DocsTransport {
  presence(request: CopyOSDocPresenceRequest): Promise<CopyOSDocPresenceValue>
  import(request: CopyOSDocImportRequest): Promise<CopyOSDocDocument>
  putAsset(request: CopyOSDocAssetPutRequest): Promise<CopyOSDocAsset>
  readAsset(request: CopyOSDocAssetReadRequest): Promise<CopyOSDocAssetReadValue>
  comment(request: CopyOSDocCommentRequest): Promise<CopyOSDocDocument>
  history(request: CopyOSDocHistoryListRequest): Promise<CopyOSDocHistoryListValue>
  version(request: CopyOSDocHistoryReadRequest): Promise<CopyOSDocHistoryReadValue>
  nameVersion(request: CopyOSDocHistoryNameRequest): Promise<CopyOSDocHistoryEntry>
  restore(request: CopyOSDocRestoreRequest): Promise<CopyOSDocDocument>
  duplicate(request: CopyOSDocDuplicateRequest): Promise<CopyOSDocDocument>
  trash(request: CopyOSDocTrashRequest): Promise<CopyOSDocDocument>
  list(workspaceId: string, trashed?: boolean): Promise<readonly CopyOSDocDocument[]>
  read(request: CopyOSDocReadRequest): Promise<CopyOSDocDocument>
  create(request: CopyOSDocCreateRequest): Promise<CopyOSDocDocument>
  sync(request: CopyOSDocSyncRequest): Promise<CopyOSDocDocument>
  control(request: CopyOSDocControlRequest): Promise<CopyOSDocDocument>
  share(request: CopyOSDocShareRequest): Promise<CopyOSDocShareValue>
  export(request: CopyOSDocExportRequest): Promise<CopyOSDocExportValue>
  review(request: CopyOSDocReviewRequest): Promise<CopyOSDocDocument>
}
/** A remote pane with its cursor resolved against locally merged shared text. */
export interface DocsPresencePeer extends CopyOSDocPresencePeer { readonly range?: { readonly from: number; readonly to: number } }
/** One immutable projection for Suite or a document session tab. */
export interface DocsSnapshot {
  /** Session-attributed saved revisions observed after this pane opened. */
  readonly assistantEdits?: Readonly<Record<string, number>>
  readonly legacyRecoverySource: string | null
  readonly commentDrafts: readonly CopyOSDocCommentDraft[]
  readonly detachedCommentDraftIds?: readonly string[]
  readonly commentDraftStorageFailed: boolean
  readonly peers: readonly DocsPresencePeer[]
  readonly presenceUnavailable: boolean
  readonly activeTab: string | null
  readonly workspaceId: string
  /** Explicit navigation intent; background polling never changes it. */
  readonly revealVersion: number
  readonly activeThread: string | null
  readonly trashedDocuments: readonly CopyOSDocDocument[]
  readonly documents: readonly CopyOSDocDocument[]
  readonly document: CopyOSDocDocument | null
  readonly status: 'loading' | 'saved' | 'saving' | 'offline' | 'error'
  readonly error: string
  readonly readOnly: boolean
  readonly hasPending: boolean
}
const localOrigin = Symbol('docs-local')
const encode = (data: Uint8Array): string => {
  let binary = ''
  for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192))
  return btoa(binary)
}
const decode = (data: string): Uint8Array => Uint8Array.from(atob(data), c => c.charCodeAt(0))

function orderedRows(doc: Y.Doc): Y.Map<unknown>[] {
  return doc
    .getArray<Y.Map<unknown>>('blocks')
    .toArray()
    .map((row, index) => ({
      row,
      position: typeof row.get('position') === 'number' ? Number(row.get('position')) : index * 1024,
    }))
    .sort((a, b) => a.position - b.position || String(a.row.get('id')).localeCompare(String(b.row.get('id'))))
    .map(item => item.row)
}
function rowPosition(doc: Y.Doc, row: Y.Map<unknown>): number {
  return typeof row.get('position') === 'number'
    ? Number(row.get('position'))
    : doc.getArray<Y.Map<unknown>>('blocks').toArray().indexOf(row) * 1024
}
function between(doc: Y.Doc, items: Y.Map<unknown>[], index: number): number {
  const before = items[index - 1],
    after = items[index]
  const left = before ? rowPosition(doc, before) : after ? rowPosition(doc, after) - 2048 : -1024
  const right = after ? rowPosition(doc, after) : left + 2048
  return (left + right) / 2
}

/** Maintain one pane's document mirror and own its polling and pending updates. */
export class DocsModel {
  /** Current document, save state, and library projection supplied to framework-generated hooks. */
  readonly state = createSnapshotStore<DocsSnapshot>({
    legacyRecoverySource: null,
    commentDrafts: [],
    commentDraftStorageFailed: false,
    peers: [],
    presenceUnavailable: false,
    activeTab: null,
    workspaceId: '',
    revealVersion: 0,
    activeThread: null,
    trashedDocuments: [],
    documents: [],
    document: null,
    status: 'loading',
    error: '',
    readOnly: false,
    hasPending: false,
  })
  private modernQueuedUpdate: string | null = null
  private legacyRecoverySource: string | null = null
  private legacyRecoveryUpdate: string | null = null
  private legacyRecoveryTab: string | null = null
  private recoveringLegacy = false
  private localCommentAnchors: DocsLocalCommentAnchors | null = null
  private peerId = randomUUID()
  private peers: readonly CopyOSDocPresencePeer[] = []
  private cursor: CopyOSDocPresenceCursor | undefined
  private presenceScope: CopyOSDocPresenceRequest | null = null
  private presenceFlight: Promise<void> | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private presenceDirty = false
  private leavePresence(): void {
    clearTimeout(this.presenceTimer); this.presenceTimer = undefined
    const request = this.presenceScope
    this.presenceScope = null; this.presenceFlight = null; this.presenceDirty = false
    this.peers = []; this.cursor = undefined; this.peerId = randomUUID()
    this.state.set({ ...this.state.getSnapshot(), peers: [], presenceUnavailable: false })
    if (request) void this.transport.presence({ ...request, state: null }).catch(() => { /* Unreachable panes expire on the host. */ })
  }
  private sendPresence(): void {
    if (this.closed || this.stopped || !this.server || !this.doc || this.server.trashedAt) return
    if (this.presenceFlight) { this.presenceDirty = true; return }
    const activeTab = this.state.getSnapshot().activeTab
    if (!activeTab || !(this.server.tabs?.length ? this.server.tabs : [{ id: this.server.id }]).some(tab => tab.id === activeTab)) return
    const cursor = this.cursor
    const knownCursor = cursor && this.server.blocks.some(block => block.id === cursor.blockId
      && (block.tabId ?? this.server?.id) === activeTab)
      && orderedRows(this.doc).some(row => row.get('id') === cursor.blockId) ? cursor : undefined
    const request: CopyOSDocPresenceRequest = { ...this.selectedRequest(), peerId: this.peerId,
      state: { tabId: activeTab, ...(knownCursor ? { cursor: knownCursor } : {}) } }
    this.presenceScope = request; this.presenceDirty = false
    const operation = this.transport.presence(request).then((value) => {
      if (this.presenceScope !== request) return
      this.peers = value.peers
      this.state.set({ ...this.state.getSnapshot(), presenceUnavailable: false })
      this.publish(this.state.getSnapshot().status, this.state.getSnapshot().error)
    }, () => {
      if (this.presenceScope !== request) return
      this.peers = []
      this.state.set({ ...this.state.getSnapshot(), peers: [], presenceUnavailable: true })
    }).finally(() => {
      if (this.presenceFlight !== operation) return
      this.presenceFlight = null
      if (this.presenceDirty) this.sendPresence()
    })
    this.presenceFlight = operation
  }
  private resolvedPeer(peer: CopyOSDocPresencePeer): DocsPresencePeer {
    if (!this.doc || !peer.cursor) return peer
    try {
      const location = docContentLocation(this.doc, peer.cursor.blockId, peer.cursor.anchor)
      if (location) return { ...peer, cursor: { ...peer.cursor, blockId: location.blockId }, range: location.range }
    } catch { /* A cursor awaiting its text update stays visible only in the people list. */ }
    return peer
  }
  /** Announce the local selection as shared-text anchors without changing document content.
   * @param blockId - Focused block, or null when leaving the editor.
   * @param range - Exact Markdown offsets, including a collapsed caret.
   */
  setCursor(blockId: string | null, range?: { from: number; to: number }): void {
    this.cursor = undefined
    const span = blockId && this.doc ? docContentSpan(this.doc, blockId) : undefined
    if (blockId && span && range && range.from >= 0 && range.to >= range.from && range.to <= span.to - span.from)
      this.cursor = { blockId, anchor: docContentAnchor(span, range.from, range.to) }

    this.presenceTimer ??= setTimeout(() => { this.presenceTimer = undefined; this.sendPresence() }, 100)
  }
  /** Capture a local block link without creating a comment or changing saved content.
   * @param blockId - Stable section containing the passage.
   * @param range - Exact Markdown source offsets.
   * @returns Relative shared-text positions, or undefined after the section disappears.
   */
  anchorPassage(blockId: string, range: { from: number; to: number }): CopyOSDocCommentAnchor | undefined {
    const span = this.doc ? docContentSpan(this.doc, blockId) : undefined
    return span ? docContentAnchor(span, range.from, range.to) : undefined
  }
  /** Locate a copied passage link after surrounding edits and section joins.
   * @param anchor - Relative positions parsed from the current document URL.
   * @returns Its first surviving section and source range, or undefined for removed text.
   */
  locatePassage(anchor: CopyOSDocCommentAnchor): { blockId: string; range: { from: number; to: number }; tabId: string } | undefined {
    if (!this.doc || !this.server) return undefined
    const part = docContentLocations(this.doc, anchor)[0]
    const block = part ? this.state.getSnapshot().document?.blocks.find(block => block.id === part.blockId) : undefined
    return part && block ? { blockId: part.blockId, range: part.range, tabId: block.tabId ?? this.server.id } : undefined
  }
  private readonly assetCache = new Map<string, Promise<DocsAssetSource>>()
  private readonly assetURLs = new Set<string>()
  private assetEpoch = 0
  private clearAssets(): void {
    this.assetEpoch++
    for (const url of this.assetURLs) URL.revokeObjectURL(url)
    this.assetURLs.clear(); this.assetCache.clear()
  }
  private doc: Y.Doc | null = null
  private undo: Y.UndoManager | null = null
  private server: CopyOSDocDocument | null = null
  private vector: Uint8Array = new Uint8Array()
  private pending = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private stopped = true
  private workspaceId = ''
  private token: string | undefined
  private closed = false
  private busy = false
  private active: Promise<void> | undefined
  private readonly attributionReads = new Set<Promise<void>>()
  private readonly attributionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private outlineStarted: { readonly docId: string; readonly at: number } | undefined
  /** Start timing the first draft until an actual section outline reaches this pane.
   * @returns Cancels this observation when request admission fails.
   */
  beginOutline(): () => void {
    const current = this.server
    if (!current) return () => {}
    const observation = { docId: current.id, at: performance.now() }
    this.outlineStarted = observation
    return () => { if (this.outlineStarted === observation) this.outlineStarted = undefined }
  }
  constructor(
    private readonly transport: DocsTransport,
    private readonly sessionId?: string,
  ) {}
  private publish(status: DocsSnapshot['status'] = this.state.getSnapshot().status, error = ''): void {
    let value = this.server
    if (value && this.doc) {
      const previous = new Map(value.blocks.map(b => [b.id, b])), doc = this.doc
      value = {
        ...value,
        ...(value.comments === undefined ? {} : { comments: value.comments.map(thread => this.commentRange(thread)) }),
        ...(value.suggestions === undefined ? {} : { suggestions: value.suggestions.map((item) => {
          const { origin, current } = docsCommentTarget(doc, { ...item, section: false }, 'suggestion')
          return { ...item, blockId: current.blockId, anchor: current.anchor, anchorOrigin: origin }
        }) }),
        title: this.doc.getText('title').toJSON(),
        tabs: this.tabs(),
        blocks: orderedRows(this.doc).map((row) => {
          const id = String(row.get('id')),
            content = docContentSource(doc, id)
          return {
            id,
            ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}),
            label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '',
            content: content ?? '',
            state: previous.get(id)?.state ?? 'ready',
          }
        }),
      }
    }
    this.state.set({
      ...this.state.getSnapshot(),
      workspaceId: this.workspaceId,
      document: value,
      legacyRecoverySource: this.legacyRecoverySource,
      commentDrafts: this.localCommentAnchors?.all() ?? [],
      detachedCommentDraftIds: this.doc ? this.localCommentAnchors?.detached(this.doc) ?? [] : [],
      commentDraftStorageFailed: this.localCommentAnchors?.storageFailed ?? false,
      peers: this.peers.map(peer => this.resolvedPeer(peer)),
      activeTab: value ? value.tabs?.some(tab => tab.id === this.state.getSnapshot().activeTab)
        ? this.state.getSnapshot().activeTab : value.tabs?.[0]?.id ?? value.id : null,
      status,
      error,
      hasPending: this.pending,
      readOnly: this.legacyRecoverySource !== null || value?.trashedAt !== undefined || value?.access === 'viewer' || value?.access === 'commenter'
        || (this.token !== undefined && (value?.access !== 'editor' || status === 'error' || status === 'offline')),
    })
  }
  private accept(value: CopyOSDocDocument): void {
    if (this.closed) return
    const previous = this.server
    if (this.outlineStarted?.docId === value.id && (value.blocks.length > 1 || value.blocks.some(block => block.label))) {
      recordDocsUsage({ outlineMs: performance.now() - this.outlineStarted.at })
      this.outlineStarted = undefined
    }
    if (!this.doc || this.server?.id !== value.id) {
      this.leavePresence()
      this.clearAssets()
      this.undo?.destroy()
      this.doc?.destroy()
      this.legacyRecoverySource = null; this.legacyRecoveryUpdate = null; this.legacyRecoveryTab = null
      this.localCommentAnchors = value.access !== 'viewer' && !value.trashedAt
        ? new DocsLocalCommentAnchors(commentDraftPrefix(this.workspaceId, value.id)) : null
      this.doc = new Y.Doc()
      Y.applyUpdate(this.doc, decode(value.sync))
      if (docContentVersion(this.doc) !== 2) throw new Error('Reload this document to update its shared editing format.')
      const currentDoc = this.doc
      this.undo = new Y.UndoManager([this.doc.getText('title'),
        ...orderedRows(this.doc).map(row => docContentBody(currentDoc, typeof row.get('tabId') === 'string' ? String(row.get('tabId')) : undefined)),
        this.doc.getArray('blocks'), this.doc.getMap('tabs'), this.doc.getMap('commentAnchorMoves'),
        this.doc.getMap('suggestionAnchorMoves')], {
        trackedOrigins: new Set([localOrigin]),
      })
    } else Y.applyUpdate(this.doc, decode(value.sync))
    const changedDocument = this.server?.id !== value.id
    this.server = value
    for (const thread of value.comments ?? []) this.localCommentAnchors?.forget(thread.id)
    if (changedDocument) {
      for (const timer of this.attributionTimers.values()) clearTimeout(timer)
      this.attributionTimers.clear()
      this.state.set({ ...this.state.getSnapshot(), assistantEdits: {} })
      const hash = new URLSearchParams(location.hash.slice(1))
      const linkedTab = hash.get('doc') === value.id ? hash.get('tab') : null
      this.state.set({ ...this.state.getSnapshot(), activeThread: null,
        activeTab: linkedTab ?? localStorage.getItem(this.tabKey()) })
      if (!this.token) {
        try { localStorage.setItem(this.selectionKey(), value.id) }
        catch (error) { console.warn('Unable to remember the selected document', error) }
      }
    }
    const remote = new Y.Doc()
    try {
      Y.applyUpdate(remote, decode(value.sync))
      this.vector = Y.encodeStateVector(remote)
    } finally {
      remote.destroy()
    }
    if (value.trashedAt) this.leavePresence()
    this.localCommentAnchors?.restore(this.doc)
    this.publish(this.pending ? 'saving' : 'saved')
    if (this.cursor && !orderedRows(this.doc).some(row => row.get('id') === this.cursor?.blockId
      && (row.get('tabId') ?? value.id) === this.state.getSnapshot().activeTab)) this.cursor = undefined
    this.sendPresence()
    if (previous?.id === value.id && previous.revision !== value.revision
      && value.access !== 'viewer' && value.access !== 'commenter') {
      const changed = value.blocks.filter((block) => {
        const old = previous.blocks.find(old => old.id === block.id)
        return old && old.state === 'ready' && block.state === 'ready' && old.content !== block.content
      }).map(block => block.id)
      if (changed.length) {
        const generation = this.generation
        const operation = this.transport.version({ ...this.selectedRequest(), revision: value.revision }).then((saved) => {
          if (this.closed || this.generation !== generation || this.server?.id !== value.id
            || this.server.revision !== value.revision || this.pending || saved.version.entry.actor !== 'assistant') return
          this.state.set({ ...this.state.getSnapshot(), assistantEdits: {
            ...this.state.getSnapshot().assistantEdits, ...Object.fromEntries(changed.map(id => [id, value.revision])),
          } })
          for (const id of changed) {
            clearTimeout(this.attributionTimers.get(id))
            this.attributionTimers.set(id, setTimeout(() => {
              this.attributionTimers.delete(id)
              const assistantEdits = Object.fromEntries(Object.entries(this.state.getSnapshot().assistantEdits ?? {})
                .filter(([blockId]) => blockId !== id))
              this.state.set({ ...this.state.getSnapshot(), assistantEdits })
            }, 10_000))
          }
        }).catch((error: unknown) => { if (!this.closed) console.warn('Unable to read assistant edit attribution', error) })
        this.attributionReads.add(operation)
        void operation.then(() => { this.attributionReads.delete(operation) })
      }
    }
  }
  private selectionKey(): string {
    return `copyos.docs.selected.${this.workspaceId}.${this.sessionId ?? 'suite'}`
  }
  private tabKey(): string { return `copyos.docs.tab.${this.workspaceId}.${this.server?.id ?? ''}.${this.sessionId ?? 'suite'}` }
  private tabs(): { id: string; title: string }[] {
    const tabs = Array.from(this.doc?.getMap<Y.Map<unknown>>('tabs').entries() ?? []).map(([id, row], index) => ({
      id, title: typeof row.get('title') === 'string' ? (row.get('title') as string) : '',
      position: typeof row.get('position') === 'number' ? Number(row.get('position')) : index * 1024,
    })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(({ id, title }) => ({ id, title }))
    return tabs.length ? tabs : this.server ? [{ id: this.server.id, title: '' }] : []
  }
  /** Select a tab without changing shared document content.
   * @param id - Tab identity from the current document.
   */
  selectTab(id: string): void {
    if (!this.tabs().some(tab => tab.id === id)) return
    this.cursor = undefined
    this.state.set({ ...this.state.getSnapshot(), activeTab: id })
    this.sendPresence()
    try { localStorage.setItem(this.tabKey(), id) }
    catch (error) { console.warn('Unable to remember the document tab', error) }
  }
  /** Create a new editable tab and its first paragraph as one undoable change.
   * @param title - User-facing tab name.
   */
  addTab(title: string): void {
    if (!this.doc || !this.server || this.state.getSnapshot().readOnly || this.tabs().length >= 50) return
    const id = this.appendTab(this.doc, title, [''])
    this.selectTab(id); this.changed()
  }
  private appendTab(doc: Y.Doc, title: string, contents: readonly string[]): string {
    const mainId = this.server?.id, tabs = doc.getMap<Y.Map<unknown>>('tabs'), id = randomUUID()
    if (!mainId) throw new Error('No document selected')
    this.undo?.stopCapturing()
    doc.transact(() => {
      if (!tabs.size) {
        const main = new Y.Map<unknown>(); main.set('title', ''); main.set('position', 0); tabs.set(mainId, main)
      }
      const row = new Y.Map<unknown>(); row.set('title', title); row.set('position', this.tabs().length * 1024)
      tabs.set(id, row)
      for (const content of contents) {
        const block = new Y.Map<unknown>(); block.set('id', randomUUID()); block.set('tabId', id)
        block.set('label', ''); block.set('text', new Y.Text(content)); block.set('position', doc.getArray('blocks').length * 1024)
        doc.getArray<Y.Map<unknown>>('blocks').push([block])
      }
      this.rewriteSections()
    }, localOrigin)
    this.undo?.stopCapturing(); return id
  }
  /** Rename one tab as an undoable local edit.
   * @param id - Saved tab identity.
   * @param title - New nonempty tab name.
   */
  renameTab(id: string, title: string): void {
    if (!title.trim()) return
    if (!this.doc || !this.server || this.state.getSnapshot().readOnly) return
    const doc = this.doc, mainId = this.server.id, tabs = doc.getMap<Y.Map<unknown>>('tabs')
    this.undo?.stopCapturing()
    doc.transact(() => {
      if (!tabs.size && id === mainId) {
        const main = new Y.Map<unknown>(); main.set('title', title); main.set('position', 0); tabs.set(id, main)
      } else tabs.get(id)?.set('title', title)
    }, localOrigin)
    this.undo?.stopCapturing(); this.changed()
  }
  /** Move one tab in visible order without moving or replacing its text.
   * @param id - Tab to move.
   * @param target - Zero-based destination index.
   */
  moveTab(id: string, target: number): void {
    if (!this.doc || this.state.getSnapshot().readOnly) return
    const tabs = this.tabs(), from = tabs.findIndex(tab => tab.id === id), current = tabs[from]
    if (!current) return
    const ordered = tabs.filter(tab => tab.id !== id); ordered.splice(Math.max(0, Math.min(ordered.length, target)), 0, current)
    const rows = this.doc.getMap<Y.Map<unknown>>('tabs')
    this.undo?.stopCapturing()
    this.doc.transact(() => {
      ordered.forEach((tab, index) => rows.get(tab.id)?.set('position', index * 1024))
    }, localOrigin)
    this.undo?.stopCapturing(); this.changed()
  }
  /** Open a workspace and start polling until the paired stop callback runs.
   * @param workspaceId - Registered project identity.
   * @param docId - Optional shared document.
   * @param token - Optional link capability.
   */
  async start(workspaceId: string, docId?: string, token?: string): Promise<void> {
    this.leavePresence()
    if (this.server && (workspaceId !== this.workspaceId || (docId !== undefined && docId !== this.server.id) || token !== this.token))
      await this.flush()
    if (this.workspaceId !== '' && this.workspaceId !== workspaceId) {
      await this.flush()
      this.undo?.destroy()
      this.doc?.destroy()
      this.doc = null
      this.server = null
      this.state.set({ ...this.state.getSnapshot(), document: null, documents: [], trashedDocuments: [] })
    }
    const generation = ++this.generation
    const prefix = `copyos.docs.pending.${workspaceId}.`
    const key = docId || this.server?.id
    const cached = localStorage.getItem(
      key ? `${prefix}${key}` : (Object.keys(localStorage).find(k => k.startsWith(prefix)) ?? ''),
    )
    let queued: { docId: string; update: string } | undefined
    if (cached && !token) {
      try {
        const value: unknown = JSON.parse(cached)
        if (
          typeof value === 'object' &&
          value !== null &&
          'docId' in value &&
          typeof value.docId === 'string' &&
          'update' in value &&
          typeof value.update === 'string'
        )
          queued = { docId: value.docId, update: value.update }
      } catch (error) {
        console.warn('Unable to read queued document edits', error)
      }
    }
    this.stopped = false
    this.workspaceId = workspaceId
    this.token = token
    this.publish('loading')
    try {
      if (token && !docId) throw new Error('A document link must identify a document.')
      const [documents, trashedDocuments] = await Promise.all([
        token && docId
          ? this.transport.read({ workspaceId, docId, token }).then(value => [value])
          : this.transport.list(workspaceId),
        token ? Promise.resolve([]) : this.transport.list(workspaceId, true),
      ])
      if (generation !== this.generation) return
      this.state.set({ ...this.state.getSnapshot(), documents, trashedDocuments })
      const selected =
        documents.find(
          d =>
            d.id ===
            (docId ?? queued?.docId ?? this.server?.id ?? localStorage.getItem(this.selectionKey())
              ?? documents.find(d => d.sessionId === this.sessionId)?.id),
        ) ?? (this.sessionId === undefined ? documents[0] : documents.find(d => d.sessionId === this.sessionId))
      if (selected) {
        this.accept(selected)
        if (queued && queued.docId === selected.id && this.doc) {
          const legacy = this.legacyQueuedSource(queued.update)
          if (legacy !== null) {
            this.legacyRecoverySource = legacy; this.legacyRecoveryUpdate = queued.update
            this.publish('saved')
          } else {
            Y.applyUpdate(this.doc, decode(queued.update))
            this.pending = true; this.publish('saving')
          }
        }
      } else {
        this.server = null
        this.publish('saved')
      }
    } catch (error) {
      if (generation === this.generation) this.publish('error', String(error))
    }
    if (generation === this.generation) this.schedule()
  }
  /** Release the poller without discarding unsaved text. */
  stop(): void {
    this.leavePresence()
    this.stopped = true
    this.generation++
    clearTimeout(this.timer)
    this.schedule()
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (!this.closed && (!this.stopped || this.pending))
      this.timer = setTimeout(() => {
        void this.poll()
      }, 650)
  }
  private poll(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.active) return this.active
    const operation = this.tick()
    this.active = operation
    void operation.finally(() => {
      if (this.active === operation) this.active = undefined
      this.schedule()
    })
    return operation
  }
  /** Save pending edits before navigation or an assistant action; in-flight saves are joined.
   * @returns Completion after the latest edits are acknowledged, or a recoverable save error.
   */
  async flush(): Promise<void> {
    if (this.legacyRecoverySource !== null && !this.recoveringLegacy)
      throw new Error('Recover the queued edits from the older editor before continuing.')
    clearTimeout(this.timer)
    try {
      if (this.active) await this.active
      if (this.pending) await this.poll()
      if (this.pending)
        throw new Error(this.state.getSnapshot().error || 'Document changes could not be saved. Try again.')
    } finally {
      this.schedule()
    }
  }

  private async tick(): Promise<void> {
    if (this.legacyRecoverySource !== null && !this.recoveringLegacy) return
    if (this.busy) {
      this.schedule()
      return
    }
    this.busy = true
    const generation = this.generation
    try {
      if (this.server && this.doc) {
        const request = {
          workspaceId: this.workspaceId,
          docId: this.server.id,
          ...(this.token === undefined ? {} : { token: this.token }),
        }
        if (this.pending) {
          const update = encode(Y.encodeStateAsUpdate(this.doc, this.vector))
          this.pending = false
          try {
            const value = await this.transport.sync({ ...request, update, contentVersion: 2 })
            if (generation === this.generation) {
              this.accept(value)
              if (!this.state.getSnapshot().hasPending) this.clearAcknowledgedCache(value)
            }
          } catch (error) {
            this.pending = true
            throw error
          }
        } else if (!this.stopped) {
          const value = await this.transport.read(request)
          if (generation === this.generation) this.accept(value)
        }
      }
      if (!this.token && !this.stopped) {
        const documents = await this.transport.list(this.workspaceId)
        if (generation === this.generation) {
          const previous = this.state.getSnapshot().documents
          const created =
            this.sessionId === undefined
              ? undefined
              : documents.find(d => d.sessionId === this.sessionId && !previous.some(old => old.id === d.id))
          this.state.set({ ...this.state.getSnapshot(), documents })
          if (created && !this.pending) this.accept(created)
          const initial = this.sessionId === undefined ? documents[0] : documents.find(d => d.sessionId === this.sessionId)
          if (!this.server && initial) this.accept(initial)
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.publish(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : String(error))
        this.sendPresence()
      }
    } finally {
      this.busy = false
    }
  }
  private legacyQueuedSource(update: string): string | null {
    if (update === this.modernQueuedUpdate) return null
    const queued = new Y.Doc()
    try {
      Y.applyUpdate(queued, decode(update))
      if (docContentVersion(queued) === 2) { this.modernQueuedUpdate = update; return null }
      const parts = orderedRows(queued).map((row) => {
        const text = row.get('text')
        if (!(text instanceof Y.Text)) throw new Error('The older queued document could not be read. Its recovery data is retained.')
        const label = row.get('label')
        return `${typeof label === 'string' && label ? `## ${label}\n\n` : ''}${text.toJSON()}`
      })
      return `# ${queued.getText('title').toJSON()}\n\n${parts.join('\n\n')}`
    } finally { queued.destroy() }
  }
  /** Recover an older queued document into a separate tab, preserving the current saved text.
   * @param title - Localized name for the recovered tab.
   * @returns Completion after the recovered text is acknowledged by the host.
   */
  async recoverLegacyDraft(title: string): Promise<void> {
    const doc = this.doc, server = this.server, source = this.legacyRecoverySource, update = this.legacyRecoveryUpdate
    if (!doc || !server || source === null || update === null || this.recoveringLegacy) return
    if (server.trashedAt || (server.access && server.access !== 'owner' && server.access !== 'editor'))
      throw new Error('This document does not allow recovering edits.')
    if (this.tabs().length >= 50 && !this.legacyRecoveryTab) throw new Error('This document has reached its tab limit.')
    const contents: string[] = []
    for (let from = 0; from < source.length;) {
      let to = Math.min(from + 200_000, source.length)
      if (to < source.length && /[\uD800-\uDBFF]/u.test(source.charAt(to - 1))) to--
      contents.push(source.slice(from, to)); from = to
    }
    if (!this.legacyRecoveryTab && orderedRows(doc).length + contents.length > 500)
      throw new Error('This document has reached its section limit. Download the recovered copy to keep your edits.')
    this.recoveringLegacy = true
    try {
      this.legacyRecoveryTab ??= this.appendTab(doc, title, contents)
      this.selectTab(this.legacyRecoveryTab); this.changed(); await this.flush()
      const saved = this.server?.blocks.filter(block => block.tabId === this.legacyRecoveryTab).map(block => block.content).join('') === source
      if (!saved) throw new Error('Recovered edits have not been saved. Keep this page open and retry.')
      const key = `copyos.docs.pending.${this.workspaceId}.${server.id}`, stored = localStorage.getItem(key)
      this.legacyRecoverySource = null; this.legacyRecoveryUpdate = null; this.legacyRecoveryTab = null
      if (stored) {
        const value: unknown = JSON.parse(stored)
        if (value && typeof value === 'object' && 'update' in value && typeof value.update === 'string') {
          if (value.update === update) localStorage.removeItem(key)
          else {
            const newer = this.legacyQueuedSource(value.update)
            if (newer !== null) { this.legacyRecoverySource = newer; this.legacyRecoveryUpdate = value.update }
          }
        }
      }
    } finally {
      this.recoveringLegacy = false
      const state = this.state.getSnapshot(); this.publish(state.status, state.error)
    }
  }
  private clearAcknowledgedCache(value: CopyOSDocDocument): void {
    const key = `copyos.docs.pending.${this.workspaceId}.${value.id}`,
      cached = localStorage.getItem(key)
    if (!cached) return
    const entry: unknown = JSON.parse(cached)
    if (typeof entry !== 'object' || entry === null || !('update' in entry) || typeof entry.update !== 'string') return
    if (this.legacyQueuedSource(entry.update) !== null) return
    const comparison = new Y.Doc()
    try {
      Y.applyUpdate(comparison, decode(value.sync))
      const before = encode(Y.encodeStateAsUpdate(comparison))
      Y.applyUpdate(comparison, decode(entry.update))
      if (before === encode(Y.encodeStateAsUpdate(comparison))) localStorage.removeItem(key)
    } finally {
      comparison.destroy()
    }
  }
  private changed(): void {
    this.pending = true
    let storageError = ''
    if (this.doc && this.server) {
      try {
        const key = `copyos.docs.pending.${this.workspaceId}.${this.server.id}`
        const cached = localStorage.getItem(key)
        if (cached) {
          const value: unknown = JSON.parse(cached)
          if (typeof value === 'object' && value !== null && 'update' in value && typeof value.update === 'string') {
            const legacy = this.legacyQueuedSource(value.update)
            if (legacy !== null && !this.recoveringLegacy) {
              this.legacyRecoverySource = legacy; this.legacyRecoveryUpdate = value.update
              this.publish('error'); return
            }
            if (legacy === null) Y.applyUpdate(this.doc, decode(value.update))
          }
        }
        const update = encode(Y.encodeStateAsUpdate(this.doc))
        localStorage.setItem(key, JSON.stringify({ docId: this.server.id, update }))
        this.modernQueuedUpdate = update
      } catch (error) {
        storageError = error instanceof Error ? error.message : String(error)
      }
    }
    this.publish(storageError ? 'error' : 'saving', storageError)
    this.schedule()
  }
  /** Release resources when the plugin unloads; browser-local pending edits remain recoverable. */
  async dispose(): Promise<void> {
    this.closed = true
    for (const timer of this.attributionTimers.values()) clearTimeout(timer)
    this.attributionTimers.clear()
    this.clearAssets()
    this.stop()
    if (this.active) await this.active
    await Promise.all(this.attributionReads)
    this.undo?.destroy()
    this.doc?.destroy()
    this.doc = null
  }

  /** Replace only the changed text range, retaining Yjs character identities.
   * @param id - Block UUID or title.
   * @param value - Edited source text.
   */
  edit(id: string, value: string): void {
    if (!this.doc || this.state.getSnapshot().readOnly) return
    const blockId = id.startsWith('label:') ? id.slice(6) : id
    if (this.server?.blocks.find(b => b.id === blockId)?.state === 'writing') return
    if (id.startsWith('label:')) {
      const row = this.doc
        .getArray<Y.Map<unknown>>('blocks')
        .toArray()
        .find(b => b.get('id') === blockId)
      if (row && row.get('label') !== value) {
        this.doc.transact(() => row.set('label', value), localOrigin)
        this.changed()
      }
      return
    }
    if (id !== 'title') {
      if (docContentSource(this.doc, id) === undefined || docContentSource(this.doc, id) === value) return
      this.doc.transact(() => { if (this.doc) replaceDocSection(this.doc, id, value) }, localOrigin)
      this.changed(); return
    }
    const text = this.doc.getText('title')
    if (!(text instanceof Y.Text)) return
    const old = text.toJSON()
    if (old === value) return
    let start = 0,
      end = 0
    while (start < old.length && start < value.length && old[start] === value[start]) start++
    while (
      end < old.length - start &&
      end < value.length - start &&
      old[old.length - end - 1] === value[value.length - end - 1]
    )
      end++
    this.doc.transact(() => {
      text.delete(start, old.length - start - end)
      text.insert(start, value.slice(start, value.length - end))
    }, localOrigin)
    this.changed()
  }
  /** Apply one page edit while preserving untouched section identities and other tabs.
   * @param values - Current active-tab sections from the continuous editor.
   * @param boundary - Keep a paragraph-boundary deletion independently undoable.
   * @param move - Exact source translation for one moved body block, including its anchored feedback.
   */
  editPage(values: readonly DocsPageValue[], boundary = false, move?: DocsPageMove): void {
    if (!this.doc || !this.server || this.state.getSnapshot().readOnly) return
    const doc = this.doc, activeTab = this.state.getSnapshot().activeTab
    const incoming = new Map(values.map(value => [value.id, value]))
    if (incoming.size !== values.length) throw new Error('Duplicate document section identity')
    for (const block of this.state.getSnapshot().document?.blocks ?? []) {
      if ((block.tabId ?? this.server.id) !== activeTab || block.state !== 'writing') continue
      const value = incoming.get(block.id)
      if (!value || value.content !== block.content || value.label !== block.label) return
    }
    const structural = boundary || orderedRows(doc).some(row =>
      (row.get('tabId') ?? this.server?.id) === activeTab && !incoming.has(String(row.get('id'))))
    const mutation = { changed: false }
    const records = move ? [
      ...(this.server.comments ?? []).map(thread => ({ thread, kind: 'comment' as const })),
      ...(this.server.suggestions ?? []).filter(item => item.state === 'pending')
        .map(item => ({ thread: { ...item, section: false }, kind: 'suggestion' as const })),
    ] : []
    const transfers = move ? records.flatMap(({ thread, kind }) => {
      const current = this.commentRange(thread, kind)
      if (current.detached || current.section || current.blockId !== move.from || !current.range
        || (current.ranges?.length ?? 0) > 1) return []
      const range = move.map(current.range)
      return range ? [{ id: thread.id, kind, range, origin: docsCommentTarget(doc, thread, kind).origin }] : []
    }) : []
    const drafts = move ? (this.localCommentAnchors?.all() ?? []).flatMap((draft) => {
      const current = docContentLocation(doc, draft.blockId, draft.anchor)
      if (draft.section || current?.blockId !== move.from) return []
      const range = move.map(current.range)
      return range ? [{ draft, range }] : []
    }) : []
    if (structural) this.undo?.stopCapturing()
    doc.transact(() => {
      const all = orderedRows(doc), before = all.map(row => ({ id: String(row.get('id')), label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '',
        content: docContentSource(doc, String(row.get('id'))) ?? '',
        ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}) }))
      const first = all.findIndex(row => (row.get('tabId') ?? this.server?.id) === activeTab)
      const retained = before.filter(value => (value.tabId ?? this.server?.id) !== activeTab)
      retained.splice(first < 0 ? retained.length : first, 0,
        ...values.map(value => ({ ...value, ...(activeTab ? { tabId: activeTab } : {}) })))
      if (JSON.stringify(before) !== JSON.stringify(retained)) { writeDocContent(doc, retained); mutation.changed = true }
      if (move) {
        const span = docContentSpan(doc, move.to)
        if (span) for (const transfer of transfers) doc.getMap(`${transfer.kind}AnchorMoves`).set(transfer.id, {
          origin: transfer.origin, target: { blockId: move.to, section: false,
            anchor: docContentAnchor(span, transfer.range.from, transfer.range.to) },
        })
      }
    }, localOrigin)
    if (structural) this.undo?.stopCapturing()
    if (mutation.changed) {
      const span = move ? docContentSpan(doc, move.to) : undefined
      if (span && move) for (const { draft, range } of drafts) this.localCommentAnchors?.relocate({ ...draft, blockId: move.to,
        section: false, anchor: docContentAnchor(span, range.from, range.to) })
      this.localCommentAnchors?.restore(doc)
      this.changed()
    }
  }
  /** Insert a new editable block.
   * @param after - Optional predecessor block.
   * @param content - Initial Markdown source.
   */
  add(after?: string, content = ''): void {
    if (!this.doc || this.state.getSnapshot().readOnly) return
    const rows = this.doc.getArray<Y.Map<unknown>>('blocks'),
      row = new Y.Map<unknown>()
    row.set('id', randomUUID())
    row.set('label', '')
    row.set('text', new Y.Text(content))
    if (this.state.getSnapshot().activeTab) row.set('tabId', this.state.getSnapshot().activeTab)
    const items = orderedRows(this.doc).filter(item => (item.get('tabId') ?? this.server?.id) === this.state.getSnapshot().activeTab),
      index = after ? items.findIndex(b => b.get('id') === after) + 1 : items.length
    row.set('position', between(this.doc, items, index))
    this.undo?.stopCapturing()
    this.doc.transact(() => {
      rows.push([row])
      this.rewriteSections()
    }, localOrigin)
    this.undo?.stopCapturing()
    this.changed()
  }
  /** Delete or reorder one idle block.
   * @param id - Block identity.
   * @param direction - Zero deletes; otherwise moves up or down.
   */
  move(id: string, direction: number): void {
    if (
      !this.doc ||
      this.state.getSnapshot().readOnly ||
      this.server?.blocks.find(b => b.id === id)?.state === 'writing'
    )
      return
    const doc = this.doc,
      rows = doc.getArray<Y.Map<unknown>>('blocks'),
      items = orderedRows(doc).filter(item => (item.get('tabId') ?? this.server?.id) === this.state.getSnapshot().activeTab),
      index = items.findIndex(b => b.get('id') === id)
    const original = items[index]
    if (!original) return
    this.undo?.stopCapturing()
    this.doc.transact(() => {
      if (direction === 0) {
        const position = rowPosition(doc, original)
        rows.delete(rows.toArray().indexOf(original), 1)
        if (items.length === 1) {
          const blank = new Y.Map<unknown>()
          blank.set('id', randomUUID()); blank.set('label', ''); blank.set('text', new Y.Text()); blank.set('position', position)
          if (this.state.getSnapshot().activeTab) blank.set('tabId', this.state.getSnapshot().activeTab)
          rows.push([blank])
        }
        this.rewriteSections()
      } else {
        const target = Math.max(0, Math.min(items.length - 1, index + direction))
        const remaining = items.filter(item => item !== original)
        original.set('position', between(doc, remaining, target))
      }
    }, localOrigin)
    this.undo?.stopCapturing()
    this.changed()
  }
  private rewriteSections(): void {
    const doc = this.doc
    if (!doc) return
    for (const row of orderedRows(doc)) this.undo?.addToScope(docContentBody(doc,
      typeof row.get('tabId') === 'string' ? String(row.get('tabId')) : undefined))
    writeDocContent(doc, orderedRows(doc).map((row) => {
      const text = row.get('text'), id = String(row.get('id'))
      return { id, label: typeof row.get('label') === 'string' ? (row.get('label') as string) : '',
        content: docContentSource(doc, id) ?? (text instanceof Y.Text ? text.toJSON() : ''),
        ...(typeof row.get('tabId') === 'string' ? { tabId: String(row.get('tabId')) } : {}) }
    }))
  }
  private restoreCommentAnchors(): void {
    const doc = this.doc
    if (!doc) return
    // Yjs redo links are process-local. Persist canonical anchors for resurrected text types.
    doc.transact(() => {
      const records = [
        ...(this.server?.comments ?? []).map(thread => ({ thread, kind: 'comment' as const })),
        ...(this.server?.suggestions ?? []).filter(item => item.state === 'pending')
          .map(item => ({ thread: { ...item, section: false }, kind: 'suggestion' as const })),
      ]
      for (const { thread, kind } of records) {
        const resolved = this.commentRange(thread, kind)
        if (resolved.detached || resolved.section || !resolved.range) continue
        const span = docContentSpan(doc, resolved.blockId)
        if (!span) continue
        const { origin, expected, current } = docsCommentTarget(doc, thread, kind)
        let anchor = docContentAnchor(span, resolved.range.from, resolved.range.to)
        const end = resolved.ranges?.at(-1), endSpan = end ? docContentSpan(doc, end.blockId) : undefined
        if (end && endSpan) anchor = { start: anchor.start, end: docContentAnchor(endSpan, end.from, end.to).end }
        if (anchor.start === current.anchor.start && anchor.end === current.anchor.end) continue
        doc.getMap(`${kind}AnchorRepairs`).set(thread.id, { origin, expected,
          target: { blockId: resolved.blockId, section: false, anchor } })
      }
    })
  }
  /** Keep a synchronous editor command in its own local Undo step.
   * @param mutate - Synchronous command; asynchronous work needs a separate capture when it applies its result.
   */
  captureEdit(mutate: () => void): void {
    const undo = this.undo, timeout = undo?.captureTimeout
    undo?.stopCapturing()
    if (undo) undo.captureTimeout = Number.POSITIVE_INFINITY
    try { mutate() }
    finally {
      if (undo && timeout !== undefined) { undo.captureTimeout = timeout; undo.stopCapturing() }
    }
  }
  /** Undo this browser's edits without undoing server writes. */
  undoLocal(): void {
    this.undo?.undo()
    if (this.doc) canonicalizeDocContent(this.doc)
    if (this.doc) this.localCommentAnchors?.restore(this.doc)
    this.restoreCommentAnchors()
    this.changed()
  }
  /** Redo this browser's last undone edit. */
  redoLocal(): void {
    this.undo?.redo()
    if (this.doc) canonicalizeDocContent(this.doc)
    if (this.doc) this.localCommentAnchors?.restore(this.doc)
    this.restoreCommentAnchors()
    this.changed()
  }
  /** Switch documents only after pending changes are acknowledged.
   * @param id - Saved document identity.
   */
  async select(id: string): Promise<void> {
    await this.flush()
    clearTimeout(this.timer)
    const generation = ++this.generation
    try {
      const document = await this.transport.read({ workspaceId: this.workspaceId, docId: id })
      if (generation === this.generation) this.accept(document)
    } finally {
      this.schedule()
    }
  }
  /** Reveal a chat-linked document and optional thread after preserving pending edits.
   * @param id - Document in the current registered workspace.
   * @param threadId - Optional retained discussion to focus.
   */
  async reveal(id: string, threadId?: string): Promise<void> {
    await this.select(id)
    const state = this.state.getSnapshot()
    if (state.document?.id !== id) return
    const activeThread = state.document.comments?.some(thread => thread.id === threadId) ? threadId ?? null : null
    const blockId = state.document.comments?.find(thread => thread.id === activeThread)?.blockId
    const block = state.document.blocks.find(item => item.id === blockId)
    this.state.set({ ...state, activeThread, activeTab: block ? block.tabId ?? state.document.id : state.activeTab,
      revealVersion: state.revealVersion + 1 })
  }
  /** Import a local text document after saving this pane's current draft.
   * @param file - UTF-8 Markdown or text file.
   */
  async importFile(file: File): Promise<void> {
    if (this.token !== undefined) throw new Error('Only the document owner can import documents.')
    if (file.size > 200_000) throw new Error('Imported documents must be 200 KB or smaller.')
    await this.flush()
    const generation = this.generation, workspaceId = this.workspaceId
    const document = await this.transport.import({ workspaceId, name: file.name.slice(0, 200),
      dataBase64: encode(new Uint8Array(await file.arrayBuffer())) })
    if (generation !== this.generation || workspaceId !== this.workspaceId || this.closed)
      throw new Error('The document was imported. Return to its workspace library to open it.')
    this.accept(document)
    await this.refreshLibrary()
  }
  /** Upload files without switching scope or replacing typed text while the network is pending.
   * @param files - Browser-selected files, each at most the attachment protocol bound.
   * @returns Saved attachment metadata, ready for insertion at the captured editor location.
   */
  async uploadFiles(files: readonly File[]): Promise<readonly CopyOSDocAsset[]> {
    if (!this.server || this.state.getSnapshot().readOnly) throw new Error('This document does not allow uploads.')
    const generation = this.generation, docId = this.server.id, workspaceId = this.workspaceId, token = this.token
    await this.flush()
    const result: CopyOSDocAsset[] = []
    for (const file of files) {
      if (file.size > 4_000_000) throw new Error('Files must be 4 MB or smaller.')
      const dataBase64 = encode(new Uint8Array(await file.arrayBuffer()))
      const asset = await this.transport.putAsset({ workspaceId, docId, name: file.name.slice(0, 200), dataBase64,
        ...(token === undefined ? {} : { token }) })
      if (generation !== this.generation || this.state.getSnapshot().document?.id !== docId || this.closed) throw new Error('The document changed during upload. Open it to insert the file.')
      result.push(asset)
    }
    return result
  }
  /** Upload and append new blocks, preserving the current draft and document identity.
   * @param files - Browser-selected attachments.
   */
  async attachFiles(files: readonly File[]): Promise<void> {
    const assets = await this.uploadFiles(files)
    this.add(undefined, assets.map(docsAssetMarkdown).join('\n\n'))
  }
  /** Resolve an internal reference without exposing project paths or capabilities in the browser URL.
   * @param reference - Internal document asset URI.
   * @returns Verified metadata and an owned local Blob URL.
   */
  async resolveAsset(reference: string): Promise<DocsAssetSource> {
    const id = /^copyos-doc-asset:([a-f0-9]{64})$/u.exec(reference)?.[1]
    if (!id || !this.server) throw new Error('This attachment is not available.')
    const cached = this.assetCache.get(id)
    if (cached) return cached
    const epoch = this.assetEpoch
    const pending = this.transport.readAsset({ workspaceId: this.workspaceId, docId: this.server.id, assetId: id,
      ...(this.token === undefined ? {} : { token: this.token }) }).then((value) => {
      if (epoch !== this.assetEpoch || this.closed) throw new Error('The document changed while loading the attachment.')
      const url = URL.createObjectURL(new Blob([Uint8Array.from(decode(value.dataBase64))], { type: value.asset.mime }))
      this.assetURLs.add(url)
      return { ...value.asset, url }
    }).catch((error: unknown) => { if (this.assetCache.get(id) === pending) this.assetCache.delete(id); throw error })
    this.assetCache.set(id, pending)
    return pending
  }
  /** Refresh the library after saving the current draft.
   * @returns Completion after the workspace listing is current.
   */
  async refreshLibrary(): Promise<void> {
    await this.flush()
    if (this.token) return
    const generation = this.generation
    const [documents, trashedDocuments] = await Promise.all([
      this.transport.list(this.workspaceId), this.transport.list(this.workspaceId, true),
    ])
    if (generation === this.generation) this.state.set({ ...this.state.getSnapshot(), documents, trashedDocuments })
  }
  /** Duplicate the latest saved body into a new private document.
   * @param title - Localized title for the copy.
   */
  async duplicate(title: string): Promise<void> {
    await this.flush()
    if (!this.server) throw new Error('No document selected')
    this.accept(await this.transport.duplicate({ workspaceId: this.workspaceId, docId: this.server.id, title,
      ...(this.token === undefined ? {} : { token: this.token }) }))
    await this.refreshLibrary()
  }
  /** Trash or restore a document after acknowledging this pane's latest edits.
   * @param docId - Document identity.
   * @param trashed - Desired recoverable trash state.
   */
  async trash(docId: string, trashed: boolean): Promise<void> {
    if (trashed) await this.flush()
    const value = await this.transport.trash({ workspaceId: this.workspaceId, docId, trashed,
      ...(this.token === undefined ? {} : { token: this.token }) })
    if (this.server?.id === docId) this.accept(value)
    await this.refreshLibrary()
  }
  /** Create a blank document.
   * @param title - Initial localized title.
   */
  async create(title: string): Promise<void> {
    if (this.token !== undefined) throw new Error('Only the document owner can create a document')
    await this.flush()
    this.accept(
      await this.transport.create({
        workspaceId: this.workspaceId,
        title,
        sections: [],
        ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      }),
    )
  }
  /** Stop or resume the selected document.
   * @param stopped - Desired writing state.
   * @returns Updated document, including the epoch required by subsequent writing requests.
   */
  async control(stopped: boolean): Promise<CopyOSDocDocument> {
    if (!this.server) throw new Error('No document selected')
    const generation = this.generation, workspaceId = this.workspaceId, docId = this.server.id, token = this.token
    await this.flush()
    const document = await this.transport.control({ workspaceId, docId, stopped,
      ...(token === undefined ? {} : { token }) })
    if (stopped) { this.outlineStarted = undefined; recordDocsUsage('stopped') }
    if (generation === this.generation && !this.closed) this.accept(document)
    return document
  }
  /** Create a link role or revoke links.
   * @param role - Requested capability.
   * @returns Capability token.
   */
  async share(role: CopyOSDocShareRequest['role']): Promise<CopyOSDocShareValue> {
    if (!this.server) throw new Error('No document selected')
    await this.flush()
    const value = await this.transport.share({
      workspaceId: this.workspaceId,
      docId: this.server.id,
      role,
      ...(this.token === undefined ? {} : { token: this.token }),
    })
    if (role !== 'restricted') recordDocsUsage('shared')
    return value
  }
  /** Download the stored document after autosave finishes.
   * @param format - Export format.
   * @returns Server export.
   */
  async export(format: 'pdf' | 'markdown' | 'word'): Promise<CopyOSDocExportValue> {
    if (!this.server) throw new Error('No document selected')
    await this.flush()
    const value = await this.transport.export({
      workspaceId: this.workspaceId,
      docId: this.server.id,
      format,
      ...(this.token === undefined ? {} : { token: this.token }),
    })
    recordDocsUsage('exported')
    return value
  }
  /** Accept or reject a proposed edit after saving local text, preserving unrelated concurrent changes.
   * @param suggestionId - Proposal identity.
   * @param decision - Review action.
   * @param replacement - Optional user-edited replacement text.
   */
  async review(suggestionId: string, decision: 'accept' | 'reject', replacement?: string): Promise<void> {
    if (!this.server) return
    await this.flush()
    this.accept(
      await this.transport.review({
        workspaceId: this.workspaceId,
        docId: this.server.id,
        suggestionId,
        decision,
        ...(replacement === undefined ? {} : { replacement }),
        ...(this.token === undefined ? {} : { token: this.token }),
      }),
    )
    if (decision === 'accept') recordDocsUsage('suggestionAccepted')
  }
  private selectedRequest(): CopyOSDocReadRequest {
    if (!this.server) throw new Error('No document selected')
    return { workspaceId: this.workspaceId, docId: this.server.id, ...(this.token === undefined ? {} : { token: this.token }) }
  }
  /** Open a timeline only after local changes are safely saved.
   * @param before - Optional exclusive revision cursor.
   * @returns Saved entries and the head revision used by restore admission.
   */
  async history(before?: number): Promise<CopyOSDocHistoryListValue> {
    await this.flush()
    return this.transport.history({ ...this.selectedRequest(), ...(before === undefined ? {} : { before }) })
  }
  /** Read an immutable saved text revision.
   * @param revision - Saved content revision.
   * @returns Historical version and optional predecessor.
   */
  async version(revision: number): Promise<CopyOSDocHistoryReadValue> {
    return this.transport.version({ ...this.selectedRequest(), revision })
  }
  /** Set or clear a version's human-readable name.
   * @param revision - Saved content revision.
   * @param name - New name, or empty to clear.
   * @returns Renamed timeline entry.
   */
  async nameVersion(revision: number, name: string): Promise<CopyOSDocHistoryEntry> {
    return this.transport.nameVersion({ ...this.selectedRequest(), revision, name })
  }
  /** Restore as a new revision, refusing content changes made since history was opened.
   * @param revision - Saved version to restore.
   * @param expectedRevision - Head captured on the first timeline page.
   */
  async restore(revision: number, expectedRevision: number): Promise<void> {
    await this.flush()
    this.accept(await this.transport.restore({ ...this.selectedRequest(), revision, expectedRevision }))
    this.undo?.clear()
  }

  private commentRange(thread: CopyOSDocCommentThread): CopyOSDocCommentThread
  private commentRange(thread: Pick<CopyOSDocCommentThread, 'id' | 'blockId' | 'section' | 'anchor' | 'anchorOrigin'>,
    kind: 'comment' | 'suggestion'): CopyOSDocCommentTarget & { detached: boolean; range?: { from: number; to: number }; ranges?: CopyOSDocCommentThread['ranges'] }
  private commentRange(thread: Pick<CopyOSDocCommentThread, 'id' | 'blockId' | 'section' | 'anchor' | 'anchorOrigin' | 'range' | 'ranges'>,
    kind: 'comment' | 'suggestion' = 'comment') {
    const { range: _range, ranges: _ranges, ...original } = thread
    if (!this.doc) return { ...original, detached: true }
    const { origin, current } = docsCommentTarget(this.doc, thread, kind)
    const rest = { ...original, ...current, anchorOrigin: origin }
    try {
      if (current.section) {
        const span = docContentSpan(this.doc, current.blockId)
        return span ? { ...rest, detached: false, range: { from: 0, to: span.to - span.from } } : { ...rest, detached: true }
      }
      const locations = kind === 'comment' ? docContentLocations(this.doc, current.anchor) : []
      const location = docContentLocation(this.doc, current.blockId, current.anchor) ?? locations[0]
      if (!location || (kind === 'comment' && location.range.to <= location.range.from)) return { ...rest, detached: true }
      return { ...rest, blockId: location.blockId, detached: false, range: location.range,
        ...(locations.length > 1 ? { ranges: locations.map(item => ({ blockId: item.blockId, ...item.range })) } : {}) }
    } catch { return { ...rest, detached: true } }
  }
  /** Capture live Yjs positions before comment composition, so typing around the passage remains safe.
   * @param blockId - Section identity.
   * @param quote - Selected rendered text, or empty for a section thread.
   * @param range - Exact Markdown offsets from the rich editor, omitted for a section thread.
   * @param reattachId - Existing private draft to attach to an explicitly selected replacement passage.
   * @param parts - Ordered section passages for one selection crossing visible sections.
   * @returns A stable draft identity and relative anchor.
   */
  commentDraft(blockId: string, quote = '', range?: { from: number; to: number }, reattachId?: string, parts?: readonly DocsPageSelectionPart[]): CopyOSDocCommentDraft {
    const span = this.doc ? docContentSpan(this.doc, blockId) : undefined
    if (!span) throw new Error('This section is no longer available.')
    const from = range?.from ?? 0, to = range?.to ?? span.to - span.from
    if (from < 0 || to > span.to - span.from || from > to || (range && from === to)) throw new Error('Select a passage before commenting.')
    if (reattachId && !this.localCommentAnchors?.all().some(draft => draft.id === reattachId))
      throw new Error('This comment draft is no longer available.')
    let anchor = docContentAnchor(span, from, to)
    const last = parts && parts.length > 1 ? parts.at(-1) : undefined
    if (last) {
      const endSpan = this.doc ? docContentSpan(this.doc, last.blockId) : undefined
      if (!endSpan || endSpan.text !== span.text || endSpan.from < span.from) throw new Error('Select a passage in one document tab.')
      anchor = { start: anchor.start, end: docContentAnchor(endSpan, last.range.from, last.range.to).end }
    }
    const draft = { id: reattachId ?? randomUUID(), blockId, quote: quote.slice(0, 10_000), section: range === undefined,
      anchor }
    if (reattachId) this.localCommentAnchors?.retarget(draft)
    else this.localCommentAnchors?.capture(draft)
    const state = this.state.getSnapshot(); this.publish(state.status, state.error)
    return draft
  }
  /** Forget an explicitly cancelled draft anchor; the form owns clearing its unsent text.
   * @param id - Cancelled draft identity.
   */
  discardCommentDraft(id: string): void {
    this.localCommentAnchors?.forget(id)
    const state = this.state.getSnapshot(); this.publish(state.status, state.error)
  }
  /** Save queued text before posting one permission-checked comment action.
   * @param action - Human thread action.
   * @returns Current document, including the pending assistant request id when requested.
   */
  async comment(action: CopyOSDocCommentAction): Promise<CopyOSDocDocument> {
    await this.flush()
    const current = action.type === 'create' && this.localCommentAnchors
      ? { ...action, draft: this.localCommentAnchors.capture(action.draft) } : action
    const document = await this.transport.comment({ ...this.selectedRequest(), action: current })
    this.accept(document)
    if (action.type === 'create') recordDocsUsage('commentPosted')
    return document
  }

  /** Remember comment focus in the pane's observable state, including context sent from Suite to a Session.
   * @param id - Thread to reveal, or null to clear the passage focus.
   */
  focusComment(id: string | null): void {
    const state = this.state.getSnapshot(), blockId = state.document?.comments?.find(thread => thread.id === id)?.blockId
    const block = state.document?.blocks.find(item => item.id === blockId)
    this.state.set({ ...state, activeThread: id,
      activeTab: block && state.document ? block.tabId ?? state.document.id : state.activeTab })
  }

}
