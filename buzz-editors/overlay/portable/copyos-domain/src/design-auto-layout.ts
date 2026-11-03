/** Explicit auto-layout conversion edits authored fields while using one scene only for geometry. */
import { z } from 'zod'
import { designConstraintsActive } from './design-constraints.ts'
import { designLayoutBox } from './design-layout-box.ts'
import { createDesignNode, createDesignRenderScene, editDesignNodes } from './design-model.ts'
import { defaultDesignGrid } from './design-grid.ts'
import { designNumberTokenSupportsProperty } from './design-token-values.ts'
import { parseDesignDocument, CopyOSDesignError } from './design-schema.ts'
import { markDesignInstanceSizingEdit } from './design-instance-sizing.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
/** Admission failures shared by auto-layout commands and read-only eligibility. */
export type DesignAutoLayoutReason = 'target' | 'locked' | 'parent' | 'page' | 'instance' | 'layout'
/** Expected atomic authoring failures remain separate from rendering/programming errors. */
export class DesignAutoLayoutEditError extends Error {
  /** Create a localized-command admission failure.
   * @param code - Invalid selection, lock, parent/page, instance, layout or wrapper identity.
   * @param message - Internal diagnostic; consumers localize by code.
   */
  constructor(readonly code: DesignAutoLayoutReason | 'identity', message: string) { super(message) }
}
/** Stored-root eligibility; Add is intentionally idempotent for an existing active stack. */
export interface DesignAutoLayoutContext {
  ids: string[]
  canAdd: boolean
  canRemove: boolean
  canRemoveAll: boolean
  addKind: 'existing' | 'wrap' | 'unchanged' | null
  addReason?: DesignAutoLayoutReason | undefined
  removeReason?: DesignAutoLayoutReason | undefined
  removeAllReason?: DesignAutoLayoutReason | undefined
}
const container = (node: CopyOSDesignNode) => ['frame', 'group', 'component', 'component-set'].includes(node.kind)
const active = (node: CopyOSDesignNode) => ['row', 'column', 'grid'].includes(node.layout) && !node.preserveLayout
function policy(node: CopyOSDesignNode, axis: 'width' | 'height'): 'fixed' | 'hug' | 'fill' {
  if (node.kind === 'text' && (node.textSizing === 'auto-width' || axis === 'height' && node.textSizing === 'auto-height')) return 'hug'
  return node[`${axis}Sizing`] ?? (node.layout === 'row' && axis === 'width' ||
    (node.layout === 'column' || node.layout === 'grid') && axis === 'height' ? 'hug' : 'fixed')
}
// Inspector controls query several selections per render; the read-only layer indexes depend only on the layer list.
const layerIndexes = new WeakMap<readonly CopyOSDesignNode[], {
  length: number
  byId: ReadonlyMap<string, CopyOSDesignNode>
  children: ReadonlyMap<string, readonly CopyOSDesignNode[]>
}>()
function indexes(nodes: readonly CopyOSDesignNode[]) {
  const cached = layerIndexes.get(nodes)
  if (cached && cached.length === nodes.length) return cached
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of nodes) if (node.parentId) {
    const list = children.get(node.parentId) ?? []; list.push(node); children.set(node.parentId, list)
  }
  const value = { length: nodes.length, byId: new Map(nodes.map(node => [node.id, node])), children }
  layerIndexes.set(nodes, value)
  return value
}
function selection(document: CopyOSDesignDocument, ids: readonly string[]) {
  const { byId, children } = indexes(document.nodes)
  const requested = new Set(ids)
  const locked = (node: CopyOSDesignNode): boolean => {
    let current: CopyOSDesignNode | undefined = node
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      if (current.locked) return true
      seen.add(current.id); current = byId.get(current.parentId ?? '')
    }
    return false
  }
  let reason: DesignAutoLayoutReason | undefined
  if (!ids.length || requested.size !== ids.length || ids.some(id => !byId.has(id))) reason = 'target'
  else if (ids.some((id) => { const node = byId.get(id); return !!node && locked(node) })) reason = 'locked'
  const roots = document.nodes.filter((node) => {
    if (!requested.has(node.id)) return false
    let parent = node.parentId
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      if (requested.has(parent)) return false
      seen.add(parent); parent = byId.get(parent)?.parentId ?? null
    }
    return true
  })
  return { byId, children, roots, reason, locked }
}
function removals(document: CopyOSDesignDocument, ids: readonly string[], recursive: boolean) {
  const current = selection(document, ids), targets = new Set<string>()
  let reason = current.reason
  for (const root of current.roots) {
    if (root.kind === 'instance') { reason ??= 'instance'; continue }
    if (!container(root)) { reason ??= 'layout'; continue }
    const queue = [root]
    for (const node of queue) {
      if (node.kind === 'instance') continue
      if (container(node) && node.layout !== 'none') {
        if (current.locked(node)) reason ??= 'locked'
        targets.add(node.id)
      }
      if (recursive) queue.push(...current.children.get(node.id) ?? [])
    }
    if (!recursive && !targets.has(root.id)) reason ??= 'layout'
  }
  if (!targets.size) reason ??= 'layout'
  return { ...current, targets, reason }
}
/** Read Add, Remove and Remove all admission using stored hierarchy indexes and inherited locks.
 * @param document - Validated immutable native scene; virtual instance descendants are not stored targets.
 * @param ids - Unique stored identities; selected ancestors supersede their selected descendants.
 * @returns Canonical roots, action eligibility and machine-readable rejection reasons without changing the document.
 */
