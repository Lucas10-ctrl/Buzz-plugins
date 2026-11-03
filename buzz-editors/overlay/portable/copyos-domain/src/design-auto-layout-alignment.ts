/** Spatial layout authoring maps each stored owner's orientation without flattening linked or resource ownership. */
import { createDesignRenderScene, editDesignNodes } from './design-model.ts'
import { designInstanceLayoutContext, mergeDesignInstanceLayouts } from './design-instance-layout-context.ts'
import { designInstanceSizingOwns } from './design-instance-sizing.ts'
import { DesignAutoLayoutEditError } from './design-auto-layout.ts'
import { CopyOSDesignError, parseDesignDocument } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
type Position = 'start' | 'center' | 'end'
type Alignment = NonNullable<CopyOSDesignNode['alignItems']>
type Distribution = NonNullable<CopyOSDesignNode['justifyContent']>
type Fields = Pick<CopyOSDesignNode, 'alignItems' | 'justifyContent'>
/** Explicit spatial axes and ensure-state commands; step operates independently on every selected owner's spatial value. */
export type DesignAutoLayoutAlignmentIntent =
  | ({ type: 'spatial' } & ({ horizontal: Position; vertical?: Position } | { horizontal?: Position; vertical: Position }))
  | { type: 'step'; axis: 'horizontal' | 'vertical'; direction: -1 | 1 }
  | { type: 'distribution'; value: Distribution }
  | { type: 'baseline'; enabled: boolean }
  | { type: 'auto-spacing'; enabled: boolean }
