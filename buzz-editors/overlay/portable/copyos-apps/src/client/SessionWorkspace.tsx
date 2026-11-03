/** Project-scoped Harness Session browser with durable CopyOS artifact relationships. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  CopyOSLinkedArtifactKind,
  CopyOSSessionLinkDocument,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './CopyOSPanel.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Live Session catalog and durable relationship operations owned by the host panel. */
export interface SessionWorkspaceActions {
  readonly subscribeSessions: (listener: () => void) => () => void
  readonly getSessions: () => SessionListState
  readonly listSessionLinks: (workspaceId: string) => Promise<readonly CopyOSSessionLinkDocument[]>
  readonly openSession: (sessionId: string) => void
}

interface Props {
  readonly workspaceId: string
  readonly projectPath: string
  readonly t: Translate
  readonly actions: SessionWorkspaceActions
  readonly openArtifact: (kind: CopyOSLinkedArtifactKind) => void
}

const PRESET_LABELS: Readonly<Record<string, CopyOSFoundationLocaleKey>> = {
  'copyos-copywriter': 'workflowCopywriter',
  'copyos-landing-page-builder': 'workflowLandingPage',
  'copyos-canvas': 'workflowCanvas',
  'copyos-docs': 'docsTitle',
  'copyos-website-clone': 'workflowWebsiteClone',
  'copyos-existing-page': 'workflowExistingPage',
  'copyos-strategy': 'workflowStrategyBuilder',
  'copyos-cro-analyst': 'workflowCro',
  'copyos-ad-scriptwriter': 'workflowAdScript',
  'copyos-creative-strategist': 'workflowStrategist',
  'copyos-researcher': 'workflowResearcher',
}

const copyArtifactLocaleKey: CopyOSFoundationLocaleKey = 'relatedCopy'

const ARTIFACT_LOCALE_KEYS: Readonly<Record<CopyOSLinkedArtifactKind, CopyOSFoundationLocaleKey>> = {
  brand: 'relatedBrand',
  research: 'relatedResearch',
  brief: 'relatedBrief',
  copy: copyArtifactLocaleKey,
  page: 'relatedPage',
  script: 'relatedScript',
  experiment: 'relatedExperiment',
}

/** Render the selected project's live Harness Sessions and their linked CopyOS output. */
export function SessionWorkspace({ workspaceId, projectPath, t, actions, openArtifact }: Props): ReactNode {
  const catalog = useSyncExternalStore(actions.subscribeSessions, actions.getSessions, actions.getSessions)
  const [links, setLinks] = useState<readonly CopyOSSessionLinkDocument[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const loadLinks = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      setLinks(await actions.listSessionLinks(workspaceId))
      setPhase('ready')
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setPhase('error')
    }
  }, [actions, workspaceId])

  useEffect(() => { void loadLinks() }, [loadLinks])

  const projectSessions = useMemo(() => catalog.ids
    .map(id => catalog.byId[id])
    .filter((session): session is SessionSummary =>
      session !== undefined && session.cwd === projectPath && session.origin !== 'subagent')
    .sort((left, right) => right.updatedAt - left.updatedAt), [catalog, projectPath])
  const linksBySession = useMemo(
    () => new Map(links.map(document => [document.sessionId, document])),
    [links],
  )

  return (
    <section className={css.assetWorkspace} aria-labelledby="copyos-sessions-title">
      <div className={css.assetWorkspaceHeader}>
        <div>
          <h3 id="copyos-sessions-title">{t('sessionsWorkspaceTitle')}</h3>
          <p>{t('sessionsWorkspaceDescription')}</p>
        </div>
        <Button variant="outline" onClick={() => { void loadLinks() }}>{t('refreshSessions')}</Button>
      </div>
      {error === '' ? null : <p className={css.assetError} role="alert">{t('sessionsLoadFailed')} {error}</p>}
      {catalog.phase === 'pending' || phase === 'loading'
        ? <p className={css.assetState} role="status">{t('sessionsLoading')}</p>
        : null}
      {phase === 'error' ? <Button variant="outline" onClick={() => { void loadLinks() }}>{t('retry')}</Button> : null}
      {catalog.phase === 'ready' && phase === 'ready' && projectSessions.length === 0
        ? <p className={css.assetState}>{t('sessionsEmpty')}</p>
        : null}
      {projectSessions.length === 0 ? null : (
        <div className={css.sessionList}>
          {projectSessions.map((session) => {
            const related = linksBySession.get(session.id)?.artifacts ?? []
            const preset = session.projectionValues?.agentPreset
            const workflowKey = typeof preset === 'string' ? PRESET_LABELS[preset] : undefined
            return (
              <article key={session.id} className={css.sessionCard}>
                <div className={css.sessionCardHeader}>
                  <div>
                    <div className={css.sessionMeta}>
                      <span data-running={session.running}>{session.running ? t('runningStatus') : t('sessionReady')}</span>
                      <span>{workflowKey === undefined ? t('sessionGeneralWorkflow') : t(workflowKey)}</span>
                    </div>
                    <h4>{session.displayTitle}</h4>
                    <p>{t('sessionUpdated')} {new Date(session.updatedAt).toLocaleString()}</p>
                  </div>
                  <Button variant="primary" onClick={() => { actions.openSession(session.id) }}>{t('openSession')}</Button>
                </div>
                <div className={css.sessionArtifacts}>
                  <strong>{t('sessionOutput')}</strong>
                  {related.length === 0 ? <span>{t('sessionOutputEmpty')}</span> : (
                    <div>
                      {related.map(artifact => (
                        <button key={`${artifact.kind}:${artifact.id}`} type="button"
                          onClick={() => { openArtifact(artifact.kind) }}>
                          <span>{t(ARTIFACT_LOCALE_KEYS[artifact.kind])}</span>
                          {artifact.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
