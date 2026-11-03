/** Shared bounded backend-cache accounting for file validation and browser transactions. */
import type { CopyOSDesignDocument } from './types.ts'

/** Count native text backend identities and all baseline contexts using the schema's character budget.
 * @param document - Complete candidate, including contextual instance records.
 * @returns Serialized characters counted against the 8,000,000-character backend-cache limit; layout signatures have a separate limit.
 */
export function designTextMeasurementCacheCharacters(document: CopyOSDesignDocument): number {
  return document.nodes.reduce((sum, node) => sum + JSON.stringify([node.textLayoutMetrics?.engine, node.textBaselineMetrics,
    ...(node.instanceOverrides ?? []).map(record => [record.textLayoutMetrics?.engine, record.textBaselineMetrics])]).length, 0)
}
