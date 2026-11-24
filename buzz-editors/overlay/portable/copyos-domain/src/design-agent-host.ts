/**
 * Host services behind the agent's Canvas tools: pictures from paths, URLs or data URLs; every installed project font; node defaults for
 * new layers; one renderer shared by viewDesign and exportDesign, so what the agent checks is the exported pixels; and a read of the
 * design system (components, text styles, variables and modes).
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { createDesignNode, resolveDesignNodes } from './design-model.ts'
import { CopyOSDesignFontStore, DESIGN_FONT_DIRECTORY } from './design-font-store.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import { createDesignRasterizer, type DesignRasterResult } from './design-raster.ts'
import { createDesignTextMeasurer, loadBundledDesignMeasurementFonts } from './design-text-measurement.ts'
import { measureDesignTextSync } from './design-measure-text.ts'
import { DESIGN_IMAGE_ASSET_MAX_BYTES } from './design-image-assets.ts'
import type { DesignMeasurementFont } from './design-text-measurement-types.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignNodeKind } from './types.ts'

const images = new CopyOSDesignImageStore()
/** Google family drawn for symbols (★ ✓ ✕ → …) that brand fonts lack. */
export const DESIGN_SYMBOL_FALLBACK_FAMILY = 'Noto Sans Symbols 2'
/** Every symbol fallback, tried in order: Symbols 2 (★ ✓ ✎ arrows, dingbats), then Symbols (technical signs such as ⌄ ⌕ ⏎). */
export const DESIGN_SYMBOL_FALLBACK_FAMILIES = [DESIGN_SYMBOL_FALLBACK_FAMILY, 'Noto Sans Symbols'] as const
/** Colour emoji family (Noto Color Emoji, open licence). Figma's own renders use Apple-style artwork, which cannot be shipped; Canvas matches Figma's emoji size, advance and line box. */
export const DESIGN_EMOJI_FALLBACK_FAMILY = 'Noto Color Emoji'
/** Arrows, maths, technical, boxes, shapes, misc symbols, dingbats and supplemental arrows/symbols. */
export const designUsesSymbols = (text: string): boolean => /[\u2190-\u2bff\u{1f300}-\u{1faff}]/u.test(text)
/** Emoji pictographs, flags and keycaps. */
export const designUsesEmoji = (text: string): boolean => /[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}\u20e3]/u.test(text)
const fonts = new CopyOSDesignFontStore()

/**
 * Read picture bytes from a local path, an http(s) URL or a data: URL.
 * @param source - `/abs/path.png`, `~/path.png`, `https://…` or `data:image/png;base64,…`.
 * @param base - Directory that relative paths resolve against.
 * @param what - What the file is, for error messages ('picture' or 'font').
 * @returns The bytes; whether they are a picture is checked when they are stored.
 */
export async function readDesignImageSource(source: string, base = process.cwd(), what = 'picture'): Promise<Uint8Array> {
  const value = source.trim()
  if (value.startsWith('data:')) {
    const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(value)
    if (!match) throw new Error('Unreadable data: URL')
    return match[1] ? Buffer.from(match[2] ?? '', 'base64') : Buffer.from(decodeURIComponent(match[2] ?? ''), 'latin1')
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { signal: AbortSignal.timeout(30_000), redirect: 'follow' })
    if (!response.ok) throw new Error(`The ${what} URL answered ${String(response.status)}`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > DESIGN_IMAGE_ASSET_MAX_BYTES) throw new Error(`The ${what} is too large`)
    return new Uint8Array(await response.arrayBuffer())
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`A ${what} comes from a file path, an http(s) URL or a data: URL`)
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : isAbsolute(value) ? value : resolve(base, value)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) throw new Error(`No ${what} file at ${path}`)
  if (info.size > DESIGN_IMAGE_ASSET_MAX_BYTES) throw new Error(`The ${what} is too large`)
  return new Uint8Array(await readFile(path))
}

/**
 * Store a picture in the project.
 * @param root - Project root.
 * @param source - Path, URL or data URL.
 * @param base - Directory for relative paths.
 * @returns Its `copyos-asset:` reference and pixel size.
 */
