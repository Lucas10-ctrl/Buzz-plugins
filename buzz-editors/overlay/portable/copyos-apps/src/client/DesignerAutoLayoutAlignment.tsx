/** Spatial content alignment with one tab stop and local, owner-aware keyboard commands. */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  designAutoLayoutAlignmentContext,
  designGridCellAlignmentContext,
  type DesignGridCellAlignmentIntent,
  type DesignAutoLayoutAlignmentIntent,
  type DesignAlignmentTarget,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { DesignerIcon } from './DesignerIcon.tsx'
import css from './DesignerAutoLayoutAlignment.module.css'

type Position = 'start' | 'center' | 'end'
const positions: readonly Position[] = ['start', 'center', 'end']
const labelKeys = {
  start: {
    start: 'designerAlignmentTopLeft',
    center: 'designerAlignmentTopCenter',
    end: 'designerAlignmentTopRight',
  },
  center: {
    start: 'designerAlignmentCenterLeft',
    center: 'designerAlignmentCenter',
    end: 'designerAlignmentCenterRight',
  },
  end: {
    start: 'designerAlignmentBottomLeft',
    center: 'designerAlignmentBottomCenter',
    end: 'designerAlignmentBottomRight',
  },
} as const satisfies Record<Position, Record<Position, CopyOSFoundationLocaleKey>>
const firstPoint = {
  horizontal: 'start',
  vertical: 'start',
  key: 'start:start',
  labelKey: labelKeys.start.start,
} as const
const points = positions.flatMap(vertical =>
  positions.map(horizontal => ({
    horizontal,
    vertical,
    key: `${horizontal}:${vertical}`,
    labelKey: labelKeys[vertical][horizontal],
  })),
)

type CommonProps = {
  document: CopyOSDesignDocument
  targets: readonly (string | DesignAlignmentTarget)[]
  t: (key: CopyOSFoundationLocaleKey) => string
}
/** Render a spatial intent control; all mutation/admission and history belong to the Workspace callback.
 * @param props - Immutable scene, stored owners, localized labels and one atomic native-intent callback.
 * @returns Roving stack alignment points or six Grid-cell Position buttons, using distinct native intents.
 */
