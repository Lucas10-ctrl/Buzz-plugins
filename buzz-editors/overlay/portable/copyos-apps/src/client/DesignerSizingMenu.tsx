/** Axis sizing policies and optional limits share immutable preview and linked ownership semantics. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  designSizingContext,
  designAspectRatioContext,
  setDesignSizingPolicy,
  clearDesignSizingLimits,
  editDesignNodes,
  resetDesignInstanceSizing,
  designInstanceSizingOwns,
  designModeResources,
  resolveDesignNumberVariables,
  designNumberTokenSupportsProperty,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerSizingMenu.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
type Bound = 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'
const labels: Record<Bound, CopyOSFoundationLocaleKey> = {
  minWidth: 'designerMinWidth',
  maxWidth: 'designerMaxWidth',
  minHeight: 'designerMinHeight',
  maxHeight: 'designerMaxHeight',
}
/** Render one axis policy picker, optional cap editors and precise local/source ownership actions.
 * @param props - Selected ordinary or root-instance owners and atomic history/preview callbacks.
 * @returns A compact anchored axis menu; rejected candidates retain the authored values.
 */
export function DesignerSizingMenu({
  doc,
  items,
  axis,
  t,
  commit,
  preview,
  cancelPreview,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  axis: 'width' | 'height'
  t: Translate
  commit: (next: CopyOSDesignDocument) => boolean | void
  preview: (next: CopyOSDesignDocument) => void
  cancelPreview: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const boundElements = useRef<Partial<Record<Bound, HTMLDivElement | null>>>({})
  const nextLimitFocus = useRef<{ key: Bound; add: boolean } | null>(null)
  useLayoutEffect(() => {
    const next = nextLimitFocus.current
    if (!next) return
    nextLimitFocus.current = null
    boundElements.current[next.key]
      ?.querySelector<HTMLElement>(next.add ? '[data-designer-add-limit]' : 'input')?.focus()
  }, [doc])
  const origin = useRef<CopyOSDesignDocument | null>(null)
  const cancel = (): void => {
    if (origin.current) {
      origin.current = null
      cancelPreview()
    }
  }
  useEffect(
    () => () => {
      if (origin.current) cancelPreview()
    },
    [],
  )
  const displayed = origin.current ?? doc
  const scene = useMemo(() => createDesignRenderScene(displayed), [displayed])
  const contexts = items
    .map(item => designSizingContext(displayed, item.id, scene))
    .filter(context => !!context)
  const locked =
    contexts.length !== items.length ||
    !contexts.length ||
    contexts.some(context => context.locked) ||
    items.some(item => item.locked)
  const ids = items.map(item => item.id),
    owner = `${doc.id}:${ids.join(',')}:${axis}`
  const first = contexts[0],
    policy =
      first && contexts.every(context => context.axis[axis].policy === first.axis[axis].policy)
        ? first.axis[axis].policy
        : null
  const title = t(axis === 'width' ? 'designerWidthSizing' : 'designerHeightSizing')
  const policies = [
    { value: 'fixed', labelKey: 'designerFixed', enabled: !locked },
    {
      value: 'hug',
      labelKey: 'designerHug',
      enabled: !locked && contexts.every(context => context.axis[axis].canHug),
    },
    {
      value: 'fill',
      labelKey: 'designerFillContainer',
      enabled: !locked && contexts.every(context => context.axis[axis].canFill),
    },
  ] as const
  const accept = (next: CopyOSDesignDocument): boolean | void => {
    const hadPreview = !!origin.current
    origin.current = null
    const result = commit(next)
    if (result === false && hadPreview) cancelPreview()
    return result
  }
  const editPolicy = (value: 'fixed' | 'hug' | 'fill', transient = false): void => {
    if (locked) return
    const base = origin.current ?? doc
    if (transient) {
      origin.current ??= doc
      preview(setDesignSizingPolicy(base, ids, axis, value))
    } else {
      if (accept(setDesignSizingPolicy(base, ids, axis, value)) !== false) setOpen(false)
    }
  }
  const updateBound = (key: Bound, value: number | undefined, binding?: string): boolean | void => {
    if (locked) return false
    const base = origin.current ?? doc
    return accept(
      editDesignNodes(
        base,
        contexts.map((context) => {
          const stored = base.nodes.find(node => node.id === context.stored.id) ?? context.stored
          const bindings = Object.fromEntries(
            Object.entries(stored.numericBindings ?? {}).filter(([property]) => property !== key),
          )
          if (binding) bindings[key] = binding
          const rawOwner =
            stored.kind === 'instance' && !designInstanceSizingOwns(stored, key) ? context.source : stored
          return {
            id: stored.id,
            [key]: binding ? (rawOwner?.[key] ?? value) : value,
            numericBindings: bindings,
          }
        }),
      ),
    )
  }
  const bounds = (axis === 'width' ? ['minWidth', 'maxWidth'] : ['minHeight', 'maxHeight']) as Bound[]
  const hasLimits = contexts.some(context =>
    bounds.some(key => context.node[key] !== undefined || context.numericBindings[key] !== undefined))
  const linked = contexts.length > 0 && contexts.every(context => context.stored.kind === 'instance')
  return (
    <DesignerPopover
      key={owner}
      label={title}
      description={hasLimits ? t('designerSizingHasLimits') : undefined}
      open={open}
      onOpenChange={setOpen}
      closeLabel={t('designerDone')}
      triggerClassName={css.trigger}
      panelClassName={css.panel}
      trigger={
        <>
          <span className={hasLimits ? css.limitBadge : undefined}>
            {t(
              policy === 'hug'
                ? 'designerHugShort'
                : policy === 'fill'
                  ? 'designerFillShort'
                  : policy === 'fixed'
                    ? 'designerFixed'
                    : 'designerMixed',
            )}
          </span>
          <DesignerIcon name="down" />
        </>
      }
      onDismiss={cancel}
    >
      <div className={css.policies} role="group" aria-label={title} onMouseLeave={cancel}>
        {policies.map(option => (
          <button
            key={option.value}
            type="button"
            disabled={!option.enabled}
            aria-pressed={policy === option.value}
            onMouseEnter={() => {
              if (option.enabled) editPolicy(option.value, true)
            }}
            onFocus={() => {
              if (option.enabled) editPolicy(option.value, true)
            }}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              event.stopPropagation()
              const buttons = Array.from(
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ) ?? [],
              )
              const index = buttons.indexOf(event.currentTarget)
              buttons[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              ]?.focus()
            }}
            onClick={() => {
              editPolicy(option.value)
            }}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <section className={css.limits} aria-label={t('designerSizingLimits')}>
        {bounds.map((key) => {
          const minimum = key.startsWith('min'),
            values = contexts.map(context => context.node[key]),
            exists = values.some(value => value !== undefined)
          const aspectValues = contexts.map((context) => {
            const aspect = designAspectRatioContext(displayed, context.stored.id, scene)
            const pairedKey = minimum ? axis === 'width' ? 'minHeight' : 'minWidth' : axis === 'width' ? 'maxHeight' : 'maxWidth'
            return aspect?.effectiveRatio && aspect.eligible &&
              (context.node[key] !== undefined || context.node[pairedKey] !== undefined)
              ? aspect.effectiveLimits[key] : undefined
          })
          const effective = aspectValues.every(value => value === aspectValues[0]) ? aspectValues[0] : null
          const showEffective = aspectValues.some((value, index) => value !== undefined && value !== values[index])
          const value = values.every(value => value === values[0]) ? (values[0] ?? null) : null
          const local = contexts.some(context => designInstanceSizingOwns(context.stored, key))
          const mode = first ? (scene.root.modes.get(first.node.id) ?? null) : null
          const tokens = resolveDesignNumberVariables(
            designModeResources(displayed, mode).numberVariables,
          ).filter(token =>
            contexts.every(context =>
              designNumberTokenSupportsProperty(displayed, token.id, key, context.node),
            ),
          )
          const binding = first?.numericBindings[key]
          const sameBinding = contexts.every(context => context.numericBindings[key] === binding)
          return (
            <div className={css.bound} key={key} ref={(element) => { boundElements.current[key] = element }}>
              <div className={css.heading}>
                <span>{t(labels[key])}</span>
                {exists ? (
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={t(minimum ? 'designerRemoveMinimum' : 'designerRemoveMaximum')}
                    onClick={() => {
                      if (!locked && accept(clearDesignSizingLimits(origin.current ?? doc, ids, axis, [key])) !== false)
                        nextLimitFocus.current = { key, add: true }
                    }}
                  >
                    <DesignerIcon name="minus" />
                  </button>
                ) : null}
                {linked ? (
                  <button
                    type="button"
                    disabled={locked || !local}
                    aria-label={`${t('designerInheritLayoutProperty')}: ${t(labels[key])}`}
                    onClick={() => {
                      let next = origin.current ?? doc
                      for (const id of ids) next = resetDesignInstanceSizing(next, id, [key])
                      accept(next)
                    }}
                  >
                    <DesignerIcon name="undo" />
                  </button>
                ) : null}
              </div>
              {showEffective ? <small className={css.effective} aria-label={`${t('designerEffectiveSizingLimit')}: ${t(labels[key])}`}>
                {t('designerEffectiveSizingLimit')}: {effective === null ? t('designerMixed') : effective === undefined ? t('designerNone') : Number(effective.toFixed(3))}
              </small> : null}
              {exists ? (
                <DesignerNumberField
                  key={`${owner}:${key}`}
                  label={t(labels[key])}
                  short={minimum ? '≥' : '≤'}
                  value={value}
                  min={minimum ? 0 : 1}
                  max={100000}
                  mixed={t('designerMixed')}
                  disabled={locked}
                  commitUnchanged={linked}
                  onCommit={next => updateBound(key, next)}
                />
              ) : (
                <button
                  type="button"
                  data-designer-add-limit={key}
                  disabled={locked}
                  onClick={() => {
                    if (locked) return
                    const base = origin.current ?? doc
                    const modes = [null, ...(base.tokenModes ?? []).map(mode => mode.id)]
                    const modeNumbers = modes.map(
                      mode =>
                        new Map(
                          resolveDesignNumberVariables(designModeResources(base, mode).numberVariables).map(
                            token => [token.id, token.value],
                          ),
                        ),
                    )
                    const accepted = accept(
                      editDesignNodes(
                        base,
                        contexts.map((context) => {
                          const oppositeKey = minimum
                            ? axis === 'width'
                              ? 'maxWidth'
                              : 'maxHeight'
                            : axis === 'width'
                              ? 'minWidth'
                              : 'minHeight'
                          const binding = context.numericBindings[oppositeKey]
                          const oppositeValues = binding
                            ? modeNumbers
                              .map(numbers => numbers.get(binding))
                              .filter(value => value !== undefined)
                            : context.node[oppositeKey] === undefined
                              ? []
                              : [context.node[oppositeKey]]
                          const value = minimum
                            ? Math.min(context.node[axis], ...oppositeValues)
                            : Math.max(context.node[axis], ...oppositeValues)
                          return { id: context.stored.id, [key]: value }
                        }),
                      ),
                    )
                    if (accepted !== false) nextLimitFocus.current = { key, add: false }
                  }}
                >
                  {t(minimum ? 'designerAddMinimum' : 'designerAddMaximum')}
                </button>
              )}
              <select
                aria-label={`${t(labels[key])} ${t('designerTokens')}`}
                disabled={locked}
                value={sameBinding ? (binding ?? '') : 'mixed'}
                onChange={(event) => {
                  const reference = event.currentTarget.value
                  if (!reference) {
                    const base = origin.current ?? doc
                    accept(
                      editDesignNodes(
                        base,
                        contexts.map((context) => {
                          const bindings = Object.fromEntries(
                            Object.entries(context.stored.numericBindings ?? {}).filter(
                              ([property]) => property !== key,
                            ),
                          )
                          return {
                            id: context.stored.id,
                            [key]: context.node[key],
                            numericBindings: bindings,
                          }
                        }),
                      ),
                    )
                  } else {
                    const token = tokens.find(item => item.id === reference)
                    if (token) updateBound(key, value ?? token.value, reference)
                  }
                }}
              >
                <option value="">{t('designerNone')}</option>
                <option value="mixed" hidden disabled>
                  {t('designerMixed')}
                </option>
                {binding && !tokens.some(token => token.id === binding) ? (
                  <option value={binding} disabled>
                    {t('designerInheritedSizing')}
                  </option>
                ) : null}
                {tokens.map(token => (
                  <option key={token.id} value={token.id}>
                    {token.name} · {token.value}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </section>
    </DesignerPopover>
  )
}
