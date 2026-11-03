/** CopyOS project home and project-scoped session launcher. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, IconDeliverDocRegular,
  IconListPenOutlineRegular, IconSettingsOutlineRegular,
  IconNewChatOutlineRegular, IconPlusOutlineRegular, IconSparkleRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime,
  PropsStore, HostObservable,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {
  CopyOSBriefCreateRequest,
  CopyOSBriefDocument,
  CopyOSBrandCreateRequest,
  CopyOSBrandDocument,
  CopyOSCopyCreateRequest,
  CopyOSCopyDocument,
  CopyOSCopyVariantCreateRequest,
  CopyOSExperimentCreateRequest,
  CopyOSExperimentDocument,
  CopyOSExperimentResultRequest,
  CopyOSExperimentStartRequest,
  CopyOSPageCreateRequest,
  CopyOSPageCommentCreateRequest,
  CopyOSPageCommentStatusRequest,
  CopyOSPageDocument,
  CopyOSPageExportRequest,
  CopyOSPageExportValue,
  CopyOSPageSectionCreateRequest,
  CopyOSPageSectionDeleteRequest,
  CopyOSPageSectionMoveRequest,
  CopyOSPageSectionRenameRequest,
  CopyOSPageSectionVariantCreateRequest,
  CopyOSPageSectionVariantSelectRequest,
  CopyOSPageSectionVariantUpdateRequest,
  CopyOSPageVariantsUpdateRequest,
  CopyOSProjectView,
  CopyOSResearchCreateRequest,
  CopyOSResearchDocument,
  CopyOSScriptCreateRequest,
  CopyOSScriptDocument,
  CopyOSScriptVariantCreateRequest,
  CopyOSStyleGuideDocument,
  CopyOSStyleGuideSaveRequest,
  CopyOSSessionLinkDocument,
  CopyOSSkillDocument,
  CopyOSSkillEnabledRequest,
  CopyOSSkillImportRequest,
  CopyOSSkillSaveRequest,
  CopyOSLinkedArtifactKind,
  CopyOSWorkflowId,
} from '../../../copyos-domain/src/types.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { BriefWorkspace, CopyWorkspace, type AssetWorkspaceActions } from './AssetWorkspace.tsx'
import { BrandResearchWorkspace, type BrandResearchActions } from './BrandResearchWorkspace.tsx'
import { ExperimentWorkspace, type ExperimentWorkspaceActions } from './ExperimentWorkspace.tsx'
import {
  PageDesignerWorkspace,
  type PageDesignerActions,
} from './PageDesignerWorkspace.tsx'
import { LandingPageWorkspace, type PageWorkspaceActions } from './LandingPageWorkspace.tsx'
import { ScriptWorkspace, type ScriptWorkspaceActions } from './ScriptWorkspace.tsx'
import { SessionWorkspace, type SessionWorkspaceActions } from './SessionWorkspace.tsx'
import { StyleGuideWorkspace, type StyleGuideWorkspaceActions } from './StyleGuideWorkspace.tsx'
import { SkillsWorkspace, type SkillsWorkspaceActions } from './SkillsWorkspace.tsx'
import { StrategySourceForm, strategyPagePrompt, type StrategySource } from './StrategySourceForm.tsx'
import { COPYOS_WORKFLOWS } from './workflows.ts'
import css from './CopyOSPanel.module.css'
import type {
  createCopyOSNavigationStore,
  ProjectSection,
} from './CopyOSNavigation.tsx'

/** Host-backed actions injected into the global CopyOS panel. */
export interface CopyOSPanelInjected extends
  PageDesignerActions,
  Pick<PageWorkspaceActions, 'listReusableSections' | 'saveReusableSection' | 'moveReusableSection' | 'deleteReusableSection'> {
  /** Resolved application palette, used only for a new design's initial canvas. */
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot> }
  /** Return from the CopyOS workspace to the Harness chat interface. */
  readonly backToHarness: () => void
  /** Read all registered portable CopyOS projects. */
  readonly listProjects: () => Promise<readonly CopyOSProjectView[]>
  /** Pick a directory and create or adopt its project marker. */
  readonly createProject: () => Promise<CopyOSProjectView | null>
  /** Choose another folder without moving the previous project files. */
  readonly changeProjectFolder: (workspaceId: string) => Promise<CopyOSProjectView | null>
  /** Pick an existing local project subfolder for page import. */
  readonly pickExistingPageFolder: () => Promise<string | null>
  readonly getStyleGuide: (workspaceId: string) => Promise<CopyOSStyleGuideDocument | undefined>
  readonly saveStyleGuide: (request: CopyOSStyleGuideSaveRequest) => Promise<CopyOSStyleGuideDocument>
  /** Read project and universal native Harness skills. */
  readonly listSkills: (workspaceId: string) => Promise<readonly CopyOSSkillDocument[]>
  /** Create or replace one native Harness skill. */
  readonly saveSkill: (request: CopyOSSkillSaveRequest) => Promise<CopyOSSkillDocument>
  /** Import a complete Markdown skill. */
  readonly importSkill: (request: CopyOSSkillImportRequest) => Promise<CopyOSSkillDocument>
  /** Enable or disable a skill without deleting its bundle. */
  readonly setSkillEnabled: (request: CopyOSSkillEnabledRequest) => Promise<CopyOSSkillDocument>
  /** Workspace row selection requests raised from the Harness sidebar. */
  readonly workspaceSettingsTarget: {
    readonly getSnapshot: () => WorkspaceLaunchTarget | null
    readonly subscribe: (listener: () => void) => () => void
  }
  /** Start one Workspace-bound session under the selected product workflow. */
  readonly acknowledgeWorkspaceLaunch: (revision: number) => void
  /** Start one Workspace-bound session under the selected product workflow. */
  readonly startProjectSession: (workspaceId: string, workflow: CopyOSWorkflowId, prompt?: string) => Promise<void>
  /** Read durable creative briefs from one project. */
  readonly listBriefs: (workspaceId: string) => Promise<readonly CopyOSBriefDocument[]>
  /** Save a structured creative brief. */
  readonly createBrief: (request: CopyOSBriefCreateRequest) => Promise<CopyOSBriefDocument>
  /** Read durable copy assets from one project. */
  readonly listCopy: (workspaceId: string) => Promise<readonly CopyOSCopyDocument[]>
  /** Save a copy asset with its first selected variation. */
  readonly createCopy: (request: CopyOSCopyCreateRequest) => Promise<CopyOSCopyDocument>
  /** Add and select a durable variation on one copy asset. */
  readonly addCopyVariant: (request: CopyOSCopyVariantCreateRequest) => Promise<CopyOSCopyDocument>
  /** Read durable landing pages from one project. */
  readonly listPages: (workspaceId: string) => Promise<readonly CopyOSPageDocument[]>
  /** Create an empty landing page. */
  readonly createPage: (request: CopyOSPageCreateRequest) => Promise<CopyOSPageDocument>
  /** Add a coded section to a page. */
  readonly addPageSection: (request: CopyOSPageSectionCreateRequest) => Promise<CopyOSPageDocument>
  /** Add a copy/HTML variation to a section. */
  readonly addPageSectionVariant: (request: CopyOSPageSectionVariantCreateRequest) => Promise<CopyOSPageDocument>
  /** Select an existing section variation. */
  readonly selectPageSectionVariant: (request: CopyOSPageSectionVariantSelectRequest) => Promise<CopyOSPageDocument>
  readonly updatePageSectionVariants: (request: CopyOSPageVariantsUpdateRequest) => Promise<CopyOSPageDocument>
  readonly updatePageSectionVariant: (request: CopyOSPageSectionVariantUpdateRequest) => Promise<CopyOSPageDocument>
  readonly addPageComment: (request: CopyOSPageCommentCreateRequest) => Promise<CopyOSPageDocument>
  readonly setPageCommentStatus: (request: CopyOSPageCommentStatusRequest) => Promise<CopyOSPageDocument>
  readonly renamePageSection: (request: CopyOSPageSectionRenameRequest) => Promise<CopyOSPageDocument>
  readonly deletePageSection: (request: CopyOSPageSectionDeleteRequest) => Promise<CopyOSPageDocument>
  /** Move one page section. */
  readonly movePageSection: (request: CopyOSPageSectionMoveRequest) => Promise<CopyOSPageDocument>
  /** Export selected section variations as HTML. */
  readonly exportPage: (request: CopyOSPageExportRequest) => Promise<CopyOSPageExportValue>
  /** Read reusable brand profiles from one project. */
  readonly listBrands: (workspaceId: string) => Promise<readonly CopyOSBrandDocument[]>
  /** Read sourced research notes from one project. */
  readonly listResearch: (workspaceId: string) => Promise<readonly CopyOSResearchDocument[]>
  /** Save a reusable brand profile. */
  readonly createBrand: (request: CopyOSBrandCreateRequest) => Promise<CopyOSBrandDocument>
  /** Save a sourced research note. */
  readonly createResearch: (request: CopyOSResearchCreateRequest) => Promise<CopyOSResearchDocument>
  /** Read durable ad scripts from one project. */
  readonly listScripts: (workspaceId: string) => Promise<readonly CopyOSScriptDocument[]>
  /** Save an ad script with its first complete variation. */
  readonly createScript: (request: CopyOSScriptCreateRequest) => Promise<CopyOSScriptDocument>
  /** Add and select another complete ad-script variation. */
  readonly addScriptVariant: (request: CopyOSScriptVariantCreateRequest) => Promise<CopyOSScriptDocument>
  /** Read durable CRO experiments from one project. */
  readonly listExperiments: (workspaceId: string) => Promise<readonly CopyOSExperimentDocument[]>
  /** Save a draft CRO experiment. */
  readonly createExperiment: (request: CopyOSExperimentCreateRequest) => Promise<CopyOSExperimentDocument>
  /** Start a draft CRO experiment. */
  readonly startExperiment: (request: CopyOSExperimentStartRequest) => Promise<CopyOSExperimentDocument>
  /** Complete a running experiment with observed result counts. */
  readonly recordExperimentResult: (request: CopyOSExperimentResultRequest) => Promise<CopyOSExperimentDocument>
  /** Subscribe to the live Harness Session catalog. */
  readonly subscribeSessions: (listener: () => void) => () => void
  /** Read the current identity-stable Harness Session catalog snapshot. */
  readonly getSessions: () => SessionListState
  /** Read durable Session-to-artifact relationships for one project. */
  readonly listSessionLinks: (workspaceId: string) => Promise<readonly CopyOSSessionLinkDocument[]>
  /** Open an existing Harness Session in the main workspace. */
  readonly openSession: (sessionId: string) => void
}

