/** Durable section-based landing-page builder for one CopyOS project. */

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSReusableSectionDocument,
  CopyOSReusableSectionSaveRequest,
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
  CopyOSPageSectionTemplateId,
  CopyOSPageSectionVariantCreateRequest,
  CopyOSPageSectionVariantSelectRequest,
  CopyOSPageSectionVariantUpdateRequest,
  CopyOSPageVariantsUpdateRequest,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { LandingPageVisualWorkspace } from './LandingPageVisualWorkspace.tsx'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Host-backed page operations scoped to one Workspace. */
export interface PageWorkspaceActions {
  readonly clonePage?: (request: { workspaceId: string; pageId: string; expectedRevision: number }) => Promise<CopyOSPageDocument>
  readonly deletePage?: (request: { workspaceId: string; pageId: string; expectedRevision: number }) => Promise<CopyOSPageDocument>
  readonly restorePage?: (request: { workspaceId: string; pageId: string; expectedRevision: number }) => Promise<CopyOSPageDocument>
  readonly readPageAsset?: (workspaceId: string, path: string, knownVersion?: string) => Promise<import('../PagePreviewAssets.ts').PageAssetFile>
  readonly listReusableSections: (workspaceId: string) => Promise<readonly CopyOSReusableSectionDocument[]>
  readonly saveReusableSection: (request: CopyOSReusableSectionSaveRequest) => Promise<CopyOSReusableSectionDocument>
  /** Optional for older embedded clients; the main application provides both actions. */
  readonly moveReusableSection?: ((request: import('../../../copyos-domain/src/types.ts').CopyOSReusableSectionMoveRequest) => Promise<CopyOSReusableSectionDocument>) | undefined
  readonly deleteReusableSection?: ((request: import('../../../copyos-domain/src/types.ts').CopyOSReusableSectionDeleteRequest) => Promise<void>) | undefined
  readonly listPages: (workspaceId: string) => Promise<readonly CopyOSPageDocument[]>
  readonly createPage: (request: CopyOSPageCreateRequest) => Promise<CopyOSPageDocument>
  readonly addPageSection: (request: CopyOSPageSectionCreateRequest) => Promise<CopyOSPageDocument>
  readonly addPageSectionVariant: (request: CopyOSPageSectionVariantCreateRequest) => Promise<CopyOSPageDocument>
  readonly selectPageSectionVariant: (request: CopyOSPageSectionVariantSelectRequest) => Promise<CopyOSPageDocument>
  readonly updatePageSectionVariants: (request: CopyOSPageVariantsUpdateRequest) => Promise<CopyOSPageDocument>
  readonly updatePageSectionVariant: (request: CopyOSPageSectionVariantUpdateRequest) => Promise<CopyOSPageDocument>
  readonly addPageComment: (request: CopyOSPageCommentCreateRequest) => Promise<CopyOSPageDocument>
  readonly setPageCommentStatus: (request: CopyOSPageCommentStatusRequest) => Promise<CopyOSPageDocument>
  readonly renamePageSection: (request: CopyOSPageSectionRenameRequest) => Promise<CopyOSPageDocument>
  readonly deletePageSection: (request: CopyOSPageSectionDeleteRequest) => Promise<CopyOSPageDocument>
  readonly movePageSection: (request: CopyOSPageSectionMoveRequest) => Promise<CopyOSPageDocument>
  readonly exportPage: (request: CopyOSPageExportRequest) => Promise<CopyOSPageExportValue>
}

interface Props {
  readonly workspaceId: string
  readonly projectPath?: string
  /** Open the full Builder on this exact page without allowing page selection or creation. */
  readonly pageId?: string
  /** Restore the host's saved selection without locking the page picker. */
  readonly initialPageId?: string
  /** A one-shot host navigation request; the original draft/save guard remains authoritative. */
  readonly openPageRequest?: { readonly requestId: string; readonly pageId: string }
  /** Report whether the original loading, save and draft guards permit navigation. */
  readonly onNavigationReady?: (ready: boolean) => void
  /** Return to the embedding Canvas after all edits have settled. */
  readonly onReturn?: (selectedPageId: string | null) => void
  readonly t: Translate
  readonly actions: PageWorkspaceActions
  readonly layout?: 'project' | 'session'
  readonly onPromptSection?: (intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string) => void | Promise<void>
  /** Prepare the host composer without submitting a message. */
  readonly onStagePromptSection?: (intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string) => void | Promise<void>
}

