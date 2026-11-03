import { designPageLinksValid } from './design-page-links.ts'
import { designBooleansDocumentValid } from './design-boolean-validation.ts'
import { designBooleanNodeEligibility } from './design-boolean-geometry.ts'
import { designFontFeaturesSchema } from './design-font-features.ts'
import { designFontVariationsSchema } from './design-font-variations.ts'
import { designTextHyperlinkSchema, designTextHyperlinksValid } from './design-text-hyperlink.ts'
import { designSemanticsIssues, designSemanticsSchema } from './design-semantics.ts'
import { designEffectBindingsValid, designEffectColorBindingsValid, designEffectResourceOwners } from './design-effect-values.ts'
import { designEffectsSchema, designEffectStyleSchema } from './design-effects-schema.ts'
import { designTextBoundary } from './design-text-runs.ts'
import { designTextMeasurementCacheCharacters } from './design-text-measurement-cache.ts'
import { designStrokeCapSchema, designStrokeJoinSchema, designStrokeMiterLimitSchema, designStrokeDashesSchema, designStrokeDashOffsetSchema } from './design-stroke-style.ts'
import { designLayerBlendModeSchema } from './design-paint-blend.ts'
import { designPaintBlendModeSchema } from './design-paint-blend.ts'
import { designNumberExpressionValid, designNumberExpressionReferences } from './design-number-expression.ts'
import { designAuthoredGridTracks } from './design-instance-grid.ts'
import { DESIGN_STROKE_NUMBER_KEYS, designStrokeSupportsEdges } from './design-stroke.ts'
/** Browser-safe authoritative native design validation shared by storage and atomic clipboard imports. */
import { z } from 'zod'
import { designVariantIssues } from './design-variant-validation.ts'
import { DESIGN_NODE_NAME_MAX_LENGTH } from './design-variant-names.ts'
import { designComponentOverrideTarget, designComponentPropertyContextPath } from './design-component-properties.ts'
import { designComponentPropertyIssues } from './design-component-property-validation.ts'
import { designNodeSizingLimitsValid } from './design-size-validation.ts'
import { designGridBudgetIssue } from './design-grid.ts'
import { designCanvasBackgroundsValid } from './design-canvas-background.ts'
import { DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS } from './design-instance-layout.ts'
import { DESIGN_INSTANCE_SIZING_KEYS } from './design-instance-sizing.ts'
import { DESIGN_IMAGE_LIMITS } from './design-image.ts'
import { captureDesignConstraintReferences } from './design-model.ts'
import { resolveDesignColorVariables, resolveDesignNumberVariables } from './design-token-values.ts'
import { designModeResources } from './design-token-modes.ts'
import { isDesignImageAssetReference } from './design-image-assets.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

const numberExpressionSchema=z.unknown().superRefine((value,ctx)=>{
  if (!designNumberExpressionValid(value) || designNumberExpressionReferences(value).some(id=>!z.uuid().safeParse(id).success))
    ctx.addIssue({ code:'custom',message:'Invalid or oversized numeric expression' })
}).transform(value=>value as import('./types.ts').CopyOSDesignNumberExpression)
const coordinate = z.number().min(-1_000_000).max(1_000_000)
const size = z.number().min(1).max(100_000)
const minimumSize = z.number().min(0).max(100_000)
const textMeasurementEngineSchema = z.object({
  name: z.literal('skparagraph'), version: z.string().min(1).max(40), layoutVersion: z.number().int().min(1).max(1000000).optional(),
  fonts: z.array(z.object({ family: z.string().min(1).max(200), weight: z.number().int().min(1).max(1000),
    style: z.enum(['normal', 'italic']), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(32),
}).strict()
const textBaselineMetricsSchema = z.array(z.object({
  signature: z.string().max(80), baseline: z.number().min(-1000000).max(1000000),
  engine: textMeasurementEngineSchema.optional(),
}).strict()).max(32)
const textLayoutMetricsSchema = z.object({
  signature: z.string().max(80), width: size, height: size, engine: textMeasurementEngineSchema.optional(),
  overflow: z.object({ signature: z.string().max(80), lines: z.number().int().min(1).max(200000), height: size }).strict().optional(),
}).strict()
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/)
const textRunsSchema = z.array(z.object({
  start: z.number().int().min(0).max(100000), end: z.number().int().min(1).max(100000),
  style: z.object({ hyperlink: designTextHyperlinkSchema.optional(),
    fontFamily: z.string().min(1).max(200).optional(), fontSize: z.number().min(1).max(1000).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(), fontFeatures: designFontFeaturesSchema.optional(),
    fontVariations: designFontVariationsSchema.optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    lineHeight: z.number().min(0.5).max(10).optional(), letterSpacing: z.number().min(-1000).max(1000).optional(),
    textDecoration: z.enum(['none', 'underline', 'line-through']).optional(), fill: color.optional(),
  }).strict().refine(value => Object.values(value).some(field => field !== undefined), 'Text run styles require a field'),
}).strict()).max(1000).refine(runs => runs.every((run, index) => run.start < run.end &&
  (index === 0 || (runs[index - 1]?.end ?? 0) <= run.start)), 'Text runs require sorted nonoverlapping ranges')
const canvasBackgroundSchema = z.object({
  color, opacity: z.number().min(0).max(1), visible: z.boolean(), variableId: z.uuid().nullable().optional(),
}).strict()
const imageUrlSchema = z
  .string()
  .max(8_000_000)
  .refine(
    value =>
      value === '' ||
      /^https:\/\//.test(value) ||
      isDesignImageAssetReference(value) ||
      /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value),
    'Use an HTTPS image, a project image reference or a raster image data URL',
  )
const gradientSchema = z
  .object({
    type: z.enum(['linear', 'radial']),
    stops: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            position: z.number().min(0).max(1),
            color,
            opacity: z.number().min(0).max(1),
            variableId: z.uuid().nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    transform: z.array(z.number()).length(6),
  })
  .strict()
const imageGeometrySchema = z
  .object({
    sourceWidth: size.optional(),
    sourceHeight: size.optional(),
    zoom: z
      .number()
      .min(DESIGN_IMAGE_LIMITS.minZoom)
      .max(DESIGN_IMAGE_LIMITS.maxZoom)
      .optional(),
    offsetX: z
      .number()
      .min(-DESIGN_IMAGE_LIMITS.maxOffset)
      .max(DESIGN_IMAGE_LIMITS.maxOffset)
      .optional(),
    offsetY: z
      .number()
      .min(-DESIGN_IMAGE_LIMITS.maxOffset)
      .max(DESIGN_IMAGE_LIMITS.maxOffset)
      .optional(),
    rotation: z.number().min(-36000).max(36000).optional(),
    tileScale: z.number().min(0.01).max(100).optional(),
  })
  .strict()
const textStyleSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    fontFamily: z.string().min(1).max(200),
    fontSize: z.number().min(1).max(1000),
    fontWeight: z.number().int().min(100).max(900),
    lineHeight: z.number().min(0.5).max(10),
    letterSpacing: z.number().min(-1000).max(1000),
    fontFeatures: designFontFeaturesSchema.optional(), fontVariations: designFontVariationsSchema.optional(),
    fontStyle: z.enum(['normal', 'italic']),
  })
  .strict()
const alphaSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal') }).strict(),
  z.object({ kind: z.literal('number'), variableId: z.uuid() }).strict(),
]).nullable().optional()
const colorModeValueSchema = z
  .object({
    id: z.uuid(),
    value: color.optional(),
    alpha: z.number().min(0).max(1).optional(),
    alphaSource: alphaSourceSchema,
    aliasId: z.uuid().nullable().optional(),
  })
  .strict()
const numberModeValueSchema = z
  .object({
    expression:numberExpressionSchema.nullable().optional(),
    id: z.uuid(),
    value: coordinate.optional(),
    aliasId: z.uuid().nullable().optional(),
  })
  .strict()
const tokenModeSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    sourceKey: z.string().max(20000).optional(),
    variables: z.array(colorModeValueSchema).max(500).default([]),
    numberVariables: z.array(numberModeValueSchema).max(500).default([]),
  })
  .strict()
const inheritedModeSchema = z.union([z.uuid(), z.literal('base')]).nullable()
const gridTrackSchema = z
  .object({
    sizing: z.enum(['fixed', 'hug', 'fill']),
    value: z.number().min(0).max(100000),
    variableId: z.uuid().nullable().optional(),
  })
  .strict()
  .superRefine((track, ctx) => {
    if (
      (track.sizing === 'fixed' && track.value < 1) ||
      (track.sizing === 'fill' && (track.value < 0.01 || track.value > 1000)) ||
      (track.sizing === 'hug' && track.variableId)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid grid track size or binding',
      })
  })
const gridSchema = z
  .object({
    columns: z.array(gridTrackSchema).min(1).max(64),
    rows: z.array(gridTrackSchema).max(4096),
    autoRows: z.boolean(),
    autoPosition: z.boolean(),
    implicitRow: gridTrackSchema,
  })
  .strict()
const gridCellSchema = z
  .object({
    column: z.number().int().min(1).max(64).optional(),
    row: z.number().int().min(1).max(4096).optional(),
    columnSpan: z.number().int().min(1).max(64).optional(),
    rowSpan: z.number().int().min(1).max(64).optional(),
    horizontalAlign: z.enum(['start', 'center', 'end']).optional(),
    verticalAlign: z.enum(['start', 'center', 'end']).optional(),
  })
  .strict()
const componentPropertySchema = z.discriminatedUnion('type', [
  z.object({
    id: z.uuid(), name: z.string().trim().min(1).max(120), type: z.literal('text'),
    defaultValue: z.string().max(100000), targets: z.array(z.array(z.uuid()).min(1).max(64)).max(100).default([]),
  }).strict(),
  z.object({
    id: z.uuid(), name: z.string().trim().min(1).max(120), type: z.literal('boolean'),
    defaultValue: z.boolean(), targets: z.array(z.array(z.uuid()).min(1).max(64)).max(100).default([]),
  }).strict(),
  z.object({
    id: z.uuid(), name: z.string().trim().min(1).max(120), type: z.literal('instance-swap'),
    defaultValue: z.uuid(), targets: z.array(z.array(z.uuid()).min(1).max(64)).max(100).default([]),
    preferredValues: z.array(z.uuid()).max(100).refine(values => new Set(values).size === values.length,
      'Duplicate preferred components').optional(),
  }).strict(),
])
const variantAxisSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120),
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
}).strict()
const variantValueSchema = z.object({
  axisId: z.uuid(), value: z.string().trim().min(1).max(120),
}).strict()
const paintSchema = z
  .object({
    blendMode: designPaintBlendModeSchema.optional(),
    id: z.uuid(),
    color,
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    variableId: z.uuid().nullable(),
    gradient: gradientSchema.optional(),
    image: z
      .object({
        url: imageUrlSchema.refine(
          value => value.length > 0,
          'Choose an image',
        ),
        scaleMode: z.enum(['fill', 'fit', 'stretch', 'crop', 'tile']),
        ...imageGeometrySchema.shape,
      })
      .strict()
      .refine(
        image =>
          (image.sourceWidth === undefined) ===
                  (image.sourceHeight === undefined),
        'Image source dimensions must be supplied together',
      )
      .refine(
        image =>
          !(
            image.scaleMode === 'crop' ||
                    image.scaleMode === 'tile' ||
                    (image.rotation ?? 0) !== 0 ||
                    (image.zoom ?? 1) !== 1 ||
                    (image.offsetX ?? 0) !== 0 ||
                    (image.offsetY ?? 0) !== 0
          ) ||
                  (image.sourceWidth !== undefined &&
                    image.sourceHeight !== undefined),
        'Crop, tile and image transforms require source dimensions',
      )
      .optional(),
  })
  .strict()
  .refine(
    paint => !(paint.image && paint.gradient),
    'A paint cannot be both an image and a gradient',
  )