type PanelProps = PropsRuntime<'main'> & PropsLocale<'copyosFoundation'> & InjectFace<CopyOSPanelInjected> &
  PropsStore<ReturnType<typeof createCopyOSNavigationStore>>

export interface WorkspaceLaunchTarget {
  readonly workspaceId: string
  readonly intent: 'settings' | 'new-asset'
  readonly revision: number
  readonly project?: CopyOSProjectView
}

interface WorkspaceMenuInjected {
  readonly startWorkspaceQuickChat: (workspaceId: string, workspacePath: string) => void
  readonly openWorkspaceAssetLauncher: (workspaceId: string, workspacePath: string) => void
  readonly openWorkspaceSettings: (workspaceId: string, workspacePath: string) => void
}

type WorkspaceMenuProps = PropsRuntime<'sidebar.workspaces.workspace.menu.item'>
  & PropsLocale<'copyosFoundation'> & InjectFace<WorkspaceMenuInjected>

const PROJECT_SECTIONS = [
  ['overview', 'projectOverview'],
  ['settings', 'workspaceSettingsTitle'],
  ['skills', 'projectSkills'],
  ['style-guide', 'projectStyleGuide'],
  ['brand', 'projectBrandResearch'],
  ['briefs', 'projectBriefs'],
  ['pages', 'projectLandingPages'],
  ['designer', 'designerTitle'],
  ['copy', 'projectCopy'],
  ['scripts', 'projectAdScripts'],
  ['experiments', 'projectExperiments'],
  ['sessions', 'projectSessions'],
] as const

