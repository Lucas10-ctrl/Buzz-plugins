/** Ordered shadows share one ownership-aware editor for document layers and linked descendants. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  CopyOSDesignDocument,
  CopyOSDesignShadow,
  CopyOSDesignEffect,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  createDesignEffectsReader,
  type DesignEffectsCurrentContext,
  editDesignEffectsBatch,
  type DesignEffectsChange,
  DesignEffectsEditError,
  designEffectSpreadSupported,
  designEffectStyleContext,
  updateDesignEffectStyle,
  detachDesignEffectStyleBatch,
  designModeResources,
  resolveDesignModeColors,
  designColorVariableCss,
  designEffectColorAlpha,
  designEffectOpacity,
  resolveDesignNumberVariables,
  designEffectNumberTokenSupportsProperty,
} from '../../../copyos-domain/src/design-model.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon } from './DesignerIcon.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerEffectStyles } from './DesignerEffectStyles.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerSwatch } from './DesignerSwatch.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerEffects.module.css'

type EditorContext = Pick<
  DesignEffectsCurrentContext,
  'effects' | 'authoredEffects' | 'locked' | 'overridePath' | 'effectiveModeId' | 'owned'
> & {
  node?: CopyOSDesignNode
  stored?: CopyOSDesignNode
  effectStyleId?: string | null
  effectStyleOwned?: boolean
}
type Owner = { nodeId: string; path?: readonly string[]; locked?: boolean }
type NumberKey = 'x' | 'y' | 'blur' | 'spread' | 'opacity' | 'radius'
type EffectType = CopyOSDesignEffect['type']
type Translate = (key: CopyOSFoundationLocaleKey) => string
const fields = [
  { key: 'x', labelKey: 'designerShadowX', short: 'X', min: -1000000, max: 1000000 },
  { key: 'y', labelKey: 'designerShadowY', short: 'Y', min: -1000000, max: 1000000 },
  { key: 'blur', labelKey: 'designerShadowBlur', short: '◌', min: 0, max: 10000 },
  { key: 'spread', labelKey: 'designerShadowSpread', short: '↗', min: -10000, max: 10000 },
  { key: 'opacity', labelKey: 'designerShadowOpacity', short: '%', min: 0, max: 100 },
] as const

/** Edit stack rows by index without copying other selected layers' shadow values.
 * @param props - Contextual owners and immutable history/preview callbacks.
 * @returns Compact effect rows; incompatible stacks retain safe add/reset actions.
 */
