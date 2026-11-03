/** Named text and visibility properties share native component operations with canvas edits. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignComponentProperty,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignComponentProperty,
  editDesignComponentProperty,
  removeDesignComponentProperty,
  setDesignComponentPropertyValue,
  resetDesignComponentPropertyValue,
  designComponentPropertyTargets,
  designComponentPropertyValues,
  designComponentPropertyDefinitions,
  designComponentPropertyOwner,
  designComponentPropertySwapCandidateSummary,
} from '../../../copyos-domain/src/design-model.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerComponentPicker } from './DesignerInstanceSwap.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerComponentProperties.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
type Commit = (document: CopyOSDesignDocument) => boolean | void

function fitPropertyText(field: HTMLTextAreaElement, showStart: boolean): void {
  field.style.height = 'auto'
  const style = getComputedStyle(field)
  const border =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0)
  field.style.height = `${Math.min(120, Math.max(24, field.scrollHeight + border))}px`
  if (showStart) field.scrollTop = 0
}

function TextValue({
  value,
  mixed,
  mixedLabel,
  label,
  id,
  disabled,
  onCommit,
}: {
  value: string
  mixed: boolean
  mixedLabel: string
  label: string
  id: string
  disabled: boolean
  onCommit: (value: string) => boolean | void
}): ReactNode {
  const [draft, setDraft] = useState(value),
    focused = useRef(false),
    edited = useRef(false),
    cancelled = useRef(false),
    field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (field.current) fitPropertyText(field.current, !focused.current)
  }, [draft, value, mixed])
  useLayoutEffect(() => {
    const element = field.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let width = element.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      fitPropertyText(element, !focused.current)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value, mixed])
  const finish = (): void => {
    if (!edited.current || cancelled.current) return
    edited.current = false
    if ((!mixed && draft === value) || onCommit(draft) !== false) return
    setDraft(value)
  }
  return (
    <textarea
      ref={field}
      id={id}
      rows={1}
      aria-label={label}
      disabled={disabled}
      value={draft}
      placeholder={mixed ? mixedLabel : undefined}
      maxLength={100000}
      onFocus={() => {
        focused.current = true
        edited.current = false
        cancelled.current = false
      }}
      onChange={(event) => {
        edited.current = true
        setDraft(event.currentTarget.value)
      }}
      onBlur={() => {
        focused.current = false
        if (!edited.current || cancelled.current) setDraft(value)
        else finish()
        cancelled.current = false
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') return
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelled.current = true
          edited.current = false
          setDraft(value)
          event.currentTarget.blur()
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          focused.current = false
          finish()
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}
function BooleanValue({
  value,
  mixed,
  label,
  id,
  disabled,
  onChange,
}: {
  value: boolean
  mixed: boolean
  label: string
  id: string
  disabled: boolean
  onChange: (value: boolean) => void
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = mixed
  }, [mixed])
  return (
    <input
      ref={input}
      id={id}
      type="checkbox"
      aria-label={label}
      aria-checked={mixed ? 'mixed' : value}
      disabled={disabled}
      checked={value}
      onChange={(event) => {
        onChange(event.currentTarget.checked)
      }}
    />
  )
}
function PropertyEditor({
  doc,
  component,
  property,
  t,
  save,
}: {
  doc: CopyOSDesignDocument
  component: CopyOSDesignNode
  property?: CopyOSDesignComponentProperty | undefined
  t: Translate
  save: (property: CopyOSDesignComponentProperty) => boolean | void
}): ReactNode {
  const [name, setName] = useState(property?.name ?? ''),
    [type, setType] = useState<CopyOSDesignComponentProperty['type']>(property?.type ?? 'text')
  const [defaultValue, setDefault] = useState<string | boolean>(property?.defaultValue ?? ''),
    [query, setQuery] = useState('')
  const defaultEdited = useRef(!!property)
  const propertyId = useRef(property?.id ?? randomUUID())
  const [preferred, setPreferred] = useState<string[]>(
    property?.type === 'instance-swap' ? (property.preferredValues ?? []) : [],
  )
  const [targets, setTargets] = useState(
    () => new Set(property?.targets.map(path => JSON.stringify(path)) ?? []),
  )
  const [error, setError] = useState(''),
    [limit, setLimit] = useState(200)
  const layers = useMemo(
    () => designComponentPropertyTargets(doc, component.id),
    [doc, component.id],
  )
  const compatible = layers.filter(
    row =>
      type === 'boolean' || row.node.kind === (type === 'instance-swap' ? 'instance' : 'text'),
  )
  const matching = compatible.filter(row =>
    row.names.join(' / ').toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  const applicable =
    component.kind === 'component-set'
      ? [
        ...(component.componentProperties ?? []),
        ...doc.nodes
          .filter(node => node.parentId === component.id)
          .flatMap(node =>
            (node.componentProperties ?? []).map(definition => ({
              ...definition,
              targets: definition.targets.map(path => [node.id, ...path]),
            })),
          ),
      ]
      : designComponentPropertyDefinitions(doc, component.id)
  const claimed = new Set(
    applicable
      .filter(def => def.id !== property?.id && def.type === type)
      .flatMap(def => def.targets.map(path => JSON.stringify(path))),
  )
  const submit = (): void => {
    const nextName = name.trim()
    if (
      !nextName ||
      (component.componentProperties ?? []).some(
        def => def.id !== property?.id && def.name === nextName,
      ) ||
      (type === 'instance-swap' && (typeof defaultValue !== 'string' || !defaultValue))
    ) {
      setError(t('designerPropertyInvalid'))
      return
    }
    const paths = compatible
      .filter(
        row => targets.has(JSON.stringify(row.path)) && !claimed.has(JSON.stringify(row.path)),
      )
      .map(row => row.path)
    const shared = {
      id: propertyId.current,
      name: nextName,
      targets: paths,
    }
    const definition: CopyOSDesignComponentProperty =
      type === 'text'
        ? {
          ...shared,
          type: 'text',
          defaultValue: typeof defaultValue === 'string' ? defaultValue : '',
        }
        : type === 'instance-swap'
          ? {
            ...shared,
            type: 'instance-swap',
            defaultValue: typeof defaultValue === 'string' ? defaultValue : '',
            preferredValues: preferred,
          }
          : {
            ...shared,
            type: 'boolean',
            defaultValue: typeof defaultValue === 'boolean' ? defaultValue : true,
          }
    try {
      if (save(definition) === false && property) {
        setName(property.name)
        setDefault(property.defaultValue)
        setTargets(new Set(property.targets.map(path => JSON.stringify(path))))
        setPreferred(property.type === 'instance-swap' ? (property.preferredValues ?? []) : [])
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setError(t('designerPropertyInvalid'))
    }
  }
  return (
    <form
      className={css.editor}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label>
        {t('designerPropertyName')}
        <input
          aria-label={t('designerPropertyName')}
          value={name}
          maxLength={120}
          onChange={(event) => {
            setName(event.currentTarget.value)
            setError('')
          }}
        />
      </label>
      <label>
        {t('designerPropertyType')}
        <select
          aria-label={t('designerPropertyType')}
          value={type}
          disabled={!!property}
          onChange={(event) => {
            const value =
              event.currentTarget.value === 'boolean'
                ? 'boolean'
                : event.currentTarget.value === 'instance-swap'
                  ? 'instance-swap'
                  : 'text'
            const nextTargets = new Set(
              [...targets].filter(
                path =>
                  value === 'boolean' ||
                  layers.some(
                    row =>
                      JSON.stringify(row.path) === path &&
                      row.node.kind === (value === 'instance-swap' ? 'instance' : 'text'),
                  ),
              ),
            )
            const first = layers.find(row => nextTargets.has(JSON.stringify(row.path)))
            setType(value)
            setDefault(
              value === 'boolean'
                ? (first?.node.visible ?? true)
                : value === 'instance-swap'
                  ? (first?.node.componentId ?? '')
                  : (first?.node.text ?? ''),
            )
            defaultEdited.current = false
            setTargets(nextTargets)
          }}
        >
          <option value="text">{t('designerPropertyText')}</option>
          <option value="boolean">{t('designerPropertyBoolean')}</option>
          <option value="instance-swap">{t('designerPropertyInstanceSwap')}</option>
        </select>
      </label>
      <div className={css.default}>
        <label className={css.defaultLabel}>
          {t('designerPropertyDefault')}
          {type === 'text' ? (
            <textarea
              aria-label={t('designerPropertyDefault')}
              rows={2}
              value={typeof defaultValue === 'string' ? defaultValue : ''}
              maxLength={100000}
              onChange={(event) => {
                defaultEdited.current = true
                setDefault(event.currentTarget.value)
              }}
            />
          ) : type === 'instance-swap' ? null : (
            <input
              type="checkbox"
              aria-label={t('designerPropertyDefault')}
              checked={!!defaultValue}
              onChange={(event) => {
                defaultEdited.current = true
                setDefault(event.currentTarget.checked)
              }}
            />
          )}
        </label>
        {type === 'instance-swap' ? (
          <DesignerComponentPicker
            doc={doc}
            label={t('designerPropertyDefault')}
            value={typeof defaultValue === 'string' ? [defaultValue] : []}
            t={t}
            candidatePage={options =>
              designComponentPropertySwapCandidateSummary(
                doc,
                component.id,
                {
                  id: propertyId.current,
                  name: name.trim() || t('designerPropertyInstanceSwap'),
                  type: 'instance-swap',
                  defaultValue: typeof defaultValue === 'string' ? defaultValue : '',
                  targets: compatible
                    .filter(row => targets.has(JSON.stringify(row.path)))
                    .map(row => row.path),
                  preferredValues: preferred,
                },
                undefined,
                options,
              )
            }
            preferred={preferred}
            onChange={(id) => {
              defaultEdited.current = true
              setDefault(id)
            }}
          />
        ) : null}
      </div>
      {type === 'instance-swap' ? (
        <div className={css.preferred}>
          <span>{t('designerPreferredComponents')}</span>
          <DesignerComponentPicker
            doc={doc}
            label={t('designerPreferredComponents')}
            searchLabel={t('designerFindPreferredComponent')}
            value={preferred}
            multiple
            t={t}
            candidates={() => doc.nodes.filter(node => node.kind === 'component')}
            onChange={(id) => {
              setPreferred(current =>
                current.includes(id)
                  ? current.filter(value => value !== id)
                  : current.length < 100
                    ? [...current, id]
                    : current,
              )
            }}
          />
        </div>
      ) : null}
      {component.kind === 'component-set' ? (
        <p className={css.hint}>{t('designerPropertySetTargetsHint')}</p>
      ) : null}
      <input
        type="search"
        aria-label={t('designerFindPropertyTarget')}
        placeholder={t('designerFindPropertyTarget')}
        value={query}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setLimit(200)
        }}
      />
      <div className={css.targetHeading}>
        <span>{t('designerPropertyTargets')}</span>
        <span>{t('designerPropertyTargetsCount').replace('{count}', String(targets.size))}</span>
      </div>
      <div role="group" aria-label={t('designerPropertyTargets')} className={css.targets}>
        {matching.slice(0, limit).map(({ path, names }) => {
          const key = JSON.stringify(path),
            label = names.join(' / ')
          return (
            <label key={key} title={label}>
              <input
                type="checkbox"
                aria-label={label}
                checked={targets.has(key)}
                disabled={claimed.has(key) || (!targets.has(key) && targets.size >= 100)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  if (checked && !defaultEdited.current && !targets.size) {
                    const layer = layers.find(row => JSON.stringify(row.path) === key)?.node
                    setDefault(
                      type === 'boolean'
                        ? (layer?.visible ?? true)
                        : type === 'instance-swap'
                          ? (layer?.componentId ?? '')
                          : (layer?.text ?? ''),
                    )
                  }
                  setTargets((current) => {
                    const next = new Set(current)
                    if (checked) next.add(key)
                    else next.delete(key)
                    return next
                  })
                  setError('')
                }}
              />
              <span>{label}</span>
            </label>
          )
        })}
        {!matching.length ? <p role="status">{t('designerNoPropertyTargets')}</p> : null}
      </div>
      {matching.length > limit ? (
        <button
          type="button"
          onClick={() => {
            setLimit(value => value + 200)
          }}
        >
          {t('designerMoreInstanceLayers').replace(
            '{count}',
            String(Math.min(200, matching.length - limit)),
          )}
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className={css.save}>
        {t('designerSave')}
      </button>
    </form>
  )
}

/** Edit native component definitions or the compatible named values shared by selected instances.
 * @param props - Stored scene, effective selected nodes, localized copy and the normal atomic commit.
 * @returns Compact named fields above geometry; source definition edits use a contained editor.
 */
