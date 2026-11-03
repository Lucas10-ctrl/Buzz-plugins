export { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
export { designBrandTypography } from './design-brand-typography.ts'
export { designImageAssetPaths, designImageAssetFiles, rewriteDesignImageAssetPaths, DESIGN_IMAGE_ASSET_PREFIX, DESIGN_IMAGE_ASSET_DIRECTORY, DESIGN_IMAGE_ASSET_MAX_BYTES, DESIGN_IMAGE_ASSET_MIME_TYPES, parseDesignImageAssetReference, designImageAssetReference, designImageDataExtension, mapDesignImageUrls, designImageUrls, resolveDesignImageUrls, isDesignImageData, isDesignImageAssetReference, type DesignImageAssetExtension, type DesignImageAssetReference } from './design-image-assets.ts'
export { designEditableTextSvg, type DesignSvgTextLine, type DesignSvgTextMeasurer, type DesignSvgTextOutliner } from './design-svg-text.ts'
export { designPageLinksValid } from './design-page-links.ts'
export { designPathBounds, type DesignPathBounds } from './design-boolean-geometry.ts'
export { designBooleansDocumentValid } from './design-boolean-validation.ts'
import { projectDesignBooleanGeometry, resizeDesignBooleanOperands } from './design-boolean.ts'
export { designBooleanSelection, createDesignBoolean, setDesignBooleanOperation, ungroupDesignBoolean, flattenDesignBoolean, fitDesignBooleans, projectDesignBooleanGeometry, type DesignBooleanSelectionReason } from './design-boolean.ts'
export { canJoinDesignPathEndpoints, joinDesignPathEndpoints, moveDesignPathAnchors, deleteDesignPathAnchors, deleteDesignPathAnchor, parseDesignPathContours, nearestDesignPathSegmentParameter, moveDesignPathPoint, splitDesignPathSegment, type CopyOSDesignPathData, type DesignPathPointTarget, type DesignPathContour, type DesignPathAnchor, type DesignPathHandle, type DesignPathSegment } from './design-path-edit.ts'
export { editDesignFontVariations } from './design-font-variations-authoring.ts'
export { designFontVariationsSchema, normalizeDesignFontVariations, designFontVariationSettings } from './design-font-variations.ts'
export { editDesignFontFeatures } from './design-font-features-authoring.ts'
export { designFontFeaturesSchema, normalizeDesignFontFeatures, designFontFeatureSettings } from './design-font-features.ts'
import { mapDesignSemanticsTargets, mapDesignTextHyperlinks } from './design-text-hyperlink.ts'
export { designTextHyperlinkSchema, designTextHyperlinkUrlAllowed, designTextHyperlink, mapDesignTextHyperlinks, mapDesignSemanticsTargets, reconcileDesignTextHyperlinks } from './design-text-hyperlink.ts'
export { designSemanticsSchema, designSemanticsIssues, designSemanticsStructureIssues, DESIGN_SEMANTIC_HEADINGS, DESIGN_SEMANTIC_LANDMARKS,
  DESIGN_SEMANTIC_LISTS, DESIGN_SEMANTIC_STRUCTURE, DESIGN_SEMANTIC_LABEL_MAX_LENGTH, DESIGN_SEMANTIC_CONTROLS, DESIGN_SEMANTIC_COMMANDS,
  DESIGN_SEMANTIC_POPOVER_ELEMENTS, DESIGN_SEMANTIC_GROUP_MAX_LENGTH, DESIGN_SEMANTIC_FORMS, DESIGN_SEMANTIC_FIELD_TYPES,
  DESIGN_SEMANTIC_FIELD_NAME_MAX_LENGTH } from './design-semantics.ts'
export type { DesignSemanticsStructureIssue } from './design-semantics.ts'
export { createDesignBreakpoint, designBreakpointFrames, createDesignSizeVariant, syncDesignBreakpointContent } from './design-breakpoints.ts'
export { packDesignExportBundle, type DesignExportBundleFile } from './design-export-bundle.ts'
export type { DesignBreakpointOptions } from './design-breakpoints.ts'
export { rebaseDesignDocument, type DesignRebaseConflict, type DesignRebaseResult } from './design-rebase.ts'
import { designAuthoredEffects, resolveDesignEffects, applyDesignEffectStyle } from './design-effect-values.ts'
import { designEffectsFilter, designEffectsPassFilter, designEffectsLayerFilter, designLayerBlurFilter } from './design-effects-render.ts'
import { applyDesignInstanceEffects } from './design-effects.ts'
export { designNodeEffects, designNodeLayerBlur, designEffectsContext, createDesignEffectsReader, editDesignEffects, editDesignEffectsBatch,
  designEffectsDocumentValid,
  designEffectsSchema, designDropShadowSchema, designInnerShadowSchema, designShadowSchema, designLayerBlurSchema, designEffectSchema, applyDesignInstanceEffects, DesignEffectsEditError, type DesignEffectsContext, type DesignEffectsCurrentContext, type DesignEffectsReadContext, type DesignEffectsChange } from './design-effects.ts'
export { designEffectSpreadSupported, designEffectsBounds, designEffectsShadowBoxes, designEffectsFilter,
  designEffectsPassFilter, designEffectsLayerFilter, designLayerBlurFilter,
  type DesignEffectsBox, type DesignEffectsFilter } from './design-effects-render.ts'
export { designTextHtmlContent, type DesignTextHtmlOptions } from './design-text-html.ts'
import { reconcileDesignTextRuns } from './design-text-range.ts'
import { rebaseDesignTextRuns } from './design-text-runs.ts'
export { designTextHyperlinkContext, designTextRangeContext, editDesignTextRange, resetDesignTextRuns, type DesignTextRangeContext, type DesignTextRangeEdit, designTextRunsDocumentValid } from './design-text-range.ts'
export { normalizeDesignTextRuns, designTextSegments, replaceDesignTextRange, rebaseDesignTextRuns, styleDesignTextRange,
  designTextBoundary, type DesignTextSegment, type DesignTextRunStylePatch } from './design-text-runs.ts'
export { designNodeCss, DESIGN_NODE_CSS_WARNING_CODES, DESIGN_NODE_CSS_REQUIREMENT_CODES,
  type DesignNodeCssOptions, type DesignNodeCssProjection, type DesignNodeCssWarning, type DesignNodeCssRequirement } from './design-node-css.ts'
export { DESIGN_STROKE_STYLE_KEYS, designStrokeCapSchema, designStrokeJoinSchema, designStrokeMiterLimitSchema,
  designStrokeDashesSchema, designStrokeDashOffsetSchema, designStrokeSupportsAdvanced, designStrokeAlignmentSupported,
  designStrokeDashes, designStrokeStyle, designStrokeAlignment, designStrokeHasJoins } from './design-stroke-style.ts'
import { designLayerBlendStyle } from './design-layer-blend.ts'
export { DESIGN_LAYER_BLEND_MODES, designLayerBlendModeSchema, designNodeLayerBlendMode, designLayerBlendStyle,
  editDesignLayerBlendMode, mergeDesignInstanceBlendModes, editDesignInstanceBlendMode, designLayerBlendContext,
  type DesignLayerBlendContext } from './design-layer-blend.ts'
export { DESIGN_PAINT_BLEND_MODES, designPaintBlendModeSchema } from './design-paint-blend.ts'
import { designTextLinkSvg, designStrokePaintSvg, designTextFillSvg, designAuthoredStrokePaints, editDesignStrokePaints } from './design-stroke-paints.ts'
import { designEditableTextSvg, type DesignSvgTextMeasurer, type DesignSvgTextOutliner } from './design-svg-text.ts'
export { designNodeStrokePaints, designAuthoredStrokePaints, editDesignStrokePaints,
  designStrokePaintDefinition, designTextStrokeFilterDefinition, designStrokePaintSvg, designTextFillSvg, designTextLinkSvg } from './design-stroke-paints.ts'
import { resolveDesignDescendantLayout } from './design-descendant-layout.ts'
export { mergeDesignInstanceLayouts, editDesignInstanceLayoutContext, designInstanceLayoutContext,
  type DesignInstanceLayoutPatch, type DesignInstanceLayoutFields, type DesignInstanceLayoutReadContext } from './design-instance-layout-context.ts'
export { moveDesignInstanceGridTrack } from './design-instance-grid-reorder.ts'
import { designGridTrackMovePlan } from './design-grid-track-order.ts'
import { createDesignInstanceContextLookup, type DesignInstanceContext } from './design-instance-context.ts'
export { mergeDesignInstanceGridConfigs, editDesignInstanceGridConfig, designInstanceGridConfigContext,
  type DesignInstanceGridConfigContext } from './design-instance-grid-config.ts'
import { mergeDesignInstanceGridCell } from './design-instance-grid-cell.ts'
export { mergeDesignInstanceGridCell, mergeDesignInstanceGridCells, DESIGN_INSTANCE_GRID_CELL_KEYS } from './design-instance-grid-cell.ts'
import { mergeDesignInstanceGridCells } from './design-instance-grid-cell.ts'
export { mapDesignNumberExpressionReferences, designNumberExpressionValid, designNumberExpressionReferences, evaluateDesignNumberExpression, designNumberExpressionCss, designTokenCssNames, DESIGN_NUMBER_EXPRESSION_LIMITS, type DesignNumberExpressionValue, type DesignTokenCssNames } from './design-number-expression.ts'
import { applyDesignInstanceGrid, authoredDesignInstanceGrid, DESIGN_INSTANCE_GRID_KEYS } from './design-instance-grid.ts'
export { applyDesignInstanceGrid, DESIGN_INSTANCE_GRID_KEYS, designInstanceGridOwns } from './design-instance-grid.ts'
import { applyDesignInstanceStroke, DESIGN_STROKE_KEYS, DESIGN_STROKE_NUMBER_KEYS } from './design-stroke.ts'
export { applyDesignInstanceStroke, DESIGN_STROKE_KEYS, DESIGN_STROKE_NUMBER_KEYS, designStrokeGeometry, designStrokePaintGeometry, designStrokeWeights, designStrokeSupportsEdges, designInstanceStrokeOwns } from './design-stroke.ts'
export { captureDesignClipboard, importDesignClipboard, parseDesignClipboardSnapshot } from './design-clipboard.ts'
export { parseDesignDocument } from './design-schema.ts'
import { designResponsiveAspectSize, normalizeDesignAspectEdits, prepareDesignAspectBindings } from './design-aspect-ratio.ts'
export { designAspectRatioContext, setDesignAspectRatio, resizeDesignAspectAxis, constrainDesignAspectSize,
  designAspectRatioLimits, designAspectRatioEligible, type DesignAspectSize, type DesignAspectLimits,
  type DesignAspectRatioContext } from './design-aspect-ratio.ts'
/**
 * Browser-safe Page Designer scene editing and export.
 */
import { createDesignVisualBounds, type DesignNodeVisualBounds, type DesignVisualBox } from './design-visual-bounds.ts'
export { createDesignVisualBounds, type DesignVisualBox, type DesignNodeVisualBounds } from './design-visual-bounds.ts'
import { normalizeDesignFillAuthoring } from './design-fill-authoring.ts'
import { applyDesignInstanceLayout, DESIGN_INSTANCE_LAYOUT_KEYS, DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS, instanceLayoutEligibility } from './design-instance-layout.ts'
export { DESIGN_INSTANCE_LAYOUT_KEYS, DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS } from './design-instance-layout.ts'
export { swapDesignInstanceComponent, swapDesignInstances, designInstanceSwapCandidates, designInstanceSwapCandidateSummary } from './design-instance-swap.ts'
export { designSizingLimitsValid, designNodeSizingLimitsValid } from './design-size-validation.ts'
export { designSizingContext, setDesignSizingPolicy, clearDesignSizingLimits, type DesignSizingContext } from './design-sizing-authoring.ts'
import { resolveDesignInstanceSizing, markDesignInstanceSizingEdit, designInstanceSizingOwns } from './design-instance-sizing.ts'
export { DESIGN_INSTANCE_SIZING_KEYS, designInstanceSizingOwns, markDesignInstanceSizingEdit, resolveDesignInstanceSizing,
  resetDesignInstanceSizing, type DesignInstanceSizingProperty } from './design-instance-sizing.ts'
import { designComponentPropertyDefinitions } from './design-component-property-definitions.ts'
export { designComponentPropertyDefinitions, designComponentPropertyOwner, materializeDesignComponentPropertyDefinitions } from './design-component-property-definitions.ts'
import {
  applyDesignComponentDefaults, applyDesignComponentInstance, reconcileDesignComponentProperties,
  remapDesignComponentPropertyDefinitions, remapDesignComponentPropertyValues,
} from './design-component-properties.ts'
export {
  createDesignComponentProperty, editDesignComponentProperty, removeDesignComponentProperty,
  setDesignComponentPropertyValue, resetDesignComponentPropertyValue, designComponentPropertyValues,
  designComponentPropertyTargets, designComponentPropertyTargetSummary, designComponentPropertyTargetPage,
  reconcileDesignComponentProperties,
  designComponentOverrideTarget, designComponentPropertySwapCandidates, designComponentPropertySwapCandidateSummary,
  designReferencedComponentIds, designComponentPropertyContextPath,
  pruneDesignComponentProperties, remapDesignComponentPropertyDefinitions, remapDesignComponentPropertyValues,
} from './design-component-properties.ts'
export { designComponentGraphIssues, designComponentGraphValid, designComponentGraphDiagnostics, type DesignComponentGraphDiagnostic } from './design-component-graph.ts'
export { designComponentPropertiesValid, designComponentPropertyIssues } from './design-component-property-validation.ts'
import { designColorVariableCss, restoreDesignTokenColorLiterals } from './design-color.ts'
export { designColorVariableCss, designColorCssValue, designColorWithOpacity, restoreDesignTokenColorLiterals } from './design-color.ts'
import { reconcileDesignVariants, DESIGN_NODE_NAME_MAX_LENGTH } from './design-variant-names.ts'
export { reconcileDesignVariants, formatDesignVariantName, parseDesignVariantName, DESIGN_NODE_NAME_MAX_LENGTH } from './design-variant-names.ts'
import { completeDesignVariantDuplicate, remapDesignVariantMetadata } from './design-component-variants.ts'
export {
  combineDesignComponentsAsVariants, configureDesignComponentSet, designComponentSetDefault, designInstanceVariants,
  selectDesignVariants, addDesignVariant, dissolveDesignComponentSet, remapDesignVariantMetadata,
} from './design-component-variants.ts'
export { designVariantIssues, designVariantsValid } from './design-variant-validation.ts'
import { designNodeBaseline } from './design-baseline.ts'
import { designLayoutDocumentFields, partitionDesignRenderGroups, sameDesignItems, type DesignRenderPartition } from './design-render-groups.ts'
import { applyDesignTextLayoutMetrics } from './design-text-layout.ts'
export { designTextMeasurementCacheCharacters } from './design-text-measurement-cache.ts'
export { designTextMeasurementStatus } from './design-text-layout.ts'
export { measureDesignText, DesignMeasureTextError, type DesignMeasureTextOptions, type DesignMeasureTextResult } from './design-measure-text.ts'
export type { DesignTextMeasurementStatus } from './design-text-layout.ts'
export { designTextLayoutSignature } from './design-text-layout.ts'
export {
  designNodeBaseline,
  designTextBaselineSignature,
} from './design-baseline.ts'
import {
  designConstraintAxis,
  designConstraintPosition,
  designConstraintsActive,
} from './design-constraints.ts'
import {
  remapDesignInstanceOverrides,
} from './design-instance-overrides.ts'
export { designInstanceOverrideTarget } from './design-instance-overrides.ts'
export { remapDesignInstanceOverrides } from './design-instance-overrides.ts'
import { designTextOverflow } from './design-text-overflow.ts'
export { designTextOverflow, designTextOverflowSignature } from './design-text-overflow.ts'
export { designConstraintsActive } from './design-constraints.ts'
import {
  designImageGeometry,
  designImageToCrop,
  DESIGN_IMAGE_LIMITS,
  type DesignCropRect,
} from './design-image.ts'
export {
  designImageGeometry,
  designImageToCrop,
  DESIGN_IMAGE_LIMITS,
  rotateDesignImage,
  resizeDesignCropImage,
  resizeDesignCropRect,
  type DesignCropRect,
} from './design-image.ts'
import {
  defaultDesignGrid,
  designGridGeometry,
} from './design-grid.ts'
export {
  defaultDesignGrid,
  designGridGeometry,
  designGridPlacements,
  designGridTrackBlock,
  designGridDocumentValid,
} from './design-grid.ts'
import type {
  CopyOSDesignDocument,
  CopyOSDesignInstanceLayout,
  CopyOSDesignNode,
  CopyOSDesignNodeKind,
  CopyOSDesignNumberProperty,
  CopyOSDesignPaint,
  CopyOSDesignGradient,
  CopyOSDesignImagePaint,
  CopyOSDesignVariable,
  CopyOSDesignNumberVariable,
} from './types.ts'

import {
  designLayoutBox,
  designLayoutSize,
  designInstanceLayoutBoxes,
  type DesignLayoutBox,
} from './design-layout-box.ts'
export {
  designLayoutBox,
  designLayoutSize,
  designInstanceLayoutBoxes,
  type DesignLayoutBox,
} from './design-layout-box.ts'
export { designCanvasBackground, resolveDesignCanvasBackground, designCanvasBackgroundsValid,
  type ResolvedDesignCanvasBackground } from './design-canvas-background.ts'
import {
  designModeResources,
  designNodeModeIds,
  type DesignModeContext,
} from './design-token-modes.ts'
import {
  resolveDesignColorVariables,
  resolveDesignNumberVariables,
} from './design-token-values.ts'
export {
  resolveDesignColorVariables,
  resolveDesignModeColors,
  unbindDesignColorAlpha,
  resetDesignColorAlpha,
  designColorAlphaTokenAllowed,
  resolveDesignNumberVariables,
  designGridTrackTokenAllowed,
  designGridTrackTokens,
  designNumberPropertyLimits,
  designNumberTokenBounds,
  designTokenAliasAllowed,
  designTokenConfigurationValid,
  designNumberTokenSupportsProperty,
  importDesignStyleTokens,
  exportDesignCss,
} from './design-token-values.ts'
export { designCssNumber, designCssNumberRegistry } from './design-css-number.ts'

export {
  designNodeModeId,
  designNodeModeIds,
  removeDesignTokenMode,
  designModeResources,
  setDesignColorVariable,
  setDesignNumberVariable,
  resetDesignModeVariable,
} from './design-token-modes.ts'
export { importDesignStyleGuideTokens } from './design-token-mode-import.ts'

/**
 * Create a fully specified scene primitive.
 * @param kind - Primitive type.
 * @param id - Caller-created stable identity.
 * @param name - Layer name.
 * @returns an independent default node.
 */
export function createDesignNode(
  kind: CopyOSDesignNodeKind,
  id: string,
  name: string,
): CopyOSDesignNode {
  return {
    id,
    parentId: null,
    kind,
    name,
    x: 80,
    y: 80,
    width: kind === 'frame' ? 1200 : 240,
    height: kind === 'frame' ? 800 : kind === 'text' ? 60 : 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill:
      kind === 'frame' ? '#ffffff' : kind === 'text' ? '#20212b' : '#7564ed',
    stroke: kind==='component-set'?'#9955ff':'#000000',
    strokeWidth: kind==='component-set'?1:0,
    ...(kind==='component-set'?{ fillOpacity:0,strokeDash:4 }:{}),
    ...(kind==='boolean'?{ booleanOperation:'union' as const }:{}),
    radius: kind === 'rectangle' ? 12 : 0,
    text: '',
    fontFamily: 'Inter, sans-serif',
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1.3,
    textAlign: 'left',
    imageUrl: '',
    layout: 'none',
    ...(['frame', 'group', 'component', 'component-set'].includes(kind)
      ? { layoutSizingModel: 'css' as const }
      : {}),
    gap: 16,
    padding: 24,
    clip: kind === 'frame',
    componentId: null,
    fillVariableId: null,
    strokeVariableId: null,
  }
}

/**
 * Descendants in document order.
 * @param nodes - Scene.
 * @param id - Ancestor identity.
 * @returns descendant identities.
 */
export function designDescendants(
  nodes: readonly CopyOSDesignNode[],
  id: string,
): Set<string> {
  const result = new Set<string>()
  const pending = [id]
  while (pending.length) {
    const parent = pending.pop()
    for (const node of nodes)
      if (node.parentId === parent && !result.has(node.id)) {
        result.add(node.id)
        pending.push(node.id)
      }
  }
  return result
}

/** SVG transform shared by the canvas, crop overlays and exported node trees.
 * @param node - Layer geometry and reflection flags.
 * @returns Parent-relative transform with rotation and reflection around the layer center.
 */
export function designNodeTransform(node: CopyOSDesignNode): string {
  return `translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.width / 2} ${node.height / 2}) translate(${node.flipX ? node.width : 0} ${node.flipY ? node.height : 0}) scale(${node.flipX ? -1 : 1} ${node.flipY ? -1 : 1})`
}
/** Resolve sibling painting without changing the document's flow or layer order.
 * @param parent - Parent stack whose visual order may be reversed.
 * @param children - Children in authored document order.
 * @returns Back-to-front paint order; reversal only applies to horizontal or vertical stacks.
 */
export function designChildrenInPaintOrder(
  parent: CopyOSDesignNode,
  children: readonly CopyOSDesignNode[],
): readonly CopyOSDesignNode[] {
  return parent.itemReverseZIndex && ['row', 'column'].includes(parent.layout)
    ? [...children].reverse()
    : children
}
function stackBounds(
  items: readonly CopyOSDesignNode[],
  axis: 'width' | 'height',
  gap: number,
): { min: number; span: number } {
  let cursor = 0,
    min = 0,
    max = 0
  for (const child of items) {
    min = Math.min(min, cursor)
    max = Math.max(max, cursor + child[axis])
    cursor += child[axis] + gap
  }
  return { min, span: max - min }
}

/** Actual arranged flow line in the owning stack’s local cross axis. */
export interface DesignStackLine {
  nodeIds: string[]
  crossStart: number
  crossSize: number
  mainGapAutomatic: boolean
  crossGapAutomatic: boolean
}

/**
 * Lay out child nodes while retaining editable stored geometry.
 * @param nodes - Scene nodes.
 * @param boxes - Component-root metrics for instance sizing in their rendered modes.
 * @param instanceSize - Resolve linked content at natural or parent-allocated dimensions.
 * @param baselineResults - Optional output map of arranged first baselines.
 * @param stackLines - Optional output map of final arranged stack lines.
 * @returns computed positions and container sizes.
 */
export function layoutDesignNodes(
  nodes: readonly CopyOSDesignNode[],
  boxes: ReadonlyMap<string, DesignLayoutBox> = new Map(),
  instanceSize?: (
    node: CopyOSDesignNode,
    forced: Partial<{ width: number; height: number }>,
  ) =>
    | (Pick<CopyOSDesignNode, 'width' | 'height'> & { baseline?: number })
    | undefined,
  baselineResults?: Map<string, number>,
  stackLines?: Map<string, DesignStackLine[]>,
): CopyOSDesignNode[] {
  const result = nodes.map(node => ({ ...node }))
  const byId = new Map(result.map(n => [n.id, n]))
  const authored = new Map(nodes.map(n => [n.id, n]))
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of result) {
    if (!node.parentId || !node.visible) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const boxFor = (n: CopyOSDesignNode): DesignLayoutBox =>
    boxes.get(n.id) ?? designLayoutBox(n)
  const clamp = (
    n: CopyOSDesignNode,
    axis: 'width' | 'height',
    value: number,
  ): number => designLayoutSize(n, axis, value, boxFor(n))
  const dimensions = (n: CopyOSDesignNode) => {
    const row = n.layout === 'row',
      box = boxFor(n)
    return {
      row,
      main: row ? ('width' as const) : ('height' as const),
      cross: row ? ('height' as const) : ('width' as const),
      before: row ? box.left : box.top,
      after: row ? box.right : box.bottom,
      crossBefore: row ? box.top : box.left,
      crossAfter: row ? box.bottom : box.right,
    }
  }
  const instanceBaselines = new Map<string, number>()
  const baselineFor = (n: CopyOSDesignNode): number =>
    designNodeBaseline(n, children, instanceBaselines)
  const baselineExtent = (items: readonly CopyOSDesignNode[]): number =>
    Math.max(0, ...items.map(baselineFor)) +
    Math.max(0, ...items.map(c => c.height - baselineFor(c)))
  const resolveInstance = (
    n: CopyOSDesignNode,
    forced: Partial<{ width: number; height: number }>,
  ): void => {
    const metrics = instanceSize?.(n, forced)
    if (!metrics) return
    n.width = metrics.width
    n.height = metrics.height
    if (metrics.baseline !== undefined)
      instanceBaselines.set(n.id, metrics.baseline)
  }
  const natural = new Map<string, { width: number; height: number }>()
  const measure = (n: CopyOSDesignNode): void => {
    const all = children.get(n.id) ?? []
    for (const child of all) measure(child)
    if (n.kind === 'instance') resolveInstance(n, {})
    applyDesignTextLayoutMetrics(n)
    const textOverflow = designTextOverflow(n)
    if (textOverflow && n.textSizing && n.textSizing !== 'fixed')
      n.height = Math.min(n.height, textOverflow.height)
    if (n.kind !== 'instance' && n.layout === 'grid' && !n.preserveLayout) {
      const geometry = designGridGeometry(n, all, {}, boxes)
      n.width = geometry.width
      n.height = geometry.height
    } else if (
      n.kind !== 'instance' &&
      n.layout !== 'none' &&
      !n.preserveLayout
    ) {
      const d = dimensions(n),
        flow = all.filter(c => !c.absolutePosition)
      if ((n[`${d.main}Sizing`] ?? 'hug') === 'hug')
        n[d.main] = d.before + d.after + stackBounds(flow, d.main, n.gap).span
      if (n[`${d.cross}Sizing`] === 'hug')
        n[d.cross] =
          d.crossBefore +
          d.crossAfter +
          (d.row && n.alignItems === 'baseline'
            ? baselineExtent(flow)
            : Math.max(0, ...flow.map(c => c[d.cross])))
    }
    const aspect = designResponsiveAspectSize(n, {}, boxFor(n))
    if (aspect) { n.width = aspect.width; n.height = aspect.height }
    n.width = clamp(n, 'width', n.width)
    n.height = clamp(n, 'height', n.height)
    natural.set(n.id, { width: n.width, height: n.height })
  }
  const arrangeConstrained = (
    parent: CopyOSDesignNode,
    child: CopyOSDesignNode,
  ): void => {
    const rules = child.constraints
    if (!rules || !designConstraintsActive(child, parent)) {
      arrange(child)
      return
    }
    const width = natural.get(child.id)?.width ?? child.width,
      height = natural.get(child.id)?.height ?? child.height
    const origin = authored.get(child.id) ?? child
    const horizontal = designConstraintAxis(
        origin.x,
        width,
        rules.referenceWidth ?? parent.width,
        parent.width,
        rules.horizontal,
      ),
      vertical = designConstraintAxis(
        origin.y,
        height,
        rules.referenceHeight ?? parent.height,
        parent.height,
        rules.vertical,
      )
    const forced: Partial<{ width: number; height: number }> = {}
    if (rules.horizontal === 'scale' || rules.horizontal === 'left-right')
      forced.width = clamp(child, 'width', horizontal.length)
    if (rules.vertical === 'scale' || rules.vertical === 'top-bottom')
      forced.height = clamp(child, 'height', vertical.length)
    arrange(child, forced)
    const ratioAnchor = !!child.targetAspectRatio && (child.kind !== 'text' || !child.textSizing || child.textSizing === 'fixed')
    child.x = horizontal.position + (ratioAnchor ? rules.horizontal === 'right' ? width - child.width :
      rules.horizontal === 'center' ? (width - child.width) / 2 : 0 : 0)
    child.y = vertical.position + (ratioAnchor ? rules.vertical === 'bottom' ? height - child.height :
      rules.vertical === 'center' ? (height - child.height) / 2 : 0 : 0)
  }
  const arrange = (
    n: CopyOSDesignNode,
    forced: Partial<{ width: number; height: number }> = {},
  ): void => {
    const base = { ...n, ...natural.get(n.id) }
    const aspect = designResponsiveAspectSize(base, forced, boxFor(n))
    arrangeNode(n, aspect ? { width: aspect.width, height: aspect.height } : forced)
    baselineResults?.set(n.id, baselineFor(n))
  }
  const arrangeNode = (
    n: CopyOSDesignNode,
    forced: Partial<{ width: number; height: number }>,
  ): void => {
    stackLines?.delete(n.id)
    Object.assign(n, natural.get(n.id), forced)
    if (n.kind === 'instance') resolveInstance(n, forced)
    applyDesignTextLayoutMetrics(n, forced)
    n.width = clamp(n, 'width', n.width)
    n.height = clamp(n, 'height', n.height)
    const all = children.get(n.id) ?? []
    if (n.kind === 'instance' || n.layout === 'none' || n.preserveLayout) {
      for (const child of all) arrangeConstrained(n, child)
      return
    }
    if (n.layout === 'grid') {
      const fixed = {
        width: forced.width !== undefined,
        height: forced.height !== undefined,
      }
      const columns = designGridGeometry(n, all, fixed, boxes)
      n.width = columns.width
      n.height = columns.height
      const spanSize = (
        sizes: number[],
        index: number,
        span: number,
        gap: number,
      ): number =>
        sizes
          .slice(index, index + span)
          .reduce((sum, value) => sum + value, 0) +
        Math.max(0, span - 1) * gap
      for (const p of columns.placements) {
        const child = byId.get(p.id)
        if (child)
          arrange(
            child,
            child.widthSizing === 'fill'
              ? {
                width: clamp(
                  child,
                  'width',
                  spanSize(columns.columns, p.column, p.columnSpan, n.gap),
                ),
              }
              : {},
          )
      }
      const rows = designGridGeometry(n, all, { ...fixed, width: true }, boxes)
      n.height = rows.height
      for (const p of columns.placements) {
        const child = byId.get(p.id)
        if (!child) continue
        const width = spanSize(columns.columns, p.column, p.columnSpan, n.gap)
        const height = spanSize(
          rows.rows,
          p.row,
          p.rowSpan,
          n.crossGap ?? n.gap,
        )
        const size: Partial<{ width: number; height: number }> = {}
        if (child.widthSizing === 'fill')
          size.width = clamp(child, 'width', width)
        if (child.heightSizing === 'fill')
          size.height = clamp(child, 'height', height)
        arrange(child, size)
        const alignX = child.gridCell?.horizontalAlign ?? 'start',
          alignY = child.gridCell?.verticalAlign ?? 'start'
        child.x =
          (columns.columnOffsets[p.column] ?? 0) +
          (alignX === 'center'
            ? (width - child.width) / 2
            : alignX === 'end'
              ? width - child.width
              : 0)
        child.y =
          (rows.rowOffsets[p.row] ?? 0) +
          (alignY === 'center'
            ? (height - child.height) / 2
            : alignY === 'end'
              ? height - child.height
              : 0)
        child.gridCell = {
          ...child.gridCell,
          column: p.column + 1,
          row: p.row + 1,
          columnSpan: p.columnSpan,
          rowSpan: p.rowSpan,
        }
      }
      for (const child of all)
        if (child.absolutePosition) arrangeConstrained(n, child)
      return
    }
    const d = dimensions(n),
      flow = all.filter(c => !c.absolutePosition)
    const mainHug =
      (n[`${d.main}Sizing`] ?? 'hug') === 'hug' && forced[d.main] === undefined
    const crossHug =
      n[`${d.cross}Sizing`] === 'hug' && forced[d.cross] === undefined
    const wrap =
      n.layoutWrap === 'wrap' &&
      (!mainHug ||
        (d.main === 'width' ? n.maxWidth : n.maxHeight) !== undefined)
    const capacity = Math.max(0, n[d.main] - d.before - d.after)
    const automatic =
      ['between', 'around', 'evenly'].includes(n.justifyContent ?? 'start') &&
      !mainHug
    const manualGap = automatic ? 0 : n.gap
    const lines: CopyOSDesignNode[][] = []
    let line: CopyOSDesignNode[] = [],
      used = 0,
      minCursor = 0,
      maxEdge = 0
    for (const child of flow) {
      const basis = natural.get(child.id)?.[d.main] ?? child[d.main]
      if (
        wrap &&
        line.length &&
        Math.max(maxEdge, used + manualGap + basis) -
          Math.min(minCursor, used + manualGap) >
          capacity + 0.00001
      ) {
        lines.push(line)
        line = []
        used = 0
        minCursor = 0
        maxEdge = 0
      }
      const start = used + (line.length ? manualGap : 0)
      minCursor = Math.min(minCursor, start)
      maxEdge = Math.max(maxEdge, start + basis)
      used = start + basis
      line.push(child)
    }
    if (line.length) lines.push(line)
    const crossGap = n.crossGap ?? Math.max(0, n.gap)
    const baseline = d.row && n.alignItems === 'baseline'
    const naturalCross = lines.map(items =>
      baseline
        ? baselineExtent(items)
        : Math.max(
          0,
          ...items.map(c => natural.get(c.id)?.[d.cross] ?? c[d.cross]),
        ),
    )
    const crossSpace = Math.max(0, n[d.cross] - d.crossBefore - d.crossAfter)
    const stretch =
      !crossHug && n.alignContent === 'stretch' && lines.length
        ? Math.max(
          0,
          crossSpace -
              naturalCross.reduce((a, b) => a + b, 0) -
              Math.max(0, lines.length - 1) * crossGap,
        ) / lines.length
        : 0
    const lineCross: number[] = []
    for (const [index, items] of lines.entries()) {
      const filling = mainHug
        ? []
        : items.filter(c => c[`${d.main}Sizing`] === 'fill')
      const assigned = new Map<string, number>()
      let available =
        capacity -
        Math.max(0, items.length - 1) * manualGap -
        items
          .filter(c => !filling.includes(c))
          .reduce(
            (sum, c) => sum + (natural.get(c.id)?.[d.main] ?? c[d.main]),
            0,
          )
      let pending = [...filling]
      const contentInset = (child: CopyOSDesignNode): number => {
        if (n.layoutSizingModel !== 'css') return 0
        const box = boxFor(child)
        return d.main === 'width' ? box.left + box.right : box.top + box.bottom
      }
      // Freeze bounded outer sizes before sharing the remaining content area.
      while (pending.length) {
        const share =
          (available - pending.reduce((sum, c) => sum + contentInset(c), 0)) /
          pending.length
        const constrained = pending.filter(
          c =>
            clamp(c, d.main, share + contentInset(c)) !==
            share + contentInset(c),
        )
        if (!constrained.length) {
          for (const c of pending) assigned.set(c.id, share + contentInset(c))
          break
        }
        for (const c of constrained) {
          const size = clamp(c, d.main, share + contentInset(c))
          assigned.set(c.id, size)
          available -= size
        }
        pending = pending.filter(c => !assigned.has(c.id))
      }
      const allocatedCross =
        !crossHug && lines.length === 1
          ? crossSpace
          : (naturalCross[index] ?? 0) + stretch
      for (const child of items) {
        const size: Partial<{ width: number; height: number }> = {}
        const main = assigned.get(child.id)
        if (main !== undefined) size[d.main] = main
        if (child[`${d.cross}Sizing`] === 'fill')
          size[d.cross] = clamp(child, d.cross, allocatedCross)
        arrange(child, size)
      }
      lineCross.push(
        Math.max(
          baseline && crossHug ? 0 : allocatedCross,
          baseline ? baselineExtent(items) : 0,
          ...items.map(c => c[d.cross]),
        ),
      )
    }
    if (mainHug)
      n[d.main] = clamp(
        n,
        d.main,
        d.before +
          d.after +
          Math.max(
            0,
            ...lines.map(items => stackBounds(items, d.main, manualGap).span),
          ),
      )
    const packedCross =
      lineCross.reduce((sum, size) => sum + size, 0) +
      Math.max(0, lines.length - 1) * crossGap
    if (crossHug)
      n[d.cross] = clamp(n, d.cross, d.crossBefore + d.crossAfter + packedCross)
    const crossFree = Math.max(
      0,
      n[d.cross] - d.crossBefore - d.crossAfter - packedCross,
    )
    const between =
      n.alignContent === 'between' && lines.length > 1
        ? crossFree / (lines.length - 1)
        : 0
    let crossCursor =
      d.crossBefore +
      (n.alignContent === 'center'
        ? crossFree / 2
        : n.alignContent === 'end'
          ? crossFree
          : 0)
    const arrangedLines: DesignStackLine[] = []
    for (const [index, items] of lines.entries()) {
      arrangedLines.push({
        nodeIds: items.map(child => child.id),
        crossStart: crossCursor,
        crossSize: lineCross[index] ?? 0,
        mainGapAutomatic: automatic,
        crossGapAutomatic: !crossHug && n.alignContent === 'between' && lines.length > 1,
      })
      const packed = stackBounds(items, d.main, manualGap)
      const free = Math.max(0, n[d.main] - d.before - d.after - packed.span)
      const distribution = automatic ? n.justifyContent : undefined
      const gap =
        distribution === 'between'
          ? items.length > 1
            ? free / (items.length - 1)
            : 0
          : distribution === 'around'
            ? free / items.length
            : distribution === 'evenly'
              ? free / (items.length + 1)
              : manualGap
      const edge =
        distribution === 'between' && items.length === 1 && n.layoutSizingModel !== 'css'
          ? free / 2
          : distribution === 'around'
            ? gap / 2
            : distribution === 'evenly'
              ? gap
              : 0
      let cursor =
        d.before -
        packed.min +
        edge +
        (n.justifyContent === 'center'
          ? free / 2
          : n.justifyContent === 'end'
            ? free
            : 0)
      const lineBaseline = baseline ? Math.max(0, ...items.map(baselineFor)) : 0
      for (const child of items) {
        child[d.row ? 'x' : 'y'] = cursor
        const availableCross = Math.max(
          0,
          (lineCross[index] ?? 0) - child[d.cross],
        )
        child[d.row ? 'y' : 'x'] =
          crossCursor +
          (baseline
            ? lineBaseline - baselineFor(child)
            : n.alignItems === 'center'
              ? availableCross / 2
              : n.alignItems === 'end'
                ? availableCross
                : 0)
        cursor += child[d.main] + gap
      }
      crossCursor += (lineCross[index] ?? 0) + crossGap + between
    }
    stackLines?.set(n.id, arrangedLines)
    for (const child of all)
      if (child.absolutePosition) arrangeConstrained(n, child)
  }
  for (const node of result)
    if (node.parentId === null || !byId.has(node.parentId)) {
      measure(node)
      arrange(node)
    }
  return result
}

function cloneStrokePaintFields(node: CopyOSDesignNode, newId: () => string): Pick<CopyOSDesignNode, 'strokes' | 'instanceStroke' | 'strokeDashes' | 'effects' | 'effectStyleId'> {
  const clone = (paints: CopyOSDesignNode['strokes']) => paints?.map(paint => ({ ...structuredClone(paint), id: newId(),
    gradient: paint.gradient && { ...structuredClone(paint.gradient), stops: paint.gradient.stops.map(stop => ({ ...stop, id: newId() })) },
  }))
  const effects = node.effectStyleId ? undefined : node.effects &&
    designAuthoredEffects(node.effects).map(effect => ({ ...effect, id: newId() }))
  return { effectStyleId: node.effectStyleId, effects,
    strokeDashes: node.strokeDashes && [...node.strokeDashes], strokes: clone(node.strokes), instanceStroke: node.instanceStroke && {
      ...structuredClone(node.instanceStroke), strokes: clone(node.instanceStroke.strokes),
    } }
}
/**
 * Clone a subtree with fresh identities.
 * @param document - Current design.
 * @param id - Root to duplicate.
 * @param newId - Identity allocator.
 * @returns complete cloned scene.
 */
export function duplicateDesignNode(
  document: CopyOSDesignDocument,
  id: string,
  newId: () => string,
): CopyOSDesignNode[] {
  const source = document.nodes.find(n => n.id === id)
  if (!source) throw new Error('Layer not found')
  const ids = designDescendants(document.nodes, id)
  ids.add(id)
  const mapping = new Map([...ids].map(value => [value, newId()]))
  for (const node of document.nodes) if (ids.has(node.id))
    for (const property of node.componentProperties ?? []) mapping.set(property.id,newId())
  for (const node of document.nodes) if (ids.has(node.id))
    for (const axis of node.componentSet?.axes ?? []) mapping.set(axis.id,newId())
  const mapped = (value: string): string => {
    const id = mapping.get(value)
    if (!id) throw new Error('Invalid subtree identity')
    return id
  }
  const visible =
    resolveDesignNodes(document).find(n => n.id === id) ?? source
  const shifted = editDesignNodes(document, [
    { id, x: visible.x + 32, y: visible.y + 32 },
  ])
  const clones = shifted.nodes
    .filter(n => ids.has(n.id))
    .map(n => ({
      ...n,
      ...cloneStrokePaintFields(n, newId),
      fontFeatures: n.fontFeatures?.map(feature => ({ ...feature })),
      fontVariations: n.fontVariations?.map(variation => ({ ...variation })),
      textRuns: mapDesignTextHyperlinks(n.textRuns?.map(run => ({ ...run, style: { ...run.style,
        ...(run.style.fontVariations !== undefined
          ? { fontVariations: run.style.fontVariations.map(variation => ({ ...variation })) } : {}),
        ...(run.style.fontFeatures !== undefined ? { fontFeatures: run.style.fontFeatures.map(feature => ({ ...feature })) } : {}) } })), target => target.type === 'NODE' && mapping.has(target.value) ?
        { ...target, value: mapping.get(target.value) ?? target.value } : target),
      semantics: mapDesignSemanticsTargets(n, target => target.type === 'NODE' && mapping.has(target.value) ?
        { ...target, value: mapping.get(target.value) ?? target.value } : target),
      breakpoint: undefined, breakpointSourceId: undefined,
      id: mapped(n.id),
      parentId:
        n.id === id
          ? n.parentId
          : n.parentId === null
            ? null
            : mapped(n.parentId),
      name: n.id === id && n.name.length+5<=DESIGN_NODE_NAME_MAX_LENGTH ? `${n.name} copy` : n.name,
      x: n.x,
      y: n.y,
      componentId:
        n.componentId === null
          ? null
          : (mapping.get(n.componentId) ?? n.componentId),
      ...remapDesignVariantMetadata(n,mapping),
      componentProperties: remapDesignComponentPropertyDefinitions(n.componentProperties,mapping),
      componentPropertyValues: remapDesignComponentPropertyValues(n.componentPropertyValues,mapping,
        designComponentPropertyDefinitions(document,n.componentId ?? '')),
      instanceOverrides: remapDesignInstanceOverrides(
        n.instanceOverrides,
        mapping, newId,
      ),
    }))
  const combined = [...document.nodes,...clones].map(node => node.id === source.parentId && node.kind === 'component-set' ? {
    ...node, componentProperties: node.componentProperties?.map(property => ({ ...property,
      targets: [...property.targets, ...property.targets.filter(path => path[0] === source.id).map(path => path
        .map(value => mapping.get(value) ?? value))],
    })),
  } : node)
  const nodes=completeDesignVariantDuplicate(document,id,combined,mapped(id))
  return reconcileDesignVariants(document,{ ...document,nodes }).nodes
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  )
}
/**
 * Build a standalone SVG from the computed scene, including linked component instances.
 * @param document - Complete design.
 * @param pageId - Optional page to export.
 * @param options - Explicit link activation opt-in, an optional top-level artboard exported exactly at its frame rectangle, and an
 * optional text measurer: measured text layers become `<text>`/`<tspan>` lines that design tools import as editable text, and
 * attribute-free wrapper groups are omitted. With `textOutline` as well, measured lines are drawn by that callback (for example as
 * glyph outlines for renderers without the Canvas fonts) instead of `<text>`. With `region` (scene coordinates), layers whose
 * painted bounds, including effects, lie entirely outside it are left out; the markup inside the region is unchanged.
 * @returns SVG markup.
 * @throws {Error} If an exported page or artboard is a linked Page Builder screen, or the artboard is not a visible top-level frame.
 */
