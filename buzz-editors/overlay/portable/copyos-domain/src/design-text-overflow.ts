/** Text overflow limits shared by canvas layout and SVG export. */
import type { CopyOSDesignNode } from './types.ts'
import { designTextBaselineSignature } from './design-baseline.ts'

/** Identify text wrapping and available height without including cached measurements.
 * @param node - Resolved content, style and allocated geometry.
 * @returns Signature invalidated by text, width, fixed height, font or overflow-limit changes.
 */
export function designTextOverflowSignature(node: CopyOSDesignNode): string {
  return designTextBaselineSignature({ ...node, verticalAlign: 'bottom' })
}

/** Resolve ending-ellipsis limits without altering the authored text.
 * @param node - Resolved text geometry and resizing properties.
 * @returns Line and physical height limits, or null while disabled or unconstrained.
 * Wrapped paragraph height is a safe upper bound; browser metrics supply its exact visible height.
 * A single unwrapped paragraph uses horizontal ellipsis.
 */
export function designTextOverflow(
  node: CopyOSDesignNode,
): { lines: number; height: number; nowrap?: true | undefined } | null {
  if (node.kind !== 'text' || node.textTruncation !== 'ending') return null
  const nowrap =
    (node.textWrap === false || node.textSizing === 'auto-width') &&
    !node.text.includes('\n')
  const measured = node.textLayoutMetrics?.overflow
  if (measured?.signature === designTextOverflowSignature(node))
    return {
      lines: measured.lines,
      height: measured.height,
      ...(nowrap ? { nowrap: true as const } : {}),
    }
  const lineHeight = node.fontSize * node.lineHeight
  const fixed = !node.textSizing || node.textSizing === 'fixed'
  const height = fixed ? node.height : (node.maxHeight ?? Infinity)
  let lines = Math.min(
    node.maxLines ?? Infinity,
    Number.isFinite(height)
      ? Math.max(1, Math.floor(height / lineHeight))
      : Infinity,
  )
  if (!Number.isFinite(lines)) return null
  const paragraphs = node.text.split('\n').length
  const spacing = node.paragraphSpacing ?? 0
  const lineExtent = (count: number): number =>
    count * lineHeight + Math.max(0, Math.min(count, paragraphs) - 1) * spacing
  // Without wrapping every explicit paragraph occupies one line. Wrapped paragraphs
  // need browser measurements; retaining every possible gap avoids clipping them early.
  if (
    spacing &&
    (node.textWrap === false || node.textSizing === 'auto-width') &&
    Number.isFinite(height)
  ) {
    let low = 1,
      high = lines
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (lineExtent(middle) <= height) low = middle
      else high = middle - 1
    }
    lines = low
  }
  return {
    lines,
    height: Math.min(height, lineExtent(lines)),
    ...(nowrap ? { nowrap: true as const } : {}),
  }
}
