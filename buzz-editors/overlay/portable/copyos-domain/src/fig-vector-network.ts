/** Rebuild editable path geometry from a Figma vector network when the record carries no saved fill or stroke geometry. */

/** One SVG subpath group with its fill rule, in the layer's own pixel coordinates. */
export interface FigVectorNetworkPath {
  readonly d: string
  readonly fillRule: 'nonzero' | 'evenodd'
}

interface Segment { start: number; end: number; startTangent: [number, number]; endTangent: [number, number] }

/**
 * Read the network blob index and normalized size from a decoded `vectorData` field.
 * @param value - Decoded Kiwi `vectorData`, typed `unknown` by the codec.
 * @returns Blob index and the normalized width and height (NaN when absent or not positive), or undefined without a network.
 */
export function figVectorNetwork(value: unknown): { blob: number; width: number; height: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const blob: unknown = Reflect.get(value, 'vectorNetworkBlob')
  if (typeof blob !== 'number' || !Number.isInteger(blob) || blob < 0) return undefined
  const size: unknown = Reflect.get(value, 'normalizedSize')
  const part = (key: string): number => {
    const number: unknown = typeof size === 'object' && size !== null ? Reflect.get(size, key) : undefined
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : NaN
  }
  return { blob, width: part('x'), height: part('y') }
}

/** Largest vertex, segment, region or loop count accepted from one network blob. */
const FIG_VECTOR_NETWORK_MAX_ITEMS = 100000

/**
 * Decode Figma's `vectorNetworkBlob` into SVG paths.
 *
 * Figma clipboard selections omit derived `fillGeometry`, so vector layers pasted from Figma carry only this network.
 * Filled regions keep their loops and winding rule; a network without regions becomes chained open or closed subpaths.
 * @param bytes - Little-endian blob: vertex, segment and region counts, then vertices (style, x, y),
 *   segments (style, start, start tangent, end, end tangent) and regions (style with the winding bit, loops of segment indices).
 * @param scaleX - Layer width divided by the network's normalized width.
 * @param scaleY - Layer height divided by the network's normalized height.
 * @returns Paths in layer coordinates; empty when the network has no segments.
 * @throws Error when the blob is truncated, references a missing vertex or segment, or contains a non-finite coordinate.
 */
export function figVectorNetworkPaths(bytes: Uint8Array, scaleX: number, scaleY: number): FigVectorNetworkPath[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const need = (count: number): void => {
    if (offset + count > bytes.byteLength) throw new Error('Truncated vector network data')
  }
  const uint = (): number => { need(4); const value = view.getUint32(offset, true); offset += 4; return value }
  const float = (): number => {
    need(4)
    const value = view.getFloat32(offset, true); offset += 4
    if (!Number.isFinite(value)) throw new Error('Invalid vector network coordinate')
    return value
  }
  const count = (): number => {
    const value = uint()
    if (value > FIG_VECTOR_NETWORK_MAX_ITEMS) throw new Error('Vector network exceeds the import limit')
    return value
  }
  const vertexCount = count(), segmentCount = count(), regionCount = count()
  const vertices: Array<[number, number]> = []
  for (let i = 0; i < vertexCount; i++) { uint(); vertices.push([float() * scaleX, float() * scaleY]) }
  const segments: Segment[] = []
  for (let i = 0; i < segmentCount; i++) {
    uint()
    const start = uint(), startTangent: [number, number] = [float() * scaleX, float() * scaleY]
    const end = uint(), endTangent: [number, number] = [float() * scaleX, float() * scaleY]
    if (start >= vertexCount || end >= vertexCount) throw new Error('Vector network segment references a missing vertex')
    segments.push({ start, end, startTangent, endTangent })
  }
  const regions: Array<{ fillRule: FigVectorNetworkPath['fillRule']; loops: number[][] }> = []
  for (let i = 0; i < regionCount; i++) {
    const style = uint(), loops: number[][] = []
    for (let loop = count(); loop > 0; loop--) {
      const indices: number[] = []
      for (let index = count(); index > 0; index--) {
        const segment = uint()
        if (segment >= segmentCount) throw new Error('Vector network region references a missing segment')
        indices.push(segment)
      }
      loops.push(indices)
    }
    regions.push({ fillRule: style & 1 ? 'nonzero' : 'evenodd', loops })
  }
  const point = ([x, y]: [number, number]): string => `${x} ${y}`
  const vertex = (index: number): [number, number] => {
    const value = vertices[index]
    if (!value) throw new Error('Vector network segment references a missing vertex')
    return value
  }
  // Walks segments in order, reversing a segment whose end meets the current point, and closes back at a subpath start.
  const chain = (indices: readonly number[], close: boolean): string => {
    const parts: string[] = []
    let current = -1, first = -1
    indices.forEach((index, position) => {
      const segment = segments[index]
      if (!segment) throw new Error('Vector network region references a missing segment')
      let forward = segment.start === current
      if (current < 0 || (!forward && segment.end !== current)) {
        const next = segments[indices[position + 1] ?? -1]
        forward = !next || next.start === segment.end || next.end === segment.end
        if (first >= 0 && current === first) parts.push('Z')
        first = forward ? segment.start : segment.end
        parts.push(`M${point(vertex(first))}`)
      }
      const from = forward ? segment.start : segment.end, to = forward ? segment.end : segment.start
      const out = forward ? segment.startTangent : segment.endTangent
      const back = forward ? segment.endTangent : segment.startTangent
      const [x0, y0] = vertex(from), [x1, y1] = vertex(to)
      parts.push(out[0] || out[1] || back[0] || back[1]
        ? `C${point([x0 + out[0], y0 + out[1]])} ${point([x1 + back[0], y1 + back[1]])} ${point([x1, y1])}`
        : `L${point([x1, y1])}`)
      current = to
    })
    if (parts.length && (close || current === first)) parts.push('Z')
    return parts.join(' ')
  }
  if (regions.length)
    return regions.map(region => ({ d: region.loops.map(loop => chain(loop, true)).join(' '), fillRule: region.fillRule }))
      .filter(path => path.d)
  const d = chain(segments.map((_, index) => index), false)
  return d ? [{ d, fillRule: 'nonzero' }] : []
}
