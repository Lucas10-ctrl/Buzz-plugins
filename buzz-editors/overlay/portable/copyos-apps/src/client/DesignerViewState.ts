/** Tab-local canvas navigation; native design content and drafts are never copied here. */

/** One file/page viewport in canvas coordinates. */
export interface DesignerPageView {
  fileId: string
  pageId: string
  x: number
  y: number
  zoom: number
}
/** Last selected design and bounded page viewports for one workspace. */
export interface DesignerViewState {
  version: 1
  fileId: string
  pageId: string
  selection: string[]
  views: DesignerPageView[]
  panelWidths: { left: number; right: number }
  pixelSnap: boolean
  leftTab: 'layers' | 'assets'
  /** Optional inspector preference; older records open Design. */
  inspectorTab?: 'design' | 'code' | undefined
}
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 500
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate bounded canvas preferences from browser storage.
 * @param value - Parsed tab-local JSON.
 * @returns A normalized preference or null when its version or values are invalid.
 */
export function parseDesignerViewState(
  value: unknown,
): DesignerViewState | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !id(value.fileId) ||
    !value.fileId ||
    !id(value.pageId) ||
    !Array.isArray(value.selection) ||
    value.selection.length > 1000 ||
    !value.selection.every(id) ||
    !Array.isArray(value.views) ||
    value.views.length > 128 ||
    !record(value.panelWidths) ||
    !finite(value.panelWidths.left, 200, 400) ||
    !finite(value.panelWidths.right, 200, 400) ||
    typeof value.pixelSnap !== 'boolean' ||
    !(value.leftTab === 'layers' || value.leftTab === 'assets') ||
    !(value.inspectorTab === undefined || value.inspectorTab === 'design' || value.inspectorTab === 'code')
  )
    return null
  const views: DesignerPageView[] = []
  for (const view of value.views) {
    if (
      !record(view) ||
      !id(view.fileId) ||
      !view.fileId ||
      !id(view.pageId) ||
      !finite(view.x, -1e9, 1e9) ||
      !finite(view.y, -1e9, 1e9) ||
      !finite(view.zoom, 0.05, 4)
    )
      return null
    views.push({
      fileId: view.fileId,
      pageId: view.pageId,
      x: view.x,
      y: view.y,
      zoom: view.zoom,
    })
  }
  return {
    version: 1,
    fileId: value.fileId,
    pageId: value.pageId,
    selection: [...value.selection],
    views,
    panelWidths: {
      left: value.panelWidths.left,
      right: value.panelWidths.right,
    },
    pixelSnap: value.pixelSnap,
    leftTab: value.leftTab,
    ...(value.inspectorTab === undefined ? {} : { inspectorTab: value.inspectorTab }),
  }
}

/** Identify a page without conflating legacy empty-page IDs across design files.
 * @param fileId - Native document identity.
 * @param pageId - Native page identity, or empty for a legacy document.
 * @returns Collision-free in-memory viewport key.
 */
export function designerPageViewKey(fileId: string, pageId: string): string {
  return JSON.stringify([fileId, pageId])
}

/** Read this tab's last canvas for a workspace; denied storage leaves defaults usable.
 * @param workspaceId - Workspace identity, scoped to this app origin and tab.
 * @returns Valid navigation preferences, or null.
 */
export function readDesignerViewState(
  workspaceId: string,
): DesignerViewState | null {
  try {
    const raw = window.sessionStorage.getItem(
      `copyos.designer-view.v1:${workspaceId}`,
    )
    return raw && raw.length <= 262144
      ? parseDesignerViewState(JSON.parse(raw))
      : null
  } catch (_error) {
    return null /* Corrupt/disabled storage does not prevent canvas use. */
  }
}

/** Save only navigation metadata, retaining at most the last128 file/page views.
 * @param workspaceId - Workspace owning these preferences.
 * @param state - Current canvas navigation and controls.
 */
export function saveDesignerViewState(
  workspaceId: string,
  state: Omit<DesignerViewState, 'version' | 'views'> & {
    view: DesignerPageView
  },
): void {
  const previous = readDesignerViewState(workspaceId)
  const views = [
    ...(previous?.views ?? []).filter(
      v => v.fileId !== state.view.fileId || v.pageId !== state.view.pageId,
    ),
    state.view,
  ].slice(-128)
  const value: DesignerViewState = {
    version: 1,
    fileId: state.fileId,
    pageId: state.pageId,
    selection: state.selection.slice(0, 1000),
    views,
    panelWidths: state.panelWidths,
    pixelSnap: state.pixelSnap,
    leftTab: state.leftTab,
    ...(state.inspectorTab === undefined ? {} : { inspectorTab: state.inspectorTab }),
  }
  // Unbounded canvas panning must not create an unreadable preference record.
  if (!parseDesignerViewState(value)) return
  try {
    window.sessionStorage.setItem(
      `copyos.designer-view.v1:${workspaceId}`,
      JSON.stringify(value),
    )
  } catch (_error) {
    /* Navigation remains in memory when storage is unavailable. */
  }
}
