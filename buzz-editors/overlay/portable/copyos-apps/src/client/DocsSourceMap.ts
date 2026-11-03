/** Map rich-text characters to the Markdown shared by tools and Yjs without editing the live editor. */
import type { Editor, JSONContent } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'

/** One text character's ProseMirror and Markdown boundaries, including Markdown escapes. */
interface Character { readonly position: number; readonly from: number; readonly to: number }
/** Offsets shared by document comments and the editor's selection. */
export interface DocsTextRange { readonly from: number; readonly to: number }
/** An exact source map; unsupported serializations fail closed rather than selecting a different occurrence. */
export interface DocsSourceMap {
  readonly source: string
  sourceRange(from: number, to: number): DocsTextRange | undefined
  documentRange(from: number, to: number): DocsTextRange | undefined
}
function normalized(value: string): { text: string; offsets: number[] } {
  let text = '', offset = 0
  const offsets: number[] = []
  for (const line of value.split('\n')) {
    const separator = /^\s*\|[ :|\-]+\|\s*$/u.test(line)
    const bullet = /^\s*[-+*]\s/u.exec(line), bulletIndex = bullet?.[0].search(/[-+*]/u)
    const destinations = new Uint8Array(line.length)
    for (const tag of line.matchAll(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*?)?\/?>/giu)) destinations.fill(1, tag.index, tag.index + tag[0].length)
    for (const link of line.matchAll(/\[[^\]]*\]\([^)]*\)/gu)) {
      const from = link.index + link[0].indexOf('](') + 2
      destinations.fill(1, from, link.index + link[0].length - 1)
    }
    if (!separator) for (let index = 0; index < line.length; index++) {
      const char = line[index] ?? ''
      if (index === bulletIndex || destinations[index] === 1) continue
      if (/\s/u.test(char) || '\\*_~`[]()<>|'.includes(char)) continue
      text += char
      offsets.push(offset + index)
    }
    offset += line.length + 1
  }
  return { text, offsets }
}
function lowerBound(offsets: readonly number[], value: number): number {
  let left = 0, right = offsets.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if ((offsets[middle] ?? Infinity) < value) left = middle + 1
    else right = middle
  }
  return left
}
function seek(points: readonly Character[], key: keyof Character, value: number, strict = false): number {
  let left = 0, right = points.length
  while (left < right) {
    const middle = (left + right) >>> 1, point = points[middle]
    if (point && (strict ? point[key] <= value : point[key] < value)) left = middle + 1
    else right = middle
  }
  return left
}
function characters(raw: string, visible: string, position: number, source: number): Character[] | undefined {
  if (raw === visible) return Array.from({ length: visible.length }, (_, index) => ({
    position: position + index, from: source + index, to: source + index + 1,
  }))
  const result: Character[] = []
  let offset = 0
  for (let index = 0; index < visible.length; index++) {
    const char = visible[index] ?? '', start = offset
    if (raw[offset] === '\\' && raw[offset + 1] === char) offset += 2
    else if (raw[offset] === char && !(char === '&' && /^&(?:#\d+|#x[\da-f]+|[a-z]+);/iu.test(raw.slice(offset)))) offset++
    else if (raw[offset] === '&') {
      const entity = /^&(?:#\d+|#x[\da-f]+|[a-z]+);/iu.exec(raw.slice(offset))?.[0]
      if (!entity) return undefined
      const decoder = document.createElement('textarea'); decoder.innerHTML = entity
      const decoded = decoder.value
      if (visible.slice(index, index + decoded.length) !== decoded) return undefined
      offset += entity.length
      for (let part = 0; part < decoded.length; part++)
        result.push({ position: position + index + part, from: source + start, to: source + offset })
      index += decoded.length - 1; continue
    } else if (char === '\n' && /^<br\s*\/?\s*>/u.test(raw.slice(offset))) offset += /^<br\s*\/?\s*>/u.exec(raw.slice(offset))?.[0].length ?? 0
    else return undefined
    result.push({ position: position + index, from: source + start, to: source + offset })
  }
  return offset === raw.length ? result : undefined
}

/** Serialize boundary markers in a temporary JSON copy, then map each original text node back exactly.
 * Table padding can grow around markers, so its whitespace and separator widths are aligned independently.
 * @param editor - Mounted rich editor with the Markdown extension.
 * @param source - Stored Markdown, defaulting to the editor's canonical serialization.
 * @param node - Optional section body represented as a temporary document.
 * @param offset - Its position in the continuous page.
 * @returns Source ranges for selections and document ranges for comment highlights.
 */
export function docsSourceMap(editor: Editor, source = editor.getMarkdown(), node: Node = editor.state.doc, offset = 0): DocsSourceMap {
  const nodes: { position: number; text: string; marks: Parameters<Editor['schema']['text']>[1] }[] = []
  node.descendants((child, position) => { if (child.isText) nodes.push({ position: position + offset, text: child.text ?? '', marks: child.marks }) })
  let marker = 0xe000
  while (marker <= 0xfffc && (source.includes(String.fromCharCode(marker)) || source.includes(String.fromCharCode(marker + 1)))) marker += 2
  if (marker > 0xfffc) return { source, sourceRange: () => undefined, documentRange: () => undefined }
  const startMarker = String.fromCharCode(marker), endMarker = String.fromCharCode(marker + 1)
  const json = node.toJSON() as JSONContent, stack: JSONContent[] = [json]
  let textIndex = 0
  while (stack.length) {
    const node = stack.pop()
    if (!node) break
    if (node.type === 'text') {
      node.text = `${startMarker}${textIndex}s${endMarker}${node.text ?? ''}${startMarker}${textIndex}e${endMarker}`
      textIndex++
    } else if (node.content) for (let index = node.content.length - 1; index >= 0; index--) {
      const child = node.content[index]
      if (child) stack.push(child)
    }
  }
  const decorated = editor.markdown?.serialize(json) ?? source
  const pattern = new RegExp(`${startMarker}(\\d+)([se])${endMarker}`, 'gu')
  let stripped = '', cursor = 0
  const boundaries = new Map<number, { from: number; to: number }>()
  for (const match of decorated.matchAll(pattern)) {
    stripped += decorated.slice(cursor, match.index)
    const id = Number(match[1]), existing = boundaries.get(id) ?? { from: 0, to: 0 }
    if (match[2] === 's') existing.from = stripped.length
    else existing.to = stripped.length
    boundaries.set(id, existing)
    cursor = match.index + match[0].length
  }
  stripped += decorated.slice(cursor)
  const same = source === stripped, left = same ? null : normalized(source), right = same ? null : normalized(stripped)
  const aligned = same || left?.text === right?.text
  const mapped: Character[] = []
  if (aligned) nodes.forEach((node, index) => {
    const range = boundaries.get(index)
    if (!range) return
    const raw = stripped.slice(range.from, range.to)
    let from = range.from
    if (!same && left && right) {
      const token = lowerBound(right.offsets, range.from), significant = right.offsets[token], target = left.offsets[token]
      if (significant === undefined || significant >= range.to || target === undefined) return
      from = target - (significant - range.from)
      if (from < 0 || source.slice(from, from + raw.length) !== raw) return
    }
    const points = characters(raw, node.text, node.position, from)
    if (points) for (const point of points) mapped.push(point)
  })
  const emptyParagraph = source === '' && node.childCount === 1
    && node.firstChild?.isTextblock && node.firstChild.content.size === 0
  return { source,
    sourceRange(from, to) {
      if (emptyParagraph && from === offset + 1 && to === offset + 1) return { from: 0, to: 0 }
      const start = seek(mapped, 'position', from), end = seek(mapped, 'position', to)
      const expected = nodes.reduce((sum, node) =>
        sum + Math.max(0, Math.min(to, node.position + node.text.length) - Math.max(from, node.position)), 0)
      const first = mapped[start], last = mapped[end - 1]
      if (from === to) {
        const position = first?.position === from ? first.from : last && last.position + 1 === from ? last.to : undefined
        return position === undefined ? undefined : { from: position, to: position }
      }
      return end - start === expected && end > start && first && last ? { from: first.from, to: last.to } : undefined
    },
    documentRange(from, to) {
      if (emptyParagraph && from === 0 && to === 0) return { from: offset + 1, to: offset + 1 }
      if (from === to) {
        const right = seek(mapped, 'from', from), next = mapped[right], previous = mapped[right - 1]
        const position = next?.from === from ? next.position : previous?.to === from ? previous.position + 1 : undefined
        return position === undefined ? undefined : { from: position, to: position }
      }
      const start = seek(mapped, 'to', from, true), end = seek(mapped, 'from', to)
      const first = mapped[start], last = mapped[end - 1]
      return end > start && first && last ? { from: first.position, to: last.position + 1 } : undefined
    },
  }
}
