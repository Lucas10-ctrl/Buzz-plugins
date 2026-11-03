/** Durable brand profiles and evidence-bearing research for one CopyOS project. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSBrandCreateRequest,
  CopyOSBrandDocument,
  CopyOSResearchCreateRequest,
  CopyOSResearchDocument,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed strategic knowledge operations scoped to one Workspace. */
export interface BrandResearchActions {
  readonly listBrands: (workspaceId: string) => Promise<readonly CopyOSBrandDocument[]>
  readonly listResearch: (workspaceId: string) => Promise<readonly CopyOSResearchDocument[]>
  readonly createBrand: (request: CopyOSBrandCreateRequest) => Promise<CopyOSBrandDocument>
  readonly createResearch: (request: CopyOSResearchCreateRequest) => Promise<CopyOSResearchDocument>
}

interface Props {
  readonly workspaceId: string
  readonly t: Translate
  readonly actions: BrandResearchActions
}

const EMPTY_BRAND = { title: '', positioning: '', audience: '', voice: '', differentiators: '', guardrails: '' }
const EMPTY_RESEARCH = { title: '', topic: '', source: '', evidence: '', insight: '', tags: '' }

/** Render the shared strategic source of truth for one CopyOS project. */
export function BrandResearchWorkspace({ workspaceId, t, actions }: Props): ReactNode {
  const [brands, setBrands] = useState<readonly CopyOSBrandDocument[]>([])
  const [research, setResearch] = useState<readonly CopyOSResearchDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'brand' | 'research' | null>(null)
  const [saving, setSaving] = useState(false)
  const [brandDraft, setBrandDraft] = useState(EMPTY_BRAND)
  const [researchDraft, setResearchDraft] = useState(EMPTY_RESEARCH)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      const [nextBrands, nextResearch] = await Promise.all([
        actions.listBrands(workspaceId),
        actions.listResearch(workspaceId),
      ])
      setBrands(nextBrands)
      setResearch(nextResearch)
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const saveBrand = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const brand = await actions.createBrand({ workspaceId, ...brandDraft })
      setBrands(current => [brand, ...current])
      setBrandDraft(EMPTY_BRAND)
      setModal(null)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const saveResearch = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const note = await actions.createResearch({
        workspaceId,
        ...researchDraft,
        tags: researchDraft.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
      })
      setResearch(current => [note, ...current])
      setResearchDraft(EMPTY_RESEARCH)
      setModal(null)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const close = (): void => { if (!saving) setModal(null) }
  const allEmpty = useMemo(() => brands.length === 0 && research.length === 0, [brands, research])

  return (
    <section className={css.assetWorkspace}>
      <div className={css.assetWorkspaceHeader}>
        <div><h3>{t('brandResearchTitle')}</h3><p>{t('brandResearchDescription')}</p></div>
        <div className={css.knowledgeActions}>
          <Button variant="outline" onClick={() => { setModal('research') }}>{t('newResearch')}</Button>
          <Button variant="primary" onClick={() => { setModal('brand') }}>{t('newBrand')}</Button>
        </div>
      </div>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('knowledgeOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('knowledgeLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' && allEmpty ? <p className={css.assetState}>{t('knowledgeEmpty')}</p> : null}
      <div className={css.knowledgeColumns}>
        <KnowledgeColumn title={t('brandProfiles')} empty={t('brandsEmpty')} hasRecords={brands.length > 0}>
          {brands.map(brand => (
            <article key={brand.id} className={css.assetCard}>
              <div className={css.assetCardHeader}><h4>{brand.title}</h4><span>{t('activeStatus')}</span></div>
              <KnowledgeField label={t('brandPositioning')} value={brand.positioning} />
              <KnowledgeField label={t('brandAudience')} value={brand.audience} />
              <KnowledgeField label={t('brandVoice')} value={brand.voice} />
              <KnowledgeField label={t('brandDifferentiators')} value={brand.differentiators} />
              {brand.guardrails === '' ? null : <KnowledgeField label={t('brandGuardrails')} value={brand.guardrails} />}
            </article>
          ))}
        </KnowledgeColumn>
        <KnowledgeColumn title={t('researchNotes')} empty={t('researchEmpty')} hasRecords={research.length > 0}>
          {research.map(note => (
            <article key={note.id} className={css.assetCard}>
              <div className={css.assetCardHeader}><h4>{note.title}</h4><span>{t('sourcedStatus')}</span></div>
              <KnowledgeField label={t('researchTopic')} value={note.topic} />
              <KnowledgeField label={t('researchSource')} value={note.source} />
              <KnowledgeField label={t('researchEvidence')} value={note.evidence} />
              <KnowledgeField label={t('researchInsight')} value={note.insight} />
              {note.tags.length === 0 ? null : (
                <div className={css.variationList}>{note.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
              )}
            </article>
          ))}
        </KnowledgeColumn>
      </div>
      <Modal open={modal === 'brand'} onClose={close} closeLabel={t('cancel')}
        title={t('newBrand')} description={t('newBrandDescription')} className={css.assetDialog as string} contentClassName={css.assetDialogContent as string}
        footer={<ModalActions t={t} saving={saving} label={t('saveBrand')} onCancel={close} onSave={() => { void saveBrand() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('assetTitle')} value={brandDraft.title} onChange={(title) => { setBrandDraft(current => ({ ...current, title })) }} />
          <TextArea label={t('brandPositioning')} value={brandDraft.positioning} onChange={(positioning) => { setBrandDraft(current => ({ ...current, positioning })) }} />
          <TextArea label={t('brandAudience')} value={brandDraft.audience} onChange={(audience) => { setBrandDraft(current => ({ ...current, audience })) }} />
          <TextArea label={t('brandVoice')} value={brandDraft.voice} onChange={(voice) => { setBrandDraft(current => ({ ...current, voice })) }} />
          <TextArea label={t('brandDifferentiators')} value={brandDraft.differentiators} onChange={(differentiators) => { setBrandDraft(current => ({ ...current, differentiators })) }} />
          <TextArea label={t('brandGuardrails')} value={brandDraft.guardrails} onChange={(guardrails) => { setBrandDraft(current => ({ ...current, guardrails })) }} />
        </div>
      </Modal>
      <Modal open={modal === 'research'} onClose={close} closeLabel={t('cancel')}
        title={t('newResearch')} description={t('newResearchDescription')} className={css.assetDialog as string} contentClassName={css.assetDialogContent as string}
        footer={<ModalActions t={t} saving={saving} label={t('saveResearch')} onCancel={close} onSave={() => { void saveResearch() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('assetTitle')} value={researchDraft.title} onChange={(title) => { setResearchDraft(current => ({ ...current, title })) }} />
          <TextField label={t('researchTopic')} value={researchDraft.topic} onChange={(topic) => { setResearchDraft(current => ({ ...current, topic })) }} />
          <TextArea label={t('researchSource')} value={researchDraft.source} onChange={(source) => { setResearchDraft(current => ({ ...current, source })) }} />
          <TextArea label={t('researchEvidence')} value={researchDraft.evidence} onChange={(evidence) => { setResearchDraft(current => ({ ...current, evidence })) }} />
          <TextArea label={t('researchInsight')} value={researchDraft.insight} onChange={(insight) => { setResearchDraft(current => ({ ...current, insight })) }} />
          <TextField label={t('researchTags')} value={researchDraft.tags} onChange={(tags) => { setResearchDraft(current => ({ ...current, tags })) }} />
        </div>
      </Modal>
    </section>
  )
}

function KnowledgeColumn({ title, empty, hasRecords, children }: {
  readonly title: string
  readonly empty: string
  readonly hasRecords: boolean
  readonly children: ReactNode
}): ReactNode {
  return <section className={css.knowledgeColumn}><h4>{title}</h4>{hasRecords ? children : <p>{empty}</p>}</section>
}

function KnowledgeField({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return <div className={css.assetField}><strong>{label}</strong><p>{value}</p></div>
}

function TextField({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label className={css.formField}>
      <span>{label}</span>
      <input value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
    </label>
  )
}

function TextArea({ label, value, onChange }: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label className={css.formField}>
      <span>{label}</span>
      <textarea rows={4} value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
    </label>
  )
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
