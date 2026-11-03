/** Advanced vector stroke settings preserve per-layer geometry and linked ownership. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignInstanceStroke,
} from '../../../copyos-domain/src/types.ts'
import {
  DESIGN_STROKE_STYLE_KEYS,
  designStrokeDashes,
  designStrokeSupportsAdvanced,
  designStrokeAlignmentSupported,
  designStrokeHasJoins,
} from '../../../copyos-domain/src/design-model.ts'
import { editDesignerStrokeSelection } from './DesignerStrokeEdits.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerStrokeChoice } from './DesignerStrokeChoice.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerAdvancedStroke.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
function DashPattern({
  value,
  mixed,
  t,
  onCommit,
}: {
  value: readonly number[] | null
  mixed: string
  t: Translate
  onCommit: (values: number[]) => boolean | void
}): ReactNode {
  const formatted = value?.join(', ') ?? ''
  const [draft, setDraft] = useState(formatted),
    [invalid, setInvalid] = useState(false)
  const focused = useRef(false),
    edited = useRef(false)
  useEffect(() => {
    if (!focused.current) {
      setDraft(formatted)
      setInvalid(false)
    }
  }, [formatted])
  const commit = (): void => {
    if (!edited.current) return
    const parts = draft.trim()
      ? draft
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
      : []
    const values = parts.map(Number)
    const valid =
      !/^\s*,|,\s*$|,\s*,/.test(draft) &&
      parts.every(part => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(part)) &&
      values.length <= 100 &&
      values.length % 2 === 0 &&
      values.every(value => Number.isFinite(value) && value >= 0 && value <= 1000) &&
      (!values.length || values.some(value => value > 0))
    if (!valid) {
      setInvalid(true)
      return
    }
    if (onCommit(values) === false) {
      setDraft(formatted)
      setInvalid(false)
      edited.current = false
      return
    }
    setDraft(values.join(', '))
    setInvalid(false)
    edited.current = false
  }
  return (
    <label className={css.pattern}>
      <span>{t('designerStrokeDashes')}</span>
      <input
        aria-label={t('designerStrokeDashes')}
        aria-invalid={invalid || undefined}
        maxLength={4096}
        value={draft}
        placeholder={value === null ? mixed : t('designerDashPatternHint')}
        onFocus={() => {
          focused.current = true
          edited.current = false
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          setInvalid(false)
          edited.current = true
        }}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            commit()
          }
        }}
      />
      {invalid ? (
        <span role="alert" className={css.error}>
          {t('designerInvalidDashPattern')}
        </span>
      ) : null}
    </label>
  )
}
/** Render compact advanced stroke geometry with true cap/join previews, paired dashes and angle conversion.
 * @param props - Effective editable stroke selection and immutable document history callbacks.
 * @returns An anchored vector settings panel; unsupported glyph/group geometry is explained instead of edited.
 */
