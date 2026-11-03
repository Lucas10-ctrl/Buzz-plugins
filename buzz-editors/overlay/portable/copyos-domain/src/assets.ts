/** Portable Markdown repository for CopyOS briefs and copy variations. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  COPYOS_ASSET_VERSION,
  type CopyOSAssetDocument,
  type CopyOSAssetKind,
  type CopyOSAssetListValue,
  type CopyOSInvalidAssetFile,
  type CopyOSBriefCreateRequest,
  type CopyOSBriefDocument,
  type CopyOSCopyCreateRequest,
  type CopyOSCopyDocument,
  type CopyOSCopyVariantCreateRequest,
} from './types.ts'

const FRONTMATTER_START = '---\n'
const FRONTMATTER_END = '\n---\n'

const assetBaseSchema = z.object({
  schema: z.literal('copyos.asset'),
  version: z.literal(COPYOS_ASSET_VERSION),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  status: z.literal('draft'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

const briefSchema = assetBaseSchema.extend({
  kind: z.literal('brief'),
  objective: z.string().trim().min(1).max(10_000),
  audience: z.string().trim().min(1).max(10_000),
  offer: z.string().trim().min(1).max(10_000),
  proof: z.string().trim().max(10_000),
  cta: z.string().trim().min(1).max(2_000),
}).strict()

const copyVariantSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
  createdAt: z.iso.datetime(),
}).strict()

const copySchema = assetBaseSchema.extend({
  kind: z.literal('copy'),
  briefId: z.uuid().optional(),
  selectedVariantId: z.uuid(),
  variants: z.array(copyVariantSchema).min(1),
}).strict().superRefine((value, context) => {
  if (!value.variants.some(variant => variant.id === value.selectedVariantId)) {
    context.addIssue({ code: 'custom', path: ['selectedVariantId'], message: 'must identify an existing variant' })
  }
})

const assetSchema = z.discriminatedUnion('kind', [briefSchema, copySchema])

/** A portable asset file is malformed or contains invalid user input. */
export class CopyOSAssetFormatError extends Error {
  override readonly name = 'CopyOSAssetFormatError'
}

/** An asset id does not exist in the requested project. */
export class CopyOSAssetNotFoundError extends Error {
  override readonly name = 'CopyOSAssetNotFoundError'
}

/** Host-owned brief fields after the transport-specific Workspace id is resolved. */
export type CopyOSBriefRepositoryCreateRequest = Omit<CopyOSBriefCreateRequest, 'workspaceId'>

/** Host-owned copy fields after the transport-specific Workspace id is resolved. */
export type CopyOSCopyRepositoryCreateRequest = Omit<CopyOSCopyCreateRequest, 'workspaceId'>

/** Host-owned variation fields after the transport-specific Workspace id is resolved. */
export type CopyOSCopyVariantRepositoryCreateRequest = Omit<CopyOSCopyVariantCreateRequest, 'workspaceId'>

/** File-first repository with atomic publication and pre-overwrite revisions. */
export class CopyOSAssetRepository {
  /**
   * List assets in newest-update order. A file that is not a valid CopyOS asset is reported in `invalid` and does not hide
   * the others; file-system failures still reject.
   * @param projectPath - Canonical CopyOS project root.
   * @param kind - Optional asset family filter.
   * @returns validated portable assets and the project-relative files skipped as invalid, in path order.
   */
  async list(projectPath: string, kind?: CopyOSAssetKind): Promise<CopyOSAssetListValue> {
    const kinds: readonly CopyOSAssetKind[] = kind === undefined ? ['brief', 'copy'] : [kind]
    const groups = await Promise.all(kinds.map(async current => await this.readDirectory(projectPath, current)))
    return {
      assets: groups.flatMap(group => group.assets).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      invalid: groups.flatMap(group => group.invalid),
    }
  }

