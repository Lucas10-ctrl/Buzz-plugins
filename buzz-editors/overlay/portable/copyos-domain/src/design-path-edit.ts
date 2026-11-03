/** Derived SVG editing geometry. Persist only the returned pathData, never these projections. */
import svgpath from 'svgpath'
import type { CopyOSDesignNode } from './types.ts'

/** Existing persisted SVG geometry, including its original coordinate dimensions. */
export type CopyOSDesignPathData = NonNullable<CopyOSDesignNode['pathData']>
/** A selectable point in the current normalized SVG command sequence. Re-inspect indexes after subdivision. */
export interface DesignPathPointTarget {
  pathIndex: number
  commandIndex: number
  kind: 'anchor' | 'incoming' | 'outgoing'
}
/** A handle in the original viewbox; commandIndex identifies its anchor. A quadratic control is shared by both endpoints. */
export interface DesignPathHandle {
  x: number
  y: number
  commandIndex: number
  kind: 'incoming' | 'outgoing'
}
/** A derived endpoint with optional cubic or shared quadratic control handles. */
export interface DesignPathAnchor {
  pathIndex: number
  commandIndex: number
  x: number
  y: number
  incoming?: DesignPathHandle
  outgoing?: DesignPathHandle
}
/** An SVG subpath. Multiple contours can share one paths[] entry. */
export interface DesignPathContour {
  pathIndex: number
  commandIndex: number
  closed: boolean
  closeCommandIndex?: number
  anchors: DesignPathAnchor[]
  segments: DesignPathSegment[]
}
/** A drawable segment with its exact SVG preview and half-parameter insertion point. */
export interface DesignPathSegment {
  commandIndex: number
  kind: 'L' | 'C' | 'Q' | 'Z'
  d: string
  midpoint: { x: number; y: number }
}
type Command = { kind: 'M' | 'L' | 'C' | 'Q' | 'Z'; values: number[] }
type Attachment = { command: number; offset: number }
type Vertex = { anchor: DesignPathAnchor; endpoints: Attachment[]; incoming?: Attachment; outgoing?: Attachment }
type Contour = { result: DesignPathContour; vertices: Vertex[] }

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new RangeError('Incomplete SVG geometry')
  return value
}

