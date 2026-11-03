/** Explicit text measurements remain reusable in headless layout and exports. */
import type { CopyOSDesignNode, CopyOSDesignTextMeasurementEngine } from './types.ts'
import { designTextOverflow } from './design-text-overflow.ts'
import { designTextBaselineSignature } from './design-baseline.ts'

/** Intrinsic-size cache readiness; fixed boxes can still need font, baseline or overflow measurement. */
export interface DesignTextMeasurementStatus {
  state: 'fixed' | 'measured' | 'missing' | 'stale'
  autoWidth: boolean
  autoHeight: boolean
  engine: CopyOSDesignTextMeasurementEngine | null
}

/** Report whether automatic text sizing has a matching explicit measurement without measuring or modifying the node.
 * @param node - Resolved text after shared styles, modes and allocated width; other layer kinds return undefined.
 * @returns Intrinsic-size readiness only; measured means a matching cached measurement, not verified font availability.
 */
export function designTextMeasurementStatus(node: CopyOSDesignNode): DesignTextMeasurementStatus | undefined {
  if (node.kind !== 'text') return undefined
  const autoWidth = node.textSizing === 'auto-width'
  const autoHeight = autoWidth || node.textSizing === 'auto-height'
  return {
    state: !autoHeight
      ? 'fixed'
      : !node.textLayoutMetrics
        ? 'missing'
        : node.textLayoutMetrics.signature === designTextLayoutSignature(node)
          ? 'measured'
          : 'stale',
    autoWidth,
    autoHeight,
    engine: node.textLayoutMetrics?.engine ?? null,
  }
}

/** Identify intrinsic content/style and, for wrapping text, its allocated width.
 * @param node - Text after shared style, mode and layout-width resolution.
 * @returns Signature excluding the dimensions produced by intrinsic measurement.
 */
export function designTextLayoutSignature(node: CopyOSDesignNode): string {
  return designTextBaselineSignature({
    ...node,
    width: node.textSizing === 'auto-width' ? 0 : node.width,
    height: 0,
    verticalAlign: 'top',
  })
}

/** Apply a matching measured size without changing dimensions allocated by the parent.
 * @param node - Mutable arranged text copy; non-text and stale measurements are ignored.
 * @param forced - Parent-allocated axes, which take precedence over intrinsic dimensions.
 */
export function applyDesignTextLayoutMetrics(
  node: CopyOSDesignNode,
  forced: Partial<{ width: number; height: number }> = {},
): void {
  if (node.kind !== 'text' || !node.textSizing || node.textSizing === 'fixed') return
  const metrics = node.textLayoutMetrics
  if (metrics?.signature !== designTextLayoutSignature(node)) return
  if (node.textSizing === 'auto-width' && forced.width === undefined) node.width = metrics.width
  if (forced.height === undefined)
    node.height = Math.min(metrics.height, designTextOverflow(node)?.height ?? metrics.height)
}