/** Chat-composer intent raised from one page section. */
export type SectionPromptIntent = 'rewrite' | 'variations' | 'refine' | 'add-section' | 'customize' | 'export-shopify'

/**
 * Compose a page action with the exact page/section identity supplied by the builder.
 * @param t - CopyOS locale translator.
 * @param intent - Requested page action.
 * @param pageTitle - Display title of the source page.
 * @param sectionTitle - Section title, or the exact page ID for Shopify export.
 * @param note - Optional editing direction.
 * @returns User message ready for the chat composer.
 */
export function buildPageActionPrompt(
  t: Translate, intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string,
): string {
  const key = intent === 'export-shopify' ? 'shopifyExportPrompt'
    : intent === 'rewrite' ? 'rewriteSectionPrompt'
      : intent === 'variations' ? 'variationsSectionPrompt'
        : intent === 'refine' ? 'refineSectionPrompt'
          : intent === 'customize' ? 'customizeSectionPrompt' : 'addSectionPrompt'
  const prompt = t(key).replace('{page}', pageTitle).replace('{section}', sectionTitle)
  return note === undefined || note.trim() === '' ? prompt : `${prompt}\n\n${t('markedDirection').replace('{note}', note.trim())}`
}

interface SectionTemplate {
  readonly id: CopyOSPageSectionTemplateId
  readonly titleKey: CopyOSFoundationLocaleKey
  readonly descriptionKey: CopyOSFoundationLocaleKey
  readonly html: string
}

const SECTION_TEMPLATES: readonly SectionTemplate[] = [
  {
    id: 'hero-centered',
    titleKey: 'sectionCenteredHero',
    descriptionKey: 'sectionCenteredHeroDescription',
    html: '<section style="padding:80px 24px;text-align:center;background:#f7f7f5"><h1 style="font:700 52px/1.05 system-ui;margin:0 auto 20px;max-width:900px">A clear promise your customer wants</h1><p style="font:20px/1.55 system-ui;max-width:680px;margin:0 auto 28px;color:#555">Explain the outcome, who it is for, and why it matters.</p><a href="#cta" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#111;color:#fff;font:600 16px system-ui;text-decoration:none">Get started</a></section>',
  },
  {
    id: 'proof-bar',
    titleKey: 'sectionProofBar',
    descriptionKey: 'sectionProofBarDescription',
    html: '<section style="padding:24px;background:#111;color:#fff;text-align:center;font:600 15px/1.5 system-ui">Trusted by 2,000+ teams · Rated 4.9/5 · 30-day guarantee</section>',
  },
  {
    id: 'benefit-grid',
    titleKey: 'sectionBenefitGrid',
    descriptionKey: 'sectionBenefitGridDescription',
    html: '<section style="padding:72px 24px;font-family:system-ui"><h2 style="text-align:center;font-size:36px">Everything you need to move faster</h2><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;max-width:1000px;margin:32px auto 0"><article><h3>Benefit one</h3><p>Connect the feature to a customer outcome.</p></article><article><h3>Benefit two</h3><p>Make the value specific and believable.</p></article><article><h3>Benefit three</h3><p>Remove a major objection or source of friction.</p></article></div></section>',
  },
  {
    id: 'testimonial',
    titleKey: 'sectionTestimonial',
    descriptionKey: 'sectionTestimonialDescription',
    html: '<section style="padding:72px 24px;background:#f3f1ff;text-align:center;font-family:system-ui"><blockquote style="max-width:780px;margin:auto;font-size:30px;line-height:1.35">“Add a specific customer quote that proves the promised outcome.”</blockquote><p style="margin-top:22px">Customer name · Role, company</p></section>',
  },
  {
    id: 'cta-banner',
    titleKey: 'sectionCtaBanner',
    descriptionKey: 'sectionCtaBannerDescription',
    html: '<section id="cta" style="padding:64px 24px;background:#241f31;color:#fff;text-align:center;font-family:system-ui"><h2 style="font-size:38px;margin:0 0 12px">Ready to get the outcome?</h2><p style="margin:0 0 24px;color:#d8d1e5">Restate the value and remove the final objection.</p><a href="#" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#fff;color:#241f31;font-weight:700;text-decoration:none">Start now</a></section>',
  },
  {
    id: 'custom-html',
    titleKey: 'sectionCustomHtml',
    descriptionKey: 'sectionCustomHtmlDescription',
    html: '<section style="padding:48px 24px;font-family:system-ui"><h2>Custom section</h2><p>Edit this HTML to use your own markup and inline styles.</p></section>',
  },
]

