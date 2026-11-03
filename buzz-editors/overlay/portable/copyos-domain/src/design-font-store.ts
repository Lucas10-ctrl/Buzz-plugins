/**
 * Project font files under `assets/fonts/` with a manifest naming each face's CSS family, style and weight range. Files are
 * content-addressed; faces come from Google Fonts (Latin characters) or from user uploads validated against their own metadata.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { create as readFont } from 'fontkit'
import { z } from 'zod'
import { CopyOSDesignError } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignFontFace } from './types.ts'

/** Project folder holding font files and their manifest. */
export const DESIGN_FONT_DIRECTORY = 'assets/fonts'
/** Largest accepted font file. */
export const DESIGN_FONT_MAX_BYTES = 10_000_000
/** Most faces one project may hold. */
const MAX_FACES = 200
const MANIFEST = 'fonts.json'
const fileNamePattern = /^[a-f0-9]{64}\.(ttf|otf|woff|woff2)$/
const MIME_TYPES = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' } as const
type FontExtension = keyof typeof MIME_TYPES

/** Expected font failures: unreadable or oversized files, unknown files, or families Google Fonts cannot provide. */
export class CopyOSDesignFontError extends CopyOSDesignError {}

const faceSchema = z.object({
  family: z.string().min(1).max(200), style: z.enum(['normal', 'italic']),
  weightMin: z.number().int().min(1).max(1000), weightMax: z.number().int().min(1).max(1000),
  file: z.string().regex(fileNamePattern), source: z.enum(['google', 'upload']), bytes: z.number().int().min(1).max(DESIGN_FONT_MAX_BYTES),
}).strict()
const manifestSchema = z.object({ version: z.literal(1), faces: z.array(faceSchema).max(MAX_FACES) }).strict()

/** Google Fonts access: the CSS endpoint and the fetch implementation used for it and its font files. */
export interface DesignGoogleFontsSource {
  /** CSS API v2 endpoint, normally `https://fonts.googleapis.com/css2`. */
  cssUrl: string
  fetch: typeof globalThis.fetch
}

function extensionOf(bytes: Uint8Array): FontExtension | undefined {
  const tag = String.fromCharCode(...bytes.subarray(0, 4))
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'OTTO') return 'otf'
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf'
  return undefined
}

/**
 * Read a font file's own family, style and weight range.
 * @param bytes - One TTF, OTF, WOFF or WOFF2 face.
 * @returns The face metadata; variable fonts report their `wght` axis range.
 * @throws {CopyOSDesignFontError} For unreadable files and collections.
 */
export function readDesignFontFace(bytes: Uint8Array): { family: string; style: 'normal' | 'italic'; weightMin: number; weightMax: number } {
  let font: ReturnType<typeof readFont>
  try { font = readFont(Buffer.from(bytes)) } catch (error: unknown) {
    throw new CopyOSDesignFontError('The font file could not be read', { cause: error })
  }
  if ('fonts' in font) throw new CopyOSDesignFontError('Font collections are not supported; upload one face per file')
  const preferred = font.getName('preferredFamily', 'en') ?? font.familyName
  const os2 = font['OS/2'] as { usWeightClass?: number; fsSelection?: { italic?: boolean } } | undefined
  const axis = font.variationAxes.wght
  const weight = Math.min(1000, Math.max(1, Math.round(os2?.usWeightClass ?? 400)))
  return { family: preferred, style: os2?.fsSelection?.italic || font.italicAngle !== 0 ? 'italic' : 'normal',
    weightMin: axis ? Math.max(1, Math.round(axis.min)) : weight, weightMax: axis ? Math.min(1000, Math.round(axis.max)) : weight }
}

/** One `@font-face` rule of a Google Fonts CSS response that covers Latin characters. */
interface GoogleFace { family: string; style: 'normal' | 'italic'; weightMin: number; weightMax: number; url: string }

/**
 * Parse the Latin `@font-face` rules of a Google Fonts CSS API v2 response.
 * @param css - Response body; each rule is preceded by a subset comment such as `/* latin *\/`.
 * @returns Faces whose font file is on fonts.gstatic.com.
 */
