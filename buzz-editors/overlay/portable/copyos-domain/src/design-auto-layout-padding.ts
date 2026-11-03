/** Grouped padding authoring retains unchanged side ownership and uses existing root/descendant spacing storage. */
import { createDesignRenderScene, editDesignNodes } from './design-model.ts'
import { DesignAutoLayoutEditError } from './design-auto-layout.ts'
import { designInstanceLayoutContext, mergeDesignInstanceLayouts } from './design-instance-layout-context.ts'
import { applyDesignInstanceLayout } from './design-instance-layout.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignNumberVariables } from './design-token-values.ts'
import { CopyOSDesignError, parseDesignDocument } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignInstanceLayout,
  CopyOSDesignInstanceLayoutBindings } from './types.ts'
const SIDES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const
type PaddingFields = Pick<CopyOSDesignNode, 'padding' | typeof SIDES[number]>
/** Resolved or authored padding ordered top, right, bottom, left. */
export type DesignPaddingValues = readonly [number, number, number, number]
/** Stored ordinary/root owner, optionally addressing a linked descendant through canonical instance hops. */
export interface DesignPaddingTarget {
  nodeId: string
  path?: readonly string[] | undefined
}
/** Effective padding, raw fallbacks and local ownership for one editable layout container. */
export interface DesignAutoLayoutPaddingOwner {
  nodeId: string
  path: string[]
  effectivePath: string[]
  overridePath: string[]
  values: DesignPaddingValues
  authoredValues: DesignPaddingValues
  bindingIds: readonly [string | null, string | null, string | null, string | null]
  localLayout: CopyOSDesignInstanceLayout | undefined
  localBindings: CopyOSDesignInstanceLayoutBindings | undefined
  paused: boolean
  locked: boolean
  effectiveModeId: string | null
}
/** Whole-selection padding admission; no partial edits occur when one target is invalid or locked. */
export interface DesignAutoLayoutPaddingContext {
  owners: DesignAutoLayoutPaddingOwner[]
  canEdit: boolean
  reason?: 'target' | 'locked' | 'layout' | undefined
}
/** Parse numeric CSS padding shorthand into four side values without authoring any fields.
 * @param input - One to four comma- or whitespace-separated finite values, optionally suffixed with px.
 * @returns Expanded top/right/bottom/left values in the native 0..10000 domain, or null for malformed/unsupported input.
 */
export function parseDesignPadding(input: string): DesignPaddingValues | null {
  const text = input.trim()
  if (!text || text.length > 200) return null
  const parts = text.includes(',') ? text.split(',').map(value => value.trim()) : text.split(/\s+/)
  const numeric = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i
  if (parts.length < 1 || parts.length > 4 || parts.some(value => !numeric.test(value))) return null
  const values = parts.map(value => Number(value.replace(/px$/i, '')))
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 10000)) return null
  const [a = 0, b = a, c = a, d = b] = values
  return [a, b, c, d]
}
function values(node: PaddingFields): DesignPaddingValues {
  return [node.paddingTop ?? node.padding, node.paddingRight ?? node.padding,
    node.paddingBottom ?? node.padding, node.paddingLeft ?? node.padding]
}
function bindingIds(node: PaddingFields, bindings: CopyOSDesignInstanceLayoutBindings): DesignAutoLayoutPaddingOwner['bindingIds'] {
  const binding = (key: typeof SIDES[number]) => bindings[key] ?? (node[key] === undefined ? bindings.padding : undefined) ?? null
  return [binding('paddingTop'), binding('paddingRight'), binding('paddingBottom'), binding('paddingLeft')]
}
function read(document: CopyOSDesignDocument, targets: readonly DesignPaddingTarget[]) {
  const scene = createDesignRenderScene(document), byId = new Map(document.nodes.map(node => [node.id, node]))
  const owners: DesignAutoLayoutPaddingOwner[] = [], seen = new Set<string>()
  let reason: DesignAutoLayoutPaddingContext['reason'] = targets.length ? undefined : 'target'
  for (const target of targets) {
    const raw = byId.get(target.nodeId), path = [...target.path ?? []], rendered = scene.root.byId.get(target.nodeId)
    if (!raw || !rendered) { reason ??= 'target'; continue }
    let ancestor: CopyOSDesignNode | undefined = raw, locked = false
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id); locked ||= ancestor.locked; ancestor = byId.get(ancestor.parentId ?? '')
    }
    let node: CopyOSDesignNode | undefined = rendered, authored: PaddingFields = raw
    let bindings: CopyOSDesignInstanceLayoutBindings = raw.numericBindings ?? {}
    let localLayout: CopyOSDesignInstanceLayout | undefined = { padding: raw.padding, paddingTop: raw.paddingTop,
      paddingRight: raw.paddingRight, paddingBottom: raw.paddingBottom, paddingLeft: raw.paddingLeft }
    let localBindings: CopyOSDesignInstanceLayoutBindings | undefined = raw.numericBindings
    let effectivePath = path, overridePath = path, effectiveModeId = scene.root.modes.get(raw.id) ?? null
    if (path.length) {
      const context = designInstanceLayoutContext(document, raw.id, path, scene)
      if (!context) { reason ??= 'target'; continue }
      node = context.node; authored = context.layout; bindings = context.numericBindings
      localLayout = context.localLayout; localBindings = context.localBindings
      effectivePath = context.effectivePath; overridePath = context.overridePath
      effectiveModeId = context.context.modes.get(node.id) ?? null
      locked ||= context.locked
    } else if (raw.kind === 'instance') {
      const context = scene.instance(rendered, scene.root), source = byId.get(rendered.componentId ?? '')
      node = context?.byId.get(rendered.componentId ?? '')
      if (!node || !source || !context) { reason ??= 'target'; continue }
      effectiveModeId = context.modes.get(node.id) ?? null
      const numbers = new Map(resolveDesignNumberVariables(designModeResources(document, effectiveModeId).numberVariables)
        .map(value => [value.id, value.value]))
      const root = applyDesignInstanceLayout(source, raw, numbers)
      authored = root; bindings = root.numericBindings ?? {}
      localLayout = raw.instanceLayout ?? undefined; localBindings = raw.numericBindings
      locked ||= node.locked
    }
    if (!['frame', 'group', 'component', 'component-set'].includes(node.kind) || !['row', 'column', 'grid'].includes(node.layout)) {
      reason ??= 'layout'; continue
    }
    const key = JSON.stringify([raw.id, effectivePath])
    if (seen.has(key)) reason ??= 'target'
    seen.add(key)
    if (locked) reason ??= 'locked'
    owners.push({ nodeId: raw.id, path, effectivePath, overridePath, values: values(node), authoredValues: values(authored),
      bindingIds: bindingIds(authored, bindings), localLayout, localBindings, paused: !!node.preserveLayout, locked, effectiveModeId })
  }
  return { context: { owners, canEdit: !reason, reason } satisfies DesignAutoLayoutPaddingContext, byId }
}
/** Read grouped padding and binding ownership without capturing inherited values or changing modes.
 * @param document - Valid immutable native scene.
 * @param targets - Explicit stored roots and linked descendant paths; canonical duplicate targets reject.
 * @returns Resolved sides, authored fallbacks, effective side references and atomic lock/layout admission.
 */
