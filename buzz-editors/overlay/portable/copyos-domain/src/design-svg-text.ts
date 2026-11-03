/** Plain SVG text lines that design tools such as Figma import as editable text. */
import { designTextSegments } from './design-text-runs.ts'
import type { CopyOSDesignNode, CopyOSDesignPaint } from './types.ts'

/** One laid-out line: UTF-16 range of the layer's text, left edge and alphabetic baseline in layer coordinates. */
export interface DesignSvgTextLine {
  start: number
  end: number
  x: number
  baseline: number
  /** The browser cut this line short with an ending ellipsis; `end` is the last fully shown character. */
  ellipsis?: boolean | undefined
}
/**
 * Measures an effective text layer's lines as a browser lays them out; undefined keeps the rich text rendering.
 * `layerId` is the layer's `data-copyos-layer` value in the rich export, unique per rendered instance.
 */
export type DesignSvgTextMeasurer = (node: CopyOSDesignNode, layerId: string) => readonly DesignSvgTextLine[] | undefined

/**
 * Draws one measured text layer's lines in layer coordinates; undefined keeps the `<text>` rendering for that layer.
 * `paints` are the layer's effective fills, from which the base text color comes.
 */
export type DesignSvgTextOutliner = (node: CopyOSDesignNode, paints: readonly CopyOSDesignPaint[],
  lines: readonly DesignSvgTextLine[]) => string | undefined

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)

/** SVG text has one paint; gradient and image paints fall back to their first stop or to black.
 * @param paints - Effective text fills.
 * @returns The topmost visible paint's color and opacity.
 */
export function designSvgTextSolidPaint(paints: readonly CopyOSDesignPaint[]): { color: string; opacity: number } {
  const paint = paints.filter(item => item.visible && item.opacity > 0).at(-1)
  if (!paint) return { color: '#000000', opacity: 0 }
  if (paint.gradient) {
    const stop = paint.gradient.stops[0]
    return { color: stop?.color ?? '#000000', opacity: paint.opacity * (stop?.opacity ?? 1) }
  }
  return { color: paint.image ? '#000000' : paint.color, opacity: paint.opacity }
}

const weightNames = ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']
/**
 * Figma's SVG import reads only the first family and maps numeric weights to Regular or Bold, but it resolves PostScript-style
 * names such as `Inter-Medium`. Browsers skip that name and use the real family with the numeric weight.
 */
function fontFamilyList(family: string, weight: number, style: string): string {
  const stem = family.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? family
  const name = weightNames[Math.min(8, Math.max(0, Math.round(weight / 100) - 1))] ?? 'Regular'
  const italic = style === 'italic'
  const suffix = italic ? name === 'Regular' ? 'Italic' : `${name}Italic` : name
  return `${stem.replace(/\s+/g, '')}-${suffix}, ${family}`
}

/** Apply a layer's text case the way the Canvas displays it.
 * @param text - Source text.
 * @param textCase - Layer text case.
 * @returns Displayed text.
 */
export function designSvgTextCase(text: string, textCase: CopyOSDesignNode['textCase']): string {
  switch (textCase) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'capitalize': return text.replace(/(^|\s)(\S)/g, (_all, space: string, letter: string) => space + letter.toUpperCase())
    case 'none': case undefined: return text
    default: return text
  }
}

/**
 * Render a text layer as `<text>` with one positioned `<tspan>` per measured line and nested tspans for inline styles.
 * Layout comes only from the measured lines; the layer's paint stack collapses to one solid fill.
 * @param node - Effective text layer.
 * @param paints - The layer's paint stack, bottom to top.
 * @param lines - Measured lines in reading order.
 * @returns SVG `<text>` markup in layer coordinates.
 */
export function designEditableTextSvg(node: CopyOSDesignNode, paints: readonly CopyOSDesignPaint[],
  lines: readonly DesignSvgTextLine[]): string {
  const base = designSvgTextSolidPaint(paints)
  const segments = designTextSegments(node)
  const first = segments[0]?.style
  const styleAttributes = (style: NonNullable<typeof first>, inherited?: typeof first): string => {
    const attributes: string[] = []
    const add = (name: string, value: string | number, parent: string | number | undefined) => {
      if (value !== parent) attributes.push(`${name}="${escapeXml(String(value))}"`)
    }
    add('font-family', fontFamilyList(style.fontFamily, style.fontWeight, style.fontStyle),
      inherited && fontFamilyList(inherited.fontFamily, inherited.fontWeight, inherited.fontStyle))
    add('font-size', style.fontSize, inherited?.fontSize)
    add('font-weight', style.fontWeight, inherited?.fontWeight)
    add('font-style', style.fontStyle, inherited?.fontStyle)
    add('letter-spacing', style.letterSpacing, inherited?.letterSpacing)
    add('text-decoration', style.textDecoration, inherited?.textDecoration)
    return attributes.length ? ` ${attributes.join(' ')}` : ''
  }
  const body = lines.map((line) => {
    // A wrapped line's trailing spaces and a paragraph's newline are layout, not glyphs.
    let end = line.end
    while (end > line.start && /\s/.test(node.text[end - 1] ?? '')) end--
    const parts = segments.filter(segment => segment.end > line.start && segment.start < end).map((segment) => {
      const text = designSvgTextCase(node.text.slice(Math.max(segment.start, line.start), Math.min(segment.end, end)), node.textCase)
      const attributes = (first ? styleAttributes(segment.style, first) : '') +
        (segment.style.fill === undefined ? '' : ` fill="${escapeXml(segment.style.fill)}" fill-opacity="1"`)
      return attributes ? `<tspan${attributes}>${escapeXml(text)}</tspan>` : escapeXml(text)
    }).join('')
    return `<tspan x="${line.x}" y="${line.baseline}">${parts}${line.ellipsis ? '…' : ''}</tspan>`
  }).join('')
  return `<text xml:space="preserve"${first ? styleAttributes(first) : ''} fill="${escapeXml(base.color)}" fill-opacity="${base.opacity}">${body}</text>`
}
