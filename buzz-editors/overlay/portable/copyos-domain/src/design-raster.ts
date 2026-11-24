/** Host-only PNG rendering of one native artboard, with text drawn as glyph outlines from the explicitly supplied fonts. */
import sharp from 'sharp'
import { createDesignRenderScene, designChildrenInPaintOrder, designSvgNodeMatrix, exportDesignSvg, type DesignSvgBackdrop as DesignSvgBackdropHook,
  type DesignSvgMatrix } from './design-model.ts'
import { designNodeEffects } from './design-effects.ts'
import { designImageFilterPixels, designImageFiltersActive } from './design-image-filters.ts'
import { designSvgTextSolidPaint } from './design-svg-text.ts'
import { createDesignTextMeasurer } from './design-text-measurement.ts'
import { DESIGN_IMAGE_ASSET_MIME_TYPES, parseDesignImageAssetReference, resolveDesignImageUrls } from './design-image-assets.ts'
import type { DesignMeasurementFont } from './design-text-measurement-types.ts'
import type { CopyOSDesignDocument, CopyOSDesignImageFilters, CopyOSDesignNode } from './types.ts'

/** One render request; sizes are CSS pixels of the artboard. */
export interface DesignRasterRequest {
  /** Visible top-level frame to render. */
  artboardId: string
  /** Longest output width in pixels; the artboard is scaled down to fit, never up beyond 2×. */
  maxWidth: number
  /** Longest output height in pixels after scaling; taller regions scale down further. */
  maxHeight: number
  /** Largest output pixels per CSS pixel; omitted keeps 2×. Agent exports ask for exactly 1×, 2× or 3×. */
  scaleLimit?: number | undefined
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
 * Narrow an exported artboard SVG to a vertical region and grow it by a margin on every side, so blurs near the artboard edges
 * sample the content that continues past them (librsvg discards everything outside its canvas before filtering).
 * @param svg - `exportDesignSvg` artboard markup whose root declares numeric width, height and viewBox.
 * @param top - Region start in artboard CSS pixels.
 * @param height - Region height in artboard CSS pixels.
 * @param margin - Extra CSS pixels on each side; zero is exactly `designSvgRegion`.
 * @returns Markup whose root viewport is the region plus the margin.
 * @throws {Error} If the root element lacks a numeric width, height or viewBox.
 */
export function designSvgViewport(svg: string, top: number, height: number, margin: number): string {
  if (!margin) return designSvgRegion(svg, top, height)
  const region = designSvgRegion(svg, top - margin, height + margin * 2)
  const end = region.indexOf('>'), root = region.slice(0, end)
  const box = /viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(root)
  if (!box || !/ width="[\d.e]+"/.test(root)) throw new Error('Artboard SVG has no numeric root viewport')
  const [, x = '0', y = '0', width = '0', boxHeight = '0'] = box
  const widened = root.replace(/ width="[\d.e]+"/, ` width="${String(Number(width) + margin * 2)}"`)
    .replace(box[0], `viewBox="${String(Number(x) - margin)} ${y} ${String(Number(width) + margin * 2)} ${boxHeight}"`)
  return widened + region.slice(end)
}

/** Largest Gaussian reach (three sigma, sigma = radius / 2) of visible layer and background blurs, in CSS pixels; zero without blurs. */
function designBlurMargin(document: CopyOSDesignDocument): number {
  let radius = 0
  for (const node of document.nodes) for (const effect of node.effects ?? [])
    if ((effect.type === 'layer-blur' || effect.type === 'background-blur') && effect.visible) radius = Math.max(radius, effect.radius)
  for (const style of document.effectStyles ?? []) for (const effect of style.effects)
    if ((effect.type === 'layer-blur' || effect.type === 'background-blur') && effect.visible) radius = Math.max(radius, effect.radius)
  return radius > 0 ? Math.ceil(radius * 1.5) + 2 : 0
}

/**
 * Bake Figma image adjustments into embedded picture bytes, so librsvg draws the adjusted picture without an SVG filter. Pictures
 * that are not `data:` URLs keep their `filters` and are adjusted by the SVG filter instead.
 * @param document - Design whose project images are already embedded.
 * @returns The same document when no image paint has active filters; otherwise a copy with adjusted pictures.
 */
export async function bakeDesignImageFilters(document: CopyOSDesignDocument): Promise<CopyOSDesignDocument> {
  type ImagePaint = { url: string; scaleMode: string; filters?: CopyOSDesignImageFilters }
  const isFiltered = (value: unknown): value is ImagePaint => typeof value === 'object' && value !== null &&
    typeof (value as ImagePaint).url === 'string' && typeof (value as ImagePaint).scaleMode === 'string' &&
    (value as ImagePaint).url.startsWith('data:') && designImageFiltersActive((value as ImagePaint).filters)
  const jobs = new Map<string, Promise<string>>()
  const key = (paint: ImagePaint): string => JSON.stringify([paint.filters, paint.url])
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) collect(item); return }
    if (typeof value !== 'object' || value === null) return
    if (isFiltered(value) && value.filters) {
      const filters = value.filters, url = value.url
      if (!jobs.has(key(value))) jobs.set(key(value), (async () => {
        const comma = url.indexOf(',')
        if (comma < 0 || !url.slice(0, comma).endsWith(';base64')) return url
        const { data, info } = await sharp(Buffer.from(url.slice(comma + 1), 'base64')).toColourspace('srgb').ensureAlpha().raw()
          .toBuffer({ resolveWithObject: true })
        designImageFilterPixels(data, filters)
        const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
        return `data:image/png;base64,${png.toString('base64')}`
      })())
      return
    }
    for (const item of Object.values(value)) collect(item)
  }
  collect(document.nodes)
  collect(document.effectStyles)
  if (!jobs.size) return document
  const baked = new Map<string, string>()
  for (const [name, job] of jobs) baked.set(name, await job.catch(() => ''))
  const rebuild = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rebuild)
    if (typeof value !== 'object' || value === null) return value
    if (isFiltered(value)) {
      const url = baked.get(key(value))
      // An undecodable picture keeps its filters so the SVG filter still adjusts what librsvg can draw.
      if (url) { const { filters: _filters, ...rest } = value; return { ...rest, url } }
      return value
    }
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rebuild(item)]))
  }
  return { ...document, nodes: rebuild(document.nodes) as CopyOSDesignNode[] }
}

