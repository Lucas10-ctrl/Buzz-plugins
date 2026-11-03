import { designFontVariationSettings } from './design-font-variations.ts'
import { designFontFeatureSettings } from './design-font-features.ts'
import { designAuthoredEffects } from './design-effect-values.ts'
import { designNodeEffects } from './design-effects.ts'
import { designEffectSpreadSupported } from './design-effects-render.ts'
import { nodeCssConstraints, nodeCssCanSizeContain } from './design-node-css-constraints.ts'
/** Selected-layer CSS projects authored relationships without claiming SVG graphics are ordinary boxes. */
import { designConstraintsActive } from './design-constraints.ts'
import { designAspectRatioEligible, designAspectRatioLimits } from './design-aspect-ratio.ts'
import { nodeCssFontFamily } from './design-node-css-font.ts'
import { nodeCssGradient } from './design-node-css-paint.ts'
import { nodeCssContext } from './design-node-css-context.ts'
import { designTokenCssNames } from './design-token-css-names.ts'
import { designColorVariableCss } from './design-color.ts'
import { designStrokeWeights } from './design-stroke.ts'
import { designStrokeStyle } from './design-stroke-style.ts'
import { designLayerBlendStyle } from './design-layer-blend.ts'
import { designGridPlacements } from './design-grid.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignNumberProperty, CopyOSDesignPaint, CopyOSDesignEffect } from './types.ts'
import type { DesignNodeCssOptions, DesignNodeCssProjection, DesignNodeCssWarning, DesignNodeCssRequirement } from './design-node-css-types.ts'
export { DESIGN_NODE_CSS_WARNING_CODES, DESIGN_NODE_CSS_REQUIREMENT_CODES } from './design-node-css-types.ts'
export type { DesignNodeCssOptions, DesignNodeCssProjection, DesignNodeCssWarning, DesignNodeCssRequirement } from './design-node-css-types.ts'

