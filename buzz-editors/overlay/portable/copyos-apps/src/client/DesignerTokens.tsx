/** Shared design resources edited by both the canvas inspector and agent tools. */
import { useMemo, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignNumberProperty,
} from '../../../copyos-domain/src/types.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import { DesignerColorResource } from './DesignerColorResource.tsx'
import { DesignerTextField } from './DesignerTextField.tsx'
import { editDesignerInstanceSizingSelection } from './DesignerInstanceSizing.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerNumberExpression } from './DesignerNumberExpression.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
import {
  createDesignRenderScene,
  designInstanceSizingOwns,
  DESIGN_STROKE_NUMBER_KEYS,
  designStrokeSupportsEdges,
  designStrokeWeights,
  designInstanceStrokeNode,
  designInstanceStrokeOwns,
  editDesignInstanceStroke,
  resetDesignInstanceSizing,
  designInstanceLayoutEligibility,
  DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS,
  editDesignInstanceLayout,
  editDesignNodes,
  designModeResources,
  removeDesignTokenMode,
  setDesignColorVariable,
  setDesignNumberVariable,
  resetDesignModeVariable,
  designTokenConfigurationValid,
  designNumberTokenSupportsProperty,
  designNumberTokenBounds,
  designTokenAliasAllowed,
  resolveDesignModeColors,
  resolveDesignNumberVariables,
} from '../../../copyos-domain/src/design-model.ts'
const properties: readonly CopyOSDesignNumberProperty[] = [
  ...DESIGN_STROKE_NUMBER_KEYS,
  'gap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'radius',
  'radiusTopLeft',
  'radiusTopRight',
  'radiusBottomRight',
  'radiusBottomLeft',
  'crossGap',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
]
const labels: Record<CopyOSDesignNumberProperty, CopyOSFoundationLocaleKey> = {
  strokeWidth: 'designerStrokeWidth',
  strokeTopWidth: 'designerStrokeTopWeight',
  strokeRightWidth: 'designerStrokeRightWeight',
  strokeBottomWidth: 'designerStrokeBottomWeight',
  strokeLeftWidth: 'designerStrokeLeftWeight',
  gap: 'designerGap',
  padding: 'designerPadding',
  paddingTop: 'designerPaddingTop',
  paddingRight: 'designerPaddingRight',
  paddingBottom: 'designerPaddingBottom',
  paddingLeft: 'designerPaddingLeft',
  radius: 'designerRadius',
  radiusTopLeft: 'designerTopLeftRadius',
  radiusTopRight: 'designerTopRightRadius',
  radiusBottomRight: 'designerBottomRightRadius',
  radiusBottomLeft: 'designerBottomLeftRadius',
  crossGap: 'designerCrossGap',
  fontSize: 'designerFontSize',
  fontWeight: 'designerFontWeight',
  lineHeight: 'designerLineHeight',
  letterSpacing: 'designerLetterSpacing',
  paragraphSpacing: 'designerParagraphSpacing',
  width: 'designerWidth',
  height: 'designerHeight',
  minWidth: 'designerMinWidth',
  maxWidth: 'designerMaxWidth',
  minHeight: 'designerMinHeight',
  maxHeight: 'designerMaxHeight',
}
/** Edit document token values, import the project CSS inventory, or bind a selected layer property.
 * @param props - Current document, optional selection and shared mutation callbacks.
 * @returns Resource rows and contextual numeric bindings.
 */
