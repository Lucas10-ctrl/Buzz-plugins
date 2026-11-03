import { withProjectArtifactAccess } from './project-artifact-transaction.ts'
import { designFontVariationsSchema } from './design-font-variations.ts'
import { editDesignFontVariations } from './design-font-variations-authoring.ts'
import { designFontFeaturesSchema } from './design-font-features.ts'
import { editDesignFontFeatures } from './design-font-features-authoring.ts'
import { DESIGN_STROKE_NUMBER_KEYS } from './design-stroke.ts'
/**
 * Revision-checked, cross-process-safe Page Designer storage.
 */
import { normalizeDesignFillAuthoring } from './design-fill-authoring.ts'
import { setDesignSizingPolicy, clearDesignSizingLimits } from './design-sizing-authoring.ts'
import { setDesignAspectRatio, resizeDesignAspectAxis } from './design-aspect-ratio.ts'
import { editDesignTextRange, resetDesignTextRuns } from './design-text-range.ts'
import { designTextHyperlinkSchema, reconcileDesignTextHyperlinks } from './design-text-hyperlink.ts'
import { editDesignEffectsBatch } from './design-effects.ts'
import { editDesignEffectStyleResources } from './design-effect-styles.ts'
import { combineDesignComponentsAsVariants, addDesignVariant, configureDesignComponentSet,
  selectDesignVariants, dissolveDesignComponentSet } from './design-component-variants.ts'
import { reconcileDesignVariants } from './design-variant-names.ts'
import { reconcileDesignComponentProperties } from './design-component-properties.ts'
import { swapDesignInstances } from './design-instance-swap.ts'
import { DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS } from './design-instance-layout.ts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { CopyOSPageRepository, CopyOSPageFormatError } from './pages.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import {
  parseDesignPadding, setDesignAutoLayoutPadding,
  designNodePaints,
  addDesignAutoLayout, removeDesignAutoLayout, designAutoLayoutContext, suggestDesignAutoLayout,
  setDesignAutoLayoutFlow, setDesignAutoLayoutAlignment, setDesignLayoutVersion, setDesignGridCellAlignment,
  createDesignInstanceGridCellReader,
  designPaintBlendModeSchema,
  designLayerBlendModeSchema,
  mergeDesignInstanceBlendModes,
  designAuthoredStrokePaints,
  applyDesignInstanceStroke,
  editDesignStrokePaints,
  editDesignInstanceStroke,
  DESIGN_INSTANCE_SIZING_KEYS,
  resetDesignInstanceSizing,
  cropDesignImage,
  editDesignNodes,
  moveDesignPathPoint, splitDesignPathSegment, deleteDesignPathAnchor,
  moveDesignPathAnchors, deleteDesignPathAnchors, joinDesignPathEndpoints,
  createDesignBoolean, setDesignBooleanOperation, ungroupDesignBoolean, flattenDesignBoolean, fitDesignBooleans,
  mergeDesignInstanceGridCells,
  mergeDesignInstanceGridConfigs,
  mergeDesignInstanceLayouts,
  designInstanceLayoutContext,
  designComponentOverrideTarget,
  designComponentPropertyContextPath,
  ignoreDesignChildConstraints,
  designNumberTokenSupportsProperty,
  setDesignColorVariable,
  setDesignNumberVariable,
  resetDesignModeVariable,
  resetDesignColorAlpha,
} from './design-model.ts'
import { createDesignBreakpoint, createDesignSizeVariant } from './design-breakpoints.ts'
import type { CopyOSDesignDocument, CopyOSDesignCanvasBackground } from './types.ts'

import { CopyOSDesignError, parseDesignDocument, designDocumentSchemas } from './design-schema.ts'
export { CopyOSDesignError, parseDesignDocument } from './design-schema.ts'
const {
  coordinate, size, minimumSize, color, canvasBackgroundSchema, imageGeometrySchema, textStyleSchema,numberExpressionSchema,
  alphaSourceSchema, inheritedModeSchema, variantAxisSchema, variantValueSchema, nodeSchema, tokenModeSchema, gridSchema,
  instanceLayoutSchema, effectStyleSchema,
} = designDocumentSchemas
const pathAnchorTargetsSchema = z.array(z.object({
  pathIndex: z.number().int().min(0).max(4999), commandIndex: z.number().int().min(0).max(2_000_000),
}).strict()).min(1).max(1000).refine(targets =>
  new Set(targets.map(target => `${target.pathIndex}:${target.commandIndex}`)).size === targets.length,
'Duplicate path anchor targets are not allowed')

const strokeChangeProperties = z.object({
  strokeCap: nodeSchema.shape.strokeCap.nullable(),
  strokeJoin: nodeSchema.shape.strokeJoin.nullable(),
  strokeMiterLimit: nodeSchema.shape.strokeMiterLimit.nullable(),
  strokeDashes: nodeSchema.shape.strokeDashes.nullable(),
  strokeDashOffset: nodeSchema.shape.strokeDashOffset.nullable(),
  strokeAlign: nodeSchema.shape.strokeAlign.nullable(),
  strokeDash: nodeSchema.shape.strokeDash.nullable(),
  strokeOpacity: nodeSchema.shape.strokeOpacity.nullable(),
  strokeWidth: nodeSchema.shape.strokeWidth.nullable().optional(),
  strokeTopWidth: nodeSchema.shape.strokeTopWidth.nullable(),
  strokeRightWidth: nodeSchema.shape.strokeRightWidth.nullable(),
  strokeBottomWidth: nodeSchema.shape.strokeBottomWidth.nullable(),
  strokeLeftWidth: nodeSchema.shape.strokeLeftWidth.nullable(),
}).strict().refine(properties => Object.keys(properties).length > 0, 'A stroke edit requires properties')
const strokeChangeKeys = Object.keys(strokeChangeProperties.shape)
const textRangeStylePatchSchema = z.object({
  fontFamily: nodeSchema.shape.fontFamily.nullable().optional(),
  fontSize: nodeSchema.shape.fontSize.nullable().optional(),
  fontWeight: nodeSchema.shape.fontWeight.nullable().optional(),
  fontStyle: nodeSchema.shape.fontStyle.nullable().optional(),
  fontFeatures: nodeSchema.shape.fontFeatures.nullable().optional(),
  fontVariations: nodeSchema.shape.fontVariations.nullable().optional(),
  lineHeight: nodeSchema.shape.lineHeight.nullable().optional(),
  letterSpacing: nodeSchema.shape.letterSpacing.nullable().optional(),
  textDecoration: nodeSchema.shape.textDecoration.nullable().optional(),
  fill: color.nullable().optional(),
  hyperlink: designTextHyperlinkSchema.nullable().optional(),
}).strict().refine(style => Object.keys(style).length > 0, 'A text range style requires a setting')

/**
 * Portable design repository shared by the browser and agent tools.
 */
export class CopyOSDesignRepository {
  private readonly images = new CopyOSDesignImageStore()
  /**
   * List saved designs.
   * @param root - Project root.
   * @returns newest first.
   */
  async list(root: string): Promise<CopyOSDesignDocument[]> {
    return withProjectArtifactAccess(root, () => this.listCore(root))
  }

  private async listCore(root: string): Promise<CopyOSDesignDocument[]> {
    const directory = join(root, 'designs')
    await mkdir(directory, { recursive: true })
    const files = await readdir(directory)
    const docs = await Promise.all(
      files
        .filter(f => /^[0-9a-f-]{36}\.design\.json$/.test(f))
        .map(async file =>
          parseDesignDocument(
            JSON.parse(await readFile(join(directory, file), 'utf8')),
          ),
        ),
    )
    return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  /**
   * Read one design.
   * @param root - Project root.
   * @param id - Stable identity.
   * @returns saved design.
   */
  async get(root: string, id: string): Promise<CopyOSDesignDocument> {
    return withProjectArtifactAccess(root, () => this.getCore(root, id))
  }

  private async getCore(root: string, id: string): Promise<CopyOSDesignDocument> {
    const valid = z.uuid().safeParse(id)
    if (!valid.success) throw new CopyOSDesignError('Invalid design identity')
    return parseDesignDocument(
      JSON.parse(
        await readFile(
          join(root, 'designs', `${valid.data}.design.json`),
          'utf8',
        ),
      ),
    )
  }
  /**
   * Create a blank scene.
   * @param root - Project root.
   * @param title - User-visible title.
   * @param canvasBackground - Optional explicit backing selected by the creator; omission retains legacy defaults.
   * @returns saved design.
   */
  async create(root: string, title: string, canvasBackground?: CopyOSDesignCanvasBackground): Promise<CopyOSDesignDocument> {
    const now = new Date().toISOString()
    const doc = parseDesignDocument({
      schema: 'copyos.design',
      version: 1,
      id: randomUUID(),
      title,
      revision: 0,
      nodes: [],
      variables: [],
      ...(canvasBackground !== undefined ? { canvasBackground } : {}),
      createdAt: now,
      updatedAt: now,
    })
    await writeFileAtomic(
      join(root, 'designs', `${doc.id}.design.json`),
      `${JSON.stringify(doc, null, 2)}\n`,
      {
        mode: 0o600,
      },
    )
    return doc
  }
  /** Validate an agent batch and commit it against the supplied document revision.
   * @param root - Project directory.
   * @param document - Latest read scene, including its expected revision.
   * @param changes - JSON node and resource edits.
   * @returns The saved scene; validation or revision conflicts leave the file unchanged.
   */
  async edit(
    root: string,
    document: CopyOSDesignDocument,
    changes: unknown,
  ): Promise<CopyOSDesignDocument> {
    return this.save(root, applyDesignChanges(document, changes))
  }

  /**
   * Commit without overwriting concurrent manual or agent edits.
   * Embedded raster images (except text image paints) are stored under `assets/images/` and replaced with `copyos-asset:` references first.
   * @param root - Project root.
   * @param input - Complete design and the revision read by its author.
   * @returns committed next revision, holding references where the input embedded images.
   */
  async save(root: string, input: unknown): Promise<CopyOSDesignDocument> {
    return withProjectArtifactAccess(root, () => this.saveCore(root, input))
  }

  private async saveCore(root: string, input: unknown): Promise<CopyOSDesignDocument> {
    const doc = await this.images.storeDocumentImages(root, parseDesignDocument(input))
    const path = join(root, 'designs', `${doc.id}.design.json`)
    return await withFileLock(path, async () => {
      const current = await this.get(root, doc.id)
      if (current.revision !== doc.revision)
        throw new CopyOSDesignError(
          'Design changed in another editor. Reload the saved version before applying your changes.',
        )
      const pageIds = new Set(doc.nodes.flatMap(node => node.pageLink ? [node.pageLink.pageId] : []))
      if (pageIds.size) {
        let available = false
        try { available = (await stat(join(root, 'pages'))).isDirectory() }
        catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
        if (!available) throw new CopyOSDesignError('Linked pages are unavailable in this project')
        let availablePageIds: Set<string>
        try { availablePageIds = new Set((await new CopyOSPageRepository().list(root)).map(page => page.id)) }
        catch (error: unknown) {
          if (error instanceof CopyOSPageFormatError) throw new CopyOSDesignError('Linked pages are unavailable in this project')
          throw error
        }
        for (const pageId of pageIds) if (!availablePageIds.has(pageId))
          throw new CopyOSDesignError(`Linked page '${pageId}' is unavailable in this project`)
      }
      const next = {
        ...doc,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      }
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
      })
      return next
    })
  }
}

