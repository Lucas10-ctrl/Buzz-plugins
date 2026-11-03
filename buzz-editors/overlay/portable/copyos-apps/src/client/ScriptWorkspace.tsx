/** Durable channel-ready ad scripts and strategically distinct variations. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSBriefDocument,
  CopyOSScriptAspectRatio,
  CopyOSScriptChannel,
  CopyOSScriptCreateRequest,
  CopyOSScriptDocument,
  CopyOSScriptVariantCreateRequest,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed ad-script operations scoped to one Workspace. */
export interface ScriptWorkspaceActions {
  readonly listScripts: (workspaceId: string) => Promise<readonly CopyOSScriptDocument[]>
  readonly createScript: (request: CopyOSScriptCreateRequest) => Promise<CopyOSScriptDocument>
  readonly addScriptVariant: (request: CopyOSScriptVariantCreateRequest) => Promise<CopyOSScriptDocument>
  readonly listBriefs: (workspaceId: string) => Promise<readonly CopyOSBriefDocument[]>
}

interface Props {
  readonly workspaceId: string
  readonly t: Translate
  readonly actions: ScriptWorkspaceActions
}

const EMPTY_CONTENT = {
  label: '', angle: '', hook: '', beats: '', visualDirection: '', spokenCopy: '', onScreenText: '', proof: '', cta: '',
}
const EMPTY_SCRIPT = {
  title: '', channel: 'meta' as CopyOSScriptChannel, durationSeconds: '30',
  aspectRatio: '9:16' as CopyOSScriptAspectRatio, briefId: '', ...EMPTY_CONTENT,
}

