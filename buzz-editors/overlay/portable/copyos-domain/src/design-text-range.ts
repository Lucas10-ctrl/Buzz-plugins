import { designTextHyperlink, designTextHyperlinksValid } from './design-text-hyperlink.ts'
import { designTextLayoutSignature } from './design-text-layout.ts'
/** Native stored and linked text-range authoring shares canonical contextual paths and sparse run ownership. */
import { createDesignRenderScene, createDesignInstanceContextReader, editDesignNodes } from './design-model.ts'
import { replaceDesignTextRange, styleDesignTextRange, rebaseDesignTextRuns, normalizeDesignTextRuns } from './design-text-runs.ts'
import type { DesignTextRunStylePatch } from './design-text-runs.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignTextRun, CopyOSDesignFontFeature, CopyOSDesignFontVariation } from './types.ts'

/** One ordered replacement and/or inline formatting operation; formatting addresses the inserted text after a replacement. */
export interface DesignTextRangeEdit {
  start: number
  end: number
  text?: string | undefined
  style?: DesignTextRunStylePatch | null | undefined
}
/** Text ownership and current typography, with independent inherited formatting for linked descendants. */
export interface DesignTextRangeContext {
  node: CopyOSDesignNode
  stored: CopyOSDesignNode
  overridePath: string[]
  /** Whole-layer feature ownership is independent of range ownership. */
  localFontVariations: CopyOSDesignFontVariation[] | undefined
  sourceFontVariations: CopyOSDesignFontVariation[] | undefined
  localFontFeatures: CopyOSDesignFontFeature[] | undefined
  sourceFontFeatures: CopyOSDesignFontFeature[] | undefined
  localRuns: CopyOSDesignTextRun[] | undefined
  sourceRuns: CopyOSDesignTextRun[] | undefined
  locked: boolean
  effectiveModeId: string | null
}
/** Read resolved text without resolving sparse inline overrides into stored base styles.
 * @param document - Validated authored design.
 * @param nodeId - Stored text or outer linked instance identity.
 * @param path - Empty for ordinary text; nested-instance hops and target identity otherwise.
 * @returns Effective text, local/inherited formatting and canonical ownership, or undefined for invalid targets.
 */
