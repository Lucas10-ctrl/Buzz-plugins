/** Compact local-component swapping keeps the selected instance identities intact. */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import { designInstanceSwapCandidates } from '../../../copyos-domain/src/design-model.ts'
import { DesignerPopover } from './DesignerPopover.tsx'
import { DesignerIcon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerInstanceSwap.module.css'

function componentLocations(
  doc: CopyOSDesignDocument,
  fallback: string,
): Map<string, { label: string; location: string; duplicate: boolean }> {
  const components = doc.nodes.filter(node => node.kind === 'component')
  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const locations = new Map<string, string>()
  for (const node of components) {
    const parents: string[] = [],
      seen = new Set([node.id])
    let parentId = node.parentId,
      pageId = node.pageId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      parents.unshift(parent.name)
      pageId ??= parent.pageId
      parentId = parent.parentId
    }
    const page = doc.pages?.find(
      value => value.id === (pageId ?? doc.pages?.[0]?.id),
    )
    locations.set(
      node.id,
      [page?.name, ...parents].filter(Boolean).join(' / ') || fallback,
    )
  }
  const names = new Map<string, number>(),
    places = new Map<string, number>(),
    fragments = new Map<string, number>()
  for (const node of components) {
    const place = JSON.stringify([node.name, locations.get(node.id)])
    const fragment = JSON.stringify([place, node.id.slice(-8)])
    names.set(node.name, (names.get(node.name) ?? 0) + 1)
    places.set(place, (places.get(place) ?? 0) + 1)
    fragments.set(fragment, (fragments.get(fragment) ?? 0) + 1)
  }
  return new Map(
    components.map((node) => {
      const location = locations.get(node.id) ?? fallback
      const place = JSON.stringify([node.name, locations.get(node.id)])
      const fragment = node.id.slice(-8)
      const uniqueFragment =
        fragments.get(JSON.stringify([place, fragment])) === 1
      const suffix =
        (places.get(place) ?? 0) > 1
          ? ` · ${uniqueFragment ? fragment : node.id}`
          : ''
      const displayLocation = location + suffix
      const duplicate = (names.get(node.name) ?? 0) > 1
      return [
        node.id,
        {
          duplicate,
          location: displayLocation,
          label: duplicate ? `${node.name} · ${displayLocation}` : node.name,
        },
      ]
    }),
  )
}

/** Select one safe local main component for one or more linked instances.
 * @param props - Selected instance nodes, document, localized labels and atomic parent actions.
 * @returns A searchable grouped picker; mutations remain in the parent's normal history commit.
 */
