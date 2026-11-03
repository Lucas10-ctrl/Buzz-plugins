/** Reviewable nested auto layout uses deterministic spatial bands, never a claimed Figma inference algorithm. */
import { z } from 'zod'
import { composeDesignAutoLayout, DesignAutoLayoutEditError } from './design-auto-layout.ts'
import type { DesignAutoLayoutReason } from './design-auto-layout.ts'
import { createDesignRenderScene } from './design-model.ts'
import { parseDesignDocument, CopyOSDesignError } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
/** Concrete inference boundaries retained unchanged in the candidate. */
export type DesignAutoLayoutSuggestionSkipReason =
  'active-layout' | 'instance' | 'component-set' | 'empty' | 'overlap' | 'transform' | 'hidden' | 'absolute'
/** Stored selection admission and bounded traversal; no inferred candidate is materialized by this read. */
export interface DesignAutoLayoutSuggestionContext {
  ids: string[]
  canSuggest: boolean
  reason?: DesignAutoLayoutReason | undefined
  inspectedCount: number
}
/** Actual rendered allocation envelopes in page coordinates, excluding paint outsets and virtual instance descendants. */
export interface DesignAutoLayoutSuggestionGeometryChange {
  id: string
  before: { x: number; y: number; width: number; height: number }
  after: { x: number; y: number; width: number; height: number }
}
/** Immutable review candidate; allocation changes compare preexisting stored layers rather than reparented local coordinates. */
export interface DesignAutoLayoutSuggestionResult {
  document: CopyOSDesignDocument
  selection: string[]
  createdIds: string[]
  convertedIds: string[]
  skipped: { id: string; reason: DesignAutoLayoutSuggestionSkipReason }[]
  geometryChanges: DesignAutoLayoutSuggestionGeometryChange[]
  inspectedCount: number
  createdCount: number
  convertedCount: number
  skippedCount: number
  geometryChangedCount: number
}
const MAX_NODES = 500, MAX_FRAMES = 128, MAX_DEPTH = 16, MAX_WORK = 500000
const container = (node: CopyOSDesignNode) => ['frame', 'group', 'component', 'component-set'].includes(node.kind)
const active = (node: CopyOSDesignNode) => node.layout !== 'none' && !node.preserveLayout
const transformed = (node: CopyOSDesignNode) => !!(node.rotation || node.flipX || node.flipY)
function index(document: CopyOSDesignDocument) {
  const byId = new Map(document.nodes.map(node => [node.id, node])), children = new Map<string, CopyOSDesignNode[]>()
  for (const node of document.nodes) if (node.parentId) {
    const list = children.get(node.parentId) ?? []; list.push(node); children.set(node.parentId, list)
  }
  const locked = (node: CopyOSDesignNode): boolean => {
    let current: CopyOSDesignNode | undefined = node
    while (current) { if (current.locked) return true; current = byId.get(current.parentId ?? '') }
    return false
  }
  return { byId, children, locked }
}
function admission(document: CopyOSDesignDocument, ids: readonly string[]) {
  const current = index(document), requested = new Set(ids)
  let reason: DesignAutoLayoutReason | undefined
  if (!ids.length || ids.length !== requested.size || ids.some(id => !current.byId.has(id))) reason = 'target'
  const roots = document.nodes.filter((node) => {
    if (!requested.has(node.id)) return false
    let parent = current.byId.get(node.parentId ?? '')
    while (parent) { if (requested.has(parent.id)) return false; parent = current.byId.get(parent.parentId ?? '') }
    return true
  })
  const first = roots[0], members = !!first?.parentId && current.byId.get(first.parentId)?.kind === 'component-set'
  if (!reason && first) {
    const page = (node: CopyOSDesignNode) => node.pageId ?? document.pages?.[0]?.id ?? null
    if (roots.some(node => page(node) !== page(first))) reason = 'page'
    else if (roots.some(node => node.parentId !== first.parentId)) reason = 'parent'
    else if (current.byId.get(first.parentId ?? '')?.kind === 'instance') reason = 'instance'
  }
  let inspectedCount = 0, potential = false
  const visit = (node: CopyOSDesignNode, depth: number): void => {
    inspectedCount++
    if (inspectedCount > MAX_NODES || depth > MAX_DEPTH) { reason ??= 'layout'; return }
    if (current.locked(node)) { reason ??= 'locked'; return }
    if (!node.visible || transformed(node) || node.kind === 'instance') return
    if (container(node)) {
      if (!active(node) && node.kind !== 'component-set' && (current.children.get(node.id)?.some(child => child.visible && !child.absolutePosition)))
        potential = true
      for (const child of current.children.get(node.id) ?? []) visit(child, depth + 1)
    }
  }
  if (!reason) for (const root of roots) visit(root, 0)
  const wrap = roots.length > 1 && !members || roots.length === 1 && !!first && !container(first)
  if (wrap && roots.some(node => node.visible && !transformed(node))) potential = true
  if (!reason && !potential) reason = 'layout'
  return { ...current, roots, wrap, reason, inspectedCount }
}
/** Inspect bounded nested Suggest admission without modifying source layers or allocating wrapper identities.
 * @param document - Validated immutable native document in its active mode.
 * @param ids - Unique stored selections; selected ancestors supersede selected descendants.
 * @returns Canonical selection and eligibility; component sets retain membership while visiting their member mains.
 */
