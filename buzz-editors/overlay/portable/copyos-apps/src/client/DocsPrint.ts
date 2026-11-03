/** Isolated, semantic print document built from the visible rich text, without application controls. */
import type { CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'

const tags = new Set(['P', 'DIV', 'SPAN', 'STRONG', 'EM', 'S', 'DEL', 'U', 'CODE', 'PRE', 'BLOCKQUOTE',
  'IMG', 'FIGURE', 'FIGCAPTION', 'COLGROUP', 'COL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'HR', 'BR', 'A'])
const excluded = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'FORM', 'TEXTAREA', 'IFRAME', 'OBJECT', 'EMBED', 'SVG'])
function copyText(source: Node, target: Node, destination: Document): void {
  if (source.nodeType === Node.TEXT_NODE) { target.appendChild(destination.createTextNode(source.textContent ?? '')); return }
  if (!(source instanceof Element) || excluded.has(source.tagName) || source.hasAttribute('data-doc-print-exclude')) return
  if (source instanceof HTMLInputElement) {
    if (source.type === 'checkbox') target.appendChild(destination.createTextNode(source.checked ? '☑ ' : '☐ '))
    return
  }
  const node = tags.has(source.tagName) ? destination.createElement(source.tagName.toLowerCase()) : destination.createElement('span')
  if (source.tagName === 'IMG') {
    const src = source.getAttribute('src') ?? ''
    if (/^(blob:|data:image\/(?:png|jpeg|webp|gif);base64,)/u.test(src)
      || (source.hasAttribute('data-doc-diagram') && src.startsWith('data:image/svg+xml;base64,'))) node.setAttribute('src', src)
    node.setAttribute('alt', source.getAttribute('alt') ?? '')
  }
  if (source.tagName === 'COL') {
    const cols = Array.from(source.parentElement?.children ?? [])
    const widths = cols.map(col => col instanceof HTMLElement ? Number.parseFloat(col.style.width) || 0 : 0)
    const total = widths.reduce((sum, width) => sum + width, 0), width = widths[cols.indexOf(source)] ?? 0
    if (total > 0 && width > 0) node.setAttribute('style', `width:${width / total * 100}%`)
  }
  if (source.tagName === 'BLOCKQUOTE' && source.getAttribute('role') === 'note') {
    const label = destination.createElement('strong'); label.textContent = source.getAttribute('aria-label') ?? ''
    node.appendChild(label)
  }
  if (source.tagName === 'A') {
    const href = source.getAttribute('href') ?? ''
    if (/^(https?:|mailto:|#)/iu.test(href)) node.setAttribute('href', href)
  }
  if (source.tagName === 'TD' || source.tagName === 'TH') {
    for (const name of ['colspan', 'rowspan']) {
      const value = source.getAttribute(name)
      if (value && /^\d{1,3}$/u.test(value)) node.setAttribute(name, value)
    }
  }
  const start = source.getAttribute('start')
  if (source.tagName === 'OL' && start && /^\d{1,6}$/u.test(start)) node.setAttribute('start', start)
  for (const child of source.childNodes) copyText(child, node, destination)
  target.appendChild(node)
}

/** Prepare a printable snapshot containing only the title, section headings and rendered body.
 * @param article - Mounted document article, including its section editors.
 * @param value - Document title and stable block identities.
 * @param mainTabLabel - Localized name for the implicit main tab.
 * @returns Offscreen iframe, owned by the caller until printing finishes.
 */
export function createDocPrintFrame(article: HTMLElement, value: Pick<CopyOSDocDocument, 'title' | 'blocks' | 'tabs' | 'id'>, mainTabLabel: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0'
  document.body.appendChild(frame)
  const destination = frame.contentDocument
  if (!destination) { frame.remove(); throw new Error('Printing is unavailable in this browser') }
  destination.title = value.title
  const style = destination.createElement('style')
  style.textContent = `
    @page { margin: 20mm; }
    html { color-scheme: light; background: white; color: #111; }
    body { margin: 0; font: 11pt/1.6 system-ui, sans-serif; overflow-wrap: break-word; }
    h1 { font-size: 25pt; line-height: 1.2; margin: 0 0 24pt; }
    h2 { font-size: 17pt; } h3 { font-size: 14pt; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
    p { orphans: 3; widows: 3; } pre { white-space: pre-wrap; font-size: 9pt; padding: 10pt; background: #f5f5f5; }
    code { font-family: ui-monospace, monospace; } blockquote { margin-left: 0; padding-left: 12pt; border-left: 2pt solid #bbb; }
    table { width: 100%; border-collapse: collapse; margin: 12pt 0; table-layout: auto; }
    th, td { border: 0.5pt solid #bbb; padding: 5pt 8pt; vertical-align: top; }
    thead { display: table-header-group; } tr { break-inside: avoid; page-break-inside: avoid; }
    figure { margin: 14pt 0; break-inside: avoid; } img { max-width: 100%; max-height: 230mm; height: auto; display: block; margin: auto; }
    figcaption { font-size: 9pt; color: #555; text-align: center; }
    a { color: inherit; } li > div, li > span, li > label { display: inline; }
  `
  destination.head.appendChild(style)
  const heading = destination.createElement('h1'); heading.textContent = value.title; destination.body.appendChild(heading)
  const tabs = value.tabs ?? [], blocks = tabs.length > 1
    ? tabs.flatMap(tab => value.blocks.filter(block => (block.tabId ?? value.id) === tab.id)) : value.blocks
  let previousTab: string | undefined
  for (const block of blocks) {
    const tabId = block.tabId ?? value.id
    if (tabs.length > 1 && tabId !== previousTab) {
      const tab = tabs.find(item => item.id === tabId), label = destination.createElement('h2')
      label.textContent = tab?.title || mainTabLabel; destination.body.appendChild(label); previousTab = tabId
    }
    const section = article.querySelector(`[id="doc-block-${block.id}"]`)
    const pageContent = section?.querySelector('[data-doc-section-content]')
    if (block.label && !pageContent) {
      const label = destination.createElement('h2'); label.textContent = block.label; destination.body.appendChild(label)
    }
    const content = pageContent ?? section?.querySelector('[contenteditable]')
    if (content) for (const child of content.childNodes) copyText(child, destination.body, destination)
  }
  return frame
}

let previous: HTMLIFrameElement | undefined
/** Print the mounted document through an isolated frame, removing the frame after the dialog closes.
 * @param article - Document article to snapshot.
 * @param value - Document title and block identities.
 * @param imageFailure - Localized explanation when an image cannot be decoded.
 * @param mainTabLabel - Localized name for the implicit main tab.
 * @returns Completion after the browser receives the print request.
 */
export async function printDoc(article: HTMLElement, value: Pick<CopyOSDocDocument, 'title' | 'blocks' | 'tabs' | 'id'>, imageFailure: string, mainTabLabel: string): Promise<void> {
  try { await Promise.all(Array.from(article.querySelectorAll('img'), img => img.decode())) }
  catch (error: unknown) { throw new Error(imageFailure, { cause: error }) }
  previous?.remove()
  const frame = createDocPrintFrame(article, value, mainTabLabel)
  previous = frame
  const view = frame.contentWindow
  if (!view) { frame.remove(); throw new Error('Printing is unavailable in this browser') }
  view.addEventListener('afterprint', () => { frame.remove(); if (previous === frame) previous = undefined }, { once: true })
  try {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    await frame.contentDocument?.fonts.ready
    try { await Promise.all(Array.from(frame.contentDocument?.images ?? [], img => img.decode())) }
    catch (error) { throw new Error(imageFailure, { cause: error }) }
    view.focus(); view.print()
  } catch (error) { frame.remove(); throw error }
}