/** Apply a bounded agent edit atomically; failed validation leaves the caller's scene untouched.
 * @param document - Most recently read design revision.
 * @param changes - Node upserts/deletions and token upserts from a JSON tool call.
 * @returns A completely validated scene ready for revision-checked saving.
 */
export function applyDesignChanges(
  document: CopyOSDesignDocument,
  changes: unknown,
): CopyOSDesignDocument {
  return applyDesignChangesWithSelection(document, changes).document
}

/** Hash the complete authored input for a cross-call Suggest review precondition.
 * @param document - Parsed authored document, including the selected default mode.
 * @param nodeIds - Ordered reviewed stored selection.
 * @param seed - Wrapper identity seed shared by preview and apply.
 * @returns SHA256 of deterministic document and review context; runtime symbols and undefined fields are omitted.
 */
export function designAutoLayoutSuggestionFingerprint(document: CopyOSDesignDocument, nodeIds: readonly string[], seed: string): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) :
    value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, stable(child)])) : value
  const authored = { ...document, activeTokenModeId: document.activeTokenModeId ?? null,
    numberVariables: document.numberVariables ?? [], textStyles: document.textStyles ?? [] }
  return createHash('sha256').update(JSON.stringify(stable({ document: authored, nodeIds, seed }))).digest('hex')
}
/** Allocate repeatable custom-version UUIDs for one reviewed Suggest plan.
 * @param seed - Caller-supplied UUID retained across preview and apply.
 * @returns Fresh allocator sequence; the native planner validates collisions with stored identities.
 */
