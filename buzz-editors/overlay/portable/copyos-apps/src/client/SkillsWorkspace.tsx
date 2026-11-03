/** Native Harness skill library for one CopyOS project. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSSkillDocument,
  CopyOSSkillEnabledRequest,
  CopyOSSkillImportRequest,
  CopyOSSkillSaveRequest,
  CopyOSSkillScope,
  CopyOSWorkflowId,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed native skill operations. */
export interface SkillsWorkspaceActions {
  readonly listSkills: (workspaceId: string) => Promise<readonly CopyOSSkillDocument[]>
  readonly saveSkill: (request: CopyOSSkillSaveRequest) => Promise<CopyOSSkillDocument>
  readonly importSkill: (request: CopyOSSkillImportRequest) => Promise<CopyOSSkillDocument>
  readonly setSkillEnabled: (request: CopyOSSkillEnabledRequest) => Promise<CopyOSSkillDocument>
}

interface Props {
  readonly workspaceId: string
  readonly scope: CopyOSSkillScope
  readonly t: Translate
  readonly actions: SkillsWorkspaceActions
}

interface Draft {
  readonly originalName?: string
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
  readonly scope: CopyOSSkillScope
  readonly enabled: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly workflows: readonly CopyOSWorkflowId[]
}

const WORKFLOW_OPTIONS: readonly [CopyOSWorkflowId, CopyOSFoundationLocaleKey][] = [
  ['copywriter', 'workflowCopywriter'],
  ['landing-page-builder', 'workflowLandingPage'],
  ['website-clone', 'workflowWebsiteClone'],
  ['existing-page', 'workflowExistingPage'],
  ['strategy', 'workflowStrategyBuilder'],
  ['cro-analyst', 'workflowCro'],
  ['ad-scriptwriter', 'workflowAdScript'],
  ['creative-strategist', 'workflowStrategist'],
  ['researcher', 'workflowResearcher'],
]

