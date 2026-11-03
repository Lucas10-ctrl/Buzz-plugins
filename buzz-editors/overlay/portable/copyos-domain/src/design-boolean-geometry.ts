/** Synchronous filled SVG geometry shared by live Boolean rendering, exports and picking. */
import paper from 'paper/dist/paper-core.js'
import svgpath from 'svgpath'
import { designColorCssValue } from './design-color.ts'
import type { CopyOSDesignNode } from './types.ts'
import type { CopyOSDesignPathData } from './design-path-edit.ts'

/** Ordered operations: subtraction retains the first operand and removes subsequent operands. */
export type DesignBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude'
/** SVG affine matrix maps physical operand-local coordinates into result-local coordinates. */
export interface DesignBooleanOperand {
  pathData: CopyOSDesignPathData
  matrix?: readonly [number, number, number, number, number, number]
}
/** Exact filled-curve bounds; empty geometry has no bounds. */
export interface DesignPathBounds { x: number; y: number; width: number; height: number }

function withScope<T>(run: (scope: paper.PaperScope) => T): T {
  const scope = new paper.PaperScope()
  try {
    scope.setup(new scope.Size(1, 1))
    scope.view.autoUpdate = false
    return run(scope)
  } finally {
    scope.remove()
    paper.activate()
  }
}

function item(scope: paper.PaperScope, operand: DesignBooleanOperand): paper.PathItem {
  let result: paper.PathItem = new scope.CompoundPath({ insert: false })
  for (const entry of operand.pathData.paths) {
    const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(entry.d)
    if (parsed.err) throw new RangeError(`Invalid Boolean SVG path: ${parsed.err}`)
    const path = new scope.CompoundPath({
      pathData: operand.matrix ? parsed.matrix([...operand.matrix]).toString() : entry.d,
      fillRule: entry.fillRule, insert: false,
    })
    const united = result.unite(path, { insert: false })
    result.remove(); path.remove(); result = united
  }
  return result
}

/** Evaluate ordered filled operands synchronously without modifying their strings or a shared project.
 * @param operation - Native Boolean operation; subtraction starts from the first operand.
 * @param operands - Physical local paths and their affine maps into the result's local coordinates.
 * @param width - Result viewbox width; geometry is never cropped or shifted to this box.
 * @param height - Result viewbox height.
 * @returns Nonzero paths preserving holes; an empty result has an explicit empty paths array.
 */
export function evaluateDesignBooleanGeometry(
  operation: DesignBooleanOperation, operands: readonly DesignBooleanOperand[], width: number, height: number,
): CopyOSDesignPathData {
  return withScope((scope) => {
    let result = operands[0] ? item(scope, operands[0]) : new scope.CompoundPath({ insert: false })
    for (const operand of operands.slice(1)) {
      const next = item(scope, operand)
      const options = { insert: false }
      const combined = operation === 'union' ? result.unite(next, options)
        : operation === 'subtract' ? result.subtract(next, options)
          : operation === 'intersect' ? result.intersect(next, options) : result.exclude(next, options)
      result.remove(); next.remove(); result = combined
    }
    const d = result.getPathData(null, 15)
    return { width, height, paths: d ? [{ d, fillRule: 'nonzero' }] : [] }
  })
}

/** Read filled SVG bounds using the same curve evaluator as Boolean operations.
 * @param data - Geometry in its authored viewbox coordinates.
 * @returns Filled bounds, or undefined for an empty result.
 */
export function designPathBounds(data: CopyOSDesignPathData): DesignPathBounds | undefined {
  return withScope((scope) => {
    const path = item(scope, { pathData: data })
    if (!path.pathData) return
    const { x, y, width, height } = path.bounds
    return { x, y, width, height }
  })
}

/** Test filled curves, including holes and disjoint islands, with the Boolean evaluator.
 * @param data - Geometry in authored viewbox coordinates.
 * @param x - Local point x.
 * @param y - Local point y.
 * @returns Whether the point belongs to the filled geometry.
 */
export function designPathContains(data: CopyOSDesignPathData, x: number, y: number): boolean {
  return withScope(scope => item(scope, { pathData: data }).contains(new scope.Point(x, y)))
}

/** Check whether a layer can participate without losing unsupported stroke geometry.
 * @param node - Effective node after token and component resolution.
 * @returns Supported geometric kind with no visible positive stroke; strokes require faithful outlining first.
 */
export function designBooleanNodeEligibility(node: CopyOSDesignNode): boolean {
  if (!['rectangle', 'ellipse', 'path', 'boolean'].includes(node.kind)) return false
  if (node.kind === 'path' && !node.pathData) return false
  if (node.pathData?.paths.some((path) => {
    const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(path.d)
    return !!parsed.err
  })) return false
  const positive = Math.max(node.strokeWidth, node.strokeTopWidth ?? 0, node.strokeRightWidth ?? 0,
    node.strokeBottomWidth ?? 0, node.strokeLeftWidth ?? 0) > 0
  const painted = (node.strokeOpacity ?? 1) > 0 && (node.strokes
    ? node.strokes.some(paint => paint.visible && paint.opacity > 0 &&
      (!!paint.gradient || !!paint.image || (designColorCssValue(paint.color)?.alpha ?? 1) > 0))
    : (designColorCssValue(node.stroke)?.alpha ?? 1) > 0)
  return !(positive && painted)
}

/** Convert supported node geometry to physical local coordinates, retaining every path's fill rule.
 * @param node - Effective rectangle, ellipse, path, or a Boolean with an already derived pathData.
 * @returns Local filled paths; undefined rejects an unsupported kind or visible stroke.
 */
export function designBooleanNodePath(node: CopyOSDesignNode): CopyOSDesignPathData | undefined {
  if (!designBooleanNodeEligibility(node)) return
  const { width, height } = node
  const source = node.pathData
  if (source) return { width, height, paths: source.paths.map(path => ({ ...path,
    d: svgpath(path.d).scale(width / source.width, height / source.height).toString(),
  })) }
  if (node.kind === 'ellipse') return { width, height, paths: [{ fillRule: 'nonzero',
    d: `M0 ${height / 2} A${width / 2} ${height / 2} 0 1 0 ${width} ${height / 2} A${width / 2} ${height / 2} 0 1 0 0 ${height / 2} Z`,
  }] }
  if (node.kind !== 'rectangle') return
  let tl = node.radiusTopLeft ?? node.radius, tr = node.radiusTopRight ?? node.radius,
    br = node.radiusBottomRight ?? node.radius, bl = node.radiusBottomLeft ?? node.radius
  const scale = Math.min(1, width / (tl + tr || 1), width / (bl + br || 1), height / (tl + bl || 1), height / (tr + br || 1))
  tl *= scale; tr *= scale; br *= scale; bl *= scale
  return { width, height, paths: [{ fillRule: 'nonzero',
    d: `M${tl} 0 H${width - tr} A${tr} ${tr} 0 0 1 ${width} ${tr} V${height - br} A${br} ${br} 0 0 1 ${width - br} ${height} H${bl} A${bl} ${bl} 0 0 1 0 ${height - bl} V${tl} A${tl} ${tl} 0 0 1 ${tl} 0 Z`,
  }] }
}
