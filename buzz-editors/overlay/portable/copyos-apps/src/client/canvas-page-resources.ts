/** Bounded parent-side project images and fonts for opaque-origin Canvas preview frames. */
import { projectAssetUrl } from './LandingPageVisualWorkspace.tsx'

const resourceBytes = 4 * 1024 * 1024, documentBytes = 16 * 1024 * 1024, cacheBytes = 16 * 1024 * 1024
const extensions: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
const fonts = new Set(['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff',
  'application/x-font-woff', 'application/x-font-ttf', 'application/x-font-opentype', 'application/vnd.ms-fontobject'])

/** Frame-local LRU data URLs; conservative UTF16 string sizes cap retained cache storage at 16 MiB. */
export type CanvasPageResourceCache = Map<string, { dataUrl: string; size: number; rawBytes: number }>

/**
 * Read a resource stream without allocating an unbounded response body.
 * @param response - Parent fetch response whose stream remains owned by this read.
 * @param signal - Cancellation for the current preview generation.
 * @param limit - Maximum retained bytes for this response.
 * @returns Complete bounded bytes; oversized or cancelled streams reject and release their reader.
 */
export async function readCanvasPreviewBytes(response: Response, signal: AbortSignal, limit: number): Promise<Uint8Array> {
  signal.throwIfAborted()
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error('Preview resource exceeds its byte limit')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  const cancel = (): void => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const next = await reader.read()
      signal.throwIfAborted()
      if (next.done) break
      total += next.value.byteLength
      if (total > limit) { await reader.cancel(); throw new Error('Preview resource exceeds its byte limit') }
      chunks.push(next.value)
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function scopedUrl(value: string, projectPath: string): string | null {
  if (!value.startsWith('/api/file?')) return null
  const url = new URL(value, window.location.href)
  if (url.hash || [...url.searchParams.keys()].some(key => key !== 'path') || url.searchParams.getAll('path').length !== 1) return null
  const path = url.searchParams.get('path') ?? '', root = projectPath.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalized = path.replaceAll('\\', '/')
  if (!root || !normalized.startsWith(root + '/') || /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.split('/').some(part => part === '..' || part === '.')) return null
  return projectAssetUrl(projectPath, normalized.slice(root.length + 1))
}
function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
  return `data:${mime};base64,${btoa(binary)}`
}
function remember(cache: CanvasPageResourceCache, url: string, value: { dataUrl: string; rawBytes: number }): void {
  const size = value.dataUrl.length * 2
  if (size > cacheBytes) return
  cache.delete(url)
  let retained = [...cache.values()].reduce((sum, item) => sum + item.size, 0)
  while (retained + size > cacheBytes) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    retained -= cache.get(oldest)?.size ?? 0; cache.delete(oldest)
  }
  cache.set(url, { ...value, size })
}

/**
 * Embed only bounded same-project image/font references; arbitrary HTTP or other-project URLs are never parent-fetched.
 * @param html - Standalone preview source already rewritten by the shared Builder asset resolver.
 * @param projectPath - Current project root; every authenticated fetch must remain within this lexical root.
 * @param signal - Current preview generation cancellation.
 * @param cache - Per-frame cache owned by this project view; callers replace it when project or page revision changes.
 * @returns HTML with local renderable references replaced by data URLs, plus explicit failure status. Media/object sources are unsupported.
 */
