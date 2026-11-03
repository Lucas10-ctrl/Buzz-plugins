/** Ordered solid and gradient paints retain the same representation in the editor and exports. */
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CopyOSDesignPaintBlendMode,
  CopyOSDesignImagePaint,
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignPaint,
  CopyOSDesignGradient,
} from '../../../copyos-domain/src/types.ts'
import {
  DESIGN_PAINT_BLEND_MODES,
  designNodePaints,
  designAuthoredStrokePaints,
  designStrokeWeights,
  resolveDesignModeColors,
  designModeResources,
  designNodeModeId,
  designPaintImage,
  designGradientAtAngle,
} from '../../../copyos-domain/src/design-model.ts'
import { designerStrokeItems, editDesignerStrokeSelection } from './DesignerStrokeEdits.ts'
import { DesignerHexField } from './DesignerHexField.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { designerPaintColorEdit } from './DesignerPaintColor.ts'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerImagePaintEditor } from './DesignerImagePaintEditor.tsx'
import { DesignerGradientEditor } from './DesignerGradientEditor.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { designerBlendLabels } from './DesignerBlendLabels.ts'
import { useDesignerImageData } from './DesignerImageAssets.ts'
import css from './PageDesignerWorkspace.module.css'

// Image swatches URL-encode the whole embedded raster. Legacy image layers rebuild their paint object on every render, so the
// cache is keyed by the image URL plus every other swatch input, and holds the 16 most recent swatches.
const imageSwatches = new Map<string, { key: string; value: string }>()
function paintSwatch(paint: CopyOSDesignPaint, colors: Parameters<typeof designPaintImage>[1], width: number, height: number,
  numbers: Parameters<typeof designPaintImage>[4]): string {
  if (!paint.image) return designPaintImage(paint, colors, width, height, numbers)
  const key = JSON.stringify([width, height, paint.opacity, { ...paint.image, url: '' }])
  const cached = imageSwatches.get(paint.image.url)
  if (cached?.key === key) return cached.value
  const value = designPaintImage(paint, colors, width, height, numbers)
  imageSwatches.delete(paint.image.url); imageSwatches.set(paint.image.url, { key, value })
  for (const url of imageSwatches.keys()) { if (imageSwatches.size <= 16) break; imageSwatches.delete(url) }
  return value
}
// Swatches are SVG data images, which cannot load other URLs, so a project image reference is read as embedded data first.
function PaintSwatch({ paint, colors, width, height, numbers }: {
  paint: CopyOSDesignPaint
  colors: Parameters<typeof designPaintImage>[1]
  width: number
  height: number
  numbers: Parameters<typeof designPaintImage>[4]
}): ReactNode {
  const data = useDesignerImageData(paint.image?.url ?? '')
  const shown = paint.image && data !== paint.image.url ? { ...paint, image: { ...paint.image, url: data } } : paint
  return <DesignerSwatch className={css.paintPreview} paint={paintSwatch(shown, colors, width, height, numbers)} />
}

/** Render fill or stroke stacks, paint pickers and structural commands.
 * @param props - Selected layers, resources and shared document transactions.
 * @returns The inspector's Fill or Stroke section.
 */
