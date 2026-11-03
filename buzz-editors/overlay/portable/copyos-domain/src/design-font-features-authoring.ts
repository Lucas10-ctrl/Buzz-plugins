/** Whole-list OpenType authoring for stored text and linked descendants. */
import { designTextRangeContext } from './design-text-range.ts'
import { editDesignNodes } from './design-model.ts'
import { normalizeDesignFontFeatures } from './design-font-features.ts'
import type { CopyOSDesignDocument, CopyOSDesignFontFeature } from './types.ts'

/** Set or reveal inherited whole-layer OpenType features without touching range ownership.
 * @param document - Current native scene.
 * @param nodeId - Stored text or owning outer instance identity.
 * @param path - Empty for stored text, otherwise the linked descendant path.
 * @param features - Explicit complete feature list; null removes local ownership.
 * @returns Edited scene with independent features and invalidated local measurements; locked or non-text targets throw.
 */
export function editDesignFontFeatures(document: CopyOSDesignDocument, nodeId: string, path: readonly string[],
  features: readonly CopyOSDesignFontFeature[] | null): CopyOSDesignDocument {
  const current = designTextRangeContext(document, nodeId, path)
  if (!current || current.locked) throw new Error('OpenType target is missing, non-text or locked')
  const fontFeatures = features === null ? undefined : normalizeDesignFontFeatures(features)
  if (!path.length) return editDesignNodes(document, [{ id: nodeId, fontFeatures,
    textLayoutMetrics: undefined, textBaselineMetrics: undefined }])
  const records = current.stored.instanceOverrides ?? [], key = JSON.stringify(current.overridePath)
  const previous = records.find(record => JSON.stringify(record.path) === key)
  const record = { ...previous, path: current.overridePath, fontFeatures,
    textLayoutMetrics: undefined, textBaselineMetrics: undefined }
  const retained = Object.entries(record).some(([name, value]) => name !== 'path' && value !== undefined)
  const overrides = previous ? records.flatMap(item => item === previous ? retained ? [record] : [] : [item]) :
    retained ? [...records, record] : records
  if (overrides.length > 1000) throw new Error('Instance exceeds 1000 overrides')
  return editDesignNodes(document, [{ id: nodeId, instanceOverrides: overrides }])
}
