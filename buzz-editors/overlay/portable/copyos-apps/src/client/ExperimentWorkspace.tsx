/** Durable hypothesis-led CRO experiments with explicit observed results. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSCopyDocument,
  CopyOSExperimentArtifactKind,
  CopyOSExperimentCreateRequest,
  CopyOSExperimentDocument,
  CopyOSExperimentResultRequest,
  CopyOSExperimentStartRequest,
  CopyOSPageDocument,
  CopyOSScriptDocument,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed experiment and artifact operations scoped to one Workspace. */
export interface ExperimentWorkspaceActions {
  readonly listExperiments: (workspaceId: string) => Promise<readonly CopyOSExperimentDocument[]>
  readonly createExperiment: (request: CopyOSExperimentCreateRequest) => Promise<CopyOSExperimentDocument>
  readonly startExperiment: (request: CopyOSExperimentStartRequest) => Promise<CopyOSExperimentDocument>
  readonly recordExperimentResult: (request: CopyOSExperimentResultRequest) => Promise<CopyOSExperimentDocument>
  readonly listPages: (workspaceId: string) => Promise<readonly CopyOSPageDocument[]>
  readonly listCopy: (workspaceId: string) => Promise<readonly CopyOSCopyDocument[]>
  readonly listScripts: (workspaceId: string) => Promise<readonly CopyOSScriptDocument[]>
}

interface Props {
  readonly workspaceId: string
  readonly t: Translate
  readonly actions: ExperimentWorkspaceActions
}

const EMPTY_EXPERIMENT = {
  title: '', artifactKind: 'other' as CopyOSExperimentArtifactKind, artifactId: '', hypothesis: '',
  primaryMetric: '', audience: '', controlLabel: '', controlDescription: '',
  variantLabel: '', variantDescription: '',
}
const EMPTY_RESULT = {
  controlVisitors: '', controlConversions: '', variantVisitors: '', variantConversions: '',
  outcome: 'inconclusive' as CopyOSExperimentResultRequest['outcome'], analysis: '',
}

