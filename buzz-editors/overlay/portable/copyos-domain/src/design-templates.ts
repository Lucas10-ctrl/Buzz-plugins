/**
 * Canvas template library shared by every workspace: `<library>/<id>.json` holds one top-level artboard captured as a design
 * clipboard snapshot with its images embedded, and the optional `<library>/<id>.png` holds its preview. The JSON file is written
 * last and removed first, so it alone marks a template as present.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { captureDesignClipboard, parseDesignClipboardSnapshot } from './design-clipboard.ts'
import { CopyOSDesignImageError, CopyOSDesignImageStore } from './design-image-store.ts'
import { parseDesignImageAssetReference, resolveDesignImageUrls } from './design-image-assets.ts'
import { CopyOSDesignError } from './design-schema.ts'
import { loadDesignProjectFonts } from './design-font-store.ts'
import type { CopyOSDesignDocument, CopyOSDesignTemplateRead, CopyOSDesignTemplateSummary } from './types.ts'

/** Most templates the shared library keeps. */
export const DESIGN_TEMPLATE_LIMIT = 500
/** Largest serialized template snapshot, in UTF-8 bytes. */
export const DESIGN_TEMPLATE_SNAPSHOT_MAX_BYTES = 20_000_000
const THUMBNAIL_MAX_WIDTH = 480
const THUMBNAIL_MAX_HEIGHT = 960

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000),
}).strict()
const fileSchema = fieldsSchema.extend({
  schema: z.literal('copyos.design-template'), version: z.literal(1), id: z.uuid(),
  width: z.number().positive(), height: z.number().positive(),
  sourceWorkspaceName: z.string().max(200), sourceDesignTitle: z.string().max(200),
  createdAt: z.iso.datetime(), snapshot: z.unknown(),
}).strict()
type TemplateFile = z.infer<typeof fileSchema>

/**
 * Locate the shared template library, beside the shared section library and overridable for isolated profiles.
 * @returns Absolute library directory: `$COPYOS_DESIGN_TEMPLATES_DIR`, otherwise `copyos/design-templates` in the user data directory.
 */
export function copyosDesignTemplateLibraryRoot(): string {
  const data = process.platform === 'win32' ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return resolve(process.env.COPYOS_DESIGN_TEMPLATES_DIR ?? join(data, 'copyos', 'design-templates'))
}

/** Saved design, artboard and naming fields of one template save. */
export interface DesignTemplateSaveInput {
  /** Source project root; its images are embedded and its fonts draw the preview. */
  root: string
  sourceWorkspaceId: string
  sourceWorkspaceName: string
  /** Saved design revision holding the artboard. */
  document: CopyOSDesignDocument
  /** Visible top-level frame to save. */
  nodeId: string
  title: string
  category: string
  description: string
}

function invalid(error: z.ZodError, field: string): CopyOSDesignError {
  return new CopyOSDesignError(`Invalid ${field}: ${error.issues.map(issue => issue.message).join('; ')}`)
}

/** Shared template storage; each template is an independent pair of files. */
export class CopyOSDesignTemplateRepository {
  private readonly images = new CopyOSDesignImageStore()
  private readonly cache = new Map<string, { mtimeMs: number; size: number; file: TemplateFile }>()

  /** @param libraryRoot - Library directory shared by every workspace and chat. */
  constructor(private readonly libraryRoot = copyosDesignTemplateLibraryRoot()) {}

