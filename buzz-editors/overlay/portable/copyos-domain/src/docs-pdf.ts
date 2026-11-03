/** Server-side PDF rendering for the same Markdown stored by Suite Docs. */
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { parse } from 'node-html-parser'
import { marked, type Token, type Tokens } from 'marked'
import type { CopyOSDocDocument } from './types.ts'
import { docDiagramImages } from './docs-diagram-images.ts'
import { docPdfFonts } from './docs-pdf-fonts.ts'

function visibleText(tokens: readonly Token[]): string {
  return tokens.map((token) => {
    if (token.type === 'list') return (token as Tokens.List).items.map(item => visibleText(item.tokens)).join('\n')
    if (token.type === 'table') {
      const table = token as Tokens.Table
      return [table.header, ...table.rows].flatMap(row => row.map(cell => visibleText(cell.tokens))).join('\n')
    }
    if (token.type === 'html') {
      const root = parse(token.raw)
      for (const element of root.querySelectorAll('script,style,iframe,object')) element.remove()
      return root.structuredText
    }
    return 'tokens' in token && Array.isArray(token.tokens) ? visibleText(token.tokens)
      : 'text' in token ? String(token.text) : ''
  }).join('')
}

/** Verified attachment bytes supplied by the permission-checked repository. */
export interface DocsPdfAsset { readonly name: string; readonly mime: string; readonly image: boolean; readonly bytes: Buffer }

/** Render document headings, rich inline text, lists, code and tables to portable PDF bytes.
 * @param document - Saved document projection.
 * @param assets - Authorized attachment data indexed by internal reference.
 * @returns Complete PDF bytes.
 */
