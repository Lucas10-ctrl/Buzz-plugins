/** Document-scoped attachment manifests retain immutable project files for history and restore. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import sharp from 'sharp'
import { CopyOSDesignImageStore, sniffDesignImage } from './design-image-store.ts'
import type { CopyOSDocAsset } from './types.ts'

// Protocol/resource bounds keep base64 transfers and document archives bounded.
const maximumFileBytes = 4_000_000
/** Durable attachment metadata; image references reuse the project image store. */
export const docAssetSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u), name: z.string().min(1).max(200),
  size: z.number().int().nonnegative().max(maximumFileBytes), mime: z.string().max(100), image: z.boolean(),
  imageRef: z.string().regex(/^copyos-asset:[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/u).optional(),
}).strict().refine(asset => asset.image === Boolean(asset.imageRef), { message: 'Attachment storage does not match its type.' })
/** Validated private manifest entry. */
export type DocAssetRecord = z.infer<typeof docAssetSchema>
const images = new CopyOSDesignImageStore()
/** Referenced attachment hashes in stored document text.
 * @param text - Markdown or embedded schema HTML.
 * @returns Unique content hashes named by that text.
 */
export function docAssetReferences(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(/copyos-doc-asset:([a-f0-9]{64})(?![a-f0-9])/gu), match => match[1] ?? ''))
}
/** Project only public file metadata; physical project paths never enter the document response.
 * @param asset - Validated manifest entry.
 * @returns Public attachment metadata.
 */
export function projectDocAsset(asset: DocAssetRecord): CopyOSDocAsset {
  return { id: asset.id, name: asset.name, size: asset.size, mime: asset.mime, image: asset.image }
}
/** Save bounded attachment bytes, deriving raster types from their contents.
 * @param root - Registered project root.
 * @param input - Original filename and base64 payload.
 * @returns Immutable metadata; the caller commits it to an authorized document manifest.
 */
export async function storeDocAsset(root: string, input: { name: string; dataBase64: string }): Promise<DocAssetRecord> {
  const name = z.string().min(1).max(200).parse(input.name).replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
  const encoded = z.string().max(Math.ceil(maximumFileBytes / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u).parse(input.dataBase64)
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > maximumFileBytes) throw new Error('Files must be 4 MB or smaller.')
  const id = createHash('sha256').update(bytes).digest('hex'), raster = sniffDesignImage(bytes)
  if (raster) {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
    if (!metadata.width || !metadata.height) throw new Error('The image could not be read.')
    const imageRef = await images.put(root, bytes)
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[raster]
    return { id, name, size: bytes.length, mime, image: true, imageRef }
  }
  const directory = join(root, 'docs', 'files'), target = join(directory, id), temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, target) }
  finally { await rm(temporary, { force: true }) }
  return { id, name, size: bytes.length, mime: 'application/octet-stream', image: false }
}
/** Read and verify one file from its document manifest.
 * @param root - Registered project root.
 * @param asset - Validated manifest metadata.
 * @returns Original bytes, checked against the content hash.
 */
export async function readDocAsset(root: string, asset: DocAssetRecord): Promise<Buffer> {
  let bytes: Buffer
  try {
    bytes = asset.image && asset.imageRef ? (await images.read(root, asset.imageRef)).bytes
      : await readFile(join(root, 'docs', 'files', asset.id))
  } catch (error) {
    throw new Error('The attachment is missing or damaged.', { cause: error })
  }
  if (createHash('sha256').update(bytes).digest('hex') !== asset.id) throw new Error('The attachment is missing or damaged.')
  return bytes
}
