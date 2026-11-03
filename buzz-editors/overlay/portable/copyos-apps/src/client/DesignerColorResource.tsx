/** All resource entry points share alias, mode, alpha and preview transactions. */
import { useRef, useState, type ReactNode } from 'react'
import type { CopyOSDesignDocument, CopyOSDesignVariable } from '../../../copyos-domain/src/types.ts'
import {
  designColorVariableCss,
  designTokenAliasAllowed,
  setDesignColorVariable,
  resolveDesignModeColors,
  designModeResources,
  resolveDesignNumberVariables,
  designColorAlphaTokenAllowed,
  unbindDesignColorAlpha,
  resetDesignColorAlpha,
  designTokenConfigurationValid,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerSwatch } from './DesignerSwatch.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
const tokenChecks = new WeakMap<CopyOSDesignDocument, Map<string, boolean>>()
/** Each allowed check validates the whole document's tokens; documents are replaced, never mutated, so one answer per document holds. */
function cachedTokenCheck(doc: CopyOSDesignDocument, key: string, check: () => boolean): boolean {
  let checks = tokenChecks.get(doc)
  if (!checks) { checks = new Map(); tokenChecks.set(doc, checks) }
  let allowed = checks.get(key)
  if (allowed === undefined) { allowed = check(); checks.set(key, allowed) }
  return allowed
}
/** Edit a resolved document-mode resource with grouped previews and explicit commits.
 * @param props - Current document, effective resource, alias candidates and transaction callbacks.
 * @returns A named resource row or compact swatch opening the shared color picker.
 */
export function DesignerColorResource({ doc, variable, colors, t, commit, preview, cancelPreview, showName = false }: {
  doc: CopyOSDesignDocument
  variable: CopyOSDesignVariable
  colors: CopyOSDesignVariable[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  showName?: boolean
}): ReactNode {
  const origin = useRef<CopyOSDesignDocument | null>(null)
  const [error, setError] = useState('')
  const cancel = (): void => {
    origin.current = null
    cancelPreview()
  }
  const apply = (next: CopyOSDesignDocument, transient = false): void => {
    if (!designTokenConfigurationValid(next)) {
      setError(t('designerModeValueInvalid'))
      return
    }
    setError('')
    if (transient) preview(next)
    else {
      origin.current = null
      if (commit(next) === false) setError(t('designerModeValueInvalid'))
    }
  }
  const edit = (value: string, alpha: number, transient = false): void => {
    if (transient) origin.current ??= doc
    const source = origin.current ?? doc
    const effective = resolveDesignModeColors(source).find(v => v.id === variable.id)
    if (!effective) return
    const sameColor = value.toLowerCase() === effective.value.toLowerCase()
    const sameAlpha = alpha === (effective.alpha ?? 1)
    apply(sameColor && sameAlpha ? source : setDesignColorVariable(source, variable.id, {
      ...(!sameColor ? { value, aliasId: null } : {}),
      ...(!sameAlpha ? { alpha, alphaSource: { kind: 'literal' } } : {}),
    }), transient)
  }
  const mode = doc.tokenModes?.find(m => m.id === doc.activeTokenModeId)
  const override = mode?.variables.find(v => v.id === variable.id)
  const inherited = !!mode && override?.alpha === undefined && override?.alphaSource === undefined
  const sourceValue = inherited ? '__inherit__' : variable.alphaSource?.kind === 'number'
    ? variable.alphaSource.variableId : variable.alphaSource?.kind === 'literal' ? '__literal__' : '__color__'
  const aliasTargets = colors.filter(c => cachedTokenCheck(doc, `alias:${variable.id}:${c.id}`,
    () => designTokenAliasAllowed(doc, 'color', variable.id, c.id)))
  const numbers = resolveDesignNumberVariables(designModeResources(doc).numberVariables)
    .filter(v => cachedTokenCheck(doc, `alpha:${v.id}`, () => designColorAlphaTokenAllowed(doc, v.id)))
  const changeSource = (value: string): void => {
    const source = origin.current ?? doc
    cancel()
    apply(value === '__inherit__' ? resetDesignColorAlpha(source, variable.id)
      : value === '__literal__' ? unbindDesignColorAlpha(source, variable.id)
        : setDesignColorVariable(source, variable.id, {
          alphaSource: value === '__color__' ? null : { kind: 'number', variableId: value },
        }))
  }
  return <DesignerPopover
    label={t('designerColorFor').replace('{name}', variable.name)}
    closeLabel={t('designerDone')}
    triggerClassName={showName ? css.token : css.tokenColorTrigger}
    trigger={<><DesignerSwatch className={css.paintSwatch} paint={designColorVariableCss(variable)} />
      {showName ? <span>{variable.name}</span> : null}</>}
    onDismiss={cancel}
  >
    <DesignerColorPicker
      color={variable.value}
      opacity={variable.alpha ?? 1}
      opacityLabel={t('designerColorAlpha')}
      resources={aliasTargets}
      t={t}
      onPreview={(value, alpha) => { edit(value, alpha, true) }}
      onCommit={(value, alpha) => { edit(value, alpha) }}
      onCancel={cancel}
      onVariable={(target) => {
        const source = origin.current ?? doc
        cancel()
        apply(setDesignColorVariable(source, variable.id, { value: target.value, aliasId: target.id }))
      }}
    />
    <div className={css.alphaSource}>
      <label>
        <span>{t('designerAlphaSource')}</span>
        <select aria-label={t('designerAlphaSource')} value={sourceValue}
          onChange={(e) => { changeSource(e.currentTarget.value) }}>
          {mode ? <option value="__inherit__">{t('designerInheritBase')}</option> : null}
          <option value="__color__">{t('designerAlphaFromColor')}</option>
          <option value="__literal__">{t('designerOwnValue')}</option>
          {numbers.map(v => <option key={v.id} value={v.id}>{v.name} · {v.value}%</option>)}
        </select>
      </label>
      {variable.alphaSource?.kind === 'number' ? <>
        <p className={css.hint}>{t('designerAlphaPercentHint')}</p>
        <button type="button" className={css.detachPaint} onClick={() => { changeSource('__literal__') }}>
          {t('designerDetachAlpha')}
        </button>
      </> : null}
      {error ? <p role="alert" className={css.hint}>{error}</p> : null}
    </div>
  </DesignerPopover>
}
