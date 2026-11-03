/** Logged document requests and blank-page eligibility shared by the host and client. */
import type { CopyOSDocDocument } from './types.ts'

/** Identify an empty main tab without granting permission to write while stopped.
 * @param document - Current document text, tabs and retained discussion/attachments.
 * @returns True for one empty, ready main section with no other tab or retained material.
 */
export function isBlankDocForOutline(document: Pick<CopyOSDocDocument, 'id'> & {
  readonly blocks: readonly (Pick<CopyOSDocDocument['blocks'][number], 'label' | 'content' | 'state'> & { readonly tabId?: string | undefined })[]
  readonly tabs?: readonly { readonly id: string }[] | undefined
  readonly comments?: readonly object[]
  readonly suggestions?: readonly object[]
  readonly assets?: readonly object[]
}): boolean {
  const block = document.blocks[0]
  return document.blocks.length === 1 && block?.state === 'ready' && block.content === '' && block.label === ''
    && (block.tabId ?? document.id) === document.id && (document.tabs ?? []).every(tab => tab.id === document.id)
    && !document.comments?.length && !document.suggestions?.length && !document.assets?.length
}

/** One exact source passage in a selection spanning several document sections. */
export interface DocsRequestSelection { readonly blockId: string; readonly before: string; readonly start: number }
/** Logged document requests retain their full context while allowing a concise chat presentation. */
export interface DocsRequestPresentation {
  readonly title: string
  readonly request: string
  readonly scope: 'document' | 'section' | 'selection' | 'comment' | 'continue' | 'draft'
  /** First-draft permission to replace only the unchanged title carried in this request. */
  readonly renameTitle?: boolean
  readonly quote?: string
  readonly editMode?: 'suggest' | 'apply'
  readonly epoch?: number
  readonly tabId?: string
  readonly blockId?: string
  readonly selection?: { readonly before: string; readonly start: number }
  readonly selections?: readonly DocsRequestSelection[]
}
/** Versioned display envelope; context remains part of the exact model-visible user message. */
export interface DocsRequestEnvelope extends DocsRequestPresentation {
  readonly version: 1
  readonly docId: string
  readonly workspaceId: string
  readonly context: string
  readonly threadId?: string
}
const prefix = '<copyos_document_request>\n', suffix = '\n</copyos_document_request>'
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu
/** Validate bounded, non-overlapping section identities for a multi-section selection.
 * @param value - Untrusted selection parts from a request or recovered draft.
 * @returns Exact source pieces, or null for malformed or ambiguous scope.
 */
export function parseDocsSelections(value: unknown): readonly DocsRequestSelection[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 500) return null
  const result: DocsRequestSelection[] = [], ids = new Set<string>()
  let length = 0
  for (const item of value) {
    const part: unknown = item
    if (!part || typeof part !== 'object' || !('blockId' in part) || typeof part.blockId !== 'string' || !uuid.test(part.blockId)
      || ids.has(part.blockId) || !('before' in part) || typeof part.before !== 'string' || !part.before
      || !('start' in part) || typeof part.start !== 'number' || !Number.isSafeInteger(part.start) || part.start < 0) return null
    length += part.before.length
    if (length > 200_000) return null
    ids.add(part.blockId); result.push({ blockId: part.blockId, before: part.before, start: part.start })
  }
  return result
}
/** Encode one request without a separate hidden model input.
 * @param context - Full instruction and document scope sent to the assistant.
 * @param workspaceId - Registered workspace containing the document.
 * @param docId - Existing document identity.
 * @param presentation - User-authored request and visible document label.
 * @param threadId - Optional discussion target.
 * @returns Exact text to persist and send through the normal Session prompt path.
 */
export function encodeDocsRequest(context: string, workspaceId: string, docId: string,
  presentation: DocsRequestPresentation, threadId?: string): string {
  return prefix + JSON.stringify({ ...presentation, version: 1, workspaceId, docId, context,
    ...(threadId === undefined ? {} : { threadId }) } satisfies DocsRequestEnvelope, null, 2) + suffix
}
/** Recognize only a complete version-one request; arbitrary or malformed text keeps its normal bubble.
 * @param content - Original message content, including any attachments.
 * @returns Validated presentation or null when the message is outside this feature.
 */