export async function storeDesignImageSource(root: string, source: string, base?: string): Promise<{ url: string; width: number; height: number }> {
  const bytes = await readDesignImageSource(source, base)
  const url = await images.put(root, bytes)
  const meta = await sharp(bytes).metadata()
  const rotated = (meta.orientation ?? 1) >= 5
  return { url, width: (rotated ? meta.height : meta.width) ?? 0, height: (rotated ? meta.width : meta.height) ?? 0 }
}

/** Where the shared colour emoji font is cached for every project on this machine (it is 25 MB, too big for a project). */
export function designEmojiFontPath(): string {
  return process.env.COPYOS_EMOJI_FONT ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'copyos-design-fonts', 'NotoColorEmoji.ttf')
}
let emojiBytes: Promise<Uint8Array | undefined> | undefined
/** Figma draws Noto Color Emoji at 0.87 of the size the font itself declares (measured on 😆 🤢 at 110 px: 99 px against 114 px). */
const EMOJI_SCALE = 0.87
const tag = (bytes: Uint8Array, at: number): string => String.fromCharCode(...bytes.slice(at, at + 4))
/**
 * A GPOS table with one single-adjustment lookup (feature `kern`, every script): each group of glyphs moves left by its
 * `placement` and advances `advance` less, so the ink stays centred in a narrower box. One format-1 subtable per group, with
 * range coverage, keeps the table small for fonts with tens of thousands of glyphs.
 */
function emojiAdvanceGpos(groups: { placement: number; advance: number; ids: number[] }[]): Uint8Array {
  const ranges = groups.map(group => {
    const list: [number, number][] = []
    for (const id of group.ids) { const last = list.at(-1); if (last && id === last[1] + 1) last[1] = id; else list.push([id, id]) }
    return list
  })
  const subtableSizes = ranges.map(list => 10 + 4 + 6 * list.length)
  const scripts = 10, features = scripts + 20, lookups = features + 14, lookup = lookups + 4
  const firstSubtable = lookup + 6 + 2 * groups.length
  // HarfBuzz budgets sanitising by table size (64 operations per byte) and a range coverage of N glyphs costs N / 2, so a few
  // bytes covering 40 000 emoji would be rejected as a whole. Unreferenced zero padding after the subtables buys that budget.
  const population = groups.reduce((sum, group) => sum + group.ids.length, 0)
  const used = firstSubtable + subtableSizes.reduce((sum, size) => sum + size, 0)
  const out = new DataView(new ArrayBuffer(Math.max(used, Math.ceil(population / 64) + 4096)))
  const tagAt = (at: number, value: string) => { [...value].forEach((c, i) => { out.setUint8(at + i, c.charCodeAt(0)) }) }
  out.setUint16(0, 1); out.setUint16(2, 0); out.setUint16(4, scripts); out.setUint16(6, features); out.setUint16(8, lookups)
  // ScriptList: DFLT with a default LangSys that turns on feature 0.
  out.setUint16(scripts, 1); tagAt(scripts + 2, 'DFLT'); out.setUint16(scripts + 6, 8)
  out.setUint16(scripts + 8, 4); out.setUint16(scripts + 10, 0)
  out.setUint16(scripts + 12, 0); out.setUint16(scripts + 14, 0xffff); out.setUint16(scripts + 16, 1); out.setUint16(scripts + 18, 0)
  // FeatureList: kern → lookup 0.
  out.setUint16(features, 1); tagAt(features + 2, 'kern'); out.setUint16(features + 6, 8)
  out.setUint16(features + 8, 0); out.setUint16(features + 10, 1); out.setUint16(features + 12, 0)
  // LookupList: one SinglePos lookup.
  out.setUint16(lookups, 1); out.setUint16(lookups + 2, 4)
  out.setUint16(lookup, 1); out.setUint16(lookup + 2, 0); out.setUint16(lookup + 4, groups.length)
  let at = firstSubtable
  groups.forEach((group, index) => {
    out.setUint16(lookup + 6 + 2 * index, at - lookup)
    // SinglePos format 1: one XPlacement + XAdvance for every covered glyph; coverage format 2 (ranges) follows it.
    out.setUint16(at, 1); out.setUint16(at + 2, 10); out.setUint16(at + 4, 0x0005)
    out.setInt16(at + 6, -group.placement); out.setInt16(at + 8, -group.advance)
    const list = ranges[index] ?? []
    out.setUint16(at + 10, 2); out.setUint16(at + 12, list.length)
    let covered = 0
    list.forEach(([start, end], i) => {
      out.setUint16(at + 14 + 6 * i, start); out.setUint16(at + 16 + 6 * i, end); out.setUint16(at + 18 + 6 * i, covered)
      covered += end - start + 1
    })
    at += subtableSizes[index] ?? 0
  })
  return new Uint8Array(out.buffer)
}
/**
 * Lay the emoji font out the way Figma draws emoji: glyphs at 0.87 of the font's declared size (units per em raised in `head`),
 * each emoji advancing exactly 1 em with its ink centred (a GPOS adjustment), and a 1 em line box (ascender + descender scaled
 * to the em, so an emoji-only line set to AUTO is as tall as the font size and the emoji sits centred in any fixed line height).
 * @param bytes - Noto Color Emoji as fetched.
 * @returns A patched copy; unknown layouts are returned unchanged (or only resized).
 */