export function designAutoLayoutContext(document: CopyOSDesignDocument, ids: readonly string[]): DesignAutoLayoutContext {
  const current = selection(document, ids), first = current.roots[0]
  let addReason = current.reason
  let addKind: DesignAutoLayoutContext['addKind'] = null
  if (!addReason && first) {
    const page = (node: CopyOSDesignNode) => node.pageId ?? document.pages?.[0]?.id ?? null
    if (current.roots.some(node => page(node) !== page(first))) addReason = 'page'
    else if (current.roots.some(node => node.parentId !== first.parentId)) addReason = 'parent'
    else if (current.roots.length === 1 && container(first)) addKind = active(first) ? 'unchanged' : 'existing'
    else if (current.byId.get(first.parentId ?? '')?.kind === 'component-set') addReason = 'parent'
    else if (current.byId.get(first.parentId ?? '')?.kind === 'instance') addReason = 'instance'
    else addKind = 'wrap'
  }
  const remove = removals(document, ids, false), all = removals(document, ids, true)
  return { ids: current.roots.map(node => node.id), canAdd: !addReason && !!addKind, addKind,
    canRemove: !remove.reason, canRemoveAll: !all.reason, addReason, removeReason: remove.reason, removeAllReason: all.reason }
}
/** Enable a stack on a free container, or wrap sibling selections while retaining authored styles, bindings and sizing policies.
 * @param document - Admitted immutable scene.
 * @param ids - Unique editable stored selections; ancestors supersede descendants.
 * @param frameId - Fresh UUID used only when a wrapper is necessary.
 * @returns Edited scene and container selection; active stacks return the original scene unchanged.
 * Direction/gap inference uses native allocation boxes.
 */
export function addDesignAutoLayout(document: CopyOSDesignDocument, ids: readonly string[], frameId: string)
  : { document: CopyOSDesignDocument; selection: string } {
  const admission = designAutoLayoutContext(document, ids)
  if (!admission.canAdd) throw new DesignAutoLayoutEditError(admission.addReason ?? 'target', 'Auto layout selection is not editable')
  if (admission.addKind === 'unchanged') {
    const id = admission.ids[0]
    if (id) return { document, selection: id }
  }
  const result = composeDesignAutoLayout(document, ids, frameId, createDesignRenderScene(document))
  const after = validateConversion(result.document, new Set(result.affectedIds)), frame = after.root.byId.get(result.selection)
  return { document: frame && result.rebaseIds.length ? { ...result.document, nodes: result.document.nodes.map(node =>
    result.rebaseIds.includes(node.id) && node.constraints ? { ...node,
      constraints: { ...node.constraints, referenceWidth: frame.width, referenceHeight: frame.height } } : node) } : result.document,
  selection: result.selection }
}
/** Compose one admitted Add operation against a caller-owned current scene, deferring final graph/geometry admission.
 * @param document - Immutable authoring candidate; internal callers validate the complete final transaction.
 * @param ids - Stored selection with the same admission semantics as public Add.
 * @param frameId - Fresh wrapper identity when wrapping is necessary.
 * @param scene - Resolved geometry for this exact candidate.
 * @returns Composition plus affected layers and moved constraint references to rebase after layout resolves.
 * @internal
 */
