/** Landing-page builder presented inside the Harness session workspace. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { buildPageActionPrompt, LandingPageWorkspace, type PageWorkspaceActions, type SectionPromptIntent } from './LandingPageWorkspace.tsx'
import css from './CopyOSPanel.module.css'

type LandingPageTabProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'copyosFoundation'>
  & InjectFace<PageWorkspaceActions>

/** Render the current CopyOS project's durable page builder beside its native Harness chat. */
export function CopyOSLandingPageTab({
  sessionId,
  useSessions,
  useWorkspaces,
  inputActions,
  t,
  ...actions
}: LandingPageTabProps): ReactNode {
  const projectPath = useSessions(state => state.byId[sessionId]?.cwd)
  const workspaceId = useWorkspaces(state =>
    state.items.find(workspace => workspace.path === projectPath)?.workspaceId)

  if (workspaceId === undefined) {
    return <p className={css.landingPageUnavailable}>{t('pageWorkspaceUnavailable')}</p>
  }

  const promptSection = (intent: SectionPromptIntent, pageTitle: string, sectionTitle: string, note?: string): void => {
    inputActions.setDraft(buildPageActionPrompt(t, intent, pageTitle, sectionTitle, note))
    if (intent === 'export-shopify') inputActions.submit()
  }

  return (
    <div className={css.landingPageTab}>
      <LandingPageWorkspace
        workspaceId={workspaceId}
        {...(projectPath === undefined ? {} : { projectPath })}
        t={t}
        actions={actions}
        layout="session"
        onPromptSection={promptSection}
      />
    </div>
  )
}