export function DesignerAutoLayoutAlignment(
  props: CommonProps &
    (
      | { purpose?: 'layout'; onIntent: (intent: DesignAutoLayoutAlignmentIntent) => boolean }
      | { purpose: 'cell'; onIntent: (intent: DesignGridCellAlignmentIntent) => boolean }
    ),
): ReactNode {
  return props.purpose === 'cell' ? <CellAlignment {...props} /> : <LayoutAlignment {...props} />
}
function LayoutAlignment({
  document,
  targets,
  t,
  onIntent,
}: CommonProps & { onIntent: (intent: DesignAutoLayoutAlignmentIntent) => boolean }): ReactNode {
  const ownerKey = JSON.stringify(targets)
  const context = useMemo(() => designAutoLayoutAlignmentContext(document, targets), [document, ownerKey])
  const allAutomatic = context.owners.length > 0 && context.owners.every(owner => owner.automatic)
  const commonFlow = context.owners.every(owner => owner.flow === context.owners[0]?.flow)
    ? context.owners[0]?.flow
    : undefined
  const autoFlow = allAutomatic && commonFlow ? commonFlow : undefined
  const visiblePoints = points.filter(
    point => !autoFlow || (autoFlow === 'row' ? point.horizontal : point.vertical) === 'center',
  )
  const pressed = (point: (typeof points)[number]): boolean =>
    context.owners.length > 0 &&
    context.owners.every(
      owner =>
        ((owner.automatic && owner.flow === 'row') || owner.horizontal === point.horizontal) &&
        ((owner.automatic && owner.flow === 'column') || owner.vertical === point.vertical),
    )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const selected = visiblePoints.find(pressed)
  const focused =
    visiblePoints.find(point => point.key === focusKey) ?? selected ?? visiblePoints[0] ?? firstPoint
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const focusAfterIntent = useRef(false)
  const fallbackFocusKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!focusAfterIntent.current) return
    focusAfterIntent.current = false
    const target = selected ?? visiblePoints.find(point => point.key === fallbackFocusKey.current) ?? focused
    setFocusKey(target.key)
    buttons.current.get(target.key)?.focus()
  }, [document, focused.key, selected?.key])

  const applyIntent = (intent: DesignAutoLayoutAlignmentIntent, fallbackKey = focused.key): void => {
    fallbackFocusKey.current = fallbackKey
    focusAfterIntent.current = true
    if (!onIntent(intent)) {
      focusAfterIntent.current = false
      const target = selected ?? focused
      setFocusKey(target.key)
      buttons.current.get(target.key)?.focus()
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === ' ' || key === 'enter') {
      event.stopPropagation()
      return
    }
    if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'x', 'b'].includes(key))
      return
    event.preventDefault()
    event.stopPropagation()
    if (!context.canEdit) return
    if (key === 'x') {
      applyIntent({ type: 'auto-spacing', enabled: !context.owners.some(owner => owner.automatic) })
      return
    }
    if (key === 'b') {
      if (context.canBaseline)
        applyIntent({ type: 'baseline', enabled: !context.owners.every(owner => owner.baseline) })
      return
    }
    const horizontal = ['arrowleft', 'arrowright', 'a', 'd'].includes(key)
    const axis = horizontal ? 'horizontal' : 'vertical'
    const direction = ['arrowleft', 'arrowup', 'w', 'a'].includes(key) ? -1 : 1
    const mainAxisIgnored = (autoFlow === 'row' && horizontal) || (autoFlow === 'column' && !horizontal)
    let fallbackKey = focused.key
    if (!mainAxisIgnored) {
      const previous = focused[axis]
      const next = key.startsWith('arrow')
        ? (positions[Math.max(0, Math.min(2, positions.indexOf(previous) + direction))] ?? previous)
        : direction < 0
          ? 'start'
          : 'end'
      const target = visiblePoints.find(
        point =>
          point[axis] === next &&
          point[horizontal ? 'vertical' : 'horizontal'] === focused[horizontal ? 'vertical' : 'horizontal'],
      )
      if (target) fallbackKey = target.key
    }
    applyIntent(
      key.startsWith('arrow')
        ? { type: 'step', axis, direction }
        : horizontal
          ? { type: 'spatial', horizontal: direction < 0 ? 'start' : 'end' }
          : { type: 'spatial', vertical: direction < 0 ? 'start' : 'end' },
      fallbackKey,
    )
  }
  return (
    <Tooltip label={t('designerAlignmentShortcuts')}>
      <div
        className={css.grid}
        data-auto-flow={autoFlow}
        role="group"
        aria-label={t('designerContentAlignment')}
        aria-description={t('designerAlignmentShortcuts')}
        onKeyDown={keyDown}
      >
        {visiblePoints.map(point => (
          <button
            key={point.key}
            type="button"
            disabled={!context.canEdit}
            ref={(button) => {
              if (button) buttons.current.set(point.key, button)
              else buttons.current.delete(point.key)
            }}
            aria-label={t(point.labelKey)}
            aria-pressed={pressed(point)}
            tabIndex={focused.key === point.key ? 0 : -1}
            onFocus={() => {
              setFocusKey(point.key)
            }}
            onClick={() => {
              onIntent({ type: 'spatial', horizontal: point.horizontal, vertical: point.vertical })
            }}
          >
            <span aria-hidden="true">·</span>
          </button>
        ))}
      </div>
    </Tooltip>
  )
}

