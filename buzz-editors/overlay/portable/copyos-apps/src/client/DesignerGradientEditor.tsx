/** Gradient stops and affine handles share the native scene's paint representation. */
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CopyOSDesignGradient, CopyOSDesignVariable } from '../../../copyos-domain/src/types.ts'
import {
  designGradientAtAngle,
  designColorVariableCss,
  designGradientFromPoints,
  designGradientPoints,
} from '../../../copyos-domain/src/design-model.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { designerPaintColorEdit } from './DesignerPaintColor.ts'
import { DesignerColorPicker } from './DesignerColorPicker.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Edit stops, opacity and physical direction with one undo step per pointer gesture.
 * @param props - Current gradient, geometry, shared colors and preview/commit actions.
 * @returns A paint-picker body.
 */
export function DesignerGradientEditor({
  gradient,
  width,
  height,
  resources,
  t,
  onPreview,
  onCommit,
  onCancel,
}: {
  gradient: CopyOSDesignGradient
  width: number
  height: number
  resources: CopyOSDesignVariable[]
  t: (key: CopyOSFoundationLocaleKey) => string
  onPreview: (gradient: CopyOSDesignGradient) => void
  onCommit: (gradient: CopyOSDesignGradient) => void
  onCancel: () => void
}): ReactNode {
  const keys = useRef(gradient.stops.map(s => s.id ?? randomUUID()))
  const stops = gradient.stops.map((s, i) => ({ ...s, id: s.id ?? keys.current[i] ?? randomUUID() }))
  const [selected, setSelected] = useState(stops[0]?.id ?? '')
  const stop = stops.find(s => s.id === selected) ?? stops[0]
  const colorOrigin = useRef<CopyOSDesignGradient | null>(null)
  const cancelColorPreview = (): void => {
    colorOrigin.current = null
    onCancel()
  }
  const editStopColor = (color: string, opacity: number, transient = false): void => {
    if (!stop) return
    if (transient) colorOrigin.current ??= { ...gradient, stops }
    const source = colorOrigin.current ?? { ...gradient, stops }
    const original = source.stops.find(value => value.id === stop.id) ?? stop
    const fields = designerPaintColorEdit(original, resources.find(value => value.id === original.variableId), color, opacity)
    update({ ...source, stops: source.stops.map(value => value.id === stop.id ? { ...value, ...fields } : value) }, transient)
    if (!transient) colorOrigin.current = null
  }
  const moved = useRef(false)
  const rail = useRef<HTMLDivElement>(null),
    drag = useRef<string | null>(null),
    latest = useRef(gradient)
  latest.current = { ...gradient, stops }
  const update = (next: CopyOSDesignGradient, preview = false): void => {
    latest.current = next
    if (preview) onPreview(next)
    else onCommit(next)
  }
  const updateStop = (fields: Partial<CopyOSDesignGradient['stops'][number]>, preview = false): void => {
    if (!stop) return
    update(
      {
        ...gradient,
        stops: stops
          .map(s => (s.id === stop.id ? { ...s, ...fields } : s))
          .sort((a, b) => a.position - b.position),
      },
      preview,
    )
  }
  const colorOf = (s: CopyOSDesignGradient['stops'][number]): string =>
    resources.find(v => v.id === s.variableId)?.value ?? s.color
  const railImage = `linear-gradient(90deg, ${[...stops]
    .sort((a, b) => a.position - b.position)
    .map(
      s =>
        `${designColorVariableCss({ value: colorOf(s), alpha: s.opacity * (resources.find(v => v.id === s.variableId)?.alpha ?? 1) })} ${s.position * 100}%`,
    )
    .join(',')})`
  const addStop = (position: number): void => {
    if (stops.length >= 100) return
    const sorted = [...stops].sort((a, b) => a.position - b.position)
    const left = sorted.filter(s => s.position <= position).at(-1) ?? sorted[0],
      right = sorted.find(s => s.position >= position) ?? sorted.at(-1)
    if (!left || !right) return
    const fraction =
      right.position === left.position ? 0 : (position - left.position) / (right.position - left.position)
    const a = colorOf(left),
      b = colorOf(right)
    const leftAlpha = left.opacity * (resources.find(v => v.id === left.variableId)?.alpha ?? 1),
      rightAlpha = right.opacity * (resources.find(v => v.id === right.variableId)?.alpha ?? 1)
    const opacity = leftAlpha + (rightAlpha - leftAlpha) * fraction
    const color =
      '#' +
      [1, 3, 5]
        .map((i) => {
          const first = parseInt(a.slice(i, i + 2), 16),
            last = parseInt(b.slice(i, i + 2), 16)
          return Math.round(opacity === 0 ? 0 : (first * leftAlpha * (1 - fraction) + last * rightAlpha * fraction) / opacity)
            .toString(16)
            .padStart(2, '0')
        })
        .join('')
    const added = { id: randomUUID(), position, color, opacity, variableId: null }
    setSelected(added.id)
    update({ ...gradient, stops: [...stops, added].sort((a, b) => a.position - b.position) })
  }
  const move = (e: PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current || !rail.current) return
    moved.current = true
    const dragging = drag.current
    const rect = rail.current.getBoundingClientRect(),
      position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    update(
      {
        ...latest.current,
        stops: latest.current.stops
          .map((s, i) => ((s.id ?? keys.current[i]) === dragging ? { ...s, id: dragging, position } : s))
          .sort((a, b) => a.position - b.position),
      },
      true,
    )
  }
  const points = designGradientPoints(gradient)
  const angle =
    (Math.atan2((points.end.y - points.start.y) * height, (points.end.x - points.start.x) * width) * 180) /
    Math.PI
  const remove = (): void => {
    if (!stop || stops.length <= 2) return
    const next = stops.filter(s => s.id !== stop.id)
    setSelected(next[0]?.id ?? '')
    update({ ...gradient, stops: next })
  }
  return (
    <div className={css.gradientEditor}>
      <div
        ref={rail}
        className={css.gradientRail}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect()
            addStop(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
          }
        }}
      >
        <DesignerSwatch className={css.gradientRailPaint} paint={railImage} />
        {stops.map((s, i) => (
          <button
            type="button"
            key={s.id}
            className={css.gradientStop}
            aria-label={t('designerGradientStop').replace('{number}', String(i + 1))}
            aria-pressed={stop?.id === s.id}
            style={{ left: `${s.position * 100}%` }}
            onClick={() => {
              setSelected(s.id)
            }}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSelected(s.id)
              drag.current = s.id
              moved.current = false
              latest.current = { ...gradient, stops }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={move}
            onPointerUp={() => {
              if (drag.current) {
                drag.current = null
                if (moved.current) onCommit(latest.current)
              }
            }}
            onPointerCancel={() => {
              drag.current = null
              onCancel()
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                update({
                  ...gradient,
                  stops: stops
                    .map(p =>
                      p.id === s.id
                        ? {
                          ...p,
                          position: Math.max(
                            0,
                            Math.min(
                              1,
                              p.position + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01),
                            ),
                          ),
                        }
                        : p,
                    )
                    .sort((a, b) => a.position - b.position),
                })
              }
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                remove()
              }
            }}
          >
            <DesignerSwatch className={css.gradientStopPaint}
              paint={designColorVariableCss({ value: colorOf(s),
                alpha: s.opacity * (resources.find(v => v.id === s.variableId)?.alpha ?? 1) })} />
          </button>
        ))}
      </div>
      <div className={css.gradientActions}>
        <button
          type="button"
          disabled={stops.length >= 100}
          onClick={() => {
            addStop(0.5)
          }}
        >
          {t('designerAddStop')}
        </button>
        <button type="button" disabled={stops.length <= 2} onClick={remove}>
          {t('designerRemoveStop')}
        </button>
        <button
          type="button"
          onClick={() => {
            update({
              ...gradient,
              stops: stops
                .map(s => ({ ...s, position: 1 - s.position }))
                .sort((a, b) => a.position - b.position),
            })
          }}
        >
          {t('designerReverseGradient')}
        </button>
      </div>
      <div className={css.fieldGrid}>
        {stop ? (
          <DesignerNumberField
            label={t('designerStopPosition')}
            short="%"
            value={stop.position * 100}
            mixed={t('designerMixed')}
            min={0}
            max={100}
            step={1}
            onCommit={(position) => {
              updateStop({ position: position / 100 })
            }}
          />
        ) : null}
        {gradient.type === 'linear' ? (
          <DesignerNumberField
            label={t('designerGradientAngle')}
            short="∠"
            value={angle}
            mixed={t('designerMixed')}
            min={-3600}
            max={3600}
            onCommit={(value) => {
              update({ ...gradient, transform: designGradientAtAngle(value, width, height) })
            }}
          />
        ) : null}
        {gradient.type === 'radial' ? (
          <>
            <DesignerNumberField
              label={t('designerGradientCenterX')}
              short="X"
              value={points.start.x * 100}
              mixed={t('designerMixed')}
              min={-1000}
              max={1000}
              onCommit={(value) => {
                const delta = value / 100 - points.start.x
                const transform = designGradientFromPoints('radial', {
                  start: { ...points.start, x: value / 100 },
                  end: { ...points.end, x: points.end.x + delta },
                  cross: { ...points.cross, x: points.cross.x + delta },
                })
                if (transform) update({ ...gradient, transform })
              }}
            />
            <DesignerNumberField
              label={t('designerGradientCenterY')}
              short="Y"
              value={points.start.y * 100}
              mixed={t('designerMixed')}
              min={-1000}
              max={1000}
              onCommit={(value) => {
                const delta = value / 100 - points.start.y
                const transform = designGradientFromPoints('radial', {
                  start: { ...points.start, y: value / 100 },
                  end: { ...points.end, y: points.end.y + delta },
                  cross: { ...points.cross, y: points.cross.y + delta },
                })
                if (transform) update({ ...gradient, transform })
              }}
            />
          </>
        ) : null}
      </div>
      {stop ? (
        <DesignerColorPicker
          key={stop.id}
          color={colorOf(stop)}
          opacity={stop.opacity * (resources.find(v => v.id === stop.variableId)?.alpha ?? 1)}
          resources={resources}
          t={t}
          onPreview={(color, opacity) => {
            editStopColor(color, opacity, true)
          }}
          onCommit={(color, opacity) => {
            editStopColor(color, opacity)
          }}
          onCancel={cancelColorPreview}
          onVariable={(variable) => {
            colorOrigin.current = null
            updateStop({ variableId: variable.id, color: variable.value })
          }}
        />
      ) : null}
    </div>
  )
}
