/** Durable browser copies of unsaved Canvas work, offered for explicit recovery after a reload or crash. */
import { parseDesignDocument } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'

/** One workspace's latest unsaved document and the saved revision it was edited from. */
export interface DesignerDurableDraft {
  version: 1
  workspaceId: string
  /** Saved revision the edits started from; a different saved revision means the server moved on. */
  revision: number
  document: CopyOSDesignDocument
  /** ISO time of the last recorded edit. */
  savedAt: string
}

/** Asynchronous draft persistence; every method resolves even when storage is unavailable. */
export interface DesignerDraftStore {
  read: (workspaceId: string) => Promise<DesignerDurableDraft | undefined>
  write: (draft: DesignerDurableDraft) => Promise<void>
  clear: (workspaceId: string) => Promise<void>
}

/**
 * Validate a stored draft record before it can reach the editor.
 * @param value - Untrusted browser storage content.
 * @returns The draft with a fully parsed design document, or undefined when malformed.
 */
export function parseDesignerDurableDraft(value: unknown): DesignerDurableDraft | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || !('workspaceId' in value) || !('savedAt' in value) ||
    !('revision' in value) || !('document' in value)) return undefined
  const { version, workspaceId, savedAt, revision, document } = value
  if (version !== 1 || typeof workspaceId !== 'string' || typeof savedAt !== 'string' || typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) || revision < 0) return undefined
  try {
    return { version: 1, workspaceId, revision, savedAt, document: parseDesignDocument(document) }
  } catch (_error) {
    return undefined /* A draft from an incompatible or corrupt write is not recoverable and is ignored. */
  }
}

const database = 'copyos-canvas-drafts', store = 'drafts'
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(store, { keyPath: 'workspaceId' }) }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('Draft storage is unavailable')) }
  })
}
async function run<T>(mode: IDBTransactionMode, action: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode), request = action(transaction.objectStore(store))
      transaction.oncomplete = () => { resolve(request.result) }
      transaction.onerror = () => { reject(transaction.error ?? new Error('Draft storage failed')) }
      transaction.onabort = () => { reject(transaction.error ?? new Error('Draft storage was aborted')) }
    })
  } finally { db.close() }
}

/**
 * IndexedDB store for this app origin; storage failures leave Canvas usable with in-memory drafts only.
 * @returns A store, or one that records nothing when IndexedDB is unavailable.
 */
export function indexedDbDesignerDraftStore(): DesignerDraftStore {
  if (typeof indexedDB === 'undefined')
    return { read: () => Promise.resolve(undefined), write: () => Promise.resolve(), clear: () => Promise.resolve() }
  return {
    read: async (workspaceId) => {
      try { return parseDesignerDurableDraft(await run('readonly', objects => objects.get(workspaceId))) }
      catch (_error) { return undefined /* Unreadable storage means there is nothing to offer. */ }
    },
    write: async (draft) => {
      try { await run('readwrite', objects => objects.put(draft)) }
      catch (_error) { /* Quota or private-mode failures keep the in-memory draft only. */ }
    },
    clear: async (workspaceId) => {
      try { await run('readwrite', objects => objects.delete(workspaceId)) }
      catch (_error) { /* A stale record is validated against saved revisions before it is offered. */ }
    },
  }
}
