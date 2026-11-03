/** Layer appearance edits keep root and contextual linked ownership distinct. */
import { useMemo, useRef, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignLayerBlendMode,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  createDesignInstanceContextReader,
  designNodeLayerBlendMode,
  DESIGN_LAYER_BLEND_MODES,
  editDesignNodes,
  mergeDesignInstanceBlendModes,
} from '../../../copyos-domain/src/design-model.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { designerBlendLabels } from './DesignerBlendLabels.ts'
import { DesignerStrokeChoice } from './DesignerStrokeChoice.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerLayerBlend.module.css'
interface BlendOwner {
  nodeId: string
  path?: readonly string[]
  locked?: boolean
}
interface BlendRow {
  stored: CopyOSDesignNode
  node: CopyOSDesignNode
  path: readonly string[] | null
  owned: boolean
  linked: boolean
  locked: boolean
}
/** Render layer blend selection with transient hover/keyboard previews and independent linked inheritance.
 * @param props - Immutable document, selected root/context owners and normal history transactions.
 * @returns A compact Appearance row; all accepted edits preserve unrelated per-layer fields.
 */
export function DesignerLayerBlend({
  doc,
  owners,
  t,
  commit,
  preview,
  cancelPreview,
}: {
  doc: CopyOSDesignDocument
  owners: readonly BlendOwner[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (document: CopyOSDesignDocument) => boolean | void
  preview: (document: CopyOSDesignDocument) => void
  cancelPreview: () => void
}): ReactNode {
  const scene = useMemo(() => createDesignRenderScene(doc), [doc])
  const readContext = useMemo(() => createDesignInstanceContextReader(doc, scene), [doc, scene])
  const storedById = useMemo(() => new Map(doc.nodes.map(node => [node.id, node])), [doc])
  const rows = owners.flatMap((owner): BlendRow[] => {
    const stored = storedById.get(owner.nodeId)
    if (!stored) return []
    if (owner.path?.length) {
      const current = readContext(owner.nodeId, owner.path)
      return current
        ? [
          {
            stored,
            node: current.node,
            path: current.overridePath,
            owned: current.record?.blendMode !== undefined,
            linked: true,
            locked: !!owner.locked || current.locked,
          },
        ]
        : []
    }
    const node = scene.root.byId.get(owner.nodeId)
    if (!node) return []
    let locked = !!owner.locked || stored.locked,
      parent = stored.parentId
    const seen = new Set<string>()
    while (parent && !seen.has(parent) && seen.size < 64) {
      seen.add(parent)
      const ancestor = storedById.get(parent)
      locked ||= !!ancestor?.locked
      parent = ancestor?.parentId ?? null
    }
    return [
      {
        stored,
        node,
        path: null,
        owned: stored.blendMode !== undefined,
        linked: stored.kind === 'instance',
        locked,
      },
    ]
  })
  const modes = rows.map(row => designNodeLayerBlendMode(row.node))
  const value = modes.length && modes.every(mode => mode === modes[0]) ? (modes[0] ?? null) : null
  const session = useRef<{
    document: CopyOSDesignDocument
    rows: BlendRow[]
    value: CopyOSDesignLayerBlendMode | null
    previewed: boolean
  } | null>(null)
  const key = `${doc.id}:${JSON.stringify(owners)}:${rows.map(row => (row.locked ? '1' : '0')).join('')}`
  const edit = (
    source: CopyOSDesignDocument,
    targets: readonly BlendRow[],
    mode: CopyOSDesignLayerBlendMode | null,
  ): CopyOSDesignDocument => {
    const updates = new Map<string, CopyOSDesignNode>()
    const roots = new Set<string>(),
      contexts = new Set<string>()
    for (const row of targets) {
      if (row.locked || (mode === null && !row.linked)) continue
      const current = updates.get(row.stored.id) ?? row.stored
      if (row.path) contexts.add(current.id)
      else roots.add(current.id)
      updates.set(
        current.id,
        row.path
          ? mergeDesignInstanceBlendModes(current, [{ path: row.path, blendMode: mode }])
          : { ...current, blendMode: mode ?? undefined },
      )
    }
    return updates.size
      ? editDesignNodes(
        source,
        [...updates.values()].map(node => ({
          id: node.id,
          ...(roots.has(node.id) ? { blendMode: node.blendMode } : {}),
          ...(contexts.has(node.id) ? { instanceOverrides: node.instanceOverrides } : {}),
        })),
      )
      : source
  }
  const cancel = (): void => {
    const original = session.current
    session.current = null
    if (original?.previewed) cancelPreview()
  }
  const selectedMode = session.current ? session.current.value : value
  const modeLabel = (mode: CopyOSDesignLayerBlendMode): string =>
    t(mode === 'pass-through' ? 'designerBlendPassThrough' : designerBlendLabels[mode])
  const ownsLinked = rows.some(row => row.linked && row.owned)
  return (
    <div className={css.container}>
      <fieldset
        className={css.root}
        disabled={!rows.some(row => !row.locked)}
        aria-label={t('designerLayerBlendMode')}
        aria-description={selectedMode ? modeLabel(selectedMode) : t('designerMixed')}
      >
        <span className={css.label}>{t('designerLayerBlendMode')}</span>
        <div className={css.controls} data-has-reset={rows.some(row => row.linked) || undefined}>
          <DesignerStrokeChoice
            key={key}
            label={t('designerLayerBlendMode')}
            value={selectedMode}
            mixed={t('designerMixed')}
            choices={DESIGN_LAYER_BLEND_MODES.map(mode => ({
              id: mode,
              label: modeLabel(mode),
            }))}
            onBegin={() => {
              session.current = { document: doc, rows, value, previewed: false }
            }}
            onPreview={(mode) => {
              const original = session.current
              if (!original) return
              original.previewed = true
              preview(edit(original.document, original.rows, mode as CopyOSDesignLayerBlendMode))
            }}
            onCommit={(mode) => {
              const original = session.current ?? { document: doc, rows }
              const accepted = commit(
                edit(original.document, original.rows, mode as CopyOSDesignLayerBlendMode),
              )
              if (accepted !== false) session.current = null
              return accepted
            }}
            onCancel={cancel}
          />
          {rows.some(row => row.linked) ? (
            <Tooltip
              portal
              label={
                ownsLinked
                  ? `${t('designerResetLayerBlend')} · ${t('designerLocalSizing')}`
                  : t('designerInheritedSizing')
              }
            >
              <span className={css.resetSlot}>
                <button
                  type="button"
                  className={css.reset}
                  aria-label={t('designerResetLayerBlend')}
                  disabled={!rows.some(row => row.linked && row.owned && !row.locked)}
                  onClick={() => {
                    commit(edit(doc, rows, null))
                  }}
                >
                  <DesignerIcon name="undo" />
                </button>
              </span>
            </Tooltip>
          ) : null}
        </div>
      </fieldset>
    </div>
  )
}