/** Render the CopyOS sidebar glyph at the size requested by its host. */
export function CopyOSPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconListPenOutlineRegular size={size} />
}

/** Render the global CopyOS skills glyph. */
export function CopyOSSkillsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconSparkleRegular size={size} />
}

/** Render CopyOS launch and settings actions for one Harness Workspace. */
export function CopyOSWorkspaceMenuItems({
  workspaceId, workspacePath, useMenuOpenState,
  startWorkspaceQuickChat, openWorkspaceAssetLauncher, openWorkspaceSettings, t,
}: WorkspaceMenuProps): ReactNode {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <>
      <MenuItemButton icon={<IconNewChatOutlineRegular />} onSelect={() => {
        setMenuOpen(false)
        startWorkspaceQuickChat(workspaceId, workspacePath)
      }}>{t('quickChat')}</MenuItemButton>
      <MenuItemButton icon={<IconPlusOutlineRegular />} onSelect={() => {
        setMenuOpen(false)
        openWorkspaceAssetLauncher(workspaceId, workspacePath)
      }}>{t('newSession')}</MenuItemButton>
      <MenuItemButton icon={<IconSettingsOutlineRegular />} onSelect={() => {
        setMenuOpen(false)
        openWorkspaceSettings(workspaceId, workspacePath)
      }}>{t('editWorkspaceSettings')}</MenuItemButton>
      <MenuItemButton icon={<IconSettingsOutlineRegular />} onSelect={() => {
        setMenuOpen(false)
        openWorkspaceSettings(workspaceId, workspacePath)
      }}>{t('workspaceChangeFolder')}</MenuItemButton>
    </>
  )
}

type UniversalSkillsPanelProps = PropsLocale<'copyosFoundation'> & Pick<CopyOSPanelInjected,
    | 'listProjects' | 'listSkills' | 'saveSkill' | 'importSkill' | 'setSkillEnabled'>

/** Render the repository-owned skill library shared by every CopyOS project. */
export function UniversalSkillsPanel({
  t, listProjects, listSkills, saveSkill, importSkill, setSkillEnabled,
}: UniversalSkillsPanelProps): ReactNode {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const actions = useMemo<SkillsWorkspaceActions>(() => ({
    listSkills, saveSkill, importSkill, setSkillEnabled,
  }), [importSkill, listSkills, saveSkill, setSkillEnabled])

  useEffect(() => {
    let active = true
    void listProjects().then((projects) => {
      if (!active) return
      setWorkspaceId(projects[0]?.workspaceId ?? null)
      setPhase('ready')
    }).catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setPhase('error')
    })
    return () => { active = false }
  }, [listProjects])

  return (
    <section className={css.page} aria-labelledby="copyos-universal-skills-title">
      {phase !== 'ready' || workspaceId === null ? (
        <header className={css.simplePageHeader}>
          <h1 id="copyos-universal-skills-title">{t('universalSkillsTitle')}</h1>
          <p>{t('universalSkillsDescription')}</p>
        </header>
      ) : null}
      {phase === 'loading' ? (
        <p className={css.simpleState} role="status">{t('skillsLoading')}</p>
      ) : null}
      {phase === 'error' ? (
        <p className={css.simpleError} role="alert">{t('skillsOperationFailed')} {error}</p>
      ) : null}
      {phase === 'ready' && workspaceId === null ? (
        <p className={css.simpleState}>{t('universalSkillsNeedsProject')}</p>
      ) : null}
      {phase === 'ready' && workspaceId !== null ? (
        <SkillsWorkspace workspaceId={workspaceId} scope="global" t={t} actions={actions} />
      ) : null}
    </section>
  )
}

