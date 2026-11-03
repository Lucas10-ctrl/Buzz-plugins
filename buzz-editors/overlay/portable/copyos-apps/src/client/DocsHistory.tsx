/** Read-only version review; restoring adds a revision instead of replacing history. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DocsRichBlock } from './DocsRichBlock.tsx'
import { DocsReadView } from './DocsReadView.tsx'
import { useEditorChrome } from '../EditorChrome.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocHistoryEntry, CopyOSDocHistoryListValue, CopyOSDocHistoryReadValue } from '../../../copyos-domain/src/types.ts'
import { wordDiff } from './word-diff.ts'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import css from './DocsWorkspace.module.css'

type Props = PropsLocale<'copyosFoundation'> & {
  readonly docId: string
  readonly resolveAsset?: DocsAssetResolver | undefined
  readonly load: (before?: number) => Promise<CopyOSDocHistoryListValue>
  readonly read: (revision: number) => Promise<CopyOSDocHistoryReadValue>
  readonly name: (revision: number, name: string) => Promise<CopyOSDocHistoryEntry>
  readonly restore: (revision: number, expectedRevision: number) => Promise<void>
  readonly onClose: () => void
}
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
const idle = (): void => {}
type VersionGroup = [CopyOSDocHistoryEntry, ...CopyOSDocHistoryEntry[]]
function grouped(entries: readonly CopyOSDocHistoryEntry[]): VersionGroup[] {
  const groups: VersionGroup[] = []
  for (const entry of entries) {
    const last = groups.at(-1), previous = last?.at(-1)
    if (last && previous?.actor === entry.actor && previous.sessionId === entry.sessionId &&
      Date.parse(previous.savedAt) - Date.parse(entry.savedAt) < 30 * 60 * 1000) last.push(entry)
    else groups.push([entry])
  }
  return groups
}

function highlighted(before: string, after: string): ReactNode {
  return wordDiff(before, after).map((part, index) => part.kind === 'removed' ? <del key={index}>{part.text}</del>
    : part.kind === 'added' ? <ins key={index}>{part.text}</ins> : <span key={index}>{part.text}</span>)
}

/** Inspect saved text, name milestones, and restore with an explicit head-revision check. */
export function DocsHistory({ docId, load, read, name, restore, onClose, resolveAsset, t }: Props): ReactNode {
  const { Button, TextField, Checkbox, ReviewDialog, VersionItem, NavigationGroup } = useEditorChrome()
  const [entries, setEntries] = useState<readonly CopyOSDocHistoryEntry[]>([])
  const [head, setHead] = useState<number | null>(null), [next, setNext] = useState<number | undefined>()
  const [selected, setSelected] = useState<number | null>(null), [preview, setPreview] = useState<CopyOSDocHistoryReadValue | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [showChanges, setShowChanges] = useState(true), [draft, setDraft] = useState('')
  const request = useRef(0)
  useEffect(() => {
    let cancelled = false
    void load().then((value) => {
      if (cancelled) return
      setEntries(value.entries); setHead(value.headRevision); setNext(value.nextBefore)
      setSelected(value.entries[0]?.revision ?? null)
      if (!value.entries.length) setLoading(false)
    }).catch((cause: unknown) => { if (!cancelled) { setError(message(cause)); setLoading(false) } })
    return () => { cancelled = true }
  }, [load])
  useEffect(() => {
    if (selected === null) return
    const generation = ++request.current
    setLoading(true); setError('')
    void read(selected).then((value) => {
      if (request.current !== generation) return
      setPreview(value); setDraft(value.version.entry.name)
    }).catch((cause: unknown) => { if (request.current === generation) setError(message(cause)) })
      .finally(() => { if (request.current === generation) setLoading(false) })
    return () => { request.current++ }
  }, [selected, read])
  const labels = { code: { copyLabel: t('docsHistoryCopyCode'), copiedLabel: t('docsCopied') }, footnotes: t('docsFootnotes') }
  const current = preview?.version
  const currentTabs = current?.tabs?.length ? current.tabs : [{ id: docId, title: '' }]
  const previousTabs = preview?.previous?.tabs?.length ? preview.previous.tabs : [{ id: docId, title: '' }]
  const tabTitle = (tab: { title: string }): string => tab.title || t('docsTabNumber', { number: '1' })
  const previousTabTitle = (id: string): string => { const tab = previousTabs.find(item => item.id === id); return tab ? tabTitle(tab) : '' }
  const priorOrder = preview?.previous?.blocks
    .filter(block => current?.blocks.some(item => item.id === block.id)).map(block => block.id) ?? []
  const nextOrder = current?.blocks.filter(block => priorOrder.includes(block.id)).map(block => block.id) ?? []
  const ready = !loading && !busy && current?.entry.revision === selected
  const run = (operation: () => Promise<void>): void => {
    setBusy(true); setError('')
    void operation().catch((cause: unknown) => { setError(message(cause)) }).finally(() => { setBusy(false) })
  }
  return <ReviewDialog title={t('docsHistory')} description={t('docsHistoryHint')} closeLabel={t('docsClose')}
    onClose={onClose} busy={busy} hint={t('docsHistoryRestoreHint')} navigationLabel={t('docsHistoryVersions')}
    navigation={<>
          {grouped(entries).map(group => <NavigationGroup key={group[0].revision}
            label={`${t(group[0].actor === 'assistant' ? 'docsHistoryAssistant' : group[0].actor === 'user' ? 'docsHistoryYou' : 'docsHistorySaved')} · ${group.length === 1 ? t('docsHistoryEdit') : t('docsHistoryEdits', { count: String(group.length) })}`}>
            {group.map(entry => <VersionItem key={entry.revision} selected={entry.revision === selected}
              disabled={busy} onSelect={() => { setSelected(entry.revision) }}
              label={entry.name || t('docsHistoryVersion', { revision: String(entry.revision) })}
              dateTime={entry.savedAt} dateLabel={new Date(entry.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              currentLabel={entry.revision === head ? t('docsHistoryCurrent') : undefined}
              restoredLabel={entry.restoredFrom !== undefined ? t('docsHistoryRestoredFrom', { revision: String(entry.restoredFrom) }) : undefined} />)}
          </NavigationGroup>)}
          {next !== undefined ? <NavigationGroup label=""><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { run(async () => {
            const older = await load(next)
            setEntries(value => [...value, ...older.entries]); setNext(older.nextBefore)
          }) }}>{t('docsHistoryOlder')}</Button></NavigationGroup> : null}
        </>}
    actions={<Button variant="prominent" size="sm" disabled={!ready || selected === head || head === null} onClick={() => { run(async () => {
      if (selected === null || head === null) return
      await restore(selected, head); onClose()
    }) }}>{t('docsHistoryRestore')}</Button>}>
      {error ? <div className={css.error} role="alert">{error}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { run(async () => {
          if (head === null) {
            const value = await load(); setEntries(value.entries); setHead(value.headRevision); setNext(value.nextBefore)
            setSelected(value.entries[0]?.revision ?? null)
          } else if (selected !== null) {
            const value = await read(selected); setPreview(value); setDraft(value.version.entry.name)
          }
        }) }}>{t('docsRetry')}</Button>
      </div> : null}
        <section className={css.historyPreview} aria-label={t('docsHistoryPreview')} aria-busy={loading}>
          {loading && !current ? <div className={css.skeleton} /> : null}
          {current ? <>
            <div className={css.historyControls}>
              <form onSubmit={(event) => { event.preventDefault(); if (ready) run(async () => {
                const named = await name(current.entry.revision, draft)
                setEntries(value => value.map(entry => entry.revision === named.revision ? named : entry))
                setPreview(value => value ? { ...value, version: { ...value.version, entry: named } } : value)
              }) }}>
                <TextField label={t('docsHistoryName')} labelVisibility="hidden" placeholder={t('docsHistoryName')} value={draft} maxLength={120}
                  disabled={!ready} onValueChange={setDraft} />
                <Button type="submit" size="sm" variant="outline" disabled={!ready || draft === current.entry.name}>{t('docsHistorySaveName')}</Button>
              </form>
              <Checkbox label={t('docsHistoryShowChanges')} checked={showChanges} onCheckedChange={setShowChanges} />
            </div>
            <article className={css.historyDocument} data-loading={loading}>
              <h1 className={css.historyDiff}>{showChanges && preview.previous && preview.previous.title !== current.title
                ? highlighted(preview.previous.title, current.title) : current.title || t('docsUntitled')}</h1>
              {currentTabs.map(tab => <div key={tab.id}>
                {currentTabs.length > 1 || previousTabs.length > 1 || tab.title ? <h2 className={css.historyDiff}>
                  {showChanges ? highlighted(previousTabTitle(tab.id), tabTitle(tab)) : tabTitle(tab)}</h2> : null}
                {current.blocks.filter(block => (block.tabId ?? docId) === tab.id).map((block) => {
                  const before = preview.previous?.blocks.find(item => item.id === block.id)
                  const changed = showChanges && preview.previous !== undefined && before?.content !== block.content
                  return <section key={block.id}>
                    {block.label || before?.label ? <h2 className={css.historyDiff}>{showChanges && before && before.label !== block.label
                      ? highlighted(before.label, block.label) : block.label}</h2> : null}
                    {showChanges && before && priorOrder.indexOf(block.id) !== nextOrder.indexOf(block.id)
                      ? <p className={css.historyMoved}>{t('docsHistoryMoved')}</p> : null}
                    {changed ? <div className={css.historyRichDiff}>
                      {before?.content ? <div><h3>{t('docsHistoryBefore')}</h3><DocsRichBlock content={before.content}
                        diff={{ other: block.content, kind: 'removed' }} editable={false} t={t} resolveAsset={resolveAsset}
                        onChange={idle} onExit={idle} onFocus={idle} onUndo={idle} onRedo={idle} /></div> : null}
                      <div><h3>{t('docsHistoryAfter')}</h3><DocsRichBlock content={block.content}
                        diff={{ other: before?.content ?? '', kind: 'added' }} editable={false} t={t} resolveAsset={resolveAsset}
                        onChange={idle} onExit={idle} onFocus={idle} onUndo={idle} onRedo={idle} /></div>
                    </div>
                      : <DocsReadView text={block.content} labels={labels} t={t} resolveAsset={resolveAsset} />}
                  </section>
                })}
              </div>)}
              {showChanges ? previousTabs.filter(tab => !currentTabs.some(item => item.id === tab.id)).map(tab =>
                <h2 key={tab.id} className={css.historyDiff}><del>{tabTitle(tab)}</del></h2>) : null}
              {showChanges ? preview.previous?.blocks
                .filter(block => !current.blocks.some(item => item.id === block.id)).map(block =>
                  <section key={block.id} className={css.historyRichDiff}>
                    <h2>{block.label}</h2><h3>{t('docsHistoryBefore')}</h3>
                    <DocsRichBlock content={block.content} diff={{ other: '', kind: 'removed' }} editable={false} t={t}
                      resolveAsset={resolveAsset} onChange={idle} onExit={idle} onFocus={idle} onUndo={idle} onRedo={idle} />
                  </section>) : null}
            </article>
          </> : null}
        </section>
  </ReviewDialog>
}
