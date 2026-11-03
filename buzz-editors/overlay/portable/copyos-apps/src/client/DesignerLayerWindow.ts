/** Windowing for the Canvas layers list: rows have one fixed height, so the mounted range is index arithmetic. */
import { useCallback, useLayoutEffect, useRef, useState, type RefCallback, type UIEvent } from 'react'

/** Height of one layers-list row in CSS pixels; `.layer` in PageDesignerWorkspace.module.css uses the same value. */
export const DESIGNER_LAYER_ROW_HEIGHT = 32

/** Rows mounted above and below the visible range so short scrolls do not show empty space. */
const OVERSCAN_ROWS = 12

/** Compute the row indices to mount for one scroll position.
 * @param scrollTop - Scroll offset of the list viewport in CSS pixels.
 * @param viewportHeight - Viewport height in CSS pixels; 0 means unmeasured and mounts every row.
 * @param count - Number of rows in the list.
 * @param pinned - Row indices that stay mounted outside the visible range, such as a row being renamed or holding focus.
 * @returns Ascending, distinct row indices.
 */
export function designerLayerWindow(scrollTop: number, viewportHeight: number, count: number,
  pinned: readonly number[] = []): number[] {
  if (viewportHeight <= 0) return Array.from({ length: count }, (_, index) => index)
  const first = Math.max(0, Math.floor(scrollTop / DESIGNER_LAYER_ROW_HEIGHT) - OVERSCAN_ROWS)
  const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / DESIGNER_LAYER_ROW_HEIGHT) + OVERSCAN_ROWS)
  const indices = Array.from({ length: Math.max(0, last - first) }, (_, offset) => first + offset)
  const extra = pinned.filter(index => index >= 0 && index < count && (index < first || index >= last))
  return extra.length ? [...new Set([...indices, ...extra])].sort((a, b) => a - b) : indices
}

/** The scroll offset that brings one row fully into view, or the current offset when it is already visible.
 * @param scrollTop - Current scroll offset in CSS pixels.
 * @param viewportHeight - Viewport height in CSS pixels.
 * @param index - Row index to reveal.
 * @returns The new scroll offset.
 */
export function designerLayerRevealOffset(scrollTop: number, viewportHeight: number, index: number): number {
  const top = index * DESIGNER_LAYER_ROW_HEIGHT, bottom = top + DESIGNER_LAYER_ROW_HEIGHT
  if (viewportHeight <= 0 || (top >= scrollTop && bottom <= scrollTop + viewportHeight)) return scrollTop
  return top < scrollTop ? top : bottom - viewportHeight
}

/** Track the layers-list viewport and return the rows to mount.
 * @param count - Number of rows in the flattened list.
 * @param pinned - Row indices that must stay mounted.
 * @returns The viewport ref and scroll handler, the mounted indices, the list height and a reveal function.
 */
export function useDesignerLayerWindow(count: number, pinned: readonly number[]): {
  viewport: RefCallback<HTMLDivElement>
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  indices: number[]
  height: number
  reveal: (index: number) => void
} {
  const element = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  // Last measured offset and height; reveal reads these instead of the DOM, since reading layout right after a Canvas
  // render forces the browser to lay out the whole scene synchronously.
  const measured = useRef({ top: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((): void => {
    const node = element.current
    if (!node) return
    const next = { top: node.scrollTop, height: node.clientHeight }
    measured.current = next
    setView(current => current.top === next.top && current.height === next.height ? current : next)
  }, [])
  const viewport = useCallback<RefCallback<HTMLDivElement>>((node) => {
    observer.current?.disconnect()
    observer.current = null
    element.current = node
    if (!node) return
    measure()
    if (typeof ResizeObserver === 'function') {
      observer.current = new ResizeObserver(measure)
      observer.current.observe(node)
    }
  }, [measure])
  // A shorter list clamps the browser's scroll offset without a scroll event when rows disappear; a longer list cannot,
  // and reading its offset right after a Canvas render would force a layout of the whole scene.
  const measuredCount = useRef(count)
  useLayoutEffect(() => {
    const shorter = count < measuredCount.current
    measuredCount.current = count
    if (shorter) measure()
  }, [count, measure])
  const reveal = useCallback((index: number): void => {
    const node = element.current
    if (!node) return
    const { top: current, height } = measured.current
    const top = designerLayerRevealOffset(current, height, index)
    if (top === current) return
    node.scrollTop = top
    // The scroll event that follows re-measures the clamped offset.
    measured.current = { top, height }
    setView(view => view.top === top && view.height === height ? view : { top, height })
  }, [])
  return {
    viewport, onScroll: measure, reveal,
    indices: designerLayerWindow(view.top, view.height, count, pinned),
    height: count * DESIGNER_LAYER_ROW_HEIGHT,
  }
}