export function designFigmaSizedEmoji(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(4)
  const tables = Array.from({ length: count }, (_, index) => {
    const record = 12 + 16 * index
    return { tag: tag(bytes, record), offset: view.getUint32(record + 8), length: view.getUint32(record + 12) }
  })
  const find = (name: string) => tables.find(table => table.tag === name)
  const head = find('head'), hhea = find('hhea'), os2 = find('OS/2'), hmtx = find('hmtx'), maxp = find('maxp')
  if (!head) return bytes
  const copy = bytes.slice(), edit = new DataView(copy.buffer)
  const unitsPerEm = view.getUint16(head.offset + 18), em = Math.round(unitsPerEm / EMOJI_SCALE)
  edit.setUint16(head.offset + 18, em)
  if (!hhea || !hmtx || !maxp || find('GPOS')) return copy
  // Line box: the font's own ascender/descender split, scaled so the two add up to one em, with no line gap.
  const ascent = view.getInt16(hhea.offset + 4), descent = -view.getInt16(hhea.offset + 6)
  if (ascent + descent <= 0) return copy
  const newAscent = Math.round(em * ascent / (ascent + descent)), newDescent = em - newAscent
  edit.setInt16(hhea.offset + 4, newAscent); edit.setInt16(hhea.offset + 6, -newDescent); edit.setInt16(hhea.offset + 8, 0)
  if (os2 && os2.length >= 78) {
    edit.setInt16(os2.offset + 68, newAscent); edit.setInt16(os2.offset + 70, -newDescent); edit.setInt16(os2.offset + 72, 0)
    edit.setUint16(os2.offset + 74, newAscent); edit.setUint16(os2.offset + 76, newDescent)
  }
  // Advances: every glyph wider than one em is pulled in to one em, half from each side.
  const glyphCount = view.getUint16(maxp.offset + 4), metrics = view.getUint16(hhea.offset + 34)
  const groups = new Map<number, { placement: number; advance: number; ids: number[] }>()
  let advance = 0
  for (let id = 0; id < glyphCount; id++) {
    if (id < metrics) advance = view.getUint16(hmtx.offset + 4 * id)
    if (advance <= em) continue
    let group = groups.get(advance)
    if (!group) groups.set(advance, group = { placement: Math.round((advance - em) / 2), advance: advance - em, ids: [] })
    group.ids.push(id)
  }
  if (!groups.size || groups.size > 64) return copy
  // Rebuild the font file with the GPOS table added (tables sorted by tag, 4-byte aligned).
  const gpos = emojiAdvanceGpos([...groups.values()])
  const entries = [...tables.map(table => ({ tag: table.tag, data: copy.subarray(table.offset, table.offset + table.length) })), { tag: 'GPOS', data: gpos }]
    .sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
  const directory = 12 + 16 * entries.length
  const total = entries.reduce((size, entry) => size + Math.ceil(entry.data.length / 4) * 4, directory)
  const font = new Uint8Array(total), out = new DataView(font.buffer)
  font.set(copy.subarray(0, 4))
  const power = 2 ** Math.floor(Math.log2(entries.length))
  out.setUint16(4, entries.length); out.setUint16(6, power * 16); out.setUint16(8, Math.log2(power)); out.setUint16(10, entries.length * 16 - power * 16)
  let offset = directory
  entries.forEach((entry, index) => {
    const record = 12 + 16 * index
    ;[...entry.tag].forEach((c, i) => { out.setUint8(record + i, c.charCodeAt(0)) })
    font.set(entry.data, offset)
    let sum = 0
    for (let at = 0; at < entry.data.length; at += 4) sum = (sum + out.getUint32(offset + at)) >>> 0
    out.setUint32(record + 4, sum); out.setUint32(record + 8, offset); out.setUint32(record + 12, entry.data.length)
    offset += Math.ceil(entry.data.length / 4) * 4
  })
  return font
}
/**
 * The colour emoji font: read from the shared cache, or fetched once from Google Fonts and cached. Offline with no cache, emoji
 * stay unavailable (reported as missing characters) rather than failing the render.
 * @returns Its bytes, or undefined when it cannot be had.
 */
