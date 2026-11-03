/** Inspector projections and local root-layout edits retain linked component inheritance. */
import type { ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignInstanceLayout,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  designInstanceLayoutEligibility,
  DESIGN_INSTANCE_LAYOUT_KEYS,
  DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS,
  editDesignInstanceLayout,
  editDesignNodes,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon } from './DesignerIcon.tsx'
import css from './DesignerInstanceLayout.module.css'

/** Project inherited root flow properties for display while retaining instance geometry.
 * @param document - Stored scene and component library.
 * @param selection - Resolved instance geometry and other selected layers.
 * @returns Inspector-only nodes; source values are never copied into stored instance settings.
 */
export function designerInstanceLayoutItems(
  document: CopyOSDesignDocument,
  selection: readonly CopyOSDesignNode[],
): CopyOSDesignNode[] {
  if (!selection.some(node => node.kind === 'instance')) return [...selection]
  const scene = createDesignRenderScene(document)
  return selection.map((node) => {
    if (node.kind !== 'instance') return node
    const resolved = scene.root.byId.get(node.id) ?? node
    const root = scene
      .instance(resolved, scene.root)
      ?.byId.get(node.componentId ?? '')
    if (!root || !['row', 'column', 'grid'].includes(root.layout))
      return { ...node, layout: 'none' }
    return {
      ...node,
      grid: root.grid,
      ...Object.fromEntries(
        DESIGN_INSTANCE_LAYOUT_KEYS.map(key => [key, root[key]]),
      ),
      widthSizing: node.widthSizing ?? 'fixed',
      heightSizing: node.heightSizing ?? 'fixed',
    }
  })
}

/** Apply one inspector layout edit atomically across ordinary containers and linked instances.
 * @param document - Stored scene.
 * @param selection - Inspector projections identifying editable selected layers.
 * @param fields - Common edited values; dimensions still belong to the instance itself.
 * @returns Updated scene, or null when the normal inspector patch should handle the edit.
 */
export function editDesignerInstanceLayoutSelection(
  document: CopyOSDesignDocument,
  selection: readonly CopyOSDesignNode[],
  fields: Partial<CopyOSDesignNode>,
): CopyOSDesignDocument | null {
  const keys = new Set<string>(DESIGN_INSTANCE_LAYOUT_KEYS)
  if (
    !selection.some(node => node.kind === 'instance') ||
    !Object.keys(fields).some(key => keys.has(key))
  )
    return null
  const local = Object.fromEntries(
    Object.entries(fields).filter(([key]) => keys.has(key)),
  ) as Partial<CopyOSDesignInstanceLayout>
  const own = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !keys.has(key)),
  )
  let next = document
  for (const selected of selection) {
    if (selected.locked) continue
    const stored = next.nodes.find(node => node.id === selected.id)
    if (!stored) continue
    if (stored.kind === 'instance') {
      next = editDesignInstanceLayout(next, stored.id, local)
      if (Object.keys(own).length)
        next = editDesignNodes(next, [{ id: stored.id, ...own }])
    } else {
      next = editDesignNodes(next, [
        {
          id: stored.id,
          ...fields,
          preserveLayout: false,
          numericBindings: Object.fromEntries(
            Object.entries(stored.numericBindings ?? {}).filter(
              ([key]) => !(key in fields),
            ),
          ),
        },
      ])
    }
  }
  return next
}

const labels: Record<
  keyof CopyOSDesignInstanceLayout,
  CopyOSFoundationLocaleKey
> = {
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

/** Show local settings separately from inherited component values and content overrides.
 * @param props - Stored scene, selected instances and the normal history commit.
 * @returns Per-property inheritance actions and a layout-only reset.
 */
export function DesignerInstanceLayoutReset({
  document,
  selection,
  t,
  commit,
}: {
  document: CopyOSDesignDocument
  selection: readonly CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (document: CopyOSDesignDocument) => void
}): ReactNode {
  const instances = selection.filter(
    node =>
      node.kind === 'instance' &&
      ['row', 'column', 'grid'].includes(node.layout),
  )
  if (!instances.length) return null
  const stored = document.nodes.filter(
    node => instances.some(item => item.id === node.id) && !node.locked,
  )
  const properties = DESIGN_INSTANCE_LAYOUT_KEYS.filter(key =>
    stored.some(
      node =>
        node.instanceLayout?.[key] !== undefined ||
        DESIGN_INSTANCE_LAYOUT_NUMBER_KEYS.some(
          numberKey =>
            numberKey === key && !!node.numericBindings?.[numberKey],
        ),
    ),
  )
  const statuses = stored.map(node =>
    designInstanceLayoutEligibility(document, node),
  )
  const dormant = new Set(
    properties.filter(key =>
      statuses
        .filter(
          status =>
            status.activeKeys.includes(key) || status.dormantKeys.includes(key),
        )
        .every(status => status.dormantKeys.includes(key)),
    ),
  )
  const label = (key: keyof CopyOSDesignInstanceLayout): string =>
    t(
      instances.every(node => node.layout === 'grid') && key === 'gap'
        ? 'designerGridColumnGap'
        : instances.every(node => node.layout === 'grid') &&
            key === 'crossGap'
          ? 'designerGridRowGap'
          : labels[key],
    )
  const reset = (key?: keyof CopyOSDesignInstanceLayout): void => {
    let next = document
    for (const node of stored)
      next = editDesignInstanceLayout(
        next,
        node.id,
        key ? { [key]: undefined } : null,
      )
    if (next !== document) commit(next)
  }
  return (
    <div className={css.section}>
      <h4>{t('designerInstanceLayoutOverrides')}</h4>
      {properties.length ? (
        <>
          {properties.map(key => (
            <div key={key} className={css.row}>
              <span
                title={
                  dormant.has(key)
                    ? t('designerDormantLayoutOverride')
                    : undefined
                }
              >
                {label(key)}
                {dormant.has(key)
                  ? ` · ${t('designerDormantLayoutOverride')}`
                  : ''}
              </span>
              <Tooltip
                label={`${t('designerInheritLayoutProperty')}: ${label(key)}`}
              >
                <button
                  type="button"
                  aria-label={`${t('designerInheritLayoutProperty')}: ${label(key)}`}
                  onClick={() => {
                    reset(key)
                  }}
                >
                  <DesignerIcon name="undo" />
                </button>
              </Tooltip>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              reset()
            }}
          >
            {t('designerResetLayoutOverrides')}
          </button>
        </>
      ) : (
        <p className={css.hint}>{t('designerInheritedLayout')}</p>
      )}
    </div>
  )
}
