/** Model-free validation for ordered durable effect stacks. */
import { z } from 'zod'
/** Strict durable drop-shadow fields shared by full documents and incremental effects edits. */
export const designDropShadowSchema = z.object({
  id: z.uuid(), type: z.literal('drop-shadow'), visible: z.boolean(),
  x: z.number().min(-1000000).max(1000000), y: z.number().min(-1000000).max(1000000),
  blur: z.number().min(0).max(10000), spread: z.number().min(-10000).max(10000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/), opacity: z.number().min(0).max(1),
  colorAlpha: z.number().min(0).max(1).optional(), colorVariableId: z.uuid().optional(),
  numericBindings: z.object({ x: z.uuid().optional(), y: z.uuid().optional(), blur: z.uuid().optional(),
    spread: z.uuid().optional(), opacity: z.uuid().optional() }).strict().optional(),
}).strict()
/** Strict inner-shadow fields retain the drop-shadow numeric and color domains. */
export const designInnerShadowSchema = designDropShadowSchema.extend({ type: z.literal('inner-shadow') })
/** Discriminated durable shadow types; unsupported effects remain rejected. */
export const designShadowSchema = z.discriminatedUnion('type', [designDropShadowSchema, designInnerShadowSchema])
/** Strict uniform layer blur; progressive and backdrop parameters remain unsupported. */
export const designLayerBlurSchema = z.object({
  id: z.uuid(), type: z.literal('layer-blur'), visible: z.boolean(), radius: z.number().min(0).max(10000),
  numericBindings: z.object({ radius: z.uuid().optional() }).strict().optional(),
}).strict()
/** Discriminated supported native effects retain strict shadow and layer-blur shapes. */
export const designEffectSchema = z.discriminatedUnion('type', [designDropShadowSchema, designInnerShadowSchema, designLayerBlurSchema])
/** At most seventeen effects, including eight shadows of each type and one layer blur, with unique stack identities. */
export const designEffectsSchema = z.array(designEffectSchema).max(17)
  .refine(effects => effects.filter(effect => effect.type === 'drop-shadow').length <= 8 &&
    effects.filter(effect => effect.type === 'inner-shadow').length <= 8, 'Effect stacks support at most eight shadows of each type')
  .refine(effects => effects.filter(effect => effect.type === 'layer-blur').length <= 1, 'Effect stacks support at most one layer blur')
  .refine(effects => new Set(effects.map(effect => effect.id)).size === effects.length, 'Duplicate effect identity within a stack')

/** Reusable complete authored effects with local metadata; effects retain stack-scoped identities. */
export const designEffectStyleSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(), effects: designEffectsSchema,
}).strict()
