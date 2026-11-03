/** Canonical variable-font axis lists shared by authoring, shaping and CSS renderers. */
import { z } from 'zod'
import type { CopyOSDesignFontVariation } from './types.ts'

/** Bounded unique tags; sorting preserves omitted versus explicitly empty list ownership. */
export const designFontVariationsSchema = z.array(z.object({ tag: z.string().regex(/^[A-Za-z0-9]{4}$/),
  value: z.number().min(-1000000).max(1000000) }).strict()).max(64)
  .refine(variations => new Set(variations.map(variation => variation.tag)).size === variations.length, 'Duplicate variable-font axis tag')
  .transform(variations => variations.sort((left, right) => left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0))

/** Validate and independently copy an authored variation list in stable tag order.
 * @param variations - At most 64 unique four-character tags with finite coordinates from -1000000 through 1000000.
 * @returns Canonical variation list; invalid values throw before authoring.
 */
export function normalizeDesignFontVariations(variations: readonly CopyOSDesignFontVariation[]): CopyOSDesignFontVariation[] {
  return designFontVariationsSchema.parse(variations)
}

/** Format effective variable-font axes for CSS and SVG foreign-object text.
 * @param variations - Effective variations; omission and empty lists use the font defaults.
 * @returns Safe CSS font-variation-settings value in canonical tag order.
 */
export function designFontVariationSettings(variations: readonly CopyOSDesignFontVariation[] = []): string {
  return normalizeDesignFontVariations(variations).map(variation => `"${variation.tag}" ${variation.value}`).join(', ') || 'normal'
}