const instanceLayoutSchema = z.object({
  layout: z.enum(['row', 'column']).optional(),
  gap: z.number().min(-10000).max(10000).optional(),
  crossGap: z.number().min(0).max(10000).optional(),
  padding: z.number().min(0).max(10000).optional(),
  paddingTop: z.number().min(0).max(10000).optional(),
  paddingRight: z.number().min(0).max(10000).optional(),
  paddingBottom: z.number().min(0).max(10000).optional(),
  paddingLeft: z.number().min(0).max(10000).optional(),
  alignItems: z.enum(['start', 'center', 'end', 'baseline']).optional(),
  justifyContent: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']).optional(),
  layoutWrap: z.enum(['none', 'wrap']).optional(),
  alignContent: z.enum(['start', 'center', 'end', 'between', 'stretch']).optional(),
}).strict().refine(value => Object.values(value).some(item => item !== undefined),
  'An instance layout override requires a setting')
const layoutBindingsSchema = z.object(Object.fromEntries(
  DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.map(key => [key, z.uuid().optional()]),
)).strict().refine(value => Object.values(value).some(id => id !== undefined), 'Layout bindings require a reference')
const nodeSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    pageId: z.uuid().optional(),
    pageLink: z.object({ pageId: z.uuid(), autoHeight: z.boolean().optional() }).strict().optional(),
    semantics: designSemanticsSchema.optional(),
    breakpoint: z.object({ sourceFrameId: z.uuid(), maxWidth: z.number().int().min(200).max(4000) }).strict().optional(),
    breakpointSourceId: z.uuid().optional(),
    tokenModeId: inheritedModeSchema.optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    strokeOpacity: z.number().min(0).max(1).optional(),
    strokeVariableId: z.uuid().nullable().optional(),
    numericBindings: z
      .object(
        Object.fromEntries(
          [
            ...DESIGN_STROKE_NUMBER_KEYS,
            'width',
            'height',
            'minWidth',
            'maxWidth',
            'minHeight',
            'maxHeight',
            'gap',
            'padding',
            'paddingTop',
            'paddingRight',
            'paddingBottom',
            'paddingLeft',
            'radius',
            'radiusTopLeft',
            'radiusTopRight',
            'radiusBottomRight',
            'radiusBottomLeft',
            'crossGap',
            'fontSize',
            'fontWeight',
            'lineHeight',
            'letterSpacing',
            'paragraphSpacing',
          ].map(key => [key, z.uuid().optional()]),
        ),
      )
      .strict()
      .optional(),
    preserveLayout: z.boolean().optional(),
    textWrap: z.boolean().optional(),
    letterSpacing: z.number().min(-1000).max(1000).optional(),
    fontFeatures: designFontFeaturesSchema.optional(), fontVariations: designFontVariationsSchema.optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    booleanOperation: z.enum(['union', 'subtract', 'intersect', 'exclude']).optional(),
    pathData: z
      .object({
        width: size,
        height: size,
        paths: z
          .array(
            z
              .object({
                d: z
                  .string()
                  .max(2_000_000)
                  .regex(/^[MmLlCcQqZzHhVvAaSsTtEe0-9+.,\s-]*$/),
                fillRule: z.enum(['nonzero', 'evenodd']),
              })
              .strict(),
          )
          .max(5000),
      })
      .strict()
      .optional(),
    gradient: gradientSchema.optional(),
    effects: designEffectsSchema.optional(),
    effectStyleId: z.uuid().nullable().optional(),
    shadow: z
      .object({
        x: coordinate,
        y: coordinate,
        blur: z.number().min(0).max(10000),
        color,
        opacity: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    constraints: z
      .object({
        horizontal: z.enum(['left', 'right', 'left-right', 'center', 'scale']),
        vertical: z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale']),
        referenceWidth: size.optional(),
        referenceHeight: size.optional(),
      })
      .strict()
      .optional(),
    grid: gridSchema.optional(),
    instanceGrid: gridSchema.partial().nullable().optional(),
    gridCell: gridCellSchema.optional(),
    layoutWrap: z.enum(['none', 'wrap']).optional(),
    crossGap: z.number().min(0).max(10000).optional(),
    alignContent: z
      .enum(['start', 'center', 'end', 'between', 'stretch'])
      .optional(),
    radiusTopLeft: z.number().min(0).max(100000).optional(),
    radiusTopRight: z.number().min(0).max(100000).optional(),
    radiusBottomRight: z.number().min(0).max(100000).optional(),
    radiusBottomLeft: z.number().min(0).max(100000).optional(),
    targetAspectRatio: z.object({ x: z.number().positive().max(100000), y: z.number().positive().max(100000) }).strict()
      .refine(value => Number.isFinite(value.x / value.y) && value.x / value.y > 0, 'Invalid aspect ratio')
      .nullable().optional(),
    widthSizing: z.enum(['fixed', 'hug', 'fill']).optional(),
    heightSizing: z.enum(['fixed', 'hug', 'fill']).optional(),
    paddingTop: z.number().min(0).max(10000).optional(),
    paddingRight: z.number().min(0).max(10000).optional(),
    paddingBottom: z.number().min(0).max(10000).optional(),
    paddingLeft: z.number().min(0).max(10000).optional(),
    alignItems: z.enum(['start', 'center', 'end', 'baseline']).optional(),
    justifyContent: z
      .enum(['start', 'center', 'end', 'between', 'around', 'evenly'])
      .optional(),
    itemReverseZIndex: z.boolean().optional(),
    layoutSizingModel: z.enum(['legacy', 'css']).optional(),
    strokesIncludedInLayout: z.boolean().optional(),
    absolutePosition: z.boolean().optional(),
    minWidth: minimumSize.optional(),
    maxWidth: size.optional(),
    minHeight: minimumSize.optional(),
    maxHeight: size.optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    textStyleId: z.uuid().nullable().optional(),
    textDecoration: z.enum(['none', 'underline', 'line-through']).optional(),
    textCase: z
      .enum(['none', 'uppercase', 'lowercase', 'capitalize'])
      .optional(),
    textSizing: z.enum(['fixed', 'auto-width', 'auto-height']).optional(),
    textTruncation: z.enum(['disabled', 'ending']).optional(),
    maxLines: z.number().int().min(1).max(100000).nullable().optional(),
    textBaselineMetrics: textBaselineMetricsSchema.optional(),
    verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
    paragraphSpacing: z.number().min(0).max(10000).optional(),
    fills: z.array(paintSchema).max(100).optional(),
    strokes: z.array(paintSchema).max(100).optional(),
    strokeAlign: z.enum(['inside', 'center', 'outside']).optional(),
    strokeDash: z.number().min(0).max(1000).optional(),
    strokeCap: designStrokeCapSchema.optional(),
    strokeJoin: designStrokeJoinSchema.optional(),
    strokeMiterLimit: designStrokeMiterLimitSchema.optional(),
    strokeDashes: designStrokeDashesSchema.optional(),
    strokeDashOffset: designStrokeDashOffsetSchema.optional(),
    kind: z.enum([
      'frame',
      'group',
      'rectangle',
      'ellipse',
      'text',
      'image',
      'component',
      'component-set',
      'instance',
      'path',
      'boolean',
    ]),
    name: z.string().trim().min(1).max(DESIGN_NODE_NAME_MAX_LENGTH),
    x: coordinate,
    y: coordinate,
    width: size,
    height: size,
    rotation: coordinate,
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean(),
    fill: color,
    stroke: color,
    strokeWidth: z.number().min(0).max(1000),
    strokeTopWidth: z.number().min(0).max(1000).optional(),
    strokeRightWidth: z.number().min(0).max(1000).optional(),
    strokeBottomWidth: z.number().min(0).max(1000).optional(),
    strokeLeftWidth: z.number().min(0).max(1000).optional(),
    instanceStroke: z.object({
      strokes: z.array(paintSchema).max(100).optional(),
      stroke: color.optional(), strokeVariableId: z.uuid().nullable().optional(),
      strokeOpacity: z.number().min(0).max(1).optional(),
      strokeAlign: z.enum(['inside','center','outside']).optional(),
      strokeDash: z.number().min(0).max(1000).optional(),
      strokeCap: designStrokeCapSchema.optional(),
      strokeJoin: designStrokeJoinSchema.optional(),
      strokeMiterLimit: designStrokeMiterLimitSchema.optional(),
      strokeDashes: designStrokeDashesSchema.optional(),
      strokeDashOffset: designStrokeDashOffsetSchema.optional(),
      ...Object.fromEntries(DESIGN_STROKE_NUMBER_KEYS.map(key => [key,z.number().min(0).max(1000).optional()])),
    }).strict().nullable().optional(),
    radius: z.number().min(0).max(100_000),
    text: z.string().max(100_000),
    textRuns: textRunsSchema.optional(),
    fontFamily: z.string().min(1).max(200),
    fontSize: z.number().min(1).max(1000),
    fontWeight: z.number().int().min(100).max(900),
    lineHeight: z.number().min(0.5).max(10),
    textAlign: z.enum(['left', 'center', 'right']),
    imageUrl: imageUrlSchema,
    layout: z.enum(['none', 'row', 'column', 'grid']),
    gap: z.number().min(-10_000).max(10_000),
    padding: z.number().min(0).max(10_000),
    clip: z.boolean(),
    componentId: z.uuid().nullable(),
    componentProperties: z.array(componentPropertySchema).max(100).optional(),
    componentPropertyValues: z.array(z.object({
      propertyId: z.uuid(), value: z.union([z.string().max(100000), z.boolean()]),
    }).strict()).max(100).optional(),
    textLayoutMetrics: textLayoutMetricsSchema.optional(),
    instanceSizingOverrides: z.array(z.enum(DESIGN_INSTANCE_SIZING_KEYS)).max(8)
      .refine(keys => new Set(keys).size === keys.length, 'Duplicate instance sizing override').optional(),
    blendMode: designLayerBlendModeSchema.optional(),
    instanceLayout: instanceLayoutSchema.nullable().optional(),
    componentSet: z.object({ axes: z.array(variantAxisSchema).min(1).max(20) }).strict().optional(),
    variantValues: z.array(variantValueSchema).min(1).max(20).optional(),
    instanceOverrides: z.array(z.object({
      effects: designEffectsSchema.optional(),
      effectStyleId: z.uuid().nullable().optional(),
      blendMode: designLayerBlendModeSchema.optional(),      path: z.array(z.uuid()).min(1).max(64),
      text: z.string().max(100_000).optional(),
      textRuns: textRunsSchema.optional(),
      fontFeatures: designFontFeaturesSchema.optional(), fontVariations: designFontVariationsSchema.optional(),
      visible: z.boolean().optional(),
      componentId: z.uuid().optional(),
      textLayoutMetrics: textLayoutMetricsSchema.optional(),
      textBaselineMetrics: textBaselineMetricsSchema.optional(),
      layout: instanceLayoutSchema.optional(),
      layoutBindings: layoutBindingsSchema.optional(),
      grid: gridSchema.partial().refine(grid => Object.values(grid).some(value => value !== undefined),
        'A grid override requires a setting').optional(),
      gridCell: gridCellSchema.refine(value => Object.values(value).some(field => field !== undefined),
        'A cell override requires a setting').optional(),
    }).strict().refine(o => o.effectStyleId !== undefined || o.effects !== undefined || o.text !== undefined ||
      o.textRuns !== undefined || o.fontFeatures !== undefined || o.fontVariations !== undefined || o.visible !== undefined ||
      o.componentId !== undefined || o.textLayoutMetrics !== undefined || o.textBaselineMetrics !== undefined || o.gridCell !== undefined ||
      o.grid !== undefined || o.layout !== undefined || o.layoutBindings !== undefined || o.blendMode !== undefined,
    'An instance override requires text, visibility, component replacement, cell placement, grid configuration, layout settings, layer blending or measured text size')).max(1000).optional(),
    fillVariableId: z.uuid().nullable(),
  })
  .strict()