export function composeDesignAutoLayout(document: CopyOSDesignDocument, ids: readonly string[], frameId: string,
  scene: ReturnType<typeof createDesignRenderScene>)
  : { document: CopyOSDesignDocument; selection: string; rebaseIds: string[]; affectedIds: string[] } {
  const admission = designAutoLayoutContext(document, ids)
  if (!admission.canAdd) throw new DesignAutoLayoutEditError(admission.addReason ?? 'target', 'Auto layout selection is not editable')
  const indexed = selection(document, ids), first = indexed.roots[0]
  if (!first) throw new DesignAutoLayoutEditError('target', 'Auto layout selection is empty')
  if (admission.addKind === 'unchanged') return { document, selection: first.id, rebaseIds: [], affectedIds: [] }
  const existing = admission.addKind === 'existing'
  if (!existing && (!z.uuid().safeParse(frameId).success || indexed.byId.has(frameId)))
    throw new DesignAutoLayoutEditError('identity', 'Auto layout wrapper requires a fresh UUID')
  const authoredChildren = existing ? indexed.children.get(first.id) ?? [] : indexed.roots
  const allChildren = authoredChildren.map(node => scene.root.byId.get(node.id) ?? node)
  const visible = allChildren.filter(node => node.visible && (!existing || !node.absolutePosition))
  const children = visible.length ? visible : existing ? [] : allChildren
  const bounds = children.length ? { x: Math.min(...children.map(node => node.x)), y: Math.min(...children.map(node => node.y)),
    right: Math.max(...children.map(node => node.x + node.width)), bottom: Math.max(...children.map(node => node.y + node.height)) } :
    { x: 0, y: 0, right: 0, bottom: 0 }
  const spread = (axis: 'x' | 'y', dimension: 'width' | 'height') => children.length > 1 ?
    Math.max(...children.map(node => node[axis] + node[dimension] / 2)) -
      Math.min(...children.map(node => node[axis] + node[dimension] / 2)) : 0
  const row = spread('x', 'width') > spread('y', 'height')
  const compare = (a: CopyOSDesignNode, b: CopyOSDesignNode) => row ? a.x - b.x : a.y - b.y
  const sorted = [...(existing ? children : allChildren)].sort(compare)
  const measured = [...children].sort(compare)
  const gaps = measured.slice(1).map((node, i) => {
    const previous = measured[i]
    return previous ? row ? node.x - previous.x - previous.width : node.y - previous.y - previous.height : 0
  })
  const gap = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0
  if (Math.abs(gap) > 10000) throw new DesignAutoLayoutEditError('layout', 'Inferred gap exceeds native limits')
  const target = existing ? first : { ...createDesignNode('frame', frameId, 'Auto layout'), parentId: first.parentId,
    pageId: first.pageId, absolutePosition: indexed.roots.every(node => node.absolutePosition) &&
      !!scene.root.byId.get(first.parentId ?? '') && active(scene.root.byId.get(first.parentId ?? '') ?? first),
    fillOpacity: 0, padding: 0, clip: false, widthSizing: 'hug' as const, heightSizing: 'hug' as const }
  const displayed = existing ? scene.root.byId.get(first.id) ?? first : undefined
  const bindings = target.numericBindings
  // Inference observes outer-frame coordinates; the active layout adds its stroke insets separately.
  const strokeInsets = designLayoutBox({ ...(displayed ?? target), layout: row ? 'row' : 'column', preserveLayout: false,
    layoutSizingModel: target.layoutSizingModel ?? 'css', padding: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 })
  const side = (key: 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft', inferred: number) =>
    bindings?.padding || bindings?.[key] ? target[key] : inferred
  const containerNode: CopyOSDesignNode = { ...target, kind: target.kind === 'group' ? 'frame' : target.kind,
    layout: row ? 'row' : 'column', preserveLayout: false, layoutSizingModel: target.layoutSizingModel ?? 'css', gap: bindings?.gap ? target.gap : gap,
    numericBindings: bindings, x: existing ? target.x : bounds.x, y: existing ? target.y : bounds.y,
    paddingTop: side('paddingTop', existing ? Math.max(0, bounds.y - strokeInsets.top) : 0),
    paddingLeft: side('paddingLeft', existing ? Math.max(0, bounds.x - strokeInsets.left) : 0),
    paddingRight: side('paddingRight', displayed ? Math.max(0, displayed.width - bounds.right - strokeInsets.right) : 0),
    paddingBottom: side('paddingBottom', displayed ? Math.max(0, displayed.height - bounds.bottom - strokeInsets.bottom) : 0) }
  let naturalScene: ReturnType<typeof createDesignRenderScene> | undefined
  const movedIds = new Set(sorted.map(node => node.id))
  const natural = (id: string) => {
    naturalScene ??= createDesignRenderScene({ ...document, nodes: document.nodes.map(node =>
      movedIds.has(node.id) ? { ...node, constraints: undefined } : node) })
    return naturalScene.root.byId.get(id)
  }
  const moved = sorted.map((display) => {
    const raw = indexed.byId.get(display.id)
    if (!raw) throw new DesignAutoLayoutEditError('target', 'Auto layout child is missing')
    if (existing) return raw
    const fields: Partial<CopyOSDesignNode> = { parentId: target.id, absolutePosition: false,
      x: display.x - bounds.x, y: display.y - bounds.y }
    const childBindings = { ...raw.numericBindings }
    const oldParent = scene.root.byId.get(raw.parentId ?? '')
    for (const axis of ['width', 'height'] as const) {
      const pin = axis === 'width' ? raw.constraints?.horizontal : raw.constraints?.vertical
      const forced = oldParent && raw.constraints && designConstraintsActive(raw, oldParent) &&
        ['scale', axis === 'width' ? 'left-right' : 'top-bottom'].includes(pin ?? '') &&
        Math.abs(display[axis] - (natural(raw.id)?.[axis] ?? display[axis])) > .00001
      if (policy(display, axis) === 'fill' || forced) {
        fields[axis] = display[axis]; fields[`${axis}Sizing`] = 'fixed'
        if (axis === 'width') delete childBindings.width
        else delete childBindings.height
        fields.numericBindings = childBindings
      }
    }
    return markDesignInstanceSizingEdit(raw, fields)
  })
  let nodes: CopyOSDesignNode[]
  if (existing) {
    const moving = new Set(sorted.map(node => node.id))
    let cursor = 0
    nodes = document.nodes.map(node => node.id === target.id ? containerNode : moving.has(node.id) ? moved[cursor++] ?? node : node)
  } else {
    const moving = new Set(indexed.roots.map(node => node.id))
    const insert = document.nodes.findIndex(node => moving.has(node.id))
    nodes = document.nodes.filter(node => !moving.has(node.id))
    nodes.splice(Math.max(0, insert), 0, containerNode, ...moved)
  }
  const candidate = { ...document, nodes }
  return { document: candidate, selection: target.id, rebaseIds: existing ? [] : [...movedIds],
    affectedIds: [target.id, ...moved.map(node => node.id)] }
}
/** Remove selected layouts, optionally including nested editable containers, without copying runtime paints or effects into storage.
 * @param document - Admitted immutable scene.
 * @param ids - Unique editable stored targets; instances reject and recursive traversal stops at instance boundaries.
 * @param options - Recursive removal includes nested container layouts; one locked target rejects the whole operation.
 * @returns Free-positioned geometry; only Hug/Fill dimensions becoming Fixed detach their matching dimension binding.
 */
export function removeDesignAutoLayout(document: CopyOSDesignDocument, ids: readonly string[], options: { recursive?: boolean } = {})
  : CopyOSDesignDocument {
  const current = removals(document, ids, !!options.recursive)
  if (current.reason) throw new DesignAutoLayoutEditError(current.reason, 'Auto layout removal is not editable')
  const scene = createDesignRenderScene(document)
  const candidate = { ...document, nodes: document.nodes.map((raw) => {
    const display = scene.root.byId.get(raw.id) ?? raw
    const selected = current.targets.has(raw.id), child = !!raw.parentId && current.targets.has(raw.parentId)
    if (!selected && !child) return raw
    const fields: Partial<CopyOSDesignNode> = selected ? { layout: 'none', preserveLayout: false } : {}
    const bindings = { ...raw.numericBindings }
    let changedSize = false
    for (const axis of ['width', 'height'] as const) {
      const value = policy(display, axis)
      if ((selected && value !== 'fixed') || (child && value === 'fill')) {
        fields[axis] = display[axis]; fields[`${axis}Sizing`] = 'fixed'
        if (axis === 'width') delete bindings.width
        else delete bindings.height
        changedSize = true
      }
    }
    if (child) { fields.x = display.x; fields.y = display.y }
    const parent = scene.root.byId.get(raw.parentId ?? '')
    if (raw.constraints && parent && (child || changedSize)) {
      fields.constraints = { ...raw.constraints, referenceWidth: parent.width, referenceHeight: parent.height }
      fields.x = display.x; fields.y = display.y
    }
    if (changedSize) fields.numericBindings = bindings
    return markDesignInstanceSizingEdit(raw, fields)
  }) }
  validateConversion(candidate, new Set(candidate.nodes.filter(node => current.targets.has(node.id) ||
    !!node.parentId && current.targets.has(node.parentId)).map(node => node.id)))
  return candidate
}

function validateConversion(document: CopyOSDesignDocument, ids: ReadonlySet<string>): ReturnType<typeof createDesignRenderScene> {
  try { parseDesignDocument(document) } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
  const scene = createDesignRenderScene(document)
  for (const id of ids) {
    const node = scene.root.byId.get(id)
    if (node && (![node.width, node.height, node.x, node.y].every(Number.isFinite) || node.width < 1 || node.height < 1 ||
      node.width > 100000 || node.height > 100000 || Math.abs(node.x) > 1000000 || Math.abs(node.y) > 1000000))
      throw new DesignAutoLayoutEditError('layout', 'Auto layout geometry exceeds native limits')
  }
  return scene
}

/** Apply explicit flow intent without capturing matching inherited directions or changing raw dimension resources.
 * @param document - Valid immutable scene.
 * @param ids - Unique stored container identities; every explicit descendant remains a target.
 * @param flow - Requested stack direction or ordinary-container grid layout.
 * @returns Original scene when all targets already match actively; otherwise one atomically validated candidate.
 * @throws DesignAutoLayoutEditError when any target is missing, locked, free-positioned or incompatible.
 */
export function setDesignAutoLayoutFlow(
  document: CopyOSDesignDocument, ids: readonly string[], flow: 'row' | 'column' | 'grid',
): CopyOSDesignDocument {
  const current = selection(document, ids)
  if (current.reason) throw new DesignAutoLayoutEditError(current.reason, 'Flow selection is not editable')
  const scene = createDesignRenderScene(document), requested = new Set(ids)
  const updates: ({ id: string } & Partial<CopyOSDesignNode>)[] = []
  for (const id of ids) {
    const raw = current.byId.get(id)
    if (!raw) throw new DesignAutoLayoutEditError('target', 'Flow target is missing')
    const rendered = scene.root.byId.get(id) ?? raw
    if (raw.kind === 'instance') {
      const source = current.byId.get(raw.componentId ?? '')
      if (!source || !['row', 'column'].includes(source.layout) || flow === 'grid')
        throw new DesignAutoLayoutEditError('instance', 'Linked flow requires a row or column source and direction')
      const effective = scene.instance(rendered, scene.root)?.byId.get(source.id)
      if (!effective) throw new DesignAutoLayoutEditError('instance', 'Linked flow source is unavailable')
      // A selected main supplies the same explicit intent; avoid redundant local ownership.
      const selectedSource = requested.has(source.id)
      const finalFlow = selectedSource ? raw.instanceLayout?.layout ?? flow : effective.layout
      if (finalFlow === flow && (selectedSource || !effective.preserveLayout)) continue
      updates.push({ id, instanceLayout: { ...raw.instanceLayout, layout: flow } })
      continue
    }
    if (!container(raw) || !['row', 'column', 'grid'].includes(raw.layout))
      throw new DesignAutoLayoutEditError('layout', 'Enable auto layout before choosing its flow')
    if (rendered.layout === flow && !rendered.preserveLayout) continue
    const fields: { id: string } & Partial<CopyOSDesignNode> = { id, layout: flow, preserveLayout: false,
      widthSizing: policy(rendered, 'width'), heightSizing: policy(rendered, 'height') }
    if (flow === 'grid') {
      fields.grid = raw.grid ?? defaultDesignGrid()
      const binding = raw.numericBindings?.gap
      const incompatibleBinding = binding && !designNumberTokenSupportsProperty(document, binding, 'gap', { layout: 'grid' })
      if (raw.gap < 0 || rendered.gap < 0 || incompatibleBinding) {
        fields.gap = Math.max(0, rendered.gap)
        if (incompatibleBinding)
          fields.numericBindings = Object.fromEntries(Object.entries(raw.numericBindings ?? {}).filter(([key]) => key !== 'gap'))
      }
    }
    updates.push(fields)
  }
  if (!updates.length) return document
  try {
    const candidate = editDesignNodes(document, updates)
    validateConversion(candidate, new Set(ids))
    return candidate
  } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
}
