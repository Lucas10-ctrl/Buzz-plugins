/** Saved data-row charts; render options are owned here, never supplied by document content. */
import { init, use, type ComposeOption } from 'echarts/core'
import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent, type GridComponentOption, type TitleComponentOption,
  type TooltipComponentOption } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { z } from 'zod'
import { parseTree, findNodeAtLocation, visit } from 'jsonc-parser'

use([BarChart, LineChart, GridComponent, TitleComponent, TooltipComponent, SVGRenderer])

const label = z.string().max(120).refine(value => !/[\u0000-\u001f]/u.test(value))
const chartSchema = z.object({
  version: z.literal(1), type: z.enum(['bar', 'line']), title: label, xLabel: label, yLabel: label,
  rows: z.array(z.object({ id: z.string().min(1).max(80).regex(/^[\w-]+$/u), label,
    value: z.number().min(-1e12).max(1e12) }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.rows.map(row => row.id)).size === value.rows.length,
  'Chart row identities must be unique.')

/** Version-one chart data saved inside a `copyos-chart` Markdown fence; row identities survive label edits. */
export type DocsChart = z.infer<typeof chartSchema>
/** The same bounded bar/line option is consumed by browser interactions and server SVG export. */
export type DocsChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption
  | TitleComponentOption | TooltipComponentOption>

/** Parse the saved JSON format, rejecting arbitrary chart options, duplicate identities and oversized data.
 * @param source - Exact `copyos-chart` fence contents.
 * @returns Validated data rows, labels and chart type.
 * @throws When JSON, version, values or bounds are invalid; callers retain the original source.
 */
export function parseDocsChart(source: string): DocsChart {
  if (source.length > 40_000) throw new Error('This chart is too large. Use at most 100 data rows.')
  const data = chartSchema.parse(JSON.parse(source)), keys: Set<string>[] = []
  visit(source, {
    onObjectBegin: () => { keys.push(new Set()) },
    onObjectProperty: (name) => {
      const object = keys.at(-1)
      if (object?.has(name)) throw new Error('Chart fields must not be repeated.')
      object?.add(name)
    },
    onObjectEnd: () => { keys.pop() },
  })
  return data
}

/** Find one row's exact numeric source span, so duplicate values never anchor a comment to another row.
 * @param source - Valid saved chart JSON.
 * @param rowId - Stable row identity selected in the chart or data table.
 * @returns Offsets within the fence contents, or undefined if the row no longer exists.
 * @throws When source data is invalid.
 */
export function docsChartValueRange(source: string, rowId: string): { from: number; to: number } | undefined {
  return docsChartValueRanges(source).get(rowId)
}

/** Map all numeric spans in one parse for data-table highlights.
 * @param source - Valid saved chart JSON.
 * @returns Numeric source offsets keyed by stable row identity.
 * @throws When source data is invalid.
 */
export function docsChartValueRanges(source: string): ReadonlyMap<string, { from: number; to: number }> {
  const data = parseDocsChart(source), tree = parseTree(source), result = new Map<string, { from: number; to: number }>()
  data.rows.forEach((row, index) => {
    const node = tree && findNodeAtLocation(tree, ['rows', index, 'value'])
    if (node) result.set(row.id, { from: node.offset, to: node.offset + node.length })
  })
  return result
}

/** Build fixed chart options from validated data; no remote assets, callbacks, HTML tooltips or animations.
 * @param chart - Data returned by parseDocsChart.
 * @returns Options shared by interactive preview and server exports.
 */
export function docsChartOption(chart: DocsChart): DocsChartOption {
  return {
    animation: false, backgroundColor: '#ffffff', color: ['#526f68'],
    textStyle: { fontFamily: 'Arial, sans-serif', color: '#262626', fontSize: 12 },
    title: { text: chart.title, left: 20, top: 12, textStyle: { fontSize: 16, fontWeight: 500, color: '#262626' } },
    grid: { left: 64, right: 28, top: 64, bottom: 32, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    xAxis: { type: 'category', data: chart.rows.map(row => row.label), name: chart.xLabel, nameLocation: 'middle', nameGap: 44,
      axisLabel: { interval: 'auto', rotate: chart.rows.length > 8 ? 35 : 0, width: 90, overflow: 'truncate' },
      axisLine: { lineStyle: { color: '#737373' } }, axisTick: { alignWithLabel: true } },
    yAxis: { type: 'value', name: chart.yLabel, nameGap: 20, axisLine: { show: false },
      splitLine: { lineStyle: { color: '#e5e7e6' } }, axisLabel: { color: '#626262' } },
    series: [{ type: chart.type, name: chart.yLabel, data: chart.rows.map(row => row.value),
      ...(chart.type === 'bar' ? { barMaxWidth: 52 } : { showSymbol: true, symbolSize: 9 }),
      emphasis: { itemStyle: { color: '#354f48' } } }],
  }
}

/** Render saved chart JSON as a standalone SVG without a DOM, fetching or persistent chart instances.
 * @param source - Exact saved fence contents.
 * @returns Fixed 720 by 380 SVG; the browser may scale it without changing its data.
 * @throws When the saved chart is invalid or the complete output exceeds the export bound.
 */
export function renderDocsChart(source: string): string {
  const data = parseDocsChart(source)
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 720, height: 380 })
  try {
    chart.setOption(docsChartOption(data))
    const svg = chart.renderToSVGString({ useViewBox: true })
    if (svg.length > 2_000_000) throw new Error('This chart is too large to display. Use fewer data rows.')
    return svg
  } finally { chart.dispose() }
}

/** Convert chart data to a portable Markdown table with literal labels and all numeric values.
 * @param chart - Validated saved data.
 * @returns A title, when present, followed by a two-column data table.
 */
export function docsChartTable(chart: DocsChart): string {
  const escape = (value: string): string => value.replaceAll('\\', '\\\\').replace(/[|`*_{}\[\]<>#!]/gu, '\\$&')
  return `${chart.title ? `**${escape(chart.title)}**\n\n` : ''}| ${escape(chart.xLabel)} | ${escape(chart.yLabel)} |\n| --- | ---: |\n`
    + chart.rows.map(row => `| ${escape(row.label)} | ${row.value} |`).join('\n')
}
