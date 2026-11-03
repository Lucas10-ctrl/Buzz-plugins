/**
 * Design image references name raster files stored once per project at `assets/images/<sha256>.<ext>`.
 * The same `imageUrl` and paint `image.url` fields hold either an embedded `data:` image, an HTTPS URL or a
 * `copyos-asset:<sha256>.<ext>` reference. Text image paints stay embedded because they render inside SVG data images.
 */
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignPaint } from './types.ts'

/** Scheme of a project image reference stored in a design image field. */
export const DESIGN_IMAGE_ASSET_PREFIX = 'copyos-asset:'
/** Project-relative folder holding referenced image files. */
export const DESIGN_IMAGE_ASSET_DIRECTORY = 'assets/images'
/** Largest stored image; matches the decoded size of the largest accepted embedded image. */
export const DESIGN_IMAGE_ASSET_MAX_BYTES = 5_999_000

/** Raster types a project image reference may name. */
export type DesignImageAssetExtension = 'png' | 'jpg' | 'webp' | 'gif'
/** Image MIME type for each stored file extension. */
export const DESIGN_IMAGE_ASSET_MIME_TYPES: Readonly<Record<DesignImageAssetExtension, string>> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}
const referencePattern = /^copyos-asset:([a-f0-9]{64})\.(png|jpg|webp|gif)$/
const dataPattern = /^data:image\/(png|jpeg|webp|gif);base64,/

/** Parsed project image reference. */
export interface DesignImageAssetReference {
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string
  extension: DesignImageAssetExtension
  /** File name inside {@link DESIGN_IMAGE_ASSET_DIRECTORY}. */
  fileName: string
}

/** Parse a stored image reference.
 * @param url - Design image field value.
 * @returns The hash and extension, or `undefined` when the value is not a well-formed reference.
 */
export function parseDesignImageAssetReference(url: string): DesignImageAssetReference | undefined {
  const match = referencePattern.exec(url)
  if (!match?.[1] || !match[2]) return undefined
  const extension = match[2] as DesignImageAssetExtension
  return { sha256: match[1], extension, fileName: `${match[1]}.${extension}` }
}

/** Build the reference for stored bytes.
 * @param sha256 - Lowercase hex SHA-256 of the bytes.
 * @param extension - Stored file extension.
 * @returns A `copyos-asset:` reference.
 */
export function designImageAssetReference(sha256: string, extension: DesignImageAssetExtension): string {
  return `${DESIGN_IMAGE_ASSET_PREFIX}${sha256}.${extension}`
}

/** File extension for an embedded image's MIME type.
 * @param url - Design image field value.
 * @returns The stored extension for a base64 raster `data:` URL, otherwise `undefined`.
 */
export function designImageDataExtension(url: string): DesignImageAssetExtension | undefined {
  const type = dataPattern.exec(url)?.[1]
  return type === undefined ? undefined : type === 'jpeg' ? 'jpg' : type as DesignImageAssetExtension
}

function mapPaints(paints: readonly CopyOSDesignPaint[] | undefined, map: (url: string) => string): CopyOSDesignPaint[] | undefined {
  if (!paints) return undefined
  const next = paints.map((paint) => {
    if (!paint.image) return paint
    const url = map(paint.image.url)
    return url === paint.image.url ? paint : { ...paint, image: { ...paint.image, url } }
  })
  return next.some((paint, index) => paint !== paints[index]) ? next : undefined
}

/** Replace image field values in every layer, keeping unchanged objects identical.
 * Visits `imageUrl`, `fills`, `strokes` and `instanceStroke.strokes`. Text layers are skipped: their image paints must stay embedded.
 * @param document - Design to rewrite.
 * @param map - Replacement for one image field value; returning the input leaves it unchanged.
 * @returns The same document when nothing changed, otherwise a copy with replaced values.
 */