/** Stored owner with optional contextual instance hops; string identity callers remain supported. */
export interface DesignAlignmentTarget {
  nodeId: string
  path?: readonly string[] | undefined
}
/** Effective spatial state and authored alignment ownership for one ordinary, linked-root or contextual container. */
export interface DesignAutoLayoutAlignmentOwner {
  id: string
  path: string[]
  effectivePath: string[]
  overridePath: string[]
  effectiveModeId: string | null
  flow: 'row' | 'column'
  horizontal: Position | null
  vertical: Position | null
  distribution: Distribution
  baseline: boolean
  automatic: boolean
  automaticActive: boolean
  paused: boolean
  locked: boolean
  localAlignItems: Alignment | undefined
  localJustifyContent: Distribution | undefined
  sourceAlignItems: Alignment
  sourceJustifyContent: Distribution
  alignItemsOwned: boolean
  justifyContentOwned: boolean
}
/** Atomic alignment admission and per-owner state; grids and free frames are excluded. */
export interface DesignAutoLayoutAlignmentContext {
  owners: DesignAutoLayoutAlignmentOwner[]
  canEdit: boolean
  canBaseline: boolean
  reason?: 'target' | 'locked' | 'layout' | 'instance' | undefined
}
const ownerKey = (owner: DesignAutoLayoutAlignmentOwner) => JSON.stringify([owner.id, owner.effectivePath])
function read(document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[]) {
  const byId = new Map(document.nodes.map(node => [node.id, node])), scene = createDesignRenderScene(document)
  const owners: DesignAutoLayoutAlignmentOwner[] = [], seen = new Set<string>()
  let reason: DesignAutoLayoutAlignmentContext['reason'] = targets.length ? undefined : 'target'
  for (const target of targets) {
    const id = typeof target === 'string' ? target : target.nodeId, path = typeof target === 'string' ? [] : [...target.path ?? []]
    const raw = byId.get(id), rendered = scene.root.byId.get(id)
    if (!raw || !rendered) { reason ??= 'target'; continue }
    let ancestor: CopyOSDesignNode | undefined = raw, locked = false
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id); locked ||= ancestor.locked; ancestor = byId.get(ancestor.parentId ?? '')
    }
    let source: Pick<CopyOSDesignNode, 'layout' | 'alignItems' | 'justifyContent'> | undefined = raw
    let effective: CopyOSDesignNode | undefined = rendered, sizingOwner: CopyOSDesignNode | undefined
    let localAlignItems = raw.alignItems, localJustifyContent = raw.justifyContent
    let effectivePath = path, overridePath = path, effectiveModeId = scene.root.modes.get(id) ?? null
    if (path.length) {
      const current = designInstanceLayoutContext(document, id, path, scene)
      if (!current) { reason ??= 'target'; continue }
      source = current.sourceLayout; effective = current.node
      sizingOwner = current.target.kind === 'instance' ? current.target : undefined
      localAlignItems = current.localLayout?.alignItems; localJustifyContent = current.localLayout?.justifyContent
      effectivePath = current.effectivePath; overridePath = current.overridePath
      effectiveModeId = current.context.modes.get(effective.id) ?? null
      locked ||= current.locked
    } else if (raw.kind === 'instance') {
      source = byId.get(rendered.componentId ?? '')
      const context = scene.instance(rendered, scene.root)
      effective = context?.byId.get(rendered.componentId ?? '')
      sizingOwner = raw
      localAlignItems = raw.instanceLayout?.alignItems; localJustifyContent = raw.instanceLayout?.justifyContent
      effectiveModeId = context?.modes.get(rendered.componentId ?? '') ?? null
    }
    if (locked) reason ??= 'locked'
    if (!source || !effective || !['row', 'column'].includes(source.layout) || !['row', 'column'].includes(effective.layout) ||
      !['frame', 'group', 'component', 'component-set'].includes(effective.kind)) {
      reason ??= raw.kind === 'instance' && !path.length ? 'instance' : 'layout'; continue
    }
    const key = JSON.stringify([id, effectivePath])
    if (seen.has(key)) reason ??= 'target'
    seen.add(key)
    const flow = effective.layout === 'row' ? 'row' : 'column'
    const align = effective.alignItems ?? 'start', distribution = effective.justifyContent ?? 'start'
    const automatic = ['between', 'around', 'evenly'].includes(distribution), baseline = align === 'baseline'
    const cross = baseline ? null : align, main = automatic ? null : distribution as Position
    const mainAxis = flow === 'row' ? 'width' : 'height'
    const mainPolicy = sizingOwner && designInstanceSizingOwns(sizingOwner, `${mainAxis}Sizing`)
      ? sizingOwner[`${mainAxis}Sizing`] ?? 'hug' : effective[`${mainAxis}Sizing`] ?? 'hug'
    owners.push({ id, path, effectivePath, overridePath, effectiveModeId,
      flow, horizontal: flow === 'row' ? main : cross, vertical: flow === 'row' ? cross : main,
      distribution, baseline, automatic, automaticActive: automatic && mainPolicy !== 'hug',
      paused: !!effective.preserveLayout, locked, localAlignItems, localJustifyContent,
      sourceAlignItems: source.alignItems ?? 'start', sourceJustifyContent: source.justifyContent ?? 'start',
      alignItemsOwned: localAlignItems !== undefined, justifyContentOwned: localJustifyContent !== undefined })
  }
  const context: DesignAutoLayoutAlignmentContext = { owners, canEdit: !reason, canBaseline: !reason && owners.every(owner => owner.flow === 'row'), reason }
  return { context, byId }
}
/** Read spatial alignment using each owner's effective direction and inherited root settings.
 * @param document - Valid immutable native scene.
 * @param targets - Unique stored identities or linked descendant paths; authored/replacement aliases identify the same target.
 * @returns Atomic admission, orientation-aware values and local/source ownership; automatic main and baseline cross positions are null.
 */