  /**
   * Read every template's summary.
   * @returns Summaries newest first, with previews as PNG `data:` URLs; an absent library is empty.
   * @throws {CopyOSDesignError} If a template file is malformed.
   */
  async list(): Promise<CopyOSDesignTemplateSummary[]> {
    let names: string[]
    try { names = await readdir(this.libraryRoot) } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const ids = names.flatMap(name => /^([0-9a-f-]{36})\.json$/.exec(name)?.[1] ?? [])
    const files = await Promise.all(ids.map(async id => await this.file(id)))
    const summaries = await Promise.all(files.flatMap(file => file ? [this.summary(file)] : []))
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  /**
   * Read one template and its validated snapshot.
   * @param templateId - Template identity.
   * @returns Summary and snapshot.
   * @throws {CopyOSDesignError} If the template is missing or malformed.
   */
  async read(templateId: string): Promise<CopyOSDesignTemplateRead> {
    const file = await this.file(this.identity(templateId))
    if (!file) throw new CopyOSDesignError(`Template '${templateId}' was not found`)
    return { template: await this.summary(file), snapshot: parseDesignClipboardSnapshot(file.snapshot) }
  }

  /**
   * Save one artboard as a template. A preview that cannot be drawn is left out instead of failing the save.
   * @param input - Source project, saved design, artboard and naming fields.
   * @returns The stored template's summary.
   * @throws {CopyOSDesignError} If a field is invalid, the node is not a visible top-level frame, the snapshot exceeds 20 MB
   * or the library holds 500 templates.
   */
  async save(input: DesignTemplateSaveInput): Promise<CopyOSDesignTemplateSummary> {
    const fields = fieldsSchema.safeParse({ title: input.title, category: input.category, description: input.description })
    if (!fields.success) throw invalid(fields.error, 'template fields')
    const artboard = input.document.nodes.find(node => node.id === input.nodeId)
    if (!artboard || artboard.parentId !== null || artboard.kind !== 'frame' || !artboard.visible)
      throw new CopyOSDesignError('A template must be a visible top-level frame')
    if (artboard.pageLink) throw new CopyOSDesignError('A linked page screen cannot be saved as a template')
    const embedded = await resolveDesignImageUrls(input.document, async (url) => {
      try {
        const { bytes, mimeType } = await this.images.read(input.root, url)
        return `data:${mimeType};base64,${bytes.toString('base64')}`
      } catch (error: unknown) {
        // A missing or corrupted project image stays a reference; the copy renders it empty, as the source Canvas does.
        if (error instanceof CopyOSDesignImageError) return url
        throw error
      }
    }, url => parseDesignImageAssetReference(url) !== undefined)
    const snapshot = captureDesignClipboard(embedded, [artboard.id], { sourceWorkspaceId: input.sourceWorkspaceId }, randomUUID)
    const id = randomUUID()
    const file: TemplateFile = {
      schema: 'copyos.design-template', version: 1, id, ...fields.data,
      width: artboard.width, height: artboard.height,
      sourceWorkspaceName: input.sourceWorkspaceName.slice(0, 200), sourceDesignTitle: input.document.title.slice(0, 200),
      createdAt: new Date().toISOString(), snapshot,
    }
    const text = `${JSON.stringify(file)}\n`
    if (Buffer.byteLength(text, 'utf8') > DESIGN_TEMPLATE_SNAPSHOT_MAX_BYTES)
      throw new CopyOSDesignError(`A template must be at most ${DESIGN_TEMPLATE_SNAPSHOT_MAX_BYTES} bytes, including its images`)
    const png = await this.thumbnail(input.root, input.document, artboard.id)
    await mkdir(this.libraryRoot, { recursive: true, mode: 0o700 })
    await withFileLock(join(this.libraryRoot, 'library'), async () => {
      const count = (await readdir(this.libraryRoot)).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).length
      if (count >= DESIGN_TEMPLATE_LIMIT) throw new CopyOSDesignError(`The template library keeps at most ${DESIGN_TEMPLATE_LIMIT} templates`)
      if (png) {
        const temporary = join(this.libraryRoot, `.${id}.${randomUUID()}.png.tmp`)
        await writeFile(temporary, png, { mode: 0o600 })
        await rename(temporary, join(this.libraryRoot, `${id}.png`))
      }
      await writeFileAtomic(join(this.libraryRoot, `${id}.json`), text, { mode: 0o600 })
    })
    return await this.summary(file)
  }