export function DesignerAdvancedStroke({
  doc,
  items,
  t,
  commit,
  preview,
  cancelPreview,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
  preview: (document: CopyOSDesignDocument) => void
  cancelPreview: () => void
}): ReactNode {
  const owner = `${doc.id}:${items.map(item => `${item.id}:${item.locked}`).join(',')}`
  const session = useRef<{
    document: CopyOSDesignDocument
    items: readonly CopyOSDesignNode[]
    property: string
    value: string | null
    active: boolean
  } | null>(null)
  const displayedItems = session.current?.items ?? items
  const displayedDocument = session.current?.document ?? doc
  const supported = items.length > 0 && items.every(designStrokeSupportsAdvanced)
  const patterns = displayedItems.map(designStrokeDashes)
  const [customOwner, setCustomOwner] = useState<string | null>(null)
  const styles = patterns.map(pattern =>
    !pattern.length ? 'solid' : pattern.length === 2 ? 'dashed' : 'custom',
  )
  const style =
    customOwner === owner && styles.every(value => value !== 'solid')
      ? 'custom'
      : styles.every(value => value === styles[0])
        ? (styles[0] ?? null)
        : null
  const cancel = (): void => {
    const original = session.current
    session.current = null
    if (original?.active) cancelPreview()
  }
  const edit = (
    fields:
      | Partial<CopyOSDesignInstanceStroke>
      | ((item: CopyOSDesignNode) => Partial<CopyOSDesignInstanceStroke>),
    transient = false,
  ): boolean | void => {
    const original = session.current ?? { document: doc, items }
    let next = original.document
    for (const item of original.items)
      next = editDesignerStrokeSelection(
        next,
        [item],
        typeof fields === 'function' ? fields(item) : fields,
      )
    if (transient) {
      if (session.current) session.current.active = true
      preview(next)
      return
    }
    const accepted = commit(next)
    if (accepted !== false) session.current = null
    return accepted
  }
  const common = <T,>(values: readonly T[]): T | null =>
    values.every(value => value === values[0]) ? (values[0] ?? null) : null
  const choice = (
    property: string,
    labelKey: CopyOSFoundationLocaleKey,
    value: string | null,
    choices: readonly { id: string; labelKey: CopyOSFoundationLocaleKey }[],
    fields: (value: string, item: CopyOSDesignNode) => Partial<CopyOSDesignInstanceStroke>,
  ): ReactNode => (
    <label className={css.row}>
      <span>{t(labelKey)}</span>
      <DesignerStrokeChoice
        key={`${owner}:${property}`}
        label={t(labelKey)}
        mixed={t('designerMixed')}
        value={session.current?.property === property ? session.current.value : value}
        choices={choices.map(choice => ({ id: choice.id, label: t(choice.labelKey) }))}
        onBegin={() => {
          session.current = { document: doc, items, property, value, active: false }
        }}
        onPreview={(value) => {
          edit(item => fields(value, item), true)
        }}
        onCommit={(value) => {
          const accepted = edit(item => fields(value, item))
          if (accepted !== false && property === 'style')
            setCustomOwner(value === 'custom' ? owner : null)
          return accepted
        }}
        onCancel={cancel}
      />
    </label>
  )
  const hasLocal = displayedItems.some(
    item =>
      item.kind === 'instance' &&
      (() => {
        const local = displayedDocument.nodes.find(node => node.id === item.id)?.instanceStroke
        return (
          !!local &&
          [...DESIGN_STROKE_STYLE_KEYS, 'strokeDash'].some(key => Object.hasOwn(local, key))
        )
      })(),
  )
  return (
    <DesignerPopover
      label={t('designerAdvancedStroke')}
      closeLabel={t('designerDone')}
      trigger={<DesignerIcon name="settings" />}
      onDismiss={cancel}
    >
      <div className={css.body}>
        {!supported ? (
          <p className={css.notice}>{t('designerUnsupportedStrokeGeometry')}</p>
        ) : (
          <>
            {!items.every(designStrokeAlignmentSupported) ? (
              <p className={css.notice}>{t('designerOpenStrokeAlignment')}</p>
            ) : null}
            {choice(
              'style',
              'designerStrokeStyle',
              style,
              [
                { id: 'solid', labelKey: 'designerStrokeSolid' },
                { id: 'dashed', labelKey: 'designerStrokeDashed' },
                { id: 'custom', labelKey: 'designerCustom' },
              ],
              (value, item) => {
                const pattern = designStrokeDashes(item)
                return {
                  strokeDashes:
                    value === 'solid'
                      ? []
                      : value === 'dashed'
                        ? [pattern[0] ?? 4, pattern[1] ?? 4]
                        : pattern.length
                          ? pattern
                          : [4, 4],
                }
              },
            )}
            {style === 'dashed' ? (
              <div className={css.pair}>
                {([0, 1] as const).map(index => (
                  <DesignerNumberField
                    caption
                    key={`${owner}:dash:${index}`}
                    label={t(index === 0 ? 'designerDash' : 'designerStrokeGap')}
                    short={index === 0 ? '┄' : '↔'}
                    mixed={t('designerMixed')}
                    min={0}
                    max={1000}
                    value={common(patterns.map(pattern => pattern[index] ?? 0))}
                    onCommit={(value) => {
                      if (
                        items
                          .filter(item => !item.locked)
                          .some((item) => {
                            const pattern = designStrokeDashes(item)
                            const next = [pattern[0] ?? 4, pattern[1] ?? 4]
                            next[index] = value
                            return next.every(value => value === 0)
                          })
                      )
                        return false
                      return edit((item) => {
                        const pattern = designStrokeDashes(item)
                        const next = [pattern[0] ?? 4, pattern[1] ?? 4]
                        next[index] = value
                        return { strokeDashes: next }
                      })
                    }}
                  />
                ))}
              </div>
            ) : null}
            {style === 'custom' ? (
              <DashPattern
                key={`${owner}:pattern`}
                value={
                  patterns.every(pattern => JSON.stringify(pattern) === JSON.stringify(patterns[0]))
                    ? (patterns[0] ?? [])
                    : null
                }
                mixed={t('designerMixed')}
                t={t}
                onCommit={strokeDashes => edit({ strokeDashes })}
              />
            ) : null}
            {patterns.every(pattern => pattern.length > 0) ? (
              <DesignerNumberField
                caption
                key={`${owner}:offset`}
                label={t('designerStrokeDashOffset')}
                short="↦"
                mixed={t('designerMixed')}
                min={-10000}
                max={10000}
                value={common(displayedItems.map(item => item.strokeDashOffset ?? 0))}
                onCommit={strokeDashOffset => edit({ strokeDashOffset })}
              />
            ) : null}
            {patterns.every(pattern => pattern.length > 0) ||
            items.every(item => item.kind === 'path' && !designStrokeAlignmentSupported(item))
              ? choice(
                'cap',
                'designerStrokeCap',
                common(displayedItems.map(item => item.strokeCap ?? 'butt')),
                [
                  { id: 'butt', labelKey: 'designerStrokeCapNone' },
                  { id: 'round', labelKey: 'designerStrokeCapRound' },
                  { id: 'square', labelKey: 'designerStrokeCapSquare' },
                ],
                value => ({ strokeCap: value as 'butt' | 'round' | 'square' }),
              )
              : null}
            {items.every(designStrokeHasJoins) ? (
              <>
                {choice(
                  'join',
                  'designerStrokeJoin',
                  common(displayedItems.map(item => item.strokeJoin ?? 'miter')),
                  [
                    { id: 'miter', labelKey: 'designerStrokeJoinMiter' },
                    { id: 'round', labelKey: 'designerStrokeJoinRound' },
                    { id: 'bevel', labelKey: 'designerStrokeJoinBevel' },
                  ],
                  value => ({ strokeJoin: value as 'miter' | 'round' | 'bevel' }),
                )}
                {displayedItems.every(item => (item.strokeJoin ?? 'miter') === 'miter') ? (
                  <DesignerNumberField
                    caption
                    key={`${owner}:miter`}
                    label={t('designerMiterAngle')}
                    short="°"
                    mixed={t('designerMixed')}
                    min={(2 * Math.asin(1 / 1000) * 180) / Math.PI}
                    max={180}
                    value={common(
                      items.map(
                        item => (2 * Math.asin(1 / (item.strokeMiterLimit ?? 4)) * 180) / Math.PI,
                      ),
                    )}
                    onCommit={angle =>
                      edit({
                        strokeMiterLimit: Math.max(
                          1,
                          Math.min(1000, 1 / Math.sin((angle * Math.PI) / 360)),
                        ),
                      })
                    }
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
        {hasLocal ? (
          <button
            type="button"
            disabled={!items.some(item => item.kind === 'instance' && !item.locked)}
            onClick={() => {
              let next = doc
              for (const item of items)
                if (item.kind === 'instance')
                  next = editDesignerStrokeSelection(
                    next,
                    [item],
                    Object.fromEntries(
                      [...DESIGN_STROKE_STYLE_KEYS, 'strokeDash'].map(key => [key, undefined]),
                    ),
                  )
              commit(next)
            }}
          >
            {t('designerInheritAdvancedStroke')}
          </button>
        ) : null}
      </div>
    </DesignerPopover>
  )
}
