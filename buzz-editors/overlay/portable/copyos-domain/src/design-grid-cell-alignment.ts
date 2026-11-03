/** Cell alignment targets each child's own grid area, independently of stack-container alignment. */
import { createDesignRenderScene, createDesignInstanceGridCellReader, editDesignNodes } from './design-model.ts'
import { mergeDesignInstanceGridCells } from './design-instance-grid-cell.ts'
import { DesignAutoLayoutEditError } from './design-auto-layout.ts'
import { CopyOSDesignError, parseDesignDocument } from './design-schema.ts'
import type { DesignAlignmentTarget, DesignAutoLayoutAlignmentIntent } from './design-auto-layout-alignment.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
type Position = 'start' | 'center' | 'end'
/** Grid cells support spatial points and relative axis steps; stack distribution, baseline and automatic-spacing are excluded. */
export type DesignGridCellAlignmentIntent = Extract<DesignAutoLayoutAlignmentIntent, { type: 'spatial' | 'step' }>
/** Current cell position and precise local/source ownership for a stored or contextual grid child. */
export interface DesignGridCellAlignmentOwner {
  id: string
  path: string[]
  effectivePath: string[]
  overridePath: string[]
  parentId: string
  parentPath: string[] | null
  horizontal: Position
  vertical: Position
  localHorizontal: Position | undefined
  localVertical: Position | undefined
  sourceHorizontal: Position
  sourceVertical: Position
  horizontalOwned: boolean
  verticalOwned: boolean
  active: boolean
  inactiveReason?: 'parent' | 'paused' | 'absolute' | 'hidden' | undefined
  locked: boolean
  effectiveModeId: string | null
  widthFill: boolean
  heightFill: boolean
}
/** Atomic grid-cell admission; inactive cells remain readable but cannot receive a visible alignment intent. */
export interface DesignGridCellAlignmentContext {
  owners: DesignGridCellAlignmentOwner[]
  canEdit: boolean
  reason?: 'target' | 'locked' | 'layout' | undefined
}
type CurrentOwner = Omit<DesignGridCellAlignmentOwner, 'sourceHorizontal' | 'sourceVertical'>
const key = (owner: CurrentOwner) => JSON.stringify([owner.id, owner.effectivePath])
function read(document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[]) {
  const byId = new Map(document.nodes.map(node => [node.id, node])), scene = createDesignRenderScene(document)
  const reader = createDesignInstanceGridCellReader(document, scene, { includeSourceCell: false })
  const owners: CurrentOwner[] = [], seen = new Set<string>()
  let reason: DesignGridCellAlignmentContext['reason'] = targets.length ? undefined : 'target'
  for (const target of targets) {
    const id = typeof target === 'string' ? target : target.nodeId, path = typeof target === 'string' ? [] : [...target.path ?? []]
    const raw = byId.get(id), rendered = scene.root.byId.get(id)
    if (!raw || !rendered) { reason ??= 'target'; continue }
    let ancestor: CopyOSDesignNode | undefined = raw, locked = false
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id); locked ||= ancestor.locked; ancestor = byId.get(ancestor.parentId ?? '')
    }
    let node = rendered, parent = scene.root.byId.get(raw.parentId ?? ''), local = raw.gridCell
    let effectivePath = path, overridePath = path, parentPath: string[] | null = null
    let effectiveModeId = scene.root.modes.get(id) ?? null
    if (path.length) {
      const current = reader(id, path)
      if (!current) { reason ??= 'target'; continue }
      node = current.node; parent = current.parent; local = current.localCell
      effectivePath = current.effectivePath; overridePath = current.overridePath; parentPath = current.parentPath
      effectiveModeId = current.context.modes.get(node.id) ?? null
      locked ||= current.locked
    }
    if (!parent) { reason ??= 'layout'; continue }
    const inactiveReason = parent.layout !== 'grid' ? 'parent' : parent.preserveLayout ? 'paused' :
      node.absolutePosition ? 'absolute' : !node.visible ? 'hidden' : undefined
    if (locked) reason ??= 'locked'
    if (inactiveReason) reason ??= 'layout'
    const owner: CurrentOwner = { id, path, effectivePath, overridePath, parentId: parent.id, parentPath,
      horizontal: node.gridCell?.horizontalAlign ?? 'start', vertical: node.gridCell?.verticalAlign ?? 'start',
      localHorizontal: local?.horizontalAlign, localVertical: local?.verticalAlign,
      horizontalOwned: local?.horizontalAlign !== undefined, verticalOwned: local?.verticalAlign !== undefined,
      active: !inactiveReason, inactiveReason, locked, effectiveModeId,
      widthFill: node.widthSizing === 'fill', heightFill: node.heightSizing === 'fill' }
    const identity = key(owner)
    if (seen.has(identity)) reason ??= 'target'
    seen.add(identity); owners.push(owner)
  }
  return { owners, canEdit: !reason, reason, byId, scene }
}
/** Read cell alignment and exact inherited/local enums without interpreting grid-container stack fields as cell defaults.
 * @param document - Valid immutable scene.
 * @param targets - Stored children or linked descendant paths; each child aligns to its respective cell.
 * @returns Current values, precise inherited source enums and atomic admission sharing one counterfactual per stored override owner.
 */
