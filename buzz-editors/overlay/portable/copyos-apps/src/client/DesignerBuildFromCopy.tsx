/** Build from copy: ask what is being built, its goal, the copy and a reference, then hand the agent one complete brief. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { CopyOSCopyDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
import { useEditorChrome } from '../EditorChrome.tsx'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** What the person is building; each kind names a different set of comparable past work. */
export const DESIGNER_BUILD_KINDS = ['landing-page', 'long-form', 'static-ad', 'email', 'section', 'other'] as const
/** One of {@link DESIGNER_BUILD_KINDS}. */
export type DesignerBuildKind = typeof DESIGNER_BUILD_KINDS[number]

const KIND_LABELS: Record<DesignerBuildKind, CopyOSFoundationLocaleKey> = {
  'landing-page': 'designerBuildKindLanding',
  'long-form': 'designerBuildKindLongForm',
  'static-ad': 'designerBuildKindAd',
  email: 'designerBuildKindEmail',
  section: 'designerBuildKindSection',
  other: 'designerBuildKindOther',
}

/** Answers collected by the panel. */
export interface DesignerBuildRequest {
  kind: DesignerBuildKind
  goal: string
  copyAsset: { id: string; title: string } | null
  copyText: string
  reference: { id: string; name: string } | null
  referenceNote: string
}

/** Host tool names used by the unchanged structured brief; user-provided copy is never rewritten. */
export interface DesignerBuildTools {
  readCopy: string
  listTemplates: string
  listWorkspaces: string
  listDesigns: string
  insertTemplate: string
  edit: string
  view: string
}
const ORIGINAL_TOOLS: DesignerBuildTools = { readCopy: 'read_copyos_asset', listTemplates: 'list_copyos_design_templates', listWorkspaces: 'list_copyos_workspaces', listDesigns: 'list_copyos_designs', insertTemplate: 'insert_copyos_design_template', edit: 'edit_copyos_design', view: 'view_copyos_design' }

/**
 * The agent brief for a Build from copy request: target design, copy source, goal, reference, and the order of work, starting with
 * comparable templates and past projects.
 * @param request - Panel answers.
 * @param design - Open design the new artboard goes into.
 * @param tools - Host-owned tool names; omission retains the original host brief.
 * @returns Prompt text for the session chat.
 */
export function designerBuildPrompt(request: DesignerBuildRequest, design: { id: string; title: string }, tools: DesignerBuildTools = ORIGINAL_TOOLS): string {
  const kind = {
    'landing-page': 'a landing page', 'long-form': 'a long-form sales page or advertorial', 'static-ad': 'static ads',
    email: 'an email', section: 'a page section', other: 'a design',
  }[request.kind]
  const lines = [
    `Build ${kind} in the Canvas design "${design.title}" (design_id ${design.id}) as a new top-level artboard beside the existing ones.`,
    `Goal: ${request.goal.trim()}`,
  ]
  if (request.copyAsset) lines.push(`Copy: the copy library asset "${request.copyAsset.title}" (id ${request.copyAsset.id}); read it with ${tools.readCopy}.`)
  if (request.copyText.trim()) lines.push(`Copy (or where to find it): ${request.copyText.trim()}`)
  lines.push('Keep the copy word for word; text in [brackets] is a note to you, not page copy.')
  if (request.reference) lines.push(`Visual reference: the artboard "${request.reference.name}" (layer ${request.reference.id}) in this design.`)
  if (request.referenceNote.trim()) lines.push(`Reference notes: ${request.referenceNote.trim()}`)
  lines.push(
    `First look for comparable work and reuse what fits: ${tools.listTemplates} for saved templates of the same kind, and ` +
    `${tools.listWorkspaces} with ${tools.listDesigns} for designs from previous projects; inspect the closest few (design-system and ` +
    `structure) and say which you reuse and why. A matching template can be placed with ${tools.insertTemplate} and then edited.`,
    `Then plan the sections from the copy, build one section at a time with ${tools.edit} using shared color variables, text ` +
    `styles and components, look at the artboard with ${tools.view} after each section and fix what reads wrong.`,
    'Finish with a short report: what you built, what you reused from templates or past projects, copy you could not place, and open questions.',
  )
  return lines.join('\n')
}

/**
 * Panel collecting a Build from copy request.
 * @param props - Translator, selected reference, copy loader and submit action. Submission receives a signal aborted when the panel closes or unmounts; a late result cannot close a revised brief.
 * @returns The panel.
 */
