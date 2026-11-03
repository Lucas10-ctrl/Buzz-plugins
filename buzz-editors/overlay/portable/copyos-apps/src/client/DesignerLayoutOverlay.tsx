/** Screen-sized canvas controls edit real layout spacing without intercepting scene clicks. */
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  designLayoutBox,
  designGridGeometry,
  type DesignStackLine,
} from '../../../copyos-domain/src/design-model.ts'
import { parseDesignNumber } from './DesignerNumberField.tsx'
import css from './PageDesignerWorkspace.module.css'

/** Native spacing properties exposed by the canvas controls. */
export type LayoutField =
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'gap'
  | 'crossGap'
interface Control {
  key: string
  field: LayoutField
  value: number
  x: number
  y: number
  horizontal: boolean
  band: { x: number; y: number; width: number; height: number }
}
type CanvasViewport = Control['band'] & {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  screenLeft: number
  screenTop: number
  screenRight: number
  screenBottom: number
}
interface Modifiers {
  altKey: boolean
  shiftKey: boolean
}
interface Editor {
  control: Control
  anchor: SVGGElement
  nodeId: string
  scope: Modifiers
}
interface Press extends Editor {
  pointerId: number
  clientX: number
  clientY: number
  moved: boolean
}
const MAX_GAPS = 32
const minimum = (field: LayoutField, grid = false): number =>
  field === 'gap' && !grid ? -10000 : 0
const bound = (field: LayoutField, value: number, grid = false): number =>
  Math.max(minimum(field, grid), Math.min(10000, value))

/** Render frame-local spacing bands, drag grips and a viewport-fitting numeric editor.
 * @param props - Resolved frame, original flow-order children, authoritative wrap lines and spacing mutations.
 * @returns Editor-only SVG controls and a portaled numeric draft; scene coordinates remain unchanged.
 */
