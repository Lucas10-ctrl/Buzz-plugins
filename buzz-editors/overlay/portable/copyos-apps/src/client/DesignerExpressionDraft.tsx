/** Local formula drafts never enter canvas previews or saved documents before Apply. */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerExpressionDraft.module.css'

/** Evaluated local draft; rejected text never replaces an authored numeric source. */
export type DesignerExpressionEvaluation =
  | { valid: true; result: string; dependencies: readonly { id: string; name: string }[] }
  | { valid: false; error: string }

/** Edit a bounded formula with explicit apply/cancel and keyboard-accessible reference insertion.
 * @param props - Frozen source owner, parser-backed local evaluation and localized transaction callbacks.
 * @returns A compact inline draft; Enter applies and Escape cancels without changing the document.
 */
export function DesignerExpressionDraft({
  value,
  variables,
  evaluate,
  onApply,
  onCancel,
  t,
}: {
  value: string
  variables: readonly { id: string; name: string; reference: string }[]
  evaluate: (source: string) => DesignerExpressionEvaluation
  onApply: (source: string) => boolean
  onCancel: () => void
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const [draft, setDraft] = useState(value),
    [rejected, setRejected] = useState(false),
    [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null),
    caret = useRef<number | null>(null)
  const evaluation = useMemo(() => evaluate(draft), [draft, evaluate])
  const choices = variables.filter(variable =>
    variable.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  useLayoutEffect(() => {
    if (caret.current === null) return
    input.current?.focus()
    input.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [draft])
  const apply = (): void => {
    if (!evaluation.valid || !onApply(draft)) setRejected(true)
  }
  return (
    <div className={css.editor}>
      <input
        ref={input}
        autoFocus
        aria-label={t('designerExpressionInput')}
        maxLength={32768}
        value={draft}
        aria-invalid={!evaluation.valid || rejected}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          setRejected(false)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            apply()
          }
        }}
      />
      <p className={css.help}>{t('designerExpressionHint')}</p>
      <input
        type="search"
        aria-label={t('designerExpressionSearchVariables')}
        placeholder={t('designerExpressionSearchVariables')}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
        }}
      />
      <select
        aria-label={t('designerExpressionInsert')}
        value=""
        onChange={(event) => {
          const variable = variables.find(item => item.id === event.currentTarget.value)
          if (!variable) return
          const start = input.current?.selectionStart ?? draft.length,
            end = input.current?.selectionEnd ?? start
          caret.current = start + variable.reference.length
          setDraft(draft.slice(0, start) + variable.reference + draft.slice(end))
          setRejected(false)
        }}
      >
        <option value="" disabled>
          {t('designerExpressionInsert')}
        </option>
        {choices.slice(0, 100).map(variable => (
          <option key={variable.id} value={variable.id}>
            {variable.name}
          </option>
        ))}
      </select>
      {choices.length > 100 ? (
        <p className={css.help}>{t('designerExpressionMoreVariables').replace('{count}', '100')}</p>
      ) : null}
      <div aria-live="polite" className={css.status}>
        {evaluation.valid && !rejected ? (
          <>
            <output>{t('designerExpressionResult').replace('{value}', evaluation.result)}</output>
            {evaluation.dependencies.length ? (
              <div className={css.dependencies}>
                <span>{t('designerExpressionDependencies')}</span>
                {evaluation.dependencies.map(dependency => (
                  <span key={dependency.id}>{dependency.name}</span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p role="alert">{evaluation.valid ? t('designerExpressionInvalid') : evaluation.error}</p>
        )}
      </div>
      <div className={css.actions}>
        <button type="button" onClick={onCancel}>
          {t('designerExpressionCancel')}
        </button>
        <button type="button" disabled={!evaluation.valid} onClick={apply}>
          {t('designerExpressionApply')}
        </button>
      </div>
    </div>
  )
}
