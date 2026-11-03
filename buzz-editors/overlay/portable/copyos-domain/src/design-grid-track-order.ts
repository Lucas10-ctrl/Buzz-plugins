/** Shared connected-track ordering for ordinary and contextual linked grids. */
import { designGridTrackBlock, type DesignGridPlacement } from './design-grid.ts'
/** Calculate a neighboring connected-block move without changing authored scene data.
 * @param placements - Effective cells, including current spans and collision resolution.
 * @param count - Computed tracks on the moved axis.
 * @param axis - Column or row orientation.
 * @param index - Zero-based selected track.
 * @param direction - One connected neighboring block earlier or later.
 * @returns New-to-old track order and old-to-new cell-anchor map, or undefined at a blocked edge.
 */
export function designGridTrackMovePlan(placements: readonly DesignGridPlacement[], count: number,
  axis: 'columns' | 'rows', index: number, direction: -1 | 1): { order: number[]; remap: Map<number, number> } | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Grid track index is out of range')
  const [low, high] = designGridTrackBlock(placements, axis, index), target = direction < 0 ? low - 1 : high
  if (target < 0 || target >= count) return
  const [otherLow, otherHigh] = designGridTrackBlock(placements, axis, target)
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
  const order = direction < 0
    ? [...range(0, otherLow), ...range(low, high), ...range(otherLow, otherHigh), ...range(high, count)]
    : [...range(0, low), ...range(otherLow, otherHigh), ...range(low, high), ...range(otherHigh, count)]
  return { order, remap: new Map(order.map((old, next) => [old, next])) }
}
