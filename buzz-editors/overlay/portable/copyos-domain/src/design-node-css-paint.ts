/** Axis-aligned gradient CSS retains stop token references without baking transformed graphics. */
import type { CopyOSDesignPaint } from './types.ts'
/** Serialize gradients whose normalized axes map directly to CSS axes.
 * @param paint - Authored paint, including its composite opacity.
 * @param color - Color serializer retaining token identity and opacity.
 * @returns A live CSS gradient, or undefined when rotation/skew requires SVG geometry.
 */
export function nodeCssGradient(paint: CopyOSDesignPaint,
  color: (literal: string, id: string | null | undefined, opacity: number) => string): string | undefined {
  const gradient = paint.gradient
  if (!gradient) return
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = gradient.transform
  if (Math.abs(a * d - b * c) < 1e-12) return
  const format = (value: number) => String(Number((value * 100).toFixed(6))) + '%'
  let prefix: string, position: (value: number) => number
  if (gradient.type === 'linear') {
    if (Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && a !== 0) {
      prefix = a > 0 ? '90deg' : '270deg'; position = value => a > 0 ? e + a * value : 1 - e - a * value
    } else if (Math.abs(a) < 1e-9 && Math.abs(d) < 1e-9 && b !== 0) {
      prefix = b > 0 ? '180deg' : '0deg'; position = value => b > 0 ? f + b * value : 1 - f - b * value
    } else return
  } else {
    if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || a === 0 || d === 0) return
    prefix = `ellipse ${format(Math.abs(a) / 2)} ${format(Math.abs(d) / 2)} at ${format(a / 2 + e)} ${format(d / 2 + f)}`
    position = value => value
  }
  const stops = [...gradient.stops].sort((x, y) => x.position - y.position).map(stop =>
    `${color(stop.color, stop.variableId, stop.opacity * paint.opacity)} ${format(position(stop.position))}`)
  return `${gradient.type === 'linear' ? 'linear' : 'radial'}-gradient(${prefix}, ${stops.join(', ')})`
}