export function exportDesignSvg(
  document: CopyOSDesignDocument,
  pageId?: string,
  options: {
    links?: boolean
    artboard?: string
    editableText?: DesignSvgTextMeasurer
    textOutline?: DesignSvgTextOutliner
    region?: DesignVisualBox
  } = {},
): string {
  if (document.nodes.some(node => node.pageLink && (options.artboard === undefined ? pageId === undefined ||
    (node.pageId ?? document.pages?.[0]?.id ?? '') === pageId : node.id === options.artboard)))
    throw new Error('Linked page screens must be exported through Builder until a shared page renderer is available.')
  const scene = createDesignRenderScene(document)
  const artboard = options.artboard === undefined ? undefined : scene.root.byId.get(options.artboard)
  if (options.artboard !== undefined && (artboard?.kind !== 'frame' || artboard.parentId !== null || !artboard.visible))
    throw new Error('Exact-size export requires a visible top-level frame')
  const roots = artboard ? [artboard] : scene.root.nodes.filter(node => node.parentId === null && node.visible &&
    (pageId === undefined || (node.pageId ?? document.pages?.[0]?.id ?? '') === pageId))
  // An artboard export is its frame rectangle; effects outside it are clipped like a placed ad.
  const { x, y, width, height } = artboard ? artboard : createDesignVisualBounds(scene).roots(roots)
  const renderer = designSvgRenderer(scene, options.editableText, options.textOutline, options.region)
  const layers = roots.map(node => renderer.render(node, new Set(), undefined, '', options.links ?? false)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"><title>${escapeXml(document.title)}</title><defs>${[...renderer.definitions.values()].join('')}</defs>${layers}</svg>`
}

/** Render inert original text glyphs for a direct SourceAlpha-only shadow pass.
 * @param node - Effective text layer with current mode, mixed runs and overflow already resolved.
 * @param namespace - Caller-owned unique paint/filter namespace, separate from actual visible text.
 * @returns Safe original fill/stroke glyph markup without editability, callbacks, layer transform, opacity or effects.
 */
export function designTextEffectsSourceSvg(node: CopyOSDesignNode, namespace: string): string {
  return node.kind === 'text' ? designTextFillSvg(node, namespace) + designStrokePaintSvg(node, namespace) : ''
}

/** SVG affine matrix `[a, b, c, d, e, f]`, mapping (x, y) to (a·x + c·y + e, b·x + d·y + f). */
export type DesignSvgMatrix = [number, number, number, number, number, number]
function designSvgMultiply([a, b, c, d, e, f]: DesignSvgMatrix, [g, h, i, j, k, l]: DesignSvgMatrix): DesignSvgMatrix {
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]
}
/** Compose a layer's `designNodeTransform` onto its parent's scene matrix.
 * @param parent - The parent layer's scene matrix; identity for top-level layers.
 * @param node - Layer whose position, rotation and flips apply inside the parent.
 * @returns Matrix mapping the layer's local coordinates to scene coordinates.
 */