/** Render the first CopyOS workspace. */
export function CopyOSPanel({
  t,
  useTheme,
  listProjects,
  listDesigns,
  createDesign,
  saveDesign,
  previewDesignPage,
  buildDesignPage,
  reviewDesignPageUpdate,
  applyDesignPageUpdate,
  importDesign,
  decodeDesignClipboard,
  putDesignImage,
  copyDesignImages,
  findUnusedDesignImages,
  removeUnusedDesignImages,
  getDesignFontMetadata,
  listDesignFonts,
  installDesignFonts,
  uploadDesignFont,
  readDesignFont,
  listDesignComments,
  addDesignComment,
  setDesignCommentStatus,
  deleteDesignComment,
  listDesignTemplates,
  saveDesignTemplate,
  readDesignTemplate,
  deleteDesignTemplate,
  generation,
  createProject,
  changeProjectFolder,
  pickExistingPageFolder,
  getStyleGuide,
  saveStyleGuide,
  listSkills,
  saveSkill,
  importSkill,
  setSkillEnabled,
  workspaceSettingsTarget,
  backToHarness,
  acknowledgeWorkspaceLaunch,
  useStore,
  actions: navigationActions,
  startProjectSession,
  listBriefs,
  createBrief,
  listCopy,
  createCopy,
  addCopyVariant,
  listReusableSections,
  saveReusableSection,
  moveReusableSection,
  deleteReusableSection,
  listPages,
  createPage,
  addPageSection,
  addPageSectionVariant,
  selectPageSectionVariant,
  updatePageSectionVariant,
  updatePageSectionVariants,
  addPageComment,
  setPageCommentStatus,
  renamePageSection,
  deletePageSection,
  movePageSection,
  exportPage,
  listBrands,
  listResearch,
  createBrand,
  createResearch,
  listScripts,
  createScript,
  addScriptVariant,
  listExperiments,
  createExperiment,
  startExperiment,
  recordExperimentResult,
  subscribeSessions,
  getSessions,
  listSessionLinks,
  openSession,
}: PanelProps) {
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [projects, setProjects] = useState<readonly CopyOSProjectView[]>([])
  const selectedProjectId = useStore(state => state.projectId)
  const section = useStore(state => state.section)
  const setSelectedProjectId = navigationActions.selectProject
  const setSection = navigationActions.selectSection
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [changingFolder, setChangingFolder] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [pageBuilderLaunchOpen, setPageBuilderLaunchOpen] = useState(false)
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [strategy, setStrategy] = useState<StrategySource>({ mode: 'guided', content: '' })
  const [existingFileOpen, setExistingFileOpen] = useState(false)
  const [existingSource, setExistingSource] = useState<'folder' | 'github'>('folder')
  const [existingFolder, setExistingFolder] = useState('')
  const [existingRepository, setExistingRepository] = useState('')
  const [existingRepositoryFolder, setExistingRepositoryFolder] = useState('')
  const [existingEntry, setExistingEntry] = useState('')
  const [startingWorkflow, setStartingWorkflow] = useState<CopyOSWorkflowId | null>(null)
  const [sessionError, setSessionError] = useState('')
  const requestedWorkspaceLaunch = useSyncExternalStore(
    workspaceSettingsTarget.subscribe,
    workspaceSettingsTarget.getSnapshot,
    workspaceSettingsTarget.getSnapshot,
  )

  const load = useCallback(async () => {
    setPhase('loading')
    setLoadError('')
    try {
      const next = await listProjects()
      setProjects(next)
      navigationActions.reconcileProjects(
        next.map(project => project.projectId),
      )
      setPhase('ready')
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }
  }, [listProjects, navigationActions])

  useEffect(() => { void load() }, [load])

  const selected = useMemo(
    () => projects.find(project => project.projectId === selectedProjectId),
    [projects, selectedProjectId],
  )
  useEffect(() => {
    if (requestedWorkspaceLaunch === null || phase !== 'ready') return
    const requested = projects.find(project => project.workspaceId === requestedWorkspaceLaunch.workspaceId)
      ?? requestedWorkspaceLaunch.project
    if (requested === undefined) return
    if (!projects.some(project => project.projectId === requested.projectId)) {
      setProjects(current => [requested, ...current])
    }
    setSelectedProjectId(requested.projectId)
    setSection(requestedWorkspaceLaunch.intent === 'settings' ? 'settings' : 'overview')
    setWorkflowOpen(requestedWorkspaceLaunch.intent === 'new-asset')
    setPageBuilderLaunchOpen(false)
    setExistingFileOpen(false)
    setStrategyOpen(false)
    setSessionError('')
    acknowledgeWorkspaceLaunch(requestedWorkspaceLaunch.revision)
  }, [phase, projects, requestedWorkspaceLaunch])
  const assetActions = useMemo<AssetWorkspaceActions>(() => ({
    listBriefs,
    createBrief,
    listCopy,
    createCopy,
    addCopyVariant,
  }), [addCopyVariant, createBrief, createCopy, listBriefs, listCopy])
  const pageActions = useMemo<PageWorkspaceActions>(() => ({
    listReusableSections,
    saveReusableSection,
    moveReusableSection,
    deleteReusableSection,
    listPages,
    createPage,
    addPageSection,
    addPageSectionVariant,
    selectPageSectionVariant,
    updatePageSectionVariant,
    updatePageSectionVariants,
    addPageComment,
    setPageCommentStatus,
    renamePageSection,
    deletePageSection,
    movePageSection,
    exportPage,
  }), [
    listReusableSections, saveReusableSection, moveReusableSection, deleteReusableSection,
    addPageSection, addPageSectionVariant, createPage, deletePageSection, exportPage, listPages, movePageSection,
    addPageComment, renamePageSection, selectPageSectionVariant, setPageCommentStatus, updatePageSectionVariant, updatePageSectionVariants,
  ])
  const knowledgeActions = useMemo<BrandResearchActions>(() => ({
    listBrands,
    listResearch,
    createBrand,
    createResearch,
  }), [createBrand, createResearch, listBrands, listResearch])
  const scriptActions = useMemo<ScriptWorkspaceActions>(() => ({
    listScripts,
    createScript,
    addScriptVariant,
    listBriefs,
  }), [addScriptVariant, createScript, listBriefs, listScripts])
  const experimentActions = useMemo<ExperimentWorkspaceActions>(() => ({
    listExperiments,
    createExperiment,
    startExperiment,
    recordExperimentResult,
    listPages,
    listCopy,
    listScripts,
  }), [createExperiment, listCopy, listExperiments, listPages, listScripts, recordExperimentResult, startExperiment])
  const sessionActions = useMemo<SessionWorkspaceActions>(() => ({
    subscribeSessions,
    getSessions,
    listSessionLinks,
    openSession,
  }), [getSessions, listSessionLinks, openSession, subscribeSessions])
  const styleGuideActions = useMemo<StyleGuideWorkspaceActions>(() => ({
    getStyleGuide, saveStyleGuide,
  }), [getStyleGuide, saveStyleGuide],
  )
  const designerActions = useMemo<PageDesignerActions>(
    () => ({
      listDesigns,
      createDesign,
      saveDesign,
      ...(previewDesignPage ? { previewDesignPage } : {}),
      ...(buildDesignPage ? { buildDesignPage } : {}),
      ...(reviewDesignPageUpdate ? { reviewDesignPageUpdate } : {}),
      ...(applyDesignPageUpdate ? { applyDesignPageUpdate } : {}),
      importDesign,
      ...(decodeDesignClipboard ? { decodeDesignClipboard } : {}),
      putDesignImage,
      copyDesignImages,
      findUnusedDesignImages,
      removeUnusedDesignImages,
      ...(getDesignFontMetadata ? { getDesignFontMetadata } : {}),
      ...(listDesignFonts && installDesignFonts && uploadDesignFont && readDesignFont
        ? { listDesignFonts, installDesignFonts, uploadDesignFont, readDesignFont } : {}),
      ...(listDesignComments && addDesignComment && setDesignCommentStatus && deleteDesignComment
        ? { listDesignComments, addDesignComment, setDesignCommentStatus, deleteDesignComment } : {}),
      ...(listDesignTemplates && saveDesignTemplate && readDesignTemplate && deleteDesignTemplate
        ? { listDesignTemplates, saveDesignTemplate, readDesignTemplate, deleteDesignTemplate } : {}),
      ...(generation ? { generation } : {}),
      getStyleGuide,
    }),
    [listDesigns, createDesign, saveDesign, previewDesignPage, buildDesignPage, reviewDesignPageUpdate, applyDesignPageUpdate, importDesign,
      decodeDesignClipboard, putDesignImage, copyDesignImages, findUnusedDesignImages, removeUnusedDesignImages,
      getDesignFontMetadata, listDesignFonts, installDesignFonts, uploadDesignFont, readDesignFont, listDesignComments, addDesignComment,
      setDesignCommentStatus, deleteDesignComment, listDesignTemplates, saveDesignTemplate, readDesignTemplate, deleteDesignTemplate,
      generation, getStyleGuide])
  const skillsActions = useMemo<SkillsWorkspaceActions>(() => ({
    listSkills, saveSkill, importSkill, setSkillEnabled,
  }), [importSkill, listSkills, saveSkill, setSkillEnabled])

  const openArtifact = useCallback((kind: CopyOSLinkedArtifactKind): void => {
    const copySectionId: ProjectSection = 'copy'
    const next: Record<CopyOSLinkedArtifactKind, ProjectSection> = {
      brand: 'brand', research: 'brand', brief: 'briefs', copy: copySectionId, page: 'pages',
      script: 'scripts', experiment: 'experiments',
    }
    setSection(next[kind])
  }, [])

  const create = async (): Promise<void> => {
    setCreating(true)
    setCreateError('')
    try {
      const project = await createProject()
      if (project === null) return
      setProjects(current => [project, ...current.filter(item => item.projectId !== project.projectId)])
      setSelectedProjectId(project.projectId)
      setSection('overview')
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }

  const changeFolder = async (): Promise<void> => {
    if (selected === undefined) return
    setChangingFolder(true)
    setFolderError('')
    try {
      const project = await changeProjectFolder(selected.workspaceId)
      if (project === null) return
      setProjects(await listProjects())
      setSelectedProjectId(project.projectId)
      setSection('settings')
    } catch (error: unknown) {
      setFolderError(error instanceof Error ? error.message : String(error))
    } finally {
      setChangingFolder(false)
    }
  }

  const start = async (workflow: CopyOSWorkflowId, prompt?: string): Promise<void> => {
    if (selected === undefined) return
    setStartingWorkflow(workflow)
    setSessionError('')
    try {
      await startProjectSession(selected.workspaceId, workflow, prompt)
      setWorkflowOpen(false)
      setPageBuilderLaunchOpen(false)
      setStrategyOpen(false)
    } catch (error: unknown) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setStartingWorkflow(null)
    }
  }

  const startNewPage = async (): Promise<void> => {
    if (selected === undefined) return
    setStartingWorkflow('landing-page-builder')
    setSessionError('')
    try {
      const existing = await listPages(selected.workspaceId)
      const title = nextUntitledPageTitle(existing.map(page => page.title), t('untitledPage'))
      await createPage({ workspaceId: selected.workspaceId, title })
      await startProjectSession(selected.workspaceId, 'landing-page-builder')
      setWorkflowOpen(false)
      setPageBuilderLaunchOpen(false)
      setStrategyOpen(false)
    } catch (error: unknown) {
      setSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      setStartingWorkflow(null)
    }
  }

  const chooseExistingFolder = async (): Promise<void> => {
    const folder = await pickExistingPageFolder()
    if (folder === null || selected === undefined) return
    const root = selected.path.replace(/\/+$/u, '')
    if (!folder.startsWith(`${root}/`)) {
      setSessionError(t('existingPageFolderOutsideProject'))
      return
    }
    setExistingFolder(folder)
    setSessionError('')
  }

  const startExistingPage = async (): Promise<void> => {
    const source =
      existingSource === 'folder'
        ? `Local workspace subfolder: ${existingFolder}`
        : `GitHub repository: ${existingRepository.trim()}\nRepository subfolder: ${existingRepositoryFolder.trim()}`
    const entry =
      existingEntry.trim() === ''
        ? 'Discover the page entry point and ask if more than one candidate exists.'
        : `Requested page entry or route: ${existingEntry.trim()}`
    await start(
      'existing-page',
      [
        'Import this existing coded page into the CopyOS Builder for optimization.',
        source,
        entry,
        'Inspect the framework, build commands, route, components, assets, and styling before editing. Keep the source structure intact, convert suitable regions into editable CopyOS sections and elements, preserve unsupported complex regions as coded sections, and begin with a prioritized CRO and copy audit.',
      ].join('\n'),
    )
  }

  return (
    <section className={css.page} aria-labelledby="copyos-workspaces-title">
      <div className={css.projectsHeader}>
        <div>
          <h1 id="copyos-workspaces-title" className={css.projectsTitle}>
            {t('projectsTitle')}
          </h1>
          <p className={css.projectsDescription}>{t('projectsDescription')}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className={css.topAction}
          disabled={creating}
          onClick={() => {
            void create()
          }}
        >
          <IconPlusOutlineRegular size={16} />
          {t('newProject')}
        </Button>
      </div>
      {createError !== '' ? (
        <p className={css.error} role="alert">
          {t('projectCreateFailed')} {createError}
        </p>
      ) : null}
      {phase === 'loading' ? (
        <p className={css.state} role="status">
          {t('projectsLoading')}
        </p>
      ) : null}
      {phase === 'error' ? (
        <div className={css.state} role="alert">
          <span>
            {t('projectLoadFailed')} {loadError}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              void load()
            }}
          >
            {t('retry')}
          </Button>
        </div>
      ) : null}
      {phase === 'ready' && projects.length === 0 ? (
        <p className={css.empty}>{t('projectsEmpty')}</p>
      ) : null}
      {phase === 'ready' && projects.length > 0 ? (
        <div className={css.projectShell}>
          <aside className={css.projectRail} aria-label={t('projectsTitle')}>
            <div className={css.projectList}>
              {projects.map(project => (
                <button
                  key={project.projectId}
                  type="button"
                  className={
                    project.projectId === selectedProjectId
                      ? css.projectButtonActive
                      : css.projectButton
                  }
                  aria-pressed={project.projectId === selectedProjectId}
                  onClick={() => {
                    setSelectedProjectId(project.projectId)
                    setSection('overview')
                  }}
                >
                  <span>{project.name}</span>
                  <small>{project.path}</small>
                </button>
              ))}
            </div>
            <nav className={css.projectNav} aria-label={selected?.name}>
              {PROJECT_SECTIONS.map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  className={
                    section === id ? css.navButtonActive : css.navButton
                  }
                  onClick={() => {
                    setSection(id)
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </nav>
          </aside>
          {selected === undefined ? null : (
            <div className={css.projectBody}>
              <div className={css.projectTitleRow}>
                <div>
                  <p className={css.projectKicker}>
                    {t(
                      section === 'settings'
                        ? 'workspaceSettingsTitle'
                        : (PROJECT_SECTIONS.find(
                          ([id]) => id === section,
                        )?.[1] ?? 'projectOverview'),
                    )}
                  </p>
                  <h2 className={css.projectName}>{selected.name}</h2>
                  <p className={css.projectPath}>
                    <span>{t('projectPath')}:</span> {selected.path}
                  </p>
                </div>
                <div className={css.projectTitleActions}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={startingWorkflow !== null}
                    onClick={() => {
                      void start('quick-chat')
                    }}
                  >
                    <IconNewChatOutlineRegular size={16} />
                    {startingWorkflow === 'quick-chat'
                      ? t('quickChatOpening')
                      : t('quickChat')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={startingWorkflow !== null}
                    onClick={() => {
                      setWorkflowOpen(true)
                    }}
                  >
                    <IconPlusOutlineRegular size={16} />
                    {t('newSession')}
                  </Button>
                </div>
              </div>
              {section === 'settings' ? (
                <div className={css.workspaceSettings}>
                  <div className={css.workspaceSettingsIntro}>
                    <h3>{t('workspaceSettingsTitle')}</h3>
                    <p>{t('workspaceSettingsDescription')}</p>
                  </div>
                  <div className={css.workspaceFolderCard}>
                    <h4>{t('workspaceFolderTitle')}</h4>
                    <p>
                      <code>{selected.path}</code>
                    </p>
                    <p>{t('workspaceFolderDescription')}</p>
                    <Button
                      variant="outline"
                      disabled={changingFolder}
                      onClick={() => {
                        void changeFolder()
                      }}
                    >
                      {t('workspaceChangeFolder')}
                    </Button>
                    {folderError !== '' ? (
                      <p role="alert">
                        {t('workspaceFolderChangeFailed')} {folderError}
                      </p>
                    ) : null}
                  </div>
                  <div className={css.workspaceSettingsGrid}>
                    <button
                      type="button"
                      className={css.workspaceSettingsCard}
                      onClick={() => {
                        setSection('skills')
                      }}
                    >
                      <span className={css.cardIcon}>
                        <IconSparkleRegular size={20} />
                      </span>
                      <strong>{t('projectSkills')}</strong>
                      <span>{t('workspaceSettingsSkillsDescription')}</span>
                    </button>
                    <button
                      type="button"
                      className={css.workspaceSettingsCard}
                      onClick={() => {
                        setSection('style-guide')
                      }}
                    >
                      <span className={css.cardIcon}>
                        <IconDeliverDocRegular size={20} />
                      </span>
                      <strong>{t('projectStyleGuide')}</strong>
                      <span>{t('workspaceSettingsStyleGuideDescription')}</span>
                    </button>
                    <button
                      type="button"
                      className={css.workspaceSettingsCard}
                      onClick={() => {
                        setSection('brand')
                      }}
                    >
                      <span className={css.cardIcon}>
                        <IconListPenOutlineRegular size={20} />
                      </span>
                      <strong>{t('projectBrandResearch')}</strong>
                      <span>{t('workspaceSettingsBrandDescription')}</span>
                    </button>
                  </div>
                </div>
              ) : section === 'overview' ? (
                <div className={css.grid}>
                  <article className={css.card}>
                    <span className={css.cardIcon}>
                      <IconDeliverDocRegular size={20} />
                    </span>
                    <h3 className={css.cardTitle}>{t('landingPagesTitle')}</h3>
                    <p className={css.cardDescription}>
                      {t('landingPagesDescription')}
                    </p>
                  </article>
                  <article className={css.card}>
                    <span className={css.cardIcon}>
                      <IconListPenOutlineRegular size={20} />
                    </span>
                    <h3 className={css.cardTitle}>{t('copyLibraryTitle')}</h3>
                    <p className={css.cardDescription}>
                      {t('copyLibraryDescription')}
                    </p>
                  </article>
                  <article className={css.card}>
                    <span className={css.cardIcon}>
                      <IconSparkleRegular size={20} />
                    </span>
                    <h3 className={css.cardTitle}>{t('adScriptsTitle')}</h3>
                    <p className={css.cardDescription}>
                      {t('adScriptsDescription')}
                    </p>
                  </article>
                </div>
              ) : section === 'brand' ? (
                <BrandResearchWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={knowledgeActions}
                />
              ) : section === 'skills' ? (
                <SkillsWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  scope="project"
                  t={t}
                  actions={skillsActions}
                />
              ) : section === 'style-guide' ? (
                <StyleGuideWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={styleGuideActions}
                  onStartWebsiteImport={async (prompt) => {
                    await start('website-clone', prompt)
                  }}
                />
              ) : section === 'briefs' ? (
                <BriefWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={assetActions}
                />
              ) : section === 'designer' ? (
                <PageDesignerWorkspace
                  colorScheme={colorScheme}
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={designerActions}
                  onBackToHarness={backToHarness}
                  pageActions={pageActions}
                  projectPath={selected.path}
                  onStartAgent={async (prompt) => {
                    await startProjectSession(
                      selected.workspaceId,
                      'quick-chat',
                      prompt,
                    )
                  }}
                />
              ) : section === 'pages' ? (
                <LandingPageWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  projectPath={selected.path}
                  t={t}
                  actions={pageActions}
                />
              ) : section === 'copy' ? (
                <CopyWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={assetActions}
                />
              ) : section === 'scripts' ? (
                <ScriptWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={scriptActions}
                />
              ) : section === 'experiments' ? (
                <ExperimentWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  t={t}
                  actions={experimentActions}
                />
              ) : (
                <SessionWorkspace
                  key={selected.workspaceId}
                  workspaceId={selected.workspaceId}
                  projectPath={selected.path}
                  t={t}
                  actions={sessionActions}
                  openArtifact={openArtifact}
                />
              )}
            </div>
          )}
        </div>
      ) : null}
      <Modal
        open={workflowOpen}
        onClose={() => {
          setWorkflowOpen(false)
          setPageBuilderLaunchOpen(false)
          setExistingFileOpen(false)
          setStrategyOpen(false)
        }}
        closeLabel={t('cancel')}
        title={t(
          strategyOpen
            ? 'pageBuilderStrategy'
            : existingFileOpen
              ? 'workflowExistingPage'
              : pageBuilderLaunchOpen
                ? 'workflowLandingPage'
                : 'newSessionQuestion',
        )}
        {...(strategyOpen || existingFileOpen || pageBuilderLaunchOpen ? {
          description: t(
            strategyOpen
              ? 'pageBuilderStrategyDescription'
              : existingFileOpen
                ? 'existingPageConfigureDescription'
                : 'pageBuilderStartModeDescription',
          ),
        } : {})}
        className={css.workflowDialog as string}
        footer={
          strategyOpen ? (
            <>
              <Button
                variant="outline"
                disabled={startingWorkflow !== null}
                onClick={() => {
                  setStrategyOpen(false)
                  setSessionError('')
                }}
              >
                {t('back')}
              </Button>
              <Button
                variant="primary"
                disabled={
                  startingWorkflow !== null ||
                  (strategy.mode === 'provided' &&
                    strategy.content.trim() === '')
                }
                onClick={() => {
                  void start(
                    'landing-page-builder',
                    strategyPagePrompt(strategy),
                  )
                }}
              >
                {startingWorkflow !== null
                  ? t('sessionStarting')
                  : t('strategyStart')}
              </Button>
            </>
          ) : existingFileOpen ? (
            <>
              <Button
                variant="outline"
                disabled={startingWorkflow !== null}
                onClick={() => {
                  setExistingFileOpen(false)
                  setSessionError('')
                }}
              >
                {t('back')}
              </Button>
              <Button
                variant="primary"
                disabled={
                  startingWorkflow !== null ||
                  (existingSource === 'folder'
                    ? existingFolder === ''
                    : existingRepository.trim() === '' ||
                      existingRepositoryFolder.trim() === '')
                }
                onClick={() => {
                  void startExistingPage()
                }}
              >
                {startingWorkflow === 'existing-page'
                  ? t('sessionStarting')
                  : t('existingPageStart')}
              </Button>
            </>
          ) : pageBuilderLaunchOpen ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setPageBuilderLaunchOpen(false)
                }}
              >
                {t('back')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setWorkflowOpen(false)
                  setPageBuilderLaunchOpen(false)
                }}
              >
                {t('cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setWorkflowOpen(false)
              }}
            >
              {t('cancel')}
            </Button>
          )
        }
      >
        {!existingFileOpen && selected !== undefined ? (
          <p className={css.workflowWorkspace}>
            {t('newAssetWorkspace', { name: selected.name })}
          </p>
        ) : null}
        {strategyOpen ? (
          <StrategySourceForm
            source={strategy}
            onChange={setStrategy}
            disabled={startingWorkflow !== null}
            t={t}
          />
        ) : existingFileOpen ? (
          <div className={css.existingPageForm}>
            <div
              className={css.existingPageSourcePicker}
              aria-label={t('existingPageSource')}
            >
              <button
                type="button"
                data-active={existingSource === 'folder'}
                onClick={() => {
                  setExistingSource('folder')
                  setSessionError('')
                }}
              >
                <strong>{t('existingPageProjectFolder')}</strong>
                <span>{t('existingPageProjectFolderDescription')}</span>
              </button>
              <button
                type="button"
                data-active={existingSource === 'github'}
                onClick={() => {
                  setExistingSource('github')
                  setSessionError('')
                }}
              >
                <strong>{t('existingPageGithub')}</strong>
                <span>{t('existingPageGithubDescription')}</span>
              </button>
            </div>
            {existingSource === 'folder' ? (
              <div className={css.existingPageFolderField}>
                <span>{t('existingPageSubfolder')}</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    void chooseExistingFolder()
                  }}
                >
                  {t('existingPageChooseSubfolder')}
                </Button>
                <code>
                  {existingFolder === ''
                    ? t('existingPageNoFolder')
                    : existingFolder}
                </code>
              </div>
            ) : (
              <>
                <label>
                  <span>{t('existingPageRepository')}</span>
                  <input
                    type="url"
                    value={existingRepository}
                    placeholder={t('repositoryUrlExample')}
                    onChange={(event) => {
                      setExistingRepository(event.currentTarget.value)
                      setSessionError('')
                    }}
                  />
                </label>
                <label>
                  <span>{t('existingPageRepositoryFolder')}</span>
                  <input
                    value={existingRepositoryFolder}
                    placeholder={t('projectFolderExample')}
                    onChange={(event) => {
                      setExistingRepositoryFolder(event.currentTarget.value)
                      setSessionError('')
                    }}
                  />
                </label>
              </>
            )}
            <label>
              <span>{t('existingPageEntry')}</span>
              <input
                value={existingEntry}
                placeholder={t('entryPointExample')}
                onChange={(event) => {
                  setExistingEntry(event.currentTarget.value)
                }}
              />
            </label>
          </div>
        ) : pageBuilderLaunchOpen ? (
          <div
            className={`${css.workflowGrid} ${css.pageBuilderLaunchGrid}`}
            aria-label={t('pageBuilderStartMode')}
          >
            <button
              type="button"
              className={css.workflowCard}
              disabled={startingWorkflow !== null}
              onClick={() => {
                void startNewPage()
              }}
            >
              <strong>{t('pageBuilderNew')}</strong>
              <span>
                {startingWorkflow === 'landing-page-builder'
                  ? t('sessionStarting')
                  : t('pageBuilderNewDescription')}
              </span>
            </button>
            <button
              type="button"
              className={css.workflowCard}
              disabled={startingWorkflow !== null}
              onClick={() => {
                setStrategyOpen(true)
                setStrategy({ mode: 'guided', content: '' })
                setSessionError('')
              }}
            >
              <strong>{t('pageBuilderStrategy')}</strong>
              <span>{t('pageBuilderStrategyDescription')}</span>
            </button>
            <button
              type="button"
              className={css.workflowCard}
              disabled={startingWorkflow !== null}
              onClick={() => {
                void start('website-clone')
              }}
            >
              <strong>{t('workflowWebsiteClone')}</strong>
              <span>
                {startingWorkflow === 'website-clone'
                  ? t('sessionStarting')
                  : t('workflowWebsiteCloneDescription')}
              </span>
            </button>
            <button
              type="button"
              className={css.workflowCard}
              disabled={startingWorkflow !== null}
              onClick={() => {
                setExistingFileOpen(true)
                setSessionError('')
              }}
            >
              <strong>{t('workflowExistingPage')}</strong>
              <span>
                {startingWorkflow === 'existing-page'
                  ? t('sessionStarting')
                  : t('workflowExistingPageDescription')}
              </span>
            </button>
          </div>
        ) : (
          <div className={css.workflowGrid}>
            {COPYOS_WORKFLOWS.map(workflow => (
              <button
                key={workflow.id}
                type="button"
                className={css.workflowCard}
                disabled={startingWorkflow !== null}
                onClick={() => {
                  if (workflow.id === 'landing-page-builder')
                    setPageBuilderLaunchOpen(true)
                  else void start(workflow.id)
                }}
              >
                <strong>{t(workflow.title)}</strong>
                <span>
                  {startingWorkflow === workflow.id
                    ? t('sessionStarting')
                    : t(workflow.description)}
                </span>
              </button>
            ))}
          </div>
        )}
        {sessionError === '' ? null : (
          <p className={css.workflowError} role="alert">
            {t('sessionCreateFailed')} {sessionError}
          </p>
        )}
      </Modal>
    </section>
  )
}

function nextUntitledPageTitle(
  existingTitles: readonly string[],
  base: string,
): string {
  const used = new Set(
    existingTitles.map(title => title.trim().toLocaleLowerCase()),
  )
  if (!used.has(base.toLocaleLowerCase())) return base
  let suffix = 2
  while (used.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${base} ${suffix}`
}
