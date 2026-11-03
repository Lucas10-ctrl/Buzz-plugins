/** Anchored document threads and permission-checked mutations, run under the document repository's queue. */
import { randomUUID, createHash } from 'node:crypto'
import * as Y from 'yjs'
import { docContentSpan, docContentLocation, docContentLocations } from './docs-content.ts'
import { z } from 'zod'
import type { CopyOSDocCommentThread, CopyOSDocCommentAction, CopyOSDocCommentReplyRequest, CopyOSDocCommentTarget } from './types.ts'

const anchor = z.object({ start: z.string().max(4000), end: z.string().max(4000) }).strict()
const reaction = z.object({ emoji: z.string(), actors: z.array(z.string()).max(100) }).strict()
const message = z.object({
  id: z.uuid(), author: z.enum(['user', 'assistant']), authorId: z.string().max(200),
  text: z.string().max(5000), deleted: z.boolean(), createdAt: z.iso.datetime(), editedAt: z.iso.datetime().optional(),
  mentions: z.array(z.string()).max(100), reactions: z.array(reaction).max(6), requestId: z.uuid().optional(),
}).strict()
/** Persisted thread schema; relative positions are resolved against the live document. */
export const docCommentSchema = z.object({
  id: z.uuid(), blockId: z.uuid(), quote: z.string().max(10_000), section: z.boolean(), anchor,
  resolved: z.boolean(), createdAt: z.iso.datetime(), messages: z.array(message).min(1).max(200),
  assistant: z.object({ id: z.uuid(), messageId: z.uuid(), requestedBy: z.string(), requestedAt: z.iso.datetime(),
    state: z.enum(['pending', 'answered', 'failed', 'cancelled']) }).strict().optional(),
}).strict()
/** Internal thread including authority data, never returned directly by the host. */
export type DocCommentRecord = z.infer<typeof docCommentSchema>
/** The host owner and each capability have distinct comment identities; public ids never equal capability hashes.
 * @param token - Optional sharing capability.
 * @returns Stable comment participant identity.
 */
export function docCommentActor(token?: string): string {
  return token === undefined ? 'owner' : createHash('sha256').update(`doc-comment:${token}`).digest('hex')
}
const targetSchema = z.object({ blockId: z.uuid(), section: z.boolean(), anchor }).strict()
const repairSchema = z.object({ origin: targetSchema, expected: targetSchema, target: targetSchema }).strict()
const moveSchema = z.object({ origin: targetSchema, target: targetSchema }).strict()
/** Validate editor-owned anchor transfers before accepting a shared update.
 * @param doc - Updated document.
 * @param threads - Existing server-owned anchored records.
 * @param kind - Collection whose editor-owned transfers are validated.
 */
export function validateDocCommentMoves(doc: Y.Doc, threads: readonly Pick<DocCommentRecord, 'id' | 'blockId' | 'section' | 'anchor'>[],
  kind: 'comment' | 'suggestion' = 'comment'): void {
  const moves = doc.getMap<unknown>(`${kind}AnchorMoves`)
  if (moves.size > (kind === 'comment' ? 500 : 1000)) throw new Error('Too many document comment anchor transfers.')
  for (const [id, value] of moves) {
    const move = moveSchema.parse(value), thread = threads.find(thread => thread.id === id)
    if (!thread || !sameTarget(move.origin, thread)) throw new Error('Comment anchor transfer has no matching original.')
    if (kind === 'suggestion' && move.target.section) throw new Error('Suggestion anchors must target a passage.')
    for (const encoded of [move.target.anchor.start, move.target.anchor.end]) {
      Y.decodeRelativePosition(Buffer.from(encoded, 'base64'))
    }
  }
  const repairs = doc.getMap<unknown>(`${kind}AnchorRepairs`)
  if (repairs.size > (kind === 'comment' ? 500 : 1000)) throw new Error('Too many restored comment anchors.')
  for (const [id, value] of repairs) {
    const repair = repairSchema.parse(value), thread = threads.find(thread => thread.id === id)
    if (!thread || !sameTarget(repair.origin, thread)) throw new Error('Restored comment anchor has no matching original.')
    if (kind === 'suggestion' && repair.target.section) throw new Error('Suggestion anchors must target a passage.')
    for (const encoded of [repair.target.anchor.start, repair.target.anchor.end]) Y.decodeRelativePosition(Buffer.from(encoded, 'base64'))
  }
}
function sameTarget(left: CopyOSDocCommentTarget, right: CopyOSDocCommentTarget): boolean {
  return left.blockId === right.blockId && left.section === right.section
    && left.anchor.start === right.anchor.start && left.anchor.end === right.anchor.end
}
/** Resolve a thread's undoable location without overwriting its original durable anchor.
 * @param doc - Current shared document.
 * @param thread - Original server-owned thread target.
 * @param kind - Collection owning the anchored record.
 * @returns Current target, or the original when no transfer applies.
 */
