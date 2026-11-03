/** Decorative color previews composite transparent paints over a theme-aware checkerboard. */
import type { ReactNode } from 'react'
import css from './PageDesignerWorkspace.module.css'
/** Render a color or CSS paint with visible transparency.
 * @param props - CSS background paint and optional size or outline class.
 * @returns A decorative swatch retaining its parent's accessible label.
 */
export function DesignerSwatch({
  paint,
  className = '',
}: {
  paint: string
  className?: string | undefined
}): ReactNode {
  const image = /(?:gradient|url|image-set)\(/i.test(paint)
  return (
    <span aria-hidden="true" className={`${css.colorSwatch} ${className}`}>
      <span
        style={{
          backgroundColor: image ? 'transparent' : paint,
          backgroundImage: image ? paint : 'none',
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
        }}
      />
    </span>
  )
}
