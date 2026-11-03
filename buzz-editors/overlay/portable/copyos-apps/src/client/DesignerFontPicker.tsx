/** Searchable family previews with optional, user-authorized local font metadata. */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  designerFontChoices,
  designerFontName,
  normalizeDesignerFont,
  designerCachedLocalFonts,
  designerLoadedWebFonts,
  designerLocalFontsSupported,
  loadDesignerLocalFonts,
  type DesignerFontChoice,
} from './DesignerFonts.ts'
import css from './DesignerFontPicker.module.css'

/** All visible picker copy is supplied by its locale-owning parent. */
export interface DesignerFontPickerLabels {
  font: string
  mixed: string
  search: string
  custom: string
  documentFonts: string
  bundledFonts: string
  localFonts: string
  loadLocalFonts: string
  localDenied: string
  localUnsupported: string
  noResults: string
  more: string
}
interface FontSession {
  key: string
  original: string | null
  previewed: boolean
  cancel: () => void
}

/** Render a bounded font-family catalog while preserving complete authored CSS stacks.
 * @param props - Current selection, stored families, localized labels and transactional preview callbacks.
 * @returns An editable combobox and portaled, keyboard-navigable family previews.
 */
export function DesignerFontPicker({
  value,
  families,
  labels,
  selectionKey,
  onCommit,
  onPreview,
  onCancelPreview,
}: {
  value: string | null
  families: readonly string[]
  labels: DesignerFontPickerLabels
  selectionKey: string
  onCommit: (value: string) => void
  onPreview?: ((value: string) => void) | undefined
  onCancelPreview: () => void
}): ReactNode {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value ?? ''),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1),
    [limit, setLimit] = useState(40),
    [inventory, setInventory] = useState<DesignerFontChoice[]>([]),
    [loading, setLoading] = useState(false),
    [denied, setDenied] = useState(false)
  const input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    session = useRef<FontSession | null>(null),
    pendingLocalOwner = useRef<FontSession | null>(null),
    current = useRef({
      selectionKey,
      value,
      families,
      onPreview,
      onCancelPreview,
      onCommit,
    }),
    draftRef = useRef(draft),
    mounted = useRef(true),
    skipFocus = useRef(false),
    id = useId()
  current.current = {
    selectionKey,
    value,
    families,
    onPreview,
    onCancelPreview,
    onCommit,
  }
  draftRef.current = draft
  const position = useAnchoredPosition({
    open,
    anchorRef: input,
    panelRef: panel,
    align: 'end',
    gap: 4,
    margin: 12,
  })
  const supported = designerLocalFontsSupported()
  const filtered = inventory
    .filter(option =>
      option.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 5001)
  const visible = filtered.slice(0, limit)
  const cancel = (): void => {
    const owner = session.current
    if (owner?.previewed) {
      owner.previewed = false
      owner.cancel()
    }
  }
  const finish = (commit: boolean, candidate = draftRef.current): void => {
    const owner = session.current
    if (!owner) return
    session.current = null
    const next = normalizeDesignerFont(candidate)
    if (
      commit &&
      owner.key === current.current.selectionKey &&
      next &&
      next !== owner.original
    )
      current.current.onCommit(next)
    else if (owner.previewed) owner.cancel()
    if (mounted.current) {
      setOpen(false)
      setDraft(owner.original ?? '')
      setActive(-1)
      setLoading(false)
    }
  }
  const start = (): void => {
    if (skipFocus.current) {
      skipFocus.current = false
      return
    }
    if (session.current) return
    const state = current.current
    session.current = {
      key: state.selectionKey,
      original: state.value,
      previewed: false,
      cancel: state.onCancelPreview,
    }
    setDraft(state.value ?? '')
    draftRef.current = state.value ?? ''
    setQuery('')
    setActive(-1)
    setLimit(40)
    setDenied(false)
    setInventory(
      designerFontChoices(
        [
          ...(state.value ? [state.value] : []),
          ...state.families.slice(0, 2000),
        ],
        designerLoadedWebFonts(),
        designerCachedLocalFonts(),
      ),
    )
    setOpen(true)
  }
  const preview = (option: DesignerFontChoice): void => {
    const owner = session.current
    if (!owner || owner.key !== current.current.selectionKey) return
    if (!option.available || !current.current.onPreview) {
      cancel()
      return
    }
    owner.previewed = true
    current.current.onPreview(option.value)
  }
  const choose = (candidate: string): void => {
    finish(true, candidate)
    input.current?.blur()
    search.current?.blur()
  }
  const navigate = (direction: number): void => {
    if (!visible.length) return
    const next =
      active < 0
        ? direction < 0
          ? visible.length - 1
          : 0
        : Math.max(0, Math.min(visible.length - 1, active + direction))
    setActive(next)
    const option = visible[next]
    if (option) preview(option)
    const row: Partial<HTMLElement> | null = document.getElementById(
      `${id}-${next}`,
    )
    row?.scrollIntoView?.({ block: 'nearest' })
  }
  const keys = (
    event: React.KeyboardEvent<HTMLInputElement>,
    isSearch = false,
  ): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
      return
    event.stopPropagation()
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        start()
        return
      }
      navigate(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0 && visible[active]) choose(visible[active].value)
      else if (isSearch) {
        if (visible[0]) choose(visible[0].value)
        else {
          const typed = normalizeDesignerFont(query)
          if (typed) choose(typed)
        }
      } else choose(draftRef.current)
    }
  }
  useLayoutEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !session.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      event.stopPropagation()
      finish(false)
      if (document.activeElement !== input.current) {
        skipFocus.current = true
        input.current?.focus({ preventScroll: true })
      }
    }
    const outside = (event: PointerEvent): void => {
      if (
        session.current &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !input.current?.contains(event.target)
      )
        finish(true)
    }
    window.addEventListener('keydown', escape, true)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [])
  useLayoutEffect(() => {
    if (session.current && session.current.key !== selectionKey) finish(false)
    if (!session.current) setDraft(value ?? '')
  }, [selectionKey, value])
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const owner = session.current
      session.current = null
      if (owner?.previewed) owner.cancel()
    }
  }, [])
  const custom = normalizeDesignerFont(query.trim() || draft)
  const selectedValue = normalizeDesignerFont(session.current?.original ?? '')
  const source = (option: DesignerFontChoice): string =>
    option.source === 'bundled'
      ? labels.bundledFonts
      : option.source === 'local'
        ? labels.localFonts
        : labels.documentFonts
  return (
    <>
      <input
        ref={input}
        className={css.input}
        aria-label={labels.font}
        placeholder={value === null ? labels.mixed : labels.font}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && active >= 0 ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        maxLength={200}
        value={open ? draft : value === null ? '' : designerFontName(value)}
        onClick={() => {
          if (!session.current) start()
        }}
        onFocus={(event) => {
          start()
          event.currentTarget.select()
        }}
        onChange={(event) => {
          if (!session.current) start()
          setDraft(event.currentTarget.value)
          draftRef.current = event.currentTarget.value
          setQuery(event.currentTarget.value)
          setActive(-1)
          setLimit(40)
          cancel()
        }}
        onBlur={(event) => {
          if (!(
            event.relatedTarget instanceof Node &&
            panel.current?.contains(event.relatedTarget)
          ))
            finish(true)
        }}
        onKeyDown={(event) => {
          keys(event)
        }}
      />
      {open
        ? createPortal(
          <div
            ref={panel}
            className={css.panel}
            style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
            data-designer-popover-owners={
              input.current
                ?.closest('[data-designer-popover-owners]')
                ?.getAttribute('data-designer-popover-owners') ?? undefined
            }
            onBlur={(event) => {
              if (
                event.relatedTarget === null &&
                  pendingLocalOwner.current === session.current &&
                  session.current
              )
                return
              if (!(
                event.relatedTarget instanceof Node &&
                  (panel.current?.contains(event.relatedTarget) ||
                    input.current === event.relatedTarget)
              ))
                finish(true)
            }}
            onPointerLeave={() => {
              cancel()
              setActive(-1)
            }}
          >
            <input
              ref={search}
              className={css.search}
              aria-label={labels.search}
              aria-controls={id}
              aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
              aria-autocomplete="list"
              placeholder={labels.search}
              value={query}
              maxLength={200}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setActive(-1)
                setLimit(40)
                cancel()
              }}
              onKeyDown={(event) => {
                keys(event, true)
              }}
            />
            <div
              className={css.list}
              id={id}
              role="listbox"
              aria-label={labels.font}
            >
              {visible.map((option, index) => (
                <button
                  key={option.value}
                  id={`${id}-${index}`}
                  className={css.option}
                  type="button"
                  role="option"
                  aria-selected={option.value === selectedValue}
                  data-active={active === index || undefined}
                  onPointerDown={(event) => {
                    event.preventDefault()
                  }}
                  onPointerEnter={() => {
                    setActive(index)
                    preview(option)
                  }}
                  onClick={() => {
                    choose(option.value)
                  }}
                >
                  <span
                    style={
                      option.available
                        ? { fontFamily: option.value }
                        : undefined
                    }
                  >
                    {option.name}
                  </span>
                  <small>{source(option)}</small>
                </button>
              ))}
            </div>
            {!visible.length ? (
              <p className={css.notice}>{labels.noResults}</p>
            ) : null}
            {custom && custom !== session.current?.original ? (
              <button
                className={css.custom}
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  choose(custom)
                }}
              >
                {labels.custom}
                <span>{custom}</span>
              </button>
            ) : null}
            {filtered.length > visible.length ? (
              <button
                className={css.more}
                type="button"
                onClick={() => {
                  setLimit(size => Math.min(5001, size + 40))
                }}
              >
                {labels.more} ({filtered.length - visible.length})
              </button>
            ) : null}
            <footer className={css.footer}>
              {supported ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    void (async () => {
                      const owner = session.current
                      if (!owner) return
                      cancel()
                      setActive(-1)
                      pendingLocalOwner.current = owner
                      setLoading(true)
                      setDenied(false)
                      try {
                        const local = await loadDesignerLocalFonts()
                        if (
                          !mounted.current ||
                            session.current !== owner ||
                            owner.key !== current.current.selectionKey
                        )
                          return
                        const documents = inventory
                          .filter(option => option.source !== 'local')
                          .map(option => option.value)
                        setActive(-1)
                        setInventory(
                          designerFontChoices(
                            documents,
                            designerLoadedWebFonts(),
                            local,
                          ),
                        )
                      } catch {
                        if (mounted.current && session.current === owner)
                          setDenied(true)
                      } finally {
                        if (pendingLocalOwner.current === owner)
                          pendingLocalOwner.current = null
                        if (mounted.current && session.current === owner)
                          setLoading(false)
                      }
                    })()
                  }}
                >
                  {labels.loadLocalFonts}
                </button>
              ) : (
                <span>{labels.localUnsupported}</span>
              )}
              {denied ? <p role="status">{labels.localDenied}</p> : null}
            </footer>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