  /**
   * Create a durable structured brief.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Browser-submitted brief fields.
   * @returns the validated file content.
   */
  async createBrief(
    projectPath: string,
    request: CopyOSBriefRepositoryCreateRequest,
  ): Promise<CopyOSBriefDocument> {
    const now = new Date().toISOString()
    const document = briefSchema.parse({
      schema: 'copyos.asset',
      version: COPYOS_ASSET_VERSION,
      id: randomUUID(),
      kind: 'brief',
      title: request.title,
      status: 'draft',
      objective: request.objective,
      audience: request.audience,
      offer: request.offer,
      proof: request.proof,
      cta: request.cta,
      createdAt: now,
      updatedAt: now,
    })
    await this.writeNew(projectPath, document)
    return document
  }

  /**
   * Create a copy asset and its first selected variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Browser-submitted title, initial body, and optional brief relation.
   * @returns the validated file content.
   */
  async createCopy(
    projectPath: string,
    request: CopyOSCopyRepositoryCreateRequest,
  ): Promise<CopyOSCopyDocument> {
    if (request.briefId !== undefined) {
      const brief = await this.find(projectPath, 'brief', request.briefId)
      if (brief === undefined) {
        throw new CopyOSAssetNotFoundError(`brief '${request.briefId}' was not found`)
      }
    }
    const now = new Date().toISOString()
    const variantId = randomUUID()
    const document = copySchema.parse({
      schema: 'copyos.asset',
      version: COPYOS_ASSET_VERSION,
      id: randomUUID(),
      kind: 'copy',
      title: request.title,
      status: 'draft',
      ...(request.briefId === undefined ? {} : { briefId: request.briefId }),
      selectedVariantId: variantId,
      variants: [{ id: variantId, label: request.label, body: request.body, createdAt: now }],
      createdAt: now,
      updatedAt: now,
    })
    await this.writeNew(projectPath, document)
    return document
  }

  /**
   * Append and select a copy variation after snapshotting the prior file.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Target asset id plus new label and body.
   * @returns the complete updated copy asset.
   */
  async addCopyVariant(
    projectPath: string,
    request: CopyOSCopyVariantRepositoryCreateRequest,
  ): Promise<CopyOSCopyDocument> {
    const located = await this.find(projectPath, 'copy', request.assetId)
    if (located === undefined || located.document.kind !== 'copy') {
      throw new CopyOSAssetNotFoundError(`copy asset '${request.assetId}' was not found`)
    }
    const now = new Date().toISOString()
    const variantId = randomUUID()
    const updated = copySchema.parse({
      ...located.document,
      updatedAt: now,
      selectedVariantId: variantId,
      variants: [...located.document.variants, {
        id: variantId,
        label: request.label,
        body: request.body,
        createdAt: now,
      }],
    })
    await this.snapshot(projectPath, located.path, updated.id)
    await this.writeAtomic(located.path, updated)
    return updated
  }

  /**
   * Read one asset by stable id without accepting a filesystem path.
   * @param projectPath - Canonical CopyOS project root.
   * @param assetId - Stable asset identity.
   * @returns the validated portable asset.
   */
  async get(projectPath: string, assetId: string): Promise<CopyOSAssetDocument> {
    for (const kind of ['brief', 'copy'] as const) {
      const located = await this.find(projectPath, kind, assetId)
      if (located !== undefined) return located.document
    }
    throw new CopyOSAssetNotFoundError(`asset '${assetId}' was not found`)
  }

  private async readDirectory(projectPath: string, kind: CopyOSAssetKind): Promise<CopyOSAssetListValue> {
    const paths = await this.assetPaths(projectPath, kind)
    const results = await Promise.all(paths.map(async (path): Promise<CopyOSAssetDocument | CopyOSInvalidAssetFile> => {
      try {
        return await this.read(path, kind)
      } catch (error: unknown) {
        if (!(error instanceof CopyOSAssetFormatError)) throw error
        return { path: relative(projectPath, path), error: error.message }
      }
    }))
    return {
      assets: results.filter((item): item is CopyOSAssetDocument => 'schema' in item),
      invalid: results.filter((item): item is CopyOSInvalidAssetFile => !('schema' in item)),
    }
  }

