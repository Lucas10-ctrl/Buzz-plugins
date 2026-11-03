/** Portable PDF faces are bundled, selected by actual glyph coverage and never loaded from caller paths. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { create as readFont, type Font } from 'fontkit'

interface Faces { readonly regular: string; readonly bold: string; readonly fonts: readonly Font[]; readonly ascentRatio: number }
let latin: Promise<Faces> | undefined, international: Promise<Faces> | undefined
async function faces(regular: string, bold: string): Promise<Faces> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
  const paths = [regular, bold].map(name => join(directory, name))
  const fonts = await Promise.all(paths.map(async (path) => {
    const font = readFont(await readFile(path))
    if ('fonts' in font) throw new Error('Document PDF fonts require static single-face files.')
    return font
  }))
  const first = paths[0], second = paths[1], regularFont = fonts[0]
  if (!first || !second || !regularFont) throw new Error('Document PDF font pair is missing.')
  return { regular: first, bold: second, fonts, ascentRatio: regularFont.ascent / regularFont.unitsPerEm }
}
/** Choose faces covering all rendered text, refusing silent missing-glyph substitutions.
 * @param text - Visible document text, excluding link destinations and executable markup.
 * @returns Regular/bold font paths and regular ascent per em for consistent mixed-face baselines.
 */
export async function docPdfFonts(text: string): Promise<{ regular: string; bold: string; ascentRatio: number }> {
  const characters = [...new Set(Array.from(text).filter(character => !/\s/u.test(character)).map(character => character.codePointAt(0)))]
  const covers = (value: Faces): boolean => characters.every(code => code !== undefined
    && value.fonts.every(font => font.hasGlyphForCodePoint(code)))
  const primary = await (latin ??= faces('Inter-Docs.ttf', 'Inter-Docs-Bold.ttf'))
  if (covers(primary)) return primary
  const fallback = await (international ??= faces('Noto-Docs-Regular.ttf', 'Noto-Docs-Bold.ttf'))
  if (covers(fallback)) return fallback
  throw new Error('Some characters cannot be exported to PDF yet. Export Word or Markdown to keep the full text.')
}
