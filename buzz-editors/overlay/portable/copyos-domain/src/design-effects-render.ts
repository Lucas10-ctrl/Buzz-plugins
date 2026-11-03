import { designEffectOpacity } from './design-effect-values.ts'
/** Independent original-alpha shadow passes shared by Canvas and standalone SVG. */
import { designNodeEffects, designNodeLayerBlur } from './design-effects.ts'
import { designColorCssValue } from './design-color.ts'
import type { CopyOSDesignNode, CopyOSDesignShadow } from './types.ts'

/** Local SourceGraphic or filter envelope, in physical layer coordinates. */
export interface DesignEffectsBox { x: number; y: number; width: number; height: number }
/** Safe filter primitives and their intermediate working region; this is distinct from final painted bounds. */
export interface DesignEffectsFilter extends DesignEffectsBox { id: string; markup: string }
const shadowEffects = (node: CopyOSDesignNode): CopyOSDesignShadow[] =>
  designNodeEffects(node).filter(effect => effect.type !== 'layer-blur').map(effect => ({ ...effect, opacity: designEffectOpacity(effect) }))
const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Report whether the effective geometry supports authored shadow spread.
 * @param node - Effective layer with source kind, clipping and active-mode paints already resolved.
 * @returns Rectangles/ellipses, or clipped frames/components with a visible fill of at least one percent opacity.
 */
export function designEffectSpreadSupported(node: CopyOSDesignNode): boolean {
  if (node.kind === 'rectangle' || node.kind === 'ellipse') return true
  if (!['frame', 'component'].includes(node.kind) || !node.clip) return false
  const paints = node.fills ?? [{ visible: true, opacity: node.fillOpacity ?? 1, color: node.fill }]
  return paints.some(paint => paint.visible && paint.opacity * (designColorCssValue(paint.color)?.alpha ?? 1) >= .01)
}

/** Resolve separate shadow envelopes from the same original content box.
 * @param node - Effective layer with authored effects and current spread eligibility.
 * @param content - Original SourceGraphic envelope before this layer's effects.
 * @returns Visible shadow boxes in back-to-front order, with conservative positive spread and three-sigma blur.
 */
export function designEffectsShadowBoxes(node: CopyOSDesignNode, content: DesignEffectsBox): DesignEffectsBox[] {
  const supported = designEffectSpreadSupported(node)
  return shadowEffects(node).filter(effect => effect.type === 'drop-shadow' && effect.visible && effect.opacity > 0).map((shadow) => {
    const outset = shadow.blur * 1.5 + (supported ? Math.max(0, shadow.spread) : 0)
    return { x: content.x + shadow.x - outset, y: content.y + shadow.y - outset,
      width: content.width + outset * 2, height: content.height + outset * 2 }
  })
}

/** Union independent shadows with original content, then expand the completed layer for uniform blur.
 * @param node - Effective layer; hidden and zero-opacity shadows do not expand bounds.
 * @param content - Original SourceGraphic envelope, including rendered children and stroke.
 * @returns Conservative finite three-sigma envelope, or undefined when neither a visible drop shadow nor layer blur is authored.
 */
export function designEffectsBounds(node: CopyOSDesignNode, content: DesignEffectsBox): DesignEffectsBox | undefined {
  const shadows = designEffectsShadowBoxes(node, content)
  const blur = designNodeLayerBlur(node)
  if (!shadows.length && !blur?.visible) return
  let left = content.x, top = content.y, right = content.x + content.width, bottom = content.y + content.height
  for (const shadow of shadows) {
    left = Math.min(left, shadow.x); top = Math.min(top, shadow.y)
    right = Math.max(right, shadow.x + shadow.width); bottom = Math.max(bottom, shadow.y + shadow.height)
  }
  const outset = blur?.visible ? blur.radius * 1.5 : 0
  return { x: left - outset, y: top - outset,
    width: Math.max(1, right - left + outset * 2), height: Math.max(1, bottom - top + outset * 2) }
}

/** Build drop shadows from the same SourceAlpha with the source graphic merged exactly once; inner shadows require separate ordered passes.
 * @param node - Effective physical layer; unsupported spread remains dormant without discarding metadata.
 * @param id - Caller-owned filter identity, namespaced for its rendered context.
 * @param bounds - Optional painted envelope including source and final shadows; it can contain overflowing descendants.
 * @returns Escaped filter children and a working region retaining spread/blur before offset; painted viewport bounds remain separate.
 */
