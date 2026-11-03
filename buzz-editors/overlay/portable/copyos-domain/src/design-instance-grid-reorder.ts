/** Content-preserving track moves scoped to one linked descendant grid. */
import type { CopyOSDesignDocument } from './types.ts'
import { createDesignRenderScene, createDesignInstanceContextReader, editDesignNodes,
  moveDesignGridTrack, DesignGridTrackMoveError } from './design-model.ts'
import { designGridGeometry } from './design-grid.ts'
import { designGridTrackMovePlan } from './design-grid-track-order.ts'
import { designInstanceGridConfigContext, mergeDesignInstanceGridConfigs } from './design-instance-grid-config.ts'
import { mergeDesignInstanceGridCells } from './design-instance-grid-cell.ts'

/** Move a connected track block and its contents within one instance's contextual grid.
 * @param document - Complete immutable native scene.
 * @param instanceId - Stored outer instance owning local configuration and descendant cell anchors.
 * @param path - Descendant grid frame or nested instance path; empty selects the outer linked root grid.
 * @param axis - Column or row orientation.
 * @param index - Zero-based effective track index, including implicit rows.
 * @param direction - One connected neighboring block earlier or later.
 * @returns One local transaction retaining token references, source geometry and all unrelated ownership.
 */
export function moveDesignInstanceGridTrack(document: CopyOSDesignDocument, instanceId: string, path: readonly string[],
  axis: 'columns' | 'rows', index: number, direction: -1 | 1): CopyOSDesignDocument {
  if (!path.length) return moveDesignGridTrack(document, instanceId, axis, index, direction)
  const scene = createDesignRenderScene(document), current = designInstanceGridConfigContext(document, instanceId, path, scene)
  if (!current?.active || !current.grid) throw new Error('Select a contextual grid container')
  const stored = document.nodes.find(node => node.id === instanceId)
  if (stored?.kind !== 'instance') throw new Error('Select a contextual grid container')
  const geometry = designGridGeometry(current.node, current.children, {}, current.context.layoutBoxes)
  const count = axis === 'columns' ? geometry.columns.length : geometry.rows.length
  const plan = designGridTrackMovePlan(geometry.placements, count, axis, index, direction)
  if (!plan) return document
  const { order, remap } = plan, locate = createDesignInstanceContextReader(document, scene)
  const edits = geometry.placements.map((placement) => {
    const path = current.target.kind === 'instance' ? [...current.effectivePath, placement.id]
      : [...current.effectivePath.slice(0, -1), placement.id]
    return { path: locate(instanceId, path)?.overridePath ?? path, patch: {
      column: (axis === 'columns' ? remap.get(placement.column) ?? placement.column : placement.column) + 1,
      row: (axis === 'rows' ? remap.get(placement.row) ?? placement.row : placement.row) + 1,
    } }
  })
  const paths = new Set((stored.instanceOverrides ?? []).map(override => JSON.stringify(override.path)))
  paths.add(JSON.stringify(current.overridePath))
  for (const edit of edits) paths.add(JSON.stringify(edit.path))
  const total = document.nodes.reduce((sum, node) => sum + (node.instanceOverrides?.length ?? 0), 0)
  if (paths.size > 1000 || total - (stored.instanceOverrides?.length ?? 0) + paths.size > 10000) throw new DesignGridTrackMoveError()
  const grid = current.grid, tracks = order.map(i => ({ ...(grid[axis][i] ?? grid.implicitRow) }))
  const configured = mergeDesignInstanceGridConfigs(stored, [{ path: current.overridePath, patch: {
    [axis]: tracks, autoPosition: false, ...(axis === 'rows' ? { autoRows: false } : {}),
  } }])
  const next = mergeDesignInstanceGridCells(configured, edits)
  return editDesignNodes(document, [{ id: instanceId, instanceOverrides: next.instanceOverrides }])
}
