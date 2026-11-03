/** Browser-safe topology checks for empty Canvas frames backed by existing Page Builder pages. */
import type { CopyOSDesignDocument } from './types.ts'

/**
 * Check linked screen placement without loading pages or resolving the complete scene.
 * @param document - Typed native design; UUID syntax is admitted separately by the native schema.
 * @returns Whether every linked screen is a top-level frame with no native children; locks and repeated page references are allowed.
 */
export function designPageLinksValid(document: CopyOSDesignDocument): boolean {
  const linked = new Set<string>()
  for (const node of document.nodes) if (node.pageLink) {
    if (node.kind !== 'frame' || node.parentId !== null) return false
    linked.add(node.id)
  }
  return document.nodes.every(node => !node.parentId || !linked.has(node.parentId))
}