export function designAutoLayoutPaddingContext(
  document: CopyOSDesignDocument, targets: readonly DesignPaddingTarget[],
): DesignAutoLayoutPaddingContext {
  return read(document, targets).context
}
/** Set all padding sides as one intent while retaining every effectively unchanged side's live references and ownership.
 * @param document - Valid immutable scene.
 * @param targets - Ordinary, linked-root or contextual layout targets, with inherited locks respected atomically.
 * @param requested - Explicit top/right/bottom/left values from the numeric shorthand parser or a typed caller.
 * @returns Original scene for active matching sides; ordinary/source edits stage before linked and descendant ownership comparisons.
 * @throws DesignAutoLayoutEditError for invalid targets, locks or an invalid complete result.
 */
export function setDesignAutoLayoutPadding(
  document: CopyOSDesignDocument, targets: readonly DesignPaddingTarget[], requested: DesignPaddingValues,
): CopyOSDesignDocument {
  const initial = read(document, targets)
  if (!initial.context.canEdit) throw new DesignAutoLayoutEditError(initial.context.reason ?? 'target', 'Padding selection is not editable')
  try {
    let candidate = document
    for (const phase of ['ordinary', 'root', 'descendant'] as const) {
      const current = candidate === document ? initial : read(candidate, targets)
      const edits = new Map<string, { id: string } & Partial<CopyOSDesignNode>>()
      for (const owner of current.context.owners) {
        const raw = current.byId.get(owner.nodeId)
        if (!raw || (owner.path.length ? 'descendant' : raw.kind === 'instance' ? 'root' : 'ordinary') !== phase) continue
        const changed = SIDES.flatMap((key, index) => owner.values[index] === requested[index] ? [] : [{ key, index }])
        if (!changed.length && !owner.paused) continue
        const fields: Partial<Pick<CopyOSDesignNode, typeof SIDES[number]>> = {}, bindings: CopyOSDesignInstanceLayoutBindings = {}
        for (const { key, index } of changed) fields[key] = requested[index]
        if (!changed.length && phase !== 'ordinary') {
          fields.paddingTop = owner.authoredValues[0]
          const binding = owner.bindingIds[0]
          if (binding) bindings.paddingTop = binding
        }
        if (phase === 'ordinary') {
          const numbers = { ...raw.numericBindings }
          for (const { key } of changed) Reflect.deleteProperty(numbers, key)
          edits.set(raw.id, { id: raw.id, ...fields, preserveLayout: false,
            ...(changed.length ? { numericBindings: numbers } : {}) })
        } else if (phase === 'root') {
          const numbers = { ...raw.numericBindings }
          for (const { key } of changed) Reflect.deleteProperty(numbers, key)
          Object.assign(numbers, bindings)
          edits.set(raw.id, { id: raw.id, instanceLayout: { ...raw.instanceLayout, ...fields }, numericBindings: numbers })
        } else {
          const previous = edits.get(raw.id), staged = previous ? { ...raw, ...previous } : raw
          const next = mergeDesignInstanceLayouts(staged, [{ path: owner.overridePath, layout: fields, layoutBindings: bindings }])
          edits.set(raw.id, { id: raw.id, instanceOverrides: next.instanceOverrides })
        }
      }
      if (edits.size) candidate = editDesignNodes(candidate, [...edits.values()])
    }
    if (candidate === document) return document
    parseDesignDocument(candidate)
    return candidate
  } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
}
