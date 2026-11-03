/** Preserve fractional intrinsic geometry before applying the native integer cache boundary. */
/** Read natural width from a text element already laid out without a canvas transform.
 * @param element - Unscaled measurement content; scrollWidth covers overflowing text.
 * @returns The upward-rounded maximum of fractional local bounds and integer scroll width.
 */
export function designerUnscaledTextWidth(element: HTMLElement): number {
  return Math.ceil(Math.max(element.scrollWidth, element.getBoundingClientRect().width))
}
/** Natural-width measurement split into a style read, a DOM write, a layout read and a cleanup so many texts share one layout. */
export interface DesignerInlineTextWidthMeasurement {
  /** Copies the live text's computed font styles; no-op for other sizing policies. */
  snapshot: () => void
  /** Appends the unscaled copy made by {@link snapshot}. */
  prepare: () => void
  /** Reads the natural integer width after {@link prepare}. */
  read: () => number
  /** Removes the temporary copy; safe to call more than once. */
  cleanup: () => void
}

/** Prepare an auto-width measurement independently of canvas rotation, flips and viewport zoom.
 * @param element - Live editable or readonly text with current content and styles.
 * @param intrinsic - Auto-width text requires natural unscaled content; other policies retain scroll width.
 * @returns Phases that never alter the live editor or its selection.
 */
export function designerInlineTextWidthMeasurement(element: HTMLElement, intrinsic: boolean): DesignerInlineTextWidthMeasurement {
  if (!intrinsic) return { snapshot: () => {}, prepare: () => {}, read: () => Math.ceil(element.scrollWidth), cleanup: () => {} }
  let copy: HTMLElement | null = null
  return {
    snapshot: () => { copy = designerUnscaledTextCopy(element) },
    prepare: () => { if (copy) document.body.append(copy) },
    read: () => (copy ? designerUnscaledTextWidth(copy) : Math.ceil(element.scrollWidth)),
    cleanup: () => { copy?.remove() },
  }
}

/** Measure auto-width text independently of canvas rotation, flips and viewport zoom.
 * @param element - Live editable or readonly text with current content and styles.
 * @param intrinsic - Auto-width text requires natural unscaled content; other policies retain scroll width.
 * @returns Natural integer width; temporary copies never alter the live editor or its selection.
 */
export function designerInlineTextWidth(element: HTMLElement, intrinsic: boolean): number {
  const measurement = designerInlineTextWidthMeasurement(element, intrinsic)
  try {
    measurement.snapshot()
    measurement.prepare()
    return measurement.read()
  } finally {
    measurement.cleanup()
  }
}

function designerUnscaledTextCopy(element: HTMLElement): HTMLElement {
  const copy = element.cloneNode(true) as HTMLElement
  const computed = window.getComputedStyle(element)
  for (const property of [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'font-kerning',
    'font-feature-settings',
    'font-variation-settings',
    'font-optical-sizing',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'text-transform',
    'text-indent',
    'text-align',
    'white-space',
    'overflow-wrap',
    'word-break',
    'tab-size',
    'direction',
    'writing-mode',
    'text-orientation',
    'text-rendering',
  ]) {
    const value = computed.getPropertyValue(property)
    if (value) copy.style.setProperty(property, value)
  }
  copy.contentEditable = 'false'
  copy.setAttribute('aria-hidden', 'true')
  copy.removeAttribute('role')
  copy.removeAttribute('id')
  copy.removeAttribute('tabindex')
  Object.assign(copy.style, {
    position: 'fixed',
    left: '-1000000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    transform: 'none',
    width: 'max-content',
    minWidth: '0',
    maxWidth: 'none',
    height: 'auto',
    maxHeight: 'none',
    margin: '0',
    padding: '0',
    border: '0',
    display: 'block',
    overflow: 'visible',
    WebkitLineClamp: 'unset',
    backgroundImage: 'none',
  })
  return copy
}
