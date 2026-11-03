/** Evidenced Kiwi effect records retain ordered shadows and uniform layer blur; unsupported semantics remain review notices. */
import { randomUUID } from 'node:crypto'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { designEffectSpreadSupported } from './design-effects-render.ts'
import type { CopyOSDesignNode, CopyOSDesignEffect } from './types.ts'

/** Figma also saves the picked color as `authoredColor`; an sRGB copy equal to `color` adds nothing to review. */
function sameSrgbColor(effect: NonNullable<NodeChange['effects']>[number], opacity: number, channels: number[]): boolean {
  const authored: unknown = Reflect.get(effect, 'authoredColor')
  if (typeof authored !== 'object' || authored === null) return false
  const space: unknown = Reflect.get(authored, 'space')
  if (space !== 'DEFAULT' && space !== 'SRGB') return false
  return [...channels, opacity].every((value, index) => {
    const part: unknown = Reflect.get(authored, `c${index}`)
    return typeof part === 'number' && Math.abs(part - value) < 1e-6
  })
}
/** Import supported normal shadows and uniform layer blur without interpreting absent metadata as linked ownership.
 * @param raw - Decoded Kiwi layer, including explicit empty/hidden effect arrays.
 * @param node - Imported geometry and paints; linked roots retain unresolved inherited spread eligibility.
 * @param warn - Import review sink for unsupported or invalid source semantics.
 * @returns Ordered native effects, or undefined when the source did not author an effect array.
 */
export function importFigEffects(raw: NodeChange, node: CopyOSDesignNode,
  warn: (message: string) => void): CopyOSDesignEffect[] | undefined {
  if (raw.effects === undefined) return
  if (raw.type === 'INSTANCE') warn('Linked effect arrays imported as local snapshots; symbolic effect ownership requires review')
  const effects: CopyOSDesignEffect[] = []
  for (const effect of raw.effects) {
    if (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR') {
      if (effects.some(value => value.type === 'layer-blur')) {
        warn('Layer blur limit exceeded; additional effects require review'); continue
      }
      if (Object.keys(effect).some(key => !['type', 'radius', 'visible', 'color', 'offset', 'spread',
        'blendMode', 'showShadowBehindNode'].includes(key))) {
        warn('Progressive or additional layer blur metadata requires review; that effect was not imported'); continue
      }
      const radius = effect.radius ?? 0
      if (!Number.isFinite(radius) || radius < 0 || radius > 10000) {
        warn('Invalid layer blur radius requires review; that effect was not imported'); continue
      }
      if (effect.blendMode !== undefined && effect.blendMode !== 'NORMAL')
        warn('Layer blur blend modes require review; uniform normal blur retained')
      effects.push({ id: randomUUID(), type: 'layer-blur', visible: effect.visible !== false, radius })
      continue
    }
    if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') { warn('Background blur and other unsupported effects require review'); continue }
    const type = effect.type === 'INNER_SHADOW' ? 'inner-shadow' : 'drop-shadow'
    if (effects.filter(value => value.type === type).length >= 8) { warn('Shadow type limit exceeded; additional effects require review'); continue }
    const x = effect.offset?.x ?? 0, y = effect.offset?.y ?? 0, blur = effect.radius ?? 0, spread = effect.spread ?? 0
    const channels = [effect.color?.r ?? 0, effect.color?.g ?? 0, effect.color?.b ?? 0], opacity = effect.color?.a ?? 1
    if (![x, y, blur, spread, opacity, ...channels].every(Number.isFinite) || Math.abs(x) > 1000000 || Math.abs(y) > 1000000 ||
      blur < 0 || blur > 10000 || Math.abs(spread) > 10000 || opacity < 0 || opacity > 1 ||
      channels.some(value => value < 0 || value > 1)) {
      warn('Invalid shadow values require review; that effect was not imported'); continue
    }
    if (effect.blendMode !== undefined && effect.blendMode !== 'NORMAL')
      warn('Shadow blend modes require review; normal shadow compositing retained')
    const opaqueFill = raw.fillPaints?.some(paint => paint.visible !== false && (paint.opacity ?? 1) === 1 &&
      paint.type === 'SOLID' && (paint.color?.a ?? 1) === 1)
    if (type === 'drop-shadow' && (effect.showShadowBehindNode === false || effect.showShadowBehindNode === undefined && !opaqueFill))
      warn('Drop shadow transparent-area knockout requires review; native through-transparent shadows retained')
    if (spread && node.kind !== 'instance' && !designEffectSpreadSupported(node))
      warn('Shadow spread is dormant on unsupported geometry or unclipped/unfilled containers')
    if (spread && node.kind === 'instance') warn('Linked shadow spread depends on inherited main clipping and fill; review effective eligibility')
    if (Object.keys(effect).some(key => !['type', 'color', 'offset', 'radius', 'visible', 'spread', 'blendMode', 'showShadowBehindNode'].includes(key) &&
      !(key === 'authoredColor' && sameSrgbColor(effect, opacity, channels))))
      warn('Additional drop shadow fields or variable bindings require review; saved supported values retained')
    effects.push({ id: randomUUID(), type, visible: effect.visible !== false, x, y, blur, spread, opacity,
      color: '#' + channels.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('') })
  }
  return effects
}
