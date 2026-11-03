/** Shared review controls for document and comment-thread suggestions. */
import { useState, type ReactNode } from 'react'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import { DocsReadView } from './DocsReadView.tsx'
import type { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocSuggestion } from '../../../copyos-domain/src/types.ts'
import css from './DocsWorkspace.module.css'
type Locale = PropsLocale<'copyosFoundation'>

/** Review one proposed replacement, preserving failures beside the proposal. */
export function SuggestionCard({
  suggestion,
  resolveAsset,
  labels,
  t,
  disabled,
  review,
}: {
  suggestion: CopyOSDocSuggestion
  resolveAsset?: DocsAssetResolver | undefined
  labels: Parameters<typeof MarkdownText>[0]['labels']
  t: Locale['t']
  disabled: boolean
  review: (decision: 'accept' | 'reject', replacement?: string) => Promise<void>
}): ReactNode {
  const [editing, setEditing] = useState(false),
    [replacement, setReplacement] = useState(suggestion.after)
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState('')
  // A passage replacement can contain only a closing fence; parsing it as a new code block hides the proposed prose.
  const fragment = (text: string): ReactNode => {
    const fences = Array.from(text.matchAll(/^[\t ]*(?:`{3,}|~{3,})[^\n]*$/gmu))
    return fences.length % 2 === 1 ? <pre className={css.suggestionSource}>{text}</pre>
      : <DocsReadView text={text} labels={labels} t={t} resolveAsset={resolveAsset} />
  }
  const submit = (decision: 'accept' | 'reject'): void => {
    setSubmitting(true)
    setError('')
    void review(decision, decision === 'accept' && editing ? replacement : undefined)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setSubmitting(false) })
  }
  return (
    <section className={css.suggestionCard} aria-label={t('docsAssistantSuggestion')}>
      {suggestion.note ? <p>{suggestion.note}</p> : null}
      {suggestion.before ? <div className={css.suggestionBefore}>
        {fragment(suggestion.before)}
      </div> : null}
      {editing ? (
        <textarea
          aria-label={t('docsEditSuggestion')}
          value={replacement}
          onChange={(event) => {
            setReplacement(event.target.value)
          }}
          rows={4}
        />
      ) : (
        <div className={css.suggestionAfter}>{fragment(suggestion.after || t('docsDeletePassage'))}</div>
      )}
      {error ? <p className={css.sectionError} role="alert">{error}</p> : null}
      <div className={css.suggestionActions}>
        <button
          className={css.acceptSuggestion}
          disabled={disabled || submitting}
          onClick={() => {
            submit('accept')
          }}
        >
          {t('docsAccept')}
        </button>
        <button
          disabled={disabled || submitting}
          onClick={() => {
            submit('reject')
          }}
        >
          {t('docsReject')}
        </button>
        <button
          disabled={disabled || submitting}
          onClick={() => {
            setEditing(!editing)
          }}
        >
          {t(editing ? 'docsCancel' : 'docsEditSuggestion')}
        </button>
      </div>
    </section>
  )
}
