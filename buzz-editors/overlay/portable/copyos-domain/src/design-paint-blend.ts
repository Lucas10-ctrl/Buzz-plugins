/** Paint blending uses CSS compositing modes without approximating unsupported Figma operators. */
import { z } from 'zod'
/** Closed native paint modes; omission is normal and pass-through remains a layer-only concept. */
export const DESIGN_PAINT_BLEND_MODES = ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge',
  'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter'] as const
/** Strict shared validator for authored paint metadata and incremental paint updates. */
export const designPaintBlendModeSchema = z.enum(DESIGN_PAINT_BLEND_MODES)

/** Layer modes add pass-through without widening paint operators. */
export const DESIGN_LAYER_BLEND_MODES = ['pass-through', ...DESIGN_PAINT_BLEND_MODES] as const
/** Shared validator for explicit layer ownership, including contextual instance records. */
export const designLayerBlendModeSchema = z.enum(DESIGN_LAYER_BLEND_MODES)