export async function embedCanvasPageResources(html: string, projectPath: string, signal: AbortSignal,
  cache: CanvasPageResourceCache): Promise<{ html: string; failed: boolean }> {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const references = new Map<string, { url: string; image: boolean }>(), replacements = new Map<string, string>()
  let failed = false
  const collect = (value: string | null, image: boolean, unsupported = false): void => {
    if (!value) return
    if (unsupported) { replacements.set(value, 'data:,'); failed = true; return }
    if (!value.startsWith('/api/file?')) return
    const url = scopedUrl(value, projectPath)
    if (!url) { replacements.set(value, 'data:,'); failed = true; return }
    references.set(value, { url, image: image || references.get(value)?.image === true })
  }
  const srcset = (value: string | null): void => {
    for (const item of value?.split(',') ?? []) collect(item.trim().split(/\s+/)[0] ?? null, true)
  }
  for (const element of document.querySelectorAll('img,input[type="image"]')) {
    collect(element.getAttribute('src'), true); srcset(element.getAttribute('srcset'))
  }
  for (const element of document.querySelectorAll('image')) collect(element.getAttribute('href') ?? element.getAttribute('xlink:href'), true)
  for (const element of document.querySelectorAll('source')) {
    const media = element.parentElement?.matches('video,audio') === true
    collect(element.getAttribute('src'), true, media); if (!media) srcset(element.getAttribute('srcset'))
  }
  for (const element of document.querySelectorAll('video,audio,object,embed')) {
    collect(element.getAttribute('src') ?? element.getAttribute('data'), true, true)
    collect(element.getAttribute('poster'), true)
  }
  for (const element of document.querySelectorAll('style,[style]')) {
    const css = element.tagName.toLowerCase() === 'style' ? element.textContent ?? '' : element.getAttribute('style') ?? ''
    for (const match of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu)) collect(match[2] ?? null, false)
  }
  if (references.size > 64) {
    for (const value of references.keys()) replacements.set(value, 'data:,')
    references.clear(); failed = true
  }
  const entries = [...references], fetched = new Map<string, Promise<{ dataUrl: string; rawBytes: number }>>()
  let next = 0, total = 0, exhausted = false
  const load = async (url: string, image: boolean): Promise<{ dataUrl: string; rawBytes: number }> => {
    const cached = cache.get(url)
    if (cached) { cache.delete(url); cache.set(url, cached); return cached }
    const response = await fetch(url, { signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error('Preview resource could not be loaded')
    const mimeHeader = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const path = new URL(url, window.location.href).searchParams.get('path') ?? ''
    const fallback = extensions[path.split('.').pop()?.toLowerCase() ?? '']
    const mime = !mimeHeader || mimeHeader === 'application/octet-stream' ? fallback : mimeHeader
    if (!mime || !(mime.startsWith('image/') || !image && fonts.has(mime))) throw new Error('Unsupported preview resource type')
    const bytes = await readCanvasPreviewBytes(response, signal, resourceBytes)
    signal.throwIfAborted()
    return { dataUrl: dataUrl(bytes, mime), rawBytes: bytes.byteLength }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (next < entries.length) {
      const entry = entries[next++]
      if (!entry) break
      const [value, { url, image }] = entry
      if (exhausted) { replacements.set(value, 'data:,'); failed = true; continue }
      try {
        let task = fetched.get(url)
        if (!task) { task = load(url, image); fetched.set(url, task) }
        const embedded = await task
        signal.throwIfAborted()
        if (image && !embedded.dataUrl.startsWith('data:image/')) throw new Error('Image resource has a font MIME type')
        total += embedded.rawBytes
        if (total > documentBytes) { exhausted = true; throw new Error('Preview resources exceed the document byte limit') }
        replacements.set(value, embedded.dataUrl)
        remember(cache, url, embedded)
      } catch (error) {
        if (signal.aborted) throw error
        replacements.set(value, 'data:,'); failed = true
      }
    }
  }))
  signal.throwIfAborted()
  const replace = (source: string): string => {
    let result = source
    for (const [value, replacement] of [...replacements].sort(([left], [right]) => right.length - left.length)) {
      for (const encoded of new Set([value, value.replaceAll('&', '&amp;')])) {
        const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(escaped + '(?=[\\s"\\x27<>),]|$)', 'g'), () => replacement)
      }
    }
    return result
  }
  const result = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/giu,
    (_whole, open: string, css: string, close: string) => open + replace(css) + close)
    .replace(/\b(src|srcset|poster|href|xlink:href|data|style)\s*=\s*(["'])([\s\S]*?)\2/giu,
      (_whole, name: string, quote: string, value: string) => `${name}=${quote}${replace(value)}${quote}`)
  return { html: result, failed }
}
