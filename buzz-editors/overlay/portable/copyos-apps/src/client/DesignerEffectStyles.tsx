/** Local effect resources share one searchable library and the existing stack editor. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CopyOSDesignDocument, CopyOSDesignEffect } from '../../../copyos-domain/src/types.ts'
import {
  updateDesignEffectStyle,
  removeDesignEffectStyle,
  applyDesignEffectStyleBatch,
  detachDesignEffectStyleBatch,
  editDesignEffectStyleResources,
  DesignEffectsEditError,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerTextField } from './DesignerTextField.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerEffectStyles.module.css'
type Target = { nodeId: string; path?: readonly string[] }
/** Keep description drafts owned by one resource, including intentional clearing. */
function DescriptionDraft({
  value,
  label,
  onCommit,
}: {
  value: string
  label: string
  onCommit: (value: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value)
  const cancelled = useRef(false),
    focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      aria-label={label}
      value={draft}
      maxLength={2000}
      onFocus={() => {
        focused.current = true
        cancelled.current = false
      }}
      onChange={(event) => {
        setDraft(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          cancelled.current = true
          setDraft(value)
          event.currentTarget.blur()
        } else if (event.key === 'Enter') event.currentTarget.blur()
      }}
      onBlur={() => {
        focused.current = false
        if (!cancelled.current && draft !== value) onCommit(draft)
      }}
    />
  )
}

/** Browse, create and manage local resources without changing a linked owner's source.
 * @param props - Current immutable document, admitted targets and shared editor content.
 * @returns Searchable local style list with explicit resource lifecycle controls.
 */
