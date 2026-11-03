/** SVG image patterns consume the same geometry as standalone exports. */
import type { ReactNode } from 'react'
import type { CopyOSDesignImagePaint } from '../../../copyos-domain/src/types.ts'
import { designImageGeometry } from '../../../copyos-domain/src/design-model.ts'
import { useDesignerImageHref } from './DesignerImageAssets.ts'
/** Render a local image fill definition; project image references load through the open project.
 * @param props - Source paint, unique resource identity and current layer bounds.
 * @returns A clipped or tiled SVG pattern without duplicating image geometry rules.
 */
export function DesignerImagePattern({
  image,
  id,
  width,
  height,
}: {
  image: CopyOSDesignImagePaint
  id: string
  width: number
  height: number
}): ReactNode {
  const geometry = designImageGeometry(image, width, height), href = useDesignerImageHref(image.url)
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={geometry.width}
      height={geometry.height}
      patternTransform={geometry.patternTransform}
    >
      <image
        href={href}
        width={geometry.imageWidth}
        height={geometry.imageHeight}
        transform={geometry.imageTransform}
        preserveAspectRatio={geometry.aspectRatio}
      />
    </pattern>
  )
}
