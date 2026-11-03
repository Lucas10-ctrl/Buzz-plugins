import { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
/** Workspace section library; independent files allow concurrent additions without lost updates. */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, relative, dirname } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { CopyOSReusableSectionDocument, CopyOSReusableSectionSaveRequest } from './types.ts'

const fields = z.object({
  title: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500),
  html: z.string().trim().min(1).max(COPYOS_PAGE_HTML_MAX_LENGTH),
}).strict()
const documentSchema = fields.extend({
  schema: z.literal('copyos.reusable-section'), version: z.literal(1),
  id: z.uuid(), createdAt: z.iso.datetime(),
}).strict()

/**
 * Locate the shared CopyOS library directory, overridable for isolated profiles.
 * @returns absolute library directory.
 */
export function copyosSectionLibraryRoot(): string {
  const data = process.platform === 'win32' ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return resolve(process.env.COPYOS_SECTIONS_DIR ?? join(data, 'copyos', 'section-library'))
}

/** Resolve local media against its source workspace before sharing across projects. */
function sharedAssetUrl(root: string, value: string, base = ''): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/api\/file)/iu.test(value)) return value
  const clean = value.split(/[?#]/u)[0] ?? ''
  const absolute = resolve(root, base, clean.replace(/^\/+/, ''))
  const local = relative(root, absolute)
  if (local.startsWith('..') || local === '') throw new Error('Section asset is outside its source workspace')
  return `/api/file?path=${encodeURIComponent(absolute)}`
}

async function sharedHtml(root: string, html: string): Promise<string> {
  const rewriteCss = (css: string, base = ''): string => css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/giu,
    (_match, quote: string, value: string) => `url(${quote}${sharedAssetUrl(root, value.trim(), base)}${quote})`)
  let result = html
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const href = /\bhref=["']([^"']+)["']/iu.exec(match[0])?.[1]
    if (!/\brel=["']stylesheet["']/iu.test(match[0]) || href === undefined
      || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/api\/file)/iu.test(href)) continue
    const url = sharedAssetUrl(root, href)
    const path = decodeURIComponent(url.slice('/api/file?path='.length))
    result = result.replace(match[0], `<style>${rewriteCss(await readFile(path, 'utf8'), dirname(relative(root, path))).replaceAll('</style', '<\\/style')}</style>`)
  }
  return rewriteCss(result).replace(/\b(src|poster)=["']([^"']+)["']/giu,
    (_match, name: string, value: string) => `${name}="${sharedAssetUrl(root, value)}"`)
    .replace(/\bsrcset=["']([^"']+)["']/giu, (match, value: string) => {
      if (value.includes('data:')) return match
      return `srcset="${value.split(',').map((candidate) => {
        const [url, ...descriptor] = candidate.trim().split(/\s+/u)
        return [sharedAssetUrl(root, url ?? ''), ...descriptor].join(' ')
      }).join(', ')}"`
    })
}

// Queue in-host operations and lock imports/mutations across host processes.
const libraryOperations = new Map<string, Promise<void>>()
async function withLibraryLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(root)
  const previous = libraryOperations.get(key) ?? Promise.resolve()
  const result = previous.then(async () => {
    const directory = join(key, '.copywriter')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return await withFileLock(join(directory, 'section-library'), operation, { waitMs: 30_000 })
  })
  const settled = result.then(() => {}, () => {})
  libraryOperations.set(key, settled)
  try { return await result } finally {
    if (libraryOperations.get(key) === settled) libraryOperations.delete(key)
  }
}

