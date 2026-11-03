/** Undoable comment targets travel with a page edit while original thread records remain immutable. */
import type * as Y from 'yjs'
import { docContentLocation, docContentLocations } from '../../../copyos-domain/src/docs-content.ts'
import type { CopyOSDocCommentTarget, CopyOSDocCommentThread } from '../../../copyos-domain/src/types.ts'
function target(value: unknown): value is CopyOSDocCommentTarget {
  return typeof value === 'object' && value !== null && 'blockId' in value && typeof value.blockId === 'string'
    && 'section' in value && typeof value.section === 'boolean' && 'anchor' in value
    && typeof value.anchor === 'object' && value.anchor !== null
    && 'start' in value.anchor && typeof value.anchor.start === 'string'
    && 'end' in value.anchor && typeof value.anchor.end === 'string'
}
/** Read a validated anchor transfer, falling back only when the original has no matching transfer.
 * @param doc - Local shared document.
 * @param thread - Public thread, possibly already projected at a transferred location.
 * @param kind - Collection owning the anchored record.
 * @returns Current target plus its immutable original.
 */
export function docsCommentTarget(doc: Y.Doc, thread: Pick<CopyOSDocCommentThread, 'id' | 'blockId' | 'section' | 'anchor' | 'anchorOrigin'>,
  kind: 'comment' | 'suggestion' = 'comment'):
{ origin: CopyOSDocCommentTarget; current: CopyOSDocCommentTarget; expected: CopyOSDocCommentTarget } {
  const origin = thread.anchorOrigin ?? { blockId: thread.blockId, section: thread.section, anchor: thread.anchor }
  const value = doc.getMap<unknown>(`${kind}AnchorMoves`).get(thread.id)
  let move: { origin: CopyOSDocCommentTarget; target: CopyOSDocCommentTarget } | undefined
  if (value !== undefined) {
    if (typeof value !== 'object' || value === null || !('origin' in value) || !('target' in value)
      || !target(value.origin) || !target(value.target)) throw new Error('Invalid document comment anchor transfer')
    move = { origin: value.origin, target: value.target }
  }
  const same = (left: CopyOSDocCommentTarget, right: CopyOSDocCommentTarget): boolean =>
    left.blockId === right.blockId && left.section === right.section
    && left.anchor.start === right.anchor.start && left.anchor.end === right.anchor.end
  const expected = move && same(move.origin, origin) ? move.target : origin
  const repair = doc.getMap<unknown>(`${kind}AnchorRepairs`).get(thread.id)
  if (repair === undefined) {
    const location = docContentLocation(doc, expected.blockId, expected.anchor)
      ?? (kind === 'comment' ? docContentLocations(doc, expected.anchor)[0] : undefined)
    return { origin, expected, current: location && location.blockId !== expected.blockId
      ? { ...expected, blockId: location.blockId, section: false } : expected }
  }
  if (typeof repair !== 'object' || repair === null || !('origin' in repair) || !('expected' in repair) || !('target' in repair)
    || !target(repair.origin) || !target(repair.expected) || !target(repair.target)) throw new Error('Invalid restored comment anchor')
  const current = same(repair.origin, origin) && same(repair.expected, expected) ? repair.target : expected
  const location = docContentLocation(doc, current.blockId, current.anchor)
    ?? (kind === 'comment' ? docContentLocations(doc, current.anchor)[0] : undefined)
  return { origin, expected, current: location && location.blockId !== current.blockId
    ? { ...current, blockId: location.blockId, section: false } : current }
}
