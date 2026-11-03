/** Raster paints share shape clipping, ordered fills and document transactions. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  DESIGN_IMAGE_LIMITS,
  rotateDesignImage,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignImagePaint } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { DesignerNumberField } from './DesignerNumberField.tsx'
import { DesignerImagePattern } from './DesignerImagePattern.tsx'
import { loadDesignerImageElement, useDesignerImageAssets, useDesignerImageHref } from './DesignerImageAssets.ts'
import css from './PageDesignerWorkspace.module.css'
type Dimensions = Pick<CopyOSDesignImagePaint, 'sourceWidth' | 'sourceHeight'>
type ImageSettings = Partial<Omit<CopyOSDesignImagePaint, 'url' | 'scaleMode'>>
/** Render image replacement and sizing without changing the layer's geometry.
 * @param props - Current paint, localized controls and commit callback.
 * @returns Image preview, upload and aspect-ratio controls.
 */
export function DesignerImagePaintEditor({
  image,
  t,
  onCommit,
  onSizing,
  mixedSource = false,
  mixedSizing = false,
  sizingEnabled = true,
  images,
  width,
  height,
  onAdjust,
  onCancel,
  onCrop,
  storeImages = false,
}: {
  image: CopyOSDesignImagePaint | undefined
  /** Store chosen files as project images; text image paints must stay embedded, so their editors leave this off. */
  storeImages?: boolean | undefined
  t: (key: CopyOSFoundationLocaleKey) => string
  onCommit: (image: CopyOSDesignImagePaint) => void
  onSizing: (
    mode: CopyOSDesignImagePaint['scaleMode'],
    dimensions: ReadonlyMap<string, Dimensions>,
  ) => void
  images: CopyOSDesignImagePaint[]
  width: number
  height: number
  onAdjust: (
    settings:
      | ImageSettings
      | ((
        image: CopyOSDesignImagePaint,
        width: number,
        height: number,
      ) => ImageSettings),
    transient?: boolean,
    dimensions?: ReadonlyMap<string, Dimensions>,
  ) => void
  onCrop?: ((metadata: Dimensions) => void) | undefined
  onCancel: () => void
  mixedSource?: boolean
  mixedSizing?: boolean
  sizingEnabled?: boolean
}): ReactNode {
  const patternId = useId().replaceAll(':', '')
  const assets = useDesignerImageAssets(), previewSource = useDesignerImageHref(image?.url ?? '')
  const metadata = useRef(new Map<string, Dimensions>()),
    failures = useRef(new Set<string>())
  const [, refreshMetadata] = useState(0),
    [retryMetadata, setRetryMetadata] = useState(0)
  const drag = useRef<{
    x: number
    y: number
    offsetX: number
    offsetY: number
    matrix: number[]
    fields: ImageSettings | null
  } | null>(null)
  const dimensions = (
    source: CopyOSDesignImagePaint,
  ): Dimensions | undefined =>
    source.sourceWidth && source.sourceHeight
      ? { sourceWidth: source.sourceWidth, sourceHeight: source.sourceHeight }
      : metadata.current.get(source.url)
  const ready =
    images.length > 0 && images.every(source => !!dimensions(source))
  const dimensionMap = () =>
    new Map(
      images.flatMap((source) => {
        const size = dimensions(source)
        return size ? [[source.url, size] as const] : []
      }),
    )
  useEffect(() => {
    const urls = new Set(
      images
        .filter(source => !source.sourceWidth || !source.sourceHeight)
        .map(source => source.url),
    )
    metadata.current = new Map(
      [...metadata.current].filter(([url]) => urls.has(url)),
    )
    failures.current = new Set(
      [...failures.current].filter(url => urls.has(url)),
    )
    const pending: HTMLImageElement[] = []
    for (const url of urls) {
      if (metadata.current.has(url) || failures.current.has(url)) continue
      const decoded = new Image()
      const loaded = () => {
        if (
          decoded.naturalWidth > 0 &&
          decoded.naturalWidth <= 100000 &&
          decoded.naturalHeight > 0 &&
          decoded.naturalHeight <= 100000
        )
          metadata.current.set(url, {
            sourceWidth: decoded.naturalWidth,
            sourceHeight: decoded.naturalHeight,
          })
        else failures.current.add(url)
        refreshMetadata(v => v + 1)
      }
      decoded.onload = loaded
      decoded.onerror = () => {
        failures.current.add(url)
        refreshMetadata(v => v + 1)
      }
      loadDesignerImageElement(assets, url, decoded)
      pending.push(decoded)
    }
    return () => {
      for (const decoded of pending) {
        decoded.onload = null
        decoded.onerror = null
      }
    }
  }, [images, retryMetadata, assets])
  const common = (
    key: keyof ImageSettings,
    fallback: number,
    multiplier = 1,
  ): number | null => {
    const first = image?.[key] ?? fallback
    return images.every(source => (source[key] ?? fallback) === first)
      ? first * multiplier
      : null
  }
  const numeric = (
    key: keyof ImageSettings,
    label: CopyOSFoundationLocaleKey,
    short: string,
    fallback: number,
    min: number,
    max: number,
    multiplier = 1,
  ) => (
    <DesignerNumberField
      label={t(label)}
      short={short}
      value={common(key, fallback, multiplier)}
      mixed={t('designerMixed')}
      min={min}
      max={max}
      disabled={!ready || !sizingEnabled}
      onCommit={(value) => {
        onAdjust(
          key === 'rotation'
            ? (image, width, height) =>
              rotateDesignImage(image, width, height, value)
            : { [key]: value / multiplier },
          false,
          dimensionMap(),
        )
      }}
    />
  )
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0),
    latest = useRef({ image, onCommit })
  latest.current = { image, onCommit }
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const choose = (file: File): void => {
    const current = ++request.current
    setError('')
    setBusy(false)
    if (file.size > 5_000_000) {
      setError(t('designerImageTooLarge'))
      return
    }
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        file.type,
      )
    ) {
      setError(t('designerImageInvalid'))
      return
    }
    setBusy(true)
    const fail = (): void => {
      if (request.current === current) {
        setBusy(false)
        setError(t('designerImageInvalid'))
      }
    }
    const reader = new FileReader()
    reader.onerror = fail
    reader.onabort = fail
    reader.onload = () => {
      const url = reader.result
      if (typeof url !== 'string') {
        fail()
        return
      }
      const decoded = new Image()
      decoded.onerror = fail
      decoded.onload = () => {
        if (request.current !== current) return
        if (
          !decoded.naturalWidth ||
          !decoded.naturalHeight ||
          decoded.naturalWidth > 100000 ||
          decoded.naturalHeight > 100000
        ) {
          fail()
          return
        }
        const sourceWidth = decoded.naturalWidth, sourceHeight = decoded.naturalHeight
        const commit = (stored: string): void => {
          if (request.current !== current) return
          setBusy(false)
          latest.current.onCommit({
            ...latest.current.image,
            url: stored,
            scaleMode: latest.current.image?.scaleMode ?? 'fill',
            sourceWidth,
            sourceHeight,
          })
        }
        if (storeImages && assets) void assets.store(url).then(commit)
        else commit(url)
      }
      decoded.src = url
    }
    reader.readAsDataURL(file)
  }
  return (
    <div
      className={css.imagePaintEditor}
      data-dropping={dropping}
      title={t('designerImageDropHint')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (
          !(e.relatedTarget instanceof Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        )
          setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDropping(false)
        const file = e.dataTransfer.files[0]
        if (file) choose(file)
      }}
    >
      {mixedSource ? (
        <p>{t('designerMixedImages')}</p>
      ) : image ? (
        <div className={css.imagePaintPreview}>
          {image.scaleMode === 'crop' ||
          image.scaleMode === 'tile' ||
          (image.rotation ?? 0) !== 0 ? (
              <svg
                role="img"
                aria-label={t('designerImagePreview')}
                viewBox={`0 0 ${width} ${height}`}
                tabIndex={0}
                className={
                  image.scaleMode === 'crop' ? css.imageCropPreview : undefined
                }
                onPointerDown={(e) => {
                  if (
                    image.scaleMode !== 'crop' ||
                  images.length !== 1 ||
                  e.button !== 0
                  )
                    return
                  e.preventDefault()
                  e.stopPropagation()
                  const matrix = e.currentTarget.getScreenCTM()?.inverse(),
                    box = e.currentTarget.getBoundingClientRect()
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    offsetX: image.offsetX ?? 0,
                    offsetY: image.offsetY ?? 0,
                    matrix: matrix
                      ? [matrix.a, matrix.b, matrix.c, matrix.d]
                      : [
                        width / Math.max(1, box.width),
                        0,
                        0,
                        height / Math.max(1, box.height),
                      ],
                    fields: null,
                  }
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const g = drag.current
                  if (!g) return
                  const [a = 1, b = 0, c = 0, d = 1] = g.matrix,
                    dx = e.clientX - g.x,
                    dy = e.clientY - g.y
                  g.fields = {
                    offsetX: Math.max(
                      -DESIGN_IMAGE_LIMITS.maxOffset,
                      Math.min(
                        DESIGN_IMAGE_LIMITS.maxOffset,
                        g.offsetX + (a * dx + c * dy) / width,
                      ),
                    ),
                    offsetY: Math.max(
                      -DESIGN_IMAGE_LIMITS.maxOffset,
                      Math.min(
                        DESIGN_IMAGE_LIMITS.maxOffset,
                        g.offsetY + (b * dx + d * dy) / height,
                      ),
                    ),
                  }
                  onAdjust(g.fields, true)
                }}
                onPointerUp={() => {
                  const g = drag.current
                  drag.current = null
                  if (g?.fields) onAdjust(g.fields)
                }}
                onPointerCancel={() => {
                  drag.current = null
                  onCancel()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && drag.current) {
                    e.preventDefault()
                    e.stopPropagation()
                    drag.current = null
                    onCancel()
                  }
                }}
              >
                <defs>
                  <DesignerImagePattern
                    id={patternId}
                    image={image}
                    width={width}
                    height={height}
                  />
                </defs>
                <rect width={width} height={height} fill={`url(#${patternId})`} />
              </svg>
            ) : (
              <img
                src={previewSource}
                alt={t('designerImagePreview')}
                onLoad={(e) => {
                  const decoded = e.currentTarget
                  if (
                    decoded.naturalWidth > 0 &&
                  decoded.naturalHeight > 0 &&
                  decoded.naturalWidth <= 100000 &&
                  decoded.naturalHeight <= 100000
                  ) {
                    metadata.current.set(image.url, {
                      sourceWidth: decoded.naturalWidth,
                      sourceHeight: decoded.naturalHeight,
                    })
                    refreshMetadata(v => v + 1)
                  }
                }}
              />
            )}
        </div>
      ) : (
        <p>{t('designerChooseImageHint')}</p>
      )}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={t('designerChooseImage')}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) choose(file)
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          input.current?.click()
        }}
      >
        {t(
          busy
            ? 'designerLoadingImage'
            : image
              ? 'designerReplaceImage'
              : 'designerChooseImage',
        )}
      </button>
      <label className={css.imageSizing}>
        <span>{t('designerImageSizing')}</span>
        <select
          aria-label={t('designerImageSizing')}
          disabled={!image || busy || !sizingEnabled}
          value={mixedSizing ? 'mixed' : (image?.scaleMode ?? 'fill')}
          onChange={(e) => {
            const scaleMode = e.currentTarget.value
            if (
              image &&
              (scaleMode === 'fill' ||
                scaleMode === 'fit' ||
                scaleMode === 'stretch' ||
                scaleMode === 'crop' ||
                scaleMode === 'tile')
            )
              onSizing(scaleMode, dimensionMap())
          }}
        >
          {mixedSizing ? (
            <option value="mixed" disabled>
              {t('designerMixed')}
            </option>
          ) : null}
          <option value="fill">{t('designerFillShort')}</option>
          <option value="fit">{t('designerImageFit')}</option>
          <option value="crop" disabled={!ready}>
            {t('designerImageCrop')}
          </option>
          <option value="tile" disabled={!ready}>
            {t('designerImageTile')}
          </option>
          <option value="stretch">{t('designerStretch')}</option>
        </select>
      </label>
      {image && !ready ? (
        <p className={css.imageMetadataHint}>
          {t(
            images.some(source => failures.current.has(source.url))
              ? 'designerImageDimensionsUnavailable'
              : 'designerImageDimensionsLoading',
          )}
        </p>
      ) : null}
      {image &&
      !ready &&
      images.some(source => failures.current.has(source.url)) ? (
          <button
            type="button"
            onClick={() => {
              failures.current.clear()
              setRetryMetadata(v => v + 1)
            }}
          >
            {t('designerImageRetry')}
          </button>
        ) : null}
      {onCrop && image ? (
        <button
          type="button"
          disabled={!ready || !sizingEnabled || images.length !== 1}
          onClick={() =>{  onCrop(dimensions(image) ?? {}) }}
        >
          {t('designerCropOnCanvas')}
        </button>
      ) : null}
      {image ? (
        <>
          {image.scaleMode === 'crop' && !mixedSizing ? (
            <>
              <div className={css.fieldGrid}>
                {numeric(
                  'offsetX',
                  'designerImageOffsetX',
                  'X',
                  0,
                  -DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  100,
                )}
                {numeric(
                  'offsetY',
                  'designerImageOffsetY',
                  'Y',
                  0,
                  -DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  100,
                )}
              </div>
              {numeric(
                'zoom',
                'designerImageZoom',
                '%',
                1,
                DESIGN_IMAGE_LIMITS.minZoom * 100,
                DESIGN_IMAGE_LIMITS.maxZoom * 100,
                100,
              )}
              {images.length === 1 ? (
                <p className={css.imageMetadataHint}>
                  {t('designerImageCropHint')}
                </p>
              ) : null}
            </>
          ) : null}
          {image.scaleMode === 'tile' && !mixedSizing ? (
            <>
              {numeric(
                'tileScale',
                'designerImageTileScale',
                '%',
                1,
                1,
                10000,
                100,
              )}
              <div className={css.fieldGrid}>
                {numeric(
                  'offsetX',
                  'designerImageOffsetX',
                  'X',
                  0,
                  -DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  100,
                )}
                {numeric(
                  'offsetY',
                  'designerImageOffsetY',
                  'Y',
                  0,
                  -DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  DESIGN_IMAGE_LIMITS.maxOffset * 100,
                  100,
                )}
              </div>
            </>
          ) : null}
          <div className={css.fieldGrid}>
            {numeric(
              'rotation',
              'designerImageRotation',
              '°',
              0,
              -36000,
              36000,
            )}
            <button
              type="button"
              disabled={!ready || !sizingEnabled}
              onClick={() => {
                onAdjust(
                  (source, width, height) =>
                    rotateDesignImage(
                      source,
                      width,
                      height,
                      ((source.rotation ?? 0) + 90) % 360,
                    ),
                  false,
                  dimensionMap(),
                )
              }}
            >
              {t('designerImageRotate90')}
            </button>
          </div>
          <button
            type="button"
            disabled={!ready || !sizingEnabled}
            onClick={() => {
              onAdjust(
                { offsetX: 0, offsetY: 0, zoom: 1, rotation: 0, tileScale: 1 },
                false,
                dimensionMap(),
              )
            }}
          >
            {t('designerImageReset')}
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