async function deletedSectionIds(root: string): Promise<ReadonlySet<string>> {
  try { return new Set(await readdir(join(root, '.copywriter', 'sections-deleted'))) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

/** Atomic, portable storage for reusable sections within one project. */
export class CopyOSReusableSectionRepository {
  /** @param sharedRoot - CopyOS-wide library, separate from any workspace. */
  constructor(private readonly sharedRoot = copyosSectionLibraryRoot()) {}

  /** Import legacy copies under the same lock used by category moves and deletion. */
  private async syncShared(roots: readonly string[]): Promise<readonly CopyOSReusableSectionDocument[]> {
    const deleted = await deletedSectionIds(this.sharedRoot)
    const existing = new Set((await this.list(this.sharedRoot)).map(section => section.id))
    for (const root of roots) {
      for (const section of await this.list(root)) {
        if (deleted.has(section.id) || existing.has(section.id)) continue
        const shared = documentSchema.parse({ ...section, html: await sharedHtml(root, section.html) })
        await this.persist(this.sharedRoot, shared)
        existing.add(shared.id)
      }
    }
    return await this.list(this.sharedRoot)
  }

  /**
   * Import legacy workspace libraries without resurrecting deleted entries.
   * @param roots - Registered project roots whose saved sections should be shared.
   * @returns all shared sections, newest first.
   */
  async listShared(roots: readonly string[] = []): Promise<readonly CopyOSReusableSectionDocument[]> {
    return await withLibraryLock(this.sharedRoot, async () => await this.syncShared(roots))
  }

  /**
   * Save a section for every workspace and chat, retaining source asset references.
   * @param root - Source project root used to resolve styles and media.
   * @param request - Complete saved section fields.
   * @returns the durable shared section.
   */
  async saveShared(root: string, request: Omit<CopyOSReusableSectionSaveRequest, 'workspaceId'>): Promise<CopyOSReusableSectionDocument> {
    return await withLibraryLock(this.sharedRoot, async () =>
      await this.save(this.sharedRoot, { ...request, html: await sharedHtml(root, request.html) }))
  }

  /**
   * Move an existing entry to a category without creating a copy or rewriting HTML.
   * @param sectionId - Existing shared section UUID.
   * @param category - Existing or new category name.
   * @param roots - Registered legacy library roots to synchronize first.
   * @returns the same section identity with its updated category.
   */
  async moveShared(sectionId: string, category: string, roots: readonly string[] = []): Promise<CopyOSReusableSectionDocument> {
    const id = z.uuid().parse(sectionId)
    const nextCategory = fields.shape.category.parse(category)
    return await withLibraryLock(this.sharedRoot, async () => {
      const section = (await this.syncShared(roots)).find(item => item.id === id)
      if (section === undefined) throw new Error('Reusable section was not found')
      const moved = { ...section, category: nextCategory }
      if (section.category !== nextCategory) await this.persist(this.sharedRoot, moved)
      return moved
    })
  }

  /**
   * Delete a shared entry after confirmation; inserted page copies are independent.
   * @param sectionId - Existing shared section UUID.
   * @param confirmDelete - Must be true after explicit user confirmation.
   * @param roots - Registered legacy library roots to synchronize first.
   * @returns only after the tombstone and shared-file removal succeed.
   */
  async deleteShared(sectionId: string, confirmDelete: boolean, roots: readonly string[] = []): Promise<void> {
    const id = z.uuid().parse(sectionId)
    z.literal(true).parse(confirmDelete)
    await withLibraryLock(this.sharedRoot, async () => {
      const deleted = await deletedSectionIds(this.sharedRoot)
      if (!deleted.has(id) && !(await this.syncShared(roots)).some(item => item.id === id)) {
        throw new Error('Reusable section was not found')
      }
      // Tombstone first: an interrupted cleanup must never reimport a legacy copy.
      await writeFileAtomic(join(this.sharedRoot, '.copywriter', 'sections-deleted', id), 'deleted\n', { mode: 0o600 })
      await rm(join(this.sharedRoot, '.copywriter', 'sections', `${id}.json`), { force: true })
    })
  }

  /** Write one validated library entry without replacing unrelated entries. */
  private async persist(root: string, section: CopyOSReusableSectionDocument): Promise<void> {
    await writeFileAtomic(join(root, '.copywriter', 'sections', `${section.id}.json`), `${JSON.stringify(section, null, 2)}\n`, { mode: 0o600 })
  }

  /**
   * Read the workspace library, rejecting malformed saved sections.
   * @param root - Validated CopyOS project root.
   * @returns saved sections, newest first; an absent library is empty.
   */
  async list(root: string): Promise<readonly CopyOSReusableSectionDocument[]> {
    const directory = join(root, '.copywriter', 'sections')
    let files: string[]
    try { files = await readdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const deleted = await deletedSectionIds(root)
    const sections = await Promise.all(files.filter(file => file.endsWith('.json') && !deleted.has(file.slice(0, -5))).map(async (file) => {
      const section = documentSchema.parse(JSON.parse(await readFile(join(directory, file), 'utf8')))
      if (file !== `${section.id}.json`) throw new Error(`Reusable section id does not match ${file}`)
      return section
    }))
    return sections.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  /**
   * Save an independent section copy without modifying its source page.
   * @param root - Validated CopyOS project root.
   * @param request - User-supplied library fields and portable HTML.
   * @returns the section after its file has been committed atomically.
   */
  async save(root: string, request: Omit<CopyOSReusableSectionSaveRequest, 'workspaceId'>): Promise<CopyOSReusableSectionDocument> {
    const section: CopyOSReusableSectionDocument = {
      ...fields.parse(request), schema: 'copyos.reusable-section', version: 1,
      id: randomUUID(), createdAt: new Date().toISOString(),
    }
    await this.persist(root, section)
    return section
  }
}
