/** Staged, font-dependent OpenType settings shared by layer, resource and range editors. */
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { CopyOSDesignFontFeature } from '../../../copyos-domain/src/types.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerFontFeatures.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string
export type DesignerFontFeaturesChange =
  | { reset: 'defaults' | 'inherit' }
  | { defaults?: boolean; edits: readonly { tag: string; value: number | null }[] }
const commonLabels: Record<string, CopyOSFoundationLocaleKey> = {
  liga: 'designerFeatureLiga', kern: 'designerFeatureKern', calt: 'designerFeatureCalt', smcp: 'designerFeatureSmcp',
  c2sc: 'designerFeatureC2sc', tnum: 'designerFeatureTnum', pnum: 'designerFeaturePnum', onum: 'designerFeatureOnum',
  lnum: 'designerFeatureLnum', frac: 'designerFeatureFrac', zero: 'designerFeatureZero', dlig: 'designerFeatureDlig',
}
const commonTags = ['liga', 'kern', 'calt', 'smcp', 'c2sc', 'tnum', 'pnum', 'onum', 'lnum', 'frac', 'zero', 'dlig']
/** Apply only touched tags, retaining unrelated settings on each selected owner.
 * @param features - Effective features for this owner.
 * @param change - One accepted editor transaction.
 * @returns Canonical features, or omitted ownership for inheritance.
 */
export function editDesignerFontFeatures(
  features: readonly CopyOSDesignFontFeature[] | undefined, change: DesignerFontFeaturesChange,
): CopyOSDesignFontFeature[] | undefined {
  if ('reset' in change) return change.reset === 'defaults' ? [] : undefined
  const values = new Map((change.defaults ? [] : features)?.map(feature => [feature.tag, feature.value]))
  for (const edit of change.edits) {
    if (edit.value === null) values.delete(edit.tag)
    else values.set(edit.tag, edit.value)
  }
  return [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([tag, value]) => ({ tag, value }))
}
/** Render a compact settings popover. Drafts persist through invalid input and commit once on Apply.
 * @param props - Effective selections, ownership identity, localized labels and mutation callback.
 * @returns Settings trigger and a dismissible, staged editor.
 */