export function designSvgNodeMatrix(parent: DesignSvgMatrix, node: CopyOSDesignNode): DesignSvgMatrix {
  const angle = (node.rotation * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const cx = node.width / 2, cy = node.height / 2
  const rotate: DesignSvgMatrix = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
  const flip: DesignSvgMatrix = [node.flipX ? -1 : 1, 0, 0, node.flipY ? -1 : 1, node.flipX ? node.width : 0, node.flipY ? node.height : 0]
  return designSvgMultiply(designSvgMultiply(designSvgMultiply(parent, [1, 0, 0, 1, node.x, node.y]), rotate), flip)
}
/** Report whether a layer's painted box, or its effect region when larger, can reach a scene region; a layer without bounds cannot. */
function designSvgBoxMeetsRegion(matrix: DesignSvgMatrix, bounds: DesignNodeVisualBounds, region: DesignVisualBox): boolean {
  const box = bounds.filter ?? bounds.visual
  if (!box) return false
  const xs: number[] = [], ys: number[] = []
  const corners = [[box.x, box.y], [box.x + box.width, box.y],
    [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]] as const
  for (const [x, y] of corners) {
    xs.push(matrix[0] * x + matrix[2] * y + matrix[4]); ys.push(matrix[1] * x + matrix[3] * y + matrix[5])
  }
  return Math.min(...xs) <= region.x + region.width && Math.max(...xs) >= region.x &&
    Math.min(...ys) <= region.y + region.height && Math.max(...ys) >= region.y
}
/** Shared paint/filter definitions keep sampled sources free of nested definition copies or foreignObject use shadow trees. */
function designSvgRenderer(scene: ReturnType<typeof createDesignRenderScene>, editableText?: DesignSvgTextMeasurer,
  textOutline?: DesignSvgTextOutliner, region?: DesignVisualBox): {
  render: (node: CopyOSDesignNode, seen: Set<string>, context?: DesignRenderContext, prefix?: string, linksEnabled?: boolean,
    parentMatrix?: DesignSvgMatrix) => string
  definitions: Map<string, string>
} {
  const visualBounds = createDesignVisualBounds(scene)
  const definitions = new Map<string, string>()
  const contextIds=new WeakMap<DesignRenderContext,number>()
  let nextContextId=0
  const render = (
    node: CopyOSDesignNode,
    seen: Set<string>,
    context = scene.root,
    prefix = '',
    linksEnabled = false,
    parentMatrix: DesignSvgMatrix = [1, 0, 0, 1, 0, 0],
  ): string => {
    let contextId=contextIds.get(context)
    if (contextId===undefined) { contextId=nextContextId++;contextIds.set(context,contextId) }
    const identity=String(contextId)+':'+node.id
    if (!node.visible || seen.has(identity) || seen.size>=64) return ''
    const matrix = designSvgNodeMatrix(parentMatrix, node)
    if (region && !designSvgBoxMeetsRegion(matrix, visualBounds.node(node, context), region)) return ''
    const visited = new Set(seen)
    visited.add(identity)
    const instance = scene.instance(node, context)
    const source = instance?.byId.get(node.componentId ?? '')
    const childMatrix = source ? designSvgMultiply(matrix, [node.width / source.width, 0, 0, node.height / source.height, 0, 0]) : matrix
    const current = instance ?? context
    const renderId = prefix + node.id
    const base = source ?? node
    const paints = designNodePaints(base)
    const gradient = base.kind === 'text' ? '' :
      paints
        .filter(p => p.gradient)
        .map(p =>
          p.gradient
            ? designGradientDefinition(
              p.gradient,
              `gradient-${renderId}-${p.id}`,
              [],
            )
            : '',
        )
        .join('') +
      paints
        .filter(p => p.image)
        .map(p =>
          p.image
            ? designImageDefinition(
              p.image,
              `image-${renderId}-${p.id}`,
              base.width,
              base.height,
            )
            : '',
        )
        .join('')
    const geometry = (attributes: string): string => {
      if ((base.kind === 'path' || base.kind === 'boolean') && base.pathData)
        return `<g transform="scale(${base.width / base.pathData.width} ${base.height / base.pathData.height})">${base.pathData.paths.map(path => `<path d="${escapeXml(path.d)}" fill-rule="${path.fillRule}" ${attributes}/>`).join('')}</g>`
      if (base.kind === 'ellipse')
        return `<ellipse cx="${base.width / 2}" cy="${base.height / 2}" rx="${base.width / 2}" ry="${base.height / 2}" ${attributes}/>`
      return `<path d="${designRectanglePath(base)}" ${attributes}/>`
    }
    let paintDefinitions = ''
    const separateDefinitions = (markup: string): string => markup.replace(/<defs>([\s\S]*?)<\/defs>/g, (_, content: string) => {
      paintDefinitions += content
      return ''
    })
    const lines = base.kind === 'text' ? editableText?.(base, renderId) : undefined
    // Editable text lines replace glyph strokes too, since those render through HTML that design tools drop.
    const strokeShape = lines ? '' : separateDefinitions(designStrokePaintSvg(base, renderId))
    let shape = paints.filter(p => p.visible).map(p => geometry(
      `fill="${p.image ? `url(#image-${renderId}-${p.id})` : p.gradient ? `url(#gradient-${renderId}-${p.id})` : escapeXml(p.color)}" fill-opacity="${p.opacity}" stroke="none" style="mix-blend-mode:${p.blendMode ?? 'normal'}"`,
    )).join('')
    if (base.kind === 'text') shape = lines ? textOutline?.(base, paints, lines) ?? designEditableTextSvg(base, paints, lines)
      : separateDefinitions(designTextFillSvg(base, renderId))
    // Editable-text exports omit attribute-free wrapper groups, which design tools import as extra layers.
    const group = (attributes: string, inner: string): string => editableText && !attributes ? inner : `<g${attributes}>${inner}</g>`
    const scaleAttribute = editableText && (!source || node.width === source.width && node.height === source.height) ? '' : ` transform="${source ? `scale(${node.width / source.width} ${node.height / source.height})` : ''}"`
    const layerBlend = designLayerBlendStyle(node)
    const exteriorStroke = node.clip && base.strokeAlign !== 'inside' &&
      ['rectangle', 'ellipse', 'frame', 'component', 'component-set', 'image'].includes(base.kind) ? strokeShape : ''
    const children = designChildrenInPaintOrder(base, base.kind === 'boolean' ? [] : current.children.get(base.id) ?? [])
      .map(n => render(n, visited, current, source ? renderId + '-' : prefix, linksEnabled, childMatrix)).join('')
    const clip = `clip-${renderId}`
    const scale = source ? `scale(${node.width / source.width} ${node.height / source.height})` : ''
    const filterNode = { ...base, clip: node.clip }
    const bounds = visualBounds.node(node, context)
    const sourceBounds = bounds.content ?? { x: 0, y: 0, width: node.width, height: node.height }
    const sourceFill = base.kind === 'group' ? '' : shape
    const under = group(node.clip ? ` clip-path="url(#${clip})"` : '', group(scaleAttribute, sourceFill + children))
    const stroke = strokeShape ? group(node.clip && !exteriorStroke ? ` clip-path="url(#${clip})"` : '', group(scaleAttribute, strokeShape)) : ''
    const original = under + stroke
    const inner = designEffectsPassFilter(filterNode, `inner-${renderId}`, 'inner-shadow', undefined, sourceBounds)
    const filterMarkup = (filter: ReturnType<typeof designEffectsFilter>): string => filter ? `<filter id="${escapeXml(filter.id)}" filterUnits="userSpaceOnUse" x="${filter.x}" y="${filter.y}" width="${filter.width}" height="${filter.height}" color-interpolation-filters="sRGB">${filter.markup}</filter>` : ''
    const inertChildren = linksEnabled && base.kind === 'text' && inner ?
      designChildrenInPaintOrder(base, current.children.get(base.id) ?? [])
        .map(n => render(n, visited, current, source ? renderId + '-' : prefix, false, childMatrix)).join('') : children
    const sourceOriginal = inertChildren === children ? original :
      `<g${node.clip ? ` clip-path="url(#${clip})"` : ''}><g transform="${scale}">${sourceFill}${inertChildren}</g></g>${stroke}`
    const pass = (filter: ReturnType<typeof designEffectsFilter>): string => filter ? `<g aria-hidden="true" pointer-events="none" filter="url(#${escapeXml(filter.id)})">${sourceOriginal}</g>` : ''
    let content: string, filters: string
    if (inner && base.kind === 'text') {
      const drop = designEffectsPassFilter(filterNode, `shadow-${renderId}`, 'drop-shadow', undefined, sourceBounds, bounds.filter ?? undefined)
      filters = filterMarkup(drop) + filterMarkup(inner)
      content = pass(drop) + under + pass(inner) + stroke
    } else if (inner) {
      const strokeSourceId = `stroke-source-${renderId}`
      const ownStroke = strokeShape && base.kind !== 'group' ? strokeSourceId : undefined
      if (ownStroke) definitions.set(strokeSourceId, `<svg id="${strokeSourceId}" x="0" y="0" width="${sourceBounds.width}" height="${sourceBounds.height}" viewBox="${sourceBounds.x} ${sourceBounds.y} ${sourceBounds.width} ${sourceBounds.height}" overflow="visible">${stroke}</svg>`)
      const layer = designEffectsLayerFilter(filterNode, `effects-${renderId}`, sourceBounds, bounds.filter ?? undefined, ownStroke)
      if (!layer) throw new Error('Expected visible inner-shadow layer filter')
      filters = filterMarkup(layer)
      content = `<g filter="url(#${layer.id})"><rect x="${sourceBounds.x}" y="${sourceBounds.y}" width="${sourceBounds.width}" height="${sourceBounds.height}" fill="transparent"/>${under}${base.kind === 'group' ? stroke : ''}</g>${base.kind === 'group' ? '' : stroke}`
    } else {
      const drop = bounds.filter ? designEffectsFilter(filterNode, `shadow-${renderId}`, bounds.filter) : undefined
      filters = filterMarkup(drop)
      const legacyOriginal = group(node.clip ? ` clip-path="url(#${clip})"` : '', group(scaleAttribute,
        sourceFill + (exteriorStroke ? '' : strokeShape) + children)) + (exteriorStroke ? group(scaleAttribute, strokeShape) : '')
      content = group(drop ? ` filter="url(#${escapeXml(drop.id)})"` : '', legacyOriginal)
    }
    const layerBlur = designLayerBlurFilter(filterNode, `layer-blur-${renderId}`, bounds.filter ?? undefined)
    if (layerBlur) {
      filters += filterMarkup(layerBlur)
      content = `<g filter="url(#${escapeXml(layerBlur.id)})">${content}</g>`
    }
    definitions.set(`resources-${renderId}`, `${gradient}${paintDefinitions}${filters}<clipPath id="${clip}"><path d="${designRectanglePath({ ...base, width: node.width, height: node.height })}"/></clipPath>`)
    const linkOverlay = linksEnabled && node.opacity > 0 ? designTextLinkSvg(base) : ''
    const interaction = linkOverlay ? `<g${node.clip ? ` clip-path="url(#${clip})"` : ''}><g transform="${scale}">${linkOverlay}</g></g>` : ''
    const layerAttributes = ` id="copyos-node-${escapeXml(renderId)}" data-copyos-layer="${escapeXml(renderId)}" transform="${designNodeTransform(node)}" opacity="${node.opacity}"`
    const layerStyle = ` style="isolation:${layerBlend.isolation};mix-blend-mode:${layerBlend.mixBlendMode}"`
    // Editable-text exports put a single-element layer's attributes on that element; design tools import each <g> as a group.
    if (editableText && !interaction && layerBlend.isolation === 'auto' && layerBlend.mixBlendMode === 'normal' &&
      (/^<(?:path|ellipse)\b[^<>]*\/>$/.test(content) || /^<text\b/.test(content) && content.indexOf('<text', 1) === -1 &&
        content.endsWith('</text>')))
      return content.replace(/^<(path|ellipse|text)\b/, `<$1${layerAttributes}`)
    return `<g${layerAttributes}${layerStyle}>${content}${interaction}</g>`
  }
  return { render, definitions }
}

/**
 * Invert Figma's paint-space transform for SVG object-bounding-box gradients.
 * @param matrix - Stored affine coefficients.
 * @returns SVG affine transform.
 */
export function designGradientTransform(matrix: readonly number[]): string {
  return `matrix(${inversePaintMatrix(matrix).join(' ')})`
}

/** Resolve shared numeric values before layout, without rewriting stored fallback values.
 * @param document - Validated native scene.
 * @param context - Optional inherited mode for a rendered component subtree.
 * @param templates - Component library used by instances outside their rendered subtree.
 * @returns Rendered node geometry shared by Canvas, agent inspection and exports.
 */
export function resolveDesignNodes(
  document: CopyOSDesignDocument,
  context?: DesignModeContext,
  templates: readonly CopyOSDesignNode[] = document.nodes,
): CopyOSDesignNode[] {
  if (context || templates !== document.nodes) return resolveDesignTree(document, context, templates, new Map(), new Set())
  // Canvas inspector controls resolve the same document independently; callers receive copies they may adjust.
  // Boolean projection replaces only Boolean layers, so without them the incremental scene holds this resolution.
  if (!document.nodes.some(node => node.kind === 'boolean')) return createDesignRenderScene(document).root.nodes.map(node => ({ ...node }))
  const cached = resolvedDocuments.get(document)
  if (cached && cached.nodes === document.nodes && cached.length === document.nodes.length)
    return cached.resolved.map(node => ({ ...node }))
  const resolved = resolveDesignTree(document, context, templates, new Map(), new Set())
  resolvedDocuments.set(document, { nodes: document.nodes, length: document.nodes.length, resolved: resolved.map(node => ({ ...node })) })
  return resolved
}
const resolvedDocuments = new WeakMap<CopyOSDesignDocument,
  { nodes: readonly CopyOSDesignNode[]; length: number; resolved: readonly CopyOSDesignNode[] }>()

function resolveDesignTree(
  document: CopyOSDesignDocument,
  context: DesignModeContext | undefined,
  templates: readonly CopyOSDesignNode[],
  cache: Map<
    string,
    Pick<CopyOSDesignNode, 'width' | 'height'> & { baseline?: number }
  >,
  active: Set<string>,
  baselineResults?: Map<string, number>,
  stackLines?: Map<string, DesignStackLine[]>,
  propertiesPrepared = false,
  templateTrees: { roots: Map<string, CopyOSDesignNode[]>; children?: Map<string, CopyOSDesignNode[]> } = { roots: new Map() },
): CopyOSDesignNode[] {
  const modes = designNodeModeIds(document, context)
  const palettes = new Map<
    string | null,
    { colors: Map<string, string>; numbers: Map<string, number> }
  >()
  const palette = (mode: string | null) => {
    let values = palettes.get(mode)
    if (!values) {
      const resources = designModeResources(document, mode)
      values = {
        numbers: new Map(
          resolveDesignNumberVariables(resources.numberVariables).map(v => [
            v.id,
            v.value,
          ]),
        ),
        colors: new Map(
          resolveDesignColorVariables(resources.variables, resources.numberVariables).map(v => [
            v.id,
            designColorVariableCss(v),
          ]),
        ),
      }
      palettes.set(mode, values)
    }
    return values
  }
  const gradient = (
    g: CopyOSDesignGradient | undefined,
    colors: Map<string, string>,
  ): CopyOSDesignGradient | undefined =>
    g
      ? {
        ...g,
        stops: g.stops.map(s => ({
          ...s,
          color: colors.get(s.variableId ?? '') ?? s.color,
        })),
      }
      : undefined
  const styles = new Map(document.textStyles?.map(v => [v.id, v]))
  const effectStyles = new Map(document.effectStyles?.map(style => [style.id, style]))
  const preparedNodes=propertiesPrepared ? document.nodes : applyDesignComponentDefaults(document.nodes)
  return layoutDesignNodes(
    preparedNodes.map((prepared) => {
      const { colors, numbers } = palette(modes.get(prepared.id) ?? null)
      const n = applyDesignEffectStyle(resolveDesignDescendantLayout(prepared, numbers), effectStyles)
      const style = styles.get(n.textStyleId ?? '')
      const resolved = style
        ? {
          ...n,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          fontFeatures: n.fontFeatures ?? style.fontFeatures,
          fontVariations: n.fontVariations ?? style.fontVariations,
          fontStyle: style.fontStyle,
        }
        : { ...n }
      if (n.grid) {
        const track = (t: import('./types.ts').CopyOSDesignGridTrack) => ({
          ...t,
          value: numbers.get(t.variableId ?? '') ?? t.value,
        })
        resolved.grid = {
          ...n.grid,
          columns: n.grid.columns.map(track),
          rows: n.grid.rows.map(track),
          implicitRow: track(n.grid.implicitRow),
        }
      }
      resolved.effects = resolveDesignEffects(n.effects, numbers, colors)
      resolved.stroke = colors.get(n.strokeVariableId ?? '') ?? n.stroke
      resolved.fill = colors.get(n.fillVariableId ?? '') ?? n.fill
      if (n.gradient) resolved.gradient = gradient(n.gradient, colors)
      if (n.strokes) resolved.strokes = n.strokes.map(p => ({
        ...p, color: colors.get(p.variableId ?? '') ?? p.color, gradient: gradient(p.gradient, colors),
      }))
      if (n.fills)
        resolved.fills = n.fills.map(p => ({
          ...p,
          color: colors.get(p.variableId ?? '') ?? p.color,
          gradient: gradient(p.gradient, colors),
        }))
      for (const [key, id] of Object.entries(n.numericBindings ?? {})) {
        const value = numbers.get(id)
        if (value !== undefined)
          resolved[key as CopyOSDesignNumberProperty] = value
      }
      if (n.kind === 'instance') {
        const source = templates.find(template => template.id === n.componentId)
        if (source) {
          resolved.blendMode = n.blendMode ?? source.blendMode
          const effectSource = applyDesignEffectStyle(applyDesignInstanceEffects(source, prepared), effectStyles)
          Object.assign(resolved, { effects: resolveDesignEffects(effectSource.effects, numbers, colors),
            effectStyleId: effectSource.effectStyleId, shadow: source.shadow })
          resolved.targetAspectRatio = n.targetAspectRatio === undefined ? source.targetAspectRatio : n.targetAspectRatio
          const authoredGrid=authoredDesignInstanceGrid(source,n)
          if (authoredGrid) {
            const track=(value:import('./types.ts').CopyOSDesignGridTrack)=>({ ...value,value:numbers.get(value.variableId ?? '') ?? value.value })
            resolved.grid={ ...authoredGrid,columns:authoredGrid.columns.map(track),
              rows:authoredGrid.rows.map(track),implicitRow:track(authoredGrid.implicitRow) }
          } else resolved.grid=source.grid
          const authoredStroke=applyDesignInstanceStroke(source,n)
          for (const key of DESIGN_STROKE_KEYS) Object.assign(resolved,{ [key]:authoredStroke[key] })
          resolved.stroke=colors.get(authoredStroke.strokeVariableId ?? '') ?? authoredStroke.stroke
          resolved.strokes=authoredStroke.strokes?.map(p => ({ ...p,
            color:colors.get(p.variableId ?? '') ?? p.color,gradient:gradient(p.gradient,colors) }))
          for (const key of DESIGN_STROKE_NUMBER_KEYS) {
            const value=numbers.get(authoredStroke.numericBindings?.[key] ?? '')
            if (value!==undefined) resolved[key]=value
          }
          return prepareDesignAspectBindings(resolveDesignInstanceSizing(source, resolved, numbers), source)
        }
      }
      return resolved
    }),
    designInstanceLayoutBoxes({ ...document,nodes:preparedNodes }, context, templates),
    (node, forced) => {
      const source = templates.find(n => n.id === node.componentId)
      if (!source || active.size>=64) return undefined
      const modeId = modes.get(node.id) ?? null
      const widthSizing =
        forced.width === undefined && node.widthSizing === 'hug'
          ? 'hug'
          : 'fixed'
      const heightSizing =
        forced.height === undefined && node.heightSizing === 'hug'
          ? 'hug'
          : 'fixed'
      const width = forced.width ?? node.width,
        height = forced.height ?? node.height
      const key = JSON.stringify([
        source.id,
        modeId,
        widthSizing,
        heightSizing,
        width,
        height,
        node.minWidth,
        node.maxWidth,
        node.minHeight,
        node.maxHeight,
        node.instanceOverrides,
        node.blendMode,
        node.effects,
        node.componentPropertyValues,
        node.instanceGrid,
        node.instanceStroke,
        node.instanceLayout,
        node.numericBindings,
        node.instanceSizingOverrides,
        node.targetAspectRatio,
        node.preserveLayout,
      ])
      if (active.has(key)) return undefined
      const cached = cache.get(key)
      if (cached) return cached
      // Raw template structure is invocation-local; mode, size and overrides still use their distinct measurement keys.
      let sourceNodes = templateTrees.roots.get(source.id)
      if (!sourceNodes) {
        if (!templateTrees.children) {
          templateTrees.children = new Map()
          for (const node of templates) if (node.parentId) {
            const siblings = templateTrees.children.get(node.parentId) ?? []
            siblings.push(node); templateTrees.children.set(node.parentId, siblings)
          }
        }
        const ids = new Set<string>(), pending = [source.id]
        while (pending.length) {
          const id = pending.pop()
          if (!id || ids.has(id)) continue
          ids.add(id)
          for (const child of templateTrees.children.get(id) ?? []) pending.push(child.id)
        }
        sourceNodes = templates.filter(node => ids.has(node.id))
        templateTrees.roots.set(source.id, sourceNodes)
      }
      active.add(key)
      try {
        const baselines = new Map<string, number>()
        const nodes = resolveDesignTree(
          {
            ...document,
            nodes: applyDesignComponentInstance(
              sourceNodes, source, node, templates,
            ).map(n =>
              n.id === source.id
                ? {
                  ...applyDesignInstanceGrid(applyDesignInstanceStroke(
                    applyDesignInstanceLayout(n, node, palette(modeId).numbers), node),node),
                  blendMode: node.blendMode ?? n.blendMode,
                  effects: applyDesignInstanceEffects(n, node).effects,
                  effectStyleId: applyDesignInstanceEffects(n, node).effectStyleId,
                  targetAspectRatio: node.targetAspectRatio === undefined ? n.targetAspectRatio : node.targetAspectRatio,
                  ...(node.preserveLayout === false && (['width', 'height'] as const).some(axis =>
                    node[`${axis}Sizing`] === 'hug' && designInstanceSizingOwns(node, `${axis}Sizing`))
                    ? { preserveLayout: false } : {}),
                  parentId: null,
                  x: 0,
                  y: 0,
                  visible: true,
                  width,
                  height,
                  widthSizing,
                  heightSizing,
                  minWidth: node.minWidth,
                  maxWidth: node.maxWidth,
                  minHeight: node.minHeight,
                  maxHeight: node.maxHeight,
                  numericBindings: Object.fromEntries(
                    Object.entries(applyDesignInstanceStroke(
                      applyDesignInstanceLayout(n, node, palette(modeId).numbers), node,
                    ).numericBindings ?? {}).filter(
                      ([property]) =>
                        ![
                          'width',
                          'height',
                          'minWidth',
                          'maxWidth',
                          'minHeight',
                          'maxHeight',
                        ].includes(property),
                    ),
                  ),
                }
                : n,
            ),
          },
          { nodeId: source.id, modeId },
          templates,
          cache,
          active,
          baselines,
          undefined,
          true,
          templateTrees,
        )
        const root = nodes.find(n => n.id === source.id)
        if (!root) return undefined
        const size = {
          width: root.width,
          height: root.height,
          baseline: baselines.get(root.id) ?? root.height,
        }
        cache.set(key, size)
        return size
      } finally {
        active.delete(key)
      }
    },
    baselineResults,
    stackLines,
  )
}

/** Resolved context for one stored tree or one rendered component subtree. */
export interface DesignRenderContext {
  nodes: CopyOSDesignNode[]
  byId: Map<string, CopyOSDesignNode>
  children: Map<string | null, CopyOSDesignNode[]>
  modes: Map<string, string | null>
  stackLines: Map<string, DesignStackLine[]>
  layoutBoxes: ReadonlyMap<string, DesignLayoutBox>
}
type DesignRenderScene = {
  root: DesignRenderContext
  instance: (
    node: CopyOSDesignNode,
    context: DesignRenderContext,
  ) => DesignRenderContext | undefined
}
// Canvas, its inspector controls and agent inspection build scenes for the same immutable document.
const renderScenes = new WeakMap<CopyOSDesignDocument, { nodes: readonly CopyOSDesignNode[]; length: number; scene: DesignRenderScene }>()
/** Build shared layer indexes and lazily resolve component templates in instance modes.
 * @param document - Complete native design; repeated calls with the same unchanged document return the same scene.
 * @returns Root context and a cached context lookup for linked instances; callers must not modify either.
 */
export function createDesignRenderScene(document: CopyOSDesignDocument): DesignRenderScene {
  const cached = renderScenes.get(document)
  if (cached && cached.nodes === document.nodes && cached.length === document.nodes.length) return cached.scene
  const scene = buildDesignRenderScene(document)
  renderScenes.set(document, { nodes: document.nodes, length: document.nodes.length, scene })
  return scene
}
function buildDesignRenderScene(document: CopyOSDesignDocument): DesignRenderScene {
  const make = (
    scene: CopyOSDesignDocument,
    mode?: DesignModeContext,
    propertiesPrepared = false,
  ): DesignRenderContext => {
    const stackLines = new Map<string, DesignStackLine[]>()
    const nodes = projectDesignBooleanGeometry(resolveDesignTree(
      scene, mode, document.nodes, new Map(), new Set(), undefined, stackLines, propertiesPrepared,
    ))
    const children = new Map<string | null, CopyOSDesignNode[]>()
    for (const node of nodes) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }
    return {
      nodes,
      stackLines,
      byId: new Map(nodes.map(n => [n.id, n])),
      children,
      modes: designNodeModeIds(scene, mode),
      layoutBoxes: designInstanceLayoutBoxes({ ...scene,nodes }, mode, document.nodes),
    }
  }
  const partition = partitionDesignRenderGroups(document.nodes)
  const fields = designLayoutDocumentFields(document)
  const root = partition ? buildDesignRenderRoot(document, partition, fields, make) : make(document)
  // A context reads its instance layer, mode, template trees and layout fields; a reused instance layer object keeps its context.
  const kept = partition && renderInstanceContexts && sameDesignItems(renderInstanceContexts.fields, fields) &&
    sameDesignItems(renderInstanceContexts.templates, partition.templates) ? renderInstanceContexts.byNode
    : new WeakMap<CopyOSDesignNode, { key: string; context: DesignRenderContext }>()
  if (partition) renderInstanceContexts = { fields, templates: partition.templates, byNode: kept }
  const cache = new Map<string, DesignRenderContext>()
  return {
    root,
    instance: (node, context) => {
      if (node.kind !== 'instance' || !node.componentId) return undefined
      const modeId = context.modes.get(node.id) ?? null
      const key = JSON.stringify([
        node.componentId,
        modeId,
        node.width,
        node.height,
        node.instanceOverrides,
        node.blendMode,
        node.effects,
        node.effectStyleId,
        node.componentPropertyValues,
        node.instanceGrid,
        node.instanceStroke,
        node.instanceLayout,
        node.numericBindings,
        node.instanceSizingOverrides,
        node.targetAspectRatio,
        node.preserveLayout,
      ])
      const previous = kept.get(node)
      let scene = cache.get(key) ?? (previous?.key === key ? previous.context : undefined)
      if (!scene) {
        const ids = designDescendants(document.nodes, node.componentId)
        ids.add(node.componentId)
        const instanceNumbers = new Map(resolveDesignNumberVariables(
          designModeResources(document, modeId).numberVariables,
        ).map(value => [value.id, value.value]))
        scene = make(
          {
            ...document,
            nodes: applyDesignComponentInstance(
              document.nodes.filter(n => ids.has(n.id)), document.nodes.find(source => source.id === node.componentId) ?? node,
              node, document.nodes,
            ).map(n =>
              n.id === node.componentId
                ? {
                  ...applyDesignInstanceGrid(applyDesignInstanceStroke(applyDesignInstanceLayout(n, node, instanceNumbers), node),node),
                  blendMode: node.blendMode ?? n.blendMode,
                  effects: applyDesignInstanceEffects(n, node).effects,
                  effectStyleId: applyDesignInstanceEffects(n, node).effectStyleId,
                  targetAspectRatio: node.targetAspectRatio === undefined ? n.targetAspectRatio : node.targetAspectRatio,
                  ...(node.preserveLayout === false && (['width', 'height'] as const).some(axis =>
                    node[`${axis}Sizing`] === 'hug' && designInstanceSizingOwns(node, `${axis}Sizing`))
                    ? { preserveLayout: false } : {}),
                  parentId: null,
                  x: 0,
                  y: 0,
                  visible: true,
                  rotation: 0,
                  opacity: 1,
                  width: node.width,
                  height: node.height,
                  widthSizing: 'fixed',
                  heightSizing: 'fixed',
                  minWidth: undefined,
                  maxWidth: undefined,
                  minHeight: undefined,
                  maxHeight: undefined,
                  numericBindings: Object.fromEntries(
                    Object.entries(applyDesignInstanceStroke(
                      applyDesignInstanceLayout(n, node, instanceNumbers), node,
                    ).numericBindings ?? {}).filter(
                      ([key]) =>
                        ![
                          'width',
                          'height',
                          'minWidth',
                          'maxWidth',
                          'minHeight',
                          'maxHeight',
                        ].includes(key),
                    ),
                  ),
                }
                : n,
            ),
          },
          { nodeId: node.componentId, modeId },
          true,
        )
      }
      cache.set(key, scene)
      kept.set(node, { key, context: scene })
      return scene
    },
  }
}

/** Laid-out top-level tree retained for the next scene of an edited document. */
interface DesignRenderGroupResult {
  members: readonly CopyOSDesignNode[]
  fields: readonly unknown[]
  templates: readonly CopyOSDesignNode[] | undefined
  nodes: CopyOSDesignNode[]
  stackLines: Map<string, DesignStackLine[]>
  modes: Map<string, string | null>
  layoutBoxes: ReadonlyMap<string, DesignLayoutBox>
}
// Keyed by stored root identity; an edit that replaces the root drops its entry with the old root.
const renderGroupResults = new WeakMap<CopyOSDesignNode, DesignRenderGroupResult>()
/** Linked-instance contexts shared by successive scenes with identical template trees and layout fields. */
interface DesignRenderInstanceContexts {
  fields: readonly unknown[]
  templates: readonly CopyOSDesignNode[]
  byNode: WeakMap<CopyOSDesignNode, { key: string; context: DesignRenderContext }>
}
let renderInstanceContexts: DesignRenderInstanceContexts | undefined

/** Lay out the stored tree, reusing each top-level tree whose members and inputs are identical to a retained result.
 * @param document - Complete native design.
 * @param partition - Top-level trees of `document.nodes`.
 * @param fields - Layout-relevant document fields.
 * @param make - Whole-document context builder.
 * @returns Root context equal to `make(document)`.
 */
function buildDesignRenderRoot(document: CopyOSDesignDocument, partition: DesignRenderPartition, fields: readonly unknown[],
  make: (scene: CopyOSDesignDocument) => DesignRenderContext): DesignRenderContext {
  const { groups, groupOf, templates } = partition
  const retained = groups.map((group) => {
    const result = renderGroupResults.get(group.root)
    return result && sameDesignItems(result.members, group.members) && sameDesignItems(result.fields, fields) &&
      (!group.readsTemplates || (result.templates !== undefined && sameDesignItems(result.templates, templates))) ? result : undefined
  })
  // A changed template tree can change any instance, and template trees prepare against the whole library.
  if (!retained.some(Boolean) || groups.some((group, index) => group.template && !retained[index])) {
    const whole = make(document)
    const parts = groups.map((): { nodes: CopyOSDesignNode[] } => ({ nodes: [] }))
    const ownerOf = new Map<string, number>()
    document.nodes.forEach((node, index) => {
      const group = groupOf[index] ?? 0
      ownerOf.set(node.id, group)
      const resolved = whole.byId.get(node.id)
      if (resolved) parts[group]?.nodes.push(resolved)
    })
    const split = <V>(values: ReadonlyMap<string, V>) => {
      const maps = groups.map(() => new Map<string, V>())
      for (const [id, value] of values) maps[ownerOf.get(id) ?? -1]?.set(id, value)
      return maps
    }
    const stackLines = split(whole.stackLines), modes = split(whole.modes), boxes = split(whole.layoutBoxes)
    groups.forEach((group, index) => renderGroupResults.set(group.root, {
      members: group.members, fields, templates: group.readsTemplates ? templates : undefined,
      nodes: parts[index]?.nodes ?? [], stackLines: stackLines[index] ?? new Map<string, DesignStackLine[]>(),
      modes: modes[index] ?? new Map<string, string | null>(), layoutBoxes: boxes[index] ?? new Map<string, DesignLayoutBox>(),
    }))
    return whole
  }
  const results = groups.map((group, index) => {
    const reused = retained[index]
    if (reused) return reused
    const part = make({ ...document, nodes: group.members })
    const result: DesignRenderGroupResult = {
      members: group.members, fields, templates: group.readsTemplates ? templates : undefined,
      nodes: part.nodes, stackLines: part.stackLines, modes: part.modes, layoutBoxes: part.layoutBoxes,
    }
    renderGroupResults.set(group.root, result)
    return result
  })
  const cursors = groups.map(() => 0)
  const nodes = document.nodes.map((node, index) => {
    const group = groupOf[index] ?? 0
    const resolved = results[group]?.nodes[cursors[group] ?? 0]
    cursors[group] = (cursors[group] ?? 0) + 1
    if (!resolved || resolved.id !== node.id) throw new Error('Render group order mismatch')
    return resolved
  })
  const merge = <V>(pick: (result: DesignRenderGroupResult) => ReadonlyMap<string, V>) => {
    const merged = new Map<string, V>()
    for (const result of results) for (const [id, value] of pick(result)) merged.set(id, value)
    return merged
  }
  const children = new Map<string | null, CopyOSDesignNode[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  return {
    nodes, children, byId: new Map(nodes.map(node => [node.id, node])),
    stackLines: merge(result => result.stackLines), modes: merge(result => result.modes),
    layoutBoxes: merge(result => result.layoutBoxes),
  }
}

/** Classify saved root overrides in their current component flow and token mode.
 * @param document - Complete native scene and resource library.
 * @param instance - Stored or contextual linked instance.
 * @param modeId - Rendered instance mode; omitted resolves the stored instance’s mode.
 * @returns Local keys currently applied or retained dormant; unset keys inherit from the source.
 */
export function designInstanceLayoutEligibility(
  document: CopyOSDesignDocument,
  instance: CopyOSDesignNode,
  modeId = designNodeModeIds(document).get(instance.id) ?? null,
): import('./design-instance-layout.ts').DesignInstanceLayoutEligibility {
  const numbers = new Map(resolveDesignNumberVariables(
    designModeResources(document, modeId).numberVariables,
  ).map(value => [value.id, value.value]))
  return instanceLayoutEligibility(document.nodes.find(node => node.id === instance.componentId), instance, numbers)
}

/** Update local component-root settings without copying inherited values.
 * @param document - Validated scene.
 * @param id - Linked instance identity.
 * @param patch - Literal edits detach matching local bindings; undefined inherits, null resets local root settings and bindings.
 * @returns Scene with local settings merged, or unchanged when there is no edit.
 */
export function editDesignInstanceLayout(
  document: CopyOSDesignDocument,
  id: string,
  patch: Partial<CopyOSDesignInstanceLayout> | null,
): CopyOSDesignDocument {
  const node = document.nodes.find(item => item.id === id)
  const source = document.nodes.find(item => item.id === node?.componentId)
  if (node?.kind !== 'instance') return document
  if (patch !== null && Object.values(patch).some(value => value !== undefined) &&
    (!source || !['row', 'column', 'grid'].includes(source.layout))) return document
  if (source?.layout === 'grid' && patch !== null) {
    patch = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
      value === undefined || (DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(property => property === key) &&
        (key !== 'gap' || (typeof value === 'number' && value >= 0)))))
  }
  const values: CopyOSDesignInstanceLayout = Object.fromEntries(
    DESIGN_INSTANCE_LAYOUT_KEYS.flatMap((key) => {
      const value = patch === null ? undefined : key in patch ? patch[key] : node.instanceLayout?.[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
  const instanceLayout = Object.keys(values).length ? values : undefined
  const numericBindings = Object.fromEntries(Object.entries(node.numericBindings ?? {}).filter(([key]) =>
    !DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(property => property === key && (patch === null || property in patch)),
  ))
  if (JSON.stringify(node.instanceLayout) === JSON.stringify(instanceLayout) &&
    JSON.stringify(node.numericBindings ?? {}) === JSON.stringify(numericBindings)) return document
  return editDesignNodes(document, [{ id, instanceLayout, numericBindings }])
}

/** Detach a linked instance using its rendered mode and dimensions.
 * @param document - Current native scene.
 * @param id - Stored instance identity; retained for the resulting frame.
 * @param newId - Fresh identity allocator for cloned template children.
 * @returns Native scene preserving visible geometry, bindings and instance transforms.
 */
export function detachDesignInstance(
  document: CopyOSDesignDocument,
  id: string,
  newId: () => string,
): CopyOSDesignDocument {
  const stored = document.nodes.find(n => n.id === id)
  if (stored?.kind !== 'instance') throw new Error('Select a linked instance')
  const scene = createDesignRenderScene(document)
  const instance = scene.root.byId.get(id)
  const modeId = scene.root.modes.get(id) ?? null
  const naturalScene = createDesignRenderScene({ ...document, nodes: document.nodes.map(node => node.id === id ? {
    ...node, parentId: null, constraints: undefined, tokenModeId: modeId ?? 'base',
  } : node) })
  const naturalInstance = naturalScene.root.byId.get(id)
  const context = naturalInstance && naturalScene.instance(naturalInstance, naturalScene.root)
  const source = context?.byId.get(stored.componentId ?? '')
  if (!source || !context || !instance) throw new Error('Component source not found')
  const children = context.nodes.filter(n => n.id !== source.id)
  const mapping = new Map(children.map(n => [n.id, newId()]))
  mapping.set(source.id, id)
  for (const node of children) for (const property of node.componentProperties ?? []) mapping.set(property.id,newId())
  for (const node of children) for (const axis of node.componentSet?.axes ?? []) mapping.set(axis.id,newId())
  const template = document.nodes.find(node => node.id === stored.componentId)
  const templateIds = designDescendants(document.nodes, stored.componentId ?? '')
  templateIds.add(stored.componentId ?? '')
  const effectOwners = template ? new Map(applyDesignComponentInstance(
    document.nodes.filter(node => templateIds.has(node.id)), template, stored, document.nodes,
  ).map(node => [node.id, { effects: node.effects, effectStyleId: node.effectStyleId }])) : new Map<string, Pick<CopyOSDesignNode, 'effects' | 'effectStyleId'>>()
  const numbers = new Map(resolveDesignNumberVariables(designModeResources(document, modeId).numberVariables)
    .map(value => [value.id, value.value]))
  const sizingBindings = Object.fromEntries((['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)
    .flatMap((key) => {
      const binding = stored.numericBindings?.[key] ??
        (!designInstanceSizingOwns(stored, key) ? template?.numericBindings?.[key] : undefined)
      if ((key === 'width' || key === 'height') &&
        (instance[`${key}Sizing`] === 'hug' || (binding && numbers.get(binding) !== instance[key]))) return []
      return binding ? [[key, binding]] : []
    }))
  const parent = scene.root.byId.get(stored.parentId ?? '')
  const constrained = parent && stored.constraints && designConstraintsActive(instance, parent)
  const hugWidth = instance.widthSizing === 'hug', hugHeight = instance.heightSizing === 'hug'
  const constraints = constrained && stored.constraints ? { ...stored.constraints,
    referenceWidth: hugWidth ? stored.constraints.referenceWidth : parent.width,
    referenceHeight: hugHeight ? stored.constraints.referenceHeight : parent.height,
  } : stored.constraints
  const root: CopyOSDesignNode = {
    ...restoreDesignTokenColorLiterals(source),
    ...cloneStrokePaintFields(restoreDesignTokenColorLiterals(source), newId),
    instanceStroke: undefined,
    id,
    kind: 'frame',
    componentId: null,
    instanceSizingOverrides: undefined,
    componentSet:undefined,
    variantValues:undefined,
    componentProperties: undefined,
    componentPropertyValues: undefined,
    name: stored.name,
    parentId: stored.parentId,
    pageId: stored.pageId,
    tokenModeId: stored.tokenModeId ?? null,
    x: constrained && hugWidth ? stored.x : instance.x,
    y: constrained && hugHeight ? stored.y : instance.y,
    width: instance.width,
    height: instance.height,
    rotation: stored.rotation,
    flipX: stored.flipX,
    flipY: stored.flipY,
    clip: stored.clip,
    absolutePosition: stored.absolutePosition,
    constraints,
    opacity: stored.opacity,
    visible: stored.visible,
    locked: stored.locked,
    widthSizing: instance.widthSizing ?? 'fixed',
    heightSizing: instance.heightSizing ?? 'fixed',
    minWidth: instance.minWidth,
    maxWidth: instance.maxWidth,
    minHeight: instance.minHeight,
    maxHeight: instance.maxHeight,
    numericBindings: {
      ...source.numericBindings,
      ...sizingBindings,
    },
  }
  const candidate = {
    ...document,
    nodes: [
      ...document.nodes.map(n => (n.id === id ? root : n)),
      ...children.map(n => ({
        ...restoreDesignTokenColorLiterals(n),
        fontFeatures: n.fontFeatures?.map(feature => ({ ...feature })),
        fontVariations: n.fontVariations?.map(variation => ({ ...variation })),
        textRuns: mapDesignTextHyperlinks(n.textRuns?.map(run => ({ ...run, style: { ...run.style,
          ...(run.style.fontVariations !== undefined
            ? { fontVariations: run.style.fontVariations.map(variation => ({ ...variation })) } : {}),
          ...(run.style.fontFeatures !== undefined ? { fontFeatures: run.style.fontFeatures.map(feature => ({ ...feature })) } : {}) } })), target => target.type === 'NODE' && mapping.has(target.value) ?
          { ...target, value: mapping.get(target.value) ?? target.value } : target),
        semantics: mapDesignSemanticsTargets(n, target => target.type === 'NODE' && mapping.has(target.value) ?
          { ...target, value: mapping.get(target.value) ?? target.value } : target),
        breakpoint: undefined, breakpointSourceId: undefined,
        ...cloneStrokePaintFields({ ...restoreDesignTokenColorLiterals(n),
          ...(n.kind === 'instance' ? effectOwners.get(n.id) : {}) }, newId),
        id: mapping.get(n.id) ?? n.id,
        parentId:
          n.parentId === source.id
            ? id
            : (mapping.get(n.parentId ?? '') ?? null),
        componentId: n.componentId
          ? (mapping.get(n.componentId) ?? n.componentId)
          : null,
        componentProperties: remapDesignComponentPropertyDefinitions(n.componentProperties?.map((property) => {
          const effective = property.targets.map((path) => {
            let current = context, target: CopyOSDesignNode | undefined
            for (const [index, targetId] of path.entries()) {
              target = current.byId.get(targetId)
              if (index < path.length - 1 && target?.kind === 'instance') {
                const nested = naturalScene.instance(target, current)
                if (!nested) { target = undefined; break }
                current = nested
              }
            }
            return target ? (property.type === 'text' ? target.text : property.type==='boolean' ? target.visible : target.componentId ?? property.defaultValue) : property.defaultValue
          })
          if (effective.length && effective.every(value => value === effective[0]))
            return { ...property, defaultValue: effective[0] } as typeof property
          return { ...property, targets: property.targets.filter((_path, index) => effective[index] === property.defaultValue) }
        }),mapping),
        componentPropertyValues: remapDesignComponentPropertyValues(n.componentPropertyValues,mapping,
          designComponentPropertyDefinitions(document,n.componentId ?? '')),
        instanceOverrides: remapDesignInstanceOverrides(
          n.instanceOverrides,
          mapping, newId,
        ),
        pageId: stored.pageId,
      })),
    ],
  }
  return reconcileDesignVariants(document,reconcileDesignComponentProperties(document,candidate))
}

/** Page effective instance descendants with stable paths through repeated nested component uses.
 * @param document - Validated native scene.
 * @param id - Stored root instance identity.
 * @param options - Nonnegative row offset, retained-row limit (1–50000, default 200) and optional shared render scene.
 * @returns Effective rows, total descendant count and the next retrievable offset in authored traversal order.
 */
export function designInstanceOverrideLayerPage(
  document:CopyOSDesignDocument,id:string,
  options:{ offset?:number;limit?:number;scene?:ReturnType<typeof createDesignRenderScene> }={},
):{ layers:{ path:string[];names:string[];node:CopyOSDesignNode }[];total:number;offset:number;nextOffset:number|null } {
  const scene=options.scene ?? createDesignRenderScene(document)
  const offset=Math.max(0,Math.trunc(options.offset ?? 0)),limit=Math.max(1,Math.min(50000,Math.trunc(options.limit ?? 200)))
  const instance = scene.root.byId.get(id)
  const context = instance && scene.instance(instance, scene.root)
  const layers: { path: string[]; names: string[]; node: CopyOSDesignNode }[] =
    []
  let count = 0
  const visit = (
    parent: string,
    context: DesignRenderContext,
    path: string[],
    names: string[],
    depth: number,
  ): void => {
    if (depth > 64) return
    for (const node of context.children.get(parent) ?? []) {
      count++
      if (count > offset && layers.length < limit)
        layers.push({
          path: [...path, node.id],
          names: [...names, node.name],
          node,
        })
      visit(node.id, context, path, [...names, node.name], depth + 1)
      const nested = scene.instance(node, context)
      if (nested && node.componentId)
        visit(
          node.componentId,
          nested,
          [...path, node.id],
          [...names, node.name],
          depth + 1,
        )
    }
  }
  if (context && instance.componentId)
    visit(instance.componentId, context, [], [], 0)
  return { layers,total:count,offset,nextOffset:offset+layers.length<count ? offset+layers.length : null }
}

/** Enumerate contextual instance descendants, including repeated nested component uses.
 * @param document - Complete native scene.
 * @param id - Stored instance identity.
 * @param limit - Maximum rows to retain; traversal counts all descendants for omission feedback.
 * @param scene - Optional shared render scene for batched inspections.
 * @returns Effective layers and omitted count; use designInstanceOverrideLayerPage to retrieve later rows.
 */
export function designInstanceOverrideLayers(
  document:CopyOSDesignDocument,id:string,limit=200,scene=createDesignRenderScene(document),
):{ layers:{ path:string[];names:string[];node:CopyOSDesignNode }[];omitted:number } {
  const page=designInstanceOverrideLayerPage(document,id,{ limit,scene })
  const layers=limit<=0 ? [] : page.layers
  return { layers,omitted:Math.max(0,page.total-layers.length) }
}

export { designAutoLayoutContext, addDesignAutoLayout, removeDesignAutoLayout, setDesignAutoLayoutFlow, DesignAutoLayoutEditError } from './design-auto-layout.ts'
export type { DesignAutoLayoutReason, DesignAutoLayoutContext } from './design-auto-layout.ts'
export { designAutoLayoutSuggestionContext, previewDesignAutoLayoutSuggestion, suggestDesignAutoLayout } from './design-auto-layout-suggest.ts'
export type { DesignAutoLayoutSuggestionSkipReason, DesignAutoLayoutSuggestionContext, DesignAutoLayoutSuggestionGeometryChange,
  DesignAutoLayoutSuggestionResult } from './design-auto-layout-suggest.ts'
export { designGridCellAlignmentContext, setDesignGridCellAlignment } from './design-grid-cell-alignment.ts'
export type { DesignGridCellAlignmentIntent, DesignGridCellAlignmentOwner, DesignGridCellAlignmentContext }
  from './design-grid-cell-alignment.ts'
export { designLayoutVersionContext, previewDesignLayoutVersion, setDesignLayoutVersion } from './design-layout-version.ts'
export type { DesignLayoutVersionModel, DesignLayoutVersionScope, DesignLayoutVersionContext, DesignLayoutVersionGeometry,
  DesignLayoutVersionGeometryChange, DesignLayoutVersionPreview } from './design-layout-version.ts'
export { parseDesignPadding, designAutoLayoutPaddingContext, setDesignAutoLayoutPadding } from './design-auto-layout-padding.ts'
export type { DesignPaddingValues, DesignPaddingTarget, DesignAutoLayoutPaddingOwner, DesignAutoLayoutPaddingContext }
  from './design-auto-layout-padding.ts'
export { designAutoLayoutAlignmentContext, setDesignAutoLayoutAlignment } from './design-auto-layout-alignment.ts'
export type { DesignAlignmentTarget, DesignAutoLayoutAlignmentIntent, DesignAutoLayoutAlignmentOwner, DesignAutoLayoutAlignmentContext }
  from './design-auto-layout-alignment.ts'

/** Reorder one flow child without changing its free-position fallback coordinates.
 * @param document - Current native scene.
 * @param id - Child of an active auto-layout container.
 * @param index - Target index among visible, non-absolute siblings.
 * @returns Reordered document; unsupported selections leave the scene unchanged.
 */
export function reorderDesignFlowNode(
  document: CopyOSDesignDocument,
  id: string,
  index: number,
): CopyOSDesignDocument {
  const node = document.nodes.find(n => n.id === id),
    parent = document.nodes.find(n => n.id === node?.parentId)
  if (
    !node ||
    !parent ||
    parent.layout === 'none' ||
    parent.preserveLayout ||
    node.absolutePosition
  )
    return document
  const siblings = document.nodes.filter(
    n => n.parentId === parent.id && n.visible && !n.absolutePosition,
  )
  const from = siblings.findIndex(n => n.id === id)
  if (from < 0) return document
  siblings.splice(from, 1)
  siblings.splice(Math.max(0, Math.min(siblings.length, index)), 0, node)
  const ids = new Set(siblings.map(n => n.id))
  let cursor = 0
  return {
    ...document,
    nodes: document.nodes.map(n =>
      ids.has(n.id) ? (siblings[cursor++] ?? n) : n,
    ),
  }
}

/** Build a rounded rectangle with four radii, proportionally reduced when adjacent corners overlap.
 * @param node - Rectangle dimensions and shared or independent corner values.
 * @returns Closed SVG path used by paints, strokes and clipping in both renderers.
 */
export function designRectanglePath(
  node: Pick<
    CopyOSDesignNode,
    | 'width'
    | 'height'
    | 'radius'
    | 'radiusTopLeft'
    | 'radiusTopRight'
    | 'radiusBottomRight'
    | 'radiusBottomLeft'
  >,
): string {
  let tl = node.radiusTopLeft ?? node.radius,
    tr = node.radiusTopRight ?? node.radius,
    br = node.radiusBottomRight ?? node.radius,
    bl = node.radiusBottomLeft ?? node.radius
  const { width: w, height: h } = node
  const scale = Math.min(
    1,
    w / (tl + tr || 1),
    w / (bl + br || 1),
    h / (tl + bl || 1),
    h / (tr + br || 1),
  )
  tl *= scale
  tr *= scale
  br *= scale
  bl *= scale
  return `M ${tl} 0 H ${w - tr} A ${tr} ${tr} 0 0 1 ${w} ${tr} V ${h - br} A ${br} ${br} 0 0 1 ${w - br} ${h} H ${bl} A ${bl} ${bl} 0 0 1 0 ${h - bl} V ${tl} A ${tl} ${tl} 0 0 1 ${tl} 0 Z`
}

/** Read an ordered fill stack, including legacy single-paint documents.
 * @param node - Native layer.
 * @returns Bottom-to-top paints, without changing stored data.
 */
export function designNodePaints(node: CopyOSDesignNode): CopyOSDesignPaint[] {
  return (
    node.fills ?? [
      {
        id: node.id,
        color: node.fill,
        opacity: node.fillOpacity ?? 1,
        visible: true,
        variableId: node.fillVariableId,
        gradient:
          node.kind === 'image' && node.imageUrl ? undefined : node.gradient,
        image:
          node.kind === 'image' && node.imageUrl
            ? { url: node.imageUrl, scaleMode: 'fill' }
            : undefined,
      },
    ]
  )
}
function inversePaintMatrix(
  matrix: readonly number[],
): readonly [number, number, number, number, number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) return [1, 0, 0, 1, 0, 0]
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}
/** Shared gradient endpoints in normalized layer coordinates.
 * @param gradient - Stored paint transform.
 * @returns Start, end and cross-axis handle positions.
 */
export function designGradientPoints(gradient: CopyOSDesignGradient): {
  start: { x: number; y: number }
  end: { x: number; y: number }
  cross: { x: number; y: number }
} {
  const [a, b, c, d, e, f] = inversePaintMatrix(gradient.transform)
  const point = (x: number, y: number) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  })
  return {
    start: point(gradient.type === 'linear' ? 0 : 0.5, 0.5),
    end: point(1, 0.5),
    cross: point(gradient.type === 'linear' ? 0 : 0.5, 1),
  }
}
/** Convert editable normalized handles into the persisted affine paint transform.
 * @param type - Linear or radial paint.
 * @param points - Handle positions.
 * @returns Transform, or null when the handles describe a degenerate gradient.
 */
export function designGradientFromPoints(
  type: 'linear' | 'radial',
  points: ReturnType<typeof designGradientPoints>,
): number[] | null {
  const { start, end, cross } = points
  const multiplier = type === 'radial' ? 2 : 1
  const a = (end.x - start.x) * multiplier,
    b = (end.y - start.y) * multiplier,
    c = (cross.x - start.x) * 2,
    d = (cross.y - start.y) * 2
  if (Math.abs(a * d - b * c) < 1e-8) return null
  const e = start.x - (type === 'radial' ? a / 2 : 0) - c / 2,
    f = start.y - (type === 'radial' ? b / 2 : 0) - d / 2
  return [...inversePaintMatrix([a, b, c, d, e, f])]
}
/** Build a linear direction in physical layer coordinates.
 * @param angle - Clockwise degrees, where zero points right.
 * @param width - Layer width.
 * @param height - Layer height.
 * @returns Gradient paint transform.
 */
export function designGradientAtAngle(
  angle: number,
  width: number,
  height: number,
): number[] {
  const radians = (angle * Math.PI) / 180,
    x = Math.cos(radians),
    y = Math.sin(radians)
  const length = Math.abs(width * x) + Math.abs(height * y)
  const u = { x: (length * x) / width, y: (length * y) / height },
    v = { x: (-length * y) / width, y: (length * x) / height }
  const start = { x: 0.5 - u.x / 2, y: 0.5 - u.y / 2 }
  return (
    designGradientFromPoints('linear', {
      start,
      end: { x: start.x + u.x, y: start.y + u.y },
      cross: { x: start.x + v.x / 2, y: start.y + v.y / 2 },
    }) ?? [1, 0, 0, 1, 0, 0]
  )
}
/** Emit a standalone gradient definition using live shared stop colors.
 * @param gradient - Native gradient.
 * @param id - Renderer-created paint identity.
 * @param variables - Shared document colors.
 * @param numbers - Numeric resources in the same mode when colors bind their alpha.
 * @returns SVG definition markup.
 */
export function designGradientDefinition(
  gradient: CopyOSDesignGradient,
  id: string,
  variables: readonly CopyOSDesignVariable[],
  numbers: readonly CopyOSDesignNumberVariable[] = [],
): string {
  variables = resolveDesignColorVariables(variables, numbers)
  const tag = gradient.type === 'linear' ? 'linearGradient' : 'radialGradient'
  return `<${tag} id="${id}" gradientTransform="${designGradientTransform(gradient.transform)}" ${gradient.type === 'linear' ? 'x1="0" y1="0.5" x2="1" y2="0.5"' : 'cx="0.5" cy="0.5" r="0.5"'}>${[
    ...gradient.stops,
  ]
    .sort((a, b) => a.position - b.position)
    .map(
      stop =>
        `<stop offset="${stop.position}" stop-color="${(() => {const color=variables.find(v=>v.id===stop.variableId);return color?designColorVariableCss(color):stop.color})()}" stop-opacity="${stop.opacity}"/>`,
    )
    .join('')}</${tag}>`
}
/** SVG image patterns preserve the layer's shape while mapping raster content to its bounds.
 * @param image - Raster URL and sizing mode.
 * @param id - Caller-owned SVG definition identity.
 * @param width - Layer width in design pixels.
 * @param height - Layer height in design pixels.
 * @returns A pattern definition using the same mapping as the canvas.
 */
export function designImageDefinition(
  image: CopyOSDesignImagePaint,
  id: string,
  width: number,
  height: number,
): string {
  const geometry = designImageGeometry(image, width, height)
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${geometry.width}" height="${geometry.height}"${geometry.patternTransform ? ` patternTransform="${geometry.patternTransform}"` : ''}><image href="${escapeXml(image.url)}" width="${geometry.imageWidth}" height="${geometry.imageHeight}" preserveAspectRatio="${geometry.aspectRatio}"${geometry.imageTransform ? ` transform="${geometry.imageTransform}"` : ''}/></pattern>`
}
/** An SVG texture preserves paint geometry and opacity in CSS text paints.
 * @param paint - Solid, gradient or image fill.
 * @param variables - Shared document colors.
 * @param width - Layer width; defaults to a unit square.
 * @param height - Layer height; defaults to a unit square.
 * @param numbers - Numeric resources in the same mode when colors bind their alpha.
 * @returns CSS background texture. Embedded raster data remains self-contained.
 */
export function designPaintImage(
  paint: CopyOSDesignPaint,
  variables: readonly CopyOSDesignVariable[],
  width = 1,
  height = 1,
  numbers: readonly CopyOSDesignNumberVariable[] = [],
): string {
  variables = resolveDesignColorVariables(variables, numbers)
  const definition = paint.image
    ? designImageDefinition(paint.image, 'paint', width, height)
    : paint.gradient
      ? designGradientDefinition(paint.gradient, 'paint', variables, numbers)
      : ''
  const variable = variables.find(value => value.id === paint.variableId)
  const color = variable ? designColorVariableCss(variable) : paint.color
  const fill = paint.gradient || paint.image ? 'url(#paint)' : color
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs>${definition}</defs><rect width="${width}" height="${height}" fill="${fill}" fill-opacity="${paint.opacity}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
function designTextPaintStackImage(paints: readonly CopyOSDesignPaint[], variables: readonly CopyOSDesignVariable[],
  width: number, height: number, numbers: readonly CopyOSDesignNumberVariable[]): string {
  const colors = new Map(variables.map(variable => [variable.id, designColorVariableCss(variable)]))
  const definitions = paints.map((paint, index) => paint.image
    ? designImageDefinition(paint.image, `paint-${index}`, width, height)
    : paint.gradient ? designGradientDefinition(paint.gradient, `paint-${index}`, variables, numbers) : '').join('')
  const layers = paints.map((paint, index) => {
    const fill = paint.gradient || paint.image ? `url(#paint-${index})` : colors.get(paint.variableId ?? '') ?? paint.color
    return `<rect width="${width}" height="${height}" fill="${escapeXml(fill)}" fill-opacity="${paint.opacity}" style="mix-blend-mode:${paint.blendMode ?? 'normal'}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="isolation:isolate"><defs>${definitions}</defs>${layers}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
/** Resolve text fill stacks without applying fill opacity to the stroke or caret.
 * @param node - Text layer.
 * @param variables - Shared document colors.
 * @param numbers - Numeric resources in the same mode when colors bind their alpha.
 * @returns CSS text color or one isolated SVG paint-stack texture; CSS background blending stays normal.
 */
export function designTextPaint(
  node: CopyOSDesignNode,
  variables: readonly CopyOSDesignVariable[],
  numbers: readonly CopyOSDesignNumberVariable[] = [],
): { color: string; backgroundImage?: string | undefined; backgroundBlendMode?: string | undefined } {
  variables = resolveDesignColorVariables(variables, numbers)
  const paints = designNodePaints(node).filter(p => p.visible)
  const first = paints[0]
  if (
    paints.length === 1 &&
    first &&
    !first.gradient &&
    !first.image &&
    first.opacity === 1 &&
    (!first.blendMode || first.blendMode === 'normal')
  )
    return {
      color:
        (() => {const color=variables.find(v=>v.id===first.variableId);return color?designColorVariableCss(color):first.color})(),
    }
  return {
    color: 'transparent',
    backgroundBlendMode: paints.length ? 'normal' : undefined,
    backgroundImage: paints.length ? designTextPaintStackImage(paints, variables, node.width, node.height, numbers) : undefined,
  }
}

/** Copy effective typography without node identities, paint or alignment.
 * @param style - A text style or resolved layer.
 * @returns Reusable typography values.
 */
export function designTextStyleValues(
  style: Pick<
    CopyOSDesignNode,
    | 'fontFamily'
    | 'fontSize'
    | 'fontWeight'
    | 'lineHeight'
    | 'letterSpacing'
    | 'fontStyle'
    | 'fontFeatures'
    | 'fontVariations'
  >,
): Omit<import('./types.ts').CopyOSDesignTextStyle, 'id' | 'name'> {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ?? 0,
    fontFeatures: style.fontFeatures?.map(feature => ({ ...feature })),
    fontVariations: style.fontVariations?.map(variation => ({ ...variation })),
    fontStyle: style.fontStyle ?? 'normal',
  }
}
/** Remove a shared text style while preserving the effective appearance of every reference.
 * @param document - Current native scene.
 * @param id - Style to remove.
 * @returns A document with baked typography and detached style references.
 */
export function removeDesignTextStyle(
  document: CopyOSDesignDocument,
  id: string,
): CopyOSDesignDocument {
  const resolved = new Map(resolveDesignNodes(document).map(n => [n.id, n]))
  return {
    ...document,
    textStyles: document.textStyles?.filter(s => s.id !== id),
    nodes: document.nodes.map(n =>
      n.textStyleId === id
        ? {
          ...n,
          ...designTextStyleValues(resolved.get(n.id) ?? n),
          textStyleId: null,
        }
        : n,
    ),
  }
}

/** Move a gradient handle while preserving the other axes and rejecting degenerate transforms.
 * @param gradient - Original paint geometry.
 * @param handle - Start, end or radial cross-axis handle.
 * @param target - Normalized layer position.
 * @param width - Physical layer width.
 * @param height - Physical layer height.
 * @param snapAngle - Snap the edited direction to 45-degree increments.
 * @returns Updated paint, or the original when the geometry cannot be inverted.
 */
export function moveDesignGradientHandle(
  gradient: CopyOSDesignGradient,
  handle: 'start' | 'end' | 'cross',
  target: { x: number; y: number },
  width: number,
  height: number,
  snapAngle = false,
): CopyOSDesignGradient {
  const points = designGradientPoints(gradient)
  if (gradient.type === 'radial' && handle === 'start') {
    const dx = target.x - points.start.x,
      dy = target.y - points.start.y
    points.end = { x: points.end.x + dx, y: points.end.y + dy }
    points.cross = { x: points.cross.x + dx, y: points.cross.y + dy }
  }
  points[handle] = target
  if (snapAngle && handle !== 'cross') {
    const dx = (points.end.x - points.start.x) * width,
      dy = (points.end.y - points.start.y) * height
    const angle =
        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
      length = Math.hypot(dx, dy)
    if (handle === 'start')
      points.start = {
        x: points.end.x - (Math.cos(angle) * length) / width,
        y: points.end.y - (Math.sin(angle) * length) / height,
      }
    else
      points.end = {
        x: points.start.x + (Math.cos(angle) * length) / width,
        y: points.start.y + (Math.sin(angle) * length) / height,
      }
  }
  if (gradient.type === 'linear') {
    const dx = points.end.x - points.start.x,
      dy = points.end.y - points.start.y
    points.cross = {
      x: points.start.x - (dy * height) / width / 2,
      y: points.start.y + (dx * width) / height / 2,
    }
  }
  const transform = designGradientFromPoints(gradient.type, points)
  return transform ? { ...gradient, transform } : gradient
}

/** Set the number of grid tracks while retaining content and clamping cell spans.
 * @param document - Current design.
 * @param id - Grid container identity.
 * @param axis - Columns or rows.
 * @param count - Positive track count, or null for automatic rows.
 * @returns Grid with content kept in its nearest available cells; linked instances own the axis and retain inherited authored cell records.
 */
export function resizeDesignGridTracks(
  document: CopyOSDesignDocument,
  id: string,
  axis: 'columns' | 'rows',
  count: number | null,
): CopyOSDesignDocument {
  const parent = document.nodes.find(n => n.id === id)
  const inherited=parent?.kind==='instance'?designInstanceGridConfig(document,parent):undefined
  if (parent?.layout !== 'grid' && !inherited) throw new Error('Select a grid container')
  if (count === null && axis !== 'rows')
    throw new Error('Only grid rows can be automatic')
  if (
    count !== null &&
    (!Number.isInteger(count) ||
      count < 1 ||
      count > (axis === 'columns' ? 64 : 4096))
  )
    throw new Error('Grid track count is out of range')
  const grid = inherited ?? parent?.grid ?? defaultDesignGrid()
  const tracks =
    count === null
      ? grid.rows
      : Array.from(
        { length: count },
        (_, i) =>
          grid[axis][i] ??
            (axis === 'columns'
              ? { sizing: 'fill' as const, value: 1 }
              : grid.implicitRow),
      )
  if (inherited) return editDesignInstanceGrid(document,id,count===null?{ autoRows:true }:
    { [axis]:tracks,...(axis==='rows'?{ autoRows:false }:{}) })
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === id
        ? {
          ...n,
          preserveLayout: false,
          grid: {
            ...grid,
            [axis]: tracks,
            ...(axis === 'rows' ? { autoRows: count === null } : {}),
          },
        }
        : n.parentId === id && n.gridCell && count !== null
          ? {
            ...n,
            gridCell: {
              ...n.gridCell,
              ...(axis === 'columns'
                ? {
                  columnSpan: Math.min(n.gridCell.columnSpan ?? 1, count),
                  column: Math.min(
                    n.gridCell.column ?? 1,
                    Math.max(
                      1,
                      count -
                            Math.min(n.gridCell.columnSpan ?? 1, count) +
                            1,
                    ),
                  ),
                }
                : {
                  rowSpan: Math.min(n.gridCell.rowSpan ?? 1, count),
                  row: Math.min(
                    n.gridCell.row ?? 1,
                    Math.max(
                      1,
                      count - Math.min(n.gridCell.rowSpan ?? 1, count) + 1,
                    ),
                  ),
                }),
            },
          }
          : n,
    ),
  }
}
/** Change one track to fixed pixels; used by the inspector and canvas handles.
 * @param document - Current scene.
 * @param id - Grid container identity.
 * @param axis - Track orientation.
 * @param index - Zero-based track index.
 * @param value - Fixed pixel size.
 * @returns Candidate with only this track's binding detached.
 */
export function resizeDesignGridTrack(
  document: CopyOSDesignDocument,
  id: string,
  axis: 'columns' | 'rows',
  index: number,
  value: number,
): CopyOSDesignDocument {
  const parent = document.nodes.find(n => n.id === id)
  const inherited=parent?.kind==='instance'?designInstanceGridConfig(document,parent):undefined
  if (parent?.layout !== 'grid' && !inherited) throw new Error('Select a grid container')
  const grid = inherited ?? parent?.grid ?? defaultDesignGrid()
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= (axis === 'columns' ? grid.columns.length : 4096) ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 100000
  )
    throw new Error('Grid track size is out of range')
  const tracks = Array.from(
    { length: Math.max(grid[axis].length, index + 1) },
    (_, i) =>
      i === index
        ? { sizing: 'fixed' as const, value, variableId: null }
        : (grid[axis][i] ?? grid.implicitRow),
  )
  if (inherited) return editDesignInstanceGrid(document,id,{ [axis]:tracks })
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === id
        ? { ...n, preserveLayout: false, grid: { ...grid, [axis]: tracks } }
        : n,
    ),
  }
}
/** Capture automatic cells before switching to manual positioning; Auto restores automatic rows.
 * @param document - Current scene.
 * @param id - Grid identity.
 * @param automatic - Requested positioning mode.
 * @returns Ordinary grids capture current cells; linked grids only own autoPosition, using inherited anchors and collision resolution.
 */
export function setDesignGridPositioning(
  document: CopyOSDesignDocument,
  id: string,
  automatic: boolean,
): CopyOSDesignDocument {
  const stored=document.nodes.find(node=>node.id===id)
  if (stored?.kind==='instance') {
    if (!designInstanceGridConfig(document,stored)) throw new Error('Select a grid container')
    return editDesignInstanceGrid(document,id,{ autoPosition:automatic })
  }
  const nodes = resolveDesignNodes(document),
    parent = nodes.find(n => n.id === id)
  if (parent?.layout !== 'grid') throw new Error('Select a grid container')
  const raw = document.nodes.find(n => n.id === id),
    grid = raw?.grid ?? defaultDesignGrid()
  const geometry = designGridGeometry(
    parent,
    nodes.filter(n => n.parentId === id),
    {},
    designInstanceLayoutBoxes(document),
  )
  const cells = new Map(geometry.placements.map(p => [p.id, p]))
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === id
        ? {
          ...n,
          preserveLayout: false,
          grid: {
            ...grid,
            autoPosition: automatic,
            autoRows: automatic,
            rows: automatic
              ? grid.rows
              : Array.from(
                { length: Math.max(1, geometry.rows.length) },
                (_, i) => grid.rows[i] ?? grid.implicitRow,
              ),
          },
        }
        : !automatic && cells.has(n.id)
          ? {
            ...n,
            gridCell: {
              ...n.gridCell,
              column: (cells.get(n.id)?.column ?? 0) + 1,
              row: (cells.get(n.id)?.row ?? 0) + 1,
            },
          }
          : n,
    ),
  }
}
/** Move a grid child, compacting Auto order or retaining manual empty cells.
 * @param document - Current design.
 * @param id - Visible flow child.
 * @param column - One-based destination column.
 * @param row - One-based destination row.
 * @returns Atomic cell move; occupied manual cells relocate without dropping content.
 */
export function moveDesignGridNode(
  document: CopyOSDesignDocument,
  id: string,
  column: number,
  row: number,
): CopyOSDesignDocument {
  const nodes = resolveDesignNodes(document),
    child = nodes.find(n => n.id === id),
    parent = nodes.find(n => n.id === child?.parentId)
  if (!child || parent?.layout !== 'grid' || child.absolutePosition)
    return document
  const grid = parent.grid ?? defaultDesignGrid(),
    siblings = nodes.filter(n => n.parentId === parent.id)
  const geometry = designGridGeometry(
      parent,
      siblings,
      {},
      designInstanceLayoutBoxes(document),
    ),
    position = geometry.placements.find(p => p.id === id)
  if (!position) return document
  column = Math.max(
    1,
    Math.min(grid.columns.length - position.columnSpan + 1, Math.round(column)),
  )
  row = Math.max(1, Math.min(4096 - position.rowSpan + 1, Math.round(row)))
  if (grid.autoPosition) {
    const target = geometry.placements.findIndex(
      p =>
        row - 1 >= p.row &&
        row - 1 < p.row + p.rowSpan &&
        column - 1 >= p.column &&
        column - 1 < p.column + p.columnSpan,
    )
    return reorderDesignFlowNode(
      document,
      id,
      target < 0 ? geometry.placements.length - 1 : target,
    )
  }
  const blocked = geometry.placements.filter(
    p =>
      p.id !== id &&
      p.column < column - 1 + position.columnSpan &&
      p.column + p.columnSpan > column - 1 &&
      p.row < row - 1 + position.rowSpan &&
      p.row + p.rowSpan > row - 1,
  )
  const cells = new Map(geometry.placements.map(p => [p.id, p])),
    blockedIds = new Set(blocked.map(p => p.id))
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === parent.id
        ? {
          ...n,
          grid: {
            ...(n.grid ?? defaultDesignGrid()),
            rows: Array.from(
              {
                length: Math.max(
                  grid.rows.length,
                  row - 1 + position.rowSpan,
                ),
              },
              (_, i) => n.grid?.rows[i] ?? grid.implicitRow,
            ),
          },
        }
        : cells.has(n.id)
          ? {
            ...n,
            gridCell: {
              ...n.gridCell,
              column:
                  n.id === id
                    ? column
                    : blockedIds.has(n.id)
                      ? undefined
                      : (cells.get(n.id)?.column ?? 0) + 1,
              row:
                  n.id === id
                    ? row
                    : blockedIds.has(n.id)
                      ? undefined
                      : (cells.get(n.id)?.row ?? 0) + 1,
            },
          }
          : n,
    ),
  }
}

/** Expected authoring failure when a content-preserving linked track move exceeds native override budgets. */
export class DesignGridTrackMoveError extends Error {
  /** Stable failure kind for localized UI feedback without swallowing programming errors. */
  readonly code = 'override-limit'
  /** Create the bounded authoring failure; the original scene remains unchanged. */
  constructor() {
    super('Moving linked grid tracks exceeds the instance override limit')
    this.name = 'DesignGridTrackMoveError'
  }
}

/** Reorder a track together with every connected spanning object, retaining cell contents.
 * @param document - Current scene.
 * @param id - Grid identity.
 * @param axis - Columns or rows.
 * @param index - Zero-based track to move.
 * @param direction - One neighboring track block earlier or later.
 * @returns Reordered tracks and captured manual cells; linked roots own local tracks and cell anchors without changing their main.
 */
export function moveDesignGridTrack(
  document: CopyOSDesignDocument,
  id: string,
  axis: 'columns' | 'rows',
  index: number,
  direction: -1 | 1,
): CopyOSDesignDocument {
  const raw = document.nodes.find(n => n.id === id)
  const linked = raw?.kind === 'instance' ? designInstanceGridContext(document, raw) : undefined
  const nodes = linked?.context.nodes ?? resolveDesignNodes(document)
  const parent = linked?.node ?? nodes.find(n => n.id === id)
  if (parent?.layout !== 'grid' || !raw || (raw.kind === 'instance' && !linked))
    throw new Error('Select a grid container')
  const grid = raw.kind === 'instance' ? designInstanceGridConfig(document, raw) : raw.grid ?? defaultDesignGrid()
  if (!grid) throw new Error('Select a grid container')
  const geometry = designGridGeometry(
    parent,
    linked?.children ?? nodes.filter(n => n.parentId === id),
    {},
    linked?.context.layoutBoxes ?? designInstanceLayoutBoxes(document),
  )
  const count =
    axis === 'columns' ? geometry.columns.length : geometry.rows.length
  const plan = designGridTrackMovePlan(geometry.placements, count, axis, index, direction)
  if (!plan) return document
  const { order, remap } = plan, cells = new Map(geometry.placements.map(p => [p.id, p]))
  const tracks = order.map(i => ({ ...(grid[axis][i] ?? grid.implicitRow) }))
  if (raw.kind === 'instance') {
    const paths = new Set((raw.instanceOverrides ?? []).map(override => JSON.stringify(override.path)))
    for (const placement of geometry.placements) paths.add(JSON.stringify([placement.id]))
    const total = document.nodes.reduce((sum, node) => sum + (node.instanceOverrides?.length ?? 0), 0)
    if (paths.size > 1000 || total - (raw.instanceOverrides?.length ?? 0) + paths.size > 10000)
      throw new DesignGridTrackMoveError()
    const next = mergeDesignInstanceGridCells(raw, geometry.placements.map(placement => ({
      path: [placement.id],
      patch: {
        column: (axis === 'columns' ? remap.get(placement.column) ?? placement.column : placement.column) + 1,
        row: (axis === 'rows' ? remap.get(placement.row) ?? placement.row : placement.row) + 1,
      },
    })))
    return editDesignNodes(document, [{ id, instanceOverrides: next.instanceOverrides,
      instanceGrid: { ...raw.instanceGrid, [axis]: tracks, autoPosition: false,
        ...(axis === 'rows' ? { autoRows: false } : {}) },
    }])
  }
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === id
        ? {
          ...n,
          preserveLayout: false,
          grid: {
            ...grid,
            [axis]: tracks,
            autoPosition: false,
            ...(axis === 'rows' ? { autoRows: false } : {}),
          },
        }
        : cells.has(n.id)
          ? {
            ...n,
            gridCell: {
              ...n.gridCell,
              column:
                  (axis === 'columns'
                    ? (remap.get(cells.get(n.id)?.column ?? 0) ?? 0)
                    : (cells.get(n.id)?.column ?? 0)) + 1,
              row:
                  (axis === 'rows'
                    ? (remap.get(cells.get(n.id)?.row ?? 0) ?? 0)
                    : (cells.get(n.id)?.row ?? 0)) + 1,
            },
          }
          : n,
    ),
  }
}

/** Resize a grid object across cells, retaining automatic placement unless an anchor changes.
 * @param document - Current native scene.
 * @param id - Flow child in a grid.
 * @param cell - Spans and optional one-based anchors.
 * @returns Candidate with Fill sizing on resized axes and displaced manual objects retained.
 */
export function resizeDesignGridCell(
  document: CopyOSDesignDocument,
  id: string,
  cell: {
    columnSpan?: number
    rowSpan?: number
    column?: number
    row?: number
  },
): CopyOSDesignDocument {
  const nodes = resolveDesignNodes(document),
    child = nodes.find(n => n.id === id),
    parent = nodes.find(n => n.id === child?.parentId)
  if (!child || parent?.layout !== 'grid' || child.absolutePosition)
    return document
  const grid = parent.grid ?? defaultDesignGrid(),
    geometry = designGridGeometry(
      parent,
      nodes.filter(n => n.parentId === parent.id),
      {},
      designInstanceLayoutBoxes(document),
    ),
    original = geometry.placements.find(p => p.id === id)
  if (!original) return document
  const columnSpan = Math.max(
      1,
      Math.min(
        grid.columns.length,
        Math.round(cell.columnSpan ?? original.columnSpan),
      ),
    ),
    rowSpan = Math.max(
      1,
      Math.min(64, Math.round(cell.rowSpan ?? original.rowSpan)),
    )
  const column = Math.max(
      1,
      Math.min(
        grid.columns.length - columnSpan + 1,
        cell.column ?? original.column + 1,
      ),
    ),
    row = Math.max(
      1,
      Math.min(4096 - rowSpan + 1, cell.row ?? original.row + 1),
    )
  const manual =
    !grid.autoPosition || cell.column !== undefined || cell.row !== undefined
  const positions = new Map(geometry.placements.map(p => [p.id, p]))
  const blocked = new Set(
    geometry.placements
      .filter(
        p =>
          p.id !== id &&
          p.column < column - 1 + columnSpan &&
          p.column + p.columnSpan > column - 1 &&
          p.row < row - 1 + rowSpan &&
          p.row + p.rowSpan > row - 1,
      )
      .map(p => p.id),
  )
  return {
    ...document,
    nodes: document.nodes.map(n =>
      n.id === id
        ? markDesignInstanceSizingEdit(n, {
          gridCell: {
            ...n.gridCell,
            columnSpan,
            rowSpan,
            ...(manual ? { column, row } : {}),
          },
          ...(cell.columnSpan !== undefined
            ? {
              widthSizing: 'fill' as const,
              ...(n.kind === 'text' && n.textSizing === 'auto-width'
                ? { textSizing: 'auto-height' as const }
                : {}),
            }
            : {}),
          ...(cell.rowSpan !== undefined
            ? {
              heightSizing: 'fill' as const,
              ...(n.kind === 'text'
                ? { textSizing: 'fixed' as const }
                : {}),
            }
            : {}),
          numericBindings: Object.fromEntries(
            Object.entries(n.numericBindings ?? {}).filter(
              ([key]) =>
                !(key === 'width' && cell.columnSpan !== undefined) &&
                  !(key === 'height' && cell.rowSpan !== undefined),
            ),
          ),
        })
        : manual && n.id === parent.id
          ? {
            ...n,
            grid: {
              ...(n.grid ?? defaultDesignGrid()),
              autoPosition: false,
              ...(cell.row !== undefined
                ? {
                  autoRows: false,
                  rows: Array.from(
                    {
                      length: Math.max(grid.rows.length, row - 1 + rowSpan),
                    },
                    (_, i) => n.grid?.rows[i] ?? grid.implicitRow,
                  ),
                }
                : {}),
            },
          }
          : manual && positions.has(n.id)
            ? {
              ...n,
              gridCell: {
                ...n.gridCell,
                column: blocked.has(n.id)
                  ? undefined
                  : (positions.get(n.id)?.column ?? 0) + 1,
                row: blocked.has(n.id)
                  ? undefined
                  : (positions.get(n.id)?.row ?? 0) + 1,
              },
            }
            : n,
    ),
  }
}

/** Capture missing resize reference dimensions without moving any layer.
 * @param document - Parsed scene with validated parent links and optional constraint references.
 * @returns Canonical scene with stable parent reference dimensions.
 */
export function captureDesignConstraintReferences(
  document: CopyOSDesignDocument,
): CopyOSDesignDocument {
  if (
    !document.nodes.some(
      n =>
        n.constraints &&
        (n.constraints.referenceWidth === undefined ||
          n.constraints.referenceHeight === undefined),
    )
  )
    return document
  const computed = new Map(resolveDesignNodes(document).map(n => [n.id, n]))
  return {
    ...document,
    nodes: document.nodes.map((n) => {
      const parent = computed.get(n.parentId ?? '')
      if (!n.constraints || !parent) return n
      return {
        ...n,
        constraints: {
          ...n.constraints,
          referenceWidth: n.constraints.referenceWidth ?? parent.width,
          referenceHeight: n.constraints.referenceHeight ?? parent.height,
        },
      }
    }),
  }
}
/** Apply effective geometry edits while retaining stable constraint references for position-only changes.
 * @param document - Current native scene.
 * @param updates - Partial existing-node edits; instanceLayout:null resets local root bindings, even when also supplied.
 * Positions and dimensions use current computed coordinates.
 * @param options - Native batch staging can defer Fill normalization until new nodes and token edits are complete.
 * @returns Scene with position edits inverted into authored coordinates; resizing or rule changes recapture their reference.
 */
export function editDesignNodes(
  document: CopyOSDesignDocument,
  updates: readonly ({
    [K in keyof CopyOSDesignNode]?: CopyOSDesignNode[K] | undefined
  } & { id: string })[],
  options?: { normalizeFill?: boolean; normalizeAspect?: boolean },
): CopyOSDesignDocument {
  const edits = new Map(
    updates.map(n => [n.id, n as Partial<CopyOSDesignNode> & { id: string }]),
  )
  const needsGeometry = updates.some(n =>
    [
      'x',
      'y',
      'width',
      'height',
      'parentId',
      'constraints',
      'absolutePosition',
    ].some(k => k in n),
  )
  const computed = needsGeometry
    ? new Map(resolveDesignNodes(document).map(n => [n.id, n]))
    : new Map<string, CopyOSDesignNode>()
  const candidate = {
    ...document,
    nodes: document.nodes.map((n) => {
      let edit = edits.get(n.id)
      if (!edit) return n
      if (edit.effects !== undefined && n.effectStyleId !== undefined && !Object.hasOwn(edit, 'effectStyleId'))
        edit = { ...edit, effectStyleId: null }
      if (n.kind === 'text' && edit.text !== undefined && edit.text !== n.text && !Object.hasOwn(edit, 'textRuns')) {
        const rebased = rebaseDesignTextRuns(n, edit.text)
        edit = { ...edit, textRuns: rebased.textRuns }
      }
      const inheritedEdges=DESIGN_STROKE_NUMBER_KEYS.slice(1).filter(key=>edit && key in edit && edit[key]===undefined)
      if (inheritedEdges.length) edit={ ...edit,numericBindings:Object.fromEntries(
        Object.entries(edit.numericBindings ?? n.numericBindings ?? {}).filter(([key])=>!inheritedEdges.some(edge=>edge===key))) }
      if (n.kind === 'instance') {
        const marked = markDesignInstanceSizingEdit(n, edit)
        edit = { ...edit,
          ...(('instanceSizingOverrides' in marked || 'instanceSizingOverrides' in n)
            ? { instanceSizingOverrides: marked.instanceSizingOverrides } : {}),
          ...(marked.numericBindings !== n.numericBindings ? { numericBindings: marked.numericBindings } : {}),
          ...(marked.widthSizing !== n.widthSizing ? { widthSizing: marked.widthSizing } : {}),
          ...(marked.heightSizing !== n.heightSizing ? { heightSizing: marked.heightSizing } : {}),
        }
      }
      if (n.kind === 'instance' && edit.instanceStroke === null) {
        edit = { ...edit, numericBindings: Object.fromEntries(
          Object.entries(edit.numericBindings ?? n.numericBindings ?? {}).filter(([key]) =>
            !DESIGN_STROKE_NUMBER_KEYS.some(property => property === key))) }
      } else if (n.kind === 'instance' && n.instanceStroke === null &&
        DESIGN_STROKE_NUMBER_KEYS.some(key => edit?.numericBindings?.[key])) {
        edit = { ...edit, instanceStroke: undefined }
      }
      if (n.kind === 'instance' && edit.instanceLayout === null) {
        edit = { ...edit, numericBindings: Object.fromEntries(
          Object.entries(edit.numericBindings ?? n.numericBindings ?? {}).filter(([key]) =>
            !DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(property => property === key)),
        ) }
      } else if (n.kind === 'instance' && n.instanceLayout === null &&
        DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(key => edit?.numericBindings?.[key])) {
        edit = { ...edit, instanceLayout: undefined }
      }
      const current = computed.get(n.id),
        parent = computed.get(n.parentId ?? '')
      const rules = n.constraints
      const recapture =
        'width' in edit ||
        'height' in edit ||
        'parentId' in edit ||
        'constraints' in edit ||
        'absolutePosition' in edit
      if (current && parent && (rules || edit.constraints) && recapture) {
        const targetParent = computed.get(
          edit.parentId === undefined
            ? (n.parentId ?? '')
            : (edit.parentId ?? ''),
        )
        const nextRules = 'constraints' in edit ? edit.constraints : rules
        const bindings = Object.fromEntries(Object.entries({ ...n.numericBindings, ...edit.numericBindings }).filter(([key]) =>
          (edit.instanceLayout !== null || !DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(property => property === key)) &&
          (edit.instanceStroke !== null || !DESIGN_STROKE_NUMBER_KEYS.some(property => property === key)) &&
          !inheritedEdges.some(edge=>edge===key),
        ))
        // Direct dimension edits detach their bindings. Baking a transformed size only detaches a binding that would reset it.
        const active = rules && designConstraintsActive(n, parent)
        if (
          'width' in edit ||
          (active &&
            ['scale', 'left-right'].includes(rules.horizontal) &&
            parent.width !== (rules.referenceWidth ?? parent.width))
        )
          delete bindings.width
        if (
          'height' in edit ||
          (active &&
            ['scale', 'top-bottom'].includes(rules.vertical) &&
            parent.height !== (rules.referenceHeight ?? parent.height))
        )
          delete bindings.height
        return {
          ...n,
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
          ...edit,
          numericBindings: bindings,
          constraints: nextRules
            ? {
              ...nextRules,
              referenceWidth: targetParent?.width ?? parent.width,
              referenceHeight: targetParent?.height ?? parent.height,
            }
            : undefined,
        }
      }
      if (rules && current && parent && designConstraintsActive(n, parent))
        return {
          ...n,
          ...edit,
          ...(edit.x !== undefined
            ? {
              x: designConstraintPosition(
                edit.x,
                rules.referenceWidth ?? parent.width,
                parent.width,
                rules.horizontal,
              ),
            }
            : {}),
          ...(edit.y !== undefined
            ? {
              y: designConstraintPosition(
                edit.y,
                rules.referenceHeight ?? parent.height,
                parent.height,
                rules.vertical,
              ),
            }
            : {}),
        }
      return { ...n, ...edit }
    }),
  }
  const aspectCandidate = options?.normalizeAspect === false ? candidate : normalizeDesignAspectEdits(document, candidate, updates)
  const booleanCandidate = resizeDesignBooleanOperands(document, aspectCandidate, updates
    .filter(update => update.width !== undefined || update.height !== undefined).map(update => update.id))
  const authored = options?.normalizeFill === false ? booleanCandidate : normalizeDesignFillAuthoring(document, booleanCandidate, updates)
  return reconcileDesignTextRuns(document,
    reconcileDesignVariants(document,reconcileDesignComponentProperties(document,authored,updates),updates))
}

/** Resize selected containers while retaining their immediate children's displayed geometry.
 * @param before - Scene before the resize.
 * @param after - Candidate with resized container dimensions.
 * @param containerIds - Containers whose child constraints are temporarily ignored.
 * @returns Candidate with constrained children recaptured at the new parent size.
 */
export function ignoreDesignChildConstraints(
  before: CopyOSDesignDocument,
  after: CopyOSDesignDocument,
  containerIds: readonly string[],
): CopyOSDesignDocument {
  if (!containerIds.length) return after
  const ids = new Set(containerIds),
    original = new Map(resolveDesignNodes(before).map(n => [n.id, n])),
    current = new Map(resolveDesignNodes(after).map(n => [n.id, n]))
  for (const id of ids)
    if (!original.has(id) || !current.has(id))
      throw new Error('Constraint resize container not found')
  return {
    ...after,
    nodes: after.nodes.map((n) => {
      if (!n.parentId || !ids.has(n.parentId) || !n.constraints) return n
      const previous = original.get(n.id),
        oldParent = original.get(n.parentId),
        newParent = current.get(n.parentId)
      if (
        !previous ||
        !oldParent ||
        !newParent ||
        !designConstraintsActive(previous, oldParent)
      )
        return n
      const bindings = { ...n.numericBindings },
        rules = n.constraints
      if (
        ['scale', 'left-right'].includes(rules.horizontal) &&
        oldParent.width !== (rules.referenceWidth ?? oldParent.width)
      )
        delete bindings.width
      if (
        ['scale', 'top-bottom'].includes(rules.vertical) &&
        oldParent.height !== (rules.referenceHeight ?? oldParent.height)
      )
        delete bindings.height
      return {
        ...n,
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
        numericBindings: bindings,
        constraints: {
          ...rules,
          referenceWidth: newParent.width,
          referenceHeight: newParent.height,
        },
      }
    }),
  }
}

/** Snapshot selected layers at their current geometry before copying or changing parents.
 * @param document - Source native scene.
 * @param ids - Layers whose geometry must be retained independently of their old layout context.
 * @returns Scene with selected geometry baked, retaining size variables that still match the visible dimensions.
 */
export function snapshotDesignGeometry(
  document: CopyOSDesignDocument,
  ids: readonly string[],
): CopyOSDesignDocument {
  const selected = new Set(ids),
    computed = new Map(resolveDesignNodes(document).map(n => [n.id, n]))
  const authored = new Map(
    resolveDesignNodes({
      ...document,
      nodes: document.nodes.map(n => ({
        ...n,
        layout: 'none' as const,
        constraints: undefined,
      })),
    }).map(n => [n.id, n]),
  )
  return {
    ...document,
    nodes: document.nodes.map((n) => {
      if (!selected.has(n.id)) return n
      const current = computed.get(n.id),
        basis = authored.get(n.id),
        parent = computed.get(n.parentId ?? '')
      if (!current) return n
      const bindings = { ...n.numericBindings }
      if (basis && Math.abs(basis.width - current.width) > 0.00001)
        delete bindings.width
      if (basis && Math.abs(basis.height - current.height) > 0.00001)
        delete bindings.height
      return {
        ...n,
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
        numericBindings: bindings,
        ...(n.constraints && parent
          ? {
            constraints: {
              ...n.constraints,
              referenceWidth: parent.width,
              referenceHeight: parent.height,
            },
          }
          : {}),
      }
    }),
  }
}

/** Apply a crop window while preserving the active image's physical placement in the layer coordinate system.
 * @param document - Current native scene.
 * @param nodeId - Layer owning the image paint.
 * @param paintId - Active image paint identity.
 * @param rect - Crop window in the old layer's local coordinates.
 * @param channel - Paint channel; omitted retains the existing fill behavior.
 * @returns Updated layer bounds, fixed sizing on resized axes, and compensating image transform.
 */
export function cropDesignImage(
  document: CopyOSDesignDocument,
  nodeId: string,
  paintId: string,
  rect: DesignCropRect,
  channel: 'fill' | 'stroke' = 'fill',
): CopyOSDesignDocument {
  const node = resolveDesignNodes(document).find(n => n.id === nodeId)
  if (!node) throw new Error('Crop layer not found')
  if (node.kind === 'instance' && channel === 'fill')
    throw new Error('Crop the main component or detach the instance first')
  const paints = channel === 'stroke' ? designAuthoredStrokePaints(document, nodeId) : designNodePaints(
      document.nodes.find(n => n.id === nodeId) ?? node,
    ),
    paint = paints.find(p => p.id === paintId)
  if (!paint?.image) throw new Error('Crop image paint not found')
  const width = designLayoutSize(node, 'width', rect.width),
    height = designLayoutSize(node, 'height', rect.height)
  const image = designImageToCrop(paint.image, node.width, node.height),
    geometry = designImageGeometry(image, node.width, node.height)
  const nextImage = {
    ...image,
    zoom:
      geometry.imageWidth /
      designImageGeometry({ ...image, zoom: 1 }, width, height).imageWidth,
    offsetX:
      (node.width / 2 +
        (image.offsetX ?? 0) * node.width -
        rect.left -
        width / 2) /
      width,
    offsetY:
      (node.height / 2 +
        (image.offsetY ?? 0) * node.height -
        rect.top -
        height / 2) /
      height,
  }
  if (
    ![nextImage.zoom, nextImage.offsetX, nextImage.offsetY].every(
      Number.isFinite,
    ) ||
    nextImage.zoom < DESIGN_IMAGE_LIMITS.minZoom ||
    nextImage.zoom > DESIGN_IMAGE_LIMITS.maxZoom ||
    Math.abs(nextImage.offsetX) > DESIGN_IMAGE_LIMITS.maxOffset ||
    Math.abs(nextImage.offsetY) > DESIGN_IMAGE_LIMITS.maxOffset
  )
    throw new Error('Image crop exceeds transform limits')
  const angle = (node.rotation * Math.PI) / 180,
    dx = (rect.left + width / 2 - node.width / 2) * (node.flipX ? -1 : 1),
    dy = (rect.top + height / 2 - node.height / 2) * (node.flipY ? -1 : 1)
  const candidate = editDesignNodes(document, [
    {
      id: nodeId,
      x:
        node.x +
        node.width / 2 +
        Math.cos(angle) * dx -
        Math.sin(angle) * dy -
        width / 2,
      y:
        node.y +
        node.height / 2 +
        Math.sin(angle) * dx +
        Math.cos(angle) * dy -
        height / 2,
      ...(Math.abs(width - node.width) > 1e-8
        ? { width, widthSizing: 'fixed' as const }
        : {}),
      ...(Math.abs(height - node.height) > 1e-8
        ? { height, heightSizing: 'fixed' as const }
        : {}),
      ...(node.kind === 'text' ? { textSizing: 'fixed' as const } : {}),
      ...(channel === 'fill' ? { gradient: undefined, fills: paints.map(p =>
        p.id === paintId ? { ...p, image: nextImage } : p,
      ) } : {}),
    },
  ])
  const stored = candidate.nodes.find(n => n.id === nodeId)
  if (
    stored &&
    (!Number.isFinite(stored.x) ||
      !Number.isFinite(stored.y) ||
      Math.abs(stored.x) > 1000000 ||
      Math.abs(stored.y) > 1000000)
  )
    throw new Error('Image crop exceeds layer coordinate limits')
  return channel === 'stroke' ? editDesignStrokePaints(candidate, nodeId, paints.map(p =>
    p.id === paintId ? { ...p, image: nextImage } : p)) : candidate
}

/** Edit explicit linked-root stroke ownership; undefined inherits one field and null resets all stroke ownership.
 * @param document - Current complete scene.
 * @param id - Stored linked instance identity.
 * @param patch - Local stroke fields or null to restore the main's whole stroke.
 * @returns Updated document preserving unrelated bindings and overrides.
 */
export function editDesignInstanceStroke(document:CopyOSDesignDocument,id:string,patch:Partial<import('./types.ts').CopyOSDesignInstanceStroke>|null):CopyOSDesignDocument {
  const node=document.nodes.find(n=>n.id===id)
  if (!node || node.kind!=='instance') return document
  if (patch===null) {
    const bindings=Object.fromEntries(Object.entries(node.numericBindings ?? {}).filter(([key])=>
      !DESIGN_STROKE_NUMBER_KEYS.some(property=>property===key)))
    if (node.instanceStroke===undefined && JSON.stringify(bindings)===JSON.stringify(node.numericBindings ?? {})) return document
    return editDesignNodes(document,[{ id,instanceStroke:undefined,numericBindings:bindings }])
  }
  const local={ ...node.instanceStroke },bindings={ ...node.numericBindings }
  for (const key of DESIGN_STROKE_KEYS) if (Object.hasOwn(patch,key)) {
    const value=patch[key]
    if (value===undefined) Reflect.deleteProperty(local,key)
    else Object.assign(local,{ [key]:value })
    if (DESIGN_STROKE_NUMBER_KEYS.some(numberKey=>numberKey===key)) Reflect.deleteProperty(bindings,key)
  }
  const instanceStroke=Object.keys(local).length?local:undefined
  if (JSON.stringify(instanceStroke)===JSON.stringify(node.instanceStroke) &&
    JSON.stringify(bindings)===JSON.stringify(node.numericBindings ?? {})) return document
  return editDesignNodes(document,[{ id,instanceStroke,numericBindings:bindings }])
}
/** Project effective linked-root stroke controls without treating inherited fields as local ownership.
 * @param document - Complete native scene.
 * @param instance - Stored linked instance.
 * @param scene - Optional shared resolved scene for a multi-selection.
 * @returns Resolved stroke fields on the instance identity and geometry.
 */
export function designInstanceStrokeNode(
  document:CopyOSDesignDocument,instance:CopyOSDesignNode,scene=createDesignRenderScene(document),
):CopyOSDesignNode {
  if (instance.kind!=='instance') return instance
  const resolved=scene.root.byId.get(instance.id) ?? instance
  const context=scene.instance(resolved,scene.root),source=context?.byId.get(instance.componentId ?? '')
  if (!source) return resolved
  const fields=Object.fromEntries(DESIGN_STROKE_KEYS.map(key=>[key,source[key]]))
  return { ...resolved,...fields,numericBindings:instance.numericBindings }
}

/** Edit independent root grid ownership without changing main or child cell records.
 * @param document - Complete native scene.
 * @param id - Stored linked instance identity.
 * @param patch - Fields to own; undefined inherits one field, null resets every grid field.
 * @returns Candidate preserving unrelated overrides; new edits require a current grid source, resets also work while dormant.
 */
export function editDesignInstanceGrid(document:CopyOSDesignDocument,id:string,patch:import('./types.ts').CopyOSDesignInstanceGrid|null):CopyOSDesignDocument {
  const instance=document.nodes.find(node=>node.id===id)
  if (instance?.kind!=='instance') return document
  const source=document.nodes.find(node=>node.id===instance.componentId),local={ ...instance.instanceGrid }
  if (patch===null) {
    if (instance.instanceGrid===undefined) return document
    return editDesignNodes(document,[{ id,instanceGrid:undefined }])
  }
  for (const key of DESIGN_INSTANCE_GRID_KEYS) if (Object.hasOwn(patch,key)) {
    if (patch[key]===undefined) Reflect.deleteProperty(local,key)
    else if (source?.layout==='grid') Object.assign(local,{ [key]:patch[key] })
  }
  const instanceGrid=Object.keys(local).length?local:undefined
  if (JSON.stringify(instanceGrid)===JSON.stringify(instance.instanceGrid)) return document
  return editDesignNodes(document,[{ id,instanceGrid }])
}
/** Read editable effective track fallbacks while preserving live mode references.
 * @param document - Complete native scene.
 * @param instance - Stored linked instance.
 * @returns Independent effective config, or undefined when its main is not a grid.
 */
export function designInstanceGridConfig(document:CopyOSDesignDocument,instance:CopyOSDesignNode):import('./types.ts').CopyOSDesignGrid|undefined {
  const stored=document.nodes.find(node=>node.id===instance.id) ?? instance
  const source=document.nodes.find(node=>node.id===stored.componentId)
  return instance.kind==='instance' && source ? authoredDesignInstanceGrid(source,stored):undefined
}
/** Resolve actual source-root geometry and children for a linked grid editor.
 * @param document - Complete native scene.
 * @param instance - Stored linked instance identity.
 * @param scene - Shared scene for a multi-control render.
 * @returns Effective source root retaining its physical ID, resolved children and layout context; undefined outside grids.
 */
export function designInstanceGridContext(document:CopyOSDesignDocument,instance:CopyOSDesignNode,scene=createDesignRenderScene(document)):
  { node:CopyOSDesignNode;children:CopyOSDesignNode[];context:DesignRenderContext }|undefined {
  if (instance.kind!=='instance') return
  const resolved=scene.root.byId.get(instance.id) ?? instance,context=scene.instance(resolved,scene.root)
  const node=context?.byId.get(resolved.componentId ?? '')
  if (!context || node?.layout!=='grid') return
  return { node,children:context.children.get(node.id) ?? [],context }
}
/** Project inherited/local root grid settings onto a selected instance without changing geometry or binding ownership.
 * @param document - Complete native scene.
 * @param instance - Selected stored instance.
 * @param scene - Optional cached render scene.
 * @returns Instance identity with effective grid configuration and layout flow.
 */
export function designInstanceGridNode(
  document:CopyOSDesignDocument,instance:CopyOSDesignNode,scene=createDesignRenderScene(document),
):CopyOSDesignNode {
  const current=designInstanceGridContext(document,instance,scene)
  return current?{ ...instance,grid:current.node.grid,layout:'grid' }:instance
}

/** Edit one linked descendant cell without writing its main or sibling instances.
 * @param document - Complete native scene.
 * @param id - Stored instance owning the descendant path.
 * @param path - Nested instance identities followed by a reachable descendant identity.
 * @param patch - Per-field local values; undefined inherits one field, null resets only cell ownership.
 * @returns Candidate preserving unrelated overrides; native validation checks all contextual grid budgets before saving.
 */
export function editDesignInstanceGridCell(document: CopyOSDesignDocument, id: string, path: readonly string[],
  patch: import('./types.ts').CopyOSDesignInstanceGridCell | null): CopyOSDesignDocument {
  const instance = document.nodes.find(node => node.id === id)
  if (instance?.kind !== 'instance') return document
  const current = designInstanceGridCellContext(document, id, path)
  if (!current) throw new Error('Missing instance cell target')
  if (current.locked) throw new Error('Instance cell target is locked')
  const merged = mergeDesignInstanceGridCell(instance, current.overridePath, patch)
  return merged === instance ? document : editDesignNodes(document, [{ id, instanceOverrides: merged.instanceOverrides }])
}

/** Read current descendant context through one indexed immutable document snapshot.
 * @param document - Complete native scene.
 * @param scene - Optional scene for exactly this document.
 * @returns Reusable current-context lookup with canonical override paths and parent navigation paths.
 */
export function createDesignInstanceContextReader(document: CopyOSDesignDocument, scene = createDesignRenderScene(document)):
ReturnType<typeof createDesignInstanceContextLookup> {
  return createDesignInstanceContextLookup(document, scene)
}
/** Current cell information; sourceCell is intentionally omitted when sourceCellIncluded is false. */
export interface DesignInstanceGridCellReadContext extends DesignInstanceContext {
  sourceCell?: import('./types.ts').CopyOSDesignGridCell | undefined
  sourceCellIncluded: boolean
  localCell: import('./types.ts').CopyOSDesignInstanceGridCell | undefined
  active: boolean
  manual: boolean
}
/** Prepare current-only or precise inherited cell reads without repeating selection indexing.
 * @param document - Complete immutable native scene.
 * @param scene - Optional shared render scene for this document.
 * @param options - includeSourceCell defaults true; false skips counterfactual layout and explicitly omits sourceCell.
 * @returns Cached cell lookup; inherited values, when requested, remove only that target's local cell ownership.
 */
export function createDesignInstanceGridCellReader(document: CopyOSDesignDocument, scene = createDesignRenderScene(document),
  options: { includeSourceCell?: boolean } = {}): (id: string, path: readonly string[]) => DesignInstanceGridCellReadContext | undefined {
  const locate = createDesignInstanceContextReader(document, scene)
  const cache = new Map<string, DesignInstanceGridCellReadContext | undefined>()
  const includeSourceCell = options.includeSourceCell !== false
  return (id, path) => {
    const key = JSON.stringify([id, path])
    if (cache.has(key)) return cache.get(key)
    const current = locate(id, path)
    if (!current) { cache.set(key, undefined); return }
    let inherited: DesignInstanceContext | undefined = current
    if (includeSourceCell && current.record?.gridCell) {
      const sourceDocument = { ...document,
        nodes: document.nodes.map(node => node.id === id ? mergeDesignInstanceGridCell(node, current.overridePath, null) : node) }
      inherited = createDesignInstanceContextLookup(sourceDocument, createDesignRenderScene(sourceDocument),
        { includeRecord: false })(id, current.effectivePath)
    }
    const active = current.parent.layout === 'grid' && current.node.visible && !current.node.absolutePosition
    const result = { ...current, ...(includeSourceCell ? { sourceCell: inherited?.node.gridCell } : {}),
      sourceCellIncluded: includeSourceCell, localCell: current.record?.gridCell,
      active, manual: active && current.parent.grid?.autoPosition === false }
    cache.set(key, result)
    return result
  }
}
/** Read effective descendant cell placement, precise inherited values and contextual locks.
 * @param document - Complete native scene.
 * @param id - Stored instance owning the path.
 * @param path - Nested instance identities followed by a descendant identity.
 * @param scene - Optional shared scene for selection controls.
 * @returns Precise inherited/local cells; use the shared reader with includeSourceCell:false for current-only selection controls.
 */
export function designInstanceGridCellContext(document: CopyOSDesignDocument, id: string, path: readonly string[],
  scene = createDesignRenderScene(document)): DesignInstanceGridCellReadContext | undefined {
  return createDesignInstanceGridCellReader(document, scene)(id, path)
}

export { designAuthoredEffects, designEffectNumberLimits, designEffectColorAlpha, designEffectOpacity } from './design-effect-values.ts'
export type { DesignEffectNumberProperty } from './design-effect-values.ts'
export { designEffectNumberTokenSupportsProperty } from './design-token-values.ts'

export { designEffectStyleContext, editDesignEffectStyleResources, createDesignEffectStyle, updateDesignEffectStyle, removeDesignEffectStyle, applyDesignEffectStyleBatch, detachDesignEffectStyleBatch } from './design-effect-styles.ts'
export type { DesignEffectStyleTarget, DesignEffectStyleContext, DesignEffectStyleResourceChanges } from './design-effect-styles.ts'
export { designEffectStyleSchema } from './design-effects-schema.ts'
