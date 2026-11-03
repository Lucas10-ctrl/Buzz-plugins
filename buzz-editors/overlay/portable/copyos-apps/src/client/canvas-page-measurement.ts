/** Opaque-origin preview measurement with a single trusted bootstrap and inert authored application behavior. */

/** Runs alone in the opaque frame; all capabilities are captured before authored nodes enter its document. */
function measurePreview(token: string, markup: string): void {
  const doc = document, body = doc.body, head = doc.head, root = doc.documentElement
  const send = window.parent.postMessage.bind(window.parent), schedule = window.setTimeout.bind(window)
  const cancel = window.clearTimeout.bind(window), computed = window.getComputedStyle.bind(window)
  const appendHead = head.appendChild.bind(head), appendBody = body.appendChild.bind(body)
  const bounds = (element: Element): DOMRect => Element.prototype.getBoundingClientRect.call(element)
  const query = (selector: string): NodeListOf<Element> => body.querySelectorAll(selector)
  const Observer = window.ResizeObserver, Mutation = window.MutationObserver
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const forbidden = new Set(['script', 'meta', 'base', 'link', 'iframe', 'frame', 'object', 'embed', 'portal',
    'fencedframe', 'template', 'noscript'])
  // Validate the final parsed nodes too: serialization and reparsing can repair malformed authored markup.
  for (const element of Array.from(parsed.querySelectorAll('*'))) {
    if (forbidden.has(element.localName.toLowerCase())) { element.remove(); continue }
    for (const attribute of Array.from(element.attributes))
      if (/^on/i.test(attribute.name) || attribute.localName === 'nonce') element.removeAttributeNode(attribute)
  }
  let timer = 0, settled = false, failed = false, last = ''
  const report = (state: 'ready' | 'error', height = 1): void => {
    const width = window.innerWidth, key = `${state}:${width}:${height}`
    if (key === last) return
    last = key; send({ type: 'copyos-canvas-layout', token, width, height, state }, '*')
  }
  const measure = (): void => {
    timer = 0
    if (!settled || failed) return
    try {
      const elements = Array.from(query('*'))
      if (elements.length > 16384) throw new Error('Preview element limit')
      let bottom = Math.max(0, bounds(body).bottom)
      for (const element of elements) {
        const style = computed(element)
        if (style.position === 'fixed' || style.display === 'none') continue
        const rect = bounds(element)
        let edge = rect.bottom, ancestor: Element | null = element.parentElement, fixed = false, depth = 0
        while (ancestor && ancestor !== body && ancestor !== root) {
          if (++depth > 128) throw new Error('Preview nesting limit')
          const parentStyle = computed(ancestor)
          if (parentStyle.position === 'fixed') { fixed = true; break }
          if (/(hidden|clip|scroll|auto)/.test(parentStyle.overflowY)) edge = Math.min(edge, bounds(ancestor).bottom)
          ancestor = ancestor.parentElement
        }
        if (!fixed) bottom = Math.max(bottom, edge)
      }
      bottom += Math.max(0, Number.parseFloat(computed(body).marginBottom) || 0)
      const height = Math.max(1, Math.ceil(bottom))
      if (!Number.isFinite(height) || height > 100000) throw new Error('Preview height limit')
      report('ready', height)
    } catch { failed = true; report('error') }
  }
  const queue = (): void => { if (!timer && !failed) timer = schedule(measure, 120) }
  try {
    for (const attribute of Array.from(parsed.documentElement.attributes)) root.setAttribute(attribute.name, attribute.value)
    for (const attribute of Array.from(parsed.body.attributes)) body.setAttribute(attribute.name, attribute.value)
    for (const child of Array.from(parsed.head.childNodes)) appendHead(child)
    for (const child of Array.from(parsed.body.childNodes)) appendBody(child)
    const elements = Array.from(query('*'))
    if (elements.length > 16384) throw new Error('Preview element limit')
    const observer = new Observer(queue)
    observer.observe(body)
    for (const element of elements) observer.observe(element)
    const mutation = new Mutation(queue)
    mutation.observe(body, { subtree: true, childList: true, attributes: true, characterData: true })
    const images = Array.from(query('img')).filter((element): element is HTMLImageElement => element instanceof HTMLImageElement)
      .map(image => new Promise<void>((resolve, reject) => {
        if (image.complete) { if (image.naturalWidth > 0) resolve(); else reject(new Error('Preview image')); return }
        image.addEventListener('load', () => { resolve() }, { once: true })
        image.addEventListener('error', () => { reject(new Error('Preview image')) }, { once: true })
      }).then(async () => { await image.decode() }))
    const deadline = schedule(() => { if (!settled) { failed = true; report('error') } }, 5000)
    void Promise.all([doc.fonts.ready, ...images]).then(() => {
      cancel(deadline)
      if (failed) return
      settled = true; queue()
    }).catch(() => { cancel(deadline); failed = true; report('error') })
  } catch { failed = true; report('error') }
}

