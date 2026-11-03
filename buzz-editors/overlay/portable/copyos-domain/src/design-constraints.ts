/** Constraint geometry is evaluated without mutating authored coordinates. */
import type { CopyOSDesignConstraints, CopyOSDesignNode } from './types.ts'

/** Whether a child uses frame constraints rather than participating in flow.
 * @param child - Child layer.
 * @param parent - Immediate parent container.
 * @returns True for free/preserved layouts and independently positioned children.
 */
export function designConstraintsActive(
  child: CopyOSDesignNode,
  parent: CopyOSDesignNode,
): boolean {
  return (
    parent.layout === 'none' ||
    !!parent.preserveLayout ||
    !!child.absolutePosition
  )
}
/** Transform an axis from its authored reference size to the current frame size.
 * @param position - Authored leading offset.
 * @param length - Authored layer length.
 * @param reference - Parent length at constraint capture.
 * @param target - Current parent length.
 * @param mode - Edge, center, stretch or proportional behavior.
 * @returns Transformed offset and length before layer size bounds.
 */
export function designConstraintAxis(
  position: number,
  length: number,
  reference: number,
  target: number,
  mode:
    CopyOSDesignConstraints['horizontal'] | CopyOSDesignConstraints['vertical'],
): { position: number; length: number } {
  const delta = target - reference
  if (mode === 'scale')
    return {
      position: (position * target) / reference,
      length: (length * target) / reference,
    }
  if (mode === 'right' || mode === 'bottom')
    return { position: position + delta, length }
  if (mode === 'center') return { position: position + delta / 2, length }
  if (mode === 'left-right' || mode === 'top-bottom')
    return { position, length: length + delta }
  return { position, length }
}
/** Convert a displayed position edit back to its stable constraint reference.
 * @param position - Requested leading offset in the current parent.
 * @param reference - Captured parent length.
 * @param target - Current parent length.
 * @param mode - Active constraint rule.
 * @returns Stored offset retaining size token bindings and the original reference.
 */
export function designConstraintPosition(
  position: number,
  reference: number,
  target: number,
  mode:
    CopyOSDesignConstraints['horizontal'] | CopyOSDesignConstraints['vertical'],
): number {
  return mode === 'scale'
    ? (position * reference) / target
    : position - designConstraintAxis(0, 1, reference, target, mode).position
}
