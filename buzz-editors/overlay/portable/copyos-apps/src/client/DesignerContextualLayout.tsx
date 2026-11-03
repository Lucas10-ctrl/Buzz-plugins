/** Contextual layout controls retain main-component inheritance and independent local numeric sources. */
import { useMemo, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignInstanceLayout,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  DESIGN_INSTANCE_LAYOUT_KEYS,
  DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS,
  designInstanceLayoutContext,
  editDesignInstanceLayoutContext,
  designModeResources,
  resolveDesignNumberVariables,
  designNumberTokenSupportsProperty,
} from '../../../copyos-domain/src/design-model.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon } from './DesignerIcon.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerAutoLayoutAlignment } from './DesignerAutoLayoutAlignment.tsx'
import { DesignerPadding } from './DesignerPadding.tsx'
import type { DesignAlignmentTarget, DesignAutoLayoutAlignmentIntent, DesignPaddingTarget, DesignPaddingValues } from '../../../copyos-domain/src/design-model.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerContextualLayout.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
type LayoutKey = keyof CopyOSDesignInstanceLayout
type NumberKey = (typeof DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS)[number]
const labels: Record<LayoutKey, CopyOSFoundationLocaleKey> = {
  layout: 'designerLayout',
  gap: 'designerGap',
  crossGap: 'designerCrossGap',
  padding: 'designerPadding',
  paddingTop: 'designerPaddingTop',
  paddingRight: 'designerPaddingRight',
  paddingBottom: 'designerPaddingBottom',
  paddingLeft: 'designerPaddingLeft',
  alignItems: 'designerAlignItems',
  justifyContent: 'designerJustifyContent',
  layoutWrap: 'designerWrap',
  alignContent: 'designerAlignLines',
}
/** Edit supported descendant layout fields through one contextual native transaction.
 * @param props - Stored instance/path, immutable scene and normal accepted/rejected history callback.
 * @returns Mode-aware spacing, stack settings and independent inheritance/reset controls; dormant data remains resettable.
 */
