/** Portable Markdown repository for CopyOS brand profiles and research notes. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  COPYOS_KNOWLEDGE_VERSION,
  type CopyOSBrandCreateRequest,
  type CopyOSBrandDocument,
  type CopyOSKnowledgeDocument,
  type CopyOSKnowledgeKind,
  type CopyOSResearchCreateRequest,
  type CopyOSResearchDocument,
} from './types.ts'

const FRONTMATTER_START = '---\n'
const FRONTMATTER_END = '\n---\n'

const baseSchema = z.object({
  schema: z.literal('copyos.knowledge'),
  version: z.literal(COPYOS_KNOWLEDGE_VERSION),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  status: z.literal('active'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

const brandSchema = baseSchema.extend({
  kind: z.literal('brand'),
  positioning: z.string().trim().min(1).max(20_000),
  audience: z.string().trim().min(1).max(20_000),
  voice: z.string().trim().min(1).max(20_000),
  differentiators: z.string().trim().min(1).max(20_000),
  guardrails: z.string().trim().max(20_000),
}).strict()

const researchSchema = baseSchema.extend({
  kind: z.literal('research'),
  topic: z.string().trim().min(1).max(2_000),
  source: z.string().trim().min(1).max(10_000),
  evidence: z.string().trim().min(1).max(50_000),
  insight: z.string().trim().min(1).max(50_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(50),
}).strict()

const knowledgeSchema = z.discriminatedUnion('kind', [brandSchema, researchSchema])

/** A knowledge file or submitted field is invalid. */
export class CopyOSKnowledgeFormatError extends Error {
  override readonly name = 'CopyOSKnowledgeFormatError'
}

/** A requested knowledge record does not exist in the project. */
export class CopyOSKnowledgeNotFoundError extends Error {
  override readonly name = 'CopyOSKnowledgeNotFoundError'
}

type BrandCreate = Omit<CopyOSBrandCreateRequest, 'workspaceId'>
type ResearchCreate = Omit<CopyOSResearchCreateRequest, 'workspaceId'>

