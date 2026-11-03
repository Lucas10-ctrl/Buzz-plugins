/** Canvas Assets section: Higgsfield text-to-image runs on the server; finished results are placed as editable image layers. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CopyOSGenerationAspectRatio,
  CopyOSGenerationCancelRequest,
  CopyOSGenerationImageRequest,
  CopyOSGenerationImageValue,
  CopyOSGenerationRecord,
  CopyOSGenerationResolution,
  CopyOSGenerationSettings,
  CopyOSGenerationStartRequest,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerGeneration.module.css'
import { useEditorChrome } from '../EditorChrome.tsx'

/** Whether the credentials service holds the provider key, as reported without the value. */
export interface DesignerGenerationCredentialStatus { configured: boolean; writable: boolean }
/** Server operations behind the Generate image section. */
export interface DesignerGenerationActions {
  readonly settings: () => Promise<CopyOSGenerationSettings>
  readonly credentialStatus: (ref: string) => Promise<DesignerGenerationCredentialStatus>
  /** Store the key through the credentials service; the browser never reads it back. */
  readonly setCredential: (ref: string, value: string) => Promise<void>
  readonly start: (request: CopyOSGenerationStartRequest) => Promise<CopyOSGenerationRecord>
  readonly list: (workspaceId: string) => Promise<readonly CopyOSGenerationRecord[]>
  readonly cancel: (request: CopyOSGenerationCancelRequest) => Promise<CopyOSGenerationRecord>
  readonly readImage: (request: CopyOSGenerationImageRequest) => Promise<CopyOSGenerationImageValue>
}
interface Props {
  workspaceId: string
  actions: DesignerGenerationActions
  t: (key: CopyOSFoundationLocaleKey) => string
  /** Add one image layer through the document history, so Undo removes it. */
  place: (image: { dataUrl: string; name: string }) => void
}

