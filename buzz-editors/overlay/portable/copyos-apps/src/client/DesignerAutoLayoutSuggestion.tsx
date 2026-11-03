/** Review nested layout inference against one immutable document snapshot. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  previewDesignAutoLayoutSuggestion,
  DesignAutoLayoutEditError,
  type DesignAutoLayoutSuggestionResult,
  type DesignAutoLayoutSuggestionSkipReason,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerAutoLayoutSuggestion.module.css'

/** Preview only while open; applying must revalidate the exact original snapshot.
 * @param props - Committed selection context and transaction callbacks.
 * @returns A compact Suggest action or its review controls inside More layout options.
 */
export function DesignerAutoLayoutSuggestion({
  doc,
  ids,
  contextKey,
  open,
  canSuggest,
  t,
  onOpenChange,
  preview,
  cancelPreview,
  apply,
}: {
  doc: CopyOSDesignDocument
  ids: readonly string[]
  contextKey: string
  open: boolean
  canSuggest: boolean
  t: (key: CopyOSFoundationLocaleKey) => string
  onOpenChange: (open: boolean) => void
  preview: (result: DesignAutoLayoutSuggestionResult) => void
  cancelPreview: () => void
  apply: (
    before: CopyOSDesignDocument,
    ids: readonly string[],
    allocations: readonly string[],
    contextKey: string,
  ) => boolean
}): ReactNode {
  const reviewElement = useRef<HTMLElement>(null)
  const origin = useRef<CopyOSDesignDocument | null>(null)
  const session = useRef<{ document: CopyOSDesignDocument; key: string } | null>(null)
  const allocations = useRef<string[]>([])
  const [review, setReview] = useState<DesignAutoLayoutSuggestionResult | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (!open) {
      session.current = null
      return
    }
    if (session.current && (session.current.document !== doc || session.current.key !== contextKey)) {
      session.current = null
      onOpenChange(false)
      return
    }
    session.current = { document: doc, key: contextKey }
    const before = doc
    const allocated: string[] = []
    try {
      const result = previewDesignAutoLayoutSuggestion(before, ids, () => {
        const value = randomUUID()
        allocated.push(value)
        return value
      })
      origin.current = before
      allocations.current = allocated
      setReview(result)
      setInvalid(false)
      preview(result)
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      setReview(null)
      setInvalid(true)
    }
    return () => {
      if (origin.current) {
        origin.current = null
        cancelPreview()
      }
    }
  }, [open, doc, contextKey])
  useEffect(() => {
    if (review)
      reviewElement.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true })
  }, [review])
  if (!open)
    return (
      <button
        type="button"
        disabled={!canSuggest}
        onClick={() => {
          onOpenChange(true)
        }}
      >
        {t('designerSuggestAutoLayout')}
      </button>
    )
  return (
    <section ref={reviewElement} className={css.review} aria-label={t('designerSuggestAutoLayout')}>
      <p>{t('designerSuggestHint')}</p>
      {invalid ? <p role="alert">{t('designerAutoLayoutUnavailable')}</p> : null}
      {review ? (
        <>
          <dl>
            <div>
              <dt>{t('designerSuggestInspected')}</dt>
              <dd>{review.inspectedCount}</dd>
            </div>
            <div>
              <dt>{t('designerSuggestCreated')}</dt>
              <dd>{review.createdCount}</dd>
            </div>
            <div>
              <dt>{t('designerSuggestConverted')}</dt>
              <dd>{review.convertedCount}</dd>
            </div>
            <div>
              <dt>{t('designerSuggestSkipped')}</dt>
              <dd>{review.skippedCount}</dd>
            </div>
            <div>
              <dt>{t('designerSuggestGeometry')}</dt>
              <dd>{review.geometryChangedCount}</dd>
            </div>
          </dl>
          <p>{t('designerSuggestGeometryHint')}</p>
          <ul>
            {review.createdIds.slice(0, 12).map(id => (
              <li key={id}>{review.document.nodes.find(node => node.id === id)?.name}</li>
            ))}
          </ul>
          <ul>
            {review.geometryChanges.slice(0, 12).map(change => (
              <li key={change.id}>
                <strong>{doc.nodes.find(node => node.id === change.id)?.name}</strong>
                <span>
                  {box(change.before)}
                  {' → '}
                  {box(change.after)}
                </span>
              </li>
            ))}
          </ul>
          {review.geometryChanges.length > 12 ||
          review.createdIds.length > 12 ||
          review.skipped.length > 12 ? (
              <p>{t('designerLayoutMoreChanges')}</p>
            ) : null}
          {review.skipped.length ? (
            <details>
              <summary>{t('designerSuggestSkipped')}</summary>
              <ul>
                {review.skipped.slice(0, 12).map(item => (
                  <li key={`${item.id}:${item.reason}`}>
                    <strong>{doc.nodes.find(node => node.id === item.id)?.name}</strong>
                    <span>{t(skipLabelKey(item.reason))}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      <div className={css.actions}>
        <Button
          variant="primary"
          size="sm"
          className={css.apply}
          disabled={!review || !(review.createdCount || review.convertedCount)}
          onClick={() => {
            const before = origin.current
            if (!before || !apply(before, ids, allocations.current, contextKey)) {
              origin.current = null
              cancelPreview()
              setReview(null)
              setInvalid(true)
              return
            }
            origin.current = null
            onOpenChange(false)
          }}
        >
          {t('designerApplyLayoutVersion')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={css.cancel}
          onClick={() => {
            onOpenChange(false)
          }}
        >
          {t('designerCancelLayoutVersion')}
        </Button>
      </div>
    </section>
  )
}
function box(value: { x: number; y: number; width: number; height: number }): string {
  const round = (number: number): number => Math.round(number * 100) / 100
  return `${round(value.x)}, ${round(value.y)} · ${round(value.width)} × ${round(value.height)}`
}
function skipLabelKey(reason: DesignAutoLayoutSuggestionSkipReason): CopyOSFoundationLocaleKey {
  switch (reason) {
    case 'active-layout':
      return 'designerSuggestSkipActive'
    case 'instance':
      return 'designerSuggestSkipInstance'
    case 'component-set':
      return 'designerSuggestSkipSet'
    case 'empty':
      return 'designerSuggestSkipEmpty'
    case 'overlap':
      return 'designerSuggestSkipOverlap'
    case 'transform':
      return 'designerSuggestSkipTransform'
    case 'hidden':
      return 'designerSuggestSkipHidden'
    case 'absolute':
      return 'designerSuggestSkipAbsolute'
    default:
      return assertNever(reason)
  }
}
function assertNever(value: never): never {
  throw new Error(`Unexpected layout suggestion skip reason: ${String(value)}`)
}
