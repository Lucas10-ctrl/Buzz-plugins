/**
 * Canvas access to project image files named by `copyos-asset:` references. Each file is fetched once per Canvas through the
 * signed-in project-file route and kept as a blob URL; self-contained outputs get `data:` URLs from the same bytes.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import {
  DESIGN_IMAGE_ASSET_DIRECTORY,
  isDesignImageAssetReference,
  isDesignImageData,
  mapDesignImageUrls,
  parseDesignImageAssetReference,
  resolveDesignImageUrls,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument } from '../../../copyos-domain/src/types.ts'

/** Project image access shared by the Canvas, inspector and exports. */
export interface DesignerImageAssets {
  /** Renderable URL for an image field value: the input unless it is a reference; `''` while a reference loads or after it failed. */
  href(url: string): string
  /** Bytes of an image field value as a `data:` URL; non-reference values are returned unchanged. The 8 most recent results are kept. */
  dataUrl(url: string): Promise<string>
  /** Loadable URL for an image field value, waiting for a reference's blob URL; non-reference values are returned unchanged. */
  resolve(url: string): Promise<string>
  /** Store an embedded image as a project file and return its reference; returns the input when storage is unavailable or fails. */
  store(dataUrl: string): Promise<string>
  /** Replace every reference in a design with a `data:` URL, for exports and other self-contained copies. */
  embed(document: CopyOSDesignDocument): Promise<CopyOSDesignDocument>
  /** Notify when a reference finished loading. */
  subscribe(listener: () => void): () => void
  /** Increments whenever {@link href} results change. */
  version(): number
  /** Release blob URLs. */
  dispose(): void
}

/** Transport for {@link createDesignerImageAssets}. */
export interface DesignerImageAssetsOptions {
  /** Read one stored file by its project-relative path. */
  read(path: string): Promise<Blob>
  /** Store base64 bytes and return the reference; absent keeps embedded images until the server converts them on save. */
  put?: ((dataBase64: string) => Promise<string>) | undefined
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result); else reject(new Error('Image could not be encoded')) }
    reader.onerror = () => { reject(reader.error ?? new Error('Image could not be read')) }
    reader.readAsDataURL(blob)
  })
}

/** Project-file transport through the authenticated document-relative `api/file` route, preserving a deployment URL prefix.
 * @param projectPath - Absolute project folder.
 * @returns A reader for project-relative paths.
 */
export function projectFileImageReader(projectPath: string): (path: string) => Promise<Blob> {
  const root = projectPath.replace(/[\\/]+$/u, '')
  return async (path) => {
    const response = await fetch(`api/file?path=${encodeURIComponent(`${root}/${path}`)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Project image ${path} could not be loaded (HTTP ${response.status})`)
    return response.blob()
  }
}

/** Create the image access for one open project.
 * @param options - File reader and optional upload.
 * @returns Image access; call `dispose` when the project closes.
 */
export function createDesignerImageAssets(options: DesignerImageAssetsOptions): DesignerImageAssets {
  const blobs = new Map<string, Promise<Blob>>(), hrefs = new Map<string, string>(), failed = new Set<string>()
  const listeners = new Set<() => void>()
  let revision = 0, disposed = false
  const blob = (url: string): Promise<Blob> => {
    const reference = parseDesignImageAssetReference(url)
    if (!reference) return Promise.reject(new Error('Invalid project image reference'))
    let pending = blobs.get(url)
    if (!pending) {
      pending = options.read(`${DESIGN_IMAGE_ASSET_DIRECTORY}/${reference.fileName}`)
      blobs.set(url, pending)
      pending.catch(() => { blobs.delete(url) })
    }
    return pending
  }
  const changed = (): void => { revision++; for (const listener of listeners) listener() }
  const datas = new Map<string, Promise<string>>()
  const dataUrl = (url: string): Promise<string> => {
    if (!isDesignImageAssetReference(url)) return Promise.resolve(url)
    const pending = datas.get(url) ?? blob(url).then(blobDataUrl)
    datas.delete(url); datas.set(url, pending)
    pending.catch(() => { datas.delete(url) })
    for (const key of datas.keys()) { if (datas.size <= 8) break; datas.delete(key) }
    return pending
  }
  const objectUrl = async (url: string): Promise<string> => {
    const value = await blob(url)
    if (disposed) throw new Error('Project closed')
    let href = hrefs.get(url)
    if (href === undefined) { href = URL.createObjectURL(value); hrefs.set(url, href); failed.delete(url); changed() }
    return href
  }
  return {
    href(url) {
      if (!isDesignImageAssetReference(url)) return url
      const loaded = hrefs.get(url)
      if (loaded !== undefined || failed.has(url)) return loaded ?? ''
      if (!blobs.has(url)) objectUrl(url).catch(() => { if (!disposed) { failed.add(url); changed() } })
      return ''
    },
    dataUrl,
    resolve: url => isDesignImageAssetReference(url) ? objectUrl(url) : Promise.resolve(url),
    async store(dataUrl) {
      if (!options.put || !isDesignImageData(dataUrl)) return dataUrl
      try {
        const reference = await options.put(dataUrl.slice(dataUrl.indexOf(',') + 1))
        return isDesignImageAssetReference(reference) ? reference : dataUrl
      } catch (error: unknown) {
        // Saving converts embedded images too, so a failed upload only delays storage.
        void error
        return dataUrl
      }
    },
    embed: document => resolveDesignImageUrls(document, dataUrl, isDesignImageAssetReference),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    version: () => revision,
    dispose() {
      disposed = true
      for (const href of hrefs.values()) URL.revokeObjectURL(href)
      hrefs.clear(); blobs.clear(); datas.clear(); failed.clear(); listeners.clear()
    },
  }
}

