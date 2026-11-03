/** Saved outer proportions constrain explicit resizing and responsive allocations without rewriting passive geometry. */
import { createDesignRenderScene, editDesignNodes } from './design-model.ts'
import { designLayoutBox, designLayoutSize, type DesignLayoutBox } from './design-layout-box.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignAspectRatio } from './types.ts'
type Axis = 'width' | 'height'
type Scene = ReturnType<typeof createDesignRenderScene>
/** Bound-aware outer size, with explicit information about ratio and limit enforcement. */
export interface DesignAspectSize { width: number; height: number; ratioApplied: boolean; limited: boolean }
/** Effective proportional limits; impossible intersections retain their independent native bounds. */
export interface DesignAspectLimits { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number; feasible: boolean }
/** Read-only effective ratio ownership for a stored ordinary layer or linked root. */
export interface DesignAspectRatioContext {
  stored: CopyOSDesignNode
  node: CopyOSDesignNode
  effectiveRatio: CopyOSDesignAspectRatio | null
  sourceRatio: CopyOSDesignAspectRatio | null
  localRatio: CopyOSDesignAspectRatio | null | undefined
  owned: boolean
  eligible: boolean
  locked: boolean
  box: DesignLayoutBox
  effectiveLimits: DesignAspectLimits
  limited: boolean
}
/** Determine whether a layer can currently apply saved proportions.
 * @param node - Stored or effective layer.
 * @returns False for auto-resizing text; retained ratios remain dormant until text sizing becomes fixed.
 */
export function designAspectRatioEligible(node: CopyOSDesignNode): boolean {
  return node.kind !== 'text' || !node.textSizing || node.textSizing === 'fixed'
}
/** Resolve proportional min/max limits in the same outer-box coordinate system as native layout.
 * @param node - Effective node with resolved numeric bounds and ratio.
 * @param box - Optional contextual content/stroke floors for a linked root.
 * @returns Paired limits and whether a proportional rectangle can satisfy both axes.
 */
export function designAspectRatioLimits(node: CopyOSDesignNode, box: DesignLayoutBox = designLayoutBox(node)): DesignAspectLimits {
  const lowW = Math.max(1, node.minWidth ?? 1, box.widthFloor), lowH = Math.max(1, node.minHeight ?? 1, box.heightFloor)
  const highW = Math.max(box.widthFloor, node.maxWidth ?? 100000), highH = Math.max(box.heightFloor, node.maxHeight ?? 100000)
  const ratio = designAspectRatioEligible(node) ? node.targetAspectRatio : null
  if (!ratio) return { minWidth: lowW, maxWidth: highW, minHeight: lowH, maxHeight: highH, feasible: lowW <= highW && lowH <= highH }
  const r = ratio.x / ratio.y, minWidth = Math.max(lowW, lowH * r), maxWidth = Math.min(highW, highH * r)
  if (!Number.isFinite(minWidth) || !Number.isFinite(maxWidth) || minWidth > maxWidth)
    return { minWidth: lowW, maxWidth: highW, minHeight: lowH, maxHeight: highH, feasible: false }
  return { minWidth, maxWidth, minHeight: minWidth / r, maxHeight: maxWidth / r, feasible: true }
}
/** Constrain a proposed outer size before canvas anchoring or native layout placement.
 * @param node - Effective node, including inherited ratio and resolved bounds.
 * @param size - Requested model-space dimensions.
 * @param driver - Explicit controlling axis; canvas corner gestures choose it before calling.
 * @param box - Optional contextual minimum outer box.
 * @returns Proportional bounded dimensions, or independent bounded dimensions with limited=true when no ratio-feasible rectangle exists.
 */
