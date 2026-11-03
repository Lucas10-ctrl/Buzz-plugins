/** Host paragraph measurements share native cache shapes without importing a rendering engine. */
import type { DesignSvgTextLine } from './design-svg-text.ts'
import type { CopyOSDesignNode, CopyOSDesignTextLayoutMetrics, CopyOSDesignTextMeasurementEngine } from './types.ts'

/** One explicitly supplied font face; bytes remain caller-owned and are copied during initialization. */
export interface DesignMeasurementFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  data: Uint8Array
}

/** Actual paragraph results or an explicit reason why no metrics may be stored. */
export type DesignTextMeasurementResult = {
  state: 'measured'
  layout: CopyOSDesignTextLayoutMetrics
  baseline: { signature: string; baseline: number; engine: CopyOSDesignTextMeasurementEngine }
} | {
  state: 'unavailable'
  code: 'missing-family' | 'missing-style' | 'missing-glyph' | 'unsupported-style' | 'budget'
  family?: string
  codepoints?: number[]
}

/** A request-scoped font provider over a lazily shared, host-only WASM engine. */
export interface DesignTextMeasurer {
  readonly engine: CopyOSDesignTextMeasurementEngine
  measure(node: CopyOSDesignNode): DesignTextMeasurementResult
  /**
   * Lay out a text layer and return its visible lines in layer coordinates, as the SVG text export expects.
   * @param node - Effective text layer.
   * Characters the fonts lack do not prevent layout here, unlike `measure`.
   * @returns Lines with source ranges, left edges and baselines (an ending ellipsis marks truncation), or undefined when unmeasurable.
   */
  lines(node: CopyOSDesignNode): DesignSvgTextLine[] | undefined
  /**
   * Draw a text layer as the paragraph engine lays it out, for renderers that lack the fonts.
   * @param node - Effective text layer.
   * @param paint - Base text color (CSS color) and opacity; run fills keep their own colors.
   * @param scale - Output pixels per layer CSS pixel, 0–4.
   * @returns A transparent PNG covering the layer box and any overflow, its size in layer CSS pixels and the code points the fonts
   * lack (drawn as the font's missing-glyph shape), or undefined when unmeasurable.
   */
  paint(node: CopyOSDesignNode, paint: { color: string; opacity: number }, scale: number):
  { png: Uint8Array; width: number; height: number; missingCodepoints: number[] } | undefined
  dispose(): void
}

/** Explicit finite work limits; omitted values use the native text/line schema limits. */
export interface DesignTextMeasurerOptions {
  fonts: readonly DesignMeasurementFont[]
  maxTextLength?: number
  maxLines?: number
}
