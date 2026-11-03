import { designComponentGraphDiagnostics } from './design-component-graph.ts'
/** Browser/host grid geometry uses the same placements and track sizing. */
import {
  designLayoutBox,
  designLayoutSize,
  type DesignLayoutBox,
} from './design-layout-box.ts'
import type {
  CopyOSDesignGrid,
  CopyOSDesignGridTrack,
  CopyOSDesignNode,
} from './types.ts'

/** Default responsive columns and content-sized automatic rows.
 * @returns Independent two-column grid settings.
 */
export function defaultDesignGrid(): CopyOSDesignGrid {
  return {
    columns: [
      { sizing: 'fill', value: 1 },
      { sizing: 'fill', value: 1 },
    ],
    rows: [],
    autoRows: true,
    autoPosition: true,
    implicitRow: { sizing: 'hug', value: 0 },
  }
}
/** Resolved cell occupancy in zero-based track coordinates. */
export interface DesignGridPlacement {
  id: string
  column: number
  row: number
  columnSpan: number
  rowSpan: number
}
/** Track sizes and offsets in the parent coordinate system. */
export interface DesignGridGeometry {
  columns: number[]
  rows: number[]
  columnOffsets: number[]
  rowOffsets: number[]
  placements: DesignGridPlacement[]
  width: number
  height: number
}
/** Place visible flow children without overlaps, retaining empty cells in manual mode.
 * @param parent - Grid container.
 * @param children - Ordered immediate children, including hidden/absolute objects.
 * @returns Effective row-major positions; overflowing content grows implicit rows.
 */
