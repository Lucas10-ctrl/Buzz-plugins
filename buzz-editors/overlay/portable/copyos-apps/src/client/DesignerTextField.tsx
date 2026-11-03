/** Draft text properties support searchable suggestions without browser-owned menus. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PageDesignerWorkspace.module.css'
/** Render an editable property with Enter/blur commit, Escape cancellation and keyboard suggestions.
 * @param props - Current value, labels, suggestions and commit callback; normalization returns null to reject a draft.
 * @returns A text draft with an optional portaled suggestion list.
 */
export function DesignerTextField({
  value,
  label,
  suggestions,
  onCommit,
  normalize,
  placeholder,
}: {
  value: string
  label: string
  suggestions: readonly string[]
  normalize?: ((value: string) => string | null) | undefined
  placeholder?: string | undefined
  onCommit: (value: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1)
  const focused = useRef(false),
    cancelled = useRef(false),
    input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId()
  const options = [...new Set(suggestions)].filter(v => v.toLowerCase().includes(query.toLowerCase()))
  const position = useAnchoredPosition({
    open,
    anchorRef: input,
    panelRef: panel,
    align: 'end',
    gap: 4,
    margin: 12,
  })
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  const commit = (text = draft): void => {
    const next = normalize ? normalize(text.trim()) : text.trim()
    if (next && next !== value) {
      setDraft(next)
      onCommit(next.slice(0, 200))
    } else setDraft(value)
  }
  const choose = (text: string): void => {
    setDraft(text)
    commit(text)
    cancelled.current = true
    focused.current = false
    setOpen(false)
    input.current?.blur()
  }
  return (
    <>
      <input
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        role={suggestions.length ? 'combobox' : undefined}
        aria-autocomplete={suggestions.length ? 'list' : undefined}
        aria-expanded={suggestions.length ? open && options.length > 0 : undefined}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={draft}
        onFocus={(e) => {
          focused.current = true
          cancelled.current = false
          setQuery('')
          setActive(-1)
          setOpen(suggestions.length > 0)
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setDraft(e.currentTarget.value)
          setQuery(e.currentTarget.value)
          setActive(-1)
          setOpen(suggestions.length > 0)
        }}
        onBlur={() => {
          focused.current = false
          setOpen(false)
          if (!cancelled.current) commit()
          cancelled.current = false
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') return
          e.stopPropagation()
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
            e.preventDefault()
            setOpen(true)
            setActive(i => Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (open && active >= 0 && options[active]) choose(options[active])
            else {
              commit()
              focused.current = false
              cancelled.current = true
              setOpen(false)
              e.currentTarget.blur()
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            focused.current = false
            cancelled.current = true
            setDraft(value)
            setOpen(false)
            e.currentTarget.blur()
          }
        }}
      />
      {open && options.length
        ? createPortal(
          <div
            ref={panel}
            data-designer-popover-owners={
              input.current
                ?.closest('[data-designer-popover-owners]')
                ?.getAttribute('data-designer-popover-owners') ?? undefined
            }
            id={id}
            role="listbox"
            aria-label={label}
            className={css.textSuggestions}
            style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          >
            {options.map((option, i) => (
              <button
                key={option}
                id={`${id}-${i}`}
                type="button"
                role="option"
                aria-selected={active === i || (!query && option === value)}
                onPointerDown={(e) => {
                  e.preventDefault()
                }}
                onClick={() => {
                  choose(option)
                }}
                style={{ fontFamily: option }}
              >
                {option}
              </button>
            ))}
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
