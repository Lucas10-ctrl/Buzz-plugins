/** Read-only change highlights use rendered text positions, keeping Markdown syntax out of version review. */
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { wordDiff } from './word-diff.ts'

function textIndex(doc: Node): { text: string; positions: number[] } {
  let text = ''
  const positions: number[] = []
  doc.descendants((node, position) => {
    if (!node.isText) return
    if (positions.length && positions.at(-1) !== position - 1) { text += '\n'; positions.push(-1) }
    const value = node.text ?? ''
    text += value
    for (let offset = 0; offset < value.length; offset++) positions.push(position + offset)
  })
  return { text, positions }
}

/**
 * Highlight additions or removals inside one formatted version without changing its content.
 * @param doc - Rendered version to decorate.
 * @param other - Opposite version parsed with the same schema.
 * @param kind - Whether this version shows additions or removals.
 * @returns Read-only decorations; formatting-only changes use the structural difference range.
 */
export function docsDiff(doc: Node, other: Node, kind: 'added' | 'removed'): DecorationSet {
  const current = textIndex(doc), opposite = textIndex(other)
  const parts = kind === 'added' ? wordDiff(opposite.text, current.text) : wordDiff(current.text, opposite.text)
  const decorations: Decoration[] = []
  let offset = 0
  for (const part of parts) {
    if (part.kind !== kind && part.kind !== 'same') continue
    if (part.kind === kind) {
      let start: number | undefined, end = 0
      const flush = (): void => {
        if (start !== undefined) decorations.push(Decoration.inline(start, end, { nodeName: kind === 'added' ? 'ins' : 'del', 'data-doc-change': kind }))
        start = undefined
      }
      for (let index = offset; index < offset + part.text.length; index++) {
        const position = current.positions[index]
        if (position === undefined || position < 0) { flush(); continue }
        if (start !== undefined && position !== end) flush()
        start ??= position; end = position + 1
      }
      flush()
    }
    offset += part.text.length
  }
  if (current.text === opposite.text && !doc.eq(other)) {
    const start = doc.content.findDiffStart(other.content), end = doc.content.findDiffEnd(other.content)
    if (start !== null && end !== null && end.a > start)
      decorations.push(Decoration.inline(start, end.a, { nodeName: kind === 'added' ? 'ins' : 'del', 'data-doc-change': kind }))
  }
  return DecorationSet.create(doc, decorations)
}