export function mapDesignImageUrls(document: CopyOSDesignDocument, map: (url: string) => string): CopyOSDesignDocument {
  const nodes = document.nodes.map((node) => {
    if (node.kind === 'text') return node
    let next: CopyOSDesignNode = node
    const imageUrl = node.imageUrl ? map(node.imageUrl) : node.imageUrl
    if (imageUrl !== node.imageUrl) next = { ...next, imageUrl }
    const fills = mapPaints(node.fills, map), strokes = mapPaints(node.strokes, map)
    const instanceStrokes = mapPaints(node.instanceStroke?.strokes, map)
    if (fills) next = { ...next, fills }
    if (strokes) next = { ...next, strokes }
    if (instanceStrokes && node.instanceStroke) next = { ...next, instanceStroke: { ...node.instanceStroke, strokes: instanceStrokes } }
    return next
  })
  return nodes.some((node, index) => node !== document.nodes[index]) ? { ...document, nodes } : document
}

/** Collect the image field values {@link mapDesignImageUrls} visits.
 * @param document - Design to scan.
 * @returns Distinct non-empty values in first-use order.
 */
export function designImageUrls(document: CopyOSDesignDocument): string[] {
  const urls = new Set<string>()
  mapDesignImageUrls(document, (url) => { if (url) urls.add(url); return url })
  return [...urls]
}

/** Replace image values asynchronously, resolving each distinct value once.
 * @param document - Design to rewrite.
 * @param resolve - Replacement for one value; called once per distinct value accepted by `select`.
 * @param select - Values to replace.
 * @returns The same document when nothing changed, otherwise a rewritten copy.
 */
export async function resolveDesignImageUrls(document: CopyOSDesignDocument, resolve: (url: string) => Promise<string>,
  select: (url: string) => boolean): Promise<CopyOSDesignDocument> {
  const selected = designImageUrls(document).filter(select)
  if (!selected.length) return document
  const replacements = new Map<string, string>()
  for (const url of selected) replacements.set(url, await resolve(url))
  return mapDesignImageUrls(document, url => replacements.get(url) ?? url)
}

/** Whether a value is an embedded raster image that a project can store.
 * @param url - Design image field value.
 * @returns `true` for a base64 PNG, JPEG, WebP or GIF `data:` URL.
 */
export function isDesignImageData(url: string): boolean {
  return designImageDataExtension(url) !== undefined
}

/** Whether a value is a project image reference.
 * @param url - Design image field value.
 * @returns `true` for a well-formed `copyos-asset:` reference.
 */
export function isDesignImageAssetReference(url: string): boolean {
  return referencePattern.test(url)
}

const htmlReferencePattern = /copyos-asset:([a-f0-9]{64}\.(?:png|jpg|webp|gif))/g
// A stored-image path not preceded by a path or name character, so `x/assets/images/…` and `myassets/images/…` stay untouched.
const htmlPathPattern = /(?<![\w/.-])assets\/images\/([a-f0-9]{64}\.(?:png|jpg|webp|gif))/g

/** Replace project image references in compiled markup with project-relative paths.
 * @param html - Markup compiled from a design that may hold `copyos-asset:` references.
 * @returns Markup naming `assets/images/<sha256>.<ext>` instead.
 */
export function designImageAssetPaths(html: string): string {
  return html.replace(htmlReferencePattern, `${DESIGN_IMAGE_ASSET_DIRECTORY}/$1`)
}

/** File names of the project images markup names, as references or as `assets/images/` paths.
 * @param html - Page or compiled markup.
 * @returns Distinct file names inside {@link DESIGN_IMAGE_ASSET_DIRECTORY}.
 */
export function designImageAssetFiles(html: string): string[] {
  return [...new Set([...html.matchAll(htmlReferencePattern), ...html.matchAll(htmlPathPattern)].map(match => match[1] ?? ''))]
}

/** Rewrite every `assets/images/<sha256>.<ext>` path in page markup.
 * @param html - Page markup.
 * @param replace - New text for one file name.
 * @returns Markup with the paths replaced; other paths are unchanged.
 */
export function rewriteDesignImageAssetPaths(html: string, replace: (fileName: string) => string): string {
  return html.replace(htmlPathPattern, (_path, fileName: string) => replace(fileName))
}
