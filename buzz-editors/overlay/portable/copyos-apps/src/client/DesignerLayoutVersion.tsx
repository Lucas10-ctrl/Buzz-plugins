/** Review stored layout geometry before changing the layout sizing version. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  designLayoutVersionContext,
  previewDesignLayoutVersion,
  DesignAutoLayoutEditError,
  type DesignLayoutVersionScope,
  type DesignLayoutVersionModel,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import css from './DesignerLayoutVersion.module.css'

/** Keep review candidates outside history until the original owner accepts Apply.
 * @param props - Committed document, review scope and immutable preview/commit callbacks.
 * @returns A compact layout-version review popover.
 */
export function DesignerLayoutVersion({
  doc,
  scope,
  contextKey,
  t,
  preview,
  cancelPreview,
  apply,
  compact = false,
}: {
  doc: CopyOSDesignDocument
  scope: DesignLayoutVersionScope
  contextKey: string
  t: (key: CopyOSFoundationLocaleKey) => string
  preview: (document: CopyOSDesignDocument) => void
  cancelPreview: () => void
  apply: (
    before: CopyOSDesignDocument,
    scope: DesignLayoutVersionScope,
    model: DesignLayoutVersionModel,
  ) => boolean
  compact?: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState<DesignLayoutVersionModel>('css')
  const [review, setReview] = useState<ReturnType<typeof previewDesignLayoutVersion> | null>(null)
  const [invalid, setInvalid] = useState(false)
  const origin = useRef<CopyOSDesignDocument | null>(null)
  // Scopes are rebuilt on every parent render; their JSON keeps the whole-document scan to document or scope changes.
  const scopeKey = JSON.stringify(scope)
  const context = useMemo(() => designLayoutVersionContext(doc, scope), [doc, scopeKey])
  const label = t(scope.type === 'page' ? 'designerReviewPageLayout' : 'designerReviewSelectionLayout')
  const cancel = (): void => {
    if (origin.current) {
      origin.current = null
      cancelPreview()
    }
    setReview(null)
    setInvalid(false)
  }
  useEffect(() => {
    cancel()
    setOpen(false)
    return () => {
      if (origin.current) {
        origin.current = null
        cancelPreview()
      }
    }
  }, [doc, contextKey])
  const start = (): void => {
    try {
      const before = origin.current ?? doc
      const candidate = previewDesignLayoutVersion(before, scope, model)
      origin.current = before
      setReview(candidate)
      setInvalid(false)
      preview(candidate.document)
    } catch (error) {
      if (!(error instanceof DesignAutoLayoutEditError)) throw error
      cancel()
      setInvalid(true)
    }
  }
  const panel = (
    <DesignerPopover
      label={label}
      closeLabel={t('designerDone')}
      open={open}
      onOpenChange={(value) => {
        if (!value) cancel()
        setOpen(value)
      }}
      onDismiss={cancel}
      trigger={compact ? <DesignerIcon name="settings" /> : label}
      panelClassName={css.panel}
    >
      <div className={css.content}>
        <label>
          {t('designerLayoutSizingModel')}
          <select
            aria-label={t('designerLayoutSizingModel')}
            value={model}
            onChange={(event) => {
              cancel()
              setModel(event.currentTarget.value === 'css' ? 'css' : 'legacy')
            }}
          >
            <option value="legacy">{t('designerLayoutLegacy')}</option>
            <option value="css">{t('designerLayoutUpdated')}</option>
          </select>
        </label>
        <p>{t('designerLayoutModelHint')}</p>
        <dl>
          <div>
            <dt>{t('designerLayoutEligible')}</dt>
            <dd>{context.ids.length}</dd>
          </div>
          <div>
            <dt>{t('designerLayoutLegacy')}</dt>
            <dd>{context.legacyCount}</dd>
          </div>
          <div>
            <dt>{t('designerLayoutUpdated')}</dt>
            <dd>{context.cssCount}</dd>
          </div>
        </dl>
        {!context.canApply || invalid ? <p role="alert">{t('designerAutoLayoutUnavailable')}</p> : null}
        {review ? (
          <section aria-label={t('designerLayoutReviewSummary')}>
            <dl>
              <div>
                <dt>{t('designerLayoutVersionChanges')}</dt>
                <dd>{review.changedCount}</dd>
              </div>
              <div>
                <dt>{t('designerLayoutGeometryChanges')}</dt>
                <dd>{review.geometryChangedCount}</dd>
              </div>
            </dl>
            <p>{t('designerLayoutStoredOnly')}</p>
            <p>{t('designerLayoutGeometryFormat')}</p>
            <ul>
              {review.geometryChanges.slice(0, 20).map(change => (
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
            {review.geometryChanges.length > 20 ? <p>{t('designerLayoutMoreChanges')}</p> : null}
          </section>
        ) : null}
        <div className={css.actions}>
          <button type="button" disabled={!context.canApply} onClick={start}>
            {t('designerPreview')}
          </button>
          <button
            type="button"
            disabled={!review || !review.changedCount}
            onClick={() => {
              const before = origin.current
              if (!before || !apply(before, scope, model)) {
                cancel()
                setInvalid(true)
                return
              }
              origin.current = null
              setReview(null)
              setOpen(false)
            }}
          >
            {t('designerApplyLayoutVersion')}
          </button>
          <button
            type="button"
            onClick={() => {
              cancel()
              setOpen(false)
            }}
          >
            {t('designerCancelLayoutVersion')}
          </button>
        </div>
      </div>
    </DesignerPopover>
  )
  return compact ? (
    <Tooltip label={label} portal disabled={open}>
      <span>{panel}</span>
    </Tooltip>
  ) : (
    panel
  )
}
function box(value: { x: number; y: number; width: number; height: number }): string {
  return `${round(value.x)}, ${round(value.y)} · ${round(value.width)} × ${round(value.height)}`
}
function round(value: number): number {
  return Math.round(value * 100) / 100
}