export function DesignerContextualLayout({
  doc,
  instanceId,
  path,
  rootLocked,
  scene,
  t,
  commit,
  setPadding,
  setLayoutAlignment,
}: {
  doc: CopyOSDesignDocument
  instanceId: string
  path: readonly string[]
  rootLocked: boolean
  scene: ReturnType<typeof createDesignRenderScene>
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
  setPadding: (targets: readonly DesignPaddingTarget[], values: DesignPaddingValues) => boolean
  setLayoutAlignment: (targets: readonly (string | DesignAlignmentTarget)[], intent: DesignAutoLayoutAlignmentIntent) => boolean
}): ReactNode {
  const current = useMemo(
    () => designInstanceLayoutContext(doc, instanceId, path, scene),
    [doc, instanceId, path, scene],
  )
  if (!current) return null
  const { node, layout, numericBindings, localLayout, localBindings } = current
  const locked = rootLocked || current.locked
  const grid = node.layout === 'grid',
    stack = node.layout === 'row' || node.layout === 'column'
  const owner = `${doc.id}:${instanceId}:${JSON.stringify(path)}`
  const resources = resolveDesignNumberVariables(
    designModeResources(doc, current.context.modes.get(node.id) ?? null).numberVariables,
  )
  const label = (key: LayoutKey): string =>
    t(
      grid && key === 'gap'
        ? 'designerGridColumnGap'
        : grid && key === 'crossGap'
          ? 'designerGridRowGap'
          : labels[key],
    )
  const own = (key: LayoutKey): boolean =>
    localLayout?.[key] !== undefined ||
    DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(number => number === key && !!localBindings?.[number])
  const apply = (patch: Parameters<typeof editDesignInstanceLayoutContext>[3]): boolean | void =>
    locked ? false : commit(editDesignInstanceLayoutContext(doc, instanceId, path, patch))
  const reset = (key: LayoutKey): boolean | void => apply({ layout: { [key]: undefined } })
  const ownership = (key: LayoutKey, capture: () => boolean | void): ReactNode => (
    <Tooltip
      label={`${t(own(key) ? 'designerInheritLayoutProperty' : 'designerOwnValue')}: ${label(key)}`}
    >
      <button
        type="button"
        className={own(key) ? css.owned : undefined}
        disabled={locked}
        aria-label={`${t(own(key) ? 'designerInheritLayoutProperty' : 'designerOwnValue')}: ${label(key)}`}
        onClick={() => {
          if (own(key)) reset(key)
          else capture()
        }}
      >
        <DesignerIcon name={own(key) ? 'undo' : 'plus'} />
      </button>
    </Tooltip>
  )
  const numeric = (key: NumberKey): ReactNode => {
    const fallback =
      key === 'crossGap' && layout.crossGap === undefined
        ? 'gap'
        : key.startsWith('padding') && layout[key] === undefined
          ? 'padding'
          : key
    const binding = localBindings?.[key] ?? numericBindings[key] ?? numericBindings[fallback]
    const raw = localLayout?.[key] ?? layout[key] ?? layout[fallback] ?? 0
    const value = node[key] ?? node[fallback] ?? 0
    const dormant = current.eligibility.dormantKeys.includes(key)
    const eligible = resources.filter(token =>
      designNumberTokenSupportsProperty(doc, token.id, key, node),
    )
    const retained = binding && !eligible.some(token => token.id === binding)
    return (
      <div className={css.numeric} key={key}>
        <span className={css.caption}>{label(key)}</span>
        <DesignerNumberField
          key={`${owner}:${key}`}
          label={label(key)}
          short={
            key === 'paddingTop' ? (
              '↑'
            ) : key === 'paddingRight' ? (
              '→'
            ) : key === 'paddingBottom' ? (
              '↓'
            ) : key === 'paddingLeft' ? (
              '←'
            ) : key === 'crossGap' ? (
              '↕'
            ) : key === 'gap' ? (
              '↔'
            ) : (
              <DesignerIcon name="padding-top" />
            )
          }
          value={value}
          min={key === 'gap' && !grid ? -10000 : 0}
          max={10000}
          disabled={locked}
          mixed={t('designerMixed')}
          onCommit={next => apply({ layout: { [key]: next } })}
        />
        <DesignerPopover
          key={`${owner}:${key}:token`}
          label={`${label(key)} ${t('designerTokens')}`}
          closeLabel={t('designerDone')}
          panelClassName={css.tokenPanel}
          triggerClassName={binding ? css.boundToken : css.token}
          trigger={<DesignerIcon name="styles" />}
        >
          <select
            aria-label={`${label(key)} ${t('designerTokens')}`}
            value={binding ?? ''}
            disabled={locked}
            onChange={(event) => {
              const variableId = event.currentTarget.value
              if (!variableId) apply({ layout: { [key]: value } })
              else apply({ layout: { [key]: raw }, layoutBindings: { [key]: variableId } })
            }}
          >
            <option value="">{t('designerNone')}</option>
            {retained ? (
              <option value={binding} disabled>
                {resources.find(token => token.id === binding)?.name} ·{' '}
                {t('designerDormantLayoutOverride')}
              </option>
            ) : null}
            {eligible.map(token => (
              <option value={token.id} key={token.id}>
                {token.name} · {token.value}
              </option>
            ))}
          </select>
        </DesignerPopover>
        {ownership(key, () =>
          apply({
            layout: { [key]: raw },
            ...(binding ? { layoutBindings: { [key]: binding } } : {}),
          }),
        )}
        {dormant ? <span className={css.hint}>{t('designerDormantLayoutOverride')}</span> : null}
      </div>
    )
  }
  const select = <K extends Exclude<LayoutKey, NumberKey>>(
    key: K,
    value: NonNullable<CopyOSDesignInstanceLayout[K]>,
    options: readonly (readonly [
      NonNullable<CopyOSDesignInstanceLayout[K]>,
      CopyOSFoundationLocaleKey,
    ])[],
  ): ReactNode => (
    <div className={css.setting} key={key}>
      <label>
        <span>{label(key)}</span>
        <select
          disabled={locked}
          aria-label={label(key)}
          value={value}
          onChange={(event) => {
            const option = options.find(([choice]) => choice === event.currentTarget.value)
            if (!option) return
            const value = event.currentTarget.value
            const targets = [{ nodeId: instanceId, path }]
            if (stack && key === 'justifyContent' &&
              (value === 'start' || value === 'center' || value === 'end' ||
                value === 'between' || value === 'around' || value === 'evenly')) {
              setLayoutAlignment(targets, { type: 'distribution', value })
            } else if (stack && key === 'alignItems' && value === 'baseline') {
              setLayoutAlignment(targets, { type: 'baseline', enabled: true })
            } else if (stack && key === 'alignItems' && (value === 'start' || value === 'center' || value === 'end')) {
              setLayoutAlignment(targets, node.layout === 'row'
                ? { type: 'spatial', vertical: value } : { type: 'spatial', horizontal: value })
            } else apply({ layout: { [key]: option[0] } })
          }}
        >
          {!options.some(([choice]) => choice === value) ? (
            <option value={value} disabled>
              {t(
                key === 'alignItems' && value === 'baseline'
                  ? 'designerTextBaseline'
                  : 'designerMixed',
              )}{' '}
              · {t('designerDormantLayoutOverride')}
            </option>
          ) : null}
          {options.map(([choice, text]) => (
            <option value={choice} key={choice}>
              {t(text)}
            </option>
          ))}
        </select>
      </label>
      {ownership(key, () => apply({ layout: { [key]: value } }))}
    </div>
  )
  const visibleKeys = new Set<LayoutKey>(
    current.active
      ? [
        'gap',
        'padding',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        ...(grid || node.layoutWrap === 'wrap' ? (['crossGap'] as const) : []),
        ...(stack ? (['layout', 'alignItems', 'justifyContent', 'layoutWrap'] as const) : []),
        ...(stack && node.layoutWrap === 'wrap' ? (['alignContent'] as const) : []),
      ]
      : [],
  )
  const locals = DESIGN_INSTANCE_LAYOUT_KEYS.filter(own)
  if (!current.active && !locals.length) return null
  return (
    <section className={css.section} aria-label={t('designerInstanceLayoutOverrides')}>
      <h4>{t('designerInstanceLayoutOverrides')}</h4>
      {current.active ? (
        <>
          {stack
            ? select('layout', node.layout === 'column' ? 'column' : 'row', [
              ['row', 'designerHorizontal'],
              ['column', 'designerVertical'],
            ])
            : null}
          {stack ? <div className={css.alignment}>
            <DesignerAutoLayoutAlignment key={`${owner}:alignment`} document={doc}
              targets={[{ nodeId: instanceId, path }]} t={t}
              onIntent={intent => setLayoutAlignment([{ nodeId: instanceId, path }], intent)} />
          </div> : null}
          <div className={css.numbers}>
            {numeric('gap')}
            {grid || node.layoutWrap === 'wrap' ? numeric('crossGap') : null}

          </div>
          <DesignerPadding key={`${owner}:padding`} document={doc} targets={[{ nodeId: instanceId, path }]}
            disabled={locked} t={t} onApply={setPadding}>
            <div className={css.numbers}>
              {numeric('padding')}
              {(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const).map(numeric)}
            </div>
          </DesignerPadding>
          {stack ? (
            <>
              {select('alignItems', node.alignItems ?? 'start', [
                ['start', 'designerStart'],
                ['center', 'designerCenter'],
                ['end', 'designerEnd'],
                ...(node.layout === 'row' ? [['baseline', 'designerTextBaseline'] as const] : []),
              ])}
              {select('justifyContent', node.justifyContent ?? 'start', [
                ['start', 'designerStart'],
                ['center', 'designerCenter'],
                ['end', 'designerEnd'],
                ['between', 'designerBetween'],
                ['around', 'designerAround'],
                ['evenly', 'designerEvenly'],
              ])}
              <div className={css.setting}>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    aria-label={t('designerWrap')}
                    checked={node.layoutWrap === 'wrap'}
                    disabled={locked}
                    onChange={(event) => {
                      apply({
                        layout: { layoutWrap: event.currentTarget.checked ? 'wrap' : 'none' },
                      })
                    }}
                  />
                  {t('designerWrap')}
                </label>
                {ownership('layoutWrap', () =>
                  apply({ layout: { layoutWrap: layout.layoutWrap ?? 'none' } }),
                )}
              </div>
              {node.layoutWrap === 'wrap'
                ? select('alignContent', node.alignContent ?? 'start', [
                  ['start', 'designerStart'],
                  ['center', 'designerCenter'],
                  ['end', 'designerEnd'],
                  ['between', 'designerBetween'],
                  ['stretch', 'designerStretch'],
                ])
                : null}
            </>
          ) : null}
        </>
      ) : (
        <p className={css.hint}>{t('designerDormantLayoutOverride')}</p>
      )}
      {locals
        .filter(key => !visibleKeys.has(key))
        .map(key => (
          <div className={css.setting} key={`dormant:${key}`}>
            <span>
              {label(key)} · {t('designerDormantLayoutOverride')}
            </span>
            <button
              type="button"
              disabled={locked}
              aria-label={`${t('designerInheritLayoutProperty')}: ${label(key)}`}
              onClick={() => {
                reset(key)
              }}
            >
              {t('designerInheritLayoutProperty')}
            </button>
          </div>
        ))}
      {locals.length ? (
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            apply({ layout: null })
          }}
        >
          {t('designerResetLayoutOverrides')}
        </button>
      ) : (
        <p className={css.hint}>{t('designerInheritedLayout')}</p>
      )}
    </section>
  )
}
