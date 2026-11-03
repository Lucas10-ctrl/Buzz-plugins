/** Review native-to-page structure and responsive rendering before creating a linked page. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSDesignDocument, CopyOSPageDocument, CopyOSDesignPagePreview } from '../../../copyos-domain/src/types.ts'
import { CanvasPagePreview } from './CanvasPagePreview.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerPageConversionReview.module.css'

type Preview = Extract<CopyOSDesignPagePreview, { state: 'ready' }>

/** Semantic outline of compiled page HTML, parsed inertly for review only. */
export interface DesignerPageStructure {
  headings: number[]
  landmarks: string[]
  links: number
  lists: number
  disclosures: number
  buttons: number
  /** Modal dialogs plus popovers. */
  overlays: number
  forms: number
  /** Text fields and text areas. */
  fields: number
}
/**
 * Summarize headings, landmarks, links, lists, disclosures, buttons, overlays, forms and fields in document order.
 * @param html - Compiled page HTML; it is parsed into an inert document and never executed.
 * @returns Heading levels in order plus landmark tags and element counts.
 */
export function designerPageStructure(html: string): DesignerPageStructure {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return {
    headings: [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(element => Number(element.tagName.slice(1))),
    landmarks: [...body.querySelectorAll('main,header,nav,footer,aside,article,section[aria-label]')].map(element => element.tagName.toLowerCase()),
    links: body.querySelectorAll('a[href]').length,
    lists: body.querySelectorAll('ul,ol').length,
    disclosures: body.querySelectorAll('details').length,
    buttons: body.querySelectorAll('button').length,
    overlays: body.querySelectorAll('dialog,[popover]').length,
    forms: body.querySelectorAll('form').length,
    fields: body.querySelectorAll('input,textarea').length,
  }
}

/**
 * Show the actual proposed page at authored and mobile widths, retaining the original design and an explicit commit action.
 * @param props - Authoritative compiled preview, source scene, localized copy and guarded build/cancel callbacks.
 * @returns A focused modal; local title/viewport edits never mutate the native design or saved page.
 */
export function DesignerPageConversionReview({ preview, source, title, onTitle, busy, error, onBuild, onClose, projectPath, t }: {
  preview: Preview
  source: CopyOSDesignDocument
  title: string
  onTitle: (title: string) => void
  busy: boolean
  error: string
  onBuild: () => void
  onClose: () => void
  projectPath?: string | undefined
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const [mobile, setMobile] = useState(false)
  const [availableWidth, setAvailableWidth] = useState(700)
  const [resources, setResources] = useState<'loading' | 'ready' | 'error'>('loading')
  const element = useRef<HTMLDivElement>(null), name = useRef<HTMLInputElement>(null), viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    name.current?.focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const dialog = element.current?.closest('[role="dialog"]')
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')
      if (!focusable?.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', trap, true)
    return () => {
      document.removeEventListener('keydown', trap, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (!viewport.current) return
    const box = viewport.current
    const measure = (): void => { if (box.clientWidth > 0) setAvailableWidth(box.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(box)
    return () => { observer.disconnect() }
  }, [])
  const page = useMemo<CopyOSPageDocument>(() => ({ schema: 'copyos.page', version: 1, id: preview.nodeId,
    title: preview.title, slug: 'conversion-preview', revision: preview.sourceRevision, status: 'draft',
    createdAt: source.createdAt, updatedAt: source.updatedAt, sections: [{ id: preview.nodeId, title: preview.title,
      templateId: 'custom-html', selectedVariantId: preview.nodeId, variants: [{ id: preview.nodeId, label: preview.title,
        createdAt: source.createdAt, html: preview.html }] }] }), [preview, source.createdAt, source.updatedAt])
  const width = mobile ? 390 : preview.width, scale = Math.min(1, availableWidth / width)
  const height = Math.max(700, preview.height * (mobile ? Math.max(1, preview.width / width) : 1))
  const structure = useMemo(() => designerPageStructure(preview.html), [preview.html])
  const skipped = structure.headings.findIndex((level, index) => index > 0 && level > (structure.headings[index - 1] ?? 0) + 1)
  const structureNotes = [
    ...structure.headings.filter(level => level === 1).length === 0 ? [t('canvasStructureNoH1')] : [],
    ...structure.headings.filter(level => level === 1).length > 1 ? [t('canvasStructureManyH1')] : [],
    ...skipped > 0 ? [t('canvasStructureSkipped').replace('{from}', String(structure.headings[skipped - 1])).replace('{to}', String(structure.headings[skipped]))] : [],
  ]
  const editable = preview.mapping.filter(item => item.kind === 'semantic').length
  const summary = t('canvasConversionCounts').replace('{editable}', String(editable))
    .replace('{artwork}', String(preview.mapping.length - editable))
  return <Modal open title={t('canvasConversionTitle')} closeLabel={t('designerDone')} className={css.dialog ?? ''}
    contentClassName={css.content ?? ''} onClose={() => { if (!busy) onClose() }}
    description={t('canvasConversionDescription')}
    footer={<div className={css.footer}>
      <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || !title.trim() || title.trim().length > 160 || resources !== 'ready'}
        onClick={onBuild}>{busy ? t('canvasConversionBuilding') : t('canvasBuildPage')}</Button>
    </div>}>
    <div ref={element} className={css.body}>
      <label className={css.name}>{t('canvasConversionPageTitle')}
        <input ref={name} value={title} maxLength={160} disabled={busy} onChange={(event) => { onTitle(event.currentTarget.value) }} />
      </label>
      <div className={css.summary}><span>{summary}</span><span>{t('canvasConversionRevision').replace('{revision}', String(preview.sourceRevision))}</span></div>
      <div className={css.viewportControls} role="group" aria-label={t('builderViewport')}>
        <button type="button" aria-pressed={!mobile} onClick={() => { setMobile(false) }}>{t('canvasConversionDesktop')}</button>
        <button type="button" aria-pressed={mobile} onClick={() => { setMobile(true) }}>{t('canvasConversionMobile')}</button>
        <span>{t('pixelWidthLabel').replace('{width}', String(width))}</span>
      </div>
      <div ref={viewport} className={css.viewport}>
        <div style={{ width: width * scale, height: height * scale }}>
          <div style={{ width, height: height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <CanvasPagePreview page={page} width={width} height={height} title={t('canvasConversionPreview')}
              onResourceState={setResources} {...(projectPath === undefined ? {} : { projectPath })} />
          </div>
        </div>
      </div>
      {resources === 'loading' ? <p role="status">{t('canvasPageResourcesLoading')}</p> : null}
      {resources === 'error' ? <p role="alert">{t('canvasPageResourcesFailed')}</p> : null}
      <p className={css.hint}>{t('canvasConversionBehaviorHint')}</p>
      <div className={css.warnings} role="group" aria-label={t('canvasStructureTitle')}>
        <strong>{t('canvasStructureTitle')}</strong>
        <ul>
          <li>{t('canvasStructureHeadings').replace('{list}', structure.headings.length
            ? [1, 2, 3, 4, 5, 6].filter(level => structure.headings.includes(level))
              .map(level => `H${level} × ${structure.headings.filter(item => item === level).length}`).join(', ') : t('designerNone'))}</li>
          <li>{t('canvasStructureLandmarks').replace('{list}', structure.landmarks.length ? structure.landmarks.join(', ') : t('designerNone'))}</li>
          <li>{t('canvasStructureCounts').replace('{links}', String(structure.links)).replace('{lists}', String(structure.lists))
            .replace('{disclosures}', String(structure.disclosures)).replace('{buttons}', String(structure.buttons))
            .replace('{overlays}', String(structure.overlays)).replace('{forms}', String(structure.forms))
            .replace('{fields}', String(structure.fields))}</li>
        </ul>
        {structureNotes.map(note => <p key={note} className={css.hint}>{note}</p>)}
      </div>
      {preview.warnings.length ? <div className={css.warnings}>
        <strong>{t('canvasConversionReviewNotes')}</strong>
        <ul>{preview.warnings.map((warning, index) => <li key={`${warning.nodeId}:${warning.code}:${index}`}>
          <span>{source.nodes.find(node => node.id === warning.nodeId)?.name ?? warning.nodeId}: </span>{warning.message}
        </li>)}</ul>
      </div> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Modal>
}
