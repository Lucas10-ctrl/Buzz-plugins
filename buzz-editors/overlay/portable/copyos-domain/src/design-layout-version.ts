/** Explicit local layout-version updates review stored geometry without materializing resolved resources or instance ownership. */
import { createDesignRenderScene } from './design-model.ts'
import { DesignAutoLayoutEditError } from './design-auto-layout.ts'
import { CopyOSDesignError, parseDesignDocument } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'
/** Supported native layout versions; omitted authored metadata means legacy. */
export type DesignLayoutVersionModel = 'css' | 'legacy'
/** Explicit stored selections or all eligible containers on one exact effective page. */
export type DesignLayoutVersionScope =
  | { type: 'selection'; nodeIds: readonly string[] }
  | { type: 'page'; pageId: string | null }
/** Version counts and atomic admission for a selection or page; instances never own a local layout version. */
export interface DesignLayoutVersionContext {
  ids: string[]
  canApply: boolean
  reason?: 'target' | 'locked' | 'layout' | 'page' | undefined
  cssCount: number
  legacyCount: number
  pausedCount: number
}
/** Rendered parent-local geometry of one stored node, excluding virtual instance descendants. */
export interface DesignLayoutVersionGeometry {
  x: number
  y: number
  width: number
  height: number
}
/** Before/after geometry for one stored node whose rendered allocation changes in the current mode. */
export interface DesignLayoutVersionGeometryChange {
  id: string
  before: DesignLayoutVersionGeometry
  after: DesignLayoutVersionGeometry
}
/** Immutable candidate and current-mode stored-node geometry review; the full candidate canvas also renders virtual descendants. */
export interface DesignLayoutVersionPreview {
  document: CopyOSDesignDocument
  changedIds: string[]
  geometryChanges: DesignLayoutVersionGeometryChange[]
  targetCount: number
  changedCount: number
  geometryChangedCount: number
}
const eligible = (node: CopyOSDesignNode) => ['frame', 'group', 'component', 'component-set'].includes(node.kind) &&
  ['row', 'column', 'grid'].includes(node.layout)
/** Read layout-version eligibility without rewriting omitted legacy metadata or expanding linked sources into local targets.
 * @param document - Valid immutable native scene.
 * @param scope - Explicit stored container identities or an exact effective page (null is the unnamed page).
 * @returns Eligible target identities, version/pause counts and an atomic admission reason; empty pages cannot apply.
 */
export function designLayoutVersionContext(document: CopyOSDesignDocument, scope: DesignLayoutVersionScope): DesignLayoutVersionContext {
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  let reason: DesignLayoutVersionContext['reason'], nodes: CopyOSDesignNode[] = []
  if (scope.type === 'selection') {
    if (!scope.nodeIds.length || new Set(scope.nodeIds).size !== scope.nodeIds.length || scope.nodeIds.some(id => !byId.has(id))) reason = 'target'
    for (const id of new Set(scope.nodeIds)) {
      const node = byId.get(id)
      if (!node) continue
      if (!eligible(node)) reason ??= 'layout'
      else nodes.push(node)
    }
  } else {
    if (scope.pageId !== null && !document.pages?.some(page => page.id === scope.pageId)) reason = 'page'
    nodes = document.nodes.filter(node => eligible(node) && (node.pageId ?? document.pages?.[0]?.id ?? null) === scope.pageId)
  }
  for (const node of nodes) {
    let ancestor: CopyOSDesignNode | undefined = node
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor.id)) {
      if (ancestor.locked) reason ??= 'locked'
      visited.add(ancestor.id); ancestor = byId.get(ancestor.parentId ?? '')
    }
  }
  if (!nodes.length) reason ??= 'layout'
  const cssCount = nodes.filter(node => node.layoutSizingModel === 'css').length
  return { ids: nodes.map(node => node.id), canApply: !reason, reason, cssCount,
    legacyCount: nodes.length - cssCount, pausedCount: nodes.filter(node => node.preserveLayout).length }
}
function stage(document: CopyOSDesignDocument, scope: DesignLayoutVersionScope, model: DesignLayoutVersionModel) {
  const context = designLayoutVersionContext(document, scope)
  if (!context.canApply) throw new DesignAutoLayoutEditError(context.reason ?? 'layout', 'Layout version scope is not editable')
  const selected = new Set(context.ids), changedIds: string[] = []
  const nodes = document.nodes.map((node) => {
    if (!selected.has(node.id)) return node
    if ((node.layoutSizingModel ?? 'legacy') === model) {
      if (!node.preserveLayout) return node
      changedIds.push(node.id)
      return { ...node, preserveLayout: false }
    }
    changedIds.push(node.id)
    return { ...node, layoutSizingModel: model, preserveLayout: false }
  })
  if (!changedIds.length) return { document, changedIds, context }
  const candidate = { ...document, nodes }
  try { parseDesignDocument(candidate) } catch (error) {
    if (error instanceof CopyOSDesignError) throw new DesignAutoLayoutEditError('layout', error.message)
    throw error
  }
  return { document: candidate, changedIds, context }
}
const geometry = (node: CopyOSDesignNode): DesignLayoutVersionGeometry => ({ x: node.x, y: node.y, width: node.width, height: node.height })
/** Preview a version update without mutating or saving the scene; geometry changes describe stored nodes only in the current mode.
 * @param document - Valid immutable authored scene.
 * @param scope - Selection or exact page scope admitted atomically.
 * @param model - Requested CSS-compatible or legacy layout model.
 * @returns Candidate, changed target identities and stored-node geometry differences/counts; active matching versions preserve identity.
 * @throws DesignAutoLayoutEditError for invalid scopes, inherited locks or invalid complete candidates.
 */
export function previewDesignLayoutVersion(
  document: CopyOSDesignDocument, scope: DesignLayoutVersionScope, model: DesignLayoutVersionModel,
): DesignLayoutVersionPreview {
  const staged = stage(document, scope, model), geometryChanges: DesignLayoutVersionGeometryChange[] = []
  if (staged.document !== document) {
    const before = createDesignRenderScene(document).root.byId, after = createDesignRenderScene(staged.document).root.byId
    for (const node of document.nodes) {
      const previous = before.get(node.id), next = after.get(node.id)
      if (previous && next && ['x', 'y', 'width', 'height'].some(key => previous[key as keyof DesignLayoutVersionGeometry] !==
        next[key as keyof DesignLayoutVersionGeometry]))
        geometryChanges.push({ id: node.id, before: geometry(previous), after: geometry(next) })
    }
  }
  return { document: staged.document, changedIds: staged.changedIds, geometryChanges, targetCount: staged.context.ids.length,
    changedCount: staged.changedIds.length, geometryChangedCount: geometryChanges.length }
}
/** Apply a layout-version intent while preserving authored resources, geometry fallbacks and matching active ownership.
 * @param document - Valid immutable authored scene.
 * @param scope - Selection or exact page scope; locked eligible containers reject the whole operation.
 * @param model - Requested CSS-compatible or legacy version.
 * @returns Candidate or original scene identity, without computing preview geometry or creating local instance version fields.
 * @throws DesignAutoLayoutEditError for invalid admission or invalid complete candidates.
 */
export function setDesignLayoutVersion(
  document: CopyOSDesignDocument, scope: DesignLayoutVersionScope, model: DesignLayoutVersionModel,
): CopyOSDesignDocument {
  return stage(document, scope, model).document
}
