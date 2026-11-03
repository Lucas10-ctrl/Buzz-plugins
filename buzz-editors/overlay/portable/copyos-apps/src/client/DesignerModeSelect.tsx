/** Explicit layer/page mode choices keep Auto distinct from Base. */
import type { ReactNode } from 'react'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Render the local mode assignment with its inherited result.
 * @param props - Scene, raw assignment, inherited mode and localized mutation callback.
 * @returns Compact native mode selector, or nothing for a library without modes.
 */
export function DesignerModeSelect({
  doc,
  value,
  inheritedModeId,
  mixed = false,
  label,
  t,
  onChange,
}: {
  doc: CopyOSDesignDocument
  value: string | null | undefined
  inheritedModeId: string | null
  mixed?: boolean
  label: string
  t: (key: CopyOSFoundationLocaleKey) => string
  onChange: (value: string | null) => void
}): ReactNode {
  if (!doc.tokenModes?.length) return null
  const inherited =
    doc.tokenModes.find(m => m.id === inheritedModeId)?.name ??
    t('designerBaseMode')
  return (
    <label className={css.captionedField}>
      <span className={css.fieldCaption}>{label}</span>
      <span className={css.field}>
        <select
          aria-label={label}
          value={mixed ? 'mixed' : (value ?? '')}
          onChange={(e) =>{  onChange(e.currentTarget.value || null) }}
        >
          <option value="mixed" disabled>
            {t('designerMixed')}
          </option>
          <option value="">
            {t('designerAutoMode').replace('{mode}', inherited)}
          </option>
          <option value="base">{t('designerBaseMode')}</option>
          {doc.tokenModes.map(m => (
            <option value={m.id} key={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}
