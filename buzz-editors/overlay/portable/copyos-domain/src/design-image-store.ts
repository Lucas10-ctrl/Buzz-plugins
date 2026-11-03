/**
 * Content-addressed project image files referenced by designs. Files are written once and never modified;
 * unused files stay until the user confirms a cleanup, because undo history, revisions and other designs may still name them.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DESIGN_IMAGE_ASSET_DIRECTORY,
  DESIGN_IMAGE_ASSET_MAX_BYTES,
  DESIGN_IMAGE_ASSET_MIME_TYPES,
  DESIGN_IMAGE_ASSET_PREFIX,
  type DesignImageAssetExtension,
  designImageAssetFiles,
  designImageAssetReference,
  designImageUrls,
  isDesignImageData,
  parseDesignImageAssetReference,
  resolveDesignImageUrls,
} from './design-image-assets.ts'
import { CopyOSDesignError } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignImageFile } from './types.ts'

/** Expected image storage failures: unsupported bytes, oversize files, missing or corrupted references; reported like design errors. */
export class CopyOSDesignImageError extends CopyOSDesignError {}

/** Detect the stored extension from file signatures.
 * @param bytes - Raster bytes.
 * @returns The extension for PNG, JPEG, WebP or GIF bytes, otherwise `undefined`.
 */
export function sniffDesignImage(bytes: Uint8Array): DesignImageAssetExtension | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8') return 'gif'
  return undefined
}

const storedFileName = /^[0-9a-f]{64}\.(?:png|jpg|webp|gif)$/
const storedFileNames = /[0-9a-f]{64}\.(?:png|jpg|webp|gif)/g
// The longest stored name has 69 characters; carrying 68 into the next read chunk finds names split between chunks.
const NAME_SCAN_OVERLAP = 68
// Folders a project never stores image references in: version control and installed packages.
const UNSCANNED_FOLDERS = new Set(['.git', 'node_modules'])

/** What an unused-image scan must treat as used besides the project's files. */
export interface CopyOSDesignImageUnusedOptions {
  /** Image field values or file names held outside the project, such as an open editor's Undo history; other values are ignored. */
  keep: readonly string[]
  /** Files modified less than this many milliseconds before `now` are kept, covering images stored but not yet saved into a design. */
  minimumAgeMs: number
  /** Scan time in epoch milliseconds. */
  now: number
}

async function scanFileForNames(path: string, names: Set<string>): Promise<void> {
  let tail = ''
  for await (const chunk of createReadStream(path, { encoding: 'latin1', highWaterMark: 1 << 20 })) {
    const text = tail + (chunk as string)
    for (const match of text.matchAll(storedFileNames)) names.add(match[0])
    tail = text.slice(-NAME_SCAN_OVERLAP)
  }
}

