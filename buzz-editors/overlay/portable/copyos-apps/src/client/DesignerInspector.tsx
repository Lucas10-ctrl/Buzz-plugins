import { DesignerFontVariations, editDesignerFontVariations } from './DesignerFontVariations.tsx'
/** Contextual inspector and local resource pickers for editable scene properties. */
import { DesignerFontFeatures, editDesignerFontFeatures } from './DesignerFontFeatures.tsx'
import { editDesignFontFeatures, designFontFeatureSettings, editDesignFontVariations, designFontVariationSettings } from '../../../copyos-domain/src/design-model.ts'
import { DesignerAutoLayoutAlignment } from './DesignerAutoLayoutAlignment.tsx'
import type { DesignAlignmentTarget, DesignAutoLayoutAlignmentIntent, DesignGridCellAlignmentIntent } from '../../../copyos-domain/src/design-model.ts'
import { DesignerPadding } from './DesignerPadding.tsx'
import type { DesignPaddingTarget, DesignPaddingValues } from '../../../copyos-domain/src/design-model.ts'
import { DesignerEffects } from './DesignerEffects.tsx'
import { DesignerLayerBlend } from './DesignerLayerBlend.tsx'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  CopyOSDesignImagePaint,
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignInstanceStroke,
  CopyOSStyleGuideDocument,
} from '../../../copyos-domain/src/types.ts'
import { DesignerAdvancedStroke } from './DesignerAdvancedStroke.tsx'
import { DesignerAspectRatio } from './DesignerAspectRatio.tsx'
import { DesignerSizingMenu } from './DesignerSizingMenu.tsx'
import { DesignerStrokeChoice } from './DesignerStrokeChoice.tsx'
import { designerStrokeItems, editDesignerStrokeSelection, uniformDesignerStrokeSelection } from './DesignerStrokeEdits.ts'
import { DesignerSelectionColors } from './DesignerSelectionColors.tsx'
import { DesignerInstanceOverrides } from './DesignerInstanceOverrides.tsx'
import { DesignerLayerNameField } from './DesignerLayerNameField.tsx'
import { DesignerVariants } from './DesignerVariants.tsx'
import { DesignerComponentProperties } from './DesignerComponentProperties.tsx'
import { DesignerInstanceSwap } from './DesignerInstanceSwap.tsx'
import { designerInstanceLayoutItems, editDesignerInstanceLayoutSelection, DesignerInstanceLayoutReset } from './DesignerInstanceLayout.tsx'
import { DesignerFontPicker } from './DesignerFontPicker.tsx'
import { designerFontLabels } from './DesignerFontLabels.ts'
import { editDesignerFontFamily } from './DesignerFontEdits.ts'
import { DesignerInstanceSizing, editDesignerInstanceSizingSelection } from './DesignerInstanceSizing.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import {
  resizeDesignAspectAxis,
  DESIGN_STROKE_KEYS,
  DESIGN_STROKE_NUMBER_KEYS,
  designStrokeWeights,
  designStrokeAlignmentSupported,
  designStrokeSupportsEdges,
  editDesignInstanceStroke,
  DESIGN_NODE_NAME_MAX_LENGTH,
  designAutoLayoutContext,
  designConstraintsActive,
  designTextStyleValues,
  designNodeModeId,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerBrandTextStyles, applyDesignerBrandTextStyle } from './DesignerBrandTextStyles.tsx'
import { DesignerTextStyleEditor } from './DesignerTextStyleEditor.tsx'
import { DesignerModeSelect } from './DesignerModeSelect.tsx'
import { DesignerConstraints } from './DesignerConstraints.tsx'
import { DesignerGrid, DesignerGridCell, DesignerDormantGridOverrides } from './DesignerGrid.tsx'
import { DesignerFills } from './DesignerFills.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
type SelectKey =
  | 'widthSizing'
  | 'heightSizing'
  | 'alignItems'
  | 'alignContent'
  | 'justifyContent'
  | 'textDecoration'
  | 'textCase'
  | 'verticalAlign'
  | 'textSizing'
  | 'strokeAlign'
type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Render selection-aware geometry, layout, appearance, typography and paint controls.
 * @param props - Scene, selected nodes, mutation callbacks and localized labels.
 * @returns Inspector sections; edits apply only to the given editable selection.
 */
