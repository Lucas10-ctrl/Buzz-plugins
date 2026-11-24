/**
 * Approximations of Figma's image adjustments (`ImagePaint.filters`), shared by the browser SVG filter and the host raster, which
 * bakes the same arithmetic into the picture bytes. Every stage works on sRGB values from 0 to 1, in this order:
 * 1. exposure and contrast as one linear stretch: gain 2^exposure, then (v − ½)·(1 + contrast) + ½;
 * 2. temperature/tint as channel gains (warm raises red and lowers blue; positive tint lowers green towards magenta), then
 *    saturation as a luminance-preserving matrix with factor 1 + saturation (−1 is greyscale);
 * 3. shadows/highlights as a tone curve that lifts or lowers the darker or lighter tones.
 * Values are clamped between stages, as SVG filter primitives do.
 */
import type { CopyOSDesignImageFilters } from './types.ts'

const KEYS = ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'] as const
const TEMPERATURE_GAIN = 0.2, TINT_GAIN = 0.2, TONE_AMOUNT = 0.25
const LUMA = [0.2126, 0.7152, 0.0722] as const
const clamp = (value: number): number => Math.min(1, Math.max(0, value))

/** Report whether any adjustment differs from neutral.
 * @param filters - Optional image adjustments.
 * @returns True when at least one value is non-zero.
 */
export function designImageFiltersActive(filters: CopyOSDesignImageFilters | undefined): filters is CopyOSDesignImageFilters {
  return !!filters && KEYS.some(key => (filters[key] ?? 0) !== 0)
}

function stages(filters: CopyOSDesignImageFilters): {
  slope: number; intercept: number; matrix: number[]; curve: ((value: number) => number) | undefined
} {
  const exposure = filters.exposure ?? 0, contrast = filters.contrast ?? 0, saturation = 1 + (filters.saturation ?? 0)
  const temperature = filters.temperature ?? 0, tint = filters.tint ?? 0
  const highlights = filters.highlights ?? 0, shadows = filters.shadows ?? 0
  const gain = 2 ** exposure
  const gains = [1 + TEMPERATURE_GAIN * temperature + TINT_GAIN * tint / 2, 1 - TINT_GAIN * tint,
    1 - TEMPERATURE_GAIN * temperature + TINT_GAIN * tint / 2]
  // Row-major 3×3: saturation (about Rec. 709 luminance) applied after the per-channel gains.
  const matrix: number[] = []
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      matrix.push(((1 - saturation) * (LUMA[column] ?? 0) + (row === column ? saturation : 0)) * (gains[column] ?? 1))
  const curve = highlights || shadows ? (value: number): number => {
    const dark = 6.75 * value * (1 - value) ** 2, light = 6.75 * value ** 2 * (1 - value)
    return clamp(value + TONE_AMOUNT * (shadows * dark + highlights * light))
  } : undefined
  return { slope: gain * (1 + contrast), intercept: -0.5 * contrast, matrix, curve }
}

/** Build SVG filter primitives approximating the adjustments, for the browser and any renderer that draws the raw picture.
 * @param filters - Active image adjustments.
 * @returns Filter children using sRGB interpolation (the caller sets `color-interpolation-filters="sRGB"`).
 */
export function designImageFilterPrimitives(filters: CopyOSDesignImageFilters): string {
  const { slope, intercept, matrix, curve } = stages(filters)
  const n = (value: number): string => String(Math.round(value * 1e6) / 1e6)
  const linear = `type="linear" slope="${n(slope)}" intercept="${n(intercept)}"`
  let markup = `<feComponentTransfer><feFuncR ${linear}/><feFuncG ${linear}/><feFuncB ${linear}/></feComponentTransfer>` +
    `<feColorMatrix type="matrix" values="${[0, 1, 2].map(row => `${matrix.slice(row * 3, row * 3 + 3).map(n).join(' ')} 0 0`).join(' ')} 0 0 0 1 0"/>`
  if (curve) {
    const table = Array.from({ length: 33 }, (_, index) => n(curve(index / 32))).join(' ')
    markup += `<feComponentTransfer><feFuncR type="table" tableValues="${table}"/><feFuncG type="table" tableValues="${table}"/>` +
      `<feFuncB type="table" tableValues="${table}"/></feComponentTransfer>`
  }
  return markup
}

/** Apply the adjustments to unpremultiplied 8-bit RGBA pixels in place (alpha unchanged).
 * @param pixels - Interleaved RGBA bytes.
 * @param filters - Active image adjustments.
 */
export function designImageFilterPixels(pixels: Uint8Array, filters: CopyOSDesignImageFilters): void {
  const { slope, intercept, matrix, curve } = stages(filters)
  const [m0 = 1, m1 = 0, m2 = 0, m3 = 0, m4 = 1, m5 = 0, m6 = 0, m7 = 0, m8 = 1] = matrix
  const linear = new Float32Array(256), tone = new Uint8Array(1024)
  for (let value = 0; value < 256; value++) linear[value] = clamp(slope * value / 255 + intercept)
  for (let index = 0; index < 1024; index++) {
    const value = index / 1023
    tone[index] = Math.round((curve ? curve(value) : value) * 255)
  }
  const out = (value: number): number => tone[Math.round(clamp(value) * 1023)] ?? 0
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const r = linear[pixels[offset] ?? 0] ?? 0, g = linear[pixels[offset + 1] ?? 0] ?? 0, b = linear[pixels[offset + 2] ?? 0] ?? 0
    pixels[offset] = out(m0 * r + m1 * g + m2 * b)
    pixels[offset + 1] = out(m3 * r + m4 * g + m5 * b)
    pixels[offset + 2] = out(m6 * r + m7 * g + m8 * b)
  }
}