export function parseDocsRequest(content: readonly unknown[]): DocsRequestEnvelope | null {
  if (content.length !== 1) return null
  const part = content[0]
  if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text'
    || !('text' in part) || typeof part.text !== 'string') return null
  if (!part.text.startsWith(prefix) || !part.text.endsWith(suffix)) return null
  let value: unknown
  try { value = JSON.parse(part.text.slice(prefix.length, -suffix.length)) }
  catch { return null }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('title' in value) || typeof value.title !== 'string'
    || !('request' in value) || typeof value.request !== 'string' || !value.request.trim()
    || !('context' in value) || typeof value.context !== 'string' || !value.context.trim()
    || !('workspaceId' in value) || typeof value.workspaceId !== 'string' || !value.workspaceId
    || !('docId' in value) || typeof value.docId !== 'string'
    || !uuid.test(value.docId)
    || !('scope' in value)
    || (value.scope !== 'document' && value.scope !== 'section' && value.scope !== 'selection'
      && value.scope !== 'comment' && value.scope !== 'continue' && value.scope !== 'draft')
    || ('renameTitle' in value && (value.scope !== 'draft' || typeof value.renameTitle !== 'boolean'))
    || ('quote' in value && typeof value.quote !== 'string')
    || ('threadId' in value && typeof value.threadId !== 'string')
    || ('editMode' in value && value.editMode !== 'suggest' && value.editMode !== 'apply')
    || ('epoch' in value && (typeof value.epoch !== 'number' || !Number.isSafeInteger(value.epoch) || value.epoch < 0))
    || ('tabId' in value && (typeof value.tabId !== 'string' || !uuid.test(value.tabId)))
    || ('blockId' in value && (typeof value.blockId !== 'string' || !uuid.test(value.blockId)))) return null
  let selection: DocsRequestPresentation['selection']
  if ('selection' in value) {
    const range = value.selection
    if (!range || typeof range !== 'object' || !('before' in range) || typeof range.before !== 'string' || !range.before
      || range.before.length > 200_000 || !('start' in range) || typeof range.start !== 'number'
      || !Number.isSafeInteger(range.start) || range.start < 0) return null
    selection = { before: range.before, start: range.start }
  }
  let selections: readonly DocsRequestSelection[] | undefined
  if ('selections' in value) {
    const parts = parseDocsSelections(value.selections)
    if (!parts || value.scope !== 'selection' || selection !== undefined
      || !('blockId' in value) || value.blockId !== parts[0]?.blockId) return null
    selections = parts
  }
  if ('editMode' in value && value.editMode === 'apply' && (!('epoch' in value) || !('tabId' in value)
    || (value.scope !== 'document' && value.scope !== 'section' && value.scope !== 'selection')
    || (value.scope !== 'document' && !('blockId' in value))
    || (value.scope === 'selection' && selection === undefined && selections === undefined))) return null
  if (value.scope === 'draft' && (!('epoch' in value) || !('tabId' in value) || value.tabId !== value.docId
    || !('blockId' in value) || !('renameTitle' in value) || 'editMode' in value || selection !== undefined || selections !== undefined)) return null
  return { version: 1, title: value.title, request: value.request, context: value.context,
    workspaceId: value.workspaceId, docId: value.docId,
    scope: value.scope,
    ...('renameTitle' in value && typeof value.renameTitle === 'boolean' ? { renameTitle: value.renameTitle } : {}),
    ...('editMode' in value && (value.editMode === 'suggest' || value.editMode === 'apply') ? { editMode: value.editMode } : {}),
    ...('epoch' in value && typeof value.epoch === 'number' ? { epoch: value.epoch } : {}),
    ...('tabId' in value && typeof value.tabId === 'string' ? { tabId: value.tabId } : {}),
    ...('blockId' in value && typeof value.blockId === 'string' ? { blockId: value.blockId } : {}),
    ...(selection === undefined ? {} : { selection }),
    ...(selections === undefined ? {} : { selections }),
    ...('quote' in value && typeof value.quote === 'string' ? { quote: value.quote } : {}),
    ...('threadId' in value && typeof value.threadId === 'string' ? { threadId: value.threadId } : {}) }
}
