import { parseDocsSelections, type DocsRequestSelection } from './DocsAssistantRequest.ts'

/** Browser-local recovery for an unsent document request and its explicit scope. */
export interface DocsAssistantDraft {
  readonly text: string
  readonly editMode?: 'suggest' | 'apply'
  readonly target: {
    readonly blockId: string
    readonly quote: string
    readonly selection?: { readonly before: string; readonly start: number }
    readonly selections?: readonly DocsRequestSelection[]
  } | null
}
const clearedEvent = 'copyos-docs-assistant-draft-cleared'
function draftIdentity(key: string, draft: DocsAssistantDraft): string {
  return JSON.stringify([key, draft.text, draft.editMode ?? 'suggest', draft.target?.blockId ?? null, draft.target?.quote ?? null,
    draft.target?.selection?.before ?? null, draft.target?.selection?.start ?? null,
    draft.target?.selections?.map(part => [part.blockId, part.before, part.start]) ?? null])
}
/** Address a draft by document tab, independently of the pane that displays it.
 * @param workspaceId - Registered workspace identity.
 * @param docId - Authorized document identity.
 * @param tabId - Current document tab.
 * @returns Browser storage key, without share credentials.
 */
export function assistantDraftKey(workspaceId: string, docId: string, tabId: string): string {
  return `copyos.docs.request-draft.${[workspaceId, docId, tabId].map(encodeURIComponent).join('.')}`
}
/** Read a bounded draft; malformed records are ignored and storage errors reach the composer.
 * @param key - Current document tab's storage key.
 * @returns Validated request, or null when none is recoverable.
 */
export function readAssistantDraft(key: string): DocsAssistantDraft | null {
  const stored = localStorage.getItem(key)
  if (!stored || stored.length > 2_600_000) return null
  let value: unknown
  try { value = JSON.parse(stored) } catch { return null }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('text' in value) || typeof value.text !== 'string' || value.text.length > 100_000
    || !('target' in value) || ('editMode' in value && value.editMode !== 'suggest' && value.editMode !== 'apply')) return null
  const mode: Pick<DocsAssistantDraft, 'editMode'> = 'editMode' in value && (value.editMode === 'suggest' || value.editMode === 'apply')
    ? { editMode: value.editMode } : {}
  const target = value.target
  if (target === null) return { text: value.text, target: null, ...mode }
  if (!target || typeof target !== 'object'
    || !('blockId' in target) || typeof target.blockId !== 'string' || !target.blockId || target.blockId.length > 128
    || !('quote' in target) || typeof target.quote !== 'string' || target.quote.length > 100_000) return null
  let selection: NonNullable<DocsAssistantDraft['target']>['selection']
  if ('selection' in target) {
    const range = target.selection
    if (!range || typeof range !== 'object' || !('before' in range) || typeof range.before !== 'string' || !range.before
      || range.before.length > 200_000 || !('start' in range) || typeof range.start !== 'number'
      || !Number.isSafeInteger(range.start) || range.start < 0) return null
    selection = { before: range.before, start: range.start }
  }
  let selections: readonly DocsRequestSelection[] | undefined
  if ('selections' in target) {
    const parts = parseDocsSelections(target.selections)
    if (!parts || selection !== undefined || target.blockId !== parts[0]?.blockId) return null
    selections = parts
  }
  return { text: value.text, ...mode, target: { blockId: target.blockId, quote: target.quote,
    ...(selection === undefined ? {} : { selection }), ...(selections === undefined ? {} : { selections }) } }
}
/** Save current input without submitting it; failures leave the visible composition intact.
 * @param key - Current document tab's storage key.
 * @param draft - Request and its passage/section, or whole-document scope.
 */
export function saveAssistantDraft(key: string, draft: DocsAssistantDraft): void {
  if (draft.text.length > 100_000 || (draft.target?.quote.length ?? 0) > 100_000 || (draft.target?.blockId.length ?? 0) > 128
    || (draft.target?.selection?.before.length ?? 0) > 200_000
    || (draft.target?.selections !== undefined && (!parseDocsSelections(draft.target.selections)
      || draft.target.selection !== undefined || draft.target.blockId !== draft.target.selections[0]?.blockId)))
    throw new Error('Document request draft exceeds browser recovery limit')
  if (draft.text.trim()) localStorage.setItem(key, JSON.stringify({ version: 1, ...draft }))
  else localStorage.removeItem(key)
}
/** Clear an accepted request in every mounted pane, including a newly revealed Session pane.
 * @param key - Accepted request's document tab key.
 * @param accepted - Exact composition accepted before navigation, without clearing a newer draft.
 */
export function clearAssistantDraft(key: string, accepted: DocsAssistantDraft): void {
  const identity = draftIdentity(key, accepted)
  try {
    const saved = readAssistantDraft(key)
    if (saved === null || draftIdentity(key, saved) === identity) localStorage.removeItem(key)
  } finally { window.dispatchEvent(new CustomEvent(clearedEvent, { detail: identity })) }
}
/** Observe successful submission without tying recovery to a particular pane lifecycle.
 * @param key - Current document tab's storage key.
 * @param current - Current visible composition, which may have changed in another pane.
 * @param clear - Drop the corresponding visible composition after acceptance.
 * @returns Listener cleanup for unmount or tab change.
 */
export function watchAssistantDraftClear(key: string, current: () => DocsAssistantDraft, clear: () => void): () => void {
  const listener = (event: Event): void => { if (event instanceof CustomEvent && event.detail === draftIdentity(key, current())) clear() }
  window.addEventListener(clearedEvent, listener)
  return () => { window.removeEventListener(clearedEvent, listener) }
}
