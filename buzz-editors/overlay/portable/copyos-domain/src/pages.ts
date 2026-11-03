import { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
/** Portable landing-page repository with section variations and HTML export. */

import { withProjectArtifactAccess } from './project-artifact-transaction.ts'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { normalizePageElementIds, inspectPageElements } from './page-elements.ts'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  COPYOS_PAGE_VERSION,
  type CopyOSPageCreateRequest,
  type CopyOSPageCommentCreateRequest,
  type CopyOSPageCommentStatusRequest,
  type CopyOSPageDocument,
  type CopyOSPageSectionCreateRequest,
  type CopyOSPageSectionDeleteRequest,
  type CopyOSPageSectionMoveRequest,
  type CopyOSPageSectionRenameRequest,
  type CopyOSPageSectionVariantCreateRequest,
  type CopyOSPageSectionVariantSelectRequest,
  type CopyOSPageSectionVariantUpdateRequest,
  type CopyOSPageVariantsUpdateRequest,
  type CopyOSPageConversion,
} from './types.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import { DESIGN_IMAGE_ASSET_DIRECTORY, designImageAssetFiles, rewriteDesignImageAssetPaths } from './design-image-assets.ts'

const templateSchema = z.enum([
  'hero-centered',
  'hero-split',
  'hero-editorial',
  'proof-bar',
  'proof-metrics',
  'benefit-grid',
  'benefit-steps',
  'testimonial',
  'testimonial-pair',
  'comparison',
  'pricing',
  'faq',
  'cta-banner',
  'cta-proof',
  'custom-html',
])

const variantSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  html: z.string().trim().min(1).max(COPYOS_PAGE_HTML_MAX_LENGTH),
  createdAt: z.iso.datetime(),
}).strict()

const sectionSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  templateId: templateSchema,
  selectedVariantId: z.uuid(),
  variants: z.array(variantSchema).min(1),
}).strict().superRefine((value, context) => {
  if (!value.variants.some(variant => variant.id === value.selectedVariantId)) {
    context.addIssue({ code: 'custom', path: ['selectedVariantId'], message: 'must identify an existing variant' })
  }
})

const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const variantChangesSchema = z.array(z.object({ sectionId: z.uuid(), variantId: z.uuid(),
  html: z.string().trim().min(1).max(COPYOS_PAGE_HTML_MAX_LENGTH) }).strict()).min(1).max(100)

