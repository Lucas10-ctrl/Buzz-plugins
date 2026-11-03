/** Text hyperlink metadata remains separate from visual formatting and navigation execution. */
import { z } from 'zod'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignTextHyperlink, CopyOSDesignTextRun, CopyOSDesignSemantics } from './types.ts'

/** Admit explicit absolute HTTP(S) destinations; following a link is always a separate consumer action.
 * @param value - Authored destination, never executed or fetched here.
 * @returns Whether the URL has an allowed scheme, host and no credentials or raw controls.
 */
export function designTextHyperlinkUrlAllowed(value: string): boolean {
  if (!value.length || value.length > 2000 || /[\u0000-\u0020\u007F-\u009F]/u.test(value) || !/^https?:\/\//i.test(value)) return false
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password }
  catch { return false }
}
/** Strict shared hyperlink wire schema; NODE values refer only to stored native layer identities. */
export const designTextHyperlinkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), value: z.string().refine(designTextHyperlinkUrlAllowed, 'Links require an absolute HTTP(S) URL without credentials or controls') }).strict(),
  z.object({ type: z.literal('NODE'), value: z.uuid() }).strict(),
])
/** Preserve sparse visual runs while rewriting or removing only hyperlink metadata.
 * @param runs - Authored inline runs.
 * @param map - Target replacement; undefined removes the link.
 * @returns Original array when no target changes; otherwise independent runs, omitting now-empty records.
 */
export function mapDesignTextHyperlinks(runs: CopyOSDesignTextRun[] | undefined,
  map: (target: CopyOSDesignTextHyperlink) => CopyOSDesignTextHyperlink | undefined): CopyOSDesignTextRun[] | undefined {
  const result = runs?.flatMap((run) => {
    if (!run.style.hyperlink) return [run]
    const hyperlink = map(run.style.hyperlink)
    if (JSON.stringify(hyperlink) === JSON.stringify(run.style.hyperlink)) return [run]
    const { hyperlink: _previous, ...visual } = run.style
    const style: CopyOSDesignTextRun['style'] = visual
    if (hyperlink) style.hyperlink = hyperlink
    return Object.keys(style).length ? [{ ...run, style }] : []
  })
  return result?.length === runs?.length && result?.every((run, index) => run === runs?.[index]) ? runs : result
}
/** Remove text and whole-layer links whose formerly valid stored destinations were deleted, retaining every other authored field.
 * @param before - Original graph used to distinguish deletion from an invalid newly authored reference.
 * @param candidate - Staged graph after deletion.
 * @returns Candidate with only links to deleted targets removed; no typography or cached geometry changes.
 */
export function reconcileDesignTextHyperlinks(before: CopyOSDesignDocument, candidate: CopyOSDesignDocument): CopyOSDesignDocument {
  const remaining = new Set(candidate.nodes.map(node => node.id))
  const deleted = new Set(before.nodes.filter(node => !remaining.has(node.id)).map(node => node.id))
  if (!deleted.size) return candidate
  const map = (target: CopyOSDesignTextHyperlink) => target.type === 'NODE' && deleted.has(target.value) ? undefined : target
  return { ...candidate, nodes: candidate.nodes.map((node) => {
    const textRuns = mapDesignTextHyperlinks(node.textRuns, map), instanceOverrides = node.instanceOverrides?.map((record) => {
      const runs = mapDesignTextHyperlinks(record.textRuns, map)
      return runs === record.textRuns ? record : { ...record, textRuns: runs }
    })
    const semantics = mapDesignSemanticsTargets(node, map)
    return textRuns === node.textRuns && semantics === node.semantics &&
      (instanceOverrides?.every((record, index) => record === node.instanceOverrides?.[index]) ?? true)
      ? node : { ...node, textRuns, instanceOverrides, semantics }
  }) }
}
/** Validate NODE target existence without treating navigation cycles as component/render dependencies.
 * @param document - Complete authored graph.
 * @param runs - One stored or contextual run array.
 * @param targets - Optional prebuilt stored-node index for whole-document validation.
 * @returns Whether every target is an admitted URL or an existing stored layer.
 */
