/** Inspector section linking narrower layouts to a top-level artboard for responsive page conversion. */
import { useState, type ReactNode } from 'react'
import { createDesignBreakpoint, designBreakpointFrames, editDesignNodes, syncDesignBreakpointContent } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { DesignerDisclosureSection } from './DesignerDisclosureSection.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

const presets = [
  { key: 'designerBreakpointAddTablet', name: 'designerBreakpointTabletName', width: 768, maxWidth: 1023 },
  { key: 'designerBreakpointAddMobile', name: 'designerBreakpointMobileName', width: 390, maxWidth: 767 },
] as const satisfies readonly { key: CopyOSFoundationLocaleKey; name: CopyOSFoundationLocaleKey; width: number; maxWidth: number }[]

/**
 * Create, list, select and detach breakpoint artboards; layout edits happen on the breakpoint artboard itself.
 * @param props - Current document, selected top-level frame, disabled state, copy, workspace commit and selection callback.
 * @returns A Properties section for top-level unlinked frames, otherwise null.
 */
export function DesignerBreakpoints({ doc, node, disabled, t, commit, select }: {
  doc: CopyOSDesignDocument
  node: CopyOSDesignNode
  disabled: boolean
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean
  select: (frame: CopyOSDesignNode) => void
}): ReactNode {
  const [error, setError] = useState('')
  if (node.kind !== 'frame' || node.parentId !== null || node.pageLink) return null
  const source = node.breakpoint ? doc.nodes.find(item => item.id === node.breakpoint?.sourceFrameId) : undefined
  if (node.breakpoint && source) {
    const stale = syncDesignBreakpointContent(doc, node.id)
    return <section className={css.propertySection} aria-label={t('designerBreakpoints')}>
      <div className={css.sectionHeading}><h3>{t('designerBreakpoints')}</h3></div>
      <p>{t('designerBreakpointOf').replace('{name}', source.name).replace('{max}', String(node.breakpoint.maxWidth))}</p>
      <p className={css.hint}>{t('designerBreakpointOfHint')}</p>
      <button type="button" onClick={() => { select(source) }}>{t('designerBreakpointSelectSource').replace('{name}', source.name)}</button>
      {stale.changed ? <>
        <p className={css.hint} role="status">{t('designerBreakpointStale').replace('{count}', String(stale.changed))}</p>
        <button type="button" disabled={disabled} onClick={() => { commit(stale.document) }}>
          {t('designerBreakpointSync').replace('{name}', source.name)}</button>
      </> : <p className={css.hint}>{t('designerBreakpointInSync')}</p>}
      <button type="button" disabled={disabled} onClick={() => {
        const descendants = new Set([node.id])
        for (let grew = true; grew;) {
          grew = false
          for (const item of doc.nodes) {
            if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); grew = true }
          }
        }
        commit(editDesignNodes(doc, doc.nodes.filter(item => descendants.has(item.id) && (item.breakpoint || item.breakpointSourceId))
          .map(item => ({ id: item.id, breakpoint: undefined, breakpointSourceId: undefined }))))
      }}>{t('designerBreakpointDetach')}</button>
    </section>
  }
  const frames = designBreakpointFrames(doc, node.id)
  return <DesignerDisclosureSection title={t('designerBreakpoints')}>
    <p className={css.hint}>{t('designerBreakpointsHint')}</p>
    {frames.length ? <ul>{frames.map((frame, index) => {
      const min = index ? (frames[index - 1]?.breakpoint?.maxWidth ?? 0) + 1 : 0, max = frame.breakpoint?.maxWidth ?? 0
      return <li key={frame.id}>
        <button type="button" onClick={() => { select(frame) }}>{frame.name}</button>{' '}
        <span>{min ? t('designerBreakpointRangeBetween').replace('{min}', String(min)).replace('{max}', String(max))
          : t('designerBreakpointRange').replace('{max}', String(max))}</span>
      </li>
    })}</ul> : null}
    {presets.filter(preset => !frames.some(frame => frame.breakpoint?.maxWidth === preset.maxWidth)).map(preset =>
      <button key={preset.key} type="button" disabled={disabled} onClick={() => {
        try {
          const created = createDesignBreakpoint(doc, node.id, { width: preset.width, maxWidth: preset.maxWidth,
            name: t(preset.name).replace('{name}', node.name) }, randomUUID)
          setError('')
          const frame = created.document.nodes.find(item => item.id === created.frameId)
          if (commit(created.document) && frame) select(frame)
        } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)) }
      }}>{t(preset.key)}</button>)}
    {error ? <p role="alert">{error}</p> : null}
  </DesignerDisclosureSection>
}