export function designTextRangeContext(document: CopyOSDesignDocument, nodeId: string,
  path: readonly string[] = []): DesignTextRangeContext | undefined {
  const stored = document.nodes.find(node => node.id === nodeId)
  if (!stored) return
  const scene = createDesignRenderScene(document)
  if (!path.length) {
    const node = scene.root.byId.get(nodeId)
    if (stored.kind !== 'text' || node?.kind !== 'text') return
    let ancestor: CopyOSDesignNode | undefined = stored
    const seen = new Set<string>()
    let locked = false
    while (ancestor && !seen.has(ancestor.id)) {
      locked ||= ancestor.locked; seen.add(ancestor.id)
      ancestor = document.nodes.find(node => node.id === ancestor?.parentId)
    }
    const withoutFeatures = { ...document, nodes: document.nodes.map(item => item.id === nodeId
      ? { ...item, fontFeatures: undefined } : item) }
    const sourceFontFeatures = stored.fontFeatures === undefined ? node.fontFeatures :
      createDesignRenderScene(withoutFeatures).root.byId.get(nodeId)?.fontFeatures
    const withoutVariations = { ...document, nodes: document.nodes.map(item => item.id === nodeId
      ? { ...item, fontVariations: undefined } : item) }
    const sourceFontVariations = stored.fontVariations === undefined ? node.fontVariations :
      createDesignRenderScene(withoutVariations).root.byId.get(nodeId)?.fontVariations
    return { node, stored, overridePath: [], localFontVariations: stored.fontVariations, sourceFontVariations,
      localFontFeatures: stored.fontFeatures, sourceFontFeatures,
      localRuns: stored.textRuns, sourceRuns: undefined, locked,
      effectiveModeId: scene.root.modes.get(node.id) ?? null }
  }
  const current = createDesignInstanceContextReader(document, scene)(nodeId, path)
  if (!current || current.node.kind !== 'text') return
  let sourceFontFeatures = current.node.fontFeatures
  if (current.record?.fontFeatures !== undefined) {
    const without = { ...document, nodes: document.nodes.map(item => item.id !== nodeId ? item : { ...item,
      instanceOverrides: item.instanceOverrides?.map(record => record === current.record
        ? { ...record, fontFeatures: undefined } : record) }) }
    sourceFontFeatures = createDesignInstanceContextReader(without)(nodeId, current.effectivePath)?.node.fontFeatures
  }
  let sourceFontVariations = current.node.fontVariations
  if (current.record?.fontVariations !== undefined) {
    const without = { ...document, nodes: document.nodes.map(item => item.id !== nodeId ? item : { ...item,
      instanceOverrides: item.instanceOverrides?.map(record => record === current.record
        ? { ...record, fontVariations: undefined } : record) }) }
    sourceFontVariations = createDesignInstanceContextReader(without)(nodeId, current.effectivePath)?.node.fontVariations
  }
  let sourceRuns: CopyOSDesignTextRun[] | undefined
  if (current.record?.textRuns !== undefined) {
    const without = { ...document, nodes: document.nodes.map(node => node.id !== nodeId ? node : { ...node,
      instanceOverrides: node.instanceOverrides?.map(record => record === current.record
        ? { ...record, textRuns: undefined } : record) }) }
    sourceRuns = createDesignInstanceContextReader(without)(nodeId, current.effectivePath)?.node.textRuns
  } else sourceRuns = current.node.textRuns
  return { node: current.node, stored, overridePath: current.overridePath,
    localFontVariations: current.record?.fontVariations, sourceFontVariations, localFontFeatures: current.record?.fontFeatures,
    sourceFontFeatures, localRuns: current.record?.textRuns,
    sourceRuns, locked: current.locked, effectiveModeId: current.context.modes.get(current.node.id) ?? null }
}
/** Apply one ordinary or linked range edit without changing its source, siblings or unrelated override fields.
 * @param document - Current authored scene.
 * @param nodeId - Stored text or owning outer instance identity.
 * @param path - Empty for ordinary text; canonical or authored linked descendant path otherwise.
 * @param edit - Replacement and/or sparse style operation using current UTF-16 offsets.
 * @returns Updated document; invalid targets, locked ancestry and empty operations throw before mutation.
 */
export function editDesignTextRange(document: CopyOSDesignDocument, nodeId: string, path: readonly string[],
  edit: DesignTextRangeEdit): CopyOSDesignDocument {
  const current = designTextRangeContext(document, nodeId, path)
  if (!current || current.locked) throw new Error('Text range target is missing, non-text or locked')
  if (edit.text === undefined && edit.style === undefined) throw new Error('Text range edits require text or formatting')
  let node = path.length ? current.node : current.stored
  if (edit.text !== undefined) node = replaceDesignTextRange(node, edit.start, edit.end, edit.text)
  if (edit.style !== undefined) node = styleDesignTextRange(node, edit.start,
    edit.text === undefined ? edit.end : edit.start + edit.text.length, edit.style)
  const fields = { text: node.text, textRuns: node.textRuns, textLayoutMetrics: node.textLayoutMetrics,
    textBaselineMetrics: node.textBaselineMetrics }
  if (!path.length) {
    const candidate = editDesignNodes(document, [{ id: nodeId, ...fields }])
    if (!designTextRunsDocumentValid(candidate)) throw new Error('Invalid text runs or aggregate run budget')
    return candidate
  }
  const key = JSON.stringify(current.overridePath), records = current.stored.instanceOverrides ?? []
  const previous = records.find(record => JSON.stringify(record.path) === key)
  const record = { ...previous, path: current.overridePath,
    ...(edit.text !== undefined ? { text: fields.text } : {}), textRuns: fields.textRuns,
    textLayoutMetrics: fields.textLayoutMetrics, textBaselineMetrics: fields.textBaselineMetrics }
  const overrides = previous ? records.map(item => item === previous ? record : item) : [...records, record]
  if (overrides.length > 1000) throw new Error('Instance exceeds 1000 overrides')
  const candidate = editDesignNodes(document, [{ id: nodeId, instanceOverrides: overrides }])
  if (!designTextRunsDocumentValid(candidate)) throw new Error('Invalid text runs or aggregate run budget')
  return candidate
}
/** Keep sparse runs aligned during ordinary content edits and inherited source/property changes.
 * @param before - Prior authored design.
 * @param candidate - Atomic candidate after property and variant reconciliation.
 * @returns Candidate with runs rebased onto effective text; plain content edits retain identifiable stale measurements.
 */
