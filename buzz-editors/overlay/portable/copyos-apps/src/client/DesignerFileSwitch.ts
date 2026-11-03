/** Separate derived text measurement changes from authored work before a file transition. */
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
/** Identify authored content while excluding only measurement caches and intrinsic fallback dimensions.
 * @param document - Authored document or its internally generated saved-content snapshot.
 * @returns Stable authored content; auto-height width, fixed geometry and every non-measurement override remain significant.
 */
export function designerAuthoredContentKey(document: CopyOSDesignDocument): string {
  const { id: _id, revision: _revision, createdAt: _created, updatedAt: _updated, ...content } = document
  return JSON.stringify({
    ...content,
    nodes: document.nodes.map((node) => {
      const {
        textLayoutMetrics: _layout,
        textBaselineMetrics: _baseline,
        instanceOverrides,
        ...authored
      } = node
      if (node.kind === 'text') {
        if (node.textSizing === 'auto-width') Reflect.deleteProperty(authored, 'width')
        if (node.textSizing === 'auto-width' || node.textSizing === 'auto-height')
          Reflect.deleteProperty(authored, 'height')
      }
      const records = (instanceOverrides ?? [])
        .map((record) => {
          const { textLayoutMetrics: _layout, textBaselineMetrics: _baseline, ...fields } = record
          return fields
        })
        .filter(record =>
          Object.entries(record).some(([key, value]) => key !== 'path' && value !== undefined),
        )
      return { ...authored, ...(records.length ? { instanceOverrides: records } : {}) }
    }),
  })
}
