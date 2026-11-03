/** Aspect ownership captures each selected layer's rendered proportions without editing linked sources. */
import { useMemo, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  designAspectRatioContext,
  setDesignAspectRatio,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerAspectRatio.module.css'
/** Render a compact mixed-state ratio lock and a precise linked inheritance reset.
 * @param props - Stored root identities, immutable document and one accepted history transaction.
 * @returns Keyboard accessible ratio ownership controls; ineligible or locked selections remain read-only.
 */
export function DesignerAspectRatio({
  doc,
  items,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (next: CopyOSDesignDocument) => boolean | void
}): ReactNode {
  const scene = useMemo(() => createDesignRenderScene(doc), [doc])
  const contexts = items.map(item => designAspectRatioContext(doc, item.id, scene)).filter(row => !!row)
  const all = contexts.length > 0 && contexts.every(row => !!row.effectiveRatio)
  const some = contexts.some(row => !!row.effectiveRatio)
  const disabled =
    contexts.length !== items.length ||
    !contexts.length ||
    contexts.some(row => row.locked) ||
    items.some(item => item.locked)
  const linked = contexts.filter(row => row.stored.kind === 'instance')
  const action = all ? 'designerUnlockAspectRatio' : 'designerLockAspectRatio'
  const ratios = contexts.map(row =>
    row.effectiveRatio
      ? `${Number((row.effectiveRatio.x / row.effectiveRatio.y).toFixed(4))}:1`
      : t('designerNone'),
  )
  const ratio = ratios.every(value => value === ratios[0]) ? ratios[0] : t('designerMixed')
  const ownership = linked.length
    ? linked.every(row => !row.owned)
      ? t('designerInheritedSizing')
      : linked.every(row => row.owned)
        ? t('designerLocalSizing')
        : t('designerMixed')
    : ''
  const status = contexts.some(row => row.limited)
    ? t('designerAspectRatioLimited')
    : contexts.some(row => !row.eligible)
      ? t('designerAspectRatioAutoText')
      : `${t('designerAspectRatio')}: ${ratio}${ownership ? ` · ${ownership}` : ''}`
  return (
    <div className={css.root}>
      <Tooltip label={`${t(action)} · ${status}`}>
        <span>
          <button
            type="button"
            aria-label={t(action)}
            aria-pressed={all ? true : some ? 'mixed' : false}
            disabled={disabled || (!all && contexts.some(row => !row.eligible))}
            onClick={() =>
              commit(
                setDesignAspectRatio(
                  doc,
                  items.map(item => item.id),
                  all ? 'unlock' : 'lock',
                ),
              )
            }
          >
            <DesignerIcon name="lock" />
          </button>
        </span>
      </Tooltip>
      {linked.some(row => row.owned) ? (
        <Tooltip label={t('designerInheritAspectRatio')}>
          <span>
            <button
              type="button"
              aria-label={t('designerInheritAspectRatio')}
              disabled={disabled}
              onClick={() =>
                commit(
                  setDesignAspectRatio(
                    doc,
                    linked.map(row => row.stored.id),
                    'inherit',
                  ),
                )
              }
            >
              <DesignerIcon name="undo" />
            </button>
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}
/** Show effective contextual ratios without suggesting unsupported instance-child ownership edits.
 * @param props - Resolved contextual nodes and localized labels.
 * @returns A read-only ratio row.
 */
export function DesignerReadOnlyAspectRatio({
  items,
  t,
}: {
  items: readonly CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const values = items.map(item =>
    item.targetAspectRatio
      ? `${Number((item.targetAspectRatio.x / item.targetAspectRatio.y).toFixed(4))}:1`
      : t('designerNone'),
  )
  return (
    <Tooltip label={t('designerAspectRatioReadOnly')}>
      <div className={css.readOnly}>
        <span>{t('designerAspectRatio')}</span>
        <span>{values.every(value => value === values[0]) ? values[0] : t('designerMixed')}</span>
      </div>
    </Tooltip>
  )
}