export function DesignerEffectStyles({
  doc,
  targets,
  effects,
  currentStyleId,
  hasStyle,
  hasSelection,
  t,
  commit,
  preview,
  cancelPreview,
  editingId,
  onEdit,
  children,
}: {
  doc: CopyOSDesignDocument
  targets: readonly Target[]
  effects: readonly CopyOSDesignEffect[]
  currentStyleId: string | null | undefined
  hasStyle: boolean
  hasSelection: boolean
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean | void
  preview: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  editingId: string | null
  onEdit: (id: string | null) => void
  children?: ReactNode
}): ReactNode {
  const [query, setQuery] = useState(''),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [failure, setFailure] = useState(false)
  const origin = useRef<CopyOSDesignDocument | null>(null)
  const ownerKey = `${doc.id}:${JSON.stringify(targets)}`
  useEffect(
    () => () => {
      if (origin.current) {
        origin.current = null
        cancelPreview()
      }
    },
    [ownerKey],
  )
  const cancel = () => {
    if (origin.current) {
      origin.current = null
      cancelPreview()
    }
  }
  const run = (change: (before: CopyOSDesignDocument) => CopyOSDesignDocument): boolean => {
    try {
      const before =
        origin.current?.id === doc.id && origin.current.revision === doc.revision ? origin.current : doc
      const next = change(before)
      origin.current = null
      if (commit(next) === false) {
        cancelPreview()
        setFailure(true)
        return false
      }
      setFailure(false)
      return true
    } catch (error) {
      if (!(error instanceof DesignEffectsEditError)) throw error
      cancel()
      setFailure(true)
      return false
    }
  }
  const hover = (id: string) => {
    if (!targets.length) return
    try {
      if (origin.current && (origin.current.id !== doc.id || origin.current.revision !== doc.revision))
        origin.current = null
      origin.current ??= doc
      preview(applyDesignEffectStyleBatch(origin.current, targets, id))
    } catch (error) {
      if (!(error instanceof DesignEffectsEditError)) throw error
      cancel()
      setFailure(true)
    }
  }
  const editing = doc.effectStyles?.find(style => style.id === editingId)
  const styles = (doc.effectStyles ?? [])
    .filter(style => style.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className={css.panel}>
      <input
        className={css.search}
        aria-label={t('designerResourceSearch')}
        placeholder={t('designerResourceSearch')}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
        }}
      />
      {failure ? <p role="alert">{t('designerEffectsInvalid')}</p> : null}
      <div className={css.list} aria-label={t('designerLocalEffectStyles')}>
        {styles.map((style, index) => {
          const slash = style.name.lastIndexOf('/'),
            group = slash < 0 ? '' : style.name.slice(0, slash),
            previous = styles[index - 1]?.name
          const previousGroup = previous?.includes('/') ? previous.slice(0, previous.lastIndexOf('/')) : ''
          return (
            <div key={style.id}>
              {group && group !== previousGroup ? <small className={css.group}>{group}</small> : null}
              <Tooltip label={style.description ?? style.name}>
                <div className={css.styleRow}>
                  <button
                    type="button"
                    aria-label={`${t('designerApplyEffectStyle')}: ${style.name}`}
                    aria-pressed={currentStyleId === style.id}
                    disabled={!targets.length}
                    onMouseEnter={() => {
                      hover(style.id)
                    }}
                    onMouseLeave={cancel}
                    onFocus={() => {
                      hover(style.id)
                    }}
                    onClick={() => {
                      run(before => applyDesignEffectStyleBatch(before, targets, style.id))
                    }}
                  >
                    <DesignerIcon name="styles" />
                    <span>{slash < 0 ? style.name : style.name.slice(slash + 1)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('designerEditEffectStyle')}: ${style.name}`}
                    onClick={() => {
                      cancel()
                      onEdit(style.id)
                    }}
                  >
                    <DesignerIcon name="settings" />
                  </button>
                </div>
              </Tooltip>
            </div>
          )
        })}
        {!styles.length ? <p>{t('designerNoResources')}</p> : null}
      </div>
      {hasStyle && targets.length ? (
        <button
          type="button"
          onClick={() => {
            run(before => detachDesignEffectStyleBatch(before, targets))
          }}
        >
          {t('designerDetachStyle')}
        </button>
      ) : null}
      <div className={css.create}>
        <input
          aria-label={t('designerStyleName')}
          placeholder={t('designerStyleName')}
          value={name}
          maxLength={200}
          onChange={(event) => {
            setName(event.currentTarget.value)
          }}
        />
        <input
          aria-label={t('designerStyleDescription')}
          placeholder={t('designerStyleDescription')}
          value={description}
          maxLength={2000}
          onChange={(event) => {
            setDescription(event.currentTarget.value)
          }}
        />
        <button
          type="button"
          disabled={!name.trim() || (doc.effectStyles?.length ?? 0) >= 1000}
          onClick={() => {
            const id = randomUUID()
            if (
              run((before) => {
                return editDesignEffectStyleResources(before, {
                  upsertStyles: [
                    {
                      id,
                      name: name.trim(),
                      ...(description ? { description } : {}),
                      effects: hasSelection
                        ? [...effects]
                        : [
                          {
                            id: randomUUID(),
                            type: 'drop-shadow',
                            visible: true,
                            x: 0,
                            y: 4,
                            blur: 8,
                            spread: 0,
                            color: '#000000',
                            opacity: 0.25,
                          },
                        ],
                    },
                  ],
                  changes: targets.map(target => ({ ...target, effectStyleId: id })),
                })
              })
            ) {
              setName('')
              setDescription('')
              onEdit(id)
            }
          }}
        >
          {t('designerCreateEffectStyle')}
        </button>
      </div>
      {editing ? (
        <section className={css.editor} aria-label={t('designerEditEffectStyle')}>
          <h4>{t('designerEditEffectStyle')}</h4>
          <DesignerTextField
            key={`${editing.id}:name`}
            label={t('designerRenameStyle')}
            value={editing.name}
            suggestions={[]}
            onCommit={value => run(before => updateDesignEffectStyle(before, editing.id, { name: value }))}
          />
          <DescriptionDraft
            key={`${doc.id}:${editing.id}:description`}
            label={t('designerStyleDescription')}
            value={editing.description ?? ''}
            onCommit={(value) => {
              run(before => updateDesignEffectStyle(before, editing.id, { description: value }))
            }}
          />
          {children}
          <button
            type="button"
            onClick={() => {
              if (run(before => removeDesignEffectStyle(before, editing.id))) onEdit(null)
            }}
          >
            {t('designerDeleteEffectStyle')}
          </button>
        </section>
      ) : null}
    </div>
  )
}
