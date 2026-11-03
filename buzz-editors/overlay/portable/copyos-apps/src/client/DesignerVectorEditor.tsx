/** Ephemeral point editing projected from the authoritative SVG path data. */
import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react'
import {
  moveDesignPathPoint, parseDesignPathContours, splitDesignPathSegment, nearestDesignPathSegmentParameter,
  deleteDesignPathAnchors, moveDesignPathAnchors, joinDesignPathEndpoints, canJoinDesignPathEndpoints,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerVectorEditor.module.css'

type PathData = NonNullable<CopyOSDesignNode['pathData']>
type Target = { pathIndex: number; commandIndex: number; kind: 'anchor' | 'incoming' | 'outgoing' }
/** Draw fixed screen-size handles and transact each complete point gesture as one edit.
 * @param props - Current source geometry, localized labels and document transaction actions.
 * @returns The node-local SVG editing overlay.
 */
export function DesignerVectorEditor({ pathData, width, height, zoom, t, toolbar, onPreview, onCommit, onCancel }: {
  pathData: PathData
  width: number
  height: number
  zoom: number
  toolbar?: HTMLElement | null
  t: (key: CopyOSFoundationLocaleKey) => string
  onPreview: (data: PathData) => void
  onCommit: (data: PathData) => void
  onCancel: () => void
}): ReactNode {
  const [selectedPoint, setSelectedPoint] = useState('')
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([])
  const anchorSelection = useRef<string[]>([])
  const pointerFocus = useRef(false)
  const entered = useRef(false)
  const topology = useRef('')
  const anchorKey = (target: Pick<Target, 'pathIndex' | 'commandIndex'>): string => `${target.pathIndex}:${target.commandIndex}`
  const selectAnchors = (keys: string[]): void => { anchorSelection.current = keys; setSelectedAnchors(keys) }
  const pointKey = (target: Target): string => `${target.pathIndex}:${target.commandIndex}:${target.kind}`
  const group = useRef<SVGGElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const drag = useRef<{ target: Target; targets: Pick<Target, 'pathIndex' | 'commandIndex'>[]; start: { x: number; y: number }; point: { x: number; y: number }; original: PathData; latest: PathData; pointerId: number } | null>(null)
  const callbacks = useRef({ onPreview, onCommit, onCancel })
  callbacks.current = { onPreview, onCommit, onCancel }
  const [linear, setLinear] = useState([1 / zoom, 0, 0, 1 / zoom])
  // Cancel abandoned gestures on selection/page changes and loss of window focus.
  useEffect(() => {
    const cancel = (): void => { if (drag.current) { drag.current = null; callbacks.current.onCancel() } }
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [])
  const contours = parseDesignPathContours(pathData)
  const anchors = contours.flatMap(contour => contour.anchors)
  const topologyKey = contours.map(contour => `${contour.pathIndex}:${contour.commandIndex}:${contour.closed}:${contour.anchors.map(anchor => anchor.commandIndex).join(',')}`).join('|')
  useLayoutEffect(() => {
    if (!entered.current) { entered.current = true; group.current?.focus() }
    const key = pendingFocus.current
    if (topology.current !== topologyKey) {
      topology.current = topologyKey
      if (key === null) { selectAnchors([]); setSelectedPoint('') }
    }
    if (key !== null) {
      pendingFocus.current = null
      const anchor = group.current?.querySelector<SVGCircleElement>(`[data-vector-anchor="${key}"]`)
      if (anchor) anchor.focus()
      else group.current?.focus()
    }
    const matrix = group.current?.getScreenCTM()
    if (!matrix) return
    const inverse = matrix.inverse()
    const next = [inverse.a, inverse.b, inverse.c, inverse.d]
    setLinear(previous => previous.every((value, index) => value === next[index]) ? previous : next)
  })
  const glyphTransform = (x: number, y: number): string => `matrix(${linear.join(' ')} ${x} ${y})`
  const targetsFor = (target: Target): Pick<Target, 'pathIndex' | 'commandIndex'>[] => {
    const keys = new Set(anchorSelection.current.length ? anchorSelection.current : [anchorKey(target)])
    return anchors.filter(anchor => keys.has(anchorKey(anchor))).map(({ pathIndex, commandIndex }) => ({ pathIndex, commandIndex }))
  }
  const begin = (event: PointerEvent<SVGCircleElement>, target: Target, point: { x: number; y: number }): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const inverse = group.current?.getScreenCTM()?.inverse()
    if (!inverse) return
    const key = anchorKey(target)
    if (target.kind === 'anchor') {
      const previous = anchorSelection.current
      const next = event.shiftKey
        ? previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]
        : previous.includes(key) ? previous : [key]
      selectAnchors(next)
    } else selectAnchors([])
    pointerFocus.current = true
    event.currentTarget.focus()
    pointerFocus.current = false
    setSelectedPoint(pointKey(target))
    if (target.kind === 'anchor' && !anchorSelection.current.includes(key)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { target, targets: target.kind === 'anchor' ? targetsFor(target) : [], point,
      start: { x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
        y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f },
      original: pathData, latest: pathData, pointerId: event.pointerId }
  }
  const keyDown = (event: KeyboardEvent<SVGElement>, target: Target, x: number, y: number): void => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation()
      if (target.kind !== 'anchor' || drag.current) return
      const index = anchors.findIndex(anchor => anchor.pathIndex === target.pathIndex && anchor.commandIndex === target.commandIndex)
      const nextData = deleteDesignPathAnchors(pathData, targetsFor(target), event.shiftKey ? 'heal' : 'delete')
      const nextAnchors = parseDesignPathContours(nextData).flatMap(contour => contour.anchors)
      const next = nextAnchors[Math.min(index, nextAnchors.length - 1)]
      pendingFocus.current = next ? `${next.pathIndex}:${next.commandIndex}` : ''
      selectAnchors(next ? [anchorKey(next)] : [])
      setSelectedPoint(next ? pointKey({ ...next, kind: 'anchor' }) : '')
      onCommit(nextData)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (drag.current) return
    const inverse = group.current?.getScreenCTM()?.inverse()
    if (!inverse) return
    const step = event.shiftKey ? 10 : 1
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    const localX = inverse.a * dx + inverse.c * dy, localY = inverse.b * dx + inverse.d * dy
    onCommit(target.kind === 'anchor'
      ? moveDesignPathAnchors(pathData, targetsFor(target), localX, localY)
      : moveDesignPathPoint(pathData, target, x + localX, y + localY))
  }
  const joinTargets = anchors.filter(anchor => selectedAnchors.includes(anchorKey(anchor)))
    .map(({ pathIndex, commandIndex }) => ({ pathIndex, commandIndex }))
  const canJoin = canJoinDesignPathEndpoints(pathData, joinTargets)
  const join = (): void => {
    if (!canJoin || drag.current) return
    const next = joinDesignPathEndpoints(pathData, joinTargets)
    pendingFocus.current = ''
    selectAnchors([]); setSelectedPoint('')
    onCommit(next)
  }
  const move = (event: PointerEvent<SVGGElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    const inverse = group.current?.getScreenCTM()?.inverse()
    if (!inverse) return
    const x = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e
    const y = inverse.b * event.clientX + inverse.d * event.clientY + inverse.f
    const dx = x - current.start.x, dy = y - current.start.y
    current.latest = current.target.kind === 'anchor'
      ? moveDesignPathAnchors(current.original, current.targets, dx, dy)
      : moveDesignPathPoint(current.original, current.target, current.point.x + dx, current.point.y + dy)
    callbacks.current.onPreview(current.latest)
  }
  return <>{toolbar ? createPortal(<button type="button" aria-label={t('designerVectorJoin')}
    title={canJoin ? t('designerVectorJoinShortcut') : t('designerVectorJoinReason')} disabled={!canJoin}
    onPointerDown={(event) => { event.stopPropagation() }}
    onPointerUp={(event) => { event.stopPropagation() }}
    onDoubleClick={(event) => { event.stopPropagation() }}
    onClick={(event) => { event.stopPropagation(); join() }} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault(); event.stopPropagation(); join()
      }
    }}>{t('designerVectorJoinShort')}</button>, toolbar) : null}<g ref={group} data-designer-vector-editor="true" className={css.editor} tabIndex={-1}
    role="group" aria-label={t('designerVectorSelection').replace('{count}', String(selectedAnchors.length))}
    transform={`scale(${width / pathData.width} ${height / pathData.height})`}
    onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault(); event.stopPropagation(); join()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation()
        if (drag.current) return
        selectAnchors(anchors.map(anchorKey)); setSelectedPoint(''); group.current?.focus()
      } else if (['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const selected = anchors.find(anchor => anchorSelection.current.includes(anchorKey(anchor)))
        if (selected) keyDown(event, { ...selected, kind: 'anchor' }, selected.x, selected.y)
      }
    }}
    onPointerDown={(event) => { event.stopPropagation() }} onDoubleClick={(event) => { event.stopPropagation() }}
    onPointerMove={move} onPointerUp={(event) => {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      event.stopPropagation(); drag.current = null
      if (current.latest !== current.original) callbacks.current.onCommit(current.latest)
    }} onPointerCancel={() => { if (drag.current) { drag.current = null; callbacks.current.onCancel() } }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; callbacks.current.onCancel() } }}>
    {contours.flatMap(contour => contour.segments.map(segment => <path key={`${contour.pathIndex}:${segment.commandIndex}`}
      d={segment.d} className={css.segment} vectorEffect="non-scaling-stroke" strokeWidth={8}
      aria-label={t('designerVectorSegment')} data-vector-segment={`${contour.pathIndex}:${segment.commandIndex}`}
      onDoubleClick={(event) => {
        event.preventDefault(); event.stopPropagation()
        const inverse = group.current?.getScreenCTM()?.inverse()
        if (!inverse) return
        const x = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e
        const y = inverse.b * event.clientX + inverse.d * event.clientY + inverse.f
        const parameter = nearestDesignPathSegmentParameter(pathData, contour.pathIndex, segment.commandIndex, x, y)
        if (parameter <= 1e-6 || parameter >= 1 - 1e-6) return
        pendingFocus.current = `${contour.pathIndex}:${segment.commandIndex}`
        selectAnchors([pendingFocus.current])
        onCommit(splitDesignPathSegment(pathData, contour.pathIndex, segment.commandIndex, parameter))
      }} />))}
    {contours.flatMap(contour => contour.anchors.map(anchor => <g key={`${contour.pathIndex}:${anchor.commandIndex}`}>
      {(['incoming', 'outgoing'] as const).map((kind) => {
        const handle = anchor[kind]
        return handle ? <g key={kind}>
          <line x1={anchor.x} y1={anchor.y} x2={handle.x} y2={handle.y} className={css.arm} vectorEffect="non-scaling-stroke" />
          <circle transform={glyphTransform(handle.x, handle.y)} r={4} className={css.control}
            tabIndex={0} role="button"
            aria-pressed={selectedPoint === pointKey({ pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind })}
            onFocus={() => {
              setSelectedPoint(pointKey({ pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind }))
              if (!pointerFocus.current) selectAnchors([])
            }}
            onKeyDown={(event) => {
              keyDown(event, { pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind }, handle.x, handle.y)
            }}
            aria-label={t(kind === 'incoming' ? 'designerVectorIncoming' : 'designerVectorOutgoing')}
            data-vector-control={`${contour.pathIndex}:${anchor.commandIndex}:${kind}`}
            onPointerDown={(event) => {
              begin(event, { pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind }, handle)
            }} />
        </g> : null
      })}
      <circle transform={glyphTransform(anchor.x, anchor.y)} r={4} className={css.anchor}
        tabIndex={0} role="button"
        aria-pressed={selectedAnchors.includes(anchorKey(anchor))}
        onFocus={() => {
          setSelectedPoint(pointKey({ pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind: 'anchor' }))
          if (!pointerFocus.current && !anchorSelection.current.includes(anchorKey(anchor))) selectAnchors([anchorKey(anchor)])
        }}
        onKeyDown={(event) => {
          keyDown(event, { pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind: 'anchor' }, anchor.x, anchor.y)
        }}
        aria-label={t('designerVectorAnchor')} data-vector-anchor={`${contour.pathIndex}:${anchor.commandIndex}`}
        onPointerDown={(event) => {
          begin(event, { pathIndex: contour.pathIndex, commandIndex: anchor.commandIndex, kind: 'anchor' }, anchor)
        }} />
    </g>))}
  </g></>
}
