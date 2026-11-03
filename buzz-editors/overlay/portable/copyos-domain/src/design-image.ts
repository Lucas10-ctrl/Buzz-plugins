/** Image fill geometry is shared by browser patterns, text textures and SVG exports. */
import type { CopyOSDesignImagePaint } from './types.ts'
/** Resolved SVG image and pattern attributes in layer coordinates. */
export interface DesignImageGeometry {
  width: number
  height: number
  patternTransform?: string
  imageWidth: number
  imageHeight: number
  imageTransform?: string
  aspectRatio: string
}
/** Resolve Fill/Fit/Crop/Tile without changing the source raster or layer bounds.
 * @param image - Stored image settings, with source dimensions for transformed paints.
 * @param width - Current layer width.
 * @param height - Current layer height.
 * @returns Pattern and image attributes, including a legacy mapping for dimensionless fills.
 */
export function designImageGeometry(
  image: CopyOSDesignImagePaint,
  width: number,
  height: number,
): DesignImageGeometry {
  const sourceWidth = image.sourceWidth,
    sourceHeight = image.sourceHeight
  const positioned = image.scaleMode === 'crop' || image.scaleMode === 'tile'
  const rotation = image.rotation ?? 0,
    offsetX = positioned ? (image.offsetX ?? 0) * width : 0,
    offsetY = positioned ? (image.offsetY ?? 0) * height : 0
  if (!sourceWidth || !sourceHeight)
    return {
      width,
      height,
      imageWidth: width,
      imageHeight: height,
      aspectRatio:
        image.scaleMode === 'stretch'
          ? 'none'
          : image.scaleMode === 'fit'
            ? 'xMidYMid meet'
            : 'xMidYMid slice',
    }
  if (image.scaleMode === 'tile') {
    const tileWidth = sourceWidth * (image.tileScale ?? 1),
      tileHeight = sourceHeight * (image.tileScale ?? 1)
    return {
      width: tileWidth,
      height: tileHeight,
      imageWidth: tileWidth,
      imageHeight: tileHeight,
      aspectRatio: 'none',
      patternTransform: `translate(${offsetX} ${offsetY}) rotate(${rotation})`,
    }
  }
  const radians = (rotation * Math.PI) / 180,
    cos = Math.abs(Math.cos(radians)),
    sin = Math.abs(Math.sin(radians))
  const scale =
    image.scaleMode === 'fit'
      ? Math.min(
        width / (cos * sourceWidth + sin * sourceHeight),
        height / (sin * sourceWidth + cos * sourceHeight),
      )
      : Math.max(
        (cos * width + sin * height) / sourceWidth,
        (sin * width + cos * height) / sourceHeight,
      )
  const zoom = image.scaleMode === 'crop' ? (image.zoom ?? 1) : 1
  const imageWidth =
      image.scaleMode === 'stretch' ? width * zoom : sourceWidth * scale * zoom,
    imageHeight =
      image.scaleMode === 'stretch'
        ? height * zoom
        : sourceHeight * scale * zoom
  return {
    width,
    height,
    imageWidth,
    imageHeight,
    aspectRatio: 'none',
    imageTransform: `translate(${width / 2 + offsetX} ${height / 2 + offsetY}) rotate(${rotation}) translate(${-imageWidth / 2} ${-imageHeight / 2})`,
  }
}

/** Transform limits shared by stored paints, crop operations and numeric controls. */
export const DESIGN_IMAGE_LIMITS = {
  minZoom: 1e-12,
  maxZoom: 1e8,
  maxOffset: 1e8,
} as const

/** Convert an existing Fill/Fit image to Crop without changing its displayed placement.
 * @param image - Source image with known original dimensions.
 * @param width - Current layer width.
 * @param height - Current layer height.
 * @returns Crop settings; legacy Stretch and Tile return to a single undistorted Fill mapping.
 */
export function designImageToCrop(
  image: CopyOSDesignImagePaint,
  width: number,
  height: number,
): CopyOSDesignImagePaint {
  if (!image.sourceWidth || !image.sourceHeight)
    throw new Error('Image source dimensions are required for crop editing')
  if (image.scaleMode === 'crop') return image
  const crop = {
    ...image,
    scaleMode: 'crop' as const,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  }
  if (image.scaleMode === 'fit')
    crop.zoom =
      designImageGeometry(image, width, height).imageWidth /
      designImageGeometry(crop, width, height).imageWidth
  return crop
}
/** Rotate an image around its current center, retaining its physical size in Crop mode.
 * @param image - Source image and current transform.
 * @param width - Current layer width.
 * @param height - Current layer height.
 * @param rotation - New clockwise angle in degrees.
 * @returns Independent image with updated angle and, for Crop, compensating zoom.
 */