export function constrainDesignAspectSize(node: CopyOSDesignNode, size: { width: number; height: number }, driver: Axis,
  box: DesignLayoutBox = designLayoutBox(node)): DesignAspectSize {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || !['width', 'height'].includes(driver))
    throw new Error('Invalid aspect size')
  const ratio = designAspectRatioEligible(node) ? node.targetAspectRatio : null
  const width = designLayoutSize(node, 'width', size.width, box), height = designLayoutSize(node, 'height', size.height, box)
  if (!ratio) return { width, height, ratioApplied: false, limited: width !== size.width || height !== size.height }
  const limits = designAspectRatioLimits(node, box), r = ratio.x / ratio.y
  if (!limits.feasible) return { width, height, ratioApplied: false, limited: true }
  const desired = driver === 'width' ? size.width : size.height * r
  const w = Math.max(limits.minWidth, Math.min(limits.maxWidth, desired)), h = w / r
  return { width: w, height: h, ratioApplied: true, limited: Math.abs(w - desired) > 1e-7 }
}
/** Read effective ratio, local/source ownership, eligibility and derived live limits.
 * @param document - Authored scene.
 * @param id - Stored selection identity; virtual component descendants are read-only through their rendered context.
 * @param scene - Optional shared render scene.
 * @returns Effective metadata, or undefined for a missing stored target.
 */
export function designAspectRatioContext(document: CopyOSDesignDocument, id: string,
  scene: Scene = createDesignRenderScene(document)): DesignAspectRatioContext | undefined {
  const stored = document.nodes.find(item => item.id === id), node = scene.root.byId.get(id)
  if (!stored || !node) return
  const source = stored.kind === 'instance' ? document.nodes.find(item => item.id === stored.componentId) : undefined
  let current: CopyOSDesignNode | undefined = stored, locked = false
  const seen = new Set<string>(), byId = new Map(document.nodes.map(item => [item.id, item]))
  while (current && !seen.has(current.id)) { seen.add(current.id); locked ||= current.locked; current = byId.get(current.parentId ?? '') }
  const effectiveRatio = node.targetAspectRatio ?? null, box = scene.root.layoutBoxes.get(node.id) ?? designLayoutBox(node),
    effectiveLimits = designAspectRatioLimits(node, box)
  return { stored, node, effectiveRatio, sourceRatio: source?.targetAspectRatio ?? null, localRatio: stored.targetAspectRatio,
    owned: stored.kind !== 'instance' || stored.targetAspectRatio !== undefined,
    eligible: designAspectRatioEligible(node), locked, box, effectiveLimits, limited: !effectiveLimits.feasible }
}
function selected(document: CopyOSDesignDocument, ids: readonly string[]) {
  const scene = createDesignRenderScene(document)
  return [...new Set(ids)].map((id) => {
    const value = designAspectRatioContext(document, id, scene)
    if (!value) throw new Error('Aspect ratio layer not found')
    if (value.locked) throw new Error('Aspect ratio layer is locked')
    return value
  })
}
/** Capture, explicitly unlock, or restore inherited outer proportions atomically.
 * @param document - Immutable authored scene.
 * @param ids - Stored ordinary or linked-root selection.
 * @param action - Lock captures each displayed size; unlock stores null; inherit removes linked-root ownership.
 * @returns Edited scene; automatic text and invalid inheritance targets reject the batch without mutation.
 */
export function setDesignAspectRatio(document: CopyOSDesignDocument, ids: readonly string[], action: 'lock' | 'unlock' | 'inherit'):
CopyOSDesignDocument {
  if (!['lock', 'unlock', 'inherit'].includes(action)) throw new Error('Invalid aspect ratio action')
  return editDesignNodes(document, selected(document, ids).map((value) => {
    if (action === 'lock' && !value.eligible) throw new Error('Auto-resizing text cannot lock aspect ratio')
    if (action === 'inherit' && value.stored.kind !== 'instance') throw new Error('Only linked roots can inherit aspect ratio')
    return { id: value.stored.id, targetAspectRatio: action === 'lock' ? { x: value.node.width, y: value.node.height } :
      action === 'unlock' ? null : undefined }
  }), { normalizeAspect: false })
}
/** Resize one axis explicitly, coupling both dimensions only when an eligible saved ratio applies.
 * @param document - Immutable authored baseline.
 * @param ids - Stored selection identities.
 * @param axis - Controlling outer dimension.
 * @param value - Finite requested dimension in the native 1..100000 range.
 * @param options - Temporary bypass retains the saved target while authoring off-ratio Fixed geometry.
 * @returns Edited scene with affected axes Fixed and their dimension bindings detached; source components remain unchanged.
 */