/** Render planned, running, and completed CRO experiments for one CopyOS project. */
export function ExperimentWorkspace({ workspaceId, t, actions }: Props): ReactNode {
  const [experiments, setExperiments] = useState<readonly CopyOSExperimentDocument[]>([])
  const [pages, setPages] = useState<readonly CopyOSPageDocument[]>([])
  const [copy, setCopy] = useState<readonly CopyOSCopyDocument[]>([])
  const [scripts, setScripts] = useState<readonly CopyOSScriptDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [resultExperimentId, setResultExperimentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const emptyExperiment = () => ({ ...EMPTY_EXPERIMENT, controlLabel: t('experimentDefaultControl'), variantLabel: t('experimentDefaultVariant') })
  const [draft, setDraft] = useState(emptyExperiment)
  const [resultDraft, setResultDraft] = useState(EMPTY_RESULT)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      const [nextExperiments, nextPages, nextCopy, nextScripts] = await Promise.all([
        actions.listExperiments(workspaceId), actions.listPages(workspaceId),
        actions.listCopy(workspaceId), actions.listScripts(workspaceId),
      ])
      setExperiments(nextExperiments)
      setPages(nextPages)
      setCopy(nextCopy)
      setScripts(nextScripts)
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const artifactOptions = useMemo(() => {
    if (draft.artifactKind === 'page') return pages.map(page => ({ id: page.id, title: page.title }))
    if (draft.artifactKind === 'copy') return copy.map(asset => ({ id: asset.id, title: asset.title }))
    if (draft.artifactKind === 'script') return scripts.map(script => ({ id: script.id, title: script.title }))
    return []
  }, [copy, draft.artifactKind, pages, scripts])

  const selectedResultExperiment = experiments.find(experiment => experiment.id === resultExperimentId)

  const create = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const experiment = await actions.createExperiment({
        workspaceId, title: draft.title, artifactKind: draft.artifactKind,
        ...draft.artifactKind === 'other' ? {} : { artifactId: draft.artifactId },
        hypothesis: draft.hypothesis, primaryMetric: draft.primaryMetric, audience: draft.audience,
        controlLabel: draft.controlLabel, controlDescription: draft.controlDescription,
        variantLabel: draft.variantLabel, variantDescription: draft.variantDescription,
      })
      setExperiments(current => [experiment, ...current])
      setDraft(emptyExperiment())
      setCreateOpen(false)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const start = async (experimentId: string): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      replaceExperiment(await actions.startExperiment({ workspaceId, experimentId }))
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const recordResult = async (): Promise<void> => {
    if (resultExperimentId === null) return
    setSaving(true)
    setError('')
    try {
      replaceExperiment(await actions.recordExperimentResult({
        workspaceId, experimentId: resultExperimentId,
        controlVisitors: Number(resultDraft.controlVisitors),
        controlConversions: Number(resultDraft.controlConversions),
        variantVisitors: Number(resultDraft.variantVisitors),
        variantConversions: Number(resultDraft.variantConversions),
        outcome: resultDraft.outcome, analysis: resultDraft.analysis,
      }))
      setResultDraft(EMPTY_RESULT)
      setResultExperimentId(null)
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const replaceExperiment = (updated: CopyOSExperimentDocument): void => {
    setExperiments(current => current.map(experiment => experiment.id === updated.id ? updated : experiment))
  }

  return <section className={css.assetWorkspace}>
    <div className={css.assetWorkspaceHeader}>
      <div><h3>{t('experimentWorkspaceTitle')}</h3><p>{t('experimentWorkspaceDescription')}</p></div>
      <Button variant="primary" onClick={() => { setCreateOpen(true) }}>{t('newExperiment')}</Button>
    </div>
    {error === '' ? null : <p className={css.assetError} role="alert">{t('experimentOperationFailed')} {error}</p>}
    {phase === 'loading' ? <p className={css.assetState} role="status">{t('experimentsLoading')}</p> : null}
    {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
    {phase === 'ready' && experiments.length === 0 ? <p className={css.assetState}>{t('experimentsEmpty')}</p> : null}
    {experiments.length === 0 ? null : <div className={css.assetList}>{experiments.map(experiment => (
      <article key={experiment.id} className={css.assetCard}>
        <div className={css.assetCardHeader}>
          <div><h4>{experiment.title}</h4><span>{statusLabel(t, experiment.status)} · {experiment.primaryMetric}</span></div>
          {experiment.status === 'draft'
            ? <Button variant="outline" disabled={saving} onClick={() => { void start(experiment.id) }}>{t('startExperiment')}</Button>
            : experiment.status === 'running'
              ? <Button variant="outline" disabled={saving} onClick={() => { setResultExperimentId(experiment.id) }}>{t('recordResults')}</Button>
              : null}
        </div>
        <ExperimentField label={t('experimentHypothesis')} value={experiment.hypothesis} />
        <ExperimentField label={t('experimentAudience')} value={experiment.audience} />
        <div className={css.experimentVariants}>
          <ExperimentVariant label={experiment.controlLabel} description={experiment.controlDescription} />
          <ExperimentVariant label={experiment.variantLabel} description={experiment.variantDescription} />
        </div>
        {experiment.result === undefined ? null : <ExperimentResult experiment={experiment} t={t} />}
      </article>
    ))}</div>}
    <Modal open={createOpen} onClose={() => { if (!saving) setCreateOpen(false) }} closeLabel={t('cancel')}
      title={t('newExperiment')} description={t('newExperimentDescription')} className={css.scriptDialog as string}
      footer={<ModalActions t={t} saving={saving} label={t('saveExperiment')}
        onCancel={() => { setCreateOpen(false) }} onSave={() => { void create() }} />}>
      <div className={css.assetForm}>
        <TextField label={t('assetTitle')} value={draft.title} onChange={(title) => { setDraft(current => ({ ...current, title })) }} />
        <div className={css.scriptConstraintGrid}>
          <SelectField label={t('experimentArtifactKind')} value={draft.artifactKind}
            options={['other', 'page', 'copy', 'script']}
            labels={[t('experimentOther'), t('experimentPage'), t('experimentCopy'), t('experimentScript')]}
            onChange={(artifactKind) => { setDraft(current => ({ ...current, artifactKind: artifactKind as CopyOSExperimentArtifactKind, artifactId: '' })) }} />
          {draft.artifactKind === 'other' ? null : <SelectField label={t('experimentArtifact')} value={draft.artifactId}
            options={['', ...artifactOptions.map(option => option.id)]}
            labels={['—', ...artifactOptions.map(option => option.title)]}
            onChange={(artifactId) => { setDraft(current => ({ ...current, artifactId })) }} />}
        </div>
        <TextArea label={t('experimentHypothesis')} value={draft.hypothesis} onChange={(hypothesis) => { setDraft(current => ({ ...current, hypothesis })) }} />
        <TextField label={t('experimentMetric')} value={draft.primaryMetric} onChange={(primaryMetric) => { setDraft(current => ({ ...current, primaryMetric })) }} />
        <TextArea label={t('experimentAudience')} value={draft.audience} onChange={(audience) => { setDraft(current => ({ ...current, audience })) }} />
        <div className={css.experimentVariants}>
          <div><TextField label={t('controlLabel')} value={draft.controlLabel} onChange={(controlLabel) => { setDraft(current => ({ ...current, controlLabel })) }} />
            <TextArea label={t('controlDescription')} value={draft.controlDescription} onChange={(controlDescription) => { setDraft(current => ({ ...current, controlDescription })) }} /></div>
          <div><TextField label={t('variantLabel')} value={draft.variantLabel} onChange={(variantLabel) => { setDraft(current => ({ ...current, variantLabel })) }} />
            <TextArea label={t('variantDescription')} value={draft.variantDescription} onChange={(variantDescription) => { setDraft(current => ({ ...current, variantDescription })) }} /></div>
        </div>
      </div>
    </Modal>
    <Modal open={selectedResultExperiment !== undefined} onClose={() => { if (!saving) setResultExperimentId(null) }} closeLabel={t('cancel')}
      title={t('recordResults')} description={selectedResultExperiment?.title ?? ''} className={css.scriptDialog as string}
      footer={<ModalActions t={t} saving={saving} label={t('saveResults')}
        onCancel={() => { setResultExperimentId(null) }} onSave={() => { void recordResult() }} />}>
      <div className={css.assetForm}>
        <div className={css.experimentResultGrid}>
          <TextField label={t('controlVisitors')} value={resultDraft.controlVisitors} onChange={(controlVisitors) => { setResultDraft(current => ({ ...current, controlVisitors })) }} />
          <TextField label={t('controlConversions')} value={resultDraft.controlConversions} onChange={(controlConversions) => { setResultDraft(current => ({ ...current, controlConversions })) }} />
          <TextField label={t('variantVisitors')} value={resultDraft.variantVisitors} onChange={(variantVisitors) => { setResultDraft(current => ({ ...current, variantVisitors })) }} />
          <TextField label={t('variantConversions')} value={resultDraft.variantConversions} onChange={(variantConversions) => { setResultDraft(current => ({ ...current, variantConversions })) }} />
        </div>
        <SelectField label={t('experimentOutcome')} value={resultDraft.outcome}
          options={['control', 'variant', 'inconclusive']}
          labels={[t('outcomeControl'), t('outcomeVariant'), t('outcomeInconclusive')]}
          onChange={(outcome) => { setResultDraft(current => ({ ...current, outcome: outcome as CopyOSExperimentResultRequest['outcome'] })) }} />
        <TextArea label={t('experimentAnalysis')} value={resultDraft.analysis} onChange={(analysis) => { setResultDraft(current => ({ ...current, analysis })) }} />
      </div>
    </Modal>
  </section>
}

function ExperimentField({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return <div className={css.assetField}><strong>{label}</strong><p>{value}</p></div>
}

function ExperimentVariant({ label, description }: { readonly label: string; readonly description: string }): ReactNode {
  return <div className={css.experimentVariant}><strong>{label}</strong><p>{description}</p></div>
}

function ExperimentResult({ experiment, t }: { readonly experiment: CopyOSExperimentDocument; readonly t: Translate }): ReactNode {
  const result = experiment.result
  if (result === undefined) return null
  const controlRate = conversionRate(result.controlConversions, result.controlVisitors)
  const variantRate = conversionRate(result.variantConversions, result.variantVisitors)
  const lift = controlRate === 0 ? null : ((variantRate - controlRate) / controlRate) * 100
  return <div className={css.experimentResult}>
    <strong>{t('experimentResult')}</strong>
    <span>{experiment.controlLabel}: {controlRate.toFixed(2)}% ({result.controlConversions}/{result.controlVisitors})</span>
    <span>{experiment.variantLabel}: {variantRate.toFixed(2)}% ({result.variantConversions}/{result.variantVisitors})</span>
    <span>{t('observedLift')}: {lift === null ? '—' : `${lift >= 0 ? '+' : ''}${lift.toFixed(2)}%`}</span>
    <p>{result.analysis}</p>
  </div>
}

function conversionRate(conversions: number, visitors: number): number {
  return visitors === 0 ? 0 : conversions / visitors * 100
}

function statusLabel(t: Translate, status: CopyOSExperimentDocument['status']): string {
  if (status === 'running') return t('runningStatus')
  if (status === 'completed') return t('completedStatus')
  return t('draftStatus')
}

function TextField({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span><input value={value}
    onChange={(event) => { onChange(event.currentTarget.value) }} /></label>
}

function TextArea({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span><textarea rows={4} value={value}
    onChange={(event) => { onChange(event.currentTarget.value) }} /></label>
}

function SelectField({ label, value, options, labels, onChange }: {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly labels: readonly string[]
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span><select value={value}
    onChange={(event) => { onChange(event.currentTarget.value) }}>
    {options.map((option, index) => <option key={option} value={option}>{labels[index]}</option>)}
  </select></label>
}

function ModalActions({ t, saving, label, onCancel, onSave }: {
  readonly t: Translate
  readonly saving: boolean
  readonly label: string
  readonly onCancel: () => void
  readonly onSave: () => void
}): ReactNode {
  return <div className={css.modalActions}>
    <Button variant="outline" disabled={saving} onClick={onCancel}>{t('cancel')}</Button>
    <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? t('savingAsset') : label}</Button>
  </div>
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
