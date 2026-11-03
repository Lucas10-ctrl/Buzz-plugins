/** Caret-anchored block suggestions retain typing focus and escape the editor's scrolling containers. */
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { overlayTopMargin } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DocsWorkspace.module.css'

const MAX_HEIGHT = 310

/** Localized suggestion row; command ids remain independent of the application language. */
export interface DocsSlashChoice { readonly id: string; readonly label: string; readonly command?: string }
/** Render a bounded suggestion list while the document owns keyboard selection.
 * @param props - Localized rows, current caret geometry, selection and dismissal callbacks.
 * @returns The body-portaled suggestion list.
 */
export function DocsSlashMenu({ id, label, choices, index, anchor, choose, close }: {
  readonly id: string
  readonly label: string
  readonly choices: readonly DocsSlashChoice[]
  readonly index: number
  readonly anchor: () => { readonly left: number; readonly top: number; readonly bottom: number }
  readonly choose: (index: number) => void
  readonly close: () => void
}) {
  const menu = useRef<HTMLDivElement>(null), rows = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8,
    '--docs-slash-height': `${Math.min(MAX_HEIGHT, Math.max(14, (window.visualViewport?.height ?? window.innerHeight) - overlayTopMargin(8) - 8))}px` })
  useLayoutEffect(() => {
    const place = (): void => {
      const box = menu.current?.getBoundingClientRect(), caret = anchor(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const inset = overlayTopMargin(8), heightLimit = Math.min(MAX_HEIGHT, Math.max(14, height - inset - 8))
      const menuHeight = Math.min((rows.current?.scrollHeight ?? 0) + 14, heightLimit), below = caret.bottom + 4
      setPosition({ left: Math.max(left + 8, Math.min(caret.left, left + width - (box?.width ?? 240) - 8)),
        top: Math.max(top + inset, Math.min(below + menuHeight <= top + height - 8 ? below : caret.top - menuHeight - 4,
          top + height - menuHeight - 8)), '--docs-slash-height': `${heightLimit}px` })
    }
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close()
    }
    const scroll = (event: Event): void => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      place()
    }
    place()
    window.addEventListener('resize', place); document.addEventListener('scroll', scroll, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true)
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place)
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [anchor, close, choices.length])
  const choiceIds = JSON.stringify(choices.map(choice => choice.id))
  useLayoutEffect(() => {
    const list = rows.current, selected = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !selected) return
    if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop
    else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight
  }, [index, choiceIds])
  return createPortal(<div id={id} ref={menu} className={css.slash} style={position} role="listbox" aria-label={label}
    onPointerDown={(event) => { event.preventDefault() }} onMouseDown={(event) => { event.preventDefault() }}>
    <div ref={rows} className={css.slashItems}>{choices.map((choice, position) => <button type="button" id={`${id}-${position}`} key={choice.id} role="option"
      aria-label={choice.label} tabIndex={-1} aria-selected={position === index} onClick={() => { choose(position) }}>
      <span>{choice.label}</span>{choice.command ? <small>/{choice.command}</small> : null}
    </button>)}</div>
  </div>, document.body)
}
