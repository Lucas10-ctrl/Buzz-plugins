/** Measures Canvas text in an off-screen copy of the rich SVG export, so editable-text exports keep the same line breaks. */
import { designTextSegments, exportDesignSvg, type DesignSvgTextLine } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'

type ExportOptions = NonNullable<Parameters<typeof exportDesignSvg>[2]>
interface Glyph { text: Text; offset: number; source: number; box: DOMRect; font: string }

/**
 * Export SVG whose text layers are `<text>`/`<tspan>` lines that design tools such as Figma import as editable text.
 * The rich export is laid out once in a hidden element of `host`; each text layer's visible character boxes give its line
 * ranges, left edges and baselines in layer coordinates, and an ending ellipsis where the Canvas truncates. Text that cannot be
 * measured keeps its rich rendering.
 * @param document - Design to export.
 * @param pageId - Optional page.
 * @param options - Rich export options other than the measurer.
 * @param host - Document used for the hidden layout; it must have the Canvas fonts loaded.
 * @returns SVG markup.
 */
export function exportDesignSvgWithEditableText(document: CopyOSDesignDocument, pageId: string | undefined,
  options: Omit<ExportOptions, 'editableText'>, host: Document): string {
  const container = host.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout'
  container.innerHTML = exportDesignSvg(document, pageId, options)
  host.body.append(container)
  try {
    const context = host.createElement('canvas').getContext('2d')
    return exportDesignSvg(document, pageId, { ...options,
      editableText: (node, layerId) => context ? measureLayer(container, node, layerId, context) : undefined })
  } finally {
    container.remove()
  }
}

/** Intersection of the boxes of `element` and its ancestors up to `root` that clip their overflow. */
function clipBox(element: Element, root: Element): { left: number; top: number; right: number; bottom: number } {
  const clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
  for (let current: Element | null = element; current && current !== root.parentElement; current = current.parentElement) {
    const style = getComputedStyle(current)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const box = current.getBoundingClientRect()
    clip.left = Math.max(clip.left, box.left); clip.top = Math.max(clip.top, box.top)
    clip.right = Math.min(clip.right, box.right); clip.bottom = Math.min(clip.bottom, box.bottom)
  }
  return clip
}

function measureLayer(container: HTMLElement, node: CopyOSDesignNode, layerId: string,
  context: CanvasRenderingContext2D): DesignSvgTextLine[] | undefined {
  const layer = [...container.querySelectorAll<SVGGElement>('g[data-copyos-layer]')].find(item => item.dataset.copyosLayer === layerId)
  const glyphs = [...layer?.querySelectorAll('foreignObject') ?? []].find(item => !item.closest('defs'))
  const matrix = layer?.getScreenCTM()?.inverse()
  if (!layer || !glyphs || !matrix) return undefined
  const host = container.ownerDocument
  const segments = designTextSegments(node)
  const range = host.createRange()
  // Rendered text omits paragraph newlines; walk it in order and match each character to its source offset.
  const walker = host.createTreeWalker(glyphs, NodeFilter.SHOW_TEXT)
  const shown: Glyph[] = []
  let source = 0, hidden = false
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!(text instanceof Text)) continue
    const clip = text.parentElement ? clipBox(text.parentElement, glyphs) : undefined
    for (let offset = 0; offset < text.data.length; offset++) {
      while (source < node.text.length && node.text[source] === '\n' && text.data[offset] !== '\n') source++
      if (source >= node.text.length) return undefined
      range.setStart(text, offset); range.setEnd(text, offset + 1)
      const box = [...range.getClientRects()].find(rect => rect.width > 0 || rect.height > 0)
      if (box && clip) {
        const x = box.left + box.width / 2, y = box.top + box.height / 2
        if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) { if (/\S/.test(text.data[offset] ?? '')) hidden = true }
        else {
          const style = segments.find(segment => segment.start <= source && source < segment.end)?.style
          shown.push({ text, offset, source, box, font: `${style?.fontStyle ?? 'normal'} ${style?.fontWeight ?? 400} ` +
            `${style?.fontSize ?? node.fontSize}px "${style?.fontFamily ?? node.fontFamily}"` })
        }
      }
      source++
    }
  }
  const groups: Glyph[][] = []
  for (const glyph of shown) {
    const line = groups.at(-1), first = line?.[0]
    if (!line || !first || glyph.box.top > first.box.top + first.box.height / 2) groups.push([glyph])
    else line.push(glyph)
  }
  const last = groups.at(-1)
  const ellipsis = hidden && node.textTruncation === 'ending' && last !== undefined
  if (ellipsis) {
    // The browser replaces the characters that do not fit before the clip edge with the ellipsis.
    const clip = clipBox(last[0]?.text.parentElement ?? glyphs, glyphs)
    while (last.length > 1) {
      const glyph = last.at(-1)
      if (!glyph) break
      context.font = glyph.font
      if (glyph.box.right + context.measureText('…').width <= clip.right + 0.5) break
      last.pop()
    }
  }
  const toLocal = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(matrix)
  // A zero-size inline-block marks the exact baseline, but it adds a wrap opportunity, so it is placed only after the first
  // character, where it cannot move a line break. Its offset from font metrics then corrects every character's metric baseline.
  const ascent = (font: string): number => { context.font = font; return context.measureText('Hg').fontBoundingBoxAscent }
  let correction = 0
  const anchor = groups[0]?.[0]
  if (anchor) {
    const marker = host.createElement('span')
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    range.setStart(anchor.text, anchor.offset + 1); range.collapse(true); range.insertNode(marker)
    correction = marker.getBoundingClientRect().bottom - (anchor.box.top + ascent(anchor.font))
    marker.remove()
  }
  const baselines = groups.map(line => toLocal(0, Math.max(...line.map(glyph => glyph.box.top + ascent(glyph.font))) + correction).y)
  const round = (value: number): number => Math.round(value * 100) / 100
  return groups.map((glyphs, index) => ({
    start: glyphs[0]?.source ?? 0,
    end: (glyphs.at(-1)?.source ?? 0) + 1,
    x: round(Math.min(...glyphs.map(glyph => toLocal(glyph.box.left, glyph.box.top).x))),
    baseline: round(baselines[index] ?? 0),
    ...(ellipsis && index === groups.length - 1 ? { ellipsis: true } : {}),
  }))
}
