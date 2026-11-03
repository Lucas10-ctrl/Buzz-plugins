/** Grid import reads evidenced Kiwi GUID maps, preserving saved geometry until explicit activation. */
import { designGridBudgetIssue } from './design-grid.ts'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { CopyOSDesignGridTrack, CopyOSDesignNode } from './types.ts'
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function guid(value: unknown): string | undefined {
  if (!object(value)) return
  const { sessionID, localID } = value
  if (typeof sessionID !== 'number' || typeof localID !== 'number' ||
    ![sessionID, localID].every(part => Number.isInteger(part) && part >= 0 && part <= 0xffffffff)) return
  if (sessionID === 0xffffffff && localID === 0xffffffff) return
  return `${sessionID}:${localID}`
}
function entries(value: unknown): Record<string, unknown>[] | undefined {
  if (!object(value) || !Array.isArray(value.entries) || !value.entries.every(object)) return
  return value.entries
}
function tracks(positions: unknown, sizes: unknown, limit: number): { ids: string[]; tracks: CopyOSDesignGridTrack[] } | undefined {
  const ordered = entries(positions), sizing = sizes === undefined ? [] : entries(sizes)
  if (!ordered || !ordered.length || ordered.length > limit || !sizing) return
  if (ordered.some(value => !guid(value.id) || typeof value.position !== 'string' || !value.position.length)) return
  const sorted = [...ordered].sort((a, b) => String(a.position) < String(b.position) ? -1 : String(a.position) > String(b.position) ? 1 : 0)
  const ids: string[] = []
  for (const value of sorted) {
    const id = guid(value.id)
    if (!id) return
    ids.push(id)
  }
  if (new Set(ids).size !== ids.length || new Set(sorted.map(value => value.position)).size !== ids.length) return
  const byId = new Map<string, Record<string, unknown>>()
  for (const value of sizing) {
    const id = guid(value.id)
    if (!id || !ids.includes(id) || byId.has(id) || !object(value.trackSize)) return
    byId.set(id, value.trackSize)
  }
  const result: CopyOSDesignGridTrack[] = []
  for (const id of ids) {
    const size = byId.get(id)
    if (!size) return
    const min = size.minSizing, max = size.maxSizing
    if (!object(min) || !object(max)) return
    if (min.type !== max.type || min.value !== max.value) return
    const fn = max
    const value = fn.value ?? (fn.type === 'HUG' ? 0 : undefined)
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    if (fn.type === 'FIXED' && value >= 1 && value <= 100000) result.push({ sizing: 'fixed', value })
    else if (fn.type === 'FLEX' && value >= .01 && value <= 1000) result.push({ sizing: 'fill', value })
    else if (fn.type === 'HUG' && value === 0) result.push({ sizing: 'hug', value: 0 })
    else return
  }
  return { ids, tracks: result }
}
/** Import evidenced Grid container and cell records without guessing symbolic instance ownership or unsupported minmax tracks.
 * @param nodes - Imported editable nodes; saved instance children have already been converted to frames.
 * @param sources - Native raw record indexed by imported node identity.
 * @param warn - Deduplicated import review sink.
 * @returns Nothing; only supported explicit fields are applied to the new import candidate.
 */