export function reconcileDesignTextRuns(before: CopyOSDesignDocument, candidate: CopyOSDesignDocument): CopyOSDesignDocument {
  const old = new Map(before.nodes.map(node => [node.id, node]))
  let result = { ...candidate, nodes: candidate.nodes.map((node) => {
    const previous = old.get(node.id)
    if (!previous || node.kind !== 'text') return node
    if (previous.text === node.text) return JSON.stringify(previous.textRuns) === JSON.stringify(node.textRuns) ? node
      : designTextLayoutSignature(previous) === designTextLayoutSignature(node) ? node
        : { ...node, textLayoutMetrics: undefined, textBaselineMetrics: undefined }
    if (node.textRuns !== previous.textRuns) return node
    return { ...node, textRuns: rebaseDesignTextRuns(previous, node.text).textRuns }
  }) }
  const owners = result.nodes.filter(node => node.instanceOverrides?.some(record => record.textRuns !== undefined))
  const changedContent = result.nodes.some((node) => {
    const previous = old.get(node.id)
    if (!previous || previous.text !== node.text || previous.componentId !== node.componentId) return true
    if (previous.componentPropertyValues !== node.componentPropertyValues &&
      JSON.stringify(previous.componentPropertyValues) !== JSON.stringify(node.componentPropertyValues)) return true
    if (previous.componentProperties !== node.componentProperties &&
      JSON.stringify(previous.componentProperties) !== JSON.stringify(node.componentProperties)) return true
    const content = (owner: CopyOSDesignNode) => owner.instanceOverrides?.map(record => [record.path, record.text, record.componentId])
    return previous.instanceOverrides !== node.instanceOverrides && JSON.stringify(content(previous)) !== JSON.stringify(content(node))
  })
  if (!owners.length || !changedContent) return result
  const readBefore = createDesignInstanceContextReader(before), readAfter = createDesignInstanceContextReader(result)
  const changed = new Map<string, CopyOSDesignNode>()
  for (const owner of owners) {
    const previous = old.get(owner.id)
    const records = (owner.instanceOverrides ?? []).map((record) => {
      if (record.textRuns === undefined) return record
      const oldRecord = previous?.instanceOverrides?.find(item => JSON.stringify(item.path) === JSON.stringify(record.path))
      if (!oldRecord || record.textRuns !== oldRecord.textRuns) return record
      const from = readBefore(owner.id, record.path)?.node, to = readAfter(owner.id, record.path)?.node
      if (!from || !to || from.text === to.text) return record
      return { ...record, textRuns: rebaseDesignTextRuns({ ...from, textRuns: record.textRuns }, to.text).textRuns,
        textLayoutMetrics: undefined, textBaselineMetrics: undefined }
    })
    if (records.some((record, index) => record !== owner.instanceOverrides?.[index]))
      changed.set(owner.id, { ...owner, instanceOverrides: records })
  }
  if (changed.size) result = { ...result, nodes: result.nodes.map(node => changed.get(node.id) ?? node) }
  return result
}

/** Validate authored and contextual inline ranges and the aggregate run budget without changing the scene.
 * @param document - Candidate including all local text and override arrays.
 * @returns Whether every effective range is sorted, nonoverlapping and within its text and bounded style domains.
 */