export function designGridCellAlignmentContext(
  document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[],
): DesignGridCellAlignmentContext {
  const current = read(document, targets), sourceOwners = new Map<string, CopyOSDesignNode>()
  const groups = new Map<string, DesignAlignmentTarget[]>()
  for (const owner of current.owners) {
    if (!owner.path.length || !owner.horizontalOwned && !owner.verticalOwned) continue
    const raw = sourceOwners.get(owner.id) ?? current.byId.get(owner.id)
    if (raw) sourceOwners.set(owner.id, mergeDesignInstanceGridCells(raw, [{ path: owner.overridePath,
      patch: { horizontalAlign: undefined, verticalAlign: undefined } }]))
    const group = groups.get(owner.id) ?? []
    group.push({ nodeId: owner.id, path: owner.effectivePath }); groups.set(owner.id, group)
  }
  // One stored override layer can be cleared together, but other owners may be its inherited library sources.
  const inherited = new Map(current.owners.map(owner => [key(owner), owner]))
  for (const [id, sourceOwner] of sourceOwners) {
    const source = read({ ...document, nodes: document.nodes.map(node => node.id === id ? sourceOwner : node) }, groups.get(id) ?? [])
    for (const owner of source.owners) inherited.set(key(owner), owner)
  }
  return { canEdit: current.canEdit, reason: current.reason, owners: current.owners.map((owner) => {
    const original = inherited.get(key(owner))
    if (!original) throw new Error('Grid cell source alignment target disappeared')
    return { ...owner, sourceHorizontal: original.horizontal, sourceVertical: original.vertical }
  }) }
}
function desired(owner: CurrentOwner, intent: DesignGridCellAlignmentIntent) {
  const fields: NonNullable<CopyOSDesignNode['gridCell']> = {}
  if (intent.type === 'spatial') {
    if (intent.horizontal !== undefined) fields.horizontalAlign = intent.horizontal
    if (intent.vertical !== undefined) fields.verticalAlign = intent.vertical
  } else {
    const values = ['start', 'center', 'end'] as const, current = owner[intent.axis]
    const value = values[Math.max(0, Math.min(2, values.indexOf(current) + intent.direction))] ?? 'start'
    if (intent.axis === 'horizontal') fields.horizontalAlign = value
    else fields.verticalAlign = value
  }
  return fields
}
/** Align grid children atomically while preserving anchors, spans, sizing, resources and unrelated linked overrides.
 * @param document - Valid immutable native scene.
 * @param targets - Unique active visible, non-absolute cell children under active grid parents; different grids are supported.
 * @param intent - Spatial point/axis or relative step, computed from each original target before source/consumer staging.
 * @returns Original identity for matching alignment; changed contextual enums own only their changed axes.
 * @throws DesignAutoLayoutEditError when any target is missing, locked, inactive or the complete candidate is invalid.
 */
