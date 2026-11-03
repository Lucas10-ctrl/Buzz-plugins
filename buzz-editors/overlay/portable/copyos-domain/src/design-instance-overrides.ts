import { mapDesignTextHyperlinks } from './design-text-hyperlink.ts'
import { rebaseDesignTextRuns } from './design-text-runs.ts'
import { prepareDesignDescendantLayout } from './design-descendant-layout.ts'
import { DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS } from './design-instance-layout.ts'
/** Instance-local descendant edits shared by layout, rendering and native validation. */
import { defaultDesignGrid } from './design-grid.ts'
import { swapDesignInstanceNode, remapDesignSwapOverrides } from './design-instance-swap.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignInstanceOverride } from './types.ts'

/** Find an override target by crossing only the nested instances named in its path.
 * @param nodes - Complete component library or its existing identity index.
 * @param instance - Instance owning the path.
 * @param path - Nested instance identities followed by a descendant layer identity.
 * @returns Target, or undefined for missing layers, invalid nesting or component roots.
 */
export function designInstanceOverrideTarget(
  nodes: readonly CopyOSDesignNode[] | ReadonlyMap<string, CopyOSDesignNode>,
  instance: CopyOSDesignNode,
  path: readonly string[],
): CopyOSDesignNode | undefined {
  const byId = 'get' in nodes ? nodes : new Map(nodes.map(n => [n.id, n]))
  let owner = instance
  for (let i = 0; i < path.length; i++) {
    const target = byId.get(path[i] ?? '')
    if (owner.kind !== 'instance' || !owner.componentId || !target) return
    let parent = target.parentId
    const visited = new Set<string>()
    while (
      parent &&
      parent !== owner.componentId &&
      !visited.has(parent) &&
      visited.size < 64
    ) {
      visited.add(parent)
      parent = byId.get(parent)?.parentId ?? null
    }
    if (parent !== owner.componentId) return
    if (i === path.length - 1) return target
    owner = target
  }
  return undefined
}

/** Apply local overrides to a component subtree, retaining nested instance paths.
 * @param nodes - Template subtree, including its root.
 * @param overrides - Validated records on the rendered instance; outer records win.
 * @param library - Complete component library for contextual swap preservation.
 * @returns Template copies with content and visibility applied before layout.
 */
