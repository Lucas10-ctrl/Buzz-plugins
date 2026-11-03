/** Preserve document Markdown while replacing valid chart fences with portable data tables. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { parseDocsChart, docsChartTable } from './docs-chart.ts'

/** Export all chart values as tables, including charts nested in lists or blockquotes; invalid drafts stay as source.
 * @param markdown - Saved document Markdown, including all ordered tabs.
 * @returns Markdown with only valid copyos-chart fences replaced; saved content is never mutated.
 */
export function docsChartsToMarkdown(markdown: string): string {
  const edits: { from: number; to: number; text: string }[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'code' && node.lang?.toLowerCase() === 'copyos-chart') {
      const from = node.position?.start.offset, to = node.position?.end.offset
      if (from === undefined || to === undefined) return
      let table: string
      try { table = docsChartTable(parseDocsChart(node.value)) }
      catch (_error) { return /* In-progress charts retain their exact source in the export. */ }
      const prefix = markdown.slice(markdown.lastIndexOf('\n', from - 1) + 1, from)
      const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s/gu, match => ' '.repeat(match.length))
      edits.push({ from, to, text: table.replaceAll('\n', `\n${continuation}`) })
    } else if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(fromMarkdown(markdown))
  for (const edit of edits.sort((a, b) => b.from - a.from))
    markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to)
  return markdown
}
