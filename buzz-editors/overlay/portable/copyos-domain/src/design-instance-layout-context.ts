/** Independent descendant spacing ownership through existing linked override paths. */
import { createDesignRenderScene, createDesignInstanceContextReader, designDescendants, editDesignNodes } from './design-model.ts'
import { applyDesignComponentInstance } from './design-component-properties.ts'
import { applyDesignInstanceGrid } from './design-instance-grid.ts'
import { resolveDesignDescendantLayout } from './design-descendant-layout.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignNumberVariables, designNumberTokenSupportsProperty } from './design-token-values.ts'
import { applyDesignInstanceLayout, instanceLayoutEligibility, DESIGN_INSTANCE_LAYOUT_KEYS, DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS } from './design-instance-layout.ts'
import type { CopyOSDesignInstanceLayout, CopyOSDesignInstanceLayoutBindings, CopyOSDesignNode,
  CopyOSDesignInstanceOverride, CopyOSDesignDocument } from './types.ts'
/** Local descendant layout edit; null layout resets settings and spacing bindings, null bindings clears only bindings. */
export interface DesignInstanceLayoutPatch {
  layout?: Partial<CopyOSDesignInstanceLayout> | null | undefined
  layoutBindings?: CopyOSDesignInstanceLayoutBindings | null | undefined
}
/** Merge descendant layout edits without rendering intermediate candidates.
 * @param instance - Stored linked instance owning typed paths.
 * @param edits - Literal edits detach matching local bindings; explicit bindings in the same patch retain authored fallback values.
 * @returns Instance copy preserving cells, grids, content, swaps and measurements; document validation remains authoritative.
 */
