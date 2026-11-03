/** Templates: saved artboards from every project, inserted into the open design; the selected artboard can be saved as one. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignClipboardSnapshot, CopyOSDesignTemplateSummary,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Template operations bound to the open project and design. */
export interface DesignerTemplateActions {
  list: () => Promise<readonly CopyOSDesignTemplateSummary[]>
  read: (templateId: string) => Promise<CopyOSDesignClipboardSnapshot>
  save: (nodeId: string, details: { title: string; category: string; description: string }) => Promise<CopyOSDesignTemplateSummary>
  remove: (templateId: string) => Promise<void>
}

/**
 * Templates panel: search and category filter, a card per template, insert on click, and saving the selected artboard.
 * @param props - Translator, template operations, the selected top-level artboard, unsaved state, the insert action and close.
 * @returns The panel.
 */
export function DesignerTemplatesPanel({ t, actions, artboard, unsaved, onInsert, onClose }: {
  t: Translate
  actions: DesignerTemplateActions
  artboard: { id: string; name: string } | null
  unsaved: boolean
  onInsert: (snapshot: CopyOSDesignClipboardSnapshot) => boolean
  onClose: () => void
}): ReactNode {
  const [templates, setTemplates] = useState<readonly CopyOSDesignTemplateSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState<{ title: string; category: string; description: string } | null>(null)
  const fail = (failure: unknown): void => { setError(failure instanceof Error ? failure.message : String(failure)) }
  const load = useCallback(() => {
    actions.list().then(setTemplates, fail)
  }, [actions])
  useEffect(load, [load])
  const categories = useMemo(() => [...new Set((templates ?? []).map(item => item.category))].sort(), [templates])
  const shown = (templates ?? []).filter(item => (category === null || item.category === category) &&
    `${item.title} ${item.category} ${item.description} ${item.sourceWorkspaceName}`.toLowerCase().includes(query.trim().toLowerCase()))
  const insert = (item: CopyOSDesignTemplateSummary): void => {
    setBusy(item.id); setError(null)
    actions.read(item.id).then((snapshot) => { if (onInsert(snapshot)) onClose() }, fail).finally(() => { setBusy(null) })
  }
  return (
    <aside className={css.headerDrawer} aria-label={t('designerTemplates')}>
      <header>
        <div><h2>{t('designerTemplates')}</h2><small>{t('designerTemplatesIntro')}</small></div>
        <button type="button" aria-label={t('designerDone')} onClick={onClose}>×</button>
      </header>
      <input className={css.templateSearch} type="search" value={query} placeholder={t('designerTemplatesSearch')}
        aria-label={t('designerTemplatesSearch')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      {categories.length > 1 ? <nav className={css.templateCategories} aria-label={t('designerTemplateCategory')}>
        <button type="button" aria-pressed={category === null} onClick={() => { setCategory(null) }}>{t('designerTemplatesAll')}</button>
        {categories.map(value => <button key={value} type="button" aria-pressed={category === value}
          onClick={() => { setCategory(value) }}>{value}</button>)}
      </nav> : null}
      {error ? <p role="alert">{error}</p> : null}
      {templates === null ? <p role="status">{t('designerLoading')}</p> : null}
      {templates?.length === 0 ? <p className={css.headerDrawerEmpty}>{t('designerTemplatesEmpty')}</p> : null}
      <ul className={css.templateGrid}>
        {shown.map(item => <li key={item.id}>
          <button type="button" className={css.templateCard} disabled={busy !== null} aria-busy={busy === item.id}
            title={item.description || item.title} onClick={() => { insert(item) }}>
            {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className={css.templateBlank} />}
            <strong>{item.title}</strong>
            <small>{item.category} · {String(Math.round(item.width))}×{String(Math.round(item.height))} · {item.sourceWorkspaceName}</small>
          </button>
          <button type="button" className={css.templateDelete} aria-label={`${t('designerTemplateDelete')} ${item.title}`}
            disabled={busy !== null} onClick={() => {
              if (!globalThis.confirm(t('designerTemplateDeleteConfirm').replace('{name}', item.title))) return
              setBusy(item.id)
              actions.remove(item.id).then(load, fail).finally(() => { setBusy(null) })
            }}>×</button>
        </li>)}
      </ul>
      <section className={css.templateSave}>
        {saving ? <form onSubmit={(event) => {
          event.preventDefault()
          if (!artboard || !saving.title.trim()) return
          setBusy('save'); setError(null)
          actions.save(artboard.id, { title: saving.title.trim(), category: saving.category.trim() || 'General', description: saving.description.trim() })
            .then(() => { setSaving(null); load() }, fail).finally(() => { setBusy(null) })
        }}>
          <label><span>{t('designerTemplateTitle')}</span><input value={saving.title} required maxLength={120}
            onChange={(event) => { setSaving({ ...saving, title: event.currentTarget.value }) }} /></label>
          <label><span>{t('designerTemplateCategory')}</span><input value={saving.category} maxLength={60} list="designer-template-categories"
            onChange={(event) => { setSaving({ ...saving, category: event.currentTarget.value }) }} /></label>
          <datalist id="designer-template-categories">{categories.map(value => <option key={value} value={value} />)}</datalist>
          <label><span>{t('designerTemplateDescription')}</span><textarea rows={2} value={saving.description} maxLength={1000}
            onChange={(event) => { setSaving({ ...saving, description: event.currentTarget.value }) }} /></label>
          <div>
            <button type="button" onClick={() => { setSaving(null) }}>{t('cancel')}</button>
            <button type="submit" data-primary="true" disabled={busy !== null}>{t('designerTemplateSave')}</button>
          </div>
        </form> : <button type="button" disabled={!artboard || unsaved || busy !== null}
          title={unsaved ? t('designerTemplateSaveFirst') : artboard ? undefined : t('designerTemplateSelectArtboard')}
          onClick={() => { if (artboard) setSaving({ title: artboard.name, category: 'General', description: '' }) }}>
          {artboard ? t('designerTemplateSaveSelected').replace('{name}', artboard.name) : t('designerTemplateSelectArtboard')}
        </button>}
        {unsaved && artboard ? <small>{t('designerTemplateSaveFirst')}</small> : null}
      </section>
    </aside>
  )
}
