/** Three-way rebase of unsaved design edits onto a newer saved revision, merging by layer property and document field. */
import { parseDesignDocument } from './design-schema.ts'
import type { CopyOSDesignDocument } from './types.ts'

/** One overlapping change that blocks a rebase; `nodeId` is null for document-level fields and layer order. */
export interface DesignRebaseConflict {
  nodeId: string | null
  /** Layer name from the local or newer version, or the document field. */
  name: string
  reason: 'both-changed' | 'deleted-locally' | 'deleted-remotely' | 'order' | 'parent-missing' | 'invalid'
}

/** Rebase result: the merged document at the newer revision, or every conflict found. */
export type DesignRebaseResult =
  | { state: 'merged'; document: CopyOSDesignDocument }
  | { state: 'conflict'; conflicts: DesignRebaseConflict[] }

const documentMetadata = new Set(['schema', 'version', 'id', 'revision', 'createdAt', 'updatedAt', 'nodes'])

// JSON-value equality that ignores key order and keys whose value is undefined.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => same(item, b[index]))
  const left = Object.entries(a).filter(([, value]) => value !== undefined)
  const right = new Map(Object.entries(b).filter(([, value]) => value !== undefined))
  return left.length === right.size && left.every(([key, value]) => right.has(key) && same(value, right.get(key)))
}

function keys(...values: object[]): Set<string> {
  return new Set(values.flatMap(value => Object.keys(value)))
}

/**
 * Apply the changes between `base` and `local` on top of `remote`, a newer saved revision of the same design.
 * Each layer property and document field merges independently; a value changed differently on both sides, a layer edited on one
 * side and deleted on the other, both sides reordering layers differently, or a layer whose parent the other side deleted is a conflict.
 * @param base - Saved revision the local edits started from.
 * @param local - Current unsaved document.
 * @param remote - Newer saved revision of the same design.
 * @returns The merged document carrying `remote.revision`, validated by the design schema, or the conflicts that prevent it.
 */
export function rebaseDesignDocument(base: CopyOSDesignDocument, local: CopyOSDesignDocument,
  remote: CopyOSDesignDocument): DesignRebaseResult {
  const conflicts: DesignRebaseConflict[] = []
  const merged: Record<string, unknown> = { ...remote }
  const record = (value: CopyOSDesignDocument): Record<string, unknown> => ({ ...value })
  const [b, l, r] = [record(base), record(local), record(remote)]
  for (const key of keys(b, l, r)) {
    if (documentMetadata.has(key)) continue
    const localChanged = !same(b[key], l[key]), remoteChanged = !same(b[key], r[key])
    if (localChanged && remoteChanged && !same(l[key], r[key])) conflicts.push({ nodeId: null, name: key, reason: 'both-changed' })
    else if (localChanged) merged[key] = l[key]
  }
  const byId = (value: CopyOSDesignDocument) => new Map(value.nodes.map(node => [node.id, node]))
  const [baseNodes, localNodes, remoteNodes] = [byId(base), byId(local), byId(remote)]
  const nodes = new Map<string, Readonly<Record<string, unknown>>>()
  for (const id of new Set([...baseNodes.keys(), ...localNodes.keys(), ...remoteNodes.keys()])) {
    const original = baseNodes.get(id), mine = localNodes.get(id), theirs = remoteNodes.get(id)
    const name = mine?.name ?? theirs?.name ?? original?.name ?? id
    if (!original) {
      const added = mine ?? theirs
      if (added) nodes.set(id, { ...added })
      continue
    }
    if (!mine || !theirs) {
      const kept = mine ?? theirs
      if (kept && !same(original, kept)) conflicts.push({ nodeId: id, name, reason: mine ? 'deleted-remotely' : 'deleted-locally' })
      continue
    }
    const o: Record<string, unknown> = { ...original }, m: Record<string, unknown> = { ...mine }
    const t: Record<string, unknown> = { ...theirs }, fields: Record<string, unknown> = {}
    for (const key of keys(o, m, t)) {
      const localChanged = !same(o[key], m[key]), remoteChanged = !same(o[key], t[key])
      if (localChanged && remoteChanged && !same(m[key], t[key])) conflicts.push({ nodeId: id, name: `${name} › ${key}`, reason: 'both-changed' })
      const value = localChanged ? m[key] : t[key]
      if (value !== undefined) fields[key] = value
    }
    nodes.set(id, fields)
  }
  // Layer order: the side that reordered the layers both sides kept wins; both reordering differently conflicts.
  const sequence = (value: CopyOSDesignDocument, ids: ReadonlySet<string>) => value.nodes.map(node => node.id).filter(id => ids.has(id))
  const common = new Set([...baseNodes.keys()].filter(id => localNodes.has(id) && remoteNodes.has(id)))
  const [baseOrder, localOrder, remoteOrder] = [sequence(base, common), sequence(local, common), sequence(remote, common)]
  const localReordered = !same(baseOrder, localOrder), remoteReordered = !same(baseOrder, remoteOrder)
  if (localReordered && remoteReordered && !same(localOrder, remoteOrder))
    conflicts.push({ nodeId: null, name: 'layer order', reason: 'order' })
  const primary = localReordered ? local : remote, secondary = localReordered ? remote : local
  const order = primary.nodes.map(node => node.id).filter(id => nodes.has(id))
  // Layers only the other side added follow their nearest preceding layer from that side.
  const secondaryIds = secondary.nodes.map(node => node.id)
  for (const [index, id] of secondaryIds.entries()) {
    if (!nodes.has(id) || order.includes(id)) continue
    const previous = secondaryIds.slice(0, index).reverse().find(item => order.includes(item))
    order.splice(previous === undefined ? order.length : order.indexOf(previous) + 1, 0, id)
  }
  for (const [id, node] of nodes) {
    const parentId = node.parentId
    if (typeof parentId === 'string' && !nodes.has(parentId))
      conflicts.push({ nodeId: id, name: typeof node.name === 'string' ? node.name : id, reason: 'parent-missing' })
  }
  if (conflicts.length) return { state: 'conflict', conflicts }
  merged.nodes = order.flatMap(id => nodes.get(id) ?? [])
  try {
    return { state: 'merged', document: parseDesignDocument(merged) }
  } catch (error: unknown) {
    return { state: 'conflict', conflicts: [{ nodeId: null, name: error instanceof Error ? error.message : String(error), reason: 'invalid' }] }
  }
}
