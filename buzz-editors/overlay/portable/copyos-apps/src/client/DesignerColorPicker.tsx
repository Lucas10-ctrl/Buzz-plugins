/** Solid paint editor with a saturation/value plane and named local resources. */
import { DesignerSwatch } from './DesignerSwatch.tsx'
import { useEffect, useRef, useState, type ReactNode, type PointerEvent, type CSSProperties } from 'react'
import { designColorVariableCss } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignVariable } from '../../../copyos-domain/src/types.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
interface Hsv {
  h: number
  s: number
  v: number
}
function hsvFromHex(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255,
    g = parseInt(hex.slice(3, 5), 16) / 255,
    b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max ? d / max : 0, v: max }
}
function hexFromHsv({ h, s, v }: Hsv): string {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c
  const [r = 0, g = 0, b = 0] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return (
    '#' +
    [r, g, b]
      .map(n =>
        Math.round((n + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}
/** Render custom color and local-library tabs; each pointer gesture commits one undo step.
 * @param props - Current paint, resources, preview/commit callbacks and localized labels.
 * @returns A reusable paint-picker body.
 */
export function DesignerColorPicker({
  color,
  opacity,
  resources,
  initialTab = 'custom',
  allowOpacity = true,
  allowLibrary = true,
  opacityLabel,
  onPreview,
  onCommit,
  onCancel,
  onVariable,
  t,
}: {
  color: string
  opacity: number
  resources: CopyOSDesignVariable[]
  initialTab?: 'custom' | 'libraries'
  allowLibrary?: boolean
  opacityLabel?: string
  allowOpacity?: boolean
  onPreview: (color: string, opacity: number) => void
  onCommit: (color: string, opacity: number) => void
  onCancel: () => void
  onVariable: (variable: CopyOSDesignVariable) => void
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const [tab, setTab] = useState(initialTab)
  const [hsv, setHsv] = useState(() => hsvFromHex(color))
  const [alpha, setAlpha] = useState(opacity)
  const alphaStyle: CSSProperties & { '--designer-alpha-color': string } = {
    '--designer-alpha-color': hexFromHsv(hsv),
  }
  const [hex, setHex] = useState(color.slice(1).toUpperCase())
  const [query, setQuery] = useState('')
  const current = useRef({ color, opacity })
  const dragging = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    if (dragging.current || (color === current.current.color && opacity === current.current.opacity)) return
    current.current = { color, opacity }
    setHsv(hsvFromHex(color))
    setAlpha(opacity)
    setHex(color.slice(1).toUpperCase())
  }, [color, opacity])
  const change = (next: Hsv, nextAlpha = alpha): void => {
    pending.current = true
    const value = hexFromHsv(next)
    setHsv(next)
    setAlpha(nextAlpha)
    setHex(value.slice(1).toUpperCase())
    current.current = { color: value, opacity: nextAlpha }
    onPreview(value, nextAlpha)
  }
  const settle = (): void => {
    dragging.current = false
    if (!pending.current) return
    pending.current = false
    onCommit(current.current.color, current.current.opacity)
  }
  const cancel = (): void => {
    dragging.current = false
    pending.current = false
    current.current = { color, opacity }
    onCancel()
    setHsv(hsvFromHex(color))
    setAlpha(opacity)
    setHex(color.slice(1).toUpperCase())
  }
  const plane = (event: PointerEvent<HTMLDivElement>): void => {
    const r = event.currentTarget.getBoundingClientRect()
    change({
      ...hsv,
      s: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    })
  }
  const commitHex = (): void => {
    const value = '#' + hex.replace('#', '')
    if (/^#[a-f\d]{6}$/i.test(value)) {
      if (!pending.current && value.toLowerCase() === current.current.color.toLowerCase()) return
      pending.current = false
      current.current = { color: value, opacity: alpha }
      setHsv(hsvFromHex(value))
      onCommit(value, alpha)
    } else setHex(current.current.color.slice(1).toUpperCase())
  }
  const sorted = resources
    .filter(v => v.name.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className={css.colorPicker}>
      {allowLibrary ? (
        <div role="tablist" className={css.colorTabs}>
          {(['custom', 'libraries'] as const).map(value => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value)
              }}
            >
              {t(value === 'custom' ? 'designerCustom' : 'designerLibraries')}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'custom' || !allowLibrary ? (
        <div className={css.popoverContent}>
          <div
            className={css.colorPlane}
            role="slider"
            tabIndex={0}
            aria-label={t('designerSaturationValue')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => {
              e.preventDefault()
              dragging.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              plane(e)
            }}
            onPointerMove={(e) => {
              if (dragging.current) plane(e)
            }}
            onPointerUp={settle}
            onPointerCancel={cancel}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              } else if (e.key.startsWith('Arrow')) {
                e.preventDefault()
                const delta = e.shiftKey ? 0.1 : 0.01
                const next = {
                  ...hsv,
                  s: Math.max(
                    0,
                    Math.min(
                      1,
                      hsv.s + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0),
                    ),
                  ),
                  v: Math.max(
                    0,
                    Math.min(1, hsv.v + (e.key === 'ArrowUp' ? delta : e.key === 'ArrowDown' ? -delta : 0)),
                  ),
                }
                change(next)
                settle()
              }
            }}
          >
            <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input
            className={css.hueSlider}
            type="range"
            min={0}
            max={359.9}
            step={0.1}
            aria-label={t('designerHue')}
            value={hsv.h}
            onPointerDown={() => {
              dragging.current = true
            }}
            onChange={(e) => {
              change({ ...hsv, h: Number(e.currentTarget.value) })
            }}
            onPointerUp={settle}
            onKeyUp={settle}
            onBlur={settle}
            onPointerCancel={cancel}
          />
          {allowOpacity ? (
            <input
              className={css.alphaSlider}
              style={alphaStyle}
              type="range"
              min={0}
              max={1}
              step={0.01}
              aria-label={opacityLabel ?? t('designerFillOpacity')}
              value={alpha}
              onPointerDown={() => {
                dragging.current = true
              }}
              onChange={(e) => {
                change(hsv, Number(e.currentTarget.value))
              }}
              onPointerUp={settle}
              onKeyUp={settle}
              onBlur={settle}
              onPointerCancel={cancel}
            />
          ) : null}
          <div className={css.colorHexRow}>
            <span>{t('designerHex')}</span>
            <input
              aria-label={t('designerHex')}
              value={hex}
              onChange={(e) => {
                setHex(e.currentTarget.value)
              }}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setHex(current.current.color.slice(1).toUpperCase())
                  e.currentTarget.blur()
                }
              }}
            />
            {allowOpacity ? (
              <DesignerNumberField
                label={opacityLabel ?? t('designerFillOpacity')}
                short="%"
                value={alpha * 100}
                fullPrecision
                min={0}
                max={100}
                mixed={t('designerMixed')}
                onCommit={(percent) => {
                  change(hsv, percent / 100)
                  settle()
                }}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className={css.popoverContent}>
            <input
              aria-label={t('designerResourceSearch')}
              placeholder={t('designerResourceSearch')}
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value)
              }}
            />
            <small>{t('designerAllLibraries')}</small>
          </div>
          <div className={css.resourceList}>
            {sorted.map((v, i) => {
              const group = v.name.includes('/') ? v.name.slice(0, v.name.lastIndexOf('/')) : ''
              const previous = sorted[i - 1]?.name
              const previousGroup = previous?.includes('/')
                ? previous.slice(0, previous.lastIndexOf('/'))
                : ''
              return (
                <div key={v.id}>
                  {group && group !== previousGroup ? <p className={css.resourceGroup}>{group}</p> : null}
                  <button
                    type="button"
                    onClick={() => {
                      onVariable(v)
                    }}
                  >
                    <DesignerSwatch className={css.swatch} paint={designColorVariableCss(v)} />
                    <span>{v.name.split('/').at(-1)}</span>
                  </button>
                </div>
              )
            })}
            {!sorted.length ? <p className={css.resourceGroup}>{t('designerNoResources')}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}
