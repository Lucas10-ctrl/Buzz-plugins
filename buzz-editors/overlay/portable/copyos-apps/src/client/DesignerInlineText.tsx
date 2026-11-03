import { DesignerFontVariations, editDesignerFontVariations } from './DesignerFontVariations.tsx'
/** Browser-owned rich text keeps native selection, composition and undo until one document commit. */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { IconLinkOutlineRegular, Tooltip, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSDesignNode, CopyOSDesignTextHyperlink } from '../../../copyos-domain/src/types.ts'
import {
  designTextOverflow,
  designTextHyperlink,
  designTextHtmlContent,
  designTextSegments,
  designNodePaints,
  styleDesignTextRange,
  type DesignTextRunStylePatch,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerFontFeatures, editDesignerFontFeatures } from './DesignerFontFeatures.tsx'
import { DesignerTextLink } from './DesignerTextLink.tsx'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerFontPicker } from './DesignerFontPicker.tsx'
import { designerFontLabels } from './DesignerFontLabels.ts'
import { designerInlineTextWidth, designerInlineTextWidthMeasurement } from './DesignerTextWidth.ts'
import { runDesignerMeasure } from './DesignerMeasureBatch.ts'
import {
  designerInlineSelection,
  designerReadInlineText,
  designerRestoreInlineSelection,
  type DesignerInlineTextValue,
  type DesignerTextSelection,
} from './DesignerInlineTextDom.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import workspaceCss from './PageDesignerWorkspace.module.css'
import css from './DesignerInlineText.module.css'
const stopInlineEvent = (event: { stopPropagation: () => void }): (void) => {
  event.stopPropagation()
}

/** Element in the Properties panel that hosts the formatting panel while text is edited; null floats it beside the text. */
export const DesignerInlinePanelHost = createContext<HTMLElement | null>(null)

/** Render rich text and a compact selection-formatting toolbar while editing.
 * @param props - Effective text, immutable owner identity, geometry and one accepted/rejected document commit.
 * @returns Browser-owned editable content; only sparse native runs cross the persistence boundary.
 */
