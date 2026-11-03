/** Read browser-owned editable content into sparse, supported native text runs. HTML itself is never persisted. */
import type { CopyOSDesignTextRun, CopyOSDesignTextRunStyle } from '../../../copyos-domain/src/types.ts'
import { designTextHyperlinkSchema, normalizeDesignTextRuns, normalizeDesignFontVariations } from '../../../copyos-domain/src/design-model.ts'

/** UTF-16 selection endpoints within the native plain text. */
export interface DesignerTextSelection {
  start: number
  end: number
}
/** Safe authored text and formatting extracted from a contenteditable element. */
export interface DesignerInlineTextValue {
  text: string
  textRuns: CopyOSDesignTextRun[]
}
interface Boundary {
  start: number
  end: number
  children: number[]
}
function color(value: string): string | undefined {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[\da-f]{3}$/i.test(value)) return '#' + value.slice(1).split('').map(part => part + part).join('')
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*(1|1\.0+)\s*)?\)$/i.exec(value)
  if (!rgb) return
  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some(channel => channel > 255)) return
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('')
}
function sparseStyle(element: HTMLElement, inherited: CopyOSDesignTextRunStyle): CopyOSDesignTextRunStyle {
  const result = { ...inherited },
    css = element.style,
    tag = element.tagName
  if (tag === 'B' || tag === 'STRONG') result.fontWeight = 700
  if (tag === 'I' || tag === 'EM') result.fontStyle = 'italic'
  if (tag === 'U') result.textDecoration = 'underline'
  if (tag === 'S' || tag === 'STRIKE') result.textDecoration = 'line-through'
  const family = css.fontFamily || (tag === 'FONT' ? element.getAttribute('face') : '')
  if (family && family.length <= 200) result.fontFamily = family
  const size = /^([\d.]+)px$/.exec(css.fontSize)
  if (size && Number(size[1]) >= 1 && Number(size[1]) <= 1000) result.fontSize = Number(size[1])
  const weight = css.fontWeight === 'bold' ? 700 : css.fontWeight === 'normal' ? 400 : Number(css.fontWeight)
  if (css.fontWeight && Number.isFinite(weight) && weight >= 1 && weight <= 1000) result.fontWeight = weight
  if (css.fontStyle === 'italic' || css.fontStyle === 'normal') result.fontStyle = css.fontStyle
  const features = css.fontFeatureSettings
  if (features === 'normal') result.fontFeatures = []
  else if (features) {
    const parsed = features.split(',').map(feature => /^\s*["']([A-Za-z0-9]{4})["'](?:\s+(on|off|\d+))?\s*$/.exec(feature))
    if (parsed.every(feature => feature !== null)) {
      const values = parsed.map(feature => ({ tag: feature[1] ?? '',
        value: feature[2] === 'off' ? 0 : feature[2] === 'on' || feature[2] === undefined ? 1 : Number(feature[2]) }))
      if (values.length <= 64 && new Set(values.map(feature => feature.tag)).size === values.length &&
        values.every(feature => feature.value <= 65535))
        result.fontFeatures = values.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
    }
  }
  const variations = css.fontVariationSettings
  if (variations === 'normal') result.fontVariations = []
  else if (variations) {
    const parsed = variations.split(',').map(axis => /^\s*["']([A-Z0-9]{4})["']\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(axis))
    if (parsed.every(axis => axis !== null)) {
      try {
        result.fontVariations = normalizeDesignFontVariations(parsed.map(axis => ({ tag: axis[1] ?? '', value: Number(axis[2]) })))
      } catch { /* Unsupported declarations retain inherited axis ownership. */ }
    }
  }
  const lineHeight = Number(css.lineHeight)
  if (css.lineHeight && Number.isFinite(lineHeight) && lineHeight >= 0.5 && lineHeight <= 10)
    result.lineHeight = lineHeight
  const tracking = /^(-?[\d.]+)px$/.exec(css.letterSpacing)
  if (tracking && Math.abs(Number(tracking[1])) <= 1000) result.letterSpacing = Number(tracking[1])
  const decoration = css.textDecorationLine || css.textDecoration
  const inheritedDecoration = element.getAttribute('data-copyos-inherited-decoration')
  if (inheritedDecoration && decoration !== inheritedDecoration && !decoration) result.textDecoration = 'none'
  else if (
    decoration !== inheritedDecoration &&
    (decoration === 'none' || decoration === 'underline' || decoration === 'line-through')
  )
    result.textDecoration = decoration
  const fill = color(
    css.getPropertyValue('-webkit-text-fill-color') ||
      css.color ||
      (tag === 'FONT' ? (element.getAttribute('color') ?? '') : ''),
  )
  if (fill) result.fill = fill
  const linkType = element.getAttribute('data-copyos-hyperlink-type')
  const linkValue = element.getAttribute('data-copyos-hyperlink-value')
  if (linkType && linkValue) {
    const link = designTextHyperlinkSchema.safeParse({ type:linkType,value:linkValue })
    if (link.success) result.hyperlink = link.data
  }
  return result
}
function read(root: HTMLElement): DesignerInlineTextValue & { boundaries: WeakMap<Node, Boundary> } {
  let text = ''
  const runs: CopyOSDesignTextRun[] = [],
    boundaries = new WeakMap<Node, Boundary>()
  const append = (value: string, style: CopyOSDesignTextRunStyle): void => {
    if (!value) return
    const start = text.length
    text += value
    if (Object.keys(style).length) runs.push({ start, end: text.length, style })
  }
  const visit = (node: Node, inherited: CopyOSDesignTextRunStyle): void => {
    const boundary: Boundary = { start: text.length, end: text.length, children: [] }
    boundaries.set(node, boundary)
    if (node.nodeType === Node.TEXT_NODE) append(node.textContent ?? '', inherited)
    else if (node instanceof HTMLElement) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return
      const style = node === root ? inherited : sparseStyle(node, inherited)
      if (node.tagName === 'BR') {
        // A sole BR keeps an empty editable paragraph alive; its block boundary supplies the newline.
        if (
          !(node.parentElement?.childNodes.length === 1 && ['DIV', 'P'].includes(node.parentElement.tagName))
        )
          append('\n', style)
      } else {
        let previousBlock = false
        for (const [index, child] of [...node.childNodes].entries()) {
          const block = child instanceof HTMLElement && ['DIV', 'P'].includes(child.tagName)
          if (index > 0 && (block || previousBlock)) append('\n', style)
          boundary.children.push(text.length)
          visit(child, style)
          previousBlock = block
        }
        boundary.children.push(text.length)
      }
    }
    boundary.end = text.length
  }
  visit(root, {})
  return { text, textRuns: normalizeDesignTextRuns(text, runs), boundaries }
}
/** Extract only whitelisted sparse inline formatting; unsupported HTML elements contribute plain text.
 * @param root - Browser-owned contenteditable text box.
 * @returns Plain content and canonical UTF-16 runs with no inherited base style materialization.
 */
export function designerReadInlineText(root: HTMLElement): DesignerInlineTextValue {
  const { text, textRuns } = read(root)
  return { text, textRuns }
}
/** Read the current DOM selection using the same block/newline coordinate map as persistence.
 * @param root - Editable text owner.
 * @returns Ordered UTF-16 endpoints only when both selection endpoints belong to this editor.
 */
export function designerInlineSelection(root: HTMLElement): DesignerTextSelection | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const { boundaries } = read(root)
  const offset = (node: Node, value: number): number => {
    const boundary = boundaries.get(node)
    if (!boundary) return 0
    return node.nodeType === Node.TEXT_NODE
      ? boundary.start + value
      : (boundary.children[value] ?? boundary.end)
  }
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  }
}
/** Restore a UTF-16 selection after a browser undoable safe-markup insertion.
 * @param root - Editable text owner.
 * @param selected - Native text offsets to restore.
 */
export function designerRestoreInlineSelection(root: HTMLElement, selected: DesignerTextSelection): void {
  const { boundaries } = read(root),
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const points: { node: Node; start: number; end: number }[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const boundary = boundaries.get(node)
    if (boundary) points.push({ node, start: boundary.start, end: boundary.end })
  }
  const point = (offset: number): [Node, number] => {
    const candidate = points.find(value => offset >= value.start && offset <= value.end) ?? points.at(-1)
    return candidate
      ? [candidate.node, Math.max(0, Math.min(offset - candidate.start, candidate.end - candidate.start))]
      : [root, 0]
  }
  const range = document.createRange()
  range.setStart(...point(selected.start))
  range.setEnd(...point(selected.end))
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