/**
 * Layers of an artboard with a visible background blur, in paint order, each with every layer painted at or after it (other than its
 * own ancestors). Only stored layers of the artboard tree take part; background blurs inside linked component instances are not drawn.
 */
function designBackgroundBlurTargets(document: CopyOSDesignDocument, artboardId: string):
  { id: string; radius: number; width: number; height: number; matrix: DesignSvgMatrix; after: Set<string> }[] {
  const scene = createDesignRenderScene(document)
  const order: { id: string; ancestors: string[]; matrix: DesignSvgMatrix }[] = []
  // Scene matrices compose exactly as the SVG renderer composes them for stored (non-instance) layers.
  const visit = (id: string, ancestors: string[], parent: DesignSvgMatrix): void => {
    const node = scene.root.byId.get(id)
    if (!node || !node.visible || ancestors.length > 64) return
    const matrix = designSvgNodeMatrix(parent, node)
    order.push({ id, ancestors, matrix })
    if (node.kind === 'instance' || node.kind === 'boolean') return
    for (const child of designChildrenInPaintOrder(node, scene.root.children.get(id) ?? [])) visit(child.id, [...ancestors, id], matrix)
  }
  visit(artboardId, [], [1, 0, 0, 1, 0, 0])
  return order.flatMap(({ id, ancestors, matrix }, index) => {
    const node = scene.root.byId.get(id)
    const blur = node && id !== artboardId ? designNodeEffects(node).find(effect => effect.type === 'background-blur') : undefined
    if (!node || !blur?.visible || blur.radius <= 0) return []
    const ancestry = new Set(ancestors)
    const after = new Set(order.slice(index).map(entry => entry.id).filter(other => !ancestry.has(other)))
    return [{ id, radius: blur.radius, width: node.width, height: node.height, matrix, after }]
  })
}