function commands(d: string): Command[] {
  if (d.length > 2_000_000) throw new RangeError('Path exceeds SVG size bounds')
  const parsed: ReturnType<typeof svgpath> & { err?: string } = svgpath(d)
  if (parsed.err) throw new RangeError(`Invalid SVG path: ${parsed.err}`)
  const result: Command[] = []
  parsed.abs().unshort().iterate((segment, _index, x, y) => {
    const kind = segment[0].toUpperCase()
    const values = segment.slice(1).map(Number)
    if (!values.every(Number.isFinite)) throw new RangeError('Path coordinates must be finite')
    if (result.at(-1)?.kind === 'Z' && kind === 'Z') return
    if (result.at(-1)?.kind === 'Z' && kind !== 'M' && kind !== 'Z') result.push({ kind: 'M', values: [x, y] })
    if (kind === 'A') {
      const arcStart = result.length
      svgpath(`M${x} ${y} A${values.join(' ')}`).unarc().iterate((part, i) => {
        if (i && (part[0] === 'C' || part[0] === 'L')) result.push({ kind: part[0], values: part.slice(1).map(Number) })
      })
      // svgpath's arc approximation has trigonometric endpoint noise; retain the authored endpoint exactly.
      if (result.length > arcStart) {
        const last = required(result.at(-1)).values
        last[last.length - 2] = required(values[5]); last[last.length - 1] = required(values[6])
      }
    } else if (kind === 'H') result.push({ kind: 'L', values: [required(values[0]), y] })
    else if (kind === 'V') result.push({ kind: 'L', values: [x, required(values[0])] })
    else if (kind === 'M' || kind === 'L' || kind === 'C' || kind === 'Q' || kind === 'Z') result.push({ kind, values })
    else throw new RangeError('Unsupported SVG command')
  })
  if (result.some(item => item.values.some(value => !Number.isFinite(value)))) throw new RangeError('Normalized path coordinates must be finite')
  if (result.length > 100_000) throw new RangeError('Path exceeds editable command bounds')
  return result
}
function validate(data: CopyOSDesignPathData): void {
  if (!Number.isFinite(data.width) || !Number.isFinite(data.height)
    || data.width < 1 || data.height < 1 || data.width > 100_000 || data.height > 100_000)
    throw new RangeError('Path dimensions must be finite and within 1..100000')
}
function contours(items: Command[], pathIndex: number): Contour[] {
  const result: Contour[] = []
  let current: Contour | undefined
  const attach = (vertex: Vertex, kind: 'incoming' | 'outgoing', ref: Attachment) => {
    vertex[kind] = ref
    const values = required(items[ref.command]).values
    vertex.anchor[kind] = {
      x: required(values[ref.offset]), y: required(values[ref.offset + 1]), commandIndex: vertex.anchor.commandIndex, kind,
    }
  }
  const segment = (item: Command, commandIndex: number, start: DesignPathAnchor, end: number[]) => {
    if (item.kind === 'M') return
    let row: number[][] = [[start.x, start.y]]
    for (let i = 0; i < item.values.length; i += 2) row.push(item.values.slice(i, i + 2))
    if (item.kind === 'Z') row.push(end)
    while (row.length > 1) row = row.slice(1).map((point, i) => [
      required(required(row[i])[0]) / 2 + required(point[0]) / 2,
      required(required(row[i])[1]) / 2 + required(point[1]) / 2,
    ])
    const midpoint = { x: required(required(row[0])[0]), y: required(required(row[0])[1]) }
    const d = `M${start.x} ${start.y} ${item.kind === 'Z' ? `L${end.join(' ')}` : serialize([item])}`
    required(current).result.segments.push({ commandIndex, kind: item.kind, d, midpoint })
  }
  for (const [commandIndex, item] of items.entries()) {
    if (item.kind === 'Z') {
      if (!current) throw new RangeError('Close command requires a contour')
      current.result.closed = true
      current.result.closeCommandIndex = commandIndex
      const first = required(current.vertices[0]), last = required(current.vertices.at(-1))
      segment(item, commandIndex, last.anchor, [first.anchor.x, first.anchor.y])
      if (first !== last && first.anchor.x === last.anchor.x && first.anchor.y === last.anchor.y) {
        first.endpoints.push(...last.endpoints)
        if (last.incoming) attach(first, 'incoming', last.incoming)
        current.vertices.pop(); current.result.anchors.pop()
      }
      continue
    }
    const offset = item.values.length - 2
    const anchor: DesignPathAnchor = { pathIndex, commandIndex, x: required(item.values[offset]), y: required(item.values[offset + 1]) }
    const vertex: Vertex = { anchor, endpoints: [{ command: commandIndex, offset }] }
    if (item.kind === 'M') {
      current = { result: { pathIndex, commandIndex, closed: false, anchors: [], segments: [] }, vertices: [] }
      result.push(current)
    }
    if (!current || (current.result.closed && item.kind !== 'M')) throw new RangeError('Draw commands after close require a move command')
    const previous = current.vertices.at(-1)
    if (previous) segment(item, commandIndex, previous.anchor, item.values.slice(-2))
    if (item.kind === 'C' || item.kind === 'Q') {
      if (!previous) throw new RangeError('Curve requires a starting anchor')
      attach(previous, 'outgoing', { command: commandIndex, offset: 0 })
      attach(vertex, 'incoming', { command: commandIndex, offset: item.kind === 'C' ? 2 : 0 })
    }
    current.vertices.push(vertex); current.result.anchors.push(anchor)
  }
  return result
}
/** Parse SVG contours without mutating their persisted strings.
 * @param pathData - Existing path geometry.
 * @returns Anchors and handles in original viewbox coordinates. Arc commands derive cubic handles.
 */
