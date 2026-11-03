/** Canonical OpenType feature lists shared by authoring, shaping and CSS renderers. */
import { z } from 'zod'
import type { CopyOSDesignFontFeature } from './types.ts'

/** Bounded unique tags; sorting preserves omitted versus explicitly empty list ownership. */
export const designFontFeaturesSchema = z.array(z.object({ tag: z.string().regex(/^[A-Za-z0-9]{4}$/),
  value: z.number().int().min(0).max(65535) }).strict()).max(64)
  .refine(features => new Set(features.map(feature => feature.tag)).size === features.length, 'Duplicate OpenType feature tag')
  .transform(features => features.sort((left, right) => left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0))

/** Validate and independently copy an authored feature list in stable tag order.
 * @param features - At most 64 unique four-character tags with unsigned 16-bit values.
 * @returns Canonical feature list; invalid values throw before authoring.
 */
export function normalizeDesignFontFeatures(features: readonly CopyOSDesignFontFeature[]): CopyOSDesignFontFeature[] {
  return designFontFeaturesSchema.parse(features)
}

/** Format effective OpenType features for CSS and SVG foreign-object text.
 * @param features - Effective features; omission and empty lists use the font defaults.
 * @returns Safe CSS font-feature-settings value in canonical tag order.
 */
export function designFontFeatureSettings(features: readonly CopyOSDesignFontFeature[] = []): string {
  return normalizeDesignFontFeatures(features).map(feature => `"${feature.tag}" ${feature.value}`).join(', ') || 'normal'
}
