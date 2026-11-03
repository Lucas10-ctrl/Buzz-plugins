/**
 * Measure editable section content without its viewport floor.
 * @param document - editable iframe document.
 * @returns content height in whole pixels.
 */
export function measureSectionFrameHeight(document: Document): number {
  const height = document.body?.getBoundingClientRect().height ?? 0
  return Math.max(1, Math.ceil(height))
}

/**
 * Anchor editor handles only when the source has not positioned the element.
 * @param element - editable source element.
 */
export function anchorEditorHandle(element: HTMLElement): void {
  const position = element.ownerDocument.defaultView?.getComputedStyle(element).position
  if (position === 'static' || position === '') element.dataset.copyosEditorPositioned = 'true'
}