/** File-first strategic knowledge storage with stable ids and atomic publication. */
export class CopyOSKnowledgeRepository {
  /**
   * List knowledge records in newest-update order.
   * @param projectPath - Canonical CopyOS project root.
   * @param kind - Optional brand or research filter.
   * @returns validated portable knowledge records.
   */
  async list(projectPath: string, kind?: CopyOSKnowledgeKind): Promise<readonly CopyOSKnowledgeDocument[]> {
    const kinds: readonly CopyOSKnowledgeKind[] = kind === undefined ? ['brand', 'research'] : [kind]
    const groups = await Promise.all(kinds.map(async current => await this.readDirectory(projectPath, current)))
    return groups.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one knowledge record by stable id.
   * @param projectPath - Canonical CopyOS project root.
   * @param recordId - Stable knowledge identity.
   * @returns the validated brand or research document.
   */
  async get(projectPath: string, recordId: string): Promise<CopyOSKnowledgeDocument> {
    for (const kind of ['brand', 'research'] as const) {
      for (const path of await this.recordPaths(projectPath, kind)) {
        const document = await this.read(path, kind)
        if (document.id === recordId) return document
      }
    }
    throw new CopyOSKnowledgeNotFoundError(`knowledge record '${recordId}' was not found`)
  }

  /**
   * Create a reusable brand profile.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Positioning, audience, voice, differentiators, and guardrails.
   * @returns the persisted brand profile.
   */
  async createBrand(projectPath: string, request: BrandCreate): Promise<CopyOSBrandDocument> {
    const now = new Date().toISOString()
    const document = brandSchema.parse({
      schema: 'copyos.knowledge',
      version: COPYOS_KNOWLEDGE_VERSION,
      id: randomUUID(),
      kind: 'brand',
      title: request.title,
      status: 'active',
      positioning: request.positioning,
      audience: request.audience,
      voice: request.voice,
      differentiators: request.differentiators,
      guardrails: request.guardrails,
      createdAt: now,
      updatedAt: now,
    })
    await this.writeNew(projectPath, document)
    return document
  }

  /**
   * Create an evidence-bearing research note.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Topic, source, evidence, insight, and tags.
   * @returns the persisted research note.
   */
  async createResearch(projectPath: string, request: ResearchCreate): Promise<CopyOSResearchDocument> {
    const now = new Date().toISOString()
    const document = researchSchema.parse({
      schema: 'copyos.knowledge',
      version: COPYOS_KNOWLEDGE_VERSION,
      id: randomUUID(),
      kind: 'research',
      title: request.title,
      status: 'active',
      topic: request.topic,
      source: request.source,
      evidence: request.evidence,
      insight: request.insight,
      tags: normalizeTags(request.tags),
      createdAt: now,
      updatedAt: now,
    })
    await this.writeNew(projectPath, document)
    return document
  }

  private async readDirectory(
    projectPath: string,
    kind: CopyOSKnowledgeKind,
  ): Promise<readonly CopyOSKnowledgeDocument[]> {
    const paths = await this.recordPaths(projectPath, kind)
    return await Promise.all(paths.map(async path => await this.read(path, kind)))
  }

  private async read(path: string, expectedKind: CopyOSKnowledgeKind): Promise<CopyOSKnowledgeDocument> {
    try {
      const parsed = knowledgeSchema.parse(parseFrontmatter(await readFile(path, 'utf8')))
      if (parsed.kind !== expectedKind) {
        throw new Error(`declares kind '${parsed.kind}' inside the '${expectedKind}' directory`)
      }
      return parsed
    } catch (error: unknown) {
      if (error instanceof CopyOSKnowledgeFormatError) throw error
      throw new CopyOSKnowledgeFormatError(`invalid CopyOS knowledge at '${path}': ${errorMessage(error)}`)
    }
  }

  private async recordPaths(projectPath: string, kind: CopyOSKnowledgeKind): Promise<readonly string[]> {
    const directory = join(projectPath, kind)
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(directory, entry.name))
      .sort()
  }

  private async writeNew(projectPath: string, document: CopyOSKnowledgeDocument): Promise<void> {
    const directory = join(projectPath, document.kind)
    await mkdir(directory, { recursive: true })
    const destination = join(directory, fileName(document))
    const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, render(document), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await copyFile(temporary, destination, constants.COPYFILE_EXCL)
      await unlink(temporary)
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}

function parseFrontmatter(source: string): unknown {
  if (!source.startsWith(FRONTMATTER_START)) throw new CopyOSKnowledgeFormatError('missing YAML frontmatter')
  const end = source.indexOf(FRONTMATTER_END, FRONTMATTER_START.length)
  if (end < 0) throw new CopyOSKnowledgeFormatError('unterminated YAML frontmatter')
  return parse(source.slice(FRONTMATTER_START.length, end))
}

function render(document: CopyOSKnowledgeDocument): string {
  const metadata = stringify(document, { lineWidth: 0 }).trimEnd()
  const body = document.kind === 'brand'
    ? `# ${document.title}\n\n## Positioning\n\n${document.positioning}\n\n## Audience\n\n${document.audience}\n\n## Voice\n\n${document.voice}\n\n## Differentiators\n\n${document.differentiators}\n\n## Guardrails\n\n${document.guardrails}`
    : `# ${document.title}\n\n## Topic\n\n${document.topic}\n\n## Source\n\n${document.source}\n\n## Evidence\n\n${document.evidence}\n\n## Insight\n\n${document.insight}`
  return `${FRONTMATTER_START}${metadata}${FRONTMATTER_END}${body}\n`
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(tag => tag !== ''))]
}

function fileName(document: CopyOSKnowledgeDocument): string {
  const slug = document.title.toLowerCase().normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 64) || document.kind
  return `${slug}-${document.id}.md`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
