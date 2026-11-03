import { designFontVariationSettings } from './design-font-variations.ts'
import { designFontFeatureSettings } from './design-font-features.ts'
import { designTextHyperlinkSchema } from './design-text-hyperlink.ts'
/** Escaped rich-text content shared by browser glyph masks and standalone SVG. */
import { nodeCssFontFamily } from './design-node-css-font.ts'
import { designTextSegments } from './design-text-runs.ts'
import type { CopyOSDesignNode } from './types.ts'

/** Select visible glyphs while retaining every segment's typography and advance. */
export interface DesignTextHtmlOptions {
  mode?: 'normal' | 'mask' | 'stroke-mask' | 'base-mask' | 'run-mask' | 'link-overlay'
  runIndex?: number
}

const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Build escaped inline spans and optional paragraph blocks without modifying native text.
 * @param node - Effective text after shared styles, modes and local overrides.
 * @param options - Normal color rendering, all-glyph masks, uncolored glyph masks or one segment mask.
 * @returns HTML content only; the caller supplies the base text box, wrapping, transforms and layer opacity.
 */
export function designTextHtmlContent(node: CopyOSDesignNode, options: DesignTextHtmlOptions = {}): string {
  const segments = designTextSegments(node)
  const mode = options.mode ?? 'normal'
  const part = (start: number, end: number): string => segments.map((segment, index) => {
    const from = Math.max(start, segment.start), to = Math.min(end, segment.end)
    if (from >= to) return ''
    const style = segment.style
    const authored = mode === 'normal' ? node.textRuns?.find(run => run.start <= segment.start && run.end >= segment.end)?.style ?? {} : style
    const inheritedDecoration = mode === 'normal' && authored.textDecoration === undefined && style.textDecoration !== 'none'
      ? style.textDecoration : undefined
    const color = mode === 'link-overlay' ? 'transparent' : mode === 'normal' ? style.fill : mode === 'mask' ? 'white' : mode === 'stroke-mask' ? 'transparent' :
      mode === 'base-mask' ? style.fill ? 'transparent' : 'white' : index === options.runIndex ? 'white' : 'transparent'
    const css = (authored.fontFamily === undefined ? '' : `font-family:${escape(nodeCssFontFamily(authored.fontFamily))};`) +
      (authored.fontSize === undefined ? '' : `font-size:${authored.fontSize}px;`) +
      (authored.fontWeight === undefined ? '' : `font-weight:${authored.fontWeight};`) +
      (authored.fontStyle === undefined ? '' : `font-style:${authored.fontStyle};`) +
      (authored.lineHeight === undefined ? '' : `line-height:${authored.lineHeight};`) +
      (authored.fontVariations === undefined ? '' : `font-variation-settings:${escape(designFontVariationSettings(authored.fontVariations))};`) +
      (authored.fontFeatures === undefined ? '' : `font-feature-settings:${escape(designFontFeatureSettings(authored.fontFeatures))};`) +
      (authored.letterSpacing === undefined ? '' : `letter-spacing:${authored.letterSpacing}px;`) +
      (mode === 'link-overlay' ? 'text-decoration:none;' : authored.textDecoration === undefined && !inheritedDecoration ? '' : `text-decoration:${authored.textDecoration ?? inheritedDecoration};`) +
      (color ? `color:${color};-webkit-text-fill-color:${color};` : '')
    const target = style.hyperlink
    const metadata = mode === 'normal' && target ?
      ` data-copyos-hyperlink-type="${target.type}" data-copyos-hyperlink-value="${escape(target.value)}"` : ''
    const content = `<span${metadata}${inheritedDecoration ? ` data-copyos-inherited-decoration="${inheritedDecoration}"` : ''} style="${css}">${escape(node.text.slice(from, to))}</span>`
    if (mode !== 'link-overlay') return content
    if (!target || !designTextHyperlinkSchema.safeParse(target).success) return `<span aria-hidden="true" style="pointer-events:none">${content}</span>`
    const href = target.type === 'URL' ? target.value : `#copyos-node-${target.value}`
    return `<a href="${escape(href)}"${target.type === 'URL' ? ' target="_blank" rel="noopener noreferrer"' : ''} style="pointer-events:auto;color:transparent;text-decoration:none">${content}</a>`
  }).join('')
  if (!node.paragraphSpacing) return part(0, node.text.length)
  let offset = 0
  return node.text.split('\n').map((paragraph, index, all) => {
    const content = part(offset, offset + paragraph.length)
    offset += paragraph.length + 1
    return `<div style="min-height:1lh;${index < all.length - 1 ? `margin-bottom:${node.paragraphSpacing}px;` : ''}">${content || '<br/>'}</div>`
  }).join('')
}
