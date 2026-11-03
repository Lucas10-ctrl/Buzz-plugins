/** Page Builder handling of breakpoint text copies, the `data-copyos-text-variant` children in one compiled text element. */

/** Matches one breakpoint copy; the value is `desktop` or `max-<maxWidth>`. */
export const BREAKPOINT_VARIANT_QUERY = '[data-copyos-text-variant]'

const DESKTOP_VARIANT = 'desktop'

/** Keeps the hidden copies of one contenteditable element intact while the shown copy is edited. */
export interface TextCopyGuard {
  /** Records which copy is shown and the content of every other copy; call before each edit. */
  capture(): void
  /**
   * Restores hidden copies that an edit removed or changed and puts edited text that left the shown copy back into it.
   * While the edited content has no text, the browser's placeholder stays at the caret, because a caret cannot sit inside a
   * `display:contents` copy.
   * @param settle Also moves textless content into the shown copy and restores the copy order; use before serializing.
   * @returns Whether the element's DOM changed.
   */
  repair(settle?: boolean): boolean
}

/**
 * Creates a guard for an element whose text has breakpoint copies.
 * @param element The contenteditable element that contains the copies.
 * @param isShown Reports whether a copy is displayed at the current editing width.
 * @returns The guard, or `undefined` when the element has no copies.
 */
export function guardTextCopies(element: HTMLElement, isShown: (copy: HTMLElement) => boolean): TextCopyGuard | undefined {
  let copies = [...element.querySelectorAll<HTMLElement>(BREAKPOINT_VARIANT_QUERY)]
  const container = copies[0]?.parentElement
  if (container === null || container === undefined) return undefined
  let active: HTMLElement | undefined
  let saved = new Map<HTMLElement, HTMLElement>()
  return {
    capture() {
      // A shown copy that an earlier edit emptied and detached stays the target until its content returns.
      const detached = active !== undefined && !element.contains(active) ? active : undefined
      active = copies.find(copy => element.contains(copy) && isShown(copy)) ?? detached
      saved = new Map(copies.filter(copy => copy !== active).map(copy => [copy, copy.cloneNode(true) as HTMLElement]))
    },
    repair(settle = false) {
      const shown = active
      if (shown === undefined) return false
      // Deleting all shown text can also remove a wrapper between the element and its copies, such as a link.
      const containerLost = container !== element && !element.contains(container)
      const host = containerLost ? element : container
      const isCopy = (node: Node): boolean => node.nodeType === node.ELEMENT_NODE && (node as Element).matches(BREAKPOINT_VARIANT_QUERY)
      // Typing at the end of a wrapper such as a link can also land beside the wrapper, directly in the element.
      const strays = [...element.childNodes].flatMap(node => node === container ? [...container.childNodes].filter(child => !isCopy(child))
        : isCopy(node) && host === element ? [] : [node])
      const restored = copies.map((copy) => {
        const original = saved.get(copy)
        if (original === undefined || (host.contains(copy) && copy.isEqualNode(original))) return copy
        return original.cloneNode(true) as HTMLElement
      })
      const inPlace = [...host.children].filter(child => child.matches(BREAKPOINT_VARIANT_QUERY))
      const ordered = inPlace.length === restored.length && restored.every((copy, index) => inPlace[index] === copy)
      if (!containerLost && strays.length === 0 && ordered) return false
      const previous = copies
      copies = restored
      if (!settle && strays.every(node => node.textContent === '')) {
        let changed = false
        restored.forEach((copy, index) => {
          const before = previous[index]
          if (copy === before || before === undefined) return
          changed = true
          if (host.contains(before)) before.replaceWith(copy)
          else host.append(copy)
        })
        return changed
      }
      const selection = element.ownerDocument.getSelection()
      const anchor = selection?.anchorNode ?? null, offset = selection?.anchorOffset ?? 0
      if (!host.contains(shown)) shown.replaceChildren()
      shown.append(...strays)
      container.replaceChildren(...restored)
      if (containerLost) element.append(container)
      if (selection === null || settle) return true
      if (anchor !== null && anchor.nodeType === anchor.TEXT_NODE && shown.contains(anchor))
        selection.collapse(anchor, Math.min(offset, anchor.textContent?.length ?? 0))
      else {
        const walker = element.ownerDocument.createTreeWalker(shown, NodeFilter.SHOW_TEXT)
        let last: Node | null = null
        while (walker.nextNode()) last = walker.currentNode
        if (last !== null) selection.collapse(last, last.textContent?.length ?? 0)
      }
      return true
    },
  }
}

/**
 * Reads an element's text with one breakpoint copy.
 * @param element The element whose text is read.
 * @param key The `data-copyos-text-variant` value of the copy to keep; defaults to the desktop copy.
 * @returns The text with whitespace collapsed.
 */
export function textCopyLabel(element: Element, key: string = DESKTOP_VARIANT): string {
  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll(BREAKPOINT_VARIANT_QUERY).forEach((copy) => { if (copy.getAttribute('data-copyos-text-variant') !== key) copy.remove() })
  return clone.textContent.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Lists the breakpoint copy keys inside an element.
 * @param element The element to inspect.
 * @returns The distinct `data-copyos-text-variant` values in document order; empty when the element has no copies.
 */
export function textCopyKeys(element: Element): string[] {
  return [...new Set([...element.querySelectorAll(BREAKPOINT_VARIANT_QUERY)].map(copy => copy.getAttribute('data-copyos-text-variant') ?? ''))]
}

/**
 * Removes every breakpoint copy except the desktop copy from section markup.
 * @param root The parsed markup to change in place.
 */
export function keepDesktopTextCopies(root: ParentNode): void {
  root.querySelectorAll(`${BREAKPOINT_VARIANT_QUERY}:not([data-copyos-text-variant="${DESKTOP_VARIANT}"])`).forEach((copy) => { copy.remove() })
}
