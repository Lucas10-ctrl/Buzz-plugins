/** Contextual text and visibility overrides keep linked component sources unchanged. */
import { useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignInstanceOverride,
} from '../../../copyos-domain/src/types.ts'
import { DesignerFontVariations, editDesignerFontVariations } from './DesignerFontVariations.tsx'
import { DesignerFontFeatures, editDesignerFontFeatures } from './DesignerFontFeatures.tsx'
import { editDesignFontFeatures, editDesignFontVariations, designTextRangeContext } from '../../../copyos-domain/src/design-model.ts'
import { designInstanceOverrideLayers } from '../../../copyos-domain/src/design-model.ts'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerInstanceOverrides.module.css'

function TextValue({
  value,
  label,
  onCommit,
}: {
  value: string
  label: string
  onCommit: (value: string) => boolean | void
}): ReactNode {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      aria-label={label}
      value={draft}
      rows={2}
      maxLength={100000}
      onChange={(e) => {
        setDraft(e.currentTarget.value)
      }}
      onBlur={() => {
        if (draft !== value && onCommit(draft) === false) setDraft(value)
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') return
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(value)
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** Render searchable descendant properties and per-property reset actions for one instance.
 * @param props - Stored scene, selected instance, localized labels and normal history mutation.
 * @returns Editable values; records are committed on blur or toggle and retain component links.
 */
export function DesignerInstanceOverrides({
  doc,
  node,
  t,
  patch,
}: {
  doc: CopyOSDesignDocument
  node: CopyOSDesignNode
  t: (key: CopyOSFoundationLocaleKey) => string
  patch: (fields: Partial<CopyOSDesignNode>) => boolean | void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(200)
  const { layers } = designInstanceOverrideLayers(doc, node.id, 50000)
  const update = (
    path: string[],
    property: 'text' | 'visible',
    value: string | boolean | undefined,
  ): boolean | void => {
    const key = JSON.stringify(path)
    const entries = new Map(
      (node.instanceOverrides ?? []).map(o => [JSON.stringify(o.path), o]),
    )
    const current: CopyOSDesignInstanceOverride = { ...entries.get(key), path }
    if (property === 'text')
      current.text = typeof value === 'string' ? value : undefined
    else current.visible = typeof value === 'boolean' ? value : undefined
    if (!Object.entries(current).some(([key, value]) => key !== 'path' && value !== undefined)) entries.delete(key)
    else entries.set(key, current)
    return patch({ instanceOverrides: [...entries.values()] })
  }
  const matches = layers.filter(row =>
    row.names.join(' / ').toLowerCase().includes(query.toLowerCase()),
  )
  const matching = matches.slice(0, limit)
  return (
    <section
      className={css.section}
      aria-label={t('designerInstanceOverrides')}
    >
      <header>
        <h3>{t('designerInstanceOverrides')}</h3>
        <button
          type="button"
          disabled={
            !node.instanceOverrides?.some(
              o => o.text !== undefined || o.visible !== undefined,
            )
          }
          onClick={() => {
            patch({
              instanceOverrides: (node.instanceOverrides ?? []).flatMap(({ text: _text, visible: _visible, ...record }) =>
                Object.entries(record).some(([key, value]) => key !== 'path' && value !== undefined) ? [record] : []),
            })
          }}
        >
          {t('designerResetContentOverrides')}
        </button>
      </header>
      <input
        type="search"
        aria-label={t('designerFindInstanceLayer')}
        placeholder={t('designerFindInstanceLayer')}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          setLimit(200)
        }}
      />
      <div className={css.layers}>
        {matching.map(({ path, names, node: layer }) => {
          const key = JSON.stringify(path),
            name = names.join(' / ')
          const textContext = layer.kind === 'text' ? designTextRangeContext(doc, node.id, path) : null
          const override = node.instanceOverrides?.find(
            o => JSON.stringify(o.path) === key,
          )
          return (
            <div key={key} className={css.layer}>
              <div className={css.heading}>
                <span title={name}>{name}</span>
                <button
                  type="button"
                  aria-label={`${t('designerVisibility')}: ${name}`}
                  aria-pressed={layer.visible}
                  onClick={() => {
                    update(path, 'visible', !layer.visible)
                  }}
                >
                  <Icon name={layer.visible ? 'eye' : 'hidden'} />
                </button>
                {override?.visible !== undefined ? (
                  <button
                    type="button"
                    aria-label={`${t('designerResetVisibilityOverride')}: ${name}`}
                    onClick={() => {
                      update(path, 'visible', undefined)
                    }}
                  >
                    <Icon name="undo" />
                  </button>
                ) : null}
              </div>
              {layer.kind === 'text' ? (
                <div className={css.text}>
                  {textContext ? <DesignerFontFeatures values={[textContext.node.fontFeatures]}
                    selectionKey={`${doc.id}:${node.id}:${key}`} disabled={textContext.locked || node.locked} t={t}
                    onApply={(change) => {
                      const next = editDesignFontFeatures(doc, node.id, path,
                        editDesignerFontFeatures(textContext.node.fontFeatures, change) ?? null)
                      return patch({ instanceOverrides: next.nodes.find(item => item.id === node.id)?.instanceOverrides })
                    }} /> : null}
                  {textContext ? <DesignerFontVariations values={[textContext.node.fontVariations]} fonts={[textContext.node]}
                    selectionKey={`${doc.id}:${node.id}:${key}`} disabled={textContext.locked || node.locked} t={t}
                    onApply={(change) => {
                      const next = editDesignFontVariations(doc, node.id, path,
                        editDesignerFontVariations(textContext.node.fontVariations, change) ?? null)
                      return patch({ instanceOverrides: next.nodes.find(item => item.id === node.id)?.instanceOverrides })
                    }} /> : null}
                  <TextValue
                    key={`${key}:${layer.text}`}
                    value={layer.text}
                    label={`${t('designerTextContent')}: ${name}`}
                    onCommit={(text) => {
                      return update(path, 'text', text)
                    }}
                  />
                  {override?.text !== undefined ? (
                    <button
                      type="button"
                      aria-label={`${t('designerResetTextOverride')}: ${name}`}
                      onClick={() => {
                        update(path, 'text', undefined)
                      }}
                    >
                      <Icon name="undo" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {!matching.length ? <p>{t('designerNoInstanceLayers')}</p> : null}
      </div>
      {matches.length > limit ? (
        <button
          type="button"
          onClick={() => {
            setLimit(v => v + 200)
          }}
        >
          {t('designerMoreInstanceLayers').replace(
            '{count}',
            String(Math.min(200, matches.length - limit)),
          )}
        </button>
      ) : null}
    </section>
  )
}
