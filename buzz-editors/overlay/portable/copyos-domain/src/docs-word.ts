/** Editable Word export from saved document content and repository-authorized attachment bytes. */
import type HTMLtoDOCX from '@turbodocx/html-to-docx'
import { createRequire } from 'node:module'
import { marked } from 'marked'
import { parse, NodeType, HTMLElement } from 'node-html-parser'
import sharp from 'sharp'
import { unzipSync, zipSync } from 'fflate'
import type { CopyOSDocDocument } from './types.ts'
import type { DocsPdfAsset } from './docs-pdf.ts'
import { docDiagramImages } from './docs-diagram-images.ts'

// Use the package's declared Node require export; its ESM wrapper differs across source loaders.
const converter: unknown = createRequire(import.meta.url)('@turbodocx/html-to-docx')
if (typeof converter !== 'function') throw new Error('The Word converter did not expose its Node entrypoint.')
const convertWord = converter as typeof HTMLtoDOCX
const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL',
  'A', 'IMG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
  'COLGROUP', 'COL', 'FIGURE', 'FIGCAPTION', 'INPUT'])

/**
 * Render a Word document without fetching external resources or changing saved content.
 * @param document - Permission-checked saved document projection.
 * @param assets - Verified bytes for attachments referenced by the body.
 * @param filePaths - Relative paths for non-image attachments in an optional portable bundle.
 * @returns Complete editable DOCX package.
 */
