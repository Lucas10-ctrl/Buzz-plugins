/** Variant controls edit one native tuple table and switch concrete component instances atomically. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignVariantAxis,
  CopyOSDesignVariantValue,
} from '../../../copyos-domain/src/types.ts'
import {
  configureDesignComponentSet,
  designComponentSetDefault,
  designInstanceVariants,
  selectDesignVariants,
  formatDesignVariantName,
} from '../../../copyos-domain/src/design-model.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerVariants.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
type Commit = (document: CopyOSDesignDocument) => boolean | void

function InlineAxisName({
  value,
  disabled,
  t,
  onCommit,
  onCancel,
}: {
  value: string
  disabled: boolean
  t: Translate
  onCommit: (value: string) => boolean
  onCancel: () => void
}): ReactNode {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null),
    button = useRef<HTMLButtonElement>(null),
    settled = useRef(false),
    restore = useRef(false)
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    } else if (restore.current) {
      restore.current = false
      button.current?.focus()
    }
  }, [editing])
  const open = (): void => {
    settled.current = false
    setDraft(value)
    setInvalid(false)
    setEditing(true)
  }
  const finish = (): void => {
    if (settled.current) return
    const next = draft.trim()
    if (next !== value && !onCommit(next)) {
      setInvalid(true)
      return
    }
    settled.current = true
    restore.current = document.activeElement === input.current
    setEditing(false)
  }
  return editing ? (
    <input
      ref={input}
      className={css.axisNameInput}
      aria-label={`${t('designerVariantAxisName')}: ${value}`}
      value={draft}
      maxLength={120}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        setInvalid(false)
        setDraft(event.currentTarget.value)
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settled.current = true
          restore.current = true
          onCancel()
          setEditing(false)
        }
      }}
    />
  ) : (
    <button
      ref={button}
      type="button"
      className={css.axisName}
      disabled={disabled}
      aria-label={`${t('designerEditVariantAxis')}: ${value}`}
      title={value}
      onDoubleClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      {value}
    </button>
  )
}

function RenameVariantValue({
  values,
  t,
  onRename,
}: {
  values: readonly string[]
  t: Translate
  onRename: (oldValue: string, newValue: string) => boolean
}): ReactNode {
  const [selected, setSelected] = useState(values[0] ?? ''),
    [draft, setDraft] = useState(values[0] ?? ''),
    [error, setError] = useState(false)
  return (
    <div className={css.renameValue}>
      <label>
        {t('designerVariantAxisValues')}
        <select
          aria-label={t('designerVariantAxisValues')}
          value={selected}
          onChange={(event) => {
            setSelected(event.currentTarget.value)
            setDraft(event.currentTarget.value)
            setError(false)
          }}
        >
          {values.map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('designerVariantValueName')}
        <input
          aria-label={t('designerVariantValueName')}
          maxLength={120}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setError(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              setError(!onRename(selected, draft.trim()))
            }
          }}
        />
      </label>
      {error ? <p role="alert">{t('designerVariantInvalid')}</p> : null}
      <button
        type="button"
        onClick={() => {
          setError(!onRename(selected, draft.trim()))
        }}
      >
        {t('designerRename')}
      </button>
    </div>
  )
}

function VariantSetEditor({
  doc,
  set,
  t,
  save,
}: {
  doc: CopyOSDesignDocument
  set: CopyOSDesignNode
  t: Translate
  save: (
    axes: CopyOSDesignVariantAxis[],
    variants: { componentId: string; values: CopyOSDesignVariantValue[] }[],
  ) => boolean
}): ReactNode {
  const [axes, setAxes] = useState(() =>
    (set.componentSet?.axes ?? []).map(axis => ({
      ...axis,
      values: axis.values.join('\n'),
    })),
  )
  const members = doc.nodes.filter(
    node => node.parentId === set.id && node.kind === 'component',
  )
  const [variants, setVariants] = useState(() =>
    members.map(node => ({
      componentId: node.id,
      values: node.variantValues ?? [],
    })),
  )
  const [error, setError] = useState(false),
    [limit, setLimit] = useState(50),
    [renameGeneration, setRenameGeneration] = useState(0)
  const renameFocus = useRef<string | null>(null),
    editor = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    if (!renameFocus.current) return
    editor.current
      ?.querySelector<HTMLButtonElement>(
        `[data-variant-value-rename="${renameFocus.current}"] button`,
      )
      ?.focus()
    renameFocus.current = null
  }, [renameGeneration])
  const values = (raw: string): string[] =>
    raw
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean)
  const editAxis = (
    id: string,
    patch: { name?: string; values?: string },
  ): void => {
    setAxes(current =>
      current.map(axis => (axis.id === id ? { ...axis, ...patch } : axis)),
    )
    if (patch.values !== undefined) {
      const nextValues = values(patch.values)
      const previous = values(axes.find(axis => axis.id === id)?.values ?? '')
      if (nextValues.length === 1 && previous.length <= 1)
        setVariants(current =>
          current.map(variant => ({
            ...variant,
            values: variant.values.map(value =>
              value.axisId === id &&
              (!value.value || value.value === previous[0])
                ? { ...value, value: nextValues[0] ?? '' }
                : value,
            ),
          })),
        )
    }
    setError(false)
  }
  return (
    <form
      className={css.editor}
      ref={editor}
      onSubmit={(event) => {
        event.preventDefault()
        const nextAxes = axes.map(axis => ({
          ...axis,
          name: axis.name.trim(),
          values: values(axis.values),
        }))
        try {
          if (!save(nextAxes, variants)) setError(true)
        } catch (error) {
          if (!(error instanceof Error)) throw error
          setError(true)
        }
      }}
    >
      {axes.map((axis, index) => (
        <div className={css.axisEditor} key={axis.id}>
          <div className={css.axisActions}>
            <Tooltip label={`${t('designerMoveVariantAxisUp')}: ${axis.name}`}>
              <span>
                <button
                  type="button"
                  className={css.up}
                  disabled={index === 0}
                  aria-label={`${t('designerMoveVariantAxisUp')}: ${axis.name}`}
                  onClick={() => {
                    setAxes((current) => {
                      const next = [...current]
                      const previous = next[index - 1]
                      if (previous) {
                        next[index - 1] = axis
                        next[index] = previous
                      }
                      return next
                    })
                    setError(false)
                  }}
                >
                  <DesignerIcon name="down" />
                </button>
              </span>
            </Tooltip>
            <Tooltip
              label={`${t('designerMoveVariantAxisDown')}: ${axis.name}`}
            >
              <span>
                <button
                  type="button"
                  disabled={index === axes.length - 1}
                  aria-label={`${t('designerMoveVariantAxisDown')}: ${axis.name}`}
                  onClick={() => {
                    setAxes((current) => {
                      const next = [...current]
                      const following = next[index + 1]
                      if (following) {
                        next[index + 1] = axis
                        next[index] = following
                      }
                      return next
                    })
                    setError(false)
                  }}
                >
                  <DesignerIcon name="down" />
                </button>
              </span>
            </Tooltip>
          </div>
          <label>
            {t('designerVariantAxisName')}
            <input
              aria-label={`${t('designerVariantAxisName')} ${index + 1}`}
              maxLength={120}
              value={axis.name}
              onChange={(event) => {
                editAxis(axis.id, { name: event.currentTarget.value })
              }}
            />
          </label>
          <label>
            {t('designerVariantAxisValues')}
            <textarea
              aria-label={`${t('designerVariantAxisValues')} ${index + 1}`}
              rows={2}
              value={axis.values}
              onChange={(event) => {
                editAxis(axis.id, { values: event.currentTarget.value })
              }}
            />
          </label>
          <small>{t('designerVariantValuesHint')}</small>
          <div data-variant-value-rename={axis.id}>
            <DesignerPopover
              key={`${axis.id}:${renameGeneration}`}
              label={`${t('designerRenameVariantValue')}: ${axis.name}`}
              closeLabel={t('designerDone')}
              trigger={t('designerRenameVariantValue')}
              panelClassName={css.renamePanel}
            >
              <RenameVariantValue
                values={values(axis.values)}
                t={t}
                onRename={(oldValue, newValue) => {
                  const previous = values(axis.values)
                  if (
                    !newValue ||
                    newValue.length > 120 ||
                    !previous.includes(oldValue) ||
                    (newValue !== oldValue && previous.includes(newValue))
                  )
                    return false
                  setAxes(current =>
                    current.map(row =>
                      row.id === axis.id
                        ? {
                          ...row,
                          values: previous
                            .map(value =>
                              value === oldValue ? newValue : value,
                            )
                            .join('\n'),
                        }
                        : row,
                    ),
                  )
                  setVariants(current =>
                    current.map(variant => ({
                      ...variant,
                      values: variant.values.map(value =>
                        value.axisId === axis.id && value.value === oldValue
                          ? { ...value, value: newValue }
                          : value,
                      ),
                    })),
                  )
                  renameFocus.current = axis.id
                  setRenameGeneration(value => value + 1)
                  setError(false)
                  return true
                }}
              />
            </DesignerPopover>
          </div>
          <button
            type="button"
            disabled={axes.length <= 1}
            aria-label={`${t('designerDelete')}: ${axis.name}`}
            onClick={() => {
              setAxes(current => current.filter(value => value.id !== axis.id))
              setVariants(current =>
                current.map(variant => ({
                  ...variant,
                  values: variant.values.filter(
                    value => value.axisId !== axis.id,
                  ),
                })),
              )
              setError(false)
            }}
          >
            <DesignerIcon name="minus" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={axes.length >= 20}
        onClick={() => {
          const id = randomUUID()
          setAxes(current => [...current, { id, name: '', values: '' }])
          setVariants(current =>
            current.map(variant => ({
              ...variant,
              values: [...variant.values, { axisId: id, value: '' }],
            })),
          )
        }}
      >
        {t('designerAddVariantAxis')}
      </button>
      <div className={css.tuples}>
        {variants.slice(0, limit).map(variant => (
          <fieldset key={variant.componentId}>
            <legend
              title={
                members.find(node => node.id === variant.componentId)?.name
              }
            >
              {members.find(node => node.id === variant.componentId)?.name}
            </legend>
            {axes.map((axis) => {
              const options = values(axis.values),
                value =
                  variant.values.find(value => value.axisId === axis.id)
                    ?.value ?? ''
              return (
                <label key={axis.id}>
                  <span>{axis.name || t('designerVariantAxisName')}</span>
                  <select
                    aria-label={`${members.find(node => node.id === variant.componentId)?.name ?? ''} · ${axis.name || t('designerVariantAxisName')}`}
                    value={value}
                    onChange={(event) => {
                      const next = event.currentTarget.value
                      setVariants(current =>
                        current.map(row =>
                          row.componentId === variant.componentId
                            ? {
                              ...row,
                              values: row.values.map(value =>
                                value.axisId === axis.id
                                  ? { ...value, value: next }
                                  : value,
                              ),
                            }
                            : row,
                        ),
                      )
                      setError(false)
                    }}
                  >
                    {!options.includes(value) ? (
                      <option value={value} disabled>
                        {value || t('designerVariantUnavailable')}
                      </option>
                    ) : null}
                    {options.map((value, index) => (
                      <option key={`${value}:${index}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      {variants.length > limit ? (
        <button
          type="button"
          onClick={() => {
            setLimit(current => current + 50)
          }}
        >
          {t('designerMoreInstanceLayers').replace(
            '{count}',
            String(Math.min(50, variants.length - limit)),
          )}
        </button>
      ) : null}
      {error ? <p role="alert">{t('designerVariantInvalid')}</p> : null}
      <button type="submit" className={css.save}>
        {t('designerSave')}
      </button>
    </form>
  )
}

/** Expose source variant tuples before named component values in the contextual inspector.
 * @param props - Selected effective nodes, native document, localized labels and history-owned actions.
 * @returns A compact source editor or common instance axis selectors; missing tuples stay unavailable.
 */
