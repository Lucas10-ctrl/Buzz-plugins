/** Durable brief and copy-variation workspaces for one CopyOS project. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSBriefCreateRequest,
  CopyOSBriefDocument,
  CopyOSCopyCreateRequest,
  CopyOSCopyDocument,
  CopyOSCopyVariantCreateRequest,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed asset operations scoped by the panel to one Workspace. */
export interface AssetWorkspaceActions {
  readonly listBriefs: (workspaceId: string) => Promise<readonly CopyOSBriefDocument[]>
  readonly createBrief: (request: CopyOSBriefCreateRequest) => Promise<CopyOSBriefDocument>
  readonly listCopy: (workspaceId: string) => Promise<readonly CopyOSCopyDocument[]>
  readonly createCopy: (request: CopyOSCopyCreateRequest) => Promise<CopyOSCopyDocument>
  readonly addCopyVariant: (request: CopyOSCopyVariantCreateRequest) => Promise<CopyOSCopyDocument>
}

interface WorkspaceProps {
  readonly workspaceId: string
  readonly t: Translate
  readonly actions: AssetWorkspaceActions
}

const EMPTY_BRIEF = { title: '', objective: '', audience: '', offer: '', proof: '', cta: '' }
const EMPTY_COPY = { title: '', body: '' }
const EMPTY_VARIANT = { label: '', body: '' }