export function designAutoLayoutSuggestionIds(seed: string): () => string {
  let index = 0
  return () => {
    const bytes = createHash('sha256').update(`copyos-auto-layout-suggestion:${seed}:${index++}`).digest().subarray(0, 16)
    bytes[6] = ((bytes[6] ?? 0) & 15) | 128
    bytes[8] = ((bytes[8] ?? 0) & 63) | 128
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}
/** Apply ordered native edits and retain the final selection without publishing partial results.
 * @param document - Most recently read design revision.
 * @param changes - Strict JSON edit command.
 * @returns Fully validated candidate and optional final selection.
 */
export function applyDesignChangesWithSelection(
  document: CopyOSDesignDocument,
  changes: unknown,
): { document: CopyOSDesignDocument; selection?: readonly string[] } {
  const parsed = z
    .object({
      autoLayoutChanges: z.array(z.discriminatedUnion('action', [
        z.object({ action: z.literal('suggest'), nodeIds: z.array(z.uuid()).min(1).max(500), seed: z.uuid(),
          reviewedFingerprint: z.string().regex(/^[a-f0-9]{64}$/), modeId: z.uuid().nullable() }).strict(),
        z.object({ action: z.literal('cell-align'), targets: z.array(z.object({ nodeId: z.uuid(),
          path: z.array(z.uuid()).max(64).default([]) }).strict()).min(1).max(500), intent: z.union([
          z.object({ type: z.literal('spatial'), horizontal: z.enum(['start', 'center', 'end']).optional(),
            vertical: z.enum(['start', 'center', 'end']).optional() }).strict()
            .refine(intent => intent.horizontal !== undefined || intent.vertical !== undefined, 'Cell alignment requires an axis'),
          z.object({ type: z.literal('step'), axis: z.enum(['horizontal', 'vertical']), direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
        ]) }).strict(),
        z.object({ action: z.literal('layout-version'), model: z.enum(['css', 'legacy']), scope: z.discriminatedUnion('type', [
          z.object({ type: z.literal('selection'), nodeIds: z.array(z.uuid()).min(1).max(500) }).strict(),
          z.object({ type: z.literal('page'), pageId: z.uuid().nullable() }).strict(),
        ]) }).strict(),
        z.object({ action: z.literal('padding'), targets: z.array(z.object({ nodeId: z.uuid(),
          path: z.array(z.uuid()).max(64).default([]) }).strict()).min(1).max(500), value: z.string().min(1).max(200) }).strict(),
        z.object({ action: z.literal('add'), nodeIds: z.array(z.uuid()).min(1).max(500), frameId: z.uuid() }).strict(),
        z.object({ action: z.literal('flow'), nodeIds: z.array(z.uuid()).min(1).max(500), flow: z.enum(['row', 'column', 'grid']) }).strict(),
        z.object({ action: z.literal('align'), nodeIds: z.array(z.uuid()).min(1).max(500).optional(),
          targets: z.array(z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]) }).strict()).min(1).max(500).optional(),
          intent: z.union([
            z.object({ type: z.literal('spatial'), horizontal: z.enum(['start', 'center', 'end']).optional(),
              vertical: z.enum(['start', 'center', 'end']).optional() }).strict()
              .refine(intent => intent.horizontal !== undefined || intent.vertical !== undefined, 'Spatial alignment requires an axis'),
            z.object({ type: z.literal('step'), axis: z.enum(['horizontal', 'vertical']), direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
            z.object({ type: z.literal('distribution'), value: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']) }).strict(),
            z.object({ type: z.literal('baseline'), enabled: z.boolean() }).strict(),
            z.object({ type: z.literal('auto-spacing'), enabled: z.boolean() }).strict(),
          ]) }).strict().refine(change => (change.nodeIds === undefined) !== (change.targets === undefined),
          'Alignment requires exactly one of nodeIds or targets'),
        z.object({ action: z.literal('remove'), nodeIds: z.array(z.uuid()).min(1).max(500), recursive: z.boolean().optional() }).strict(),
      ])).max(100).default([]),
      effectStyles: z.array(effectStyleSchema).max(500).default([]),
      deleteEffectStyleIds: z.array(z.uuid()).max(500).default([]),
      effectStyleChanges: z.array(z.discriminatedUnion('action', [
        z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]), action: z.literal('bind'), styleId: z.uuid() }).strict(),
        z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]), action: z.literal('detach') }).strict(),
        z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]), action: z.literal('reset') }).strict(),
      ])).max(500).default([]),
      effectChanges: z.array(z.object({
        nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]),
        effects: nodeSchema.shape.effects.nonoptional().nullable(),
      }).strict()).max(500).default([]),
      sizeVariantChanges: z.array(z.object({ action: z.literal('create'), frameId: z.uuid(),
        width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000),
        name: z.string().trim().min(1).max(200) }).strict()).max(10).default([]),
      breakpointChanges: z.array(z.object({ action: z.literal('create'), frameId: z.uuid(),
        width: z.number().int().min(200).max(4000), maxWidth: z.number().int().min(200).max(4000),
        name: z.string().trim().min(1).max(200) }).strict()).max(10).default([]),
      booleanChanges: z.array(z.discriminatedUnion('action', [
        z.object({ action: z.literal('create'), nodeIds: z.array(z.uuid()).min(2).max(500), id: z.uuid(),
          operation: z.enum(['union', 'subtract', 'intersect', 'exclude']) }).strict(),
        z.object({ action: z.literal('set-operation'), nodeId: z.uuid(),
          operation: z.enum(['union', 'subtract', 'intersect', 'exclude']) }).strict(),
        z.object({ action: z.literal('ungroup'), nodeId: z.uuid() }).strict(),
        z.object({ action: z.literal('flatten'), nodeId: z.uuid() }).strict(),
      ])).max(100).default([]),
      pathChanges: z.array(z.discriminatedUnion('action', [
        z.object({ nodeId: z.uuid(), action: z.literal('join-endpoints'),
          targets: pathAnchorTargetsSchema.refine(targets => targets.length === 2, 'Joining requires exactly two endpoints') }).strict(),
        z.object({ nodeId: z.uuid(), action: z.literal('move-anchors'),
          targets: pathAnchorTargetsSchema, dx: coordinate, dy: coordinate }).strict(),
        z.object({ nodeId: z.uuid(), action: z.literal('delete-anchors'),
          targets: pathAnchorTargetsSchema, mode: z.enum(['delete', 'heal']).default('delete') }).strict(),
        z.object({ nodeId: z.uuid(), action: z.literal('delete-anchor'),
          pathIndex: z.number().int().min(0).max(4999), commandIndex: z.number().int().min(0).max(2_000_000),
          mode: z.enum(['delete', 'heal']).default('delete'),
        }).strict(),
        z.object({ nodeId: z.uuid(), action: z.literal('move-point'), target: z.object({
          pathIndex: z.number().int().min(0).max(4999), commandIndex: z.number().int().min(0).max(2_000_000),
          kind: z.enum(['anchor', 'incoming', 'outgoing']),
        }).strict(), x: coordinate, y: coordinate }).strict(),
        z.object({ nodeId: z.uuid(), action: z.literal('split-segment'),
          pathIndex: z.number().int().min(0).max(4999), commandIndex: z.number().int().min(0).max(2_000_000),
          t: z.number().gt(0).lt(1),
        }).strict(),
      ])).max(100).default([]),
      fontVariationChanges: z.array(z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]),
        variations: designFontVariationsSchema.nullable() }).strict()).max(100).default([]),
      fontFeatureChanges: z.array(z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]),
        features: designFontFeaturesSchema.nullable() }).strict()).max(100).default([]),
      textRangeChanges: z.array(z.union([z.object({
        nodeId: z.uuid(), path: z.array(z.uuid()).max(64).default([]),
        start: z.number().int().min(0).max(100000), end: z.number().int().min(0).max(100000),
        text: z.string().max(100000).optional(), style: textRangeStylePatchSchema.nullable().optional(),
      }).strict().refine(change => change.end >= change.start, 'Text range end precedes its start')
        .refine(change => change.text !== undefined || change.style !== undefined, 'A text range edit requires content or style'),
      z.object({ nodeId: z.uuid(), path: z.array(z.uuid()).min(1).max(64), inherit: z.literal(true) }).strict()]))
        .max(100).default([]),
      combineVariants: z.array(z.object({
        componentIds: z.array(z.uuid()).min(2).max(1000), setId: z.uuid(), axisId: z.uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        axisName: z.string().trim().min(1).max(120).optional(),
      }).strict()).max(100).default([]),
      addVariants: z.array(z.object({
        sourceId: z.uuid(), componentId: z.uuid(), setId: z.uuid().optional(), axisId: z.uuid().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        axisName: z.string().trim().min(1).max(120).optional(),
      }).strict().refine(value => (value.setId === undefined) === (value.axisId === undefined),
        'Standalone variant set and axis identities must be supplied together')).max(100).default([]),
      configureComponentSets: z.array(z.object({
        setId: z.uuid(), axes: z.array(variantAxisSchema).min(1).max(20),
        variants: z.array(z.object({ componentId: z.uuid(), values: z.array(variantValueSchema).min(1).max(20) }).strict())
          .min(1).max(1000),
      }).strict()).max(100).default([]),
      selectVariants: z.array(z.object({ nodeId: z.uuid(), values: z.array(variantValueSchema).min(1).max(20) }).strict())
        .max(500).default([]),
      dissolveComponentSets: z.array(z.uuid()).max(100).default([]),
      swapInstances: z.array(z.object({ nodeId: z.uuid(), componentId: z.uuid() }).strict()).max(500).default([]),
      instanceGridChanges: z.array(z.object({
        instanceId: z.uuid(), path: z.array(z.uuid()).min(1).max(64),
        grid: z.object({
          columns: gridSchema.shape.columns.nullable().optional(),
          rows: gridSchema.shape.rows.nullable().optional(),
          implicitRow: gridSchema.shape.implicitRow.nullable().optional(),
          autoRows: z.boolean().nullable().optional(),
          autoPosition: z.boolean().nullable().optional(),
        }).strict().refine(grid => Object.keys(grid).length > 0, 'A grid edit requires a setting').nullable(),
      }).strict()).max(1000).default([]),
      instanceLayoutChanges: z.array(z.object({
        instanceId: z.uuid(), path: z.array(z.uuid()).min(1).max(64),
        layout: z.object({
          layout: instanceLayoutSchema.shape.layout.nullable().optional(),
          gap: instanceLayoutSchema.shape.gap.nullable().optional(),
          crossGap: instanceLayoutSchema.shape.crossGap.nullable().optional(),
          padding: instanceLayoutSchema.shape.padding.nullable().optional(),
          paddingTop: instanceLayoutSchema.shape.paddingTop.nullable().optional(),
          paddingRight: instanceLayoutSchema.shape.paddingRight.nullable().optional(),
          paddingBottom: instanceLayoutSchema.shape.paddingBottom.nullable().optional(),
          paddingLeft: instanceLayoutSchema.shape.paddingLeft.nullable().optional(),
          alignItems: instanceLayoutSchema.shape.alignItems.nullable().optional(),
          justifyContent: instanceLayoutSchema.shape.justifyContent.nullable().optional(),
          layoutWrap: instanceLayoutSchema.shape.layoutWrap.nullable().optional(),
          alignContent: instanceLayoutSchema.shape.alignContent.nullable().optional(),
        }).strict().refine(layout => Object.keys(layout).length > 0, 'A layout edit requires a setting').nullable().optional(),
        layoutBindings: z.object(Object.fromEntries(DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.map(key =>
          [key, z.uuid().nullable().optional()]))).strict()
          .refine(bindings => Object.keys(bindings).length > 0, 'A binding edit requires a setting').nullable().optional(),
      }).strict().refine(change => change.layout !== undefined || change.layoutBindings !== undefined,
        'A layout edit requires settings or bindings').refine(change => change.layout !== null || change.layoutBindings == null,
        'A layout reset cannot also assign bindings')).max(1000).default([]),
      instanceBlendChanges: z.array(z.object({
        instanceId: z.uuid(), path: z.array(z.uuid()).min(1).max(64),
        blendMode: designLayerBlendModeSchema.nullable(),
      }).strict()).max(1000).default([]),
      instanceCellChanges: z.array(z.object({
        instanceId: z.uuid(), path: z.array(z.uuid()).min(1).max(64),
        cell: z.object({
          column: z.number().int().min(1).max(64).nullable().optional(),
          row: z.number().int().min(1).max(4096).nullable().optional(),
          columnSpan: z.number().int().min(1).max(64).nullable().optional(),
          rowSpan: z.number().int().min(1).max(64).nullable().optional(),
          horizontalAlign: z.enum(['start', 'center', 'end']).nullable().optional(),
          verticalAlign: z.enum(['start', 'center', 'end']).nullable().optional(),
        }).strict().refine(cell => Object.keys(cell).length > 0, 'A cell edit requires a setting').nullable(),
      }).strict()).max(1000).default([]),
      resetInstanceSizing: z.array(z.object({
        nodeId: z.uuid(),
        properties: z.array(z.enum(DESIGN_INSTANCE_SIZING_KEYS)).min(1).max(8)
          .refine(keys => new Set(keys).size === keys.length, 'Duplicate instance sizing reset property').optional(),
      }).strict()).max(500).default([]),
      ignoreConstraintsFor: z.array(z.uuid()).max(500).default([]),
      activeTokenModeId: z.uuid().nullable().optional(),
      upsertTokenModes: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string().trim().min(1).max(200).optional(),
            })
            .strict(),
        )
        .max(32)
        .default([]),
      deleteTokenModeIds: z.array(z.uuid()).max(32).default([]),
      canvasBackground: canvasBackgroundSchema.nullable().optional(),
      pageBackgroundChanges: z.array(z.object({
        id: z.uuid(), canvasBackground: canvasBackgroundSchema.nullable(),
      }).strict()).max(200).default([]),
      pageModeChanges: z
        .array(
          z.object({ id: z.uuid(), tokenModeId: inheritedModeSchema }).strict(),
        )
        .max(200)
        .default([]),
      tokenChanges: z
        .array(
          z.discriminatedUnion('kind', [
            z
              .object({
                kind: z.literal('color'),
                inheritAlpha: z.literal(true).optional(),
                id: z.uuid(),
                modeId: z.uuid().nullable().optional(),
                value: color.optional(),
                alpha: z.number().min(0).max(1).optional(),
                alphaSource: alphaSourceSchema,
                aliasId: z.uuid().nullable().optional(),
                inherit: z.boolean().optional(),
              })
              .strict(),
            z
              .object({
                kind: z.literal('number'),
                expression:numberExpressionSchema.nullable().optional(),
                id: z.uuid(),
                modeId: z.uuid().nullable().optional(),
                value: coordinate.optional(),
                aliasId: z.uuid().nullable().optional(),
                inherit: z.boolean().optional(),
              })
              .strict(),
          ]),
        )
        .max(500)
        .default([]),
      cropImages: z
        .array(
          z
            .object({
              nodeId: z.uuid(),
              paintId: z.uuid(),
              channel: z.enum(['fill', 'stroke']).default('fill'),
              left: coordinate,
              top: coordinate,
              width: size,
              height: size,
            })
            .strict(),
        )
        .max(500)
        .default([]),
      strokeChanges: z.array(z.object({ nodeId: z.uuid(), properties: strokeChangeProperties }).strict()).max(500).default([]),
      sizingChanges: z.array(z.object({
        nodeId: z.uuid(),
        axis: z.enum(['width', 'height']),
        policy: z.enum(['fixed', 'hug', 'fill']).optional(),
        removeLimits: z.literal(true).optional(),
      }).strict().refine(change => change.policy !== undefined || change.removeLimits === true,
        'Sizing changes require a policy or removeLimits')).max(500).default([]),
      aspectRatioChanges: z.array(z.object({
        nodeId: z.uuid(), action: z.enum(['lock', 'unlock', 'inherit']),
      }).strict()).max(500).default([]),
      resizeChanges: z.array(z.object({
        nodeId: z.uuid(), axis: z.enum(['width', 'height']), value: size,
      }).strict()).max(500).default([]),
      paintUpdates: z
        .array(
          z
            .object({
              nodeId: z.uuid(),
              paintId: z.uuid(),
              channel: z.enum(['fill', 'stroke']).default('fill'),
              opacity: z.number().min(0).max(1).optional(),
              visible: z.boolean().optional(),
              blendMode: designPaintBlendModeSchema.optional(),
              imageSizing: z
                .enum(['fill', 'fit', 'stretch', 'crop', 'tile'])
                .optional(),
              imageSettings: imageGeometrySchema.optional(),
            })
            .strict(),
        )
        .max(500)
        .default([]),
      textStyles: z.array(textStyleSchema).max(500).default([]),
      upsertNodes: z
        .array(nodeSchema.partial().required({ id: true }).extend({
          blendMode: designLayerBlendModeSchema.nullable().optional(),
          pageLink: nodeSchema.shape.pageLink.nullable().optional(),
          semantics: nodeSchema.shape.semantics.nullable().optional(),
          breakpoint: nodeSchema.shape.breakpoint.nullable().optional(),
          breakpointSourceId: nodeSchema.shape.breakpointSourceId.nullable().optional(),
          strokeTopWidth:z.number().min(0).max(1000).nullable().optional(),
          strokeRightWidth:z.number().min(0).max(1000).nullable().optional(),
          strokeBottomWidth:z.number().min(0).max(1000).nullable().optional(),
          strokeLeftWidth:z.number().min(0).max(1000).nullable().optional(),
          minWidth: minimumSize.nullable().optional(), maxWidth: size.nullable().optional(),
          minHeight: minimumSize.nullable().optional(), maxHeight: size.nullable().optional(),
        }).transform((edit) => {
          const { minWidth, maxWidth, minHeight, maxHeight, blendMode, pageLink, semantics, breakpoint, breakpointSourceId,
            strokeTopWidth,strokeRightWidth,strokeBottomWidth,strokeLeftWidth,instanceGrid, ...fields } = edit
          const resetEdges=DESIGN_STROKE_NUMBER_KEYS.slice(1).filter(key=>key in edit && edit[key]===null)
          if (resetEdges.length && fields.numericBindings) fields.numericBindings=Object.fromEntries(
            Object.entries(fields.numericBindings).filter(([key])=>!resetEdges.some(edge=>edge===key)))
          return {
            ...fields,
            ...('blendMode' in edit ? { blendMode: blendMode ?? undefined } : {}),
            ...('pageLink' in edit ? { pageLink: pageLink ?? undefined } : {}),
            ...('semantics' in edit ? { semantics: semantics ?? undefined } : {}),
            ...('breakpoint' in edit ? { breakpoint: breakpoint ?? undefined } : {}),
            ...('breakpointSourceId' in edit ? { breakpointSourceId: breakpointSourceId ?? undefined } : {}),
            ...('instanceGrid' in edit ? { instanceGrid:instanceGrid ?? undefined }:{}),
            ...('strokeTopWidth' in edit ? { strokeTopWidth:strokeTopWidth ?? undefined }:{}),
            ...('strokeRightWidth' in edit ? { strokeRightWidth:strokeRightWidth ?? undefined }:{}),
            ...('strokeBottomWidth' in edit ? { strokeBottomWidth:strokeBottomWidth ?? undefined }:{}),
            ...('strokeLeftWidth' in edit ? { strokeLeftWidth:strokeLeftWidth ?? undefined }:{}),
            ...('minWidth' in edit ? { minWidth: minWidth ?? undefined } : {}),
            ...('maxWidth' in edit ? { maxWidth: maxWidth ?? undefined } : {}),
            ...('minHeight' in edit ? { minHeight: minHeight ?? undefined } : {}),
            ...('maxHeight' in edit ? { maxHeight: maxHeight ?? undefined } : {}),
          }
        }))
        .max(500)
        .default([]),
      deleteNodeIds: z.array(z.uuid()).max(500).default([]),
      variables: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string(),
              value: color,
              alpha: z.number().min(0).max(1).optional(),
              alphaSource: alphaSourceSchema,
              aliasId: z.uuid().nullable().optional(),
            })
            .strict(),
        )
        .max(500)
        .default([]),
      numberVariables: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string(),
              value: coordinate,
              unit: z.enum(['px', 'number']),
              expression:numberExpressionSchema.nullable().optional(),
              aliasId: z.uuid().nullable().optional(),
            })
            .strict(),
        )
        .max(500)
        .default([]),
    })
    .strict()
    .parse(changes)
  parsed.upsertNodes = parsed.upsertNodes.map((edit) => {
    const cleared = (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)
      .filter(key => key in edit && edit[key] === undefined)
    if (!cleared.length) return edit
    const bindings = edit.numericBindings ?? document.nodes.find(node => node.id === edit.id)?.numericBindings ?? {}
    return { ...edit, numericBindings: Object.fromEntries(Object.entries(bindings).filter(([key]) =>
      !cleared.some(property => property === key))) }
  })
  const deletes = new Set(parsed.deleteNodeIds)
  for (const id of deletes)
    if (!document.nodes.some(n => n.id === id))
      throw new Error(`Layer not found: ${id}`)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const node of document.nodes)
      if (
        node.parentId &&
        deletes.has(node.parentId) &&
        !deletes.has(node.id)
      ) {
        deletes.add(node.id)
        expanded = true
      }
  }
  const edits = new Map(parsed.upsertNodes.map(n => [n.id, n]))
  if (edits.size !== parsed.upsertNodes.length)
    throw new Error('Duplicate layer edits')
  if (parsed.upsertNodes.some(n => deletes.has(n.id)))
    throw new Error('A layer cannot be updated and deleted together')
  const sizingResetIds = new Set<string>()
  for (const reset of parsed.resetInstanceSizing) {
    if (sizingResetIds.has(reset.nodeId)) throw new Error('Duplicate instance sizing resets')
    sizingResetIds.add(reset.nodeId)
    if (deletes.has(reset.nodeId)) throw new Error('A layer cannot be reset and deleted together')
    const edit = edits.get(reset.nodeId)
    const properties = new Set(reset.properties ?? DESIGN_INSTANCE_SIZING_KEYS)
    const touched = edit ? DESIGN_INSTANCE_SIZING_KEYS.filter(key => key in edit ||
      key in (edit.numericBindings ?? {})) : []
    if (edit && ('width' in edit || 'width' in (edit.numericBindings ?? {})) && !('widthSizing' in edit)) touched.push('widthSizing')
    if (edit && ('height' in edit || 'height' in (edit.numericBindings ?? {})) && !('heightSizing' in edit)) touched.push('heightSizing')
    if (edit && ('instanceSizingOverrides' in edit || touched.some(key => properties.has(key))))
      throw new Error('Instance sizing resets cannot also edit the same sizing properties or ownership mask')
  }
  const oldProperties = new Map(document.nodes.flatMap(node =>
    (node.componentProperties ?? []).map(property => [property.id, property] as const)))
  for (const node of parsed.upsertNodes) {
    const values = node.componentPropertyValues ?? []
    if (new Set(values.map(value => value.propertyId)).size !== values.length)
      throw new Error('Duplicate component property values')
    for (const property of node.componentProperties ?? [])
      if (oldProperties.has(property.id) && oldProperties.get(property.id)?.type !== property.type)
        throw new Error('Component property types are immutable; create a new property identity')
  }
  const existing = new Set(document.nodes.map(n => n.id))
  const merge = <T extends { id: string }>(
    current: readonly T[],
    updates: readonly T[],
  ): T[] => {
    const map = new Map(current.map(v => [v.id, v]))
    for (const value of updates) map.set(value.id, value)
    return [...map.values()]
  }
  const candidateBase = {
    ...document,
    nodes: [
      ...editDesignNodes(document, parsed.upsertNodes, { normalizeFill: false }).nodes.filter(
        n => !deletes.has(n.id),
      ).map(n => deletes.size && n.instanceOverrides ? {
        ...n, instanceOverrides: n.instanceOverrides.filter(o => !o.path.some(id => deletes.has(id))),
      } : n),
      ...parsed.upsertNodes.filter(n => !existing.has(n.id)).map(n =>
        n.kind === 'instance' && (n.instanceLayout === null || n.instanceStroke === null) ? {
          ...n,
          numericBindings: Object.fromEntries(Object.entries(n.numericBindings ?? {}).filter(([key]) =>
            (n.instanceLayout !== null || !DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(property => property === key)) &&
            (n.instanceStroke !== null || !DESIGN_STROKE_NUMBER_KEYS.some(property => property === key)))),
        } : n),
    ],
    textStyles: merge(document.textStyles ?? [], parsed.textStyles),
    variables: merge(document.variables, parsed.variables),
    numberVariables: merge(
      document.numberVariables ?? [],
      parsed.numberVariables,
    ),
  }
  const modeEdits = new Map(parsed.upsertTokenModes.map(m => [m.id, m]))
  if (modeEdits.size !== parsed.upsertTokenModes.length)
    throw new Error('Duplicate token mode edits')
  const removedModes = new Set(parsed.deleteTokenModeIds)
  for (const id of removedModes)
    if (!document.tokenModes?.some(m => m.id === id) || modeEdits.has(id))
      throw new Error('Invalid token mode deletion')
  const oldModeIds = new Set(document.tokenModes?.map(m => m.id))
  const modeRecords = [
    ...(document.tokenModes ?? [])
      .filter(m => !removedModes.has(m.id))
      .map(m => ({ ...m, ...modeEdits.get(m.id) })),
    ...parsed.upsertTokenModes
      .filter(m => !oldModeIds.has(m.id))
      .map(m => ({ ...m, variables: [], numberVariables: [] })),
  ]
  let staged: CopyOSDesignDocument = {
    ...candidateBase,
    nodes: candidateBase.nodes.map(n => nodeSchema.parse(n)),
    ...(document.tokenModes !== undefined ||
    modeRecords.length ||
    parsed.deleteTokenModeIds.length
      ? { tokenModes: modeRecords.map(m => tokenModeSchema.parse(m)) }
      : {}),
    ...(parsed.activeTokenModeId !== undefined
      ? { activeTokenModeId: parsed.activeTokenModeId }
      : {}),
  }
  if (deletes.size) staged = reconcileDesignTextHyperlinks(document, staged)
  if (parsed.canvasBackground !== undefined) {
    const { canvasBackground: _background, ...rest } = staged
    staged = parsed.canvasBackground === null ? rest : { ...rest, canvasBackground: parsed.canvasBackground }
  }
  const pageBackgrounds = new Map(parsed.pageBackgroundChanges.map(change => [change.id, change.canvasBackground]))
  if (pageBackgrounds.size !== parsed.pageBackgroundChanges.length ||
    [...pageBackgrounds.keys()].some(id => !staged.pages?.some(page => page.id === id)))
    throw new Error('Invalid or duplicate page background edits')
  if (pageBackgrounds.size) staged = { ...staged, pages: staged.pages?.map((page) => {
    if (!pageBackgrounds.has(page.id)) return page
    const { canvasBackground: _background, ...rest } = page
    const background = pageBackgrounds.get(page.id)
    return background == null ? rest : { ...rest, canvasBackground: background }
  }) }
  const pageModeChanges = new Map(
    parsed.pageModeChanges.map(p => [p.id, p.tokenModeId]),
  )
  if (
    pageModeChanges.size !== parsed.pageModeChanges.length ||
    [...pageModeChanges.keys()].some(
      id => !staged.pages?.some(p => p.id === id),
    )
  )
    throw new Error('Invalid page mode changes')
  if (pageModeChanges.size)
    staged = {
      ...staged,
      pages: staged.pages?.map(p =>
        pageModeChanges.has(p.id)
          ? { ...p, tokenModeId: pageModeChanges.get(p.id) }
          : p,
      ),
    }
  const tokenEditIds = new Set<string>()
  for (const change of parsed.tokenChanges) {
    const modeId =
      change.modeId !== undefined
        ? change.modeId
        : (staged.activeTokenModeId ?? null)
    const key = change.kind + ':' + (modeId ?? 'base') + ':' + change.id
    if (tokenEditIds.has(key)) throw new Error('Duplicate token changes')
    tokenEditIds.add(key)
    if (change.kind === 'color' && change.inheritAlpha &&
      (change.inherit || change.alpha !== undefined || change.alphaSource !== undefined))
      throw new Error('Alpha inheritance cannot also specify alpha ownership or whole-resource inheritance')
    if (change.inherit) {
      if (change.value !== undefined || change.aliasId !== undefined || (change.kind==='number' && change.expression!==undefined) || (change.kind==='color' && (change.alpha!==undefined || change.alphaSource!==undefined)))
        throw new Error(
          'Inherited values cannot also specify a literal or alias',
        )
      staged = resetDesignModeVariable(staged, change.kind, change.id, modeId)
    } else {
      if (change.kind === 'color') {
        staged = setDesignColorVariable(
          staged,
          change.id,
          {
            ...(change.value !== undefined ? { value: change.value } : {}),
            ...(change.alpha !== undefined ? { alpha: change.alpha } : {}),
            ...(change.alphaSource !== undefined ? { alphaSource: change.alphaSource } : {}),
            ...(change.aliasId !== undefined
              ? { aliasId: change.aliasId }
              : {}),
          },
          modeId,
        )
        if (change.inheritAlpha) staged = resetDesignColorAlpha(staged, change.id, modeId)
      } else
        staged = setDesignNumberVariable(
          staged,
          change.id,
          {
            ...(change.value !== undefined ? { value: change.value } : {}),
            ...(change.expression !== undefined ? { expression:change.expression }:{}),
            ...(change.aliasId !== undefined
              ? { aliasId: change.aliasId }
              : {}),
          },
          modeId,
        )
    }
  }
  if (parsed.swapInstances.some(swap => parsed.upsertNodes.some(node => node.id === swap.nodeId &&
    ('componentId' in node || 'instanceOverrides' in node))))
    throw new Error('Instance swaps cannot also upsert componentId or instanceOverrides for the same instance')
  for (const reset of parsed.resetInstanceSizing) {
    if (staged.nodes.find(node => node.id === reset.nodeId)?.kind !== 'instance')
      throw new Error('Sizing resets require an existing linked instance')
    staged = resetDesignInstanceSizing(staged, reset.nodeId, reset.properties)
  }
  staged = normalizeDesignFillAuthoring(document, staged, parsed.upsertNodes)
  if (parsed.combineVariants.length || parsed.addVariants.length || parsed.configureComponentSets.length ||
    parsed.selectVariants.length || parsed.dissolveComponentSets.length)
    staged = parseDesignDocument(reconcileDesignVariants(
      document, reconcileDesignComponentProperties(document, staged), parsed.upsertNodes))
  const variantIdentities = new Set<string>()
  const reserveVariantIdentity = (id: string): void => {
    if (variantIdentities.has(id)) throw new Error('Duplicate new variant identity')
    variantIdentities.add(id)
  }
  const combinedMembers = new Set<string>()
  for (const combine of parsed.combineVariants) {
    reserveVariantIdentity(combine.setId)
    reserveVariantIdentity(combine.axisId)
    if (new Set(combine.componentIds).size !== combine.componentIds.length)
      throw new Error('Duplicate components in variant combination')
    for (const id of combine.componentIds) {
      if (combinedMembers.has(id)) throw new Error('A component may only be combined once per batch')
      combinedMembers.add(id)
      if (parsed.upsertNodes.some(node => node.id === id && ('parentId' in node || 'variantValues' in node)))
        throw new Error('Combining variants cannot also upsert their membership')
    }
    staged = combineDesignComponentsAsVariants(staged, combine.componentIds, randomUUID, {
      setId: combine.setId, axisId: combine.axisId,
      ...(combine.name !== undefined ? { name: combine.name } : {}),
      ...(combine.axisName !== undefined ? { axisName: combine.axisName } : {}),
    }).document
  }
  for (const add of parsed.addVariants) {
    reserveVariantIdentity(add.componentId)
    if (staged.nodes.some(node => node.id === add.componentId)) throw new Error('New variant identity already exists')
    const source = staged.nodes.find(node => node.id === add.sourceId)
    const standalone = source?.kind === 'component' &&
      staged.nodes.find(node => node.id === source.parentId)?.kind !== 'component-set'
    if (standalone && (!add.setId || !add.axisId))
      throw new Error('Adding a standalone variant requires stable setId and axisId')
    if (!standalone && (add.setId || add.axisId || add.name || add.axisName))
      throw new Error('Set authoring options require a standalone main component')
    if (add.setId) reserveVariantIdentity(add.setId)
    if (add.axisId) reserveVariantIdentity(add.axisId)
    staged = addDesignVariant(staged, add.sourceId, randomUUID, {
      componentId: add.componentId,
      ...(add.setId ? { setId: add.setId } : {}), ...(add.axisId ? { axisId: add.axisId } : {}),
      ...(add.name ? { name: add.name } : {}), ...(add.axisName ? { axisName: add.axisName } : {}),
    }).document
  }
  const configuredSets = new Set<string>()
  for (const configure of parsed.configureComponentSets) {
    if (configuredSets.has(configure.setId)) throw new Error('Duplicate component-set configurations')
    configuredSets.add(configure.setId)
    if (parsed.upsertNodes.some(node => (node.id === configure.setId && 'componentSet' in node) ||
      (configure.variants.some(member => member.componentId === node.id) && 'variantValues' in node)))
      throw new Error('Component-set configuration cannot also upsert its axis table or member values')
    staged = configureDesignComponentSet(staged, configure.setId, configure)
  }
  const selectedVariants = new Set<string>()
  for (const selection of parsed.selectVariants) {
    if (selectedVariants.has(selection.nodeId)) throw new Error('Duplicate variant selections')
    selectedVariants.add(selection.nodeId)
    if (parsed.swapInstances.some(swap => swap.nodeId === selection.nodeId) ||
      parsed.upsertNodes.some(node => node.id === selection.nodeId && ('componentId' in node || 'instanceOverrides' in node)))
      throw new Error('Variant selection cannot also swap or upsert component links or overrides')
  }
  staged = selectDesignVariants(staged, parsed.selectVariants)
  const dissolvedSets = new Set<string>()
  for (const setId of parsed.dissolveComponentSets) {
    if (dissolvedSets.has(setId) || configuredSets.has(setId) || parsed.combineVariants.some(item => item.setId === setId))
      throw new Error('Duplicate or contradictory component-set dissolution')
    dissolvedSets.add(setId)
    if (parsed.upsertNodes.some(node => (node.id === setId && ('componentSet' in node || 'parentId' in node)) ||
      (staged.nodes.find(member => member.id === node.id)?.parentId === setId && ('parentId' in node || 'variantValues' in node))))
      throw new Error('Dissolving a component set cannot also upsert its membership')
    staged = dissolveDesignComponentSet(staged, setId)
  }
  const cellPaths = new Set<string>()
  const cellEdits = new Map<string, { path: string[]; patch: import('./types.ts').CopyOSDesignInstanceGridCell | null }[]>()
  const readCell = parsed.instanceCellChanges.length ?
    createDesignInstanceGridCellReader(staged, undefined, { includeSourceCell: false }) : undefined
  for (const change of parsed.instanceCellChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.instanceId &&
      ('instanceOverrides' in node || 'componentId' in node)) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.instanceId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.instanceId))
      throw new Error('Instance cell edits cannot also replace the owning instance overrides or component')
    const instance = staged.nodes.find(node => node.id === change.instanceId)
    if (instance?.kind !== 'instance') throw new Error('Instance cell edits require an existing linked instance')
    const current = readCell?.(instance.id, change.path)
    if (!current) throw new Error('Missing instance cell target')
    if (current.locked) throw new Error('Instance cell target is locked')
    const effective = current.effectivePath
    const key = JSON.stringify([change.instanceId, effective])
    if (cellPaths.has(key)) throw new Error('Duplicate instance cell edit')
    cellPaths.add(key)
    const path = current.overridePath
    const patch = change.cell === null ? null : Object.fromEntries(
      Object.entries(change.cell).map(([field, value]) => [field, value === null ? undefined : value]),
    )
    const edits = cellEdits.get(change.instanceId) ?? []
    edits.push({ path, patch })
    cellEdits.set(change.instanceId, edits)
  }
  const gridPaths = new Set<string>()
  const gridEdits = new Map<string, { path: string[]; patch: import('./types.ts').CopyOSDesignInstanceGrid | null }[]>()
  const gridRecordPaths = new Map<string, Map<string, string[]>>()
  for (const change of parsed.instanceGridChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.instanceId &&
      ('instanceOverrides' in node || 'componentId' in node)) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.instanceId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.instanceId))
      throw new Error('Instance grid edits cannot also replace the owning instance overrides or component')
    const instance = staged.nodes.find(node => node.id === change.instanceId)
    if (instance?.kind !== 'instance') throw new Error('Instance grid edits require an existing linked instance')
    if (!designComponentOverrideTarget(staged, instance, change.path)) throw new Error('Missing instance grid target')
    let paths = gridRecordPaths.get(instance.id)
    if (!paths) {
      paths = new Map((instance.instanceOverrides ?? []).map(record => [
        JSON.stringify(designComponentPropertyContextPath(staged, instance, record.path) ?? record.path), record.path,
      ]))
      gridRecordPaths.set(instance.id, paths)
    }
    const effective = designComponentPropertyContextPath(staged, instance, change.path) ?? change.path
    const key = JSON.stringify([change.instanceId, effective])
    if (gridPaths.has(key)) throw new Error('Duplicate instance grid edit')
    gridPaths.add(key)
    const path = paths.get(JSON.stringify(effective)) ?? effective
    const patch = change.grid === null ? null : Object.fromEntries(
      Object.entries(change.grid).map(([field, value]) => [field, value === null ? undefined : value]),
    )
    const edits = gridEdits.get(change.instanceId) ?? []
    edits.push({ path, patch })
    gridEdits.set(change.instanceId, edits)
  }
  const layoutPaths = new Set<string>()
  const layoutEdits = new Map<string, (import('./design-instance-layout-context.ts').DesignInstanceLayoutPatch & { path: string[] })[]>()
  const layoutRecordPaths = new Map<string, Map<string, string[]>>()
  for (const change of parsed.instanceLayoutChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.instanceId &&
      ('instanceOverrides' in node || 'componentId' in node)) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.instanceId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.instanceId))
      throw new Error('Instance layout edits cannot also replace the owning instance overrides or component')
    const instance = staged.nodes.find(node => node.id === change.instanceId)
    if (instance?.kind !== 'instance') throw new Error('Instance layout edits require an existing linked instance')
    if (!designComponentOverrideTarget(staged, instance, change.path)) throw new Error('Missing instance layout target')
    let paths = layoutRecordPaths.get(instance.id)
    if (!paths) {
      paths = new Map((instance.instanceOverrides ?? []).map(record => [
        JSON.stringify(designComponentPropertyContextPath(staged, instance, record.path) ?? record.path), record.path,
      ]))
      layoutRecordPaths.set(instance.id, paths)
    }
    const effective = designComponentPropertyContextPath(staged, instance, change.path) ?? change.path
    const key = JSON.stringify([change.instanceId, effective])
    if (layoutPaths.has(key)) throw new Error('Duplicate instance layout edit')
    layoutPaths.add(key)
    const path = paths.get(JSON.stringify(effective)) ?? effective
    const normalize = (value: Record<string, unknown> | null | undefined) => value == null ? value :
      Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, entry === null ? undefined : entry]))
    const edits = layoutEdits.get(change.instanceId) ?? []
    edits.push({ path, layout: normalize(change.layout), layoutBindings: normalize(change.layoutBindings) })
    layoutEdits.set(change.instanceId, edits)
  }
  const blendPaths = new Set<string>()
  const blendEdits = new Map<string, { path: string[]; blendMode: import('./types.ts').CopyOSDesignLayerBlendMode | null }[]>()
  const blendRecordPaths = new Map<string, Map<string, string[]>>()
  for (const change of parsed.instanceBlendChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.instanceId &&
      ('instanceOverrides' in node || 'componentId' in node)) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.instanceId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.instanceId))
      throw new Error('Instance blend edits cannot also replace the owning instance overrides or component')
    const instance = staged.nodes.find(node => node.id === change.instanceId)
    if (instance?.kind !== 'instance') throw new Error('Instance blend edits require an existing linked instance')
    if (!designComponentOverrideTarget(staged, instance, change.path)) throw new Error('Missing instance blend target')
    let paths = blendRecordPaths.get(instance.id)
    if (!paths) {
      paths = new Map((instance.instanceOverrides ?? []).map(record => [
        JSON.stringify(designComponentPropertyContextPath(staged, instance, record.path) ?? record.path), record.path,
      ]))
      blendRecordPaths.set(instance.id, paths)
    }
    const effective = designComponentPropertyContextPath(staged, instance, change.path) ?? change.path
    const key = JSON.stringify([change.instanceId, effective])
    if (blendPaths.has(key)) throw new Error('Duplicate instance blend edit')
    blendPaths.add(key)
    const edits = blendEdits.get(instance.id) ?? []
    edits.push({ path: paths.get(JSON.stringify(effective)) ?? effective, blendMode: change.blendMode })
    blendEdits.set(instance.id, edits)
  }
  const layoutOwners = new Set([...cellEdits.keys(), ...gridEdits.keys(), ...layoutEdits.keys(), ...blendEdits.keys()])
  if (layoutOwners.size) staged = editDesignNodes(staged, [...layoutOwners].map((id) => {
    const instance = staged.nodes.find(node => node.id === id)
    if (!instance) throw new Error('Instance layout owner disappeared')
    const cells = mergeDesignInstanceGridCells(instance, cellEdits.get(id) ?? [])
    const grids = mergeDesignInstanceGridConfigs(cells, gridEdits.get(id) ?? [])
    const layouts = mergeDesignInstanceLayouts(grids, layoutEdits.get(id) ?? [])
    const next = mergeDesignInstanceBlendModes(layouts, blendEdits.get(id) ?? [])
    return { id, instanceOverrides: next.instanceOverrides }
  }))
  staged = swapDesignInstances(staged, parsed.swapInstances)
  staged = reconcileDesignVariants(document, reconcileDesignComponentProperties(document, staged), parsed.upsertNodes)
  const strokeOwners = new Set<string>()
  for (const change of parsed.strokeChanges) {
    if (strokeOwners.has(change.nodeId)) throw new Error('Duplicate stroke edit')
    strokeOwners.add(change.nodeId)
    if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
      ('instanceStroke' in node || 'componentId' in node || strokeChangeKeys.some(key => key in node))) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.nodeId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.nodeId))
      throw new Error('Stroke edits cannot also replace stroke properties or component on the same layer')
    const node = staged.nodes.find(item => item.id === change.nodeId)
    if (!node) throw new Error('Stroke layer was not found')
    if (node.kind !== 'instance' && change.properties.strokeWidth === null)
      throw new Error('An ordinary layer requires strokeWidth; provide a value instead of resetting it')
    const patch = Object.fromEntries(Object.entries(change.properties).map(([key, value]) =>
      [key, value === null ? undefined : value])) as Partial<import('./types.ts').CopyOSDesignInstanceStroke>
    const widths = DESIGN_STROKE_NUMBER_KEYS.filter(key => Object.hasOwn(patch, key))
    staged = node.kind === 'instance' ? editDesignInstanceStroke(staged, node.id, patch) :
      editDesignNodes(staged, [{ id: node.id, ...patch, ...(widths.length ? { numericBindings: Object.fromEntries(
        Object.entries(node.numericBindings ?? {}).filter(([key]) => !widths.some(width => width === key)),
      ) } : {}) }])
  }
  const sizingOwners = new Set<string>()
  for (const change of parsed.sizingChanges) {
    const key = change.nodeId + ':' + change.axis
    if (sizingOwners.has(key)) throw new Error('Duplicate sizing axis edit')
    sizingOwners.add(key)
    if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
      (['componentId', 'instanceSizingOverrides', 'textSizing', ...DESIGN_INSTANCE_SIZING_KEYS].some(field => field in node) ||
        DESIGN_INSTANCE_SIZING_KEYS.some(field => field in (node.numericBindings ?? {})))) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.nodeId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.nodeId) ||
      parsed.resetInstanceSizing.some(reset => reset.nodeId === change.nodeId))
      throw new Error('Sizing edits cannot also replace sizing properties or component on the same layer')
    if (change.policy !== undefined) staged = setDesignSizingPolicy(staged, [change.nodeId], change.axis, change.policy)
    if (change.removeLimits) staged = clearDesignSizingLimits(staged, [change.nodeId], change.axis)
  }
  const aspectOwners = new Set<string>(), resizeOwners = new Set<string>()
  const conflictingSizing = (id: string): boolean => parsed.swapInstances.some(swap => swap.nodeId === id) ||
    parsed.selectVariants.some(selection => selection.nodeId === id) ||
    parsed.resetInstanceSizing.some(reset => reset.nodeId === id) ||
    parsed.sizingChanges.some(change => change.nodeId === id)
  for (const change of parsed.aspectRatioChanges) {
    if (aspectOwners.has(change.nodeId)) throw new Error('Duplicate aspect ratio edit')
    aspectOwners.add(change.nodeId)
    if (conflictingSizing(change.nodeId) || parsed.upsertNodes.some(node => node.id === change.nodeId &&
      ['targetAspectRatio', 'componentId', 'instanceOverrides', 'instanceSizingOverrides'].some(key => key in node)))
      throw new Error('Aspect ratio intent cannot replace ratio ownership, sizing or component in the same edit')
    staged = setDesignAspectRatio(staged, [change.nodeId], change.action)
  }
  for (const change of parsed.resizeChanges) {
    if (resizeOwners.has(change.nodeId)) throw new Error('Duplicate explicit resize')
    resizeOwners.add(change.nodeId)
    if (conflictingSizing(change.nodeId) || parsed.upsertNodes.some(node => node.id === change.nodeId &&
      (['targetAspectRatio', 'componentId', 'instanceOverrides', 'instanceSizingOverrides', 'textSizing',
        ...DESIGN_INSTANCE_SIZING_KEYS].some(key => key in node) ||
        DESIGN_INSTANCE_SIZING_KEYS.some(key => key in (node.numericBindings ?? {})))))
      throw new Error('Explicit resize cannot also replace dimensions, sizing, ratio or component on the same layer')
    staged = resizeDesignAspectAxis(staged, [change.nodeId], change.axis, change.value)
  }
  const styleTransaction = parsed.effectStyles.length > 0 || parsed.deleteEffectStyleIds.length > 0 || parsed.effectStyleChanges.length > 0
  const effectResourceTransaction = styleTransaction || parsed.effectChanges.length > 0 &&
    (parsed.tokenChanges.length > 0 || parsed.numberVariables.length > 0 || parsed.variables.length > 0 ||
      parsed.upsertTokenModes.length > 0 || parsed.deleteTokenModeIds.length > 0)
  const applyEffects = (candidate: CopyOSDesignDocument): CopyOSDesignDocument => {
    if (parsed.effectChanges.length + parsed.effectStyleChanges.length > 500) throw new Error('Effect edits exceed 500 targets')
    for (const change of [...parsed.effectChanges, ...parsed.effectStyleChanges]) {
      if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
        ['effects', 'effectStyleId', 'shadow', 'componentId', 'instanceOverrides'].some(key => key in node)) ||
        parsed.swapInstances.some(swap => swap.nodeId === change.nodeId) ||
        parsed.selectVariants.some(selection => selection.nodeId === change.nodeId))
        throw new Error('Effect edits cannot also replace the owning effects, style, legacy shadow, component or overrides')
    }
    const changes = [...parsed.effectChanges, ...parsed.effectStyleChanges.map((change) => {
      const target = { nodeId: change.nodeId, path: change.path }
      return change.action === 'bind' ? { ...target, effectStyleId: change.styleId } :
        change.action === 'detach' ? { ...target, detachStyle: true as const } : { ...target, effects: null }
    })]
    return styleTransaction ? editDesignEffectStyleResources(candidate, {
      upsertStyles: parsed.effectStyles, removeStyleIds: parsed.deleteEffectStyleIds, changes,
    }) : changes.length ? editDesignEffectsBatch(candidate, changes) : candidate
  }
  if (effectResourceTransaction) {
    // Only this admission view defers effect constraints; the original authored fields enter the shared planner and final full parse.
    const unbound = (effects: CopyOSDesignDocument['nodes'][number]['effects']) =>
      effects?.map((effect) => {
        const { numericBindings: _bindings, ...literal } = effect
        if (literal.type === 'layer-blur') return literal
        const { colorVariableId: _colorVariableId, ...unboundShadow } = literal
        return unboundShadow
      })
    parseDesignDocument({ ...staged,
      ...(styleTransaction ? { effectStyles: staged.effectStyles?.map(style => ({ ...style, effects: [] })) } : {}),
      nodes: staged.nodes.map(node => ({ ...node,
        ...(styleTransaction ? { effectStyleId: undefined } : {}),
        effects: styleTransaction ? node.effects && [] : unbound(node.effects),
        instanceOverrides: node.instanceOverrides?.map(record => ({ ...record,
          ...(styleTransaction ? { effectStyleId: undefined } : {}),
          effects: styleTransaction
            ? (record.effects !== undefined || record.effectStyleId !== undefined ? [] : undefined) : unbound(record.effects),
        })),
      })),
    })
    staged = applyEffects(staged)
  }
  const validated = parseDesignDocument(staged)
  const candidate = parsed.ignoreConstraintsFor.length
    ? parseDesignDocument(
      ignoreDesignChildConstraints(
        document,
        validated,
        parsed.ignoreConstraintsFor,
      ),
    )
    : validated
  const changed = new Set<string>()
  const strokePaints = new Map<string, import('./types.ts').CopyOSDesignPaint[]>()
  const nodes = new Map(candidate.nodes.map(n => [n.id, n]))
  for (const update of parsed.paintUpdates) {
    const key = update.nodeId + ':' + update.channel + ':' + update.paintId
    if (changed.has(key)) throw new Error('Duplicate paint edits')
    changed.add(key)
    const node = nodes.get(update.nodeId)
    if (!node) throw new Error(`Layer not found: ${update.nodeId}`)
    const paints = update.channel === 'stroke'
      ? strokePaints.get(node.id) ?? designAuthoredStrokePaints(candidate, node.id) : designNodePaints(node)
    const paint = paints.find(p => p.id === update.paintId)
    if (!paint) throw new Error(`Paint not found: ${update.paintId}`)
    if ((update.imageSizing || update.imageSettings) && !paint.image)
      throw new Error('Paint has no image')
    const edited = paints.map(p => p.id !== paint.id ? p : {
      ...p,
      opacity: update.opacity ?? p.opacity,
      visible: update.visible ?? p.visible,
      ...('blendMode' in update ? { blendMode: update.blendMode } : {}),
      ...(p.image && (update.imageSizing || update.imageSettings) ? { image: {
        ...p.image, ...update.imageSettings,
        ...(update.imageSizing ? { scaleMode: update.imageSizing } : {}),
      } } : {}),
    })
    if (update.channel === 'stroke') strokePaints.set(node.id, edited)
    else nodes.set(node.id, { ...node, gradient: undefined, fills: edited })
  }
  let result = parsed.paintUpdates.length
    ? parseDesignDocument({ ...candidate, nodes: [...nodes.values()] })
    : candidate
  for (const [nodeId, paints] of strokePaints) result = editDesignStrokePaints(result, nodeId, paints)
  const crops = new Set<string>()
  for (const crop of parsed.cropImages) {
    if (crops.has(crop.nodeId))
      throw new Error('A layer can only be cropped once per batch')
    crops.add(crop.nodeId)
    result = parseDesignDocument(
      cropDesignImage(result, crop.nodeId, crop.paintId, crop, crop.channel),
    )
  }
  for (const change of parsed.pathChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.nodeId && 'pathData' in node))
      throw new CopyOSDesignError('Path edits cannot also upsert pathData for the same layer')
    const owner = result.nodes.find(node => node.id === change.nodeId)
    if (owner?.kind !== 'path' || !owner.pathData)
      throw new CopyOSDesignError('Path edits require a stored path layer')
    const byId = new Map(result.nodes.map(node => [node.id, node]))
    const seen = new Set<string>()
    let ancestor: typeof owner | undefined = owner
    while (ancestor && !seen.has(ancestor.id)) {
      if (ancestor.locked) throw new CopyOSDesignError('Path layer or ancestor is locked')
      seen.add(ancestor.id)
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
    }
    const pathData = change.action === 'join-endpoints'
      ? joinDesignPathEndpoints(owner.pathData, change.targets)
      : change.action === 'move-anchors'
        ? moveDesignPathAnchors(owner.pathData, change.targets, change.dx, change.dy)
        : change.action === 'delete-anchors'
          ? deleteDesignPathAnchors(owner.pathData, change.targets, change.mode)
          : change.action === 'move-point'
            ? moveDesignPathPoint(owner.pathData, change.target, change.x, change.y)
            : change.action === 'delete-anchor'
              ? deleteDesignPathAnchor(owner.pathData, { pathIndex: change.pathIndex, commandIndex: change.commandIndex }, change.mode)
              : splitDesignPathSegment(owner.pathData, change.pathIndex, change.commandIndex, change.t)
    result = { ...result, nodes: result.nodes.map(node => node.id === owner.id ? { ...node, pathData } : node) }
  }
  if (parsed.pathChanges.length) result = parseDesignDocument(result)
  for (const change of parsed.fontVariationChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
      ('fontVariations' in node || 'componentId' in node || 'instanceOverrides' in node)))
      throw new CopyOSDesignError('Cannot combine font variation changes with same-owner variation or instance upserts')
    result = editDesignFontVariations(result, change.nodeId, change.path, change.variations)
  }
  for (const change of parsed.fontFeatureChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
      ('fontFeatures' in node || 'componentId' in node || 'instanceOverrides' in node)))
      throw new CopyOSDesignError('Cannot combine OpenType changes with same-owner feature or instance upserts')
    result = editDesignFontFeatures(result, change.nodeId, change.path, change.features)
  }
  for (const change of parsed.textRangeChanges) {
    if (parsed.upsertNodes.some(node => node.id === change.nodeId &&
      ('text' in node || 'textRuns' in node || 'componentId' in node || 'instanceOverrides' in node)) ||
      parsed.swapInstances.some(swap => swap.nodeId === change.nodeId) ||
      parsed.selectVariants.some(selection => selection.nodeId === change.nodeId))
      throw new Error('Text range edits cannot also replace the owning text, runs, component or overrides')
    result = 'inherit' in change ? resetDesignTextRuns(result, change.nodeId, change.path) :
      editDesignTextRange(result, change.nodeId, change.path, {
        start: change.start, end: change.end,
        ...(change.text !== undefined ? { text: change.text } : {}),
        ...(change.style !== undefined ? { style: change.style } : {}),
      })
  }
  if (!effectResourceTransaction) result = applyEffects(result)
  if (parsed.fontVariationChanges.length || parsed.fontFeatureChanges.length ||
    parsed.textRangeChanges.length || parsed.effectChanges.length) result = parseDesignDocument(result)
  const previous = new Map(document.nodes.map(node => [node.id, node]))
  const finalNodes = new Map(result.nodes.map(node => [node.id, node]))
  for (const patch of parsed.upsertNodes) {
    const before = previous.get(patch.id), node = finalNodes.get(patch.id)
    if (!before || !node) continue
    const source = node.kind === 'instance' ? finalNodes.get(node.componentId ?? '') : undefined
    const explicit = source ? applyDesignInstanceStroke(source, node).strokes : node.strokes
    if (explicit === undefined) continue
    const colorChanged = (patch.stroke !== undefined && patch.stroke !== before.stroke) ||
      (patch.strokeVariableId !== undefined && patch.strokeVariableId !== before.strokeVariableId) ||
      (patch.instanceStroke?.stroke !== undefined && patch.instanceStroke.stroke !== before.instanceStroke?.stroke) ||
      (patch.instanceStroke?.strokeVariableId !== undefined &&
        patch.instanceStroke.strokeVariableId !== before.instanceStroke?.strokeVariableId)
    const paintsSupplied = node.kind === 'instance' ? patch.instanceStroke?.strokes !== undefined : patch.strokes !== undefined
    if (colorChanged && !paintsSupplied)
      throw new Error('Edit stroke paint data instead of scalar stroke colors on a layer with an explicit stroke stack')
  }
  for (const node of result.nodes) {
    if (node.kind !== 'instance' || finalNodes.get(node.componentId ?? '')?.layout !== 'grid') continue
    const old = previous.get(node.id)
    const gap = node.instanceLayout?.gap
    if (gap !== undefined && gap < 0 && gap !== old?.instanceLayout?.gap)
      throw new Error('New grid instance gap overrides must be nonnegative')
    const binding = node.numericBindings?.gap
    if (binding && binding !== old?.numericBindings?.gap &&
      !designNumberTokenSupportsProperty(result, binding, 'gap', { layout: 'grid' }))
      throw new Error('New grid instance gap bindings must be nonnegative in every mode')
  }
  for (const node of result.nodes) {
    if (node.kind !== 'instance') continue
    const records = (node.instanceOverrides ?? []).filter(record =>
      (record.layout?.gap !== undefined && record.layout.gap < 0) || record.layoutBindings?.gap)
    if (!records.length) continue
    const old = previous.get(node.id)
    const oldRecords = new Map((old?.instanceOverrides ?? []).filter(record =>
      (record.layout?.gap !== undefined && record.layout.gap < 0) || record.layoutBindings?.gap).map(record => [
      JSON.stringify(old && record.path.length > 1
        ? designComponentPropertyContextPath(document, old, record.path) ?? record.path : record.path), record,
    ]))
    for (const record of records) {
      const path = record.path.length === 1 ? record.path :
        designComponentPropertyContextPath(result, node, record.path) ?? record.path
      const before = oldRecords.get(JSON.stringify(path)), gap = record.layout?.gap, binding = record.layoutBindings?.gap
      const newNegative = gap !== undefined && gap < 0 && gap !== before?.layout?.gap
      const newBinding = binding && binding !== before?.layoutBindings?.gap ? binding : undefined
      if (!newNegative && !newBinding) continue
      if (designInstanceLayoutContext(result, node.id, path)?.sourceLayout.layout !== 'grid') continue
      if (newNegative) throw new Error('New descendant grid gap overrides must be nonnegative')
      if (newBinding && !designNumberTokenSupportsProperty(result, newBinding, 'gap', { layout: 'grid' }))
        throw new Error('New descendant grid gap bindings must be nonnegative in every mode')
    }
  }
  let selection: readonly string[] | undefined
  if (parsed.autoLayoutChanges.reduce((sum, change) => sum + (change.action === 'layout-version' ?
    (change.scope.type === 'selection' ? change.scope.nodeIds.length : 1) : change.action === 'padding' || change.action === 'cell-align' ? change.targets.length : change.action === 'align' ?
      (change.targets ?? change.nodeIds ?? []).length : change.nodeIds.length), 0) > 500)
    throw new Error('Auto layout commands exceed 500 selected layers')
  for (const change of parsed.autoLayoutChanges) {
    if (change.action !== 'padding' && change.action !== 'cell-align' && change.action !== 'layout-version' && change.nodeIds && new Set(change.nodeIds).size !== change.nodeIds.length) throw new Error('Duplicate auto layout selection')
    if (change.action === 'suggest') {
      if ((result.activeTokenModeId ?? null) !== change.modeId ||
        designAutoLayoutSuggestionFingerprint(result, change.nodeIds, change.seed) !== change.reviewedFingerprint)
        throw new Error('Suggest input changed since review; inspect the suggestion again before applying')
      const suggestion = suggestDesignAutoLayout(result, change.nodeIds, designAutoLayoutSuggestionIds(change.seed))
      result = suggestion.document
      selection = suggestion.selection
    } else if (change.action === 'cell-align') {
      const intent = change.intent
      if (intent.type === 'step') result = setDesignGridCellAlignment(result, change.targets, intent)
      else if (intent.horizontal !== undefined) result = setDesignGridCellAlignment(result, change.targets, {
        type: 'spatial', horizontal: intent.horizontal, ...(intent.vertical === undefined ? {} : { vertical: intent.vertical }),
      })
      else if (intent.vertical !== undefined) result = setDesignGridCellAlignment(result, change.targets, { type: 'spatial', vertical: intent.vertical })
      else throw new Error('Cell alignment requires an axis')
    } else if (change.action === 'layout-version') {
      result = setDesignLayoutVersion(result, change.scope, change.model)
    } else if (change.action === 'padding') {
      const values = parseDesignPadding(change.value)
      if (!values) throw new Error('Padding requires 1..4 comma- or space-separated values in 0..10000, optionally px')
      result = setDesignAutoLayoutPadding(result, change.targets, values)
    } else if (change.action === 'align') {
      const intent = change.intent
      const targets = change.targets ?? change.nodeIds ?? []
      if (intent.type !== 'spatial') result = setDesignAutoLayoutAlignment(result, targets, intent)
      else if (intent.horizontal !== undefined) result = setDesignAutoLayoutAlignment(result, targets, {
        type: 'spatial', horizontal: intent.horizontal, ...(intent.vertical === undefined ? {} : { vertical: intent.vertical }),
      })
      else if (intent.vertical !== undefined) result = setDesignAutoLayoutAlignment(result, targets, {
        type: 'spatial', vertical: intent.vertical,
      })
      else throw new Error('Spatial alignment requires an axis')
    } else if (change.action === 'flow') {
      result = setDesignAutoLayoutFlow(result, change.nodeIds, change.flow)
    } else if (change.action === 'add') {
      const added = addDesignAutoLayout(result, change.nodeIds, change.frameId)
      result = added.document
      selection = [added.selection]
    } else {
      const context = designAutoLayoutContext(result, change.nodeIds)
      result = removeDesignAutoLayout(result, change.nodeIds, { recursive: change.recursive ?? false })
      selection = context.ids
    }
  }
  if (parsed.autoLayoutChanges.length) result = parseDesignDocument(result)
  if (parsed.booleanChanges.reduce((sum, change) => sum + (change.action === 'create' ? change.nodeIds.length : 1), 0) > 500)
    throw new CopyOSDesignError('Boolean commands exceed 500 selected layers')
  for (const change of parsed.booleanChanges) {
    const ownerId = change.action === 'create' ? change.id : change.nodeId
    if (parsed.upsertNodes.some(node => node.id === ownerId && ('kind' in node || 'booleanOperation' in node || 'pathData' in node)))
      throw new CopyOSDesignError('Boolean commands cannot also replace the same result kind, operation or geometry')
    if (change.action === 'create') {
      result = createDesignBoolean(result, change.nodeIds, change.operation, change.id)
      selection = [change.id]
    } else if (change.action === 'set-operation') {
      result = setDesignBooleanOperation(result, [change.nodeId], change.operation)
      selection = [change.nodeId]
    } else if (change.action === 'ungroup') {
      selection = result.nodes.filter(node => node.parentId === change.nodeId).map(node => node.id)
      result = ungroupDesignBoolean(result, change.nodeId)
    } else {
      result = flattenDesignBoolean(result, change.nodeId)
      selection = [change.nodeId]
    }
  }
  if (result.nodes.some(node => node.kind === 'boolean')) result = parseDesignDocument(fitDesignBooleans(result))
  else if (parsed.booleanChanges.length) result = parseDesignDocument(result)
  for (const change of parsed.sizeVariantChanges) {
    try {
      const created = createDesignSizeVariant(result, change.frameId, change, randomUUID)
      result = created.document
      selection = [created.frameId]
    } catch (error: unknown) { throw new CopyOSDesignError(error instanceof Error ? error.message : String(error)) }
  }
  for (const change of parsed.breakpointChanges) {
    try {
      const created = createDesignBreakpoint(result, change.frameId, change, randomUUID)
      result = created.document
      selection = [created.frameId]
    } catch (error: unknown) { throw new CopyOSDesignError(error instanceof Error ? error.message : String(error)) }
  }
  return { document: result, ...(selection ? { selection } : {}) }
}