export function parseDesignPathContours(pathData: CopyOSDesignPathData): DesignPathContour[] {
  validate(pathData)
  return pathData.paths.flatMap((path, index) => contours(commands(path.d), index).map(contour => contour.result))
}
function serialize(items: Command[]): string { return items.map(item => `${item.kind}${item.values.join(' ')}`).join(' ') }
function replace(data: CopyOSDesignPathData, index: number, items: Command[]): CopyOSDesignPathData {
  if (items.some(item => item.values.some(value => !Number.isFinite(value)))) throw new RangeError('Path edit exceeds finite coordinate bounds')
  if (items.length > 100_000) throw new RangeError('Path edit exceeds editable command bounds')
  const d = serialize(items)
  if (d.length > 2_000_000) throw new RangeError('Path edit exceeds SVG size bounds')
  return { ...data, paths: data.paths.map((path, i) => i === index ? { ...path, d } : path) }
}
function editable(data: CopyOSDesignPathData, index: number): Command[] {
  validate(data)
  // Validate all contours before committing an edit to any one path.
  parseDesignPathContours(data)
  if (!Number.isInteger(index) || !data.paths[index]) throw new RangeError('Unknown path index')
  return commands(required(data.paths[index]).d)
}
/** Move an endpoint with its attached controls, or move a single handle.
 * @param pathData - Persisted SVG geometry; never mutated.
 * @param target - Address returned by the contour projection.
 * @param x - New original-viewbox x coordinate.
 * @param y - New original-viewbox y coordinate.
 * @returns New pathData; invalid edits throw atomically. Editing arcs commits their cubic approximation.
 */
export function moveDesignPathPoint(
  pathData: CopyOSDesignPathData, target: DesignPathPointTarget, x: number, y: number,
): CopyOSDesignPathData {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Point coordinates must be finite')
  const items = editable(pathData, target.pathIndex)
  const vertex = contours(items, target.pathIndex).flatMap(contour => contour.vertices)
    .find(item => item.anchor.commandIndex === target.commandIndex)
  if (!vertex) throw new RangeError('Unknown anchor command index')
  if (target.kind === 'anchor') {
    const dx = x - vertex.anchor.x, dy = y - vertex.anchor.y
    const refs = [...vertex.endpoints, ...[vertex.incoming, vertex.outgoing].filter((ref): ref is Attachment => !!ref)]
    const seen = new Set<string>()
    for (const ref of refs) {
      const key = `${ref.command}:${ref.offset}`
      if (seen.has(key)) continue
      seen.add(key)
      const values = required(items[ref.command]).values
      values[ref.offset] = required(values[ref.offset]) + dx
      values[ref.offset + 1] = required(values[ref.offset + 1]) + dy
    }
  } else {
    const ref = vertex[target.kind]
    if (!ref) throw new RangeError('Anchor has no requested handle')
    const values = required(items[ref.command]).values
    values[ref.offset] = x; values[ref.offset + 1] = y
  }
  return replace(pathData, target.pathIndex, items)
}
function retainedControl(items: Command[], vertex: Vertex, kind: 'incoming' | 'outgoing'): number[] | undefined {
  const ref = vertex[kind]
  if (!ref) return undefined
  const item = required(items[ref.command]), control = item.values.slice(ref.offset, ref.offset + 2)
  if (item.kind !== 'Q') return control
  // Elevate a quadratic endpoint's tangent handle to its equivalent cubic handle.
  return [vertex.anchor.x / 3 + required(control[0]) * (2 / 3), vertex.anchor.y / 3 + required(control[1]) * (2 / 3)]
}
function joinedSegment(items: Command[], previous: Vertex, next: Vertex): Command {
  const outgoing = retainedControl(items, previous, 'outgoing')
  const incoming = retainedControl(items, next, 'incoming')
  const end = [next.anchor.x, next.anchor.y]
  if (!outgoing && !incoming) return { kind: 'L', values: end }
  return { kind: 'C', values: [...(outgoing ?? [previous.anchor.x, previous.anchor.y]), ...(incoming ?? end), ...end] }
}
function anchorSelection(
  data: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>,
): Map<number, { items: Command[]; contours: Contour[]; selected: Set<number> }> {
  validate(data)
  const entries = data.paths.map((path, index) => {
    const items = commands(path.d)
    return { items, contours: contours(items, index), selected: new Set<number>() }
  })
  const selected = new Map<number, typeof entries[number]>()
  let count = 0
  for (const target of targets) {
    const entry = entries[target.pathIndex]
    if (!Number.isInteger(target.pathIndex) || !entry) throw new RangeError('Unknown path index')
    if (!Number.isInteger(target.commandIndex)
      || !entry.contours.some(contour => contour.vertices.some(vertex => vertex.anchor.commandIndex === target.commandIndex)))
      throw new RangeError('Unknown anchor command index')
    if (entry.selected.has(target.commandIndex)) continue
    if (++count > 1000) throw new RangeError('Anchor selection exceeds 1000 unique points')
    entry.selected.add(target.commandIndex)
    selected.set(target.pathIndex, entry)
  }
  if (!count) throw new RangeError('Anchor selection must not be empty')
  return selected
}
/** Translate original-address anchors and their attached handles together.
 * @param pathData - Persisted SVG geometry; never mutated. Every entry validates before editing.
 * @param targets - One to 1000 unique normalized logical anchor addresses; duplicates are ignored.
 * @param dx - Finite original-viewbox horizontal translation.
 * @param dy - Finite original-viewbox vertical translation.
 * @returns New geometry preserving untouched entries. Shared quadratic controls and duplicate closed
 * endpoints translate exactly once. Invalid addresses or overflowing coordinates reject atomically.
 */
