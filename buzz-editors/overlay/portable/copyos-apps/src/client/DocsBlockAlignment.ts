/** Align a body-block grip with the first rendered text line, including authored heading margins. */
export function alignDocsBlockGrip(details: HTMLElement, summary: HTMLElement): () => void {
  let disposed = false
  const place = (): void => {
    if (disposed || !details.isConnected) return
    const block = details.nextElementSibling
    if (!(block instanceof HTMLElement)) return
    const line = block.matches('p,h1,h2,h3,pre') ? block : [...block.querySelectorAll<HTMLElement>('p,h1,h2,h3,pre,th,td')].find(node => node.getBoundingClientRect().height > 0) ?? block
    const style = getComputedStyle(line), height = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6
    summary.style.top = `${line.getBoundingClientRect().top - details.getBoundingClientRect().top + (Number.parseFloat(style.paddingTop) || 0) + (height - summary.getBoundingClientRect().height) / 2}px`
  }
  const observer = new ResizeObserver(place)
  const frame = requestAnimationFrame(() => {
    if (disposed) return
    const block = details.nextElementSibling
    if (block) observer.observe(block)
    observer.observe(summary)
    place()
  })
  return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect() }
}