export function InlineDesignText({
  node,
  ownerKey,
  active,
  caret,
  label,
  style,
  onDirty,
  onFinish,
  onMeasure,
  intrinsicWidth,
  overflow,
  t,
  families = [],
  linkTargets = [],
  linkRequest = 0,
  linkContextKey = ownerKey,
  onFollowLink,
}: {
  node: CopyOSDesignNode
  ownerKey: string
  active: boolean
  caret: { x: number; y: number } | null
  label: string
  style: CSSProperties
  onDirty: () => void
  onFinish: (value: DesignerInlineTextValue, edited: boolean) => boolean
  onMeasure: (width: number, height: number) => void
  intrinsicWidth: boolean
  overflow: ReturnType<typeof designTextOverflow>
  t: (key: CopyOSFoundationLocaleKey) => string
  families?: readonly string[]
  linkTargets?: readonly { id: string; name: string }[]
  linkRequest?: number
  linkContextKey?: string
  onFollowLink?: (nodeId: string) => boolean
}): ReactNode {
  const element = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    owner = useId()
  const savedSelection = useRef<DesignerTextSelection | null>(null),
    accepted = useRef(false),
    composing = useRef(false)
  const seeded = useRef({ active: false, owner: '' })
  const modified = useRef(false)
  const latest = useRef({ node, onDirty, onFinish, active })
  latest.current = { node, onDirty, onFinish, active }
  const [selection, setSelection] = useState<DesignerTextSelection | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [formatError, setFormatError] = useState(false)
  const [linkSession, setLinkSession] = useState<{
    range: DesignerTextSelection
    before: DesignerTextSelection
    current: CopyOSDesignTextHyperlink | null | 'mixed'
    whole: boolean
    anchor: Range | null
  } | null>(null)
  const openedLinkRequest = useRef(0)
  const [draft, setDraft] = useState<DesignerInlineTextValue>({
    text: node.text,
    textRuns: node.textRuns ?? [],
  })
  const host = useContext(DesignerInlinePanelHost)
  const position = useAnchoredPosition({
    open: active && !host,
    anchorRef: element,
    panelRef: panel,
    align: 'end',
    gap: 8,
    margin: 12,
  })
  const runsKey = JSON.stringify(node.textRuns ?? [])
  const owns = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    (!!element.current?.contains(target) ||
      !!panel.current?.contains(target) ||
      !!target
        .closest('[data-designer-popover-owners]')
        ?.getAttribute('data-designer-popover-owners')
        ?.split(' ')
        .includes(owner))
  const readValue = (): DesignerInlineTextValue | (null) => {
    if (!element.current) return null
    try {
      const value = designerReadInlineText(element.current)
      setInvalid(false)
      return value
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/^(Text exceeds|Text runs require|Text ranges require)/.test(error.message)
      )
        throw error
      setInvalid(true)
      return null
    }
  }
  const refresh = (): (void) => {
    const target = element.current
    if (!target) return
    const value = readValue()
    if (!value) return
    const current = designerInlineSelection(target)
    if (current) {
      savedSelection.current = current
      setSelection(current)
    }
    setDraft(value)
  }
  const finish = (restoreFocus = false): boolean => {
    if (!latest.current.active || accepted.current || composing.current || !element.current) return false
    const value = readValue()
    if (!value) {
      element.current.focus({ preventScroll: true })
      return false
    }
    const workspace = element.current.closest<HTMLElement>('[tabindex="0"]')
    const result = latest.current.onFinish(value, modified.current)
    if (result) {
      accepted.current = true
      if (restoreFocus)
        requestAnimationFrame(() => {
          if (workspace?.isConnected) workspace.focus({ preventScroll: true })
        })
    } else element.current.focus({ preventScroll: true })
    return result
  }
  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    if (active && seeded.current.active && seeded.current.owner === ownerKey) return
    seeded.current = { active, owner: ownerKey }
    if (
      !node.textRuns?.length &&
      !node.paragraphSpacing &&
      (!node.textDecoration || node.textDecoration === 'none')
    )
      target.textContent = node.text
    else target.innerHTML = designTextHtmlContent(node)
    accepted.current = false
    modified.current = false
    setInvalid(false)
    setFormatError(false)
    setDraft({ text: node.text, textRuns: node.textRuns ?? [] })
    savedSelection.current = null
    setSelection(null)
    if (!active) return
    target.focus({ preventScroll: true })
    const caretDocument: Partial<Document> = document
    const point = caret && caretDocument.caretPositionFromPoint?.(caret.x, caret.y)
    const range = document.createRange()
    if (point && target.contains(point.offsetNode)) {
      range.setStart(point.offsetNode, point.offset)
      range.collapse(true)
    } else {
      range.selectNodeContents(target)
      range.collapse(false)
    }
    const selected = window.getSelection()
    selected?.removeAllRanges()
    selected?.addRange(range)
    refresh()
    // Measurements may replace node identity while the browser owns its current draft.
  }, [ownerKey, active, node.text, runsKey, caret, node.paragraphSpacing])
  useLayoutEffect(() => {
    const target = element.current
    if (!target || active) return
    const width = designerInlineTextWidthMeasurement(target, intrinsicWidth)
    let measured = 0, height = 0
    runDesignerMeasure({
      steps: [() => {}, width.snapshot, width.prepare, () => {
        measured = width.read()
        height = Math.ceil(target.scrollHeight)
      }, () => { onMeasure(measured, height) }],
      cleanup: width.cleanup,
    })
  }, [
    active,
    intrinsicWidth,
    node.text,
    runsKey,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.fontFeatureSettings,
    style.fontVariationSettings,
    style.lineHeight,
    style.width,
    style.whiteSpace,
    style.letterSpacing,
    style.fontStyle,
    style.textTransform,
    node.paragraphSpacing,
    overflow?.lines,
    overflow?.height,
  ])
  useEffect(() => {
    if (!active) return
    const selectionChanged = (): (void) => {
      if (!composing.current) refresh()
    }
    const pointer = (event: PointerEvent): (void) => {
      if (!owns(event.target) && !finish()) event.preventDefault()
    }
    const focus = (event: FocusEvent): (void) => {
      if (!owns(event.target)) finish()
    }
    document.addEventListener('selectionchange', selectionChanged)
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('focusin', focus)
    return () => {
      document.removeEventListener('selectionchange', selectionChanged)
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('focusin', focus)
    }
  }, [active, ownerKey])
  const changed = (): (void) => {
    modified.current = true
    latest.current.onDirty()
    refresh()
    const target = element.current
    if (target) onMeasure(designerInlineTextWidth(target, intrinsicWidth), Math.ceil(target.scrollHeight))
  }
  const command = (name: string, value?: string): boolean => {
    const target = element.current
    if (!target || !latest.current.active || composing.current || invalid) return false
    target.focus({ preventScroll: true })
    if (savedSelection.current) designerRestoreInlineSelection(target, savedSelection.current)
    // The native editing transaction retains browser undo and composition semantics.
    // oxlint-disable-next-line typescript/no-deprecated -- This native transaction preserves browser undo.
    const result = document.execCommand(name, false, value)
    if (result) changed()
    return result
  }
  const format = (
    patch: DesignTextRunStylePatch | null | ((node: CopyOSDesignNode, range: DesignerTextSelection) => CopyOSDesignNode),
    selected: DesignerTextSelection | null = savedSelection.current,
  ): boolean => {
    const target = element.current
    if (!target || !selected || selected.start === selected.end || composing.current) return false
    const value = readValue()
    if (!value) return false
    setFormatError(false)
    let next: CopyOSDesignNode
    try {
      next = typeof patch === 'function' ? patch({ ...latest.current.node, ...value }, selected) : styleDesignTextRange({ ...latest.current.node, ...value }, selected.start, selected.end, patch)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/^(Text exceeds|Text runs require|Text ranges require)/.test(error.message)
      )
        throw error
      setFormatError(true)
      return false
    }
    const html = designTextHtmlContent(next)
    target.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(target)
    const selectedDom = window.getSelection()
    selectedDom?.removeAllRanges()
    selectedDom?.addRange(range)
    // One safe-markup insertion forms one native undo transaction; no HTML is persisted.
    // oxlint-disable-next-line typescript/no-deprecated -- Safe insertion must join the native undo history.
    const result = document.execCommand('insertHTML', false, html)
    designerRestoreInlineSelection(target, selected)
    savedSelection.current = selected
    if (result) changed()
    return result
  }
  const openLink = (whole = false): (void) => {
    const target = element.current,
      value = readValue()
    if (!target || !value?.text.length || composing.current) return
    const before = designerInlineSelection(target) ?? savedSelection.current ?? { start: 0, end: 0 }
    let range = before
    if (whole || before.start === before.end) {
      const caret = before.start,
        runs = value.textRuns
      let index = whole
        ? -1
        : runs.findIndex(
          run =>
            run.style.hyperlink &&
              run.start <= caret &&
              (caret < run.end || (caret === value.text.length && run.end === caret)),
        )
      if (index >= 0) {
        const linked = runs[index]
        if (!linked) return
        let start = linked.start,
          end = linked.end
        const key = JSON.stringify(linked.style.hyperlink)
        while (
          index > 0 &&
          runs[index - 1]?.end === start &&
          JSON.stringify(runs[index - 1]?.style.hyperlink) === key
        ) {
          index--
          start = runs[index]?.start ?? start
        }
        index = runs.findIndex(run => run.end === end && JSON.stringify(run.style.hyperlink) === key)
        while (
          index >= 0 &&
          runs[index + 1]?.start === end &&
          JSON.stringify(runs[index + 1]?.style.hyperlink) === key
        ) {
          index++
          end = runs[index]?.end ?? end
        }
        range = { start, end }
      } else {
        range = { start: 0, end: value.text.length }
        whole = true
      }
    }
    designerRestoreInlineSelection(target, range)
    const selection = window.getSelection()
    setLinkSession({
      range,
      before,
      whole,
      current: designTextHyperlink({ ...node, ...value }, range.start, range.end),
      anchor: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null,
    })
  }
  const closeLink = (restore: boolean): (void) => {
    const previous = linkSession?.before
    setLinkSession(null)
    if (restore && previous && latest.current.active && element.current?.isConnected) {
      element.current.focus({ preventScroll: true })
      designerRestoreInlineSelection(element.current, previous)
      savedSelection.current = previous
      refresh()
    }
  }
  useEffect(() => {
    setLinkSession(null)
  }, [ownerKey, node.text, runsKey, linkContextKey])
  useEffect(() => {
    if (active && linkRequest && openedLinkRequest.current !== linkRequest) {
      openedLinkRequest.current = linkRequest
      openLink(true)
    }
  }, [active, linkRequest])
  const underline = (): (void) => {
    const selected = savedSelection.current,
      value = readValue()
    if (!value) return
    if (!selected || selected.start === selected.end) {
      command('underline')
      return
    }
    const parts = designTextSegments({ ...latest.current.node, ...value }).filter(
      part => part.start < selected.end && part.end > selected.start,
    )
    format({
      textDecoration: parts.every(part => part.style.textDecoration === 'underline') ? 'none' : 'underline',
    })
  }
  const selected = selection ?? savedSelection.current
  const hasRange = !!selected && selected.end > selected.start
  const segments = designTextSegments({ ...node, ...draft }).filter(
    segment =>
      selected &&
      (hasRange
        ? segment.start < selected.end && segment.end > selected.start
        : segment.start <= Math.max(0, selected.start - 1) && segment.end > Math.max(0, selected.start - 1)),
  )
  const common = <K extends keyof (typeof segments)[number]['style']>(
    key: K,
  ): (typeof segments)[number]['style'][K] | (null) => {
    const first = segments[0]?.style[key]
    return segments.every(segment => segment.style[key] === first) ? (first ?? null) : null
  }
  const fills = segments.map(segment => segment.style.fill)
  const inheritedColor = fills.length > 0 && fills.every(fill => fill === undefined)
  const mixedColor = fills.some(fill => fill !== fills[0])
  const basePaints = designNodePaints(node).filter(paint => paint.visible && paint.opacity > 0)
  const baseColor =
    basePaints.length === 1 &&
    !basePaints[0]?.gradient &&
    !basePaints[0]?.image &&
    /^#[0-9a-f]{6}$/i.test(basePaints[0]?.color ?? '')
      ? basePaints[0]?.color
      : undefined
  const selectedColor = mixedColor ? undefined : (fills[0] ?? (inheritedColor ? baseColor : undefined))
  const colorStatus = mixedColor ? t('designerMixed') : inheritedColor ? t('designerInheritBase') : undefined
  const numeric = (
    key: 'fontSize' | 'lineHeight' | 'letterSpacing',
    labelKey: CopyOSFoundationLocaleKey,
    min: number,
    max: number,
  ): ReactNode => (
    <DesignerNumberField
      key={`${ownerKey}:${key}`}
      label={t(labelKey)}
      value={common(key)}
      disabled={!hasRange}
      min={min}
      max={max}
      step={key === 'lineHeight' ? 0.1 : 1}
      mixed={t('designerMixed')}
      short={key === 'fontSize' ? 'Aa' : key === 'lineHeight' ? '↕' : '↔'}
      onCommit={value => format({ [key]: value })}
    />
  )
  return (
    <>
      <div
        ref={element}
        className={workspaceCss.inlineText}
        contentEditable={active}
        suppressContentEditableWarning
        role={active ? 'textbox' : undefined}
        aria-label={active ? label : undefined}
        aria-multiline={active ? true : undefined}
        style={
          {
            ...style,
            ...(!active && overflow
              ? {
                display: overflow.nowrap ? 'block' : '-webkit-box',
                // oxlint-disable-next-line typescript/no-deprecated -- Required by the prefixed multiline clamp.
                WebkitBoxOrient: overflow.nowrap ? undefined : 'vertical',
                WebkitLineClamp: overflow.nowrap ? undefined : overflow.lines,
                ...(overflow.nowrap ? { width: '100%' } : {}),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxHeight: overflow.height,
              }
              : {}),
            '--designer-paragraph-spacing': `${node.paragraphSpacing ?? 0}px`,
            textDecoration: 'none',
            outline: 'none',
            minHeight: style.minHeight ?? '1em',
            pointerEvents: active ? 'auto' : 'none',
            userSelect: active ? 'text' : 'none',
            cursor: active ? 'text' : undefined,
          } as CSSProperties
        }
        onPointerDown={(event) => {
          if (active) event.stopPropagation()
        }}
        onDoubleClick={(event) => {
          if (active) event.stopPropagation()
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          changed()
        }}
        onKeyDown={(event) => {
          if (!active) return
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          const key = event.key.toLowerCase()
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'u') {
            event.preventDefault()
            openLink()
            return
          }
          if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(key)) {
            event.preventDefault()
            if (key === 'u') underline()
            else command(key === 'b' ? 'bold' : 'italic')
            return
          }
          if (
            event.key === 'Escape' ||
            ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || key === 's'))
          ) {
            event.preventDefault()
            finish(true)
          }
        }}
        onBeforeInput={(event) => {
          const input = event.nativeEvent
          if (
            active &&
            input.inputType.startsWith('format') &&
            !['formatBold', 'formatItalic', 'formatUnderline'].includes(input.inputType)
          )
            event.preventDefault()
        }}
        onPaste={(event) => {
          if (!active) return
          event.preventDefault()
          command('insertText', event.clipboardData.getData('text/plain'))
        }}
        onInput={() => {
          if (active && !composing.current) changed()
        }}
        onBlur={(event) => {
          if (!active || owns(event.relatedTarget)) return
          finish()
        }}
      />
      {active && linkSession ? (
        <DesignerTextLink
          current={linkSession.current}
          wholeText={linkSession.whole}
          anchorRange={linkSession.anchor}
          editor={element}
          owner={owner}
          targets={linkTargets}
          t={t}
          close={closeLink}
          apply={(target) => {
            if (target?.type === 'NODE' && !linkTargets.some(node => node.id === target.value)) return false
            if (!format({ hyperlink: target }, linkSession.range)) return false
            setLinkSession(null)
            return true
          }}
          follow={(target) => {
            if (!finish(true)) return false
            return target.type === 'URL' || (onFollowLink?.(target.value) ?? false)
          }}
        />
      ) : null}
      {active
        ? createPortal(
          <div
            ref={panel}
            className={host ? `${css.toolbar} ${css.docked}` : `${workspaceCss.designerPopover} ${css.toolbar}`}
            style={host ? undefined : position ?? { visibility: 'hidden' }}
            role="group"
            aria-label={t('designerInlineFormatting')}
            data-designer-popover-owners={owner}
            onPointerDown={stopInlineEvent}
            onPointerUp={stopInlineEvent}
            onPointerMove={stopInlineEvent}
            onClick={stopInlineEvent}
            onDoubleClick={stopInlineEvent}
            onContextMenu={stopInlineEvent}
            onWheel={stopInlineEvent}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.nativeEvent.isComposing) return
              const key = event.key.toLowerCase(),
                mod = event.ctrlKey || event.metaKey
              if (mod && event.shiftKey && key === 'u') {
                event.preventDefault()
                openLink()
                return
              }
              if (mod && key === 's') {
                event.preventDefault()
                finish(true)
                return
              }
              if (
                event.target instanceof HTMLInputElement ||
                  event.target instanceof HTMLTextAreaElement ||
                  event.target instanceof HTMLSelectElement
              )
                return
              if (event.key === 'Escape' || (mod && event.key === 'Enter')) {
                event.preventDefault()
                finish(true)
                return
              }
              if (mod && ['b', 'i', 'u'].includes(key)) {
                event.preventDefault()
                if (key === 'u') underline()
                else command(key === 'b' ? 'bold' : 'italic')
              } else if (mod && (key === 'z' || key === 'y')) {
                event.preventDefault()
                command(key === 'y' || event.shiftKey ? 'redo' : 'undo')
              }
            }}
          >
            <div className={css.actions}>
              {(['bold', 'italic', 'underline'] as const).map((name, index) => (
                <button
                  key={name}
                  type="button"
                  aria-label={t(
                    (['designerWeightBold', 'designerItalic', 'designerUnderline'] as const)[index] ??
                        'designerWeightBold',
                  )}
                  aria-pressed={
                    name === 'bold'
                      ? common('fontWeight') === null
                        ? 'mixed'
                        : Number(common('fontWeight')) >= 600
                      : name === 'italic'
                        ? common('fontStyle') === null
                          ? 'mixed'
                          : common('fontStyle') === 'italic'
                        : common('textDecoration') === null
                          ? 'mixed'
                          : common('textDecoration') === 'underline'
                  }
                  onPointerDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    if (name === 'underline') underline()
                    else command(name)
                  }}
                >
                  {['B', 'I', 'U'][index]}
                </button>
              ))}
              <Tooltip label={t('designerTextLink')} portal>
                <button
                  type="button"
                  aria-label={t('designerTextLink')}
                  aria-pressed={!!linkSession}
                  disabled={!draft.text.length}
                  onPointerDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    openLink()
                  }}
                >
                  <IconLinkOutlineRegular size={14} />
                </button>
              </Tooltip>
              <button
                type="button"
                disabled={!hasRange}
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  format(null)
                }}
              >
                {t('designerResetInlineFormatting')}
              </button>
              <button
                type="button"
                onClick={() => {
                  finish(true)
                }}
              >
                {t('designerDone')}
              </button>
            </div>
            {!hasRange ? <p>{t('designerSelectTextToFormat')}</p> : null}
            {invalid || formatError ? <p role="alert">{t('designerInlineFormattingInvalid')}</p> : null}
            <fieldset disabled={!hasRange || invalid} className={css.fields}>
              <div className={css.family}>
                <DesignerFontPicker
                  value={common('fontFamily')}
                  families={[node.fontFamily, ...families]}
                  labels={designerFontLabels(t)}
                  selectionKey={`${ownerKey}:${selected?.start}:${selected?.end}`}
                  onCancelPreview={() => {}}
                  onCommit={(value) => {
                    format({ fontFamily: value })
                  }}
                />
              </div>
              <DesignerFontFeatures values={segments.map(segment => segment.style.fontFeatures)}
                selectionKey={`${ownerKey}:${selected?.start}:${selected?.end}`} disabled={!hasRange || invalid} t={t}
                onApply={change => format((original, range) => {
                  let next = original
                  for (const segment of designTextSegments(original)) {
                    const start = Math.max(range.start, segment.start), end = Math.min(range.end, segment.end)
                    if (end > start) next = styleDesignTextRange(next, start, end, {
                      fontFeatures: editDesignerFontFeatures(segment.style.fontFeatures, change) ?? null,
                    })
                  }
                  return next
                })} />
              <DesignerFontVariations values={segments.map(segment => segment.style.fontVariations)}
                fonts={segments.map(segment => segment.style)}
                selectionKey={`${ownerKey}:${selected?.start}:${selected?.end}`} disabled={!hasRange || invalid} t={t}
                onApply={change => format((original, range) => {
                  let next = original
                  for (const segment of designTextSegments(original)) {
                    const start = Math.max(range.start, segment.start), end = Math.min(range.end, segment.end)
                    if (end > start) next = styleDesignTextRange(next, start, end, {
                      fontVariations: editDesignerFontVariations(segment.style.fontVariations, change) ?? null,
                    })
                  }
                  return next
                })} />
              <label>
                <span>{t('designerFontWeight')}</span>
                <select
                  aria-label={t('designerFontWeight')}
                  value={common('fontWeight') ?? 'mixed'}
                  onChange={(event) => {
                    format({ fontWeight: Number(event.currentTarget.value) })
                  }}
                >
                  <option value="mixed" disabled>
                    {t('designerMixed')}
                  </option>
                  {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span>{t('designerFontSize')}</span>
                {numeric('fontSize', 'designerFontSize', 1, 1000)}
              </div>
              <div>
                <span>{t('designerLineHeight')}</span>
                {numeric('lineHeight', 'designerLineHeight', 0.5, 10)}
              </div>
              <div>
                <span>{t('designerLetterSpacing')}</span>
                {numeric('letterSpacing', 'designerLetterSpacing', -1000, 1000)}
              </div>
              <label>
                <span>{t('designerInlineColor')}</span>
                <span className={css.colorField}>
                  {!selectedColor ? (
                    <span>{mixedColor ? t('designerMixed') : t('designerFill')}</span>
                  ) : null}
                  <input
                    type="color"
                    aria-label={t('designerInlineColor')}
                    aria-description={colorStatus}
                    className={!selectedColor ? css.unrepresentedColor : undefined}
                    value={selectedColor ?? '#000000'}
                    onChange={(event) => {
                      format({ fill: event.currentTarget.value })
                    }}
                  />
                </span>
                {colorStatus ? <span>{colorStatus}</span> : null}
              </label>
            </fieldset>
          </div>,
          host ?? document.body,
        )
        : null}
    </>
  )
}
