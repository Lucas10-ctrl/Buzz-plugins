/** Browser-safe ZIP packaging for exported artboard files and their `manifest.json`. */
import { zipSync } from 'fflate'

/** One exported artboard file and the facts needed to reproduce it. */
export interface DesignExportBundleFile {
  /** File name inside the archive; names are made unique and path separators removed. */
  name: string
  data: Uint8Array
  frameId: string
  frameName: string
  width: number
  height: number
  scale: number
  format: 'png' | 'jpeg' | 'webp' | 'svg'
  /** Lowercase hexadecimal SHA-256 of `data`. */
  sha256: string
}

/**
 * Package exported files with a `manifest.json` recording design identity, revision and renderer, plus each file's frame,
 * size, scale, format and SHA-256.
 * @param design - Exported design identity, last saved revision, title and whether the export included unsaved edits.
 * @param files - Encoded files in export order.
 * @param renderer - Renderer identity recorded in the manifest.
 * @returns ZIP bytes; raster data is stored uncompressed, SVG files and the manifest are deflated.
 */
export function packDesignExportBundle(design: { id: string; revision: number; title: string; unsaved: boolean },
  files: readonly DesignExportBundleFile[], renderer: string): Uint8Array {
  const used = new Set<string>(['manifest.json'])
  const named = files.map((file) => {
    const safe = file.name.replace(/[\\/]+/g, '-').trim() || 'artboard'
    let name = safe
    for (let index = 2; used.has(name); index++) name = safe.replace(/(\.[a-z]+)?$/, `-${index}$1`)
    used.add(name)
    return { ...file, name }
  })
  const manifest = { version: 1, designId: design.id, designRevision: design.revision, designTitle: design.title,
    includesUnsavedChanges: design.unsaved, renderer,
    files: named.map(({ data: _data, ...file }) => file) }
  return zipSync({ 'manifest.json': [new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), { level: 6 }],
    ...Object.fromEntries(named.map(file => [file.name, [file.data, { level: file.format === 'svg' ? 6 : 0 }]])) })
}
