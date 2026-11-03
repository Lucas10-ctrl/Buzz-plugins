/** Host-only PNG rendering of one native artboard, with text drawn as glyph outlines from the explicitly supplied fonts. */
import sharp from 'sharp'
import { exportDesignSvg } from './design-model.ts'
import { designSvgTextSolidPaint } from './design-svg-text.ts'
import { createDesignTextMeasurer } from './design-text-measurement.ts'
import { DESIGN_IMAGE_ASSET_MIME_TYPES, parseDesignImageAssetReference, resolveDesignImageUrls } from './design-image-assets.ts'
import type { DesignMeasurementFont } from './design-text-measurement-types.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

/** One render request; sizes are CSS pixels of the artboard. */
export interface DesignRasterRequest {
  /** Visible top-level frame to render. */
  artboardId: string
  /** Longest output width in pixels; the artboard is scaled down to fit, never up beyond 2×. */
  maxWidth: number
  /** Longest output height in pixels after scaling; taller regions scale down further. */
  maxHeight: number
  /** Optional vertical region of the artboard, for long pages; omitted renders the whole artboard. */
  region?: { top: number; height: number } | undefined
  /** Read one stored project image by its file name inside `assets/images/`. */
  readImage: (fileName: string) => Promise<Uint8Array>
}

/** A text layer drawn with a substitute font, or not drawn. */
export type DesignRasterTextNote = {
  id: string
  name: string
  /** `drawn`: drawn with its own family; `substituted`: drawn with the first catalog family; `skipped`: not drawn. */
  outcome: 'drawn' | 'substituted' | 'skipped'
  family: string
  /** Characters the fonts lack, drawn as the missing-glyph shape. */
  missingCharacters?: string
}

/** Rendered PNG and what it shows. */
export interface DesignRasterResult {
  png: Uint8Array
  width: number
  height: number
  /** Output pixels per artboard CSS pixel. */
  scale: number
  artboard: { id: string; name: string; width: number; height: number }
  region: { top: number; height: number }
  text: DesignRasterTextNote[]
  /** Images that could not be read and render as empty. */
  missingImages: string[]
}

/** A reusable renderer over one font catalog. */
export interface DesignRasterizer {
  /**
   * Render one artboard of a saved design to PNG.
   * @param document - Saved design.
   * @param request - Artboard, size bounds, region and the project image reader.
   * @returns The PNG and notes about substituted text and missing images.
   */
  render(document: CopyOSDesignDocument, request: DesignRasterRequest): Promise<DesignRasterResult>
  /** Release the text engine. */
  dispose(): void
}

const firstFamily = (value: string): string => value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? value

/**
 * Narrow an exported artboard SVG's root viewport to a vertical region.
 * @param svg - `exportDesignSvg` artboard markup whose root declares numeric height and viewBox.
 * @param top - Region start in artboard CSS pixels.
 * @param height - Region height in artboard CSS pixels.
 * @returns Markup showing only that region.
 * @throws {Error} If the root element lacks a numeric height or viewBox.
 */
export function designSvgRegion(svg: string, top: number, height: number): string {
  const end = svg.indexOf('>')
  const root = svg.slice(0, end)
  const box = /viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(root)
  if (!/^<svg\b/.test(root) || !box || !/ height="[\d.e]+"/.test(root)) throw new Error('Artboard SVG has no numeric root viewport')
  const [, x = '0', y = '0', width = '0'] = box
  const narrowed = root.replace(/ height="[\d.e]+"/, ` height="${String(height)}"`)
    .replace(box[0], `viewBox="${x} ${String(Number(y) + top)} ${width} ${String(height)}"`)
  return narrowed + svg.slice(end)
}

/**
 * Split each single-radius `feMorphology` into a horizontal and a vertical pass, which librsvg evaluates with the same
 * pixels in 2·(2r+1) instead of (2r+1)² samples per pixel; spread shadows on large layers otherwise dominate render time.
 * Browsers may treat a zero radius component as disabling the primitive, so this rewrite is only for the librsvg render.
 * @param svg - Exported markup whose morphology primitives carry `in`, `radius` and `result` attributes.
 * @returns Markup with equivalent separable morphology passes.
 */
export function designSvgSeparableMorphology(svg: string): string {
  return svg.replace(/<feMorphology in="([^"]*)" operator="(dilate|erode)" radius="([\d.e+]+)" result="([^"]*)"([^>]*)\/>/g,
    (_, input: string, operator: string, radius: string, result: string, rest: string) =>
      `<feMorphology in="${input}" operator="${operator}" radius="${radius} 0" result="${result}-x"${rest}/>` +
      `<feMorphology in="${result}-x" operator="${operator}" radius="0 ${radius}" result="${result}"${rest}/>`)
}

