/** Anchored editor popovers retain their owner and escape panel overflow. */
import {
  createContext,
  useContext,
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PageDesignerWorkspace.module.css'

const PopoverOwners = createContext<readonly string[]>([])
const activePanels: string[] = []

/** Render a dismissible, viewport-clamped resource or settings panel.
 * @param props - Localized labels, optional accessible trigger description and panel content; controlled state uses onOpenChange.
 * @returns A trigger and its portaled panel.
 */
export function DesignerPopover({
  label,
  description,
  open: controlledOpen,
  closeLabel,
  children,
  trigger,
  triggerClassName,
  panelClassName,
  onDismiss,
  onOpenChange,
  allowPaintHandles = false,
  cropView = false,
}: {
  label: string
  description?: string | undefined
  open?: boolean | undefined
  closeLabel: string
  children: ReactNode
  trigger?: ReactNode
  triggerClassName?: string | undefined
  panelClassName?: string | undefined
  onDismiss?: (() => void) | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  cropView?: boolean | undefined
  allowPaintHandles?: boolean | undefined
}): ReactNode {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = (value: boolean): void => { if (controlledOpen === undefined) setLocalOpen(value) }
  const panelHadFocus = useRef(false)
  const id = useId(),
    ancestors = useContext(PopoverOwners),
    owners = [...ancestors, id]
  const dismiss = (): void => {
    onDismiss?.()
    onOpenChange?.(false)
    setOpen(false)
  }
  const restoreFocus = useRef(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open,
    anchorRef: anchor,
    panelRef: panel,
    align: 'end',
    gap: 6,
    margin: 12,
  })
  useLayoutEffect(() => {
    if (!open && (restoreFocus.current || controlledOpen === false && panelHadFocus.current)) {
      restoreFocus.current = false
      panelHadFocus.current = false
      anchor.current?.focus()
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    activePanels.push(id)
    const owns = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (!!panel.current?.contains(target) ||
        !!anchor.current?.contains(target) ||
        (target instanceof Element &&
          !!target
            .closest('[data-designer-popover-owners]')
            ?.getAttribute('data-designer-popover-owners')
            ?.split(' ')
            .includes(id)))
    let startedInside = false
    const pointerOrigin = (e: PointerEvent): void => {
      startedInside =
        owns(e.target) ||
        (allowPaintHandles &&
          e.target instanceof Element &&
          !!e.target.closest('[data-designer-paint-handle]'))
    }
    const outside = (e: MouseEvent): void => {
      if (startedInside) {
        startedInside = false
        return
      }
      if (
        allowPaintHandles &&
        e.target instanceof Element &&
        e.target.closest('[data-designer-paint-handle]')
      )
        return
      if (e.target instanceof Node && !owns(e.target)) dismiss()
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && activePanels.at(-1) === id) {
        // A focused child menu owns Escape before the containing settings panel.
        if (e.target instanceof Element && e.target.closest('[role="menu"], [aria-haspopup="menu"][aria-expanded="true"]')) return
        e.stopPropagation()
        e.preventDefault()
        restoreFocus.current = true
        dismiss()
      }
    }
    document.addEventListener('pointerdown', pointerOrigin, true)
    document.addEventListener('click', outside)
    document.addEventListener('keydown', escape, true)
    panel.current
      ?.querySelector<HTMLInputElement>('input')
      ?.focus({ preventScroll: true })
    return () => {
      const index = activePanels.indexOf(id)
      if (index >= 0) activePanels.splice(index, 1)
      document.removeEventListener('pointerdown', pointerOrigin, true)
      document.removeEventListener('click', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return (
    <PopoverOwners.Provider value={owners}>
      <button
        ref={anchor}
        data-designer-crop-view={cropView || undefined}
        className={triggerClassName}
        type="button"
        aria-label={label}
        aria-description={description}
        aria-expanded={open}
        onClick={() => {
          if (open) dismiss()
          else {
            setOpen(true)
            onOpenChange?.(true)
          }
        }}
      >
        {trigger ?? label}
      </button>
      {open
        ? createPortal(
          <div
            ref={panel}
            data-designer-crop-view={cropView || undefined}
            onFocusCapture={() => { panelHadFocus.current = true }}
            onBlurCapture={(event) => {
              if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) panelHadFocus.current = false
            }}
            role="dialog"
            data-designer-popover-owners={[...owners, anchor.current?.closest('[data-designer-popover-owners]')
              ?.getAttribute('data-designer-popover-owners')].filter(Boolean).join(' ')}
            aria-label={label}
            className={`${css.designerPopover} ${panelClassName ?? ''}`}
            style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
            onKeyDown={(e) => {
              e.stopPropagation()
            }}
          >
            <header>
              <span>{label}</span>
              <button
                type="button"
                aria-label={closeLabel}
                onClick={() => {
                  restoreFocus.current = true
                  dismiss()
                }}
              >
                ×
              </button>
            </header>
            {children}
          </div>,
          document.body,
        )
        : null}
    </PopoverOwners.Provider>
  )
}
