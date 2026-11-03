import { DesignerAutoLayoutAlignment } from './DesignerAutoLayoutAlignment.tsx'
/** Path-aware linked grid cell controls never treat main-component layer IDs as editable document selection. */
import { useMemo, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignInstanceGridCell,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  defaultDesignGrid,
  createDesignInstanceGridCellReader,
  designInstanceGridConfigContext,
  editDesignInstanceGridConfig,
  designInstanceOverrideLayers,
  editDesignNodes,
  mergeDesignInstanceGridCells,
  setDesignGridPositioning,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerReadOnlyAspectRatio } from './DesignerAspectRatio.tsx'
import { DesignerEffects } from './DesignerEffects.tsx'
import { DesignerLayerBlend } from './DesignerLayerBlend.tsx'
import type { DesignAlignmentTarget, DesignAutoLayoutAlignmentIntent, DesignGridCellAlignmentIntent, DesignPaddingTarget, DesignPaddingValues } from '../../../copyos-domain/src/design-model.ts'
import { DesignerContextualLayout } from './DesignerContextualLayout.tsx'
import { DesignerGrid } from './DesignerGrid.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerInstanceGridCell.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string
type CellContext = NonNullable<ReturnType<ReturnType<typeof createDesignInstanceGridCellReader>>>

/** Offer keyboard-accessible, bounded descendant selection without exposing source-layer mutation.
 * @param props - Selected instance and a path-only selection callback; Shift adds compatible layers.
 * @returns A searchable disclosure of contextual component layers.
 */
export function DesignerInstanceCellChooser({
  doc,
  instanceId,
  t,
  onSelect,
}: {
  doc: CopyOSDesignDocument
  instanceId: string
  t: Translate
  onSelect: (path: string[], additive: boolean) => void
}): ReactNode {
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(100),
    [open, setOpen] = useState(false)
  const rows = useMemo(
    () => (open ? designInstanceOverrideLayers(doc, instanceId, 50000).layers : []),
    [doc, instanceId, open],
  )
  const matches = rows.filter(row =>
    row.names.join(' / ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <details
      className={css.chooser}
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
      }}
    >
      <summary>{t('designerSelectInstanceCell')}</summary>
      {open ? (
        <>
          <input
            type="search"
            aria-label={t('designerFindInstanceCell')}
            placeholder={t('designerFindInstanceCell')}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setLimit(100)
            }}
          />
          <div className={css.choices}>
            {matches.slice(0, limit).map(row => (
              <button
                type="button"
                key={JSON.stringify(row.path)}
                onClick={(event) => {
                  onSelect(row.path, event.shiftKey)
                }}
              >
                {row.names.join(' / ')}
              </button>
            ))}
          </div>
          {matches.length > limit ? (
            <button
              type="button"
              onClick={() => {
                setLimit(limit + 100)
              }}
            >
              {t('designerMoreInstanceLayers').replace(
                '{count}',
                String(Math.min(100, matches.length - limit)),
              )}
            </button>
          ) : null}
        </>
      ) : null}
    </details>
  )
}

/** Edit only path-owned cell fields, retaining contextual source geometry and independent root configuration.
 * @param props - Stored instance owner, compatible selected paths and the normal atomic history callback.
 * @returns A dedicated inspector with no root-position or source-layer editing controls.
 */
