/** Linked narrower page layouts and independent exact-size output variants of top-level artboards. */
import { duplicateDesignNode, editDesignNodes } from './design-model.ts'
import { resizeDesignAspectAxis } from './design-aspect-ratio.ts'
import { parseDesignDocument } from './design-schema.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

/** Requested breakpoint artboard geometry; the frame is placed beside the source unless coordinates are supplied. */
export interface DesignBreakpointOptions {
  /** Artboard width in CSS pixels, 200..4000. */
  width: number
  /** Largest viewport width that uses this layout, 200..4000. */
  maxWidth: number
  name: string
  x?: number | undefined
  y?: number | undefined
}

/**
 * Duplicate a top-level artboard as a linked breakpoint whose layers record the source layer they restyle.
 * @param document - Valid native document.
 * @param frameId - Visible top-level, unlinked artboard that is not itself a breakpoint.
 * @param options - Breakpoint width, applied viewport range, name and optional placement.
 * @param newId - Identity allocator for the duplicate and its owned resources.
 * @returns Parsed document with the new frame last; the source artboard is unchanged.
 * @throws {Error} If the source is not an eligible artboard or the range already has a breakpoint.
 */
export function createDesignBreakpoint(document: CopyOSDesignDocument, frameId: string, options: DesignBreakpointOptions,
  newId: () => string): { document: CopyOSDesignDocument; frameId: string } {
  const source = document.nodes.find(node => node.id === frameId)
  if (!source || source.kind !== 'frame' || source.parentId !== null || source.pageLink || source.breakpoint)
    throw new Error('Breakpoints duplicate one unlinked top-level artboard that is not itself a breakpoint')
  if (!Number.isInteger(options.width) || options.width < 200 || options.width > 4000 ||
    !Number.isInteger(options.maxWidth) || options.maxWidth < 200 || options.maxWidth > 4000)
    throw new Error('Breakpoint width and maximum viewport width must be integers from 200 to 4000')
  if (document.nodes.some(node => node.breakpoint?.sourceFrameId === frameId && node.breakpoint.maxWidth === options.maxWidth))
    throw new Error(`This artboard already has a breakpoint up to ${options.maxWidth}px`)
  const nodes = duplicateDesignNode(document, frameId, newId)
  const before = new Set(document.nodes.map(node => node.id))
  const added = nodes.filter(node => !before.has(node.id))
  const copy = added.find(node => node.parentId === source.parentId && node.kind === 'frame')
  if (!copy) throw new Error('Breakpoint duplicate could not be resolved')
  // Clones keep sibling order, so a parallel walk pairs each copy with the layer it came from.
  const children = (items: readonly CopyOSDesignNode[], parentId: string) => items.filter(node => node.parentId === parentId)
  const sources = new Map<string, string>()
  const pair = (fromId: string, toId: string): void => {
    const from = children(document.nodes, fromId), to = children(added, toId)
    if (from.length !== to.length) throw new Error('Breakpoint duplicate changed the layer structure')
    to.forEach((node, index) => {
      const original = from[index]
      if (!original) return
      sources.set(node.id, original.id); pair(original.id, node.id)
    })
  }
  pair(source.id, copy.id)
  const right = Math.max(...document.nodes.filter(node => node.parentId === null && node.pageId === source.pageId &&
    node.y < source.y + source.height && node.y + node.height > source.y).map(node => node.x + node.width)) + 80
  const linked = { ...document, nodes: nodes.map(node => node.id === copy.id
    ? { ...node, name: options.name.slice(0, 200), breakpoint: { sourceFrameId: source.id, maxWidth: options.maxWidth } }
    : sources.has(node.id) ? { ...node, breakpointSourceId: sources.get(node.id) } : node) }
  const placed = editDesignNodes(linked, [{ id: copy.id, width: options.width, widthSizing: 'fixed',
    x: options.x ?? right, y: options.y ?? source.y }])
  return { document: parseDesignDocument(placed), frameId: copy.id }
}

/**
 * List breakpoint artboards of one source in ascending viewport order.
 * @param document - Native document.
 * @param frameId - Source artboard identity.
 * @returns Linked breakpoint frames, narrowest range first.
 */
export function designBreakpointFrames(document: Pick<CopyOSDesignDocument, 'nodes'>, frameId: string): CopyOSDesignNode[] {
  return document.nodes.filter(node => node.breakpoint?.sourceFrameId === frameId && node.parentId === null)
    .sort((left, right) => (left.breakpoint?.maxWidth ?? 0) - (right.breakpoint?.maxWidth ?? 0))
}

/**
 * Duplicate a top-level artboard as an independent exact-size output, such as an ad format, adapting its layout through normal resizing.
 * @param document - Valid native document.
 * @param frameId - Visible top-level, unlinked frame.
 * @param options - Exact pixel size 1..20000, name and optional placement; defaults below the lowest top-level layer in the
 *   source's column.
 * @param newId - Identity allocator for the duplicate and its owned resources.
 * @returns Parsed document with the variant frame identity; constraints, auto layout and Fill/Hug policies apply as in a manual resize.
 * @throws {Error} If the source is not an eligible frame or the size is invalid.
 */