export function designGridPlacements(
  parent: CopyOSDesignNode,
  children: readonly CopyOSDesignNode[],
): DesignGridPlacement[] {
  const grid = parent.grid ?? defaultDesignGrid(),
    count = grid.columns.length
  const occupied = new Map<number, bigint>(),
    cursors = new Map<string, number>()
  const free = (
    column: number,
    row: number,
    width: number,
    height: number,
  ): boolean => {
    if (column < 0 || column + width > count || row < 0) return false
    const mask = ((1n << BigInt(width)) - 1n) << BigInt(column)
    for (let y = row; y < row + height; y++)
      if (((occupied.get(y) ?? 0n) & mask) !== 0n) return false
    return true
  }
  const reserve = (p: DesignGridPlacement): void => {
    const mask = ((1n << BigInt(p.columnSpan)) - 1n) << BigInt(p.column)
    for (let y = p.row; y < p.row + p.rowSpan; y++)
      occupied.set(y, (occupied.get(y) ?? 0n) | mask)
  }
  const flow = children.filter(n => n.visible && !n.absolutePosition)
  const placed = new Map<string, DesignGridPlacement>()
  const make = (n: CopyOSDesignNode): DesignGridPlacement => ({
    id: n.id,
    column: 0,
    row: 0,
    columnSpan: Math.min(count, n.gridCell?.columnSpan ?? 1),
    rowSpan: n.gridCell?.rowSpan ?? 1,
  })
  if (!grid.autoPosition)
    for (const n of flow) {
      if (n.gridCell?.column === undefined && n.gridCell?.row === undefined)
        continue
      const p = make(n)
      p.column = Math.min(count - p.columnSpan, (n.gridCell.column ?? 1) - 1)
      p.row = grid.autoRows
        ? (n.gridCell.row ?? 1) - 1
        : Math.min(
          Math.max(0, grid.rows.length - p.rowSpan),
          (n.gridCell.row ?? 1) - 1,
        )
      if (free(p.column, p.row, p.columnSpan, p.rowSpan)) {
        reserve(p)
        placed.set(n.id, p)
      }
    }
  for (const n of flow) {
    if (placed.has(n.id)) continue
    const p = make(n),
      key = `${p.columnSpan}:${p.rowSpan}`
    let cursor = cursors.get(key) ?? 0
    while (
      !free(cursor % count, Math.floor(cursor / count), p.columnSpan, p.rowSpan)
    )
      cursor++
    p.column = cursor % count
    p.row = Math.floor(cursor / count)
    reserve(p)
    placed.set(n.id, p)
    cursors.set(key, cursor + p.columnSpan)
  }
  return flow.flatMap((n) => {
    const p = placed.get(n.id)
    return p ? [p] : []
  })
}
function sizes(
  tracks: readonly CopyOSDesignGridTrack[],
  axis: 'width' | 'height',
  placements: readonly DesignGridPlacement[],
  nodes: ReadonlyMap<string, CopyOSDesignNode>,
  gap: number,
  available: number,
  hug: boolean,
  boxes: ReadonlyMap<string, DesignLayoutBox>,
): number[] {
  const values = tracks.map(t => (t.sizing === 'fixed' ? t.value : 0))
  const start = axis === 'width' ? 'column' : 'row',
    span = axis === 'width' ? 'columnSpan' : 'rowSpan'
  for (const p of [...placements].sort((a, b) => a[span] - b[span])) {
    if (hug && p[span] > 1) {
      const unit = Math.max(
        0,
        ...tracks.flatMap((t, i) =>
          t.sizing === 'fill' ? [(values[i] ?? 0) / t.value] : [],
        ),
      )
      tracks.forEach((t, i) => {
        if (t.sizing === 'fill') values[i] = unit * t.value
      })
    }
    const node = nodes.get(p.id)
    if (!node) continue
    const indices = Array.from({ length: p[span] }, (_, i) => p[start] + i)
    const fills = indices.filter(i => tracks[i]?.sizing === 'fill')
    const eligible = fills.length
      ? fills
      : indices.filter(i => tracks[i]?.sizing === 'hug')
    const required = Math.max(
      0,
      (!hug && fills.length
        ? Math.max(
          (axis === 'width' ? node.minWidth : node.minHeight) ?? 0,
          axis === 'width'
            ? (boxes.get(node.id) ?? designLayoutBox(node)).widthFloor
            : (boxes.get(node.id) ?? designLayoutBox(node)).heightFloor,
        )
        : node[axis]) -
        gap * (p[span] - 1),
    )
    const deficit =
      required - indices.reduce((sum, i) => sum + (values[i] ?? 0), 0)
    const weight = eligible.reduce(
      (sum, i) => sum + (tracks[i]?.sizing === 'fill' ? tracks[i].value : 1),
      0,
    )
    if (deficit > 0 && weight > 0)
      for (const i of eligible)
        values[i] =
          (values[i] ?? 0) +
          (deficit * (tracks[i]?.sizing === 'fill' ? tracks[i].value : 1)) /
            weight
  }
  const fill = tracks.flatMap((t, i) => (t.sizing === 'fill' ? [i] : []))
  if (hug) {
    const unit = Math.max(
      0,
      ...fill.map(i => (values[i] ?? 0) / (tracks[i]?.value ?? 1)),
    )
    for (const i of fill) values[i] = unit * (tracks[i]?.value ?? 1)
  } else {
    let remaining = Math.max(
      0,
      available -
        Math.max(0, tracks.length - 1) * gap -
        tracks.reduce(
          (sum, t, i) => sum + (t.sizing === 'fill' ? 0 : (values[i] ?? 0)),
          0,
        ),
    )
    let pending = [...fill]
    while (pending.length) {
      const weight = pending.reduce(
        (sum, i) => sum + (tracks[i]?.value ?? 1),
        0,
      )
      const constrained = pending.filter(
        i =>
          (remaining * (tracks[i]?.value ?? 1)) / weight < (values[i] ?? 0),
      )
      if (!constrained.length) {
        for (const i of pending)
          values[i] = (remaining * (tracks[i]?.value ?? 1)) / weight
        break
      }
      for (const i of constrained)
        remaining = Math.max(0, remaining - (values[i] ?? 0))
      pending = pending.filter(i => !constrained.includes(i))
    }
  }
  return values
}
/** Calculate tracks for already-resolved numeric resources and child intrinsic sizes.
 * @param parent - Container and current dimensions.
 * @param children - Ordered immediate child geometry.
 * @param fixed - Axes forced by a parent layout or a width-first measurement pass.
 * @param boxes - Optional component-root metrics for child instances.
 * @returns Track sizes, offsets, placements and natural container dimensions.
 */