export function DesignerInstanceGridCell({
  doc,
  instanceId,
  paths,
  rootLocked,
  t,
  commit,
  setPadding,
  setLayoutAlignment,
  setCellAlignment,
  preview,
  cancelPreview,
  onBack,
  onSelect,
}: {
  doc: CopyOSDesignDocument
  instanceId: string
  paths: readonly string[][]
  rootLocked: boolean
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
  setPadding: (targets: readonly DesignPaddingTarget[], values: DesignPaddingValues) => boolean
  setLayoutAlignment: (targets: readonly (string | DesignAlignmentTarget)[], intent: DesignAutoLayoutAlignmentIntent) => boolean
  setCellAlignment: (targets: readonly (string | DesignAlignmentTarget)[], intent: DesignGridCellAlignmentIntent) => boolean
  preview: (document: CopyOSDesignDocument) => void
  cancelPreview: () => void
  onBack: () => void
  onSelect: (path: string[], additive: boolean) => void
}): ReactNode {
  const scene = useMemo(() => createDesignRenderScene(doc), [doc])
  const readCell = useMemo(
    () => createDesignInstanceGridCellReader(doc, scene, { includeSourceCell: false }),
    [doc, scene],
  )
  const contexts = paths.map(path => ({ path, value: readCell(instanceId, path) }))
  const selectedPath = paths.length === 1 ? paths[0] : undefined
  const selectedGrid = selectedPath
    ? designInstanceGridConfigContext(doc, instanceId, selectedPath, scene)
    : undefined
  const first = contexts[0]?.value
  const stored = doc.nodes.find(node => node.id === instanceId)
  const compatible =
    !!first &&
    contexts.every(
      item => item.value?.parent.id === first.parent.id && item.value.context === first.context,
    )
  const active = compatible && contexts.every(item => item.value?.active)
  const manual = active && contexts.every(item => item.value?.manual)
  const editable = contexts.filter(item => item.value && !rootLocked && !item.value.locked)
  const owner = `${doc.id}:${instanceId}:${JSON.stringify(paths)}`
  const fields = [
    { key: 'column', labelKey: 'designerGridColumn' },
    { key: 'row', labelKey: 'designerGridRow' },
    { key: 'columnSpan', labelKey: 'designerGridColumnSpan' },
    { key: 'rowSpan', labelKey: 'designerGridRowSpan' },
  ] as const
  const edit = (
    patch:
      | CopyOSDesignInstanceGridCell
      | null
      | ((context: CellContext) => CopyOSDesignInstanceGridCell),
  ): boolean | void => {
    if (!editable.length || !stored) return false
    const merged = mergeDesignInstanceGridCells(
      stored,
      editable.flatMap(item =>
        item.value
          ? [
            {
              path: item.value.overridePath,
              patch: typeof patch === 'function' ? patch(item.value) : patch,
            },
          ]
          : [],
      ),
    )
    return merged === stored
      ? true
      : commit(
        editDesignNodes(doc, [{ id: instanceId, instanceOverrides: merged.instanceOverrides }]),
      )
  }
  return (
    <section className={css.inspector} aria-label={t('designerInstanceCellSelection')}>
      <button type="button" onClick={onBack}>
        {t('designerBackToInstance')}
      </button>
      <h3>{first?.node.name ?? t('designerInstanceCellUnavailable')}</h3>
      <DesignerReadOnlyAspectRatio items={contexts.flatMap(item => item.value ? [item.value.node] : [])} t={t} />
      <DesignerLayerBlend key={`${owner}:blendMode`} doc={doc}
        owners={paths.map(path => ({ nodeId: instanceId, path, locked: rootLocked }))}
        t={t} commit={commit} preview={preview} cancelPreview={cancelPreview} />
      <DesignerEffects key={`${owner}:effects`} doc={doc}
        owners={paths.map(path => ({ nodeId: instanceId, path, locked: rootLocked }))}
        t={t} commit={commit} preview={preview} cancelPreview={cancelPreview} />
      {selectedGrid?.active && selectedPath ? (
        <section>
          <h4>{t('designerGridTracks')}</h4>
          <DesignerGrid
            key={`${owner}:grid`}
            doc={doc}
            node={{ ...selectedGrid.node, locked: rootLocked || selectedGrid.locked }}
            contextual={{ instanceId, path: selectedPath, resolved: selectedGrid }}
            renderScene={scene}
            t={t}
            commit={commit}
            patch={() => false}
          />
        </section>
      ) : selectedGrid?.localGrid && selectedPath ? (
        <section aria-label={t('designerInstanceGridOverrides')}>
          <p>{t('designerDormantDescendantGrid')}</p>
          <button
            type="button"
            disabled={rootLocked || selectedGrid.locked}
            onClick={() => {
              commit(editDesignInstanceGridConfig(doc, instanceId, selectedPath, null))
            }}
          >
            {t('designerResetGridOverrides')}
          </button>
        </section>
      ) : null}
      {selectedPath ? (
        <DesignerContextualLayout
          key={`${owner}:layout`}
          doc={doc}
          instanceId={instanceId}
          path={selectedPath}
          rootLocked={rootLocked}
          setPadding={setPadding}
          setLayoutAlignment={setLayoutAlignment}
          scene={scene}
          t={t}
          commit={commit}
        />
      ) : null}
      {!compatible ? (
        <p>
          {first ? t('designerInstanceCellsDifferentGrids') : t('designerInstanceCellUnavailable')}
        </p>
      ) : (
        <>
          {first.parent.layout === 'grid' ? (
            <button
              type="button"
              onClick={() => {
                if (first.parentPath) onSelect([...first.parentPath], false)
                else onBack()
              }}
            >
              {t('designerEditParentGrid')}
            </button>
          ) : null}
          <h4>{t('designerPosition')}</h4>
          <div className={css.cellAlignment}>
            <DesignerAutoLayoutAlignment purpose="cell" document={doc} targets={paths.map(path => ({ nodeId:instanceId,path }))} t={t}
              onIntent={intent => setCellAlignment(paths.map(path => ({ nodeId:instanceId,path })), intent)} />
          </div>
          <h4>{t('designerGridCell')}</h4>
          {!active ? (
            <p>{t('designerDormantCellOverrides')}</p>
          ) : (
            <>
              {!manual ? <p>{t('designerCellAnchorsAutomatic')}</p> : null}
              {first.parent.id === stored?.componentId && !selectedGrid?.active ? (
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={!manual}
                    disabled={!editable.length}
                    onChange={(event) => {
                      commit(setDesignGridPositioning(doc, instanceId, event.currentTarget.checked))
                    }}
                  />
                  {t('designerGridAutoPosition')}
                </label>
              ) : null}
              <div className={css.fields}>
                {fields.map(({ key, labelKey }) => {
                  const anchor = key === 'column' || key === 'row'
                  const values = contexts.map(item => item.value?.node.gridCell?.[key] ?? 1)
                  const max = Math.max(
                    1,
                    Math.min(
                      ...contexts.map((item) => {
                        const cell = item.value?.node.gridCell
                        const columns =
                          item.value?.parent.grid?.columns.length ??
                          defaultDesignGrid().columns.length
                        return key === 'column'
                          ? columns - (cell?.columnSpan ?? 1) + 1
                          : key === 'row'
                            ? 4096 - (cell?.rowSpan ?? 1) + 1
                            : key === 'columnSpan'
                              ? columns
                              : 64
                      }),
                    ),
                  )
                  return (
                    <DesignerNumberField
                      key={`${owner}:${key}`}
                      label={t(labelKey)}
                      short={key === 'column' || key === 'columnSpan' ? '↔' : '↕'}
                      value={values.every(value => value === values[0]) ? (values[0] ?? 1) : null}
                      min={1}
                      max={max}
                      disabled={!editable.length || (anchor && !manual)}
                      mixed={t('designerMixed')}
                      onCommit={value => edit({ [key]: Math.round(value) })}
                    />
                  )
                })}
              </div>
            </>
          )}
          <h4>{t('designerInstanceCellOverrides')}</h4>
          {(['horizontalAlign', 'verticalAlign'] as const).map((key) => {
            const labelKey = key === 'horizontalAlign' ? 'designerHorizontalCellAlignment' : 'designerVerticalCellAlignment'
            const owns = contexts.some(item => item.value?.localCell?.[key] !== undefined)
            const allOwn = contexts.every(item => item.value?.localCell?.[key] !== undefined)
            if (!owns && (!active || contexts.some(item => item.value?.parent.preserveLayout))) return null
            return <div className={css.ownerRow} key={key}>
              <span className={css.ownerInfo}>
                <span>{t(labelKey)}</span>
                <small>{t(allOwn ? 'designerEffectsLocal' : owns ? 'designerMixed' : 'designerEffectsInherited')}</small>
              </span>
              <button type="button" disabled={!editable.length || editable.length !== contexts.length}
                aria-label={`${t(owns ? 'designerInheritedCellProperty' : 'designerOwnValue')}: ${t(labelKey)}`}
                onClick={() => {
                  if (editable.length !== contexts.length) return
                  edit(owns ? { [key]:undefined } : context => ({ [key]:context.node.gridCell?.[key] ?? 'start' }))
                }}>
                {t(owns ? 'designerInheritAction' : 'designerOwnAction')}
              </button>
            </div>
          })}
          {fields.map(({ key, labelKey }) => {
            const owns = contexts.some(item => item.value?.localCell?.[key] !== undefined)
            const allOwn = contexts.every(item => item.value?.localCell?.[key] !== undefined)
            const anchor = key === 'column' || key === 'row'
            if (!owns && (!active || (anchor && !manual))) return null
            return (
              <div key={key} className={css.ownerRow}>
                <span className={css.ownerInfo}>
                  <span>{t(labelKey)}</span>
                  <small>{t(allOwn ? 'designerEffectsLocal' : owns ? 'designerMixed' : 'designerEffectsInherited')}</small>
                </span>
                <button
                  type="button"
                  disabled={!editable.length}
                  aria-label={`${t(owns ? 'designerInheritedCellProperty' : 'designerOwnValue')}: ${t(labelKey)}`}
                  onClick={() => {
                    edit(
                      owns
                        ? { [key]: undefined }
                        : context => ({ [key]: context.node.gridCell?.[key] ?? 1 }),
                    )
                  }}
                >
                  {t(owns ? 'designerInheritAction' : 'designerOwnAction')}
                </button>
              </div>
            )
          })}
          <button
            type="button"
            disabled={!editable.some(item => !!item.value?.localCell)}
            onClick={() => {
              edit(null)
            }}
          >
            {t('designerResetInstanceCell')}
          </button>
        </>
      )}
      <DesignerInstanceCellChooser doc={doc} instanceId={instanceId} t={t} onSelect={onSelect} />
    </section>
  )
}