function keptFileNames(keep: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const value of keep) {
    const fileName = parseDesignImageAssetReference(value)?.fileName ?? value
    if (storedFileName.test(fileName)) names.add(fileName)
  }
  return names
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Project image files under `assets/images/`. */
export class CopyOSDesignImageStore {
  /** Store bytes once and return their reference.
   * @param root - Project root.
   * @param bytes - PNG, JPEG, WebP or GIF bytes; the type comes from the bytes, not from a caller label.
   * @returns The `copyos-asset:` reference; storing identical bytes again returns the same reference and only refreshes the file's
   *   modification time.
   * @throws {CopyOSDesignImageError} For unsupported or oversized bytes.
   */
  async put(root: string, bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > DESIGN_IMAGE_ASSET_MAX_BYTES)
      throw new CopyOSDesignImageError(`Image exceeds the ${DESIGN_IMAGE_ASSET_MAX_BYTES}-byte limit`)
    const extension = sniffDesignImage(bytes)
    if (!extension) throw new CopyOSDesignImageError('Image is not a PNG, JPEG, WebP or GIF file')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const reference = designImageAssetReference(sha256, extension)
    const directory = join(root, DESIGN_IMAGE_ASSET_DIRECTORY), path = join(directory, `${sha256}.${extension}`)
    try {
      if ((await stat(path)).size === bytes.byteLength) {
        // A fresh time protects the file from a cleanup that runs before the design naming it is saved.
        const now = new Date()
        await utimes(path, now, now)
        return reference
      }
    } catch (error: unknown) { if (!missing(error)) throw error }
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${sha256}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally { await rm(temporary, { force: true }) }
    return reference
  }

  /** Read and verify one referenced file.
   * @param root - Project root.
   * @param reference - `copyos-asset:` reference.
   * @returns File bytes and their MIME type.
   * @throws {CopyOSDesignImageError} When the reference is malformed, the file is missing, or its bytes no longer match the hash.
   */
  async read(root: string, reference: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const parsed = parseDesignImageAssetReference(reference)
    if (!parsed) throw new CopyOSDesignImageError('Invalid project image reference')
    let bytes: Buffer
    try { bytes = await readFile(join(root, DESIGN_IMAGE_ASSET_DIRECTORY, parsed.fileName)) }
    catch (error: unknown) {
      if (missing(error)) throw new CopyOSDesignImageError(`Project image ${parsed.fileName} is missing`)
      throw error
    }
    if (createHash('sha256').update(bytes).digest('hex') !== parsed.sha256)
      throw new CopyOSDesignImageError(`Project image ${parsed.fileName} does not match its reference`)
    return { bytes, mimeType: DESIGN_IMAGE_ASSET_MIME_TYPES[parsed.extension] }
  }

  /** Require every project image that markup names to exist in the project.
   * @param root - Project root.
   * @param html - Markup holding references or `assets/images/` paths.
   * @throws {CopyOSDesignImageError} When a named file is missing.
   */
  async requireHtmlImages(root: string, html: string): Promise<void> {
    for (const fileName of designImageAssetFiles(html)) {
      try { await stat(join(root, DESIGN_IMAGE_ASSET_DIRECTORY, fileName)) }
      catch (error: unknown) {
        if (missing(error)) throw new CopyOSDesignImageError(`Project image ${fileName} is missing`)
        throw error
      }
    }
  }

  /** Read a stored file named by its file name inside `assets/images/`.
   * @param root - Project root.
   * @param fileName - `<sha256>.<ext>`.
   * @returns Verified bytes and MIME type.
   * @throws {CopyOSDesignImageError} When the file is missing or corrupted.
   */
  async readFile(root: string, fileName: string): Promise<{ bytes: Buffer; mimeType: string }> {
    return this.read(root, `${DESIGN_IMAGE_ASSET_PREFIX}${fileName}`)
  }

  /** Replace embedded raster images with stored references.
   * @param root - Project root.
   * @param document - Validated design.
   * @returns The same document when it holds no storable embedded images, otherwise a copy holding references; embedded data whose
   *   bytes are not a PNG, JPEG, WebP or GIF file stays embedded.
   */
  async storeDocumentImages(root: string, document: CopyOSDesignDocument): Promise<CopyOSDesignDocument> {
    return resolveDesignImageUrls(document, async (url) => {
      const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
      // The schema accepts any base64 under a raster label; bytes the store cannot verify stay embedded so the design still saves.
      if (bytes.byteLength > DESIGN_IMAGE_ASSET_MAX_BYTES || !sniffDesignImage(bytes)) return url
      return this.put(root, bytes)
    }, isDesignImageData)
  }

  /** Replace references with embedded `data:` images, for consumers that need self-contained markup.
   * @param root - Project root.
   * @param document - Design that may hold references.
   * @returns The same document when it holds no references, otherwise a self-contained copy.
   * @throws {CopyOSDesignImageError} When a referenced file is missing or corrupted.
   */
  async embedDocumentImages(root: string, document: CopyOSDesignDocument): Promise<CopyOSDesignDocument> {
    return resolveDesignImageUrls(document, async (url) => {
      const { bytes, mimeType } = await this.read(root, url)
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    }, url => parseDesignImageAssetReference(url) !== undefined)
  }

  /** Copy the files a design references from one project into another; files already present are not rewritten.
   * @param sourceRoot - Project holding the files.
   * @param targetRoot - Project receiving them.
   * @param document - Design whose references must resolve in the target.
   * @throws {CopyOSDesignImageError} When a file missing from the target is missing or corrupted in the source.
   */
  async copyDocumentImages(sourceRoot: string, targetRoot: string, document: CopyOSDesignDocument): Promise<void> {
    await this.copyImages(sourceRoot, targetRoot, designImageUrls(document))
  }

  /** Copy referenced files from one project into another; files already present are not rewritten.
   * @param sourceRoot - Project holding the files.
   * @param targetRoot - Project receiving them.
   * @param urls - Image field values; values that are not references are ignored.
   * @throws {CopyOSDesignImageError} When a file missing from the target is missing or corrupted in the source.
   */
  async copyImages(sourceRoot: string, targetRoot: string, urls: readonly string[]): Promise<void> {
    if (sourceRoot === targetRoot) return
    for (const url of urls) {
      const parsed = parseDesignImageAssetReference(url)
      if (!parsed) continue
      try { await stat(join(targetRoot, DESIGN_IMAGE_ASSET_DIRECTORY, parsed.fileName)); continue }
      catch (error: unknown) { if (!missing(error)) throw error }
      await this.put(targetRoot, (await this.read(sourceRoot, url)).bytes)
    }
  }

  /** Collect every stored file name that any project file mentions, as a reference, an `assets/images/` path or a bare name.
   * @param root - Project root.
   * @returns File names found outside `assets/images/`, `.git` and `node_modules`; symbolic links are not followed.
   */
  async referencedImageFiles(root: string): Promise<Set<string>> {
    const names = new Set<string>(), imageFolder = join(root, DESIGN_IMAGE_ASSET_DIRECTORY)
    const visit = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) { if (!UNSCANNED_FOLDERS.has(entry.name) && path !== imageFolder) await visit(path) }
        else if (entry.isFile()) await scanFileForNames(path, names)
      }
    }
    await visit(root)
    return names
  }

  /** List stored files that nothing uses.
   * @param root - Project root.
   * @param options - Outside references and the minimum file age.
   * @returns Unused files sorted by name; a project without `assets/images/` has none.
   */
  async findUnusedImages(root: string, options: CopyOSDesignImageUnusedOptions): Promise<CopyOSDesignImageFile[]> {
    const folder = join(root, DESIGN_IMAGE_ASSET_DIRECTORY)
    let entries: string[]
    try { entries = (await readdir(folder)).filter(name => storedFileName.test(name)).sort() }
    catch (error: unknown) { if (missing(error)) return []; throw error }
    const used = await this.referencedImageFiles(root), kept = keptFileNames(options.keep), unused: CopyOSDesignImageFile[] = []
    for (const fileName of entries) {
      if (used.has(fileName) || kept.has(fileName)) continue
      let info
      try { info = await stat(join(folder, fileName)) }
      catch (error: unknown) { if (missing(error)) continue; throw error }
      if (info.isFile() && options.now - info.mtimeMs >= options.minimumAgeMs) unused.push({ fileName, bytes: info.size })
    }
    return unused
  }

  /** Delete the listed files that are still unused when this call scans the project again.
   * @param root - Project root.
   * @param fileNames - Files the user confirmed, normally from {@link findUnusedImages}.
   * @param options - Outside references and the minimum file age.
   * @returns The files deleted; listed files that became used, are too new or are already gone are skipped.
   */
  async removeUnusedImages(root: string, fileNames: readonly string[],
    options: CopyOSDesignImageUnusedOptions): Promise<CopyOSDesignImageFile[]> {
    const confirmed = new Set(fileNames), removed: CopyOSDesignImageFile[] = []
    for (const file of await this.findUnusedImages(root, options)) {
      if (!confirmed.has(file.fileName)) continue
      await rm(join(root, DESIGN_IMAGE_ASSET_DIRECTORY, file.fileName), { force: true })
      removed.push(file)
    }
    return removed
  }
}
