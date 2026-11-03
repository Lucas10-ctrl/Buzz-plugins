/** Grid editing shares the native cell/track operations used by agents and canvas gestures. */
import { useMemo, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignGridTrack,
  CopyOSDesignGrid,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import {
  defaultDesignGrid,
  createDesignRenderScene,
  designInstanceGridContext,
  designInstanceGridConfig,
  editDesignInstanceGrid,
  designInstanceGridConfigContext,
  editDesignInstanceGridConfig,
  type DesignInstanceGridConfigContext,
  designGridGeometry,
  designInstanceLayoutBoxes,
  designGridTrackBlock,
  designGridTrackTokens,
  designModeResources,
  designNodeModeId,
  resolveDesignNumberVariables,
  resizeDesignGridTracks,
  setDesignGridPositioning,
  moveDesignGridNode,
  moveDesignGridTrack,
  moveDesignInstanceGridTrack,
  DesignGridTrackMoveError,
  resizeDesignGridCell,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
import gridCss from './DesignerGrid.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
/** Edit track counts, placement and individually sized tracks.
 * @param props - Selected container, current document and localized native mutations.
 * @returns Compact grid settings with a scrollable track editor.
 */
export function DesignerGrid({
  doc,
  node,
  t,
  commit,
  patch,
  contextual,
  renderScene,
}: {
  doc: CopyOSDesignDocument
  node: CopyOSDesignNode
  t: Translate
  commit: (doc: CopyOSDesignDocument) => boolean | void
  patch: (fields: Partial<CopyOSDesignNode>) => boolean | void
  contextual?: {
    instanceId: string
    path: readonly string[]
    resolved?: DesignInstanceGridConfigContext
  }
  renderScene?: ReturnType<typeof createDesignRenderScene>
}): ReactNode {
  const stored = doc.nodes.find(n => n.id === node.id) ?? node
  const linked = stored.kind === 'instance' && !contextual
  const scene = useMemo(() => renderScene ?? createDesignRenderScene(doc), [doc, renderScene])
  const contextualContext = contextual
    ? (contextual.resolved ??
      designInstanceGridConfigContext(doc, contextual.instanceId, contextual.path, scene))
    : undefined
  const linkedContext =
    contextualContext ?? (linked ? designInstanceGridContext(doc, stored, scene) : undefined)
  const grid = linkedContext?.node.grid ?? node.grid ?? defaultDesignGrid()
  const raw =
    contextualContext?.grid ??
    (linked ? designInstanceGridConfig(doc, stored) : stored.grid) ??
    defaultDesignGrid()
  const local = contextual ? contextualContext?.localGrid : stored.instanceGrid
  const owner = `${doc.id}:${contextual?.instanceId ?? node.id}:${JSON.stringify(contextual?.path ?? [])}`
  const locked = node.locked || (!!contextual && (!contextualContext || contextualContext.locked))
  const ownsGrid = linked || !!contextual
  const writeGrid = (fields: Parameters<typeof editDesignInstanceGrid>[2]): boolean | void => {
    if (locked) return false
    return commit(
      contextual
        ? editDesignInstanceGridConfig(doc, contextual.instanceId, contextual.path, fields)
        : editDesignInstanceGrid(doc, node.id, fields),
    )
  }
  const geometry = linkedContext
    ? designGridGeometry(
      linkedContext.node,
      linkedContext.children,
      {},
      linkedContext.context.layoutBoxes,
    )
    : designGridGeometry(
      node,
      scene.root.nodes.filter(n => n.parentId === node.id),
      {},
      designInstanceLayoutBoxes(doc),
    )
  const applyGrid = (fields: Partial<CopyOSDesignGrid>): boolean | void => {
    if (locked) return false
    return ownsGrid ? writeGrid(fields) : patch({ grid: { ...raw, ...fields } })
  }
  const resize = (axis: 'columns' | 'rows', count: number | null): boolean | void => {
    if (locked) return false
    if (contextual) {
      if (axis === 'rows' && count === null) return applyGrid({ autoRows: true })
      const size = count ?? raw.columns.length
      const tracks = Array.from({ length: size }, (_, index) => ({
        ...(raw[axis][index] ??
          (axis === 'columns' ? { sizing: 'fill' as const, value: 1 } : raw.implicitRow)),
      }))
      return applyGrid({ [axis]: tracks, ...(axis === 'rows' ? { autoRows: false } : {}) })
    }
    return commit(resizeDesignGridTracks(doc, node.id, axis, count))
  }
  const resources = resolveDesignNumberVariables(
    designModeResources(
      doc,
      contextualContext
        ? (contextualContext.context.modes.get(contextualContext.node.id) ?? null)
        : designNodeModeId(doc, node.id),
    ).numberVariables,
  )
  const eligible = useMemo(() => designGridTrackTokens(doc), [doc])
  const [moveError, setMoveError] = useState(false)
  const moveTrack = (axis: 'columns' | 'rows', index: number, direction: -1 | 1): void => {
    if (locked) return
    try {
      const accepted = commit(
        contextual
          ? moveDesignInstanceGridTrack(
            doc,
            contextual.instanceId,
            contextual.path,
            axis,
            index,
            direction,
          )
          : moveDesignGridTrack(doc, node.id, axis, index, direction),
      )
      if (accepted !== false) setMoveError(false)
    } catch (error) {
      if (!(error instanceof DesignGridTrackMoveError)) throw error
      setMoveError(true)
    }
  }
  const [requestedRowStart, setRowStart] = useState(0)
  const rowStart = Math.min(requestedRowStart, Math.max(0, geometry.rows.length - 1))
  const field = (
    label: CopyOSFoundationLocaleKey,
    value: number,
    onCommit: (value: number) => boolean | void,
    max = 10000,
    min = 0,
  ) => (
    <DesignerNumberField
      key={`${owner}:${label}`}
      disabled={locked}
      label={t(label)}
      short={
        label === 'designerGridColumns' || label === 'designerGridColumnGap'
          ? '↔'
          : label === 'designerGridRows' || label === 'designerGridRowGap'
            ? '↕'
            : ''
      }
      value={value}
      min={min}
      max={max}
      mixed={t('designerMixed')}
      onCommit={onCommit}
    />
  )
  const edit = (
    axis: 'columns' | 'rows' | 'implicitRow',
    index: number,
    fields: Partial<CopyOSDesignGridTrack>,
  ): boolean | void => {
    if (axis === 'implicitRow') return applyGrid({ implicitRow: { ...raw.implicitRow, ...fields } })
    const tracks = Array.from({ length: Math.max(raw[axis].length, index + 1) }, (_, i) => ({
      ...(raw[axis][i] ?? raw.implicitRow),
      ...(i === index ? fields : {}),
    }))
    return applyGrid({ [axis]: tracks })
  }
  const track = (axis: 'columns' | 'rows' | 'implicitRow', index: number): ReactNode => {
    const current =
      axis === 'implicitRow' ? grid.implicitRow : (grid[axis][index] ?? grid.implicitRow)
    const block =
      axis === 'implicitRow' ? [0, 0] : designGridTrackBlock(geometry.placements, axis, index)
    const label = t(
      axis === 'columns'
        ? 'designerGridColumnTrack'
        : axis === 'rows'
          ? 'designerGridRowTrack'
          : 'designerGridImplicitRow',
    ).replace('{number}', String(index + 1))
    return (
      <div className={css.gridTrackRow} key={label}>
        <span>{label}</span>
        <select
          disabled={locked}
          aria-label={`${label} ${t('designerGridTrackSizing')}`}
          value={current.sizing}
          onChange={(e) => {
            const sizing = e.currentTarget.value as CopyOSDesignGridTrack['sizing']
            const pixels =
              axis === 'columns'
                ? geometry.columns[index]
                : axis === 'rows'
                  ? geometry.rows[index]
                  : undefined
            edit(axis, index, {
              sizing,
              value: sizing === 'fill' ? 1 : sizing === 'hug' ? 0 : Math.max(1, pixels ?? 100),
              variableId: null,
            })
          }}
        >
          <option value="fixed">{t('designerFixed')}</option>
          <option value="hug">{t('designerHug')}</option>
          <option value="fill">{t('designerFillContainer')}</option>
        </select>
        {current.sizing === 'hug' ? (
          <span>{t('designerHugShort')}</span>
        ) : (
          <DesignerNumberField
            key={`${owner}:${axis}:${index}:value`}
            disabled={locked}
            label={`${label} ${t('designerGridTrackSize')}`}
            short={current.sizing === 'fill' ? 'fr' : 'px'}
            value={current.value}
            min={current.sizing === 'fill' ? 0.01 : 1}
            max={current.sizing === 'fill' ? 1000 : 100000}
            step={current.sizing === 'fill' ? 0.1 : 1}
            mixed={t('designerMixed')}
            onCommit={(value) => {
              return edit(axis, index, { value, variableId: null })
            }}
          />
        )}
        {current.sizing !== 'hug' ? (
          <select
            disabled={locked}
            className={css.gridTrackToken}
            aria-label={`${label} ${t('designerGridTrackToken')}`}
            value={current.variableId ?? ''}
            onChange={(e) => {
              const variableId = e.currentTarget.value || null,
                variable = resources.find(v => v.id === variableId)
              edit(axis, index, {
                variableId,
                value: variable?.value ?? current.value,
              })
            }}
          >
            <option value="">{t('designerOwnValue')}</option>
            {resources
              .filter(v => current.sizing !== 'hug' && eligible[current.sizing].has(v.id))
              .map(v => (
                <option value={v.id} key={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        ) : null}
        {axis !== 'implicitRow' ? (
          <div className={css.gridTrackActions}>
            <button
              type="button"
              aria-label={`${label} ${t('designerGridMoveEarlier')}`}
              disabled={locked || block[0] === 0}
              onClick={() => {
                moveTrack(axis, index, -1)
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`${label} ${t('designerGridMoveLater')}`}
              disabled={
                locked ||
                (block[1] ?? 0) >=
                  (axis === 'columns' ? geometry.columns.length : geometry.rows.length)
              }
              onClick={() => {
                moveTrack(axis, index, 1)
              }}
            >
              ↓
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <>
      {ownsGrid ? (
        <section className={gridCss.ownership} aria-label={t('designerInstanceGridOverrides')}>
          {!contextual ? <p>{t('designerGridCellsInherited')}</p> : null}
          {(['columns', 'rows', 'implicitRow', 'autoRows', 'autoPosition'] as const).map((key) => {
            const labels = {
              columns: 'designerGridColumns',
              rows: 'designerGridRows',
              implicitRow: 'designerGridImplicitRow',
              autoRows: 'designerGridAutoRows',
              autoPosition: 'designerGridAutoPosition',
            } as const
            const own = local?.[key] !== undefined
            return (
              <div key={key} className={gridCss.ownerRow}>
                <span>{t(labels[key])}</span>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`${t(own ? 'designerInheritLayoutProperty' : 'designerOwnValue')}: ${t(labels[key])}`}
                  onClick={() => {
                    writeGrid(own ? { [key]: undefined } : { [key]: raw[key] })
                  }}
                >
                  {t(own ? 'designerLocalSizing' : 'designerInheritedSizing')}
                </button>
              </div>
            )
          })}
          {local && Object.keys(local).length ? (
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                writeGrid(null)
              }}
            >
              {t('designerResetGridOverrides')}
            </button>
          ) : null}
        </section>
      ) : null}
      <div className={css.fieldGrid}>
        {field(
          'designerGridColumns',
          grid.columns.length,
          value => resize('columns', Math.round(value)),
          64,
          1,
        )}
        <DesignerNumberField
          key={`${owner}:rows`}
          disabled={locked}
          label={t('designerGridRows')}
          short="↕"
          value={grid.autoRows ? null : grid.rows.length}
          mixed={t('designerAutomatic')}
          min={1}
          max={4096}
          onCommit={value => resize('rows', Math.max(1, Math.round(value)))}
        />
        {!contextual &&
          field('designerGridColumnGap', node.gap, (gap) => {
            return patch({ gap })
          })}
        {!contextual &&
          field('designerGridRowGap', node.crossGap ?? node.gap, (crossGap) => {
            return patch({ crossGap })
          })}
      </div>
      {grid.autoRows ? (
        <span className={css.hint}>
          {t('designerGridRowsUsed').replace('{count}', String(geometry.rows.length))}
        </span>
      ) : null}
      <label className={css.check}>
        <input
          type="checkbox"
          checked={grid.autoRows}
          disabled={locked}
          onChange={(e) => {
            resize('rows', e.currentTarget.checked ? null : Math.max(1, geometry.rows.length))
          }}
        />
        {t('designerGridAutoRows')}
      </label>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={grid.autoPosition}
          disabled={locked}
          onChange={(e) => {
            if (!locked) {
              if (contextual) applyGrid({ autoPosition: e.currentTarget.checked })
              else commit(setDesignGridPositioning(doc, node.id, e.currentTarget.checked))
            }
          }}
        />
        {t('designerGridAutoPosition')}
      </label>
      <DesignerPopover
        key={`${owner}:tracks`}
        label={t('designerGridTracks')}
        panelClassName={css.gridTracksPopover}
        closeLabel={t('designerDone')}
        trigger={
          <>
            <Icon name="layout-grid" />
            {t('designerGridTracks')}
          </>
        }
      >
        <div className={css.popoverContent}>
          {moveError ? <p role="alert">{t('designerGridTrackMoveLimit')}</p> : null}
          <h3>{t('designerGridColumns')}</h3>
          <div className={css.gridTrackList}>{grid.columns.map((_, i) => track('columns', i))}</div>
          <h3>{t('designerGridRows')}</h3>
          <div className={css.gridTrackList}>
            {Array.from(
              {
                length: Math.min(32, Math.max(0, geometry.rows.length - rowStart)),
              },
              (_, i) => track('rows', rowStart + i),
            )}
          </div>
          {geometry.rows.length > 32 ? (
            <div className={css.fieldGrid}>
              {field(
                'designerGridFirstTrack',
                rowStart + 1,
                (value) => {
                  setRowStart(
                    Math.max(0, Math.min(geometry.rows.length - 1, Math.round(value) - 1)),
                  )
                },
                geometry.rows.length,
                1,
              )}
            </div>
          ) : null}
          {track('implicitRow', 0)}
        </div>
      </DesignerPopover>
    </>
  )
}
/** Surface retained grid ownership while its main component uses another flow.
 * @param props - Selected projections, stored document and one atomic history commit.
 * @returns An inactive-state explanation and reset for editable dormant instances only.
 */
export function DesignerDormantGridOverrides({
  doc,
  items,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
}): ReactNode {
  const dormant = items.filter(
    item =>
      item.kind === 'instance' &&
      item.layout !== 'grid' &&
      doc.nodes.some(
        stored =>
          stored.id === item.id &&
          stored.instanceGrid &&
          Object.keys(stored.instanceGrid).length > 0,
      ),
  )
  if (!dormant.length) return null
  const editable = dormant.filter(item => !item.locked)
  return (
    <section className={gridCss.ownership} aria-label={t('designerInstanceGridOverrides')}>
      <p>{t('designerDormantGridOverrides')}</p>
      <button
        type="button"
        disabled={!editable.length}
        onClick={() => {
          let next = doc
          for (const item of editable) next = editDesignInstanceGrid(next, item.id, null)
          if (next !== doc) commit(next)
        }}
      >
        {t('designerResetGridOverrides')}
      </button>
    </section>
  )
}

/** Edit cell spans and anchors without overwriting unrelated selected-cell properties.
 * @param props - Compatible child selection and its grid container.
 * @returns Per-cell sizing controls; alignment uses the Position section.
 */
export function DesignerGridCell({
  doc,
  items,
  parent,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: [CopyOSDesignNode, ...CopyOSDesignNode[]]
  parent: CopyOSDesignNode
  t: Translate
  commit: (doc: CopyOSDesignDocument) => void
}): ReactNode {
  const first = items[0],
    columns = parent.grid?.columns.length ?? 2
  const number = (
    key: 'column' | 'row' | 'columnSpan' | 'rowSpan',
    label: CopyOSFoundationLocaleKey,
    max: number,
  ) => {
    const values = items.map(n => n.gridCell?.[key] ?? 1)
    return (
      <DesignerNumberField
        label={t(label)}
        short={key === 'column' || key === 'columnSpan' ? '↔' : '↕'}
        value={values.every(v => v === values[0]) ? (values[0] ?? 1) : null}
        min={1}
        max={max}
        mixed={t('designerMixed')}
        onCommit={(value) => {
          value = Math.round(value)
          if (key === 'column' || key === 'row') {
            let next = setDesignGridPositioning(doc, parent.id, false)
            for (const item of items)
              next = moveDesignGridNode(
                next,
                item.id,
                key === 'column' ? value : (item.gridCell?.column ?? 1),
                key === 'row' ? value : (item.gridCell?.row ?? 1),
              )
            commit(next)
          } else {
            let next = doc
            for (const item of items) next = resizeDesignGridCell(next, item.id, { [key]: value })
            commit(next)
          }
        }}
      />
    )
  }
  return (
    <div className={css.gridCellSettings}>
      <h3>{t('designerGridCell')}</h3>
      <div className={css.fieldGrid}>
        {number('column', 'designerGridColumn', columns)}
        {number('row', 'designerGridRow', 4096 - (first.gridCell?.rowSpan ?? 1) + 1)}
        {number('columnSpan', 'designerGridColumnSpan', columns)}
        {number('rowSpan', 'designerGridRowSpan', 64)}
      </div>
    </div>
  )
}