export function DesignerLayoutOverlay({
  node,
  children,
  parentId = node.id,
  lines,
  zoom,
  labels,
  activeField,
  color = 'var(--dsw-alias-state-warn-primary)',
  onStart,
  onChange,
}: {
  node: CopyOSDesignNode
  children: readonly CopyOSDesignNode[]
  parentId?: string | undefined
  lines?: readonly DesignStackLine[] | undefined
  zoom: number
  labels: Record<LayoutField, string>
  activeField?: LayoutField | null | undefined
  color?: string | undefined
  onStart: (
    event: PointerEvent<SVGGElement>,
    field: LayoutField,
    currentValue: number,
  ) => void
  onChange: (field: LayoutField, value: number, modifiers?: Modifiers) => void
}): ReactNode {
  const overlay = useRef<SVGGElement>(null)
  const [viewport, setViewport] = useState<CanvasViewport | null>(null)
  const grid = node.layout === 'grid'
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState('')
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const editorRef = useRef<Editor | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const press = useRef<Press | null>(null)
  const modifiers = useRef<Modifiers>({ altKey: false, shiftKey: false })
  const finishRef = useRef<(commit: boolean, restoreFocus: boolean) => void>(
    () => {},
  )
  const latest = useRef({ onChange, nodeId: node.id })
  latest.current = { onChange, nodeId: node.id }
  // Read the actual nested/rotated SVG transform, including canvas pan and zoom.
  // Filter before capping controls so later visible tracks remain editable in huge grids.
  const measureViewport = (): void => {
    const group = overlay.current
    // Only grid controls use the viewport; reading the screen matrix forces a layout of the whole Canvas.
    if (!group || !grid) return
    const matrix =
      typeof group.getScreenCTM === 'function' ? group.getScreenCTM() : null
    if (!matrix) return
    const { a, b, c, d, e, f } = matrix
    const determinant = a * d - b * c
    if (!Number.isFinite(determinant) || determinant === 0) return
    const screen = group.ownerSVGElement?.getBoundingClientRect()
    const left = Math.max(0, screen?.left ?? 0),
      top = Math.max(0, screen?.top ?? 0)
    const right = Math.min(
      window.innerWidth,
      screen && screen.width > 0 ? screen.right : window.innerWidth,
    )
    const bottom = Math.min(
      window.innerHeight,
      screen && screen.height > 0 ? screen.bottom : window.innerHeight,
    )
    const corners =
      right <= left || bottom <= top
        ? [[left, top]]
        : [
          [left, top],
          [right, top],
          [left, bottom],
          [right, bottom],
        ]
    const points = corners.map(([x = 0, y = 0]) => ({
      x: (d * (x - e) - c * (y - f)) / determinant,
      y: (a * (y - f) - b * (x - e)) / determinant,
    }))
    const x = Math.min(...points.map(point => point.x)),
      y = Math.min(...points.map(point => point.y))
    const next = {
      a,
      b,
      c,
      d,
      e,
      f,
      screenLeft: left,
      screenTop: top,
      screenRight: right,
      screenBottom: bottom,
      x,
      y,
      width: Math.max(...points.map(point => point.x)) - x,
      height: Math.max(...points.map(point => point.y)) - y,
    }
    setViewport(current =>
      current &&
      Object.keys(next).every(
        key =>
          current[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? current
        : next,
    )
  }
  useLayoutEffect(measureViewport)
  useLayoutEffect(() => {
    window.addEventListener('resize', measureViewport)
    return () => {
      window.removeEventListener('resize', measureViewport)
    }
  }, [grid])
  const open = (value: Editor): void => {
    if (value.nodeId !== latest.current.nodeId) return
    editorRef.current = value
    setDraft(String(value.control.value))
    setEditor(value)
  }
  const finish = (commit: boolean, restoreFocus: boolean): void => {
    const current = editorRef.current
    if (!current) return
    editorRef.current = null
    setEditor(null)
    const value = parseDesignNumber(draft)
    const scope = modifiers.current.altKey ? modifiers.current : current.scope
    if (
      commit &&
      current.nodeId === node.id &&
      value !== null &&
      value >= minimum(current.control.field, grid) &&
      value <= 10000 &&
      (value !== current.control.value || scope.altKey)
    )
      onChange(current.control.field, value, scope)
    if (restoreFocus && current.anchor.isConnected)
      current.anchor.focus({ preventScroll: true })
  }
  finishRef.current = finish
  useLayoutEffect(() => {
    press.current = null
    editorRef.current = null
    setEditor(null)
    setHovered(null)
    setFocused(null)
    const move = (event: globalThis.PointerEvent): void => {
      const current = press.current
      if (
        current?.pointerId === event.pointerId &&
        Math.hypot(
          event.clientX - current.clientX,
          event.clientY - current.clientY,
        ) >= 3
      )
        current.moved = true
    }
    const up = (event: globalThis.PointerEvent): void => {
      const current = press.current
      if (!current || current.pointerId !== event.pointerId) return
      press.current = null
      if (
        !current.moved &&
        Math.hypot(
          event.clientX - current.clientX,
          event.clientY - current.clientY,
        ) < 3
      )
        open(current)
    }
    const cancel = (): void => {
      press.current = null
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', cancel)
    return () => {
      press.current = null
      editorRef.current = null
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', cancel)
    }
  }, [node.id, parentId, node.locked, node.visible, node.layout])
  const placeEditor = (): void => {
    if (!editor) return
    const box = editor.anchor.getBoundingClientRect()
    const width = 104,
      height = 36,
      margin = 8
    const next = {
      left: Math.max(
        margin,
        Math.min(
          window.innerWidth - width - margin,
          box.left + box.width / 2 - width / 2,
        ),
      ),
      top: Math.max(
        margin,
        Math.min(
          window.innerHeight - height - margin,
          box.bottom + height + margin <= window.innerHeight
            ? box.bottom + margin
            : box.top - height - margin,
        ),
      ),
    }
    setPosition(current =>
      current.left === next.left && current.top === next.top ? current : next,
    )
  }
  useLayoutEffect(placeEditor)
  useLayoutEffect(() => {
    if (!editor) return
    input.current?.focus({ preventScroll: true })
    input.current?.select()
    const outside = (event: globalThis.PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        input.current?.parentElement?.contains(target) ||
        editor.anchor.contains(target)
      )
        return
      finishRef.current(true, false)
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', placeEditor)
    window.addEventListener('scroll', placeEditor, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', placeEditor)
      window.removeEventListener('scroll', placeEditor, true)
    }
  }, [editor])
  if (
    node.locked ||
    !node.visible ||
    !['row', 'column', 'grid'].includes(node.layout) ||
    !['frame', 'component', 'group'].includes(node.kind)
  )
    return null
  const box = designLayoutBox({ ...node, preserveLayout: false })
  const padding = {
    paddingTop: node.paddingTop ?? node.padding,
    paddingRight: node.paddingRight ?? node.padding,
    paddingBottom: node.paddingBottom ?? node.padding,
    paddingLeft: node.paddingLeft ?? node.padding,
  }
  const stroke = box.left - padding.paddingLeft
  const innerWidth = Math.max(0, node.width - 2 * stroke),
    innerHeight = Math.max(0, node.height - 2 * stroke)
  const top = Math.min(padding.paddingTop, innerHeight),
    bottom = Math.min(padding.paddingBottom, innerHeight)
  const left = Math.min(padding.paddingLeft, innerWidth),
    right = Math.min(padding.paddingRight, innerWidth)
  const controls: Control[] = []
  // At smaller sizes there is no room between outer resize handles; the inspector remains available.
  const paddingHandles = node.width * zoom >= 48 && node.height * zoom >= 48
  {
    const near = (value: number, size: number): number =>
      Math.max(14 / zoom, Math.min(size / 2 - 8 / zoom, value))
    const far = (value: number, size: number): number =>
      Math.min(size - 14 / zoom, Math.max(size / 2 + 8 / zoom, value))
    controls.push(
      {
        key: 'paddingTop',
        field: 'paddingTop',
        value: padding.paddingTop,
        x: node.width / 2,
        y: near(stroke + top, node.height),
        horizontal: false,
        band: { x: stroke, y: stroke, width: innerWidth, height: top },
      },
      {
        key: 'paddingBottom',
        field: 'paddingBottom',
        value: padding.paddingBottom,
        x: node.width / 2,
        y: far(node.height - stroke - bottom, node.height),
        horizontal: false,
        band: {
          x: stroke,
          y: node.height - stroke - bottom,
          width: innerWidth,
          height: bottom,
        },
      },
      {
        key: 'paddingLeft',
        field: 'paddingLeft',
        value: padding.paddingLeft,
        x: near(stroke + left, node.width),
        y: node.height / 2,
        horizontal: true,
        band: {
          x: stroke,
          y: stroke + top,
          width: left,
          height: Math.max(0, innerHeight - top - bottom),
        },
      },
      {
        key: 'paddingRight',
        field: 'paddingRight',
        value: padding.paddingRight,
        x: far(node.width - stroke - right, node.width),
        y: node.height / 2,
        horizontal: true,
        band: {
          x: node.width - stroke - right,
          y: stroke + top,
          width: right,
          height: Math.max(0, innerHeight - top - bottom),
        },
      },
    )
  }
  const row = node.layout === 'row'
  const flow = children.filter(
    child =>
      child.parentId === parentId && child.visible && !child.absolutePosition,
  )
  if (node.layout !== 'grid' && !node.preserveLayout) {
    const groups = lines
      ? lines
        .filter(line => !line.mainGapAutomatic)
        .map(line =>
          flow.filter(child => line.nodeIds.includes(child.id)),
        )
      : node.layoutWrap === 'wrap' ||
          ((node[row ? 'widthSizing' : 'heightSizing'] ?? 'hug') !== 'hug' &&
            ['between', 'evenly', 'around'].includes(
              node.justifyContent ?? 'start',
            ))
        ? []
        : [flow]
    let count = 0
    for (const group of groups) {
      for (let index = 1; index < group.length && count < MAX_GAPS; index++) {
        const before = group[index - 1],
          after = group[index]
        if (!before || !after) continue
        const start = row ? before.x + before.width : before.y + before.height
        const end = row ? after.x : after.y
        const low = Math.min(start, end),
          size = Math.abs(end - start)
        const crossStart = Math.max(
          row ? before.y : before.x,
          row ? after.y : after.x,
        )
        const crossEnd = Math.min(
          row ? before.y + before.height : before.x + before.width,
          row ? after.y + after.height : after.x + after.width,
        )
        const crossMiddle =
          crossEnd > crossStart
            ? (crossStart + crossEnd) / 2
            : row
              ? node.height / 2
              : node.width / 2
        const crossSize = Math.max(0, crossEnd - crossStart)
        controls.push({
          key: `gap:${before.id}:${after.id}`,
          field: 'gap',
          value: node.gap,
          x: row ? (start + end) / 2 : crossMiddle,
          y: row ? crossMiddle : (start + end) / 2,
          horizontal: row,
          band: row
            ? { x: low, y: crossStart, width: size, height: crossSize }
            : { x: crossStart, y: low, width: crossSize, height: size },
        })
        count++
      }
    }
  }
  if (
    node.layoutWrap === 'wrap' &&
    node.layout !== 'grid' &&
    !node.preserveLayout &&
    lines &&
    !lines.some(line => line.crossGapAutomatic)
  ) {
    for (let index = 1; index < lines.length && index <= MAX_GAPS; index++) {
      const before = lines[index - 1],
        after = lines[index]
      if (!before || !after) continue
      const start = before.crossStart + before.crossSize,
        end = after.crossStart
      const mainStart = row ? box.left : box.top
      const mainSize = Math.max(
        0,
        row
          ? node.width - box.left - box.right
          : node.height - box.top - box.bottom,
      )
      controls.push({
        key: `crossGap:${index}`,
        field: 'crossGap',
        value: node.crossGap ?? Math.max(0, node.gap),
        x: row ? mainStart + mainSize / 2 : (start + end) / 2,
        y: row ? (start + end) / 2 : mainStart + mainSize / 2,
        horizontal: !row,
        band: row
          ? {
            x: mainStart,
            y: Math.min(start, end),
            width: mainSize,
            height: Math.abs(end - start),
          }
          : {
            x: Math.min(start, end),
            y: mainStart,
            width: Math.abs(end - start),
            height: mainSize,
          },
      })
    }
  }
  if (grid && !node.preserveLayout) {
    const geometry = designGridGeometry({ ...node, id: parentId }, flow)
    const bounds = {
      left: Math.max(box.left, viewport?.x ?? box.left),
      top: Math.max(box.top, viewport?.y ?? box.top),
      right: Math.min(
        node.width - box.right,
        viewport ? viewport.x + viewport.width : node.width,
      ),
      bottom: Math.min(
        node.height - box.bottom,
        viewport ? viewport.y + viewport.height : node.height,
      ),
    }
    const candidates: [Control[], Control[]] = [[], []]
    for (const column of [true, false]) {
      const offsets = column ? geometry.columnOffsets : geometry.rowOffsets
      const sizes = column ? geometry.columns : geometry.rows
      const crossOffsets = column ? geometry.rowOffsets : geometry.columnOffsets
      const crossSizes = column ? geometry.rows : geometry.columns
      const value = Math.max(0, column ? node.gap : (node.crossGap ?? node.gap))
      const low = column ? bounds.left : bounds.top,
        high = column ? bounds.right : bounds.bottom
      const crossLow = column ? bounds.top : bounds.left,
        crossHigh = column ? bounds.bottom : bounds.right
      for (let index = 0; index < sizes.length - 1; index++) {
        const start = (offsets[index] ?? 0) + (sizes[index] ?? 0)
        const end = offsets[index + 1] ?? start
        // Zero gaps keep a narrow grip but never paint an artificial spacing band.
        if (end < start || end < low || start > high || crossHigh <= crossLow)
          continue
        const mainLow = Math.max(low, start),
          mainHigh = Math.min(high, end)
        let visibleLow = crossLow,
          visibleHigh = crossHigh
        if (viewport) {
          const main = (mainLow + mainHigh) / 2
          const constraints = column
            ? [
              [
                viewport.c,
                viewport.a * main + viewport.e,
                viewport.screenLeft,
                viewport.screenRight,
              ],
              [
                viewport.d,
                viewport.b * main + viewport.f,
                viewport.screenTop,
                viewport.screenBottom,
              ],
            ]
            : [
              [
                viewport.a,
                viewport.c * main + viewport.e,
                viewport.screenLeft,
                viewport.screenRight,
              ],
              [
                viewport.b,
                viewport.d * main + viewport.f,
                viewport.screenTop,
                viewport.screenBottom,
              ],
            ]
          for (const [
            coefficient = 0,
            offset = 0,
            min = 0,
            max = 0,
          ] of constraints) {
            if (Math.abs(coefficient) < 1e-10) {
              if (offset < min || offset > max) visibleHigh = visibleLow
            } else {
              const a = (min - offset) / coefficient,
                b = (max - offset) / coefficient
              visibleLow = Math.max(visibleLow, Math.min(a, b))
              visibleHigh = Math.min(visibleHigh, Math.max(a, b))
            }
          }
        }
        if (visibleHigh <= visibleLow) continue
        let segments: Array<[number, number]> = [[visibleLow, visibleHigh]]
        for (const placement of geometry.placements) {
          const main = column ? placement.column : placement.row
          const span = column ? placement.columnSpan : placement.rowSpan
          if (main > index || main + span <= index + 1) continue
          const cross = column ? placement.row : placement.column
          const crossSpan = column ? placement.rowSpan : placement.columnSpan
          const from = crossOffsets[cross] ?? 0
          const last = cross + crossSpan - 1
          const to = (crossOffsets[last] ?? from) + (crossSizes[last] ?? 0)
          segments = segments.flatMap(([a, b]) => {
            if (to <= a || from >= b) return [[a, b]]
            return [
              ...(from > a ? [[a, from] as [number, number]] : []),
              ...(to < b ? [[to, b] as [number, number]] : []),
            ]
          })
        }
        for (const [segment, [from, to]] of segments.entries()) {
          if ((to - from) * zoom < 22) continue
          const x = column ? (mainLow + mainHigh) / 2 : (from + to) / 2
          const y = column ? (from + to) / 2 : (mainLow + mainHigh) / 2
          if (Math.min(x, y, node.width - x, node.height - y) * zoom < 16)
            continue
          candidates[column ? 0 : 1].push({
            key: `grid:${column ? 'column' : 'row'}:${index}:${segment}`,
            field: column ? 'gap' : 'crossGap',
            value,
            x,
            y,
            horizontal: column,
            band: column
              ? {
                x: mainLow,
                y: from,
                width: Math.max(0, mainHigh - mainLow),
                height: to - from,
              }
              : {
                x: from,
                y: mainLow,
                width: to - from,
                height: Math.max(0, mainHigh - mainLow),
              },
          })
          if (candidates[column ? 0 : 1].length >= MAX_GAPS) break
        }
        if (candidates[column ? 0 : 1].length >= MAX_GAPS) break
      }
    }
    // Alternate axes so a dense set of columns does not hide row spacing.
    for (
      let index = 0, count = 0;
      index < MAX_GAPS && count < MAX_GAPS;
      index++
    ) {
      for (const axis of candidates) {
        const candidate = axis[index]
        if (candidate && count < MAX_GAPS) {
          controls.push(candidate)
          count++
        }
      }
    }
  }
  const parsed = parseDesignNumber(draft)
  const invalid =
    editor &&
    (parsed === null ||
      parsed < minimum(editor.control.field, grid) ||
      parsed > 10000)
  return (
    <>
      <g
        ref={overlay}
        color={color}
        data-designer-layout-overlay="true"
        pointerEvents="none"
      >
        {controls.map((control) => {
          const highlight = hovered === control.key || focused === control.key
          const visible = highlight || activeField === control.field
          const width = (control.horizontal ? 3 : 16) / zoom,
            height = (control.horizontal ? 16 : 3) / zoom
          const hitWidth = (control.horizontal ? 12 : 22) / zoom,
            hitHeight = (control.horizontal ? 22 : 12) / zoom
          const interactive = control.field.startsWith('padding')
            ? paddingHandles
            : Math.min(
              control.x,
              control.y,
              node.width - control.x,
              node.height - control.y,
            ) *
                zoom >=
              16
          return (
            <g key={control.key}>
              <rect
                {...control.band}
                data-designer-layout-band={control.field}
                fill="currentColor"
                fillOpacity={visible ? 0.12 : 0}
                aria-hidden="true"
                pointerEvents="none"
              />
              {interactive ? (
                <g
                  role="slider"
                  tabIndex={0}
                  aria-label={labels[control.field]}
                  aria-valuenow={control.value}
                  aria-valuemin={minimum(control.field, grid)}
                  aria-valuemax={10000}
                  aria-orientation={
                    control.horizontal ? 'horizontal' : 'vertical'
                  }
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter"
                  data-designer-layout-handle={control.field}
                  style={{
                    cursor: control.horizontal ? 'ew-resize' : 'ns-resize',
                    outline: 'none',
                    touchAction: 'none',
                  }}
                  onPointerEnter={() => {
                    setHovered(control.key)
                  }}
                  onPointerLeave={() => {
                    setHovered(null)
                  }}
                  onFocus={() => {
                    setFocused(control.key)
                  }}
                  onBlur={() => {
                    setFocused(null)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    event.stopPropagation()
                    event.currentTarget.focus({ preventScroll: true })
                    modifiers.current = {
                      altKey: event.altKey,
                      shiftKey: event.shiftKey,
                    }
                    press.current = {
                      control,
                      anchor: event.currentTarget,
                      nodeId: node.id,
                      scope: modifiers.current,
                      pointerId: event.pointerId,
                      clientX: event.clientX,
                      clientY: event.clientY,
                      moved: false,
                    }
                    onStart(event, control.field, control.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.ctrlKey || event.metaKey) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      modifiers.current = {
                        altKey: event.altKey,
                        shiftKey: event.shiftKey,
                      }
                      open({
                        control,
                        anchor: event.currentTarget,
                        nodeId: node.id,
                        scope: modifiers.current,
                      })
                      return
                    }
                    if (
                      ![
                        'ArrowUp',
                        'ArrowDown',
                        'ArrowLeft',
                        'ArrowRight',
                        'Home',
                      ].includes(event.key)
                    )
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    const value =
                      event.key === 'Home'
                        ? 0
                        : bound(
                          control.field,
                          control.value +
                              (event.key === 'ArrowUp' ||
                              event.key === 'ArrowRight'
                                ? 1
                                : -1) *
                                (event.shiftKey ? 10 : 1),
                          grid,
                        )
                    if (value !== control.value || event.altKey)
                      onChange(control.field, value, {
                        altKey: event.altKey,
                        shiftKey: event.shiftKey,
                      })
                  }}
                >
                  <title>{`${labels[control.field]}: ${control.value}`}</title>
                  <rect
                    x={control.x - hitWidth / 2}
                    y={control.y - hitHeight / 2}
                    width={hitWidth}
                    height={hitHeight}
                    fill="transparent"
                    pointerEvents="all"
                    data-designer-layout-hit="true"
                  />
                  <rect
                    x={control.x - width / 2}
                    y={control.y - height / 2}
                    width={width}
                    height={height}
                    rx={1.5 / zoom}
                    fill="currentColor"
                    fillOpacity={highlight ? 1 : 0.75}
                    pointerEvents="none"
                  />
                  {focused === control.key ? (
                    <rect
                      x={control.x - hitWidth / 2 - 2 / zoom}
                      y={control.y - hitHeight / 2 - 2 / zoom}
                      width={hitWidth + 4 / zoom}
                      height={hitHeight + 4 / zoom}
                      rx={3 / zoom}
                      fill="none"
                      stroke="var(--designer-blue, #0d99ff)"
                      strokeWidth={2 / zoom}
                      pointerEvents="none"
                    />
                  ) : null}
                  {highlight ? (
                    <g pointerEvents="none" aria-hidden="true">
                      <rect
                        x={control.x - 20 / zoom}
                        y={control.y - 27 / zoom}
                        width={40 / zoom}
                        height={18 / zoom}
                        rx={4 / zoom}
                        fill="var(--dsw-alias-bg-base)"
                      />
                      <text
                        x={control.x}
                        y={control.y - 14 / zoom}
                        textAnchor="middle"
                        fontSize={11 / zoom}
                        fill="var(--dsw-alias-label-primary)"
                      >
                        {Math.round(control.value * 100) / 100}
                      </text>
                    </g>
                  ) : null}
                </g>
              ) : null}
            </g>
          )
        })}
      </g>
      {editor
        ? createPortal(
          <div
            className={css.designerPopover}
            role="dialog"
            aria-label={labels[editor.control.field]}
            data-designer-layout-editor="true"
            style={{
              ...position,
              width: 104,
              padding: 4,
              borderRadius: 6,
              overflow: 'visible',
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <input
              ref={input}
              type="text"
              inputMode="decimal"
              role="spinbutton"
              value={draft}
              aria-label={labels[editor.control.field]}
              aria-valuemin={minimum(editor.control.field, grid)}
              aria-valuemax={10000}
              aria-valuenow={parseDesignNumber(draft) ?? undefined}
              aria-invalid={invalid || undefined}
              style={{
                width: '100%',
                height: 28,
                margin: 0,
                boxSizing: 'border-box',
                border: '0.5px solid var(--dsw-alias-border-l1)',
              }}
              onChange={(event) => {
                setDraft(event.currentTarget.value)
              }}
              onBlur={() => {
                finish(true, false)
              }}
              onKeyDown={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === 's'
                )
                  return
                event.stopPropagation()
                modifiers.current = {
                  altKey: event.altKey,
                  shiftKey: event.shiftKey,
                }
                if (event.key === 'Escape' || event.key === 'Enter') {
                  event.preventDefault()
                  finish(event.key === 'Enter', true)
                }
              }}
            />
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