export function DesignerComponentProperties({
  doc,
  items,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: Translate
  commit: Commit
}): ReactNode {
  const [generation, setGeneration] = useState(0),
    [error, setError] = useState('')
  const section = useRef<HTMLElement>(null),
    focus = useRef<string | null>(null)
  const stored = items.map(item => doc.nodes.find(node => node.id === item.id) ?? item)
  const component =
    stored.length === 1 && (stored[0]?.kind === 'component' || stored[0]?.kind === 'component-set')
      ? stored[0]
      : null
  const parentSet =
    component?.kind === 'component'
      ? doc.nodes.find(node => node.id === component.parentId && node.kind === 'component-set')
      : undefined
  const createOwner = parentSet ?? component
  const definitions = component
    ? designComponentPropertyDefinitions(doc, component.id).map((property) => {
      const owner = designComponentPropertyOwner(doc, property.id) ?? component
      return {
        property,
        owner,
        definition:
            owner.componentProperties?.find(item => item.id === property.id) ?? property,
      }
    })
    : []
  const selectionKey = stored
    .map(node => node.id)
    .sort()
    .join(':')
  useEffect(() => {
    setError('')
  }, [selectionKey])
  const instances = stored.length > 0 && stored.every(node => node.kind === 'instance')
  const disabled = items.some(node => node.locked) || stored.some(node => node.locked)
  const rows = useMemo(
    () =>
      instances
        ? stored.map(node => ({
          node,
          properties: designComponentPropertyValues(doc, node.id),
        }))
        : [],
    [doc, instances, items],
  )
  useLayoutEffect(() => {
    if (!focus.current) return
    const key = focus.current
    focus.current = null
    const wrapper =
      key === 'create'
        ? section.current?.querySelector('[data-property-create]')
        : section.current?.querySelector(`[data-property-editor="${key}"]`)
    wrapper?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [generation])
  if (!component && !instances) return null
  const finishDefinition = (
    property: CopyOSDesignComponentProperty,
    existing: boolean,
    owner = createOwner,
  ): boolean => {
    if (disabled || !owner || owner.locked) return false
    const next = existing
      ? editDesignComponentProperty(doc, owner.id, property.id, {
        name: property.name,
        defaultValue: property.defaultValue,
        targets: property.targets,
        ...(property.type === 'instance-swap'
          ? { preferredValues: property.preferredValues }
          : {}),
      })
      : createDesignComponentProperty(doc, owner.id, property)
    if (commit(next) === false) return false
    focus.current = existing ? property.id : 'create'
    setGeneration(value => value + 1)
    setError('')
    return true
  }
  const shared =
    rows[0]?.properties.flatMap((property) => {
      const matches = rows.map(row =>
        row.properties.some(candidate => candidate.id === property.id)
          ? row.properties.filter(candidate => candidate.id === property.id)
          : row.properties.filter(
            candidate => candidate.name === property.name && candidate.type === property.type,
          ),
      )
      if (!matches.every(values => values.length === 1)) return []
      const members = matches.flatMap((values, index) => {
        const node = rows[index]?.node,
          value = values[0]
        return node && value ? [{ node, property: value }] : []
      })
      return members.length === rows.length ? [{ property, members }] : []
    }) ?? []
  if (instances && !rows.some(row => row.properties.length)) return null
  const change = (
    members: (typeof shared)[number]['members'],
    value?: string | boolean,
  ): boolean => {
    if (disabled) return false
    try {
      let next = doc
      for (const member of members)
        next =
          value === undefined
            ? resetDesignComponentPropertyValue(next, member.node.id, member.property.id)
            : setDesignComponentPropertyValue(next, member.node.id, member.property.id, value)
      return next === doc || commit(next) !== false
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setError(t('designerPropertyInvalid'))
      return false
    }
  }
  return (
    <section
      key={selectionKey}
      ref={section}
      className={css.section}
      aria-label={t('designerProperties')}
    >
      <header>
        <h3>{t('designerProperties')}</h3>
        {component ? (
          <div data-property-create>
            {disabled ||
            createOwner?.locked ||
            (createOwner?.componentProperties?.length ?? 0) >= 100 ? (
                <Tooltip
                  label={
                    (createOwner?.componentProperties?.length ?? 0) >= 100
                      ? `${t('designerCreateProperty')} · ${createOwner?.componentProperties?.length ?? 0}/100`
                      : t('designerCreateProperty')
                  }
                >
                  <span>
                    <button type="button" disabled aria-label={t('designerCreateProperty')}>
                      <DesignerIcon name="plus" />
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <DesignerPopover
                  key={`create:${generation}:${createOwner?.id}` + selectionKey}
                  label={t('designerCreateProperty')}
                  closeLabel={t('designerDone')}
                  trigger={<DesignerIcon name="plus" />}
                  triggerClassName={css.icon}
                  panelClassName={css.panel}
                >
                  <PropertyEditor
                    doc={doc}
                    component={createOwner ?? component}
                    t={t}
                    save={property => finishDefinition(property, false)}
                  />
                </DesignerPopover>
              )}
          </div>
        ) : (
          <button
            type="button"
            disabled={
              disabled ||
              !rows.some(row => row.properties.some(property => property.overridden))
            }
            onClick={() => {
              change(
                rows.flatMap(row =>
                  row.properties.map(property => ({
                    node: row.node,
                    property,
                  })),
                ),
              )
            }}
          >
            {t('designerResetAllProperties')}
          </button>
        )}
      </header>
      {component ? (
        <>
          {definitions.map(({ property, owner, definition }) => (
            <div className={css.definition} key={property.id}>
              <span title={property.name}>
                {property.name}
                <small>
                  {t(
                    property.type === 'text'
                      ? 'designerPropertyText'
                      : property.type === 'instance-swap'
                        ? 'designerPropertyInstanceSwap'
                        : 'designerPropertyBoolean',
                  )}
                </small>
                <span className={css.scope}>
                  {owner.kind === 'component-set'
                    ? t('designerPropertySharedScope').replace('{name}', owner.name)
                    : t('designerPropertyLocalScope')}
                </span>
                {owner.kind === 'component-set' &&
                component.kind === 'component' &&
                !property.targets.length ? (
                    <span className={css.scope}>{t('designerPropertyUnmappedVariant')}</span>
                  ) : null}
              </span>
              <div data-property-editor={property.id}>
                {disabled || owner.locked ? (
                  <button
                    type="button"
                    disabled
                    aria-label={`${t('designerEditProperty')}: ${property.name}`}
                  >
                    <DesignerIcon name="settings" />
                  </button>
                ) : (
                  <DesignerPopover
                    key={`${property.id}:${generation}:${owner.id}:${selectionKey}`}
                    label={`${t('designerEditProperty')}: ${property.name}`}
                    closeLabel={t('designerDone')}
                    trigger={<DesignerIcon name="settings" />}
                    triggerClassName={css.icon}
                    panelClassName={css.panel}
                  >
                    <PropertyEditor
                      doc={doc}
                      component={owner}
                      property={definition}
                      t={t}
                      save={value => finishDefinition(value, true, owner)}
                    />
                  </DesignerPopover>
                )}
              </div>
              <Tooltip label={`${t('designerDelete')}: ${property.name}`}>
                <button
                  type="button"
                  disabled={disabled || owner.locked}
                  aria-label={`${t('designerDelete')}: ${property.name}`}
                  onClick={() => {
                    try {
                      commit(removeDesignComponentProperty(doc, owner.id, property.id))
                    } catch (error) {
                      if (!(error instanceof Error)) throw error
                      setError(t('designerPropertyInvalid'))
                    }
                  }}
                >
                  <DesignerIcon name="minus" />
                </button>
              </Tooltip>
            </div>
          ))}
          {!definitions.length ? (
            <p className={css.hint}>{t('designerComponentPropertiesHint')}</p>
          ) : null}
        </>
      ) : (
        <>
          {shared.map(({ property, members }) => {
            const firstValue = members[0]?.property.value ?? property.defaultValue
            const mixed = !members.every(member => member.property.value === firstValue)
            const value = mixed ? (property.type === 'boolean' ? false : '') : firstValue
            return (
              <div className={css.value} key={`${selectionKey}:${property.id}`}>
                <label
                  htmlFor={`component-property-${property.id}`}
                  title={property.name}
                  onClick={(event) => {
                    if (property.type !== 'instance-swap') return
                    event.preventDefault()
                    event.currentTarget.nextElementSibling
                      ?.querySelector<HTMLButtonElement>('button')
                      ?.focus()
                  }}
                >
                  {property.name}
                  {members.every(member => !member.property.targets.length) ? (
                    <small className={css.scope}>{t('designerPropertyUnmappedVariant')}</small>
                  ) : null}
                </label>
                {property.type === 'text' ? (
                  <TextValue
                    id={`component-property-${property.id}`}
                    value={typeof value === 'string' ? value : ''}
                    mixed={mixed}
                    mixedLabel={t('designerMixed')}
                    label={property.name}
                    disabled={disabled}
                    onCommit={next => change(members, next)}
                  />
                ) : property.type === 'instance-swap' ? (
                  <DesignerComponentPicker
                    doc={doc}
                    label={property.name}
                    value={typeof value === 'string' ? [value] : []}
                    mixed={mixed}
                    disabled={disabled}
                    preferred={property.preferredValues ?? []}
                    t={t}
                    candidatePage={(options) => {
                      const contexts = members.flatMap(member =>
                        member.node.componentId
                          ? [
                            {
                              ownerId:
                                  designComponentPropertyOwner(doc, member.property.id)?.id ??
                                  member.node.componentId,
                              property: member.property.id,
                              instanceIds: [member.node.id],
                            },
                          ]
                          : [],
                      )
                      const first = contexts[0]
                      if (!first)
                        return {
                          candidates: [],
                          nextCursor: null,
                          unsearched: 0,
                        }
                      return designComponentPropertySwapCandidateSummary(
                        doc,
                        first.ownerId,
                        first.property,
                        first.instanceIds,
                        { ...options, additionalContexts: contexts.slice(1) },
                      )
                    }}
                    onChange={id => change(members, id)}
                  />
                ) : (
                  <BooleanValue
                    id={`component-property-${property.id}`}
                    value={!!value}
                    mixed={mixed}
                    label={property.name}
                    disabled={disabled}
                    onChange={(next) => {
                      change(members, next)
                    }}
                  />
                )}
                <Tooltip label={t('designerResetProperty').replace('{name}', property.name)}>
                  <button
                    type="button"
                    aria-label={t('designerResetProperty').replace('{name}', property.name)}
                    disabled={disabled || !members.some(member => member.property.overridden)}
                    onClick={() => {
                      change(members)
                    }}
                  >
                    <DesignerIcon name="undo" />
                  </button>
                </Tooltip>
              </div>
            )
          })}
          {!shared.length ? <p className={css.hint}>{t('designerNoCommonProperties')}</p> : null}
        </>
      )}
      {error ? (
        <p role="alert" className={css.hint}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