export function designAutoLayoutAlignmentContext(
  document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[],
): DesignAutoLayoutAlignmentContext {
  return read(document, targets).context
}
function patch(owner: DesignAutoLayoutAlignmentOwner, intent: DesignAutoLayoutAlignmentIntent): Fields {
  const fields: Fields = {}
  const spatial = (axis: 'horizontal' | 'vertical', value: Position) => {
    const main = axis === (owner.flow === 'row' ? 'horizontal' : 'vertical')
    if (main && owner.automatic) return
    if (main) fields.justifyContent = value
    else fields.alignItems = value
  }
  switch (intent.type) {
    case 'spatial':
      if (intent.horizontal !== undefined) spatial('horizontal', intent.horizontal)
      if (intent.vertical !== undefined) spatial('vertical', intent.vertical)
      break
    case 'step': {
      const values = ['start', 'center', 'end'] as const
      const current = owner[intent.axis] ?? 'start'
      spatial(intent.axis, values[Math.max(0, Math.min(2, values.indexOf(current) + intent.direction))] ?? 'start')
      break
    }
    case 'distribution': fields.justifyContent = intent.value; break
    case 'baseline':
      fields.alignItems = intent.enabled ? 'baseline' : owner.baseline ? 'start' : owner.flow === 'row' ? owner.vertical ?? 'start' : 'start'
      break
    case 'auto-spacing':
      fields.justifyContent = intent.enabled ? owner.automatic ? owner.distribution : 'between' : owner.automatic ? 'start' : owner.distribution
      break
  }
  return fields
}
function trim(owner: DesignAutoLayoutAlignmentOwner, requested: Fields): Fields {
  const fields = { ...requested }, cross = owner.flow === 'row' ? owner.vertical : owner.horizontal
  if (fields.alignItems === (owner.baseline ? 'baseline' : cross)) delete fields.alignItems
  if (fields.justifyContent === owner.distribution) delete fields.justifyContent
  if (!Object.keys(fields).length && owner.paused) {
    if (requested.alignItems !== undefined) fields.alignItems = requested.alignItems
    else if (requested.justifyContent !== undefined) fields.justifyContent = requested.justifyContent
  }
  return fields
}
function changed(owner: DesignAutoLayoutAlignmentOwner, fields: Fields): boolean {
  const align = owner.flow === 'row' ? owner.vertical : owner.horizontal
  return Object.keys(fields).length > 0 && (owner.paused ||
    fields.alignItems !== undefined && fields.alignItems !== (owner.baseline ? 'baseline' : align) ||
    fields.justifyContent !== undefined && fields.justifyContent !== owner.distribution)
}
/** Apply spatial alignment atomically while preserving untouched settings, token references and linked sizing ownership.
 * @param document - Valid immutable scene.
 * @param targets - Explicit stored roots or contextual descendants; selected ancestors do not supersede descendants.
 * @param intent - Spatial, distribution, baseline, automatic-spacing or relative-step intent.
 * @returns Original scene for active no-ops; ordinary sources, linked roots and descendants stage before their ownership comparisons.
 * @throws DesignAutoLayoutEditError when any target is invalid, locked or incompatible with the intent.
 */
export function setDesignAutoLayoutAlignment(
  document: CopyOSDesignDocument, targets: readonly (string | DesignAlignmentTarget)[], intent: DesignAutoLayoutAlignmentIntent,
): CopyOSDesignDocument {
  const initial = read(document, targets)
  if (!initial.context.canEdit || intent.type === 'baseline' && !initial.context.canBaseline)
    throw new DesignAutoLayoutEditError(initial.context.reason ?? 'layout', 'Alignment selection is not editable')
  try {
    const intents = new Map(initial.context.owners.map(owner => [ownerKey(owner), patch(owner, intent)]))
    let candidate = document
    for (const phase of ['ordinary', 'root', 'descendant'] as const) {
      const staged = candidate === document ? initial : read(candidate, targets)
      const updates = new Map<string, { id: string } & Partial<CopyOSDesignNode>>()
      for (const owner of staged.context.owners) {
        const raw = staged.byId.get(owner.id)
        if (!raw || (owner.path.length ? 'descendant' : raw.kind === 'instance' ? 'root' : 'ordinary') !== phase) continue
        const requested = intents.get(ownerKey(owner)) ?? {}
        const fields = trim(phase === 'ordinary' ? { ...owner, paused: false } : owner, requested)
        if (!changed(owner, fields) && !(phase === 'ordinary' && owner.paused && Object.keys(requested).length)) continue
        if (phase === 'ordinary') updates.set(raw.id, { id: raw.id, ...fields, preserveLayout: false })
        else if (phase === 'root') updates.set(raw.id, { id: raw.id, instanceLayout: { ...raw.instanceLayout, ...fields } })
        else {
          const previous = updates.get(raw.id), current = previous ? { ...raw, ...previous } : raw
          const next = mergeDesignInstanceLayouts(current, [{ path: owner.overridePath, layout: fields }])
          updates.set(raw.id, { id: raw.id, instanceOverrides: next.instanceOverrides })
        }
      }
      if (updates.size) candidate = editDesignNodes(candidate, [...updates.values()])
    }
    if (candidate === document) return document
    parseDesignDocument(candidate)
    return candidate
  } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
}
