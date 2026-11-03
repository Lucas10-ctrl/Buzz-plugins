/** Staged variable-font axis values shared by text layers, styles and rich ranges. */
import { useEffect, useState, type ReactNode } from 'react'
import type { CopyOSDesignFontVariation, CopyOSDesignFontAxis, CopyOSDesignFontMetadata } from '../../../copyos-domain/src/types.ts'
import { useDesignerFontMetadata } from './DesignerFontMetadata.tsx'
import { designerFontName } from './DesignerFonts.ts'
import axisCss from './DesignerFontVariations.module.css'
import { DesignerPopover } from './DesignerPopover.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerFontFeatures.module.css'

type Change = { reset: 'defaults' | 'inherit' } | { defaults?: boolean; edits: { tag: string; value: number | null }[] }
type AxisFont = { fontFamily: string; fontWeight: number; fontStyle?: 'normal' | 'italic' | undefined; fontSize?: number | undefined }
type Translate = (key: CopyOSFoundationLocaleKey) => string
const numeric = (value: string): boolean => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
  && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1_000_000
/** Apply only touched axes to each owner's effective list.
 * @param variations - Current effective axis values.
 * @param change - One accepted editor transaction.
 * @returns Canonical values; undefined restores inherited ownership, while empty uses font defaults.
 */
export function editDesignerFontVariations(variations: readonly CopyOSDesignFontVariation[] | undefined,
  change: Change): CopyOSDesignFontVariation[] | undefined {
  if ('reset' in change) return change.reset === 'defaults' ? [] : undefined
  const values = new Map((change.defaults ? [] : variations)?.map(axis => [axis.tag, axis.value]))
  for (const edit of change.edits) {
    if (edit.value === null) values.delete(edit.tag)
    else values.set(edit.tag, edit.value)
  }
  return [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([tag, value]) => ({ tag, value }))
}
/** Show a bounded axis editor without claiming unsupported axes exist in the selected font.
 * @param props - Effective axis lists and typography, ownership identity, localized labels and one transaction callback.
 * @returns A staged popover; cancellation discards drafts and rejected commits keep them open.
 */