export function docCommentTarget(doc: Y.Doc, thread: Pick<DocCommentRecord, 'id' | 'blockId' | 'section' | 'anchor'>,
  kind: 'comment' | 'suggestion' = 'comment'):
CopyOSDocCommentTarget {
  const value = doc.getMap<unknown>(`${kind}AnchorMoves`).get(thread.id)
  const move = value === undefined ? undefined : moveSchema.parse(value)
  const expected = move && sameTarget(move.origin, thread) ? move.target : thread
  const repairValue = doc.getMap<unknown>(`${kind}AnchorRepairs`).get(thread.id)
  if (repairValue === undefined) {
    const location = docContentLocation(doc, expected.blockId, expected.anchor)
      ?? (kind === 'comment' ? docContentLocations(doc, expected.anchor)[0] : undefined)
    return location && location.blockId !== expected.blockId ? { ...expected, blockId: location.blockId, section: false } : expected
  }
  const repair = repairSchema.parse(repairValue)
  const current = sameTarget(repair.origin, thread) && sameTarget(repair.expected, expected) ? repair.target : expected
  const location = docContentLocation(doc, current.blockId, current.anchor)
    ?? (kind === 'comment' ? docContentLocations(doc, current.anchor)[0] : undefined)
  return location && location.blockId !== current.blockId ? { ...current, blockId: location.blockId, section: false } : current
}
/** Resolve passage boundaries without dropping a thread whose text or block disappeared.
 * @param doc - Live Yjs document.
 * @param thread - Thread identity and relative anchor.
 * @returns Current offsets, or undefined for a detached passage.
 */
export function docCommentRange(doc: Y.Doc, thread: Pick<DocCommentRecord, 'blockId' | 'anchor' | 'section'>):
  { from: number; to: number } | undefined {
  try {
    if (thread.section) {
      const span = docContentSpan(doc, thread.blockId)
      return span ? { from: 0, to: span.to - span.from } : undefined
    }
    const location = docContentLocation(doc, thread.blockId, thread.anchor) ?? docContentLocations(doc, thread.anchor)[0]
    return location && location.range.to > location.range.from ? location.range : undefined
  } catch { return undefined /* Removed or invalid anchors remain readable in Detached. */ }
}
/** Project ownership, reaction counts and live ranges for the current reader.
 * @param threads - Stored threads.
 * @param doc - Live Yjs document.
 * @param actor - Requester's comment identity.
 * @param owner - Whether the reader can moderate all messages.
 * @returns Public threads without participant ids or request authority.
 */