/**
 * Create a renderer whose text uses only the given fonts: the shared paragraph engine lays out and draws each text layer, and the
 * drawing is placed where the layer's text goes, so stacking order and clipping follow the design and no host font is involved.
 * A layer whose family is not in the catalog is drawn with the first catalog family and reported.
 * @param fonts - Explicit font faces; the first face's family is the substitute for unknown families.
 * @returns The renderer.
 */
export async function createDesignRasterizer(fonts: readonly DesignMeasurementFont[]): Promise<DesignRasterizer> {
  const fallbackFamily = fonts[0]?.family
  if (fallbackFamily === undefined) throw new Error('Provide at least one raster font')
  const measurer = await createDesignTextMeasurer({ fonts })
  const known = (family: string): boolean => fonts.some(face => face.family.toLowerCase() === family.toLowerCase())
  const substitute = (node: CopyOSDesignNode): CopyOSDesignNode => ({ ...node, fontFamily: fallbackFamily,
    textRuns: node.textRuns?.map(run => run.style.fontFamily === undefined || known(firstFamily(run.style.fontFamily)) ? run
      : { ...run, style: { ...run.style, fontFamily: fallbackFamily } }) })
  return {
    dispose: () => { measurer.dispose() },
    async render(document, request) {
      const artboard = document.nodes.find(node => node.id === request.artboardId)
      if (!artboard || artboard.parentId !== null || artboard.kind !== 'frame' || !artboard.visible)
        throw new Error('Rendering requires a visible top-level frame')
      const missingImages: string[] = []
      const resolved = await resolveDesignImageUrls(document, async (url) => {
        const reference = parseDesignImageAssetReference(url)
        if (!reference) return url
        try {
          const bytes = await request.readImage(reference.fileName)
          return `data:${DESIGN_IMAGE_ASSET_MIME_TYPES[reference.extension]};base64,${Buffer.from(bytes).toString('base64')}`
        } catch (error: unknown) {
          if (!(error instanceof Error)) throw error
          missingImages.push(reference.fileName)
          return ''
        }
      }, url => parseDesignImageAssetReference(url) !== undefined)
      const top = Math.max(0, Math.min(artboard.height, request.region?.top ?? 0))
      const height = Math.max(1, Math.min(artboard.height - top, request.region?.height ?? artboard.height))
      const scale = Math.min(2, request.maxWidth / artboard.width, request.maxHeight / height)
      const width = Math.max(1, Math.round(artboard.width * scale)), outputHeight = Math.max(1, Math.round(height * scale))
      // Text drawings keep at least one pixel per CSS pixel so small type stays legible after the final resize.
      const textScale = Math.min(4, Math.max(1, Math.ceil(scale * 2) / 2))
      const notes = new Map<string, DesignRasterTextNote>()
      const drawable = (node: CopyOSDesignNode): CopyOSDesignNode => {
        const family = firstFamily(node.fontFamily)
        const runFamilies = node.textRuns?.flatMap(run =>
          run.style.fontFamily === undefined ? [] : [firstFamily(run.style.fontFamily)]) ?? []
        const unknown = [family, ...runFamilies].find(name => !known(name))
        if (unknown === undefined) return node
        notes.set(node.id, { id: node.id, name: node.name, outcome: 'substituted', family: unknown })
        return substitute(node)
      }
      const svg = exportDesignSvg(resolved, undefined, {
        artboard: artboard.id,
        // Layers outside the region are left out, so their effects and text drawings cost nothing.
        region: { x: artboard.x, y: artboard.y + top, width: artboard.width, height },
        editableText: (node) => {
          const lines = measurer.lines(drawable(node))
          if (!lines) notes.set(node.id, { id: node.id, name: node.name, outcome: 'skipped', family: firstFamily(node.fontFamily) })
          return lines
        },
        textOutline: (node, paints) => {
          const painted = measurer.paint(drawable(node), designSvgTextSolidPaint(paints), textScale)
          if (!painted) return undefined
          if (painted.missingCodepoints.length) {
            const note = notes.get(node.id)
            notes.set(node.id, { ...note ?? { id: node.id, name: node.name, outcome: 'drawn', family: firstFamily(node.fontFamily) },
              missingCharacters: String.fromCodePoint(...painted.missingCodepoints) })
          }
          return `<image x="0" y="0" width="${painted.width}" height="${painted.height}" preserveAspectRatio="none" ` +
            `href="data:image/png;base64,${Buffer.from(painted.png).toString('base64')}"/>`
        },
      })
      // Only the requested region is rasterized: the narrowed root viewport makes tall artboards cost their region, not their height.
      const png = await sharp(Buffer.from(designSvgSeparableMorphology(designSvgRegion(svg, top, height))),
        { density: 72 * scale, limitInputPixels: 268_402_689 })
        .resize({ width, height: outputHeight, fit: 'fill' }).png().toBuffer()
      return { png: new Uint8Array(png), width, height: outputHeight, scale, missingImages,
        artboard: { id: artboard.id, name: artboard.name, width: artboard.width, height: artboard.height },
        region: { top, height }, text: [...notes.values()] }
    },
  }
}