export function designGridGeometry(
  parent: CopyOSDesignNode,
  children: readonly CopyOSDesignNode[],
  fixed: Partial<Record<'width' | 'height', boolean>> = {},
  boxes: ReadonlyMap<string, DesignLayoutBox> = new Map(),
): DesignGridGeometry {
  const grid = parent.grid ?? defaultDesignGrid(),
    placements = designGridPlacements(parent, children)
  const rowCount = Math.max(
    grid.autoRows ? 0 : grid.rows.length,
    ...placements.map(p => p.row + p.rowSpan),
    0,
  )
  const rows = Array.from(
    { length: rowCount },
    (_, i) => grid.rows[i] ?? grid.implicitRow,
  )
  const nodes = new Map(children.map(n => [n.id, n]))
  const box = designLayoutBox(parent),
    { left, right, top, bottom } = box
  const xGap = parent.gap,
    yGap = parent.crossGap ?? parent.gap
  const clamp = (axis: 'width' | 'height', value: number): number =>
    designLayoutSize(parent, axis, value, box)
  const axis = (
    tracks: readonly CopyOSDesignGridTrack[],
    dimension: 'width' | 'height',
    padding: number,
    gap: number,
  ) => {
    const hug =
      !fixed[dimension] &&
      (parent[`${dimension}Sizing`] ??
        (dimension === 'height' ? 'hug' : 'fixed')) === 'hug'
    let trackSizes = sizes(
      tracks,
      dimension,
      placements,
      nodes,
      gap,
      Math.max(0, parent[dimension] - padding),
      hug,
      boxes,
    )
    const natural =
      padding +
      trackSizes.reduce((a, b) => a + b, 0) +
      Math.max(0, tracks.length - 1) * gap
    const dimensionValue = clamp(dimension, hug ? natural : parent[dimension])
    if (hug && Math.abs(dimensionValue - natural) > 0.00001)
      trackSizes = sizes(
        tracks,
        dimension,
        placements,
        nodes,
        gap,
        Math.max(0, dimensionValue - padding),
        false,
        boxes,
      )
    return { trackSizes, dimensionValue }
  }
  const x = axis(grid.columns, 'width', left + right, xGap),
    y = axis(rows, 'height', top + bottom, yGap)
  const offsets = (tracks: number[], start: number, gap: number): number[] => {
    let cursor = start
    return tracks.map((v) => {
      const p = cursor
      cursor += v + gap
      return p
    })
  }
  return {
    columns: x.trackSizes,
    rows: y.trackSizes,
    columnOffsets: offsets(x.trackSizes, left, xGap),
    rowOffsets: offsets(y.trackSizes, top, yGap),
    placements,
    width: x.dimensionValue,
    height: y.dimensionValue,
  }
}

/** Find the track block joined by spanning objects.
 * @param placements - Computed cell occupancy.
 * @param axis - Track direction.
 * @param index - Track inside the block.
 * @returns Inclusive start and exclusive end of the connected block.
 */
export function designGridTrackBlock(
  placements: readonly DesignGridPlacement[],
  axis: 'columns' | 'rows',
  index: number,
): [number, number] {
  const start = axis === 'columns' ? 'column' : 'row',
    span = axis === 'columns' ? 'columnSpan' : 'rowSpan'
  let low = index,
    high = index + 1,
    changed = true
  while (changed) {
    changed = false
    for (const cell of placements)
      if (cell[start] < high && cell[start] + cell[span] > low) {
        const a = Math.min(low, cell[start]),
          b = Math.max(high, cell[start] + cell[span])
        if (a !== low || b !== high) {
          low = a
          high = b
          changed = true
        }
      }
  }
  return [low, high]
}

/** Bound grid occupancy before allocating potentially large track arrays.
 * @param parent - Validly shaped grid container.
 * @param children - Immediate children.
 * @returns The exceeded resource bound, or null.
 */
export function designGridBudgetIssue(
  parent: CopyOSDesignNode,
  children: readonly CopyOSDesignNode[],
): 'area' | 'rows' | null {
  const count = parent.grid?.columns.length ?? 2
  const area = children.reduce(
    (sum, n) =>
      sum +
      (n.visible && !n.absolutePosition
        ? Math.min(count, n.gridCell?.columnSpan ?? 1) *
          (n.gridCell?.rowSpan ?? 1)
        : 0),
    0,
  )
  if (area > 65536) return 'area'
  if (
    designGridPlacements(parent, children).some(p => p.row + p.rowSpan > 4096)
  )
    return 'rows'
  return null
}
/** Check canvas candidates before committing a grid edit that exceeds file limits.
 * @param document - Candidate native scene.
 * @returns Whether grids fit their occupancy/row bounds; unrelated component graph failures remain a separate validation responsibility.
 */
export function designGridDocumentValid(
  document: import('./types.ts').CopyOSDesignDocument,
): boolean {
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const n of document.nodes)
    if (n.parentId) {
      const group = children.get(n.parentId) ?? []
      group.push(n)
      children.set(n.parentId, group)
    }
  return document.nodes.every(
    n =>
      n.layout !== 'grid' ||
      ((!n.grid || (n.grid.columns.length>=1 && n.grid.columns.length<=64 && n.grid.rows.length<=4096)) &&
      designGridBudgetIssue(n, children.get(n.id) ?? []) === null),
  ) && (!(document.nodes.some(node=>node.kind==='instance') && document.nodes.some(node=>node.layout==='grid')) ||
    !designComponentGraphDiagnostics(document).some(issue=>issue.kind==='grid'))
}
