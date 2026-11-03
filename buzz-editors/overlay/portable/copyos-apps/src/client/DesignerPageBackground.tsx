/** The shared page backdrop keeps its own paint and follows page color modes. */
import { useRef, type ReactNode } from 'react'
import {
  designCanvasBackground,
  resolveDesignCanvasBackground,
  resolveDesignModeColors,
  designColorVariableCss,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignCanvasBackground, CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerHexField } from './DesignerHexField.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

/** Edit the current page's persisted backdrop without changing scene layers.
 * @param props - Document, active page, localized labels and document transactions.
 * @returns Solid background paint controls with local opacity and visibility.
 */
export function DesignerPageBackground({ doc, pageId, t, commit, preview, cancelPreview }: {
  doc: CopyOSDesignDocument
  pageId: string
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
}): ReactNode {
  const origin = useRef<CopyOSDesignDocument | null>(null)
  const resolved = resolveDesignCanvasBackground(doc, pageId)
  const authored = resolved.background
  const colors = resolveDesignModeColors(doc, resolved.tokenModeId)
  const cancel = (): void => { origin.current = null; cancelPreview() }
  const apply = (source: CopyOSDesignDocument, background: CopyOSDesignCanvasBackground, transient = false): void => {
    const next = source.pages?.some(p => p.id === pageId)
      ? { ...source, pages: source.pages.map(p => p.id === pageId ? { ...p, canvasBackground: background } : p) }
      : { ...source, canvasBackground: background }
    if (transient) preview(next)
    else { origin.current = null; commit(next) }
  }
  const patch = (value: Partial<CopyOSDesignCanvasBackground>): void => {
    const source = origin.current ?? doc
    cancel()
    apply(source, { ...designCanvasBackground(source, pageId), ...value })
  }
  const edit = (color: string, alpha: number, transient = false): void => {
    if (transient) origin.current ??= doc
    const source = origin.current ?? doc
    const current = resolveDesignCanvasBackground(source, pageId)
    const paint = current.background
    const sameColor = color.toLowerCase() === current.color.toLowerCase()
    if (sameColor && alpha === current.alpha) {
      if (transient) preview(source)
      else { origin.current = null; commit(source) }
      return
    }
    const variable = resolveDesignModeColors(source, current.tokenModeId).find(v => v.id === paint.variableId)
    const tokenAlpha = variable?.alpha ?? 1
    const keep = sameColor && !!variable && tokenAlpha > 0 && alpha <= tokenAlpha
    apply(source, { ...paint, color, variableId: keep ? paint.variableId : null,
      opacity: keep ? alpha / tokenAlpha : alpha }, transient)
  }
  return <section className={css.propertySection}>
    <h3>{t('designerPage')}</h3>
    <div className={css.paintRow} role="group" aria-label={t('designerCanvasBackground')} data-hidden={!authored.visible}>
      <DesignerPopover label={t('designerCanvasBackground')} closeLabel={t('designerDone')} onDismiss={cancel}
        trigger={<DesignerSwatch className={css.paintPreview}
          paint={designColorVariableCss({ value: resolved.color, alpha: resolved.alpha })} />}>
        <DesignerColorPicker color={resolved.color} opacity={resolved.alpha} resources={colors} t={t}
          opacityLabel={t('designerColorAlpha')}
          onPreview={(color, alpha) => { edit(color, alpha, true) }}
          onCommit={(color, alpha) => { edit(color, alpha) }} onCancel={cancel}
          onVariable={(variable) => { patch({ color: variable.value, variableId: variable.id }) }} />
        {authored.variableId ? <button type="button" className={css.detachPaint}
          onClick={() => { patch({ color: resolved.color, opacity: resolved.alpha, variableId: null }) }}>
          {t('designerDetachColor')}</button> : null}
      </DesignerPopover>
      <DesignerHexField color={resolved.color} label={t('designerCanvasBackgroundHex')} mixed={t('designerMixed')}
        onCommit={(color) => {
          if (color.toLowerCase() !== resolved.color.toLowerCase())
            patch({ color, opacity: resolved.alpha, variableId: null })
        }} />
      <DesignerNumberField label={t('designerCanvasBackgroundOpacity')} short="%" value={authored.opacity * 100}
        min={0} max={100} mixed={t('designerMixed')} onCommit={(value) => { patch({ opacity: value / 100 }) }} />
      <button type="button" aria-label={t(authored.visible ? 'designerHideCanvasBackground' : 'designerShowCanvasBackground')}
        aria-pressed={authored.visible} onClick={() => { patch({ visible: !authored.visible }) }}><Icon name="eye" /></button>
    </div>
  </section>
}