export function mergeDesignInstanceLayouts(instance: CopyOSDesignNode,
  edits: readonly (DesignInstanceLayoutPatch & { path: readonly string[] })[]): CopyOSDesignNode {
  if (instance.kind !== 'instance' || !edits.length) return instance
  const records = new Map((instance.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
  for (const edit of edits) {
    if (edit.layout === null && Object.values(edit.layoutBindings ?? {}).some(id => id !== undefined))
      throw new Error('A layout reset cannot also assign spacing bindings')
    const key = JSON.stringify(edit.path), previous = records.get(key)
    const layout = { ...previous?.layout }, bindings = { ...previous?.layoutBindings }
    if (edit.layout === null) {
      for (const field of DESIGN_INSTANCE_LAYOUT_KEYS) Reflect.deleteProperty(layout, field)
      for (const field of DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS) Reflect.deleteProperty(bindings, field)
    } else {
      for (const field of DESIGN_INSTANCE_LAYOUT_KEYS) if (edit.layout && Object.hasOwn(edit.layout, field)) {
        if (edit.layout[field] === undefined) Reflect.deleteProperty(layout, field)
        else Object.assign(layout, { [field]: edit.layout[field] })
        Reflect.deleteProperty(bindings, field)
      }
      for (const field of DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS) if (edit.layoutBindings === null ||
        (edit.layoutBindings && Object.hasOwn(edit.layoutBindings, field))) {
        const id = edit.layoutBindings?.[field]
        if (id === undefined) Reflect.deleteProperty(bindings, field)
        else bindings[field] = id
      }
    }
    const record: CopyOSDesignInstanceOverride = { ...previous, path: [...edit.path],
      layout: Object.keys(layout).length ? layout : undefined,
      layoutBindings: Object.keys(bindings).length ? bindings : undefined }
    if (record.blendMode !== undefined || record.layout || record.layoutBindings || record.grid || record.gridCell ||
      record.effectStyleId !== undefined || record.effects !== undefined || record.text !== undefined ||
        record.textRuns !== undefined || record.fontFeatures !== undefined || record.fontVariations !== undefined ||
      record.visible !== undefined || record.componentId !== undefined || record.textLayoutMetrics || record.textBaselineMetrics)
      records.set(key, record)
    else records.delete(key)
  }
  const instanceOverrides = records.size ? [...records.values()] : undefined
  return JSON.stringify(instanceOverrides) === JSON.stringify(instance.instanceOverrides) ? instance : { ...instance, instanceOverrides }
}

/** Raw layout fields retain authored fallbacks and the actual inherited flow, including grid/none. */
export type DesignInstanceLayoutFields = Pick<CopyOSDesignNode, keyof CopyOSDesignInstanceLayout>
/** Contextual spacing data keeps local references separate from inherited and rendered values. */
export interface DesignInstanceLayoutReadContext {
  target: CopyOSDesignNode
  node: CopyOSDesignNode
  children: CopyOSDesignNode[]
  context: import('./design-model.ts').DesignRenderContext
  layout: DesignInstanceLayoutFields
  numericBindings: CopyOSDesignInstanceLayoutBindings
  sourceLayout: DesignInstanceLayoutFields
  sourceBindings: CopyOSDesignInstanceLayoutBindings
  localLayout: CopyOSDesignInstanceLayout | undefined
  localBindings: CopyOSDesignInstanceLayoutBindings | undefined
  eligibility: import('./design-instance-layout.ts').DesignInstanceLayoutEligibility
  active: boolean
  locked: boolean
  effectivePath: string[]
  overridePath: string[]
  parentPath: string[] | null
}
/** Read raw and rendered descendant layout ownership in the exact effective mode.
 * @param document - Complete immutable native document.
 * @param instanceId - Outer stored instance owning the descendant path.
 * @param path - Nested instance hops followed by a descendant identity.
 * @param scene - Optional shared render scene for this document.
 * @returns Contextual target/root, raw inherited/local spacing and eligibility, with no counterfactual render scene.
 */
export function designInstanceLayoutContext(document: CopyOSDesignDocument, instanceId: string, path: readonly string[],
  scene = createDesignRenderScene(document)): DesignInstanceLayoutReadContext | undefined {
  const current = createDesignInstanceContextReader(document, scene)(instanceId, path)
  if (!current) return
  const target = current.node
  const context = target.kind === 'instance' ? scene.instance(target, current.context) : current.context
  const node = target.kind === 'instance' ? context?.byId.get(target.componentId ?? '') : target
  if (!context || !node) return
  const numbers = new Map(resolveDesignNumberVariables(designModeResources(document,
    context.modes.get(node.id) ?? null).numberVariables).map(value => [value.id, value.value]))
  const byId = new Map(document.nodes.map(item => [item.id, item])), templates = new Map<string, CopyOSDesignNode[]>()
  const prepare = (owner: CopyOSDesignNode): CopyOSDesignNode[] | undefined => {
    const source = byId.get(owner.componentId ?? '')
    if (owner.kind !== 'instance' || !source) return
    let template = templates.get(source.id)
    if (!template) {
      const ids = designDescendants(document.nodes, source.id)
      ids.add(source.id)
      template = document.nodes.filter(item => ids.has(item.id))
      templates.set(source.id, template)
    }
    return applyDesignComponentInstance(template, source, owner, document.nodes).map(item => item.id === source.id ?
      applyDesignInstanceGrid(applyDesignInstanceLayout(item, owner, numbers), owner) : item)
  }
  const authored = (outer: CopyOSDesignNode): CopyOSDesignNode | undefined => {
    let owner = outer
    for (const [index, id] of current.effectivePath.entries()) {
      const selected = prepare(owner)?.find(item => item.id === id)
      if (!selected) return
      if (index < current.effectivePath.length - 1) { owner = selected; continue }
      const root = selected.kind === 'instance' ? prepare(selected)?.find(item => item.id === selected.componentId) : selected
      return root ? resolveDesignDescendantLayout(root, numbers) : undefined
    }
  }
  const raw = authored(current.stored)
  const inheritedOwner = current.record?.layout || current.record?.layoutBindings ?
    mergeDesignInstanceLayouts(current.stored, [{ path: current.overridePath, layout: null }]) : current.stored
  const source = inheritedOwner === current.stored ? raw : authored(inheritedOwner)
  if (!raw || !source) return
  const fields = (item: CopyOSDesignNode): DesignInstanceLayoutFields =>
    Object.fromEntries(DESIGN_INSTANCE_LAYOUT_KEYS.map(key => [key, item[key]])) as DesignInstanceLayoutFields
  const bindings = (item: CopyOSDesignNode): CopyOSDesignInstanceLayoutBindings => Object.fromEntries(
    DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.flatMap(key => item.numericBindings?.[key] ? [[key, item.numericBindings[key]]] : []))
  const localLayout = current.record?.layout, localBindings = current.record?.layoutBindings
  return { target, node, children: context.children.get(node.id) ?? [], context,
    layout: fields(raw), numericBindings: bindings(raw), sourceLayout: fields(source), sourceBindings: bindings(source),
    localLayout, localBindings, eligibility: instanceLayoutEligibility(source, { ...source, kind: 'instance',
      instanceLayout: localLayout,
      numericBindings: Object.fromEntries(Object.entries(localBindings ?? {}).filter(([, id]) => id !== undefined)) }, numbers),
    active: ['row', 'column', 'grid'].includes(node.layout), locked: current.locked || node.locked,
    effectivePath: current.effectivePath, overridePath: current.overridePath, parentPath: current.parentPath }
}
/** Edit one descendant's layout settings and live spacing references atomically.
 * @param document - Complete native scene.
 * @param instanceId - Outer stored instance owning the path.
 * @param path - Descendant identity in authored or current replacement space.
 * @param patch - Literal/binding ownership edits; layout:null clears both without touching other overrides.
 * @returns Independent candidate for native validation; the source and sibling instances are unchanged.
 */
export function editDesignInstanceLayoutContext(document: CopyOSDesignDocument, instanceId: string,
  path: readonly string[], patch: DesignInstanceLayoutPatch): CopyOSDesignDocument {
  const current = createDesignInstanceContextReader(document)(instanceId, path)
  if (!current) throw new Error('Missing instance layout target')
  const gap = patch.layout?.gap, binding = patch.layoutBindings?.gap
  const newNegative = gap !== undefined && gap < 0 && gap !== current.record?.layout?.gap
  const newBinding = binding && binding !== current.record?.layoutBindings?.gap ? binding : undefined
  if ((newNegative || newBinding) && designInstanceLayoutContext(document, instanceId, current.effectivePath)?.sourceLayout.layout === 'grid') {
    if (newNegative) throw new Error('New descendant grid gap overrides must be nonnegative')
    if (newBinding && !designNumberTokenSupportsProperty(document, newBinding, 'gap', { layout: 'grid' }))
      throw new Error('New descendant grid gap bindings must be nonnegative in every mode')
  }
  const next = mergeDesignInstanceLayouts(current.stored, [{ path: current.overridePath, ...patch }])
  return next === current.stored ? document : editDesignNodes(document, [{ id: instanceId, instanceOverrides: next.instanceOverrides }])
}
