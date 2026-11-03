/** CopyOS workflow chooser shown in every brand-new Harness session. */

import { useState, type ReactNode } from 'react'
import { useEditorChrome } from '../EditorChrome.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import type { CopyOSWorkflowId } from '../../../copyos-domain/src/types.ts'
import { StrategySourceForm, strategyPagePrompt, type StrategySource } from './StrategySourceForm.tsx'
import { COPYOS_WORKFLOWS } from './workflows.ts'
import css from './CopyOSPanel.module.css'

/** One selected blank Session routed into the CopyOS onboarding composer. */
export interface CopyOSNewSessionMatch {
  readonly sessionId: string
}

/** Business action supplied by the CopyOS browser plugin. */
export interface CopyOSNewSessionInjected {
  readonly startWorkflow: (
    sessionId: string,
    workflow: CopyOSWorkflowId,
    prompt?: string,
  ) => Promise<void>
  /** Choose one subfolder inside the blank session's current project. */
  readonly pickExistingPageFolder: (
    sessionId: string,
  ) => Promise<string | null>
}

type Props = CopyOSNewSessionInjected & {
  readonly matched: CopyOSNewSessionMatch
  readonly t: (key: CopyOSFoundationLocaleKey) => string
  /** Keep a destination-specific chooser on its own workflow. */
  readonly initialWorkflow?: CopyOSWorkflowId
  /** Open an explicit import action on its source chooser. */
  readonly initialPageBuilderMode?: PageBuilderMode
}

type PageBuilderMode = 'new' | 'clone' | 'existing' | 'strategy'
type ExistingSource = 'folder' | 'github'
type CloneMode = 'faithful' | 'adapt'

