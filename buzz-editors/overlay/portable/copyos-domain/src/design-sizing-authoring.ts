/** Explicit sizing gestures share eligibility, text coupling and linked ownership. */
import { createDesignRenderScene, editDesignNodes } from './design-model.ts'
import { DESIGN_INSTANCE_SIZING_KEYS, designInstanceSizingOwns } from './design-instance-sizing.ts'
import { designSizingLimitsValid } from './design-size-validation.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

type Axis = 'width' | 'height'
type Policy = 'fixed' | 'hug' | 'fill'
type Limit = 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'
type Scene = ReturnType<typeof createDesignRenderScene>
type Edit = { [K in keyof CopyOSDesignNode]?: CopyOSDesignNode[K] | undefined } & { id: string }

/** Displayed and authored sizing for a stored selection, with axis eligibility and inherited token ownership. */
export interface DesignSizingContext {
  stored: CopyOSDesignNode
  node: CopyOSDesignNode
  parent: CopyOSDesignNode | undefined
  source: CopyOSDesignNode | undefined
  locked: boolean
  axis: Record<Axis, { policy: Policy; canHug: boolean; canFill: boolean }>
  numericBindings: Partial<Record<'width' | 'height' | Limit, string>>
}

function policy(node: CopyOSDesignNode, axis: Axis): Policy {
  if (node.kind === 'text' && (node.textSizing === 'auto-width' || axis === 'height' && node.textSizing === 'auto-height')) return 'hug'
  return node[`${axis}Sizing`] ?? (node.layout === 'row' && axis === 'width' ||
    (node.layout === 'column' || node.layout === 'grid') && axis === 'height' ? 'hug' : 'fixed')
}

/** Read displayed sizing and authoring eligibility for a stored ordinary node or linked root.
 * @param document - Authored scene; legacy incompatible policies remain untouched.
 * @param id - Stored selection identity, excluding virtual instance descendants.
 * @param scene - Optional shared render scene for a multi-selection.
 * @returns Rendered and authored values, parent, accumulated lock and per-axis policy eligibility; absent for unknown IDs.
 */