export function DesignerInstanceSwap({
  doc,
  items,
  t,
  onSwap,
  onGoToMain,
}: {
  doc: CopyOSDesignDocument
  items: readonly CopyOSDesignNode[]
  t: (key: CopyOSFoundationLocaleKey) => string
  onSwap: (componentId: string) => void
  onGoToMain?: ((componentId: string) => void) | undefined
}): ReactNode {
  const [query, setQuery] = useState('')
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const anchor = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  const stored = items.map(
    item => doc.nodes.find(node => node.id === item.id) ?? item,
  )
  const disabled =
    !items.length ||
    items.some(
      item =>
        item.kind !== 'instance' ||
        item.locked ||
        !doc.nodes.some(node => node.id === item.id),
    ) ||
    stored.some(item => item.kind !== 'instance' || item.locked)
  const selectionKey = stored
    .map(item => `${item.id}:${item.componentId ?? ''}`)
    .join(',')
  const open = openFor === selectionKey
  const currentIds = new Set(stored.map(item => item.componentId))
  const currentId = currentIds.size === 1 ? stored[0]?.componentId : undefined
  const current = doc.nodes.find(
    node => node.id === currentId && node.kind === 'component',
  )
  const locations = useMemo(
    () => componentLocations(doc, t('designerLocalComponents')),
    [doc, t],
  )
  const currentName =
    currentIds.size > 1
      ? t('designerMixed')
      : current
        ? (locations.get(current.id)?.label ?? current.name)
        : t('designerMissingComponent')
  const candidates = useMemo(() => {
    if (disabled || !open) return []
    const eligible = items.map((item) => {
      const source = doc.nodes.find(node => node.id === item.id)?.componentId
      return new Set([
        ...designInstanceSwapCandidates(doc, item.id).map(node => node.id),
        ...(source ? [source] : []),
      ])
    })
    return doc.nodes
      .filter(
        node =>
          node.kind === 'component' && eligible.every(ids => ids.has(node.id)),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          (locations.get(a.id)?.location ?? '').localeCompare(
            locations.get(b.id)?.location ?? '',
          ) ||
          a.id.localeCompare(b.id),
      )
  }, [doc, items, disabled, locations, open])
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const groups = new Map<string, { node: CopyOSDesignNode; label: string }[]>()
  for (const node of candidates) {
    if (
      !terms.every(term =>
        `${node.name} ${locations.get(node.id)?.location ?? ''}`
          .toLocaleLowerCase()
          .includes(term),
      )
    )
      continue
    const path = node.name
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)
    const group =
      path.length > 1
        ? path.slice(0, -1).join(' / ')
        : t('designerLocalComponents')
    const rows = groups.get(group) ?? []
    rows.push({ node, label: path.at(-1) ?? node.name })
    groups.set(group, rows)
  }
  useLayoutEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    anchor.current
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus({ preventScroll: true })
  }, [generation])
  const swap = (id: string): void => {
    if (
      disabled ||
      !candidates.some(node => node.id === id) ||
      stored.every(node => node.componentId === id)
    )
      return
    restoreFocus.current = true
    setOpenFor(null)
    setGeneration(value => value + 1)
    onSwap(id)
  }
  const trigger = (
    <>
      <DesignerIcon name="component" />
      <span title={currentName}>{currentName}</span>
      <DesignerIcon name="down" />
    </>
  )
  return (
    <div className={css.section} ref={anchor}>
      <span className={css.label}>{t('designerMainComponent')}</span>
      <div className={css.heading}>
        {disabled ? (
          <button
            type="button"
            className={css.trigger}
            aria-label={t('designerSwapComponent')}
            disabled
          >
            {trigger}
          </button>
        ) : (
          <DesignerPopover
            key={`${generation}:${selectionKey}`}
            label={t('designerSwapComponent')}
            closeLabel={t('designerDone')}
            trigger={trigger}
            triggerClassName={css.trigger}
            panelClassName={css.panel}
            onOpenChange={(value) => {
              setOpenFor(value ? selectionKey : null)
              if (value) setQuery('')
            }}
          >
            <div
              ref={content}
              className={css.content}
              onKeyDown={(event) => {
                const rows = Array.from(
                  content.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="option"]',
                  ) ?? [],
                )
                const index = rows.findIndex(
                  row => row === document.activeElement,
                )
                let next: number | undefined
                if (event.key === 'ArrowDown') next = (index + 1) % rows.length
                else if (event.key === 'ArrowUp')
                  next =
                    index < 0
                      ? rows.length - 1
                      : (index - 1 + rows.length) % rows.length
                else if (index >= 0 && event.key === 'Home') next = 0
                else if (index >= 0 && event.key === 'End')
                  next = rows.length - 1
                else if (
                  index >= 0 &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault()
                  rows[index]?.click()
                } else if (
                  index < 0 &&
                  event.key === 'Enter' &&
                  rows.length === 1
                ) {
                  event.preventDefault()
                  rows[0]?.click()
                }
                if (next === undefined || !rows.length) return
                event.preventDefault()
                rows[next]?.focus({ preventScroll: true })
                const row = rows[next]
                if (row && typeof row.scrollIntoView === 'function')
                  row.scrollIntoView({ block: 'nearest' })
              }}
            >
              <label className={css.search}>
                <DesignerIcon name="search" />
                <input
                  aria-label={t('designerSearchComponents')}
                  placeholder={t('designerSearchComponents')}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value)
                  }}
                />
              </label>
              <div
                className={css.list}
                role="listbox"
                aria-label={t('designerLocalComponents')}
              >
                {groups.size ? (
                  [...groups].map(([group, rows]) => (
                    <div key={group} role="group" aria-label={group}>
                      <h4>{group}</h4>
                      {rows.map(({ node, label }) => (
                        <button
                          key={node.id}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-label={
                            locations.get(node.id)?.label ?? node.name
                          }
                          aria-selected={currentId === node.id}
                          aria-disabled={stored.every(
                            item => item.componentId === node.id,
                          )}
                          title={
                            locations.get(node.id)?.duplicate
                              ? `${locations.get(node.id)?.label ?? node.name}\n${node.id}`
                              : currentId === node.id
                                ? t('designerCurrentComponent')
                                : node.name
                          }
                          className={css.option}
                          onClick={() => {
                            swap(node.id)
                          }}
                        >
                          <DesignerIcon name="component" />
                          <span className={css.optionText}>
                            <span>{label}</span>
                            {locations.get(node.id)?.duplicate ? (
                              <small>{locations.get(node.id)?.location}</small>
                            ) : null}
                          </span>
                          {currentId === node.id ? (
                            <span aria-hidden="true">✓</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ))
                ) : (
                  <p role="status" className={css.empty}>
                    {t('designerNoComponents')}
                  </p>
                )}
              </div>
            </div>
          </DesignerPopover>
        )}
        {onGoToMain && current ? (
          <button
            type="button"
            className={css.goMain}
            aria-label={t('designerGoMain')}
            title={t('designerGoMain')}
            onClick={() => {
              onGoToMain(current.id)
            }}
          >
            <DesignerIcon name="chevron" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Reuse the compact component chooser for named properties and preferred-value hints.
 * @param props - Current IDs, contextual safe candidates, localized labels and an atomic selection action.
 * @returns A searchable component picker with optional preferred suggestions.
 */
export function DesignerComponentPicker({
  doc,
  label,
  value,
  mixed = false,
  disabled = false,
  preferred = [],
  multiple = false,
  searchLabel,
  candidates,
  candidatePage,
  onChange,
  t,
}: {
  doc: CopyOSDesignDocument
  label: string
  value: readonly string[]
  mixed?: boolean
  disabled?: boolean
  preferred?: readonly string[]
  searchLabel?: string
  multiple?: boolean
  candidates?: (() => readonly CopyOSDesignNode[]) | undefined
  candidatePage?:
    | ((options: { query: string; cursor: number; limit: number }) => {
      candidates: readonly CopyOSDesignNode[]
      nextCursor: number | null
      unsearched: number
    })
    | undefined
  onChange: (id: string) => boolean | void
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [generation, setGeneration] = useState(0),
    [localLimit, setLocalLimit] = useState(20)
  const anchor = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    restore = useRef(false)
  const locations = useMemo(
    () => componentLocations(doc, t('designerLocalComponents')),
    [doc, t],
  )
  const available = useMemo(
    () => (open && !candidatePage ? (candidates?.() ?? []) : []),
    [open, candidates, candidatePage],
  )
  const [page, setPage] = useState<{
    source: typeof candidatePage
    query: string
    candidates: readonly CopyOSDesignNode[]
    nextCursor: number | null
    unsearched: number
  } | null>(null)
  useEffect(() => {
    if (!open || !candidatePage) {
      setPage(null)
      return
    }
    const result = candidatePage({ query, cursor: 0, limit: 20 })
    setPage({ ...result, source: candidatePage, query })
  }, [open, query, candidatePage])
  const currentPage =
    open && page && page.source === candidatePage && page.query === query
      ? page
      : null
  const more = (): void => {
    if (!candidatePage || !currentPage || currentPage.nextCursor === null)
      return
    const result = candidatePage({
      query,
      cursor: currentPage.nextCursor,
      limit: 20,
    })
    const ids = new Set(currentPage.candidates.map(node => node.id))
    setPage({
      ...result,
      source: candidatePage,
      query,
      candidates: [
        ...currentPage.candidates,
        ...result.candidates.filter(node => !ids.has(node.id)),
      ],
    })
  }
  const current = doc.nodes.find(node => node.id === value[0])
  const display = mixed
    ? t('designerMixed')
    : multiple
      ? value
        .map(
          id =>
            locations.get(id)?.label ??
              doc.nodes.find(node => node.id === id)?.name ??
              id,
        )
        .join(', ') || t('designerNone')
      : current
        ? (locations.get(current.id)?.label ?? current.name)
        : value[0]
          ? t('designerMissingComponent')
          : t('designerChooseComponent')
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const allMatching = (
    candidatePage ? (currentPage?.candidates ?? []) : available
  )
    .filter(node =>
      terms.every(term =>
        `${node.name} ${locations.get(node.id)?.location ?? ''}`
          .toLocaleLowerCase()
          .includes(term),
      ),
    )
    .slice()
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (locations.get(a.id)?.location ?? '').localeCompare(
          locations.get(b.id)?.location ?? '',
        ) ||
        a.id.localeCompare(b.id),
    )
  const matching = candidatePage
    ? allMatching
    : allMatching.slice(0, localLimit)
  const suggestions = matching.filter(node => preferred.includes(node.id)),
    others = matching.filter(node => !preferred.includes(node.id))
  useLayoutEffect(() => {
    if (!restore.current) return
    restore.current = false
    anchor.current
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus({ preventScroll: true })
  }, [generation])
  const select = (id: string): void => {
    if (
      disabled ||
      (multiple && value.length >= 100 && !value.includes(id)) ||
      ((multiple || mixed || value[0] !== id) && onChange(id) === false)
    )
      return
    if (!multiple) {
      restore.current = true
      setOpen(false)
      setGeneration(n => n + 1)
    }
  }
  const trigger = (
    <>
      <DesignerIcon name="component" />
      <span title={display}>{display}</span>
      <DesignerIcon name="down" />
    </>
  )
  return (
    <div ref={anchor} className={css.picker}>
      {disabled ? (
        <button
          type="button"
          disabled
          aria-label={label}
          className={css.trigger}
        >
          {trigger}
        </button>
      ) : (
        <DesignerPopover
          key={generation}
          label={label}
          closeLabel={t('designerDone')}
          trigger={trigger}
          triggerClassName={css.trigger}
          panelClassName={css.panel}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) {
              setQuery('')
              setLocalLimit(20)
            }
          }}
        >
          <div
            ref={content}
            className={css.content}
            onKeyDown={(event) => {
              const rows = [
                ...(content.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="option"]:not(:disabled)',
                ) ?? []),
              ]
              const index = rows.findIndex(
                row => row === document.activeElement,
              )
              let next: number | undefined
              if (event.key === 'ArrowDown') next = (index + 1) % rows.length
              else if (event.key === 'ArrowUp')
                next =
                  index < 0
                    ? rows.length - 1
                    : (index - 1 + rows.length) % rows.length
              else if (index >= 0 && event.key === 'Home') next = 0
              else if (index >= 0 && event.key === 'End') next = rows.length - 1
              else if (
                event.key === 'Enter' &&
                (index >= 0 ||
                  (event.target instanceof HTMLInputElement &&
                    rows.length === 1))
              ) {
                event.preventDefault()
                rows[index >= 0 ? index : 0]?.click()
              }
              if (next === undefined || !rows.length) return
              event.preventDefault()
              rows[next]?.focus({ preventScroll: true })
              const row = rows[next]
              if (row && typeof row.scrollIntoView === 'function')
                row.scrollIntoView({ block: 'nearest' })
            }}
          >
            <label className={css.search}>
              <DesignerIcon name="search" />
              <input
                aria-label={searchLabel ?? t('designerSearchComponents')}
                placeholder={searchLabel ?? t('designerSearchComponents')}
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                  setLocalLimit(20)
                }}
              />
            </label>
            <div
              role="listbox"
              aria-label={label}
              aria-multiselectable={multiple || undefined}
              className={css.list}
              aria-busy={!!candidatePage && !currentPage}
            >
              {[
                { label: t('designerPreferredComponents'), nodes: suggestions },
                { label: t('designerAllComponents'), nodes: others },
              ].map(group =>
                group.nodes.length ? (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <h4>{group.label}</h4>
                    {group.nodes.map(node => (
                      <button
                        type="button"
                        role="option"
                        key={node.id}
                        tabIndex={-1}
                        className={css.option}
                        aria-label={locations.get(node.id)?.label ?? node.name}
                        aria-selected={!mixed && value.includes(node.id)}
                        disabled={
                          multiple &&
                          value.length >= 100 &&
                          !value.includes(node.id)
                        }
                        onClick={() => {
                          select(node.id)
                        }}
                      >
                        <DesignerIcon name="component" />
                        <span className={css.optionText}>
                          <span>{node.name}</span>
                          <small>{locations.get(node.id)?.location}</small>
                        </span>
                        {!mixed && value.includes(node.id) ? (
                          <span aria-hidden="true">✓</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null,
              )}
              {!matching.length &&
              (!candidatePage || (currentPage && !currentPage.unsearched)) ? (
                  <p role="status" className={css.empty}>
                    {t('designerNoComponents')}
                  </p>
                ) : null}
            </div>
            {currentPage?.unsearched ||
            (!candidatePage && allMatching.length > localLimit) ? (
                <div className={css.pagination}>
                  {currentPage?.unsearched ? (
                    <p role="status">
                      {t('designerUnsearchedComponents').replace(
                        '{count}',
                        String(currentPage.unsearched),
                      )}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (candidatePage) more()
                      else setLocalLimit(n => n + 20)
                    }}
                  >
                    {t('designerLoadMoreComponents')}
                  </button>
                </div>
              ) : null}
          </div>
        </DesignerPopover>
      )}
    </div>
  )
}
