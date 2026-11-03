/** Independent linked descendant cell ownership, stored in the existing typed override path. */
import type { CopyOSDesignInstanceGridCell, CopyOSDesignNode, CopyOSDesignInstanceOverride } from './types.ts'

/** Cell fields that can be owned independently of source placement and span. */
export const DESIGN_INSTANCE_GRID_CELL_KEYS = ['column', 'row', 'columnSpan', 'rowSpan', 'horizontalAlign', 'verticalAlign'] as const

/** Merge multiple local cell edits without repeatedly copying or laying out the scene.
 * @param instance - Stored linked instance; other nodes are returned unchanged.
 * @param edits - Typed descendant paths and partial ownership; undefined inherits a field, null resets only cell ownership.
 * @returns Instance copy preserving unrelated content, visibility, nested swaps and measurements; no scene validation is performed.
 */
export function mergeDesignInstanceGridCells(instance: CopyOSDesignNode,
  edits: readonly { path: readonly string[]; patch: CopyOSDesignInstanceGridCell | null }[]): CopyOSDesignNode {
  if (instance.kind !== 'instance' || !edits.length) return instance
  const records = new Map((instance.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
  for (const { path, patch } of edits) {
    const key = JSON.stringify(path), previous = records.get(key)
    const gridCell = { ...previous?.gridCell }
    if (patch === null) for (const field of DESIGN_INSTANCE_GRID_CELL_KEYS) Reflect.deleteProperty(gridCell, field)
    else for (const field of DESIGN_INSTANCE_GRID_CELL_KEYS) if (Object.hasOwn(patch, field)) {
      if (patch[field] === undefined) Reflect.deleteProperty(gridCell, field)
      else Object.assign(gridCell, { [field]: patch[field] })
    }
    const record: CopyOSDesignInstanceOverride = { ...previous, path: [...path],
      gridCell: Object.keys(gridCell).length ? gridCell : undefined }
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

/** Merge one local cell edit while preserving every other override field.
 * @param instance - Stored linked instance.
 * @param path - Nested instance identities followed by the descendant layer identity.
 * @param patch - Fields to own; undefined inherits one field, null resets all cell fields.
 * @returns Instance copy; use the document edit helper for contextual target validation.
 */
export function mergeDesignInstanceGridCell(instance: CopyOSDesignNode, path: readonly string[],
  patch: CopyOSDesignInstanceGridCell | null): CopyOSDesignNode {
  return mergeDesignInstanceGridCells(instance, [{ path, patch }])
}