export function designTextRunsDocumentValid(document: CopyOSDesignDocument): boolean {
  const owners = document.nodes.filter(node => node.instanceOverrides?.some(record => record.textRuns !== undefined))
  if (document.nodes.reduce((sum, node) => sum + (node.textRuns?.length ?? 0) +
    (node.instanceOverrides ?? []).reduce((total, record) => total + (record.textRuns?.length ?? 0), 0), 0) > 10000) return false
  const valid = (node: CopyOSDesignNode, runs: readonly CopyOSDesignTextRun[]) => {
    if (!designTextHyperlinksValid(document, runs) || node.kind !== 'text' || runs.some((run, index) =>
      !Object.values(run.style).some(value => value !== undefined) ||
      index > 0 && (runs[index - 1]?.end ?? 0) > run.start)) return false
    try { normalizeDesignTextRuns(node.text, runs); return true } catch (error) {
      // This admission predicate reports the range/style rejection emitted by the pure normalizer.
      if (!(error instanceof Error)) throw error
      return false
    }
  }
  for (const node of document.nodes) if (node.textRuns !== undefined && !valid(node, node.textRuns)) return false
  if (owners.length) {
    const read = createDesignInstanceContextReader(document)
    for (const owner of owners) for (const record of owner.instanceOverrides ?? []) if (record.textRuns !== undefined) {
      const node = read(owner.id, record.path)?.node
      if (!node || !valid(node, record.textRuns)) return false
    }
  }
  return true
}

/** Remove only linked inline formatting ownership so current and future source runs remain live.
 * @param document - Authored scene.
 * @param nodeId - Outer linked instance identity.
 * @param path - Nonempty contextual text path.
 * @returns Candidate preserving local text and unrelated override fields while removing stale text measurements.
 */
export function resetDesignTextRuns(document: CopyOSDesignDocument, nodeId: string, path: readonly string[]): CopyOSDesignDocument {
  if (!path.length) throw new Error('Inline style inheritance requires a linked text path')
  const current = designTextRangeContext(document, nodeId, path)
  if (!current || current.locked) throw new Error('Text range target is missing, non-text or locked')
  const key = JSON.stringify(current.overridePath)
  const records = (current.stored.instanceOverrides ?? []).flatMap((record) => {
    if (JSON.stringify(record.path) !== key) return [record]
    const next = { ...record, textRuns: undefined, textLayoutMetrics: undefined, textBaselineMetrics: undefined }
    return Object.entries(next).some(([field, value]) => field !== 'path' && value !== undefined) ? [next] : []
  })
  return editDesignNodes(document, [{ id: nodeId, instanceOverrides: records.length ? records : undefined }])
}

/** Inspect existing or selected text link targets without changing styling, content or ownership.
 * @param document - Current authored graph.
 * @param nodeId - Stored text identity or owning outer linked instance.
 * @param path - Canonical contextual text path, empty for ordinary text.
 * @param start - Inclusive UTF16 offset, default zero.
 * @param end - Exclusive UTF16 offset, default full effective text length.
 * @returns Text ownership/context plus none, uniform or mixed link state and complete linked ranges.
 */
export function designTextHyperlinkContext(document: CopyOSDesignDocument, nodeId: string, path: readonly string[] = [],
  start = 0, end?: number): (DesignTextRangeContext & {
    start: number
    end: number
    hyperlink: ReturnType<typeof designTextHyperlink>
    links: { start: number; end: number; hyperlink: NonNullable<CopyOSDesignTextRun['style']['hyperlink']> }[] }) | undefined {
  const current = designTextRangeContext(document, nodeId, path)
  if (!current) return
  const finish = end ?? current.node.text.length
  return { ...current, start, end: finish, hyperlink: designTextHyperlink(current.node, start, finish),
    links: (current.node.textRuns ?? []).flatMap(run => run.style.hyperlink && run.end > start && run.start < finish ?
      [{ start: Math.max(start, run.start), end: Math.min(finish, run.end), hyperlink: run.style.hyperlink }] : []) }
}