const pageSchema = z.object({
  revision: revisionSchema.default(0),
  schema: z.literal('copyos.page'),
  version: z.literal(COPYOS_PAGE_VERSION),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  status: z.literal('draft'),
  sections: z.array(sectionSchema).max(100),
  comments: z.array(z.object({
    id: z.uuid(),
    sectionId: z.uuid(),
    variantId: z.uuid(),
    elementId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).nullable().optional(),
    elementIndex: z.number().int().nonnegative(),
    elementLabel: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(4_000),
    status: z.enum(['open', 'resolved']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }).strict()).max(1_000).optional(),
  conversion: z.object({ version: z.literal(1), compilerVersion: z.literal(1), sourceDesignId: z.uuid(), sourceFrameId: z.uuid(), sourceRevision: revisionSchema, linkedFrameId: z.uuid(), snapshotPath: z.string().regex(/^\.copyos\/conversions\/[0-9a-f-]{36}\/source\.design\.json$/), generatedPath: z.string().regex(/^\.copyos\/conversions\/[0-9a-f-]{36}\/generated\.html$/).optional(), previewHash: z.string().regex(/^[a-f0-9]{64}$/), mapping: z.array(z.object({ nodeId: z.string().max(128), instancePath: z.array(z.string().max(128)).max(128), elementId: z.string().max(128), tagName: z.string().max(32), kind: z.enum(['semantic', 'artwork']) }).strict()).max(4096) }).strict().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

/** A page file or submitted page field is invalid. */
export class CopyOSPageFormatError extends Error {
  override readonly name: string = 'CopyOSPageFormatError'
}

/** The saved page changed since a guarded caller read it; no mutation or snapshot occurred. */
export class CopyOSPageConflictError extends CopyOSPageFormatError {
  override readonly name = 'CopyOSPageConflictError'
}

/** A requested page, section, or variation was not found. */
export class CopyOSPageNotFoundError extends Error {
  override readonly name = 'CopyOSPageNotFoundError'
}

type PageCreate = Omit<CopyOSPageCreateRequest, 'workspaceId'>
type SectionCreate = Omit<CopyOSPageSectionCreateRequest, 'workspaceId'>
type VariantCreate = Omit<CopyOSPageSectionVariantCreateRequest, 'workspaceId'>
type VariantSelect = Omit<CopyOSPageSectionVariantSelectRequest, 'workspaceId'>
type VariantUpdate = Omit<CopyOSPageSectionVariantUpdateRequest, 'workspaceId'>
type VariantsUpdate = Omit<CopyOSPageVariantsUpdateRequest, 'workspaceId'>
type SectionRename = Omit<CopyOSPageSectionRenameRequest, 'workspaceId'>
type SectionDelete = Omit<CopyOSPageSectionDeleteRequest, 'workspaceId'>
type SectionMove = Omit<CopyOSPageSectionMoveRequest, 'workspaceId'>
type CommentCreate = Omit<CopyOSPageCommentCreateRequest, 'workspaceId'>
type CommentStatus = Omit<CopyOSPageCommentStatusRequest, 'workspaceId'>
interface ConversionVariantUpdate {
  pageId: string
  expectedRevision: number
  sectionId: string
  variantId: string
  html: string
  conversion: CopyOSPageConversion
}

/** JSON-first page storage with atomic updates, revisions, and standalone export. */
export class CopyOSPageRepository {
  /**
   * List pages in newest-update order.
   * @param projectPath - Canonical CopyOS project root.
   * @returns validated page documents.
   */
  async list(projectPath: string): Promise<readonly CopyOSPageDocument[]> {
    return withProjectArtifactAccess(projectPath, () => this.listCore(projectPath))
  }

  private async listCore(projectPath: string): Promise<readonly CopyOSPageDocument[]> {
    const directory = join(projectPath, 'pages')
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    const pages = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.page.json'))
      .map(async entry => await this.read(join(directory, entry.name))))
    return pages.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one page by stable id.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns the validated page document.
   */
  async get(projectPath: string, pageId: string): Promise<CopyOSPageDocument> {
    const located = await this.find(projectPath, pageId)
    if (located === undefined) throw new CopyOSPageNotFoundError(`page '${pageId}' was not found`)
    return located.document
  }

  /**
   * Create an empty page document.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page title and optional slug.
   * @returns the persisted empty page.
   */
  async create(projectPath: string, request: PageCreate): Promise<CopyOSPageDocument> {
    const now = new Date().toISOString()
    const slug = normalizeSlug(request.slug ?? request.title)
    if ((await this.list(projectPath)).some(page => page.slug === slug)) {
      throw new CopyOSPageFormatError(`page slug '${slug}' already exists`)
    }
    const page = this.parse({
      schema: 'copyos.page',
      revision: 0,
      version: COPYOS_PAGE_VERSION,
      id: randomUUID(),
      title: request.title,
      slug,
      status: 'draft',
      sections: [],
      comments: [],
      createdAt: now,
      updatedAt: now,
    })
    const directory = join(projectPath, 'pages')
    await mkdir(directory, { recursive: true })
    await this.writeAtomic(join(directory, fileName(page)), page, 'wx')
    return page
  }

  /**
   * Append a coded section with one selected HTML variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page identity and initial section fields.
   * @returns the complete updated page.
   */
  async addSection(projectPath: string, request: SectionCreate): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      const variantId = randomUUID()
      const section = {
        id: randomUUID(),
        title: request.title,
        templateId: request.templateId,
        selectedVariantId: variantId,
        variants: [{ id: variantId, label: request.label, html: request.html, createdAt: now }],
      }
      const sections = [...page.sections]
      const toIndex = request.toIndex === undefined
        ? sections.length
        : Math.max(0, Math.min(request.toIndex, sections.length))
      sections.splice(toIndex, 0, section)
      return {
        ...page,
        updatedAt: now,
        sections,
      }
    })
  }

  /**
   * Append and select another HTML variation for one section.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page, section, and new variation fields.
   * @returns the complete updated page.
   */
  async addVariant(projectPath: string, request: VariantCreate): Promise<CopyOSPageDocument> {
    return await this.updateSection(projectPath, request.pageId, request.sectionId, request.expectedRevision, (section, now) => {
      const variantId = randomUUID()
      return {
        ...section,
        selectedVariantId: variantId,
        variants: [...section.variants, {
          id: variantId,
          label: request.label,
          html: request.html,
          createdAt: now,
        }],
      }
    })
  }

  /**
   * Select an existing stored variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page, section, and variation identities.
   * @returns the complete updated page.
   */
  async selectVariant(projectPath: string, request: VariantSelect): Promise<CopyOSPageDocument> {
    return await this.updateSection(projectPath, request.pageId, request.sectionId, request.expectedRevision, (section) => {
      if (!section.variants.some(variant => variant.id === request.variantId)) {
        throw new CopyOSPageNotFoundError(`variation '${request.variantId}' was not found`)
      }
      return { ...section, selectedVariantId: request.variantId }
    })
  }

  /**
   * Persist direct canvas edits without creating a new named variation.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page, section, variation, and complete edited HTML.
   * @returns the complete updated page.
   */
  async updateVariant(projectPath: string, request: VariantUpdate): Promise<CopyOSPageDocument> {
    return await this.updateSection(projectPath, request.pageId, request.sectionId, request.expectedRevision, (section) => {
      if (!section.variants.some(variant => variant.id === request.variantId)) {
        throw new CopyOSPageNotFoundError(`variation '${request.variantId}' was not found`)
      }
      return {
        ...section,
        variants: section.variants.map(variant => variant.id === request.variantId
          ? { ...variant, html: request.html }
          : variant),
      }
    })
  }

  /**
   * Replace existing HTML variations in one guarded transaction, retaining selection and unrelated metadata.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Required saved revision and 1–100 unique section/variation targets with bounded nonempty HTML.
   * @returns Complete saved page after one revision increment and one pre-write snapshot, including same-content batches.
   * @throws {CopyOSPageFormatError} If any target, HTML, revision or batch is invalid; stale revisions throw CopyOSPageConflictError.
   */
  async updateVariants(projectPath: string, request: VariantsUpdate): Promise<CopyOSPageDocument> {
    let changes: z.infer<typeof variantChangesSchema>
    try {
      revisionSchema.parse(request.expectedRevision)
      z.uuid().parse(request.pageId)
      changes = variantChangesSchema.parse(request.changes)
    } catch (error: unknown) { throw new CopyOSPageFormatError(errorMessage(error)) }
    const targets = new Set<string>()
    for (const change of changes) {
      const target = `${change.sectionId}:${change.variantId}`
      if (targets.has(target)) throw new CopyOSPageFormatError('Page batch contains a duplicate section/variation target')
      targets.add(target)
    }
    return this.update(projectPath, request.pageId, request.expectedRevision, (page) => {
      for (const change of changes) {
        const sections = page.sections.filter(item => item.id === change.sectionId)
        if (!sections.length) throw new CopyOSPageNotFoundError(`section '${change.sectionId}' was not found`)
        if (sections.length !== 1) throw new CopyOSPageFormatError(`section '${change.sectionId}' is ambiguous`)
        const variants = sections[0]?.variants.filter(variant => variant.id === change.variantId) ?? []
        if (!variants.length) throw new CopyOSPageNotFoundError(`variation '${change.variantId}' was not found`)
        if (variants.length !== 1) throw new CopyOSPageFormatError(`variation '${change.variantId}' is ambiguous`)
      }
      return { ...page, sections: page.sections.map(section => ({ ...section, variants: section.variants.map((variant) => {
        const change = changes.find(item => item.sectionId === section.id && item.variantId === variant.id)
        return change ? { ...variant, html: change.html } : variant
      }) })) }
    }, targets)
  }

  /**
   * Replace one converted variation and its conversion record in one guarded revision.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Saved revision, unique converted section/variation, merged HTML and its new design-base conversion record.
   * @returns Complete saved page after one revision increment and one pre-write snapshot.
   * @throws {CopyOSPageConflictError} If the page changed since review; no snapshot or write occurs.
   */
  async updateConversionVariant(projectPath: string, request: ConversionVariantUpdate): Promise<CopyOSPageDocument> {
    return this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      if (page.conversion?.sourceFrameId !== request.conversion.sourceFrameId ||
        page.conversion.sourceDesignId !== request.conversion.sourceDesignId)
        throw new CopyOSPageFormatError('Page conversion source changed before the update')
      const variants = page.sections.filter(section => section.id === request.sectionId)
        .flatMap(section => section.variants.filter(variant => variant.id === request.variantId))
      if (variants.length !== 1) throw new CopyOSPageFormatError('The converted variation is missing or ambiguous')
      return { ...page, updatedAt: now, conversion: request.conversion, sections: page.sections.map(section =>
        section.id !== request.sectionId ? section : { ...section, variants: section.variants.map(variant =>
          variant.id === request.variantId ? { ...variant, html: request.html } : variant) }) }
    }, new Set([`${request.sectionId}:${request.variantId}`]))
  }

  /**
   * Rename a section while preserving its stable identity and variations.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page and section identities plus the replacement title.
   * @returns the complete updated page.
   */
  async renameSection(projectPath: string, request: SectionRename): Promise<CopyOSPageDocument> {
    return await this.updateSection(projectPath, request.pageId, request.sectionId, request.expectedRevision, section => ({
      ...section,
      title: request.title,
    }))
  }

  /**
   * Delete a section from the page.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page and section identities.
   * @returns the complete updated page.
   */
  async deleteSection(projectPath: string, request: SectionDelete): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      if (!page.sections.some(section => section.id === request.sectionId)) {
        throw new CopyOSPageNotFoundError(`section '${request.sectionId}' was not found`)
      }
      return { ...page, updatedAt: now, sections: page.sections.filter(section => section.id !== request.sectionId) }
    })
  }

  /**
   * Move a section to a zero-based destination.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page, section, and destination index.
   * @returns the complete updated page.
   */
  async moveSection(projectPath: string, request: SectionMove): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      const fromIndex = page.sections.findIndex(section => section.id === request.sectionId)
      if (fromIndex < 0) throw new CopyOSPageNotFoundError(`section '${request.sectionId}' was not found`)
      const toIndex = Math.max(0, Math.min(request.toIndex, page.sections.length - 1))
      const sections = [...page.sections]
      const [moved] = sections.splice(fromIndex, 1)
      sections.splice(toIndex, 0, moved as CopyOSPageDocument['sections'][number])
      return { ...page, updatedAt: now, sections }
    })
  }

  /**
   * Pin one durable review comment to a selected page element.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page-element selection and comment body.
   * @returns the complete updated page.
   */
  async addComment(projectPath: string, request: CommentCreate): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      const owners = page.sections.filter(item => item.id === request.sectionId)
      if (owners.length > 1) throw new CopyOSPageFormatError('Comment section target is ambiguous')
      const section = owners[0]
      if (!section) throw new CopyOSPageNotFoundError(`section '${request.sectionId}' was not found`)
      const variants = section.variants.filter(item => item.id === request.variantId)
      if (variants.length > 1) throw new CopyOSPageFormatError('Comment variation target is ambiguous')
      const variant = variants[0]
      if (!variant) throw new CopyOSPageNotFoundError(`variation '${request.variantId}' was not found`)
      const elements = inspectPageElements(variant.html)
      const element = request.elementId === undefined
        ? elements.find(item => item.styleIndex === request.elementIndex)
        : elements.find(item => item.id === request.elementId)
      if (!element) throw new CopyOSPageNotFoundError('Comment element target was not found; select an existing element')
      return {
        ...page,
        updatedAt: now,
        comments: [...(page.comments ?? []), {
          id: randomUUID(),
          sectionId: request.sectionId,
          variantId: request.variantId,
          elementId: element.id,
          elementIndex: element.styleIndex ?? request.elementIndex,
          elementLabel: request.elementLabel,
          body: request.body,
          status: 'open' as const,
          createdAt: now,
          updatedAt: now,
        }],
      }
    })
  }

  /**
   * Resolve or reopen one page review comment.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Page and comment identities plus the desired status.
   * @returns the complete updated page.
   */
  async setCommentStatus(projectPath: string, request: CommentStatus): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, request.pageId, request.expectedRevision, (page, now) => {
      if (!(page.comments ?? []).some(comment => comment.id === request.commentId)) {
        throw new CopyOSPageNotFoundError(`comment '${request.commentId}' was not found`)
      }
      return {
        ...page,
        updatedAt: now,
        comments: (page.comments ?? []).map(comment => comment.id === request.commentId
          ? { ...comment, status: request.status, updatedAt: now }
          : comment),
      }
    })
  }

  /**
   * Write a complete standalone HTML document using selected section variations; stored project images are embedded.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns host path of the written HTML file.
   */
  async exportHtml(projectPath: string, pageId: string): Promise<string> {
    const page = await this.get(projectPath, pageId)
    const html = await embedPageImages(projectPath, standaloneHtml(page))
    const directory = join(projectPath, 'exports')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${page.slug}.html`)
    await writeFile(destination, html, { encoding: 'utf8', mode: 0o600 })
    return destination
  }

  /**
   * Write a static project folder that can be imported or deployed with Vercel, with the stored project images the page names.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns host path of the written project folder.
   */
  async exportVercel(projectPath: string, pageId: string): Promise<string> {
    const page = await this.get(projectPath, pageId)
    const destination = join(projectPath, 'exports', `${page.slug}-vercel`)
    await mkdir(destination, { recursive: true })
    const html = standaloneHtml(page)
    await copyPageImages(projectPath, html, join(destination, DESIGN_IMAGE_ASSET_DIRECTORY))
    await writeFile(join(destination, 'index.html'), html, { encoding: 'utf8', mode: 0o600 })
    await writeFile(join(destination, 'vercel.json'), `${JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    await writeFile(join(destination, 'README.md'), `# ${page.title}\n\nVercel-ready static export from CopyOS.\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    return destination
  }

  /**
   * Write an Online Store 2.0 theme folder with one reusable Liquid section per CopyOS section; stored project images become theme assets.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns host path of the written theme folder.
   */
  async exportShopify(projectPath: string, pageId: string): Promise<string> {
    const page = await this.get(projectPath, pageId)
    const destination = join(projectPath, 'exports', `${page.slug}-shopify`)
    const layoutDirectory = join(destination, 'layout')
    const templatesDirectory = join(destination, 'templates')
    const sectionsDirectory = join(destination, 'sections')
    const assetsDirectory = join(destination, 'assets')
    await Promise.all([layoutDirectory, templatesDirectory, sectionsDirectory, assetsDirectory]
      .map(async (directory) => { await mkdir(directory, { recursive: true }) }))

    const sectionRecords = page.sections.map((section, index) => {
      const key = `copyos${index + 1}`
      const type = `copyos-${index + 1}-${shopifyHandle(section.title)}`
      const selected = section.variants.find(variant => variant.id === section.selectedVariantId)
      return { key, type, title: section.title, html: selected?.html ?? '' }
    })
    // Theme files live flat in `assets/`; Liquid's asset_url resolves them on the storefront.
    await copyPageImages(projectPath, sectionRecords.map(section => section.html).join('\n'), assetsDirectory)
    await Promise.all(sectionRecords.map(async (section) => {
      const schema = { name: section.title.slice(0, 25), settings: [], presets: [{ name: section.title.slice(0, 25) }] }
      const html = rewriteDesignImageAssetPaths(section.html, fileName => `{{ '${fileName}' | asset_url }}`)
      const liquid = `${html}\n\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}\n`
      await writeFile(join(sectionsDirectory, `${section.type}.liquid`), liquid, { encoding: 'utf8', mode: 0o600 })
    }))
    const template = {
      sections: Object.fromEntries(sectionRecords.map(section => [section.key, { type: section.type, settings: {} }])),
      order: sectionRecords.map(section => section.key),
    }
    await writeFile(join(templatesDirectory, `page.copyos-${page.slug}.json`), `${JSON.stringify(template, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    await writeFile(join(layoutDirectory, 'theme.liquid'), shopifyLayout(page.title), { encoding: 'utf8', mode: 0o600 })
    await writeFile(join(assetsDirectory, 'copyos.css'), 'html{box-sizing:border-box}*,*:before,*:after{box-sizing:inherit}body{margin:0}\n', {
      encoding: 'utf8', mode: 0o600,
    })
    await writeFile(join(destination, 'README.md'), `# ${page.title}\n\nShopify Online Store 2.0 theme folder from CopyOS. Upload it as an unpublished theme, then assign the **page.copyos-${page.slug}** template to a page.\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    return destination
  }

  /**
   * Write the selected page copy as a readable Markdown document.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns host path of the written Markdown file.
   */
  async exportCopy(projectPath: string, pageId: string): Promise<string> {
    const page = await this.get(projectPath, pageId)
    const content = [`# ${page.title}`, ...page.sections.map((section) => {
      const selected = section.variants.find(variant => variant.id === section.selectedVariantId)
      return `## ${section.title}\n\n${plainTextFromHtml(selected?.html ?? '')}`
    })].join('\n\n') + '\n'
    const directory = join(projectPath, 'exports')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${page.slug}.copy.md`)
    await writeFile(destination, content, { encoding: 'utf8', mode: 0o600 })
    return destination
  }

  /**
   * Write the structured page document to the export directory.
   * @param projectPath - Canonical CopyOS project root.
   * @param pageId - Stable page identity.
   * @returns host path of the written JSON file.
   */
  async exportJson(projectPath: string, pageId: string): Promise<string> {
    const page = await this.get(projectPath, pageId)
    const directory = join(projectPath, 'exports')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${page.slug}.sections.json`)
    await writeFile(destination, `${JSON.stringify(page, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return destination
  }

  private async updateSection(
    projectPath: string,
    pageId: string,
    sectionId: string,
    expectedRevision: number | undefined,
    transform: (section: CopyOSPageDocument['sections'][number], now: string) => CopyOSPageDocument['sections'][number],
  ): Promise<CopyOSPageDocument> {
    return await this.update(projectPath, pageId, expectedRevision, (page, now) => {
      if (!page.sections.some(section => section.id === sectionId)) {
        throw new CopyOSPageNotFoundError(`section '${sectionId}' was not found`)
      }
      const sections = page.sections.map((section) => {
        if (section.id !== sectionId) return section
        return transform(section, now)
      })
      return { ...page, updatedAt: now, sections }
    })
  }

  private async update(
    projectPath: string,
    pageId: string,
    expectedRevision: number | undefined,
    transform: (page: CopyOSPageDocument, now: string) => CopyOSPageDocument,
    changedTargets?: ReadonlySet<string>,
  ): Promise<CopyOSPageDocument> {
    try {
      z.uuid().parse(pageId)
      revisionSchema.optional().parse(expectedRevision)
    } catch (error: unknown) { throw new CopyOSPageFormatError(errorMessage(error)) }
    const located = await this.find(projectPath, pageId)
    if (located === undefined) throw new CopyOSPageNotFoundError(`page '${pageId}' was not found`)
    return withFileLock(located.path, async () => {
      const saved = await this.read(located.path), revision = saved.revision ?? 0
      if (saved.id !== pageId) throw new CopyOSPageFormatError('Page identity changed before the update')
      if (expectedRevision !== undefined && revision !== expectedRevision)
        throw new CopyOSPageConflictError(`Page changed in another editor (expected revision ${expectedRevision}, current ${revision}). Reload the saved page before reviewing and reapplying your draft.`)
      if (revision === Number.MAX_SAFE_INTEGER) throw new CopyOSPageFormatError('Page revision cannot increment beyond the safe integer limit')
      const candidate = this.parse({ ...transform(saved, new Date().toISOString()), revision: revision + 1 }, 'write')
      const updated = reconcilePageCommentElements(saved, candidate, changedTargets)
      await this.snapshot(projectPath, located.path, pageId)
      await this.writeAtomic(located.path, updated)
      return updated
    })
  }

  private async find(projectPath: string, pageId: string): Promise<{ path: string; document: CopyOSPageDocument } | undefined> {
    const pages = await this.list(projectPath)
    const document = pages.find(page => page.id === pageId)
    if (document === undefined) return undefined
    return { path: join(projectPath, 'pages', fileName(document)), document }
  }

  private async read(path: string): Promise<CopyOSPageDocument> {
    try {
      return this.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error: unknown) {
      if (error instanceof CopyOSPageFormatError) throw error
      throw new CopyOSPageFormatError(`invalid CopyOS page at '${path}': ${errorMessage(error)}`)
    }
  }

  private parse(value: unknown, mode: 'read' | 'write' = 'read'): CopyOSPageDocument {
    return parseCopyOSPageDocument(value, mode)
  }

  private async writeAtomic(
    destination: string,
    page: CopyOSPageDocument,
    destinationFlag: 'w' | 'wx' = 'w',
  ): Promise<void> {
    const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(page, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
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

  private async snapshot(projectPath: string, source: string, pageId: string): Promise<void> {
    const directory = join(projectPath, '.copywriter', 'revisions', pageId)
    await mkdir(directory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    await copyFile(source, join(directory, `${stamp}-${randomUUID()}.page.json`), constants.COPYFILE_EXCL)
  }
}


/** Reconcile only uniquely owned sections and variants; transfer only when an old target disappears into one new owner. */
function reconcilePageCommentElements(before: CopyOSPageDocument, after: CopyOSPageDocument,
  changedTargets?: ReadonlySet<string>): CopyOSPageDocument {
  if (!after.comments?.length) return after
  const tables = (page: CopyOSPageDocument) => {
    const sectionCounts = new Map<string, number>()
    for (const section of page.sections) sectionCounts.set(section.id, (sectionCounts.get(section.id) ?? 0) + 1)
    return page.sections.flatMap((section) => {
      const variantCounts = new Map<string, number>()
      for (const variant of section.variants) variantCounts.set(variant.id, (variantCounts.get(variant.id) ?? 0) + 1)
      return section.variants.map(variant => ({ sectionId: section.id, variantId: variant.id, key: `${section.id}:${variant.id}`,
        unique: sectionCounts.get(section.id) === 1 && variantCounts.get(variant.id) === 1,
        elements: inspectPageElements(variant.html) }))
    })
  }
  const previous = tables(before), current = tables(after)
  const uniqueOwner = (targets: typeof previous, key: string) => targets.find(target => target.unique && target.key === key)
  return { ...after, comments: after.comments.map((comment) => {
    if (!comment.elementId) return comment
    const ownerKey = `${comment.sectionId}:${comment.variantId}`
    const owner = uniqueOwner(current, ownerKey), oldOwner = uniqueOwner(previous, ownerKey)
    if (!owner || !oldOwner) return comment
    const remaining = owner.elements.find(element => element.id === comment.elementId)
    if (remaining) return { ...comment, elementIndex: remaining.styleIndex ?? comment.elementIndex }
    if (!changedTargets?.has(ownerKey) || !oldOwner.elements.some(element => element.id === comment.elementId)) return comment
    const moved = current.filter((target) => {
      const oldTarget = uniqueOwner(previous, target.key)
      return target.unique && oldTarget && changedTargets.has(target.key) && target.key !== ownerKey
        && target.elements.some(element => element.id === comment.elementId)
        && !oldTarget.elements.some(element => element.id === comment.elementId)
    })
    if (moved.length !== 1) return comment
    const target = moved[0], element = target?.elements.find(item => item.id === comment.elementId)
    if (!target || !element) return comment
    return { ...comment, sectionId: target.sectionId, variantId: target.variantId,
      elementIndex: element.styleIndex ?? comment.elementIndex }
  }) }
}

function normalizeSlug(value: string): string {
  const slug = value.toLowerCase().normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 120)
  if (slug === '') throw new CopyOSPageFormatError('page slug must contain a letter or number')
  return slug
}

function fileName(page: Pick<CopyOSPageDocument, 'id' | 'slug'>): string {
  return `${page.slug}-${page.id}.page.json`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function escapeComment(value: string): string {
  return value.replaceAll('--', '—')
}

/** Render the original selected-section HTML without writing an export.
 * @param page - Saved page snapshot to render.
 * @returns The same HTML document used by the original HTML and Vercel exporters.
 */
export function standaloneHtml(page: CopyOSPageDocument): string {
  const body = page.sections.map((section) => {
    const selected = section.variants.find(variant => variant.id === section.selectedVariantId)
    return `<!-- ${escapeComment(section.title)} -->\n${selected?.html ?? ''}`
  }).join('\n\n')
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(page.title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
}

// Stored project images named by page markup; exports either embed them or copy them beside the output.
async function embedPageImages(projectPath: string, html: string): Promise<string> {
  const store = new CopyOSDesignImageStore(), embedded = new Map<string, string>()
  for (const fileName of designImageAssetFiles(html)) {
    const { bytes, mimeType } = await store.readFile(projectPath, fileName)
    embedded.set(fileName, `data:${mimeType};base64,${bytes.toString('base64')}`)
  }
  return rewriteDesignImageAssetPaths(html, fileName => embedded.get(fileName) ?? `${DESIGN_IMAGE_ASSET_DIRECTORY}/${fileName}`)
}
async function copyPageImages(projectPath: string, html: string, directory: string): Promise<void> {
  const store = new CopyOSDesignImageStore(), files = designImageAssetFiles(html)
  if (files.length) await mkdir(directory, { recursive: true })
  for (const fileName of files)
    await writeFile(join(directory, fileName), (await store.readFile(projectPath, fileName)).bytes, { mode: 0o600 })
}
function shopifyHandle(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 35) || 'section'
}

function shopifyLayout(title: string): string {
  return `<!doctype html>\n<html lang="{{ request.locale.iso_code }}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{{ page_title | default: '${escapeLiquid(title)}' }}</title>\n{{ content_for_header }}\n{{ 'copyos.css' | asset_url | stylesheet_tag }}\n</head>\n<body>\n{{ content_for_layout }}\n</body>\n</html>\n`
}

function escapeLiquid(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('{{', '').replaceAll('}}', '')
}

function plainTextFromHtml(value: string): string {
  return value
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replaceAll(/<\/(?:h[1-6]|p|div|section|article|blockquote|li)>/gi, '\n')
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Validate and normalize a portable page, preserving stable authored element identities.
 * @param value - Untrusted page JSON.
 * @param mode - Read migration or persisted write validation.
 * @returns A validated complete page document.
 */
export function parseCopyOSPageDocument(value: unknown, mode: 'read' | 'write' = 'read'): CopyOSPageDocument {
  try {
    const page = pageSchema.parse(value)
    const sections = page.sections.map(section => ({ ...section, variants: section.variants.map(variant => ({
      ...variant, html: normalizePageElementIds(variant.html, { namespace: `${page.id}/${section.id}/${variant.id}`, mode }),
    })) }))
    const comments = page.comments?.map((comment) => {
      if (comment.elementId !== undefined) return comment
      const owners = sections.filter(section => section.id === comment.sectionId)
      const variants = owners.length === 1 ? owners[0]?.variants.filter(variant => variant.id === comment.variantId) ?? [] : []
      const html = variants.length === 1 ? variants[0]?.html : undefined
      const target = mode === 'read' && html !== undefined
        ? inspectPageElements(html).find(element => element.styleIndex === comment.elementIndex) : undefined
      return { ...comment, elementId: target?.id ?? null }
    })
    return { ...page, sections, ...(comments === undefined ? {} : { comments }) }
  } catch (error: unknown) {
    throw new CopyOSPageFormatError(errorMessage(error))
  }
}