export function projectDocComments(threads: readonly DocCommentRecord[], doc: Y.Doc, actor: string, owner: boolean):
readonly CopyOSDocCommentThread[] {
  return threads.map((thread) => {
    const target = docCommentTarget(doc, thread), range = docCommentRange(doc, target)
    const ranges = target.section ? [] : docContentLocations(doc, target.anchor).map(item => ({ blockId: item.blockId, ...item.range }))
    const request = thread.assistant
    return { id: thread.id, blockId: target.blockId, quote: thread.quote, section: target.section,
      anchor: target.anchor, ...(target === thread ? {} : { anchorOrigin: {
        blockId: thread.blockId, section: thread.section, anchor: thread.anchor,
      } }),
      resolved: thread.resolved, createdAt: thread.createdAt, detached: range === undefined,
      mentioned: thread.messages.some(item => !item.deleted && item.mentions.includes(actor)),
      ...(range === undefined ? {} : { range }), ...(ranges.length > 1 ? { ranges } : {}),
      ...(request === undefined ? {} : { assistant: { id: request.id, messageId: request.messageId, state: request.state } }),
      messages: thread.messages.map(item => ({ id: item.id, author: item.author, mine: item.authorId === actor,
        canEdit: item.author === 'user' && item.authorId === actor && !item.deleted,
        canDelete: owner || (item.author === 'user' && item.authorId === actor),
        text: item.deleted ? '' : item.text, deleted: item.deleted, createdAt: item.createdAt,
        ...(item.editedAt === undefined ? {} : { editedAt: item.editedAt }),
        reactions: item.reactions.filter(item => item.actors.length > 0).map(item => ({ emoji: item.emoji,
          count: item.actors.length, mine: item.actors.includes(actor) })),
      })),
    }
  })
}
const uuid = z.uuid(), text = z.string().trim().min(1).max(5000)
/** Human comment operations admitted by the original document repository. */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), draft: z.object({ id: uuid, blockId: uuid, quote: z.string().max(10_000),
    section: z.boolean(), anchor }).strict(), text, requestAssistant: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('reply'), threadId: uuid, id: uuid, text, requestAssistant: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('edit'), threadId: uuid, messageId: uuid, text,
    expectedText: z.string().min(1).max(5000), expectedEditedAt: z.iso.datetime().nullable() }).strict(),
  z.object({ type: z.literal('delete'), threadId: uuid, messageId: uuid }).strict(),
  z.object({ type: z.literal('undelete'), threadId: uuid, messageId: uuid }).strict(),
  z.object({ type: z.literal('resolve'), threadId: uuid, resolved: z.boolean() }).strict(),
  z.object({ type: z.literal('react'), threadId: uuid, messageId: uuid, emoji: z.enum(['👍', '❤️', '🎉', '👀', '✅', '❓']) }).strict(),
  z.object({ type: z.literal('ask'), threadId: uuid }).strict(),
  z.object({ type: z.literal('assistant-failed'), threadId: uuid, requestId: uuid }).strict(),
])
function admitMessage(threads: readonly DocCommentRecord[], thread?: DocCommentRecord): void {
  if (threads.reduce((sum, item) => sum + item.messages.length, 0) >= 2000 || (thread?.messages.length ?? 0) >= 200)
    throw new Error('This document has reached its comment limit. Start another document to continue the discussion.')
}
function ask(thread: DocCommentRecord, actor: string, owner: boolean, messageId: string): void {
  if (!owner) throw new Error('Open this document from your own workspace to ask the assistant.')
  if (thread.resolved) throw new Error('Reopen this thread before asking the assistant.')
  if (thread.assistant?.state === 'pending' && thread.assistant.messageId === messageId) return
  thread.assistant = { id: randomUUID(), messageId, requestedBy: actor, requestedAt: new Date().toISOString(), state: 'pending' }
}
/** Apply a human comment action; the caller has already admitted commenter-or-editor access.
 * @param threads - Stored threads to mutate.
 * @param doc - Live document for anchor admission.
 * @param input - Validated human operation.
 * @param actor - Requester identity.
 * @param owner - Whether owner-scoped AI requests and moderation are permitted.
 * @returns The thread affected by the operation.
 */