const EMPTY_PAGE = { title: '', slug: '' }
const EMPTY_VARIANT = { label: '', html: '' }

/** Choose the compact project editor or the prototype-grade native Session canvas. */
export function LandingPageWorkspace(props: Props): ReactNode {
  if (props.layout === 'session' || props.pageId !== undefined) {
    return <LandingPageVisualWorkspace key={props.workspaceId} workspaceId={props.workspaceId} t={props.t} actions={props.actions}
      {...(props.projectPath === undefined ? {} : { projectPath: props.projectPath })}
      {...(props.pageId === undefined ? {} : { pageId: props.pageId })}
      {...(props.initialPageId === undefined ? {} : { initialPageId: props.initialPageId })}
      {...(props.openPageRequest === undefined ? {} : { openPageRequest: props.openPageRequest })}
      {...(props.onNavigationReady === undefined ? {} : { onNavigationReady: props.onNavigationReady })}
      {...(props.onReturn === undefined ? {} : { onReturn: props.onReturn })}
      {...(props.onStagePromptSection === undefined ? {} : { onStagePromptSection: props.onStagePromptSection })}
      {...(props.onPromptSection === undefined ? {} : { onPromptSection: props.onPromptSection })} />
  }
  return <LandingPageProjectWorkspace key={props.workspaceId} {...props} />
}