export function DesignerBuildFromCopy({ t, reference, listCopy, onSubmit, onClose }: {
  t: Translate
  reference: { id: string; name: string } | null
  listCopy?: (() => Promise<readonly CopyOSCopyDocument[]>) | undefined
  onSubmit: (request: DesignerBuildRequest, signal: AbortSignal) => Promise<void>
  onClose: () => void
}): ReactNode {
  const { Button, TextField, Select, Checkbox } = useEditorChrome()
  const [kind, setKind] = useState<DesignerBuildKind>('landing-page')
  const [goal, setGoal] = useState('')
  const [copyId, setCopyId] = useState('')
  const [copyText, setCopyText] = useState('')
  const [useReference, setUseReference] = useState(reference !== null)
  const [referenceNote, setReferenceNote] = useState('')
  const [library, setLibrary] = useState<readonly CopyOSCopyDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const copyFile = useRef<HTMLInputElement>(null), copyFieldId = useId()
  const pending = useRef<AbortController | null>(null)
  const edits = useRef(0)
  const change = <T,>(set: (value: T) => void, value: T) => { edits.current += 1; set(value) }
  const close = () => { pending.current?.abort(); pending.current = null; onClose() }
  useEffect(() => () => { pending.current?.abort(); pending.current = null }, [])
  useEffect(() => {
    if (!listCopy) return
    let active = true
    listCopy().then((items) => { if (active) setLibrary(items) }, (failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { active = false }
  }, [listCopy])
  const asset = library.find(item => item.id === copyId)
  const ready = goal.trim() !== '' && (asset !== undefined || copyText.trim() !== '')
  return (
    <aside className={css.headerDrawer} aria-label={t('designerBuildFromCopy')}>
      <header>
        <div><h2>{t('designerBuildFromCopy')}</h2><small>{t('designerBuildIntro')}</small></div>
        <Button type="button" variant="ghost" size="xs" aria-label={t('designerDone')} onClick={close}>×</Button>
      </header>
      <form className={css.buildForm} onSubmit={(event) => {
        event.preventDefault()
        if (!ready || pending.current) return
        const controller = new AbortController(), revision = edits.current
        pending.current = controller
        setBusy(true)
        setError(null)
        void (async () => {
          try {
            await onSubmit({ kind, goal, copyAsset: asset ? { id: asset.id, title: asset.title } : null, copyText,
              reference: useReference ? reference : null, referenceNote }, controller.signal)
            if (!controller.signal.aborted && edits.current === revision) onClose()
          } catch (failure: unknown) {
            if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            if (pending.current === controller) { pending.current = null; setBusy(false) }
          }
        })()
      }}>
        <Select label={t('designerBuildKind')} value={kind} options={DESIGNER_BUILD_KINDS.map(value => ({ value, label: t(KIND_LABELS[value]) }))}
          onValueChange={value => { change(setKind, value as DesignerBuildKind) }} />
        <TextField label={t('designerBuildGoal')} rows={2} value={goal} placeholder={t('designerBuildGoalPlaceholder')}
          onValueChange={value => { change(setGoal, value) }} />
        {library.length ? <Select label={t('designerBuildCopyAsset')} value={copyId}
          options={[{ value: '', label: t('designerBuildCopyNone') }, ...library.map(item => ({ value: item.id, label: item.title }))]}
          onValueChange={value => { change(setCopyId, value) }} /> : null}
        <TextField label={t('designerBuildCopyText')} id={copyFieldId} rows={4} value={copyText} placeholder={t('designerBuildCopyPlaceholder')}
          onValueChange={value => { change(setCopyText, value) }}
          labelAction={<Button type="button" variant="outline" size="xs" onClick={() => copyFile.current?.click()}>{t('designerBuildCopyFile')}</Button>} />
          {/* A chosen file replaces the field with its text, so the brief carries the copy itself. */}
          <input ref={copyFile} hidden type="file" accept=".md,.markdown,.txt,.html,.htm,text/*" aria-label={t('designerBuildCopyFile')}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              file.text().then(value => { change(setCopyText, value) }, (failure: unknown) => {
                setError(failure instanceof Error ? failure.message : String(failure))
              })
            }} />
        {reference ? <Checkbox label={t('designerBuildUseReference').replace('{name}', reference.name)} checked={useReference}
          onCheckedChange={value => { change(setUseReference, value) }} /> : null}
        <TextField label={t('designerBuildReferenceNote')} value={referenceNote} placeholder={t('designerBuildReferencePlaceholder')}
          onValueChange={value => { change(setReferenceNote, value) }} />
        <p className={css.headerDrawerNote}>{t('designerBuildCrossReference')}</p>
        {error ? <p role="alert">{error}</p> : null}
        <Button type="submit" variant="prominent" size="sm" disabled={!ready || busy}>{t('designerBuildStart')}</Button>
      </form>
    </aside>
  )
}