export function importFigGrids(nodes: CopyOSDesignNode[], sources: ReadonlyMap<string, NodeChange>,
  warn: (message: string) => void): void {
  const axes = new Map<string, { columns: string[]; rows: string[] }>()
  for (const node of nodes) {
    const raw = sources.get(node.id)
    const mode: unknown = raw && Reflect.get(raw, 'stackMode')
    if (!raw || mode !== 'GRID') continue
    if (node.kind === 'instance') {
      warn('Linked Grid configuration ownership requires review; current main Grid inherited without local activation')
      continue
    }
    const columns = tracks(Reflect.get(raw, 'gridColumns'), Reflect.get(raw, 'gridColumnsSizing'), 64)
    const rows = tracks(Reflect.get(raw, 'gridRows'), Reflect.get(raw, 'gridRowsSizing'), 4096)
    const xgap: unknown = Reflect.get(raw, 'gridColumnGap') ?? 0, ygap: unknown = Reflect.get(raw, 'gridRowGap') ?? 0
    if (!columns || !rows || typeof xgap !== 'number' || typeof ygap !== 'number' ||
      ![xgap, ygap].every(value => Number.isFinite(value) && value >= 0 && value <= 10000)) {
      warn('Grid track sizing requires review; unsupported or invalid Grid retained as saved free geometry'); continue
    }
    if (!['frame', 'component'].includes(node.kind)) {
      warn('Grid on unsupported layer kind requires review; saved geometry retained'); continue
    }
    const auto: unknown = Reflect.get(raw, 'gridAutoTracks') ?? 'NONE'
    const reflow: unknown = Reflect.get(raw, 'gridReflowEnabled') ?? false
    if (!['NONE', 'ROWS'].includes(String(auto)) || typeof reflow !== 'boolean') {
      warn('Unknown Grid positioning policy requires review; saved free geometry retained'); continue
    }
    const grid = { columns: columns.tracks, rows: rows.tracks, autoRows: auto === 'ROWS', autoPosition: false,
      implicitRow: { sizing: 'fill' as const, value: 1 } }
    if (auto === 'ROWS') warn('Implicit Grid rows use native equal FLEX sizing; review newly added row behavior')
    if (reflow) warn('Grid reflow flag semantics require review; explicit cell placement retained without enabling automatic positioning')
    node.layout = 'grid'; node.grid = grid; node.gap = xgap; node.crossGap = ygap; node.preserveLayout = true
    node.widthSizing ??= 'fixed'; node.heightSizing ??= 'fixed'
    if (raw.stackPrimarySizing && raw.stackPrimarySizing !== 'FIXED' || raw.stackCounterSizing && raw.stackCounterSizing !== 'FIXED')
      warn('Grid axis Hug sizing requires review; own-axis sizing is not inferred')
    axes.set(node.id, { columns: columns.ids, rows: rows.ids })
    warn('Grid imported with saved positions. Editing layout activates CopyOS reflow; review track sizing and placement.')
  }
  for (const node of nodes) {
    const raw = sources.get(node.id), parent = node.parentId ? axes.get(node.parentId) : undefined
    if (!raw || !parent) continue
    const cell = { ...node.gridCell }
    for (const [axis, field, ids] of [['column', 'gridColumnAnchor', parent.columns], ['row', 'gridRowAnchor', parent.rows]] as const) {
      const value: unknown = Reflect.get(raw, field)
      if (value === undefined) continue
      const key = guid(value), index = key ? ids.indexOf(key) : -1
      if (index < 0) warn(`Unresolved Grid ${axis} anchor requires review; saved position retained`)
      else cell[axis] = index + 1
    }
    for (const [key, field, limit] of [['columnSpan', 'gridColumnSpan', parent.columns.length],
      ['rowSpan', 'gridRowSpan', 64]] as const) {
      const value: unknown = Reflect.get(raw, field)
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit)
        warn('Invalid Grid cell span requires review; saved geometry retained')
      else cell[key] = value
    }
    for (const [key, field] of [['horizontalAlign', 'gridChildHorizontalAlign'], ['verticalAlign', 'gridChildVerticalAlign']] as const) {
      const value: unknown = Reflect.get(raw, field)
      if (value === 'MIN') cell[key] = 'start'
      else if (value === 'CENTER') cell[key] = 'center'
      else if (value === 'MAX') cell[key] = 'end'
      else if (value === 'AUTO') warn('Grid AUTO cell alignment default requires review; native leading default retained')
      else if (value !== undefined) warn('Unknown Grid cell alignment requires review; native default retained')
    }
    if (Object.keys(cell).length) node.gridCell = cell
    if ((raw.stackChildPrimaryGrow ?? 0) > 0 || raw.stackChildAlignSelf === 'STRETCH')
      warn('Legacy stack growth on Grid children requires review; not interpreted as Grid Fill')
  }
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of nodes) if (node.parentId) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node); children.set(node.parentId, siblings)
  }
  for (const node of nodes) if (axes.has(node.id) && designGridBudgetIssue(node, children.get(node.id) ?? [])) {
    node.layout = 'none'; delete node.grid; node.preserveLayout = false
    warn('Grid occupancy exceeds native limits; saved free geometry retained')
  }
  for (const raw of sources.values()) {
    const data = raw.symbolData
    if (data && 'symbolOverrides' in data && Array.isArray(data.symbolOverrides) && data.symbolOverrides.some(value =>
      object(value) && Object.keys(value).some(key => key.startsWith('grid'))))
      warn('Native symbolic Grid overrides require review; unverified Grid ownership is not imported')
  }
}
