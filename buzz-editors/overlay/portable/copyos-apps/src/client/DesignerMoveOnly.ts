/** Recognize edits that only reposition or reorder layers, whose document validity cannot differ from the committed document. */
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'

function sameExceptPosition(before: CopyOSDesignNode, after: CopyOSDesignNode): boolean {
  if (before === after) return true
  // A key holding `undefined` and a missing key are the same stored value.
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])] as (keyof CopyOSDesignNode)[]
  // Reconciliation may rebuild unchanged nested values, so differing references fall back to a value comparison.
  return keys.every(key => key === 'x' || key === 'y' || Object.is(before[key], after[key]) ||
    JSON.stringify(before[key]) === JSON.stringify(after[key]))
}

/** Report whether `after` changes nothing but layer `x`/`y` values and the order of layers relative to `before`.
 * Document validation and reconciliation (text links, runs, effects, grids, variants, component properties, component
 * graph, sizing limits) read neither layer positions nor the order of layer records, so a valid `before` implies the
 * same outcome for `after`.
 * @param before - Committed document that passed validation.
 * @param after - Candidate document.
 * @returns True when both hold the same uniquely identified layers, document fields are reference-identical and
 *   every layer field except `x`/`y` is equal.
 */
export function designerMovesOnly(before: CopyOSDesignDocument, after: CopyOSDesignDocument): boolean {
  if (before.nodes.length !== after.nodes.length) return false
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof CopyOSDesignDocument>
  for (const key of keys) if (key !== 'nodes' && !Object.is(before[key], after[key])) return false
  const previous = new Map(before.nodes.map(node => [node.id, node]))
  if (previous.size !== before.nodes.length) return false
  const seen = new Set<string>()
  return after.nodes.every((node) => {
    const old = previous.get(node.id)
    if (!old || seen.has(node.id)) return false
    seen.add(node.id)
    return sameExceptPosition(old, node)
  })
}
