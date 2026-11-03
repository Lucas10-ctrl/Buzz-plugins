/** Review a three-way update from a changed native design into its already edited Page Builder page. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSDesignPageUpdateElement, CopyOSDesignPageUpdateReview, CopyOSPageDocument } from '../../../copyos-domain/src/types.ts'
import { CanvasPagePreview } from './CanvasPagePreview.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerPageConversionReview.module.css'

type Review = Extract<CopyOSDesignPageUpdateReview, { state: 'update' }>
/** Version a conflicting element keeps. */
export type DesignerPageUpdateResolution = 'keep-page' | 'use-design'
/** Choice for every conflicting element, keyed by merge key. */
export type DesignerPageUpdateResolutions = Readonly<Record<string, DesignerPageUpdateResolution>>

/**
 * Show classified design changes, retained Builder edits and conflicts with the merged page, and require a choice for every conflict.
 * @param props - Reviewed update, saved page, localized copy, mixed-choice preview loader and guarded apply/cancel callbacks.
 * @returns A focused modal; choices only change the preview until Apply.
 */
export function DesignerPageUpdateReview({ review, page, busy, error, onApply, onPreview, onClose, projectPath, t }: {
  review: Review
  page: CopyOSPageDocument
  busy: boolean
  error: string
  onApply: (resolutions: DesignerPageUpdateResolutions | undefined) => void
  /** Host merge for a mixed set of choices; uniform choices use the review's own previews. */
  onPreview: (resolutions: DesignerPageUpdateResolutions) => Promise<string>
  onClose: () => void
  projectPath?: string | undefined
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const conflicted = review.conflicts.length > 0
  const [choices, setChoices] = useState<DesignerPageUpdateResolutions>({})
  const [mixedHtml, setMixedHtml] = useState<{ key: string; html: string } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const complete = review.conflicts.every(item => choices[item.key])
  const firstChoice = review.conflicts[0] ? choices[review.conflicts[0].key] : undefined
  const uniform = review.conflicts.every(item => choices[item.key] === firstChoice) ? firstChoice ?? 'keep-page' : null
  const choiceKey = JSON.stringify(review.conflicts.map(item => choices[item.key] ?? 'keep-page'))
  const [availableWidth, setAvailableWidth] = useState(700)
  const [mobile, setMobile] = useState(false)
  const viewport = useRef<HTMLDivElement>(null), first = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    first.current?.querySelector<HTMLElement>('input,button')?.focus()
    // Keep Tab inside the dialog, matching the build review, while Canvas behind it is inert.
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const dialog = first.current?.closest('[role="dialog"]')
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')
      if (!focusable?.length) return
      const head = focusable[0], tail = focusable[focusable.length - 1]
      const outside = !dialog?.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === head || outside)) { event.preventDefault(); tail?.focus() }
      else if (!event.shiftKey && (document.activeElement === tail || outside)) { event.preventDefault(); head?.focus() }
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
  useEffect(() => {
    if (uniform !== null) return
    let current = true
    const timer = setTimeout(() => {
      onPreview(Object.fromEntries(review.conflicts.map(item => [item.key, choices[item.key] ?? 'keep-page'])))
        .then((html) => { if (current) { setMixedHtml({ key: choiceKey, html }); setPreviewError('') } })
        .catch((failure: unknown) => { if (current) setPreviewError(failure instanceof Error ? failure.message : String(failure)) })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [choiceKey, uniform, review, choices, onPreview])
  const shownHtml = uniform !== null ? review.html[uniform] : mixedHtml?.key === choiceKey ? mixedHtml.html : null
  const preview = useMemo<CopyOSPageDocument | null>(() => shownHtml === null ? null : ({ ...page,
    sections: page.sections.map(section => ({ ...section,
      variants: section.variants.map(variant => variant.html.includes(`data-canvas-conversion="${review.nodeId}"`)
        ? { ...variant, html: shownHtml } : variant) })) }), [page, review, shownHtml])
  const choose = (key: string, value: DesignerPageUpdateResolution): void => { setChoices(current => ({ ...current, [key]: value })) }
  const chooseAll = (value: DesignerPageUpdateResolution): void => {
    setChoices(Object.fromEntries(review.conflicts.map(item => [item.key, value])))
  }
  const width = mobile ? 390 : review.width, scale = Math.min(1, availableWidth / width)
  const height = Math.max(600, review.height * (mobile ? Math.max(1, review.width / width) : 1))
  const name = (item: CopyOSDesignPageUpdateElement): string => item.key.startsWith('style:') ? t('canvasUpdateStyles') : item.name
  const list = (title: CopyOSFoundationLocaleKey, items: readonly CopyOSDesignPageUpdateElement[]) => items.length
    ? <div className={css.warnings}>
      <strong>{t(title).replace('{count}', String(items.length))}</strong>
      <ul>{items.map(item => <li key={item.key}>{name(item)}</li>)}</ul>
    </div> : null
  const unplaced = uniform !== null ? review.unplaced[uniform] : []
  return <Modal open title={t('canvasUpdateTitle')} closeLabel={t('designerDone')} className={css.dialog ?? ''}
    contentClassName={css.content ?? ''} onClose={() => { if (!busy) onClose() }} description={t('canvasUpdateDescription')}
    footer={<div className={css.footer}>
      <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || !complete} onClick={() => { onApply(conflicted ? choices : undefined) }}>
        {busy ? t('canvasUpdateApplying') : t('canvasUpdateApply')}</Button>
    </div>}>
    <div ref={first} className={css.body}>
      <div className={css.summary}>
        <span>{t('canvasUpdateSummary').replace('{design}', String(review.designChanges.length))
          .replace('{page}', String(review.pageEdits.length)).replace('{conflicts}', String(review.conflicts.length))}</span>
        <span>{t('canvasUpdateRevisions').replace('{from}', String(review.previousSourceRevision)).replace('{to}', String(review.sourceRevision))}</span>
      </div>
      {conflicted ? <fieldset className={css.warnings}>
        <legend>{t('canvasUpdateConflictTitle').replace('{count}', String(review.conflicts.length))}</legend>
        <p className={css.hint}>{t('canvasUpdateConflictHint')}</p>
        <div className={css.choice}>
          <button type="button" disabled={busy} onClick={() => { chooseAll('keep-page') }}>{t('canvasUpdateKeepPage')}</button>
          <button type="button" disabled={busy} onClick={() => { chooseAll('use-design') }}>{t('canvasUpdateUseDesign')}</button>
        </div>
        <ul>{review.conflicts.map(item => <li key={item.key} role="group" aria-label={name(item)}>
          <span>{name(item)}</span>
          <label className={css.choice}><input type="radio" name={`canvas-update-${item.key}`} checked={choices[item.key] === 'keep-page'}
            disabled={busy} onChange={() => { choose(item.key, 'keep-page') }} /> {t('canvasUpdateChoicePage')}</label>
          <label className={css.choice}><input type="radio" name={`canvas-update-${item.key}`} checked={choices[item.key] === 'use-design'}
            disabled={busy} onChange={() => { choose(item.key, 'use-design') }} /> {t('canvasUpdateChoiceDesign')}</label>
        </li>)}</ul>
      </fieldset> : null}
      <div className={css.viewportControls} role="group" aria-label={t('builderViewport')}>
        <button type="button" aria-pressed={!mobile} onClick={() => { setMobile(false) }}>{t('canvasConversionDesktop')}</button>
        <button type="button" aria-pressed={mobile} onClick={() => { setMobile(true) }}>{t('canvasConversionMobile')}</button>
        <span>{t('canvasUpdateViewportWidth').replace('{width}', String(width))}</span>
      </div>
      <div ref={viewport} className={css.viewport}>
        <div style={{ width: width * scale, height: height * scale }}>
          <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {preview ? <CanvasPagePreview page={preview} width={width} height={height} title={t('canvasUpdatePreview')}
              {...(projectPath === undefined ? {} : { projectPath })} /> : <p role="status">{t('canvasConversionPreparing')}</p>}
          </div>
        </div>
      </div>
      {list('canvasUpdateDesignChanges', review.designChanges)}
      {list('canvasUpdatePageEdits', review.pageEdits)}
      {unplaced.length ? <p role="alert">{t('canvasUpdateUnplaced').replace('{names}', unplaced.map(name).join(', '))}</p> : null}
      <p className={css.hint}>{t('canvasUpdateHistoryHint')}</p>
      {previewError ? <p role="alert">{previewError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Modal>
}