export function loadDesignEmojiFont(): Promise<Uint8Array | undefined> {
  return emojiBytes ??= (async () => {
    const path = designEmojiFontPath()
    try { return designFigmaSizedEmoji(new Uint8Array(await readFile(path))) } catch { /* not cached yet */ }
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji', { signal: AbortSignal.timeout(20_000) })).text()
      const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.ttf)\)/.exec(css)?.[1]
      if (!url) return undefined
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!response.ok) return undefined
      const bytes = new Uint8Array(await response.arrayBuffer())
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${String(process.pid)}.tmp`
      await writeFile(temporary, bytes)
      await rename(temporary, path).catch(async () => { await rm(temporary, { force: true }) })
      return designFigmaSizedEmoji(bytes)
    } catch { emojiBytes = undefined; return undefined }
  })()
}

const firstFamilyName = (value: string): string => value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? value
/** Whether any text in a design (layers, instance overrides) has emoji. */
export function designDocumentUsesEmoji(document: CopyOSDesignDocument): boolean {
  return document.nodes.some(node => (node.kind === 'text' && designUsesEmoji(node.text)) ||
    (node.instanceOverrides ?? []).some(record => record.text !== undefined && designUsesEmoji(record.text)))
}

/**
 * The families a design draws text with: text layers, their runs and text styles.
 * @param document - Design.
 * @returns Family names as written.
 */
export function designDocumentFamilies(document: CopyOSDesignDocument): string[] {
  const named = new Set<string>()
  for (const node of document.nodes) {
    if (node.kind !== 'text') continue
    named.add(firstFamilyName(node.fontFamily))
    for (const run of node.textRuns ?? []) if (run.style.fontFamily) named.add(firstFamilyName(run.style.fontFamily))
  }
  for (const style of document.textStyles ?? []) named.add(firstFamilyName(style.fontFamily))
  return [...named]
}

/**
 * The faces the project can draw: the bundled Inter plus installed fonts, registered at each weight they cover. There is no cap on
 * how many fonts a project holds: pass `families` (the ones a design or script uses) and only those are loaded. The symbol
 * fallback is added when installed, and the colour emoji font unless `options.emoji` is false (pass whether the text has emoji).
 * @param root - Project root.
 * @param families - Families to load; omitted loads every installed family.
 * @returns Faces for the text engine.
 */
export async function loadAllDesignProjectFonts(root: string, families?: Iterable<string>, options: { emoji?: boolean } = {}): Promise<DesignMeasurementFont[]> {
  const wanted = families ? new Set([...families].map(name => firstFamilyName(name).toLowerCase())) : undefined
  for (const family of DESIGN_SYMBOL_FALLBACK_FAMILIES) wanted?.add(family.toLowerCase())
  const result = await loadBundledDesignMeasurementFonts()
  const files = new Map<string, Uint8Array>()
  // Installed faces come first in priority over the built-in Inter (a project may install its own Inter).
  const installed = (await fonts.list(root)).filter(face => !wanted || wanted.has(face.family.toLowerCase()))
  const ownInter = installed.some(face => face.family.toLowerCase() === 'inter')
  if (ownInter) result.splice(0, result.length)
  for (const face of installed) {
    let data = files.get(face.file)
    if (!data) { data = new Uint8Array(await readFile(join(root, DESIGN_FONT_DIRECTORY, face.file))); files.set(face.file, data) }
    const weights = new Set<number>([face.weightMin, face.weightMax])
    for (let weight = Math.ceil(face.weightMin / 100) * 100; weight <= face.weightMax; weight += 100) weights.add(weight)
    for (const weight of weights) {
      if (!result.some(item => item.family.toLowerCase() === face.family.toLowerCase() && item.weight === weight && item.style === face.style))
        result.push({ family: face.family, weight, style: face.style, data })
    }
  }
  if (!result.length) result.push(...await loadBundledDesignMeasurementFonts())
  const emoji = options.emoji === false ? undefined : await loadDesignEmojiFont()
  if (emoji && !result.some(face => face.family.toLowerCase() === DESIGN_EMOJI_FALLBACK_FAMILY.toLowerCase()))
    result.push({ family: DESIGN_EMOJI_FALLBACK_FAMILY, weight: 400, style: 'normal', data: emoji })
  return result
}

/** Fallback families to hand the text engine for these faces. */
export function designFallbackFamilies(faces: readonly DesignMeasurementFont[]): string[] {
  // Emoji first, as Figma does: ❤ and 👍 draw in colour; symbols the emoji font lacks (★ ✓ →) fall through to Noto Sans Symbols 2,
  // and technical signs (⌄ ⌕ ⏎) to Noto Sans Symbols.
  return [DESIGN_EMOJI_FALLBACK_FAMILY, ...DESIGN_SYMBOL_FALLBACK_FAMILIES]
    .filter(family => faces.some(face => face.family.toLowerCase() === family.toLowerCase()))
}

/**
 * Install the symbol fallback fonts. Google splits them by character range and the font store keeps only Latin ranges, so each
 * family's `symbols` range is fetched here and stored as the project's copy of the family.
 * @param root - Project root.
 * @returns Whether the first (main) symbol font is installed.
 */
export async function installDesignSymbolFont(root: string): Promise<boolean> {
  const faces = await fonts.list(root)
  const results: boolean[] = []
  for (const family of DESIGN_SYMBOL_FALLBACK_FAMILIES) {
    if (faces.some(face => face.family.toLowerCase() === family.toLowerCase() && face.source === 'upload')) { results.push(true); continue }
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&display=swap`, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
      })).text()
      const url = /\/\*\s*symbols\s*\*\/\s*@font-face\s*\{[^}]*src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(css)?.[1]
      if (!url) { results.push(false); continue }
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) { results.push(false); continue }
      await fonts.upload(root, new Uint8Array(await response.arrayBuffer()))
      results.push(true)
    } catch { results.push(false) }
  }
  return results[0] ?? false
}

