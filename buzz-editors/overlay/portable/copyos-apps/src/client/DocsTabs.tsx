/** Document tabs retain one shared document while supporting keyboard and pointer navigation. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocTab } from '../../../copyos-domain/src/types.ts'
import css from './DocsWorkspace.module.css'

/** Render the current document's tab strip and its compact tab actions. */
export function DocsTabs({ tabs, active, readOnly, select, add, rename, move, copyLink, t }: PropsLocale<'copyosFoundation'> & {
  readonly tabs: readonly CopyOSDocTab[]
  readonly active: string | null
  readonly readOnly: boolean
  readonly select: (id: string) => void
  readonly add: (title: string) => void
  readonly rename: (id: string, title: string) => void
  readonly move: (id: string, index: number) => void
  readonly copyLink: (id: string) => Promise<void>
}): ReactNode {
  const [menu, setMenu] = useState(false), [editing, setEditing] = useState<string | null>(null), [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false), [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null), index = tabs.findIndex(tab => tab.id === active)
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setMenu(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside) }
  }, [menu])
  useEffect(() => {
    host.current?.querySelector<HTMLElement>(`[data-doc-tab="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const label = (tab: CopyOSDocTab, _number: number): string => tab.title || t('docsTabNumber', { number: '1' })
  const focus = (id: string): void => { requestAnimationFrame(() => host.current?.querySelector<HTMLButtonElement>(`[data-doc-tab="${id}"]`)?.focus()) }
  const choose = (id: string, keyboard = false): void => {
    setMenu(false); setCopied(false); select(id); if (keyboard) focus(id)
  }
  const beginRename = (tab: CopyOSDocTab, number: number): void => {
    setMenu(false); setDraft(label(tab, number)); setEditing(tab.id)
  }
  return <div ref={host} className={css.docTabs} onKeyDown={(event) => {
    if (event.key === 'Escape' && menu) { event.preventDefault(); setMenu(false); if (active) focus(active) }
  }}>
    <div role="tablist" aria-label={t('docsTabs')} className={css.docTabList}>
      {tabs.map((tab, number) => <button key={tab.id} id={`docs-tab-${tab.id}`} role="tab" type="button"
        aria-selected={tab.id === active} aria-controls={`docs-tab-panel-${tab.id}`} tabIndex={tab.id === active ? 0 : -1}
        title={label(tab, number)} data-doc-tab={tab.id} onClick={() => { choose(tab.id) }}
        draggable={!readOnly} onDragStart={(event) => { event.dataTransfer.setData('application/x-copyos-doc-tab', tab.id) }}
        onDragOver={(event) => { if (!readOnly) event.preventDefault() }}
        onDrop={(event) => { if (readOnly) return; event.preventDefault(); event.stopPropagation()
          const id = event.dataTransfer.getData('application/x-copyos-doc-tab'); if (tabs.some(item => item.id === id)) move(id, number)
        }}
        onDoubleClick={() => { if (!readOnly) beginRename(tab, number) }}
        onKeyDown={(event) => {
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowRight' ? (number + 1) % tabs.length : event.key === 'ArrowLeft' ? (number + tabs.length - 1) % tabs.length : -1
          const next = tabs[target]
          if (next) { event.preventDefault(); choose(next.id, true) }
          if (event.key === 'F2' && !readOnly) { event.preventDefault(); beginRename(tab, number) }
        }}>{label(tab, number)}</button>)}
    </div>
    {!readOnly ? <button type="button" disabled={tabs.length >= 50} aria-label={t('docsNewTab')} title={t('docsNewTab')}
      onClick={() => { setMenu(false); add(t('docsTabNumber', { number: String(tabs.length + 1) })) }}>＋</button> : null}
    <div className={css.docTabActions}>
      <button type="button" aria-label={t('docsTabOptions')} title={t('docsTabOptions')} aria-expanded={menu}
        onClick={() => { setMenu(!menu); setError(''); setCopied(false) }}>⋯</button>
      {menu && active ? <div className={css.docTabMenu}>
        {!readOnly ? <>
          <button type="button" onClick={() => { const tab = tabs[index]; if (tab) beginRename(tab, index) }}>{t('docsRenameTab')}</button>
          <button type="button" disabled={index <= 0} onClick={() => { move(active, index - 1); setMenu(false); focus(active) }}>{t('docsTabLeft')}</button>
          <button type="button" disabled={index >= tabs.length - 1} onClick={() => { move(active, index + 1); setMenu(false); focus(active) }}>{t('docsTabRight')}</button>
        </> : null}
        <button type="button" onClick={() => {
          setError(''); void copyLink(active).then(() => { setCopied(true) })
            .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
        }}>{t(copied ? 'docsCopied' : 'docsCopyTabLink')}</button>
        {error ? <p role="alert">{error}</p> : null}
      </div> : null}
    </div>
    {editing ? <Modal open title={t('docsRenameTab')} closeLabel={t('docsClose')} onClose={() => { setEditing(null); focus(editing) }}>
      <form className={css.docTabRename} onSubmit={(event) => {
        event.preventDefault(); rename(editing, draft.trim()); setEditing(null); focus(editing)
      }}>
        <input autoFocus aria-label={t('docsTabName')} value={draft} maxLength={200} required onFocus={(event) =>{  event.currentTarget.select() }}
          onChange={(event) => { setDraft(event.target.value) }} />
        <Button type="button" variant="outline" onClick={() => { setEditing(null); focus(editing) }}>{t('docsCancel')}</Button>
        <Button type="submit" disabled={!draft.trim()}>{t('docsSaveTab')}</Button>
      </form>
    </Modal> : null}
  </div>
}
