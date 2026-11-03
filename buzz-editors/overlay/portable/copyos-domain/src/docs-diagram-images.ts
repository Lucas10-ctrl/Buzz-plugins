/** Export diagram images derived from the saved Mermaid fences; invalid drafts retain their source text. */
import { marked, type Tokens } from 'marked'
import sharp from 'sharp'
import type { CopyOSDocDocument } from './types.ts'
import { renderDocsDiagram } from './docs-diagram.ts'
import { renderDocsChart } from './docs-chart.ts'

/** Sharp raster bytes retain their source dimensions for consistent document-scale placement. */
export interface DocsDiagramImage { readonly bytes: Buffer; readonly width: number; readonly height: number }

/** Render each distinct valid Mermaid or data-chart fence once for an export operation.
 * @param document - Authorized saved document.
 * @returns PNG bytes and source dimensions keyed by exact Mermaid text, with invalid or unsupported source omitted.
 */
export async function docDiagramImages(document: CopyOSDocDocument): Promise<ReadonlyMap<string, DocsDiagramImage>> {
  const sources = new Map<string, string>()
  for (const block of document.blocks) void marked.walkTokens(marked.lexer(block.content), (token) => {
    if (token.type !== 'code') return
    const code = token as Tokens.Code
    const language = code.lang?.trim().toLowerCase()
    if (language === 'mermaid' || language === 'copyos-chart') sources.set(code.text, language)
  })
  if (sources.size > 64) throw new Error('This document has more than 64 diagrams. Split it before exporting.')
  const images = new Map<string, DocsDiagramImage>()
  let total = 0
  for (const [source, language] of sources) {
    let svg: string
    try { svg = language === 'copyos-chart' ? renderDocsChart(source) : renderDocsDiagram(source) }
    catch (_error) { continue /* A partial or unsupported diagram exports as its saved code. */ }
    const dimensions = /viewBox="0 0 ([\d.]+) ([\d.]+)"/u.exec(svg)
    const width = Number(dimensions?.[1]), height = Number(dimensions?.[2]), scale = 1400 / Math.max(width, height)
    const sized = svg.replace(/\bwidth="[\d.]+"/u, `width="${Math.max(1, Math.round(width * scale))}"`)
      .replace(/\bheight="[\d.]+"/u, `height="${Math.max(1, Math.round(height * scale))}"`)
    const image = await sharp(Buffer.from(sized), { limitInputPixels: 40_000_000 })
      .flatten({ background: '#ffffff' }).png().toBuffer()
    total += image.byteLength
    if (total > 32_000_000) throw new Error('Diagram images exceed the export size limit. Split this document before exporting.')
    images.set(source, { bytes: image, width, height })
  }
  return images
}