export function designTextHyperlinksValid(document: Pick<CopyOSDesignDocument, 'nodes'>, runs: readonly CopyOSDesignTextRun[] | undefined,
  targets: ReadonlyMap<string, unknown> = new Map(document.nodes.map(node => [node.id, node]))): boolean {
  const ids = targets
  return (runs ?? []).every(run => !run.style.hyperlink || designTextHyperlinkSchema.safeParse(run.style.hyperlink).success &&
    (run.style.hyperlink.type === 'URL' || ids.has(run.style.hyperlink.value)))
}
/** Read a hyperlink target across a selected range; uncovered characters count as unlinked.
 * @param node - Effective text after linked overrides.
 * @param start - Inclusive UTF16 offset.
 * @param end - Exclusive UTF16 offset.
 * @returns Uniform target, null for none, or mixed for multiple targets/unlinked gaps.
 */
export function designTextHyperlink(node: CopyOSDesignNode, start: number, end: number): CopyOSDesignTextHyperlink | null | 'mixed' {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > node.text.length) throw new Error('Invalid hyperlink range')
  if (start === end) return null
  const targets = new Map<string, CopyOSDesignTextHyperlink | null>()
  let cursor = start
  for (const run of node.textRuns ?? []) {
    const from = Math.max(start, run.start), to = Math.min(end, run.end)
    if (from >= to) continue
    if (from > cursor) targets.set('null', null)
    const target = run.style.hyperlink ?? null
    targets.set(JSON.stringify(target), target); cursor = to
  }
  if (cursor < end) targets.set('null', null)
  return targets.size > 1 ? 'mixed' : [...targets.values()][0] ?? null
}
/**
 * Rewrite or remove the whole-layer link destination, the button command target and the label's field, which map as NODE destinations.
 * @param node - Layer kind and authored record; image labels remain alternatives without a link.
 * @param map - Destination replacement; undefined removes the link, command or labelled field.
 * @returns Original record when unchanged, otherwise an independent record; undefined when no field remains.
 */
export function mapDesignSemanticsTargets(node: Pick<CopyOSDesignNode, 'kind' | 'semantics'>,
  map: (target: CopyOSDesignTextHyperlink) => CopyOSDesignTextHyperlink | undefined): CopyOSDesignSemantics | undefined {
  const semantics = node.semantics
  if (!semantics?.link && !semantics?.command && semantics?.labelFor === undefined) return semantics
  const link = semantics.link && map(semantics.link)
  const mapped = semantics.command && map({ type: 'NODE', value: semantics.command.target })
  const command = semantics.command && mapped?.type === 'NODE' ? { ...semantics.command, target: mapped.value } : undefined
  const field = semantics.labelFor !== undefined ? map({ type: 'NODE', value: semantics.labelFor }) : undefined
  const labelFor = field?.type === 'NODE' ? field.value : undefined
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  if (same(link, semantics.link) && same(command, semantics.command) && labelFor === semantics.labelFor) return semantics
  const { link: _previous, command: _command, labelFor: _labelFor, ...rest } = semantics
  const result: CopyOSDesignSemantics = { ...rest, ...link ? { link } : {}, ...command ? { command } : {},
    ...labelFor !== undefined ? { labelFor } : {} }
  // A label without its link, control, landmark, form or field owner would describe nothing; drop it with the destination.
  if (!link && result.label !== undefined && node.kind !== 'image' &&
    !(result.element && /^(?:header|nav|main|footer|aside|section|article|button|dialog|form|input|textarea)$/.test(result.element)))
    delete result.label
  return result.element !== undefined || result.label !== undefined || result.link !== undefined || result.popover !== undefined
    ? result : undefined
}