/** Parse authored markup once and remove executable behavior and independent navigation contexts. */
function sanitizedPreview(source: string): Document {
  const authored = new DOMParser().parseFromString(source, 'text/html')
  const forbidden = new Set(['script', 'meta', 'base', 'link', 'iframe', 'frame', 'object', 'embed', 'portal', 'fencedframe',
    'template', 'noscript'])
  for (const element of Array.from(authored.querySelectorAll('*'))) {
    if (forbidden.has(element.localName.toLowerCase())) { element.remove(); continue }
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || attribute.localName === 'nonce') element.removeAttributeNode(attribute)
    }
  }
  return authored
}

/** Put the trusted policy and viewport before all authored nodes. */
function previewShell(scriptPolicy: string): Document {
  const shell = new DOMParser().parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html')
  const policy = shell.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = `default-src 'none'; script-src ${scriptPolicy}; script-src-attr 'none'; style-src 'unsafe-inline'; ` +
    "img-src data: http: https:; font-src data: http: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; " +
    "form-action 'none'; base-uri 'none'"
  const viewport = shell.createElement('meta')
  viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'
  shell.head.append(policy, viewport)
  return shell
}

/**
 * Construct a controlled preview shell whose sole nonce-bearing script measures sanitized authored layout.
 * @param source - Standalone materialized preview HTML; authored behavior and navigation metadata are removed.
 * @param token - Fresh unpredictable source-generation token, also used as the only authorized CSP nonce.
 * @returns A complete srcdoc for sandbox="allow-scripts" without allow-same-origin; the parent must validate source and token.
 */
export function buildMeasuredCanvasDocument(source: string, token: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new Error('Invalid Canvas measurement token')
  const authored = sanitizedPreview(source), shell = previewShell(`'nonce-${token}'`)
  const script = shell.createElement('script')
  script.setAttribute('nonce', token)
  const payload = JSON.stringify(authored.documentElement.outerHTML).replaceAll('<', '\\u003c')
  script.textContent = `(${measurePreview.toString()})(${JSON.stringify(token)},${payload});`
  shell.body.append(script)
  return '<!doctype html>' + shell.documentElement.outerHTML
}

/**
 * Retain visible authored layout in a script-disabled shell after trusted automatic measurement fails.
 * @param source - Standalone materialized preview HTML, sanitized with the same behavior/navigation exclusions as measurement.
 * @returns A fixed-viewport srcdoc with CSP script-src none and authored head/body nodes following the trusted policy.
 */
export function buildStaticCanvasDocument(source: string): string {
  const authored = sanitizedPreview(source), shell = previewShell("'none'")
  for (const attribute of Array.from(authored.documentElement.attributes))
    shell.documentElement.setAttribute(attribute.name, attribute.value)
  for (const attribute of Array.from(authored.body.attributes)) shell.body.setAttribute(attribute.name, attribute.value)
  shell.head.append(...Array.from(authored.head.childNodes))
  shell.body.append(...Array.from(authored.body.childNodes))
  return '<!doctype html>' + shell.documentElement.outerHTML
}