export function moveDesignPathAnchors(
  pathData: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>, dx: number, dy: number,
): CopyOSDesignPathData {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError('Point translation must be finite')
  const entries = anchorSelection(pathData, targets)
  let result = pathData
  for (const [pathIndex, entry] of entries) {
    const seen = new Set<string>()
    for (const vertex of entry.contours.flatMap(contour => contour.vertices)) {
      if (!entry.selected.has(vertex.anchor.commandIndex)) continue
      const refs = [...vertex.endpoints, ...[vertex.incoming, vertex.outgoing].filter((ref): ref is Attachment => !!ref)]
      for (const ref of refs) {
        const key = `${ref.command}:${ref.offset}`
        if (seen.has(key)) continue
        seen.add(key)
        const values = required(entry.items[ref.command]).values
        values[ref.offset] = required(values[ref.offset]) + dx
        values[ref.offset + 1] = required(values[ref.offset + 1]) + dy
      }
    }
    result = replace(result, pathIndex, entry.items)
  }
  return result
}
function endpointJoinSelection(
  data: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>,
) {
  const entries = anchorSelection(data, targets)
  if ([...entries.values()].reduce((count, entry) => count + entry.selected.size, 0) !== 2)
    throw new RangeError('Join requires exactly two unique endpoints')
  const endpoints = [...entries].sort(([a], [b]) => a - b).flatMap(([pathIndex, entry]) =>
    entry.contours.flatMap(contour => contour.vertices.filter(vertex => entry.selected.has(vertex.anchor.commandIndex))
      .map(vertex => ({ pathIndex, entry, contour, vertex }))))
  for (const endpoint of endpoints) {
    const { contour, vertex } = endpoint
    if (contour.result.closed || contour.vertices.length < 2
      || (vertex !== contour.vertices[0] && vertex !== contour.vertices.at(-1)))
      throw new RangeError('Join requires endpoints of drawable open contours')
  }
  const first = required(endpoints[0]), second = required(endpoints[1])
  if (required(data.paths[first.pathIndex]).fillRule !== required(data.paths[second.pathIndex]).fillRule)
    throw new RangeError('Joined path entries must use the same fill rule')
  return { entries, first, second }
}
function openContourCommands(items: Command[], contour: Contour, reverse: boolean): Command[] {
  const vertices = contour.vertices
  if (!reverse) return vertices.map(vertex => required(items[vertex.anchor.commandIndex]))
  const last = required(vertices.at(-1))
  const result: Command[] = [{ kind: 'M', values: [last.anchor.x, last.anchor.y] }]
  for (let index = vertices.length - 1; index > 0; index--) {
    const command = required(items[required(vertices[index]).anchor.commandIndex])
    const previous = required(vertices[index - 1]).anchor, end = [previous.x, previous.y]
    result.push({ kind: command.kind, values: command.kind === 'C'
      ? [...command.values.slice(2, 4), ...command.values.slice(0, 2), ...end]
      : command.kind === 'Q' ? [...command.values.slice(0, 2), ...end] : end })
  }
  return result
}
/** Check whether exactly two current logical anchors can join without changing fill-rule ownership.
 * @param pathData - Existing geometry; all entries validate, and input remains unchanged.
 * @param targets - Current normalized anchor addresses; duplicate addresses count once.
 * @returns True for opposite endpoints of one open drawable contour or endpoints of two compatible contours.
 */
