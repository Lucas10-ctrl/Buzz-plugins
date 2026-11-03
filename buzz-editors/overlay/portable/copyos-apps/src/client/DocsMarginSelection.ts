/** Pointer selection beginning in the document's blank page margins. */
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/** Let a page-margin drag select only the active editor body, preserving native text/control gestures.
 * @param editor - Active editable page body.
 * @param surface - Scroll viewport containing the page and its margins.
 * @returns Disposer for the surface listener and any in-progress drag.
 */
export function installDocsMarginSelection(editor: Editor, surface: HTMLElement): () => void {
  const document = surface.ownerDocument, window = document.defaultView
  let drag: { pointerId: number; anchor: number; x: number; y: number } | undefined
  let frame: number | undefined
  const position = (x: number, y: number): number | undefined => {
    const rect = editor.view.dom.getBoundingClientRect(), viewport = surface.getBoundingClientRect()
    const left = Math.max(rect.left, viewport.left), right = Math.min(rect.right, viewport.right)
    const top = Math.max(rect.top, viewport.top), bottom = Math.min(rect.bottom, viewport.bottom)
    if (left >= right || top >= bottom) return undefined
    return editor.view.posAtCoords({ left: Math.max(left + 1, Math.min(right - 1, x)),
      top: Math.max(top + 1, Math.min(bottom - 1, y)) })?.pos
  }
  const select = (): void => {
    if (!drag || editor.isDestroyed) return
    const head = position(drag.x, drag.y)
    if (head === undefined) return
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(
      editor.state.doc.resolve(Math.min(drag.anchor, editor.state.doc.content.size)), editor.state.doc.resolve(head),
    )))
  }
  const scroll = (): void => {
    frame = undefined
    if (!drag || !window) return
    const rect = surface.getBoundingClientRect()
    const delta = drag.y < rect.top ? drag.y - rect.top : drag.y > rect.bottom ? drag.y - rect.bottom : 0
    if (!delta) return
    const previous = surface.scrollTop
    surface.scrollTop += delta
    select()
    if (surface.scrollTop !== previous) frame = window.requestAnimationFrame(scroll)
  }
  const move = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX; drag.y = event.clientY
    event.preventDefault(); select()
    if (frame === undefined && window) frame = window.requestAnimationFrame(scroll)
  }
  const finish = (): void => {
    drag = undefined
    if (frame !== undefined && window) window.cancelAnimationFrame(frame)
    frame = undefined
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', end)
    window?.removeEventListener('blur', finish)
  }
  const end = (event: PointerEvent): void => { if (event.pointerId === drag?.pointerId) finish() }
  const start = (event: PointerEvent): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.ctrlKey || event.metaKey || event.altKey
      || !editor.isEditable || editor.isDestroyed || !(event.target instanceof Element)
      || editor.view.dom.contains(event.target) || !event.target.contains(editor.view.dom)) return
    const rect = surface.getBoundingClientRect()
    if (event.clientX >= rect.left + surface.clientLeft + surface.clientWidth) return
    const anchor = position(event.clientX, event.clientY)
    if (anchor === undefined) return
    finish(); event.preventDefault()
    drag = { pointerId: event.pointerId, anchor: event.shiftKey ? editor.state.selection.anchor : anchor,
      x: event.clientX, y: event.clientY }
    editor.view.focus(); select()
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    window?.addEventListener('blur', finish)
  }
  surface.addEventListener('pointerdown', start)
  return () => { finish(); surface.removeEventListener('pointerdown', start) }
}
