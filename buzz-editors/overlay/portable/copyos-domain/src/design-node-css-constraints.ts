/** Responsive constraint CSS follows native outer-coordinate equations rather than browser inset anchoring. */
import { designConstraintsActive } from './design-constraints.ts'
import { designAspectRatioEligible, designAspectRatioLimits } from './design-aspect-ratio.ts'
import { designLayoutBox, designLayoutSize } from './design-layout-box.ts'
import { designStrokeStyle } from './design-stroke-style.ts'
import type { CopyOSDesignNode, CopyOSDesignNumberProperty } from './types.ts'
import type { DesignNodeCssWarning } from './design-node-css-types.ts'
type Axis = 'width' | 'height'
type NumberValue = (key: CopyOSDesignNumberProperty, fallback: number, owner?: CopyOSDesignNode) => string
const decimal = (value: number) => String(Number(value.toFixed(12)))
const px = (value: number) => `${decimal(value)}px`
const calc = (value: string) => `calc(${value})`
const multiply = (value: string, factor: number) => factor === 0 ? '0px' : factor === 1 ? value : calc(`${value} * ${decimal(factor)}`)

/** Identify the same layout-consuming CSS border emitted by the selected-layer paint projection.
 * @param node - Authored token-bearing parent, after instance/style overlays.
 * @param children - Direct resolved children; active constraints use a non-quantized inside overlay instead.
 * @returns True only for a single visible solid inside stroke represented by an actual CSS border.
 */
export function nodeCssUsesBorder(node: CopyOSDesignNode, children: readonly CopyOSDesignNode[] = []): boolean {
  if (children.some(child => child.constraints && designConstraintsActive(child, node))) return false
  const paints = node.strokes ?? (node.strokeWidth > 0 ? [{ visible: true, opacity: 1 }] : [])
  const visible = paints.filter(paint => paint.visible && paint.opacity > 0), first = visible[0]
  return !!first && visible.length === 1 && !('gradient' in first && first.gradient) && !('image' in first && first.image) &&
    (!('blendMode' in first) || !first.blendMode || first.blendMode === 'normal') && node.kind !== 'text' && node.kind !== 'path' &&
    node.strokeAlign === 'inside' && !designStrokeStyle(node).dashes.length && node.layout !== 'none' && !node.preserveLayout &&
    (node.strokesIncludedInLayout ?? node.layoutSizingModel === 'css')
}
/** Determine whether size containment leaves the projected parent's intrinsic sizing unchanged.
 * @param node - Authored parent after contextual source overlays.
 * @returns True for fixed axes, free-layout dormant Hug, or explicitly preserved geometry.
 */
export function nodeCssCanSizeContain(node: CopyOSDesignNode): boolean {
  return !!node.preserveLayout || node.layout === 'none' ||
    (node.widthSizing ?? (node.layout === 'row' ? 'hug' : 'fixed')) === 'fixed' &&
    (node.heightSizing ?? (node.layout === 'column' || node.layout === 'grid' ? 'hug' : 'fixed')) === 'fixed'
}
/** Inputs preserve raw live relationships while a lazy native read supplies intrinsic pre-constraint measurements. */
export interface NodeCssConstraintInput {
  raw: CopyOSDesignNode
  node: CopyOSDesignNode
  parentRaw: CopyOSDesignNode | undefined
  parent: CopyOSDesignNode | undefined
  naturalSize: () => { width: number; height: number }
  number: NumberValue
  numbers: ReadonlyMap<string, number>
  parentChildren: readonly CopyOSDesignNode[]
}
/** Resulting dimensions and offsets override only active constraint geometry. */
export interface NodeCssConstraintResult {
  declarations: { property: string; value: string }[]
  warnings: DesignNodeCssWarning[]
}
/** Project native edge, center, stretch and scale rules using the containing parent's outer dimensions.
 * @param input - Contextual authored/resolved geometry, live token serializer and lazy natural-size reader.
 * @returns Responsive declarations and specific compatibility/intrinsic warnings, or undefined while constraints are dormant.
 */
