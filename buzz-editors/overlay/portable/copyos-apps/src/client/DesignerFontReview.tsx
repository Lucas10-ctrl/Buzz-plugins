/** Explicit document-wide substitutions with conservative browser family evidence. */
import type { DesignerProjectFontsState } from './DesignerProjectFonts.ts'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerFontPicker } from './DesignerFontPicker.tsx'
import { designerFontLabels } from './DesignerFontLabels.ts'
import { normalizeDesignerFont } from './DesignerFonts.ts'
import {
  designerFontEvidence, designerFontReport, replaceDesignerDocumentFont,
  type DesignerFontEvidence,
} from './DesignerFontReviewModel.ts'
import css from './DesignerFontReview.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string
interface Session { document: CopyOSDesignDocument; evidence: DesignerFontEvidence; generation: number }
const statusKeys = {
  available: 'designerFontAvailable', 'family-known': 'designerFontFamilyKnown', fallback: 'designerFontFallback',
  loading: 'designerFontLoading', failed: 'designerFontFailed', unverified: 'designerFontUnverified',
} satisfies Record<string, CopyOSFoundationLocaleKey>

/** Review all stored font references and commit replacements as one document transaction.
 * @param props - Current document, localized copy and owning transaction callbacks.
 * @returns A self-contained review popover; opening never modifies text or requests local font access.
 */
export function DesignerFontReview({ doc, t, commit, cancelPreview, projectFonts }: {
  doc: CopyOSDesignDocument
  t: Translate
  commit: (doc: CopyOSDesignDocument) => boolean | void
  cancelPreview: () => void
  /** Project font files; omission hides the project font section. */
  projectFonts?: DesignerProjectFontsState | undefined
}): ReactNode {
  const [session, setSession] = useState<Session | null>(null)
  const generation = useRef(0), host = useRef<HTMLDivElement>(null), restoreFocus = useRef(false)
  const [popoverGeneration, setPopoverGeneration] = useState(0)
  useLayoutEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    host.current?.querySelector('button')?.focus()
  }, [popoverGeneration])
  const show = (document: CopyOSDesignDocument): void => {
    setSession({ document, evidence: designerFontEvidence(), generation: ++generation.current })
  }
  const refresh = (): void => { show(doc) }
  return <div ref={host} className={css.host}><DesignerPopover key={popoverGeneration} label={t('designerFontReview')} closeLabel={t('designerDone')}
    trigger={t('designerFontReview')} onOpenChange={(open) => {
      if (open) { cancelPreview(); refresh() } else setSession(null)
    }} onDismiss={() => { setSession(null) }} panelClassName={css.panel}>
    {projectFonts ? <ProjectFontsSection fonts={projectFonts} t={t} onChange={refresh} /> : null}
    {session?.document === doc
      ? <FontReviewBody key={session.generation} session={session} t={t} commit={(next) => {
        if (commit(next) === false) return false
        setSession(null)
        restoreFocus.current = true
        setPopoverGeneration(value => value + 1)
        return true
      }} refresh={refresh} />
      : <><p>{t('designerFontReviewChanged')}</p><button onClick={refresh}>{t('designerFontReviewRefresh')}</button></>}
  </DesignerPopover></div>
}
/** Project font files: how many are installed, families nobody provides, and an upload button. */
function ProjectFontsSection({ fonts, t, onChange }: { fonts: DesignerProjectFontsState; t: Translate; onChange: () => void }): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const families = new Set(fonts.faces.map(face => face.family)).size
  return <section className={css.project} aria-label={t('designerProjectFonts')}>
    <p>{fonts.busy ? t('designerProjectFontsLoading')
      : t('designerProjectFontsSummary').replace('{families}', String(families)).replace('{faces}', String(fonts.faces.length))}</p>
    {fonts.unavailable.length ? <p>{t('designerProjectFontsUnavailable').replace('{families}', fonts.unavailable.join(', '))}</p> : null}
    <input ref={input} type="file" hidden accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void fonts.upload(file).then(onChange)
      }} />
    <button type="button" disabled={fonts.busy} onClick={() => { input.current?.click() }}>{t('designerProjectFontsUpload')}</button>
    {fonts.error ? <p role="alert">{fonts.error}</p> : null}
  </section>
}
function FontReviewBody({ session, t, commit, refresh }: {
  session: Session
  t: Translate
  commit: (doc: CopyOSDesignDocument) => boolean | void
  refresh: () => void
}): ReactNode {
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(40), [selected, setSelected] = useState(''),
    [replacement, setReplacement] = useState(''), [invalid, setInvalid] = useState(false)
  const report = designerFontReport(session.document, session.evidence)
  const matches = report.filter(row => row.family.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const row = report.find(item => item.key === selected)
  return <div className={css.body}>
    <p>{t('designerFontReviewHelp')}</p>
    <button onClick={refresh}>{t('designerFontReviewRefresh')}</button>
    <input aria-label={t('designerFontSearch')} placeholder={t('designerFontSearch')} value={query}
      onChange={(event) => { setQuery(event.currentTarget.value); setLimit(40) }} />
    <div className={css.list}>
      {matches.slice(0, limit).map(item => <button key={item.key} className={css.row} aria-pressed={selected === item.key}
        onClick={() => { setSelected(item.key); setReplacement(''); setInvalid(false) }}>
        <strong>{item.family}</strong><span>{t(statusKeys[item.status])}</span>
        <span>{t('designerFontReferences').replace('{layers}', String(item.layers)).replace('{styles}', String(item.styles))}</span>
        <span>{item.faces.join(' · ')}</span>
      </button>)}
      {!matches.length && <p>{t('designerFontReviewEmpty')}</p>}
    </div>
    {matches.length > limit && <button onClick={() => { setLimit(limit + 40) }}>{t('designerFontMore')}</button>}
    {row && <div className={css.replacement}>
      <label>{t('designerFontReplace')}</label>
      <DesignerFontPicker value={replacement || null} families={report.flatMap(item => item.stacks)}
        labels={designerFontLabels(t)} selectionKey={session.document.id + ':' + row.key}
        onCommit={setReplacement} onCancelPreview={() => {}} />
      <button disabled={!replacement} onClick={() => {
        if (!normalizeDesignerFont(replacement)) { setInvalid(true); return }
        const next = replaceDesignerDocumentFont(session.document, row.key, replacement)
        if (next === session.document || commit(next) === false) setInvalid(true)
      }}>{t('designerFontReplaceApply')}</button>
      {invalid && <p role="alert">{t('designerFontReplaceInvalid')}</p>}
    </div>}
  </div>
}