export function canJoinDesignPathEndpoints(
  pathData: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>,
): boolean {
  try { joinDesignPathEndpoints(pathData, targets); return true }
  catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}
/** Join two open-contour endpoints with a straight segment, preserving authored Bézier edges.
 * @param pathData - Persisted SVG geometry; never mutated or fitted to new bounds.
 * @param targets - Exactly two unique current normalized endpoint addresses; selection order is ignored.
 * @returns New geometry. One contour closes with Z. Two contours follow authored order and reverse
 * as needed, swapping cubic controls. Same-entry unrelated contours retain compound grouping;
 * across entries the joined contour replaces the earlier entry, followed by its residual compound
 * contours, while later residual entries retain their positions. Different fill rules reject.
 * Invalid targets, closed/interior points and editable size limits reject atomically.
 */
export function joinDesignPathEndpoints(
  pathData: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>,
): CopyOSDesignPathData {
  const { entries, first, second } = endpointJoinSelection(pathData, targets)
  const sameContour = first.contour === second.contour
  let joined: Command[]
  if (sameContour) joined = [...openContourCommands(first.entry.items, first.contour, false), { kind: 'Z', values: [] }]
  else {
    const head = openContourCommands(first.entry.items, first.contour, first.vertex === first.contour.vertices[0])
    const tail = openContourCommands(second.entry.items, second.contour, second.vertex !== second.contour.vertices[0])
    joined = [...head, { kind: 'L', values: required(tail[0]).values }, ...tail.slice(1)]
  }
  const sameEntry = first.pathIndex === second.pathIndex
  const paths: CopyOSDesignPathData['paths'] = []
  for (const [pathIndex, path] of pathData.paths.entries()) {
    const entry = entries.get(pathIndex)
    if (!entry) { paths.push(path); continue }
    if (!sameEntry && pathIndex === first.pathIndex)
      paths.push(required(replace({ ...pathData, paths: [path] }, 0, joined).paths[0]))
    const items = entry.contours.flatMap((contour, index) => {
      if (contour === first.contour) return sameEntry ? joined : []
      if (contour === second.contour) return []
      const end = entry.contours[index + 1]?.result.commandIndex ?? entry.items.length
      return entry.items.slice(contour.result.commandIndex, end)
    })
    if (items.length) paths.push(required(replace({ ...pathData, paths: [path] }, 0, items).paths[0]))
  }
  if (paths.length > 5000) throw new RangeError('Join exceeds 5000 path entries')
  return { ...pathData, paths }
}
function deleteContourAnchors(items: Command[], contour: Contour, selected: Set<number>, mode: 'delete' | 'heal'): Command[] {
  const vertices = contour.vertices
  const selectedIndex = vertices.findIndex(vertex => selected.has(vertex.anchor.commandIndex))
  const remaining = vertices.filter(vertex => !selected.has(vertex.anchor.commandIndex))
  if (remaining.length < 2) return []
  const originalIndexes = new Map(vertices.map((vertex, index) => [vertex, index]))
  const retainedEdge = (next: Vertex): Command => {
    if (required(originalIndexes.get(next)) !== 0) return required(items[next.anchor.commandIndex])
    const explicitEnd = next.endpoints.find(ref => ref.command !== next.anchor.commandIndex)
    return explicitEnd ? required(items[explicitEnd.command]) : { kind: 'L', values: [next.anchor.x, next.anchor.y] }
  }
  const replacement: Command[] = []
  if (mode === 'delete') {
    const ordered = contour.result.closed ? [...vertices.slice(selectedIndex + 1), ...vertices.slice(0, selectedIndex + 1)] : vertices
    const chains: Vertex[][] = [[]]
    for (const vertex of ordered) {
      if (selected.has(vertex.anchor.commandIndex)) chains.push([])
      else required(chains.at(-1)).push(vertex)
    }
    for (const chain of chains) {
      if (chain.length < 2) continue
      const first = required(chain[0])
      replacement.push({ kind: 'M', values: [first.anchor.x, first.anchor.y] })
      for (const next of chain.slice(1)) replacement.push(retainedEdge(next))
    }
  } else {
    const first = required(remaining[0])
    replacement.push({ kind: 'M', values: [first.anchor.x, first.anchor.y] })
    const edges = contour.result.closed ? remaining.length : remaining.length - 1
    for (let index = 0; index < edges; index++) {
      const previous = required(remaining[index]), next = required(remaining[(index + 1) % remaining.length])
      const oldPrevious = required(originalIndexes.get(previous)), oldNext = required(originalIndexes.get(next))
      const adjacent = (oldPrevious + 1) % vertices.length === oldNext
      replacement.push(adjacent ? retainedEdge(next) : joinedSegment(items, previous, next))
    }
    if (contour.result.closed) replacement.push({ kind: 'Z', values: [] })
  }
  return replacement
}
/** Delete an original-address anchor selection simultaneously across contours and entries.
 * @param pathData - Persisted SVG geometry; never mutated. All entries validate before editing.
 * @param targets - One to 1000 unique normalized logical anchor addresses; duplicates are ignored.
 * @param mode - Delete removes incident edges; heal joins surviving neighbors with their original
 * tangent handles, elevating quadratic handles to cubic equivalents without curve fitting.
 * @returns New geometry with original viewbox and fill rules. Drawable surviving chains retain their
 * authored edges; chains with fewer than two anchors and empty entries disappear. Closed healed
 * contours remain closed. Untouched entries retain identity; invalid edits reject atomically.
 */