export async function renderDocWord(document: CopyOSDocDocument, assets: ReadonlyMap<string, DocsPdfAsset>,
  filePaths: ReadonlyMap<string, string>): Promise<Buffer> {
  const content = `<h1>${escape(document.title)}</h1>` + document.blocks.map(block =>
    `${block.label ? `<h2>${escape(block.label)}</h2>` : ''}${marked.parse(block.content, { async: false })}`).join('\n')
  const root = parse(content, { blockTextElements: { script: true, noscript: true, style: true } })
  const diagrams = await docDiagramImages(document), diagramAssets = new Map<string, DocsPdfAsset & { width: number; height: number }>()
  for (const code of root.querySelectorAll('pre > code')) {
    if (!code.classNames.split(/\s+/u).some(name => ['language-mermaid', 'language-copyos-chart'].includes(name.toLowerCase()))) continue
    const image = diagrams.get(code.textContent.replace(/\n$/u, ''))
    if (!image) continue
    const reference = `copyos-rendered-diagram:${diagramAssets.size}`
    const name = code.classNames.includes('language-copyos-chart') ? 'Chart' : 'Diagram'
    diagramAssets.set(reference, { name, mime: 'image/png', image: true, bytes: image.bytes,
      width: image.width, height: image.height })
    code.parentNode.replaceWith(`<img src="${reference}" alt="${name}">`)
  }
  for (const element of root.querySelectorAll('script,style,iframe,object,embed,link,meta,svg,math')) element.remove()
  for (const element of root.querySelectorAll('*')) {
    if (!TAGS.has(element.tagName)) { element.replaceWith(element.innerHTML); continue }
    const attrs = { ...element.attributes }
    for (const key of Object.keys(attrs)) element.removeAttribute(key)
    if (element.tagName === 'INPUT') {
      element.replaceWith(attrs.type === 'checkbox' ? (Object.hasOwn(attrs, 'checked') ? '[x] ' : '[ ] ') : '')
      continue
    }
    if (element.tagName === 'A') {
      const href = attrs.href ?? '', path = filePaths.get(href)
      if (path || /^(?:https?:|mailto:|tel:|#)/iu.test(href)) element.setAttribute('href', path ?? href)
      else { element.replaceWith(...element.childNodes); continue }
      element.setAttribute('style', 'color: #1f4f7b; text-decoration: underline;')
    }
    if (element.tagName === 'IMG') {
      const diagram = diagramAssets.get(attrs.src ?? ''), asset = diagram ?? assets.get(attrs.src ?? '')
      if (!asset?.image) throw new Error('An image is unavailable. Upload it to the document before exporting.')
      const image = await sharp(asset.bytes, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: 1400, withoutEnlargement: true }).png().toBuffer()
      element.setAttribute('src', `data:image/png;base64,${image.toString('base64')}`)
      element.setAttribute('alt', attrs.alt ?? asset.name)
      const scale = diagram ? Math.min(1, 650 / diagram.width, 850 / diagram.height) : 1
      element.setAttribute('style', diagram
        ? `width: ${diagram.width * scale}px; height: ${diagram.height * scale}px; max-width: 100%;`
        : 'max-width: 100%; height: auto;')
    }
    for (const key of ['colspan', 'rowspan']) if (['TH', 'TD'].includes(element.tagName) && attrs[key])
      element.setAttribute(key, String(Math.max(1, Math.min(100, Number.parseInt(attrs[key], 10) || 1))))
    if (element.tagName === 'OL' && attrs.start) element.setAttribute('start', String(Number.parseInt(attrs.start, 10) || 1))
    if (element.tagName === 'COL') {
      const width = /width:\s*([\d.]+)px/u.exec(attrs.style ?? '')?.[1]
      if (width) element.setAttribute('style', `width: ${Math.max(24, Math.min(2000, Number(width)))}px;`)
    }
    if (/^H[1-6]$/u.test(element.tagName)) element.setAttribute('style', 'color: #000000;')
    if (element.tagName === 'TH') element.setAttribute('style', 'background-color: #f0f1f2; color: #000000; font-weight: bold;')
    if (element.tagName === 'PRE') {
      element.set_content(escape(element.textContent).replaceAll('\n', '<br>'))
      element.tagName = 'p'
      element.setAttribute('style', 'background-color: #f3f4f5; font-family: Courier New; font-size: 10pt;')
    }
    if (element.tagName === 'CODE') element.setAttribute('style', 'font-family: Courier New; font-size: 10pt;')
    if (element.tagName === 'FIGCAPTION') {
      element.tagName = 'p'; element.setAttribute('style', 'font-size: 10pt; color: #555555; text-align: center;')
    }
    if (element.tagName === 'FIGURE') element.tagName = 'div'
  }
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.querySelector('p')
    if (first) first.set_content(first.innerHTML.replace(/^\s*\[!(?:NOTE|WARNING|TIP|IMPORTANT)\](?:\s*<br\s*\/?>)?\s*/iu, ''))
    quote.setAttribute('style', 'border-left: 3px solid #aab4b0; padding-left: 12px; background-color: #f4f6f5;')
  }
  for (const table of root.querySelectorAll('table')) {
    const cells = table.querySelectorAll('td,th')
    if (cells.reduce((sum, cell) => sum + Number(cell.getAttribute('rowspan') ?? 1) * Number(cell.getAttribute('colspan') ?? 1), 0) > 10_000)
      throw new Error('This table layout is too large to export as Word. Split it into smaller tables.')
    table.setAttribute('style', 'width: 100%; border-collapse: collapse;')
  }
  for (const item of root.querySelectorAll('li').filter(list =>
    list.childNodes.some(child => child instanceof HTMLElement && ['P', 'UL', 'OL'].includes(child.tagName))))
    for (const child of [...item.childNodes])
      if (child.nodeType === NodeType.TEXT_NODE && !child.textContent.trim() && /[\r\n]/u.test(child.textContent)) child.remove()
  for (const parent of [root, ...root.querySelectorAll('ul,ol,table,thead,tbody,tfoot,tr,colgroup')])
    for (const child of [...parent.childNodes]) if (child.nodeType === NodeType.TEXT_NODE && !child.textContent.trim()) child.remove()
  const value = await convertWord(root.toString(), null, {
    title: document.title, creator: 'CopyOS', lastModifiedBy: 'CopyOS', font: 'Arial', fontSize: 22,
    margins: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
    table: { row: { cantSplit: true }, borderOptions: { size: 1, color: 'd4d7da' } },
    heading: { heading1: { fontSize: 48, bold: true, keepNext: true },
      heading2: { fontSize: 36, bold: true, keepNext: true }, heading3: { fontSize: 28, bold: true, keepNext: true } },
    preprocessing: { skipHTMLMinify: true },
  })
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value instanceof Blob ? await value.arrayBuffer() : value)
  const files = unzipSync(bytes)
  const body = files['word/document.xml'], styles = files['word/styles.xml']
  if (!body || !styles) throw new Error('Word export produced an incomplete document.')
  files['word/document.xml'] = Buffer.from(Buffer.from(body).toString().replace(/w:pStyle w:val="Heading1"/u, 'w:pStyle w:val="Title"'))
  files['word/styles.xml'] = Buffer.from(Buffer.from(styles).toString().replace('</w:styles>',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:keepNext/><w:spacing w:after="320"/></w:pPr><w:rPr><w:color w:val="000000"/>' +
    '<w:sz w:val="48"/></w:rPr></w:style></w:styles>'))
  return Buffer.from(zipSync(files))
}
