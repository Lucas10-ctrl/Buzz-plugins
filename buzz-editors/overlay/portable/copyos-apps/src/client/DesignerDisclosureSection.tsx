/** Inspector section for optional board tools: only its heading shows until the user opens it. */
import { useState, type ReactNode } from 'react'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import css from './PageDesignerWorkspace.module.css'

/**
 * Render a Properties section that starts closed; the heading button toggles the body.
 * @param props - Localized title and the section body.
 * @returns The section with its heading toggle.
 */
export function DesignerDisclosureSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  return <section className={`${css.propertySection} ${open ? '' : css.collapsedSection}`} aria-label={title}>
    <div className={css.sectionHeading}>
      <h3><button type="button" className={css.disclosure} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {title}<Icon name={open ? 'down' : 'chevron'} /></button></h3>
    </div>
    {open ? children : null}
  </section>
}