/**
 * Install any Google font a design names but the project lacks.
 * @param root - Project root.
 * @param document - Design whose text layers, runs and styles name families.
 * @returns Families Google Fonts does not have.
 */
export async function installDesignDocumentFonts(root: string, document: CopyOSDesignDocument): Promise<string[]> {
  const named = new Set(designDocumentFamilies(document))
  if (document.nodes.some(node => node.kind === 'text' && designUsesSymbols(node.text))) await installDesignSymbolFont(root)
  const installed = new Set(['inter', ...(await fonts.list(root)).map(face => face.family.toLowerCase())])
  const missing = [...named].filter(family => family && !installed.has(family.toLowerCase()) && !/^(sans-serif|serif|monospace|system-ui)$/i.test(family) &&
    family.toLowerCase() !== DESIGN_EMOJI_FALLBACK_FAMILY.toLowerCase())
  if (!missing.length) return []
  const result = await fonts.installGoogle(root, missing, { cssUrl: 'https://fonts.googleapis.com/css2', fetch: globalThis.fetch })
  return result.unavailable
}

/**
 * Measure every visible text layer with the project's fonts so hug sizes, wrapping and auto-height are exact before saving.
 * @param root - Project root.
 * @param document - Candidate design.
 * @returns The measured design and the layers that could not be measured.
 */