export function deleteDesignPathAnchors(
  pathData: CopyOSDesignPathData, targets: Array<Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>>, mode: 'delete' | 'heal' = 'delete',
): CopyOSDesignPathData {
  if (!['delete', 'heal'].includes(mode)) throw new RangeError('Unknown anchor deletion mode')
  const entries = anchorSelection(pathData, targets)
  const paths: CopyOSDesignPathData['paths'] = []
  for (const [pathIndex, path] of pathData.paths.entries()) {
    const entry = entries.get(pathIndex)
    if (!entry) { paths.push(path); continue }
    const items = entry.contours.flatMap((contour, index) => {
      if (contour.vertices.some(vertex => entry.selected.has(vertex.anchor.commandIndex)))
        return deleteContourAnchors(entry.items, contour, entry.selected, mode)
      const end = entry.contours[index + 1]?.result.commandIndex ?? entry.items.length
      return entry.items.slice(contour.result.commandIndex, end)
    })
    if (items.length) paths.push(required(replace({ ...pathData, paths: [path] }, 0, items).paths[0]))
  }
  return { ...pathData, paths }
}
/** Delete one logical anchor, optionally healing its incident segments.
 * @param pathData - Persisted SVG geometry; never mutated.
 * @param target - Current normalized logical anchor address.
 * @param mode - Delete removes incident edges; heal reconnects surviving neighbors.
 * @returns New geometry using the simultaneous selection operation's validation and topology rules.
 */
export function deleteDesignPathAnchor(
  pathData: CopyOSDesignPathData, target: Pick<DesignPathPointTarget, 'pathIndex' | 'commandIndex'>, mode: 'delete' | 'heal' = 'delete',
): CopyOSDesignPathData {
  return deleteDesignPathAnchors(pathData, [target], mode)
}
function drawableSegment(items: Command[], commandIndex: number): { item: Command; points: number[][] } {
  const item = items[commandIndex]
  if (!Number.isInteger(commandIndex) || !item || item.kind === 'M') throw new RangeError('Unknown drawable segment')
  let start = [0, 0], first = start
  for (const command of items.slice(0, commandIndex)) {
    if (command.kind === 'M') first = command.values.slice(-2)
    start = command.kind === 'Z' ? first : command.values.slice(-2)
  }
  const points = [start]
  for (let i = 0; i < item.values.length; i += 2) points.push(item.values.slice(i, i + 2))
  if (item.kind === 'Z') points.push(first)
  return { item, points }
}