export function applyDesignInstanceOverrides(
  nodes: readonly CopyOSDesignNode[],
  overrides: readonly CopyOSDesignInstanceOverride[] = [],
  library: readonly CopyOSDesignNode[] = nodes,
): CopyOSDesignNode[] {
  if (!overrides.length) return [...nodes]
  const document={ nodes:library } as CopyOSDesignDocument
  const replacements=new Map<string,CopyOSDesignNode>()
  for (const record of overrides) if (record.path.length===1 && record.componentId) {
    const node=nodes.find(item=>item.id===record.path[0])
    if (node?.kind==='instance') replacements.set(node.id,swapDesignInstanceNode(document,node,record.componentId))
  }
  const mapped=overrides.flatMap((record)=>{
    if (record.path.length<2) return [record]
    const previous=nodes.find(item=>item.id===record.path[0]),target=replacements.get(record.path[0] ?? '') ?? previous
    if (!target?.componentId || !previous?.componentId) return [record]
    const authored=library.find(item=>item.id===target.id)
    const path=record.path.slice(1)
    const from=designInstanceOverrideTarget(library,previous,path) ? previous.componentId : authored?.componentId ?? previous.componentId
    return remapDesignSwapOverrides(document,from,target.componentId,[{ ...record,path }],previous.componentPropertyValues)
      .map(item=>({ ...item,path:[target.id,...item.path] }))
  })
  const activeParents = new Set(mapped.flatMap((record) => {
    const target = record.path.length === 1 && record.gridCell ? nodes.find(node => node.id === record.path[0]) : undefined
    const parent = target?.parentId ? nodes.find(node => node.id === target.parentId) : undefined
    const cell = record.gridCell
    return parent?.layout === 'grid' && (record.visible ?? target?.visible) && !target?.absolutePosition && (cell?.columnSpan !== undefined || cell?.rowSpan !== undefined ||
      parent.grid?.autoPosition === false) ? [parent.id] : []
  }))
  return nodes.map((stored) => {
    let n=replacements.get(stored.id) ?? stored
    if (n.layout === 'grid' && activeParents.has(n.id)) n = { ...n, preserveLayout: false }
    if (replacements.size && n.componentProperties?.length) n={ ...n,componentProperties:n.componentProperties.map(property=>({ ...property,
      targets:property.targets.flatMap((path)=>{
        const target=replacements.get(path[0] ?? ''),previous=nodes.find(item=>item.id===path[0])
        if (path.length<2 || !target?.componentId || !previous?.componentId) return [path]
        return remapDesignSwapOverrides(document,previous.componentId,target.componentId,[{ path:path.slice(1),visible:true }])
          .map(record=>[target.id,...record.path])
      }) })) }
    const direct = mapped.find(
      o => o.path.length === 1 && o.path[0] === n.id,
    )
    const nested = mapped.filter(
      o => o.path.length > 1 && o.path[0] === n.id,
    )
    if (!direct && !nested.length) return n
    const inherited = new Map(
      (n.instanceOverrides ?? []).map(o => [JSON.stringify(o.path), o]),
    )
    for (const o of nested) {
      const path = o.path.slice(1),
        key = JSON.stringify(path)
      const layoutBindings = { ...inherited.get(key)?.layoutBindings }
      for (const field of DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS) if (o.layout && Object.hasOwn(o.layout, field))
        Reflect.deleteProperty(layoutBindings, field)
      Object.assign(layoutBindings, o.layoutBindings)
      inherited.set(key, { ...inherited.get(key),
        ...Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined)), path,
        ...(o.effectStyleId !== undefined ? { effectStyleId: o.effectStyleId, effects: o.effects } :
          o.effects !== undefined ? { effectStyleId: null, effects: o.effects } : {}),
        ...(o.layout ? { layout: { ...inherited.get(key)?.layout, ...o.layout } } : {}),
        ...(Object.keys(layoutBindings).length ? { layoutBindings } : { layoutBindings: undefined }),
        ...(o.gridCell ? { gridCell: { ...inherited.get(key)?.gridCell, ...o.gridCell } } : {}),
        ...(o.grid ? { grid: { ...inherited.get(key)?.grid, ...o.grid } } : {}),
      })
    }
    if (direct?.layout || direct?.layoutBindings) {
      if (n.kind === 'instance') {
        const numericBindings = { ...n.numericBindings }
        for (const field of DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS) if (direct.layout && Object.hasOwn(direct.layout, field))
          Reflect.deleteProperty(numericBindings, field)
        const instanceLayout = { ...n.instanceLayout, ...direct.layout }
        n = { ...n, instanceLayout: Object.values(instanceLayout).some(value => value !== undefined) ? instanceLayout : undefined,
          numericBindings: { ...numericBindings,
            ...Object.fromEntries(Object.entries(direct.layoutBindings ?? {}).filter(([, id]) => id !== undefined)) } }
      } else n = prepareDesignDescendantLayout(n, direct.layout, direct.layoutBindings)
    }
    return {
      ...n,
      ...(direct?.effectStyleId !== undefined ? { effectStyleId: direct.effectStyleId, effects: direct.effects } :
        direct?.effects !== undefined ? { effects: direct.effects, effectStyleId: null } : {}),
      ...(direct?.blendMode !== undefined ? { blendMode: direct.blendMode } : {}),
      ...(direct?.text !== undefined ? { text: direct.text,
        textRuns: direct.textRuns ?? rebaseDesignTextRuns(n, direct.text).textRuns } : {}),
      ...(direct?.fontFeatures !== undefined ? { fontFeatures: direct.fontFeatures } : {}),
      ...(direct?.fontVariations !== undefined ? { fontVariations: direct.fontVariations } : {}),
      ...(direct?.textRuns !== undefined ? { textRuns: direct.textRuns } : {}),
      ...(direct?.visible !== undefined ? { visible: direct.visible } : {}),
      ...(direct?.gridCell ? { gridCell: { ...n.gridCell, ...direct.gridCell } } : {}),
      ...(direct?.grid ? (n.kind === 'instance'
        ? { instanceGrid: { ...n.instanceGrid, ...direct.grid } }
        : n.layout === 'grid' ? { grid: { ...(n.grid ?? defaultDesignGrid()), ...Object.fromEntries(Object.entries(direct.grid).filter(([, value]) => value !== undefined)) }, preserveLayout: false } : {}) : {}),
      ...(direct?.textLayoutMetrics
        ? { textLayoutMetrics: direct.textLayoutMetrics }
        : {}),
      ...(direct?.textBaselineMetrics ? { textBaselineMetrics: direct.textBaselineMetrics } : {}),
      ...(nested.length ? { instanceOverrides: [...inherited.values()] } : {}),
    }
  })
}

/** Remap override paths when copying a component subtree with fresh layer identities.
 * @param overrides - Optional instance-local records.
 * @param ids - Source-to-copy identities; external component identities remain linked.
 * @param newId - Optional allocator freshens effect identities when cloning their owning layer.
 * @returns Independent records referring to copied layers where available.
 */
export function remapDesignInstanceOverrides(
  overrides: readonly CopyOSDesignInstanceOverride[] | undefined,
  ids: ReadonlyMap<string, string>,
  newId?: () => string,
): CopyOSDesignInstanceOverride[] | undefined {
  return overrides?.map(o => ({
    ...o,
    path: o.path.map(id => ids.get(id) ?? id),
    fontFeatures: o.fontFeatures?.map(feature => ({ ...feature })),
    fontVariations: o.fontVariations?.map(variation => ({ ...variation })),
    textRuns: mapDesignTextHyperlinks(o.textRuns?.map(run => ({ ...run, style: { ...run.style,
      ...(run.style.fontVariations !== undefined ? { fontVariations: run.style.fontVariations.map(variation => ({ ...variation })) } : {}),
      ...(run.style.fontFeatures !== undefined ? { fontFeatures: run.style.fontFeatures.map(feature => ({ ...feature })) } : {}) } })), target => target.type === 'NODE' && ids.has(target.value) ?
      { ...target, value: ids.get(target.value) ?? target.value } : target),
    ...(o.effects ? { effects: o.effects.map(effect => ({ ...effect, id: newId?.() ?? effect.id })) } : {}),
    ...(o.componentId ? { componentId:ids.get(o.componentId) ?? o.componentId } : {}),
  }))
}
