/** Local instance sizing ownership is separate from inherited component layout and content. */
import type { ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import {
  DESIGN_INSTANCE_SIZING_KEYS,
  designInstanceSizingOwns,
  editDesignNodes,
  resetDesignInstanceSizing,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerInstanceSizing.module.css'
type SizingKey = (typeof DESIGN_INSTANCE_SIZING_KEYS)[number]
const fieldsForAxis = (axis: 'width' | 'height'): readonly SizingKey[] =>
  axis === 'width'
    ? ['width', 'widthSizing', 'minWidth', 'maxWidth']
    : ['height', 'heightSizing', 'minHeight', 'maxHeight']
const labels: Record<SizingKey, CopyOSFoundationLocaleKey> = {
  width: 'designerWidth',
  height: 'designerHeight',
  widthSizing: 'designerWidthSizing',
  heightSizing: 'designerHeightSizing',
  minWidth: 'designerMinWidth',
  maxWidth: 'designerMaxWidth',
  minHeight: 'designerMinHeight',
  maxHeight: 'designerMaxHeight',
}

/** Commit explicit dimension edits or policies without recovering stale instance snapshots.
 * Hug/Fill policies use the original scene so parent sizing captures the pre-edit geometry.
 * @param document - Stored scene.
 * @param items - Effective selected nodes, retaining their stored identities.
 * @param fields - Explicit inspector edits.
 * @returns One atomic candidate, or null for the ordinary inspector mutation path.
 */
export function editDesignerInstanceSizingSelection(
  document: CopyOSDesignDocument,
  items: readonly CopyOSDesignNode[],
  fields: Partial<CopyOSDesignNode>,
): CopyOSDesignDocument | null {
  if (
    !items.some(node => node.kind === 'instance') ||
    !Object.keys(fields).some(key =>
      DESIGN_INSTANCE_SIZING_KEYS.some(property => property === key),
    )
  )
    return null
  if (items.some(item => item.locked || document.nodes.some(node => node.id === item.id && node.locked))) return document
  let next = document
  for (const selected of items) {
    if (selected.locked) continue
    const stored = next.nodes.find(node => node.id === selected.id)
    if (!stored) continue
    const edits = { ...fields }
    const inheritedAxes = (['width', 'height'] as const).filter(axis =>
      !(axis in edits) && (edits[`${axis}Sizing`] === 'hug' || edits[`${axis}Sizing`] === 'fill'))
    if (stored.kind === 'instance') {
      for (const axis of ['width', 'height'] as const) {
        const policy = `${axis}Sizing` as const
        if (axis in edits) edits[policy] = 'fixed'
      }
      if (stored.instanceSizingOverrides === undefined && inheritedAxes.length)
        edits.instanceSizingOverrides = DESIGN_INSTANCE_SIZING_KEYS.filter(key =>
          !inheritedAxes.some(axis => axis === key))
    }
    const current = next.nodes.find(node => node.id === stored.id) ?? stored
    next = editDesignNodes(next, [
      {
        id: stored.id,
        ...edits,
        preserveLayout: false,
        numericBindings: Object.fromEntries(
          Object.entries(current.numericBindings ?? {}).filter(
            ([key]) => !(key in edits) &&
              !(stored.kind === 'instance' && inheritedAxes.some(axis => axis === key)),
          ),
        ),
      },
    ])
  }
  return next
}

/** Show axis ownership and precise resets while keeping component layout/content overrides intact.
 * @param props - Stored scene, rendered instances, labels and one parent history commit.
 * @returns Compact axis actions with per-property inheritance and explicit no-limit ownership.
 */
export function DesignerInstanceSizing({
  doc,
  items,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (document: CopyOSDesignDocument) => void
}): ReactNode {
  if (!items.length || !items.every(node => node.kind === 'instance'))
    return null
  const stored = items.map(
    item => doc.nodes.find(node => node.id === item.id) ?? item,
  )
  const disabled =
    items.some(node => node.locked) || stored.some(node => node.locked)
  const hasLocal = (keys: readonly SizingKey[]): boolean =>
    stored.some(node =>
      keys.some(key => designInstanceSizingOwns(node, key)),
    )
  const status = (keys: readonly SizingKey[]): string => {
    const own = stored.map(node =>
      keys.some(key => designInstanceSizingOwns(node, key)),
    )
    return t(
      own.every(Boolean)
        ? 'designerLocalSizing'
        : own.some(Boolean)
          ? 'designerMixed'
          : 'designerInheritedSizing',
    )
  }
  const reset = (keys?: readonly SizingKey[]): void => {
    if (disabled) return
    let next = doc
    for (const node of stored)
      next = resetDesignInstanceSizing(next, node.id, keys)
    if (next !== doc) commit(next)
  }
  const own = (key: SizingKey, noLimit = false): void => {
    if (disabled) return
    let next = doc
    for (const node of items) {
      const value = noLimit ? undefined : node[key]
      const candidate = editDesignerInstanceSizingSelection(next, [node], {
        [key]: value,
      })
      if (candidate) next = candidate
    }
    if (next !== doc) commit(next)
  }
  return (
    <div className={css.section}>
      <h4>{t('designerInstanceSizing')}</h4>
      {(['width', 'height'] as const).map(axis => (
        <div className={css.axis} key={axis}>
          <span>
            {t(labels[axis])}
            <small>{status(fieldsForAxis(axis))}</small>
          </span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${t('designerOwnValue')}: ${t(labels[axis])}`}
            title={`${t('designerOwnValue')}: ${t(labels[axis])}`}
            onClick={() => {
              own(axis)
            }}
          >
            <DesignerIcon name="rectangle" />
          </button>
          <button
            type="button"
            disabled={disabled || !hasLocal(fieldsForAxis(axis))}
            aria-label={t(
              axis === 'width'
                ? 'designerResetWidthSizing'
                : 'designerResetHeightSizing',
            )}
            title={t(
              axis === 'width'
                ? 'designerResetWidthSizing'
                : 'designerResetHeightSizing',
            )}
            onClick={() => {
              reset(fieldsForAxis(axis))
            }}
          >
            <DesignerIcon name="undo" />
          </button>
          {disabled ? (
            <button
              type="button"
              disabled
              aria-label={`${t('designerInstanceSizing')}: ${t(labels[axis])}`}
            >
              <DesignerIcon name="settings" />
            </button>
          ) : (
            <DesignerPopover
              label={`${t('designerInstanceSizing')}: ${t(labels[axis])}`}
              closeLabel={t('designerDone')}
              trigger={<DesignerIcon name="settings" />}
              triggerClassName={css.settings}
              panelClassName={css.panel}
            >
              {fieldsForAxis(axis).map(key => (
                <div className={css.property} key={key}>
                  <span>
                    {t(labels[key])}
                    <small>{status([key])}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`${t('designerOwnValue')}: ${t(labels[key])}`}
                    onClick={() => {
                      own(key)
                    }}
                  >
                    {t('designerOwnValue')}
                  </button>
                  <button
                    type="button"
                    disabled={!hasLocal([key])}
                    aria-label={`${t('designerInheritLayoutProperty')}: ${t(labels[key])}`}
                    onClick={() => {
                      reset([key])
                    }}
                  >
                    <DesignerIcon name="undo" />
                  </button>
                  {key.startsWith('min') || key.startsWith('max') ? (
                    <button
                      type="button"
                      aria-label={`${t('designerNone')}: ${t(labels[key])}`}
                      onClick={() => {
                        own(key, true)
                      }}
                    >
                      {t('designerNone')}
                    </button>
                  ) : null}
                </div>
              ))}
            </DesignerPopover>
          )}
        </div>
      ))}
      <button
        type="button"
        className={css.reset}
        disabled={disabled || !hasLocal(DESIGN_INSTANCE_SIZING_KEYS)}
        onClick={() => {
          reset()
        }}
      >
        {t('designerResetInstanceSizing')}
      </button>
    </div>
  )
}
