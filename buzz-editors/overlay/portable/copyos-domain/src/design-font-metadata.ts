/** Node-only metadata from the exact trusted Inter WOFF2 shipped to the browser; never reads caller font paths. */
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { create as readFont } from 'fontkit'
import type { CopyOSDesignFontMetadata } from './types.ts'

let bundled: Promise<Extract<CopyOSDesignFontMetadata, { state: 'available' }>> | undefined

async function readBundled(): Promise<Extract<CopyOSDesignFontMetadata, { state: 'available' }>> {
  const handle = await open(new URL('../fonts/Inter-latin.woff2', import.meta.url), 'r')
  let data: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > 2000000) throw new Error('Bundled font exceeds its 2 MB byte budget')
    data = Buffer.alloc(info.size)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
      if (!bytesRead) throw new Error('Bundled font changed while reading')
      offset += bytesRead
    }
    if ((await handle.stat()).size !== data.length) throw new Error('Bundled font changed while reading')
  } finally { await handle.close() }
  const font = readFont(data)
  if ('fonts' in font) throw new Error('Bundled font metadata requires one face')
  const entries = Object.entries(font.variationAxes)
  if (entries.length > 64) throw new Error('Bundled font exceeds its 64-axis budget')
  const axes = entries.map(([tag, axis]) => {
    if (!/^[A-Za-z0-9]{4}$/.test(tag) || !axis || !axis.name || axis.name.length > 200 ||
      ![axis.min, axis.default, axis.max].every(Number.isFinite) || axis.min > axis.default || axis.default > axis.max)
      throw new Error('Invalid bundled font axis metadata')
    return { tag, name: axis.name, min: axis.min, default: axis.default, max: axis.max }
  }).sort((left, right) => left.tag.localeCompare(right.tag, 'en'))
  return { state: 'available', family: 'Inter', source: 'bundled', sha256: createHash('sha256').update(data).digest('hex'), axes }
}

/**
 * Discover actual axes for Inter and CopyOSInter aliases, ignoring case, from the shipped font bytes.
 * @param family - Exact family name of 1–200 characters; no CSS list, path, network URL or local font is resolved.
 * @returns Independent metadata records; unknown families remain explicitly unavailable. Asset or metadata failures reject.
 */
export async function getBundledDesignFontMetadata(family: string): Promise<CopyOSDesignFontMetadata> {
  if (!family.length || family.length > 200) throw new Error('Font family must contain 1–200 characters')
  if (!['inter', 'copyosinter'].includes(family.toLowerCase())) return { state: 'unavailable', family, reason: 'unknown-family' }
  if (!bundled) bundled = readBundled().catch((error: unknown) => { bundled = undefined; throw error })
  return structuredClone(await bundled)
}
