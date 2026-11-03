/** Selection color edits update matching fills, gradient stops and strokes without flattening paints. */
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignPaint,
  CopyOSDesignTextRun,
} from '../../../copyos-domain/src/types.ts'
import {
  designNodePaints,
  designAuthoredStrokePaints,
  designStrokeWeights,
  editDesignNodes,
  designNodeModeIds,
  resolveDesignModeColors,
  designColorVariableCss,
  createDesignRenderScene,
  createDesignInstanceContextReader,
  designInstanceOverrideLayers,
} from '../../../copyos-domain/src/design-model.ts'
import { designerStrokeItems } from './DesignerStrokeEdits.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
interface SelectionColorsProps {
  doc: CopyOSDesignDocument
  selection: readonly string[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
}
/** Render shared selection colors; editing changes occurrences, leaving resource definitions untouched.
 * The rows are recomputed only when the document, selection or locale changes: the Canvas re-renders on every pan and zoom,
 * and scanning a large selection each time is costly. Transactions always call the caller's latest callbacks.
 * @param props - Native scene, selected identities and common paint transactions.
 * @returns Color rows for visible, editable selected layers and their descendants.
 */
export function DesignerSelectionColors(props: SelectionColorsProps): ReactNode {
  const latest = useRef(props)
  latest.current = props
  const actions = useMemo(() => ({
    commit: (doc: CopyOSDesignDocument) => { latest.current.commit(doc) },
    preview: (doc: CopyOSDesignDocument) => { latest.current.preview(doc) },
    cancelPreview: () => { latest.current.cancelPreview() },
  }), [])
  return <SelectionColorRows doc={props.doc} selectionKey={props.selection.join('\n')} t={props.t} {...actions} />
}
const SelectionColorRows = memo(function SelectionColorRows({ selectionKey, ...props }:
Omit<SelectionColorsProps, 'selection'> & { selectionKey: string }): ReactNode {
  return <SelectionColorsBody {...props} selection={selectionKey ? selectionKey.split('\n') : []} />
})
function SelectionColorsBody({
  doc,
  selection,
  t,
  commit,
  preview,
  cancelPreview,
}: {
  doc: CopyOSDesignDocument
  selection: readonly string[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
}): ReactNode {
  const [origin, setOrigin] = useState<CopyOSDesignDocument | null>(null)
  const committedColors = useRef(new Map<string, string>())
  const source = origin ?? doc
  const modes = designNodeModeIds(source)
  const palettes = new Map<string | null, ReturnType<typeof resolveDesignModeColors>>()
  const resourcesFor = (id: string) => {
    const mode = modes.get(id) ?? null
    let values = palettes.get(mode)
    if (!values) {
      values = resolveDesignModeColors(source, mode)
      palettes.set(mode, values)
    }
    return values
  }
  const nodes = new Map(source.nodes.map(n => [n.id, n])),
    selected = new Set(selection)
  const colors = new Map<
    string,
    {
      name: string
      color: string
      alpha: number
      ids: Set<string>
      variableId: string | null
      modeId: string | null
      resources: ReturnType<typeof resourcesFor>
      inline: boolean
    }
  >()
  const keyFor = (color: string, id: string | null | undefined, nodeId: string): string => {
    const effective = resourcesFor(nodeId).find(v => v.id === id)
    return id && effective ? `${id}:${designColorVariableCss(effective)}` : color.toLowerCase()
  }
  const editableNodes: CopyOSDesignNode[] = []
  for (const n of source.nodes) {
    let current = nodes.get(n.id),
      included = false,
      editable = true
    while (current) {
      included ||= selected.has(current.id)
      if (!current.visible || current.opacity <= 0 || current.locked) editable = false
      current = current.parentId ? nodes.get(current.parentId) : undefined
    }
    if (included && editable) editableNodes.push(n)
  }
  const strokeNodes = new Map(
    designerStrokeItems(source, editableNodes).map(node => [node.id, node]),
  )
  const runTargets: { ownerId: string; path?: string[]; runs: CopyOSDesignTextRun[] }[] = []
  const scene = editableNodes.some(node => node.kind === 'instance') ? createDesignRenderScene(source) : null
  const reader = scene ? createDesignInstanceContextReader(source, scene) : null
  for (const node of editableNodes) {
    if (node.kind === 'text' && node.textRuns?.some(run => run.style.fill)) runTargets.push({ ownerId: node.id, runs: node.textRuns })
    if (node.kind !== 'instance' || !scene || !reader) continue
    for (const row of designInstanceOverrideLayers(source, node.id, 50000, scene).layers) {
      if (row.node.kind !== 'text' || !row.node.textRuns?.some(run => run.style.fill)) continue
      const current = reader(node.id, row.path)
      if (!current || current.locked) continue
      let visible = true, ancestor: CopyOSDesignNode | undefined = current.node
      while (ancestor) {
        if (!ancestor.visible || ancestor.opacity <= 0) visible = false
        ancestor = ancestor.parentId ? current.context.byId.get(ancestor.parentId) : undefined
      }
      for (let length = 1; visible && length < row.path.length; length++) {
        const parent = reader(node.id, row.path.slice(0, length))
        if (parent && (!parent.node.visible || parent.node.opacity <= 0)) visible = false
      }
      if (visible) runTargets.push({ ownerId: node.id, path: current.overridePath, runs: current.node.textRuns ?? [] })
    }
  }
  const colorSources = (
    paints: CopyOSDesignPaint[],
  ): { color: string; variableId?: string | null | undefined }[] =>
    paints
      .filter(paint => paint.visible && paint.opacity > 0 && !paint.image)
      .flatMap((paint): { color: string; variableId?: string | null | undefined }[] =>
        paint.gradient ? paint.gradient.stops.filter(stop => stop.opacity > 0) : [paint],
      )
  for (const n of editableNodes) {
    const strokeNode = strokeNodes.get(n.id) ?? n
    const sources = [
      ...(n.kind === 'instance' ? [] : colorSources(designNodePaints(n))),
      ...(Math.max(...Object.values(designStrokeWeights(strokeNode))) > 0 &&
      (strokeNode.strokeOpacity ?? 1) > 0
        ? colorSources(designAuthoredStrokePaints(source, n.id))
        : []),
    ]
    for (const source of sources) {
      const resources = resourcesFor(n.id)
      const token = resources.find(v => v.id === source.variableId),
        key = keyFor(source.color, source.variableId, n.id)
      const entry = colors.get(key) ?? {
        name: token?.name ?? source.color.slice(1).toUpperCase(),
        color: token?.value ?? source.color,
        alpha: token?.alpha ?? 1,
        ids: new Set<string>(),
        variableId: token?.id ?? null,
        modeId: modes.get(n.id) ?? null,
        resources,
        inline: false,
      }
      entry.ids.add(n.id)
      colors.set(key, entry)
    }
  }
  for (const target of runTargets) for (const run of target.runs) {
    const fill = run.style.fill
    if (!fill) continue
    const key = keyFor(fill, null, target.ownerId), existing = colors.get(key)
    const entry = existing ?? { name: fill.slice(1).toUpperCase(), color: fill, alpha: 1, ids: new Set<string>(),
      variableId: null, modeId: modes.get(target.ownerId) ?? null, resources: resourcesFor(target.ownerId), inline: true }
    entry.inline = true
    entry.ids.add(target.ownerId)
    colors.set(key, entry)
  }
  for (const entry of colors.values())
    if (
      entry.variableId &&
      [...colors.values()].some(other => other !== entry && other.variableId === entry.variableId)
    )
      entry.name +=
        ' · ' + (source.tokenModes?.find(m => m.id === entry.modeId)?.name ?? t('designerBaseMode'))
  const change = (
    key: string,
    color: string,
    variableId: string | null,
    transient = false,
  ): void => {
    const entry = colors.get(key)
    if (!entry) return
    const updates: (Partial<CopyOSDesignNode> & { id: string })[] = []
    const editPaints = (paints: CopyOSDesignPaint[], nodeId: string): CopyOSDesignPaint[] =>
      paints.map((paint) => {
        if (!paint.visible || paint.opacity <= 0 || paint.image) return paint
        if (paint.gradient) {
          const stops = paint.gradient.stops.map(stop =>
            stop.opacity <= 0 || keyFor(stop.color, stop.variableId, nodeId) !== key
              ? stop
              : {
                ...stop,
                color,
                variableId,
                ...(variableId === null ? { opacity: stop.opacity * entry.alpha } : {}),
              },
          )
          return stops.every((stop, index) => stop === paint.gradient?.stops[index])
            ? paint
            : { ...paint, gradient: { ...paint.gradient, stops } }
        }
        return keyFor(paint.color, paint.variableId, nodeId) !== key
          ? paint
          : {
            ...paint,
            color,
            variableId,
            ...(variableId === null ? { opacity: paint.opacity * entry.alpha } : {}),
          }
      })
    for (const n of editableNodes) {
      if (!entry.ids.has(n.id)) continue
      const paints = n.kind === 'instance' ? [] : designNodePaints(n),
        fills = editPaints(paints, n.id)
      const strokeNode = strokeNodes.get(n.id) ?? n
      const strokes = designAuthoredStrokePaints(source, n.id)
      const changedStrokes =
        Math.max(...Object.values(designStrokeWeights(strokeNode))) > 0 &&
        (strokeNode.strokeOpacity ?? 1) > 0
          ? editPaints(strokes, n.id)
          : strokes
      const fillChanged = fills.some((paint, index) => paint !== paints[index])
      const strokeChanged = changedStrokes.some((paint, index) => paint !== strokes[index])
      if (fillChanged || strokeChanged)
        updates.push({
          id: n.id,
          ...(fillChanged ? { fills, gradient: undefined } : {}),
          ...(strokeChanged
            ? n.kind === 'instance'
              ? { instanceStroke: { ...n.instanceStroke, strokes: changedStrokes } }
              : { strokes: changedStrokes }
            : {}),
        })
    }
    for (const target of runTargets) {
      if (!entry.ids.has(target.ownerId)) continue
      const runs = target.runs.map(run => run.style.fill && keyFor(run.style.fill, null, target.ownerId) === key
        ? { ...run, style: { ...run.style, fill: color } } : run)
      if (runs.every((run, index) => run === target.runs[index])) continue
      let update = updates.find(update => update.id === target.ownerId)
      if (!update) { update = { id: target.ownerId }; updates.push(update) }
      if (!target.path) update.textRuns = runs
      else {
        const stored = nodes.get(target.ownerId)
        if (!stored) continue
        const records = update.instanceOverrides ?? stored.instanceOverrides ?? []
        const previous = records.find(record => JSON.stringify(record.path) === JSON.stringify(target.path))
        const record = { ...previous, path: target.path, textRuns: runs }
        update.instanceOverrides = previous ? records.map(item => item === previous ? record : item) : [...records, record]
      }
    }
    const next = editDesignNodes(source, updates)
    if (transient) preview(next)
    else commit(next)
  }
  return (
    <div className={css.selectionColors}>
      {[...colors].map(([key, entry]) => (
        <div className={css.selectionColorRow} key={key}>
          <DesignerPopover
            label={t('designerSelectionColorFor').replace('{name}', entry.name)}
            closeLabel={t('designerDone')}
            triggerClassName={css.selectionColorTrigger}
            onOpenChange={(open) => {
              committedColors.current.clear()
              setOrigin(open ? doc : null)
            }}
            onDismiss={cancelPreview}
            trigger={
              <>
                <DesignerSwatch
                  className={css.paintSwatch}
                  paint={designColorVariableCss({ value: entry.color, alpha: entry.alpha })}
                />
                <span>{entry.name}</span>
                {!!entry.variableId ? <Icon name="component" /> : null}
              </>
            }
          >
            <DesignerColorPicker
              initialTab={!!entry.variableId ? 'libraries' : 'custom'}
              color={entry.color}
              opacity={1}
              resources={entry.resources}
              allowOpacity={false}
              allowLibrary={!entry.inline}
              t={t}
              onPreview={(color) => {
                if (
                  color.toLowerCase() ===
                  (committedColors.current.get(key) ?? entry.color).toLowerCase()
                )
                  cancelPreview()
                else change(key, color, null, true)
              }}
              onCommit={(color) => {
                if (
                  color.toLowerCase() ===
                  (committedColors.current.get(key) ?? entry.color).toLowerCase()
                )
                  cancelPreview()
                else {
                  change(key, color, null)
                  committedColors.current.set(key, color)
                }
              }}
              onCancel={cancelPreview}
              onVariable={(v) => {
                change(key, v.value, v.id)
                committedColors.current.set(key, v.value)
              }}
            />
            {!!entry.variableId ? (
              <button
                type="button"
                className={css.detachPaint}
                onClick={() => {
                  change(key, entry.color, null)
                }}
              >
                {t('designerDetachColor')}
              </button>
            ) : null}
          </DesignerPopover>
        </div>
      ))}
    </div>
  )
}