export function resizeDesignAspectAxis(document: CopyOSDesignDocument, ids: readonly string[], axis: Axis, value: number,
  options: { bypass?: boolean } = {}): CopyOSDesignDocument {
  if (!['width', 'height'].includes(axis) || !Number.isFinite(value) || value < 1 || value > 100000) throw new Error('Invalid aspect resize dimension')
  const edits = selected(document, ids).map((context) => {
    const fixesText = context.node.kind === 'text' && axis === 'height'
    const active = (context.eligible || fixesText) && !!context.effectiveRatio && !options.bypass
    const desired = { width: context.node.width, height: context.node.height, [axis]: value }
    const size = active ? constrainDesignAspectSize(fixesText ? { ...context.node, textSizing: 'fixed' } : context.node, desired, axis, context.box) : desired
    const paired = active || options.bypass && (context.eligible || fixesText) && !!context.effectiveRatio
    const fields: Partial<CopyOSDesignNode> = paired ? { width: size.width, height: size.height, widthSizing: 'fixed' as const, heightSizing: 'fixed' as const } :
      { [axis]: value, [`${axis}Sizing`]: 'fixed' as const }
    if (context.node.kind === 'text') {
      if (axis === 'height') {
        fields.textSizing = 'fixed'
        if (context.node.textSizing === 'auto-width' && !paired) { fields.width = context.node.width; fields.widthSizing = 'fixed' }
      } else if (context.node.textSizing === 'auto-width') { fields.textSizing = 'auto-height'; fields.heightSizing = 'hug' }
    }
    const numericBindings = Object.fromEntries(Object.entries(context.stored.numericBindings ?? {}).filter(([key]) =>
      paired || (fixesText && context.node.textSizing === 'auto-width') ? key !== 'width' && key !== 'height' : key !== axis))
    return { id: context.stored.id, ...fields, numericBindings }
  })
  return editDesignNodes(document, edits, { normalizeAspect: false })
}

const bindingAxes = Symbol('copyos.aspect-binding-axes')
type Prepared = CopyOSDesignNode & { [bindingAxes]?: readonly Axis[] }
/** Retain inherited dimension-token drivers in transient render metadata without claiming local binding ownership.
 * @param node - Resolved ordinary/instance projection.
 * @param source - Optional authored main for an inherited instance dimension.
 * @returns Render-only node copy; symbol metadata never enters native JSON.
 */
export function prepareDesignAspectBindings(node: CopyOSDesignNode, source?: CopyOSDesignNode): CopyOSDesignNode {
  const axes = (['width', 'height'] as const).filter((axis) => {
    const own = node.instanceSizingOverrides === undefined || node.instanceSizingOverrides.includes(axis) || !!node.numericBindings?.[axis]
    return !!(own ? node.numericBindings?.[axis] : source?.numericBindings?.[axis])
  })
  return { ...node, [bindingAxes]: axes } as Prepared
}
/** Resolve responsive ratio sizing while leaving passive Fixed/Fixed geometry authoritative.
 * @param node - Effective measured node.
 * @param forced - Parent flow or constraint allocation.
 * @param box - Contextual padding/stroke floors.
 * @returns Active responsive adjustment, or undefined when the target is dormant/passive.
 */
