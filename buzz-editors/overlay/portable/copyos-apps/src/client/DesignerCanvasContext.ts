/** Context menus look beneath editor-only spacing hit regions without changing drag targets. */
export interface DesignerCanvasContextTarget {
  nodeId: string
  instanceId?: string | undefined
  instancePath?: string[] | undefined
}
const editorControls =
  '[data-designer-layout-overlay], [data-designer-grid-guide], [data-designer-resize-handle], [data-designer-sizing-edge]'

/** Resolve the painted layer underneath a spacing overlay using the browser's clipped, transformed hit stack.
 * @param canvas - The actual designer SVG; unrelated page surfaces are excluded.
 * @param target - Original context-menu target, retained when it is ordinary scene content.
 * @param x - Client-space horizontal pointer coordinate.
 * @param y - Client-space vertical pointer coordinate.
 * @returns Stored owner and optional contextual descendant path; no source-layer identity is substituted for an instance.
 */
export function designerCanvasContextTarget(
  canvas: SVGSVGElement,
  target: EventTarget | null,
  x: number,
  y: number,
): DesignerCanvasContextTarget | undefined {
  if (!(target instanceof Element) || !canvas.contains(target)) return undefined
  const owner = target.closest('[data-design-node]')
  let painted = owner
  if (target.closest('[data-designer-layout-overlay]')) {
    const document = canvas.ownerDocument
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []
    painted =
      stack
        .find(
          element =>
            canvas.contains(element) &&
            !element.closest(editorControls) &&
            element.closest('[data-design-node]'),
        )
        ?.closest('[data-design-node]') ?? owner
  }
  const nodeId = painted?.getAttribute('data-design-node')
  if (!nodeId) return undefined
  const instanceId = painted?.getAttribute('data-instance-owner')
  if (!instanceId) return { nodeId }
  const encoded = painted?.getAttribute('data-instance-path')
  if (encoded && encoded.length <= 8192) {
    try {
      const path: unknown = JSON.parse(encoded)
      if (
        Array.isArray(path) &&
        path.length > 0 &&
        path.length <= 64 &&
        path.every(part => typeof part === 'string' && part.length > 0)
      )
        return { nodeId: instanceId, instanceId, instancePath: path }
    } catch (_error) {
      /* Invalid editor metadata falls back to its stored instance, never the physical source layer. */
    }
  }
  return { nodeId: instanceId }
}
