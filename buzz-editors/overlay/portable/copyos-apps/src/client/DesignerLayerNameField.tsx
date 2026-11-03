/** Layer names with structured syntax remain drafts until the user explicitly finishes editing. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** Stage a layer-name edit without publishing invalid intermediate syntax.
 * @param props - Committed name, accessible label, native limit and the history-owned commit action.
 * @returns An editable draft; rejected commits retain the draft for correction.
 */
export function DesignerLayerNameField({
  value,
  label,
  maxLength,
  onCommit,
  onDone,
  autoFocus = false,
  className,
}: {
  value: string
  label: string
  maxLength: number
  onCommit: (name: string) => boolean | void
  onDone?: (() => void) | undefined
  autoFocus?: boolean
  className?: string | undefined
}): ReactNode {
  const [draft, setDraft] = useState(value),
    [invalid, setInvalid] = useState(false)
  const dirty = useRef(false),
    settled = useRef(false),
    input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])
  useLayoutEffect(() => {
    if (autoFocus) {
      input.current?.focus()
      input.current?.select()
    }
  }, [autoFocus])
  const finish = (): void => {
    if (settled.current) return
    const next = draft.trim()
    if (!next) {
      setInvalid(true)
      return
    }
    try {
      if (dirty.current && next !== value && onCommit(next) === false) {
        setInvalid(true)
        return
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setInvalid(true)
      return
    }
    dirty.current = false
    settled.current = true
    setInvalid(false)
    setDraft(next)
    onDone?.()
  }
  return (
    <input
      ref={input}
      className={className}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft}
      title={draft}
      maxLength={maxLength}
      onChange={(event) => {
        dirty.current = true
        settled.current = false
        setInvalid(false)
        setDraft(event.currentTarget.value)
      }}
      onClick={(event) => {
        event.stopPropagation()
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
          return
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          dirty.current = false
          settled.current = true
          setInvalid(false)
          setDraft(value)
          onDone?.()
        }
      }}
    />
  )
}
