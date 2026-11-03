/** Exact-size PNG/JPEG/WebP rendering and self-contained SVG output of one native artboard, without page or editor chrome. */
import { exportDesignSvg } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'

/** Output request; scale multiplies the artboard's CSS pixel size (for SVG, its declared width and height). */
export interface DesignerRasterOptions {
  format: 'png' | 'jpeg' | 'webp' | 'svg'
  scale: 1 | 2 | 3
  /** Bundled Inter font URL embedded so exported text uses the same face as the canvas. */
  fontUrl: string
  /** Further `@font-face` rules with data URLs, such as the project's fonts; an SVG drawn as an image cannot use page fonts. */
  fontCss?: string | undefined
  /** Part of the artboard to draw, in artboard CSS pixels; omitted draws the whole artboard. */
  region?: { x: number; y: number; width: number; height: number } | undefined
}

const maximumSide = 16384, maximumAssetBytes = 20 * 1024 * 1024

async function dataUrl(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Export could not load ${url}`)
  const blob = await response.blob()
  if (blob.size > maximumAssetBytes) throw new Error('An exported image or font exceeds 20 MB')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result); else reject(new Error('Export could not encode an embedded resource')) }
    reader.onerror = () => { reject(reader.error ?? new Error('Export could not read an embedded resource')) }
    reader.readAsDataURL(blob)
  })
}

function regionInScene(document: CopyOSDesignDocument, frameId: string, region: NonNullable<DesignerRasterOptions['region']>):
{ x: number; y: number; width: number; height: number } {
  const frame = document.nodes.find(node => node.id === frameId)
  return { x: (frame?.x ?? 0) + region.x, y: (frame?.y ?? 0) + region.y, width: region.width, height: region.height }
}

/** Show only an artboard-local region: the root viewBox moves to it and the declared size becomes its size. */
function narrowSvgViewport(svg: string, region: NonNullable<DesignerRasterOptions['region']>): string {
  const end = svg.indexOf('>')
  const root = svg.slice(0, end)
  const box = /viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(root)
  if (!box) throw new Error('Artboard SVG has no viewBox')
  const x = Number(box[1]) + region.x, y = Number(box[2]) + region.y
  return root.replace(/ width="[\d.e]+" height="[\d.e]+"/, ` width="${String(region.width)}" height="${String(region.height)}"`)
    .replace(box[0], `viewBox="${String(x)} ${String(y)} ${String(region.width)} ${String(region.height)}"`) + svg.slice(end)
}

/**
 * Render one top-level artboard to a file of exactly its frame size times scale.
 * @param document - Current native design; linked Page Builder screens reject.
 * @param frameId - Visible top-level frame.
 * @param options - Format, integer scale and bundled font source.
 * @returns Encoded file and its pixel dimensions; JPEG fills transparent areas with white; SVG embeds images and Inter as data URLs.
 * @throws {Error} If the artboard is ineligible, a resource cannot be embedded, the size exceeds 16384 pixels per side,
 *   or this browser cannot encode the format.
 */
export async function rasterizeDesignArtboard(document: CopyOSDesignDocument, frameId: string,
  options: DesignerRasterOptions): Promise<{ blob: Blob; width: number; height: number }> {
  let svg = exportDesignSvg(document, undefined,
    { artboard: frameId, ...options.region ? { region: regionInScene(document, frameId, options.region) } : {} })
  if (options.region) svg = narrowSvgViewport(svg, options.region)
  const size = /^<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(svg)
  const width = Math.round(Number(size?.[1]) * options.scale), height = Math.round(Number(size?.[2]) * options.scale)
  if (!(width > 0 && height > 0) || width > maximumSide || height > maximumSide)
    throw new Error(`Export size must be 1–${maximumSide} pixels per side`)
  // An SVG drawn as an image cannot fetch, so every external image becomes a data URL first.
  const sources = [...new Set([...svg.matchAll(/\bhref="([^"#][^"]*)"/g)].map(match => match[1] ?? '').filter(url => url && !url.startsWith('data:')))]
  for (const source of sources) {
    const embedded = await dataUrl(source.replaceAll('&amp;', '&'))
    svg = svg.replaceAll(`href="${source}"`, `href="${embedded}"`)
  }
  const font = await dataUrl(options.fontUrl)
  const faces = ['Inter', 'CopyOSInter'].map(family =>
    `@font-face{font-family:${family};src:url(${font}) format('woff2');font-style:normal;font-weight:100 900}`).join('')
  svg = svg.replace('<defs>', `<defs><style>${faces}${options.fontCss ?? ''}</style>`)
  if (options.format === 'svg') {
    // The viewBox keeps the artboard coordinates; only the declared output size scales.
    const scaled = svg.replace(/^(<svg[^>]*?) width="[\d.]+" height="[\d.]+"/, `$1 width="${width}" height="${height}"`)
    return { blob: new Blob([scaled], { type: 'image/svg+xml' }), width, height }
  }
  // Data URLs keep the rendered SVG same-origin; blob URLs would taint the canvas in Chromium.
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  await globalThis.document.fonts.ready
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image export is unavailable in this browser')
  if (options.format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height) }
  context.drawImage(image, 0, 0, width, height)
  const type = `image/${options.format}`
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, type, 0.92) })
  if (!blob) throw new Error('Image encoding failed')
  // Browsers without an encoder for the type return PNG instead of failing.
  if (blob.type !== type) throw new Error(`This browser cannot encode ${options.format.toUpperCase()} images`)
  return { blob, width, height }
}
