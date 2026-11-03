/** The workspace branding guide supplies typography choices without replacing a design's local resource library. */
import { useEffect, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { designBrandTypography, designTextStyleValues, editDesignNodes } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignTextStyle,
  CopyOSStyleGuideDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/**
 * Import a chosen branding snapshot and apply it to editable stored text layers in one undoable document edit.
 * @param document - Current design; existing local styles remain unchanged.
 * @param items - Current inspector selection, including inherited lock state.
 * @param source - Workspace typography snapshot.
 * @returns Updated design, or the unchanged document when no editable text is selected.
 */
export function applyDesignerBrandTextStyle(document: CopyOSDesignDocument, items: readonly CopyOSDesignNode[],
  source: CopyOSDesignTextStyle): CopyOSDesignDocument {
  const ids = new Set(items.filter(item => item.kind === 'text' && !item.locked).map(item => item.id))
  const nodes = document.nodes.filter(node => ids.has(node.id) && node.kind === 'text')
  if (!nodes.length) return document
  const resources = document.textStyles ?? []
  const matching = resources.find(style => style.name === source.name &&
    JSON.stringify(designTextStyleValues(style)) === JSON.stringify(designTextStyleValues(source)))
  const style = matching ?? { ...source, id: resources.some(item => item.id === source.id) ? randomUUID() : source.id }
  const fields = { ...designTextStyleValues(style), textStyleId: style.id }
  return editDesignNodes({ ...document, textStyles: matching ? resources : [...resources, style] }, nodes.map(node => ({
    id: node.id, ...fields,
    numericBindings: Object.fromEntries(Object.entries(node.numericBindings ?? {}).filter(([key]) => !(key in fields))),
  })))
}

/**
 * Fetch the current workspace guide when the typography picker opens; stale and unmounted responses cannot replace its choices.
 * @param props - Workspace identity, resource read, search and selected-layer mutation callback.
 * @returns Branded typography choices with explicit missing, unsupported and retry states.
 */
export function DesignerBrandTextStyles({ workspaceId, getStyleGuide, query, t, onApply }: {
  workspaceId: string
  getStyleGuide: (workspaceId: string) => Promise<CopyOSStyleGuideDocument | undefined>
  query: string
  t: Translate
  onApply: (style: CopyOSDesignTextStyle) => void
}): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    workspaceId: string
    guide: CopyOSStyleGuideDocument | undefined
    styles: CopyOSDesignTextStyle[]
    skipped: number
    error: boolean
  } | null>(null)
  useEffect(() => {
    let active = true
    setState(null)
    void getStyleGuide(workspaceId).then((guide) => {
      if (!active) return
      const result = guide ? designBrandTypography(guide) : { styles: [], skipped: 0 }
      setState({ workspaceId, guide, ...result, error: false })
    }).catch(() => { if (active) setState({ workspaceId, guide: undefined, styles: [], skipped: 0, error: true }) })
    return () => { active = false }
  }, [workspaceId, getStyleGuide, attempt])
  const current = state?.workspaceId === workspaceId ? state : null
  return <section aria-label={t('designerBrandTextStyles')}>
    <strong>{t('designerBrandTextStyles')}</strong>
    {current === null ? <span role="status" aria-label={t('styleGuideLoading')}>…</span> : current.error ? <div role="alert">
      <p>{t('designerBrandTextStylesError')}</p>
      <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
    </div> : <>
      {current.guide ? <small>{current.guide.name}</small> : <p>{t('designerNoStyleGuide')}</p>}
      {current.guide && !current.styles.length ? <p>{t('designerBrandTextStylesEmpty')}</p> : null}
      {current.skipped ? <p>{t('designerBrandTextStylesSkipped').replace('{count}', String(current.skipped))}</p> : null}
      {current.styles.filter(style => style.name.toLowerCase().includes(query.toLowerCase())).map(style =>
        <button type="button" key={style.id} onClick={() => { onApply(style) }}>
          <b style={{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle }}>
            {t('designerTypeSample')}</b><span>{style.name}</span><small>{style.fontSize}/{Math.round(style.fontSize * style.lineHeight)}</small>
        </button>)}
    </>}
  </section>
}