/** Image access for the open project; `null` renders references as empty images. */
export const DesignerImageAssetsContext = createContext<DesignerImageAssets | null>(null)

/** Read the open project's image access.
 * @returns The provided access, or `null` outside a project Canvas.
 */
export function useDesignerImageAssets(): DesignerImageAssets | null {
  return useContext(DesignerImageAssetsContext)
}

const noSubscription = (): (() => void) => () => undefined
const noVersion = (): number => 0
/** Renderable URL for one image field value, re-rendering when a referenced file finishes loading.
 * @param url - Image field value.
 * @returns A blob URL for a loaded reference, `''` while it loads, or the input for other values.
 */
export function useDesignerImageHref(url: string): string {
  const assets = useDesignerImageAssets()
  const subscribe = useCallback((listener: () => void) => assets ? assets.subscribe(listener) : noSubscription(), [assets])
  const snapshot = useCallback(() => assets ? assets.version() : noVersion(), [assets])
  useSyncExternalStore(subscribe, snapshot)
  return assets ? assets.href(url) : isDesignImageAssetReference(url) ? '' : url
}

/** `data:` URL for one image field value, for SVG data images that cannot load other URLs.
 * @param url - Image field value.
 * @returns The input for non-reference values; for references, `''` until the bytes are read.
 */
export function useDesignerImageData(url: string): string {
  const assets = useDesignerImageAssets(), reference = isDesignImageAssetReference(url)
  const [loaded, setLoaded] = useState<{ url: string; data: string } | null>(null)
  useEffect(() => {
    if (!reference || !assets) return
    let live = true
    assets.dataUrl(url).then((data) => { if (live) setLoaded({ url, data }) }, () => { if (live) setLoaded({ url, data: '' }) })
    return () => { live = false }
  }, [assets, reference, url])
  if (!reference) return url
  return loaded?.url === url ? loaded.data : ''
}

/** Load an image field value into an image element, resolving references through the open project.
 * @param assets - Project image access, or `null` outside a project Canvas.
 * @param url - Image field value.
 * @param image - Element to load; an unavailable reference dispatches its `error` event.
 */
export function loadDesignerImageElement(assets: DesignerImageAssets | null, url: string, image: HTMLImageElement): void {
  if (!isDesignImageAssetReference(url)) { image.src = url; return }
  if (!assets) { image.dispatchEvent(new Event('error')); return }
  assets.resolve(url).then((href) => { image.src = href }, () => { image.dispatchEvent(new Event('error')) })
}

/** Pair embedded images in a saved snapshot with the references the server stored them as.
 * @param before - Document sent to the server.
 * @param after - Document the server saved.
 * @returns Embedded image → reference, empty when the documents' layers or image fields do not line up.
 */
export function designImageReplacements(before: CopyOSDesignDocument, after: CopyOSDesignDocument): Map<string, string> {
  const sent: string[] = [], saved: string[] = [], replacements = new Map<string, string>()
  if (before.nodes.length !== after.nodes.length || before.nodes.some((node, index) => node.id !== after.nodes[index]?.id))
    return replacements
  mapDesignImageUrls(before, (url) => { sent.push(url); return url })
  mapDesignImageUrls(after, (url) => { saved.push(url); return url })
  if (sent.length !== saved.length) return replacements
  sent.forEach((url, index) => {
    const stored = saved[index]
    if (stored !== undefined && isDesignImageData(url) && isDesignImageAssetReference(stored)) replacements.set(url, stored)
  })
  return replacements
}