export function designAutoLayoutSuggestionContext(document: CopyOSDesignDocument, ids: readonly string[])
  : DesignAutoLayoutSuggestionContext {
  const current = admission(document, ids)
  return { ids: current.roots.map(node => node.id), canSuggest: !current.reason, reason: current.reason,
    inspectedCount: current.inspectedCount }
}
type Band = { ids: string[]; axis: 'row' | 'column'; groups: Band[] }
function bands(nodes: readonly CopyOSDesignNode[], depth: number): Band | undefined {
  if (depth > MAX_DEPTH) throw new DesignAutoLayoutEditError('layout', 'Suggestion nesting exceeds native review budget')
  if (!nodes.length) return
  if (nodes.length === 1) return { ids: nodes.map(node => node.id), axis: 'column', groups: [] }
  const partition = (axis: 'x' | 'y', size: 'width' | 'height') => {
    const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]), result: CopyOSDesignNode[][] = []
    let edge = -Infinity
    for (const node of sorted) {
      if (node[axis] >= edge - .00001) { result.push([node]); edge = node[axis] + node[size] }
      else { result[result.length - 1]?.push(node); edge = Math.max(edge, node[axis] + node[size]) }
    }
    return result
  }
  const columns = partition('x', 'width'), rows = partition('y', 'height')
  if (columns.length < 2 && rows.length < 2) return
  const vertical = rows.length > 1 && (columns.length < 2 || rows.length <= columns.length)
  const split = vertical ? rows : columns, children: Band[] = []
  for (const group of split) if (group.length > 1) {
    const child = bands(group, depth + 1)
    if (!child) return
    children.push(child)
  }
  return { ids: nodes.map(node => node.id), axis: vertical ? 'column' : 'row', groups: children }
}
function allocation(scene: ReturnType<typeof createDesignRenderScene>, id: string) {
  const node = scene.root.byId.get(id)
  if (!node) return
  let points = [{ x: 0, y: 0 }, { x: node.width, y: 0 }, { x: node.width, y: node.height }, { x: 0, y: node.height }]
  let current: CopyOSDesignNode | undefined = node
  while (current) {
    const frame = current, angle = frame.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    points = points.map((point) => {
      const x = (frame.flipX ? frame.width - point.x : point.x) - frame.width / 2
      const y = (frame.flipY ? frame.height - point.y : point.y) - frame.height / 2
      return { x: frame.x + frame.width / 2 + x * cos - y * sin, y: frame.y + frame.height / 2 + x * sin + y * cos }
    })
    current = scene.root.byId.get(frame.parentId ?? '')
  }
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}
/** Preview deterministic nested spatial bands using explicit identity allocation; source documents remain immutable.
 * @param document - Validated document in the exact mode being reviewed.
 * @param ids - Stored root selection; linked internals are boundaries and active layouts retain their own settings.
 * @param newId - Required fresh UUID allocator; capture/replay its sequence for exact preview acceptance.
 * @returns Candidate, generated frames, skipped boundaries and actual page-relative allocation drift for existing stored layers.
 */