/** Create, import, edit, and disable project or universal CopyOS skills. */
export function SkillsWorkspace({ workspaceId, scope, t, actions }: Props): ReactNode {
  const [skills, setSkills] = useState<readonly CopyOSSkillDocument[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(t, scope))
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importMarkdown, setImportMarkdown] = useState('')

  const load = useCallback(async () => {
    setPhase('loading'); setError('')
    try {
      const next = await actions.listSkills(workspaceId)
      setSkills(next)
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError)); setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const selected = useMemo(
    () => skills.find(skill => skillKey(skill) === selectedKey),
    [selectedKey, skills],
  )
  const visibleSkills = useMemo(() => skills.filter(skill => skill.scope === scope), [scope, skills])

  const select = (skill: CopyOSSkillDocument): void => {
    setSelectedKey(skillKey(skill))
    setDraft({
      originalName: skill.name,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      content: skill.content,
      scope: skill.scope,
      enabled: skill.enabled,
      modelInvocable: skill.modelInvocable,
      userInvocable: skill.userInvocable,
      workflows: skill.workflows,
    })
    setSaved(false); setError('')
  }

  const create = (): void => {
    setSelectedKey(null); setDraft(emptyDraft(t, scope)); setSaved(false); setError('')
  }

  const save = async (): Promise<void> => {
    setSaving(true); setError(''); setSaved(false)
    try {
      const next = await actions.saveSkill({ workspaceId, ...draft })
      setSkills(current => [next, ...current.filter(skill => skillKey(skill) !== skillKey(next)
        && !(skill.scope === next.scope && skill.name === draft.originalName))]
        .sort((left, right) => left.name.localeCompare(right.name)))
      select(next)
      setSaved(true)
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const importFromMarkdown = async (): Promise<void> => {
    setSaving(true); setError('')
    try {
      const next = await actions.importSkill({ workspaceId, scope, markdown: importMarkdown })
      setSkills(current => [next, ...current.filter(skill => skillKey(skill) !== skillKey(next))]
        .sort((left, right) => left.name.localeCompare(right.name)))
      select(next)
      setImportMarkdown(''); setImportOpen(false); setSaved(true)
    } catch (importError: unknown) {
      setError(errorMessage(importError))
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (skill: CopyOSSkillDocument): Promise<void> => {
    setSaving(true); setError('')
    try {
      const next = await actions.setSkillEnabled({
        workspaceId, scope: skill.scope, name: skill.name, enabled: !skill.enabled,
      })
      setSkills(current => current.map(item => skillKey(item) === skillKey(skill) ? next : item))
      if (selectedKey === skillKey(skill)) select(next)
    } catch (toggleError: unknown) {
      setError(errorMessage(toggleError))
    } finally {
      setSaving(false)
    }
  }

  const toggleWorkflow = (workflow: CopyOSWorkflowId): void => {
    setDraft(current => ({
      ...current,
      workflows: current.workflows.includes(workflow)
        ? current.workflows.filter(item => item !== workflow)
        : [...current.workflows, workflow],
    }))
    setSaved(false)
  }

  const valid = draft.name.trim() !== '' && draft.description.trim() !== '' && draft.content.trim() !== ''
    && (draft.modelInvocable || draft.userInvocable)

  return (
    <section className={css.skillsWorkspace} data-scope={scope}
      aria-labelledby={scope === 'global' ? 'copyos-skills-title' : undefined} aria-label={scope === 'project' ? t('skillsTitle') : undefined}>
      <div className={scope === 'global' ? css.assetWorkspaceHeader : css.skillsProjectToolbar}>
        {scope === 'global' ? <div><h1 id="copyos-skills-title">{t('universalSkillsTitle')}</h1>
          <p>{t('universalSkillsDescription')}</p></div> : null}
        <div className={css.skillsHeaderActions}>
          <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setError('') }}>{t('skillsImport')}</Button>
          <Button variant="primary" size="sm" onClick={create}>{t('skillsNew')}</Button>
        </div>
      </div>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('skillsOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('skillsLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' ? (
        <div className={css.skillsShell}>
          <aside className={css.skillsList} aria-label={t('skillsLibrary')}>
            {visibleSkills.length === 0 ? <p>{t('skillsEmpty')}</p> : visibleSkills.map(skill => (
              <button key={skillKey(skill)} type="button" data-active={selectedKey === skillKey(skill)}
                onClick={() => { select(skill) }}>
                <span><strong>/{skill.name}</strong><small>{skill.description}</small></span>
                {skill.enabled ? null : <span className={css.skillsBadges}><em data-disabled="true">{t('skillsDisabled')}</em></span>}
              </button>
            ))}
          </aside>
          <div className={css.skillsEditor}>
            <div className={css.skillsEditorHeading}>
              <h4>{selected === undefined ? t('skillsCreateTitle') : `/${selected.name}`}</h4>
              {selected === undefined ? null : <Button variant="outline" disabled={saving}
                onClick={() => { void toggleEnabled(selected) }}>
                {t(selected.enabled ? 'skillsDisable' : 'skillsEnable')}
              </Button>}
            </div>
            <div className={css.skillsForm}>
              <label><span>{t('skillsName')}</span><input value={draft.name} placeholder="landing-page-hero"
                onChange={(event) => {
                  const name = event.currentTarget.value.toLowerCase().replaceAll(' ', '-')
                  setDraft(current => ({ ...current, name })); setSaved(false)
                }} /></label>
              <label className={css.skillsWide}><span>{t('skillsDescriptionLabel')}</span><textarea rows={3} value={draft.description}
                placeholder={t('skillsDescriptionPlaceholder')}
                onChange={(event) => {
                  const description = event.currentTarget.value
                  setDraft(current => ({ ...current, description })); setSaved(false)
                }} /></label>
              <label className={css.skillsWide}><span>{t('skillsWhenToUse')}</span><textarea rows={2} value={draft.whenToUse}
                onChange={(event) => {
                  const whenToUse = event.currentTarget.value
                  setDraft(current => ({ ...current, whenToUse })); setSaved(false)
                }} /></label>
              <fieldset className={css.skillsWide}><legend>{t('skillsInvocation')}</legend>
                <label><input type="checkbox" checked={draft.modelInvocable}
                  onChange={(event) => {
                    const modelInvocable = event.currentTarget.checked
                    setDraft(current => ({ ...current, modelInvocable })); setSaved(false)
                  }} />
                <span>{t('skillsAutomatic')}</span></label>
                <label><input type="checkbox" checked={draft.userInvocable}
                  onChange={(event) => {
                    const userInvocable = event.currentTarget.checked
                    setDraft(current => ({ ...current, userInvocable })); setSaved(false)
                  }} />
                <span>{t('skillsSlashCommand')}</span></label>
              </fieldset>
              <fieldset className={`${css.skillsWide} ${css.skillsWorkflowField}`}><legend>{t('skillsAppliesTo')}</legend>
                <div>{WORKFLOW_OPTIONS.map(([id, key]) => (
                  <label key={id} data-active={draft.workflows.includes(id)}><input type="checkbox" checked={draft.workflows.includes(id)}
                    onChange={() => { toggleWorkflow(id) }} /><span>{t(key)}</span></label>
                ))}</div>
              </fieldset>
              <label className={css.skillsWide}><span>{t('skillsInstructions')}</span><textarea className={css.skillsCodeEditor} rows={18}
                value={draft.content} onChange={(event) => {
                  const content = event.currentTarget.value
                  setDraft(current => ({ ...current, content })); setSaved(false)
                }} /></label>
            </div>
            <div className={css.skillsFooter}>
              <span>{saved ? t('skillsSaved') : draft.enabled ? '' : t('skillsDisabled')}</span>
              <Button variant="primary" disabled={saving || !valid} onClick={() => { void save() }}>
                {saving ? t('savingAsset') : t('skillsSave')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <Modal open={importOpen} onClose={() => { if (!saving) setImportOpen(false) }} closeLabel={t('cancel')}
        title={t('skillsImportTitle')} description={t('skillsImportDescription')} className={css.assetDialog as string}
        footer={<><Button variant="outline" disabled={saving} onClick={() => { setImportOpen(false) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={saving || importMarkdown.trim() === ''}
            onClick={() => { void importFromMarkdown() }}>{t('skillsImportAction')}</Button></>}>
        <div className={css.skillsImportForm}>
          <label><span>{t('skillsScope')}</span><select value={scope} disabled>
            <option value={scope}>{t(scope === 'project' ? 'skillsProjectScope' : 'skillsGlobalScope')}</option>
          </select></label>
          <label><span>{t('skillsMarkdown')}</span><textarea rows={18} value={importMarkdown}
            placeholder={t('skillsMarkdownPlaceholder')}
            onChange={(event) => { setImportMarkdown(event.currentTarget.value) }} /></label>
        </div>
      </Modal>
    </section>
  )
}

function emptyDraft(t: Translate, scope: CopyOSSkillScope): Draft {
  return {
    name: '',
    description: '',
    whenToUse: '',
    content: t('skillsDefaultInstructions'),
    scope,
    enabled: true,
    modelInvocable: true,
    userInvocable: true,
    workflows: [],
  }
}

function skillKey(skill: Pick<CopyOSSkillDocument, 'scope' | 'name'>): string {
  return `${skill.scope}:${skill.name}`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
