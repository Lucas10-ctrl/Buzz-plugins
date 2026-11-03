/** Canvas backdrops are authored per page and remain independent from scene exports and interface themes. */
import type { CopyOSDesignCanvasBackground, CopyOSDesignDocument } from './types.ts'
import { designColorVariableCss } from './design-color.ts'
import { resolveDesignModeColors } from './design-token-values.ts'
/** Mode-resolved editor backdrop; the authored paint remains separate from its final composited alpha. */
export interface ResolvedDesignCanvasBackground {
  background: CopyOSDesignCanvasBackground
  color: string
  alpha: number
  cssColor: string
  tokenModeId: string | null
}
/** Read page, document or legacy-default backing without mutating or materializing stored defaults.
 * @param document - Native scene and optional explicit pages.
 * @param pageId - Explicit page identity; ignored for legacy scenes without explicit pages.
 * @returns Independent authored solid paint; omitted defaults to light gray, opaque and visible.
 */
export function designCanvasBackground(document: CopyOSDesignDocument, pageId?: string): CopyOSDesignCanvasBackground {
  const page = pageId === undefined ? undefined : document.pages?.find(value => value.id === pageId)
  if (pageId !== undefined && document.pages?.length && !page) throw new Error('Canvas page not found')
  return { ...(page?.canvasBackground ?? document.canvasBackground ?? { color: '#f5f5f5', opacity: 1, visible: true }) }
}
/** Resolve the selected page's backing using page mode, then the document mode.
 * @param document - Native scene, token library and page assignments.
 * @param pageId - Explicit page identity or the document/implicit backing.
 * @returns Native RGB, final alpha and ready-to-paint CSS; authored opacity and bindings stay in background.
 */
export function resolveDesignCanvasBackground(document: CopyOSDesignDocument, pageId?: string): ResolvedDesignCanvasBackground {
  const background = designCanvasBackground(document, pageId)
  const page = pageId === undefined ? undefined : document.pages?.find(value => value.id === pageId)
  const tokenModeId = page?.tokenModeId === 'base' ? null : page?.tokenModeId ?? document.activeTokenModeId ?? null
  const resource = background.variableId
    ? resolveDesignModeColors(document, tokenModeId).find(value => value.id === background.variableId) : undefined
  if (background.variableId && !resource) throw new Error('Canvas background color resource not found')
  const color = resource?.value ?? background.color, alpha = background.opacity * (resource?.alpha ?? 1)
  return { background, color, alpha, tokenModeId,
    cssColor: background.visible ? designColorVariableCss({ value: color, alpha }) : 'transparent' }
}
/** Validate every authored canvas paint, including unused document fallbacks and hidden page overrides.
 * @param document - Native scene and color identities.
 * @returns Whether solid fields and shared references are valid; numeric alpha graphs validate with the token library.
 */
export function designCanvasBackgroundsValid(document: CopyOSDesignDocument): boolean {
  const ids = new Set(document.variables.map(value => value.id))
  return [document.canvasBackground, ...(document.pages ?? []).map(page => page.canvasBackground)].every(background =>
    background === undefined || (/^#[a-f\d]{6}$/i.test(background.color) && Number.isFinite(background.opacity) &&
      background.opacity >= 0 && background.opacity <= 1 && typeof background.visible === 'boolean' &&
      (background.variableId == null || ids.has(background.variableId))))
}