const designSchema = z
  .object({
    schema: z.literal('copyos.design'),
    version: z.literal(1),
    id: z.uuid(),
    title: z.string().trim().min(1).max(160),
    revision: z.number().int().nonnegative(),
    nodes: z.array(nodeSchema).max(25000),
    variables: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(120),
            value: color,
            alpha: z.number().min(0).max(1).optional(),
            alphaSource: alphaSourceSchema,
            aliasId: z.uuid().nullable().optional(),
          })
          .strict(),
      )
      .max(500),
    numberVariables: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(120),
            value: coordinate,
            unit: z.enum(['px', 'number']),
            expression:numberExpressionSchema.nullable().optional(),
            aliasId: z.uuid().nullable().optional(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    textStyles: z.array(textStyleSchema).max(1000).optional(),
    effectStyles: z.array(designEffectStyleSchema).max(1000).optional(),
    tokenModes: z.array(tokenModeSchema).max(32).optional(),
    activeTokenModeId: z.uuid().nullable().optional(),
    canvasBackground: canvasBackgroundSchema.optional(),
    pages: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1).max(200),
            tokenModeId: inheritedModeSchema.optional(),
            canvasBackground: canvasBackgroundSchema.optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    source: z
      .object({
        format: z.literal('fig'),
        fileName: z.string().max(255),
        warnings: z.array(z.string().max(500)).max(100),
        importedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const nodes = new Map(doc.nodes.map(n => [n.id, n]))
    const variables = new Set(doc.variables.map(v => v.id))
    if (!designCanvasBackgroundsValid(doc)) ctx.addIssue({ code: 'custom', message: 'Invalid canvas background color reference' })
    let resolvedNumbers = doc.numberVariables ?? []
    try {
      resolveDesignColorVariables(doc.variables, doc.numberVariables ?? [])
      resolvedNumbers = resolveDesignNumberVariables(doc.numberVariables ?? [])
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof Error ? error.message : 'Invalid token aliases',
      })
      return
    }
    const numbers = new Map(resolvedNumbers.map(v => [v.id, v]))
    const styles = new Set(doc.textStyles?.map(v => v.id))
    const effectStyles = new Set(doc.effectStyles?.map(value => value.id))
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', message })
    }
    if (!designPageLinksValid(doc)) issue('Linked page screens must be empty top-level frames')
    for (const message of designSemanticsIssues(doc, nodes)) issue(message)
    for (const node of doc.nodes) if (node.breakpoint) {
      const source = nodes.get(node.breakpoint.sourceFrameId)
      if (node.kind !== 'frame' || node.parentId !== null || node.pageLink) issue(`Breakpoints must be unlinked top-level frames: ${node.name}`)
      if (source && (source.id === node.id || source.kind !== 'frame' || source.parentId !== null || source.breakpoint))
        issue(`A breakpoint source must be another top-level artboard that is not itself a breakpoint: ${node.name}`)
    }
    if (!designEffectColorBindingsValid(designEffectResourceOwners(doc), variables)) issue('Missing effect color token')
    if (!designEffectBindingsValid(designEffectResourceOwners(doc), numbers)) issue('Missing or incompatible effect numeric token')
    if (effectStyles.size !== (doc.effectStyles?.length ?? 0)) issue('Duplicate effect style identities')
    for (const owner of doc.nodes.flatMap(node => [node, ...node.instanceOverrides ?? []])) {
      if (owner.effectStyleId && !effectStyles.has(owner.effectStyleId)) issue('Missing effect style')
      if (owner.effectStyleId && owner.effects !== undefined) issue('Effect style cannot coexist with local effects')
      if (owner.effectStyleId === null && owner.effects === undefined) issue('Detached effect style requires explicit effects')
    }
    if (!designBooleansDocumentValid(doc)) issue('Unsupported Boolean source geometry or operation')
    const validateSizeLimits = (node: CopyOSDesignNode, values: ReadonlyMap<string, number>, suffix = ''): void => {
      const source = node.kind === 'instance' ? nodes.get(node.componentId ?? '') : undefined
      if (!designNodeSizingLimitsValid(node, source, values))
        issue(`Invalid size limits for ${node.name}${suffix}`)
    }
    if (
      nodes.size !== doc.nodes.length ||
      variables.size !== doc.variables.length
    )
      issue('Duplicate identities')
    if (numbers.size !== (doc.numberVariables?.length ?? 0))
      issue('Duplicate numeric token identities')
    const pages = new Set(doc.pages?.map(p => p.id))
    if (doc.pages && pages.size !== doc.pages.length)
      issue('Duplicate page identities')
    if (doc.textStyles && styles.size !== doc.textStyles.length)
      issue('Duplicate text style identities')
    const modes = new Set(doc.tokenModes?.map(m => m.id))
    if (modes.size !== (doc.tokenModes?.length ?? 0))
      issue('Duplicate token mode identities')
    if (doc.activeTokenModeId && !modes.has(doc.activeTokenModeId))
      issue('Active token mode not found')
    for (const owner of [...doc.nodes, ...(doc.pages ?? [])])
      if (
        owner.tokenModeId &&
        owner.tokenModeId !== 'base' &&
        !modes.has(owner.tokenModeId)
      )
        issue('Inherited token mode not found')
    for (const mode of doc.tokenModes ?? []) {
      if (
        new Set(mode.variables.map(v => v.id)).size !==
          mode.variables.length ||
        new Set(mode.numberVariables.map(v => v.id)).size !==
          mode.numberVariables.length
      )
        issue('Duplicate mode resource overrides')
      try {
        const resources = designModeResources(doc, mode.id)
        resolveDesignColorVariables(resources.variables, resources.numberVariables)
        const values = new Map(
          resolveDesignNumberVariables(resources.numberVariables).map(v => [
            v.id,
            v,
          ]),
        )
        if (!designEffectBindingsValid(designEffectResourceOwners(doc), values)) issue(`Missing or incompatible effect numeric token in mode ${mode.name}`)
        for (const n of doc.nodes)
          for (const track of designAuthoredGridTracks(n)) {
            if (!track.variableId) continue
            const token = values.get(track.variableId)
            if (!token) issue('Missing grid track token')
            else if (
              token.unit !== (track.sizing === 'fill' ? 'number' : 'px') ||
              !gridTrackSchema.safeParse({ ...track, value: token.value })
                .success
            )
              issue('Invalid grid track token in mode')
          }
        for (const n of doc.nodes)
          for (const [key, id] of Object.entries(n.numericBindings ?? {})) {
            const token = id ? values.get(id) : undefined
            if (!token) issue(`Missing numeric token in mode ${mode.name}`)
            else if (
              token.unit !==
              (['fontWeight', 'lineHeight'].includes(key) ? 'number' : 'px')
            )
              issue(`Incompatible token unit in mode ${mode.name}`)
            else if (
              !nodeSchema.safeParse({ ...n, [key]: token.value }).success ||
              (n.layout === 'grid' && key === 'gap' && token.value < 0)
            )
              issue(`Invalid token value in mode ${mode.name}`)
          }
        for (const node of doc.nodes) for (const record of node.instanceOverrides ?? [])
          for (const [key, id] of Object.entries(record.layoutBindings ?? {})) {
            const token = id ? values.get(id) : undefined
            if (!token) issue(`Missing descendant layout token in mode ${mode.name}`)
            else if (token.unit !== 'px') issue(`Incompatible descendant layout token unit in mode ${mode.name}`)
            else if (token.value < (key === 'gap' ? -10000 : 0) || token.value > 10000)
              issue(`Invalid descendant layout token value in mode ${mode.name}`)
          }
        const numericValues = new Map([...values].map(([id, token]) => [id, token.value]))
        for (const node of doc.nodes) validateSizeLimits(node, numericValues, ` in mode ${mode.name}`)
      } catch (error) {
        issue(error instanceof Error ? error.message : 'Invalid token mode')
      }
    }
    const variantIssues = designVariantIssues(doc)
    for (const message of variantIssues) issue(message)
    if (variantIssues.length) return
    const propertyIssues = designComponentPropertyIssues(doc)
    for (const message of propertyIssues) issue(message)
    if (propertyIssues.length) return
    const children = new Map<string, string[]>()
    const baseNumbers = new Map([...numbers].map(([id, token]) => [id, token.value]))
    for (const n of doc.nodes) {
      if (n.layout === 'grid' && n.gap < 0)
        issue(`Grid gap must be nonnegative for ${n.name}`)
      for (const track of designAuthoredGridTracks(n)) {
        if (!track.variableId) continue
        const token = numbers.get(track.variableId)
        if (!token) issue('Missing grid track token')
        else if (
          token.unit !== (track.sizing === 'fill' ? 'number' : 'px') ||
          !gridTrackSchema.safeParse({ ...track, value: token.value }).success
        )
          issue('Invalid grid track token')
      }
      for (const record of n.instanceOverrides ?? []) for (const [key, id] of Object.entries(record.layoutBindings ?? {})) {
        const token = id ? numbers.get(id) : undefined
        if (!token) issue('Missing descendant layout token')
        else if (token.unit !== 'px') issue('Incompatible descendant layout token unit')
        else if (token.value < (key === 'gap' ? -10000 : 0) || token.value > 10000)
          issue('Invalid descendant layout token value')
      }
      for (const [key, id] of Object.entries(n.numericBindings ?? {})) {
        const token = id ? numbers.get(id) : undefined
        if (!token) issue(`Missing numeric token for ${n.name}`)
        else {
          const unitless = ['fontWeight', 'lineHeight'].includes(key)
          if (token.unit !== (unitless ? 'number' : 'px'))
            issue(`Incompatible token unit for ${n.name}.${key}`)
          if (
            !nodeSchema.safeParse({ ...n, [key]: token.value }).success ||
            (n.layout === 'grid' && key === 'gap' && token.value < 0)
          )
            issue(`Invalid token value for ${n.name}.${key}`)
        }
      }
      if (n.kind === 'boolean') {
        if (!n.booleanOperation) issue('Boolean containers require an operation')
        if (n.layout !== 'none') issue('Boolean containers cannot use auto layout')
        if (n.pathData !== undefined) issue('Boolean geometry is derived from operands')
      } else if (n.booleanOperation !== undefined) issue('Only Boolean containers may have an operation')
      if (n.pageId && !pages.has(n.pageId)) issue(`Missing page for ${n.name}`)
      if (n.parentId) {
        const parent = nodes.get(n.parentId)
        if (!parent) issue(`Missing parent for ${n.name}`)
        else if (
          (parent.pageId ?? doc.pages?.[0]?.id) !==
          (n.pageId ?? doc.pages?.[0]?.id)
        )
          issue(`Parent belongs to another page for ${n.name}`)
        else if (parent.kind === 'boolean' && !designBooleanNodeEligibility(n))
          issue(`Unsupported Boolean operand for ${n.name}`)
        else if (!['frame', 'group', 'component', 'component-set', 'boolean'].includes(parent.kind))
          issue(`Invalid container for ${n.name}`)
        const siblings = children.get(n.parentId) ?? []
        siblings.push(n.id)
        children.set(n.parentId, siblings)
      }
      if (
        n.kind === 'text' &&
        [...n.fills ?? [], ...n.strokes ?? []].some(p => p.image && !p.image.url.startsWith('data:image/'))
      )
        issue(`Text image paints require embedded raster data for ${n.name}`)
      if (n.textStyleId && !styles.has(n.textStyleId))
        issue(`Missing text style for ${n.name}`)
      for (const gradient of [
        n.gradient,
        ...(n.fills?.map(p => p.gradient) ?? []),
        ...(n.strokes?.map(p => p.gradient) ?? []),
        ...(n.instanceStroke?.strokes?.map(p => p.gradient) ?? []),
      ]) {
        if (!gradient) continue
        const ids = gradient.stops.flatMap(s => (s.id ? [s.id] : []))
        if (new Set(ids).size !== ids.length)
          issue(`Duplicate gradient stop identities for ${n.name}`)
        if (
          gradient.stops.some(
            s => s.variableId && !variables.has(s.variableId),
          )
        )
          issue(`Missing gradient color variable for ${n.name}`)
      }
      for (const stack of [n.fills, n.strokes, n.instanceStroke?.strokes])
        if (stack && new Set(stack.map(paint => paint.id)).size !== stack.length) issue(`Duplicate paint identities for ${n.name}`)
      if ([...n.fills ?? [], ...n.strokes ?? [], ...n.instanceStroke?.strokes ?? []]
        .some(p => p.variableId && !variables.has(p.variableId)))
        issue(`Missing paint variable for ${n.name}`)
      validateSizeLimits(n, baseNumbers)
      if (n.instanceGrid !== undefined && n.kind !== 'instance') issue('Only instances may override root grid configuration')
      if (n.instanceStroke !== undefined && n.kind !== 'instance') issue('Only instances may override component strokes')
      if (!designStrokeSupportsEdges(n) && DESIGN_STROKE_NUMBER_KEYS.slice(1).some(key => n[key] !== undefined || n.numericBindings?.[key]))
        issue('Independent stroke edges require a rectangular layer')
      if (n.instanceStroke?.strokeVariableId && !variables.has(n.instanceStroke.strokeVariableId)) issue(`Missing instance stroke variable for ${n.name}`)
      if (n.instanceStroke === null && DESIGN_STROKE_NUMBER_KEYS.some(key => n.numericBindings?.[key])) issue('A reset instance stroke cannot retain local numeric bindings')
      if (n.strokeVariableId && !variables.has(n.strokeVariableId))
        issue(`Missing stroke variable for ${n.name}`)
      if (n.fillVariableId && !variables.has(n.fillVariableId))
        issue(`Missing color variable for ${n.name}`)
      if (
        n.kind === 'instance' &&
        (!n.componentId || nodes.get(n.componentId)?.kind !== 'component')
      )
        issue(`Missing component for ${n.name}`)
      if (n.kind !== 'instance' && n.componentId)
        issue('Only instances may reference components')
      if (n.instanceLayout === null && DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(key => n.numericBindings?.[key]))
        issue('A reset instance layout cannot retain local root numeric bindings')
      if (n.instanceSizingOverrides !== undefined && n.kind !== 'instance')
        issue('Only instances may override component sizing')
      if (n.instanceLayout !== undefined) {
        if (n.kind !== 'instance') issue('Only instances may override component layout')
      }
      if (n.instanceOverrides !== undefined && n.kind !== 'instance') issue('Only instances may override component layers')
      if (!designTextHyperlinksValid(doc, n.textRuns, nodes) ||
        n.instanceOverrides?.some(record => !designTextHyperlinksValid(doc, record.textRuns, nodes)))
        issue('Text hyperlink targets require existing stored layers or admitted URLs')
      if ((n.textRuns !== undefined || n.fontFeatures !== undefined || n.fontVariations !== undefined) && n.kind !== 'text') issue('Inline formatting requires a text layer')
      if (n.textRuns?.some(run => !designTextBoundary(n.text, run.start) || !designTextBoundary(n.text, run.end)))
        issue('Text run ranges require valid UTF-16 boundaries within text')
      if (n.textLayoutMetrics && n.kind !== 'text') issue('Measured text sizes require a text layer')
      if (n.instanceOverrides?.length) {
        const paths = new Set<string>(), effectivePaths = new Set<string>()
        for (const override of n.instanceOverrides) {
          const key = JSON.stringify(override.path)
          if (paths.has(key)) issue(`Duplicate instance override for ${n.name}`)
          paths.add(key)
          const effectivePath = override.path.length === 1 ? override.path :
            designComponentPropertyContextPath(doc, n, override.path) ?? override.path
          const effectiveKey = JSON.stringify(effectivePath)
          if (effectivePaths.has(effectiveKey)) issue(`Duplicate effective instance override target for ${n.name}`)
          effectivePaths.add(effectiveKey)
          const target = designComponentOverrideTarget(doc, n, override.path)
          if (!target) issue(`Missing instance override target for ${n.name}`)
          if (target && (override.text !== undefined || override.textRuns !== undefined || override.fontFeatures !== undefined || override.fontVariations !== undefined) && target.kind !== 'text')
            issue('Text overrides require a text layer')
          if (target && (override.textLayoutMetrics || override.textBaselineMetrics) && target.kind !== 'text')
            issue('Measured text sizes require a text layer')
          if (override.componentId !== undefined) {
            if (target?.kind !== 'instance') issue('Contextual component replacements require instance targets')
            if (nodes.get(override.componentId)?.kind !== 'component') issue('Missing contextual replacement component')
          }
        }
      }
    }
    if (doc.nodes.reduce((sum, n) => sum + (n.effects?.length ?? 0) +
      (n.instanceOverrides ?? []).reduce((total, record) => total + (record.effects?.length ?? 0), 0),
    (doc.effectStyles ?? []).reduce((sum, style) => sum + style.effects.length, 0)) > 10000)
      issue('Design exceeds 10000 authored effects')
    if (doc.nodes.reduce((sum, n) => sum + (n.textRuns?.length ?? 0) +
      (n.instanceOverrides ?? []).reduce((total, record) => total + (record.textRuns?.length ?? 0), 0), 0) > 10000)
      issue('Design exceeds 10000 inline text runs')
    if (doc.nodes.reduce((sum, n) => sum + (n.instanceOverrides?.length ?? 0), 0) > 10000)
      issue('Design exceeds 10000 instance overrides')
    if (doc.nodes.reduce((sum, n) => sum + (n.instanceOverrides ?? []).reduce(
      (total, o) => total + (o.text?.length ?? 0), 0), 0) > 8000000)
      issue('Instance override text exceeds 8000000 characters')
    if (doc.nodes.reduce((sum, n) => sum +
      (n.textLayoutMetrics?.signature.length ?? 0) + (n.textLayoutMetrics?.overflow?.signature.length ?? 0) +
      (n.instanceOverrides ?? []).reduce(
        (total, o) => total + (o.textLayoutMetrics?.signature.length ?? 0) +
          (o.textLayoutMetrics?.overflow?.signature.length ?? 0), 0), 0) > 8000000)
      issue('Text layout signatures exceed 8000000 characters')
    if (designTextMeasurementCacheCharacters(doc) > 8000000)
      issue('Text measurement backend metadata exceeds 8000000 characters')
    for (const n of doc.nodes) {
      if (
        n.layout === 'grid' &&
        !['frame', 'group', 'component', 'component-set'].includes(n.kind)
      )
        issue('Grid requires a container')
      if (n.layout !== 'grid') continue
      const budget = designGridBudgetIssue(
        n,
        (children.get(n.id) ?? []).flatMap((id) => {
          const child = nodes.get(id)
          return child ? [child] : []
        }),
      )
      if (budget === 'area') issue('Grid occupied area exceeds 65536 cells')
      if (budget === 'rows') issue('Grid exceeds 4096 rows')
    }
    // Validate the rendered graph too: separate masters can indirectly instantiate each other.
    const depths = new Map<string, number>()
    const counts = new Map<string, number>()
    const visiting = new Set<string>()
    const visit = (id: string, depth: number): number => {
      if (visiting.has(id)) {
        issue('Cyclic layer or component hierarchy')
        return 0
      }
      if (depth > 64) {
        issue('Design nesting exceeds 64 layers')
        return 0
      }
      const cached = depths.get(id)
      if (cached !== undefined) return cached
      visiting.add(id)
      const node = nodes.get(id)
      const edges = [
        ...(children.get(id) ?? []),
        ...(node?.kind === 'instance' && node.componentId
          ? [node.componentId]
          : []),
      ]
      const height =
        1 + Math.max(0, ...edges.map(child => visit(child, depth + 1)))
      const count =
        1 + edges.reduce((sum, child) => sum + (counts.get(child) ?? 0), 0)
      if (count > 50000) issue('Expanded component scene exceeds 50000 layers')
      counts.set(id, Math.min(count, 50001))
      visiting.delete(id)
      depths.set(id, height)
      if (height > 64) issue('Design nesting exceeds 64 layers')
      return height
    }
    for (const node of doc.nodes) visit(node.id, 0)
    if (
      doc.nodes
        .filter(n => n.parentId === null)
        .reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0) > 100000
    )
      issue('Expanded scene exceeds 100000 layers')
  })