export function previewDesignAutoLayoutSuggestion(document: CopyOSDesignDocument, ids: readonly string[], newId: () => string)
  : DesignAutoLayoutSuggestionResult {
  const current = admission(document, ids)
  if (current.reason) throw new DesignAutoLayoutEditError(current.reason, 'Nested auto layout selection is not editable')
  const before = createDesignRenderScene(document), createdIds: string[] = [], convertedIds: string[] = []
  const skipped: DesignAutoLayoutSuggestionResult['skipped'] = [], known = new Set(document.nodes.map(node => node.id))
  let candidate = document, cachedDocument = document, cachedScene = before, work = 0
  const affectedIds = new Set<string>()
  const render = () => {
    if (cachedDocument !== candidate) { cachedScene = createDesignRenderScene(candidate); cachedDocument = candidate }
    return cachedScene
  }
  const skip = (id: string, reason: DesignAutoLayoutSuggestionSkipReason) => {
    if (!skipped.some(value => value.id === id && value.reason === reason)) skipped.push({ id, reason })
  }
  const allocate = (): string => {
    if (createdIds.length >= MAX_FRAMES) throw new DesignAutoLayoutEditError('layout', 'Suggestion frame budget exceeded')
    const id = newId()
    if (!z.uuid().safeParse(id).success || known.has(id))
      throw new DesignAutoLayoutEditError('identity', 'Suggestion requires fresh frame UUIDs')
    known.add(id); createdIds.push(id); return id
  }
  const materialize = (plan: Band, existing?: string): string => {
    work += candidate.nodes.length
    if (work > MAX_WORK) throw new DesignAutoLayoutEditError('layout', 'Suggestion work budget exceeded; use a smaller batch')
    let members = [...plan.ids]
    for (const group of plan.groups) {
      const id = materialize(group)
      const groupIds = new Set(group.ids), first = members.findIndex(value => groupIds.has(value))
      members = members.filter(value => !groupIds.has(value)); members.splice(Math.max(0, first), 0, id)
    }
    const scene = render(), displayed = members.flatMap((id) => {
      const value = scene.root.byId.get(id); return value ? [value] : []
    }).sort((a, b) => plan.axis === 'row' ? a.x - b.x : a.y - b.y)
    const gaps = displayed.slice(1).map((node, i) => {
      const previous = displayed[i]
      return previous ? plan.axis === 'row' ? node.x - previous.x - previous.width : node.y - previous.y - previous.height : 0
    })
    const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
    const id = existing ?? allocate(), original = existing ? candidate.nodes.find(node => node.id === existing) : undefined
    const result = composeDesignAutoLayout(candidate, existing ? [existing] : members, id, scene)
    candidate = result.document
    for (const affected of result.affectedIds) affectedIds.add(affected)
    const raw = candidate.nodes.find(node => node.id === result.selection)
    if (!raw) throw new DesignAutoLayoutEditError('target', 'Suggestion frame is missing')
    const policy = (axis: 'width' | 'height') => original ? original[`${axis}Sizing`] ??
        (original.layout === 'row' && axis === 'width' || (original.layout === 'column' || original.layout === 'grid') &&
          axis === 'height' ? 'hug' : 'fixed') : 'hug'
    const order = displayed.flatMap((node) => {
      const owned = candidate.nodes.find(value => value.id === node.id); return owned ? [owned] : []
    })
    const moving = new Set(order.map(node => node.id))
    let cursor = 0
    candidate = { ...candidate, nodes: candidate.nodes.map(node => node.id === raw.id ? { ...raw, layout: plan.axis,
      gap: raw.numericBindings?.gap ? raw.gap : gap, widthSizing: policy('width'), heightSizing: policy('height') } :
      moving.has(node.id) ? order[cursor++] ?? node : node) }
    if (result.rebaseIds.length) {
      const frame = render().root.byId.get(raw.id), movingReferences = new Set(result.rebaseIds)
      if (frame) {
        candidate = { ...candidate, nodes: candidate.nodes.map(node => movingReferences.has(node.id) && node.constraints ?
          { ...node, constraints: { ...node.constraints, referenceWidth: frame.width, referenceHeight: frame.height } } : node) }
      }
    }
    if (existing && candidate !== document) convertedIds.push(existing)
    return result.selection
  }
  const visit = (id: string): void => {
    const raw = candidate.nodes.find(node => node.id === id)
    if (!raw) return
    if (!raw.visible) { skip(id, 'hidden'); return }
    if (transformed(raw)) { skip(id, 'transform'); return }
    if (raw.kind === 'instance') { skip(id, 'instance'); return }
    if (!container(raw)) return
    for (const child of current.children.get(id) ?? []) visit(child.id)
    if (active(raw)) { skip(id, 'active-layout'); return }
    if (raw.kind === 'component-set') { skip(id, 'component-set'); return }
    const scene = render(), children = candidate.nodes.filter(node => node.parentId === id)
    for (const child of children) {
      if (!child.visible) skip(child.id, 'hidden')
      if (child.absolutePosition) skip(child.id, 'absolute')
    }
    const visible = children.filter(node => node.visible && !node.absolutePosition).map(node => scene.root.byId.get(node.id) ?? node)
    if (!visible.length) { skip(id, 'empty'); return }
    if (visible.some(transformed)) { skip(id, 'transform'); return }
    const plan = bands(visible, 0)
    if (!plan) { skip(id, 'overlap'); return }
    materialize(plan, id)
  }
  const groupCount = (plan: Band): number => 1 + plan.groups.reduce((sum, group) => sum + groupCount(group), 0)
  let estimatedFrames = 0
  const estimate = (node: CopyOSDesignNode): number => {
    if (!node.visible || transformed(node) || node.kind === 'instance' || !container(node)) return 0
    const children = current.children.get(node.id) ?? []
    const nested = children.reduce((sum, child) => sum + estimate(child), 0)
    if (active(node) || node.kind === 'component-set') return nested
    const visible = children.filter(child => child.visible && !child.absolutePosition)
      .map(child => before.root.byId.get(child.id) ?? child)
    const plan = visible.some(transformed) ? undefined : bands(visible, 0)
    const count = plan ? groupCount(plan) : 0
    estimatedFrames += Math.max(0, count - 1)
    return nested + count
  }
  let estimateCount = current.roots.reduce((sum, node) => sum + estimate(node), 0)
  if (current.wrap) {
    const plan = bands(current.roots.filter(node => node.visible).map(node => before.root.byId.get(node.id) ?? node), 0)
    if (plan) { estimateCount += groupCount(plan); estimatedFrames += groupCount(plan) }
  }
  if (estimatedFrames > MAX_FRAMES) throw new DesignAutoLayoutEditError('layout', 'Suggestion frame budget exceeded')
  if (estimateCount * (document.nodes.length + Math.min(MAX_FRAMES, estimateCount)) > MAX_WORK)
    throw new DesignAutoLayoutEditError('layout', 'Suggestion work budget exceeded; use a smaller batch')
  let selection = current.roots.map(node => node.id)
  try {
    if (current.wrap) {
      for (const root of current.roots) if (container(root)) visit(root.id)
      const scene = render()
      const roots = current.roots.map(node => scene.root.byId.get(node.id) ?? node)
      if (roots.some(transformed)) { for (const node of roots) if (transformed(node)) skip(node.id, 'transform') }
      else {
        const plan = bands(roots.filter(node => node.visible), 0)
        if (plan) selection = [materialize({ ...plan, ids: roots.map(node => node.id) })]
        else for (const node of roots) skip(node.id, 'overlap')
      }
    } else for (const root of current.roots) visit(root.id)
    if (candidate !== document) {
      parseDesignDocument(candidate)
      const scene = render()
      for (const id of affectedIds) {
        const node = scene.root.byId.get(id)
        if (node && (![node.width, node.height, node.x, node.y].every(Number.isFinite) || node.width < 1 || node.height < 1 ||
          node.width > 100000 || node.height > 100000 || Math.abs(node.x) > 1000000 || Math.abs(node.y) > 1000000))
          throw new DesignAutoLayoutEditError('layout', 'Suggestion allocation exceeds native limits')
      }
    }
  } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
  const after = candidate === document ? before : render()
  const geometryChanges: DesignAutoLayoutSuggestionGeometryChange[] = []
  if (candidate !== document) for (const node of document.nodes) {
    const a = allocation(before, node.id), b = allocation(after, node.id)
    if (a && b && (Math.abs(a.x - b.x) > .00001 || Math.abs(a.y - b.y) > .00001 ||
      Math.abs(a.width - b.width) > .00001 || Math.abs(a.height - b.height) > .00001))
      geometryChanges.push({ id: node.id, before: a, after: b })
  }
  return { document: candidate, selection, createdIds, convertedIds, skipped, geometryChanges,
    inspectedCount: current.inspectedCount, createdCount: createdIds.length, convertedCount: convertedIds.length,
    skippedCount: skipped.length, geometryChangedCount: geometryChanges.length }
}
/** Apply the same immutable Suggest planner after callers validate their exact reviewed document/mode boundary.
 * @param document - Exact authored scene being accepted.
 * @param ids - Reviewed stored root selection.
 * @param newId - Replay the preview allocation sequence or a deterministic allocator.
 * @returns One complete candidate and the same review metadata; callers commit it as one undoable transaction.
 */
export function suggestDesignAutoLayout(document: CopyOSDesignDocument, ids: readonly string[], newId: () => string)
  : DesignAutoLayoutSuggestionResult {
  return previewDesignAutoLayoutSuggestion(document, ids, newId)
}