export function parseGoogleFontsCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = []
  for (const match of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (match[1] !== 'latin') continue
    const body = match[2] ?? ''
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1]
    const style = /font-style:\s*(normal|italic)/.exec(body)?.[1]
    const weight = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(body)
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(body)?.[1]
    if (!family || (style !== 'normal' && style !== 'italic') || !weight?.[1] || !url) continue
    faces.push({ family, style, weightMin: Number(weight[1]), weightMax: Number(weight[2] ?? weight[1]), url })
  }
  return faces
}

/** Project font files and their manifest. */
export class CopyOSDesignFontStore {
  /**
   * List installed faces.
   * @param root - Project root.
   * @returns Faces in manifest order; a project without fonts has none.
   */
  async list(root: string): Promise<CopyOSDesignFontFace[]> {
    let raw: string
    try { raw = await readFile(join(root, DESIGN_FONT_DIRECTORY, MANIFEST), 'utf8') } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    return manifestSchema.parse(JSON.parse(raw)).faces
  }

  /**
   * Read one installed font file.
   * @param root - Project root.
   * @param file - Manifest file name.
   * @returns The bytes and MIME type.
   * @throws {CopyOSDesignFontError} If the file is not an installed face.
   */
  async read(root: string, file: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const face = (await this.list(root)).find(item => item.file === file)
    if (!face) throw new CopyOSDesignFontError('Font file is not installed in this project')
    const extension = file.slice(file.lastIndexOf('.') + 1) as FontExtension
    return { bytes: await readFile(join(root, DESIGN_FONT_DIRECTORY, file)), mimeType: MIME_TYPES[extension] }
  }

  /**
   * Add a user font file; a face with the same family, style and weight range is replaced.
   * @param root - Project root.
   * @param bytes - One TTF, OTF, WOFF or WOFF2 face, at most 10 MB.
   * @returns The installed face.
   */
  async upload(root: string, bytes: Uint8Array): Promise<CopyOSDesignFontFace> {
    if (bytes.length < 12 || bytes.length > DESIGN_FONT_MAX_BYTES) throw new CopyOSDesignFontError('Font files must be at most 10 MB')
    const extension = extensionOf(bytes)
    if (!extension) throw new CopyOSDesignFontError('Upload a TTF, OTF, WOFF or WOFF2 font file')
    const meta = readDesignFontFace(bytes)
    const face = { ...meta, file: await this.writeFile(root, bytes, extension), source: 'upload' as const, bytes: bytes.length }
    await this.upsert(root, [face])
    return face
  }

  /**
   * Install families from Google Fonts: the Latin face of each style, variable where Google offers it.
   * @param root - Project root.
   * @param families - CSS family names; installed families are skipped.
   * @param source - Google Fonts endpoint and fetch.
   * @param signal - Cancellation.
   * @returns Installed faces, and families Google Fonts does not provide.
   */
  async installGoogle(root: string, families: readonly string[], source: DesignGoogleFontsSource, signal?: AbortSignal):
  Promise<{ faces: CopyOSDesignFontFace[]; unavailable: string[] }> {
    const installed = new Set((await this.list(root)).map(face => face.family.toLowerCase()))
    const faces: CopyOSDesignFontFace[] = [], unavailable: string[] = []
    for (const family of [...new Set(families)]) {
      if (installed.has(family.toLowerCase())) continue
      const found = await this.googleFaces(family, source, signal)
      if (!found.length) { unavailable.push(family); continue }
      for (const face of found) {
        const response = await source.fetch(face.url, { signal: signal ?? null })
        if (!response.ok) throw new CopyOSDesignFontError(`Google Fonts file for ${family} could not be downloaded`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const extension = extensionOf(bytes)
        if (!extension || bytes.length > DESIGN_FONT_MAX_BYTES) throw new CopyOSDesignFontError(`Google Fonts returned an unusable file for ${family}`)
        faces.push({ family, style: face.style, weightMin: face.weightMin, weightMax: face.weightMax,
          file: await this.writeFile(root, bytes, extension), source: 'google', bytes: bytes.length })
      }
    }
    if (faces.length) await this.upsert(root, faces)
    return { faces, unavailable }
  }

  /** Ask Google Fonts for a family: every weight and both styles, then narrower requests for families without those. */
  private async googleFaces(family: string, source: DesignGoogleFontsSource, signal?: AbortSignal): Promise<GoogleFace[]> {
    const name = encodeURIComponent(family).replace(/%20/g, '+')
    for (const axes of [':ital,wght@0,100..900;1,100..900', ':wght@100..900', ':ital,wght@0,400;0,700;1,400;1,700', ':wght@400;700', '']) {
      // Google serves WOFF2 only to clients that announce support for it.
      const response = await source.fetch(`${source.cssUrl}?family=${name}${axes}&display=swap`, { signal: signal ?? null, headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } })
      if (response.status === 400) continue
      if (!response.ok) throw new CopyOSDesignFontError(`Google Fonts could not be reached (${String(response.status)})`)
      return parseGoogleFontsCss(await response.text()).map(face => ({ ...face, family }))
    }
    return []
  }

