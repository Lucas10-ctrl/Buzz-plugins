/** Authoritative, reviewed native artboard conversion with coordinated recoverable publication. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { compileDesignArtboard } from './design-page-compiler.ts'
import { mergeDesignPageHtml, type DesignPageMergeResolution, type DesignPageMergeResult } from './design-page-merge.ts'
import { createDesignNode } from './design-model.ts'
import { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
import { parseDesignDocument } from './design-schema.ts'
import { CopyOSDesignRepository, CopyOSDesignError } from './designs.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import { designImageAssetPaths } from './design-image-assets.ts'
import { CopyOSPageRepository, parseCopyOSPageDocument } from './pages.ts'
import { withProjectArtifactAccess, commitProjectArtifacts, readConversionArchive, writeConversionArchive } from './project-artifact-transaction.ts'
import type { CopyOSDesignDocument, CopyOSPageDocument, CopyOSDesignPagePreviewRequest, CopyOSDesignPageBuildRequest,
  CopyOSDesignPagePreview, CopyOSDesignPageBuildResult, CopyOSDesignPageUpdateRequest, CopyOSDesignPageUpdateApplyRequest,
  CopyOSDesignPageUpdateReview, CopyOSDesignPageUpdateResult, CopyOSDesignPageUpdateElement, CopyOSPageConversion } from './types.ts'
import type { DesignPageElementMapping } from './design-page-compiler.ts'

const requestSchema = z.object({
  designId: z.uuid(), nodeId: z.uuid(), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(160).optional(), previewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()
let bundledFont: Promise<string> | undefined
async function pages(root: string): Promise<readonly CopyOSPageDocument[]> {
  try { await stat(join(root, 'pages')) } catch (error: unknown) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
  return new CopyOSPageRepository().list(root)
}
function existing(document: CopyOSDesignDocument, page: CopyOSPageDocument): Extract<CopyOSDesignPagePreview, { state: 'existing' }> {
  if (!page.conversion) throw new CopyOSDesignError('Missing page conversion source metadata')
  const links = document.nodes.filter(node => node.pageLink?.pageId === page.id)
  const original = links.find(node => node.id === page.conversion?.linkedFrameId)
  return { state: 'existing', designId: document.id, nodeId: page.conversion.sourceFrameId, designRevision: document.revision, pageId: page.id, linkedFrameId: original?.id ?? (links.length === 1 ? links[0]?.id ?? null : null), title: page.title }
}
// Project image references become project-relative `assets/images/` paths, which Page Builder previews and page exports resolve.
async function ready(root: string, document: CopyOSDesignDocument, request: Omit<CopyOSDesignPagePreviewRequest, 'workspaceId'>): Promise<Extract<CopyOSDesignPagePreview, { state: 'ready' }>> {
  const compilation = compileDesignArtboard(document, request.nodeId)
  await new CopyOSDesignImageStore().requireHtmlImages(root, compilation.html)
  let html = designImageAssetPaths(compilation.html)
  if (compilation.fonts.some(family => /(?:^|[,"'\s])(?:Inter|CopyOSInter)(?:$|[,"'\s])/i.test(family))) {
    bundledFont ??= readFile(new URL('../fonts/Inter-latin.woff2', import.meta.url)).then(data => data.toString('base64'))
    const font = await bundledFont
    html = `<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-style:normal;font-weight:100 900}@font-face{font-family:CopyOSInter;src:url(data:font/woff2;base64,${font}) format('woff2');font-style:normal;font-weight:100 900}</style>${html}`
  }
  if (html.length > COPYOS_PAGE_HTML_MAX_LENGTH)
    throw new CopyOSDesignError(`Compiled page including embedded fonts exceeds the ${COPYOS_PAGE_HTML_MAX_LENGTH}-character page limit`)
  const previewHash = createHash('sha256').update(JSON.stringify({ version: 1, designId: document.id, nodeId: request.nodeId, sourceRevision: document.revision, ...compilation, html })).digest('hex')
  const title = request.title ?? document.nodes.find(node => node.id === request.nodeId)?.name.slice(0, 160) ?? document.title.slice(0, 160)
  return { state: 'ready', designId: document.id, nodeId: request.nodeId, sourceRevision: document.revision, ...compilation, html, previewHash, title }
}

const revisionNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const policy = z.enum(['keep-page', 'use-design'])
const resolutionsSchema = z.record(z.string().min(1).max(160), policy)
  .refine(value => Object.keys(value).length <= 4096, 'At most 4096 per-element resolutions').optional()
const updateSchema = z.object({ designId: z.uuid(), nodeId: z.uuid(), expectedRevision: revisionNumber,
  resolutions: resolutionsSchema }).strict()
const applySchema = updateSchema.extend({ expectedPageRevision: revisionNumber, previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  resolution: policy.optional() }).strict()
interface UpdatePlan {
  document: CopyOSDesignDocument
  page: CopyOSPageDocument
  conversion: CopyOSPageConversion
  sectionId: string
  variantId: string
  next: Extract<CopyOSDesignPagePreview, { state: 'ready' }>
  current: boolean
  merges: Record<DesignPageMergeResolution, DesignPageMergeResult>
  merge: (resolution: DesignPageMergeResolution, overrides: ReadonlyMap<string, DesignPageMergeResolution>) => DesignPageMergeResult
  describe: (keys: readonly string[]) => CopyOSDesignPageUpdateElement[]
}
// Admit per-element choices only for actual conflicts, so a stale or mistyped key never silently changes another element.
function overridesFor(resolutions: Readonly<Record<string, DesignPageMergeResolution>>,
  conflicts: readonly string[]): Map<string, DesignPageMergeResolution> {
  const known = new Set(conflicts), entries = Object.entries(resolutions)
  const unknown = entries.find(([key]) => !known.has(key))
  if (unknown) throw new CopyOSDesignError(`'${unknown[0]}' is not a conflicting element in this update; review the update again`)
  return new Map(entries)
}
// Write the exact generated HTML before any page references it; an interrupted publication leaves only an unreferenced file.
async function archiveGenerated(root: string, conversionId: string, html: string): Promise<string> {
  const path = `.copyos/conversions/${conversionId}/generated.html`
  await writeConversionArchive(root, path, html)
  return path
}
// Load the converted page, its unique converted variation, its exact archived output and the current compilation.
// Conversions without archived output recompile their source; compiler drift then can only add conflicts, never hide page edits.
async function updatePlan(root: string, request: z.infer<typeof updateSchema>): Promise<UpdatePlan> {
  const document = await new CopyOSDesignRepository().get(root, request.designId)
  if (document.revision !== request.expectedRevision)
    throw new CopyOSDesignError('Design changed in another editor. Reload the saved version before updating its page.')
  const built = (await pages(root)).filter(page => page.conversion?.sourceDesignId === document.id &&
    page.conversion.sourceFrameId === request.nodeId)
  const [page] = built, conversion = page?.conversion
  if (built.length !== 1 || !page || !conversion)
    throw new CopyOSDesignError(built.length ? 'Multiple pages reference this source artboard' : 'This artboard has no converted page to update')
  const marker = `data-canvas-conversion="${request.nodeId}"`
  const sections = page.sections.filter(section => section.variants.some(variant => variant.html.includes(marker)))
  const [section] = sections
  const candidates = sections.length === 1 && section ? section.variants.filter(variant => variant.html.includes(marker)) : []
  const variant = candidates.find(item => item.id === section?.selectedVariantId) ?? (candidates.length === 1 ? candidates[0] : undefined)
  if (!variant || !section) throw new CopyOSDesignError(
    'The converted content is missing from the page or appears in several sections or variations; restore one converted variation before updating')
  const archived = parseDesignDocument(JSON.parse(await readConversionArchive(root, conversion.snapshotPath)))
  const base = conversion.generatedPath ? { html: await readConversionArchive(root, conversion.generatedPath), mapping: conversion.mapping }
    : await ready(root, archived, { designId: archived.id, nodeId: request.nodeId, expectedRevision: archived.revision })
  const next = await ready(root, document, request)
  const mapping = new Map<string, DesignPageElementMapping>([...conversion.mapping, ...base.mapping, ...next.mapping]
    .map(item => [item.elementId, item]))
  const owned = new Set(mapping.keys())
  const merge = (resolution: DesignPageMergeResolution, overrides: ReadonlyMap<string, DesignPageMergeResolution>) =>
    mergeDesignPageHtml(base.html, variant.html, next.html, owned, resolution, overrides)
  const merges = { 'keep-page': merge('keep-page', new Map()), 'use-design': merge('use-design', new Map()) }
  const names = new Map([...archived.nodes, ...document.nodes].map(node => [node.id, node.name]))
  const describe = (keys: readonly string[]) => keys.map((key) => {
    const item = mapping.get(key), last = item?.instancePath.at(-1)
    const name = item ? `${names.get(item.nodeId) ?? item.nodeId}${last ? ` › ${names.get(last) ?? last}` : ''}` : key
    return { key, nodeId: item?.nodeId ?? null, name }
  })
  return { document, page, conversion, sectionId: section.id, variantId: variant.id, next, current: base.html === next.html,
    merges, merge, describe }
}

/** Native conversion API shared by the registered Remote and project-admitted AI tools. */
export class CopyOSDesignPageConversion {
  /** Review authoritative editable markup without changing project files.
   * @param root - Admitted project root.
   * @param input - Source artboard and exact saved revision.
   * @returns Compiled review or the existing page without overwriting Builder edits.
   */
  async preview(root: string, input: Omit<CopyOSDesignPagePreviewRequest, 'workspaceId'>): Promise<CopyOSDesignPagePreview> {
    const request = requestSchema.parse(input)
    return withProjectArtifactAccess(root, async () => {
      const document = await new CopyOSDesignRepository().get(root, request.designId)
      this.checkRevision(document, request.expectedRevision)
      const built = (await pages(root)).filter(page =>
        page.conversion?.sourceDesignId === document.id && page.conversion.sourceFrameId === request.nodeId)
      if (built.length > 1)
        throw new CopyOSDesignError('Multiple pages reference this source artboard; resolve the ambiguous conversion before continuing')
      return built[0] ? existing(document, built[0]) : ready(root, document, request)
    })
  }
  /** Recompile and atomically publish a new page beside its preserved original scene.
   * @param root - Admitted project root.
   * @param input - Exact source revision and reviewed authoritative preview hash.
   * @returns Saved page/design; repeat conversion preserves existing Builder edits.
   */
  async build(root: string, input: Omit<CopyOSDesignPageBuildRequest, 'workspaceId'>): Promise<CopyOSDesignPageBuildResult> {
    const request = requestSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
    return withProjectArtifactAccess(root, async () => {
      const document = await new CopyOSDesignRepository().get(root, request.designId)
      this.checkRevision(document, request.expectedRevision)
      const built = (await pages(root)).filter(page =>
        page.conversion?.sourceDesignId === document.id && page.conversion.sourceFrameId === request.nodeId)
      if (built.length > 1) throw new CopyOSDesignError('Multiple pages reference this source artboard')
      if (built[0]) return { state: 'existing', design: document, page: built[0], linkedFrameId: existing(document, built[0]).linkedFrameId }
      const preview = await ready(root, document, request)
      if (preview.previewHash !== request.previewHash)
        throw new CopyOSDesignError('Design preview changed or was not reviewed. Preview this saved artboard again before building.')
      const frame = document.nodes.find(node => node.id === request.nodeId)
      if (!frame) throw new CopyOSDesignError('Source artboard disappeared')
      const pageId = randomUUID(), sectionId = randomUUID(), variantId = randomUUID()
      const linkedFrameId = randomUUID(), conversionId = randomUUID()
      const snapshotPath = `.copyos/conversions/${conversionId}/source.design.json`
      const generatedPath = `.copyos/conversions/${conversionId}/generated.html`
      const now = new Date().toISOString()
      const slug = `${preview.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'page'}-${pageId.slice(0, 8)}`
      const page = parseCopyOSPageDocument({ schema: 'copyos.page', version: 1, revision: 0, id: pageId, title: preview.title, slug, status: 'draft', sections: [{ id: sectionId, title: preview.title, templateId: 'custom-html', selectedVariantId: variantId, variants: [{ id: variantId, label: 'Original', html: preview.html, createdAt: now }] }], comments: [], conversion: { version: 1, compilerVersion: 1, sourceDesignId: document.id, sourceFrameId: frame.id, sourceRevision: document.revision, linkedFrameId, snapshotPath, generatedPath, previewHash: preview.previewHash, mapping: preview.mapping }, createdAt: now, updatedAt: now }, 'write')
      // Clear every top-level layer on the same page that shares the screen's vertical band.
      const band = document.nodes.filter(node => node.parentId === null && node.pageId === frame.pageId &&
        node.y < frame.y + preview.height && node.y + node.height > frame.y)
      const right = Math.max(frame.x + preview.width, ...band.map(node => node.x + node.width)) + 80
      const x = right <= 1_000_000 ? right : Math.max(-1_000_000, Math.min(...band.map(node => node.x), frame.x) - preview.width - 80)
      const linked = { ...createDesignNode('frame', linkedFrameId, `${preview.title} · Builder`.slice(0, 200)), x, y: frame.y, width: preview.width, height: preview.height, ...(frame.pageId ? { pageId: frame.pageId } : {}), pageLink: { pageId, autoHeight: true } }
      const design = parseDesignDocument({
        ...document, nodes: [...document.nodes, linked], revision: document.revision + 1, updatedAt: now,
      })
      const designPath = `designs/${document.id}.design.json`
      const before = await readFile(join(root, designPath), 'utf8')
      // Catch direct external writers between the first read and journal preparation.
      const current = parseDesignDocument(JSON.parse(before))
      if (JSON.stringify(current) !== JSON.stringify(document)) throw new CopyOSDesignError('Design changed before conversion publication')
      const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
      await archiveGenerated(root, conversionId, preview.html)
      await commitProjectArtifacts(root, [{ path: snapshotPath, before: null, after: json(document) }, { path: `pages/${slug}-${pageId}.page.json`, before: null, after: json(page) }, { path: designPath, before, after: json(design) }])
      return { state: 'created', design, page, linkedFrameId }
    })
  }
  /** Review how the current saved design would update its converted page without writing project files.
   * @param root - Admitted project root.
   * @param input - Source artboard and exact saved design revision.
   * @returns Current state, or classified design changes, retained page edits, conflicts and both merged previews.
   */
  async reviewUpdate(root: string, input: Omit<CopyOSDesignPageUpdateRequest, 'workspaceId'>): Promise<CopyOSDesignPageUpdateReview> {
    const request = updateSchema.parse(input)
    return withProjectArtifactAccess(root, async () => {
      const plan = await updatePlan(root, request), revision = plan.page.revision ?? 0
      const identity = { designId: plan.document.id, nodeId: request.nodeId, pageId: plan.page.id, pageRevision: revision,
        sourceRevision: plan.document.revision }
      if (plan.current) return { state: 'current', ...identity }
      const keep = plan.merges['keep-page'], use = plan.merges['use-design']
      return { state: 'update', ...identity, previousSourceRevision: plan.conversion.sourceRevision, previewHash: plan.next.previewHash,
        width: plan.next.width, height: plan.next.height, designChanges: plan.describe(keep.designChanges),
        pageEdits: plan.describe(keep.pageEdits),
        conflicts: plan.describe(keep.conflicts), unplaced: { 'keep-page': plan.describe(keep.unplaced), 'use-design': plan.describe(use.unplaced) },
        html: { 'keep-page': keep.html, 'use-design': use.html }, warnings: plan.next.warnings,
        ...request.resolutions ? { selectedHtml: plan.merge('keep-page', overridesFor(request.resolutions, keep.conflicts)).html } : {} }
    })
  }
  /** Publish exactly the reviewed merge: archive the new source, then replace the converted variation in one guarded page revision.
   * @param root - Admitted project root.
   * @param input - Reviewed design/page revisions, compilation hash and the conflict policy when conflicts exist.
   * @returns Saved page; an orphaned archive after an interrupted page write is unreferenced and harmless.
   */
  async applyUpdate(root: string, input: Omit<CopyOSDesignPageUpdateApplyRequest, 'workspaceId'>): Promise<CopyOSDesignPageUpdateResult> {
    const request = applySchema.parse(input)
    return withProjectArtifactAccess(root, async () => {
      const plan = await updatePlan(root, request)
      if (plan.current) throw new CopyOSDesignError('The page already matches this design revision')
      if (plan.next.previewHash !== request.previewHash) throw new CopyOSDesignError('Design output changed after review. Review the update again.')
      if ((plan.page.revision ?? 0) !== request.expectedPageRevision)
        throw new CopyOSDesignError('Page changed in Builder after review. Review the update again.')
      const conflicts = plan.merges['keep-page'].conflicts, overrides = overridesFor(request.resolutions ?? {}, conflicts)
      if (conflicts.some(key => !overrides.has(key)) && !request.resolution)
        throw new CopyOSDesignError('Choose whether conflicting elements keep the page version or use the design version')
      const merge = plan.merge(request.resolution ?? 'keep-page', overrides)
      const conversionId = randomUUID(), snapshotPath = `.copyos/conversions/${conversionId}/source.design.json`
      const generatedPath = await archiveGenerated(root, conversionId, plan.next.html)
      await writeConversionArchive(root, snapshotPath, `${JSON.stringify(plan.document, null, 2)}\n`)
      const page = await new CopyOSPageRepository().updateConversionVariant(root, { pageId: plan.page.id,
        expectedRevision: request.expectedPageRevision, sectionId: plan.sectionId, variantId: plan.variantId, html: merge.html,
        conversion: { ...plan.conversion, sourceRevision: plan.document.revision, snapshotPath, generatedPath,
          previewHash: plan.next.previewHash,
          mapping: plan.next.mapping } })
      return { page, designChanges: merge.designChanges.length, pageEdits: merge.pageEdits.length, conflicts: merge.conflicts.length }
    })
  }
  private checkRevision(document: CopyOSDesignDocument, revision: number): void {
    if (document.revision !== revision) throw new CopyOSDesignError('Design changed in another editor. Reload the saved version before building this page.')
  }
}