/** Split one line or Bézier segment using exact De Casteljau subdivision.
 * @param pathData - Persisted SVG geometry.
 * @param pathIndex - Index in paths[].
 * @param commandIndex - Normalized destination command, or a contour's closeCommandIndex.
 * @param t - Strictly interior segment parameter (0 < t < 1).
 * @returns New pathData preserving the original curve and coordinate dimensions.
 */
export function splitDesignPathSegment(
  pathData: CopyOSDesignPathData, pathIndex: number, commandIndex: number, t: number,
): CopyOSDesignPathData {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new RangeError('Split parameter must be between zero and one')
  const items = editable(pathData, pathIndex)
  const { item, points } = drawableSegment(items, commandIndex)
  const left = [required(points[0])], right = [required(points.at(-1))]
  let row = points
  while (row.length > 1) {
    row = row.slice(1).map((point, i) => [
      required(required(row[i])[0]) * (1 - t) + required(point[0]) * t,
      required(required(row[i])[1]) * (1 - t) + required(point[1]) * t,
    ])
    left.push(required(row[0])); right.unshift(required(row.at(-1)))
  }
  const kind = item.kind === 'Z' ? 'L' : item.kind
  const replacements: Command[] = [
    { kind, values: left.slice(1).flat() },
    item.kind === 'Z' ? item : { kind, values: right.slice(1).flat() },
  ]
  items.splice(commandIndex, 1, ...replacements)
  return replace(pathData, pathIndex, items)
}

/** Find the nearest parameter on a drawable segment in original viewbox coordinates.
 * @param pathData - Persisted SVG geometry, unchanged by this query.
 * @param pathIndex - Index in paths[].
 * @param commandIndex - Normalized drawable command index from the contour projection.
 * @param x - Pointer x in original viewbox coordinates.
 * @param y - Pointer y in original viewbox coordinates.
 * @returns Nearest t in [0, 1]: exact for lines, bounded sample/refinement approximation for curves.
 */
export function nearestDesignPathSegmentParameter(
  pathData: CopyOSDesignPathData, pathIndex: number, commandIndex: number, x: number, y: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Point coordinates must be finite')
  const items = editable(pathData, pathIndex)
  const { item, points } = drawableSegment(items, commandIndex)
  // Scale the complete distance computation to avoid squared-coordinate overflow.
  const scale = points.reduce((largest, point) => Math.max(largest, ...point.map(Math.abs)), Math.max(1, Math.abs(x), Math.abs(y)))
  const normalized = points.map(point => point.map(value => value / scale))
  const px = x / scale, py = y / scale
  const distance = (t: number): number => {
    let row = normalized
    while (row.length > 1) row = row.slice(1).map((point, i) => [
      required(required(row[i])[0]) * (1 - t) + required(point[0]) * t,
      required(required(row[i])[1]) * (1 - t) + required(point[1]) * t,
    ])
    const point = required(row[0])
    return (required(point[0]) - px) ** 2 + (required(point[1]) - py) ** 2
  }
  if (item.kind === 'L' || item.kind === 'Z') {
    const a = required(normalized[0]), b = required(normalized[1])
    const dx = required(b[0]) - required(a[0]), dy = required(b[1]) - required(a[1])
    const length = dx * dx + dy * dy
    if (!length) return 0
    return Math.max(0, Math.min(1, ((px - required(a[0])) * dx + (py - required(a[1])) * dy) / length))
  }
  let best = 0, bestDistance = distance(0)
  const samples = 64
  for (let i = 1; i <= samples; i++) {
    const candidate = i / samples, candidateDistance = distance(candidate)
    if (candidateDistance < bestDistance) { best = candidate; bestDistance = candidateDistance }
  }
  let low = Math.max(0, best - 1 / samples), high = Math.min(1, best + 1 / samples)
  for (let i = 0; i < 40; i++) {
    const a = low + (high - low) / 3, b = high - (high - low) / 3
    if (distance(a) <= distance(b)) high = b
    else low = a
  }
  const refined = (low + high) / 2
  return distance(refined) < bestDistance ? refined : best
}
