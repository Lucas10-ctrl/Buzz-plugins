import { normalizeDesignFontVariations } from './design-font-variations.ts'
import { normalizeDesignFontFeatures } from './design-font-features.ts'
import { designTextMetricRuns } from './design-text-runs.ts'
/** Measured first baselines shared by auto layout, canvas, SVG and agent inspection. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { CopyOSDesignNode } from './types.ts'

const signatures = new Map<string, string>(), maximumCachedSignatures = 20000
// Normalized run, feature and variation lists per stored array; layout recomputes signatures on every pass.
// Arrays are immutable once part of a document.
const runsJson = new WeakMap<readonly unknown[], string>(),
  featuresJson = new WeakMap<readonly unknown[], string>(),
  variationsJson = new WeakMap<readonly unknown[], string>(),
  emptyListJson = '[]'
const json = (value: unknown): string => value === undefined ? 'null' : JSON.stringify(value)
function cachedJson<T extends readonly unknown[]>(
  cache: WeakMap<readonly unknown[], string>, value: T, normalize: (value: T) => unknown,
): string {
  let result = cache.get(value)
  if (result === undefined) {
    result = json(normalize(value))
    cache.set(value, result)
  }
  return result
}

/** Identify the exact text layout for which a browser measured a baseline.
 * @param node - Text layer after style, variable and allocated-size resolution.
 * @returns Signature that invalidates a measurement when its rendered text layout changes.
 */
export function designTextBaselineSignature(node: CopyOSDesignNode): string {
  // Byte-identical to JSON.stringify of the field array; stored measurements carry these signatures.
  const input = `[${[
    json(node.text),
    node.textRuns ? cachedJson(runsJson, node.textRuns, runs => designTextMetricRuns({ textRuns: runs }) ?? null) : 'null',
    json(node.fontFamily),
    json(node.fontSize),
    json(node.fontWeight),
    node.fontFeatures ? cachedJson(featuresJson, node.fontFeatures, normalizeDesignFontFeatures) : emptyListJson,
    node.fontVariations ? cachedJson(variationsJson, node.fontVariations, normalizeDesignFontVariations) : emptyListJson,
    json(node.fontStyle ?? 'normal'),
    json(node.lineHeight),
    json(node.letterSpacing ?? 0),
    json(node.textCase ?? 'none'),
    json(node.textWrap !== false),
    json(node.textSizing ?? 'fixed'),
    json(node.width),
    json(node.verticalAlign && node.verticalAlign !== 'top' && (!node.textSizing || node.textSizing === 'fixed')
      ? node.height : null),
    json(node.verticalAlign ?? 'top'),
    json(node.paragraphSpacing ?? 0),
    json(node.textTruncation ?? 'disabled'),
    json(node.maxLines ?? null),
    json(node.minWidth ?? null),
    json(node.maxWidth ?? null),
    json(node.minHeight ?? null),
    json(node.maxHeight ?? null),
  ].join(',')}]`
  const cached = signatures.get(input)
  if (cached !== undefined) return cached
  const signature = `text-metrics-v1:${bytesToHex(sha256(utf8ToBytes(input)))}`
  // Layout recomputes every text signature on each pass; the digest depends only on `input`.
  if (signatures.size >= maximumCachedSignatures) signatures.clear()
  signatures.set(input, signature)
  return signature
}

/** Resolve a layer's first horizontal baseline without guessing missing font metrics.
 * @param node - Arranged layer whose baseline is requested.
 * @param children - Visible direct children in document flow order.
 * @param instanceBaselines - Baselines resolved from linked component subtrees at allocated sizes.
 * @returns First text/descendant baseline, or the bottom edge for an unmeasured/replaced layer.
 */
export function designNodeBaseline(
  node: CopyOSDesignNode,
  children: ReadonlyMap<string, readonly CopyOSDesignNode[]>,
  instanceBaselines: ReadonlyMap<string, number> = new Map(),
): number {
  if (node.rotation !== 0 || node.flipY) return node.height
  if (node.kind === 'text') {
    const signature = designTextBaselineSignature(node)
    return (
      node.textBaselineMetrics?.find(m => m.signature === signature &&
        JSON.stringify(m.engine ?? null) === JSON.stringify(node.textLayoutMetrics?.engine ?? null))
        ?.baseline ?? node.height
    )
  }
  if (node.kind === 'instance')
    return instanceBaselines.get(node.id) ?? node.height
  const first = children.get(node.id)?.find(child => !child.absolutePosition)
  return first
    ? first.y + designNodeBaseline(first, children, instanceBaselines)
    : node.height
}
