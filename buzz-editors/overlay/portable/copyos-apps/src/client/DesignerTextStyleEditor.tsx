import { DesignerFontVariations, editDesignerFontVariations } from './DesignerFontVariations.tsx'
/** Shared text styles edit their resource rather than baking values into every layer. */
import { useRef, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignTextStyle,
} from '../../../copyos-domain/src/types.ts'
import { removeDesignTextStyle } from '../../../copyos-domain/src/design-model.ts'
import { DesignerFontFeatures, editDesignerFontFeatures } from './DesignerFontFeatures.tsx'
import { designFontFeatureSettings, designFontVariationSettings } from '../../../copyos-domain/src/design-model.ts'
import { DesignerTextField } from './DesignerTextField.tsx'
import { DesignerFontPicker } from './DesignerFontPicker.tsx'
import { designerFontLabels } from './DesignerFontLabels.ts'
import { editDesignerTextStyleFont } from './DesignerFontEdits.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Edit a named typography resource and preserve references until explicit detachment.
 * @param props - Current style, document and revision-aware editor commit.
 * @returns Resource controls with a bounded preview.
 */
export function DesignerTextStyleEditor({
  doc,
  style,
  t,
  commit,
  preview,
  cancelPreview,
  disabled = false,
}: {
  doc: CopyOSDesignDocument
  style: CopyOSDesignTextStyle
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  disabled?: boolean
}): ReactNode {
  const fontPreview = useRef<CopyOSDesignDocument | null>(null)
  const patch = (fields: Partial<CopyOSDesignTextStyle>): boolean | void => {
    return commit({
      ...doc,
      textStyles: doc.textStyles?.map(s =>
        s.id === style.id ? { ...s, ...fields } : s,
      ),
    })
  }
  const number = (
    key: 'fontSize' | 'lineHeight' | 'letterSpacing',
    label: CopyOSFoundationLocaleKey,
    short: string,
    min: number,
    max: number,
    factor = 1,
  ) => (
    <DesignerNumberField
      label={t(label)}
      short={short}
      value={style[key] * factor}
      mixed={t('designerMixed')}
      min={min * factor}
      max={max * factor}
      onCommit={(value) => {
        patch({ [key]: value / factor })
      }}
    />
  )
  const weights: readonly CopyOSFoundationLocaleKey[] = [
    'designerWeightThin',
    'designerWeightExtraLight',
    'designerWeightLight',
    'designerWeightRegular',
    'designerWeightMedium',
    'designerWeightSemiBold',
    'designerWeightBold',
    'designerWeightExtraBold',
    'designerWeightBlack',
  ]
  return (
    <section
      className={css.textStyleEditor}
      aria-label={t('designerEditTextStyle')}
    >
      <h4>{t('designerEditTextStyle')}</h4>
      <div
        className={css.textStylePreview}
        style={{
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontFeatureSettings: designFontFeatureSettings(style.fontFeatures),
          fontVariationSettings: designFontVariationSettings(style.fontVariations),
          fontStyle: style.fontStyle,
          fontSize: Math.min(32, style.fontSize),
          lineHeight: style.lineHeight,
        }}
      >
        {style.name}
      </div>
      <label className={css.field}>
        <DesignerTextField
          label={t('designerRenameStyle')}
          value={style.name}
          suggestions={[]}
          onCommit={(name) => {
            patch({ name })
          }}
        />
      </label>
      <label className={css.field}>
        <DesignerFontPicker
          value={style.fontFamily}
          families={[
            ...doc.nodes
              .filter(n => n.kind === 'text')
              .map(n => n.fontFamily),
            ...(doc.textStyles?.map(s => s.fontFamily) ?? []),
          ]}
          labels={designerFontLabels(t)}
          selectionKey={`${doc.id}:style:${style.id}`}
          onPreview={(family) => {
            const original = fontPreview.current ?? doc
            fontPreview.current = original
            preview(editDesignerTextStyleFont(original, style.id, family))
          }}
          onCancelPreview={() => {
            if (!fontPreview.current) return
            fontPreview.current = null
            cancelPreview()
          }}
          onCommit={(family) => {
            const original = fontPreview.current ?? doc
            fontPreview.current = null
            commit(editDesignerTextStyleFont(original, style.id, family))
          }}
        />
      </label>
      <div className={css.fieldGrid}>
        {number('fontSize', 'designerFontSize', 'Aa', 1, 1000)}
        <label className={css.field}>
          <select
            aria-label={t('designerFontWeight')}
            value={style.fontWeight}
            onChange={(e) => {
              patch({ fontWeight: Number(e.currentTarget.value) })
            }}
          >
            {weights.map((label, i) => (
              <option key={label} value={(i + 1) * 100}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {number(
          'lineHeight',
          'designerLineHeight',
          '↕',
          0.5,
          10,
          style.fontSize,
        )}
        {number('letterSpacing', 'designerLetterSpacing', '↔', -1000, 1000)}
      </div>
      <DesignerFontFeatures values={[style.fontFeatures]} selectionKey={`${doc.id}:style:${style.id}`} disabled={disabled} t={t}
        onApply={change => patch({ fontFeatures: editDesignerFontFeatures(style.fontFeatures, change) })} />
      <DesignerFontVariations values={[style.fontVariations]} fonts={[style]} selectionKey={`${doc.id}:style:${style.id}`} disabled={disabled} t={t}
        onApply={change => patch({ fontVariations: editDesignerFontVariations(style.fontVariations, change) })} />
      <label className={css.check}>
        <input
          type="checkbox"
          checked={style.fontStyle === 'italic'}
          onChange={(e) => {
            patch({ fontStyle: e.currentTarget.checked ? 'italic' : 'normal' })
          }}
        />
        {t('designerItalic')}
      </label>
      <button
        type="button"
        onClick={() => {
          commit(removeDesignTextStyle(doc, style.id))
        }}
      >
        {t('designerDeleteTextStyle')}
      </button>
    </section>
  )
}
