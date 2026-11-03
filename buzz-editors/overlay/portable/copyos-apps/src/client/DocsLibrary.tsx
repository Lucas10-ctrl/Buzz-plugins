/** Searchable document gallery; opening a draft is owned by its save-aware model. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEditorChrome } from '../EditorChrome.tsx'
import type { CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'
import css from './DocsWorkspace.module.css'

function bodyText(value: string): string {
  const plain = value.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*?)?\/?>/giu, ' ')
    .replace(/^\s*```[^\n]*$/gmu, '').replace(/^\s*>?\s*\[![A-Z]+\]\s*$/gmu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').replace(/[#*_`>]/gu, '')
  const decoder = document.createElement('textarea')
  return plain.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/giu, (entity) => { decoder.innerHTML = entity; return decoder.value })
    .replace(/\s+/gu, ' ').trim()
}

type Props = PropsLocale<'copyosFoundation'> & {
  readonly documents: readonly CopyOSDocDocument[]
  readonly trashedDocuments: readonly CopyOSDocDocument[]
  readonly restore: (id: string) => void
  readonly currentId: string | undefined
  readonly pending: boolean
  readonly loading: boolean
  readonly error: string
  readonly open: (id: string) => void
  readonly create: () => void
  readonly importFile: () => void
  readonly close: (() => void) | undefined
}
/** Render a keyboard-searchable gallery without unmounting the current editor's drafts. */
export function DocsLibrary({ t, documents, trashedDocuments, restore, currentId, pending, loading, error,
  open, create, close, importFile }: Props): ReactNode {
  const { Button, DocumentIcon } = useEditorChrome()
  const [query, setQuery] = useState('')
  const [trash, setTrash] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { search.current?.focus() }, [])
  const currentTrash = trashedDocuments.find(doc => doc.id === currentId)
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  const matches = [...(trash ? trashedDocuments : documents)].filter((doc) => {
    const text = `${doc.title}\n${doc.blocks.map(block => `${block.label}\n${bodyText(block.content)}`).join('\n')}`.toLocaleLowerCase()
    return words.every(word => text.includes(word))
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return <section className={css.library} aria-label={t('docsAll')} onKeyDown={(event) => {
    if (event.key === 'Escape' && close) { event.preventDefault(); close() }
  }}>
    <header>
      <div><h1>{t('docsTitle')}</h1><p>{t('docsDescription')}</p></div>
      <div className={css.libraryActions}>
        <Button variant="ghost" size="sm" disabled={pending || loading} onClick={importFile}>{t('docsImport')}</Button>
        <Button variant="prominent" size="sm" disabled={pending || loading} onClick={create}>＋ {t('docsNew')}</Button>
      </div>
    </header>
    <nav className={css.libraryTabs} aria-label={t('docsLibraryView')}>
      <button aria-pressed={!trash} onClick={() => { setTrash(false) }}>{t('docsAll')}</button>
      <button aria-pressed={trash} onClick={() => { setTrash(true) }}>{t('docsTrash')}</button>
    </nav>
    {!trash && currentTrash ? <div className={css.trashBanner} role="status"><span>{t('docsInTrash')}</span>
      <button disabled={pending} onClick={() => { restore(currentTrash.id) }}>{t('docsRestore')}</button></div> : null}
    {trash ? <p className={css.trashHint}>{t('docsTrashHint')}</p> : null}
    <div className={css.librarySearch}>
      <input ref={search} type="search" value={query} placeholder={t('docsSearch')} aria-label={t('docsSearch')}
        onChange={(event) => { setQuery(event.target.value) }} />
      {close ? <Button variant="ghost" size="sm" onClick={close}>{t('docsReturn')}</Button> : null}
    </div>
    {error ? <p role="alert" className={css.error}>{error}</p> : null}
    {loading ? <div className={css.skeleton} aria-label={t('docsLoading')} /> : <>
      <p className={css.libraryCount} role="status">{t(matches.length === 1 ? 'docsLibraryCountSingle' : 'docsLibraryCount', { count: String(matches.length) })}</p>
      {matches.length ? <ul className={css.libraryList}>{matches.map(doc => <li key={doc.id}>
        <button disabled={pending} aria-current={doc.id === currentId ? 'page' : undefined} onClick={() => { if (trash) restore(doc.id); else open(doc.id) }}>
          <DocumentIcon size={22} />
          <span><strong>{doc.title || t('docsUntitled')}</strong><span>{doc.blocks.map(block => bodyText(block.content)).join(' ').slice(0, 180) || t('docsBlank')}</span></span>
          {trash ? <span className={css.restoreLabel}>{t('docsRestore')}</span> : null}
          <time dateTime={doc.updatedAt}>{new Date(doc.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
        </button>
      </li>)}</ul> : <div className={css.empty}><h2>{t(words.length ? 'docsNoResults' : trash ? 'docsTrashEmpty' : 'docsEmpty')}</h2><p>{t(words.length ? 'docsSearchHint' : trash ? 'docsTrashHint' : 'docsEmptyHint')}</p></div>}
    </>}
  </section>
}