  private async read(path: string, expectedKind: CopyOSAssetKind): Promise<CopyOSAssetDocument> {
    try {
      const document = parseFrontmatter(await readFile(path, 'utf8'))
      const parsed = assetSchema.parse(document)
      if (parsed.kind !== expectedKind) {
        throw new Error(`declares kind '${parsed.kind}' inside the '${directoryFor(expectedKind)}' directory`)
      }
      return parsed
    } catch (error: unknown) {
      if (error instanceof CopyOSAssetFormatError) throw error
      throw new CopyOSAssetFormatError(`invalid CopyOS asset at '${path}': ${errorMessage(error)}`)
    }
  }

  private async find(
    projectPath: string,
    kind: CopyOSAssetKind,
    assetId: string,
  ): Promise<{ readonly path: string; readonly document: CopyOSAssetDocument } | undefined> {
    for (const path of await this.assetPaths(projectPath, kind)) {
      let document: CopyOSAssetDocument
      try {
        document = await this.read(path, kind)
      } catch (error: unknown) {
        // An invalid sibling file has no readable id, so it cannot be the requested asset; listing reports it.
        if (error instanceof CopyOSAssetFormatError) continue
        throw error
      }
      if (document.id === assetId) {
        return { path, document }
      }
    }
    return undefined
  }

  private async assetPaths(projectPath: string, kind: CopyOSAssetKind): Promise<readonly string[]> {
    const directory = join(projectPath, directoryFor(kind))
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(directory, entry.name))
      .sort()
  }

  private async writeNew(projectPath: string, document: CopyOSAssetDocument): Promise<void> {
    const directory = join(projectPath, directoryFor(document.kind))
    await mkdir(directory, { recursive: true })
    await this.writeAtomic(join(directory, fileName(document)), document, 'wx')
  }

  private async writeAtomic(
    destination: string,
    document: CopyOSAssetDocument,
    destinationFlag: 'w' | 'wx' = 'w',
  ): Promise<void> {
    const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, renderAsset(document), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      if (destinationFlag === 'wx') {
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

  private async snapshot(projectPath: string, source: string, assetId: string): Promise<void> {
    const directory = join(projectPath, '.copywriter', 'revisions', assetId)
    await mkdir(directory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    await copyFile(source, join(directory, `${stamp}-${randomUUID()}.md`), constants.COPYFILE_EXCL)
  }
}

function parseFrontmatter(source: string): unknown {
  if (!source.startsWith(FRONTMATTER_START)) {
    throw new CopyOSAssetFormatError('missing YAML frontmatter')
  }
  const end = source.indexOf(FRONTMATTER_END, FRONTMATTER_START.length)
  if (end < 0) throw new CopyOSAssetFormatError('unterminated YAML frontmatter')
  return parse(source.slice(FRONTMATTER_START.length, end))
}

function renderAsset(document: CopyOSAssetDocument): string {
  const metadata = stringify(document, { lineWidth: 0 }).trimEnd()
  const body = document.kind === 'brief'
    ? `# ${document.title}\n\n## Objective\n\n${document.objective}\n\n## Audience\n\n${document.audience}\n\n## Offer\n\n${document.offer}\n\n## Proof\n\n${document.proof}\n\n## CTA\n\n${document.cta}`
    : `# ${document.title}\n\n${document.variants.find(variant => variant.id === document.selectedVariantId)?.body ?? ''}`
  return `${FRONTMATTER_START}${metadata}${FRONTMATTER_END}${body}\n`
}

function directoryFor(kind: CopyOSAssetKind): 'briefs' | 'copy' {
  return kind === 'brief' ? 'briefs' : 'copy'
}

function fileName(document: CopyOSAssetDocument): string {
  const slug = document.title.toLowerCase().normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 64) || 'asset'
  return `${slug}-${document.id}.md`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
