/** Crop mode owns one reversible edit session, separate from ordinary selection tools. */
import type { ReactNode } from 'react'
import type { CopyOSDesignImagePaint } from '../../../copyos-domain/src/types.ts'
import { DESIGN_IMAGE_LIMITS } from '../../../copyos-domain/src/design-model.ts'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Render crop aspect, image transforms, fit and session completion controls.
 * @param props - Current image, crop aspect and callbacks that preview or finish the session.
 * @returns A compact floating crop toolbar.
 */
export function DesignerCropToolbar({
  image,
  aspect,
  t,
  onAspect,
  onZoom,
  onRotation,
  onFit,
  onDone,
  onCancel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  image: CopyOSDesignImagePaint
  aspect: string
  t: (key: CopyOSFoundationLocaleKey) => string
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onAspect: (value: string) => void
  onZoom: (value: number) => void
  onRotation: (value: number) => void
  onFit: () => void
  onDone: () => void
  onCancel: () => void
}): ReactNode {
  return (
    <div
      data-designer-crop-ui="true"
      className={css.cropToolbar}
      role="toolbar"
      aria-label={t('designerCropToolbar')}
    >
      <div
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span style={{ flex: 1 }}>{t('designerCropToolbar')}</span>
        <button
          type="button"
          aria-label={t('designerUndo')}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          aria-label={t('designerRedo')}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Icon name="redo" />
        </button>
      </div>
      <select
        aria-label={t('designerCropAspect')}
        value={aspect}
        onChange={(e) =>{  onAspect(e.currentTarget.value) }}
      >
        <option value="free">{t('designerCropFree')}</option>
        <option value="original">{t('designerCropOriginal')}</option>
        {['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'].map(value => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <DesignerNumberField
        label={t('designerImageZoom')}
        short="%"
        value={(image.zoom ?? 1) * 100}
        mixed={t('designerMixed')}
        min={DESIGN_IMAGE_LIMITS.minZoom * 100}
        max={DESIGN_IMAGE_LIMITS.maxZoom * 100}
        onCommit={(value) =>{  onZoom(value / 100) }}
      />
      <DesignerNumberField
        label={t('designerImageRotation')}
        short="°"
        value={image.rotation ?? 0}
        mixed={t('designerMixed')}
        min={-36000}
        max={36000}
        onCommit={onRotation}
      />
      <button type="button" onClick={onCancel}>
        {t('cancel')}
      </button>
      <button type="button" onClick={onFit}>
        {t('designerCropFit')}
      </button>
      <button type="button" className={css.cropConfirm} onClick={onDone}>
        {t('designerDone')}
      </button>
      <p>{t('designerCropCanvasHint')}</p>
    </div>
  )
}
