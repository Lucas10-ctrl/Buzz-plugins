/** Explicit Fill authoring breaks Hug/Fill circular sizing without rewriting saved or rendered scenes. */
import { resolveDesignNodes } from './design-model.ts'
import { designConstraintsActive } from './design-constraints.ts'
import { designSizingLimitsValid } from './design-size-validation.ts'
import { markDesignInstanceSizingEdit, designInstanceSizingOwns } from './design-instance-sizing.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
type Edit = { [K in keyof CopyOSDesignNode]?: CopyOSDesignNode[K] | undefined } & { id: string }
function policy(node: CopyOSDesignNode, axis: 'width' | 'height'): 'fixed' | 'hug' | 'fill' {
  return node[`${axis}Sizing`] ?? ((node.layout === 'row' && axis === 'width') ||
    ((node.layout === 'column' || node.layout === 'grid') && axis === 'height') ? 'hug' : 'fixed')
}
function effectivePolicy(node: CopyOSDesignNode, axis: 'width' | 'height', nodes: ReadonlyMap<string, CopyOSDesignNode>)
  : 'fixed' | 'hug' | 'fill' {
  const source = node.kind === 'instance' && !designInstanceSizingOwns(node, `${axis}Sizing`) ? nodes.get(node.componentId ?? '') : undefined
  return policy(source?.kind === 'component' ? source : node, axis)
}
/** Freeze only a newly Fill child's Hug parent axis at its pre-edit displayed size.
 * @param before - Valid authored scene before the explicit user transaction.
 * @param after - Complete candidate including newly created nodes and resource/mode edits.
 * @param updates - Explicit node edits; unchanged Fill and passive source inheritance do not trigger normalization.
 * @returns Candidate with preserved parents activated and Hug axes locally Fixed; conflicting explicit intent or invalid bounds rejects.
 */
export function normalizeDesignFillAuthoring(before: CopyOSDesignDocument, after: CopyOSDesignDocument,
  updates: readonly Edit[]): CopyOSDesignDocument {
  if (!updates.some(edit => edit.widthSizing === 'fill' || edit.heightSizing === 'fill')) return after
  const previous = new Map(before.nodes.map(node => [node.id, node])), current = new Map(after.nodes.map(node => [node.id, node]))
  const explicit = new Map(updates.map(edit => [edit.id, edit]))
  let computed: Map<string, CopyOSDesignNode> | undefined
  const rendered = (): Map<string, CopyOSDesignNode> => computed ??= new Map(resolveDesignNodes(before).map(node => [node.id, node]))
  const activating = new Set<string>()
  const freezing = new Map<string, Set<'width' | 'height'>>()
  for (const edit of updates) {
    const child = current.get(edit.id), parent = current.get(child?.parentId ?? '')
    if (!child?.visible || child.absolutePosition || !parent ||
      !['row', 'column', 'grid'].includes(parent.layout)) continue
    for (const axis of ['width', 'height'] as const) {
      const key = `${axis}Sizing` as const
      if (edit[key] !== 'fill' || effectivePolicy(child, axis, current) !== 'fill') continue
      const oldChild = previous.get(child.id)
      if (oldChild && effectivePolicy(rendered().get(oldChild.id) ?? oldChild, axis, previous) === 'fill') continue
      if (parent.preserveLayout) {
        if (explicit.get(parent.id)?.preserveLayout === true)
          throw new Error('A new Fill child cannot also explicitly keep its parent layout preserved')
        activating.add(parent.id)
      }
      const oldParent = previous.get(parent.id), oldRendered = oldParent ? rendered().get(oldParent.id) ?? oldParent : parent
      if (policy(oldRendered, axis) !== 'hug' || policy(parent, axis) !== 'hug') continue
      const parentEdit = explicit.get(parent.id)
      if (parentEdit?.[key] === 'hug') throw new Error('A new Fill child cannot also explicitly keep its parent axis Hug')
      if (parentEdit && (axis in parentEdit || parentEdit.numericBindings?.[axis]))
        throw new Error('Choose an explicit Fixed parent policy when editing its dimension together with a new Fill child')
      const axes = freezing.get(parent.id) ?? new Set<'width' | 'height'>()
      axes.add(axis); freezing.set(parent.id, axes)
    }
  }
  if (!freezing.size && !activating.size) return after
  const nodes = after.nodes.map((parent) => {
    const axes = freezing.get(parent.id)
    if (!axes) return activating.has(parent.id) ? { ...parent, preserveLayout: false } : parent
    const visible = rendered().get(parent.id) ?? parent, ancestor = rendered().get(parent.parentId ?? '')
    const fields: Partial<CopyOSDesignNode> = {}, bindings = { ...parent.numericBindings }
    let constraints = parent.constraints
    for (const axis of axes) {
      fields[axis] = visible[axis]
      fields[`${axis}Sizing`] = 'fixed'
      if (axis === 'width') delete bindings.width
      else delete bindings.height
      if (constraints && ancestor && designConstraintsActive(parent, ancestor)) {
        constraints = { ...constraints, ...(axis === 'width' ? { referenceWidth: ancestor.width } : { referenceHeight: ancestor.height }) }
        if (axis === 'width') fields.x = visible.x
        else fields.y = visible.y
      }
    }
    return markDesignInstanceSizingEdit(parent, { ...fields, numericBindings: bindings,
      ...(activating.has(parent.id) ? { preserveLayout: false } : {}),
      ...(constraints !== parent.constraints ? { constraints } : {}) })
  })
  const candidate = { ...after, nodes }
  if (!designSizingLimitsValid(candidate)) throw new Error('Fill authoring requires valid sizing limits in Base and every mode')
  return candidate
}