export async function renderDocPdf(document: CopyOSDocDocument, assets: ReadonlyMap<string, DocsPdfAsset> = new Map()): Promise<Buffer> {
  const fonts = await docPdfFonts([document.title, ...document.blocks.flatMap(block => [block.label, visibleText(marked.lexer(block.content))])].join('\n'))
  const diagrams = await docDiagramImages(document)
  const raster = new Map<string, Buffer>()
  await Promise.all(Array.from(assets, async ([reference, asset]) => {
    if (asset.image) raster.set(reference, await sharp(asset.bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer())
  }))
  const pdf = new PDFDocument({ margin: 54, size: 'A4', info: { Title: document.title } }),
    chunks: Buffer[] = []
  const result = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
    pdf.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    pdf.on('error', reject)
  })
  pdf.registerFont('DocsRegular', fonts.regular)
  pdf.registerFont('DocsBold', fonts.bold)
  const pageBottom = (): number => pdf.page.height - pdf.page.margins.bottom
  const space = (height: number): void => {
    if (pdf.y + height > pageBottom()) pdf.addPage()
  }
  const plain = (tokens: readonly Token[]): string =>
    tokens
      .map(token =>
        'tokens' in token && Array.isArray(token.tokens) ? plain(token.tokens) : 'text' in token ? String(token.text) : token.raw,
      )
      .join('')
  const image = (source: string, caption = ''): void => {
    const bytes = raster.get(source)
    if (!bytes) throw new Error('An image is unavailable. Upload it to the document before exporting.')
    pdf.text('', { continued: false })
    space(280)
    pdf.image(bytes, { fit: [pdf.page.width - 108, 260], align: 'center' }).moveDown(0.5)
    if (caption) pdf.font('DocsRegular').fontSize(9).text(caption, { align: 'center' }).moveDown(0.5)
  }
  const inline = (tokens: readonly Token[], bold = false, italic = false): void => {
    for (const token of tokens) {
      if (token.type === 'checkbox') continue
      if (token.type === 'image') { image(String(token.href), String(token.title ?? '')); continue }
      if (token.type === 'strong' || token.type === 'em' || token.type === 'del') {
        inline(token.tokens ?? [], bold || token.type === 'strong', italic || token.type === 'em')
      } else {
        const text = token.type === 'br' ? '\n' : 'text' in token ? String(token.text) : token.raw
        const face = token.type === 'codespan' && /^[\x20-\x7e\r\n\t]*$/u.test(text) ? 'Courier' : bold ? 'DocsBold' : 'DocsRegular'
        pdf
          .font(face)
          .text(text, {
            continued: true,
            baseline: -11 * fonts.ascentRatio,
            lineGap: 4,
            oblique: italic,
            ...(token.type === 'link' && /^(?:https?:|mailto:|tel:)/iu.test(String(token.href))
              ? { link: String(token.href), underline: true } : {}),
          })
      }
    }
  }
  const render = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'space') continue
      if (token.type === 'heading') {
        space(65)
        pdf
          .moveDown(0.5)
          .font('DocsRegular')
          .fontSize(24 - token.depth * 2)
          .text(plain(token.tokens ?? []), { lineGap: 4 })
          .moveDown(0.4)
      } else if (token.type === 'paragraph' || token.type === 'text') {
        space(35)
        pdf.font('DocsRegular').fontSize(11)
        if ('tokens' in token && Array.isArray(token.tokens)) inline(token.tokens)
        else pdf.text(String(token.text), { continued: true, baseline: -11 * fonts.ascentRatio, lineGap: 4 })
        pdf.text('\n', { continued: false, oblique: false }).moveDown(0.6)
      } else if (token.type === 'list') {
        ;(token as Tokens.List).items.forEach((item, index) => {
          space(30)
          pdf.font('DocsRegular').fontSize(11)
          const marker = item.task
            ? item.checked
              ? '[x]'
              : '[ ]'
            : token.ordered
              ? `${Number(token.start) + index}.`
              : '•'
          pdf.text(`${marker} `, { continued: true, baseline: -11 * fonts.ascentRatio })
          render(item.tokens)
        })
      } else if (token.type === 'blockquote') {
        const start = pdf.y
        const quote = token as Tokens.Blockquote
        const body = quote.text.replace(/^\[!(NOTE|WARNING|TIP|IMPORTANT)\](?:\r?\n|$)/u, '')
        render(body === quote.text ? quote.tokens : marked.lexer(body))
        pdf
          .save()
          .strokeColor('#a8b4ac')
          .lineWidth(2)
          .moveTo(45, start)
          .lineTo(45, pdf.y - 7)
          .stroke()
          .restore()
      } else if (token.type === 'code') {
        const code = token as Tokens.Code
        const diagram = ['mermaid', 'copyos-chart'].includes(code.lang?.trim().toLowerCase() ?? '') ? diagrams.get(code.text) : undefined
        if (diagram) {
          const height = Math.min(600, diagram.height * 0.75)
          space(height + 16)
          pdf.image(diagram.bytes, { fit: [pdf.page.width - 108, height], align: 'center' }).moveDown()
        } else {
          space(40)
          const text = String(token.text)
          pdf.font(/^[\x20-\x7e\r\n\t]*$/u.test(text) ? 'Courier' : 'DocsRegular').fontSize(9).text(text, { lineGap: 3 }).moveDown()
        }
      } else if (token.type === 'hr') {
        space(25)
        pdf.moveDown(0.5)
        pdf
          .save()
          .strokeColor('#dddddd')
          .moveTo(54, pdf.y)
          .lineTo(pdf.page.width - 54, pdf.y)
          .stroke()
          .restore()
        pdf.moveDown()
      } else if (token.type === 'html') {
        const root = parse(token.raw)
        for (const element of root.querySelectorAll('script,style,iframe,object')) element.remove()
        const figures = root.querySelectorAll('figure[data-doc-image]')
        for (const figure of figures) {
          const src = figure.querySelector('img')?.getAttribute('src')
          if (src) image(src, figure.querySelector('figcaption')?.textContent ?? '')
          figure.remove()
        }
        for (const img of root.querySelectorAll('img')) {
          image(img.getAttribute('src') ?? '', img.getAttribute('title') ?? ''); img.remove()
        }
        const tables = root.querySelectorAll('table').filter(table => !table.parentNode.closest('table'))
        if (!tables.length) {
          const text = root.structuredText.trim()
          if (text) { space(35); pdf.font('DocsRegular').fontSize(11).text(text).moveDown(0.5) }
        }
        for (const table of tables) {
          const rows = table.querySelectorAll('tr').filter(row => row.closest('table') === table)
          const data = rows.map(row => row.querySelectorAll('th,td').filter(cell => cell.closest('tr') === row).map(cell => ({
            text: cell.structuredText.trim(),
            colSpan: Math.max(1, Math.min(100, Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1)),
            rowSpan: Math.max(1, Math.min(rows.length, Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1)),
            font: { src: cell.tagName === 'TH' ? 'DocsBold' : 'DocsRegular', size: 10 },
            type: cell.tagName === 'TH' ? 'TH' as const : 'TD' as const,
          }))).filter(row => row.length)
          if (!data.length) continue
          if (data.reduce((sum, row) => sum + row.reduce((area, cell) => area + cell.colSpan * cell.rowSpan, 0), 0) > 10_000)
            throw new Error('This table layout is too large to export as PDF. Split it into smaller tables.')
          const widths = table.querySelectorAll('col').map(col =>
            Number.parseFloat(/width:\s*([\d.]+)px/u.exec(col.getAttribute('style') ?? '')?.[1] ?? '0'))
          const total = widths.reduce((sum, value) => sum + value, 0), width = pdf.page.width - 108
          const scaled = Number.isFinite(total) && total > 0 && widths.every(value => Number.isFinite(value) && value > 0)
            ? widths.map(value => value / total * width) : undefined
          space(40)
          pdf.font('DocsRegular').fontSize(10).table({ data, position: { x: 54, y: pdf.y }, maxWidth: width,
            ...(scaled ? { columnStyles: scaled } : {}),
            defaultStyle: { border: 0.5, borderColor: '#dddddd', padding: 8 } })
          pdf.x = 54; pdf.moveDown()
        }
      } else if (token.type === 'table') {
        const table = token as Tokens.Table,
          rows = [table.header, ...table.rows],
          width = pdf.page.width - 108,
          cellWidth = width / table.header.length
        for (const [index, row] of rows.entries()) {
          pdf.font(index === 0 ? 'DocsBold' : 'DocsRegular').fontSize(10)
          const height = Math.max(
            28,
            ...row.map(cell => pdf.heightOfString(plain(cell.tokens), { width: cellWidth - 16 }) + 16),
          )
          space(height)
          const y = pdf.y
          row.forEach((cell, column) => {
            const x = 54 + column * cellWidth
            pdf.save().lineWidth(0.5).strokeColor('#dddddd').rect(x, y, cellWidth, height).stroke().restore()
            pdf.text(plain(cell.tokens), x + 8, y + 8, { width: cellWidth - 16, lineGap: 2 })
          })
          pdf.x = 54
          pdf.y = y + height
        }
        pdf.moveDown()
      } else if ('text' in token) {
        pdf.font('DocsRegular').fontSize(11).text(String(token.text)).moveDown(0.5)
      }
    }
  }
  try {
    for (const asset of assets.values()) if (!asset.image) pdf.file(asset.bytes, { name: asset.name, type: asset.mime })
    pdf.font('DocsRegular').fontSize(28).text(document.title).moveDown()
    for (const block of document.blocks) {
      if (block.label) {
        space(70)
        pdf.font('DocsRegular').fontSize(18).text(block.label).moveDown(0.5)
      }
      render(marked.lexer(block.content))
      pdf.moveDown(0.4)
    }
    pdf.end()
  } catch (error) {
    pdf.emit('error', error instanceof Error ? error : new Error(String(error)))
  }
  return result
}