export function applyDocComment(threads: DocCommentRecord[], doc: Y.Doc, input: CopyOSDocCommentAction,
  actor: string, owner: boolean): DocCommentRecord {
  const operation = actionSchema.parse(input)
  if (operation.type === 'create') {
    const existing = threads.find(item => item.id === operation.draft.id)
    if (existing) {
      if (existing.messages[0]?.authorId !== actor || existing.messages[0].text !== operation.text)
        throw new Error('Comment identity already belongs to another message.')
      return existing
    }
    if (threads.length >= 500) throw new Error('This document has reached its thread limit.')
    admitMessage(threads)
    if (!docCommentRange(doc, operation.draft)) throw new Error('The selected passage changed or was removed. Select it again before commenting.')
    const now = new Date().toISOString()
    const thread: DocCommentRecord = { ...operation.draft, resolved: false, createdAt: now,
      messages: [{ id: operation.draft.id, author: 'user', authorId: actor, text: operation.text, deleted: false,
        createdAt: now, mentions: [], reactions: [] }] }
    if (operation.requestAssistant) ask(thread, actor, owner, operation.draft.id)
    threads.push(thread)
    return thread
  }
  const thread = threads.find(item => item.id === operation.threadId)
  if (!thread) throw new Error('This comment thread is no longer available.')
  if (operation.type === 'reply') {
    const existing = thread.messages.find(item => item.id === operation.id)
    if (existing) {
      if (existing.authorId !== actor || existing.text !== operation.text) throw new Error('Reply identity belongs to another message.')
      return thread
    }
    if (thread.resolved) throw new Error('Reopen this thread before replying.')
    admitMessage(threads, thread)
    if (operation.requestAssistant) ask(thread, actor, owner, operation.id)
    thread.messages.push({ id: operation.id, author: 'user', authorId: actor, text: operation.text, deleted: false,
      createdAt: new Date().toISOString(), mentions: [], reactions: [] })
    return thread
  }
  if (operation.type === 'resolve') {
    thread.resolved = operation.resolved
    if (operation.resolved && thread.assistant?.state === 'pending') thread.assistant.state = 'cancelled'
    return thread
  }
  if (operation.type === 'ask') {
    const latest = [...thread.messages].reverse().find(item => item.author === 'user' && !item.deleted)
    if (!latest) throw new Error('There is no comment for the assistant to answer.')
    ask(thread, actor, owner, latest.id)
    return thread
  }
  if (operation.type === 'assistant-failed') {
    if (!owner) throw new Error('Only the document owner can manage assistant requests.')
    if (thread.assistant?.id === operation.requestId && thread.assistant.state === 'pending') thread.assistant.state = 'failed'
    return thread
  }
  const item = thread.messages.find(item => item.id === operation.messageId)
  if (!item) throw new Error('This reply is no longer available.')
  if (operation.type === 'react') {
    if (item.deleted) throw new Error('This comment has been deleted.')
    let reaction = item.reactions.find(item => item.emoji === operation.emoji)
    if (!reaction) { reaction = { emoji: operation.emoji, actors: [] }; item.reactions.push(reaction) }
    if (reaction.actors.includes(actor)) reaction.actors = reaction.actors.filter(id => id !== actor)
    else {
      if (reaction.actors.length >= 100) throw new Error('This reaction has reached its participant limit.')
      reaction.actors.push(actor)
    }
    return thread
  }
  if (operation.type === 'edit') {
    if (item.author !== 'user' || item.authorId !== actor || item.deleted) throw new Error('You can only edit your own comments.')
    if (item.text === operation.text) return thread
    if (item.text !== operation.expectedText || (item.editedAt ?? null) !== operation.expectedEditedAt)
      throw new Error('This comment changed while you were editing. Review the current comment before saving your draft.')
    item.text = operation.text
    item.editedAt = new Date(Math.max(Date.now(), item.editedAt ? Date.parse(item.editedAt) + 1 : 0)).toISOString()
  } else {
    if (!owner && (item.author !== 'user' || item.authorId !== actor)) throw new Error('You can only delete your own comments.')
    item.deleted = operation.type === 'delete'
  }
  if (thread.assistant?.messageId === item.id && thread.assistant.state === 'pending') thread.assistant.state = 'cancelled'
  return thread
}
/** Fence stale assistant replies and attach one answer to its explicit requesting thread.
 * @param threads - Stored threads to mutate.
 * @param input - Request identity, reply text and scoped Session attribution.
 */
export function replyDocComment(threads: DocCommentRecord[], input: CopyOSDocCommentReplyRequest): void {
  const request = z.object({ threadId: uuid, requestId: uuid, text, sessionId: z.string().min(1).max(200) }).parse(input)
  const thread = threads.find(item => item.id === request.threadId), pending = thread?.assistant
  const existing = thread?.messages.find(item => item.requestId === request.requestId)
  if (existing?.text === request.text) return
  if (!thread || thread.resolved || pending?.id !== request.requestId || pending.state !== 'pending' || pending.requestedBy !== 'owner')
    throw new Error('This assistant request was cancelled, answered or resolved. Do not post a late reply.')
  admitMessage(threads, thread)
  thread.messages.push({ id: randomUUID(), author: 'assistant', authorId: `assistant:${request.sessionId}`,
    text: request.text, deleted: false, createdAt: new Date().toISOString(), reactions: [],
    mentions: [pending.requestedBy], requestId: request.requestId })
  pending.state = 'answered'
}
