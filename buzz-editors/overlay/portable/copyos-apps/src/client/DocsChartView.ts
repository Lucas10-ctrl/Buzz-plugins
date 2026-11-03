/** A chart's data stays in its Markdown code node; controls never enter the editable source. */
import type { NodeViewRendererProps } from '@tiptap/core'
import type { NodeView } from '@tiptap/pm/view'
import { init } from 'echarts/core'
import { parseDocsChart, docsChartOption, renderDocsChart, docsChartValueRanges, type DocsChart } from '../../../copyos-domain/src/docs-chart.ts'
import { bytesToBase64, randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocsWorkspace.module.css'

/** The rich editor maps chart-value positions through the same source map as selected text comments. */
export interface DocsChartComments {
  readonly available: () => boolean
  readonly match: (from: number, to: number) => { readonly id: string; readonly active: boolean } | undefined
  readonly start: (from: number, to: number, quote: string) => void
}

/** Build a chart preview, source toggle and autosaved data table around one code node.
 * @param props - Tiptap-owned node, view and position lifecycle.
 * @param t - Current interface dictionary.
 * @param comments - Current reader's comment capability, resolved again for every action.
 * @returns Node view with editor-owned source and disposal of chart, observer and timers.
 */
export function docsChartView(props: NodeViewRendererProps, t: PropsLocale<'copyosFoundation'>['t'], comments?: DocsChartComments): NodeView {
  const { editor, getPos, view } = props
  let current = props.node, data: DocsChart | undefined, sourceMode = false, dataOpen = false, selectedId: string | undefined
  let rendered: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
  let ranges: ReadonlyMap<string, { from: number; to: number }> = new Map()
  const dom = document.createElement('div'), controls = document.createElement('div'), plot = document.createElement('div')
  dom.className = `${css.codeNode ?? ''} ${css.chartNode ?? ''}`
  controls.className = css.codeControls ?? ''; controls.contentEditable = 'false'; controls.setAttribute('data-doc-print-exclude', '')
  const sourceButton = document.createElement('button'), dataButton = document.createElement('button')
  sourceButton.type = dataButton.type = 'button'
  dataButton.textContent = t('docsChartViewData'); dataButton.setAttribute('aria-expanded', 'false')
  const status = document.createElement('p'); status.className = css.diagramError ?? ''; status.setAttribute('role', 'status')
  status.contentEditable = 'false'; status.setAttribute('data-doc-print-exclude', '')
  const pre = document.createElement('pre'), code = document.createElement('code'); code.className = 'language-copyos-chart'; pre.appendChild(code)
  plot.className = css.chartPlot ?? ''; plot.contentEditable = 'false'; plot.setAttribute('data-doc-print-exclude', '')
  plot.setAttribute('role', 'img'); plot.setAttribute('aria-label', t('docsChart'))
  const printImage = document.createElement('img'); printImage.className = css.chartPrint ?? ''; printImage.setAttribute('data-doc-diagram', '')
  printImage.setAttribute('aria-hidden', 'true')
  printImage.alt = t('docsChart')
  const inspector = document.createElement('div'), valueText = document.createElement('output'), commentValue = document.createElement('button')
  inspector.className = css.chartValue ?? ''; inspector.contentEditable = 'false'; inspector.setAttribute('data-doc-print-exclude', '')
  inspector.hidden = true; commentValue.type = 'button'; commentValue.textContent = t('docsComment')
  inspector.append(valueText, commentValue)
  const panel = document.createElement('div'), metadata = document.createElement('div'), table = document.createElement('table')
  panel.className = css.chartData ?? ''; panel.contentEditable = 'false'; panel.setAttribute('data-doc-print-exclude', '')
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', t('docsChartData'))
  metadata.className = css.chartMetadata ?? ''
  const title = document.createElement('input'), xLabel = document.createElement('input'), yLabel = document.createElement('input')
  const type = document.createElement('select')
  for (const name of ['bar', 'line'] as const) {
    const option = document.createElement('option'); option.value = name; option.textContent = t(name === 'bar' ? 'docsChartBar' : 'docsChartLine'); type.append(option)
  }
  type.setAttribute('aria-label', t('docsChartType'))
  metadata.append(type)
  for (const [field, name] of [[title, 'docsChartTitle'], [xLabel, 'docsChartXLabel'], [yLabel, 'docsChartYLabel']] as const) {
    field.maxLength = 120; field.setAttribute('aria-label', t(name)); field.placeholder = t(name); metadata.append(field)
  }
  const head = table.createTHead().insertRow(), labelHead = document.createElement('th'), valueHead = document.createElement('th'), actionHead = document.createElement('th')
  labelHead.scope = valueHead.scope = actionHead.scope = 'col'; actionHead.textContent = t('docsChartActions')
  head.append(labelHead, valueHead, actionHead)
  const body = table.createTBody(), add = document.createElement('button')
  add.type = 'button'; add.textContent = t('docsChartAddRow')
  const hint = document.createElement('p'); hint.className = css.chartHint ?? ''; hint.textContent = t('docsChartHint')
  panel.append(metadata, table, add, hint)
  controls.append(dataButton, sourceButton); dom.append(controls, plot, printImage, inspector, status, panel, pre)
  const rows = new Map<string, { row: HTMLTableRowElement
    label: HTMLInputElement
    value: HTMLInputElement
    labelText: HTMLSpanElement
    valueText: HTMLSpanElement
    comment: HTMLButtonElement
    remove: HTMLButtonElement
  }>()
  const chart = init(plot, undefined, { renderer: 'svg', width: 720, height: 380 })
  const display = (): void => {
    pre.hidden = !!data && !sourceMode; plot.hidden = !data || sourceMode; panel.hidden = !data || !dataOpen || sourceMode
    sourceButton.textContent = t(sourceMode ? 'docsChartPreview' : 'docsChartShowSource')
    sourceButton.disabled = !data && sourceMode; dataButton.disabled = !data
    dataButton.setAttribute('aria-expanded', String(dataOpen && !sourceMode))
    inspector.hidden = !data || sourceMode || !selectedId
    if (data) pre.setAttribute('data-doc-print-exclude', ''); else pre.removeAttribute('data-doc-print-exclude')
    if (data) { if (printImage.parentNode !== dom) dom.insertBefore(printImage, inspector) }
    else printImage.remove()
  }
  const select = (id: string): void => {
    const row = data?.rows.find(item => item.id === id)
    selectedId = row?.id; valueText.textContent = row ? `${row.label}: ${row.value}` : ''
    highlight(valueText, row?.id ?? '')
    commentValue.hidden = !comments?.available(); display()
  }
  const highlight = (element: HTMLElement, id: string, reveal = true): void => {
    const range = ranges.get(id), position = getPos()
    const thread = range && position !== undefined ? comments?.match(position + 1 + range.from, position + 1 + range.to) : undefined
    element.className = thread ? css.commentHighlight ?? '' : ''
    if (thread) element.dataset.active = String(thread.active); else delete element.dataset.active
    if (thread && reveal) element.dataset.docComment = thread.id; else delete element.dataset.docComment
  }
  const comment = (id: string): void => {
    if (!comments?.available()) return
    const row = data?.rows.find(item => item.id === id), position = getPos()
    if (!row || position === undefined) return
    const range = ranges.get(id)
    if (range) comments.start(position + 1 + range.from, position + 1 + range.to, `${row.label}: ${row.value}`)
  }
  const write = (change: (value: DocsChart) => DocsChart): void => {
    if (!editor.isEditable) return
    const position = getPos()
    if (position === undefined) return
    let source: string
    try { source = JSON.stringify(change(parseDocsChart(current.textContent)), null, 2); parseDocsChart(source) }
    catch (_error) { status.textContent = t('docsChartInvalidData'); return }
    status.textContent = ''
    view.dispatch(view.state.tr.insertText(source, position + 1, position + 1 + current.content.size))
  }
  const capabilities = (): void => {
    dom.dataset.editable = String(editor.isEditable); metadata.hidden = !editor.isEditable; add.hidden = !editor.isEditable
    add.disabled = (data?.rows.length ?? 0) >= 100
    for (const row of rows.values()) {
      row.label.disabled = row.value.disabled = !editor.isEditable
      row.label.hidden = row.value.hidden = !editor.isEditable
      row.labelText.hidden = row.valueText.hidden = editor.isEditable
      row.comment.hidden = !comments?.available(); row.remove.hidden = !editor.isEditable
      row.remove.disabled = (data?.rows.length ?? 0) <= 1
    }
    commentValue.hidden = !comments?.available()
  }
  const syncTable = (): void => {
    if (!data) return
    for (const [input, value] of [[title, data.title], [xLabel, data.xLabel], [yLabel, data.yLabel]] as const)
      if (document.activeElement !== input) input.value = value
    type.value = data.type; labelHead.textContent = data.xLabel || t('docsChartLabel'); valueHead.textContent = data.yLabel || t('docsChartValue')
    for (const [id, item] of rows) if (!data.rows.some(row => row.id === id)) { item.row.remove(); rows.delete(id) }
    data.rows.forEach((row, index) => {
      let item = rows.get(row.id)
      if (!item) {
        const tr = document.createElement('tr'), labelCell = tr.insertCell(), valueCell = tr.insertCell(), actions = tr.insertCell()
        tr.dataset.chartRow = row.id
        const label = document.createElement('input'), value = document.createElement('input')
        const labelText = document.createElement('span'), valueText = document.createElement('span')
        const commentButton = document.createElement('button'), remove = document.createElement('button')
        label.maxLength = 120; value.type = 'number'; value.step = 'any'; value.min = '-1000000000000'; value.max = '1000000000000'
        commentButton.type = remove.type = 'button'; commentButton.textContent = t('docsComment'); remove.textContent = t('docsChartRemoveRow')
        labelCell.append(labelText, label); valueCell.append(valueText, value); actions.append(commentButton, remove)
        label.oninput = () => {
          write(data => ({ ...data, rows: data.rows.map(item => item.id === row.id ? { ...item, label: label.value } : item) }))
        }
        value.oninput = () => {
          const number = value.valueAsNumber
          if (!value.value || !Number.isFinite(number) || !value.validity.valid) { status.textContent = t('docsChartInvalidData'); return }
          write(data => ({ ...data, rows: data.rows.map(item => item.id === row.id ? { ...item, value: number } : item) }))
        }
        commentButton.onclick = () => { comment(row.id) }
        remove.onclick = () => {
          write(data => ({ ...data, rows: data.rows.length > 1 ? data.rows.filter(item => item.id !== row.id) : data.rows }))
        }
        item = { row: tr, label, value, labelText, valueText, comment: commentButton, remove }; rows.set(row.id, item)
      }
      item.labelText.textContent = row.label; item.valueText.textContent = String(row.value)
      if (document.activeElement !== item.label) item.label.value = row.label
      if (document.activeElement !== item.value) item.value.value = String(row.value)
      item.label.setAttribute('aria-label', t('docsChartRowLabel', { number: String(index + 1) }))
      item.value.setAttribute('aria-label', t('docsChartRowValue', { number: String(index + 1) }))
      item.comment.setAttribute('aria-label', t('docsChartCommentValue', { label: row.label, value: String(row.value) }))
      item.remove.setAttribute('aria-label', t('docsChartDeleteValue', { label: row.label }))
      highlight(item.valueText, row.id); highlight(item.value, row.id, false)
      if (body.children[index] !== item.row) body.insertBefore(item.row, body.children[index] ?? null)
    })
    capabilities()
    if (selectedId) select(selectedId)
  }
  const draw = (): void => {
    if (disposed || !data) return
    chart.setOption(docsChartOption(data), true)
  }
  const update = (): void => {
    if (rendered === current.textContent) { syncTable(); return }
    const initial = rendered === undefined; rendered = current.textContent; clearTimeout(timer)
    try {
      data = parseDocsChart(current.textContent); ranges = docsChartValueRanges(current.textContent)
      status.textContent = ''; syncTable(); plot.setAttribute('aria-label', data.title || t('docsChart'))
      printImage.src = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(renderDocsChart(current.textContent)))}`
      printImage.alt = data.title || t('docsChart')
    }
    catch (_error) { data = undefined; sourceMode = true; status.textContent = t('docsChartInvalid'); printImage.removeAttribute('src') }
    display()
    if (data) { if (initial) draw(); else timer = setTimeout(draw, 120) }
  }
  for (const [input, key] of [[title, 'title'], [xLabel, 'xLabel'], [yLabel, 'yLabel']] as const)
    input.oninput = () => { write(data => ({ ...data, [key]: input.value })) }
  type.onchange = () => { const value = type.value; if (value === 'bar' || value === 'line') write(data => ({ ...data, type: value })) }
  add.onclick = () => { write(data => data.rows.length < 100 ? { ...data, rows: [...data.rows,
    { id: randomUUID(), label: t('docsChartNewRow', { number: String(data.rows.length + 1) }), value: 0 }] } : data) }
  dataButton.onclick = () => { dataOpen = !dataOpen; sourceMode = false; display(); if (dataOpen) panel.querySelector<HTMLElement>('input:not(:disabled),button:not([hidden])')?.focus() }
  sourceButton.onclick = () => {
    sourceMode = !sourceMode; display(); const pos = getPos()
    if (sourceMode && editor.isEditable && pos !== undefined) editor.chain().focus().setTextSelection(pos + 1).run()
  }
  commentValue.onclick = () => { if (selectedId) comment(selectedId) }
  for (const event of ['click', 'mouseover']) chart.on(event, (params) => {
    if (params && typeof params === 'object' && 'dataIndex' in params && typeof params.dataIndex === 'number') {
      const row = data?.rows[params.dataIndex]; if (row) select(row.id)
    }
  })
  const resize = (): void => {
    const width = plot.clientWidth
    if (width > 0 && !plot.hidden) chart.resize({ width, height: 380 })
  }
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
  observer?.observe(plot)
  const permissions = new MutationObserver(capabilities)
  permissions.observe(view.dom, { attributes: true, attributeFilter: ['contenteditable', 'data-doc-can-comment'] })
  update()
  return { dom, contentDOM: code,
    update: (next) => {
      if (next.type !== current.type || String(next.attrs.language).toLowerCase() !== 'copyos-chart') return false
      current = next; update(); return true
    },
    stopEvent: event => event.target instanceof globalThis.Node && !pre.contains(event.target),
    ignoreMutation: mutation => mutation.type !== 'selection' && !code.contains(mutation.target),
    destroy: () => { disposed = true; clearTimeout(timer); observer?.disconnect(); permissions.disconnect(); chart.dispose() },
  }
}
