/** Constructive geometry controls retain operands until an explicit flatten. */
import type { ReactNode } from 'react'
import type { CopyOSDesignNode, CopyOSDesignBooleanOperation } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerBooleanControls.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
const labels = { union: 'designerBooleanUnion', subtract: 'designerBooleanSubtract', intersect: 'designerBooleanIntersect', exclude: 'designerBooleanExclude' } as const
/** Translate native eligibility codes into actionable selection guidance. */
export function designerBooleanReason(reason: string | undefined, t: Translate): string {
  const keys: Record<string, CopyOSFoundationLocaleKey> = {
    'select-two': 'designerBooleanSelectTwo', 'missing-node': 'designerBooleanMissing',
    'same-parent': 'designerBooleanSameParent', locked: 'designerBooleanLocked', component: 'designerBooleanComponent',
    'unsupported-operand': 'designerBooleanUnsupported',
  }
  return t(keys[reason ?? ''] ?? 'designerBooleanSelectTwo')
}
/** Render one compact selection section using native select keyboard behavior. */
export function DesignerBooleanControls({ selected, enabled, reason, t, onOperation, onUngroup, onFlatten }: {
  selected?: CopyOSDesignNode | undefined
  enabled: boolean
  reason?: string | undefined
  t: Translate
  onOperation: (operation: CopyOSDesignBooleanOperation) => void
  onUngroup: () => void
  onFlatten: () => void
}): ReactNode {
  return <section className={css.root} aria-label={t('designerBoolean')}>
    {selected ? <label>{t('designerBoolean')}<select aria-label={t('designerBooleanOperation')}
      disabled={!enabled} value={selected.booleanOperation} onChange={(event) => {
        const value = event.currentTarget.value
        if (value === 'union' || value === 'subtract' || value === 'intersect' || value === 'exclude') onOperation(value)
      }}>{Object.entries(labels).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>
      : enabled ? <label>{t('designerBoolean')}<select aria-label={t('designerBooleanOperation')} value="" onChange={(event) => {
        const value = event.currentTarget.value
        if (value === 'union' || value === 'subtract' || value === 'intersect' || value === 'exclude') onOperation(value)
      }}><option value="" disabled>{t('designerBooleanChoose')}</option>{Object.entries(labels).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label> : null}
    {reason ? <p>{reason}</p> : null}
    {selected ? <><p>{t('designerBooleanEditable')}</p><p>{t('designerBooleanResize')}</p><div className={css.actions}>
      <button type="button" disabled={!enabled} onClick={onUngroup}>{t('designerUngroup')}</button>
      <button type="button" disabled={!enabled} onClick={onFlatten}>{t('designerBooleanFlatten')}</button>
    </div></> : null}
  </section>
}