export async function measureDesignDocumentText(root: string, document: CopyOSDesignDocument):
Promise<{ document: CopyOSDesignDocument; unmeasured: { id: string; name: string; code: string; family?: string | undefined }[] }> {
  const faces = await loadAllDesignProjectFonts(root, designDocumentFamilies(document), { emoji: designDocumentUsesEmoji(document) })
  const measurer = await createDesignTextMeasurer({ fonts: faces, fallbackFamilies: designFallbackFamilies(faces) })
  try {
    let result = measureDesignTextSync(document, measurer)
    // Stored sizes of auto-sized text follow their measurement, so a Hug parent never sizes itself from a stale value.
    for (let pass = 0; pass < 3; pass++) {
      const resolved = new Map(resolveDesignNodes(result.document).map(node => [node.id, node]))
      let changed = false
      const nodes = result.document.nodes.map((node) => {
        const shown = resolved.get(node.id)
        if (node.kind !== 'text' || !shown || node.textSizing === 'fixed' || node.textSizing === undefined) return node
        const width = node.textSizing === 'auto-width' ? shown.width : node.width
        if (Math.abs(width - node.width) < 0.01 && Math.abs(shown.height - node.height) < 0.01) return node
        changed = true
        return { ...node, width, height: shown.height }
      })
      if (!changed) break
      result = measureDesignTextSync({ ...result.document, nodes }, measurer)
    }
    const names = new Map(document.nodes.map(node => [node.id, node.name]))
    return { document: result.document, unmeasured: result.unmeasured.map(item => ({ ...item, name: names.get(item.id) ?? '' })) }
  } finally { measurer.dispose() }
}

/** Figma-like defaults for a new layer of each kind, used when an agent's upsert omits fields. */
export function designAgentNodeDefaults(kind: CopyOSDesignNodeKind): CopyOSDesignNode {
  const node = createDesignNode(kind, '00000000-0000-4000-8000-000000000000', kind)
  node.x = 0; node.y = 0
  if (kind === 'frame' || kind === 'component') { node.gap = 0; node.padding = 0; node.widthSizing = 'fixed'; node.heightSizing = 'fixed' }
  if (kind === 'text') { node.fontFamily = 'Inter'; node.fill = '#000000'; node.textSizing = 'auto-width'; node.lineHeight = 1.2 }
  if (kind === 'rectangle' || kind === 'ellipse') { node.radius = 0; node.fill = '#d9d9d9' }
  return node
}

/**
 * Render one artboard at an exact scale. viewDesign and exportDesign both call this, so the agent checks the pixels it exports.
 * @param root - Project root.
 * @param document - Saved design.
 * @param artboardId - Visible top-level frame.
 * @param scale - Output pixels per design pixel (1–3).
 * @param region - Optional vertical region in design pixels.
 * @returns The PNG and its notes.
 */
export async function renderDesignArtboard(root: string, document: CopyOSDesignDocument, artboardId: string, scale: number,
  region?: { top: number; height: number }): Promise<DesignRasterResult> {
  await installDesignDocumentFonts(root, document).catch(() => [])
  const artboard = document.nodes.find(node => node.id === artboardId)
  if (!artboard) throw new Error('Artboard not found')
  const height = region?.height ?? artboard.height
  const faces = await loadAllDesignProjectFonts(root, designDocumentFamilies(document), { emoji: designDocumentUsesEmoji(document) })
  const rasterizer = await createDesignRasterizer(faces, { fallbackFamilies: designFallbackFamilies(faces) })
  try {
    return await rasterizer.render(document, {
      artboardId, maxWidth: Math.round(artboard.width * scale), maxHeight: Math.round(height * scale), scaleLimit: scale,
      ...(region ? { region } : {}),
      readImage: async fileName => (await images.read(root, `copyos-asset:${fileName}`)).bytes,
    })
  } finally { rasterizer.dispose() }
}

/**
 * The design system an agent builds with: components (with variant axes), text styles, colour and number variables per mode,
 * and the named layers of each top-level frame that templates fill.
 * @param document - Design.
 * @returns A compact JSON summary.
 */
