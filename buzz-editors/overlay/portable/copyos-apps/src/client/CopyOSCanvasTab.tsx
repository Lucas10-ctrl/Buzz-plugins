/** Canvas presented beside a Harness session chat, like Builder, and as a full-window panel that holds that chat. */

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PageWorkspaceActions } from './LandingPageWorkspace.tsx'
import type { CopyOSCopyDocument } from '../../../copyos-domain/src/types.ts'
import { PageDesignerWorkspace, type PageDesignerActions } from './PageDesignerWorkspace.tsx'
import css from './CopyOSPanel.module.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The full-window Canvas panel, which shows its session's chat in place of the chat column. */
    copyosCanvasFullWindow: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-scoped content of the full-window Canvas panel: the Canvas and its embedded session chat. */
    'copyos.canvas.fullWindow': { kind: 'single'; scope: 'session' }
  }
}

/** Session identity as the session-scoped slot runtime supplies it. */
type SessionId = PropsRuntime<'sidebar.right.pane.tab'>['sessionId']

/** Which session the full-window Canvas panel shows: `requested` by the Canvas tab, `shown` while its Canvas is mounted. */
export interface CanvasFullWindowState {
  readonly requested: SessionId | null
  readonly shown: SessionId | null
}

/** Shared by the Canvas tab and the full-window panel, so one session's Canvas is mounted in only one of them. */
export interface CanvasFullWindowController {
  readonly state: HostObservable<CanvasFullWindowState>
  /** @param sessionId - Session whose Canvas and chat the panel shows next. */
  request: (sessionId: SessionId) => void
  /**
   * Mark the panel's Canvas as mounted for one session.
   * @param sessionId - Session the panel's Canvas edits.
   * @returns Release, called when that Canvas unmounts.
   */
  show: (sessionId: SessionId) => () => void
}

/**
 * Create the full-window state shared by the Canvas tab and the full-window panel.
 * @returns The observable state and its two writers.
 */
export function createCanvasFullWindow(): CanvasFullWindowController {
  let state: CanvasFullWindowState = { requested: null, shown: null }
  const listeners = new Set<() => void>()
  const set = (next: CanvasFullWindowState): void => {
    if (next.requested === state.requested && next.shown === state.shown) return
    state = next
    for (const listener of [...listeners]) listener()
  }
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    request: (sessionId) => { set({ ...state, requested: sessionId }) },
    show: (sessionId) => {
      set({ ...state, shown: sessionId })
      return () => { if (state.shown === sessionId) set({ ...state, shown: null }) }
    },
  }
}

/** Actions the Canvas tab needs: the Canvas's own design operations plus page reads for linked page screens. */
export interface CopyOSCanvasTabActions {
  readonly designer: PageDesignerActions
  readonly pages: PageWorkspaceActions
  /** Application palette, so the Canvas follows light and dark themes, and the full-window state. */
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot>; readonly canvasFullWindow: HostObservable<CanvasFullWindowState> }
  /** @param sessionId - Session whose Canvas replaces its chat column, with the chat in the Canvas's left rail. */
  readonly openFullWindow: (sessionId: SessionId) => void
  /**
   * Attach images to a session's chat draft.
   * @param sessionId - Session whose draft receives the images.
   * @param files - Images.
   * @returns `attached`, `busy` while the draft is being submitted, or `unsupported`.
   */
  readonly attachImages: (sessionId: SessionId, files: readonly File[]) => 'attached' | 'busy' | 'unsupported'
  /** @param workspaceId - Project whose copy library Build from copy offers. @returns Copy library entries. */
  readonly listCopy: (workspaceId: string) => Promise<readonly CopyOSCopyDocument[]>
}

type SessionRuntime = Pick<PropsRuntime<'sidebar.right.pane.tab'>, 'sessionId' | 'useSessions' | 'useWorkspaces' | 'inputActions'>
type SessionCanvasProps = SessionRuntime & PropsLocale<'copyosFoundation'> & Pick<CopyOSCanvasTabActions, 'designer' | 'pages' | 'attachImages' | 'listCopy'> & {
  readonly colorScheme: 'light' | 'dark'
  readonly chat?: ReactNode
  readonly onOpenFullWindow?: () => void
  readonly onExitFullWindow?: () => void
  readonly onBackToHarness?: () => void
}

/** Render one session's workspace Canvas; agent prompts go to that session's chat input. */
function SessionCanvas({
  sessionId, useSessions, useWorkspaces, inputActions, t, designer, pages, colorScheme, chat,
  onOpenFullWindow, onExitFullWindow, onBackToHarness,
  attachImages, listCopy,
}: SessionCanvasProps): ReactNode {
  const projectPath = useSessions(state => state.byId[sessionId]?.cwd)
  const workspaceId = useWorkspaces(state =>
    state.items.find(workspace => workspace.path === projectPath)?.workspaceId)
  if (workspaceId === undefined)
    return <p className={css.landingPageUnavailable}>{t('canvasWorkspaceUnavailable')}</p>
  return (
    <div className={css.landingPageTab}>
      <PageDesignerWorkspace
        key={workspaceId}
        workspaceId={workspaceId}
        {...(projectPath === undefined ? {} : { projectPath })}
        t={t}
        colorScheme={colorScheme}
        actions={designer}
        pageActions={pages}
        layout="session"
        chat={chat}
        onOpenFullWindow={onOpenFullWindow}
        onExitFullWindow={onExitFullWindow}
        onBackToHarness={onBackToHarness}
        onMentionSelection={text => inputActions.insertText(text, inputActions.captureInsertion())}
        onAttachPicture={(file) => {
          const status = attachImages(sessionId, [file])
          return status === 'attached' ? null : t(status === 'busy' ? 'designerChatDraftLocked' : 'designerPictureUnsupported')
        }}
        listCopy={() => listCopy(workspaceId)}
        onStartAgent={(prompt) => {
          inputActions.setDraft(prompt)
          inputActions.submit()
          return Promise.resolve()
        }}
      />
    </div>
  )
}

type CanvasTabProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'copyosFoundation'>
  & InjectFace<CopyOSCanvasTabActions>

/** Render the session's CopyOS workspace Canvas beside its chat; the chat input receives Canvas agent prompts.
 * @param props - Session, workspace and chat input runtime, translator and Canvas actions.
 * @returns The Canvas, nothing while the full-window panel shows this session's Canvas, or a notice outside a CopyOS workspace.
 */
export function CopyOSCanvasTab({
  sessionId, useSessions, useWorkspaces, inputActions, t, designer, pages, useTheme, useCanvasFullWindow, openFullWindow, useTabInfo,
  attachImages, listCopy,
}: CanvasTabProps): ReactNode {
  const { tab } = useTabInfo()
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const fullWindow = useCanvasFullWindow(state => state.shown === sessionId)
  if (fullWindow) return null
  return <SessionCanvas sessionId={sessionId} useSessions={useSessions} useWorkspaces={useWorkspaces} inputActions={inputActions}
    t={t} designer={designer} pages={pages} colorScheme={colorScheme} onOpenFullWindow={() => { openFullWindow(sessionId) }}
    onBackToHarness={() => { tab.actions.close() }} attachImages={attachImages} listCopy={listCopy} />
}

/** Root-scope services of the full-window panel. */
export interface CopyOSCanvasFullWindowInjected {
  readonly hooks: { readonly canvasFullWindow: HostObservable<CanvasFullWindowState> }
  /**
   * Retain the requested session for the panel's lifetime.
   * @param sessionId - Session to retain.
   * @returns The owned reference; the panel releases it on unmount or session change.
   */
  readonly retain: (sessionId: SessionId) => SessionReference
  /** Select the chat column again. */
  readonly exitFullWindow: () => void
}

type FullWindowPanelProps = PropsRuntime<'main'> & PropsRenderSlots<'copyos.canvas.fullWindow'> & InjectFace<CopyOSCanvasFullWindowInjected>

/** Main panel that replaces the chat column with the requested session's Canvas; without a request it returns to the chat.
 * @param props - Session binding, child renderer and the full-window services.
 * @returns The session-bound panel content once the session is retained.
 */
export function CopyOSCanvasFullWindowPanel({
  useCanvasFullWindow, retain, exitFullWindow, SessionProvider, renderSlot,
}: FullWindowPanelProps): ReactNode {
  const sessionId = useCanvasFullWindow(state => state.requested)
  const [reference, setReference] = useState<SessionReference | null>(null)
  useEffect(() => {
    if (sessionId === null) { exitFullWindow(); return }
    const next = retain(sessionId)
    setReference(next)
    return () => { setReference(null); next.release() }
  }, [sessionId, retain, exitFullWindow])
  if (reference === null || reference.sessionId !== sessionId) return null
  return <div className={css.canvasFullWindow}>
    <SessionProvider session={reference}>{renderSlot('copyos.canvas.fullWindow', {})}</SessionProvider>
  </div>
}

/** Fixed Chat view for the conversation embedded in the Canvas. */
function CanvasChatView(props: ConversationViewsProps): ReactNode {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Services of the full-window panel's session content. */
export interface CopyOSCanvasFullWindowSessionInjected extends Pick<CopyOSCanvasTabActions, 'designer' | 'pages' | 'attachImages' | 'listCopy'> {
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot> }
  readonly show: CanvasFullWindowController['show']
  readonly exitFullWindow: () => void
}

type FullWindowSessionProps = PropsRuntime<'copyos.canvas.fullWindow'> & PropsLocale<'copyosFoundation'> & PropsRenderFactories
  & InjectFace<CopyOSCanvasFullWindowSessionInjected>

/** Render the Canvas with the session's chat in its left rail, after the Canvas tab has released this session's Canvas.
 * @param props - Session runtime, conversation renderer, translator and Canvas services.
 * @returns The Canvas, once it is the only mounted Canvas for the session.
 */
export function CopyOSCanvasFullWindowSession({
  sessionId, useSessions, useWorkspaces, inputActions, useSession, useConversation, renderFactorySlot, t, designer, pages, useTheme,
  show, exitFullWindow, attachImages, listCopy,
}: FullWindowSessionProps): ReactNode {
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [ready, setReady] = useState(false)
  // The tab unmounts its Canvas in this commit's layout phase, before the panel's Canvas mounts on the next render.
  useLayoutEffect(() => {
    const release = show(sessionId)
    setReady(true)
    return () => { setReady(false); release() }
  }, [show, sessionId])
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const chat = renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero },
    { slots: { views: CanvasChatView } })
  if (!ready) return null
  return <SessionCanvas sessionId={sessionId} useSessions={useSessions} useWorkspaces={useWorkspaces} inputActions={inputActions}
    t={t} designer={designer} pages={pages} colorScheme={colorScheme} chat={chat} onExitFullWindow={exitFullWindow}
    attachImages={attachImages} listCopy={listCopy} />
}
