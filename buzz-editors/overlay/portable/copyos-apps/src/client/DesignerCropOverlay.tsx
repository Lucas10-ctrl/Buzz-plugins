/** Crop guides live above the scene so image handles remain reachable through nested frames. */
import {
  useId,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  CopyOSDesignNode,
  CopyOSDesignPaint,
} from '../../../copyos-domain/src/types.ts'
import {
  designImageGeometry,
  designRectanglePath,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { useDesignerImageHref } from './DesignerImageAssets.ts'
import css from './PageDesignerWorkspace.module.css'
/** Canvas crop manipulation target. */
export type CropHandleKind = 'pan' | 'frame' | 'image' | 'rotate'
/** Render an editable crop window and full-raster guides without adding scene layers.
 * @param props - Computed layer, active image paint, world transform and crop interaction callbacks.
 * @returns Image ghost, crop window, image scale/rotation handles and accessible keyboard targets.
 */
export function DesignerCropOverlay({
  node,
  paint,
  transform,
  zoom,
  extent,
  t,
  onStart,
  onKey,
}: {
  node: CopyOSDesignNode
  paint: CopyOSDesignPaint
  transform: string
  zoom: number
  extent: number
  t: (key: CopyOSFoundationLocaleKey) => string
  onStart: (
    e: PointerEvent<SVGElement>,
    kind: CropHandleKind,
    handle: string,
  ) => void
  onKey: (
    e: KeyboardEvent<SVGElement>,
    kind: CropHandleKind,
    handle: string,
  ) => void
}): ReactNode {
  const id = useId().replaceAll(':', ''),
    image = paint.image, href = useDesignerImageHref(image?.url ?? '')
  if (!image) return null
  const geometry = designImageGeometry(image, node.width, node.height),
    size = 7 / zoom,
    overscan = (extent * 2) / zoom
  const boundary =
    node.kind === 'ellipse' ? (
      <ellipse
        cx={node.width / 2}
        cy={node.height / 2}
        rx={node.width / 2}
        ry={node.height / 2}
      />
    ) : node.kind === 'path' && node.pathData ? (
      <g
        transform={`scale(${node.width / node.pathData.width} ${node.height / node.pathData.height})`}
      >
        {node.pathData.paths.map((path, i) => (
          <path key={i} d={path.d} fillRule={path.fillRule} />
        ))}
      </g>
    ) : (
      <path d={designRectanglePath(node)} />
    )
  const frameHandles = [
    ['nw', 0, 0],
    ['n', node.width / 2, 0],
    ['ne', node.width, 0],
    ['e', node.width, node.height / 2],
    ['se', node.width, node.height],
    ['s', node.width / 2, node.height],
    ['sw', 0, node.height],
    ['w', 0, node.height / 2],
  ] as const
  const cornerHandles = [
    ['nw', 0, 0],
    ['ne', geometry.imageWidth, 0],
    ['se', geometry.imageWidth, geometry.imageHeight],
    ['sw', 0, geometry.imageHeight],
  ] as const
  return (
    <g transform={transform} data-designer-crop-overlay="true" color="#0d99ff">
      <defs>
        <clipPath id={`crop-clip-${id}`}>{boundary}</clipPath>
        <mask
          id={`crop-ghost-${id}`}
          maskUnits="userSpaceOnUse"
          x={-overscan}
          y={-overscan}
          width={node.width + overscan * 2}
          height={node.height + overscan * 2}
        >
          <rect
            x={-overscan}
            y={-overscan}
            width={node.width + overscan * 2}
            height={node.height + overscan * 2}
            fill="white"
          />
          <g fill="black">{boundary}</g>
        </mask>
      </defs>
      <g mask={`url(#crop-ghost-${id})`} pointerEvents="none">
        <image
          href={href}
          width={geometry.imageWidth}
          height={geometry.imageHeight}
          transform={geometry.imageTransform}
          preserveAspectRatio="none"
          opacity={0.3}
        />
      </g>
      <g clipPath={`url(#crop-clip-${id})`} pointerEvents="none">
        <image
          href={href}
          width={geometry.imageWidth}
          height={geometry.imageHeight}
          transform={geometry.imageTransform}
          preserveAspectRatio="none"
          opacity={paint.opacity}
        />
      </g>
      <rect
        width={node.width}
        height={node.height}
        fill="transparent"
        stroke="currentColor"
        strokeWidth={1.5 / zoom}
        role="button"
        tabIndex={0}
        aria-label={t('designerCropMoveImage')}
        className={css.cropPan}
        data-designer-crop-handle="window"
        onPointerDown={(e) => {
          onStart(e, 'pan', '')
        }}
      />
      <g transform={geometry.imageTransform}>
        <rect
          width={geometry.imageWidth}
          height={geometry.imageHeight}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={1 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          className={css.cropPan}
          data-designer-crop-handle="pan"
          onPointerDown={(e) => {
            onStart(e, 'pan', '')
          }}
          onKeyDown={(e) => {
            onKey(e, 'pan', '')
          }}
        />
        {cornerHandles.map(([handle, x, y]) => (
          <rect
            key={handle}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill="white"
            stroke="currentColor"
            strokeWidth={1 / zoom}
            role="button"
            tabIndex={0}
            aria-label={t('designerCropScaleHandle').replace(
              '{handle}',
              handle.toUpperCase(),
            )}
            className={css.cropImageHandle}
            data-designer-crop-handle={`image-${handle}`}
            onPointerDown={(e) => {
              onStart(e, 'image', handle)
            }}
            onKeyDown={(e) => {
              onKey(e, 'image', handle)
            }}
          />
        ))}
        <line
          x1={geometry.imageWidth / 2}
          x2={geometry.imageWidth / 2}
          y1={0}
          y2={-28 / zoom}
          stroke="currentColor"
          strokeWidth={1 / zoom}
          pointerEvents="none"
        />
        <circle
          cx={geometry.imageWidth / 2}
          cy={-28 / zoom}
          r={6 / zoom}
          fill="white"
          stroke="currentColor"
          strokeWidth={1 / zoom}
          role="button"
          tabIndex={0}
          aria-label={t('designerCropRotateHandle')}
          className={css.cropRotateHandle}
          data-designer-crop-handle="rotate"
          onPointerDown={(e) => {
            onStart(e, 'rotate', '')
          }}
          onKeyDown={(e) => {
            onKey(e, 'rotate', '')
          }}
        />
      </g>
      {frameHandles.map(([handle, x, y]) => (
        <rect
          key={handle}
          x={x - size / 2}
          y={y - size / 2}
          width={size}
          height={size}
          fill="currentColor"
          stroke="white"
          strokeWidth={1 / zoom}
          role="button"
          tabIndex={0}
          aria-label={t('designerCropBoundsHandle').replace(
            '{handle}',
            handle.toUpperCase(),
          )}
          className={css.cropFrameHandle}
          data-designer-crop-handle={`frame-${handle}`}
          onPointerDown={(e) => {
            onStart(e, 'frame', handle)
          }}
          onKeyDown={(e) => {
            onKey(e, 'frame', handle)
          }}
        />
      ))}
    </g>
  )
}
