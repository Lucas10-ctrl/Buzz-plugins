/**
 * Host services behind the agent's Canvas tools: pictures from paths, URLs or data URLs; every installed project font; node defaults for
 * new layers; one renderer shared by viewDesign and exportDesign, so what the agent checks is the exported pixels; and a read of the
 * design system (components, text styles, variables and modes).
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
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
/** Most faces one text engine registers. */
const MAX_FACES = 128
/** Arrows, maths, technical, boxes, shapes, misc symbols, dingbats and supplemental arrows/symbols. */
export const designUsesSymbols = (text: string): boolean => /[\u2190-\u2bff\u{1f300}-\u{1faff}]/u.test(text)
const fonts = new CopyOSDesignFontStore()

/**
 * Read picture bytes from a local path, an http(s) URL or a data: URL.
 * @param source - `/abs/path.png`, `~/path.png`, `https://…` or `data:image/png;base64,…`.
 * @param base - Directory that relative paths resolve against.
 * @returns The bytes; whether they are a picture is checked when they are stored.
 */
export async function readDesignImageSource(source: string, base = process.cwd()): Promise<Uint8Array> {
  const value = source.trim()
  if (value.startsWith('data:')) {
    const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(value)
    if (!match) throw new Error('Unreadable data: URL')
    return match[1] ? Buffer.from(match[2] ?? '', 'base64') : Buffer.from(decodeURIComponent(match[2] ?? ''), 'latin1')
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { signal: AbortSignal.timeout(30_000), redirect: 'follow' })
    if (!response.ok) throw new Error(`The picture URL answered ${String(response.status)}`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > DESIGN_IMAGE_ASSET_MAX_BYTES) throw new Error('The picture is too large')
    return new Uint8Array(await response.arrayBuffer())
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error('Pictures come from a file path, an http(s) URL or a data: URL')
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : isAbsolute(value) ? value : resolve(base, value)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) throw new Error(`No picture file at ${path}`)
  if (info.size > DESIGN_IMAGE_ASSET_MAX_BYTES) throw new Error('The picture is too large')
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

/**
 * Every face the project can draw: the bundled Inter plus each installed font, registered at each weight it covers.
 * @param root - Project root.
 * @returns Faces for the text engine.
 */
export async function loadAllDesignProjectFonts(root: string): Promise<DesignMeasurementFont[]> {
  const result = await loadBundledDesignMeasurementFonts()
  const files = new Map<string, Uint8Array>()
  // Installed faces come first in priority over the built-in Inter (a project may install its own Inter).
  const installed = await fonts.list(root)
  const ownInter = installed.some(face => face.family.toLowerCase() === 'inter')
  if (ownInter) result.splice(0, result.length)
  for (const face of installed) {
    let data = files.get(face.file)
    if (!data) { data = new Uint8Array(await readFile(join(root, DESIGN_FONT_DIRECTORY, face.file))); files.set(face.file, data) }
    const weights = new Set<number>([face.weightMin, face.weightMax])
    for (let weight = Math.ceil(face.weightMin / 100) * 100; weight <= face.weightMax; weight += 100) weights.add(weight)
    for (const weight of weights) {
      if (result.length >= MAX_FACES) break
      if (!result.some(item => item.family.toLowerCase() === face.family.toLowerCase() && item.weight === weight && item.style === face.style))
        result.push({ family: face.family, weight, style: face.style, data })
    }
  }
  if (!result.length) result.push(...await loadBundledDesignMeasurementFonts())
  return result
}

/** Fallback families to hand the text engine for these faces. */
export function designFallbackFamilies(faces: readonly DesignMeasurementFont[]): string[] {
  return faces.some(face => face.family.toLowerCase() === DESIGN_SYMBOL_FALLBACK_FAMILY.toLowerCase()) ? [DESIGN_SYMBOL_FALLBACK_FAMILY] : []
}

/**
 * Install the symbol fallback font. Google splits it by character range and the font store keeps only Latin ranges, so the
 * `symbols` range is fetched here and stored as the project's copy of the family.
 * @param root - Project root.
 * @returns Whether the font is installed.
 */
export async function installDesignSymbolFont(root: string): Promise<boolean> {
  const faces = await fonts.list(root)
  if (faces.some(face => face.family.toLowerCase() === DESIGN_SYMBOL_FALLBACK_FAMILY.toLowerCase() && face.source === 'upload')) return true
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${DESIGN_SYMBOL_FALLBACK_FAMILY.replace(/ /g, '+')}&display=swap`, {
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    })).text()
    const url = /\/\*\s*symbols\s*\*\/\s*@font-face\s*\{[^}]*src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(css)?.[1]
    if (!url) return false
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return false
    await fonts.upload(root, new Uint8Array(await response.arrayBuffer()))
    return true
  } catch { return false }
}

/**
 * Install any Google font a design names but the project lacks.
 * @param root - Project root.
 * @param document - Design whose text layers, runs and styles name families.
 * @returns Families Google Fonts does not have.
 */
export async function installDesignDocumentFonts(root: string, document: CopyOSDesignDocument): Promise<string[]> {
  const first = (value: string): string => value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? value
  const named = new Set<string>()
  for (const node of document.nodes) {
    if (node.kind !== 'text') continue
    named.add(first(node.fontFamily))
    for (const run of node.textRuns ?? []) if (run.style.fontFamily) named.add(first(run.style.fontFamily))
  }
  for (const style of document.textStyles ?? []) named.add(first(style.fontFamily))
  if (document.nodes.some(node => node.kind === 'text' && designUsesSymbols(node.text))) await installDesignSymbolFont(root)
  const installed = new Set(['inter', ...(await fonts.list(root)).map(face => face.family.toLowerCase())])
  const missing = [...named].filter(family => family && !installed.has(family.toLowerCase()) && !/^(sans-serif|serif|monospace|system-ui)$/i.test(family))
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
  const faces = await loadAllDesignProjectFonts(root)
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
  const faces = await loadAllDesignProjectFonts(root)
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