export function DesignerVariants({
  doc,
  items,
  t,
  commit,
  combineVariants,
  addVariant,
  dissolveVariants,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: Translate
  commit: Commit
  combineVariants?: (() => boolean | void) | undefined
  addVariant?: ((sourceId: string) => boolean | void) | undefined
  dissolveVariants?: (() => boolean | void) | undefined
}): ReactNode {
  const [generation, setGeneration] = useState(0),
    [error, setError] = useState(false)
  const anchor = useRef<HTMLElement>(null),
    restore = useRef(false)
  useLayoutEffect(() => {
    if (!restore.current) return
    restore.current = false
    anchor.current
      ?.querySelector<HTMLButtonElement>('[data-variant-configure] button')
      ?.focus()
  }, [generation])
  const stored = items.map(
    item => doc.nodes.find(node => node.id === item.id) ?? item,
  )
  const first = stored[0]
  const parent = first?.parentId
    ? doc.nodes.find(
      node => node.id === first.parentId && node.kind === 'component-set',
    )
    : undefined
  const set =
    stored.length === 1 && first?.kind === 'component-set'
      ? first
      : stored.every(
        node => node.kind === 'component' && node.parentId === parent?.id,
      )
        ? parent
        : undefined
  const members = set
    ? doc.nodes.filter(
      node => node.parentId === set.id && node.kind === 'component',
    )
    : []
  const disabled =
    items.some(node => node.locked) ||
    stored.some(node => node.locked) ||
    !!set?.locked
  const samePage = (node: CopyOSDesignNode): string | undefined =>
    node.pageId ?? doc.pages?.[0]?.id
  const canCombine =
    stored.length >= 2 &&
    stored.every(
      node =>
        node.kind === 'component' &&
        (node.parentId ?? null) === (first?.parentId ?? null) &&
        samePage(node) === (first && samePage(first)),
    ) &&
    !parent
  const instanceRows =
    stored.length && stored.every(node => node.kind === 'instance')
      ? stored.flatMap((node) => {
        const context = designInstanceVariants(doc, node.id)
        return context ? [{ node, context }] : []
      })
      : []
  const instanceAxes =
    instanceRows.length === stored.length
      ? (instanceRows[0]?.context.axes.flatMap((axis) => {
        const matches = instanceRows.map(row => ({
          ...row,
          axis: row.context.axes.find(value => value.name === axis.name),
        }))
        return matches.every(row => row.axis) ? [{ axis, matches }] : []
      }) ?? [])
      : []
  const firstContext = instanceRows[0]?.context
  const contextAxes = new Map(
    instanceRows.map(row => [row.context.set.id, row.context.axes]),
  )
  const tupleKeys = new Map<string, Set<string>>()
  for (const node of doc.nodes) {
    const axes = node.parentId ? contextAxes.get(node.parentId) : undefined
    if (node.kind !== 'component' || !node.parentId || !axes || !firstContext)
      continue
    const byName = new Map(
      axes.map(axis => [
        axis.name,
        node.variantValues?.find(value => value.axisId === axis.id)?.value ??
          '',
      ]),
    )
    const key = JSON.stringify(
      firstContext.axes.map(axis => byName.get(axis.name)),
    )
    const keys = tupleKeys.get(node.parentId) ?? new Set<string>()
    keys.add(key)
    tupleKeys.set(node.parentId, keys)
  }
  const wholeVariants =
    firstContext &&
    instanceRows.length === stored.length &&
    instanceRows.every(
      row =>
        row.context.axes.length === firstContext.axes.length &&
        row.context.axes.every(axis =>
          firstContext.axes.some(first => first.name === axis.name),
        ),
    )
      ? doc.nodes
        .filter(
          node =>
            node.kind === 'component' &&
              node.parentId === firstContext.set.id,
        )
        .flatMap((component) => {
          const named = firstContext.axes.map(axis => ({
            name: axis.name,
            value:
                component.variantValues?.find(value => value.axisId === axis.id)
                  ?.value ?? '',
          }))
          const selections = instanceRows.flatMap((row) => {
            const values = row.context.axes.map(axis => ({
              axisId: axis.id,
              value:
                  named.find(value => value.name === axis.name)?.value ?? '',
            }))
            const exists =
              tupleKeys
                .get(row.context.set.id)
                ?.has(JSON.stringify(named.map(value => value.value))) ??
                false
            return exists ? [{ nodeId: row.node.id, values }] : []
          })
          return selections.length === instanceRows.length
            ? [
              {
                component,
                selections,
                label: formatDesignVariantName(
                  firstContext.axes,
                  component.variantValues ?? [],
                ),
              },
            ]
            : []
        })
      : []
  const wholeCurrent = wholeVariants.find(choice =>
    choice.selections.every(selection =>
      instanceRows
        .find(row => row.node.id === selection.nodeId)
        ?.context.axes.every(axis =>
          selection.values.some(
            value => value.axisId === axis.id && value.value === axis.value,
          ),
        ),
    ),
  )
  const action = (operation: () => boolean | void): void => {
    try {
      setError(operation() === false)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setError(true)
    }
  }
  const configure = (
    axes: CopyOSDesignVariantAxis[],
    variants: { componentId: string; values: CopyOSDesignVariantValue[] }[],
  ): boolean => {
    if (!set || disabled || members.some(node => node.locked)) return false
    const next = configureDesignComponentSet(doc, set.id, { axes, variants })
    if (commit(next) === false) return false
    restore.current = true
    setGeneration(value => value + 1)
    setError(false)
    return true
  }
  if (
    !canCombine &&
    !set &&
    !instanceRows.length &&
    !(stored.length === 1 && first?.kind === 'component' && addVariant)
  )
    return null
  const defaultVariant = set
    ? designComponentSetDefault(doc, set.id)
    : undefined
  return (
    <section
      ref={anchor}
      className={css.section}
      aria-label={t('designerVariants')}
    >
      <header>
        <h3>{t('designerVariants')}</h3>
        {set ? (
          <div data-variant-configure>
            {disabled || members.some(node => node.locked) ? (
              <button
                type="button"
                disabled
                aria-label={t('designerEditVariantAxis')}
              >
                <DesignerIcon name="settings" />
              </button>
            ) : (
              <DesignerPopover
                key={`${set.id}:${generation}`}
                label={t('designerEditVariantAxis')}
                closeLabel={t('designerDone')}
                trigger={<DesignerIcon name="settings" />}
                triggerClassName={css.icon}
                panelClassName={css.panel}
              >
                <VariantSetEditor doc={doc} set={set} t={t} save={configure} />
              </DesignerPopover>
            )}
          </div>
        ) : null}
      </header>
      {canCombine && combineVariants ? (
        <button
          type="button"
          disabled={disabled}
          className={css.wide}
          onClick={() => {
            action(combineVariants)
          }}
        >
          {t('designerCombineVariants')}
        </button>
      ) : null}
      {set && first?.kind === 'component-set' ? (
        <>
          {set.componentSet?.axes.map(axis => (
            <div className={css.axis} key={axis.id}>
              <InlineAxisName
                value={axis.name}
                onCancel={() => {
                  setError(false)
                }}
                disabled={disabled || members.some(node => node.locked)}
                t={t}
                onCommit={(name) => {
                  try {
                    const next = configureDesignComponentSet(doc, set.id, {
                      axes: (set.componentSet?.axes ?? []).map(old =>
                        old.id === axis.id ? { ...old, name } : old,
                      ),
                      variants: members.map(member => ({
                        componentId: member.id,
                        values: member.variantValues ?? [],
                      })),
                    })
                    if (commit(next) === false) {
                      setError(true)
                      return false
                    }
                    setError(false)
                    return true
                  } catch (error) {
                    if (!(error instanceof Error)) throw error
                    setError(true)
                    return false
                  }
                }}
              />
              <span title={axis.values.join(', ')}>
                {axis.values.join(', ')}
              </span>
            </div>
          ))}
          <div className={css.axis}>
            <span>{t('designerDefaultVariant')}</span>
            <span title={defaultVariant?.name}>{defaultVariant?.name}</span>
          </div>
          <p className={css.hint}>{t('designerVariantDefaultHint')}</p>
        </>
      ) : null}
      {set && stored.every(node => node.kind === 'component')
        ? set.componentSet?.axes.map((axis) => {
          const values = stored.map(
            node =>
              node.variantValues?.find(value => value.axisId === axis.id)
                ?.value ?? '',
          )
          const mixed = !values.every(value => value === values[0])
          return (
            <label className={css.axis} key={axis.id}>
              <span>{axis.name}</span>
              <select
                aria-label={axis.name}
                disabled={disabled}
                value={mixed ? '' : values[0]}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  action(() =>
                    commit(
                      configureDesignComponentSet(doc, set.id, {
                        axes: set.componentSet?.axes ?? [],
                        variants: members.map(member => ({
                          componentId: member.id,
                          values: (member.variantValues ?? []).map(old =>
                            stored.some(node => node.id === member.id) &&
                              old.axisId === axis.id
                              ? { ...old, value }
                              : old,
                          ),
                        })),
                      }),
                    ),
                  )
                }}
              >
                {mixed ? (
                  <option value="" disabled>
                    {t('designerMixed')}
                  </option>
                ) : null}
                {axis.values.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )
        })
        : null}
      {wholeVariants.length ? (
        <label className={css.axis}>
          <span>{t('designerAvailableVariants')}</span>
          <select
            aria-label={t('designerAvailableVariants')}
            disabled={disabled}
            value={wholeCurrent?.component.id ?? ''}
            onChange={(event) => {
              const choice = wholeVariants.find(
                choice => choice.component.id === event.currentTarget.value,
              )
              if (choice)
                action(() =>
                  commit(selectDesignVariants(doc, choice.selections)),
                )
            }}
          >
            {!wholeCurrent ? (
              <option value="" disabled>
                {t('designerMixed')}
              </option>
            ) : null}
            {wholeVariants.map(choice => (
              <option key={choice.component.id} value={choice.component.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {instanceAxes.map(({ axis, matches }) => {
        const mixed = !matches.every(row => row.axis?.value === axis.value)
        const values = [
          ...new Set(matches.flatMap(row => row.axis?.values ?? [])),
        ]
        return (
          <label className={css.axis} key={axis.id}>
            <span>{axis.name}</span>
            <select
              aria-label={axis.name}
              disabled={disabled}
              value={mixed ? '' : axis.value}
              onChange={(event) => {
                const value = event.currentTarget.value
                action(() =>
                  commit(
                    selectDesignVariants(
                      doc,
                      matches.flatMap(row =>
                        row.axis
                          ? [
                            {
                              nodeId: row.node.id,
                              values: [{ axisId: row.axis.id, value }],
                            },
                          ]
                          : [],
                      ),
                    ),
                  ),
                )
              }}
            >
              {mixed ? (
                <option value="" disabled>
                  {t('designerMixed')}
                </option>
              ) : null}
              {values.map(value => (
                <option
                  key={value}
                  value={value}
                  disabled={
                    !matches.every(row =>
                      row.axis?.options.some(
                        option => option.value === value && option.available,
                      ),
                    )
                  }
                >
                  {value}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      {instanceRows.length && !instanceAxes.length ? (
        <p className={css.hint}>{t('designerNoCommonVariants')}</p>
      ) : null}
      {addVariant &&
      (defaultVariant ||
        (stored.length === 1 && first?.kind === 'component')) ? (
          <button
            type="button"
            disabled={disabled || members.some(node => node.locked)}
            className={css.wide}
            onClick={() => {
              const sourceId =
                first?.kind === 'component' ? first.id : defaultVariant?.id
              if (sourceId) action(() => addVariant(sourceId))
            }}
          >
            {t('designerAddVariant')}
          </button>
        ) : null}
      {first?.kind === 'component-set' && dissolveVariants ? (
        <button
          type="button"
          disabled={disabled || members.some(node => node.locked)}
          className={css.wide}
          onClick={() => {
            action(dissolveVariants)
          }}
        >
          {t('designerDissolveVariants')}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className={css.hint}>
          {t('designerVariantInvalid')}
        </p>
      ) : null}
    </section>
  )
}
