/** Linked root grid configuration owns axes independently of inherited cell placements. */
import type { CopyOSDesignGrid, CopyOSDesignNode } from './types.ts'
import { defaultDesignGrid } from './design-grid.ts'
/** Root grid fields with explicit local ownership; track arrays own the whole axis. */
export const DESIGN_INSTANCE_GRID_KEYS = ['columns','rows','autoRows','autoPosition','implicitRow'] as const
/** Check one authored local root grid field without treating raw instance grid fallbacks as ownership.
 * @param node - Stored linked instance.
 * @param key - Root grid configuration field.
 * @returns Whether the field is explicitly local, including false and empty row arrays.
 */
export function designInstanceGridOwns(node:CopyOSDesignNode,key:typeof DESIGN_INSTANCE_GRID_KEYS[number]):boolean {
  return node.kind==='instance' && node.instanceGrid?.[key]!==undefined
}
/** Apply grid ownership before track resources and layout resolve in the instance mode.
 * @param source - Current main component root.
 * @param instance - Stored or contextual linked instance.
 * @returns Effective root; local settings remain dormant outside a source grid and explicit edits activate preserved layouts.
 */
export function applyDesignInstanceGrid(source:CopyOSDesignNode,instance:CopyOSDesignNode):CopyOSDesignNode {
  if (source.layout!=='grid') return source
  const fields=Object.fromEntries(Object.entries(instance.instanceGrid ?? {}).filter(([,value])=>value!==undefined))
  if (!Object.keys(fields).length) return source
  return { ...source,grid:{ ...(source.grid ?? defaultDesignGrid()),...fields },preserveLayout:false }
}
/** Enumerate authored grid tracks, including dormant local configuration, for shared resource validation.
 * @param node - Stored node with optional source and local grid settings.
 * @returns All authored track records; aliases remain unresolved.
 */
export function designAuthoredGridTracks(node:CopyOSDesignNode):import('./types.ts').CopyOSDesignGridTrack[] {
  return [...(node.grid?.columns ?? []),...(node.grid?.rows ?? []),...(node.grid?[node.grid.implicitRow]:[]),
    ...(node.instanceGrid?.columns ?? []),...(node.instanceGrid?.rows ?? []),
    ...(node.instanceGrid?.implicitRow?[node.instanceGrid.implicitRow]:[]),
    ...(node.instanceOverrides ?? []).flatMap(record => [...record.grid?.columns ?? [], ...record.grid?.rows ?? [],
      ...(record.grid?.implicitRow ? [record.grid.implicitRow] : [])])]
}
/** Clone editable effective grid fallbacks without baking active-mode token values.
 * @param source - Current component root.
 * @param instance - Linked instance owning optional fields.
 * @returns A detached configuration for a grid source, or undefined for dormant settings.
 */
export function authoredDesignInstanceGrid(source:CopyOSDesignNode,instance:CopyOSDesignNode):CopyOSDesignGrid|undefined {
  if (source.layout!=='grid') return
  const grid=applyDesignInstanceGrid(source,instance).grid ?? defaultDesignGrid()
  return { ...grid,columns:grid.columns.map(track=>({ ...track })),
    rows:grid.rows.map(track=>({ ...track })),implicitRow:{ ...grid.implicitRow } }
}