export function designEffectsFilter(node: CopyOSDesignNode, id: string, bounds?: DesignEffectsBox): DesignEffectsFilter | undefined {
  const shadows = shadowEffects(node).filter(effect => effect.type === 'drop-shadow' && effect.visible && effect.opacity > 0)
  const box = bounds ?? designEffectsBounds(node, { x: 0, y: 0, width: node.width, height: node.height })
  if (!shadows.length || !box) return
  const supported = designEffectSpreadSupported(node)
  // The supplied painted envelope contains SourceAlpha, but a large offset can leave its unoffset spread/blur outside it.
  const outset = Math.max(...shadows.map(shadow => shadow.blur * 1.5 + (supported ? Math.max(0, shadow.spread) : 0)))
  const working = { x: box.x - outset, y: box.y - outset, width: box.width + outset * 2, height: box.height + outset * 2 }
  const region = ` x="${working.x}" y="${working.y}" width="${working.width}" height="${working.height}"`
  let markup = ''
  const results: string[] = []
  for (const [index, shadow] of shadows.entries()) {
    const prefix = `shadow-${index}`, spread = supported ? shadow.spread : 0
    let input = 'SourceAlpha'
    if (spread) {
      markup += `<feMorphology in="SourceAlpha" operator="${spread > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(spread)}" result="${prefix}-spread"${region}/>`
      input = `${prefix}-spread`
    }
    if (shadow.blur) {
      markup += `<feGaussianBlur in="${input}" stdDeviation="${shadow.blur / 2}" result="${prefix}-blur"${region}/>`
      input = `${prefix}-blur`
    }
    markup += `<feOffset in="${input}" dx="${shadow.x}" dy="${shadow.y}" result="${prefix}-offset"${region}/>` +
      `<feFlood flood-color="${escape(shadow.color)}" flood-opacity="${shadow.opacity}" result="${prefix}-color"${region}/>` +
      `<feComposite in="${prefix}-color" in2="${prefix}-offset" operator="in" result="${prefix}"${region}/>`
    results.push(prefix)
  }
  markup += `<feMerge${region}>${results.map(result => `<feMergeNode in="${result}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`
  return { id, ...working, markup }
}


/** Internal finite working region preserves inverse-alpha and pre-offset intermediates. */
function effectWorkingBox(node: CopyOSDesignNode, box: DesignEffectsBox): DesignEffectsBox {
  const supported = designEffectSpreadSupported(node)
  const outset = Math.max(0, ...shadowEffects(node).filter(effect => effect.visible && effect.opacity > 0).map(effect =>
    Math.abs(effect.x) + Math.abs(effect.y) + effect.blur * 1.5 + (supported ? Math.abs(effect.spread) : 0))) + 1
  return { x: box.x - outset, y: box.y - outset, width: box.width + outset * 2, height: box.height + outset * 2 }
}
function effectRegion(box: DesignEffectsBox): string {
  return ` x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"`
}
function alphaPrimitive(input: string, region: string): string {
  return `<feColorMatrix in="${input}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="original-alpha"${region}/>`
}
function shadowPrimitives(node: CopyOSDesignNode, type: 'drop-shadow' | 'inner-shadow', region: string): { markup: string; results: string[] } {
  const effects = shadowEffects(node).filter(effect => effect.type === type && effect.visible && effect.opacity > 0)
  const supported = designEffectSpreadSupported(node)
  let markup = ''
  const results: string[] = []
  for (const [index, effect] of effects.entries()) {
    const name = `${type}-${index}`, spread = supported ? effect.spread : 0
    let input = 'original-alpha'
    if (spread) {
      const dilate = type === 'drop-shadow' ? spread > 0 : spread < 0
      markup += `<feMorphology in="${input}" operator="${dilate ? 'dilate' : 'erode'}" radius="${Math.abs(spread)}" result="${name}-spread"${region}/>`
      input = `${name}-spread`
    }
    if (type === 'inner-shadow') {
      markup += `<feComponentTransfer in="${input}" result="${name}-inverse"${region}><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>`
      input = `${name}-inverse`
    }
    if (effect.blur) {
      markup += `<feGaussianBlur in="${input}" stdDeviation="${effect.blur / 2}" result="${name}-blur"${region}/>`
      input = `${name}-blur`
    }
    markup += `<feOffset in="${input}" dx="${effect.x}" dy="${effect.y}" result="${name}-offset"${region}/>`
    input = `${name}-offset`
    if (type === 'inner-shadow') {
      markup += `<feComposite in="${input}" in2="original-alpha" operator="in" result="${name}-clipped"${region}/>`
      input = `${name}-clipped`
    }
    markup += `<feFlood flood-color="${escape(effect.color)}" flood-opacity="${effect.opacity}" result="${name}-color"${region}/>` +
      `<feComposite in="${name}-color" in2="${input}" operator="in" result="${name}"${region}/>`
    results.push(name)
  }
  return { markup, results }
}
function mergePrimitives(results: string[], region: string): string {
  return `<feMerge${region}>${results.map(result => `<feMergeNode in="${result}"/>`).join('')}</feMerge>`
}
/** Build a shadow-only pass from directly rendered original glyphs or a pure-SVG sampled source.
 * @param node - Effective layer; each effect samples the same original alpha.
 * @param id - Context-namespaced filter identity.
 * @param type - Drop or inner shadow category.
 * @param sourceId - Optional pure-SVG source ID; omit to capture directly rendered SourceGraphic, required for foreignObject text.
 * @param sourceBounds - Original local source envelope, excluding this layer's effects.
 * @param paintedBounds - Optional final painted envelope used for drop working space.
 * @returns Shadow-only primitives; callers render inert original glyph clones and paint the real source/stroke once.
 */
