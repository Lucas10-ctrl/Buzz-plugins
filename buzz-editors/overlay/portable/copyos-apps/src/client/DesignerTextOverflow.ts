/** Fit actual browser-laid-out paragraph line boxes before applying ending ellipsis. */
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import { designTextOverflowSignature } from '../../../copyos-domain/src/design-model.ts'

/** Read untruncated paragraph geometry including the gaps between paragraph blocks.
 * @param node - Resolved text content and available box dimensions.
 * @param content - Connected, unclamped text element whose paragraphs use the node's line height.
 * @returns Exact fitting line count and visible height, or null when text has no measurable paragraph gaps.
 */
export function measureDesignerTextOverflow(
  node: CopyOSDesignNode,
  content: HTMLElement,
): NonNullable<
  NonNullable<CopyOSDesignNode['textLayoutMetrics']>['overflow']
> | null {
  if (
    node.textTruncation !== 'ending' ||
    !(node.paragraphSpacing && node.paragraphSpacing > 0)
  )
    return null
  const box = content.getBoundingClientRect()
  if (box.height <= 0) return null
  const fixed = !node.textSizing || node.textSizing === 'fixed'
  const available = fixed ? node.height : (node.maxHeight ?? Infinity)
  const limit = node.maxLines ?? Infinity
  if (!Number.isFinite(available) && !Number.isFinite(limit)) return null
  const lineHeight = node.fontSize * node.lineHeight
  let lines = 0,
    height = 0
  for (const paragraph of content.children) {
    const bounds = paragraph.getBoundingClientRect()
    const count = Math.max(1, Math.round(bounds.height / lineHeight))
    for (let index = 0; index < count; index++) {
      const bottom = bounds.top - box.top + (index + 1) * lineHeight
      if (lines >= limit || bottom > available + 0.01) {
        return {
          signature: designTextOverflowSignature(node),
          lines: Math.max(1, lines),
          height: Math.max(1, Math.min(available, height || lineHeight)),
        }
      }
      lines++
      height = bottom
    }
  }
  return lines
    ? {
      signature: designTextOverflowSignature(node),
      lines,
      height: Math.max(1, Math.min(available, height)),
    }
    : null
}