export function describeDesignSystem(document: CopyOSDesignDocument): unknown {
  const modes = document.tokenModes ?? []
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  const path = (node: CopyOSDesignNode): string => {
    const names: string[] = []
    for (let cursor: CopyOSDesignNode | undefined = node; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) names.unshift(cursor.name)
    return names.join(' / ')
  }
  const slots = (frame: CopyOSDesignNode): { id: string; name: string; kind: string; text?: string }[] => {
    const result: { id: string; name: string; kind: string; text?: string }[] = []
    const walk = (parentId: string): void => {
      for (const node of document.nodes) {
        if (node.parentId !== parentId) continue
        if (!node.name.startsWith('_') && (node.kind === 'text' || node.name.startsWith('slot/')))
          result.push({ id: node.id, name: node.name, kind: node.kind, ...(node.kind === 'text' ? { text: node.text.slice(0, 80) } : {}) })
        walk(node.id)
      }
    }
    walk(frame.id)
    return result
  }
  return {
    collection: { id: 'VariableCollectionId:canvas', modes: [{ modeId: 'base', name: 'Default' }, ...modes.map(mode => ({ modeId: mode.id, name: mode.name }))] },
    colorVariables: document.variables.map(variable => ({
      id: variable.id, name: variable.name, valuesByMode: { base: variable.value,
        ...Object.fromEntries(modes.flatMap(mode => { const entry = mode.variables.find(item => item.id === variable.id); return entry?.value ? [[mode.id, entry.value]] : [] })) },
    })),
    numberVariables: (document.numberVariables ?? []).map(variable => ({
      id: variable.id, name: variable.name, unit: variable.unit, valuesByMode: { base: variable.value,
        ...Object.fromEntries(modes.flatMap(mode => { const entry = mode.numberVariables.find(item => item.id === variable.id); return entry?.value !== undefined ? [[mode.id, entry.value]] : [] })) },
    })),
    textStyles: (document.textStyles ?? []).map(style => ({ id: style.id, name: style.name, fontFamily: style.fontFamily, fontWeight: style.fontWeight,
      fontStyle: style.fontStyle, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing })),
    effectStyles: (document.effectStyles ?? []).map(style => ({ id: style.id, name: style.name })),
    components: document.nodes.filter(node => node.kind === 'component' || node.kind === 'component-set').map(node => ({
      id: node.id, kind: node.kind, name: path(node), width: node.width, height: node.height,
      ...(node.componentSet ? { axes: node.componentSet.axes } : {}),
      ...(node.variantValues ? { variant: node.variantValues } : {}),
    })),
    frames: document.nodes.filter(node => node.parentId === null && node.kind === 'frame').map(node => ({
      id: node.id, name: node.name, width: node.width, height: node.height, tokenModeId: node.tokenModeId ?? null, layers: slots(node),
    })),
  }
}

/**
 * After a template insert, point the new layers at resources the design already had with the same name (colour and number variables,
 * text styles, token modes) and drop the duplicate copies, so one Brand mode switch reaches every ad in the design.
 * @param before - Design before the insert.
 * @param after - Design the clipboard importer returned.
 * @returns The design with name-matched resources merged.
 */
export function mergeDesignResourcesByName(before: CopyOSDesignDocument, after: CopyOSDesignDocument): CopyOSDesignDocument {
  const remap = new Map<string, string>()
  const match = <T extends { id: string; name: string }>(old: readonly T[] | undefined, next: readonly T[] | undefined): T[] => {
    const known = new Set((old ?? []).map(value => value.id))
    const byName = new Map((old ?? []).map(value => [value.name, value.id]))
    return (next ?? []).filter((value) => {
      if (known.has(value.id)) return true
      const existing = byName.get(value.name)
      if (existing === undefined) return true
      remap.set(value.id, existing)
      return false
    })
  }
  const variables = match(before.variables, after.variables)
  const numberVariables = match(before.numberVariables, after.numberVariables)
  const textStyles = match(before.textStyles, after.textStyles)
  const keptModes = match(before.tokenModes, after.tokenModes)
  if (!remap.size) return after
  const known = new Set([...before.variables, ...before.numberVariables ?? []].map(value => value.id))
  // A merged mode keeps the design's own values; values for variables that arrived new are carried over from the duplicate.
  const tokenModes = keptModes.map((mode) => {
    if (!(before.tokenModes ?? []).some(value => value.id === mode.id)) return mode
    const duplicates = (after.tokenModes ?? []).filter(value => remap.get(value.id) === mode.id)
    return { ...mode,
      variables: [...mode.variables, ...duplicates.flatMap(value => value.variables).filter(value => !known.has(remap.get(value.id) ?? value.id))],
      numberVariables: [...mode.numberVariables, ...duplicates.flatMap(value => value.numberVariables).filter(value => !known.has(remap.get(value.id) ?? value.id))] }
  })
  const oldIds = new Set(before.nodes.map(node => node.id))
  const pattern = new RegExp([...remap.keys()].map(id => id.replace(/[-]/g, '\\-')).join('|'), 'g')
  const nodes = after.nodes.map(node => oldIds.has(node.id) ? node
    : JSON.parse(JSON.stringify(node).replace(pattern, id => remap.get(id) ?? id)) as CopyOSDesignNode)
  return { ...after, nodes, variables, numberVariables, textStyles, tokenModes }
}
