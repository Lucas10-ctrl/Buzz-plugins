/** Independent grid configuration on linked descendants, using the existing override paths. */
import { createDesignRenderScene, createDesignInstanceContextReader, designDescendants, editDesignNodes } from './design-model.ts'
import { applyDesignComponentInstance } from './design-component-properties.ts'
import { defaultDesignGrid } from './design-grid.ts'
import { applyDesignInstanceGrid } from './design-instance-grid.ts'
import { DESIGN_INSTANCE_GRID_KEYS } from './design-instance-grid.ts'
import type { CopyOSDesignInstanceGrid, CopyOSDesignNode, CopyOSDesignInstanceOverride } from './types.ts'

/** Merge descendant grid configuration edits without laying out or validating intermediate scenes.
 * @param instance - Stored linked instance owning all supplied paths.
 * @param edits - Complete-axis/config ownership patches; undefined inherits a field, null clears only grid configuration.
 * @returns Instance copy preserving cell/content/visibility/swap/measurement ownership; no document validation is performed.
 */
export function mergeDesignInstanceGridConfigs(instance: CopyOSDesignNode,
  edits: readonly { path: readonly string[]; patch: CopyOSDesignInstanceGrid | null }[]): CopyOSDesignNode {
  if (instance.kind !== 'instance' || !edits.length) return instance
  const records = new Map((instance.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
  for (const { path, patch } of edits) {
    const key = JSON.stringify(path), previous = records.get(key), grid = { ...previous?.grid }
    if (patch === null) for (const field of DESIGN_INSTANCE_GRID_KEYS) Reflect.deleteProperty(grid, field)
    else for (const field of DESIGN_INSTANCE_GRID_KEYS) if (Object.hasOwn(patch, field)) {
      if (patch[field] === undefined) Reflect.deleteProperty(grid, field)
      else Object.assign(grid, { [field]: structuredClone(patch[field]) })
    }
    const record: CopyOSDesignInstanceOverride = { ...previous, path: [...path],
      grid: Object.keys(grid).length ? grid : undefined }
    if (record.blendMode !== undefined || record.layout || record.layoutBindings || record.grid || record.gridCell ||
      record.effectStyleId !== undefined || record.effects !== undefined ||
      record.text !== undefined || record.textRuns !== undefined || record.fontFeatures !== undefined ||
      record.fontVariations !== undefined ||
      record.visible !== undefined ||
      record.componentId !== undefined || record.textLayoutMetrics || record.textBaselineMetrics) records.set(key, record)
    else records.delete(key)
  }
  const instanceOverrides = records.size ? [...records.values()] : undefined
  return JSON.stringify(instanceOverrides) === JSON.stringify(instance.instanceOverrides) ? instance : { ...instance, instanceOverrides }
}

/** Editable, unbaked configuration and resolved geometry for a linked descendant grid. */
export interface DesignInstanceGridConfigContext {
  target: CopyOSDesignNode
  node: CopyOSDesignNode
  children: CopyOSDesignNode[]
  context: import('./design-model.ts').DesignRenderContext
  grid: import('./types.ts').CopyOSDesignGrid | undefined
  sourceGrid: import('./types.ts').CopyOSDesignGrid | undefined
  localGrid: CopyOSDesignInstanceGrid | undefined
  active: boolean
  locked: boolean
  effectivePath: string[]
  overridePath: string[]
  parentPath: string[] | null
}

/** Read descendant grid configuration without baking active-mode track values into authored fallbacks.
 * @param document - Complete immutable native document.
 * @param instanceId - Stored outer instance owning the path.
 * @param path - Nested instance identities followed by the descendant frame or nested instance.
 * @param scene - Optional shared render scene for exactly this document.
 * @returns Effective source-root geometry and unbaked inherited/local configuration; non-grid settings remain dormant.
 */
export function designInstanceGridConfigContext(document: import('./types.ts').CopyOSDesignDocument, instanceId: string,
  path: readonly string[], scene = createDesignRenderScene(document)): DesignInstanceGridConfigContext | undefined {
  const current = createDesignInstanceContextReader(document, scene)(instanceId, path)
  if (!current) return
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  const templates = new Map<string, CopyOSDesignNode[]>()
  const prepare = (owner: CopyOSDesignNode): CopyOSDesignNode[] | undefined => {
    const source = byId.get(owner.componentId ?? '')
    if (owner.kind !== 'instance' || !source) return
    let template = templates.get(source.id)
    if (!template) {
      const ids = designDescendants(document.nodes, source.id)
      ids.add(source.id)
      template = document.nodes.filter(node => ids.has(node.id))
      templates.set(source.id, template)
    }
    return applyDesignComponentInstance(template, source, owner, document.nodes)
      .map(node => node.id === source.id ? applyDesignInstanceGrid(node, owner) : node)
  }
  const authored = (outer: CopyOSDesignNode): import('./types.ts').CopyOSDesignGrid | undefined => {
    let owner = outer
    for (const [index, id] of current.effectivePath.entries()) {
      const target = prepare(owner)?.find(node => node.id === id)
      if (!target) return
      if (index < current.effectivePath.length - 1) { owner = target; continue }
      const root = target.kind === 'instance' ? prepare(target)?.find(node => node.id === target.componentId) : target
      return root?.layout === 'grid' ? structuredClone(root.grid ?? defaultDesignGrid()) : undefined
    }
  }
  const target = current.node
  const context = target.kind === 'instance' ? scene.instance(target, current.context) : current.context
  const node = target.kind === 'instance' ? context?.byId.get(target.componentId ?? '') : target
  if (!context || !node) return
  const grid = authored(current.stored)
  const inherited = current.record?.grid
    ? mergeDesignInstanceGridConfigs(current.stored, [{ path: current.overridePath, patch: null }]) : current.stored
  return { target, node, children: context.children.get(node.id) ?? [], context,
    grid, sourceGrid: current.record?.grid ? authored(inherited) : grid, localGrid: current.record?.grid,
    active: node.layout === 'grid', locked: current.locked || node.locked,
    effectivePath: current.effectivePath, overridePath: current.overridePath, parentPath: current.parentPath }
}

/** Edit one descendant grid config, retaining all other descendant and root ownership.
 * @param document - Complete native document.
 * @param instanceId - Stored outer instance owning the typed path.
 * @param path - Descendant frame or nested instance path.
 * @param patch - Fields to own; undefined restores one inherited field, null clears only this descendant's grid ownership.
 * @returns Candidate validated by the normal native save/edit boundary, with no mutation of the main or sibling instances.
 */
export function editDesignInstanceGridConfig(document: import('./types.ts').CopyOSDesignDocument, instanceId: string,
  path: readonly string[], patch: CopyOSDesignInstanceGrid | null): import('./types.ts').CopyOSDesignDocument {
  const current = createDesignInstanceContextReader(document)(instanceId, path)
  if (!current) throw new Error('Missing instance grid target')
  const next = mergeDesignInstanceGridConfigs(current.stored, [{ path: current.overridePath, patch }])
  return next === current.stored ? document : editDesignNodes(document, [{ id: instanceId, instanceOverrides: next.instanceOverrides }])
}