/** Render durable ad scripts and their complete selected variations. */
export function ScriptWorkspace({ workspaceId, t, actions }: Props): ReactNode {
  const [scripts, setScripts] = useState<readonly CopyOSScriptDocument[]>([])
  const [briefs, setBriefs] = useState<readonly CopyOSBriefDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [variantScriptId, setVariantScriptId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(EMPTY_SCRIPT)
  const [variantDraft, setVariantDraft] = useState(EMPTY_CONTENT)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      const [nextScripts, nextBriefs] = await Promise.all([
        actions.listScripts(workspaceId), actions.listBriefs(workspaceId),
      ])
      setScripts(nextScripts)
      setBriefs(nextBriefs)
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const selectedScript = useMemo(
    () => scripts.find(script => script.id === variantScriptId),
    [scripts, variantScriptId],
  )

  const create = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const script = await actions.createScript({
        workspaceId, title: draft.title, channel: draft.channel,
        durationSeconds: Number(draft.durationSeconds), aspectRatio: draft.aspectRatio,
        ...draft.briefId === '' ? {} : { briefId: draft.briefId },
        label: draft.label, angle: draft.angle, hook: draft.hook, beats: draft.beats,
        visualDirection: draft.visualDirection, spokenCopy: draft.spokenCopy,
        onScreenText: draft.onScreenText, proof: draft.proof, cta: draft.cta,
      })
      setScripts(current => [script, ...current])
      setDraft(EMPTY_SCRIPT)
      setCreateOpen(false)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const addVariant = async (): Promise<void> => {
    if (variantScriptId === null) return
    setSaving(true)
    setError('')
    try {
      const updated = await actions.addScriptVariant({ workspaceId, scriptId: variantScriptId, ...variantDraft })
      setScripts(current => current.map(script => script.id === updated.id ? updated : script))
      setVariantDraft(EMPTY_CONTENT)
      setVariantScriptId(null)
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={css.assetWorkspace}>
      <div className={css.assetWorkspaceHeader}>
        <div><h3>{t('scriptWorkspaceTitle')}</h3><p>{t('scriptWorkspaceDescription')}</p></div>
        <Button variant="primary" onClick={() => { setCreateOpen(true) }}>{t('newScript')}</Button>
      </div>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('scriptOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('scriptsLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' && scripts.length === 0 ? <p className={css.assetState}>{t('scriptsEmpty')}</p> : null}
      {scripts.length === 0 ? null : (
        <div className={css.assetList}>
          {scripts.map((script) => {
            const selected = script.variants.find(variant => variant.id === script.selectedVariantId)
            return <article key={script.id} className={css.assetCard}>
              <div className={css.assetCardHeader}>
                <div><h4>{script.title}</h4><span>{t('scriptSummary').replace('{channel}', script.channel).replace('{seconds}', String(script.durationSeconds)).replace('{ratio}', script.aspectRatio)}</span></div>
                <Button variant="outline" onClick={() => { setVariantScriptId(script.id) }}>{t('addScriptVariation')}</Button>
              </div>
              <p className={css.selectedVariationLabel}>{selected?.label ?? t('selectedVariation')}</p>
              <ScriptField label={t('scriptAngle')} value={selected?.angle ?? ''} />
              <ScriptField label={t('scriptHook')} value={selected?.hook ?? ''} />
              <ScriptField label={t('scriptBeats')} value={selected?.beats ?? ''} />
              <ScriptField label={t('scriptVisualDirection')} value={selected?.visualDirection ?? ''} />
              <ScriptField label={t('scriptSpokenCopy')} value={selected?.spokenCopy ?? ''} />
              {selected?.onScreenText === '' ? null : <ScriptField label={t('scriptOnScreenText')} value={selected?.onScreenText ?? ''} />}
              {selected?.proof === '' ? null : <ScriptField label={t('scriptProof')} value={selected?.proof ?? ''} />}
              <ScriptField label={t('scriptCta')} value={selected?.cta ?? ''} />
              <div className={css.variationList}>{script.variants.map(variant => (
                <span key={variant.id} data-selected={variant.id === script.selectedVariantId}>{variant.label}</span>
              ))}</div>
            </article>
          })}
        </div>
      )}
      <Modal open={createOpen} onClose={() => { if (!saving) setCreateOpen(false) }} closeLabel={t('cancel')}
        title={t('newScript')} description={t('newScriptDescription')} className={css.scriptDialog as string}
        footer={<ModalActions t={t} saving={saving} label={t('saveScript')}
          onCancel={() => { setCreateOpen(false) }} onSave={() => { void create() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('assetTitle')} value={draft.title} onChange={(title) => { setDraft(current => ({ ...current, title })) }} />
          <div className={css.scriptConstraintGrid}>
            <SelectField label={t('scriptChannel')} value={draft.channel} options={['meta', 'tiktok', 'youtube', 'linkedin', 'other']}
              onChange={(channel) => { setDraft(current => ({ ...current, channel: channel as CopyOSScriptChannel })) }} />
            <TextField label={t('scriptDuration')} value={draft.durationSeconds}
              onChange={(durationSeconds) => { setDraft(current => ({ ...current, durationSeconds })) }} />
            <SelectField label={t('scriptAspectRatio')} value={draft.aspectRatio} options={['9:16', '1:1', '16:9', 'other']}
              onChange={(aspectRatio) => { setDraft(current => ({ ...current, aspectRatio: aspectRatio as CopyOSScriptAspectRatio })) }} />
            <SelectField label={t('sourceBrief')} value={draft.briefId}
              options={['', ...briefs.map(brief => brief.id)]} labels={['—', ...briefs.map(brief => brief.title)]}
              onChange={(briefId) => { setDraft(current => ({ ...current, briefId })) }} />
          </div>
          <ContentFields t={t} draft={draft} onChange={(field, value) => { setDraft(current => ({ ...current, [field]: value })) }} />
        </div>
      </Modal>
      <Modal open={selectedScript !== undefined} onClose={() => { if (!saving) setVariantScriptId(null) }} closeLabel={t('cancel')}
        title={t('addScriptVariation')} description={selectedScript?.title ?? ''} className={css.scriptDialog as string}
        footer={<ModalActions t={t} saving={saving} label={t('saveScriptVariation')}
          onCancel={() => { setVariantScriptId(null) }} onSave={() => { void addVariant() }} />}>
        <div className={css.assetForm}>
          <ContentFields t={t} draft={variantDraft}
            onChange={(field, value) => { setVariantDraft(current => ({ ...current, [field]: value })) }} />
        </div>
      </Modal>
    </section>
  )
}

function ContentFields({ t, draft, onChange }: {
  readonly t: Translate
  readonly draft: typeof EMPTY_CONTENT
  readonly onChange: (field: keyof typeof EMPTY_CONTENT, value: string) => void
}): ReactNode {
  return <>
    <TextField label={t('variationLabel')} value={draft.label} onChange={(value) => { onChange('label', value) }} />
    <TextArea label={t('scriptAngle')} value={draft.angle} onChange={(value) => { onChange('angle', value) }} />
    <TextArea label={t('scriptHook')} value={draft.hook} onChange={(value) => { onChange('hook', value) }} />
    <TextArea label={t('scriptBeats')} value={draft.beats} onChange={(value) => { onChange('beats', value) }} />
    <TextArea label={t('scriptVisualDirection')} value={draft.visualDirection} onChange={(value) => { onChange('visualDirection', value) }} />
    <TextArea label={t('scriptSpokenCopy')} value={draft.spokenCopy} onChange={(value) => { onChange('spokenCopy', value) }} />
    <TextArea label={t('scriptOnScreenText')} value={draft.onScreenText} onChange={(value) => { onChange('onScreenText', value) }} />
    <TextArea label={t('scriptProof')} value={draft.proof} onChange={(value) => { onChange('proof', value) }} />
    <TextField label={t('scriptCta')} value={draft.cta} onChange={(value) => { onChange('cta', value) }} />
  </>
}

function ScriptField({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return <div className={css.assetField}><strong>{label}</strong><p>{value}</p></div>
}

function TextField({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span>
    <input value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
  </label>
}

function TextArea({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span>
    <textarea rows={4} value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
  </label>
}

function SelectField({ label, value, options, labels = options, onChange }: {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly labels?: readonly string[]
  readonly onChange: (value: string) => void
}): ReactNode {
  return <label className={css.formField}><span>{label}</span>
    <select value={value} onChange={(event) => { onChange(event.currentTarget.value) }}>
      {options.map((option, index) => <option key={option} value={option}>{labels[index]}</option>)}
    </select>
  </label>
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
