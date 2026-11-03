/** Pointer menus with independently clamped submenus and keyboard focus. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MenuEntry, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PageDesignerWorkspace.module.css'

/** Render the designer's pointer-targeted command menu.
 * @param props - Viewport point, commands, selection handler and dismissal callback.
 * @returns Independently portaled primary and submenu cards.
 */
export function DesignerContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number
  y: number
  items: MenuEntry[]
  onSelect: (id: string) => void
  onClose: () => void
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const sub = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef(document.activeElement)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [submenu, setSubmenu] = useState<MenuItem | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' })
  const [subPosition, setSubPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const cancelTimer = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const dismiss = (): void => {
    onClose()
    if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus({ preventScroll: true })
  }
  useLayoutEffect(() => {
    const place = (): void => {
      const box = root.current
      if (!box) return
      const margin = 12
      setPosition({
        left: Math.max(margin, Math.min(x, window.innerWidth - box.offsetWidth - margin)),
        top: Math.max(margin, Math.min(y, window.innerHeight - box.offsetHeight - margin)),
      })
      if (submenu && sub.current && trigger.current) {
        const r = trigger.current.getBoundingClientRect()
        const width = sub.current.offsetWidth
        const height = sub.current.offsetHeight
        setSubPosition({
          left: r.right + width + margin > window.innerWidth ? Math.max(margin, r.left - width) : r.right,
          top: Math.max(margin, Math.min(r.top - 4, window.innerHeight - height - margin)),
        })
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [x, y, submenu])
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !sub.current?.contains(event.target)
      )
        onClose()
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
      cancelTimer()
    }
  }, [])
  const openSubmenu = (item: MenuItem, button: HTMLButtonElement, focus = false): void => {
    cancelTimer()
    trigger.current = button
    // Re-activating the same card must retain its measured position: its
    // unchanged identity does not rerun the placement effect.
    if (submenu !== item) {
      setSubPosition({ visibility: 'hidden' })
      setSubmenu(item)
    }
    if (focus)
      queueMicrotask(() => sub.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
  }
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>, nested: boolean): void => {
    event.stopPropagation()
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    } else if (event.key === 'Escape' || (event.key === 'ArrowLeft' && nested)) {
      event.preventDefault()
      if (nested) {
        setSubmenu(null)
        trigger.current?.focus()
      } else dismiss()
    } else if (event.key === 'ArrowRight' && !nested && document.activeElement instanceof HTMLButtonElement) {
      const button = document.activeElement
      const item = items.find(v => !('type' in v) && v.id === button.dataset.command)
      if (item && !('type' in item) && item.submenu?.length) {
        event.preventDefault()
        openSubmenu(item, button, true)
      }
    } else if (event.key === 'Tab') {
      event.preventDefault()
      dismiss()
    }
  }
  const rows = (entries: readonly MenuEntry[], nested: boolean): ReactNode =>
    entries.map((entry) => {
      if ('type' in entry)
        return entry.type === 'separator' ? (
          <div key={entry.id} role="separator" className={css.contextDivider} />
        ) : (
          <div key={entry.id}>{entry.text}</div>
        )
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          data-command={entry.id}
          disabled={entry.disabled}
          aria-haspopup={entry.submenu?.length ? 'menu' : undefined}
          aria-expanded={entry.submenu?.length ? submenu?.id === entry.id : undefined}
          onPointerEnter={(event) => {
            cancelTimer()
            if (entry.submenu?.length) openSubmenu(entry, event.currentTarget)
            else if (!nested) setSubmenu(null)
          }}
          onPointerLeave={() => {
            if (entry.submenu?.length) {
              cancelTimer()
              timer.current = setTimeout(() => {
                setSubmenu(null)
              }, 260)
            }
          }}
          onClick={(event) => {
            if (entry.submenu?.length) openSubmenu(entry, event.currentTarget, true)
            else {
              onSelect(entry.id)
              if (previousFocus.current instanceof HTMLElement)
                previousFocus.current.focus({ preventScroll: true })
            }
          }}
        >
          {entry.icon}
          {entry.label}
          {entry.submenu?.length ? <span aria-hidden="true">›</span> : null}
        </button>
      )
    })
  return createPortal(
    <>
      <div
        ref={root}
        role="menu"
        className={css.contextMenu}
        style={position}
        onKeyDown={(e) => {
          keyboard(e, false)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
        }}
      >
        {rows(items, false)}
      </div>
      {submenu ? (
        <div
          ref={sub}
          role="menu"
          className={css.contextMenu}
          style={subPosition}
          onPointerEnter={cancelTimer}
          onPointerLeave={() => {
            timer.current = setTimeout(() => {
              setSubmenu(null)
            }, 260)
          }}
          onKeyDown={(e) => {
            keyboard(e, true)
          }}
        >
          {rows(submenu.submenu ?? [], true)}
        </div>
      ) : null}
    </>,
    document.body,
  )
}
