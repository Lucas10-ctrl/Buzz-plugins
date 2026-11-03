/** Browser-local recovery for unsent feedback; draft text never posts without a user action. */
import type { CopyOSDocCommentDraft } from '../../../copyos-domain/src/types.ts'

/** One unsent comment keeps its original Yjs anchor across document navigation and reload. */
export interface DocsRecoveredComment { readonly draft: CopyOSDocCommentDraft; readonly text: string }
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu
function parseComment(value: unknown): DocsRecoveredComment | null {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string' || value.text.length > 5000
    || !('draft' in value) || !value.draft || typeof value.draft !== 'object') return null
  const draft = value.draft
  if (!('id' in draft) || typeof draft.id !== 'string' || !uuid.test(draft.id)
    || !('blockId' in draft) || typeof draft.blockId !== 'string' || !uuid.test(draft.blockId)
    || !('quote' in draft) || typeof draft.quote !== 'string' || draft.quote.length > 10_000
    || !('section' in draft) || typeof draft.section !== 'boolean'
    || !('anchor' in draft) || !draft.anchor || typeof draft.anchor !== 'object'
    || !('start' in draft.anchor) || typeof draft.anchor.start !== 'string' || draft.anchor.start.length > 4096
    || !('end' in draft.anchor) || typeof draft.anchor.end !== 'string' || draft.anchor.end.length > 4096) return null
  return { text: value.text, draft: { id: draft.id, blockId: draft.blockId, quote: draft.quote,
    section: draft.section, anchor: { start: draft.anchor.start, end: draft.anchor.end } } }
}
/** Scope feedback to the current browser profile, workspace and document, without storing link credentials.
 * @param workspaceId - Registered workspace.
 * @param docId - Authorized document identity.
 * @returns Storage prefix for this document's unsent feedback.
 */
export function commentDraftPrefix(workspaceId: string, docId: string): string {
  return `copyos.docs.feedback.${encodeURIComponent(workspaceId)}.${encodeURIComponent(docId)}.`
}
/** Read bounded anchored comments; malformed browser records are ignored without executing their content.
 * @param prefix - Document-specific prefix.
 * @returns Valid unsent comments in storage order.
 */
export function readCommentDrafts(prefix: string): readonly DocsRecoveredComment[] {
  const result: DocsRecoveredComment[] = []
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`${prefix}new.`)) continue
      const stored = localStorage.getItem(key)
      if (!stored || stored.length > 100_000) continue
      try {
        const value: unknown = JSON.parse(stored), comment = parseComment(value)
        if (comment && key === `${prefix}new.${comment.draft.id}` && comment.text.trim()) result.push(comment)
      } catch (_error) { /* Invalid JSON is not a recoverable draft. */ }
    }
  } catch (error) { console.warn('Unable to read unsent comments', error) }
  return result
}
/** Persist or clear one anchored comment; callers retain visible text and report storage failures.
 * @param prefix - Document-specific prefix.
 * @param draft - Original captured anchor.
 * @param text - Current composition, at most the comment protocol limit.
 */
export function saveCommentDraft(prefix: string, draft: CopyOSDocCommentDraft, text: string): void {
  const key = `${prefix}new.${draft.id}`
  if (text.trim()) localStorage.setItem(key, JSON.stringify({ draft, text }))
  else localStorage.removeItem(key)
}
/** Recover an unsent reply, without treating malformed or oversized records as input.
 * @param prefix - Document-specific prefix.
 * @param threadId - Retained discussion identity.
 * @returns Recovered text and retry identity, or null when unavailable.
 */
export function readReplyDraft(prefix: string, threadId: string): { id: string; text: string } | null {
  try {
    const stored = localStorage.getItem(`${prefix}reply.${threadId}`)
    if (!stored || stored.length > 40_000) return null
    const value: unknown = JSON.parse(stored)
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && uuid.test(value.id)
      && 'text' in value && typeof value.text === 'string' && value.text.length <= 5000)
      return { id: value.id, text: value.text }
  } catch (error) { console.warn('Unable to read an unsent reply', error) }
  return null
}
/** Save or clear a reply; storage failures remain visible to the composer.
 * @param prefix - Document-specific prefix.
 * @param threadId - Retained discussion identity.
 * @param reply - Unsent text and retry identity, or null to clear.
 */
export function saveReplyDraft(prefix: string, threadId: string, reply: { id: string; text: string } | null): void {
  const key = `${prefix}reply.${threadId}`
  if (reply?.text.trim()) localStorage.setItem(key, JSON.stringify(reply))
  else localStorage.removeItem(key)
}

/** An unsaved posted-comment edit retains the exact server version it began from. */
export interface DocsCommentEditDraft {
  readonly before: string
  readonly editedAt: string | null
  readonly text: string
  readonly updatedAt: number
}
function parseEdit(value: unknown): DocsCommentEditDraft | null {
  if (!value || typeof value !== 'object' || !('before' in value) || typeof value.before !== 'string'
    || !value.before || value.before.length > 5000 || !('text' in value) || typeof value.text !== 'string' || value.text.length > 5000
    || !('updatedAt' in value) || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0
    || !('editedAt' in value) || (value.editedAt !== null && (typeof value.editedAt !== 'string'
      || !Number.isFinite(Date.parse(value.editedAt)) || new Date(value.editedAt).toISOString() !== value.editedAt))) return null
  return { before: value.before, editedAt: value.editedAt, text: value.text, updatedAt: value.updatedAt }
}
/** Recover one message edit without opening or submitting it.
 * @param prefix - Workspace/document feedback prefix.
 * @param threadId - Discussion identity.
 * @param messageId - Posted message identity.
 * @returns Bounded original version and unsent text, or null for unavailable/invalid records.
 */
export function readCommentEditDraft(prefix: string, threadId: string, messageId: string): DocsCommentEditDraft | null {
  try {
    const stored = localStorage.getItem(`${prefix}edit.${threadId}.${messageId}`)
    if (!stored || stored.length > 80_000) return null
    const value: unknown = JSON.parse(stored)
    return parseEdit(value)
  } catch (error) { console.warn('Unable to read an unsent comment edit', error) }
  return null
}
/** Save a composition, including an intentionally empty edit; storage failure must remain visible to its editor.
 * @param prefix - Workspace/document feedback prefix.
 * @param threadId - Discussion identity.
 * @param messageId - Posted message identity.
 * @param draft - Exact server version and current unsent text.
 */
export function saveCommentEditDraft(prefix: string, threadId: string, messageId: string, draft: DocsCommentEditDraft): void {
  localStorage.setItem(`${prefix}edit.${threadId}.${messageId}`, JSON.stringify(draft))
}
/** Clear only the submitted or cancelled composition, retaining newer edits from another pane.
 * @param prefix - Workspace/document feedback prefix.
 * @param threadId - Discussion identity.
 * @param messageId - Posted message identity.
 * @param expected - Composition whose save/cancel just completed.
 */
export function clearCommentEditDraft(prefix: string, threadId: string, messageId: string, expected: DocsCommentEditDraft): void {
  const key = `${prefix}edit.${threadId}.${messageId}`, stored = localStorage.getItem(key)
  if (!stored || stored.length > 80_000) return
  let value: unknown
  try { value = JSON.parse(stored) }
  catch (_error) { return /* A malformed or newer record is not this completed composition. */ }
  const current = parseEdit(value)
  if (current?.before === expected.before && current.editedAt === expected.editedAt
    && current.text === expected.text && current.updatedAt === expected.updatedAt) localStorage.removeItem(key)
}