export function setDesignGridCellAlignment(
  document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[], intent: DesignGridCellAlignmentIntent,
): CopyOSDesignDocument {
  const initial = read(document, targets)
  if (!initial.canEdit) throw new DesignAutoLayoutEditError(initial.reason ?? 'layout', 'Grid cell alignment selection is not editable')
  const requests = new Map(initial.owners.map(owner => [key(owner), desired(owner, intent)]))
  const original = new Map(initial.owners.map(owner => [key(owner), owner]))
  const acquired = new Map<string, { target: DesignAlignmentTarget; horizontal: boolean; vertical: boolean }>()
  try {
    let candidate = document
    for (const phase of ['ordinary', 'root', 'descendant'] as const) {
      const current = candidate === document ? initial : read(candidate, targets)
      const updates = new Map<string, { id: string } & Partial<CopyOSDesignNode>>()
      for (const owner of current.owners) {
        const raw = current.byId.get(owner.id)
        if (!raw || (owner.path.length ? 'descendant' : raw.kind === 'instance' ? 'root' : 'ordinary') !== phase) continue
        const fields = { ...requests.get(key(owner)) }
        if (fields.horizontalAlign === owner.horizontal) delete fields.horizontalAlign
        if (fields.verticalAlign === owner.vertical) delete fields.verticalAlign
        if (!Object.keys(fields).length) continue
        if (phase !== 'descendant') updates.set(raw.id, { id: raw.id, gridCell: { ...raw.gridCell, ...fields } })
        else {
          const before = original.get(key(owner))
          if (before) {
            const horizontal = fields.horizontalAlign !== undefined && !before.horizontalOwned
            const vertical = fields.verticalAlign !== undefined && !before.verticalOwned
            if (horizontal || vertical)
              acquired.set(key(owner), { target: { nodeId: owner.id, path: owner.effectivePath }, horizontal, vertical })
          }
          const previous = updates.get(raw.id), staged = previous ? { ...raw, ...previous } : raw
          const next = mergeDesignInstanceGridCells(staged, [{ path: owner.overridePath, patch: fields }])
          updates.set(raw.id, { id: raw.id, instanceOverrides: next.instanceOverrides })
        }
      }
      if (updates.size) candidate = editDesignNodes(candidate, [...updates.values()])
    }
    if (candidate === document) return document
    if (acquired.size) {
      // Library instances and their consumers can both be descendant targets in the same phase.
      // Remove only newly acquired axes already supplied by their final inherited override layer.
      const context = designGridCellAlignmentContext(candidate, [...acquired.values()].map(value => value.target))
      const byId = new Map(candidate.nodes.map(node => [node.id, node])), updates = new Map<string, CopyOSDesignNode>()
      for (const owner of context.owners) {
        const capture = acquired.get(key(owner)), raw = updates.get(owner.id) ?? byId.get(owner.id)
        if (!capture || !raw) continue
        const patch: NonNullable<CopyOSDesignNode['gridCell']> = {}
        if (capture.horizontal && owner.horizontal === owner.sourceHorizontal) patch.horizontalAlign = undefined
        if (capture.vertical && owner.vertical === owner.sourceVertical) patch.verticalAlign = undefined
        if (Object.keys(patch).length) updates.set(raw.id, mergeDesignInstanceGridCells(raw, [{ path: owner.overridePath, patch }]))
      }
      if (updates.size) candidate = { ...candidate, nodes: candidate.nodes.map((node) => {
        const changed = updates.get(node.id), before = initial.byId.get(node.id)
        if (!changed) return node
        return before && JSON.stringify(changed) === JSON.stringify(before) ? before : changed
      }) }
    }
    parseDesignDocument(candidate)
    return candidate
  } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
}
