/** Frame constraint controls edit independent axes for every selected layer. */
import type { ReactNode } from 'react'
import type {
  CopyOSDesignConstraints,
  CopyOSDesignDocument,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import { editDesignNodes } from '../../../copyos-domain/src/design-model.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
const defaults: CopyOSDesignConstraints = {
  horizontal: 'left',
  vertical: 'top',
}
/** Edit pins using dropdowns or the interactive diagram, with Shift for opposing edges.
 * @param props - Current document, computed selection and native commit callback.
 * @returns Position-panel constraint picker preserving current visible geometry.
 */
export function DesignerConstraints({
  doc,
  items,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  items: CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => void
}): ReactNode {
  const common = <K extends 'horizontal' | 'vertical'>(
    axis: K,
  ): CopyOSDesignConstraints[K] | 'mixed' => {
    const first = items[0]?.constraints?.[axis] ?? defaults[axis]
    return items.every(
      n => (n.constraints?.[axis] ?? defaults[axis]) === first,
    )
      ? first
      : 'mixed'
  }
  const horizontal = common('horizontal'),
    vertical = common('vertical')
  const set = (
    axis: 'horizontal' | 'vertical',
    value:
      | CopyOSDesignConstraints['horizontal']
      | CopyOSDesignConstraints['vertical'],
  ): void => {
    commit(
      editDesignNodes(
        doc,
        items.map(n => ({
          id: n.id,
          constraints: { ...(n.constraints ?? defaults), [axis]: value },
        })),
      ),
    )
  }
  const edge = (
    axis: 'horizontal' | 'vertical',
    leading: boolean,
  ): ReactNode => {
    const value = axis === 'horizontal' ? horizontal : vertical,
      start = axis === 'horizontal' ? 'left' : 'top',
      end = axis === 'horizontal' ? 'right' : 'bottom',
      both = axis === 'horizontal' ? 'left-right' : 'top-bottom',
      own = leading ? start : end,
      opposite = leading ? end : start,
      label = t(
        (
          {
            left: 'designerConstraintLeft',
            right: 'designerConstraintRight',
            top: 'designerConstraintTop',
            bottom: 'designerConstraintBottom',
          } as const
        )[own],
      )
    return (
      <button
        type="button"
        key={own}
        className={css.constraintPin}
        data-edge={own}
        aria-label={label}
        title={label}
        aria-pressed={value === own || value === both}
        onClick={(e) => {
          set(
            axis,
            e.shiftKey
              ? value === both
                ? opposite
                : value === opposite
                  ? both
                  : own
              : own,
          )
        }}
      >
        <span />
      </button>
    )
  }
  return (
    <DesignerPopover
      label={t('designerConstraints')}
      closeLabel={t('designerDone')}
      trigger={<DesignerIcon name="constraints" />}
    >
      <div className={css.constraintControls}>
        <div className={css.constraintDiagram}>
          <span className={css.constraintObject} />
          {edge('horizontal', true)}
          {edge('horizontal', false)}
          {edge('vertical', true)}
          {edge('vertical', false)}
          {(['horizontal', 'vertical'] as const).map(axis => (
            <button
              type="button"
              key={axis}
              className={css.constraintCenter}
              data-axis={axis}
              aria-label={t(
                axis === 'horizontal'
                  ? 'designerConstraintCenterX'
                  : 'designerConstraintCenterY',
              )}
              aria-pressed={common(axis) === 'center'}
              onClick={() => {
                set(axis, 'center')
              }}
            >
              <span />
            </button>
          ))}
        </div>
        <div className={css.constraintAxes}>
          <select
            aria-label={t('designerConstraintHorizontal')}
            value={horizontal}
            onChange={(e) => {
              set(
                'horizontal',
                e.currentTarget.value as CopyOSDesignConstraints['horizontal'],
              )
            }}
          >
            <option value="mixed" disabled>
              {t('designerMixed')}
            </option>
            {(['left', 'right', 'left-right', 'center', 'scale'] as const).map(
              (v, i) => (
                <option key={v} value={v}>
                  {t(
                    (
                      [
                        'designerConstraintLeft',
                        'designerConstraintRight',
                        'designerConstraintBothX',
                        'designerConstraintCenter',
                        'designerConstraintScale',
                      ] as const
                    )[i] ?? 'designerConstraintLeft',
                  )}
                </option>
              ),
            )}
          </select>
          <select
            aria-label={t('designerConstraintVertical')}
            value={vertical}
            onChange={(e) => {
              set(
                'vertical',
                e.currentTarget.value as CopyOSDesignConstraints['vertical'],
              )
            }}
          >
            <option value="mixed" disabled>
              {t('designerMixed')}
            </option>
            {(['top', 'bottom', 'top-bottom', 'center', 'scale'] as const).map(
              (v, i) => (
                <option key={v} value={v}>
                  {t(
                    (
                      [
                        'designerConstraintTop',
                        'designerConstraintBottom',
                        'designerConstraintBothY',
                        'designerConstraintCenter',
                        'designerConstraintScale',
                      ] as const
                    )[i] ?? 'designerConstraintLeft',
                  )}
                </option>
              ),
            )}
          </select>
        </div>
      </div>
      <p className={css.constraintHint}>{t('designerConstraintHint')}</p>
    </DesignerPopover>
  )
}
