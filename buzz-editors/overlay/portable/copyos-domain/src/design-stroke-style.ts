/** Bounded SVG stroke geometry metadata; glyph strokes retain unsupported settings without pretending to apply them. */
import { z } from 'zod'
import svgpath from 'svgpath'
import type { CopyOSDesignNode } from './types.ts'
/** Optional geometry fields with independent linked-root ownership. */
export const DESIGN_STROKE_STYLE_KEYS = ['strokeCap', 'strokeJoin', 'strokeMiterLimit', 'strokeDashes', 'strokeDashOffset'] as const
/** Strict basic endpoint decorations; arrowheads and per-vertex caps are not represented. */
export const designStrokeCapSchema = z.enum(['butt', 'round', 'square'])
/** Strict SVG vertex joins. */
export const designStrokeJoinSchema = z.enum(['miter', 'round', 'bevel'])
/** SVG miter-length/width ratio; angle conversion belongs to the inspector. */
export const designStrokeMiterLimitSchema = z.number().min(1).max(1000)
/** Alternating dash/gap pairs; an explicit empty list owns a solid stroke. */
export const designStrokeDashesSchema = z.array(z.number().min(0).max(1000)).max(100)
  .refine(values => values.length % 2 === 0 && (!values.length || values.some(value => value > 0)),
    'Dash patterns require positive-total dash/gap pairs, or an empty solid pattern')
/** Signed phase in physical design pixels. */
export const designStrokeDashOffsetSchema = z.number().min(-10000).max(10000)
const closedPaths = new WeakMap<object, boolean>()
/** Determine whether every authored subpath has an explicit close command.
 * @param node - Path geometry; non-path shapes have closed outlines.
 * @returns False for open, mixed or invalid path geometry, which supports centered strokes only.
 */
export function designStrokeAlignmentSupported(node: Pick<CopyOSDesignNode, 'kind' | 'pathData'>): boolean {
  if ((node.kind !== 'path' && node.kind !== 'boolean') || !node.pathData) return true
  const prior = closedPaths.get(node.pathData)
  if (prior !== undefined) return prior
  let closed = true
  for (const item of node.pathData.paths) {
    const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(item.d)
    if (parsed.err) { closed = false; break }
    const commands: string[] = []
    parsed.iterate((segment) => { commands.push(segment[0].toUpperCase()) })
    let started = false, open = false
    for (const command of commands) {
      if (command === 'M') { if (started && open) closed = false; started = true; open = true }
      else if (command === 'Z') open = false
      else open = true
    }
    if (open || !started) closed = false
  }
  closedPaths.set(node.pathData, closed)
  return closed
}
/** Gate advanced vector controls to shapes whose renderer applies them.
 * @param node - Effective source kind; browser glyph outlines do not expose these SVG controls.
 * @returns Whether cap/join/miter/dash geometry is rendered.
 */
export function designStrokeSupportsAdvanced(node: Pick<CopyOSDesignNode, 'kind'>): boolean {
  return !['text', 'group'].includes(node.kind)
}
/** Read explicit custom pairs or the previous scalar dash/gap fallback.
 * @param node - Authored/effective node, with linked ownership already applied.
 * @returns Independent alternating dash/gap values; empty means solid.
 */
export function designStrokeDashes(node: Pick<CopyOSDesignNode, 'strokeDashes' | 'strokeDash'>): number[] {
  return node.strokeDashes ? [...node.strokeDashes] : node.strokeDash ? [node.strokeDash, node.strokeDash] : []
}
/** Read effective geometry and explicit renderer support for inspector and agent metadata.
 * @param node - Effective source geometry.
 * @returns SVG defaults plus physical dash pairs and phase; unsupported text metadata remains authored but dormant.
 */
export function designStrokeStyle(node: CopyOSDesignNode): {
  supported: boolean
  alignmentSupported: boolean
  cap: 'butt' | 'round' | 'square'
  join: 'miter' | 'round' | 'bevel'
  miterLimit: number
  dashes: number[]
  dashOffset: number
} {
  return { supported: designStrokeSupportsAdvanced(node), alignmentSupported: designStrokeAlignmentSupported(node),
    cap: node.strokeCap ?? 'butt', join: node.strokeJoin ?? 'miter', miterLimit: node.strokeMiterLimit ?? 4,
    dashes: designStrokeDashes(node), dashOffset: node.strokeDashOffset ?? 0 }
}
/** Read actual stroke placement while retaining incompatible authored alignment for a later closed path.
 * @param node - Effective source geometry and saved placement.
 * @returns Center for any open subpath, otherwise the saved/default alignment.
 */
export function designStrokeAlignment(node: CopyOSDesignNode): 'inside' | 'center' | 'outside' {
  return designStrokeAlignmentSupported(node) ? node.strokeAlign ?? 'center' : 'center'
}
/** Determine whether endpoint/segment geometry includes a vertex that can display a join.
 * @param node - Effective vector source; a single open segment has caps but no joins.
 * @returns Whether join controls can affect a connection; ellipse and glyph geometry are excluded.
 */
export function designStrokeHasJoins(node: Pick<CopyOSDesignNode, 'kind' | 'pathData'>): boolean {
  if ((node.kind !== 'path' && node.kind !== 'boolean')) return !['ellipse', 'text', 'group'].includes(node.kind)
  if (!node.pathData) return false
  for (const item of node.pathData.paths) {
    const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(item.d)
    if (parsed.err) continue
    const commands: string[] = []
    parsed.iterate((segment) => { commands.push(segment[0].toUpperCase()) })
    let segments = 0
    for (const command of commands) {
      if (command === 'M') segments = 0
      else if (command === 'Z') { if (segments) return true }
      else { segments++; if (segments > 1) return true }
    }
  }
  return false
}