const firstCellButton = {
  axis: 'horizontal',
  value: 'start',
  key: 'horizontal:start',
  labelKey: 'designerAlignLeft',
} as const
const cellButtons = [
  firstCellButton,
  { axis: 'horizontal', value: 'center', key: 'horizontal:center', labelKey: 'designerAlignCenterX' },
  { axis: 'horizontal', value: 'end', key: 'horizontal:end', labelKey: 'designerAlignRight' },
  { axis: 'vertical', value: 'start', key: 'vertical:start', labelKey: 'designerAlignTop' },
  { axis: 'vertical', value: 'center', key: 'vertical:center', labelKey: 'designerAlignCenterY' },
  { axis: 'vertical', value: 'end', key: 'vertical:end', labelKey: 'designerAlignBottom' },
] as const
function CellAlignment({
  document,
  targets,
  t,
  onIntent,
}: CommonProps & { onIntent: (intent: DesignGridCellAlignmentIntent) => boolean }): ReactNode {
  const ownerKey = JSON.stringify(targets)
  const context = useMemo(() => designGridCellAlignmentContext(document, targets), [document, ownerKey])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const pending = useRef<{ axis: 'horizontal' | 'vertical'; fallback: string } | null>(null)
  const common = (axis: 'horizontal' | 'vertical'): Position | undefined => {
    const value = context.owners[0]?.[axis]
    return context.owners.length && context.owners.every(owner => owner[axis] === value) ? value : undefined
  }
  const focused =
    cellButtons.find(button => button.key === focusKey) ??
    cellButtons.find(button => button.axis === 'horizontal' && button.value === common('horizontal')) ??
    firstCellButton
  useLayoutEffect(() => {
    const next = pending.current
    if (!next) return
    pending.current = null
    const key = `${next.axis}:${common(next.axis) ?? next.fallback}`
    setFocusKey(key)
    buttons.current.get(key)?.focus()
  }, [document])
  const apply = (
    intent: DesignGridCellAlignmentIntent,
    axis: 'horizontal' | 'vertical',
    fallback: Position,
  ): void => {
    pending.current = { axis, fallback }
    if (!onIntent(intent)) {
      pending.current = null
      const key = `${axis}:${common(axis) ?? focused.value}`
      setFocusKey(key)
      buttons.current.get(key)?.focus()
    }
  }
  const shortcuts = t('designerGridCellAlignmentShortcuts')
  const description = !context.canEdit
    ? `${shortcuts} ${t('designerGridCellAlignmentUnavailable')}`
    : context.owners.some(owner => owner.widthFill || owner.heightFill)
      ? `${shortcuts} ${t('designerGridCellFillAlignment')}`
      : shortcuts
  return (
    <Tooltip label={description}>
      <div
        className={css.cell}
        role="group"
        aria-label={t('designerCellAlignment')}
        aria-description={description}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const key = event.key.toLowerCase()
          if (key === ' ' || key === 'enter') {
            event.stopPropagation()
            return
          }
          if (
            !['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'x', 'b'].includes(key)
          )
            return
          event.preventDefault()
          event.stopPropagation()
          if (!context.canEdit || key === 'x' || key === 'b') return
          const axis = ['arrowleft', 'arrowright', 'a', 'd'].includes(key) ? 'horizontal' : 'vertical'
          const direction = ['arrowleft', 'arrowup', 'w', 'a'].includes(key) ? -1 : 1
          const value = common(axis) ?? context.owners[0]?.[axis] ?? 'start'
          const next = key.startsWith('arrow')
            ? (positions[Math.max(0, Math.min(2, positions.indexOf(value) + direction))] ?? value)
            : direction < 0
              ? 'start'
              : 'end'
          apply(
            key.startsWith('arrow')
              ? { type: 'step', axis, direction }
              : axis === 'horizontal'
                ? { type: 'spatial', horizontal: next }
                : { type: 'spatial', vertical: next },
            axis,
            next,
          )
        }}
      >
        {cellButtons.map(button => (
          <button
            key={button.key}
            type="button"
            disabled={!context.canEdit}
            ref={(element) => {
              if (element) buttons.current.set(button.key, element)
              else buttons.current.delete(button.key)
            }}
            aria-label={t(button.labelKey)}
            aria-pressed={common(button.axis) === button.value}
            tabIndex={focused.key === button.key ? 0 : -1}
            onFocus={() => {
              setFocusKey(button.key)
            }}
            onClick={() => {
              apply(
                button.axis === 'horizontal'
                  ? { type: 'spatial', horizontal: button.value }
                  : { type: 'spatial', vertical: button.value },
                button.axis,
                button.value,
              )
            }}
          >
            <DesignerIcon name={`align-${button.axis === 'horizontal' ? 'x' : 'y'}-${button.value}`} />
          </button>
        ))}
      </div>
    </Tooltip>
  )
}