/**
 * A design document, scene relationship, or write revision is invalid.
 */
export class CopyOSDesignError extends Error {
  override readonly name = 'CopyOSDesignError'
}

/**
 * Validate a candidate design document and keep the full validation report, with issue paths.
 * @param input - Candidate document.
 * @returns The validation error, or undefined for a valid document.
 */
export function designDocumentValidationError(input: unknown): z.ZodError | undefined {
  const result = designSchema.safeParse(input)
  return result.success ? undefined : result.error
}

/**
 * Validate files and agent-supplied documents before committing.
 * @param input - Untrusted file or wire value.
 * @returns validated portable design.
 */
export function parseDesignDocument(input: unknown): CopyOSDesignDocument {
  const result = designSchema.safeParse(input)
  if (!result.success)
    throw new CopyOSDesignError(
      result.error.issues.map(i => i.message).join('; '),
    )
  return captureDesignConstraintReferences(result.data)
}

/** Internal schema pieces keep incremental edits and complete files on the same strict contract. */
export const designDocumentSchemas = {
  coordinate, size, minimumSize, color, canvasBackgroundSchema, imageGeometrySchema, textStyleSchema,
  effectStyleSchema: designEffectStyleSchema,numberExpressionSchema,
  alphaSourceSchema, inheritedModeSchema, variantAxisSchema, variantValueSchema, nodeSchema, tokenModeSchema,
  gridSchema, instanceLayoutSchema, layoutBindingsSchema, paintSchema,
}