const aspectRatios: CopyOSGenerationAspectRatio[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
const resolutions: CopyOSGenerationResolution[] = ['720p', '1080p']
const shown = 8
const pollMs = 2000
const statusKeys = {
  submitting: 'designerGenerateStatusSubmitting',
  queued: 'designerGenerateStatusQueued',
  in_progress: 'designerGenerateStatusRunning',
  completed: 'designerGenerateStatusCompleted',
  failed: 'designerGenerateStatusFailed',
  nsfw: 'designerGenerateStatusBlocked',
  canceled: 'designerGenerateStatusCanceled',
} as const satisfies Record<CopyOSGenerationRecord['status'], CopyOSFoundationLocaleKey>
const running = (record: CopyOSGenerationRecord): boolean =>
  record.status === 'submitting' || record.status === 'queued' || record.status === 'in_progress'

/**
 * Generate images, follow server-side progress, cancel, and place finished results.
 * @param props - Project, server actions, translator and layer placement callback.
 * @returns The section; it keeps listing while any generation is unfinished.
 */
export function DesignerGeneration({ workspaceId, actions, t, place }: Props) {
  const { Button, TextField, Select } = useEditorChrome()
  const [settings, setSettings] = useState<CopyOSGenerationSettings | null>(null)
  const [credential, setCredential] = useState<DesignerGenerationCredentialStatus | null>(null)
  const [key, setKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<CopyOSGenerationAspectRatio>('1:1')
  const [resolution, setResolution] = useState<CopyOSGenerationResolution>('720p')
  const [records, setRecords] = useState<readonly CopyOSGenerationRecord[]>([])
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requested = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    setRecords(await actions.list(workspaceId))
  }, [actions, workspaceId])

  useEffect(() => {
    const unmounted = new AbortController()
    void (async () => {
      try {
        const loaded = await actions.settings()
        const status = await actions.credentialStatus(loaded.credentialRef)
        if (unmounted.signal.aborted) return
        setSettings(loaded); setCredential(status)
        await refresh()
      } catch (cause) { if (!unmounted.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    })()
    return () => { unmounted.abort() }
  }, [actions, refresh])

  const unfinished = records.some(running)
  useEffect(() => {
    if (!unfinished) return
    const timer = setInterval(() => {
      refresh().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
    }, pollMs)
    return () => { clearInterval(timer) }
  }, [unfinished, refresh])

  useEffect(() => {
    for (const record of records.slice(0, shown)) {
      if (record.status !== 'completed' || !record.images.length || requested.current.has(record.id)) continue
      requested.current.add(record.id)
      actions.readImage({ workspaceId, id: record.id, index: 0 }).then((image) => {
        setPreviews(current => ({ ...current, [record.id]: image.dataUrl }))
      }, (cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
    }
  }, [records, actions, workspaceId])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  if (!settings || !credential) return error ? <p className={css.error} role="alert">{error}</p> : null
  return (
    <section className={css.generation} aria-labelledby="designer-generation-title">
      <h3 id="designer-generation-title">{t('designerGenerateTitle')}</h3>
      {!credential.configured ? (
        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault()
            const value = key.trim()
            if (!value) return
            void run(async () => {
              await actions.setCredential(settings.credentialRef, value)
              setKey('')
              setCredential(await actions.credentialStatus(settings.credentialRef))
            })
          }}
        >
          <p>{t('designerGenerateKeyHint')}</p>
          <TextField type="password" label={t('designerGenerateKey')} value={key} disabled={!credential.writable || busy}
            maxLength={4096} onValueChange={setKey} />
          <Button type="submit" size="sm" variant="prominent" disabled={!credential.writable || busy || !/^[^:\s]+:[^:\s]+$/.test(key.trim())}>
            {t('designerGenerateSaveKey')}
          </Button>
        </form>
      ) : (
        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const record = await actions.start({ workspaceId, prompt, aspectRatio, resolution })
              setRecords(current => [record, ...current.filter(value => value.id !== record.id)])
              if (record.status !== 'failed') setPrompt('')
            })
          }}
        >
          <TextField label={t('designerGeneratePrompt')} value={prompt} rows={3} maxLength={4000} disabled={busy} onValueChange={setPrompt} />
          <div className={css.row}>
            <Select label={t('designerGenerateAspect')} value={aspectRatio} disabled={busy}
              onValueChange={value => setAspectRatio(aspectRatios.find(item => item === value) ?? '1:1')}
              options={aspectRatios.map(value => ({ value, label: value }))} />
            <Select label={t('designerGenerateResolution')} value={resolution} disabled={busy}
              onValueChange={value => setResolution(resolutions.find(item => item === value) ?? '720p')}
              options={resolutions.map(value => ({ value, label: value }))} />
          </div>
          <p className={css.note}>{t('designerGenerateBilled')}</p>
          <Button type="submit" size="sm" variant="prominent" disabled={busy || !prompt.trim()}>{t('designerGenerateSubmit')}</Button>
        </form>
      )}
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {records.length ? (
        <ul className={css.list} aria-label={t('designerGenerateHistory')}>
          {records.slice(0, shown).map(record => (
            <li key={record.id}>
              {previews[record.id] ? <img src={previews[record.id]} alt="" /> : <span className={css.placeholder} aria-hidden="true" />}
              <div>
                <p title={record.prompt}>{record.prompt}</p>
                <p className={css.status} role="status">
                  {t(statusKeys[record.status])}
                  {record.cancelRequested && running(record) ? ` · ${t('designerGenerateCancelRequested')}` : ''}
                </p>
                {record.error && !running(record) && record.status !== 'canceled' ? <p className={css.detail}>{record.error}</p> : null}
                {record.status === 'completed' && record.images.length ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                    void run(async () => {
                      const image = await actions.readImage({ workspaceId, id: record.id, index: 0 })
                      place({ dataUrl: image.dataUrl, name: record.prompt.slice(0, 60) })
                    })
                  }}>{t('designerGeneratePlace')}</Button>
                ) : null}
                {record.requestId && (record.status === 'queued' || record.status === 'in_progress') && !record.cancelRequested ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                    void run(async () => {
                      const updated = await actions.cancel({ workspaceId, id: record.id })
                      setRecords(current => current.map(value => value.id === updated.id ? updated : value))
                    })
                  }}>{t('designerGenerateCancel')}</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
