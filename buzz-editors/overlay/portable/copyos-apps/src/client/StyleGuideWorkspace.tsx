/** Project-level visual system imported from user-owned CSS. */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSStyleGuideDocument,
  CopyOSStyleGuideSaveRequest,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed project style guide operations. */
export interface StyleGuideWorkspaceActions {
  readonly getStyleGuide: (workspaceId: string) => Promise<CopyOSStyleGuideDocument | undefined>
  readonly saveStyleGuide: (request: CopyOSStyleGuideSaveRequest) => Promise<CopyOSStyleGuideDocument>
}

interface Props {
  readonly workspaceId: string
  readonly t: Translate
  readonly actions: StyleGuideWorkspaceActions
  readonly onStartWebsiteImport: (prompt: string) => Promise<void>
}

type ImportMode = 'faithful' | 'adapt'
type ImportScope = 'page' | 'site'

/** Import, inspect, and replace the visual system shared by one project. */
export function StyleGuideWorkspace({ workspaceId, t, actions, onStartWebsiteImport }: Props): ReactNode {
  const [guide, setGuide] = useState<CopyOSStyleGuideDocument | undefined>()
  const [name, setName] = useState('Workspace style guide')
  const [cssSource, setCssSource] = useState('')
  const [sourceLabel, setSourceLabel] = useState('Pasted CSS')
  const [sourceType, setSourceType] = useState<'css' | 'file'>('css')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [importMode, setImportMode] = useState<ImportMode>('adapt')
  const [importScope, setImportScope] = useState<ImportScope>('page')
  const [captureAssets, setCaptureAssets] = useState(true)
  const [captureInteractions, setCaptureInteractions] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setPhase('loading'); setError('')
    try {
      const current = await actions.getStyleGuide(workspaceId)
      setGuide(current)
      if (current !== undefined) {
        setName(current.name); setCssSource(current.css); setSourceLabel(current.sourceLabel)
        setSourceType(current.sourceType === 'file' ? 'file' : 'css')
      }
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError)); setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    if (!file.name.toLowerCase().endsWith('.css')) {
      setError(t('styleGuideCssOnly')); return
    }
    try {
      setCssSource(await file.text())
      setSourceLabel(file.name)
      setSourceType('file')
      setError('')
    } catch (readError: unknown) {
      setError(errorMessage(readError))
    } finally {
      event.currentTarget.value = ''
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true); setError('')
    try {
      const next = await actions.saveStyleGuide({
        workspaceId, name, sourceType, sourceLabel, css: cssSource,
      })
      setGuide(next)
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const startWebsiteImport = async (): Promise<void> => {
    let url: URL
    try {
      url = new URL(websiteUrl.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      setError(t('websiteImportUrlInvalid')); return
    }
    setImporting(true); setError('')
    try {
      await onStartWebsiteImport(buildWebsiteImportPrompt({
        url: url.toString(), mode: importMode, scope: importScope, captureAssets, captureInteractions,
        hasExistingStyleGuide: guide !== undefined,
      }))
      setImportOpen(false)
    } catch (importError: unknown) {
      setError(errorMessage(importError))
    } finally {
      setImporting(false)
    }
  }

  if (phase === 'loading') return <p className={css.state}>{t('styleGuideLoading')}</p>
  if (phase === 'error') return <div className={css.state} role="alert"><span>{t('styleGuideOperationFailed')} {error}</span><Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button></div>

  const properties = guide === undefined ? [] : Object.entries(guide.tokens.customProperties)
  return <section className={css.styleGuideWorkspace}>
    <header className={css.assetWorkspaceHeader}>
      <div><h3>{t('styleGuideTitle')}</h3><p>{t('styleGuideDescription')}</p></div>
      <span className={css.styleGuideStatus}>{guide === undefined ? t('styleGuideNotConfigured') : t('styleGuideActive')}</span>
    </header>
    {error === '' ? null : <p className={css.error} role="alert">{t('styleGuideOperationFailed')} {error}</p>}
    <div className={css.styleGuideLayout}>
      <div className={css.styleGuideEditor}>
        <label><span>{t('styleGuideName')}</span><input value={name} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
        <div className={css.styleGuideSourceActions}>
          <Button variant="outline" onClick={() => { fileRef.current?.click() }}>{t('styleGuideUploadCss')}</Button>
          <span>{sourceType === 'file' ? sourceLabel : t('styleGuidePasteCss')}</span>
          <input ref={fileRef} type="file" accept=".css,text/css" hidden onChange={(event) => { void chooseFile(event) }} />
        </div>
        <label><span>{t('styleGuideCss')}</span><textarea value={cssSource} spellCheck={false}
          placeholder={t('styleGuideCssExample')}
          onChange={(event) => { setCssSource(event.currentTarget.value); setSourceType('css'); setSourceLabel('Pasted CSS') }} /></label>
        <div className={css.styleGuideFooter}>
          <span>{t('styleGuideSafeImport')}</span>
          <Button variant="primary" disabled={saving || name.trim() === '' || cssSource.trim() === ''}
            onClick={() => { void save() }}>{saving ? t('savingAsset') : t('styleGuideSave')}</Button>
        </div>
      </div>
      <aside className={css.styleGuidePreview}>
        <div className={css.styleGuidePreviewHeader}><div><small>{t('styleGuideCurrent')}</small><strong>{guide?.name ?? t('styleGuideNotConfigured')}</strong></div><span>{guide?.sourceLabel}</span></div>
        <div className={css.styleGuideSample}>
          <small>{t('styleGuideSampleEyebrow')}</small><h4>{t('styleGuideSampleHeading')}</h4>
          <p>{t('styleGuideSampleBody')}</p><button type="button">{t('styleGuideSampleAction')}</button>
        </div>
        <div className={css.styleGuideTokenGroup}><strong>{t('styleGuideColors')}</strong><div className={css.styleGuideSwatches}>
          {(guide?.tokens.colors ?? []).slice(0, 12).map(color => <span key={color} title={color} style={{ background: color }} />)}
          {guide !== undefined && guide.tokens.colors.length === 0 ? <small>{t('styleGuideNoColors')}</small> : null}
        </div></div>
        <div className={css.styleGuideTokenGroup}><strong>{t('styleGuideFonts')}</strong>
          {(guide?.tokens.fonts ?? []).slice(0, 6).map(font => <code key={font}>{font}</code>)}
          {guide !== undefined && guide.tokens.fonts.length === 0 ? <small>{t('styleGuideNoFonts')}</small> : null}
        </div>
        <TokenCollection title={t('styleGuideTypeScale')} values={[
          ...(guide?.tokens.fontSizes ?? []), ...(guide?.tokens.fontWeights ?? []),
          ...(guide?.tokens.lineHeights ?? []), ...(guide?.tokens.letterSpacings ?? []),
        ]} />
        <TokenCollection title={t('styleGuideSpacing')} values={guide?.tokens.spacing ?? []} />
        <TokenCollection title={t('styleGuideShape')} values={[
          ...(guide?.tokens.radii ?? []), ...(guide?.tokens.shadows ?? []),
        ]} />
        <TokenCollection title={t('styleGuideLayoutMotion')} values={[
          ...(guide?.tokens.breakpoints ?? []), ...(guide?.tokens.contentWidths ?? []),
          ...(guide?.tokens.durations ?? []), ...(guide?.tokens.easings ?? []),
        ]} />
        <div className={css.styleGuideTokenGroup}><strong>{t('styleGuideVariables')}</strong>
          {properties.slice(0, 12).map(([property, value]) => <div key={property}><code>{property}</code><span>{value}</span></div>)}
          {guide !== undefined && properties.length === 0 ? <small>{t('styleGuideNoVariables')}</small> : null}
        </div>
      </aside>
    </div>
    <button type="button" className={css.websiteImportCard} onClick={() => { setImportOpen(true); setError('') }}>
      <div><span>↗</span><div><h4>{t('websiteImportTitle')}</h4><p>{t('websiteImportDescription')}</p></div></div>
      <strong>{t('websiteImportNext')}</strong>
    </button>
    <Modal open={importOpen} onClose={() => { if (!importing) setImportOpen(false) }} closeLabel={t('cancel')}
      title={t('websiteImportTitle')} description={t('websiteImportModalDescription')} className={css.websiteImportDialog as string}
      footer={<div className={css.modalActions}><Button variant="outline" disabled={importing}
        onClick={() => { setImportOpen(false) }}>{t('cancel')}</Button><Button variant="primary"
        disabled={importing || websiteUrl.trim() === ''}
        onClick={() => { void startWebsiteImport() }}>{importing ? t('sessionStarting') : t('websiteImportStart')}</Button></div>}>
      <div className={css.websiteImportForm}>
        <label><span>{t('websiteImportUrl')}</span><input type="url" autoFocus value={websiteUrl}
          placeholder={t('landingPageUrlExample')} onChange={(event) => { setWebsiteUrl(event.currentTarget.value); setError('') }} /></label>
        <fieldset><legend>{t('websiteImportMode')}</legend><div className={css.websiteImportChoiceGrid}>
          <button type="button" data-active={importMode === 'faithful'} onClick={() => { setImportMode('faithful') }}>
            <strong>{t('websiteImportFaithful')}</strong><span>{t('websiteImportFaithfulDescription')}</span></button>
          <button type="button" data-active={importMode === 'adapt'} onClick={() => { setImportMode('adapt') }}>
            <strong>{t('websiteImportAdapt')}</strong><span>{t('websiteImportAdaptDescription')}</span></button>
        </div></fieldset>
        <fieldset><legend>{t('websiteImportScope')}</legend><div className={css.websiteImportChoiceGrid}>
          <button type="button" data-active={importScope === 'page'} onClick={() => { setImportScope('page') }}>
            <strong>{t('websiteImportPage')}</strong><span>{t('websiteImportPageDescription')}</span></button>
          <button type="button" data-active={importScope === 'site'} onClick={() => { setImportScope('site') }}>
            <strong>{t('websiteImportSite')}</strong><span>{t('websiteImportSiteDescription')}</span></button>
        </div></fieldset>
        <div className={css.websiteImportChecks}>
          <label><input type="checkbox" checked={captureAssets} onChange={(event) => { setCaptureAssets(event.currentTarget.checked) }} />
            <span><strong>{t('websiteImportAssets')}</strong><small>{t('websiteImportAssetsDescription')}</small></span></label>
          <label><input type="checkbox" checked={captureInteractions} onChange={(event) => { setCaptureInteractions(event.currentTarget.checked) }} />
            <span><strong>{t('websiteImportInteractions')}</strong><small>{t('websiteImportInteractionsDescription')}</small></span></label>
        </div>
        {guide === undefined ? null : <p className={css.websiteImportExisting}>{t('websiteImportExistingGuide')}</p>}
      </div>
    </Modal>
  </section>
}

interface WebsiteImportPromptOptions {
  readonly url: string
  readonly mode: ImportMode
  readonly scope: ImportScope
  readonly captureAssets: boolean
  readonly captureInteractions: boolean
  readonly hasExistingStyleGuide: boolean
}

/** Build the explicit handoff consumed by the project-bound Website Clone agent. */
export function buildWebsiteImportPrompt(options: WebsiteImportPromptOptions): string {
  return [
    `Import this permitted website into the CopyOS Builder: ${options.url}`,
    `Clone mode: ${options.mode === 'faithful' ? 'faithful reconstruction' : 'adapt the visual system while keeping the current project brand and content editable'}.`,
    `Scope: ${options.scope === 'page' ? 'the supplied page only' : 'crawl the permitted public site and identify reusable page patterns'}.`,
    `Local assets: ${options.captureAssets ? 'capture referenced images, fonts, icons, and media with their source URLs' : 'do not download source assets; use documented references only'}.`,
    `Interaction capture: ${options.captureInteractions ? 'inspect meaningful hover, click, menu, form, and scroll states' : 'focus on static and responsive layout states'}.`,
    '',
    'Load the copyos-web-clone skill and follow its evidence-first workflow. Validate desktop, tablet, and mobile references. Build the result as semantic, independently movable CopyOS sections with editable elements; preserve unsupported complex regions as coded sections rather than flattening the page.',
    'Extract a durable project style system from the evidence: color roles and raw palette; font families, sizes, weights, line heights, and letter spacing; spacing scale; radii; shadows; content widths; breakpoints; motion durations and easings; and CSS custom properties. Use read_copyos_style_guide before saving. '
      + (options.hasExistingStyleGuide
        ? 'A project style guide already exists, so show the proposed differences and ask before replacing it.'
        : 'Save the normalized captured CSS and token inventory with save_copyos_style_guide.'),
    'Keep source URLs, licenses, trademarks, third-party assets, and publication risks explicit in the clone report.',
  ].join('\n')
}

function TokenCollection({ title, values }: { readonly title: string; readonly values: readonly string[] }): ReactNode {
  if (values.length === 0) return null
  return <div className={css.styleGuideTokenGroup}><strong>{title}</strong><div className={css.styleGuideChips}>
    {values.slice(0, 16).map((value, index) => <code key={`${value}-${index}`}>{value}</code>)}
  </div></div>
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
