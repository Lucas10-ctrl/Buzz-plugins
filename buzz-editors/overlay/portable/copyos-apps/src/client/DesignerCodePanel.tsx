/** Selected-layer CSS is a read-only projection with explicit target-page prerequisites. */
import type { ReactNode } from 'react'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import type { designNodeCss } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerCodePanel.module.css'
type Projection = ReturnType<typeof designNodeCss>
const cssModeAttribute = 'data-copyos-mode'
const modeContextLabelKey = 'designerCssModeContext'
/** One contextual selection and its native CSS projection. */
export interface DesignerCodeResult {
  label: string
  projection: Projection
}
const warningLabelKeys = {
  'preserved-layout': 'designerCssPreservedLayout',
  'negative-gap': 'designerCssNegativeGap',
  'wrap-fill': 'designerCssWrapFill',
  'legacy-auto-spacing': 'designerCssLegacyAutoSpacing',
  'grid-placement': 'designerCssGridPlacement',
  'text-layout': 'designerCssTextLayout',
  'paragraph-spacing': 'designerCssParagraphSpacing',
  'layer-compositing': 'designerCssLayerCompositing',
  'constraint-layout': 'designerCssConstraintLayout',
  'css-typed-arithmetic': 'designerCssTypedArithmetic',
  'css-container-units': 'designerCssContainerUnits',
  'instance-scale': 'designerCssInstanceScale',
  'box-model': 'designerCssBoxModel',
  'image-transform': 'designerCssImageTransform',
  'font-availability': 'designerCssFontAvailability',
  'mode-context': modeContextLabelKey,
  'svg-paint': 'designerCssSvgPaint',
  'svg-stroke': 'designerCssSvgStroke',
  'svg-geometry': 'designerCssSvgGeometry',
} as const satisfies Record<Projection['warnings'][number]['code'], CopyOSFoundationLocaleKey>
const requirementLabelKeys = {
  'token-css': 'designerCssTokenRequirement',
  'mode-scope': 'designerCssModeRequirement',
  'parent-layout': 'designerCssParentRequirement',
  'positioned-parent': 'designerCssPositionRequirement',
  'svg-renderer': 'designerCssSvgRequirement',
  'font-resource': 'designerCssFontRequirement',
  'text-link-markup': 'designerCssTextLinkRequirement',
} as const satisfies Record<Projection['requirements'][number]['code'], CopyOSFoundationLocaleKey>
/** Show the exact CSS used by Copy CSS, plus localized limitations and resource requirements.
 * @param props - Native projection results, resource names and the normal clipboard action.
 * @returns Read-only accessible CSS and context metadata; inspecting does not mutate the design.
 */
export function DesignerCodePanel({
  document,
  results,
  text,
  copy,
  copyTokens,
  t,
}: {
  document: CopyOSDesignDocument | null
  results: readonly DesignerCodeResult[]
  text: string
  copy: () => void
  copyTokens: () => void
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  return (
    <section className={css.panel} aria-label={t('designerNodeCss')}>
      <div className={css.heading}>
        <h3>{t('designerNodeCss')}</h3>
        <div className={css.actions}>
          <button
            type="button"
            disabled={!results.some(result => result.projection.tokenReferences.length)}
            onClick={copyTokens}
          >
            {t('designerCopyTokenCss')}
          </button>
          <button type="button" disabled={!text} onClick={copy}>
            {t('designerCopyCss')}
          </button>
        </div>
      </div>
      {!results.length ? (
        <p>{t('designerCssEmpty')}</p>
      ) : (
        <>
          <textarea readOnly aria-label={t('designerNodeCss')} value={text} spellCheck={false} />
          {results.map(({ label, projection }, index) => (
            <section className={css.context} key={`${projection.selector}:${index}`} aria-label={label}>
              <h4>{label}</h4>
              <p>
                {t('designerCssMode').replace(
                  '{name}',
                  document?.tokenModes?.find(mode => mode.id === projection.effectiveModeId)?.name ??
                    t('designerBaseMode'),
                )}
              </p>
              {projection.requirements.some(requirement => requirement.code === 'mode-scope') ? (
                <code>
                  {[cssModeAttribute, JSON.stringify(projection.effectiveModeId ?? 'base')].join('=')}
                </code>
              ) : null}
              {projection.tokenReferences.length ? (
                <details>
                  <summary>{t('designerCssTokens')}</summary>
                  <ul>
                    {projection.tokenReferences.map(token => (
                      <li key={`${token.kind}:${token.id}`}>
                        <span>{token.name}</span>
                        <code>{token.cssName}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {projection.requirements.length ? (
                <div>
                  <h4>{t('designerCssContext')}</h4>
                  <ul>
                    {projection.requirements.map((requirement, requirementIndex) => (
                      <li key={`${requirement.code}:${requirementIndex}`}>
                        {t(requirementLabelKeys[requirement.code])}
                        {requirement.property ? (
                          <>
                            {' '}
                            <code>{requirement.property}</code>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {projection.warnings.length ? (
                <div role="note">
                  <h4>{t('designerCssWarnings')}</h4>
                  <ul>
                    {projection.warnings.map((warning, warningIndex) => (
                      <li key={`${warning.code}:${warningIndex}`}>
                        {t(warningLabelKeys[warning.code])}
                        {warning.property ? (
                          <>
                            {' '}
                            <code>{warning.property}</code>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))}
        </>
      )}
    </section>
  )
}
