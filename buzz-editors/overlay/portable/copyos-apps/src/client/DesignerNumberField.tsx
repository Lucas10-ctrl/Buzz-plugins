/** Draft-based numeric fields shared by the designer inspector. */
import { useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import css from './PageDesignerWorkspace.module.css'
import { DesignerSaveAdmission } from './DesignerSaveAdmission.ts'

/** Parse arithmetic without evaluating JavaScript.
 * @param input - A numeric expression with parentheses and arithmetic operators.
 * @returns A finite result, or null for an invalid draft.
 */
export function parseDesignNumber(input: string): number | null {
  const tokens = input.match(/\d*\.?\d+(?:e[+-]?\d+)?|[()+*/-]/gi) ?? []
  if (tokens.join('') !== input.replace(/\s/g, '') || tokens.length > 100) return null
  let index = 0
  const primary = (): number => {
    const token = tokens[index++]
    if (token === '-') return -primary()
    if (token === '+') return primary()
    if (token === '(') {
      const value = sum()
      if (tokens[index++] !== ')') return NaN
      return value
    }
    return token === undefined ? NaN : Number(token)
  }
  const product = (): number => {
    let v = primary()
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++]
      const n = primary()
      v = op === '*' ? v * n : v / n
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++]
      const n = product()
      v = op === '+' ? v + n : v - n
    }
    return v
  }
  const result = sum()
  return index === tokens.length && Number.isFinite(result) ? result : null
}

/** Edited drafts commit on blur/Enter; clean focus never quantizes values. Full precision retains every displayed digit.
 * Escape cancels; dragging the label scrubs one edit. Inspector callers key fields by selection,
 * so replacing their owner while focus remains cancels drafts rather than moving them to another layer.
 * @param props - Localized labels, common value (null for Mixed), limits and commit callback.
 * @returns A compact numeric control.
 */
export function DesignerNumberField({
  label,
  short,
  value,
  mixed,
  min = -100000,
  max = 100000,
  step = 1,
  disabled = false,
  commitUnchanged = false,
  fullPrecision = false,
  caption = false,
  onCommit,
}: {
  label: string
  short: ReactNode
  value: number | null
  mixed: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  commitUnchanged?: boolean
  fullPrecision?: boolean
  /** Show the full label above the field; a text `short` prefix is then omitted and the caption scrubs instead. */
  caption?: boolean
  onCommit: (value: number) => boolean | void
}): ReactNode {
  const format = (n: number | null): string =>
    n === null
      ? ''
      : fullPrecision || (n !== 0 && Math.abs(n) < 0.0001)
        ? String(n)
        : String(Math.round(n * 10000) / 10000)
  const reportSaveAdmission = useContext(DesignerSaveAdmission)
  const restoreRejectedFocus = useRef(false)
  const [draft, setDraft] = useState(format(value))
  const [invalid, setInvalid] = useState(false)
  const focused = useRef(false)
  const cancelled = useRef(false)
  const edited = useRef(false)
  const scrub = useRef<{
    pointerId: number
    x: number
    value: number
    current: number
    edited: boolean
  } | null>(null)
  const currentValue = useRef(value)
  currentValue.current = value
  const cancelScrub = (): void => {
    if (!scrub.current) return
    scrub.current = null
    setDraft(format(currentValue.current))
    setInvalid(false)
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !scrub.current) return
      event.preventDefault()
      event.stopPropagation()
      cancelScrub()
    }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', cancelScrub)
    return () => {
      scrub.current = null
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', cancelScrub)
    }
  }, [fullPrecision])
  useEffect(() => {
    if (!focused.current) setDraft(format(value))
  }, [value, fullPrecision])
  const commit = (): void => {
    if (!edited.current) {
      setInvalid(false)
      setDraft(format(value))
      return
    }
    // A commit callback may move focus and synchronously re-enter onBlur.
    edited.current = false
    const next = parseDesignNumber(draft)
    if (next !== null && next >= min && next <= max) {
      const accepted = next !== value || commitUnchanged ? onCommit(next) : true
      const saving = reportSaveAdmission?.(accepted !== false) ?? false
      if (saving && accepted === false) {
        restoreRejectedFocus.current = true
        edited.current = true
        setInvalid(true)
        return
      }
      setInvalid(false)
      setDraft(format(accepted === false ? value : next))
    } else {
      if (reportSaveAdmission?.(false)) {
        restoreRejectedFocus.current = true
        edited.current = true
        setInvalid(true)
        return
      }
      setDraft(format(value))
      setInvalid(false)
    }
  }
  // Dragging the prefix, or the caption when shown, scrubs the value as one edit.
  const scrubProps: HTMLAttributes<HTMLSpanElement> = {
    title: label,
    style: { cursor: disabled ? 'default' : 'ew-resize', touchAction: 'none' },
    onPointerDown: (e) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      edited.current = false
      setDraft(format(value))
      setInvalid(false)
      scrub.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        value: value ?? 0,
        current: value ?? 0,
        edited: false,
      }
    },
    onPointerMove: (e) => {
      const g = scrub.current
      if (!g || g.pointerId !== e.pointerId) return
      g.edited ||= e.clientX !== g.x
      g.current = Math.max(
        min,
        Math.min(max, g.value + Math.round(e.clientX - g.x) * step * (e.shiftKey ? 10 : 1)),
      )
      setDraft(format(g.current))
    },
    onPointerUp: (event) => {
      const gesture = scrub.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      scrub.current = null
      if (gesture.edited && (gesture.current !== gesture.value || commitUnchanged)) {
        if (onCommit(gesture.current) === false) {
          setDraft(format(value))
          setInvalid(false)
        }
      }
    },
    onPointerCancel: cancelScrub,
    onLostPointerCapture: cancelScrub,
  }
  const input = (
    <input
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? mixed : undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-invalid={invalid || undefined}
      placeholder={value === null ? mixed : undefined}
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focused.current = true
        cancelled.current = false
        if (!restoreRejectedFocus.current) edited.current = false
        restoreRejectedFocus.current = false
      }}
      onChange={(e) => {
        edited.current = true
        setDraft(e.currentTarget.value)
        const n = parseDesignNumber(e.currentTarget.value)
        setInvalid(n === null || n < min || n > max)
      }}
      onBlur={() => {
        focused.current = false
        if (!cancelled.current) commit()
        cancelled.current = false
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') return
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          focused.current = false
          cancelled.current = true
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          focused.current = false
          cancelled.current = true
          edited.current = false
          setDraft(format(value))
          setInvalid(false)
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const next = Math.max(
            min,
            Math.min(
              max,
              (parseDesignNumber(draft) ?? value ?? 0) +
                  step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1),
            ),
          )
          edited.current = false
          const accepted = onCommit(next)
          setInvalid(false)
          setDraft(format(accepted === false ? value : next))
        }
      }}
    />
  )
  if (caption)
    return (
      <label className={css.captionedField}>
        <span className={css.fieldCaption} {...scrubProps}>{label}</span>
        <span className={css.field}>
          {typeof short === 'string' ? null : <span {...scrubProps}>{short}</span>}
          {input}
        </span>
      </label>
    )
  return (
    <label className={css.field}>
      <span {...scrubProps}>{short}</span>
      {input}
    </label>
  )
}
