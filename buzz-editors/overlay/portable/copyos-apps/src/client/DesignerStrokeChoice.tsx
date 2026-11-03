/** Compact stroke menus retain committed selection while hover/focus previews remain transient. */
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon } from './DesignerIcon.tsx'
import css from './DesignerStrokeChoice.module.css'

/** Render a keyboard-accessible stroke choice menu with optional transient previews.
 * @param props - Localized options and edit-session callbacks; callers key this component by selected owner.
 * @returns An anchored menu; selection closes it, while dismissal cancels its preview.
 */
export function DesignerStrokeChoice({
  label,
  value,
  mixed,
  choices,
  onBegin,
  onPreview,
  onCommit,
  onCancel,
  caption = false,
}: {
  label: string
  /** Show the label above the menu button, as inspector fields do. */
  caption?: boolean | undefined
  value: string | null
  mixed: string
  choices: readonly { id: string; label: string }[]
  onBegin?: (() => void) | undefined
  onPreview?: ((value: string) => void) | undefined
  onCommit: (value: string) => boolean | void
  onCancel?: (() => void) | undefined
}): ReactNode {
  const [open, setOpen] = useState(false),
    [keyboard, setKeyboard] = useState(false)
  const session = useRef<{ cancel?: (() => void) | undefined; previewed: string | null } | null>(
    null,
  )
  const cancel = (): void => {
    const active = session.current
    session.current = null
    active?.cancel?.()
    setOpen(false)
  }
  useEffect(
    () => () => {
      session.current?.cancel?.()
      session.current = null
    },
    [],
  )
  const begin = (fromKeyboard: boolean): void => {
    if (open) {
      cancel()
      return
    }
    session.current = { cancel: onCancel, previewed: null }
    onBegin?.()
    setKeyboard(fromKeyboard)
    setOpen(true)
  }
  const preview = (event: SyntheticEvent): void => {
    if (!onPreview || !session.current || !(event.target instanceof Element)) return
    const row = event.target.closest('[role="menuitem"]'),
      id = row?.querySelector('[data-stroke-choice]')?.getAttribute('data-stroke-choice')
    if (!id || !choices.some(choice => choice.id === id) || session.current.previewed === id) return
    session.current.previewed = id
    onPreview(id)
  }
  return (
    <span className={css.root} data-caption={caption || undefined} onMouseOverCapture={preview} onFocusCapture={preview}>
      {caption ? <span className={css.caption} aria-hidden="true">{label}</span> : null}
      <Menu
        portal
        listClassName={css.menu}
        compact
        autoFocus={keyboard}
        open={open}
        selectedId={value ?? undefined}
        onClose={cancel}
        anchor={
          <button
            type="button"
            className={css.trigger}
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={(event) => {
              begin(event.detail === 0)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              event.stopPropagation()
              if (open) setKeyboard(true)
              else begin(true)
            }}
          >
            <span>{choices.find(choice => choice.id === value)?.label ?? mixed}</span>
            <DesignerIcon name="down" />
          </button>
        }
        items={choices.map(choice => ({
          id: choice.id,
          label: <span data-stroke-choice={choice.id}>{choice.label}</span>,
        }))}
        onSelect={(id) => {
          const accepted = onCommit(id)
          if (accepted === false) session.current?.cancel?.()
          session.current = null
          setOpen(false)
        }}
      />
    </span>
  )
}