  private async writeFile(root: string, bytes: Uint8Array, extension: FontExtension): Promise<string> {
    const file = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
    const directory = join(root, DESIGN_FONT_DIRECTORY)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${file}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, join(directory, file))
    } finally { await rm(temporary, { force: true }) }
    return file
  }

  private async upsert(root: string, added: readonly CopyOSDesignFontFace[]): Promise<void> {
    const key = (face: CopyOSDesignFontFace) => `${face.family.toLowerCase()}|${face.style}|${String(face.weightMin)}|${String(face.weightMax)}`
    const replaced = new Set(added.map(key))
    const faces = [...(await this.list(root)).filter(face => !replaced.has(key(face))), ...added]
    if (faces.length > MAX_FACES) throw new CopyOSDesignFontError(`A project holds at most ${String(MAX_FACES)} font faces`)
    const directory = join(root, DESIGN_FONT_DIRECTORY), temporary = join(directory, `.${MANIFEST}.${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, faces }, null, 2)}\n`, { flag: 'wx' })
      await rename(temporary, join(directory, MANIFEST))
    } finally { await rm(temporary, { force: true }) }
  }
}

/** Most project faces loaded for one server-side measurement or render. */
const MAX_LOADED_FACES = 24

/**
 * Load the project font files a design uses, as explicit faces for the server text engine: one entry per used weight and style
 * that an installed face covers.
 * @param root - Project root.
 * @param document - Design whose text layers, runs and text styles name the families, weights and styles.
 * @returns At most 24 faces; families without an installed face are left out.
 */
export async function loadDesignProjectFonts(root: string, document: CopyOSDesignDocument):
Promise<{ family: string; weight: number; style: 'normal' | 'italic'; data: Uint8Array }[]> {
  const first = (value: string): string => value.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase() ?? ''
  const used = new Set<string>()
  const use = (family: string, weight: number, style: string | undefined): void => {
    used.add(`${first(family)}|${String(weight)}|${style === 'italic' ? 'italic' : 'normal'}`)
  }
  for (const node of document.nodes) {
    if (node.kind !== 'text') continue
    use(node.fontFamily, node.fontWeight, node.fontStyle)
    for (const run of node.textRuns ?? [])
      use(run.style.fontFamily ?? node.fontFamily, run.style.fontWeight ?? node.fontWeight, run.style.fontStyle ?? node.fontStyle)
  }
  for (const style of document.textStyles ?? []) use(style.fontFamily, style.fontWeight, style.fontStyle)
  const faces = await new CopyOSDesignFontStore().list(root)
  const result: { family: string; weight: number; style: 'normal' | 'italic'; data: Uint8Array }[] = []
  const files = new Map<string, Uint8Array>()
  for (const key of used) {
    const [family = '', weightText = '400', style = 'normal'] = key.split('|')
    const weight = Number(weightText)
    const face = faces.find(item =>
      item.family.toLowerCase() === family && item.style === style && item.weightMin <= weight && weight <= item.weightMax)
    if (!face || result.length >= MAX_LOADED_FACES) continue
    let data = files.get(face.file)
    if (!data) { data = new Uint8Array(await readFile(join(root, DESIGN_FONT_DIRECTORY, face.file))); files.set(face.file, data) }
    result.push({ family: face.family, weight, style: face.style, data })
  }
  return result
}