export function nodeCssConstraints(input: NodeCssConstraintInput): NodeCssConstraintResult | undefined {
  const { raw, node, parent, parentRaw, number } = input, rules = raw.constraints
  if (!parent || !parentRaw || !rules || !designConstraintsActive(raw, parentRaw)) return
  const result: NodeCssConstraintResult = { declarations: [], warnings: [] }
  const set = (property: string, value: string) => result.declarations.push({ property, value })
  const warn = (message: string, property?: string, code: DesignNodeCssWarning['code'] = 'constraint-layout') => {
    if (!result.warnings.some(value => value.message === message))
      result.warnings.push({ code, message, ...(property ? { property } : {}) })
  }
  const sides = { width: ['Left', 'Right'], height: ['Top', 'Bottom'] } as const
  const border = (side: 'Left' | 'Right' | 'Top' | 'Bottom') => {
    if (!nodeCssUsesBorder(parentRaw, input.parentChildren)) return '0px'
    const key = `stroke${side}Width` as const
    return number(parentRaw[key] === undefined ? 'strokeWidth' : key, parentRaw[key] ?? parentRaw.strokeWidth, parentRaw)
  }
  const ratio = designAspectRatioEligible(node) ? node.targetAspectRatio : null
  const crossAxisLengths = !!ratio && nodeCssCanSizeContain(parentRaw)
  const outer = (axis: Axis) => crossAxisLengths ? calc(`100${axis === 'width' ? 'cqw' : 'cqh'} + var(--copyos-inset-${parentRaw.id}-${axis}, 0px)`) :
    calc(`100% + ${border(sides[axis][0])} + ${border(sides[axis][1])}`)
  if (crossAxisLengths) warn('Responsive proportional constraints require the matching size-container parent and CSS container-query units.', undefined, 'css-container-units')
  const floor = (axis: Axis) => {
    if (raw.layout === 'none' || raw.preserveLayout || raw.layoutSizingModel !== 'css') return '0px'
    const values = sides[axis].flatMap((side) => {
      const key = `padding${side}` as const
      const padding = number(raw[key] === undefined ? 'padding' : key, raw[key] ?? raw.padding)
      const strokeKey = `stroke${side}Width` as const
      return raw.strokeAlign === 'inside' && (raw.strokesIncludedInLayout ?? raw.layoutSizingModel === 'css')
        ? [padding, number(raw[strokeKey] === undefined ? 'strokeWidth' : strokeKey, raw[strokeKey] ?? raw.strokeWidth)] : [padding]
    })
    return calc(values.join(' + '))
  }
  const lower = (axis: Axis) => {
    const key = axis === 'width' ? 'minWidth' : 'minHeight'
    return `max(1px, ${floor(axis)}, ${number(key, raw[key] ?? 1)})`
  }
  const upper = (axis: Axis) => {
    const key = axis === 'width' ? 'maxWidth' : 'maxHeight'
    return number(key, raw[key] ?? 100000)
  }
  const bounded = (axis: Axis, value: string) => `max(${lower(axis)}, min(${upper(axis)}, ${value}))`
  const isHug = (axis: Axis) => !raw.preserveLayout && (raw.kind === 'text' && (raw.textSizing === 'auto-width' ||
    axis === 'height' && raw.textSizing === 'auto-height') || raw.layout !== 'none' && raw[`${axis}Sizing`] === 'hug' ||
    raw[`${axis}Sizing`] === undefined && (axis === 'width' && raw.layout === 'row' || axis === 'height' && ['column', 'grid'].includes(raw.layout)))
  let intrinsic: { width: number; height: number } | undefined
  const liveIntrinsic = new Set<Axis>()
  const base: Record<Axis, string> = { width: '', height: '' }
  for (const axis of ['width', 'height'] as const) {
    const mode = axis === 'width' ? rules.horizontal : rules.vertical
    if (isHug(axis) && !ratio && !['scale', 'left-right', 'top-bottom'].includes(mode)) {
      base[axis] = px(raw[axis]); liveIntrinsic.add(axis)
    } else if (isHug(axis)) {
      intrinsic ??= input.naturalSize()
      base[axis] = px(intrinsic[axis])
      warn('The constraint uses the current native intrinsic measurement as its basis; regenerate after content, font or intrinsic-layout changes.', axis)
    } else base[axis] = bounded(axis, number(axis, raw[axis]))
  }
  const r = ratio ? ratio.x / ratio.y : 1
  const feasible = !ratio || designAspectRatioLimits(node).feasible
  const pair = (value: string, driver: Axis): Record<Axis, string> => {
    const low = `max(${lower('width')}, ${multiply(lower('height'), r)})`
    const high = `min(${upper('width')}, ${multiply(upper('height'), r)})`
    const width = `max(${low}, min(${high}, ${driver === 'width' ? value : multiply(value, r)}))`
    return { width, height: multiply(width, 1 / r) }
  }
  const resolved = { ...raw, ...Object.fromEntries(Object.entries(raw.numericBindings ?? {}).flatMap(([key, id]) => {
    const value = input.numbers.get(id)
    return value === undefined ? [] : [[key, value]]
  })) }
  const cappedWidth = designLayoutSize(resolved, 'width', resolved.width, designLayoutBox(resolved)) !== resolved.width
  const cappedHeight = designLayoutSize(resolved, 'height', resolved.height, designLayoutBox(resolved)) !== resolved.height
  if (ratio && feasible && (raw.numericBindings?.width || raw.numericBindings?.height || isHug('width') || isHug('height') || cappedWidth || cappedHeight ||
    Math.abs(resolved.width - resolved.height * r) <= 1e-7)) {
    if (isHug('width') || isHug('height')) {
      intrinsic ??= input.naturalSize(); base.width = px(intrinsic.width); base.height = px(intrinsic.height)
    } else {
      const driver = raw.numericBindings?.width || !raw.numericBindings?.height && cappedWidth ? 'width' : 'height'
      Object.assign(base, pair(base[driver], driver))
    }
  }
  const position: Record<Axis, string> = { width: '', height: '' }, sizes = { ...base }, forced = new Set<Axis>()
  for (const axis of ['width', 'height'] as const) {
    const mode = axis === 'width' ? rules.horizontal : rules.vertical, origin = axis === 'width' ? raw.x : raw.y
    const reference = axis === 'width' ? rules.referenceWidth : rules.referenceHeight
    const leading = border(sides[axis][0]), target = outer(axis)
    // An absent authored reference tracks the current parent at every resolve; no delta is introduced.
    if (reference === undefined) {
      position[axis] = calc(`${px(origin)} - ${leading}`)
      if (['scale', 'left-right', 'top-bottom'].includes(mode)) forced.add(axis)
      continue
    }
    if (mode === 'scale') {
      position[axis] = calc(`${target} * ${decimal(origin / reference)} - ${leading}`)
      sizes[axis] = bounded(axis, calc(`${target} * (${base[axis]} / ${px(reference)})`)); forced.add(axis)
      warn('Live proportional constraints require CSS typed arithmetic for length division.', axis, 'css-typed-arithmetic')
    } else {
      const factor = mode === 'center' ? 0.5 : mode === 'right' || mode === 'bottom' ? 1 : 0
      position[axis] = calc(`${px(origin)} + ${multiply(calc(`${target} - ${px(reference)}`), factor)} - ${leading}`)
      if (mode === 'left-right' || mode === 'top-bottom') {
        sizes[axis] = bounded(axis, calc(`${base[axis]} + ${target} - ${px(reference)}`)); forced.add(axis)
      }
    }
  }
  const passiveOffRatio = !!ratio && !raw.numericBindings?.width && !raw.numericBindings?.height &&
    !isHug('width') && !isHug('height') && !cappedWidth && !cappedHeight &&
    Math.abs(resolved.width - resolved.height * r) > 1e-7
  if (passiveOffRatio && ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].some(key => raw.numericBindings?.[key as CopyOSDesignNumberProperty]))
    warn('A bound-token change can activate a retained off-ratio target; regenerate this snapshot after bounds or modes change.', 'aspect-ratio')
  let automaticAxis: Axis | undefined
  const anchorDeclarations: { property: string; value: string }[] = []
  if (ratio && forced.size && feasible && (passiveOffRatio || forced.size === 2 && !crossAxisLengths)) {
    sizes.width = px(node.width); sizes.height = px(node.height)
    warn(passiveOffRatio ? 'Passive off-ratio geometry changes policy at the next responsive allocation; regenerate this snapshot after parent dimensions change.' :
      'Dual constrained proportions need both parent axes, but size containment would change this intrinsic parent; regenerate this snapshot after parent dimensions change.', 'aspect-ratio')
    for (const axis of ['width', 'height'] as const) {
      const mode = axis === 'width' ? rules.horizontal : rules.vertical
      const factor = mode === 'center' ? 0.5 : mode === 'right' || mode === 'bottom' ? 1 : 0
      if (factor) position[axis] = calc(`${position[axis]} + ${multiply(calc(`${base[axis]} - ${sizes[axis]}`), factor)}`)
    }
  } else if (ratio && forced.size && feasible) {
    const target = forced.size === 2 ? `min(${sizes.width}, ${multiply(sizes.height, r)})` : sizes[forced.has('width') ? 'width' : 'height']
    Object.assign(sizes, pair(target, forced.has('width') ? 'width' : 'height'))
    for (const axis of ['width', 'height'] as const) {
      const mode = axis === 'width' ? rules.horizontal : rules.vertical
      const factor = mode === 'center' ? 0.5 : mode === 'right' || mode === 'bottom' ? 1 : 0
      if (factor && (crossAxisLengths || forced.has(axis)))
        position[axis] = calc(`${position[axis]} + ${multiply(calc(`${base[axis]} - ${sizes[axis]}`), factor)}`)
    }
    if (!crossAxisLengths && forced.size === 1) {
      automaticAxis = forced.has('width') ? 'height' : 'width'
      const axis = automaticAxis, mode = axis === 'width' ? rules.horizontal : rules.vertical
      if (mode === 'right' || mode === 'bottom') {
        const origin = axis === 'width' ? raw.x : raw.y, reference = axis === 'width' ? rules.referenceWidth : rules.referenceHeight
        const distance = reference === undefined ? calc(`${outer(axis)} - ${px(origin)} - ${base[axis]}`) :
          calc(`${px(reference - origin)} - ${base[axis]}`)
        position[axis] = 'auto'
        anchorDeclarations.push({ property: axis === 'width' ? 'right' : 'bottom', value: distance })
      } else if (mode === 'center') {
        position[axis] = calc(`${position[axis]} + ${multiply(base[axis], 0.5)}`)
        anchorDeclarations.push({ property: 'translate', value: axis === 'width' ? '-50% 0' : '0 -50%' })
      }
    }
    if (node.minWidth !== undefined || node.maxWidth !== undefined || node.minHeight !== undefined || node.maxHeight !== undefined)
      warn('Proportional bounds are live while their interval remains feasible; regenerate for an incompatible bounds/mode interval.', 'aspect-ratio')
  } else if (ratio && !feasible) warn('No proportional rectangle satisfies the current bounds; independent responsive bounds take precedence.', 'aspect-ratio')
  set('position', 'absolute'); set('box-sizing', 'border-box')
  set('left', position.width); set('top', position.height)
  for (const item of anchorDeclarations) set(item.property, item.value)
  for (const axis of ['width', 'height'] as const) {
    set(axis, liveIntrinsic.has(axis) ? 'max-content' : axis === automaticAxis ? 'auto' : sizes[axis])
    // Match native padding/stroke floors even when they exceed a maximum bound.
    set(`min-${axis}`, lower(axis)); set(`max-${axis}`, `max(${floor(axis)}, ${upper(axis)})`)
  }
  if (raw.kind === 'text' && (raw.textSizing === 'auto-height' || raw.textSizing === 'auto-width') && forced.has('width')) {
    set('height', px(node.height))
    warn('The native automatic text height is a measured snapshot; remeasure text after constrained wrapping widths change.', 'height')
  }
  return result
}
