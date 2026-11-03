/** Portable ad-script repository with channel constraints and complete variations. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { CopyOSAssetNotFoundError, CopyOSAssetRepository } from './assets.ts'
import {
  COPYOS_SCRIPT_VERSION,
  type CopyOSAssetDocument,
  type CopyOSScriptCreateRequest,
  type CopyOSScriptDocument,
  type CopyOSScriptVariantCreateRequest,
} from './types.ts'

const channelSchema = z.enum(['meta', 'tiktok', 'youtube', 'linkedin', 'other'])
const aspectRatioSchema = z.enum(['9:16', '1:1', '16:9', 'other'])
const content = z.string().trim().min(1).max(100_000)

const variantSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  angle: content,
  hook: content,
  beats: content,
  visualDirection: content,
  spokenCopy: content,
  onScreenText: z.string().trim().max(100_000),
  proof: z.string().trim().max(100_000),
  cta: content,
  createdAt: z.iso.datetime(),
}).strict()

const scriptSchema = z.object({
  schema: z.literal('copyos.script'),
  version: z.literal(COPYOS_SCRIPT_VERSION),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  status: z.literal('draft'),
  channel: channelSchema,
  durationSeconds: z.number().int().min(1).max(3_600),
  aspectRatio: aspectRatioSchema,
  briefId: z.uuid().optional(),
  selectedVariantId: z.uuid(),
  variants: z.array(variantSchema).min(1).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (!value.variants.some(variant => variant.id === value.selectedVariantId)) {
    context.addIssue({ code: 'custom', path: ['selectedVariantId'], message: 'must identify an existing variant' })
  }
})

/** An ad-script file or submitted field is invalid. */
export class CopyOSScriptFormatError extends Error {
  override readonly name = 'CopyOSScriptFormatError'
}

/** A requested ad script was not found. */
export class CopyOSScriptNotFoundError extends Error {
  override readonly name = 'CopyOSScriptNotFoundError'
}

type ScriptCreate = Omit<CopyOSScriptCreateRequest, 'workspaceId'>
type VariantCreate = Omit<CopyOSScriptVariantCreateRequest, 'workspaceId'>

/** JSON-first ad-script storage with atomic updates and file-level revisions. */
export class CopyOSScriptRepository {
  /**
   * List ad scripts in newest-update order.
   * @param projectPath - Canonical CopyOS project root.
   * @returns validated ad-script documents.
   */
  async list(projectPath: string): Promise<readonly CopyOSScriptDocument[]> {
    const directory = join(projectPath, 'scripts')
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    const scripts = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.script.json'))
      .map(async entry => await this.read(join(directory, entry.name))))
    return scripts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one ad script by stable id.
   * @param projectPath - Canonical CopyOS project root.
   * @param scriptId - Stable ad-script identity.
   * @returns the validated complete script.
   */
  async get(projectPath: string, scriptId: string): Promise<CopyOSScriptDocument> {
    const located = await this.find(projectPath, scriptId)
    if (located === undefined) throw new CopyOSScriptNotFoundError(`ad script '${scriptId}' was not found`)
    return located.document
  }

  /**
   * Create an ad script with its first complete variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Channel constraints, optional brief, and script fields.
   * @returns the persisted ad script.
   */
  async create(projectPath: string, request: ScriptCreate): Promise<CopyOSScriptDocument> {
    if (request.briefId !== undefined) {
      let brief: CopyOSAssetDocument
      try {
        brief = await new CopyOSAssetRepository().get(projectPath, request.briefId)
      } catch (error: unknown) {
        if (error instanceof CopyOSAssetNotFoundError) {
          throw new CopyOSScriptFormatError(`brief '${request.briefId}' was not found`)
        }
        throw error
      }
      if (brief.kind !== 'brief') throw new CopyOSScriptFormatError(`asset '${request.briefId}' is not a brief`)
    }
    const now = new Date().toISOString()
    const variant = this.variant(request, now)
    const script = this.parse({
      schema: 'copyos.script',
      version: COPYOS_SCRIPT_VERSION,
      id: randomUUID(),
      title: request.title,
      status: 'draft',
      channel: request.channel,
      durationSeconds: request.durationSeconds,
      aspectRatio: request.aspectRatio,
      ...request.briefId === undefined ? {} : { briefId: request.briefId },
      selectedVariantId: variant.id,
      variants: [variant],
      createdAt: now,
      updatedAt: now,
    })
    const directory = join(projectPath, 'scripts')
    await mkdir(directory, { recursive: true })
    await this.writeAtomic(join(directory, fileName(script)), script, 'wx')
    return script
  }

  /**
   * Append and select another complete strategic variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Script identity and complete alternative fields.
   * @returns the complete updated script.
   */
  async addVariant(projectPath: string, request: VariantCreate): Promise<CopyOSScriptDocument> {
    const located = await this.find(projectPath, request.scriptId)
    if (located === undefined) throw new CopyOSScriptNotFoundError(`ad script '${request.scriptId}' was not found`)
    const now = new Date().toISOString()
    const variant = this.variant(request, now)
    const updated = this.parse({
      ...located.document,
      selectedVariantId: variant.id,
      variants: [...located.document.variants, variant],
      updatedAt: now,
    })
    await this.snapshot(projectPath, located.path, request.scriptId)
    await this.writeAtomic(located.path, updated)
    return updated
  }

  private variant(request: Omit<ScriptCreate, 'title' | 'channel' | 'durationSeconds' | 'aspectRatio' | 'briefId'> | VariantCreate, now: string) {
    return variantSchema.parse({
      id: randomUUID(), label: request.label, angle: request.angle, hook: request.hook,
      beats: request.beats, visualDirection: request.visualDirection, spokenCopy: request.spokenCopy,
      onScreenText: request.onScreenText, proof: request.proof, cta: request.cta, createdAt: now,
    })
  }

  private async find(projectPath: string, scriptId: string): Promise<{
    readonly path: string
    readonly document: CopyOSScriptDocument
  } | undefined> {
    const document = (await this.list(projectPath)).find(script => script.id === scriptId)
    return document === undefined ? undefined : { path: join(projectPath, 'scripts', fileName(document)), document }
  }

  private async read(path: string): Promise<CopyOSScriptDocument> {
    try {
      return this.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error: unknown) {
      if (error instanceof CopyOSScriptFormatError) throw error
      throw new CopyOSScriptFormatError(`invalid CopyOS ad script at '${path}': ${errorMessage(error)}`)
    }
  }

  private parse(value: unknown): CopyOSScriptDocument {
    try {
      return scriptSchema.parse(value)
    } catch (error: unknown) {
      throw new CopyOSScriptFormatError(errorMessage(error))
    }
  }

  private async writeAtomic(destination: string, script: CopyOSScriptDocument, flag: 'w' | 'wx' = 'w'): Promise<void> {
    const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(script, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      if (flag === 'wx') {
        await copyFile(temporary, destination, constants.COPYFILE_EXCL)
        await unlink(temporary)
      } else {
        await rename(temporary, destination)
      }
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async snapshot(projectPath: string, source: string, scriptId: string): Promise<void> {
    const directory = join(projectPath, '.copywriter', 'revisions', scriptId)
    await mkdir(directory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    await copyFile(source, join(directory, `${stamp}-${randomUUID()}.script.json`), constants.COPYFILE_EXCL)
  }
}

function fileName(script: Pick<CopyOSScriptDocument, 'id' | 'title'>): string {
  const slug = script.title.toLowerCase().normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 64) || 'script'
  return `${slug}-${script.id}.script.json`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