const decimal = (value: number): string => String(Number(value.toFixed(6)))
const px = (value: number): string => `${decimal(value)}px`
const modeDocuments = new WeakMap<CopyOSDesignDocument, Map<string | null, CopyOSDesignDocument>>()
const cssString = (value: string): string => '"' + value.replace(/["\\\x00-\x1f\x7f]/g,
  char => `\\${char.codePointAt(0)?.toString(16)} `) + '"'
const policy = (node: CopyOSDesignNode, axis: 'width' | 'height') => node.kind === 'text' &&
  (node.textSizing === 'auto-width' || axis === 'height' && node.textSizing === 'auto-height') ? 'hug' :
  node[`${axis}Sizing`] ?? (node.layout === 'row' && axis === 'width' ||
    (node.layout === 'column' || node.layout === 'grid') && axis === 'height' ? 'hug' : 'fixed')

/** Generate CSS for exactly one selected layer, preserving token identities and documenting required parent/graphics context.
 * @param document - Immutable native scene; resource CSS remains available separately through exportDesignCss.
 * @param options - Stored owner, optional stable descendant path and optional document default mode override.
 * @returns Deterministic declarations, effective mode, live resource references and machine-readable fidelity warnings.
 */
export function designNodeCss(document: CopyOSDesignDocument, options: DesignNodeCssOptions): DesignNodeCssProjection {
  if (options.documentModeId !== undefined && options.documentModeId !== null &&
    !document.tokenModes?.some(mode => mode.id === options.documentModeId)) throw new Error('CSS token mode not found')
  let working = document
  if (options.documentModeId !== undefined) {
    let modes = modeDocuments.get(document)
    if (!modes) { modes = new Map(); modeDocuments.set(document, modes) }
    working = modes.get(options.documentModeId) ?? { ...document, activeTokenModeId: options.documentModeId }
    modes.set(options.documentModeId, working)
  }
  const path = [...options.instancePath ?? []], selected = nodeCssContext(working, options.nodeId, path)
  const { raw, node, parent, parentRaw, children, modeId, placementNode } = selected
  const result: DesignNodeCssProjection = { nodeId: options.nodeId, instancePath: path,
    overridePath: selected.overridePath, effectiveModeId: modeId,
    selector: '.copyos-node-' + [options.nodeId, ...path].map(id => id.replace(/[^\w-]/g, '_')).join('-'),
    declarations: [], css: '', tokenReferences: [], requirements: [], warnings: [] }
  const set = (property: string, value: string) => {
    const prior = result.declarations.find(declaration => declaration.property === property)
    if (prior) prior.value = value
    else result.declarations.push({ property, value })
  }
  const warning = (code: DesignNodeCssWarning['code'], message: string, property?: string) => {
    if (!result.warnings.some(item => item.code === code && item.property === property)) result.warnings.push({ code, message, property })
  }
  const require = (code: DesignNodeCssRequirement['code'], message: string, property?: string) => {
    if (!result.requirements.some(item => item.code === code && item.property === property))
      result.requirements.push({ code, message, property })
  }
  const names = designTokenCssNames(document)
  const reference = (kind: 'number' | 'color', id: string | null | undefined): string | undefined => {
    if (!id) return
    const resource = kind === 'number' ? document.numberVariables?.find(item => item.id === id) : document.variables.find(item => item.id === id)
    const name = names[kind].get(id)
    if (!resource || !name) throw new Error('CSS resource not found')
    if (!result.tokenReferences.some(item => item.kind === kind && item.id === id))
      result.tokenReferences.push({ kind, id, name: resource.name, cssName: name })
    require('token-css', 'Include the matching exportDesignCss resource declarations.')
    return `var(${name})`
  }
  const number = (key: CopyOSDesignNumberProperty, fallback: number, owner = raw): string =>
    reference('number', owner.numericBindings?.[key]) ?? (key === 'fontWeight' || key === 'lineHeight' ? decimal(fallback) : px(fallback))
  const color = (literal: string, id: string | null | undefined, opacity = 1): string => {
    const value = reference('color', id) ?? literal
    return opacity === 1 ? value : `color-mix(in srgb, ${value} ${decimal(opacity * 100)}%, transparent)`
  }
  if (modeId !== null || result.tokenReferences.length) require('mode-scope', 'Apply the reported data-copyos-mode resource scope.')
  const flow = !raw.preserveLayout && ['row', 'column', 'grid'].includes(raw.layout)
  const wrapFill = raw.layoutWrap === 'wrap' && children.some(child => policy(child, raw.layout === 'column' ? 'height' : 'width') === 'fill')
  const negative = raw.layout !== 'grid' && (node.gap < 0 || (node.crossGap ?? 0) < 0)
  const legacyLines = (authored: CopyOSDesignNode, displayed: CopyOSDesignNode,
    context: typeof selected.context) => authored.layoutSizingModel !== 'css' && authored.justifyContent === 'between' &&
      (authored.layout === 'row' || authored.layout === 'column')
    ? context.stackLines.get(displayed.id) ?? [] : []
  const lines = legacyLines(raw, node, selected.context)
  const legacySingle = lines.length === 1 && lines[0]?.nodeIds.length === 1 && lines[0].mainGapAutomatic
  const legacyWrapped = lines.length > 1 && lines.some(line => line.nodeIds.length === 1 && line.mainGapAutomatic)
  const snapshot = !!raw.preserveLayout || negative || wrapFill || legacyWrapped
  const constraintParent = children.some(child => child.constraints && designConstraintsActive(child, node))
  if (constraintParent && nodeCssCanSizeContain(raw)) set('container-type', 'size')
  if (raw.preserveLayout) warning('preserved-layout', 'Saved geometry is preserved; this snippet does not activate auto layout.')
  if (negative) warning('negative-gap', 'CSS gap cannot represent negative native spacing; children require positioned snapshot geometry.', 'gap')
  if (wrapFill) warning('wrap-fill', 'Native wrapping measures Fill children before allocation; positioned children preserve this snapshot.')
  if (legacyWrapped) warning('legacy-auto-spacing', 'Legacy Between spacing centers single-item wrapped lines; positioned children retain this geometry.')
  set('box-sizing', 'border-box')
  if (!node.visible) set('display', 'none')
  else if (flow && !snapshot) {
    set('display', raw.layout === 'grid' ? 'grid' : 'flex')
    if (raw.layout !== 'grid') {
      set('flex-direction', raw.layout === 'row' ? 'row' : 'column')
      set('flex-wrap', raw.layoutWrap === 'wrap' ? 'wrap' : 'nowrap')
      set('align-items', raw.alignItems === 'baseline' ? 'baseline' : (raw.alignItems ?? 'start') === 'start' ? 'flex-start' : raw.alignItems === 'end' ? 'flex-end' : 'center')
      const mainAxis = raw.layout === 'row' ? 'width' : 'height'
      const automatic = policy(node, mainAxis) !== 'hug' && ['between', 'around', 'evenly'].includes(raw.justifyContent ?? 'start')
      const justify = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' }
      set('justify-content', legacySingle ? 'safe center' : automatic || !['between', 'around', 'evenly'].includes(raw.justifyContent ?? 'start') ? justify[raw.justifyContent ?? 'start'] : 'flex-start')
      set(raw.layout === 'row' ? 'column-gap' : 'row-gap', automatic ? '0px' : number('gap', raw.gap))
      set(raw.layout === 'row' ? 'row-gap' : 'column-gap', raw.crossGap === undefined && !raw.numericBindings?.crossGap ? '0px' : number('crossGap', raw.crossGap ?? 0))
      set('align-content', { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', stretch: 'stretch' }[raw.alignContent ?? 'start'])
    } else {
      const grid = raw.grid
      if (grid) {
        const track = (value: typeof grid.columns[number]) => {
          if (value.sizing === 'hug') return 'max-content'
          if (value.sizing === 'fill') {
            const bound = reference('number', value.variableId)
            if (bound) warning('grid-placement', 'Live number-to-fr calculation is not portable; the effective mode weight is captured.', 'grid-template')
            const effective = value.variableId ? (selected.numbers.get(value.variableId) ?? value.value) : value.value
            return `minmax(0, ${decimal(effective)}fr)`
          }
          return reference('number', value.variableId) ?? px(value.value)
        }
        set('grid-template-columns', grid.columns.map(track).join(' '))
        if (grid.rows.length) set('grid-template-rows', grid.rows.map(track).join(' '))
        set('grid-auto-rows', track(grid.implicitRow))
        set('column-gap', number('gap', raw.gap)); set('row-gap', number(raw.crossGap === undefined && !raw.numericBindings?.crossGap ? 'gap' : 'crossGap', raw.crossGap ?? raw.gap))
        set('grid-auto-flow', 'row dense')
        warning('grid-placement', 'Apply projected cell positions to every participating child; native spanning-track sizing can differ from CSS Grid.')
      }
    }
    for (const [css, key] of [['top', 'paddingTop'], ['right', 'paddingRight'], ['bottom', 'paddingBottom'], ['left', 'paddingLeft']] as const)
      set(`padding-${css}`, number(raw[key] === undefined ? 'padding' : key, raw[key] ?? raw.padding))
  }
  set('position', 'relative')
  const parentFlow = !!parentRaw && !parentRaw.preserveLayout && ['row', 'column', 'grid'].includes(parentRaw.layout) && !placementNode.absolutePosition
  const parentLegacyLines = parentRaw && parent ? legacyLines(parentRaw, parent, selected.parentContext) : []
  const parentLegacyWrapped = parentLegacyLines.length > 1 &&
    parentLegacyLines.some(line => line.nodeIds.length === 1 && line.mainGapAutomatic)
  if (parentLegacyWrapped) warning('legacy-auto-spacing',
    'The containing legacy Between stack requires positioned children to retain single-item wrapped-line geometry.')
  const parentSnapshot = !!parentRaw && (parentRaw.preserveLayout ||
    (parent?.gap ?? 0) < 0 || (parent?.crossGap ?? 0) < 0 || parentLegacyWrapped ||
    parentRaw.layoutWrap === 'wrap' && (selected.parentContext.children.get(parent?.id ?? '') ?? [])
      .some(child => child.visible && !child.absolutePosition && policy(child, parentRaw.layout === 'column' ? 'height' : 'width') === 'fill'))
  if (parent && (!parentFlow || parentSnapshot)) {
    set('position', 'absolute'); set('left', px(placementNode.x)); set('top', px(placementNode.y))
    require('positioned-parent', 'The containing parent must establish a positioning context.')
  } else if (parentFlow) {
    require('parent-layout', 'Apply the matching projected parent layout and all participating siblings.')
    if (parentRaw.layout === 'grid' && parent) {
      const placement = designGridPlacements(parent, selected.parentContext.children.get(parent.id) ?? [])
        .find(item => item.id === placementNode.id)
      if (placement) {
        set('grid-column', `${placement.column + 1} / span ${placement.columnSpan}`)
        set('grid-row', `${placement.row + 1} / span ${placement.rowSpan}`)
      }
      if (!parentSnapshot) {
        set('justify-self', placementNode.gridCell?.horizontalAlign ?? 'start')
        set('align-self', placementNode.gridCell?.verticalAlign ?? 'start')
      }
    } else set('flex-shrink', '0')
  }
  const constraintSnapshot = !!node.constraints && !!parent && !parentFlow
  for (const axis of ['width', 'height'] as const) {
    const sizing = policy(node, axis), bound = number(axis, raw[axis])
    if (snapshot || parentSnapshot || constraintSnapshot) set(axis, px(node[axis]))
    else if (sizing === 'hug') {
      if (raw.kind === 'text' || flow) set(axis, 'max-content')
      else {
        set(axis, number(axis, raw[axis]))
        warning('box-model', 'Hug is dormant without an intrinsic text or auto-layout sizing model; the fixed authored axis is retained.', axis)
      }
    }
    else if (sizing === 'fill' && parentFlow && parent && policy(parent, axis) === 'hug') {
      set(axis, number(axis, node[axis]))
      warning('box-model', 'Fill is not allocated on a Hug parent axis; the natural authored axis is retained.', axis)
    }
    else if (sizing === 'fill' && parentFlow) {
      if (parentRaw.layout === 'grid') set(axis, '100%')
      else if ((parentRaw.layout === 'row' ? 'width' : 'height') === axis) {
        set('flex-grow', '1'); set('flex-basis', '0px')
        set(axis, '0px')
        if (parentRaw.layoutSizingModel === 'css' && flow) {
          set('box-sizing', 'content-box')
          warning('box-model', 'Native Fill shares content space before child insets; verify intrinsic floors and cross-axis outer sizing.')
        } else if (parentRaw.layoutSizingModel !== 'css') {
          const siblings = (selected.parentContext.children.get(parent?.id ?? '') ?? [])
            .filter(item => item.visible && !item.absolutePosition)
          const fills = siblings.filter(item => policy(item, axis) === 'fill')
          const automatic = policy(parent ?? node, axis) !== 'hug' &&
            ['between', 'around', 'evenly'].includes(parentRaw.justifyContent ?? 'start')
          const gap = automatic ? '0px' : number('gap', parentRaw.gap, parentRaw)
          const occupied = siblings.filter(item => policy(item, axis) !== 'fill').map((item) => {
            const source = selected.siblingsRaw.find(value => value.id === item.id)
            return source ? number(axis, item[axis], source) : px(item[axis])
          })
          const total = [...occupied, `(${gap} * ${Math.max(0, siblings.length - 1)})`].join(' + ')
          set('flex-grow', '0')
          set('flex-basis', `max(0px, calc((100% - (${total})) / ${Math.max(1, fills.length)}))`)
          if (fills.some(item => axis === 'width' ? item.minWidth !== undefined || item.maxWidth !== undefined :
            item.minHeight !== undefined || item.maxHeight !== undefined))
            warning('box-model', 'Bounded legacy Fill redistribution needs the native allocator; this basis preserves unbounded equal outer shares.')
        }
      } else { set(axis, 'auto'); set('align-self', 'stretch') }
    } else set(axis, sizing === 'fill' ? px(node[axis]) : bound)
    for (const prefix of ['min', 'max'] as const) {
      const key = `${prefix}${axis === 'width' ? 'Width' : 'Height'}` as const
      if (node[key] !== undefined) set(`${prefix}-${axis}`, number(key, raw[key] ?? node[key]))
    }
  }
  const blend = designLayerBlendStyle(node)
  set('isolation', blend.isolation); set('mix-blend-mode', blend.mixBlendMode)
  if (node.opacity !== 1) set('opacity', decimal(node.opacity))
  if (node.clip) set('overflow', 'hidden')
  if (node.rotation || node.flipX || node.flipY) {
    set('transform-origin', 'center')
    set('transform', `rotate(${decimal(node.rotation)}deg) scale(${node.flipX ? -1 : 1}, ${node.flipY ? -1 : 1})`)
  }
  const authoredEffects = designAuthoredEffects(designNodeEffects(node))
  const effects = authoredEffects.filter(effect => effect.type !== 'layer-blur')
    .filter(effect => effect.visible && (effect.opacity > 0 || effect.numericBindings?.opacity))
  const layerBlur = authoredEffects.find(effect => effect.type === 'layer-blur'), effectFilters: string[] = []
  const spreadSupported = designEffectSpreadSupported(node)
  if (effects.some(effect => effect.spread && !spreadSupported))
    warning('svg-paint', 'Shadow spread remains dormant on this geometry.', 'filter')
  const effectNumber = (effect: CopyOSDesignEffect, key: string, fallback: number): string =>
    reference('number', effect.numericBindings?.[key as keyof typeof effect.numericBindings]) ?? (key === 'opacity' ? decimal(fallback) : px(fallback))
  const effectSigma = (effect: CopyOSDesignEffect, key: string, fallback: number): string => {
    const token = reference('number', effect.numericBindings?.[key as keyof typeof effect.numericBindings])
    return token ? `calc(${token} / 2)` : px(fallback / 2)
  }
  const singleShadow = effects.length === 1 ? effects[0] : undefined
  if (singleShadow?.type === 'drop-shadow' && !singleShadow.spread && !singleShadow.numericBindings?.spread) {
    const opacity = reference('number', singleShadow.numericBindings?.opacity)
    const tokenColor = reference('color', singleShadow.colorVariableId)
    const intrinsic = tokenColor ?? designColorVariableCss({ value: singleShadow.color, alpha: singleShadow.colorAlpha ?? 1 })
    const color = opacity ? `color-mix(in srgb, ${intrinsic} calc(${opacity} * 100%), transparent)` :
      tokenColor ? singleShadow.opacity === 1 ? tokenColor :
        `color-mix(in srgb, ${tokenColor} ${decimal(singleShadow.opacity * 100)}%, transparent)` :
        designColorVariableCss({ value: singleShadow.color, alpha: (singleShadow.colorAlpha ?? 1) * singleShadow.opacity })
    effectFilters.push(`drop-shadow(${effectNumber(singleShadow, 'x', singleShadow.x)} ${effectNumber(singleShadow, 'y', singleShadow.y)} ${effectSigma(singleShadow, 'blur', singleShadow.blur)} ${color})`)
  } else if (effects.length) {
    warning('svg-paint', 'Independent shadow stacks and spread require the native SVG renderer.', 'filter')
    require('svg-renderer', 'Use the native independent SourceAlpha effect filter for this shadow stack.')
    for (const effect of effects) {
      reference('color', effect.colorVariableId)
      for (const id of Object.values(effect.numericBindings ?? {})) reference('number', id)
    }
  }
  if (layerBlur?.visible) effectFilters.push(`blur(${effectSigma(layerBlur, 'radius', layerBlur.radius)})`)
  if (effectFilters.length) set('filter', effectFilters.join(' '))
  if ((raw.kind === 'path' || raw.kind === 'boolean')) { warning('svg-geometry', 'Vector paths require the native SVG geometry.'); require('svg-renderer', 'Use exportDesignSvg for vector geometry.') }
  if (raw.kind === 'ellipse') set('border-radius', '50%')
  else for (const [css, key] of [['top-left', 'radiusTopLeft'], ['top-right', 'radiusTopRight'],
    ['bottom-right', 'radiusBottomRight'], ['bottom-left', 'radiusBottomLeft']] as const)
    set(`border-${css}-radius`, number(raw[key] === undefined ? 'radius' : key, raw[key] ?? raw.radius))
  const paints: CopyOSDesignPaint[] = raw.fills ?? [{ id: raw.id, color: raw.fill, variableId: raw.fillVariableId,
    opacity: raw.fillOpacity ?? 1, visible: true, gradient: raw.gradient, image: raw.kind === 'image' && raw.imageUrl ? { url: raw.imageUrl, scaleMode: 'fill' } : undefined }]
  const visible = (raw.kind === 'group' ? [] : paints).filter(paint => paint.visible && paint.opacity > 0).reverse()
  if (designLayerBlendStyle(node).isolation === 'auto' && visible.some(paint => paint.blendMode && paint.blendMode !== 'normal')) {
    warning('layer-compositing', 'CSS backgrounds isolate paint blending; pass-through paint interaction with external content needs native SVG.')
    require('svg-renderer', 'Use native SVG for pass-through per-paint blending.')
  }
  if (raw.kind === 'text') set('color', 'transparent')
  const firstPaint = visible[0]
  const needsSvgPaint = visible.some(paint => paint.gradient && !nodeCssGradient(paint, color) || paint.image &&
    (paint.image.scaleMode === 'crop' || paint.image.scaleMode === 'tile' || paint.opacity !== 1) || paint.blendMode === 'plus-lighter')
  if (needsSvgPaint) { warning('svg-paint', 'Transformed gradients, cropped/tiled images or Plus lighter backgrounds require a graphics compositor.'); require('svg-renderer', 'Use native SVG to preserve complex paint geometry.') }
  else if (raw.kind === 'text') {
    if (visible.length === 1 && firstPaint && !firstPaint.image && !firstPaint.gradient)
      set('color', color(firstPaint.color, firstPaint.variableId, firstPaint.opacity))
    else if (visible.length === 1 && firstPaint && firstPaint.gradient) {
      set('background-image', nodeCssGradient(firstPaint, color) ?? 'none')
      set('background-clip', 'text'); set('-webkit-background-clip', 'text'); set('color', 'transparent')
    }
    else if (visible.length) { warning('text-layout', 'Multiple text paints require glyph clipping and compositing.'); require('svg-renderer', 'Use native SVG for multicolor glyph paints.') }
  } else if (visible.length) {
    set('background-image', visible.map(paint => paint.image ? `url(${cssString(paint.image.url)})` :
      nodeCssGradient(paint, color) ?? `linear-gradient(${color(paint.color, paint.variableId, paint.opacity)}, ${color(paint.color, paint.variableId, paint.opacity)})`).join(', '))
    set('background-blend-mode', visible.map(paint => paint.blendMode ?? 'normal').join(', '))
    set('background-size', visible.map(paint => !paint.image || paint.image.scaleMode === 'stretch' ? '100% 100%' : paint.image.scaleMode === 'fit' ? 'contain' : 'cover').join(', '))
    set('background-position', 'center'); set('background-repeat', 'no-repeat')
  }
  const strokes: CopyOSDesignPaint[] = raw.strokes ?? (raw.strokeWidth > 0 ? [{ id: raw.id, color: raw.stroke,
    variableId: raw.strokeVariableId ?? null,
    visible: true, opacity: 1 }] : [])
  const stroke = strokes.filter(paint => paint.visible && paint.opacity > 0), style = designStrokeStyle(raw)
  const firstStroke = stroke[0]
  if (firstStroke) {
    if (stroke.length !== 1 || firstStroke.gradient || firstStroke.image || raw.kind === 'text' || (raw.kind === 'path' || raw.kind === 'boolean') ||
      raw.strokeAlign !== 'inside' || style.dashes.length || firstStroke.blendMode && firstStroke.blendMode !== 'normal') {
      warning('svg-stroke', 'This stroke placement, paint stack or dash geometry requires SVG rather than a CSS border.')
      require('svg-renderer', 'Use native SVG to preserve stroke geometry.')
    } else if (!flow || !(raw.strokesIncludedInLayout ?? raw.layoutSizingModel === 'css') || constraintParent) {
      const widths = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => {
        const key = `stroke${side}Width` as const
        return number(raw[key] === undefined ? 'strokeWidth' : key, raw[key] ?? raw.strokeWidth)
      })
      if (new Set(widths).size === 1)
        set('box-shadow', `inset 0 0 0 ${widths[0]} ${color(firstStroke.color, firstStroke.variableId, firstStroke.opacity * (raw.strokeOpacity ?? 1))}`)
      else {
        warning('svg-stroke', 'This unequal inside stroke needs an overlay to preserve exact content and constraint insets.')
        require('svg-renderer', 'Use native SVG for non-layout unequal inside strokes.')
      }
    } else {
      set('border-style', 'solid')
      set('border-color', color(firstStroke.color, firstStroke.variableId, firstStroke.opacity * (raw.strokeOpacity ?? 1)))
      const weights = designStrokeWeights(raw)
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const key = `stroke${side.charAt(0).toUpperCase()}${side.slice(1)}Width` as CopyOSDesignNumberProperty
        set(`border-${side}-width`, number(raw[key as keyof CopyOSDesignNode] === undefined ? 'strokeWidth' : key, weights[side]))
      }
    }
  }
  if (flow && !snapshot && raw.strokeAlign === 'inside' && (raw.strokesIncludedInLayout ?? raw.layoutSizingModel === 'css') &&
    !result.declarations.some(item => item.property === 'border-style')) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      const padding = `padding${side}` as const, strokeKey = `stroke${side}Width` as const
      const inset = number(raw[strokeKey] === undefined ? 'strokeWidth' : strokeKey, raw[strokeKey] ?? raw.strokeWidth)
      set(`padding-${side.toLowerCase()}`, `calc(${number(raw[padding] === undefined ? 'padding' : padding, raw[padding] ?? raw.padding)} + ${inset})`)
    }
  }
  if (raw.kind === 'text') {
    if (raw.textRuns?.some(run => run.style.hyperlink))
      require('text-link-markup', 'Preserve linked ranges as semantic anchors and implement stored-node navigation; CSS cannot encode hyperlink targets.')
    if (raw.textRuns?.length) {
      warning('text-layout', 'Mixed inline formatting requires the native rich text spans; one CSS rule describes only the base layer style.')
      require('svg-renderer', 'Use native rich text markup or SVG to preserve inline typography and colors.')
    }
    set('font-family', nodeCssFontFamily(raw.fontFamily)); set('font-size', number('fontSize', raw.fontSize))
    set('font-weight', number('fontWeight', raw.fontWeight)); set('font-style', raw.fontStyle ?? 'normal')
    set('font-feature-settings', designFontFeatureSettings(node.fontFeatures))
    set('font-variation-settings', designFontVariationSettings(node.fontVariations))
    set('line-height', number('lineHeight', raw.lineHeight)); set('letter-spacing', number('letterSpacing', (raw.letterSpacing ?? 0)))
    set('text-decoration', raw.textDecoration ?? 'none'); set('text-transform', raw.textCase ?? 'none')
    if (raw.verticalAlign && raw.verticalAlign !== 'top')
      warning('text-layout', 'Vertical text alignment requires a matching text wrapper; no extra HTML is generated.')
    set('text-align', raw.textAlign); set('white-space', raw.textWrap === false || raw.textSizing === 'auto-width' ? 'pre' : 'pre-wrap')
    require('font-resource', 'Load the selected font family and weight; CSS does not install fonts.')
    warning('font-availability', 'Text metrics depend on the installed font and browser shaping.')
    if (raw.paragraphSpacing) warning('paragraph-spacing', 'Paragraph spacing requires separate paragraph elements; this snippet contains no HTML.')
    if (raw.textTruncation === 'ending') warning('text-layout', 'Native line-cap and paragraph clipping require matching text markup.')
  }
  if (result.declarations.some(item => item.property === 'box-sizing' && item.value === 'content-box')) {
    for (const dimension of ['width', 'height'] as const) {
      const sides = dimension === 'width' ? ['Left', 'Right'] as const : ['Top', 'Bottom'] as const
      const insets = sides.map((side) => {
        const key = `padding${side}` as const
        return result.declarations.find(item => item.property === `padding-${side.toLowerCase()}`)?.value ??
          number(raw[key] === undefined ? 'padding' : key, raw[key] ?? raw.padding)
      })
      if (result.declarations.some(item => item.property === 'border-style')) for (const side of sides) {
        const key = `stroke${side}Width` as const
        insets.push(number(raw[key] === undefined ? 'strokeWidth' : key, raw[key] ?? raw.strokeWidth))
      }
      for (const declaration of result.declarations) if ([dimension, `min-${dimension}`, `max-${dimension}`].includes(declaration.property) &&
        !['0px', 'auto', 'max-content'].includes(declaration.value))
        declaration.value = `max(0px, calc(${declaration.value} - ${insets.join(' - ')}))`
    }
  }
  const ratio = designAspectRatioEligible(node) ? node.targetAspectRatio : null
  if (ratio) {
    const feasible = designAspectRatioLimits(node).feasible
    const r = ratio.x / ratio.y, widthPolicy = policy(node, 'width'), heightPolicy = policy(node, 'height')
    set('aspect-ratio', `${ratio.x} / ${ratio.y}`)
    const bothFill = widthPolicy === 'fill' && heightPolicy === 'fill' && parentFlow
    const bothHug = widthPolicy === 'hug' && heightPolicy === 'hug'
    let driver: 'width' | 'height' | undefined = widthPolicy === 'fill' && parentFlow ? 'width' :
      heightPolicy === 'fill' && parentFlow ? 'height' : raw.numericBindings?.width ? 'width' :
        raw.numericBindings?.height ? 'height' : widthPolicy === 'hug' ? 'width' : heightPolicy === 'hug' ? 'height' : undefined
    const boundedSnapshot = !driver && !constraintSnapshot && (node.width !== raw.width || node.height !== raw.height)
    if (bothFill || bothHug || !feasible || boundedSnapshot) {
      set('width', px(node.width)); set('height', px(node.height))
      set('flex-grow', '0'); set('flex-basis', 'auto'); set('align-self', 'flex-start')
      warning('box-model', boundedSnapshot ? 'Native bounds adjusted passive ratio geometry; regenerate this bounded snapshot when limits change.' :
        feasible ? 'Dual Fill/Hug ratio resolution uses a native contain/cover snapshot; regenerate after parent or intrinsic-content changes.' :
          'No proportional rectangle satisfies the native bounds; independent bounded snapshot dimensions take precedence.', 'aspect-ratio')
      driver = undefined
    }
    if (driver && !snapshot && !parentSnapshot && !constraintSnapshot) {
      if (result.declarations.some(item => item.property === 'box-sizing' && item.value === 'content-box')) {
        // Border-box CSS ratios describe native outer proportions; retain content-share allocation in an explicit outer flex basis.
        const main = parentRaw?.layout === 'row' ? 'width' : 'height'
        const siblings = (selected.parentContext.children.get(parent?.id ?? '') ?? []).filter(item => item.visible && !item.absolutePosition)
        const fills = siblings.filter(item => policy(item, main) === 'fill')
        const inset = (item: CopyOSDesignNode): string => {
          if (!['row', 'column', 'grid'].includes(item.layout) || item.preserveLayout) return '0px'
          const sides = main === 'width' ? ['Left', 'Right'] as const : ['Top', 'Bottom'] as const
          const values = sides.map((side) => {
            const key = `padding${side}` as const
            return number(item[key] === undefined ? 'padding' : key, item[key] ?? item.padding, item)
          })
          if (item.strokeAlign === 'inside' && (item.strokesIncludedInLayout ?? item.layoutSizingModel === 'css'))
            for (const side of sides) {
              const key = `stroke${side}Width` as const
              values.push(number(item[key] === undefined ? 'strokeWidth' : key, item[key] ?? item.strokeWidth, item))
            }
          return values.join(' + ')
        }
        const gaps = parentRaw ? number('gap', parentRaw.gap, parentRaw) : '0px'
        const occupied = siblings.filter(item => policy(item, main) !== 'fill').map((item) => {
          const source = selected.siblingsRaw.find(candidate => candidate.id === item.id)
          return source ? number(main, item[main], source) : px(item[main])
        })
        const insets = fills.map(item => inset(selected.siblingsRaw.find(candidate => candidate.id === item.id) ?? item))
        const subtractions = [...occupied, ...insets, `(${gaps} * ${Math.max(0, siblings.length - 1)})`]
        set('box-sizing', 'border-box'); set('flex-grow', '0')
        set('flex-basis', `max(0px, calc((100% - (${subtractions.join(' + ')})) / ${Math.max(1, fills.length)} + ${inset(raw)}))`)
        // Undo the earlier content-box conversion for dimensions and caps before applying transferred proportional caps.
        for (const axis of ['width', 'height'] as const) {
          if (policy(node, axis) === 'fixed') set(axis, number(axis, raw[axis]))
          for (const prefix of ['min', 'max'] as const) {
            const key = `${prefix}${axis === 'width' ? 'Width' : 'Height'}` as const
            if (node[key] !== undefined) set(`${prefix}-${axis}`, number(key, raw[key] ?? node[key]))
          }
        }
      }
      set(driver === 'width' ? 'height' : 'width', 'auto')
      // Native dimensions never fall below one pixel; transfer that floor to the driving axis too.
      for (const axis of ['width', 'height'] as const) {
        const floor = px(axis === 'width' ? Math.max(1, r) : Math.max(1, 1 / r))
        const original = result.declarations.find(item => item.property === `min-${axis}`)?.value
        set(`min-${axis}`, original ? `max(${original}, ${floor})` : floor)
      }
    }
    if (feasible) for (const prefix of ['min', 'max'] as const) for (const axis of ['width', 'height'] as const) {
      const other = axis === 'width' ? 'height' : 'width'
      const key = `${prefix}${other === 'width' ? 'Width' : 'Height'}` as const
      if (node[key] === undefined) continue
      const transferred = `calc(${number(key, raw[key] ?? node[key])} ${axis === 'width' ? '*' : '/'} ${r})`
      const original = result.declarations.find(item => item.property === `${prefix}-${axis}`)?.value
      set(`${prefix}-${axis}`, original ? `${prefix === 'min' ? 'max' : 'min'}(${original}, ${transferred})` : transferred)
    }
  }
  if (constraintParent && nodeCssCanSizeContain(raw)) for (const axis of ['width', 'height'] as const) {
    const insets = (axis === 'width' ? ['left', 'right'] : ['top', 'bottom']).map((side) => {
      const padding = result.declarations.find(item => item.property === `padding-${side}`)?.value ?? '0px'
      const border = result.declarations.find(item => item.property === `border-${side}-width`)?.value ?? '0px'
      return `(${padding} + ${border})`
    })
    for (const id of new Set([raw.id, placementNode.id])) set(`--copyos-inset-${id}-${axis}`, `calc(${insets.join(' + ')})`)
  }
  const constraints = nodeCssConstraints({ raw, node, parentRaw, parent, number, numbers: selected.numbers,
    parentChildren: selected.parentContext.children.get(parent?.id ?? '') ?? [], naturalSize: selected.naturalSize })
  if (constraints) {
    for (const item of constraints.declarations) set(item.property, item.value)
    for (const item of constraints.warnings) warning(item.code, item.message, item.property)
    const parentRequirement = result.requirements.find(item => item.code === 'positioned-parent')
    if (parentRequirement) parentRequirement.message = 'Apply the matching projected parent; constraints require its positioning and declared size-container context.'
    else require('positioned-parent', 'Apply the matching projected parent; constraints require its positioning and declared size-container context.')
  }
  if (result.tokenReferences.length) require('mode-scope', 'Use the reported effective mode with the matching resource stylesheet.')
  result.css = `${result.selector} {\n${result.declarations.map(item => `  ${item.property}: ${item.value};`).join('\n')}\n}`
  return result
}
