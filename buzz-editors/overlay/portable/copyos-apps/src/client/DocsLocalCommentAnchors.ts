/** Unsent comment locations stay browser-local while following document edits and Undo. */
import type * as Y from 'yjs'
import { docContentAnchor, docContentLocation, docContentLocations } from '../../../copyos-domain/src/docs-content.ts'
import type { CopyOSDocCommentDraft } from '../../../copyos-domain/src/types.ts'
import { readCommentDrafts, saveCommentDraft } from './DocsCommentDrafts.ts'

type Draft = CopyOSDocCommentDraft

/** Own local draft locations without adding unsent data to shared Yjs updates. */
export class DocsLocalCommentAnchors {
  private readonly drafts = new Map<string, Draft>()
  private readonly alternatives = new Map<string, Draft[]>()
  private readonly failed = new Set<string>()
  /** Whether the latest anchor update could not be saved for recovery. */
  storageFailed = false
  /** Recover locations for one workspace/document browser-storage prefix.
   * @param prefix - Existing comment recovery prefix, excluding sharing credentials.
   */
  constructor(private readonly prefix: string) {
    for (const { draft } of readCommentDrafts(prefix)) this.drafts.set(draft.id, draft)
  }
  /** Return current targets without unsent comment text.
   * @returns Draft locations owned by this pane.
   */
  all(): readonly Draft[] { return [...this.drafts.values()] }
  /** Capture or look up a draft by its stable retry identity.
   * @param draft - Newly captured or recovered location.
   * @returns The current target, retaining a previously mapped location.
   */
  capture(draft: Draft): Draft {
    const current = this.drafts.get(draft.id) ?? draft
    this.drafts.set(draft.id, current)
    return current
  }
  /** Forget an explicitly cancelled or posted composition's location.
   * @param id - Draft identity; text clearing remains with the comment form.
   */
  forget(id: string): void {
    this.drafts.delete(id); this.alternatives.delete(id); this.failed.delete(id); this.storageFailed = this.failed.size > 0
  }
  /** Explicitly reattach the same unsent composition to a newly selected passage.
   * @param draft - New location retaining the unsent composition identity.
   */
  retarget(draft: Draft): void {
    this.alternatives.delete(draft.id); this.drafts.set(draft.id, draft); this.persist(new Set([draft.id]))
  }
  /** Follow an explicit block move while keeping prior private locations available to Undo.
   * @param draft - Same private composition at its new shared-text location.
   */
  relocate(draft: Draft): void {
    const current = this.drafts.get(draft.id)
    if (current) this.alternatives.set(draft.id, [...(this.alternatives.get(draft.id) ?? []), current, draft])
    this.drafts.set(draft.id, draft)
  }
  /** Follow shared character identities and save canonical locations for reopening.
   * @param doc - Document after local editing, a remote update, or Undo/Redo.
   */
  restore(doc: Y.Doc): void {
    for (const original of this.drafts.values()) {
      try {
        const candidates = [original, ...(this.alternatives.get(original.id) ?? []).toReversed()]
        const draft = candidates.find(candidate =>
          docContentLocations(doc, candidate.anchor).some(part => part.range.to > part.range.from)) ?? original
        const locations = docContentLocations(doc, draft.anchor)
        const first = locations[0]
        if (first && locations.length > 1) {
          this.drafts.set(draft.id, { ...draft, blockId: first.blockId, section: false })
          continue
        }
        const location = docContentLocation(doc, draft.blockId, draft.anchor) ?? locations[0]
        if (location) this.drafts.set(draft.id, { ...draft, blockId: location.blockId,
          section: draft.section && draft.blockId === location.blockId,
          anchor: docContentAnchor(location.span, location.range.from, location.range.to) })
      } catch (_error) { /* Removed or malformed passages keep their original target and fail posting safely. */ }
    }
    this.persist(new Set(this.drafts.keys()))
  }
  /** Identify drafts whose original passage is no longer present.
   * @param doc - Current document used for resolving saved character identities.
   * @returns Identities requiring an explicitly selected replacement passage.
   */
  detached(doc: Y.Doc): readonly string[] {
    return this.all().filter((draft) => {
      const location = docContentLocation(doc, draft.blockId, draft.anchor) ?? docContentLocations(doc, draft.anchor)[0]
      return !location || (!draft.section && location.range.from === location.range.to)
    }).map(draft => draft.id)
  }
  private persist(changed: ReadonlySet<string>): void {
    const ids = new Set([...changed, ...this.failed])
    if (!ids.size) return
    const saved = new Map(readCommentDrafts(this.prefix).map(item => [item.draft.id, item]))
    for (const id of ids) {
      const draft = this.drafts.get(id), original = saved.get(id)
      if (!draft || !original) continue
      try { saveCommentDraft(this.prefix, draft, original.text); this.failed.delete(id) }
      catch (error) { this.failed.add(id); console.warn('Unable to save an unsent comment location', error) }
    }
    this.storageFailed = this.failed.size > 0
  }
}
