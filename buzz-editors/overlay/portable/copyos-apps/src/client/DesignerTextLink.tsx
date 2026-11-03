/** A draft link editor is inert until Apply or an explicit Follow action. */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import { designTextHyperlinkUrlAllowed } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignTextHyperlink } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerTextLink.module.css'
import workspaceCss from './PageDesignerWorkspace.module.css'

const stopLinkEvent = (event: { stopPropagation: () => void }): void => {
  event.stopPropagation()
}

/** Keep URL/layer drafts separate from the browser text transaction until accepted.
 * @param props - Captured range, inert owner and stored-layer destinations.
 * @returns A viewport-clamped link dialog; it never navigates from text glyphs.
 */
export function DesignerTextLink({
  current,
  wholeText,
  anchorRange,
  editor,
  owner,
  targets,
  t,
  apply,
  close,
  follow,
}: {
  current: CopyOSDesignTextHyperlink | null | 'mixed'
  wholeText: boolean
  anchorRange: Range | null
  editor: RefObject<HTMLDivElement | null>
  owner: string
  targets: readonly { id: string; name: string }[]
  t: (key: CopyOSFoundationLocaleKey) => string
  apply: (target: CopyOSDesignTextHyperlink | null) => boolean
  close: (restoreFocus: boolean) => void
  follow: (target: CopyOSDesignTextHyperlink) => boolean
}): ReactNode {
  const initial = current && current !== 'mixed' ? current : null
  const [type, setType] = useState<'URL' | 'NODE'>(initial?.type ?? 'URL')
  const [url, setUrl] = useState(initial?.type === 'URL' ? initial.value : '')
  const [nodeId, setNodeId] = useState(initial?.type === 'NODE' ? initial.value : '')
  const [search, setSearch] = useState('')
  const [invalid, setInvalid] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null)
  // A real DOM Range follows the selected text on scroll; the hidden anchor only positions this UI.
  useLayoutEffect(() => {
    const place = () => {
      const rect =
        typeof anchorRange?.getBoundingClientRect === 'function'
          ? anchorRange.getBoundingClientRect()
          : editor.current?.getBoundingClientRect()
      if (!rect || !anchor.current) return
      Object.assign(anchor.current.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRange, editor])
  const position = useAnchoredPosition({
    open: true,
    anchorRef: anchor,
    panelRef: panel,
    side: 'top',
    align: 'start',
    gap: 8,
    margin: 12,
  })
  const placed = position !== null
  useLayoutEffect(() => {
    if (placed) input.current?.focus({ preventScroll: true })
  }, [placed, type])
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
    }
  }, [])
  const target: CopyOSDesignTextHyperlink = { type, value: type === 'URL' ? url : nodeId }
  const valid = type === 'URL' ? designTextHyperlinkUrlAllowed(url) : targets.some(node => node.id === nodeId)
  const submit = () => {
    if (!valid || !apply(target)) {
      setInvalid(true)
      return
    }
  }
  const unchanged = !!initial && initial.type === type && initial.value === target.value
  const choices = targets.filter(node => node.name.toLowerCase().includes(search.toLowerCase())).slice(0, 100)
  const chosen = targets.find(node => node.id === nodeId)
  return createPortal(
    <>
      <span ref={anchor} className={css.anchor} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-label={t('designerTextLink')}
        className={`${workspaceCss.designerPopover} ${css.panel}`}
        data-designer-popover-owners={owner}
        onPointerDown={stopLinkEvent}
        onPointerUp={stopLinkEvent}
        onPointerMove={stopLinkEvent}
        onMouseDown={stopLinkEvent}
        onMouseUp={stopLinkEvent}
        onClick={stopLinkEvent}
        onDoubleClick={stopLinkEvent}
        onContextMenu={stopLinkEvent}
        onWheel={stopLinkEvent}
        style={position ?? { visibility: 'hidden' }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            close(true)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      >
        <header>
          {t('designerTextLink')}
          <span>{t(wholeText ? 'designerLinkWholeText' : 'designerLinkSelectedText')}</span>
        </header>
        {current === 'mixed' ? <p>{t('designerMixed')}</p> : null}
        <label>
          {t('designerLinkType')}
          <select
            aria-label={t('designerLinkType')}
            value={type}
            onChange={(event) => {
              setType(event.currentTarget.value === 'NODE' ? 'NODE' : 'URL')
              setInvalid(false)
            }}
          >
            <option value="URL">{t('designerLinkUrl')}</option>
            <option value="NODE">{t('designerLinkLayer')}</option>
          </select>
        </label>
        {type === 'URL' ? (
          <label>
            {t('designerLinkUrl')}
            <input
              ref={input}
              aria-label={t('designerLinkUrl')}
              aria-invalid={invalid || undefined}
              value={url}
              onChange={(event) => {
                setUrl(event.currentTarget.value)
                setInvalid(false)
              }}
            />
          </label>
        ) : (
          <>
            <input
              ref={input}
              aria-label={t('designerResourceSearch')}
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value)
              }}
            />
            <select
              aria-label={t('designerLinkLayer')}
              aria-invalid={invalid || undefined}
              value={nodeId}
              onChange={(event) => {
                setNodeId(event.currentTarget.value)
                setInvalid(false)
              }}
            >
              <option value="">{t('designerLinkChooseLayer')}</option>
              {chosen && !choices.some(node => node.id === chosen.id) ? (
                <option value={chosen.id}>{chosen.name}</option>
              ) : null}
              {choices.map(node => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </>
        )}
        <p>{t(type === 'URL' ? 'designerLinkUrlHint' : 'designerLinkLayerHint')}</p>
        {invalid ? <p role="alert">{t('designerLinkInvalid')}</p> : null}
        <div className={css.actions}>
          <Button variant="primary" size="sm" className={css.apply} onClick={submit}>
            {t('designerApplyLayoutVersion')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!current}
            onClick={() => {
              if (!apply(null)) setInvalid(true)
            }}
          >
            {t('designerLinkRemove')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              close(true)
            }}
          >
            {t('designerCancelLayoutVersion')}
          </Button>
        </div>
        {unchanged ? (
          initial.type === 'URL' ? (
            <a
              href={initial.value}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!follow(initial)) event.preventDefault()
              }}
            >
              {t('designerLinkFollow')}
            </a>
          ) : (
            <Button variant="outline" size="sm" onClick={() => follow(initial)}>
              {t('designerLinkFollow')}
            </Button>
          )
        ) : null}
      </div>
    </>,
    document.body,
  )
}
