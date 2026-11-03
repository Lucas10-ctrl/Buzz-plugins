import { CopyOSDesignPageConversion } from './design-page-conversion.ts'
import type { CopyOSDesignPagePreviewRequest, CopyOSDesignPageBuildRequest, CopyOSDesignPagePreview, CopyOSDesignPageBuildResult,
  CopyOSDesignPageUpdateRequest, CopyOSDesignPageUpdateApplyRequest, CopyOSDesignPageUpdateReview, CopyOSDesignPageUpdateResult } from './types.ts'
/** Host Remote for portable CopyOS projects layered over Harness Workspaces. */

import { z } from 'zod'
import type { CopyOSDocCommentRequest } from './types.ts'
import type { CopyOSDocImportRequest, CopyOSDocAsset, CopyOSDocAssetPutRequest, CopyOSDocAssetReadRequest, CopyOSDocAssetReadValue, CopyOSDocDuplicateRequest, CopyOSDocTrashRequest } from './types.ts'
import { CopyOSDocRepository } from './docs.ts'
import type { CopyOSDocPresenceRequest, CopyOSDocPresenceValue } from './types.ts'
import type { CopyOSDocHistoryEntry, CopyOSDocHistoryListRequest, CopyOSDocHistoryListValue, CopyOSDocHistoryReadRequest, CopyOSDocHistoryReadValue, CopyOSDocHistoryNameRequest, CopyOSDocRestoreRequest } from './types.ts'
import type { CopyOSDocDocument, CopyOSDocListRequest, CopyOSDocListValue, CopyOSDocCreateRequest, CopyOSDocReadRequest, CopyOSDocSyncRequest, CopyOSDocControlRequest, CopyOSDocShareRequest, CopyOSDocShareValue, CopyOSDocExportRequest, CopyOSDocExportValue, CopyOSDocReviewRequest } from './types.ts'
export { CopyOSDocRepository } from './docs.ts'
export { TEMPLATE_COPY_SLOTS, STRATEGY_TEMPLATE_IDS, renderStrategySectionHtml, isTemplateSlot } from './strategy-templates.ts'
export type { CopyOSStrategySlot, CopyOSStrategySlotKind } from './strategy-templates.ts'
export { STRATEGY_SLOT_HEADINGS, LIBRARY_COPY_SLOTS, strategyDesignSlots } from './strategy-templates.ts'
export { STRATEGY_DOC_DECISIONS, STRATEGY_DOC_DECISION_LABELS, STRATEGY_DECISION_FENCE, STRATEGY_SECTION_FENCE, parseStrategyDecision,
  parseStrategySectionMarker, strategyDecisionMarkdown, strategySectionMarkerMarkdown, strategySectionCopyMarkdown, strategyDecisionFences,
  strategyMarkerFence, assertAssistantStrategyEdit, readStrategySection, readStrategyDocument, strategySectionAttachments,
  STRATEGY_STAGES, STRATEGY_STAGE_SECTIONS, STRATEGY_DOC_WHY_SECTION, STRATEGY_DOC_DATA_SECTION, STRATEGY_DOC_NARRATIVE_SECTION,
  isStrategyDocument, strategyStageProgress, strategyStageDecision } from './docs-strategy.ts'
export type { StrategyDocDecisionId, StrategyDocDecision, StrategyDocOption, StrategyDocDesign, StrategyDocSectionMarker,
  StrategyDocDecisionFence, StrategyDocMarkerFence, StrategyDocBlock, StrategyDocSection, StrategyDocReading,
  StrategyStageId, StrategyStageDocument, StrategyStageProgress } from './docs-strategy.ts'
import { createStrategyDocument } from './strategy-docs.ts'
import type { CopyOSStrategyDocCreateRequest } from './types.ts'
export { createStrategyDocument, STRATEGY_DOC_MAIN_TAB, STRATEGY_DOC_PAGE_TAB } from './strategy-docs.ts'
import { getBundledDesignFontMetadata } from './design-font-metadata.ts'
import type { CopyOSDesignFontMetadata, CopyOSDesignFontMetadataRequest } from './types.ts'
import type { CopyOSDesignFontFace, CopyOSDesignFontInstallRequest, CopyOSDesignFontInstallValue, CopyOSDesignFontList } from './types.ts'
import type { CopyOSDesignFontListRequest, CopyOSDesignFontReadRequest, CopyOSDesignFontReadValue, CopyOSDesignFontUploadRequest } from './types.ts'
import { CopyOSDesignFontStore } from './design-font-store.ts'
export { CopyOSDesignFontStore, CopyOSDesignFontError, loadDesignProjectFonts, DESIGN_FONT_DIRECTORY } from './design-font-store.ts'
import { randomUUID } from 'node:crypto'
import { captureDesignClipboard, importDesignClipboard } from './design-model.ts'
import { decodeFigClipboardSelection } from './fig-clipboard-service.ts'
import type { FigClipboardDecodeResult } from './types.ts'
import type { CopyOSDesignClipboardDecodeRequest } from './types.ts'
import { importFigDesign } from './fig-import-service.ts'
import { CopyOSDesignRepository, CopyOSDesignError } from './designs.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import { DESIGN_IMAGE_ASSET_MAX_BYTES } from './design-image-assets.ts'
import type { CopyOSDesignImageCopyRequest, CopyOSDesignImagePutRequest, CopyOSDesignImagePutValue, CopyOSDesignImageRemoveRequest,
  CopyOSDesignImageUnusedRequest, CopyOSDesignImageUnusedValue } from './types.ts'
import { CopyOSGenerationError, CopyOSGenerationRepository, CopyOSGenerationService, HiggsfieldProvider } from './generations.ts'
import type { CopyOSGenerationCancelRequest, CopyOSGenerationImageRequest, CopyOSGenerationImageValue, CopyOSGenerationListRequest,
  CopyOSGenerationListValue, CopyOSGenerationRecord, CopyOSGenerationSettings, CopyOSGenerationStartRequest } from './types.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CopyOSDesignDocument, CopyOSDesignListRequest, CopyOSDesignListValue, CopyOSDesignReadRequest, CopyOSDesignCreateRequest, CopyOSDesignSaveRequest, CopyOSDesignImportRequest } from './types.ts'