export function designSizingContext(
  document: CopyOSDesignDocument, id: string, scene: Scene = createDesignRenderScene(document),
): DesignSizingContext | undefined {
  const stored = document.nodes.find(node => node.id === id), node = scene.root.byId.get(id)
  if (!stored || !node) return undefined
  const parent = scene.root.byId.get(stored.parentId ?? '')
  let locked = false, ancestor: CopyOSDesignNode | undefined = stored
  const visited = new Set<string>(), authored = new Map(document.nodes.map(item => [item.id, item]))
  while (ancestor && !visited.has(ancestor.id)) {
    visited.add(ancestor.id)
    locked ||= ancestor.locked
    ancestor = authored.get(ancestor.parentId ?? '')
  }
  const source = node.kind === 'instance' ? scene.instance(node, scene.root)?.byId.get(node.componentId ?? '') : node
  const canHug = source?.kind === 'text' || !!source && ['frame', 'component', 'component-set'].includes(source.kind) &&
    ['row', 'column', 'grid'].includes(source.layout)
  const canFill = !!parent && ['row', 'column', 'grid'].includes(parent.layout) && !node.absolutePosition
  const rawSource = stored.kind === 'instance' ? authored.get(stored.componentId ?? '') : stored
  const numericBindings = Object.fromEntries((['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)
    .flatMap((key) => {
      const owner = stored.kind === 'instance' && !designInstanceSizingOwns(stored, key) ? rawSource : stored
      const binding = owner?.numericBindings?.[key]
      return binding ? [[key, binding]] : []
    }))
  const axis = {
    width: { policy: policy(node, 'width'), canHug, canFill },
    height: { policy: policy(node, 'height'), canHug, canFill },
  }
  return { stored, node, parent, locked, axis, source: rawSource, numericBindings }
}

function selections(document: CopyOSDesignDocument, ids: readonly string[]) {
  const scene = createDesignRenderScene(document)
  return [...new Set(ids)].map((id) => {
    const context = designSizingContext(document, id, scene)
    if (!context) throw new Error('Sizing selection not found')
    if (context.locked) throw new Error('Sizing selection is locked')
    return context
  })
}

/** Apply one explicit sizing policy atomically, capturing Fixed geometry and normalizing text and Fill parents.
 * @param document - Immutable gesture baseline.
 * @param ids - Stored selection identities; any locked or ineligible target rejects the entire transaction.
 * @param axis - Model axis, independent of canvas rotation or zoom.
 * @param value - Fixed captures displayed size; Hug and Fill detach the affected local dimension binding.
 * @returns Edited scene with linked ownership and existing parent Hug-to-Fixed normalization.
 */
export function setDesignSizingPolicy(
  document: CopyOSDesignDocument, ids: readonly string[], axis: Axis, value: Policy,
): CopyOSDesignDocument {
  if (!['width', 'height'].includes(axis) || !['fixed', 'hug', 'fill'].includes(value)) throw new Error('Invalid sizing policy')
  const updates = selections(document, ids).map(({ stored, node, axis: eligibility }) => {
    if (value === 'hug' && !eligibility[axis].canHug || value === 'fill' && !eligibility[axis].canFill)
      throw new Error('Sizing policy is unavailable for this layer')
    const numericBindings = { ...stored.numericBindings }
    if (axis === 'width') delete numericBindings.width
    else delete numericBindings.height
    const edit: Edit = { id: stored.id, [`${axis}Sizing`]: value, numericBindings }
    if (stored.kind === 'instance' && stored.instanceSizingOverrides === undefined && value !== 'fixed')
      edit.instanceSizingOverrides = DESIGN_INSTANCE_SIZING_KEYS.filter(key => key !== axis)
    if (value === 'fixed') edit[axis] = node[axis]
    if (value === 'hug') edit.preserveLayout = false
    if (node.kind === 'text') {
      if (axis === 'width') {
        if (value === 'hug') {
          Object.assign(edit, { textSizing: 'auto-width', heightSizing: 'hug' })
          delete numericBindings.height
        }
        else if (node.textSizing === 'auto-width') Object.assign(edit, { textSizing: 'auto-height', heightSizing: 'hug' })
      } else if (value === 'hug') edit.textSizing = node.textSizing === 'auto-width' ? 'auto-width' : 'auto-height'
      else {
        edit.textSizing = 'fixed'
        if (node.textSizing === 'auto-width') {
          edit.widthSizing = 'fixed'
          edit.width = node.width
          delete numericBindings.width
        }
      }
    }
    return edit
  })
  const next = editDesignNodes(document, updates)
  if (!designSizingLimitsValid(next)) throw new Error('Sizing limits are invalid')
  return next
}

/** Remove selected axis limits explicitly, distinct from inheriting a linked main's limits.
 * @param document - Immutable authored scene.
 * @param ids - Stored selection identities; locked or missing selections reject atomically.
 * @param axis - Axis whose limits are cleared.
 * @param properties - Optional subset of this axis's bounds; omitted clears both minimum and maximum.
 * @returns Scene without matching local bindings; linked instances own explicit absence until reset to inheritance.
 */
export function clearDesignSizingLimits(document: CopyOSDesignDocument, ids: readonly string[], axis: Axis,
  properties?: readonly Limit[]): CopyOSDesignDocument {
  const allowed: Limit[] = axis === 'width' ? ['minWidth', 'maxWidth'] : ['minHeight', 'maxHeight']
  const keys = properties ?? allowed
  if (!['width', 'height'].includes(axis) || keys.some(key => !allowed.includes(key))) throw new Error('Invalid sizing bound')
  return editDesignNodes(document, selections(document, ids).map(({ stored }) => {
    const numericBindings = Object.fromEntries(Object.entries(stored.numericBindings ?? {}).filter(([key]) =>
      !keys.some(property => property === key)))
    const edit: Edit = { id: stored.id, numericBindings }
    for (const key of keys) edit[key] = undefined
    return edit
  }))
}