/** Render the compact page editor used from the CopyOS project hub. */
function LandingPageProjectWorkspace({
  workspaceId, t, actions, layout = 'project', onPromptSection,
}: Props): ReactNode {
  const [pages, setPages] = useState<readonly CopyOSPageDocument[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [pageDraft, setPageDraft] = useState(EMPTY_PAGE)
  const [sectionTemplate, setSectionTemplate] = useState<SectionTemplate | null>(null)
  const [sectionHtml, setSectionHtml] = useState('')
  const [variantTarget, setVariantTarget] = useState<string | null>(null)
  const [variantDraft, setVariantDraft] = useState(EMPTY_VARIANT)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      const next = await actions.listPages(workspaceId)
      setPages(next)
      setSelectedPageId(current => current !== null && next.some(page => page.id === current) ? current : next[0]?.id ?? null)
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(errorMessage(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void load() }, [load])

  const selectedPage = useMemo(() => pages.find(page => page.id === selectedPageId), [pages, selectedPageId])
  const variantSection = selectedPage?.sections.find(section => section.id === variantTarget)

  const replacePage = (page: CopyOSPageDocument): void => {
    setPages(current => current.map(item => item.id === page.id ? page : item))
  }

  const createPage = async (): Promise<void> => {
    setSaving(true); setError('')
    try {
      const page = await actions.createPage({ workspaceId, title: pageDraft.title, ...(pageDraft.slug.trim() === '' ? {} : { slug: pageDraft.slug }) })
      setPages(current => [page, ...current])
      setSelectedPageId(page.id)
      setPageDraft(EMPTY_PAGE)
      setCreateOpen(false)
      setPhase('ready')
    } catch (saveError: unknown) { setError(errorMessage(saveError)) } finally { setSaving(false) }
  }

  const addSection = async (): Promise<void> => {
    if (selectedPage === undefined || sectionTemplate === null) return
    setSaving(true); setError('')
    try {
      replacePage(await actions.addPageSection({
        workspaceId,
        pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        title: t(sectionTemplate.titleKey),
        templateId: sectionTemplate.id,
        label: t('originalVariation'),
        html: sectionHtml,
      }))
      setSectionTemplate(null)
      setSectionHtml('')
    } catch (saveError: unknown) { setError(errorMessage(saveError)) } finally { setSaving(false) }
  }

  const addVariant = async (): Promise<void> => {
    if (selectedPage === undefined || variantTarget === null) return
    setSaving(true); setError('')
    try {
      replacePage(await actions.addPageSectionVariant({ workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0,
        sectionId: variantTarget, ...variantDraft }))
      setVariantTarget(null)
      setVariantDraft(EMPTY_VARIANT)
    } catch (saveError: unknown) { setError(errorMessage(saveError)) } finally { setSaving(false) }
  }

  const selectVariant = async (sectionId: string, variantId: string): Promise<void> => {
    if (selectedPage === undefined) return
    setError('')
    try {
      replacePage(await actions.selectPageSectionVariant({
        workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0, sectionId, variantId,
      }))
    } catch (saveError: unknown) { setError(errorMessage(saveError)) }
  }

  const moveSection = async (sectionId: string, toIndex: number): Promise<void> => {
    if (selectedPage === undefined) return
    setError('')
    try {
      replacePage(await actions.movePageSection({
        workspaceId, pageId: selectedPage.id, expectedRevision: selectedPage.revision ?? 0, sectionId, toIndex,
      }))
    } catch (saveError: unknown) { setError(errorMessage(saveError)) }
  }

  const dropSection = (event: DragEvent<HTMLElement>, toIndex: number): void => {
    event.preventDefault()
    if (draggedSectionId !== null) void moveSection(draggedSectionId, toIndex)
    setDraggedSectionId(null)
  }

  const exportPage = async (): Promise<void> => {
    if (selectedPage === undefined) return
    setError(''); setExportPath('')
    try { setExportPath((await actions.exportPage({ workspaceId, pageId: selectedPage.id })).path) }
    catch (exportError: unknown) { setError(errorMessage(exportError)) }
  }

  return (
    <section className={`${css.assetWorkspace} ${layout === 'session' ? css.landingPageWorkspace : ''}`}>
      <div className={css.assetWorkspaceHeader}>
        <div><h3>{t('pageWorkspaceTitle')}</h3><p>{t('pageWorkspaceDescription')}</p></div>
        <Button variant="primary" onClick={() => { setCreateOpen(true) }}>{t('newPage')}</Button>
      </div>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('assetOperationFailed')} {error}</p>}
      {phase === 'loading' ? <p className={css.assetState} role="status">{t('pagesLoading')}</p> : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button> : null}
      {phase === 'ready' && pages.length === 0 ? <p className={css.assetState}>{t('pagesEmpty')}</p> : null}
      {pages.length === 0 ? null : (
        <div className={css.pageBuilder}>
          <aside className={css.pageLibrary}>
            <label className={css.formField}><span>{t('page')}</span>
              <select value={selectedPageId ?? ''} onChange={(event) => { setSelectedPageId(event.currentTarget.value); setExportPath('') }}>
                {pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}
              </select>
            </label>
            <h4>{t('sectionLibrary')}</h4>
            <p>{t('sectionLibraryDescription')}</p>
            <div className={css.templateList}>
              {SECTION_TEMPLATES.map(template => (
                <button key={template.id} type="button" onClick={() => { setSectionTemplate(template); setSectionHtml(template.html) }}>
                  <strong>{t(template.titleKey)}</strong><span>{t(template.descriptionKey)}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className={css.pageCanvas}>
            <div className={css.pageCanvasHeader}>
              <div><h4>{selectedPage?.title}</h4><span>/{selectedPage?.slug}</span></div>
              <Button variant="outline" onClick={() => { void exportPage() }}>{t('exportHtml')}</Button>
            </div>
            {exportPath === '' ? null : <p className={css.exportSuccess} role="status">{t('exportedTo')} {exportPath}</p>}
            {selectedPage?.sections.length === 0 ? <div className={css.canvasEmpty}>{t('canvasEmpty')}</div> : null}
            <div className={css.sectionStack}>
              {selectedPage?.sections.map((section, index) => {
                const selected = section.variants.find(variant => variant.id === section.selectedVariantId)
                return (
                  <article key={section.id} className={css.pageSection} draggable
                    onDragStart={() => { setDraggedSectionId(section.id) }}
                    onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => { dropSection(event, index) }}>
                    <div className={css.pageSectionHeader}>
                      <div>
                        <span className={css.dragHandle}>⋮⋮</span>
                        <strong>{section.title}</strong>
                        <small>{section.templateId}</small>
                      </div>
                      <div className={css.sectionActions}>
                        {onPromptSection === undefined ? null : (
                          <>
                            <Button variant="outline" onClick={() => {
                              onPromptSection('rewrite', selectedPage.title, section.title)
                            }}>{t('rewriteInChat')}</Button>
                            <Button variant="outline" onClick={() => {
                              onPromptSection('variations', selectedPage.title, section.title)
                            }}>{t('variationsInChat')}</Button>
                          </>
                        )}
                        <Button variant="outline" disabled={index === 0} onClick={() => { void moveSection(section.id, index - 1) }}>{t('moveUp')}</Button>
                        <Button variant="outline" disabled={index === selectedPage.sections.length - 1}
                          onClick={() => { void moveSection(section.id, index + 1) }}>{t('moveDown')}</Button>
                        <Button variant="outline" onClick={() => { setVariantTarget(section.id); setVariantDraft({ label: '', html: selected?.html ?? '' }) }}>{t('addVariation')}</Button>
                      </div>
                    </div>
                    <iframe className={css.sectionPreview} title={t('sectionPreviewTitle').replace('{section}', section.title)} sandbox="" srcDoc={selected?.html ?? ''} />
                    <div className={css.variationTabs}>
                      {section.variants.map(variant => (
                        <button key={variant.id} type="button" data-selected={variant.id === section.selectedVariantId}
                          onClick={() => { void selectVariant(section.id, variant.id) }}>{variant.label}</button>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <Modal open={createOpen} onClose={() => { if (!saving) setCreateOpen(false) }} closeLabel={t('cancel')}
        title={t('newPage')} description={t('newPageDescription')} className={css.assetDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('savePage')} onCancel={() => { setCreateOpen(false) }} onSave={() => { void createPage() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('pageTitle')} value={pageDraft.title} onChange={(title) => { setPageDraft(current => ({ ...current, title })) }} />
          <TextField label={t('pageSlug')} value={pageDraft.slug} onChange={(slug) => { setPageDraft(current => ({ ...current, slug })) }} />
        </div>
      </Modal>
      <Modal open={sectionTemplate !== null} onClose={() => { if (!saving) setSectionTemplate(null) }} closeLabel={t('cancel')}
        title={sectionTemplate === null ? t('addSection') : t(sectionTemplate.titleKey)} description={t('sectionHtmlDescription')} className={css.codeDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('addSection')} onCancel={() => { setSectionTemplate(null) }} onSave={() => { void addSection() }} />}>
        <label className={css.formField}><span>{t('sectionHtml')}</span><textarea className={css.codeEditor} rows={16} value={sectionHtml} onChange={(event) => { setSectionHtml(event.currentTarget.value) }} /></label>
      </Modal>
      <Modal open={variantSection !== undefined} onClose={() => { if (!saving) setVariantTarget(null) }} closeLabel={t('cancel')}
        title={t('addVariation')} description={variantSection?.title ?? ''} className={css.codeDialog as string}
        footer={<ModalActions t={t} saving={saving} saveLabel={t('saveVariation')} onCancel={() => { setVariantTarget(null) }} onSave={() => { void addVariant() }} />}>
        <div className={css.assetForm}>
          <TextField label={t('variationLabel')} value={variantDraft.label} onChange={(label) => { setVariantDraft(current => ({ ...current, label })) }} />
          <label className={css.formField}><span>{t('sectionHtml')}</span><textarea className={css.codeEditor} rows={16} value={variantDraft.html} onChange={(event) => { setVariantDraft(current => ({ ...current, html: event.currentTarget.value })) }} /></label>
        </div>
      </Modal>
    </section>
  )
}

function TextField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}): ReactNode {
  return (
    <label className={css.formField}>
      <span>{label}</span>
      <input value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
    </label>
  )
}

function ModalActions({ t, saving, saveLabel, onCancel, onSave }: {
  t: Translate
  saving: boolean
  saveLabel: string
  onCancel: () => void
  onSave: () => void
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