import { CopyOSReusableSectionRepository, copyosSectionLibraryRoot } from './reusable-sections.ts'
import { CopyOSDesignCommentRepository } from './design-comments.ts'
import { CopyOSDesignTemplateRepository, copyosDesignTemplateLibraryRoot } from './design-templates.ts'
import type { CopyOSDesignComment, CopyOSDesignCommentCreateRequest, CopyOSDesignCommentDeleteRequest, CopyOSDesignCommentList,
  CopyOSDesignCommentListRequest, CopyOSDesignCommentStatusRequest, CopyOSDesignTemplateDeleteRequest, CopyOSDesignTemplateList,
  CopyOSDesignTemplateListRequest, CopyOSDesignTemplateRead, CopyOSDesignTemplateReadRequest, CopyOSDesignTemplateSaveRequest,
  CopyOSDesignTemplateSummary } from './types.ts'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  CopyOSExperimentFormatError,
  CopyOSExperimentNotFoundError,
  CopyOSExperimentRepository,
} from './experiments.ts'
import {
  CopyOSAssetFormatError,
  CopyOSAssetNotFoundError,
  CopyOSAssetRepository,
} from './assets.ts'
import {
  CopyOSKnowledgeFormatError,
  CopyOSKnowledgeNotFoundError,
  CopyOSKnowledgeRepository,
} from './knowledge.ts'
import {
  CopyOSPageFormatError,
  CopyOSPageNotFoundError,
  CopyOSPageRepository,
} from './pages.ts'
import { CopyOSProjectFormatError, CopyOSProjectPathError, CopyOSProjectRepository } from './repository.ts'
import {
  CopyOSScriptFormatError,
  CopyOSScriptNotFoundError,
  CopyOSScriptRepository,
} from './scripts.ts'
import { CopyOSSessionLinkFormatError, CopyOSSessionLinkRepository } from './session-links.ts'
import { CopyOSStyleGuideFormatError, CopyOSStyleGuideRepository } from './style-guide.ts'
import {
  CopyOSSkillConflictError,
  CopyOSSkillFormatError,
  CopyOSSkillRepository,
} from './skills.ts'
import type {
  CopyOSDesignCopyLayersRequest,
  CopyOSDesignCopyLayersValue,
  CopyOSAssetListRequest,
  CopyOSAssetListValue,
  CopyOSBriefCreateRequest,
  CopyOSBriefDocument,
  CopyOSBrandCreateRequest,
  CopyOSBrandDocument,
  CopyOSCopyCreateRequest,
  CopyOSCopyDocument,
  CopyOSCopyVariantCreateRequest,
  CopyOSExperimentCreateRequest,
  CopyOSExperimentDocument,
  CopyOSExperimentListRequest,
  CopyOSExperimentListValue,
  CopyOSExperimentResultRequest,
  CopyOSExperimentStartRequest,
  CopyOSKnowledgeListRequest,
  CopyOSKnowledgeListValue,
  CopyOSReusableSectionDocument,
  CopyOSReusableSectionSaveRequest,
  CopyOSReusableSectionMoveRequest,
  CopyOSReusableSectionDeleteRequest,
  CopyOSReusableSectionListValue,
  CopyOSPageCreateRequest,
  CopyOSPageCommentCreateRequest,
  CopyOSPageCommentStatusRequest,
  CopyOSPageDocument,
  CopyOSPageExportRequest,
  CopyOSPageExportValue,
  CopyOSPageListRequest,
  CopyOSPageListValue,
  CopyOSPageSectionCreateRequest,
  CopyOSPageSectionDeleteRequest,
  CopyOSPageSectionMoveRequest,
  CopyOSPageSectionRenameRequest,
  CopyOSPageSectionVariantCreateRequest,
  CopyOSPageSectionVariantSelectRequest,
  CopyOSPageSectionVariantUpdateRequest,
  CopyOSPageVariantsUpdateRequest,
  CopyOSProjectCreateRequest,
  CopyOSProjectChangeFolderRequest,
  CopyOSProjectListValue,
  CopyOSProjectView,
  CopyOSResearchCreateRequest,
  CopyOSResearchDocument,
  CopyOSScriptCreateRequest,
  CopyOSScriptDocument,
  CopyOSScriptListRequest,
  CopyOSScriptListValue,
  CopyOSScriptVariantCreateRequest,
  CopyOSStyleGuideDocument,
  CopyOSStyleGuideGetRequest,
  CopyOSStyleGuideGetValue,
  CopyOSStyleGuideSaveRequest,
  CopyOSSessionLinkListRequest,
  CopyOSSessionLinkListValue,
  CopyOSSkillDocument,
  CopyOSSkillEnabledRequest,
  CopyOSSkillImportRequest,
  CopyOSSkillListRequest,
  CopyOSSkillListValue,
  CopyOSSkillSaveRequest,
} from './types.ts'

export * from './reusable-sections.ts'
export * from './design-comments.ts'
export * from './design-templates.ts'
export * from './assets.ts'
export * from './experiments.ts'
export * from './knowledge.ts'
export * from './pages.ts'
export * from './page-elements.ts'
export * from './designs.ts'
export * from './generations.ts'
export * from './repository.ts'
export * from './scripts.ts'
export * from './session-links.ts'
export * from './style-guide.ts'
export * from './skills.ts'
export type * from './types.ts'
export type { FigClipboardDecodeResult } from './types.ts'

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every(item => typeof item === 'string')
}

const COPYOS_UNIVERSAL_SKILLS_ROOT = resolve(
  process.env.COPYOS_SKILLS_DIR
    ?? fileURLToPath(new URL('../../../../skills/', import.meta.url)),
)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** CopyOS project marker and Workspace bridge. */
    copyosProjects: CopyOSProjects
  }
}

/** Shared reusable-section library and Higgsfield generation configuration. */
export interface Config {
  /** Directory for the library shared by CopyOS workspaces and chat; use the same path in both plugins. */
  sectionLibraryRoot: string
  /** Directory for the Canvas template library shared by CopyOS workspaces and chat; use the same path in both plugins. */
  designTemplateLibraryRoot: string
  /** Credentials-service reference holding Higgsfield `KEY_ID:KEY_SECRET`; Higgsfield's SDK documents `HF_CREDENTIALS`. */
  higgsfieldCredentialRef: string
  /** Higgsfield queue API origin. */
  higgsfieldBaseUrl: string
  /** Text-to-image model path; it must accept `prompt`, `aspect_ratio`, `resolution` and `batch_size`. */
  higgsfieldImageModel: string
  /** Delay between status polls; Higgsfield's SDK polls every 2 seconds. */
  generationPollIntervalMs: number
  /** Unused-image cleanup keeps image files modified more recently than this, covering images stored but not yet saved into a design. */
  unusedImageMinimumAgeMs: number
  /** Whether the Canvas may install fonts its designs use from Google Fonts into the project. */
  googleFonts: boolean
  /** Google Fonts CSS API v2 endpoint. */
  googleFontsCssUrl: string
}
/** Shared section storage visible to every workspace and CopyOS chat, plus Higgsfield generation settings. */
export const Config = Schema.object({
  sectionLibraryRoot: Schema.string().default(copyosSectionLibraryRoot()),
  designTemplateLibraryRoot: Schema.string().default(copyosDesignTemplateLibraryRoot()),
  higgsfieldCredentialRef: Schema.string().role('credential-ref').pattern(/^[A-Z_][A-Z0-9_]*$/).default('HF_CREDENTIALS'),
  higgsfieldBaseUrl: Schema.string().pattern(/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/).default('https://api.higgsfield.ai'),
  higgsfieldImageModel: Schema.string().pattern(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/).default('higgsfield-ai/soul/v2/standard'),
  generationPollIntervalMs: Schema.natural().min(250).max(60_000).default(2000),
  unusedImageMinimumAgeMs: Schema.natural().min(60_000).default(3_600_000),
  googleFonts: Schema.boolean().default(true),
  googleFontsCssUrl: Schema.string().pattern(/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/).default('https://fonts.googleapis.com/css2'),
})