export function createDesignSizeVariant(document: CopyOSDesignDocument, frameId: string,
  options: { width: number; height: number; name: string; x?: number | undefined; y?: number | undefined },
  newId: () => string): { document: CopyOSDesignDocument; frameId: string } {
  const source = document.nodes.find(node => node.id === frameId)
  if (!source || source.kind !== 'frame' || source.parentId !== null || source.pageLink)
    throw new Error('Size variants duplicate one unlinked top-level frame')
  if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 1 && value <= 20000))
    throw new Error('Variant width and height must be whole pixels from 1 to 20000')
  const nodes = duplicateDesignNode(document, frameId, newId), before = new Set(document.nodes.map(node => node.id))
  const copy = nodes.find(node => !before.has(node.id) && node.parentId === null && node.kind === 'frame')
  if (!copy) throw new Error('Size variant duplicate could not be resolved')
  const below = Math.max(...document.nodes.filter(node => node.parentId === null && node.pageId === source.pageId &&
    node.x < source.x + Math.max(source.width, options.width) && node.x + node.width > source.x).map(node => node.y + node.height)) + 120
  let next: CopyOSDesignDocument = { ...document, nodes: nodes.map(node => node.id === copy.id
    ? { ...node, name: options.name.slice(0, 200), heightSizing: 'fixed', widthSizing: 'fixed' } : node) }
  next = resizeDesignAspectAxis(next, [copy.id], 'width', options.width)
  next = resizeDesignAspectAxis(next, [copy.id], 'height', options.height)
  next = editDesignNodes(next, [{ id: copy.id, x: options.x ?? source.x, y: options.y ?? below }])
  return { document: parseDesignDocument(next), frameId: copy.id }
}

/**
 * Copy content from each linked source layer into a breakpoint artboard while keeping the breakpoint's own layout and styling.
 * @param document - Valid native document.
 * @param frameId - Breakpoint artboard whose source still exists.
 * @returns Parsed document and the number of layers whose text, inline runs, image source or instance text changed; text measurements
 *   of changed text are cleared so they are measured again.
 * @throws {Error} If the frame is not a breakpoint of an existing artboard.
 */
export function syncDesignBreakpointContent(document: CopyOSDesignDocument,
  frameId: string): { document: CopyOSDesignDocument; changed: number } {
  const frame = document.nodes.find(node => node.id === frameId), byId = new Map(document.nodes.map(node => [node.id, node]))
  if (!frame?.breakpoint || !byId.has(frame.breakpoint.sourceFrameId)) throw new Error('Content sync requires a breakpoint of an existing artboard')
  const inside = new Set([frameId])
  for (let grew = true; grew;) {
    grew = false
    for (const node of document.nodes) {
      if (node.parentId && inside.has(node.parentId) && !inside.has(node.id)) { inside.add(node.id); grew = true }
    }
  }
  let changed = 0
  const nodes = document.nodes.map((node) => {
    const source = node.breakpointSourceId && inside.has(node.id) ? byId.get(node.breakpointSourceId) : undefined
    if (!source || source.kind !== node.kind) return node
    let next: CopyOSDesignNode = node
    if (node.kind === 'text' && (node.text !== source.text || JSON.stringify(node.textRuns) !== JSON.stringify(source.textRuns)))
      next = { ...next, text: source.text, textRuns: source.textRuns?.map(run => ({ ...run, style: { ...run.style } })),
        textLayoutMetrics: undefined, textBaselineMetrics: undefined }
    if (node.kind === 'image' && node.imageUrl !== source.imageUrl) next = { ...next, imageUrl: source.imageUrl }
    if (node.kind === 'image' && node.fills && source.fills) {
      const urls = new Map(source.fills.flatMap(paint => paint.image ? [[paint.id, paint.image.url] as const] : []))
      const fills = node.fills.map(paint => paint.image && urls.has(paint.id) && urls.get(paint.id) !== paint.image.url
        ? { ...paint, image: { ...paint.image, url: urls.get(paint.id) ?? paint.image.url } } : paint)
      if (fills.some((paint, index) => paint !== node.fills?.[index])) next = { ...next, fills }
    }
    if (node.kind === 'instance' && source.instanceOverrides?.some(record => record.text !== undefined || record.textRuns !== undefined)) {
      const own = new Map((node.instanceOverrides ?? []).map(record => [JSON.stringify(record.path), record]))
      for (const record of source.instanceOverrides) {
        if (record.text === undefined && record.textRuns === undefined) continue
        const key = JSON.stringify(record.path), current = own.get(key)
        if (current?.text === record.text && JSON.stringify(current?.textRuns) === JSON.stringify(record.textRuns)) continue
        own.set(key, { ...current, path: [...record.path], text: record.text, textRuns: record.textRuns,
          textLayoutMetrics: undefined, textBaselineMetrics: undefined })
      }
      const overrides = [...own.values()]
      if (JSON.stringify(overrides) !== JSON.stringify(node.instanceOverrides ?? [])) next = { ...next, instanceOverrides: overrides }
    }
    if (next !== node) changed++
    return next
  })
  return { document: changed ? parseDesignDocument({ ...document, nodes }) : document, changed }
}