export function designResponsiveAspectSize(node: CopyOSDesignNode, forced: Partial<{ width: number; height: number }>,
  box: DesignLayoutBox = designLayoutBox(node)): DesignAspectSize | undefined {
  if (!node.targetAspectRatio || !designAspectRatioEligible(node)) return
  const width = forced.width ?? node.width, height = forced.height ?? node.height
  const axes = (node as Prepared)[bindingAxes] ?? (['width', 'height'] as const).filter(axis => !!node.numericBindings?.[axis])
  const hugW = node.widthSizing === 'hug', hugH = node.heightSizing === 'hug'
  const changedW = forced.width !== undefined && Math.abs(forced.width - node.width) > 1e-7
  const changedH = forced.height !== undefined && Math.abs(forced.height - node.height) > 1e-7
  const flowW = forced.width !== undefined && node.widthSizing === 'fill', flowH = forced.height !== undefined && node.heightSizing === 'fill'
  const capW = designLayoutSize(node, 'width', node.width, box) !== node.width
  const capH = designLayoutSize(node, 'height', node.height, box) !== node.height
  if (!changedW && !changedH && !flowW && !flowH && !hugW && !hugH && !axes.length && !capW && !capH) return
  const r = node.targetAspectRatio.x / node.targetAspectRatio.y
  let driver: Axis = changedW || flowW ? 'width' : changedH || flowH ? 'height' : axes.includes('width') ? 'width' :
    axes.includes('height') ? 'height' : hugW ? 'width' : hugH ? 'height' : capW ? 'width' : 'height'
  let target = { width, height }
  if (forced.width !== undefined && forced.height !== undefined && (changedW || changedH || flowW || flowH)) {
    target = { width: Math.min(width, height * r), height }; driver = 'width'
  } else if (hugW && hugH && forced.width === undefined && forced.height === undefined) {
    target = { width: Math.max(width, height * r), height }; driver = 'width'
  }
  return constrainDesignAspectSize(node, target, driver, box)
}
/** Normalize only explicit one-axis edits; complete authored geometry and bypass gestures remain authoritative.
 * @param before - Baseline scene.
 * @param after - Candidate after explicit fields have been staged.
 * @param updates - Actual edit fields, not a full-save reconstruction.
 * @returns Candidate with ratio-derived paired Fixed dimensions and detached dimension bindings when applicable.
 */
export function normalizeDesignAspectEdits(before: CopyOSDesignDocument, after: CopyOSDesignDocument,
  updates: readonly ({ id: string } & { [K in keyof CopyOSDesignNode]?: CopyOSDesignNode[K] | undefined })[]): CopyOSDesignDocument {
  if (before === after) return after
  const storedNodes = new Map(after.nodes.map(node => [node.id, node]))
  const candidates = updates.filter((edit) => {
    if (('width' in edit) === ('height' in edit)) return false
    const node = storedNodes.get(edit.id)
    if (!node || !designAspectRatioEligible(node)) return false
    const source = node.kind === 'instance' ? storedNodes.get(node.componentId ?? '') : undefined
    return !!(node.targetAspectRatio === undefined ? source?.targetAspectRatio : node.targetAspectRatio)
  })
  if (!candidates.length) return after
  const scene = createDesignRenderScene(after), changes = new Map<string, Partial<CopyOSDesignNode>>()
  for (const edit of candidates) {
    const node = scene.root.byId.get(edit.id), stored = after.nodes.find(item => item.id === edit.id)
    if (!node?.targetAspectRatio || !stored || !designAspectRatioEligible(node)) continue
    const axis = 'width' in edit ? 'width' : 'height', value = edit[axis]
    if (value === undefined) continue
    const size = constrainDesignAspectSize(node, { width: node.width, height: node.height, [axis]: value }, axis,
      scene.root.layoutBoxes.get(node.id))
    const bindings = Object.fromEntries(Object.entries(stored.numericBindings ?? {}).filter(([key]) => key !== 'width' && key !== 'height'))
    const mask = stored.instanceSizingOverrides === undefined ? undefined :
      [...new Set([...stored.instanceSizingOverrides, 'width', 'height', 'widthSizing', 'heightSizing'] as const)]
    changes.set(node.id, { width: size.width, height: size.height, widthSizing: 'fixed', heightSizing: 'fixed', numericBindings: bindings,
      ...(mask ? { instanceSizingOverrides: mask } : {}) })
  }
  if (!changes.size) return after
  return { ...after, nodes: after.nodes.map(node => changes.has(node.id) ? { ...node, ...changes.get(node.id) } : node) }
}