  /**
   * Delete one template and its preview.
   * @param templateId - Template identity.
   * @throws {CopyOSDesignError} If the template is missing.
   */
  async delete(templateId: string): Promise<void> {
    const id = this.identity(templateId)
    try { await unlink(join(this.libraryRoot, `${id}.json`)) } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new CopyOSDesignError(`Template '${id}' was not found`)
      throw error
    }
    this.cache.delete(id)
    try { await unlink(join(this.libraryRoot, `${id}.png`)) } catch (error: unknown) {
      // A template saved without a preview has no PNG file.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  private identity(templateId: string): string {
    const id = z.uuid().safeParse(templateId)
    if (!id.success) throw new CopyOSDesignError('Invalid template identity')
    return id.data
  }

  private async file(id: string): Promise<TemplateFile | undefined> {
    const path = join(this.libraryRoot, `${id}.json`)
    let info: Awaited<ReturnType<typeof stat>>
    try { info = await stat(path) } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    const cached = this.cache.get(id)
    if (cached?.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.file
    if (info.size > DESIGN_TEMPLATE_SNAPSHOT_MAX_BYTES) throw new CopyOSDesignError(`Template '${id}' exceeds the size limit`)
    let json: unknown
    try { json = JSON.parse(await readFile(path, 'utf8')) } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw new CopyOSDesignError(`Template '${id}' is not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = fileSchema.safeParse(json)
    if (!parsed.success) throw invalid(parsed.error, `template '${id}'`)
    if (parsed.data.id !== id) throw new CopyOSDesignError(`Template id does not match ${id}.json`)
    this.cache.set(id, { mtimeMs: info.mtimeMs, size: info.size, file: parsed.data })
    return parsed.data
  }

  private async summary(file: TemplateFile): Promise<CopyOSDesignTemplateSummary> {
    let thumbnail: string | null = null
    try { thumbnail = `data:image/png;base64,${(await readFile(join(this.libraryRoot, `${file.id}.png`))).toString('base64')}` }
    catch (error: unknown) {
      // A template saved without a preview has no PNG file.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    return { id: file.id, title: file.title, category: file.category, description: file.description, width: file.width,
      height: file.height, sourceWorkspaceName: file.sourceWorkspaceName, sourceDesignTitle: file.sourceDesignTitle,
      createdAt: file.createdAt, thumbnail }
  }

  private async thumbnail(root: string, document: CopyOSDesignDocument, artboardId: string): Promise<Uint8Array | undefined> {
    try {
      // The renderer and text engine load on first save, not when the project service starts.
      const [{ createDesignRasterizer }, { loadBundledDesignMeasurementFonts }] = await Promise.all([
        import('./design-raster.ts'), import('./design-text-measurement.ts')])
      const fonts = [...await loadBundledDesignMeasurementFonts(), ...await loadDesignProjectFonts(root, document)]
      const rasterizer = await createDesignRasterizer(fonts)
      try {
        const artboard = document.nodes.find(node => node.id === artboardId)
        const tall = artboard !== undefined && artboard.height * THUMBNAIL_MAX_WIDTH / artboard.width > THUMBNAIL_MAX_HEIGHT
        const result = await rasterizer.render(document, {
          artboardId, maxWidth: THUMBNAIL_MAX_WIDTH, maxHeight: THUMBNAIL_MAX_HEIGHT,
          // Tall artboards show their top region at full preview width instead of a narrow strip.
          ...(tall ? { region: { top: 0, height: artboard.width * THUMBNAIL_MAX_HEIGHT / THUMBNAIL_MAX_WIDTH } } : {}),
          readImage: async fileName => (await this.images.read(root, `copyos-asset:${fileName}`)).bytes,
        })
        return result.png
      } finally { rasterizer.dispose() }
    } catch (error: unknown) {
      // The preview is optional: a template whose artboard the host renderer cannot draw is stored without one.
      if (error instanceof Error) return undefined
      throw error
    }
  }
}
