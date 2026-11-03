/** Restore the CopyOS workspace route within this browser tab. */
import { useLayoutEffect, useEffect, useRef } from 'react'
import {
  defineStore,
  type EngineStoreHandle,
} from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'

/** Workspace sections whose identity can be restored without reopening a dialog. */
export type ProjectSection =
  | 'designer'
  | 'overview'
  | 'settings'
  | 'skills'
  | 'style-guide'
  | 'brand'
  | 'briefs'
  | 'pages'
  | 'copy'
  | 'scripts'
  | 'experiments'
  | 'sessions'

/** Navigation preferences contain no document drafts or Session data. */
export interface CopyOSNavigationState {
  version: 1
  active: boolean
  projectId: string | null
  section: ProjectSection
}
type NavigationActions = {
  selectProject: (
    draft: CopyOSNavigationState,
    projectId: string | null,
  ) => void
  selectSection: (draft: CopyOSNavigationState, section: ProjectSection) => void
  reconcileProjects: (
    draft: CopyOSNavigationState,
    projectIds: readonly string[],
  ) => void
  setActive: (draft: CopyOSNavigationState, active: boolean) => void
}
const KEY = 'copyos.navigation.v1'
const sections = new Set<string>([
  'designer',
  'overview',
  'settings',
  'skills',
  'style-guide',
  'brand',
  'briefs',
  'pages',
  'copy',
  'scripts',
  'experiments',
  'sessions',
])

/** Validate tab-local preferences before they enter the UI store.
 * @param value - Parsed browser storage value.
 * @returns Valid navigation or null; unknown versions and malformed routes are ignored.
 */
export function parseCopyOSNavigation(
  value: unknown,
): CopyOSNavigationState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  if (
    !('version' in value) ||
    value.version !== 1 ||
    !('active' in value) ||
    typeof value.active !== 'boolean' ||
    !('projectId' in value) ||
    !(
      value.projectId === null ||
      (typeof value.projectId === 'string' &&
        value.projectId.length > 0 &&
        value.projectId.length <= 500)
    ) ||
    !('section' in value) ||
    typeof value.section !== 'string' ||
    !sections.has(value.section)
  )
    return null
  return {
    version: 1,
    active: value.active,
    projectId: value.projectId,
    section: value.section as ProjectSection,
  }
}
function readNavigation(): CopyOSNavigationState | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return raw && raw.length <= 2048
      ? parseCopyOSNavigation(JSON.parse(raw))
      : null
  } catch (_error) {
    // Disabled storage and malformed preferences leave navigation usable in memory.
    return null
  }
}

/** Persist preferences per tab; other tabs keep their own active workspace.
 * @param state - Valid state from the framework-owned navigation store.
 */
export function saveCopyOSNavigation(state: CopyOSNavigationState): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch (_error) {
    /* Storage availability does not control navigation. */
  }
}

/** Declare one root store shared by the panel and its restoration observer.
 * @returns Store handle whose initial preferences are validated before restoration.
 */
export function createCopyOSNavigationStore(): EngineStoreHandle<
  CopyOSNavigationState,
  NavigationActions
> {
  return defineStore({
    init: (): CopyOSNavigationState =>
      readNavigation() ?? {
        version: 1,
        active: false,
        projectId: null,
        section: 'overview',
      },
    actions: {
      selectProject: (draft, projectId: string | null) => {
        draft.projectId = projectId
        draft.section = 'overview'
      },
      selectSection: (draft, section: ProjectSection) => {
        draft.section = section
      },
      reconcileProjects: (draft, projectIds: readonly string[]) => {
        if (draft.projectId === null || !projectIds.includes(draft.projectId)) {
          draft.projectId = projectIds[0] ?? null
          draft.section = 'overview'
        }
      },
      setActive: (draft, active: boolean) => {
        draft.active = active
      },
    },
  })
}

/** Observe actual panel navigation and restore once before the first interactive paint.
 * @param props - Framework store/hook shares and the layout-owned panel transition.
 * @returns No visible UI.
 */
export function CopyOSNavigationObserver({
  useStore,
  actions,
  usePanelInfo,
  restorePanel,
  panelRegistered,
}: PropsRuntime<'shell.overlay'> &
  PropsStore<ReturnType<typeof createCopyOSNavigationStore>> & {
    restorePanel: () => void
    panelRegistered: () => boolean
  }): null {
  const state = useStore(value => value)
  const panel = usePanelInfo(value => value.activePanelId)
  const initial = useRef(true)
  useLayoutEffect(() => {
    if (initial.current) {
      initial.current = false
      if (state.active && panel === null) {
        restorePanel()
        return
      }
    }
    // Registry teardown can clear selection while this observer is still mounted.
    if (panelRegistered())
      actions.setActive(panel === ('copyos' as MainPanelId))
  }, [panel])
  useEffect(() => {
    saveCopyOSNavigation(state)
  }, [state])
  return null
}