export function designEffectsPassFilter(node: CopyOSDesignNode, id: string,
  type: 'drop-shadow' | 'inner-shadow', sourceId: string | undefined, sourceBounds: DesignEffectsBox,
  paintedBounds?: DesignEffectsBox): DesignEffectsFilter | undefined {
  if (!shadowEffects(node).some(effect => effect.type === type && effect.visible && effect.opacity > 0)) return
  const working = effectWorkingBox(node, type === 'drop-shadow' ? paintedBounds ?? designEffectsBounds(node, sourceBounds) ?? sourceBounds : sourceBounds)
  const region = effectRegion(working), pass = shadowPrimitives(node, type, region)
  const image = sourceId ? `<feImage href="#${escape(sourceId)}" x="${sourceBounds.x}" y="${sourceBounds.y}" width="${sourceBounds.width}" height="${sourceBounds.height}" preserveAspectRatio="none" result="original"/>` : ''
  return { id, ...working, markup: image + alphaPrimitive(sourceId ? 'original' : 'SourceGraphic', region) + pass.markup + mergePrimitives(pass.results, region) }
}
/** Composite drops, direct original fills/content, then inners without sampling foreignObject descendants through images.
 * @param node - Effective layer; groups include their whole content, layers keep their own stroke outside this filter.
 * @param id - Context-namespaced filter identity.
 * @param sourceBounds - Original physical source envelope.
 * @param paintedBounds - Final drop-expanded painted envelope, if any.
 * @param strokeSourceId - Optional pure-SVG own-stroke source; sampled only to construct original alpha, never painted by this filter.
 * @returns Complete content filter; callers paint a layer's actual own stroke once above it.
 */
export function designEffectsLayerFilter(node: CopyOSDesignNode, id: string, sourceBounds: DesignEffectsBox,
  paintedBounds?: DesignEffectsBox, strokeSourceId?: string): DesignEffectsFilter | undefined {
  if (!shadowEffects(node).some(effect => effect.visible && effect.opacity > 0)) return
  const working = effectWorkingBox(node, paintedBounds ?? sourceBounds), region = effectRegion(working)
  const drop = shadowPrimitives(node, 'drop-shadow', region), inner = shadowPrimitives(node, 'inner-shadow', region)
  const original = strokeSourceId ? `<feImage href="#${escape(strokeSourceId)}" x="${sourceBounds.x}" y="${sourceBounds.y}" width="${sourceBounds.width}" height="${sourceBounds.height}" preserveAspectRatio="none" result="own-stroke"/>` +
    `<feComposite in="own-stroke" in2="SourceGraphic" operator="over" result="original"${region}/>` : ''
  return { id, ...working, markup: original + alphaPrimitive(strokeSourceId ? 'original' : 'SourceGraphic', region) + drop.markup + inner.markup +
    mergePrimitives([...drop.results, 'SourceGraphic', ...inner.results], region) }
}

/** Blur the completed layer, including its own stroke, shadows and descendant content, exactly once.
 * @param node - Effective node with its inherited uniform layer blur.
 * @param id - Filter identity unique to this rendered context.
 * @param bounds - Final blur-expanded painted envelope; omission uses the authored node rectangle and its effects.
 * @returns Visible blur primitives and final filter region, including zero-radius isolation; hidden/absent blur returns undefined.
 */
export function designLayerBlurFilter(node: CopyOSDesignNode, id: string, bounds?: DesignEffectsBox): DesignEffectsFilter | undefined {
  const blur = designNodeLayerBlur(node)
  if (!blur?.visible) return
  const box = bounds ?? designEffectsBounds(node, { x: 0, y: 0, width: node.width, height: node.height })
  if (!box) return
  return { id, ...box,
    markup: `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur.radius / 2}" edgeMode="none"${effectRegion(box)}/>` }
}