export function DesignerFontFeatures({ values, selectionKey, disabled = false, t, onApply }: {
  values: readonly (readonly CopyOSDesignFontFeature[] | undefined)[]
  selectionKey: string
  disabled?: boolean
  t: Translate
  onApply: (change: DesignerFontFeaturesChange) => boolean | void
}): ReactNode {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [selectionKey, disabled])
  return <fieldset disabled={disabled} className={css.container}>
    <DesignerPopover label={t('designerFontFeatures')} closeLabel={t('designerDone')} open={open}
      onOpenChange={setOpen} panelClassName={css.panel} trigger={t('designerFontFeatures')}>
      {open ? <FeatureDraft key={selectionKey} values={values} disabled={disabled} t={t}
        onApply={(change) => {
          if (disabled) return false
          const result = onApply(change)
          if (result !== false) setOpen(false)
          return result
        }} /> : null}
    </DesignerPopover>
  </fieldset>
}
function FeatureDraft({ values, disabled, t, onApply }: {
  values: readonly (readonly CopyOSDesignFontFeature[] | undefined)[]
  disabled: boolean
  t: Translate
  onApply: (change: DesignerFontFeaturesChange) => boolean | void
}): ReactNode {
  const [rejected, setRejected] = useState(false)
  const id = useId()
  const tags = [...new Set([...commonTags, ...values.flatMap(features => features?.map(feature => feature.tag) ?? [])])]
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(200)
  const [customTag, setCustomTag] = useState('')
  const [customValue, setCustomValue] = useState('1')
  const [indices, setIndices] = useState<string[]>([])
  const [custom, setCustom] = useState<string[]>([])
  const [reset, setReset] = useState<'defaults' | 'inherit' | null>(null)
  const current = (tag: string): string => {
    if (edits[tag] !== undefined) return edits[tag]
    if (reset) return 'default'
    const first = values[0]?.find(feature => feature.tag === tag)?.value
    return values.every(features => features?.find(feature => feature.tag === tag)?.value === first)
      ? first === undefined ? 'default' : String(first) : 'mixed'
  }
  const validValue = (value: string): boolean => value === 'default' || /^\d+$/.test(value) && Number(value) <= 65535
  const allTags = [...new Set([...tags, ...custom])]
  const matches = allTags.filter(tag => `${tag} ${commonLabels[tag] ? t(commonLabels[tag]) : ''}`
    .toLowerCase().includes(query.toLowerCase()))
  const change: DesignerFontFeaturesChange = reset && Object.keys(edits).length === 0 ? { reset } : {
    defaults: reset !== null,
    edits: Object.entries(edits).map(([tag, value]) => ({ tag, value: value === 'default' ? null : Number(value) })),
  }
  const changed = reset !== null || Object.keys(edits).length > 0
  const valid = Object.values(edits).every(validValue) && values.every((features) => {
    const result = editDesignerFontFeatures(reset ? [] : features, change)
    return !result || result.length <= 64
  })
  const customPending = customTag.length > 0
  const customValid = /^[A-Za-z0-9]{4}$/.test(customTag) && /^\d+$/.test(customValue) && Number(customValue) <= 65535
  return <fieldset disabled={disabled} className={css.body}>
    <p className={css.hint}>{t('designerFontFeaturesHint')}</p>
    <div className={css.actions}>
      <button type="button" aria-pressed={reset === 'defaults'} onClick={() => { setReset('defaults'); setEdits({}); setIndices([]); setCustomTag('') }}>{t('designerFontFeatureDefaults')}</button>
      <button type="button" aria-pressed={reset === 'inherit'} onClick={() => { setReset('inherit'); setEdits({}); setIndices([]); setCustomTag('') }}>{t('designerInheritBase')}</button>
    </div>
    <input aria-label={t('designerFontFeatureSearch')} placeholder={t('designerFontFeatureSearch')} value={query}
      onChange={(event) => { setQuery(event.currentTarget.value); setLimit(200) }} />
    <div className={css.rows}>
      {matches.slice(0, limit).map((tag) => {
        const value = current(tag)
        const numeric = indices.includes(tag) || !['default', 'mixed', '0', '1'].includes(value)
        return <div className={css.row} key={tag}>
          <label htmlFor={`${id}-feature-${tag}`}>{commonLabels[tag] ? t(commonLabels[tag]) : tag}
            {commonLabels[tag] ? <small>{tag}</small> : null}</label>
          <select id={`${id}-feature-${tag}`} aria-label={`${tag} ${t('designerFontFeatureState')}`} value={numeric ? 'index' : value}
            onChange={(event) => {
              const next = event.currentTarget.value
              setIndices(next === 'index' ? [...indices, tag] : indices.filter(value => value !== tag))
              setEdits({ ...edits, [tag]: next === 'index' ? '2' : next })
            }}>
            <option value="mixed" disabled>{t('designerMixed')}</option>
            <option value="default">{t('designerFontFeatureDefault')}</option>
            <option value="0">{t('designerFontFeatureOff')}</option>
            <option value="1">{t('designerFontFeatureOn')}</option>
            <option value="index">{t('designerFontFeatureIndex')}</option>
          </select>
          {numeric ? <input aria-label={`${tag} ${t('designerFontFeatureIndex')}`} inputMode="numeric" value={value}
            aria-invalid={!validValue(value)}
            onChange={(event) => { setEdits({ ...edits, [tag]: event.currentTarget.value }) }} /> : <span />}
        </div>
      })}
    </div>
    {matches.length > limit ? <button type="button" onClick={() => { setLimit(limit + 200) }}>
      {t('designerFontFeatureMore')}</button> : null}
    {!matches.length ? <p className={css.hint}>{t('designerFontFeatureNoMatches')}</p> : null}
    <div className={css.custom}>
      <input aria-label={t('designerFontFeatureTag')} placeholder={t('designerFontFeatureTag')} value={customTag} maxLength={4} aria-invalid={customPending && !/^[A-Za-z0-9]{4}$/.test(customTag)} onChange={(event) => { setCustomTag(event.currentTarget.value) }} />
      <input aria-label={t('designerFontFeatureValue')} inputMode="numeric" value={customValue} aria-invalid={customPending && !validValue(customValue)} onChange={(event) => { setCustomValue(event.currentTarget.value) }} />
      <button type="button" disabled={!customValid} onClick={() => {
        setCustom([...custom, customTag]); setEdits({ ...edits, [customTag]: customValue }); setCustomTag('')
      }}>{t('designerFontFeatureAdd')}</button>
    </div>
    {!valid || customPending ? <p role="alert" className={css.hint}>{t('designerFontFeaturesInvalid')}</p> : null}
    {rejected ? <p role="alert" className={css.hint}>{t('designerFontFeaturesRejected')}</p> : null}
    <button type="button" disabled={!changed || !valid || customPending} onClick={() => { setRejected(onApply(change) === false) }}>{t('designerFontFeaturesApply')}</button>
  </fieldset>
}
