/** Shared localized names for the exact supported native paint modes. */
import type { CopyOSDesignPaintBlendMode } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
/** Locale keys shared by layer and paint controls; pass-through is a layer-only choice. */
export const designerBlendLabels: Record<CopyOSDesignPaintBlendMode, CopyOSFoundationLocaleKey> = {
  normal: 'designerBlendNormal',
  darken: 'designerBlendDarken',
  multiply: 'designerBlendMultiply',
  'color-burn': 'designerBlendColorBurn',
  lighten: 'designerBlendLighten',
  screen: 'designerBlendScreen',
  'color-dodge': 'designerBlendColorDodge',
  overlay: 'designerBlendOverlay',
  'soft-light': 'designerBlendSoftLight',
  'hard-light': 'designerBlendHardLight',
  difference: 'designerBlendDifference',
  exclusion: 'designerBlendExclusion',
  hue: 'designerBlendHue',
  saturation: 'designerBlendSaturation',
  color: 'designerBlendColor',
  luminosity: 'designerBlendLuminosity',
  'plus-lighter': 'designerBlendPlusLighter',
}