export function DesignerTokens({
  doc,
  node,
  t,
  commit,
  preview,
  cancelPreview,
  patch,
  importTokens,
  notice,
  review = [],
}: {
  doc: CopyOSDesignDocument
  node?: CopyOSDesignNode | undefined
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  patch?: ((fields: Partial<CopyOSDesignNode>) => void) | undefined
  importTokens: () => void
  notice: string
  review?: readonly string[]
}): ReactNode {
  const resources = designModeResources(doc),
    colors = resolveDesignModeColors(doc),
    numbers = resolveDesignNumberVariables(resources.numberVariables)
  const activeMode = doc.tokenModes?.find(m => m.id === doc.activeTokenModeId)
  const numberModeOverrides = useMemo(
    () => new Map(activeMode?.numberVariables.map(variable => [variable.id, variable]) ?? []),
    [activeMode],
  )
  const [modeName, setModeName] = useState<string | null>(null),
    [error, setError] = useState('')
  const commitResources = (next: CopyOSDesignDocument): boolean | void => {
    if (!designTokenConfigurationValid(next)) {
      setError(t('designerModeValueInvalid'))
      return false
    }
    setError('')
    return commit(next)
  }
  const [aliasEditor, setAliasEditor] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [requestedProperty, setProperty] =
    useState<CopyOSDesignNumberProperty>('gap')
  const instanceContext = useMemo(() => {
    if (node?.kind !== 'instance') return null
    const stored = doc.nodes.find(n => n.id === node.id)
    if (!stored) return null
    const scene = createDesignRenderScene(doc)
    const resolved = scene.root.byId.get(node.id) ?? node
    const context = scene.instance(resolved, scene.root)
    const root = context?.byId.get(node.componentId ?? '')
    if (!root) return null
    return {
      stored,
      root,
      resolved,
      modeId: context?.modes.get(root.id) ?? null,
    }
  }, [doc, node])
  const availableProperties: readonly CopyOSDesignNumberProperty[] =
    node?.kind === 'instance'
      ? [
        ...DESIGN_STROKE_NUMBER_KEYS,
        'width',
        'height',
        'minWidth',
        'maxWidth',
        'minHeight',
        'maxHeight',
        ...(instanceContext &&
          ['row', 'column', 'grid'].includes(instanceContext.root.layout)
          ? DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS
          : []),
      ]
      : properties.filter(key =>
        key === 'strokeWidth' || !DESIGN_STROKE_NUMBER_KEYS.some(stroke => stroke === key) ||
        !!node && designStrokeSupportsEdges(node),
      )
  const property = availableProperties.includes(requestedProperty)
    ? requestedProperty
    : 'width'
  const [unit, setUnit] = useState<'px' | 'number'>('px')
  const layoutProperty = DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.find(
    key => key === property,
  )
  const strokeProperty = DESIGN_STROKE_NUMBER_KEYS.find(key => key === property)
  const localStroke = instanceContext && strokeProperty ? instanceContext : null
  const strokeNode = localStroke ? designInstanceStrokeNode(doc, localStroke.stored) : node
  const strokeValue = (root: CopyOSDesignNode, key: typeof DESIGN_STROKE_NUMBER_KEYS[number]): number => {
    if (key === 'strokeWidth') return root.strokeWidth
    const weights = designStrokeWeights(root)
    return key === 'strokeTopWidth' ? weights.top : key === 'strokeRightWidth' ? weights.right :
      key === 'strokeBottomWidth' ? weights.bottom : weights.left
  }
  const inheritedStroke = useMemo(() => {
    if (!localStroke || !strokeProperty) return null
    const inherited = editDesignInstanceStroke(doc, localStroke.stored.id, { [strokeProperty]: undefined })
    const scene = createDesignRenderScene(inherited), instance = scene.root.byId.get(localStroke.stored.id)
    return instance ? scene.instance(instance, scene.root)?.byId.get(instance.componentId ?? '') : null
  }, [doc, localStroke, strokeProperty])
  const localLayout = instanceContext && layoutProperty ? instanceContext : null
  const dimension =
    (
      [
        'width',
        'height',
        'minWidth',
        'maxWidth',
        'minHeight',
        'maxHeight',
      ] as const
    ).find(key => key === property) ?? null
  const localSizing = dimension && instanceContext ? instanceContext : null
  const inheritedSizing = useMemo(() => {
    if (!localSizing || !dimension) return null
    const inherited = resetDesignInstanceSizing(doc, localSizing.stored.id, [
      dimension,
    ])
    const scene = createDesignRenderScene(inherited),
      instance = scene.root.byId.get(localSizing.stored.id)
    const root =
      instance &&
      scene.instance(instance, scene.root)?.byId.get(instance.componentId ?? '')
    return instance && root ? { instance, root } : null
  }, [doc, localSizing, dimension])
  const inheritedRoot = useMemo(() => {
    if (!localLayout || !layoutProperty) return null
    const inherited = editDesignInstanceLayout(doc, localLayout.stored.id, {
      [layoutProperty]: undefined,
    })
    const scene = createDesignRenderScene(inherited)
    const instance = scene.root.byId.get(localLayout.stored.id)
    return instance
      ? scene
        .instance(instance, scene.root)
        ?.byId.get(instance.componentId ?? '')
      : null
  }, [doc, localLayout, layoutProperty])
  const bindingContext = localStroke ?? localLayout ?? localSizing
  const bindingNumbers = bindingContext
    ? resolveDesignNumberVariables(
      designModeResources(doc, bindingContext.modeId).numberVariables,
    )
    : numbers
  const localBinding =
    localStroke && strokeProperty ? localStroke.stored.numericBindings?.[strokeProperty] :
      localLayout && layoutProperty
        ? localLayout.stored.numericBindings?.[layoutProperty]
        : undefined
  const dormant = !!(
    localLayout &&
    layoutProperty &&
    designInstanceLayoutEligibility(
      doc,
      localLayout.stored,
      localLayout.modeId,
    ).dormantKeys.includes(layoutProperty)
  )
  const binding =
    localStroke && strokeProperty ? (localBinding ?? (designInstanceStrokeOwns(localStroke.stored, strokeProperty) ? '' : '__inherit__')) :
      localSizing && dimension
        ? (localSizing.stored.numericBindings?.[dimension] ??
        (designInstanceSizingOwns(localSizing.stored, dimension)
          ? ''
          : '__inherit__'))
        : localLayout && layoutProperty
          ? (localBinding ??
          (dormant
            ? '__dormant__'
            : localLayout.stored.instanceLayout?.[layoutProperty] === undefined
              ? '__inherit__'
              : ''))
          : (node?.numericBindings?.[property] ?? '')
  const storedBindingToken = bindingNumbers.find(v => v.id === localBinding)
  const retainedBindingOption =
    localLayout &&
    layoutProperty &&
    !!localBinding &&
    !designNumberTokenSupportsProperty(
      doc,
      localBinding,
      layoutProperty,
      localLayout.root,
    )
  const inheritedBinding =
    localStroke && strokeProperty ? inheritedStroke?.numericBindings?.[strokeProperty] :
      localSizing && dimension
        ? doc.nodes.find(node => node.id === localSizing.stored.componentId)
          ?.numericBindings?.[dimension]
        : layoutProperty
          ? inheritedRoot?.numericBindings?.[layoutProperty]
          : undefined
  const inheritedToken = bindingNumbers.find(v => v.id === inheritedBinding)
  const effectiveValue = (
    root: CopyOSDesignNode,
    key: (typeof DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS)[number],
  ): number =>
    root[key] ?? (key === 'crossGap' ? Math.max(0, root.gap) : root.padding)
  const inheritLabel =
    localStroke && strokeProperty && inheritedStroke
      ? `${t('designerInheritStrokeProperty')}: ${inheritedToken ? `${inheritedToken.name} · ` : ''}${strokeValue(inheritedStroke, strokeProperty)}${t('designerPixels')}` :
      localSizing && dimension && inheritedSizing
        ? `${t('designerInheritLayoutProperty')}: ${inheritedToken ? `${inheritedToken.name} · ` : ''}${
          inheritedToken?.value ??
          inheritedSizing.instance[dimension] ??
          t('designerNone')
        }${inheritedToken || inheritedSizing.instance[dimension] !== undefined ? t('designerPixels') : ''}`
        : localLayout && layoutProperty && inheritedRoot
          ? `${t('designerInheritLayoutProperty')}: ${inheritedToken ? `${inheritedToken.name} · ` : ''}${effectiveValue(
            inheritedRoot,
            layoutProperty,
          )}${t('designerPixels')}`
          : t('designerInheritLayoutProperty')
  const aliasControl = (
    kind: 'color' | 'number',
    v: { id: string; name: string; aliasId?: string | null | undefined },
  ): ReactNode => {
    const resources = kind === 'color' ? colors : numbers
    const override =
      kind === 'color'
        ? activeMode?.variables.find(c => c.id === v.id)
        : activeMode?.numberVariables.find(c => c.id === v.id)
    const key = kind + ':' + v.id
    const label = t('designerAliasFor').replace('{name}', v.name)
    return (
      <div className={css.tokenAlias}>
        <Tooltip
          label={
            v.aliasId
              ? `${label}: ${resources.find(c => c.id === v.aliasId)?.name ?? ''}`
              : label
          }
          side="top"
          portal
        >
          <button
            type="button"
            aria-label={label}
            aria-expanded={aliasEditor === key}
            data-linked={!!v.aliasId}
            onClick={() => {
              setAliasEditor(aliasEditor === key ? null : key)
            }}
          >
            <Icon name="component" />
          </button>
        </Tooltip>
        {aliasEditor === key ? (
          <select
            aria-label={t('designerAliasTarget').replace('{name}', v.name)}
            value={activeMode && !override ? '__inherit__' : (v.aliasId ?? '')}
            onChange={(e) => {
              const selected = e.currentTarget.value
              if (selected === '__inherit__')
                commitResources(resetDesignModeVariable(doc, kind, v.id))
              else {
                const aliasId = selected || null
                if (kind === 'color')
                  commitResources(
                    setDesignColorVariable(doc, v.id, {
                      aliasId,
                      value:
                        colors.find(c => c.id === (aliasId ?? v.id))?.value ??
                        '#000000',
                      ...(!aliasId ? { alpha: colors.find(c => c.id === v.id)?.alpha ?? 1 } : {}),
                    }),
                  )
                else
                  commitResources(
                    setDesignNumberVariable(doc, v.id, {
                      aliasId,
                      expression: null,
                      value:
                        numbers.find(c => c.id === (aliasId ?? v.id))
                          ?.value ?? 0,
                    }),
                  )
              }
              setAliasEditor(null)
            }}
          >
            {activeMode ? (
              <option
                value="__inherit__"
                disabled={
                  !designTokenConfigurationValid(
                    resetDesignModeVariable(doc, kind, v.id),
                  )
                }
              >
                {t('designerInheritBase')}
              </option>
            ) : null}
            <option value="">{t('designerOwnValue')}</option>
            {resources
              .filter(c => designTokenAliasAllowed(doc, kind, v.id, c.id))
              .map(c => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        ) : null}
      </div>
    )
  }
  return (
    <div className={css.tokenResources}>
      <div className={css.tokenModeBar}>
        <select
          aria-label={t('designerTokenMode')}
          value={doc.activeTokenModeId ?? ''}
          onChange={(e) => {
            commitResources({
              ...doc,
              activeTokenModeId: e.currentTarget.value || null,
            })
            setAliasEditor(null)
            setModeName(null)
          }}
        >
          <option value="">{t('designerBaseMode')}</option>
          {doc.tokenModes?.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Tooltip label={t('designerAddMode')} portal>
          <button
            type="button"
            aria-label={t('designerAddMode')}
            onClick={() => {
              setModeName(modeName === null ? '' : null)
            }}
          >
            <Icon name="plus" />
          </button>
        </Tooltip>
        <Tooltip label={t('designerDeleteMode')} portal>
          <button
            type="button"
            aria-label={t('designerDeleteMode')}
            disabled={!activeMode}
            onClick={() => {
              if (activeMode)
                commitResources(removeDesignTokenMode(doc, activeMode.id))
            }}
          >
            <Icon name="minus" />
          </button>
        </Tooltip>
      </div>
      {activeMode ? (
        <DesignerTextField
          key={activeMode.id}
          label={t('designerModeName')}
          value={activeMode.name}
          suggestions={[]}
          onCommit={(name) => {
            commitResources({
              ...doc,
              tokenModes: doc.tokenModes?.map(m =>
                m.id === activeMode.id ? { ...m, name } : m,
              ),
            })
          }}
        />
      ) : null}
      {modeName !== null ? (
        <div className={css.tokenModeCreate}>
          <input
            aria-label={t('designerNewModeName')}
            value={modeName}
            onChange={(e) => {
              setModeName(e.currentTarget.value)
            }}
          />
          <button
            type="button"
            disabled={!modeName.trim() || (doc.tokenModes?.length ?? 0) >= 32}
            onClick={() => {
              const id = randomUUID()
              commitResources({
                ...doc,
                activeTokenModeId: id,
                tokenModes: [
                  ...(doc.tokenModes ?? []),
                  {
                    id,
                    name: modeName.trim().slice(0, 200),
                    variables: [],
                    numberVariables: [],
                  },
                ],
              })
              setModeName(null)
            }}
          >
            {t('designerCreateMode')}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={css.hint}>
          {error}
        </p>
      ) : null}
      {node && patch ? (
        <div className={css.tokenBinding}>
          <label>
            {t('designerTokenProperty')}
            <select
              aria-label={t('designerTokenProperty')}
              value={property}
              onChange={(e) => {
                const value = availableProperties.find(
                  p => p === e.currentTarget.value,
                )
                if (value) setProperty(value)
              }}
            >
              {availableProperties.map(p => (
                <option key={p} value={p}>
                  {t(
                    instanceContext?.root.layout === 'grid' && p === 'gap'
                      ? 'designerGridColumnGap'
                      : instanceContext?.root.layout === 'grid' &&
                          p === 'crossGap'
                        ? 'designerGridRowGap'
                        : labels[p],
                  )}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('designerBindToken')}
            <select
              aria-label={t('designerBindToken')}
              value={binding}
              onChange={(e) => {
                const id = e.currentTarget.value
                if (localStroke && strokeProperty && strokeNode) {
                  if (id === '__inherit__') {
                    commit(editDesignInstanceStroke(doc, localStroke.stored.id, { [strokeProperty]: undefined }))
                    return
                  }
                  // Claiming scalar ownership masks main-component edge widths. Preserve inherited custom edges when baking a value.
                  const retainedEdges = !id && strokeProperty === 'strokeWidth' ? Object.fromEntries(
                    DESIGN_STROKE_NUMBER_KEYS.slice(1).filter(key =>
                      strokeNode[key] !== undefined && !designInstanceStrokeOwns(localStroke.stored, key),
                    )
                      .map(key => [key, strokeValue(strokeNode, key)]),
                  ) : {}
                  let next = editDesignInstanceStroke(doc, localStroke.stored.id, {
                    ...retainedEdges, [strokeProperty]: strokeValue(strokeNode, strokeProperty),
                  })
                  if (id) {
                    next = editDesignNodes(next, [{
                      id: localStroke.stored.id,
                      numericBindings: { ...localStroke.stored.numericBindings, [strokeProperty]: id },
                    }])
                  }
                  commit(next)
                  return
                }
                if (localSizing && dimension) {
                  if (id === '__inherit__')
                    commit(
                      resetDesignInstanceSizing(doc, localSizing.stored.id, [
                        dimension,
                      ]),
                    )
                  else if (!id) {
                    const next = editDesignerInstanceSizingSelection(
                      doc,
                      [localSizing.resolved],
                      { [dimension]: localSizing.resolved[dimension] },
                    )
                    if (next) commit(next)
                  } else {
                    commit(
                      editDesignNodes(doc, [
                        {
                          id: localSizing.stored.id,
                          numericBindings: {
                            ...localSizing.stored.numericBindings,
                            [dimension]: id,
                          },
                          ...(dimension === 'width' || dimension === 'height'
                            ? { [`${dimension}Sizing`]: 'fixed' }
                            : {}),
                        },
                      ]),
                    )
                  }
                  return
                }
                if (localLayout && layoutProperty) {
                  if (id === '__inherit__') {
                    commit(
                      editDesignInstanceLayout(doc, localLayout.stored.id, {
                        [layoutProperty]: undefined,
                      }),
                    )
                    return
                  }
                  const numericBindings = Object.fromEntries(
                    Object.entries(
                      localLayout.stored.numericBindings ?? {},
                    ).filter(([key]) => key !== layoutProperty),
                  )
                  if (id) numericBindings[layoutProperty] = id
                  const fallback = id
                    ? (localLayout.stored.instanceLayout?.[layoutProperty] ??
                      effectiveValue(localLayout.root, layoutProperty))
                    : effectiveValue(localLayout.root, layoutProperty)
                  commit(
                    editDesignNodes(doc, [
                      {
                        id: localLayout.stored.id,
                        numericBindings,
                        instanceLayout: {
                          ...localLayout.stored.instanceLayout,
                          [layoutProperty]: fallback,
                        },
                      },
                    ]),
                  )
                  return
                }
                const numericBindings = Object.fromEntries(
                  Object.entries(node.numericBindings ?? {}).filter(
                    ([key]) => key !== property,
                  ),
                )
                if (id) numericBindings[property] = id
                patch({
                  numericBindings,
                  ...(!id ? { [property]: strokeProperty ? strokeValue(node, strokeProperty) : node[property] } : {}),
                  preserveLayout: false,
                })
              }}
            >
              {dormant || retainedBindingOption ? (
                <option value={binding} disabled>
                  {storedBindingToken
                    ? `${storedBindingToken.name} · ${storedBindingToken.value}`
                    : `${t('designerOwnValue')} · ${localLayout.stored.instanceLayout?.[layoutProperty]}`}
                  {dormant ? ` (${t('designerDormantLayoutOverride')})` : ''}
                </option>
              ) : null}
              {localStroke || localLayout || localSizing ? (
                <option value="__inherit__">{inheritLabel}</option>
              ) : null}
              <option value="">
                {t(
                  localStroke || localLayout || localSizing
                    ? 'designerOwnValue'
                    : 'designerNone',
                )}
              </option>
              {bindingNumbers
                .filter(v =>
                  designNumberTokenSupportsProperty(
                    doc,
                    v.id,
                    property,
                    localStroke?.root ?? localLayout?.root ?? node,
                  ),
                )
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.value}
                    {v.unit === 'px' ? t('designerPixels') : ''}
                  </option>
                ))}
            </select>
          </label>
          {dormant ? (
            <p role="status" className={css.hint}>
              {t('designerDormantGridGap')} {inheritLabel}
            </p>
          ) : null}
          <p className={css.hint}>{t('designerTokenBindingHint')}</p>
        </div>
      ) : null}
      <button type="button" onClick={importTokens}>
        {t('designerImportTokens')}
      </button>
      {notice ? (
        <p role="status" className={css.hint}>
          {notice}
        </p>
      ) : null}
      {review.length ? (
        <details className={css.tokenReview}>
          <summary>
            {t('designerTokenImportReview').replace(
              '{count}',
              String(review.length),
            )}
          </summary>
          <div className={css.tokenReviewList}>
            <ul>
              {review.slice(0, 100).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            {review.length > 100 ? (
              <p>
                {t('designerTokenImportOmitted').replace(
                  '{count}',
                  String(review.length - 100),
                )}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      <div className={css.tokenList}>
        {colors.map(v => (
          <div
            key={`${doc.id}:${doc.activeTokenModeId ?? 'base'}:${v.id}`}
            className={css.tokenRecord}
          >
            <div className={css.tokenColorRow}>
              <DesignerColorResource
                doc={doc} variable={v} colors={colors} t={t}
                commit={commitResources} preview={preview} cancelPreview={cancelPreview}
              />
              <span title={v.name}>{v.name}</span>
              {aliasControl('color', v)}
            </div>
          </div>
        ))}
        {numbers.map((v) => {
          const bounds = designNumberTokenBounds(doc, v.id)
          return (
            <div
              key={`${doc.id}:${doc.activeTokenModeId ?? 'base'}:${v.id}`}
              className={css.tokenRecord}
            >
              <div className={css.tokenNumberRow}>
                <span title={v.name}>{v.name}</span>
                <DesignerNumberField
                  label={v.name}
                  short={v.unit === 'px' ? 'px' : '#'}
                  min={bounds.min}
                  max={bounds.max}
                  value={v.value}
                  mixed={t('designerMixed')}
                  onCommit={(value) => {
                    const next = bounds.integer ? Math.round(value) : value
                    return commitResources(
                      setDesignNumberVariable(doc, v.id, {
                        value: next,
                        aliasId: null,
                        expression: null,
                      }),
                    )
                  }}
                />
                {aliasControl('number', v)}
              </div>
              <DesignerNumberExpression key={`${doc.id}:${doc.activeTokenModeId ?? 'base'}:${v.id}`} doc={doc} variable={v} inherited={!!activeMode && !!v.expression && !numberModeOverrides.get(v.id)?.expression} t={t} commit={commitResources} />
            </div>
          )
        })}
      </div>
      <div className={css.tokenCreate}>
        <input
          aria-label={t('designerNumberTokenName')}
          placeholder={t('designerNumberTokenName')}
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value)
          }}
        />
        <select
          aria-label={t('designerTokenUnit')}
          value={unit}
          onChange={(e) => {
            setUnit(e.currentTarget.value === 'px' ? 'px' : 'number')
          }}
        >
          <option value="px">{t('designerPixels')}</option>
          <option value="number">{t('designerUnitless')}</option>
        </select>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            commit({
              ...doc,
              numberVariables: [
                ...(doc.numberVariables ?? []),
                {
                  id: randomUUID(),
                  name: name.trim().slice(0, 120),
                  value: unit === 'px' ? 16 : 1,
                  unit,
                },
              ],
            })
            setName('')
          }}
        >
          {t('designerCreateToken')}
        </button>
      </div>
    </div>
  )
}
