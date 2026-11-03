/** Keep section actions outside the scrolling editor, with bounded placement and keyboard dismissal.
 * @param details - Section-owned disclosure whose open state drives the menu.
 * @param summary - Focusable handle that opens the actions.
 * @param menu - Localized menu items owned by the section node view.
 * @returns Cleanup for the node view's lifetime.
 */
export function docsSectionMenu(details: HTMLDetailsElement, summary: HTMLElement, menu: HTMLElement): () => void {
  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])'))
  const place = (): void => {
    const anchor = summary.getBoundingClientRect(), box = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`
    const top = anchor.bottom + box.height + 4 < window.innerHeight - 8 ? anchor.bottom + 4 : anchor.top - box.height - 4
    menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`
  }
  const close = (focus = false): void => {
    details.open = false; render()
    if (focus && summary.isConnected) summary.focus()
  }
  const outside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !details.contains(event.target) && !menu.contains(event.target)) close()
  }
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); close(true)
  }
  const render = (): void => {
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true)
    window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true)
    if (!details.open || !details.isConnected) { menu.remove(); return }
    if (!menu.isConnected) document.body.append(menu)
    place()
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true)
  }
  const click = (event: MouseEvent): void => { event.preventDefault(); details.open = !details.open; render() }
  const summaryKey = (event: KeyboardEvent): void => {
    if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation(); details.open = true; render(); items()[0]?.focus()
  }
  const menuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') { close(true); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const buttons = items(), index = buttons.findIndex(button => button === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    buttons[next]?.focus()
  }
  summary.setAttribute('aria-haspopup', 'menu'); summary.setAttribute('aria-controls', menu.id)
  menu.setAttribute('role', 'menu')
  summary.addEventListener('click', click); summary.addEventListener('keydown', summaryKey)
  menu.addEventListener('keydown', menuKey); details.addEventListener('toggle', render)
  return () => {
    details.open = false; render(); menu.remove()
    summary.removeEventListener('click', click); summary.removeEventListener('keydown', summaryKey)
    menu.removeEventListener('keydown', menuKey); details.removeEventListener('toggle', render)
  }
}