export function DesignerFills({
  doc,
  items,
  t,
  commit,
  preview,
  cancelPreview,
  editGradient,
  cropImage,
  paintRole = 'fill',
  children,
  extraActions,
}: {
  doc: CopyOSDesignDocument
  items: [CopyOSDesignNode, ...CopyOSDesignNode[]]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  cropImage?:
    | ((
      paintId: string,
      metadata?: Pick<CopyOSDesignImagePaint, 'sourceWidth' | 'sourceHeight'>,
    ) => void)
    | undefined
  paintRole?: 'fill' | 'stroke'
  children?: ReactNode
  extraActions?: ReactNode
  editGradient: (paintId: string, open: boolean, role?: 'fill' | 'stroke') => void
}): ReactNode {
  const stroke = paintRole === 'stroke'
  const readPaints = (node: CopyOSDesignNode, source = doc): CopyOSDesignPaint[] =>
    stroke
      ? node.strokes === undefined &&
        Object.values(designStrokeWeights(node)).every(value => value === 0)
        ? []
        : designAuthoredStrokePaints(source, node.id)
      : designNodePaints(node)
  const paintLabel = t(stroke ? 'designerStroke' : 'designerFill')
  const colorOrigin = useRef<CopyOSDesignDocument | null>(null)
  const cancelColorPreview = (): void => {
    colorOrigin.current = null
    cancelPreview()
  }
  const node = items[0],
    paints = readPaints(node)
  const resolvedColors = resolveDesignModeColors(doc, designNodeModeId(doc, node.id))
  const [cropCloseKey, setCropCloseKey] = useState(0)
  const [menu, setMenu] = useState<string | null>(null)
  const [newImage, setNewImage] = useState<string | null>(null)
  const [tokenSession, setTokenSession] = useState<{ paintId: string; name: string } | null>(null)
  const compatible = items.every(n => readPaints(n).length === paints.length)
  const ids = new Set(items.filter(n => !n.locked).map(n => n.id))
  const change = (
    modify: (paints: CopyOSDesignPaint[], node: CopyOSDesignNode) => CopyOSDesignPaint[],
    transient = false,
    source = doc,
    ensureStroke = false,
  ): boolean | void => {
    if (stroke) {
      const selected = designerStrokeItems(
        source,
        source.nodes.filter(n => ids.has(n.id)).map(n => ({ ...n, locked: false })),
      )
      let next = source
      for (const current of selected)
        next = editDesignerStrokeSelection(next, [current], {
          strokes: modify(readPaints(current, source), current),
          ...(ensureStroke &&
          Object.values(designStrokeWeights(current)).every(value => value === 0)
            ? { strokeWidth: 1 }
            : {}),
        })
      if (transient) {
        preview(next)
        return
      }
      return commit(next)
    }
    const next = {
      ...source,
      nodes: source.nodes.map(n =>
        ids.has(n.id)
          ? {
            ...n,
            gradient: undefined,
            fills: modify(readPaints(n), items.find(item => item.id === n.id) ?? n),
          }
          : n,
      ),
    }
    if (transient) {
      preview(next)
      return
    }
    return commit(next)
  }
  const setPaint = (
    index: number,
    fields: Partial<CopyOSDesignPaint>,
    transient = false,
  ): boolean | void => {
    if (!transient) colorOrigin.current = null
    return change(own => own.map((p, i) => (i === index ? { ...p, ...fields } : p)), transient)
  }
  const editColor = (index: number, color: string, opacity: number, transient = false): void => {
    if (transient) colorOrigin.current ??= doc
    const source = colorOrigin.current ?? doc
    change(
      (own, layer) => {
        const colors = resolveDesignModeColors(source, designNodeModeId(source, layer.id))
        return own.map((paint, i) =>
          i === index
            ? {
              ...paint,
              ...designerPaintColorEdit(
                paint,
                colors.find(v => v.id === paint.variableId),
                color,
                opacity,
              ),
            }
            : paint,
        )
      },
      transient,
      source,
    )
    if (!transient) colorOrigin.current = null
  }
  const close = (): void => {
    cancelColorPreview()
    setNewImage(null)
    setTokenSession(null)
  }
  const colorFor = (paint: CopyOSDesignPaint): string =>
    resolvedColors.find(v => v.id === paint.variableId)?.value ?? paint.color
  const opacityFor = (paint: CopyOSDesignPaint): number =>
    paint.opacity * (resolvedColors.find(v => v.id === paint.variableId)?.alpha ?? 1)
  const picker = (paint: CopyOSDesignPaint, index: number, library = false): ReactNode => (
    <>
      <label className={`${css.paintType} ${css.paintBlend}`}>
        <span>{t('designerPaintBlendMode')}</span>
        <select
          aria-label={t('designerPaintBlendMode')}
          value={
            items.every(
              n => (readPaints(n)[index]?.blendMode ?? 'normal') === (paint.blendMode ?? 'normal'),
            )
              ? (paint.blendMode ?? 'normal')
              : ''
          }
          onChange={(event) => {
            const source = colorOrigin.current ?? doc
            colorOrigin.current = null
            const blendMode = event.currentTarget.value as CopyOSDesignPaintBlendMode
            change(
              own => own.map((paint, i) => (i === index ? { ...paint, blendMode } : paint)),
              false,
              source,
            )
          }}
        >
          <option value="" disabled>
            {t('designerMixed')}
          </option>
          {DESIGN_PAINT_BLEND_MODES.map(mode => (
            <option key={mode} value={mode}>
              {t(designerBlendLabels[mode])}
            </option>
          ))}
        </select>
      </label>
      {!library ? (
        <label className={css.paintType}>
          <span>{t('designerPaintType')}</span>
          <select
            aria-label={t('designerPaintType')}
            value={
              paint.image || newImage === paint.id ? 'image' : (paint.gradient?.type ?? 'solid')
            }
            onChange={(e) => {
              const kind = e.currentTarget.value
              setNewImage(kind === 'image' ? paint.id : null)
              if (kind === 'solid') {
                const stop = paint.gradient?.stops[0]
                setPaint(index, {
                  gradient: undefined,
                  image: undefined,
                  color: stop
                    ? stroke
                      ? stop.color
                      : (resolvedColors.find(v => v.id === stop.variableId)?.value ?? stop.color)
                    : paint.color,
                  variableId: stop?.variableId ?? null,
                })
              } else if (kind === 'linear' || kind === 'radial') {
                const gradient: CopyOSDesignGradient = paint.gradient
                  ? { ...paint.gradient, type: kind }
                  : {
                    type: kind,
                    transform:
                        kind === 'linear'
                          ? designGradientAtAngle(0, node.width, node.height)
                          : [1, 0, 0, 1, 0, 0],
                    stops: [
                      {
                        id: randomUUID(),
                        position: 0,
                        color: stroke ? paint.color : colorFor(paint),
                        variableId: paint.variableId,
                        opacity: 1,
                      },
                      {
                        id: randomUUID(),
                        position: 1,
                        color:
                            colorFor(paint).toLowerCase() === '#ffffff' ? '#7564ed' : '#ffffff',
                        opacity: 1,
                      },
                    ],
                  }
                setPaint(index, {
                  gradient,
                  image: undefined,
                  variableId: null,
                })
                editGradient(paint.id, true, paintRole)
              }
            }}
          >
            <option value="solid">{t('designerSolid')}</option>
            <option value="linear">{t('designerLinearGradient')}</option>
            <option value="radial">{t('designerRadialGradient')}</option>
            <option value="image">{t('designerImage')}</option>
          </select>
        </label>
      ) : null}
      {(paint.image || newImage === paint.id) && !library ? (
        <DesignerImagePaintEditor
          key={items.map(n => n.id).join(':') + ':' + paint.id}
          storeImages={!items.some(n => n.kind === 'text')}
          onCrop={
            !stroke && cropImage && items.length === 1 && !['instance', 'text'].includes(node.kind)
              ? (metadata) => {
                setCropCloseKey(v => v + 1)
                cropImage(paint.id, metadata)
              }
              : undefined
          }
          image={paint.image}
          images={items.flatMap((n) => {
            const image = readPaints(n)[index]?.image
            return image ? [image] : []
          })}
          width={node.width}
          height={node.height}
          onCancel={cancelColorPreview}
          onAdjust={(settings, transient, dimensions) => {
            change(
              (own, currentNode) =>
                own.map((p, i) =>
                  i === index && p.image
                    ? {
                      ...p,
                      image: {
                        ...p.image,
                        ...(p.image.sourceWidth && p.image.sourceHeight
                          ? {}
                          : dimensions?.get(p.image.url)),
                        ...(typeof settings === 'function'
                          ? settings(
                            { ...p.image, ...dimensions?.get(p.image.url) },
                            currentNode.width,
                            currentNode.height,
                          )
                          : settings),
                      },
                    }
                    : p,
                ),
              transient,
            )
          }}
          mixedSource={items.some(n => readPaints(n)[index]?.image?.url !== paint.image?.url)}
          mixedSizing={items.some(
            n => readPaints(n)[index]?.image?.scaleMode !== paint.image?.scaleMode,
          )}
          sizingEnabled={items.every(n => !!readPaints(n)[index]?.image)}
          onSizing={(scaleMode, dimensions) => {
            change(own =>
              own.map((p, i) =>
                i === index && p.image
                  ? {
                    ...p,
                    image: {
                      ...p.image,
                      ...(p.image.sourceWidth && p.image.sourceHeight
                        ? {}
                        : dimensions.get(p.image.url)),
                      scaleMode,
                    },
                  }
                  : p,
              ),
            )
          }}
          t={t}
          onCommit={(image) => {
            setPaint(index, { image, gradient: undefined, variableId: null })
            editGradient(paint.id, false, paintRole)
          }}
        />
      ) : paint.gradient && !library ? (
        <DesignerGradientEditor
          key={paint.id + paint.gradient.type}
          gradient={paint.gradient}
          width={node.width}
          height={node.height}
          resources={resolvedColors}
          t={t}
          onPreview={(gradient) => {
            setPaint(index, { gradient }, true)
          }}
          onCommit={(gradient) => {
            setPaint(index, { gradient })
          }}
          onCancel={cancelColorPreview}
        />
      ) : (
        <>
          <DesignerColorPicker
            key={paint.id + (library ? 'library' : '')}
            color={colorFor(paint)}
            opacity={opacityFor(paint)}
            opacityLabel={t(stroke ? 'designerStrokePaintOpacity' : 'designerFillOpacity')}
            resources={resolvedColors}
            initialTab={library ? 'libraries' : 'custom'}
            t={t}
            onPreview={(color, opacity) => {
              editColor(index, color, opacity, true)
            }}
            onCommit={(color, opacity) => {
              editColor(index, color, opacity)
            }}
            onCancel={cancelColorPreview}
            onVariable={(variable) => {
              setPaint(index, {
                color: variable.value,
                variableId: variable.id,
                gradient: undefined,
                image: undefined,
              })
            }}
          />
          {items.some(n => readPaints(n)[index]?.variableId) ? (
            <button
              type="button"
              className={css.detachPaint}
              onClick={() => {
                colorOrigin.current = null
                change((own, layer) => {
                  const colors = resolveDesignModeColors(doc, designNodeModeId(doc, layer.id))
                  return own.map((p, i) => {
                    if (i !== index || !p.variableId) return p
                    const variable = colors.find(v => v.id === p.variableId)
                    return {
                      ...p,
                      color: variable?.value ?? p.color,
                      opacity: p.opacity * (variable?.alpha ?? 1),
                      variableId: null,
                    }
                  })
                })
              }}
            >
              {t('designerDetachColor')}
            </button>
          ) : null}
        </>
      )}
    </>
  )
  return (
    <section className={css.propertySection}>
      <div className={css.sectionHeading}>
        <h3>{paintLabel}</h3>
        <div className={css.paintHeaderActions}>
          {extraActions}
          {paints[0] ? (
            <DesignerPopover
              label={t(stroke ? 'designerStrokeLibraries' : 'designerLibraries')}
              closeLabel={t('designerDone')}
              triggerClassName={css.paintHeaderButton}
              trigger={<Icon name="styles" />}
              onDismiss={close}
            >
              {picker(paints[0], 0, true)}
            </DesignerPopover>
          ) : null}
          <button
            type="button"
            aria-label={t(stroke ? 'designerAddStrokePaint' : 'designerAddFill')}
            disabled={!compatible}
            onClick={() => {
              change(
                own => [
                  ...own,
                  {
                    id: randomUUID(),
                    color: '#ffffff',
                    opacity: 1,
                    visible: true,
                    variableId: null,
                  },
                ],
                false,
                doc,
                true,
              )
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {!compatible ? (
        <p className={css.hint}>{t(stroke ? 'designerMixedStrokePaints' : 'designerMixedFills')}</p>
      ) : (
        [...paints].reverse().map((paint, visualIndex) => {
          const index = paints.length - visualIndex - 1
          const counterparts = items.map(n => readPaints(n)[index])
          const commonOpacity = counterparts.every(p => p?.opacity === paint.opacity)
            ? paint.opacity * 100
            : null
          const commonColor = counterparts.every((p, i) => {
            const layer = items[i]
            if (!layer) return false
            const colors = resolveDesignModeColors(doc, designNodeModeId(doc, layer.id))
            return (
              p &&
              !p.gradient &&
              !p.image &&
              (colors.find(v => v.id === p.variableId)?.value ?? p.color) === colorFor(paint)
            )
          })
          const token = counterparts.every(
            p => p && p.variableId === paint.variableId && !p.gradient && !p.image,
          )
            ? resolvedColors.find(v => v.id === paint.variableId)
            : undefined
          const tokenName = tokenSession?.paintId === paint.id ? tokenSession.name : token?.name
          return (
            <div
              className={css.paintRow}
              role="group"
              aria-label={t(
                stroke ? 'designerStrokePaintControls' : 'designerFillControls',
              ).replace('{number}', String(index + 1))}
              key={paint.id}
              data-hidden={!paint.visible}
              data-designer-fill-menu-open={menu === paint.id}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu(paint.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu(paint.id)
                }
              }}
            >
              <DesignerPopover
                key={cropCloseKey}
                label={`${paintLabel} ${index + 1}`}
                closeLabel={t('designerDone')}
                allowPaintHandles
                onDismiss={close}
                onOpenChange={(open) => {
                  editGradient(paint.id, open, paintRole)
                }}
                trigger={
                  <PaintSwatch
                    paint={paint}
                    colors={resolvedColors}
                    width={node.width}
                    height={node.height}
                    numbers={designModeResources(doc, designNodeModeId(doc, node.id)).numberVariables}
                  />
                }
              >
                {picker(paint, index)}
              </DesignerPopover>
              <div className={css.paintValue} data-menu-open={menu === paint.id}>
                {paint.gradient || paint.image ? (
                  <span className={css.paintKind}>
                    {t(
                      paint.image
                        ? 'designerImage'
                        : paint.gradient?.type === 'linear'
                          ? 'designerLinearGradient'
                          : 'designerRadialGradient',
                    )}
                  </span>
                ) : tokenName ? (
                  <DesignerPopover
                    label={stroke ? `${t('designerStrokeToken')} ${index + 1}` : tokenName}
                    closeLabel={t('designerDone')}
                    triggerClassName={css.paintToken}
                    onDismiss={close}
                    onOpenChange={(open) => {
                      setTokenSession(open ? { paintId: paint.id, name: tokenName } : null)
                    }}
                    trigger={
                      <>
                        <Icon name="component" />
                        <span title={tokenName}>{tokenName}</span>
                      </>
                    }
                  >
                    {picker(paint, index, true)}
                  </DesignerPopover>
                ) : (
                  <DesignerHexField
                    label={`${t(stroke ? 'designerStrokeHex' : 'designerHex')} ${index + 1}`}
                    mixed={t('designerMixed')}
                    color={commonColor ? colorFor(paint) : null}
                    onCommit={(color) => {
                      change((own, layer) => {
                        const colors = resolveDesignModeColors(doc, designNodeModeId(doc, layer.id))
                        return own.map((p, i) =>
                          i === index
                            ? {
                              ...p,
                              color,
                              variableId: null,
                              opacity:
                                  p.opacity * (colors.find(v => v.id === p.variableId)?.alpha ?? 1),
                            }
                            : p,
                        )
                      })
                    }}
                  />
                )}
                <Menu
                  className={css.paintMenu}
                  autoFocus
                  portal
                  compact
                  open={menu === paint.id}
                  onClose={() => {
                    setMenu(null)
                  }}
                  anchor={
                    <button
                      type="button"
                      className={css.paintOptions}
                      aria-label={t(
                        stroke ? 'designerStrokePaintOptions' : 'designerFillOptions',
                      ).replace('{number}', String(index + 1))}
                      aria-expanded={menu === paint.id}
                      onClick={() => {
                        setMenu(menu === paint.id ? null : paint.id)
                      }}
                    >
                      <Icon name="more" />
                    </button>
                  }
                  items={[
                    {
                      id: 'up',
                      label: t(stroke ? 'designerMoveStrokePaintUp' : 'designerMoveFillUp'),
                      disabled: index === paints.length - 1,
                    },
                    {
                      id: 'down',
                      label: t(stroke ? 'designerMoveStrokePaintDown' : 'designerMoveFillDown'),
                      disabled: index === 0,
                    },
                    {
                      id: 'duplicate',
                      label: t(stroke ? 'designerDuplicateStrokePaint' : 'designerDuplicateFill'),
                    },
                  ]}
                  onSelect={(action) => {
                    change((own) => {
                      const next = [...own],
                        value = next[index]
                      if (!value) return next
                      if (action === 'duplicate')
                        next.splice(index + 1, 0, {
                          ...structuredClone(value),
                          id: randomUUID(),
                        })
                      else {
                        const target = index + (action === 'up' ? 1 : -1),
                          other = next[target]
                        if (other) {
                          next[target] = value
                          next[index] = other
                        }
                      }
                      return next
                    })
                    setMenu(null)
                  }}
                />
              </div>
              <DesignerNumberField
                label={`${t(stroke ? 'designerStrokePaintOpacity' : 'designerFillOpacity')} ${index + 1}`}
                short="%"
                value={commonOpacity}
                mixed={t('designerMixed')}
                min={0}
                max={100}
                onCommit={(value) => {
                  setPaint(index, { opacity: value / 100 })
                }}
              />
              <button
                type="button"
                aria-label={t(
                  paint.visible
                    ? stroke
                      ? 'designerHideStrokePaint'
                      : 'designerHideFill'
                    : stroke
                      ? 'designerShowStrokePaint'
                      : 'designerShowFill',
                ).replace('{number}', String(index + 1))}
                onClick={() => {
                  setPaint(index, { visible: !paint.visible })
                }}
              >
                <Icon name="eye" />
              </button>
              <button
                type="button"
                aria-label={t(stroke ? 'designerRemoveStrokePaint' : 'designerRemoveFill')}
                onClick={() => {
                  change(own => own.filter((_, i) => i !== index))
                }}
              >
                <Icon name="minus" />
              </button>
            </div>
          )
        })
      )}
      {children}
    </section>
  )
}
