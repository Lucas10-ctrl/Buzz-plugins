/** SVG grid guides expose real track resizing without adding design layers. */
import type { PointerEvent, ReactNode } from 'react'
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  designGridGeometry,
  type DesignLayoutBox,
  defaultDesignGrid,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Show track boundaries and keyboard/pointer resizing affordances.
 * @param props - Computed parent/children, zoom and native track resize callbacks.
 * @returns Editor-only guides and focusable separators.
 */
export function DesignerGridOverlay({
  node,
  boxes,
  children,
  zoom,
  color,
  handles,
  t,
  onStart,
  onResize,
}: {
  node: CopyOSDesignNode
  boxes?: ReadonlyMap<string, DesignLayoutBox> | undefined
  children: readonly CopyOSDesignNode[]
  zoom: number
  color: string
  handles: boolean
  t: (key: CopyOSFoundationLocaleKey) => string
  onStart: (
    e: PointerEvent<SVGGElement>,
    axis: 'columns' | 'rows',
    index: number,
    size: number,
  ) => void
  onResize: (axis: 'columns' | 'rows', index: number, size: number) => void
}): ReactNode {
  const geometry = designGridGeometry(node, children, {}, boxes),
    grid = node.grid ?? defaultDesignGrid()
  const track = (
    axis: 'columns' | 'rows',
    index: number,
    size: number,
  ): ReactNode => {
    const column = axis === 'columns',
      offset = column
        ? (geometry.columnOffsets[index] ?? 0)
        : (geometry.rowOffsets[index] ?? 0)
    const config = grid[axis][index] ?? grid.implicitRow
    const label = t(
      column ? 'designerGridResizeColumn' : 'designerGridResizeRow',
    ).replace('{number}', String(index + 1))
    const text =
      config.sizing === 'fill'
        ? `${config.value}${t('designerGridFraction')}`
        : config.sizing === 'hug'
          ? t('designerHugShort')
          : `${Math.round(size * 10) / 10}${t('designerPixels')}`
    return (
      <g key={`${axis}:${index}`}>
        <line
          x1={column ? offset : (node.paddingLeft ?? node.padding)}
          x2={
            column ? offset : node.width - (node.paddingRight ?? node.padding)
          }
          y1={column ? (node.paddingTop ?? node.padding) : offset}
          y2={
            column ? node.height - (node.paddingBottom ?? node.padding) : offset
          }
          stroke="currentColor"
          strokeDasharray={`${3 / zoom} ${3 / zoom}`}
          strokeWidth={1 / zoom}
          opacity={0.3}
          pointerEvents="none"
        />
        {handles ? (
          <g
            role="separator"
            tabIndex={0}
            aria-label={label}
            aria-orientation={column ? 'vertical' : 'horizontal'}
            aria-valuenow={Math.round(size * 100) / 100}
            aria-valuemin={1}
            aria-valuemax={100000}
            className={column ? css.gridColumnHandle : css.gridRowHandle}
            onPointerDown={(e) => {
              onStart(e, axis, index, size)
            }}
            onKeyDown={(e) => {
              if (
                !(
                  column
                    ? ['ArrowLeft', 'ArrowRight']
                    : ['ArrowUp', 'ArrowDown']
                ).includes(e.key)
              )
                return
              e.preventDefault()
              e.stopPropagation()
              onResize(
                axis,
                index,
                Math.max(
                  1,
                  Math.min(
                    100000,
                    size +
                      (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) *
                        (e.shiftKey ? 10 : 1),
                  ),
                ),
              )
            }}
          >
            <title>{label}</title>
            <rect
              className={css.gridTrackHit}
              x={column ? offset + size - 4 / zoom : -4 / zoom}
              y={column ? -4 / zoom : offset + size - 4 / zoom}
              width={column ? 8 / zoom : node.width + 8 / zoom}
              height={column ? node.height + 8 / zoom : 8 / zoom}
            />
            <rect
              className={css.gridTrackPill}
              x={column ? offset + size / 2 - 26 / zoom : -58 / zoom}
              y={column ? -37 / zoom : offset + size / 2 - 10 / zoom}
              width={52 / zoom}
              height={20 / zoom}
              rx={4 / zoom}
              stroke="currentColor"
              strokeWidth={1 / zoom}
            />
            <text
              x={column ? offset + size / 2 : -32 / zoom}
              y={column ? -23 / zoom : offset + size / 2 + 4 / zoom}
              fontSize={11 / zoom}
              textAnchor="middle"
              fill="currentColor"
              pointerEvents="none"
            >
              {text}
            </text>
          </g>
        ) : null}
      </g>
    )
  }
  return (
    <g color={color} data-designer-grid-guide="true">
      {geometry.columns.map((size, i) => track('columns', i, size))}
      {geometry.rows.map((size, i) => track('rows', i, size))}
    </g>
  )
}