const invertMatrix = ([a, b, c, d, e, f]: DesignSvgMatrix): DesignSvgMatrix => {
  const determinant = a * d - b * c || 1
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant]
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
export async function createDesignRasterizer(fonts: readonly DesignMeasurementFont[],
  options: { fallbackFamilies?: readonly string[] } = {}): Promise<DesignRasterizer> {
  const fallbackFamily = fonts[0]?.family
  if (fallbackFamily === undefined) throw new Error('Provide at least one raster font')
  const measurer = await createDesignTextMeasurer({ fonts, ...(options.fallbackFamilies ? { fallbackFamilies: options.fallbackFamilies } : {}) })
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
      const embedded = await resolveDesignImageUrls(document, async (url) => {
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
      const resolved = await bakeDesignImageFilters(embedded)
      const top = Math.max(0, Math.min(artboard.height, request.region?.top ?? 0))
      const height = Math.max(1, Math.min(artboard.height - top, request.region?.height ?? artboard.height))
      const scale = Math.min(request.scaleLimit ?? 2, request.maxWidth / artboard.width, request.maxHeight / height)
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
      // Blurs sample past the artboard edges: the render grows by their reach and is cropped back, so edges stay solid as in Figma.
      // Without blurs the margin is zero and the output is exactly the plain region render.
      const margin = designBlurMargin(resolved)
      const exportSvg = (source: CopyOSDesignDocument, backdrop?: DesignSvgBackdropHook): string => exportDesignSvg(source, undefined, {
        artboard: artboard.id,
        // Layers outside the region are left out, so their effects and text drawings cost nothing.
        region: { x: artboard.x - margin, y: artboard.y + top - margin, width: artboard.width + margin * 2, height: height + margin * 2 },
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
          return `<image x="${String(painted.left ?? 0)}" y="${String(painted.top ?? 0)}" width="${painted.width}" height="${painted.height}" preserveAspectRatio="none" ` +
            `href="data:image/png;base64,${Buffer.from(painted.png).toString('base64')}"/>`
        },
        ...(backdrop ? { backdrop } : {}),
      })
      // Only the requested region (plus the blur margin) is rasterized: the narrowed root viewport makes tall artboards cost their region.
      const rasterize = (svg: string): ReturnType<typeof sharp> => sharp(Buffer.from(designSvgSeparableMorphology(designSvgViewport(svg, top, height, margin))),
        { density: 72 * scale, limitInputPixels: 268_402_689 })
      // Background blur (raster only): each target's backdrop is the artboard rendered without the target and everything painted
      // after it, blurred, and drawn inside the target's shape under its own paint. Rotation is exact: the backdrop is placed through
      // the inverse of the target's transform.
      const targets = designBackgroundBlurTargets(resolved, artboard.id)
      const backdrops = new Map<string, string>()
      const backdropHook: DesignSvgBackdropHook = (_node, matrix, renderId) => {
        const markup = backdrops.get(renderId)
        return markup ? `<g transform="matrix(${invertMatrix(matrix).join(' ')})">${markup}</g>` : undefined
      }
      for (const target of targets) {
        const hidden: CopyOSDesignDocument = { ...resolved,
          nodes: resolved.nodes.map(node => target.after.has(node.id) ? { ...node, opacity: 0 } : node) }
        const { data, info } = await rasterize(exportSvg(hidden, backdropHook)).png().toBuffer({ resolveWithObject: true })
        const { matrix } = target
        // Scene rectangle covered by the backdrop render, and its pixels per CSS pixel.
        const sceneX = artboard.x - margin, sceneY = artboard.y + top - margin
        const sx = info.width / (artboard.width + margin * 2), sy = info.height / (height + margin * 2)
        const corners = [[0, 0], [target.width, 0], [0, target.height], [target.width, target.height]] as const
        const xs = corners.map(([x, y]) => (matrix[0] * x + matrix[2] * y + matrix[4] - sceneX) * sx)
        const ys = corners.map(([x, y]) => (matrix[1] * x + matrix[3] * y + matrix[5] - sceneY) * sy)
        const left = Math.max(0, Math.floor(Math.min(...xs)) - 1), topPixel = Math.max(0, Math.floor(Math.min(...ys)) - 1)
        const right = Math.min(info.width, Math.ceil(Math.max(...xs)) + 1), bottom = Math.min(info.height, Math.ceil(Math.max(...ys)) + 1)
        if (right <= left || bottom <= topPixel) continue
        // The backdrop is the artboard's own pixels, extended past its edges by copying them, so the blur stays solid at the edges.
        const inner = { left: Math.round(margin * sx), top: Math.round(margin * sy) }
        const innerWidth = Math.max(1, Math.min(info.width - inner.left, Math.round(artboard.width * sx)))
        const innerHeight = Math.max(1, Math.min(info.height - inner.top, Math.round(height * sy)))
        const edged = await sharp(data).extract({ ...inner, width: innerWidth, height: innerHeight })
          .extend({ top: inner.top, left: inner.left, right: info.width - inner.left - innerWidth, bottom: info.height - inner.top - innerHeight,
            extendWith: 'copy' }).png().toBuffer()
        const sigma = Math.min(1000, target.radius / 2 * sx)
        // sharp extracts before it blurs within one pipeline, so the blur is completed first and cropped in a second pass.
        const softened = sigma >= 0.3 ? await sharp(edged).blur(sigma).png().toBuffer() : edged
        const blurred = await sharp(softened).extract({ left, top: topPixel, width: right - left, height: bottom - topPixel }).png().toBuffer()
        backdrops.set(target.id, `<image x="${sceneX + left / sx}" y="${sceneY + topPixel / sy}" width="${(right - left) / sx}" ` +
          `height="${(bottom - topPixel) / sy}" preserveAspectRatio="none" href="data:image/png;base64,${blurred.toString('base64')}"/>`)
      }
      let image = rasterize(exportSvg(resolved, targets.length ? backdropHook : undefined))
      if (margin) {
        // Crop the margin back off; the artboard's own clip is unchanged inside the larger render.
        const rendered = await image.png().toBuffer({ resolveWithObject: true })
        const sx = rendered.info.width / (artboard.width + margin * 2), sy = rendered.info.height / (height + margin * 2)
        const left = Math.round(margin * sx), topPixel = Math.round(margin * sy)
        image = sharp(rendered.data).extract({ left, top: topPixel,
          width: Math.max(1, Math.min(rendered.info.width - left, Math.round(artboard.width * sx))),
          height: Math.max(1, Math.min(rendered.info.height - topPixel, Math.round(height * sy))) })
      }
      const png = await image.resize({ width, height: outputHeight, fit: 'fill' }).png().toBuffer()
      return { png: new Uint8Array(png), width, height: outputHeight, scale, missingImages,
        artboard: { id: artboard.id, name: artboard.name, width: artboard.width, height: artboard.height },
        region: { top, height }, text: [...notes.values()] }
    },
  }
}
