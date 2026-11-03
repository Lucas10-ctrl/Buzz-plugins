/** Paint editing preserves live color bindings while a local opacity can represent the requested result. */
import type { CopyOSDesignVariable } from '../../../copyos-domain/src/types.ts'
/** Retain a matching resource by adjusting its paint multiplier; detach only when the requested RGBA requires it.
 * @param paint - Native RGB fallback, authored opacity and optional color binding.
 * @param resource - Effective color resource in the layer's mode.
 * @param color - Requested RGB literal.
 * @param opacity - Requested final alpha after both opacity factors.
 * @returns Native paint fields with the effective appearance preserved.
 */
export function designerPaintColorEdit(
  paint: { color: string; opacity: number; variableId?: string | null | undefined },
  resource: CopyOSDesignVariable | undefined,
  color: string,
  opacity: number,
): { color: string; opacity: number; variableId: string | null } {
  const alpha = resource?.alpha ?? 1
  if (resource && color.toLowerCase() === resource.value.toLowerCase() && opacity <= alpha) {
    return {
      color: resource.value,
      variableId: resource.id,
      opacity: alpha === 0 ? paint.opacity : opacity / alpha,
    }
  }
  return { color, opacity, variableId: null }
}