export function DesignerEffects({
  doc,
  owners,
  t,
  commit,
  preview,
  cancelPreview,
  editStyleId,
  styleModeId,
}: {
  doc: CopyOSDesignDocument
  owners: readonly Owner[]
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
  preview: (document: CopyOSDesignDocument) => void
  cancelPreview: () => void
  editStyleId?: string | undefined
  styleModeId?: string | null | undefined
}): ReactNode {
  const scene = useMemo(() => createDesignRenderScene(doc), [doc])
  const readEffects = useMemo<(id: string, path?: readonly string[]) => EditorContext | undefined>(() => {
    if (!editStyleId) return createDesignEffectsReader(doc, scene, { includeSourceEffects: false })
    const context = designEffectStyleContext(
      doc,
      editStyleId,
      styleModeId === undefined ? (doc.activeTokenModeId ?? null) : styleModeId,
    )
    return () =>
      context
        ? {
          effects: context.effects,
          authoredEffects: context.authoredEffects,
          locked: false,
          overridePath: null,
          effectiveModeId: context.effectiveModeId,
          owned: true,
        }
        : undefined
  }, [doc, scene, editStyleId, styleModeId])
  const activeOwners = editStyleId ? [{ nodeId: editStyleId }] : owners
  const contexts = activeOwners.map(owner => ({ owner, context: readEffects(owner.nodeId, owner.path) }))
  const editable = contexts.filter(item => item.context && !item.owner.locked && !item.context.locked)
  const nonempty = contexts.filter(item => item.context?.effects.length)
  const count = nonempty[0]?.context?.effects.length ?? 0
  const compatible = nonempty.every(item => item.context?.effects.length === count)
  const mismatch = !compatible || contexts.some(item => (item.context?.effects.length ?? 0) !== count)
  const ownerKey = `${doc.id}:${editStyleId ?? ''}:${styleModeId === undefined ? 'auto' : (styleModeId ?? 'base')}:${owners.map(owner => `${owner.nodeId}:${JSON.stringify(owner.path ?? [])}`).join('|')}`
  const origin = useRef<{
    document: CopyOSDesignDocument
    read: (id: string, path?: readonly string[]) => EditorContext | undefined
  } | null>(null)
  const [pickerVersion, setPickerVersion] = useState(0)
  const [failure, setFailure] = useState(false)
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null)
  const [stylesOpen, setStylesOpen] = useState(false)
  useEffect(() => {
    setStylesOpen(false)
    setEditingStyleId(null)
  }, [ownerKey])
  useEffect(
    () => () => {
      if (origin.current) {
        origin.current = null
        cancelPreview()
      }
    },
    [ownerKey],
  )
  const cancel = (): void => {
    origin.current = null
    cancelPreview()
  }
  const apply = (
    change: (
      effects: CopyOSDesignEffect[],
      owner: Owner,
      current: EditorContext,
    ) => CopyOSDesignEffect[] | null,
    transient = false,
  ): boolean => {
    if (!editable.length) return false
    if (transient) origin.current ??= { document: doc, read: readEffects }
    const before = origin.current?.document ?? doc
    const readOrigin = origin.current?.read ?? readEffects
    const changes: Extract<DesignEffectsChange, { effects: unknown }>[] = []
    for (const item of editable) {
      const current = readOrigin(item.owner.nodeId, item.owner.path)
      if (!current || current.locked) continue
      const changed = change(current.authoredEffects, item.owner, current)
      if (changed !== current.authoredEffects)
        changes.push({ nodeId: item.owner.nodeId, path: item.owner.path, effects: changed })
    }
    let next: CopyOSDesignDocument
    try {
      next = editStyleId
        ? changes.length
          ? updateDesignEffectStyle(before, editStyleId, { effects: [...(changes[0]?.effects ?? [])] })
          : before
        : editDesignEffectsBatch(before, changes)
    } catch (error) {
      if (!(error instanceof DesignEffectsEditError)) throw error
      setFailure(true)
      cancel()
      setPickerVersion(value => value + 1)
      return false
    }
    setFailure(false)
    if (transient) {
      preview(next)
      return true
    }
    origin.current = null
    if (commit(next) === false) {
      cancel()
      setPickerVersion(value => value + 1)
      return false
    }
    return true
  }
  const move = (index: number, direction: number): boolean =>
    apply((effects) => {
      const effect = effects[index],
        neighbor = effects[index + direction]
      if (!effect || !neighbor) return effects
      const next = effects.slice()
      next[index] = neighbor
      next[index + direction] = effect
      return next
    })
  const duplicate = (index: number): boolean =>
    apply((effects) => {
      const effect = effects[index]
      return effect
        ? [...effects.slice(0, index + 1), { ...effect, id: randomUUID() }, ...effects.slice(index + 1)]
        : effects
    })
  const update = (
    index: number,
    change: (effect: CopyOSDesignEffect) => CopyOSDesignEffect,
    transient = false,
  ): boolean =>
    apply((effects) => {
      const effect = effects[index]
      if (!effect) return effects
      const next = change(effect)
      return next === effect ? effects : effects.map((current, at) => (at === index ? next : current))
    }, transient)
  const patchShadow = (index: number, values: Partial<CopyOSDesignShadow>, transient = false): boolean =>
    update(
      index,
      (effect) => {
        if (
          effect.type === 'layer-blur' ||
          (Object.keys(values) as (keyof CopyOSDesignShadow)[]).every(
            key => effect[key] === values[key] && !bindingFor(effect, key as NumberKey),
          )
        )
          return effect
        const numericBindings = Object.fromEntries(
          Object.entries(effect.numericBindings ?? {}).filter(([key]) => !(key in values)),
        )
        return { ...effect, ...values, ...(effect.numericBindings ? { numericBindings } : {}) }
      },
      transient,
    )
  const common = <K extends keyof CopyOSDesignEffect>(
    index: number,
    key: K,
  ): CopyOSDesignEffect[K] | null => {
    const first = nonempty[0]?.context?.effects[index]?.[key]
    return nonempty.every(item => item.context?.effects[index]?.[key] === first) ? (first ?? null) : null
  }
  const commonShadow = <K extends keyof CopyOSDesignShadow>(
    index: number,
    key: K,
  ): CopyOSDesignShadow[K] | null => {
    const values = nonempty.map((item) => {
      const effect = item.context?.effects[index]
      return effect && effect.type !== 'layer-blur' ? effect[key] : undefined
    })
    return values.every(value => value === values[0]) ? (values[0] ?? null) : null
  }
  const convert = (index: number, type: EffectType): boolean =>
    update(index, (effect) => {
      if (effect.type === type) return effect
      if (type === 'layer-blur')
        return {
          id: effect.id,
          type,
          visible: effect.visible,
          radius: effect.type === 'layer-blur' ? effect.radius : effect.blur,
          ...(bindingFor(effect, 'blur') ? { numericBindings: { radius: bindingFor(effect, 'blur') } } : {}),
        }
      return effect.type === 'layer-blur'
        ? {
          id: effect.id,
          type,
          visible: effect.visible,
          x: 0,
          y: 4,
          blur: effect.radius,
          spread: 0,
          color: '#000000',
          opacity: 0.25,
          ...(effect.numericBindings?.radius
            ? { numericBindings: { blur: effect.numericBindings.radius } }
            : {}),
        }
        : { ...effect, type }
    })
  const colorResources = (context: EditorContext | undefined) =>
    resolveDesignModeColors(origin.current?.document ?? doc, context?.effectiveModeId ?? null)
  const editColor = (index: number, color: string, opacity: number, transient = false): boolean => {
    const read = origin.current?.read ?? readEffects
    const owner = nonempty[0]?.owner
    const primary = owner ? read(owner.nodeId, owner.path)?.effects[index] : undefined
    if (!primary || primary.type === 'layer-blur') return false
    const colorChanged = color.toLowerCase() !== primary.color.toLowerCase()
    const alphaChanged = Math.abs(opacity - designEffectOpacity(primary)) > 0.000001
    if (!colorChanged && !alphaChanged) return origin.current ? apply(effects => effects, transient) : true
    return apply((effects, _owner, current) => {
      const changed = effects.map((effect, at) => {
        if (at !== index || effect.type === 'layer-blur') return effect
        const resolved = current.effects.find(item => item.id === effect.id)
        if (!resolved || resolved.type === 'layer-blur') return effect
        const intrinsic = designEffectColorAlpha(resolved)
        const { colorVariableId: _reference, ...literal } = effect
        if (!alphaChanged) {
          if (!effect.colorVariableId && color.toLowerCase() === resolved.color.toLowerCase()) return effect
          return {
            ...literal,
            color,
            ...(intrinsic !== 1 || effect.colorAlpha !== undefined || effect.colorVariableId
              ? { colorAlpha: intrinsic }
              : {}),
          }
        }
        const numericBindings = Object.fromEntries(
          Object.entries(effect.numericBindings ?? {}).filter(([key]) => key !== 'opacity'),
        )
        if (!colorChanged && opacity <= intrinsic && intrinsic > 0)
          return { ...effect, opacity: opacity / intrinsic, numericBindings }
        return {
          ...literal,
          color: colorChanged ? color : resolved.color,
          colorAlpha: 1,
          opacity,
          numericBindings,
        }
      })
      return changed.every((effect, at) => effect === effects[at]) ? effects : changed
    }, transient)
  }
  const detachColor = (index: number): boolean =>
    apply((effects, _owner, current) => {
      const changed = effects.map((effect, at) => {
        if (at !== index || effect.type === 'layer-blur' || !effect.colorVariableId) return effect
        const resolved = current.effects.find(item => item.id === effect.id)
        if (!resolved || resolved.type === 'layer-blur') return effect
        const { colorVariableId: _reference, ...literal } = effect
        return { ...literal, color: resolved.color, colorAlpha: designEffectColorAlpha(resolved) }
      })
      return changed.every((effect, at) => effect === effects[at]) ? effects : changed
    })
  const label = (key: CopyOSFoundationLocaleKey, index: number): string =>
    count === 1 ? t(key) : `${t(key)} ${count - index}`
  const numberValue = (effect: CopyOSDesignEffect | undefined, key: NumberKey): number | undefined =>
    !effect
      ? undefined
      : effect.type === 'layer-blur'
        ? key === 'radius'
          ? effect.radius
          : undefined
        : key === 'radius'
          ? undefined
          : effect[key]
  const bindingFor = (effect: CopyOSDesignEffect | undefined, key: NumberKey): string | undefined => {
    const bindings: Partial<Record<NumberKey, string | undefined>> = effect?.numericBindings ?? {}
    return bindings[key]
  }
  const tokenControl = (index: number, key: NumberKey, disabled: boolean): ReactNode => {
    const first = nonempty[0]?.context
    const binding = bindingFor(first?.authoredEffects[index], key)
    const same = nonempty.every(item => bindingFor(item.context?.authoredEffects[index], key) === binding)
    const resources = resolveDesignNumberVariables(
      designModeResources(doc, first?.effectiveModeId ?? null).numberVariables,
    )
    const eligible = resources.filter(resource =>
      editable.every((item) => {
        const effect = item.context?.authoredEffects[index]
        return !effect || designEffectNumberTokenSupportsProperty(doc, resource.id, key, effect)
      }),
    )
    const labelKey =
      key === 'radius'
        ? 'designerLayerBlurRadius'
        : (fields.find(field => field.key === key)?.labelKey ?? 'designerLayerBlurRadius')
    const controlLabel = `${label(labelKey, index)} ${t('designerTokens')}`
    const resourceName = resources.find(resource => resource.id === binding)?.name
    return (
      <DesignerPopover
        key={`${ownerKey}:${index}:${key}:token`}
        label={controlLabel}
        closeLabel={t('designerDone')}
        panelClassName={css.tokenPanel}
        triggerClassName={binding || !same ? css.boundToken : css.token}
        trigger={
          <Tooltip label={same ? (resourceName ?? t('designerNone')) : t('designerMixed')}>
            <span className={css.tokenGlyph}>
              <DesignerIcon name="styles" />
            </span>
          </Tooltip>
        }
      >
        <select
          aria-label={controlLabel}
          value={same ? (binding ?? '') : '__mixed__'}
          disabled={disabled}
          onChange={(event) => {
            const reference = event.currentTarget.value
            apply((effects, _owner, current) => {
              const effect = effects[index]
              if (
                !effect ||
                numberValue(effect, key) === undefined ||
                (reference || undefined) === bindingFor(effect, key)
              )
                return effects
              const numericBindings = Object.fromEntries(
                Object.entries(effect.numericBindings ?? {}).filter(([property]) => property !== key),
              )
              if (reference) numericBindings[key] = reference
              const value = reference
                ? numberValue(effect, key)
                : numberValue(
                  current.effects.find(item => item.id === effect.id),
                  key,
                )
              const next = { ...effect, [key]: value, numericBindings }
              return effects.map((item, at) => (at === index ? next : item))
            })
          }}
        >
          <option value="__mixed__" disabled>
            {t('designerMixed')}
          </option>
          <option value="">{t('designerNone')}</option>
          {binding && !eligible.some(resource => resource.id === binding) ? (
            <option value={binding} disabled>
              {resourceName ?? t('designerNone')}
            </option>
          ) : null}
          {eligible.map(resource => (
            <option key={resource.id} value={resource.id}>
              {resource.name} · {resource.value}
            </option>
          ))}
        </select>
        {binding && same ? <span className={css.hint}>{resourceName}</span> : null}
      </DesignerPopover>
    )
  }
  const newEffect = (type: EffectType): CopyOSDesignEffect =>
    type === 'layer-blur'
      ? { id: randomUUID(), type, visible: true, radius: 8 }
      : {
        id: randomUUID(),
        type,
        visible: true,
        x: 0,
        y: 4,
        blur: 8,
        spread: 0,
        color: '#000000',
        opacity: 0.25,
      }
  const canAppend = (effects: readonly CopyOSDesignEffect[], type: EffectType): boolean =>
    effects.length < 17 &&
    effects.filter(effect => effect.type === type).length < (type === 'layer-blur' ? 1 : 8)
  const canAdd = (type: EffectType): boolean =>
    editable.length > 0 && editable.every(item => canAppend(item.context?.effects ?? [], type))
  const addType: EffectType =
    !editable.length || canAdd('drop-shadow')
      ? 'drop-shadow'
      : canAdd('inner-shadow')
        ? 'inner-shadow'
        : 'layer-blur'
  const canDuplicate = (index: number): boolean =>
    editable.every((item) => {
      const effects = item.context?.effects ?? [],
        effect = effects[index]
      return !effect || canAppend(effects, effect.type)
    })
  const canConvert = (index: number, type: EffectType): boolean =>
    editable.every((item) => {
      const effects = item.context?.effects ?? [],
        effect = effects[index]
      return (
        !effect ||
        effect.type === type ||
        effects.filter(current => current.type === type).length < (type === 'layer-blur' ? 1 : 8)
      )
    })
  const inherited = contexts.some(
    item => item.context && (item.context.overridePath !== null || item.context.stored?.kind === 'instance'),
  )
  const allOwned = contexts.every(item => item.context?.owned)
  const noneOwned = contexts.every(item => !item.context?.owned)
  const canReset = editable.some(item => item.context?.owned)
  const styleId = contexts[0]?.context?.effectStyleId
  const sharedStyle =
    styleId && contexts.every(item => item.context?.effectStyleId === styleId)
      ? doc.effectStyles?.find(style => style.id === styleId)
      : undefined
  return (
    <section className={css.section} aria-label={t('designerEffects')}>
      <div className={css.heading}>
        <h3>{t('designerEffects')}</h3>
        {!sharedStyle && contexts.some(item => !!item.context?.effectStyleId) ? (
          <span className={css.hint}>{t('designerMixed')}</span>
        ) : null}
        {sharedStyle ? (
          <div className={css.styleLabel}>
            <button
              type="button"
              className={css.styleName}
              aria-label={`${t('designerEffectStyles')}: ${sharedStyle.name}`}
              onClick={() => {
                setEditingStyleId(null)
                setStylesOpen(true)
              }}
            >
              {sharedStyle.name}
            </button>
            <button
              type="button"
              aria-label={`${t('designerEditEffectStyle')}: ${sharedStyle.name}`}
              onClick={() => {
                setEditingStyleId(sharedStyle.id)
                setStylesOpen(true)
              }}
            >
              <DesignerIcon name="settings" />
            </button>
            <button
              type="button"
              disabled={!editable.length}
              aria-label={t('designerDetachStyle')}
              onClick={() => {
                try {
                  const accepted = commit(
                    detachDesignEffectStyleBatch(
                      doc,
                      editable.map(item => item.owner),
                    ),
                  )
                  setFailure(accepted === false)
                } catch (error) {
                  if (!(error instanceof DesignEffectsEditError)) throw error
                  setFailure(true)
                }
              }}
            >
              <DesignerIcon name="minus" />
            </button>
          </div>
        ) : null}
        {inherited ? (
          <span className={css.hint}>
            {t(allOwned ? 'designerEffectsLocal' : noneOwned ? 'designerEffectsInherited' : 'designerMixed')}
          </span>
        ) : null}
        {!editStyleId ? (
          <DesignerPopover
            open={stylesOpen}
            panelClassName={css.stylesPanel}
            onOpenChange={setStylesOpen}
            label={t('designerEffectStyles')}
            closeLabel={t('designerDone')}
            trigger={<DesignerIcon name="styles" />}
            onDismiss={cancel}
          >
            <DesignerEffectStyles
              hasStyle={editable.some(item => !!item.context?.effectStyleId)}
              hasSelection={contexts.some(item => !!item.context)}
              doc={doc}
              targets={editable.map(item => item.owner)}
              effects={nonempty[0]?.context?.authoredEffects ?? []}
              currentStyleId={
                contexts.every(item => item.context?.effectStyleId === contexts[0]?.context?.effectStyleId)
                  ? contexts[0]?.context?.effectStyleId
                  : undefined
              }
              t={t}
              commit={commit}
              preview={preview}
              cancelPreview={cancelPreview}
              editingId={editingStyleId}
              onEdit={setEditingStyleId}
            >
              {editingStyleId ? (
                <DesignerEffects
                  key={`${doc.id}:style:${editingStyleId}`}
                  doc={doc}
                  owners={[]}
                  editStyleId={editingStyleId}
                  styleModeId={
                    contexts[0]?.context
                      ? contexts[0].context.effectiveModeId
                      : (doc.activeTokenModeId ?? null)
                  }
                  t={t}
                  commit={commit}
                  preview={preview}
                  cancelPreview={cancelPreview}
                />
              ) : null}
            </DesignerEffectStyles>
          </DesignerPopover>
        ) : null}
        {contexts.some(item => !!item.context) ? (
          <button
            type="button"
            aria-label={t(
              addType === 'drop-shadow'
                ? 'designerAddShadow'
                : addType === 'inner-shadow'
                  ? 'designerAddInnerShadow'
                  : 'designerAddLayerBlur',
            )}
            disabled={!canAdd(addType)}
            onClick={() => {
              apply(effects => [...effects, newEffect(addType)])
            }}
          >
            +
          </button>
        ) : null}
        {inherited ? (
          <button
            type="button"
            aria-label={t('designerResetEffects')}
            disabled={!canReset}
            onClick={() => {
              apply(() => null)
            }}
          >
            ↩
          </button>
        ) : null}
      </div>
      {sharedStyle ? <p className={css.hint}>{t('designerEffectStyleLocalEdit')}</p> : null}
      {failure ? <p role="alert">{t('designerEffectsInvalid')}</p> : null}
      {mismatch ? <p className={css.hint}>{t('designerMixedEffects')}</p> : null}
      {compatible
        ? Array.from({ length: count }, (_, row) => {
          const index = count - row - 1
          const effect = nonempty[0]?.context?.effects[index]
          if (!effect) return null
          const rowKey = `${ownerKey}:${index}:${nonempty.map(item => item.context?.effects[index]?.id).join(',')}`
          const spreadSupported = nonempty.every(
            item => !!editStyleId || (item.context?.node && designEffectSpreadSupported(item.context.node)),
          )
          const disabled = !editable.some(item => item.context?.effects[index])
          const type = common(index, 'type')
          const shadowRow = nonempty.every(item => item.context?.effects[index]?.type !== 'layer-blur')
          const radii = nonempty.map((item) => {
            const effect = item.context?.effects[index]
            return effect?.type === 'layer-blur' ? effect.radius : undefined
          })
          const radius = radii.every(value => value === radii[0]) ? (radii[0] ?? null) : null
          const typeLabel =
            type === 'drop-shadow'
              ? t('designerDropShadow')
              : type === 'inner-shadow'
                ? t('designerInnerShadow')
                : type === 'layer-blur'
                  ? t('designerLayerBlur')
                  : t('designerMixed')
          const primaryContext = nonempty[0]?.context
          const resources = colorResources(primaryContext)
          const colorBinding = commonShadow(index, 'colorVariableId')
          const boundResource = resources.find(resource => resource.id === colorBinding)
          const intrinsicAlpha = effect.type !== 'layer-blur' ? designEffectColorAlpha(effect) : 1
          const combinedAlpha = effect.type !== 'layer-blur' ? designEffectOpacity(effect) : 1
          return (
            <div key={rowKey} className={css.row} role="group" aria-label={`${typeLabel} ${count - index}`}>
              <div className={css.rowHeading}>
                <select
                  className={css.type}
                  aria-label={label('designerEffectType', index)}
                  value={type ?? 'mixed'}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    if (value === 'drop-shadow' || value === 'inner-shadow' || value === 'layer-blur')
                      convert(index, value)
                  }}
                >
                  <option value="mixed" disabled>
                    {t('designerMixed')}
                  </option>
                  <option value="drop-shadow" disabled={!canConvert(index, 'drop-shadow')}>
                    {t('designerDropShadow')}
                  </option>
                  <option value="inner-shadow" disabled={!canConvert(index, 'inner-shadow')}>
                    {t('designerInnerShadow')}
                  </option>
                  <option value="layer-blur" disabled={!canConvert(index, 'layer-blur')}>
                    {t('designerLayerBlur')}
                  </option>
                </select>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={label(
                    common(index, 'visible') === false ? 'designerShowEffect' : 'designerHideEffect',
                    index,
                  )}
                  aria-pressed={common(index, 'visible') !== false}
                  onClick={() => {
                    update(index, effect => ({ ...effect, visible: common(index, 'visible') === false }))
                  }}
                >
                  {common(index, 'visible') === false ? '○' : '●'}
                </button>
                <button
                  type="button"
                  disabled={disabled || index === count - 1}
                  aria-label={label('designerMoveEffectUp', index)}
                  onClick={() => {
                    move(index, 1)
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  aria-label={label('designerMoveEffectDown', index)}
                  onClick={() => {
                    move(index, -1)
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={disabled || !canDuplicate(index)}
                  aria-label={label('designerDuplicateEffect', index)}
                  onClick={() => {
                    duplicate(index)
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={label(
                    type === 'layer-blur' ? 'designerRemoveEffect' : 'designerRemoveShadow',
                    index,
                  )}
                  onClick={() => {
                    apply(effects =>
                      effects[index] ? effects.filter((_effect, at) => at !== index) : effects,
                    )
                  }}
                >
                  −
                </button>
              </div>
              {type === 'layer-blur' ? (
                <div className={css.fields}>
                  <div className={css.numeric}>
                    <DesignerNumberField
                      key={`${rowKey}:radius`}
                      label={label('designerLayerBlurRadius', index)}
                      short="◌"
                      value={radius}
                      mixed={t('designerMixed')}
                      min={0}
                      max={10000}
                      step={0.1}
                      disabled={disabled}
                      onCommit={value =>
                        update(index, effect =>
                          effect.type === 'layer-blur' &&
                            (effect.radius !== value || !!effect.numericBindings?.radius)
                            ? {
                              ...effect,
                              radius: value,
                              ...(effect.numericBindings ? { numericBindings: {} } : {}),
                            }
                            : effect,
                        )
                      }
                    />
                    {tokenControl(index, 'radius', disabled)}
                  </div>
                </div>
              ) : shadowRow ? (
                <div className={css.fields}>
                  {fields.map(field => (
                    <div className={css.numeric} key={`${rowKey}:${field.key}`}>
                      <DesignerNumberField
                        key={`${rowKey}:${field.key}`}
                        label={label(field.labelKey, index)}
                        short={field.short}
                        disabled={disabled || (field.key === 'spread' && !spreadSupported)}
                        value={
                          commonShadow(index, field.key) === null
                            ? null
                            : Number(commonShadow(index, field.key)) * (field.key === 'opacity' ? 100 : 1)
                        }
                        mixed={t('designerMixed')}
                        min={field.min}
                        max={field.max}
                        onCommit={value =>
                          patchShadow(index, { [field.key]: value / (field.key === 'opacity' ? 100 : 1) })
                        }
                      />
                      {tokenControl(
                        index,
                        field.key,
                        disabled || (field.key === 'spread' && !spreadSupported),
                      )}
                    </div>
                  ))}
                  <DesignerPopover
                    key={`${rowKey}:color`}
                    label={label('designerShadowColor', index)}
                    closeLabel={t('designerDone')}
                    triggerClassName={css.color}
                    onDismiss={cancel}
                    onOpenChange={() => {
                      origin.current = null
                    }}
                    trigger={
                      <>
                        <DesignerSwatch
                          paint={designColorVariableCss({
                            value:
                                commonShadow(index, 'color') ??
                                (effect.type !== 'layer-blur' ? effect.color : '#000000'),
                            alpha: intrinsicAlpha,
                          })}
                        />
                        <span>
                          {boundResource?.name ??
                              commonShadow(index, 'color')?.slice(1).toUpperCase() ??
                              t('designerMixed')}
                        </span>
                        {colorBinding ? (
                          <small>
                            {nonempty.every((item) => {
                              const effect = item.context?.effects[index]
                              return (
                                effect &&
                                  effect.type !== 'layer-blur' &&
                                  designEffectColorAlpha(effect) === intrinsicAlpha
                              )
                            })
                              ? `${Math.round(intrinsicAlpha * 100)}%`
                              : t('designerMixed')}
                          </small>
                        ) : null}
                      </>
                    }
                  >
                    <fieldset disabled={disabled} className={css.picker}>
                      <DesignerColorPicker
                        key={pickerVersion}
                        color={
                          commonShadow(index, 'color') ??
                            (effect.type !== 'layer-blur' ? effect.color : '#000000')
                        }
                        opacity={combinedAlpha}
                        opacityLabel={t('designerColorAlpha')}
                        resources={resources}
                        t={t}
                        onPreview={(color, opacity) => {
                          editColor(index, color, opacity, true)
                        }}
                        onCommit={(color, opacity) => {
                          editColor(index, color, opacity)
                        }}
                        onCancel={cancel}
                        onVariable={(variable) => {
                          update(index, effect =>
                            effect.type === 'layer-blur' || effect.colorVariableId === variable.id
                              ? effect
                              : { ...effect, colorVariableId: variable.id },
                          )
                        }}
                      />
                      {nonempty.some((item) => {
                        const effect = item.context?.authoredEffects[index]
                        return effect?.type !== 'layer-blur' && effect?.colorVariableId
                      }) ? (
                          <button
                            type="button"
                            onClick={() => {
                              detachColor(index)
                            }}
                          >
                            {t('designerDetachColor')}
                          </button>
                        ) : null}
                    </fieldset>
                  </DesignerPopover>
                </div>
              ) : (
                <p className={css.hint}>{t('designerMixedEffectTypes')}</p>
              )}
              {shadowRow && !spreadSupported ? (
                <p className={css.hint}>{t('designerEffectSpreadUnavailable')}</p>
              ) : null}
            </div>
          )
        })
        : null}
    </section>
  )
}