export function DesignerInspector({
  doc,
  items: selectedItems,
  t,
  patch: patchFields,
  commit,
  preview,
  cancelPreview,
  layoutVersionControl,
  suggestionControl,
  suggestionOpen = false,
  dismissSuggestion,
  align,
  distribute,
  addLayout,
  removeLayout,
  setLayoutFlow,
  setLayoutAlignment,
  setCellAlignment,
  setPadding,
  editGradient,
  cropImage,
  swapComponent,
  goToMain,
  combineVariants,
  addVariant,
  dissolveVariants,
  workspaceTypography,
}: {
  doc: CopyOSDesignDocument
  workspaceTypography?: {
    workspaceId: string
    getStyleGuide: (workspaceId: string) => Promise<CopyOSStyleGuideDocument | undefined>
  } | undefined
  items: [CopyOSDesignNode, ...CopyOSDesignNode[]]
  t: Translate
  patch: (fields: Partial<CopyOSDesignNode>) => boolean | void
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  layoutVersionControl?: ReactNode
  suggestionControl?: ReactNode
  suggestionOpen?: boolean
  dismissSuggestion?: () => void
  align: (axis: 'x' | 'y', position: 'start' | 'center' | 'end') => void
  distribute: (axis: 'x' | 'y') => void
  addLayout: () => void
  removeLayout: (recursive?:boolean) => void
  setLayoutFlow: (flow: 'row' | 'column' | 'grid') => void
  setLayoutAlignment: (targets: readonly (string | DesignAlignmentTarget)[], intent: DesignAutoLayoutAlignmentIntent) => boolean
  setCellAlignment: (targets: readonly (string | DesignAlignmentTarget)[], intent: DesignGridCellAlignmentIntent) => boolean
  setPadding: (targets: readonly DesignPaddingTarget[], values: DesignPaddingValues) => boolean
  cropImage?:
    | ((
      paintId: string,
      metadata?: Pick<CopyOSDesignImagePaint, 'sourceWidth' | 'sourceHeight'>,
    ) => void)
    | undefined
  editGradient: (paintId: string, open: boolean, role?: 'fill' | 'stroke') => void
  swapComponent?: ((componentId: string) => void) | undefined
  goToMain?: ((componentId: string) => void) | undefined
  combineVariants?: (() => boolean | void) | undefined
  addVariant?: ((sourceId: string) => boolean | void) | undefined
  dissolveVariants?: (() => boolean | void) | undefined
}): ReactNode {
  const projected = useMemo(() => designerStrokeItems(doc, designerInstanceLayoutItems(doc, selectedItems)), [doc, selectedItems])
  const items: [CopyOSDesignNode, ...CopyOSDesignNode[]] = [projected[0] ?? selectedItems[0], ...projected.slice(1)]
  const node = items[0]
  const patch = (fields: Partial<CopyOSDesignNode>): boolean | void => {
    if (Object.keys(fields).some(key => DESIGN_STROKE_KEYS.some(property => property === key)))
      return commit(editDesignerStrokeSelection(doc, items, fields))
    const next = editDesignerInstanceSizingSelection(doc, items, fields) ?? editDesignerInstanceLayoutSelection(doc, items, fields)
    if (next) return next !== doc ? commit(next) : true
    return patchFields(fields)
  }
  const numericOwnerKey = (property: string): string => `${doc.id}:${items.map(item => item.id).join(',')}:${property}`
  const [resourceQuery, setResourceQuery] = useState('')
  const [styleName, setStyleName] = useState('')
  const common = <K extends keyof CopyOSDesignNode>(
    key: K,
  ): CopyOSDesignNode[K] | null =>
    items.every(n => n[key] === node[key]) ? node[key] : null
  const selectedWeight = common('fontWeight')
  const fontPreview = useRef<{
    document: CopyOSDesignDocument
    items: readonly CopyOSDesignNode[]
  } | null>(null)
  const previewFont = (family: string): void => {
    const original = fontPreview.current ?? { document: doc, items }
    fontPreview.current = original
    preview(editDesignerFontFamily(original.document, original.items, family))
  }
  const cancelFont = (): void => {
    if (!fontPreview.current) return
    fontPreview.current = null
    cancelPreview()
  }
  const commitFont = (family: string): void => {
    const original = fontPreview.current ?? { document: doc, items }
    fontPreview.current = null
    commit(editDesignerFontFamily(original.document, original.items, family))
  }
  const fieldIcons: Partial<Record<keyof CopyOSDesignNode, string>> = {
    opacity: 'opacity',
    radius: 'radius',
    radiusTopLeft: 'corner-tl',
    radiusTopRight: 'corner-tr',
    radiusBottomRight: 'corner-br',
    radiusBottomLeft: 'corner-bl',
    crossGap: 'gap',
    paddingTop: 'padding-top',
    paddingRight: 'padding-right',
    paddingBottom: 'padding-bottom',
    paddingLeft: 'padding-left',
    gap: 'gap',
    lineHeight: 'line-height',
    letterSpacing: 'letter-spacing',
  }
  const number = (
    key: keyof CopyOSDesignNode,
    label: CopyOSFoundationLocaleKey,
    short: string,
    fallback = 0,
    min = -100000,
    max = 100000,
    factor = 1,
    step = 1,
  ): ReactNode => {
    const automaticGap =
      key === 'gap' &&
      items.every(
        n =>
          ['row', 'column'].includes(n.layout) &&
          ['between', 'around', 'evenly'].includes(
            n.justifyContent ?? 'start',
          ) &&
          (n[n.layout === 'row' ? 'widthSizing' : 'heightSizing'] ?? 'hug') !==
            'hug',
      )
    const sizingBound = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key)
    const missingBound = sizingBound && items.some(n => n[key] === undefined)
    const emptyBound = sizingBound && items.every(n => n[key] === undefined)
    const values = items.map((n) => {
      const stored = n[key]
      const value =
        typeof stored === 'number'
          ? stored
          : key.startsWith('padding')
            ? n.padding
            : key.startsWith('radius')
              ? n.radius
              : key === 'crossGap'
                ? Math.max(0, n.gap)
                : fallback
      return value * (key === 'lineHeight' ? n.fontSize : factor)
    })
    return (
      <DesignerNumberField
        key={numericOwnerKey(key)}
        label={t(label)}
        caption={key !== 'width' && key !== 'height'}
        short={fieldIcons[key] ? <Icon name={fieldIcons[key]} /> : short}
        disabled={
          automaticGap ||
          (items.some(item => item.kind === 'boolean') && (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key) || items.length > 1 && ['width', 'height'].includes(key))) ||
          ((key === 'x' || key === 'y') &&
            items.every(
              n =>
                !n.absolutePosition &&
                doc.nodes.some(
                  p => p.id === n.parentId && p.layout !== 'none',
                ),
            ))
        }
        mixed={t(automaticGap ? 'designerAutomatic' : emptyBound ? 'designerNone' : 'designerMixed')}
        value={
          automaticGap || missingBound
            ? null
            : values.every(v => v === values[0])
              ? (values[0] ?? fallback)
              : null
        }
        min={
          min *
          (key === 'lineHeight'
            ? Math.max(...items.map(n => n.fontSize))
            : factor)
        }
        max={
          max *
          (key === 'lineHeight'
            ? Math.min(...items.map(n => n.fontSize))
            : factor)
        }
        step={step}
        commitUnchanged={items.some(n => n.kind === 'instance') && ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key)}
        onCommit={(value) => {
          if (key === 'width' || key === 'height') {
            const source = key !== 'height' ? doc : { ...doc, nodes: doc.nodes.map((node) => {
              const shown = items.find(item => item.id === node.id)
              return shown && node.pageLink?.autoHeight ? { ...node, height: shown.height,
                pageLink: { ...node.pageLink, autoHeight: false } } : node
            }) }
            return commit(resizeDesignAspectAxis(source, items.map(item => item.id), key, value / factor))
          }
          if (key === 'lineHeight') {
            const sizes = new Map(items.map(n => [n.id, n.fontSize]))
            return commit({
              ...doc,
              nodes: doc.nodes.map((n) => {
                const fontSize = sizes.get(n.id)
                return fontSize
                  ? {
                    ...n,
                    ...designTextStyleValues(
                      items.find(item => item.id === n.id) ?? n,
                    ),
                    textStyleId: null,
                    lineHeight: value / fontSize,
                    numericBindings: Object.fromEntries(
                      Object.entries(n.numericBindings ?? {}).filter(
                        ([key]) => key !== 'lineHeight',
                      ),
                    ),
                  }
                  : n
              }),
            })
          } else return patch({ [key]: value / factor })
        }}
      />
    )
  }
  const select = <K extends SelectKey>(
    key: K,
    label: CopyOSFoundationLocaleKey,
    options: readonly (readonly [
      NonNullable<CopyOSDesignNode[K]>,
      CopyOSFoundationLocaleKey,
    ])[],
    fallback: NonNullable<CopyOSDesignNode[K]>,
  ): ReactNode => (
    <label className={css.field}>
      <span
        hidden={
          label === 'designerStrokeAlignment' ||
          label === 'designerJustifyContent'
        }
      >
        {t(
          label === 'designerWidthSizing'
            ? 'designerShortWidth'
            : label === 'designerHeightSizing'
              ? 'designerShortHeight'
              : label === 'designerStrokeAlignment'
                ? 'designerNone'
                : label,
        )}
      </span>
      <select
        aria-label={t(label)}
        value={
          common(key) ??
          (items.every(n => n[key] === undefined) ? fallback : 'mixed')
        }
        onChange={(e) => {
          const value = e.currentTarget.value
          if (key === 'justifyContent' &&
            (value === 'start' || value === 'center' || value === 'end' ||
              value === 'between' || value === 'around' || value === 'evenly')) {
            setLayoutAlignment(items.map(item => item.id), { type: 'distribution', value })
            return
          }

          patch(
            key === 'textSizing'
              ? value === 'auto-width'
                ? {
                  textSizing: 'auto-width',
                  widthSizing: 'hug',
                  heightSizing: 'hug',
                }
                : value === 'auto-height'
                  ? {
                    textSizing: 'auto-height',
                    widthSizing:
                        node.widthSizing === 'fill' ? 'fill' : 'fixed',
                    heightSizing: 'hug',
                  }
                  : {
                    textSizing: 'fixed',
                    widthSizing:
                        node.widthSizing === 'fill' ? 'fill' : 'fixed',
                    heightSizing: 'fixed',
                  }
              : { [key]: value },
          )
        }}
      >
        <option value="mixed" disabled>
          {t('designerMixed')}
        </option>
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {t(name)}
          </option>
        ))}
      </select>
    </label>
  )
  const section = (
    title: CopyOSFoundationLocaleKey,
    children: ReactNode,
    action?: ReactNode,
  ): ReactNode => (
    <section
      className={`${css.propertySection} ${children ? '' : css.collapsedSection}`}
    >
      <div className={css.sectionHeading}>
        <h3>{t(title)}</h3>
        {action}
      </div>
      {children}
    </section>
  )
  const realContainer = items.every(n => ['frame', 'component', 'group'].includes(n.kind))
  const container = items.every(n => ['frame', 'component', 'group'].includes(n.kind) ||
    (n.kind === 'instance' && ['row', 'column', 'grid'].includes(n.layout)))
  const linkedLayout = items.some(n => n.kind === 'instance')
  const linkedGrid = linkedLayout && items.some(n => n.layout === 'grid')
  const text = items.every(n => n.kind === 'text')
  const parent = doc.nodes.find(n => n.id === node.parentId)
  const sizingOwner = numericOwnerKey('sizing-recovery')
  const retainedLimits = items.some(item => (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)
    .some(key => item[key] !== undefined || item.numericBindings?.[key] !== undefined))
  const [limitRecoveryOwner, setLimitRecoveryOwner] = useState<string | null>(null)
  useEffect(() => {
    if (retainedLimits) setLimitRecoveryOwner(sizingOwner)
    else if (limitRecoveryOwner !== sizingOwner) setLimitRecoveryOwner(null)
  }, [retainedLimits, sizingOwner, limitRecoveryOwner])
  const showSizing =
    retainedLimits || limitRecoveryOwner === sizingOwner ||
    container ||
    text ||
    items.every(n => n.kind === 'instance') ||
    (parent && parent.layout !== 'none')
  const constraintsAction =
    parent &&
    items.every(
      item =>
        item.kind !== 'group' &&
        item.parentId === parent.id &&
        designConstraintsActive(item, parent),
    ) ? (
        <DesignerConstraints doc={doc} items={items} t={t} commit={commit} />
      ) : null
  const sizing = (axis: 'width' | 'height'): ReactNode => <DesignerSizingMenu
    key={numericOwnerKey(`${axis}:sizing`)} doc={doc} items={items} axis={axis} t={t}
    commit={commit} preview={preview} cancelPreview={cancelPreview} />

  const sharedStyle = items.every(n => n.textStyleId === node.textStyleId)
  const textStyle = sharedStyle
    ? doc.textStyles?.find(s => s.id === node.textStyleId)
    : undefined
  const selectedIds = new Set(items.map(n => n.id))
  const layoutContext = designAutoLayoutContext(doc, items.map(item => item.id))
  const layoutAction = layoutContext.canRemove || (realContainer && node.layout !== 'none' && !layoutContext.canAdd) ? 'remove' : 'add'

  const strokeSides = [
    { side: 'top', key: 'strokeTopWidth', labelKey: 'designerStrokeTop', weightLabelKey: 'designerStrokeTopWeight' },
    { side: 'right', key: 'strokeRightWidth', labelKey: 'designerStrokeRight', weightLabelKey: 'designerStrokeRightWeight' },
    { side: 'bottom', key: 'strokeBottomWidth', labelKey: 'designerStrokeBottom', weightLabelKey: 'designerStrokeBottomWeight' },
    { side: 'left', key: 'strokeLeftWidth', labelKey: 'designerStrokeLeft', weightLabelKey: 'designerStrokeLeftWeight' },
  ] as const
  const edgeControls = items.every(designStrokeSupportsEdges)
  const hasStroke = items.some(n => n.strokeWidth > 0 || strokeSides.some(({ key }) => n[key] !== undefined))
  const [customStrokeOwner, setCustomStrokeOwner] = useState<string | null>(null)
  const strokePreset = (item: CopyOSDesignNode): string => {
    const weights = designStrokeWeights(item), active = strokeSides.filter(({ side }) => weights[side] > 0)
    if (active.length === 1) return active[0]?.side ?? 'custom'
    return strokeSides.some(({ key }) => item[key] !== undefined) ? 'custom' : 'all'
  }
  const presets = items.map(strokePreset)
  const currentStrokePreset = customStrokeOwner === numericOwnerKey('stroke') ? 'custom' : presets.every(value => value === presets[0]) ? presets[0] ?? 'all' : null
  const chooseStrokePreset = (value: string): boolean | void => {
    if (value === 'custom') { setCustomStrokeOwner(numericOwnerKey('stroke')); return true }
    setCustomStrokeOwner(null)
    if (value === 'all') return commit(uniformDesignerStrokeSelection(doc, items))
    const chosen = strokeSides.find(({ side }) => side === value)
    if (!chosen) return false
    let next = doc
    for (const item of items) {
      const weights = designStrokeWeights(item)
      const fields: Partial<CopyOSDesignInstanceStroke> = Object.fromEntries(
        strokeSides.filter(({ side }) => side !== value).map(({ key }) => [key, 0]),
      )
      if (weights[chosen.side] <= 0) fields[chosen.key] = item.strokeWidth || Math.max(...Object.values(weights)) || 1
      next = editDesignerStrokeSelection(next, [item], fields)
    }
    return commit(next)
  }
  const strokePositionSession = useRef<{ document: CopyOSDesignDocument; items: readonly CopyOSDesignNode[]; active: boolean } | null>(null)
  const cancelStrokePosition = (): void => {
    const session = strokePositionSession.current
    strokePositionSession.current = null
    if (session?.active) cancelPreview()
  }
  const positionItems = strokePositionSession.current?.items ?? items
  const strokePositionValue = positionItems.every(item => (item.strokeAlign ?? 'center') === (positionItems[0]?.strokeAlign ?? 'center')) ? positionItems[0]?.strokeAlign ?? 'center' : null
  const localStrokeInstances = items.filter(item => item.kind === 'instance').filter((item) => {
    const stored = doc.nodes.find(node => node.id === item.id)
    return !!stored && (Object.keys(stored.instanceStroke ?? {}).length > 0 ||
      DESIGN_STROKE_NUMBER_KEYS.some(key => !!stored.numericBindings?.[key]))
  })
  return (
    <>
      <div className={css.selectionHeader}>
        <Icon
          name={
            items.length > 1
              ? 'styles'
              : node.kind === 'instance'
                ? 'component'
                : node.kind === 'group'
                  ? 'frame'
                  : node.kind
          }
        />
        {items.length > 1 ? (
          <span>
            {t('designerSelectionCount').replace(
              '{count}',
              String(items.length),
            )}
          </span>
        ) : node.kind === 'component' && doc.nodes.some(parent => parent.id === node.parentId && parent.kind === 'component-set') ? (
          <DesignerLayerNameField
            key={node.id}
            value={node.name}
            label={t('designerLayerName')}
            maxLength={DESIGN_NODE_NAME_MAX_LENGTH}
            onCommit={name => patch({ name })}
          />
        ) : (
          <input
            aria-label={t('designerLayerName')}
            title={node.name}
            maxLength={DESIGN_NODE_NAME_MAX_LENGTH}
            value={node.name}
            onChange={(e) => {
              if (e.currentTarget.value.trim())
                patch({ name: e.currentTarget.value.slice(0, DESIGN_NODE_NAME_MAX_LENGTH) })
            }}
          />
        )}
      </div>
      {swapComponent && selectedItems.every(n => n.kind === 'instance') ? (
        <DesignerInstanceSwap
          doc={doc}
          items={selectedItems}
          t={t}
          onSwap={swapComponent}
          onGoToMain={goToMain}
        />
      ) : null}
      <DesignerVariants
        doc={doc}
        items={selectedItems}
        t={t}
        commit={commit}
        combineVariants={combineVariants}
        addVariant={addVariant}
        dissolveVariants={dissolveVariants}
      />
      <DesignerComponentProperties doc={doc} items={selectedItems} t={t} commit={commit} />
      <fieldset disabled={items.some(n => n.locked)}>
        {section(
          'designerPosition',
          <>
            <div className={css.alignment}>
              {parent?.layout === 'grid' && items.every(item => !item.absolutePosition) ?
                <DesignerAutoLayoutAlignment purpose="cell" document={doc} targets={items.map(item => item.id)} t={t}
                  onIntent={intent => setCellAlignment(items.map(item => item.id), intent)} /> :
                (['x', 'y'] as const).flatMap(axis =>
                  (['start', 'center', 'end'] as const).map((pos, i) => {
                    const labelKey =
                      axis === 'x'
                        ? ((
                          [
                            'designerAlignLeft',
                            'designerAlignCenterX',
                            'designerAlignRight',
                          ] as const
                        )[i] ?? 'designerAlignLeft')
                        : ((
                          [
                            'designerAlignTop',
                            'designerAlignCenterY',
                            'designerAlignBottom',
                          ] as const
                        )[i] ?? 'designerAlignLeft')
                    return (
                      <button
                        key={axis + pos}
                        type="button"
                        title={t(labelKey)}
                        aria-label={t(labelKey)}
                        aria-pressed={parent?.layout === 'grid' && items.every(item => !item.absolutePosition)
                          ? items.every(item => (item.gridCell?.[axis === 'x' ? 'horizontalAlign' : 'verticalAlign'] ?? 'start') === pos)
                          : undefined}
                        onClick={() => {
                          align(axis, pos)
                        }}
                      >
                        <Icon name={`align-${axis}-${pos}`} />
                      </button>
                    )
                  }),
                )}
              <button
                type="button"
                aria-label={t('designerDistributeX')}
                title={t('designerDistributeX')}
                disabled={
                  items.length < 3 ||
                  (parent?.layout !== 'none' &&
                    !!parent &&
                    !node.absolutePosition)
                }
                onClick={() => {
                  distribute('x')
                }}
              >
                <Icon name="distribute" />
              </button>
            </div>
            <div className={css.fieldGrid}>
              {number('x', 'designerX', 'X')}
              {number('y', 'designerY', 'Y')}
              {number('rotation', 'designerRotation', '∠')}
            </div>
            {parent?.layout !== 'none' && parent ? (
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={!!node.absolutePosition}
                  onChange={(e) => {
                    patch({ absolutePosition: e.currentTarget.checked })
                  }}
                />
                {t('designerAbsolutePosition')}
              </label>
            ) : null}
          </>,
          constraintsAction,
        )}
        {section(
          container && node.layout !== 'none'
            ? 'designerAutoLayout'
            : 'designerLayout',
          <>
            {realContainer && node.layout !== 'none' && node.preserveLayout ? (
              <button
                type="button"
                className={css.reflowImport}
                title={t('designerPreservedLayoutHint')}
                onClick={() => {
                  patch({ preserveLayout: false })
                }}
              >
                {t('designerReflowImport')}
              </button>
            ) : null}
            {container && node.layout !== 'none' && !linkedGrid ? (
              <div className={css.segmented}>
                {(['none', 'column', 'row', 'grid'] as const).filter(value => !linkedLayout || value === 'row' || value === 'column').map(
                  value => (
                    <button
                      key={value}
                      type="button"
                      aria-label={t(
                        value === 'none' ? 'designerNone' : value === 'column' ? 'designerVertical' :
                          value === 'row' ? 'designerHorizontal' : 'designerGrid',
                      )}
                      aria-pressed={common('layout') === value}
                      disabled={value==='none'&&!layoutContext.canRemove}
                      onClick={() => {
                        if (value === 'none') {
                          removeLayout()
                          return
                        }
                        setLayoutFlow(value)
                      }}
                    >
                      <Icon name={`layout-${value}`} />
                    </button>
                  ),
                )}
                <button
                  type="button"
                  aria-label={t('designerWrap')}
                  title={t('designerWrap')}
                  disabled={node.layout === 'grid'}
                  aria-pressed={
                    node.layout !== 'grid' && node.layoutWrap === 'wrap'
                  }
                  onClick={() => {
                    patch({
                      layoutWrap: node.layoutWrap === 'wrap' ? 'none' : 'wrap',
                    })
                  }}
                >
                  <Icon name="layout-none" />
                </button>
              </div>
            ) : null}
            <div className={css.dimensionGrid}>
              <div className={css.captionedField}>
                <div className={css.captionRow}>
                  <span className={css.fieldCaption} aria-hidden="true">{t('designerWidth')}</span>
                  {showSizing ? sizing('width') : null}
                </div>
                {number('width', 'designerWidth', 'W', 1, 1)}
              </div>
              <DesignerAspectRatio key={numericOwnerKey('targetAspectRatio')} doc={doc} items={items} t={t} commit={commit} />
              <div className={css.captionedField}>
                <div className={css.captionRow}>
                  <span className={css.fieldCaption} aria-hidden="true">{t('designerHeight')}</span>
                  {showSizing ? sizing('height') : null}
                </div>
                {number('height', 'designerHeight', 'H', 1, 1)}
              </div>
            </div>
            {items.every(item => item.kind === 'instance') ? <DesignerInstanceSizing doc={doc} items={items} t={t} commit={commit} /> : null}
            {parent?.layout === 'grid' &&
            !node.absolutePosition &&
            items.every(n => n.parentId === parent.id) ? (
                <DesignerGridCell
                  doc={doc}
                  parent={parent}
                  items={items}
                  t={t}
                  commit={commit}
                />
              ) : null}
            {container && node.layout !== 'none' ? (
              <>
                {items.some(item => item.layout === 'grid') ? (
                  items.length === 1 ? <DesignerGrid
                    key={`${doc.id}:${node.id}:grid`}
                    doc={doc}
                    node={node}
                    t={t}
                    commit={commit}
                    patch={patch}
                  /> : <>
                    <p className={css.hint}>{t('designerGridSingleSelection')}</p>
                    <div className={css.fieldGrid}>
                      {number('gap', 'designerGridColumnGap', '↔', node.gap, 0, 10000)}
                      {number('crossGap', 'designerGridRowGap', '↕', node.gap, 0, 10000)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={css.layoutAlignment}>
                      <DesignerAutoLayoutAlignment key={numericOwnerKey('alignment')}
                        document={doc} targets={items.map(item => item.id)} t={t}
                        onIntent={intent => setLayoutAlignment(items.map(item => item.id), intent)} />
                      <div>
                        {number('gap', 'designerGap', '↕', 16, -10000, 10000)}
                        {node.layoutWrap === 'wrap'
                          ? number(
                            'crossGap',
                            'designerCrossGap',
                            '↔',
                            node.gap,
                            0,
                            10000,
                          )
                          : null}
                        {select(
                          'justifyContent',
                          'designerJustifyContent',
                          [
                            ['start', 'designerStart'],
                            ['center', 'designerCenter'],
                            ['end', 'designerEnd'],
                            ['between', 'designerBetween'],
                            ['around', 'designerAround'],
                            ['evenly', 'designerEvenly'],
                          ],
                          'start',
                        )}
                      </div>
                    </div>
                    {node.layoutWrap === 'wrap'
                      ? select(
                        'alignContent',
                        'designerAlignLines',
                        [
                          ['start', 'designerStart'],
                          ['center', 'designerCenter'],
                          ['end', 'designerEnd'],
                          ['between', 'designerBetween'],
                          ['stretch', 'designerStretch'],
                        ],
                        'start',
                      )
                      : null}
                  </>
                )}
                <DesignerPadding key={numericOwnerKey('padding')} document={doc}
                  targets={items.map(item => ({ nodeId: item.id }))} t={t} onApply={setPadding}>
                  <div className={css.fieldGrid}>
                    {number(
                      'paddingTop',
                      'designerPaddingTop',
                      '↑',
                      node.padding,
                      0,
                      10000,
                    )}
                    {number(
                      'paddingRight',
                      'designerPaddingRight',
                      '→',
                      node.padding,
                      0,
                      10000,
                    )}
                    {number(
                      'paddingBottom',
                      'designerPaddingBottom',
                      '↓',
                      node.padding,
                      0,
                      10000,
                    )}
                    {number(
                      'paddingLeft',
                      'designerPaddingLeft',
                      '←',
                      node.padding,
                      0,
                      10000,
                    )}
                  </div>
                </DesignerPadding>
              </>
            ) : null}
            {realContainer ? (
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={node.clip}
                  onChange={(e) => {
                    patch({ clip: e.currentTarget.checked })
                  }}
                />
                {t('designerClip')}
              </label>
            ) : null}
            {linkedLayout ? <DesignerInstanceLayoutReset document={doc} selection={items} t={t} commit={commit} /> : null}
            <DesignerDormantGridOverrides doc={doc} items={items} t={t} commit={commit} />
            <DesignerPopover
              triggerClassName={css.layoutOptions}
              open={suggestionOpen ? true : undefined}
              onOpenChange={(value) => { if (!value && suggestionOpen) dismissSuggestion?.() }}
              onDismiss={dismissSuggestion}
              panelClassName={suggestionOpen ? css.layoutSuggestionPanel : undefined}
              label={t(suggestionOpen ? 'designerSuggestAutoLayout' : 'designerMoreLayout')}
              closeLabel={t('designerDone')}
              trigger={<Icon name="settings" />}
            >
              <div className={css.popoverContent}>
                {suggestionControl}
                {!suggestionOpen ? <>
                  {realContainer && node.layout !== 'none' ? (
                    <>
                      {layoutVersionControl}
                      <label className={css.field}>
                        <span>{t('designerInsideStrokeLayout')}</span>
                        <select
                          aria-label={t('designerInsideStrokeLayout')}
                          value={
                            items.every(
                              n =>
                                (n.strokesIncludedInLayout ??
                                n.layoutSizingModel === 'css') ===
                              (node.strokesIncludedInLayout ??
                                node.layoutSizingModel === 'css'),
                            )
                              ? (node.strokesIncludedInLayout ??
                              node.layoutSizingModel === 'css')
                                ? 'included'
                                : 'excluded'
                              : 'mixed'
                          }
                          onChange={(e) => {
                            patch({
                              strokesIncludedInLayout:
                              e.currentTarget.value === 'included',
                            })
                          }}
                        >
                          <option value="mixed" disabled hidden>
                            {t('designerMixed')}
                          </option>
                          <option value="included">
                            {t('designerIncludedLayout')}
                          </option>
                          <option value="excluded">
                            {t('designerExcludedLayout')}
                          </option>
                        </select>
                      </label>
                      <p className={css.hint}>{t('designerLayoutModelHint')}</p>
                    </>
                  ) : null}
                  {realContainer && items.every(n => ['row', 'column'].includes(n.layout)) ? (
                    <label className={css.field}>
                      <span>{t('designerCanvasStacking')}</span>
                      <select
                        aria-label={t('designerCanvasStacking')}
                        value={
                          items.every(
                            n =>
                              !!n.itemReverseZIndex === !!node.itemReverseZIndex,
                          )
                            ? node.itemReverseZIndex
                              ? 'first'
                              : 'last'
                            : 'mixed'
                        }
                        onChange={(e) => {
                          patch({
                            itemReverseZIndex: e.currentTarget.value === 'first',
                          })
                        }}
                      >
                        <option value="mixed" disabled hidden>
                          {t('designerMixed')}
                        </option>
                        <option value="last">{t('designerLastOnTop')}</option>
                        <option value="first">{t('designerFirstOnTop')}</option>
                      </select>
                    </label>
                  ) : null}
                  {node.layout !== 'grid' && (!linkedLayout || (container && !linkedGrid)) && select(
                    'alignItems',
                    'designerAlignItems',
                    [
                      ['start', 'designerStart'],
                      ['center', 'designerCenter'],
                      ['end', 'designerEnd'],
                      ...(items.every(n => n.layout === 'row')
                        ? [['baseline', 'designerTextBaseline'] as const]
                        : []),
                    ],
                    'start',
                  )}
                  {node.layout === 'row' && node.alignItems === 'baseline' ? (
                    <p className={css.hint}>{t('designerTextBaselineHint')}</p>
                  ) : null}
                  <button type="button" disabled={!layoutContext.canRemove} onClick={() => { removeLayout() }}>
                    {t('designerRemoveAutoLayout')}
                  </button>
                  <button type="button" disabled={!layoutContext.canRemoveAll} onClick={() => { removeLayout(true) }}>
                    {t('designerRemoveAllAutoLayout')}
                  </button>
                </> : null}
              </div>
            </DesignerPopover>
          </>,
          realContainer || layoutContext.canAdd ? (
            <button
              type="button"
              aria-label={t(
                layoutAction === 'add'
                  ? 'designerAddAutoLayout'
                  : 'designerRemoveAutoLayout',
              )}
              title={t(
                layoutAction === 'add'
                  ? 'designerAddAutoLayout'
                  : 'designerRemoveAutoLayout',
              )}
              disabled={layoutAction === 'add' ? !layoutContext.canAdd : !layoutContext.canRemove}
              onClick={() => { if (layoutAction === 'add') addLayout(); else removeLayout() }}
            >
              <Icon name={layoutAction === 'add' ? 'plus' : 'minus'} />
            </button>
          ) : undefined,
        )}
        {section(
          'designerAppearance',
          <>
            <DesignerLayerBlend key={numericOwnerKey('blendMode')} doc={doc}
              owners={items.map(item => ({ nodeId: item.id, locked: item.locked }))}
              t={t} commit={commit} preview={preview} cancelPreview={cancelPreview} />
            <DesignerModeSelect
              label={t('designerVariableMode')}
              doc={doc}
              value={node.tokenModeId}
              mixed={
                !items.every(
                  n => (n.tokenModeId ?? null) === (node.tokenModeId ?? null),
                )
              }
              inheritedModeId={designNodeModeId(
                {
                  ...doc,
                  nodes: doc.nodes.map(n =>
                    n.id === node.id ? { ...n, tokenModeId: null } : n,
                  ),
                },
                node.id,
              )}
              t={t}
              onChange={(tokenModeId) => {
                patch({ tokenModeId })
              }}
            />
            <div className={css.fieldGrid}>
              {number('opacity', 'designerOpacity', '◌', 1, 0, 1, 100)}
              {items.every(n =>
                ['rectangle', 'frame', 'component'].includes(n.kind),
              ) ? (
                  <DesignerNumberField
                    key={numericOwnerKey('radius')}
                    label={t('designerRadius')}
                    caption
                    short={<Icon name="radius" />}
                    mixed={t('designerMixed')}
                    value={(() => {
                      const values = items.flatMap(n => [
                        n.radiusTopLeft ?? n.radius,
                        n.radiusTopRight ?? n.radius,
                        n.radiusBottomRight ?? n.radius,
                        n.radiusBottomLeft ?? n.radius,
                      ])
                      return values.every(v => v === values[0])
                        ? (values[0] ?? 0)
                        : null
                    })()}
                    min={0}
                    max={100000}
                    onCommit={(radius) => {
                      return patch({ radius })
                    }}
                  />
                ) : null}
            </div>
          </>,
          items.every(n =>
            ['rectangle', 'frame', 'component'].includes(n.kind),
          ) ? (
              <DesignerPopover
                label={t('designerIndependentCorners')}
                closeLabel={t('designerDone')}
                trigger={<Icon name="radius" />}
              >
                <div className={css.popoverContent}>
                  <div className={css.fieldGrid}>
                    {number(
                      'radiusTopLeft',
                      'designerTopLeftRadius',
                      '⌜',
                      node.radius,
                      0,
                      100000,
                    )}
                    {number(
                      'radiusTopRight',
                      'designerTopRightRadius',
                      '⌝',
                      node.radius,
                      0,
                      100000,
                    )}
                    {number(
                      'radiusBottomLeft',
                      'designerBottomLeftRadius',
                      '⌞',
                      node.radius,
                      0,
                      100000,
                    )}
                    {number(
                      'radiusBottomRight',
                      'designerBottomRightRadius',
                      '⌟',
                      node.radius,
                      0,
                      100000,
                    )}
                  </div>
                </div>
              </DesignerPopover>
            ) : undefined,
        )}
        {text
          ? section(
            'designerTypography',
            <>
              <DesignerPopover
                triggerClassName={css.textStyleTrigger}
                label={t('designerTextStyles')}
                closeLabel={t('designerDone')}
                trigger={
                  <>
                    <span>{t('designerTypeSample')}</span>
                    <span>
                      {textStyle?.name ??
                          t(
                            sharedStyle
                              ? 'designerTextStyles'
                              : 'designerMixed',
                          )}
                    </span>
                    {textStyle ? (
                      <small>
                        {textStyle.fontSize}/
                        {Math.round(
                          textStyle.lineHeight * textStyle.fontSize,
                        )}
                      </small>
                    ) : null}
                  </>
                }
              >
                <div className={css.popoverContent}>
                  <input
                    aria-label={t('designerResourceSearch')}
                    placeholder={t('designerResourceSearch')}
                    value={resourceQuery}
                    onChange={(e) => {
                      setResourceQuery(e.currentTarget.value)
                    }}
                  />
                  <div className={css.resourceList}>
                    {workspaceTypography ? <DesignerBrandTextStyles {...workspaceTypography} query={resourceQuery} t={t}
                      onApply={(style) => { commit(applyDesignerBrandTextStyle(doc, items, style)) }} /> : null}
                    {workspaceTypography ? <strong>{t('designerLocalTextStyles')}</strong> : null}
                    {doc.textStyles
                      ?.filter(s =>
                        s.name
                          .toLowerCase()
                          .includes(resourceQuery.toLowerCase()),
                      )
                      .map(s => (
                        <button
                          type="button"
                          key={s.id}
                          aria-pressed={node.textStyleId === s.id}
                          onClick={() => {
                            patch({
                              ...designTextStyleValues(s),
                              textStyleId: s.id,
                            })
                          }}
                        >
                          <b>{t('designerTypeSample')}</b>
                          <span>{s.name}</span>
                          <small>
                            {s.fontSize}/
                            {Math.round(s.fontSize * s.lineHeight)}
                          </small>
                        </button>
                      ))}
                  </div>
                  <input
                    aria-label={t('designerStyleName')}
                    placeholder={t('designerStyleName')}
                    value={styleName}
                    onChange={(e) => {
                      setStyleName(e.currentTarget.value)
                    }}
                  />
                  <button
                    type="button"
                    disabled={!styleName.trim()}
                    onClick={() => {
                      const style = {
                        ...designTextStyleValues(node),
                        id: randomUUID(),
                        name: styleName.trim().slice(0, 200),
                      }
                      commit({
                        ...doc,
                        textStyles: [...(doc.textStyles ?? []), style],
                        nodes: doc.nodes.map(n =>
                          selectedIds.has(n.id)
                            ? { ...n, textStyleId: style.id }
                            : n,
                        ),
                      })
                      setStyleName('')
                    }}
                  >
                    {t('designerCreateStyle')}
                  </button>
                  {textStyle ? (
                    <>
                      <button
                        type="button"
                        disabled={
                          JSON.stringify(designTextStyleValues(node)) ===
                            JSON.stringify(designTextStyleValues(textStyle))
                        }
                        onClick={() => {
                          const values = designTextStyleValues(node)
                          commit({
                            ...doc,
                            textStyles: doc.textStyles?.map(s =>
                              s.id === textStyle.id ? { ...s, ...values } : s,
                            ),
                            nodes: doc.nodes.map(n =>
                              n.textStyleId === textStyle.id
                                ? { ...n, ...values }
                                : n,
                            ),
                          })
                        }}
                      >
                        {t('designerUpdateStyle')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const selected = new Map(
                            items.map(n => [n.id, n]),
                          )
                          commit({
                            ...doc,
                            nodes: doc.nodes.map((n) => {
                              const item = selected.get(n.id)
                              return item
                                ? {
                                  ...n,
                                  ...designTextStyleValues(item),
                                  textStyleId: null,
                                }
                                : n
                            }),
                          })
                        }}
                      >
                        {t('designerDetachStyle')}
                      </button>
                      <DesignerTextStyleEditor
                        doc={doc}
                        style={textStyle}
                        disabled={items.some(item => item.locked)}
                        t={t}
                        commit={commit}
                        preview={preview}
                        cancelPreview={cancelPreview}
                      />
                    </>
                  ) : null}
                </div>
              </DesignerPopover>
              {!textStyle ? (
                <>
                  <span className={css.fieldCaption} aria-hidden="true">{t('designerFont')}</span>
                  <label className={css.field}>
                    <DesignerFontPicker
                      value={common('fontFamily')}
                      families={[
                        ...doc.nodes
                          .filter(n => n.kind === 'text')
                          .map(n => n.fontFamily),
                        ...(doc.textStyles?.map(s => s.fontFamily) ?? []),
                      ]}
                      labels={designerFontLabels(t)}
                      selectionKey={`${doc.id}:${items.map(n => n.id).join(',')}`}
                      onPreview={previewFont}
                      onCancelPreview={cancelFont}
                      onCommit={commitFont}
                    />
                  </label>
                  <div className={css.fieldGrid}>
                    <label className={css.captionedField}>
                      <span className={css.fieldCaption}>{t('designerFontWeight')}</span>
                      <span className={css.field}>
                        <select
                          aria-label={t('designerFontWeight')}
                          value={common('fontWeight') ?? 'mixed'}
                          onChange={(e) => {
                            patch({
                              fontWeight: Number(e.currentTarget.value),
                            })
                          }}
                        >
                          <option value="mixed" disabled>
                            {t('designerMixed')}
                          </option>
                          {selectedWeight !== null &&
                          ![
                            100, 200, 300, 400, 500, 600, 700, 800, 900,
                          ].includes(selectedWeight) ? (
                              <option value={selectedWeight}>
                                {selectedWeight}
                              </option>
                            ) : null}
                          {(
                            [
                              100, 200, 300, 400, 500, 600, 700, 800, 900,
                            ] as const
                          ).map((weight, i) => (
                            <option key={weight} value={weight}>
                              {t(
                                (
                                  [
                                    'designerWeightThin',
                                    'designerWeightExtraLight',
                                    'designerWeightLight',
                                    'designerWeightRegular',
                                    'designerWeightMedium',
                                    'designerWeightSemiBold',
                                    'designerWeightBold',
                                    'designerWeightExtraBold',
                                    'designerWeightBlack',
                                  ] as const
                                )[i] ?? 'designerWeightRegular',
                              )}
                            </option>
                          ))}
                        </select>
                      </span>
                    </label>
                    {number(
                      'fontSize',
                      'designerFontSize',
                      'Aa',
                      32,
                      1,
                      1000,
                    )}
                    {number(
                      'lineHeight',
                      'designerLineHeight',
                      '↕',
                      1.3,
                      0.5,
                      10,
                      node.fontSize,
                    )}
                    {number(
                      'letterSpacing',
                      'designerLetterSpacing',
                      '↔',
                      0,
                      -1000,
                      1000,
                    )}
                    {number(
                      'paragraphSpacing',
                      'designerParagraphSpacing',
                      '¶',
                      0,
                      0,
                      10000,
                    )}
                  </div>
                </>
              ) : null}
              <div className={css.segmented}>
                {(['left', 'center', 'right'] as const).map((align, i) => (
                  <button
                    type="button"
                    key={align}
                    aria-label={t(
                      (
                        [
                          'designerAlignLeft',
                          'designerCenter',
                          'designerAlignRight',
                        ] as const
                      )[i] ?? 'designerAlignLeft',
                    )}
                    aria-pressed={common('textAlign') === align}
                    onClick={() => {
                      patch({ textAlign: align })
                    }}
                  >
                    <Icon name={`text-${align}`} />
                  </button>
                ))}
                <span className={css.smallDivider} />
                {(['top', 'center', 'bottom'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${t('designerVerticalAlign')} ${value}`}
                    aria-pressed={(node.verticalAlign ?? 'top') === value}
                    onClick={() => {
                      patch({ verticalAlign: value })
                    }}
                  >
                    <Icon name={`vertical-${value}`} />
                  </button>
                ))}
                <DesignerPopover
                  label={t('designerTypeSettings')}
                  closeLabel={t('designerDone')}
                  trigger={<Icon name="settings" />}
                >
                  <div className={css.popoverContent}>
                    <DesignerFontFeatures values={items.map(item => item.fontFeatures)}
                      selectionKey={numericOwnerKey('fontFeatures')} disabled={items.some(item => item.locked)} t={t}
                      onApply={(change) => {
                        let next = doc
                        for (const item of items)
                          next = editDesignFontFeatures(next, item.id, [], editDesignerFontFeatures(item.fontFeatures, change) ?? null)
                        return commit(next)
                      }} />
                    <DesignerFontVariations values={items.map(item => item.fontVariations)} fonts={items}
                      selectionKey={numericOwnerKey('fontVariations')} disabled={items.some(item => item.locked)} t={t}
                      onApply={(change) => {
                        let next = doc
                        for (const item of items)
                          next = editDesignFontVariations(next, item.id, [],
                            editDesignerFontVariations(item.fontVariations, change) ?? null)
                        return commit(next)
                      }} />
                    <div
                      className={css.typePreview}
                      style={{
                        fontFamily: node.fontFamily,
                        fontFeatureSettings: designFontFeatureSettings(node.fontFeatures),
                        fontVariationSettings: designFontVariationSettings(node.fontVariations),
                        fontStyle: node.fontStyle,
                        textDecoration: node.textDecoration,
                        textTransform: node.textCase,
                      }}
                    >
                      {node.text.slice(0, 100)}
                    </div>
                    <label className={css.check}>
                      <input
                        type="checkbox"
                        checked={node.fontStyle === 'italic'}
                        onChange={(e) => {
                          patch({
                            fontStyle: e.currentTarget.checked
                              ? 'italic'
                              : 'normal',
                          })
                        }}
                      />
                      {t('designerItalic')}
                    </label>
                    {select(
                      'textDecoration',
                      'designerDecoration',
                      [
                        ['none', 'designerNone'],
                        ['underline', 'designerUnderline'],
                        ['line-through', 'designerStrike'],
                      ],
                      'none',
                    )}
                    {select(
                      'textCase',
                      'designerTextCase',
                      [
                        ['none', 'designerNone'],
                        ['uppercase', 'designerUppercase'],
                        ['lowercase', 'designerLowercase'],
                        ['capitalize', 'designerCapitalize'],
                      ],
                      'none',
                    )}
                    {select(
                      'verticalAlign',
                      'designerVerticalAlign',
                      [
                        ['top', 'designerAlignTop'],
                        ['center', 'designerCenter'],
                        ['bottom', 'designerAlignBottom'],
                      ],
                      'top',
                    )}
                    {select(
                      'textSizing',
                      'designerTextSizing',
                      [
                        ['fixed', 'designerFixed'],
                        ['auto-width', 'designerAutoWidth'],
                        ['auto-height', 'designerAutoHeight'],
                      ],
                      'fixed',
                    )}
                    <label className={css.check}>
                      <input
                        type="checkbox"
                        checked={items.every(
                          n => n.textTruncation === 'ending',
                        )}
                        ref={(input) => {
                          if (input)
                            input.indeterminate =
                              common('textTruncation') === null
                        }}
                        onChange={(e) => {
                          patch({
                            textTruncation: e.currentTarget.checked
                              ? 'ending'
                              : 'disabled',
                          })
                        }}
                      />
                      {t('designerTextTruncation')}
                    </label>
                    {items.every(n => n.textTruncation === 'ending') ? (
                      <>
                        <label className={css.check}>
                          <input
                            type="checkbox"
                            checked={items.every(n => n.maxLines != null)}
                            ref={(input) => {
                              if (input)
                                input.indeterminate =
                                  items.some(n => n.maxLines != null) &&
                                    !items.every(n => n.maxLines != null)
                            }}
                            onChange={(e) => {
                              patch({
                                maxLines: e.currentTarget.checked ? 1 : null,
                              })
                            }}
                          />
                          {t('designerLimitLines')}
                        </label>
                        {items.every(n => n.maxLines != null) ? (
                          <DesignerNumberField
                            key={numericOwnerKey('maxLines')}
                            label={t('designerMaxLines')}
                            short={t('designerMaxLines')}
                            value={common('maxLines') ?? null}
                            mixed={t('designerMixed')}
                            min={1}
                            max={100000}
                            onCommit={(value) => {
                              return patch({ maxLines: Math.round(value) })
                            }}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </DesignerPopover>
              </div>
            </>,
          )
          : null}
        {node.kind !== 'instance' ? (
          <DesignerFills
            cropImage={cropImage}
            key={`${doc.id}:${items.map(n => n.id).join(',')}`}
            doc={doc}
            items={items}
            t={t}
            commit={commit}
            preview={preview}
            cancelPreview={cancelPreview}
            editGradient={editGradient}
          />
        ) : null}
        <DesignerFills key={`${numericOwnerKey('stroke')}:paints`} paintRole="stroke" doc={doc} items={items} t={t}
          commit={commit} preview={preview} cancelPreview={cancelPreview} editGradient={editGradient}
          extraActions={<>
            {hasStroke ? <DesignerAdvancedStroke key={numericOwnerKey('strokeAdvanced')} doc={doc} items={items}
              t={t} commit={commit} preview={preview} cancelPreview={cancelPreview} /> : null}
            {items.some(item => item.kind === 'instance' && doc.nodes.find(n => n.id === item.id)?.instanceStroke?.strokes !== undefined) ? <button type="button" aria-label={t('designerResetStrokePaints')} title={t('designerResetStrokePaints')}
              onClick={() => { let next = doc; for (const item of items) if (item.kind === 'instance' && !item.locked) next = editDesignInstanceStroke(next, item.id, { strokes: undefined }); commit(next) }}><Icon name="undo" /></button> : null}
            {localStrokeInstances.length ? <button type="button" aria-label={t('designerResetStrokeOverrides')} title={t('designerResetStrokeOverrides')}
              onClick={() => { let next = doc; for (const item of localStrokeInstances) if (!item.locked) next = editDesignInstanceStroke(next, item.id, null); commit(next) }}><Icon name="undo" /></button> : null}
            <button type="button" aria-label={t('designerStroke')} onClick={() => { patch({ strokeWidth: hasStroke ? 0 : 1 }) }}><Icon name={hasStroke ? 'minus' : 'plus'} /></button>
          </>}>
          {hasStroke ? <>
            {number('strokeOpacity', 'designerStrokeOpacity', '%', 1, 0, 1, 100)}
            <div className={css.fieldGrid}>
              {node.kind !== 'text' && items.every(designStrokeAlignmentSupported) ? (
                <DesignerStrokeChoice key={numericOwnerKey('strokeAlign')} label={t('designerStrokeAlignment')} caption mixed={t('designerMixed')}
                  value={strokePositionValue} choices={[
                    { id: 'inside', label: t('designerInside') }, { id: 'center', label: t('designerCenter') }, { id: 'outside', label: t('designerOutside') },
                  ]}
                  onBegin={() => { strokePositionSession.current = { document: doc, items, active: false } }}
                  onPreview={(value) => {
                    const session = strokePositionSession.current
                    if (!session || (value !== 'inside' && value !== 'center' && value !== 'outside')) return
                    session.active = true
                    preview(editDesignerStrokeSelection(session.document, session.items, { strokeAlign: value }))
                  }}
                  onCommit={(value) => {
                    if (value !== 'inside' && value !== 'center' && value !== 'outside') return false
                    const source = strokePositionSession.current ?? { document: doc, items }
                    const accepted = commit(editDesignerStrokeSelection(source.document, source.items, { strokeAlign: value }))
                    if (accepted !== false) strokePositionSession.current = null
                    return accepted
                  }}
                  onCancel={cancelStrokePosition} />
              ) : null}
              <DesignerNumberField key={numericOwnerKey('strokeWidth')} label={t('designerStrokeWidth')} caption short="☰" mixed={t('designerMixed')}
                min={0} max={1000} value={(() => {
                  const values = items.flatMap(item => Object.values(designStrokeWeights(item)))
                  return values.every(value => value === values[0]) ? values[0] ?? 0 : null
                })()}
                commitUnchanged={items.some(item => item.kind === 'instance' || strokeSides.some(({ key }) => item[key] !== undefined))}
                onCommit={strokeWidth => patch({ strokeWidth })} />
            </div>
            {edgeControls ? (
              <>
                <DesignerStrokeChoice key={numericOwnerKey('strokeSides')} label={t('designerIndividualStrokes')} caption mixed={t('designerMixed')}
                  value={currentStrokePreset} choices={[
                    { id: 'all', label: t('designerStrokeAll') }, ...strokeSides.map(({ side, labelKey }) => ({ id: side, label: t(labelKey) })),
                    { id: 'custom', label: t('designerCustom') },
                  ]} onCommit={chooseStrokePreset} />
                {currentStrokePreset === 'custom' ? <div className={css.fieldGrid}>
                  {strokeSides.map(({ side, key, weightLabelKey }) => {
                    const values = items.map(item => designStrokeWeights(item)[side])
                    return <DesignerNumberField key={numericOwnerKey(key)} label={t(weightLabelKey)} caption short={<Icon name={`padding-${side}`} />}
                      value={values.every(value => value === values[0]) ? values[0] ?? 0 : null} mixed={t('designerMixed')} min={0} max={1000}
                      commitUnchanged={items.some(item => item.kind === 'instance')}
                      onCommit={value => patch({ [key]: value })} />
                  })}
                </div> : null}
              </>
            ) : null}

          </> : null}
        </DesignerFills>
        <DesignerEffects key={numericOwnerKey('effects')} doc={doc}
          owners={items.map(item => ({ nodeId: item.id, locked: item.locked }))}
          t={t} commit={commit} preview={preview} cancelPreview={cancelPreview} />
        {node.kind === 'instance' ? (
          <>
            <p className={css.hint}>{t('designerLinkedInstance')}</p>
            {items.length === 1 ? (
              <DesignerInstanceOverrides
                key={node.id}
                doc={doc}
                node={node}
                t={t}
                patch={patch}
              />
            ) : null}
          </>
        ) : null}
      </fieldset>
      {!items.some(n => n.locked)
        ? section(
          'designerSelectionColors',
          <DesignerSelectionColors
            doc={doc}
            selection={items.map(n => n.id)}
            t={t}
            commit={commit}
            preview={preview}
            cancelPreview={cancelPreview}
          />,
        )
        : null}
    </>
  )
}