export function rotateDesignImage(
  image: CopyOSDesignImagePaint,
  width: number,
  height: number,
  rotation: number,
): CopyOSDesignImagePaint {
  const next = { ...image, rotation }
  if (image.scaleMode === 'crop')
    next.zoom =
      designImageGeometry(image, width, height).imageWidth /
      designImageGeometry({ ...next, zoom: 1 }, width, height).imageWidth
  return next
}
/** Scale one image corner while retaining the opposite corner in layer coordinates.
 * @param image - Current Crop image.
 * @param width - Layer width.
 * @param height - Layer height.
 * @param handle - Image corner, in its unrotated axes.
 * @param dx - Pointer movement in layer coordinates.
 * @param dy - Pointer movement in layer coordinates.
 * @param fromCenter - Keep the image center fixed instead of its opposite corner.
 * @returns Uniform image scaling and center displacement, with its source aspect ratio retained.
 */
export function resizeDesignCropImage(
  image: CopyOSDesignImagePaint,
  width: number,
  height: number,
  handle: 'nw' | 'ne' | 'se' | 'sw',
  dx: number,
  dy: number,
  fromCenter = false,
): CopyOSDesignImagePaint {
  const g = designImageGeometry(image, width, height),
    angle = ((image.rotation ?? 0) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    x = cos * dx + sin * dy,
    y = -sin * dx + cos * dy,
    sx = handle.includes('w') ? -1 : 1,
    sy = handle.includes('n') ? -1 : 1
  const scale = Math.max(
    DESIGN_IMAGE_LIMITS.minZoom / (image.zoom ?? 1),
    Math.min(
      DESIGN_IMAGE_LIMITS.maxZoom / (image.zoom ?? 1),
      1 +
        ((fromCenter ? 2 : 1) *
          (sx * g.imageWidth * x + sy * g.imageHeight * y)) /
          (g.imageWidth ** 2 + g.imageHeight ** 2),
    ),
  )
  const mx = fromCenter ? 0 : ((scale - 1) * sx * g.imageWidth) / 2,
    my = fromCenter ? 0 : ((scale - 1) * sy * g.imageHeight) / 2
  return {
    ...image,
    zoom: (image.zoom ?? 1) * scale,
    offsetX: (image.offsetX ?? 0) + (cos * mx - sin * my) / width,
    offsetY: (image.offsetY ?? 0) + (sin * mx + cos * my) / height,
  }
}
/** Crop window bounds in the original layer's local coordinates. */
export interface DesignCropRect {
  left: number
  top: number
  width: number
  height: number
}
/** Resize a crop window while retaining the opposite edge or corner and an optional aspect ratio.
 * @param width - Original crop window width.
 * @param height - Original crop window height.
 * @param handle - Edge or corner being dragged.
 * @param dx - Movement in layer coordinates.
 * @param dy - Movement in layer coordinates.
 * @param aspect - Optional locked width/height ratio.
 * @param bounds - Layer size constraints.
 * @param fromCenter - Resize both opposite sides around the current center.
 * @returns Positive crop window within the layer's size constraints.
 */
export function resizeDesignCropRect(
  width: number,
  height: number,
  handle: string,
  dx: number,
  dy: number,
  aspect: number | null,
  bounds: {
    minWidth?: number | undefined
    maxWidth?: number | undefined
    minHeight?: number | undefined
    maxHeight?: number | undefined
  } = {},
  fromCenter = false,
): DesignCropRect {
  if (fromCenter) {
    dx *= 2
    dy *= 2
  }
  const west = handle.includes('w'),
    north = handle.includes('n'),
    horizontal = west || handle.includes('e'),
    vertical = north || handle.includes('s')
  let w = horizontal ? width + (west ? -dx : dx) : width,
    h = vertical ? height + (north ? -dy : dy) : height
  const minW = bounds.minWidth ?? 1,
    maxW = bounds.maxWidth ?? 100000,
    minH = bounds.minHeight ?? 1,
    maxH = bounds.maxHeight ?? 100000
  if (aspect) {
    const low = Math.max(minW, minH * aspect),
      high = Math.min(maxW, maxH * aspect)
    if (low > high)
      throw new Error('Crop aspect ratio conflicts with size bounds')
    if (!horizontal || (vertical && Math.abs(h - height) > Math.abs(w - width) / aspect)) w = h * aspect
    w = Math.max(low, Math.min(high, w))
    h = w / aspect
  } else {
    w = Math.max(minW, Math.min(maxW, w))
    h = Math.max(minH, Math.min(maxH, h))
  }
  return {
    left: fromCenter
      ? (width - w) / 2
      : west
        ? width - w
        : !horizontal
          ? (width - w) / 2
          : 0,
    top: fromCenter
      ? (height - h) / 2
      : north
        ? height - h
        : !vertical
          ? (height - h) / 2
          : 0,
    width: w,
    height: h,
  }
}