/** Render durable creative briefs for one project. */
export function BriefWorkspace({ workspaceId, t, actions }: WorkspaceProps): ReactNode {
  const [briefs, setBriefs] = useState<readonly CopyOSBriefDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(EMPTY_BRIEF)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      setBriefs(await actions.listBriefs(workspaceId))
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const brief = await actions.createBrief({ workspaceId, ...draft })
      setBriefs(current => [brief, ...current])
      setDraft(EMPTY_BRIEF)
      setFormOpen(false)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AssetFrame title={t('briefWorkspaceTitle')} description={t('briefWorkspaceDescription')}
      action={<Button variant="primary" onClick={() => { setFormOpen(true) }}>{t('newBrief')}</Button>}>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('assetOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('assetsLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' && briefs.length === 0 ? <p className={css.assetState}>{t('briefsEmpty')}</p> : null}
      {briefs.length === 0 ? null : (
        <div className={css.assetList}>
          {briefs.map(brief => (
            <article key={brief.id} className={css.assetCard}>
              <div className={css.assetCardHeader}>
                <h4>{brief.title}</h4>
                <span>{t('draftStatus')}</span>
              </div>
              <AssetField label={t('briefObjective')} value={brief.objective} />
              <AssetField label={t('briefAudience')} value={brief.audience} />
              <AssetField label={t('briefOffer')} value={brief.offer} />
              {brief.proof === '' ? null : <AssetField label={t('briefProof')} value={brief.proof} />}
              <AssetField label={t('briefCta')} value={brief.cta} />
            </article>
          ))}
        </div>
      )}
      <Modal open={formOpen} onClose={() => { if (!saving) setFormOpen(false) }} closeLabel={t('cancel')}
        title={t('newBrief')} description={t('newBriefDescription')} className={css.assetDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('saveBrief')}
          onCancel={() => { setFormOpen(false) }} onSave={() => { void save() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('assetTitle')} value={draft.title}
            onChange={(title) => { setDraft(current => ({ ...current, title })) }} />
          <TextArea label={t('briefObjective')} value={draft.objective}
            onChange={(objective) => { setDraft(current => ({ ...current, objective })) }} />
          <TextArea label={t('briefAudience')} value={draft.audience}
            onChange={(audience) => { setDraft(current => ({ ...current, audience })) }} />
          <TextArea label={t('briefOffer')} value={draft.offer}
            onChange={(offer) => { setDraft(current => ({ ...current, offer })) }} />
          <TextArea label={t('briefProof')} value={draft.proof}
            onChange={(proof) => { setDraft(current => ({ ...current, proof })) }} />
          <TextField label={t('briefCta')} value={draft.cta}
            onChange={(cta) => { setDraft(current => ({ ...current, cta })) }} />
        </div>
      </Modal>
    </AssetFrame>
  )
}

/** Render portable copy assets and their selected alternatives for one project. */
export function CopyWorkspace({ workspaceId, t, actions }: WorkspaceProps): ReactNode {
  const [assets, setAssets] = useState<readonly CopyOSCopyDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [variantAssetId, setVariantAssetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copyDraft, setCopyDraft] = useState(EMPTY_COPY)
  const [variantDraft, setVariantDraft] = useState(EMPTY_VARIANT)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      setAssets(await actions.listCopy(workspaceId))
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const selectedAsset = useMemo(
    () => assets.find(asset => asset.id === variantAssetId),
    [assets, variantAssetId],
  )

  const create = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const asset = await actions.createCopy({ workspaceId, label: t('originalVariation'), ...copyDraft })
      setAssets(current => [asset, ...current])
      setCopyDraft(EMPTY_COPY)
      setCreateOpen(false)
      setPhase('ready')
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const addVariant = async (): Promise<void> => {
    if (variantAssetId === null) return
    setSaving(true)
    setError('')
    try {
      const updated = await actions.addCopyVariant({ workspaceId, assetId: variantAssetId, ...variantDraft })
      setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset))
      setVariantDraft(EMPTY_VARIANT)
      setVariantAssetId(null)
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AssetFrame title={t('copyWorkspaceTitle')} description={t('copyWorkspaceDescription')}
      action={<Button variant="primary" onClick={() => { setCreateOpen(true) }}>{t('newCopyAsset')}</Button>}>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('assetOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('assetsLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' && assets.length === 0 ? <p className={css.assetState}>{t('copyEmpty')}</p> : null}
      {assets.length === 0 ? null : (
        <div className={css.assetList}>
          {assets.map((asset) => {
            const selected = asset.variants.find(variant => variant.id === asset.selectedVariantId)
            return (
              <article key={asset.id} className={css.assetCard}>
                <div className={css.assetCardHeader}>
                  <div>
                    <h4>{asset.title}</h4>
                    <span>{t('variationCount').replace('{count}', String(asset.variants.length))}</span>
                  </div>
                  <Button variant="outline" onClick={() => { setVariantAssetId(asset.id) }}>{t('addVariation')}</Button>
                </div>
                <p className={css.selectedVariationLabel}>{selected?.label ?? t('selectedVariation')}</p>
                <p className={css.copyBody}>{selected?.body}</p>
                <div className={css.variationList}>
                  {asset.variants.map(variant => (
                    <span key={variant.id} data-selected={variant.id === asset.selectedVariantId}>{variant.label}</span>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Modal open={createOpen} onClose={() => { if (!saving) setCreateOpen(false) }} closeLabel={t('cancel')}
        title={t('newCopyAsset')} description={t('newCopyDescription')} className={css.assetDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('saveCopyAsset')}
          onCancel={() => { setCreateOpen(false) }} onSave={() => { void create() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('assetTitle')} value={copyDraft.title}
            onChange={(title) => { setCopyDraft(current => ({ ...current, title })) }} />
          <TextArea label={t('initialCopy')} value={copyDraft.body}
            onChange={(body) => { setCopyDraft(current => ({ ...current, body })) }} />
        </div>
      </Modal>
      <Modal open={selectedAsset !== undefined} onClose={() => { if (!saving) setVariantAssetId(null) }} closeLabel={t('cancel')}
        title={t('addVariation')} description={selectedAsset?.title ?? ''} className={css.assetDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('saveVariation')}
          onCancel={() => { setVariantAssetId(null) }} onSave={() => { void addVariant() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('variationLabel')} value={variantDraft.label}
            onChange={(label) => { setVariantDraft(current => ({ ...current, label })) }} />
          <TextArea label={t('variationCopy')} value={variantDraft.body}
            onChange={(body) => { setVariantDraft(current => ({ ...current, body })) }} />
        </div>
      </Modal>
    </AssetFrame>
  )
}

function AssetFrame({ title, description, action, children }: {
  readonly title: string
  readonly description: string
  readonly action: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <section className={css.assetWorkspace}>
      <div className={css.assetWorkspaceHeader}>
        <div><h3>{title}</h3><p>{description}</p></div>
        {action}
      </div>
      {children}
    </section>
  )
}

function AssetField({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
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

function ModalActions({ t, saving, saveLabel, onCancel, onSave }: {
  readonly t: Translate
  readonly saving: boolean
  readonly saveLabel: string
  readonly onCancel: () => void
  readonly onSave: () => void
}): ReactNode {
  return (
    <div className={css.modalActions}>
      <Button variant="outline" disabled={saving} onClick={onCancel}>{t('cancel')}</Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? t('savingAsset') : saveLabel}</Button>
    </div>
  )
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