/** Browser-facing CopyOS project operations. */
export class CopyOSProjects extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']
  static Config = Config
  private readonly repository = new CopyOSProjectRepository()
  private folderChangeChain: Promise<void> = Promise.resolve()
  private readonly assets = new CopyOSAssetRepository()
  private readonly pages = new CopyOSPageRepository()
  private readonly designs = new CopyOSDesignRepository()
  private readonly designImages = new CopyOSDesignImageStore()
  private readonly reusableSections: CopyOSReusableSectionRepository
  private readonly designComments = new CopyOSDesignCommentRepository()
  private readonly designTemplates: CopyOSDesignTemplateRepository
  private readonly knowledge = new CopyOSKnowledgeRepository()
  private readonly docs = new CopyOSDocRepository()
  private readonly scripts = new CopyOSScriptRepository()
  private readonly experiments = new CopyOSExperimentRepository()
  private readonly sessionLinks = new CopyOSSessionLinkRepository()
  private readonly styleGuide = new CopyOSStyleGuideRepository()
  private readonly skills = new CopyOSSkillRepository(COPYOS_UNIVERSAL_SKILLS_ROOT)
  private readonly generations: CopyOSGenerationService
  private readonly generationSettings: CopyOSGenerationSettings
  private readonly unusedImageMinimumAgeMs: number
  private readonly designFonts = new CopyOSDesignFontStore()
  private readonly googleFonts: { cssUrl: string } | undefined

  /** @param ctx - Host context with the durable Workspace registry. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'copyosProjects', { namespace: 'copyosProjects' })
    this.reusableSections = new CopyOSReusableSectionRepository(config.sectionLibraryRoot)
    this.designTemplates = new CopyOSDesignTemplateRepository(config.designTemplateLibraryRoot)
    this.unusedImageMinimumAgeMs = config.unusedImageMinimumAgeMs
    this.googleFonts = config.googleFonts ? { cssUrl: config.googleFontsCssUrl } : undefined
    const ref = credentialRef(config.higgsfieldCredentialRef)
    this.generationSettings = { provider: 'higgsfield', credentialRef: ref, model: config.higgsfieldImageModel }
    this.generations = new CopyOSGenerationService({
      provider: new HiggsfieldProvider({ baseUrl: config.higgsfieldBaseUrl,
        resolveCredentials: async () => (await ctx.get('credentials')?.resolve(ref))?.value }),
      repository: new CopyOSGenerationRepository(), model: config.higgsfieldImageModel,
      pollIntervalMs: config.generationPollIntervalMs,
    })
    ctx.effect(() => () => { void this.generations.dispose() }, 'copyos-projects: generation pollers')
  }

  /** Create a Suite strategy document with one section per strategy stage.
   * @param request - Workspace, title and the Session that shows the document.
   * @returns The saved document.
   */
  @Remote
  async createStrategyDoc(request: CopyOSStrategyDocCreateRequest): Promise<CopyOSDocDocument> {
    const { workspaceId, ...input } = request
    return await createStrategyDocument(this.docs, await this.projectPath(workspaceId), input)
  }

  /** List Suite documents in a registered workspace.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async listDocs(request: CopyOSDocListRequest): Promise<CopyOSDocListValue> {
    return { documents: await this.docs.list(await this.projectPath(request.workspaceId), request.trashed) }
  }

  /** Import UTF-8 Markdown or text as a new private document.
   * @param request - Workspace, filename and encoded contents.
   * @returns Complete imported document in its initial revision.
   */
  @Remote
  async importDoc(request: CopyOSDocImportRequest): Promise<CopyOSDocDocument> {
    return this.docs.import(await this.projectPath(request.workspaceId), request)
  }

  /** Upload one image or file through the document's editor capability.
   * @param request - Document, optional link capability, original filename and bytes.
   * @returns Public attachment metadata.
   */
  @Remote
  async putDocAsset(request: CopyOSDocAssetPutRequest): Promise<CopyOSDocAsset> {
    return this.docs.putAsset(await this.projectPath(request.workspaceId), request)
  }
  /** Read a document-scoped attachment after checking access and manifest ownership.
   * @param request - Document, optional link capability and attachment hash.
   * @returns Verified original bytes and filename metadata.
   */
  @Remote
  async readDocAsset(request: CopyOSDocAssetReadRequest): Promise<CopyOSDocAssetReadValue> {
    return this.docs.readAsset(await this.projectPath(request.workspaceId), request)
  }

  /** Duplicate a saved document with new identities and private access.
   * @param request - Source document and localized copy title.
   * @returns Independent saved document.
   */
  @Remote
  async duplicateDoc(request: CopyOSDocDuplicateRequest): Promise<CopyOSDocDocument> {
    return this.docs.duplicate(await this.projectPath(request.workspaceId), request)
  }
  /** Move a document to recoverable trash or restore it.
   * @param request - Document and desired trash state.
   * @returns Current document with all retained content and discussion.
   */
  @Remote
  async trashDoc(request: CopyOSDocTrashRequest): Promise<CopyOSDocDocument> {
    return this.docs.trash(await this.projectPath(request.workspaceId), request)
  }

  /** Create, reply to, moderate or react to a document comment with the caller's capability.
   * @param request - Workspace, document and human comment action.
   * @returns The current document with permission-derived comment projections.
   */
  @Remote
  async commentDoc(request: CopyOSDocCommentRequest): Promise<CopyOSDocDocument> {
    return this.docs.comment(await this.projectPath(request.workspaceId), request)
  }

  /** List a bounded page of saved document revisions for an editor.
   * @param request - Workspace, document and optional older-revision cursor.
   * @returns Committed timeline entries and the current head revision.
   */
  @Remote
  async listDocHistory(request: CopyOSDocHistoryListRequest): Promise<CopyOSDocHistoryListValue> {
    return this.docs.listHistory(await this.projectPath(request.workspaceId), request)
  }

  /** Read saved text and its preceding revision for comparison.
   * @param request - Workspace, document and saved revision.
   * @returns Text-only historical projections.
   */
  @Remote
  async readDocHistory(request: CopyOSDocHistoryReadRequest): Promise<CopyOSDocHistoryReadValue> {
    return this.docs.readHistory(await this.projectPath(request.workspaceId), request)
  }

  /** Name a version without changing its text.
   * @param request - Workspace, document, revision and name.
   * @returns Updated timeline entry.
   */
  @Remote
  async nameDocVersion(request: CopyOSDocHistoryNameRequest): Promise<CopyOSDocHistoryEntry> {
    return this.docs.nameHistory(await this.projectPath(request.workspaceId), request)
  }

  /** Restore historical text as a new revision while retaining current permissions.
   * @param request - Workspace, document, saved version and expected current revision.
   * @returns The restored document with a new content revision.
   */
  @Remote
  async restoreDocVersion(request: CopyOSDocRestoreRequest): Promise<CopyOSDocDocument> {
    return this.docs.restore(await this.projectPath(request.workspaceId), request)
  }

  /** Review an anchored assistant edit without overwriting concurrent changes.
   * @param request - Document, suggestion and review decision.
   * @returns The current document with the reviewed proposal.
   */
  @Remote
  async reviewDocSuggestion(request: CopyOSDocReviewRequest): Promise<CopyOSDocDocument> {
    return this.docs.review(await this.projectPath(request.workspaceId), request)
  }

  /** Create a persisted blank document or outline.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async createDoc(request: CopyOSDocCreateRequest): Promise<CopyOSDocDocument> {
    return this.docs.create(await this.projectPath(request.workspaceId), request)
  }

  /** Read a saved document with an optional link capability.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async readDoc(request: CopyOSDocReadRequest): Promise<CopyOSDocDocument> {
    return this.docs.get(await this.projectPath(request.workspaceId), request)
  }

  /** Exchange ephemeral pane presence using the current document capability.
   * @param request - Document, pane identity and tab/cursor or leave state.
   * @returns Other active, authorized panes; no content revision is created.
   */
  @Remote
  async presenceDoc(request: CopyOSDocPresenceRequest): Promise<CopyOSDocPresenceValue> {
    const { workspaceId, ...input } = request
    return this.docs.presence(await this.projectPath(workspaceId), input)
  }

  /** Merge a document update without replacing concurrent text.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async syncDoc(request: CopyOSDocSyncRequest): Promise<CopyOSDocDocument> {
    return this.docs.sync(await this.projectPath(request.workspaceId), request)
  }

  /** Stop or resume generation and invalidate previous agent writes.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async controlDoc(request: CopyOSDocControlRequest): Promise<CopyOSDocDocument> {
    return this.docs.control(await this.projectPath(request.workspaceId), request)
  }

  /** Issue a document capability or revoke existing links.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async shareDoc(request: CopyOSDocShareRequest): Promise<CopyOSDocShareValue> {
    return this.docs.share(await this.projectPath(request.workspaceId), request)
  }

  /** Render the stored document as Markdown, PDF or editable Word.
   * @param request - Workspace and document operation fields.
   * @returns The persisted operation result.
   */
  @Remote
  async exportDoc(request: CopyOSDocExportRequest): Promise<CopyOSDocExportValue> {
    return this.docs.export(await this.projectPath(request.workspaceId), request)
  }

  /**
   * Read the generation provider settings the Canvas needs; the secret is never included.
   * @returns Provider, credentials reference and model path.
   */
  @Remote
  getGenerationSettings(): Promise<CopyOSGenerationSettings> {
    return Promise.resolve(this.generationSettings)
  }

  /**
   * Submit one billable Higgsfield text-to-image generation; the server polls it until it finishes.
   * @param request - Workspace, prompt, aspect ratio and resolution.
   * @returns The saved record; a provider rejection is saved as `failed`.
   * @throws {RemoteError} If the request is invalid or credentials are missing; nothing is sent then.
   */
  @Remote
  async startGeneration(request: CopyOSGenerationStartRequest): Promise<CopyOSGenerationRecord> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.generations.start(root, request) } catch (error) { this.rethrowGenerationError(error) }
  }

  /**
   * List a project's generations, resuming server polling for unfinished ones after a restart.
   * @param request - Workspace identity.
   * @returns Records, newest first.
   */
  @Remote
  async listGenerations(request: CopyOSGenerationListRequest): Promise<CopyOSGenerationListValue> {
    const root = await this.projectPath(request.workspaceId)
    try { return { generations: await this.generations.list(root) } } catch (error) { this.rethrowGenerationError(error) }
  }

  /**
   * Ask Higgsfield to cancel a queued or running generation.
   * @param request - Workspace and generation identity.
   * @returns The record marked `cancelRequested`; its status changes when Higgsfield reports cancellation.
   * @throws {RemoteError} If the generation finished, is unconfirmed or Higgsfield refuses.
   */
  @Remote
  async cancelGeneration(request: CopyOSGenerationCancelRequest): Promise<CopyOSGenerationRecord> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.generations.cancel(root, request.id) } catch (error) { this.rethrowGenerationError(error) }
  }

  /**
   * Read one saved generation result as a data URL for a Canvas image layer.
   * @param request - Workspace, generation identity and result position.
   * @returns Data URL and image type.
   * @throws {RemoteError} If the result is missing or larger than a design image allows.
   */
  @Remote
  async readGenerationImage(request: CopyOSGenerationImageRequest): Promise<CopyOSGenerationImageValue> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.generations.readImage(root, request.id, request.index) } catch (error) { this.rethrowGenerationError(error) }
  }

  /**
   * Store one image as a project file for Canvas image layers; identical bytes share one file.
   * @param request - Workspace and base64 image bytes.
   * @returns The reference to place in a design image field.
   * @throws {RemoteError} If the bytes are not a PNG, JPEG, WebP or GIF image or exceed the design image size limit.
   */
  @Remote
  async putDesignImage(request: CopyOSDesignImagePutRequest): Promise<CopyOSDesignImagePutValue> {
    const root = await this.projectPath(request.workspaceId)
    if (typeof request.dataBase64 !== 'string' || request.dataBase64.length > Math.ceil(DESIGN_IMAGE_ASSET_MAX_BYTES / 3) * 4)
      throw new RemoteError('gateway/bad-request', `Image exceeds the ${DESIGN_IMAGE_ASSET_MAX_BYTES}-byte limit`, {})
    try { return { url: await this.designImages.put(root, Buffer.from(request.dataBase64, 'base64')) } }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Copy referenced image files into a project from the project a pasted selection came from; files already present are kept.
   * @param request - Target and source workspaces and the pasted image references (at most 1,000).
   * @throws {RemoteError} If a workspace is not registered or a source file is missing or corrupted.
   */
  @Remote
  async copyDesignImages(request: CopyOSDesignImageCopyRequest): Promise<void> {
    if (!Array.isArray(request.urls) || request.urls.length > 1000 || request.urls.some(url => typeof url !== 'string'))
      throw new RemoteError('gateway/bad-request', 'Supply at most 1000 image references', {})
    const [sourcePath, targetPath] = await Promise.all([this.projectPath(request.sourceWorkspaceId), this.projectPath(request.workspaceId)])
    try { await this.designImages.copyImages(sourcePath, targetPath, request.urls) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * List stored project images that no project file names and the caller does not hold; nothing is deleted.
   * @param request - Workspace and the image references an open editor still holds (at most 10,000).
   * @returns Unused files older than the configured minimum age, sorted by name.
   * @throws {RemoteError} If the workspace is not registered or `keep` is malformed.
   */
  @Remote
  async findUnusedDesignImages(request: CopyOSDesignImageUnusedRequest): Promise<CopyOSDesignImageUnusedValue> {
    const root = await this.projectPath(request.workspaceId)
    return { files: await this.designImages.findUnusedImages(root, this.unusedImageOptions(request.keep)) }
  }

  /**
   * Delete confirmed unused project images after scanning the project again; files that became used or are too new stay.
   * @param request - Workspace, the references an open editor still holds and the confirmed file names (each at most 10,000).
   * @returns The files deleted.
   * @throws {RemoteError} If the workspace is not registered or a list is malformed.
   */
  @Remote
  async removeUnusedDesignImages(request: CopyOSDesignImageRemoveRequest): Promise<CopyOSDesignImageUnusedValue> {
    if (!stringList(request.fileNames)) throw new RemoteError('gateway/bad-request', 'Supply at most 10000 image file names', {})
    const root = await this.projectPath(request.workspaceId)
    return { files: await this.designImages.removeUnusedImages(root, request.fileNames, this.unusedImageOptions(request.keep)) }
  }

  /**
   * List the fonts installed in a project.
   * @param request - Registered workspace.
   * @returns Installed faces.
   */
  @Remote
  async listDesignFonts(request: CopyOSDesignFontListRequest): Promise<CopyOSDesignFontList> {
    return { faces: await this.designFonts.list(await this.projectPath(request.workspaceId)) }
  }

  /**
   * Install families a design uses from Google Fonts into the project (Latin characters).
   * @param request - Registered workspace and at most 20 CSS family names of 1–200 characters.
   * @returns Installed faces and families Google Fonts does not provide; with Google Fonts disabled every family is unavailable.
   * @throws {RemoteError} If the request is malformed or Google Fonts cannot be reached.
   */
  @Remote
  async installDesignFonts(request: CopyOSDesignFontInstallRequest): Promise<CopyOSDesignFontInstallValue> {
    const root = await this.projectPath(request.workspaceId)
    if (!Array.isArray(request.families) || request.families.length > 20 ||
      !request.families.every(family => typeof family === 'string' && family.length > 0 && family.length <= 200))
      throw new RemoteError('gateway/bad-request', 'Supply at most 20 font family names of 1–200 characters', {})
    if (!this.googleFonts) return { faces: [], unavailable: [...request.families] }
    const source = { cssUrl: this.googleFonts.cssUrl, fetch: globalThis.fetch }
    try { return await this.designFonts.installGoogle(root, request.families, source) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Add a user font file to the project.
   * @param request - Registered workspace, original file name and base64 bytes (at most 10 MB).
   * @returns The installed face, read from the file's own metadata.
   * @throws {RemoteError} If the file is not a single readable TTF, OTF, WOFF or WOFF2 face.
   */
  @Remote
  async uploadDesignFont(request: CopyOSDesignFontUploadRequest): Promise<CopyOSDesignFontFace> {
    const root = await this.projectPath(request.workspaceId)
    if (typeof request.dataBase64 !== 'string' || request.dataBase64.length > 13_400_000 || typeof request.fileName !== 'string' ||
      request.fileName.length > 255) throw new RemoteError('gateway/bad-request', 'Supply a font file of at most 10 MB', {})
    try { return await this.designFonts.upload(root, Buffer.from(request.dataBase64, 'base64')) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Read one installed font file for the Canvas.
   * @param request - Registered workspace and manifest file name.
   * @returns Base64 bytes and MIME type.
   * @throws {RemoteError} If the file is not installed.
   */
  @Remote
  async readDesignFont(request: CopyOSDesignFontReadRequest): Promise<CopyOSDesignFontReadValue> {
    const root = await this.projectPath(request.workspaceId)
    try {
      const { bytes, mimeType } = await this.designFonts.read(root, request.file)
      return { dataBase64: bytes.toString('base64'), mimeType }
    } catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  private unusedImageOptions(keep: unknown): { keep: string[]; minimumAgeMs: number; now: number } {
    if (!stringList(keep)) throw new RemoteError('gateway/bad-request', 'Supply at most 10000 kept image references', {})
    return { keep, minimumAgeMs: this.unusedImageMinimumAgeMs, now: Date.now() }
  }

  /**
   * Read every registered Workspace carrying a valid CopyOS marker.
   * @returns current portable CopyOS project projections in Workspace order.
   */
  @Remote
  async list(): Promise<CopyOSProjectListValue> {
    const projects: CopyOSProjectView[] = []
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      const document = await this.repository.read(workspace.path)
      if (document === undefined) continue
      projects.push({ ...document, workspaceId: workspace.id, path: workspace.path })
    }
    return { projects }
  }

  /**
   * Read the shared section library, importing registered workspace libraries.
   * @param request - Workspace whose section library is requested.
   * @returns the current saved section library.
   */
  @Remote
  async listReusableSections(request: CopyOSPageListRequest): Promise<CopyOSReusableSectionListValue> {
    await this.projectPath(request.workspaceId)
    return { sections: await this.reusableSections.listShared(this.ctx.workspaceRegistry.list().map(workspace => workspace.path)) }
  }

  /**
   * Save a reusable section copy without changing the source page.
   * @param request - Workspace and section library fields.
   * @returns the saved section after durable storage succeeds.
   */
  @Remote
  async saveReusableSection(request: CopyOSReusableSectionSaveRequest): Promise<CopyOSReusableSectionDocument> {
    const root = await this.projectPath(request.workspaceId)
    const { workspaceId: _workspaceId, ...fields } = request
    try { return await this.reusableSections.saveShared(root, fields) } catch (error) {
      if (error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {})
      throw error
    }
  }

  /**
   * Move a saved library section without changing its name, HTML or identity.
   * @param request - Registered workspace, saved section and destination category.
   * @returns the moved shared section.
   */
  @Remote
  async moveReusableSection(request: CopyOSReusableSectionMoveRequest): Promise<CopyOSReusableSectionDocument> {
    await this.projectPath(request.workspaceId)
    try {
      return await this.reusableSections.moveShared(request.sectionId, request.category,
        this.ctx.workspaceRegistry.list().map(workspace => workspace.path))
    } catch (error) {
      if (error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {})
      throw error
    }
  }

  /**
   * Delete only the shared library entry after explicit user confirmation.
   * @param request - Registered workspace, saved section and confirmation.
   * @returns after durable deletion; existing page copies are unchanged.
   */
  @Remote
  async deleteReusableSection(request: CopyOSReusableSectionDeleteRequest): Promise<void> {
    await this.projectPath(request.workspaceId)
    try {
      await this.reusableSections.deleteShared(request.sectionId, request.confirmDelete,
        this.ctx.workspaceRegistry.list().map(workspace => workspace.path))
    } catch (error) {
      if (error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {})
      throw error
    }
  }

  /**
   * Create or adopt a portable project and register its folder as a Workspace.
   * @param request - existing directory and optional initial display name.
   * @returns the portable project joined with its Harness Workspace identity.
   */
  @Remote
  async create(request: CopyOSProjectCreateRequest): Promise<CopyOSProjectView> {
    try {
      const initialized = await this.repository.initialize(request.path, request.name)
      const workspace = await this.ctx.workspaceRegistry.create(initialized.path, initialized.document.name)
      if (workspace.title !== initialized.document.name) await workspace.setTitle(initialized.document.name)
      return {
        ...initialized.document,
        workspaceId: workspace.id,
        path: workspace.path,
      }
    } catch (error: unknown) {
      if (error instanceof CopyOSProjectPathError || error instanceof CopyOSProjectFormatError) {
        throw new RemoteError('gateway/bad-request', error.message, {})
      }
      throw error
    }
  }

  /**
   * Use another folder in the original sidebar position without moving files or rewriting Session cwd.
   * The destination is initialized or adopted before the old registration is removed.
   * @param request - current Workspace identity and existing destination directory.
   * @returns the destination project and its Workspace identity.
   */
  @Remote
  changeFolder(request: CopyOSProjectChangeFolderRequest): Promise<CopyOSProjectView> {
    const operation = this.folderChangeChain.then(async () => {
      const registry = this.ctx.workspaceRegistry
      const previous = registry.get(WorkspaceId(request.workspaceId))
      if (previous === undefined) throw new RemoteError('workspace/not-found', 'The workspace no longer exists.', { workspaceId: WorkspaceId(request.workspaceId) })
      const destination = await this.create({ path: request.path, name: previous.title })
      if (destination.workspaceId === previous.id) return destination
      await registry.insertBefore(WorkspaceId(destination.workspaceId), previous.id)
      await registry.delete(previous.id)
      return destination
    })
    // A rejected change must not prevent subsequent folder choices from running.
    this.folderChangeChain = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * Read the project-wide visual system, when configured.
   * @param request - Workspace identity whose style guide should be read.
   * @returns the optional project style guide.
   */
  @Remote
  async getStyleGuide(request: CopyOSStyleGuideGetRequest): Promise<CopyOSStyleGuideGetValue> {
    try {
      return { styleGuide: await this.styleGuide.get(await this.projectPath(request.workspaceId)) }
    } catch (error: unknown) {
      this.rethrowStyleGuideError(error)
    }
  }

  /**
   * Save user-owned CSS and its extracted tokens as the project visual system.
   * @param request - Workspace identity and complete style-guide source.
   * @returns the stored project style guide.
   */
  @Remote
  async saveStyleGuide(request: CopyOSStyleGuideSaveRequest): Promise<CopyOSStyleGuideDocument> {
    try {
      const { workspaceId: _workspaceId, ...document } = request
      return await this.styleGuide.save(await this.projectPath(request.workspaceId), document)
    } catch (error: unknown) {
      this.rethrowStyleGuideError(error)
    }
  }

  /**
   * List editable project and universal skills visible from one CopyOS project.
   * @param request - Workspace identity used to resolve project skills.
   * @returns the editable skill catalog.
   */
  @Remote
  async listSkills(request: CopyOSSkillListRequest): Promise<CopyOSSkillListValue> {
    try {
      return { skills: await this.skills.list(await this.projectPath(request.workspaceId)) }
    } catch (error: unknown) {
      this.rethrowSkillError(error)
    }
  }

  /**
   * Create or replace one native Harness skill.
   * @param request - Workspace identity and canonical skill fields.
   * @returns the stored skill document.
   */
  @Remote
  async saveSkill(request: CopyOSSkillSaveRequest): Promise<CopyOSSkillDocument> {
    try {
      const { workspaceId: _workspaceId, ...skill } = request
      return await this.skills.save(await this.projectPath(request.workspaceId), skill)
    } catch (error: unknown) {
      this.rethrowSkillError(error)
    }
  }

  /**
   * Import a complete Markdown skill into a native Harness skill root.
   * @param request - Workspace identity, target scope, and Markdown source.
   * @returns the imported skill document.
   */
  @Remote
  async importSkill(request: CopyOSSkillImportRequest): Promise<CopyOSSkillDocument> {
    try {
      const { workspaceId: _workspaceId, ...skill } = request
      return await this.skills.import(await this.projectPath(request.workspaceId), skill)
    } catch (error: unknown) {
      this.rethrowSkillError(error)
    }
  }

  /**
   * Enable or disable one skill without deleting its bundle.
   * @param request - Workspace identity, skill identity, scope, and desired state.
   * @returns the updated skill document.
   */
  @Remote
  async setSkillEnabled(request: CopyOSSkillEnabledRequest): Promise<CopyOSSkillDocument> {
    try {
      const { workspaceId: _workspaceId, ...skill } = request
      return await this.skills.setEnabled(await this.projectPath(request.workspaceId), skill)
    } catch (error: unknown) {
      this.rethrowSkillError(error)
    }
  }

  /**
   * List portable briefs and copy assets in one registered CopyOS project.
   * @param request - Workspace identity and optional asset family.
   * @returns current assets in newest-update order, plus asset files skipped as invalid.
   */
  @Remote
  async listAssets(request: CopyOSAssetListRequest): Promise<CopyOSAssetListValue> {
    const path = await this.projectPath(request.workspaceId)
    return await this.assets.list(path, request.kind)
  }

  /**
   * Create a structured brief in one registered CopyOS project.
   * @param request - Workspace identity and brief fields.
   * @returns the persisted brief.
   */
  @Remote
  async createBrief(request: CopyOSBriefCreateRequest): Promise<CopyOSBriefDocument> {
    try {
      return await this.assets.createBrief(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowAssetError(error)
    }
  }

  /**
   * Create a copy asset with its first selected variation.
   * @param request - Workspace identity, title, body, and optional brief relation.
   * @returns the persisted copy asset.
   */
  @Remote
  async createCopy(request: CopyOSCopyCreateRequest): Promise<CopyOSCopyDocument> {
    try {
      return await this.assets.createCopy(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowAssetError(error)
    }
  }

  /**
   * Add and select an alternative body on an existing copy asset.
   * @param request - Workspace, asset, and variation fields.
   * @returns the complete updated copy asset.
   */
  @Remote
  async addCopyVariant(request: CopyOSCopyVariantCreateRequest): Promise<CopyOSCopyDocument> {
    try {
      return await this.assets.addCopyVariant(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowAssetError(error)
    }
  }

  /**
   * List durable landing-page documents in one project.
   * @param request - Workspace identity for the owning CopyOS project.
   * @returns pages in newest-update order.
   */
  @Remote
  async listPages(request: CopyOSPageListRequest): Promise<CopyOSPageListValue> {
    return { pages: await this.pages.list(await this.projectPath(request.workspaceId)) }
  }

  /**
   * Create an empty landing page ready for coded sections.
   * @param request - Workspace identity, title, and optional slug.
   * @returns the persisted empty page.
   */
  @Remote
  async createPage(request: CopyOSPageCreateRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.create(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Add a coded section to a landing page.
   * @param request - Page identity and first section variation.
   * @returns the complete updated page.
   */
  @Remote
  async addPageSection(request: CopyOSPageSectionCreateRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.addSection(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Add and select an HTML variation for one section.
   * @param request - Page, section, and alternative HTML fields.
   * @returns the complete updated page.
   */
  @Remote
  async addPageSectionVariant(request: CopyOSPageSectionVariantCreateRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.addVariant(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Select one of a section's stored variations.
   * @param request - Page, section, and variation identities.
   * @returns the complete updated page.
   */
  @Remote
  async selectPageSectionVariant(request: CopyOSPageSectionVariantSelectRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.selectVariant(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Persist direct edits to an existing section variation.
   * @param request - Page, section, variation, and complete edited HTML.
   * @returns the complete updated page.
   */
  @Remote
  async updatePageSectionVariant(request: CopyOSPageSectionVariantUpdateRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.updateVariant(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Save existing section variations together at one required page revision.
   * @param request - Registered workspace, page, expected revision and 1–100 unique HTML variation targets.
   * @returns Complete saved page after one atomic batch, revision increment and pre-write snapshot.
   * @throws {RemoteError} If the workspace, revision, HTML or any target is invalid; no partial page update occurs.
   */
  @Remote
  async updatePageSectionVariants(request: CopyOSPageVariantsUpdateRequest): Promise<CopyOSPageDocument> {
    try { return await this.pages.updateVariants(await this.projectPath(request.workspaceId), request) }
    catch (error: unknown) { this.rethrowPageError(error) }
  }

  /**
   * Rename one landing-page section.
   * @param request - Workspace, page, section, and replacement title.
   * @returns the complete updated page.
   */
  @Remote
  async renamePageSection(request: CopyOSPageSectionRenameRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.renameSection(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Delete one landing-page section.
   * @param request - Workspace, page, and section identities.
   * @returns the complete updated page.
   */
  @Remote
  async deletePageSection(request: CopyOSPageSectionDeleteRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.deleteSection(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Reorder one page section, including drag-and-drop changes.
   * @param request - Page, section, and zero-based destination.
   * @returns the complete updated page.
   */
  @Remote
  async movePageSection(request: CopyOSPageSectionMoveRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.moveSection(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Add a durable review comment to a page element.
   * @param request - Page-element selection and comment body.
   * @returns the complete updated page.
   */
  @Remote
  async addPageComment(request: CopyOSPageCommentCreateRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.addComment(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Resolve or reopen a durable page review comment.
   * @param request - Page and comment identities plus the desired status.
   * @returns the complete updated page.
   */
  @Remote
  async setPageCommentStatus(request: CopyOSPageCommentStatusRequest): Promise<CopyOSPageDocument> {
    try {
      return await this.pages.setCommentStatus(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * Export selected section variations as standalone HTML.
   * @param request - Workspace and page identities.
   * @returns host path of the written HTML file.
   */
  @Remote
  async exportPage(request: CopyOSPageExportRequest): Promise<CopyOSPageExportValue> {
    try {
      const root = await this.projectPath(request.workspaceId)
      const path = request.format === 'copy'
        ? await this.pages.exportCopy(root, request.pageId)
        : request.format === 'json'
          ? await this.pages.exportJson(root, request.pageId)
          : request.format === 'shopify'
            ? await this.pages.exportShopify(root, request.pageId)
            : request.format === 'vercel'
              ? await this.pages.exportVercel(root, request.pageId)
              : await this.pages.exportHtml(root, request.pageId)
      return { path }
    } catch (error: unknown) {
      this.rethrowPageError(error)
    }
  }

  /**
   * List durable brand profiles and research notes in one project.
   * @param request - Workspace identity and optional knowledge family.
   * @returns current strategic knowledge in newest-update order.
   */
  @Remote
  async listKnowledge(request: CopyOSKnowledgeListRequest): Promise<CopyOSKnowledgeListValue> {
    return { records: await this.knowledge.list(await this.projectPath(request.workspaceId), request.kind) }
  }

  /**
   * Create a durable brand profile.
   * @param request - Workspace identity and brand strategy fields.
   * @returns the persisted brand profile.
   */
  @Remote
  async createBrand(request: CopyOSBrandCreateRequest): Promise<CopyOSBrandDocument> {
    try {
      return await this.knowledge.createBrand(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowKnowledgeError(error)
    }
  }

  /**
   * Create a sourced durable research note.
   * @param request - Workspace identity, source, evidence, and insight fields.
   * @returns the persisted research note.
   */
  @Remote
  async createResearch(request: CopyOSResearchCreateRequest): Promise<CopyOSResearchDocument> {
    try {
      return await this.knowledge.createResearch(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowKnowledgeError(error)
    }
  }

  /**
   * List durable ad scripts in one project.
   * @param request - Workspace identity for the owning CopyOS project.
   * @returns scripts in newest-update order.
   */
  @Remote
  async listScripts(request: CopyOSScriptListRequest): Promise<CopyOSScriptListValue> {
    return { scripts: await this.scripts.list(await this.projectPath(request.workspaceId)) }
  }

  /**
   * Create an ad script with channel constraints and its first variation.
   * @param request - Workspace, channel, optional brief, and complete script fields.
   * @returns the persisted ad script.
   */
  @Remote
  async createScript(request: CopyOSScriptCreateRequest): Promise<CopyOSScriptDocument> {
    try {
      return await this.scripts.create(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowScriptError(error)
    }
  }

  /**
   * Append and select another complete ad-script variation.
   * @param request - Workspace, script, and complete alternative fields.
   * @returns the complete updated ad script.
   */
  @Remote
  async addScriptVariant(request: CopyOSScriptVariantCreateRequest): Promise<CopyOSScriptDocument> {
    try {
      return await this.scripts.addVariant(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowScriptError(error)
    }
  }

  /**
   * List durable CRO experiments in one project.
   * @param request - Workspace identity for the owning CopyOS project.
   * @returns experiments in newest-update order.
   */
  @Remote
  async listExperiments(request: CopyOSExperimentListRequest): Promise<CopyOSExperimentListValue> {
    return { experiments: await this.experiments.list(await this.projectPath(request.workspaceId)) }
  }

  /**
   * Create a draft CRO experiment with explicit control and treatment definitions.
   * @param request - Workspace, artifact relation, hypothesis, metric, audience, and variants.
   * @returns the persisted draft experiment.
   */
  @Remote
  async createExperiment(request: CopyOSExperimentCreateRequest): Promise<CopyOSExperimentDocument> {
    try {
      return await this.experiments.create(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowExperimentError(error)
    }
  }

  /**
   * Start a draft CRO experiment.
   * @param request - Workspace and experiment identities.
   * @returns the updated running experiment.
   */
  @Remote
  async startExperiment(request: CopyOSExperimentStartRequest): Promise<CopyOSExperimentDocument> {
    try {
      return await this.experiments.start(await this.projectPath(request.workspaceId), request.experimentId)
    } catch (error: unknown) {
      this.rethrowExperimentError(error)
    }
  }

  /**
   * Complete a running CRO experiment with observed sample counts and a reviewed outcome.
   * @param request - Workspace, experiment, sample counts, outcome, and analysis.
   * @returns the completed experiment.
   */
  @Remote
  async recordExperimentResult(request: CopyOSExperimentResultRequest): Promise<CopyOSExperimentDocument> {
    try {
      return await this.experiments.recordResult(await this.projectPath(request.workspaceId), request)
    } catch (error: unknown) {
      this.rethrowExperimentError(error)
    }
  }

  /**
   * List durable relationships between Harness Sessions and project artifacts.
   * @param request - Workspace identity for the owning CopyOS project.
   * @returns Session relationship documents in newest-update order.
   */
  @Remote
  async listSessionLinks(request: CopyOSSessionLinkListRequest): Promise<CopyOSSessionLinkListValue> {
    try {
      return { sessions: await this.sessionLinks.list(await this.projectPath(request.workspaceId)) }
    } catch (error: unknown) {
      if (error instanceof CopyOSSessionLinkFormatError) {
        throw new RemoteError('gateway/bad-request', error.message, {})
      }
      throw error
    }
  }

  /**
   * List native design files.
   * @param request - Owning workspace.
   * @returns saved project designs.
   */
  @Remote
  async listDesigns(request: CopyOSDesignListRequest): Promise<CopyOSDesignListValue> {
    return { designs: await this.designs.list(await this.projectPath(request.workspaceId)) }
  }

  /**
   * Read one native design through its registered workspace.
   * @param request - Owning registered workspace and saved design identity.
   * @returns Complete validated scene with its current revision.
   * @throws {RemoteError} If the workspace, project marker or design is invalid.
   */
  @Remote
  async readDesign(request: CopyOSDesignReadRequest): Promise<CopyOSDesignDocument> {
    try { return await this.designs.get(await this.projectPath(request.workspaceId), request.designId) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Create a native design file.
   * @param request - Workspace and title.
   * @returns empty saved design.
   */
  @Remote
  async createDesign(request: CopyOSDesignCreateRequest): Promise<CopyOSDesignDocument> {
    try { return await this.designs.create(await this.projectPath(request.workspaceId), request.title, request.canvasBackground) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Save a native design with a revision check.
   * @param request - Workspace and complete scene.
   * @returns committed design.
   */
  @Remote
  async saveDesign(request: CopyOSDesignSaveRequest): Promise<CopyOSDesignDocument> {
    try { return await this.designs.save(await this.projectPath(request.workspaceId), request.document) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Read one design's Canvas review comments, stored beside the design file.
   * @param request - Registered workspace and saved design.
   * @returns Comments oldest first.
   * @throws {RemoteError} If the design is missing or its comments file is malformed.
   */
  @Remote
  async listDesignComments(request: CopyOSDesignCommentListRequest): Promise<CopyOSDesignCommentList> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.designComments.list(root, request.designId) } catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Add an open review comment to a saved design without changing the design or its revision.
   * @param request - Registered workspace, saved design, 1–4000 characters of text and the layer or page point it is pinned to.
   * @returns The stored comment.
   * @throws {RemoteError} If the design is missing, a field is invalid or the design already has 2000 comments.
   */
  @Remote
  async addDesignComment(request: CopyOSDesignCommentCreateRequest): Promise<CopyOSDesignComment> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.designComments.add(root, request.designId, request.body, request.target) }
    catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Resolve or reopen one design review comment.
   * @param request - Registered workspace, saved design, comment and desired status.
   * @returns The updated comment.
   * @throws {RemoteError} If the design or comment is missing.
   */
  @Remote
  async setDesignCommentStatus(request: CopyOSDesignCommentStatusRequest): Promise<CopyOSDesignComment> {
    const root = await this.projectPath(request.workspaceId)
    try { return await this.designComments.setStatus(root, request.designId, request.commentId, request.status) }
    catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Delete one design review comment.
   * @param request - Registered workspace, saved design and comment.
   * @returns Confirmation after the comment is removed.
   * @throws {RemoteError} If the design or comment is missing.
   */
  @Remote
  async deleteDesignComment(request: CopyOSDesignCommentDeleteRequest): Promise<{ deleted: true }> {
    const root = await this.projectPath(request.workspaceId)
    try { await this.designComments.delete(root, request.designId, request.commentId) } catch (error) { this.rethrowDesignError(error) }
    return { deleted: true }
  }

  /**
   * List the Canvas template library shared by every workspace.
   * @param request - Registered workspace of the caller.
   * @returns Every template newest first, with previews.
   * @throws {RemoteError} If the workspace is not registered or a template file is malformed.
   */
  @Remote
  async listDesignTemplates(request: CopyOSDesignTemplateListRequest): Promise<CopyOSDesignTemplateList> {
    await this.projectPath(request.workspaceId)
    try { return { templates: await this.designTemplates.list() } } catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Save one visible top-level frame of a saved design revision as a shared template; unsaved editor changes are not included.
   * @param request - Registered workspace, saved design, frame and template title (1–120), category (1–60) and description (≤ 1000).
   * @returns The stored template; its preview is null when the artboard could not be drawn.
   * @throws {RemoteError} If the frame is not a visible top-level frame, a field is invalid, the template exceeds 20 MB
   * or the library holds 500 templates.
   */
  @Remote
  async saveDesignTemplate(request: CopyOSDesignTemplateSaveRequest): Promise<CopyOSDesignTemplateSummary> {
    const root = await this.projectPath(request.workspaceId)
    try {
      const document = await this.designs.get(root, request.designId)
      const project = await this.repository.read(root)
      return await this.designTemplates.save({ root, sourceWorkspaceId: request.workspaceId, sourceWorkspaceName: project?.name ?? '',
        document, nodeId: request.nodeId, title: request.title, category: request.category, description: request.description })
    } catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Read one template with its layers for placing into a design.
   * @param request - Registered workspace of the caller and template identity.
   * @returns Summary and validated clipboard snapshot whose images are embedded.
   * @throws {RemoteError} If the template is missing or malformed.
   */
  @Remote
  async readDesignTemplate(request: CopyOSDesignTemplateReadRequest): Promise<CopyOSDesignTemplateRead> {
    await this.projectPath(request.workspaceId)
    try { return await this.designTemplates.read(request.templateId) } catch (error) { this.rethrowDesignError(error) }
  }

  /**
   * Delete one template and its preview from the shared library.
   * @param request - Registered workspace of the caller and template identity.
   * @returns Confirmation after the template is removed.
   * @throws {RemoteError} If the template is missing.
   */
  @Remote
  async deleteDesignTemplate(request: CopyOSDesignTemplateDeleteRequest): Promise<{ deleted: true }> {
    await this.projectPath(request.workspaceId)
    try { await this.designTemplates.delete(request.templateId) } catch (error) { this.rethrowDesignError(error) }
    return { deleted: true }
  }

  /** Review an exact saved native artboard without writing project artifacts.
   * @param request - Registered workspace, source artboard, and expected revision.
   * @returns Compiled review or the existing built page identity.
   */
  @Remote
  async previewDesignPage(request: CopyOSDesignPagePreviewRequest): Promise<CopyOSDesignPagePreview> {
    try {
      const { workspaceId, ...input } = request
      return await new CopyOSDesignPageConversion().preview(await this.projectPath(workspaceId), input)
    }
    catch (error) { if (error instanceof CopyOSDesignError || error instanceof CopyOSPageFormatError || error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }
  /** Build the reviewed native artboard as an editable page beside its preserved original.
   * @param request - Registered source, expected revision, and reviewed compilation hash.
   * @returns Coordinated saved page and linked design view.
   */
  @Remote
  async buildDesignPage(request: CopyOSDesignPageBuildRequest): Promise<CopyOSDesignPageBuildResult> {
    try {
      const { workspaceId, ...input } = request
      return await new CopyOSDesignPageConversion().build(await this.projectPath(workspaceId), input)
    }
    catch (error) { if (error instanceof CopyOSDesignError || error instanceof CopyOSPageFormatError || error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /** Review how the current saved artboard would update its converted page; nothing is written.
   * @param request - Registered workspace, source artboard, and expected design revision.
   * @returns Current state, or classified changes, conflicts and both merged previews.
   */
  @Remote
  async reviewDesignPageUpdate(request: CopyOSDesignPageUpdateRequest): Promise<CopyOSDesignPageUpdateReview> {
    try {
      const { workspaceId, ...input } = request
      return await new CopyOSDesignPageConversion().reviewUpdate(await this.projectPath(workspaceId), input)
    }
    catch (error) { if (error instanceof CopyOSDesignError || error instanceof CopyOSPageFormatError || error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }
  /** Apply exactly a reviewed page update, preserving retained Builder edits.
   * @param request - Reviewed design/page revisions, compilation hash and required conflict policy.
   * @returns Saved page and applied change counts; stale reviews reject without page writes.
   */
  @Remote
  async applyDesignPageUpdate(request: CopyOSDesignPageUpdateApplyRequest): Promise<CopyOSDesignPageUpdateResult> {
    try {
      const { workspaceId, ...input } = request
      return await new CopyOSDesignPageConversion().applyUpdate(await this.projectPath(workspaceId), input)
    }
    catch (error) { if (error instanceof CopyOSDesignError || error instanceof CopyOSPageFormatError || error instanceof z.ZodError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Copy authored layers and their reusable dependencies into a saved target design.
   * @param request - Registered source/target workspaces, source roots, expected target revision and optional target placement.
   * @returns New target revision, selected roots and imported library/page identities; the source file is unchanged.
   * @throws {RemoteError} If a workspace, reference, placement or target revision is invalid; no partial import is saved.
   */
  @Remote
  async copyDesignLayers(request: CopyOSDesignCopyLayersRequest): Promise<CopyOSDesignCopyLayersValue> {
    try {
      if (!Number.isSafeInteger(request.targetRevision) || request.targetRevision < 0)
        throw new CopyOSDesignError('Target revision must be a nonnegative integer')
      if ((request.x === undefined) !== (request.y === undefined))
        throw new CopyOSDesignError('Supply both target coordinates or neither')
      const sourceWorkspaceId = request.sourceWorkspaceId ?? request.workspaceId
      const [sourcePath, targetPath] = await Promise.all([
        this.projectPath(sourceWorkspaceId), this.projectPath(request.workspaceId),
      ])
      const target = await this.designs.get(targetPath, request.targetDesignId)
      if (target.revision !== request.targetRevision)
        throw new CopyOSDesignError('Target design changed. Inspect its current revision before copying layers.')
      const source = sourcePath === targetPath && request.sourceDesignId === target.id
        ? target : await this.designs.get(sourcePath, request.sourceDesignId)
      const snapshot = captureDesignClipboard(source, request.rootIds, { sourceWorkspaceId }, randomUUID)
      const imported = importDesignClipboard(target, snapshot, {
        destinationWorkspaceId: request.workspaceId,
        ...(request.pageId !== undefined ? { pageId: request.pageId } : {}),
        ...(request.x !== undefined && request.y !== undefined ? { position: { x: request.x, y: request.y } } : {}),
      }, randomUUID)
      await this.designImages.copyDocumentImages(sourcePath, targetPath, imported.document)
      const saved = await this.designs.save(targetPath, imported.document)
      return {
        id: saved.id, revision: saved.revision, selectedIds: imported.selectedIds,
        dependencyIds: imported.dependencyIds, dependencyPageId: imported.dependencyPageId,
        activePageId: imported.activePageId,
        ...(imported.notices?.length ? { notices: imported.notices } : {}),
        ...(imported.removedNodeLinks ? { removedNodeLinks: imported.removedNodeLinks } : {}),
      }
    } catch (error) {
      if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {})
      throw error
    }
  }

  /**
   * Import a local Figma file into an independent editable design.
   * @param request - Workspace, original file name, and base64 file content.
   * @returns saved scene including pages and any fidelity warnings.
   */
  @Remote
  async importDesign(request: CopyOSDesignImportRequest): Promise<CopyOSDesignDocument> {
    try { return await importFigDesign(await this.projectPath(request.workspaceId), request.fileName, request.fileBase64) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Decode an editable Figma clipboard selection for a registered project without saving it.
   * @param request - Registered workspace and base64 native selection bytes.
   * @returns Validated independent scene and roots for current-document clipboard admission.
   */
  @Remote
  async decodeDesignClipboard(request: CopyOSDesignClipboardDecodeRequest): Promise<FigClipboardDecodeResult> {
    await this.projectPath(request.workspaceId)
    try { return await decodeFigClipboardSelection(request.dataBase64) }
    catch (error) { if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {}); throw error }
  }

  /**
   * Read axis metadata from the bundled Inter font without scanning or uploading local fonts.
   * @param request - Registered project and exact Inter or CopyOSInter family alias, ignoring case.
   * @returns Bundled axis metadata, or explicit unknown-family for every other family.
   * @throws {RemoteError} If the project or bounded family request is invalid; asset failures propagate.
   */
  @Remote
  async getDesignFontMetadata(request: CopyOSDesignFontMetadataRequest): Promise<CopyOSDesignFontMetadata> {
    await this.projectPath(request.workspaceId)
    if (typeof request.family !== 'string' || !request.family.length || request.family.length > 200)
      throw new RemoteError('gateway/bad-request', 'Font family must contain 1–200 characters', {})
    return getBundledDesignFontMetadata(request.family)
  }

  private async projectPath(workspaceId: string): Promise<string> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) {
      throw new RemoteError('gateway/bad-request', `CopyOS workspace '${workspaceId}' was not found`, {})
    }
    if (await this.repository.read(workspace.path) === undefined) {
      throw new RemoteError('gateway/bad-request', `Workspace '${workspaceId}' is not a CopyOS project`, {})
    }
    return workspace.path
  }

  private rethrowAssetError(error: unknown): never {
    if (error instanceof CopyOSAssetFormatError || error instanceof CopyOSAssetNotFoundError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowPageError(error: unknown): never {
    if (error instanceof CopyOSPageFormatError || error instanceof CopyOSPageNotFoundError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowKnowledgeError(error: unknown): never {
    if (error instanceof CopyOSKnowledgeFormatError || error instanceof CopyOSKnowledgeNotFoundError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowScriptError(error: unknown): never {
    if (error instanceof CopyOSScriptFormatError || error instanceof CopyOSScriptNotFoundError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowExperimentError(error: unknown): never {
    if (error instanceof CopyOSExperimentFormatError || error instanceof CopyOSExperimentNotFoundError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowStyleGuideError(error: unknown): never {
    if (error instanceof CopyOSStyleGuideFormatError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }

  private rethrowDesignError(error: unknown): never {
    if (error instanceof CopyOSDesignError) throw new RemoteError('gateway/bad-request', error.message, {})
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new RemoteError('gateway/bad-request', 'The design was not found', {})
    throw error
  }

  private rethrowGenerationError(error: unknown): never {
    if (error instanceof CopyOSGenerationError) throw new RemoteError('gateway/bad-request', error.message, {})
    throw error
  }

  private rethrowSkillError(error: unknown): never {
    if (error instanceof CopyOSSkillFormatError || error instanceof CopyOSSkillConflictError) {
      throw new RemoteError('gateway/bad-request', error.message, {})
    }
    throw error
  }
}

export default CopyOSProjects