/** Ask what the user wants to build before the first CopyOS turn begins. */
export function CopyOSNewSession({ matched, startWorkflow, pickExistingPageFolder, t, initialWorkflow, initialPageBuilderMode }: Props): ReactNode {
  const { Button, BuilderModeIcon } = useEditorChrome()
  const [selected, setSelected] = useState<CopyOSWorkflowId | null>(initialWorkflow ?? null)
  const [pageBuilderMode, setPageBuilderMode] = useState<PageBuilderMode>(initialPageBuilderMode ?? 'new')
  const [strategy, setStrategy] = useState<StrategySource>({ mode: 'guided', content: '' })
  const [prompt, setPrompt] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneMode, setCloneMode] = useState<CloneMode>('faithful')
  const [existingSource, setExistingSource] = useState<ExistingSource>('folder')
  const [existingRepository, setExistingRepository] = useState('')
  const [existingSubfolder, setExistingSubfolder] = useState('')
  const [existingEntry, setExistingEntry] = useState('')
  const [existingGoal, setExistingGoal] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const workflow = COPYOS_WORKFLOWS.find(item => item.id === selected)
  const launchWorkflow: CopyOSWorkflowId | undefined = workflow?.id === 'landing-page-builder'
    ? pageBuilderMode === 'clone' ? 'website-clone' : pageBuilderMode === 'existing' ? 'existing-page' : workflow.id
    : workflow?.id

  const cloneUrlValid = /^https?:\/\/[^\s]+$/iu.test(cloneUrl.trim())
  const existingReady = existingSource === 'folder'
    ? existingSubfolder.trim() !== ''
    : existingRepository.trim() !== '' && existingSubfolder.trim() !== ''
  const canStart = launchWorkflow !== undefined && !starting && (
    launchWorkflow === 'landing-page-builder'
      ? pageBuilderMode !== 'strategy' || strategy.mode === 'guided' || strategy.content.trim() !== ''
      : launchWorkflow === 'website-clone'
        ? cloneUrlValid
        : launchWorkflow === 'existing-page'
          ? existingReady
          : launchWorkflow === 'canvas' || launchWorkflow === 'docs' || prompt.trim() !== ''
  )

  const resetInputs = (): void => {
    setStrategy({ mode: 'guided', content: '' })
    setPrompt('')
    setCloneUrl('')
    setCloneMode('faithful')
    setExistingSource('folder')
    setExistingRepository('')
    setExistingSubfolder('')
    setExistingEntry('')
    setExistingGoal('')
  }

  const initialPrompt = (): string | undefined => {
    if (launchWorkflow === 'landing-page-builder') return pageBuilderMode === 'strategy' ? strategyPagePrompt(strategy) : undefined
    if (launchWorkflow === 'website-clone') {
      return [
        'Import this permitted website into the CopyOS Builder as editable sections and elements.',
        `Website URL: ${cloneUrl.trim()}`,
        cloneMode === 'faithful'
          ? 'Direction: Faithful reconstruction. Preserve the original content, assets, layout, responsive behavior, and interactions as closely as permitted.'
          : 'Direction: Adapt to this project. Preserve the site’s visual DNA and useful structure, then apply this project’s content and brand.',
      ].join('\n')
    }
    if (launchWorkflow === 'existing-page') {
      const source = existingSource === 'folder'
        ? `Local workspace subfolder: ${existingSubfolder.trim()}`
        : `GitHub repository: ${existingRepository.trim()}\nRepository subfolder: ${existingSubfolder.trim()}`
      return [
        'Import this existing coded page into the CopyOS Builder for optimization.',
        source,
        existingEntry.trim() === ''
          ? 'Page entry: Discover the page entry point and ask if more than one candidate exists.'
          : `Requested page entry or route: ${existingEntry.trim()}`,
        existingGoal.trim() === ''
          ? 'Optimization goal: Begin with a prioritized copy and conversion audit before changing the page.'
          : `Optimization goal: ${existingGoal.trim()}`,
        'Inspect the framework, build commands, route, components, assets, and styling before editing. Keep the source structure intact, convert suitable regions into editable CopyOS sections and elements, and preserve unsupported complex regions as coded sections.',
      ].join('\n')
    }
    // Canvas opens without a prompt; an empty prompt starts the chat idle beside it.
    return (launchWorkflow === 'canvas' || launchWorkflow === 'docs') && prompt.trim() === '' ? undefined : prompt.trim()
  }

  const start = async (): Promise<void> => {
    if (!canStart) return
    setStarting(true); setError('')
    try { await startWorkflow(matched.sessionId, launchWorkflow, initialPrompt()) }
    catch (startError: unknown) { setError(startError instanceof Error ? startError.message : String(startError)); setStarting(false) }
  }

  const chooseExistingFolder = async (): Promise<void> => {
    setError('')
    try {
      const folder = await pickExistingPageFolder(matched.sessionId)
      if (folder !== null) setExistingSubfolder(folder)
    } catch (folderError: unknown) {
      setError(folderError instanceof Error ? folderError.message : String(folderError))
    }
  }

  const startLabel = launchWorkflow === 'landing-page-builder'
    ? t(pageBuilderMode === 'strategy' ? 'strategyStart' : 'pageBuilderOpenBlank')
    : launchWorkflow === 'website-clone'
      ? t('websiteImportStart')
      : launchWorkflow === 'existing-page'
        ? t('existingPageStart')
        : launchWorkflow === 'canvas'
          ? t('canvasOpen')
          : launchWorkflow === 'docs' ? t(prompt.trim() ? 'docsCreateDraft' : 'docsOpenBlank') : t('startSession')

  return (
    <section className={css.newSessionChooser} aria-labelledby="copyos-new-session-title">
      <div className={css.newSessionHeading}>
        <span className={css.newSessionMark}>{t('appMonogram')}</span>
        <div><p>{t('eyebrow')}</p><h1 id="copyos-new-session-title">{t('newSessionQuestion')}</h1></div>
      </div>
      <p className={css.newSessionIntro}>{t('newSessionDescription')}</p>
      {initialWorkflow === undefined ? <div className={css.newSessionWorkflowGrid}>
        {COPYOS_WORKFLOWS.map(item => (
          <button key={item.id} type="button" aria-label={t(item.title)} aria-describedby={`copyos-workflow-${item.id}-description`}
            aria-pressed={selected === item.id} data-active={selected === item.id} disabled={starting}
            onClick={() => {
              setSelected(item.id)
              setPageBuilderMode('new')
              resetInputs()
              setError('')
            }}>
            <span>{item.mark}</span><strong>{t(item.title)}</strong><small id={`copyos-workflow-${item.id}-description`}>{t(item.description)}</small>
          </button>
        ))}
      </div> : null}
      {workflow === undefined ? null : (
        <div className={css.newSessionPrompt}>
          <div><strong>{t(workflow.title)}</strong>{initialWorkflow === undefined ? <button type="button" disabled={starting}
            onClick={() => { setSelected(null); resetInputs(); setError('') }}>{t('changeWorkspace')}</button> : null}</div>
          {workflow.id === 'landing-page-builder' ? (
            <div className={css.pageBuilderModePicker} aria-label={t('pageBuilderStartMode')}>
              <p>{t('pageBuilderStartMode')}</p>
              <button type="button" data-active={pageBuilderMode === 'new'} disabled={starting}
                onClick={() => { setPageBuilderMode('new'); setError('') }}>
                <strong><BuilderModeIcon mode="new" size={18}/>{t('pageBuilderNew')}</strong><span>{t('pageBuilderNewDescription')}</span>
              </button>
              <button type="button" data-active={pageBuilderMode === 'strategy'} disabled={starting}
                onClick={() => { setPageBuilderMode('strategy'); setError('') }}>
                <strong><BuilderModeIcon mode="strategy" size={18}/>{t('pageBuilderStrategy')}</strong><span>{t('pageBuilderStrategyDescription')}</span>
              </button>
              <button type="button" data-active={pageBuilderMode === 'clone'} disabled={starting}
                onClick={() => { setPageBuilderMode('clone'); setError('') }}>
                <strong><BuilderModeIcon mode="clone" size={18}/>{t('workflowWebsiteClone')}</strong><span>{t('workflowWebsiteCloneDescription')}</span>
              </button>
              <button type="button" data-active={pageBuilderMode === 'existing'} disabled={starting}
                onClick={() => { setPageBuilderMode('existing'); setError('') }}>
                <strong><BuilderModeIcon mode="existing" size={18}/>{t('workflowExistingPage')}</strong><span>{t('workflowExistingPageDescription')}</span>
              </button>
            </div>
          ) : null}

          {launchWorkflow === 'landing-page-builder' && pageBuilderMode === 'strategy' ? (
            <StrategySourceForm source={strategy} onChange={setStrategy} disabled={starting} t={t} />
          ) : launchWorkflow === 'landing-page-builder' ? (
            <div className={css.newSessionBlankPage}>
              <strong>{t('pageBuilderBlankTitle')}</strong>
              <p>{t('pageBuilderBlankDescription')}</p>
            </div>
          ) : launchWorkflow === 'website-clone' ? (
            <div className={css.newSessionStructuredForm}>
              <label><span>{t('websiteImportUrl')}</span><input type="url" value={cloneUrl}
                placeholder={t('pageUrlExample')} onChange={(event) => { setCloneUrl(event.currentTarget.value); setError('') }} /></label>
              <fieldset>
                <legend>{t('websiteImportMode')}</legend>
                <div className={css.newSessionChoiceRow}>
                  <button type="button" data-active={cloneMode === 'faithful'} onClick={() => { setCloneMode('faithful') }}>
                    <strong>{t('websiteImportFaithful')}</strong><span>{t('websiteImportFaithfulDescription')}</span>
                  </button>
                  <button type="button" data-active={cloneMode === 'adapt'} onClick={() => { setCloneMode('adapt') }}>
                    <strong>{t('websiteImportAdapt')}</strong><span>{t('websiteImportAdaptDescription')}</span>
                  </button>
                </div>
              </fieldset>
            </div>
          ) : launchWorkflow === 'existing-page' ? (
            <div className={css.newSessionStructuredForm}>
              <fieldset>
                <legend>{t('existingPageSource')}</legend>
                <div className={css.newSessionChoiceRow}>
                  <button type="button" data-active={existingSource === 'folder'} onClick={() => { setExistingSource('folder'); setError('') }}>
                    <strong>{t('existingPageProjectFolder')}</strong><span>{t('existingPageProjectFolderDescription')}</span>
                  </button>
                  <button type="button" data-active={existingSource === 'github'} onClick={() => { setExistingSource('github'); setError('') }}>
                    <strong>{t('existingPageGithub')}</strong><span>{t('existingPageGithubDescription')}</span>
                  </button>
                </div>
              </fieldset>
              {existingSource === 'github' ? <label><span>{t('existingPageRepository')}</span><input type="url"
                value={existingRepository} placeholder={t('repositoryUrlExample')}
                onChange={(event) => { setExistingRepository(event.currentTarget.value); setError('') }} /></label> : null}
              {existingSource === 'folder' ? (
                <div className={css.newSessionFolderPicker}>
                  <span>{t('existingPageSubfolder')}</span>
                  <Button variant="outline" disabled={starting} onClick={() => { void chooseExistingFolder() }}>{t('existingPageChooseSubfolder')}</Button>
                  <code>{existingSubfolder === '' ? t('existingPageNoFolder') : existingSubfolder}</code>
                </div>
              ) : <label><span>{t('existingPageRepositoryFolder')}</span><input
                value={existingSubfolder} placeholder={t('projectFolderExample')} onChange={(event) => { setExistingSubfolder(event.currentTarget.value); setError('') }} /></label>}
              <label><span>{t('existingPageEntry')}</span><input value={existingEntry}
                placeholder={t('entryPointExample')} onChange={(event) => { setExistingEntry(event.currentTarget.value) }} /></label>
              <label><span>{t('existingPageGoal')}</span><textarea rows={3} value={existingGoal}
                placeholder={t('existingPageGoalPlaceholder')} onChange={(event) => { setExistingGoal(event.currentTarget.value) }} /></label>
            </div>
          ) : (
            <div className={css.newSessionBrief}>
              <div><strong>{t('quickBriefTitle')}</strong><p>{t(launchWorkflow === 'canvas' || launchWorkflow === 'docs' ? workflow.prompt : 'quickBriefDescription')}</p></div>
              <textarea rows={5} value={prompt} disabled={starting} aria-label={t('describeBuild')}
                placeholder={t(workflow.example)} onChange={(event) => { setPrompt(event.currentTarget.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void start() }} />
            </div>
          )}
          <div className={css.newSessionPromptFooter}>
            <span>{launchWorkflow === 'landing-page-builder'
              ? t('pageBuilderBlankHint')
              : launchWorkflow === 'website-clone' || launchWorkflow === 'existing-page'
                ? t('requiredFieldsHint')
                : t('startSessionHint')}</span>
            <Button variant="prominent" size="sm" disabled={!canStart} onClick={() => { void start() }}>
              {starting ? t('sessionStarting') : startLabel}
            </Button>
          </div>
        </div>
      )}
      {error === '' ? null : <p className={css.workflowError} role="alert">{t('sessionCreateFailed')} {error}</p>}
    </section>
  )
}
