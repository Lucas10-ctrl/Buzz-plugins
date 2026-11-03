/** Word-level diff for showing a proposed edit or a history change in place. */

/** One run of unchanged, removed or added text, whitespace included. */
export interface WordDiffPart {
  readonly kind: 'same' | 'removed' | 'added'
  readonly text: string
}

const MAX_CELLS = 90_000

/**
 * Diff two texts by words with a longest-common-subsequence table.
 * Inputs whose table would exceed 90,000 cells come back as one removal and one addition.
 * @param before - Current text.
 * @param after - Proposed text.
 * @returns Runs in reading order with adjacent runs of the same kind merged.
 */
export function wordDiff(before: string, after: string): readonly WordDiffPart[] {
  const left = before.split(/(\s+)/u).filter(Boolean)
  const right = after.split(/(\s+)/u).filter(Boolean)
  if (left.length * right.length > MAX_CELLS) return merge([{ kind: 'removed', text: before }, { kind: 'added', text: after }])
  const width = right.length + 1
  const table = new Uint32Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      table[i * width + j] = left[i] === right[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
  const parts: WordDiffPart[] = []
  let i = 0, j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { parts.push({ kind: 'same', text: left[i] ?? '' }); i++; j++ }
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) { parts.push({ kind: 'removed', text: left[i] ?? '' }); i++ }
    else { parts.push({ kind: 'added', text: right[j] ?? '' }); j++ }
  }
  for (; i < left.length; i++) parts.push({ kind: 'removed', text: left[i] ?? '' })
  for (; j < right.length; j++) parts.push({ kind: 'added', text: right[j] ?? '' })
  return merge(parts)
}

function merge(parts: readonly WordDiffPart[]): readonly WordDiffPart[] {
  // A whitespace-only match between two changes belongs to the change, so a replaced phrase reads as one removal and one addition.
  const blocks: WordDiffPart[] = []
  let removed = '', added = ''
  const flush = (): void => {
    if (removed) blocks.push({ kind: 'removed', text: removed })
    if (added) blocks.push({ kind: 'added', text: added })
    removed = ''; added = ''
  }
  parts.forEach((part, index) => {
    const between = part.kind === 'same' && part.text.trim() === '' && (removed || added) !== ''
      && parts.slice(index + 1).find(next => !(next.kind === 'same' && next.text.trim() === ''))?.kind !== 'same'
      && index < parts.length - 1
    if (part.kind === 'removed' || between) removed += part.text
    if (part.kind === 'added' || between) added += part.text
    if (part.kind === 'same' && !between) { flush(); blocks.push(part) }
  })
  flush()
  const merged: WordDiffPart[] = []
  for (const part of blocks) {
    if (part.text === '') continue
    const last = merged.at(-1)
    if (last?.kind === part.kind) merged[merged.length - 1] = { kind: part.kind, text: last.text + part.text }
    else merged.push(part)
  }
  return merged
}