export function DesignerFontVariations({ values, fonts, selectionKey, disabled = false, t, onApply }: {
  values: readonly (readonly CopyOSDesignFontVariation[] | undefined)[]
  fonts?: readonly AxisFont[] | undefined
  selectionKey: string
  disabled?: boolean
  t: Translate
  onApply: (change: Change) => boolean | void
}): ReactNode {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [selectionKey, disabled])
  return <fieldset disabled={disabled} className={css.container}>
    <DesignerPopover label={t('designerFontVariations')} closeLabel={t('designerDone')} open={open}
      onOpenChange={setOpen} panelClassName={css.panel} trigger={t('designerFontVariations')}>
      {open ? <AxisDraft key={selectionKey} values={values} fonts={fonts} t={t} onApply={(change) => {
        if (disabled) return false
        const accepted = onApply(change)
        if (accepted !== false) setOpen(false)
        return accepted
      }} /> : null}
    </DesignerPopover>
  </fieldset>
}
function AxisDraft({ values, fonts, t, onApply }: {
  values: readonly (readonly CopyOSDesignFontVariation[] | undefined)[]
  fonts?: readonly AxisFont[] | undefined
  t: Translate
  onApply: (change: Change) => boolean | void
}): ReactNode {
  const lookup = useDesignerFontMetadata()
  const familyKey = JSON.stringify([...new Set(fonts?.map(font => designerFontName(font.fontFamily)) ?? [])])
  const [discovery, setDiscovery] = useState<{ key: string; reader: typeof lookup; metadata: CopyOSDesignFontMetadata[] | null }>({ key: '', reader: undefined, metadata: null })
  useEffect(() => {
    let active = true
    const families = JSON.parse(familyKey) as string[]
    if (!lookup || !families.length || families.length > 64) return
    void Promise.all(families.map(family => lookup(family))).then((metadata) => {
      if (active) setDiscovery({ key: familyKey, reader: lookup, metadata })
    }).catch(() => { if (active) setDiscovery({ key: familyKey, reader: lookup, metadata: [] }) })
    return () => { active = false }
  }, [familyKey, lookup])
  const metadata = lookup && discovery.reader === lookup && discovery.key === familyKey ? discovery.metadata : null
  const available = metadata?.length && metadata.every(item => item.state === 'available') ? metadata : null
  const first = available?.[0]
  const known = new Map<string, CopyOSDesignFontAxis>()
  if (available && first) for (const axis of first.axes) {
    const matches = available.flatMap(item => item.axes.filter(other => other.tag === axis.tag))
    if (matches.length !== available.length) continue
    const min = Math.max(...matches.map(item => item.min)), max = Math.min(...matches.map(item => item.max))
    if (min <= max) known.set(axis.tag, { ...axis, min, max })
  }
  const requestedFamilies = JSON.parse(familyKey) as string[]
  const loading = !!lookup && requestedFamilies.length > 0 && requestedFamilies.length <= 64 && metadata === null
  const implicit = (key: string, index: number): number | undefined => {
    const font = fonts?.[index]
    if (!font) return undefined
    const metadataIndex = requestedFamilies.indexOf(designerFontName(font.fontFamily)), source = metadata?.[metadataIndex]
    const axis = source?.state === 'available' ? source.axes.find(item => item.tag === key) : undefined
    if (!axis) return undefined
    if (key === 'wght') return Math.max(axis.min, Math.min(axis.max, font.fontWeight))
    if (key === 'ital') return Math.max(axis.min, Math.min(axis.max, font.fontStyle === 'italic' ? 1 : 0))
    if (key === 'slnt') return Math.max(axis.min, Math.min(axis.max, font.fontStyle === 'italic' ? axis.min < 0 ? axis.min : axis.max : 0))
    // Optical sizing may be automatic; its effective coordinate is not inferred from the font size.
    return key === 'opsz' ? undefined : axis.default
  }
  const [edits, setEdits] = useState<Record<string, string | null>>({})
  const [tag, setTag] = useState('')
  const [value, setValue] = useState('0')
  const [reset, setReset] = useState<'defaults' | 'inherit' | null>(null)
  const [rejected, setRejected] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(200)
  const tags = [...new Set([...values.flatMap(axes => axes?.map(axis => axis.tag) ?? []), ...Object.keys(edits), ...known.keys()])].sort()
  const current = (key: string): string => {
    if (edits[key] !== undefined && edits[key] !== null) return edits[key]
    if (reset === 'inherit') return ''
    const coordinates = values.map((axes, index) => reset || edits[key] === null ? implicit(key, index)
      : axes?.find(axis => axis.tag === key)?.value ?? implicit(key, index))
    const firstValue = coordinates[0]
    return coordinates.every(item => item === firstValue) && firstValue !== undefined ? String(firstValue) : ''
  }
  const validValue = (key: string, raw: string | null): boolean => {
    if (raw === null) return true
    const axis = known.get(key)
    return numeric(raw) && (!axis || Number(raw) >= axis.min && Number(raw) <= axis.max)
  }
  const change: Change = reset && !Object.keys(edits).length ? { reset } : {
    defaults: reset !== null, edits: Object.entries(edits).map(([key, raw]) => ({ tag: key, value: raw === null ? null : Number(raw) })),
  }
  const valid = Object.entries(edits).every(([key, raw]) => validValue(key, raw))
    && values.every(axes => (editDesignerFontVariations(axes, change)?.length ?? 0) <= 64)
  const matches = tags.filter(key => (known.has(key) || edits[key] !== null && !(reset && edits[key] === undefined))
    && `${key} ${known.get(key)?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const pending = tag.length > 0
  const canAdd = /^[A-Za-z0-9]{4}$/.test(tag) && validValue(tag, value)
  const outsideRange = [...Object.entries(edits), ...(pending ? [[tag, value] as const] : [])]
    .some(([key, raw]) => raw !== null && numeric(raw) && known.has(key) && !validValue(key, raw))
  return <div className={css.body}>
    <p className={css.hint}>{t('designerFontVariationsHint')}</p>
    <p role="status" className={css.hint}>{t(loading ? 'designerFontAxesLoading' : available
      ? known.size ? 'designerFontAxesAvailable' : 'designerFontAxesNoCommon' : 'designerFontAxesUnavailable')}</p>
    <div className={css.actions}>
      <button type="button" aria-pressed={reset === 'defaults'} onClick={() => { setReset('defaults'); setEdits({}); setTag('') }}>{t('designerFontFeatureDefaults')}</button>
      <button type="button" aria-pressed={reset === 'inherit'} onClick={() => { setReset('inherit'); setEdits({}); setTag('') }}>{t('designerInheritBase')}</button>
    </div>
    <input aria-label={t('designerFontAxisSearch')} placeholder={t('designerFontAxisSearch')} value={query}
      onChange={(event) => { setQuery(event.currentTarget.value); setLimit(200) }} />
    <div className={css.rows}>
      {matches.slice(0, limit).map((key) => {
        const axis = known.get(key), coordinate = current(key)
        return <div className={`${css.row} ${axis ? axisCss.knownRow : ''}`} key={key}>
          <label>{axis?.name ?? key}{axis ? <small>{key} · {axis.min}–{axis.max}</small> : null}</label>
          <input aria-label={`${key} ${t('designerFontAxisValue')}`} value={coordinate} inputMode="decimal"
            placeholder={t('designerMixed')} aria-invalid={edits[key] !== undefined && !validValue(key, edits[key])}
            onChange={(event) => { setEdits({ ...edits, [key]: event.currentTarget.value }) }} />
          <button type="button" aria-label={`${t('designerFontAxisRemove')} ${key}`}
            onClick={() => { setEdits({ ...edits, [key]: null }) }}>−</button>
          {axis ? <input type="range" className={axisCss.slider} aria-label={`${key} ${t('designerFontAxisSlider')}`}
            min={axis.min} max={axis.max} step="any" value={numeric(coordinate) ? Math.max(axis.min, Math.min(axis.max, Number(coordinate))) : Math.max(axis.min, Math.min(axis.max, axis.default))}
            aria-valuetext={coordinate || t('designerMixed')}
            onChange={(event) => { setEdits({ ...edits, [key]: event.currentTarget.value }) }} /> : null}
        </div>
      })}
    </div>
    {matches.length > limit ? <button type="button" onClick={() => { setLimit(limit + 200) }}>{t('designerFontFeatureMore')}</button> : null}
    <div className={css.custom}>
      <input aria-label={t('designerFontAxisTag')} placeholder={t('designerFontAxisTag')} value={tag} maxLength={4}
        aria-invalid={pending && !/^[A-Za-z0-9]{4}$/.test(tag)} onChange={(event) => { setTag(event.currentTarget.value) }} />
      <input aria-label={t('designerFontAxisValue')} inputMode="decimal" value={value} aria-invalid={pending && !validValue(tag, value)}
        onChange={(event) => { setValue(event.currentTarget.value) }} />
      <button type="button" disabled={!canAdd} onClick={() => { setEdits({ ...edits, [tag]: value }); setTag('') }}>{t('designerFontFeatureAdd')}</button>
    </div>
    {!valid || pending ? <p role="alert" className={css.hint}>{t(outsideRange ? 'designerFontAxisRangeInvalid' : 'designerFontVariationsInvalid')}</p> : null}
    {rejected ? <p role="alert" className={css.hint}>{t('designerFontFeaturesRejected')}</p> : null}
    <button type="button" disabled={(!reset && !Object.keys(edits).length) || !valid || pending}
      onClick={() => { setRejected(onApply(change) === false) }}>{t('designerFontFeaturesApply')}</button>
  </div>
}
