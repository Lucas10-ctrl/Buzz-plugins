/** Combined CSS padding drafts wrap the existing individual controls without changing their resource ownership. */
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  designAutoLayoutPaddingContext,
  parseDesignPadding,
  type DesignPaddingTarget,
  type DesignPaddingValues,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { DesignerIcon } from './DesignerIcon.tsx'
import css from './DesignerPadding.module.css'

function format(values: DesignPaddingValues): string {
  const [top, right, bottom, left] = values
  if (top === right && top === bottom && top === left) return String(top)
  if (top === bottom && right === left) return `${top}, ${right}`
  if (right === left) return `${top}, ${right}, ${bottom}`
  return values.join(', ')
}

/** Render a mode-only combined editor and retain the caller's original individual/token controls.
 * @param props - Stored root/contextual targets, localized copy and atomic admission callback. True means accepted,
 * including native identity no-ops; false retains the rejected draft while the Workspace reports the error.
 * @returns Compact padding mode controls; modifier-click numeric fields enters combined editing.
 */
export function DesignerPadding({
  document,
  targets,
  t,
  onApply,
  children,
  disabled = false,
}: {
  document: CopyOSDesignDocument
  targets: readonly DesignPaddingTarget[]
  t: (key: CopyOSFoundationLocaleKey) => string
  onApply: (targets: readonly DesignPaddingTarget[], values: DesignPaddingValues) => boolean
  children: ReactNode
  disabled?: boolean
}): ReactNode {
  const targetKey = JSON.stringify(targets)
  const context = useMemo(() => designAutoLayoutPaddingContext(document, targets), [document, targetKey])
  const first = context.owners[0]?.values
  const common =
    first && context.owners.every(owner => owner.values.every((value, index) => value === first[index]))
      ? format(first)
      : ''
  const ownerKey = `${document.id}:${targetKey}:${context.owners.map(owner => owner.effectiveModeId ?? '').join(',')}`
  const [combined, setCombined] = useState(false)
  const [draft, setDraft] = useState(common)
  const [invalid, setInvalid] = useState(false)
  const [rejected, setRejected] = useState(false)
  const edited = useRef(false)
  const owner = useRef(ownerKey)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const originLabel = useRef<string | null>(null)
  const returnFocus = useRef(false)
  const errorId = useId()
  const locked = disabled || !context.canEdit
  useLayoutEffect(() => {
    if (owner.current === ownerKey) {
      if (!edited.current) {
        setDraft(common)
        setInvalid(false)
        setRejected(false)
      }
      return
    }
    owner.current = ownerKey
    edited.current = false
    returnFocus.current = false
    setInvalid(false)
    setRejected(false)
    setDraft(common)
    setCombined(false)
  }, [ownerKey, common])
  useLayoutEffect(() => {
    if (combined) {
      input.current?.focus()
      input.current?.select()
    } else if (returnFocus.current) {
      returnFocus.current = false
      const previous = Array.from(
        root.current?.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]') ?? [],
      ).find(field => field.getAttribute('aria-label') === originLabel.current)
      const target = previous ?? toggle.current
      target?.focus()
    }
  }, [combined])
  const open = (label: string | null): void => {
    if (locked) return
    originLabel.current = label
    edited.current = false
    setDraft(common)
    setInvalid(false)
    setRejected(false)
    setCombined(true)
  }
  const cancel = (): void => {
    edited.current = false
    setDraft(common)
    setInvalid(false)
    setRejected(false)
    returnFocus.current = true
    setCombined(false)
  }
  const apply = (): boolean => {
    if (!edited.current) return true
    const values = parseDesignPadding(draft)
    if (!values || locked) {
      setRejected(false)
      setInvalid(true)
      return false
    }
    // Native admission may synchronously rerender or move focus; prevent blur from submitting twice.
    edited.current = false
    if (!onApply(targets, values)) {
      edited.current = true
      setRejected(true)
      setInvalid(true)
      return false
    }
    setDraft(format(values))
    setInvalid(false)
    setRejected(false)
    return true
  }
  const modifier = (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>): void => {
    if (
      combined ||
      locked ||
      event.button !== 0 ||
      !(event.ctrlKey || event.metaKey) ||
      !(event.target instanceof Element)
    )
      return
    const field = event.target.closest('label')?.querySelector<HTMLInputElement>('input[role="spinbutton"]')
    if (!field || field.disabled) return
    event.preventDefault()
    event.stopPropagation()
    open(field.getAttribute('aria-label'))
  }
  return (
    <div ref={root} className={css.root} onPointerDownCapture={modifier} onClickCapture={modifier}>
      <div className={css.heading}>
        <span>{t('designerPadding')}</span>
        <Tooltip label={t(combined ? 'designerIndividualPadding' : 'designerCombinedPadding')}>
          <button
            ref={toggle}
            type="button"
            disabled={locked}
            aria-label={t(combined ? 'designerIndividualPadding' : 'designerCombinedPadding')}
            aria-pressed={combined}
            onPointerDown={(event) => {
              if (combined) event.preventDefault()
            }}
            onClick={() => {
              if (combined) cancel()
              else open(null)
            }}
          >
            <DesignerIcon name={combined ? 'layout-grid' : 'padding-top'} />
          </button>
        </Tooltip>
      </div>
      {combined ? (
        <>
          <label className={css.entry}>
            <Tooltip label={t('designerPaddingShorthandHint')}>
              <span>
                <DesignerIcon name="padding-top" />
              </span>
            </Tooltip>
            <input
              ref={input}
              type="text"
              inputMode="text"
              maxLength={256}
              aria-label={t('designerPadding')}
              aria-description={t('designerPaddingShorthandHint')}
              aria-invalid={invalid || undefined}
              aria-errormessage={invalid ? errorId : undefined}
              disabled={locked}
              value={draft}
              placeholder={!common ? t('designerMixed') : undefined}
              onChange={(event) => {
                edited.current = true
                setRejected(false)
                setDraft(event.currentTarget.value)
                setInvalid(parseDesignPadding(event.currentTarget.value) === null)
              }}
              onBlur={() => {
                apply()
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') return
                event.stopPropagation()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancel()
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  if (apply()) input.current?.blur()
                }
              }}
            />
          </label>
          {invalid ? (
            <p id={errorId} className={css.error}>
              {t(rejected ? 'designerAutoLayoutUnavailable' : 'designerPaddingInvalid')}
            </p>
          ) : null}
        </>
      ) : (
        children
      )}
    </div>
  )
}
