/** Document-specific rich blocks retain a readable Markdown representation. */
import { docsImage } from './DocsImage.ts'
import { DocsInlineReferences, readDocsInlineReference } from './DocsInlineReference.tsx'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import { Extension, getSchema, type Extensions, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Blockquote from '@tiptap/extension-blockquote'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin } from '@tiptap/pm/state'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Fragment, Slice, DOMSerializer, type Schema, type ResolvedPos } from '@tiptap/pm/model'
import { common, createLowlight } from 'lowlight'
import { tsvParseRows } from 'd3-dsv'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocsWorkspace.module.css'
import { renderDocsDiagram } from '../../../copyos-domain/src/docs-diagram.ts'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { docsChartView, type DocsChartComments } from './DocsChartView.ts'
import { isStrategyFence, strategyDecisionView, strategySectionView } from './StrategyBlockViews.ts'
import { STRATEGY_DECISION_FENCE, STRATEGY_SECTION_FENCE } from '../../../copyos-domain/src/docs-strategy.ts'

function docsTaskItem(t: PropsLocale<'copyosFoundation'>['t']) {
  return TaskItem.extend({
    addNodeView() {
      const parent = this.parent?.()
      return parent ? (props) => {
        const view = parent(props)
        view.dom.querySelector('label > span')?.setAttribute('aria-hidden', 'true')
        return view
      } : null
    },
  }).configure({ nested: true, a11y: { checkboxLabel: node => node.textContent
    ? t('docsTaskCheckbox', { text: node.textContent }) : t('docsTaskCheckboxEmpty') } })
}

const lowlight = createLowlight(common)
const languageNames = ['plaintext', 'mermaid', 'copyos-chart', 'javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'sql', 'markdown', 'yaml', 'xml', 'java', 'go', 'rust', 'cpp']
const calloutMarkers = { info: 'NOTE', warning: 'WARNING', success: 'TIP', neutral: 'IMPORTANT' } as const
/** Persisted callout tones, encoded as standard blockquote admonition markers in Markdown. */
export type DocsCalloutTone = keyof typeof calloutMarkers
function toneFromMarker(marker: string): DocsCalloutTone | undefined {
  return (Object.entries(calloutMarkers).find(([, value]) => value === marker)?.[0]) as DocsCalloutTone | undefined
}
/** Blockquotes with optional callout tones; ordinary quotes keep ordinary Markdown. */
export const DocsBlockquote = Blockquote.extend({
  addAttributes() {
    return { tone: { default: null, parseHTML: element => element.getAttribute('data-callout'),
      renderHTML: attrs => typeof attrs.tone === 'string' && Object.hasOwn(calloutMarkers, attrs.tone)
        ? { 'data-callout': attrs.tone } : {} } }
  },
  parseMarkdown: (token, helpers) => {
    const children = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? [])
    const first = children[0], text = first?.content?.[0]
    const marker = text?.type === 'text' ? /^\[!(NOTE|WARNING|TIP|IMPORTANT)\](?:\n|$)/u.exec(text.text ?? '') : null
    const tone = marker?.[1] ? toneFromMarker(marker[1]) : undefined
    if (tone && first && text) {
      text.text = (text.text ?? '').slice(marker?.[0].length ?? 0)
      if (!text.text) {
        first.content?.shift()
        if (first.content?.[0]?.type === 'hardBreak') first.content.shift()
      }
      if (!first.content?.length) children.shift()
    }
    return helpers.createNode('blockquote', { tone: tone ?? null }, children.length ? children : [{ type: 'paragraph' }])
  },
  renderMarkdown: (node, helpers) => {
    const tone = typeof node.attrs?.tone === 'string' && Object.hasOwn(calloutMarkers, node.attrs.tone)
      ? node.attrs.tone as DocsCalloutTone : undefined
    const body = helpers.renderChildren(node.content ?? []).split('\n').map(line => line ? `> ${line}` : '>').join('\n')
    return tone ? `> [!${calloutMarkers[tone]}]\n${body}` : body
  },
})

/** Add a localized semantic label to callouts, keeping the stored tone language-independent.
 * @param t - Current interface dictionary.
 * @returns Blockquote extension with accessible callout labels.
 */
export function docsBlockquote(t: PropsLocale<'copyosFoundation'>['t']): typeof DocsBlockquote {
  const labels = { info: 'docsToneInfo', warning: 'docsToneWarning', success: 'docsToneSuccess', neutral: 'docsToneNeutral' } as const
  return DocsBlockquote.extend({ renderHTML({ node, HTMLAttributes }) {
    const tone = typeof node.attrs.tone === 'string' && Object.hasOwn(labels, node.attrs.tone) ? node.attrs.tone as DocsCalloutTone : undefined
    return ['blockquote', { ...HTMLAttributes, ...(tone ? { role: 'note', 'aria-label': t(labels[tone]) } : {}) }, 0]
  } })
}

/** Highlight code and add language/copy controls that stay outside its editable text.
 * @param t - Current interface dictionary.
 * @param comments - Current chart-value comment capability.
 * @returns Code-block extension with Markdown language fences and a semantic code content DOM.
 */
export function docsCodeBlock(t: PropsLocale<'copyosFoundation'>['t'], comments?: DocsChartComments): typeof CodeBlockLowlight {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return (props) => {
        const { node, editor, getPos } = props
        if (String(node.attrs.language).toLowerCase() === 'copyos-chart') return docsChartView(props, t, comments)
        if (String(node.attrs.language).toLowerCase() === STRATEGY_DECISION_FENCE) return strategyDecisionView(props, t)
        if (String(node.attrs.language).toLowerCase() === STRATEGY_SECTION_FENCE) return strategySectionView(props, t)
        let current = node, reset: ReturnType<typeof setTimeout> | undefined
        let previewTimer: ReturnType<typeof setTimeout> | undefined, renderedSource: string | undefined
        let sourceMode = false, valid = false, disposed = false
        const dom = document.createElement('div'), controls = document.createElement('div')
        dom.className = css.codeNode ?? ''; controls.className = css.codeControls ?? ''
        controls.contentEditable = 'false'; controls.setAttribute('data-doc-print-exclude', '')
        const language = document.createElement('select'), label = document.createElement('span')
        language.setAttribute('aria-label', t('docsCodeLanguage'))
        for (const name of languageNames) {
          const option = document.createElement('option'); option.value = name
          option.textContent = name === 'plaintext' ? t('docsPlainText') : name === 'mermaid' ? t('docsDiagram') : name === 'copyos-chart' ? t('docsChart') : name
          language.appendChild(option)
        }
        const copy = document.createElement('button'), status = document.createElement('span')
        copy.type = 'button'; copy.textContent = t('docsHistoryCopyCode'); status.setAttribute('role', 'status')
        const pre = document.createElement('pre'), code = document.createElement('code'); pre.appendChild(code)
        const preview = document.createElement('div'), image = document.createElement('img')
        const toggle = document.createElement('button'), diagramStatus = document.createElement('p')
        preview.className = css.diagramPreview ?? ''; preview.contentEditable = 'false'; preview.appendChild(image)
        preview.tabIndex = 0; preview.setAttribute('role', 'group'); preview.setAttribute('aria-label', t('docsDiagram'))
        preview.title = t('docsDiagramScroll')
        image.alt = t('docsDiagram'); image.setAttribute('data-doc-diagram', '')
        diagramStatus.className = css.diagramError ?? ''; diagramStatus.contentEditable = 'false'
        diagramStatus.setAttribute('data-doc-print-exclude', ''); diagramStatus.setAttribute('role', 'status')
        toggle.type = 'button'; toggle.setAttribute('aria-label', t('docsDiagramShowCode'))
        const isDiagram = (): boolean => String(current.attrs.language).toLowerCase() === 'mermaid'
        const display = (): void => {
          const diagram = isDiagram()
          toggle.hidden = !diagram; toggle.disabled = sourceMode && !valid
          toggle.textContent = t(sourceMode ? 'docsDiagramPreview' : 'docsDiagramShowCode')
          toggle.setAttribute('aria-label', toggle.textContent)
          pre.hidden = diagram && valid && !sourceMode
          preview.hidden = !diagram || !valid || sourceMode
          diagramStatus.hidden = !diagram || valid
          if (diagram && valid) pre.setAttribute('data-doc-print-exclude', '')
          else pre.removeAttribute('data-doc-print-exclude')
        }
        const draw = (): void => {
          if (disposed || !isDiagram()) return
          renderedSource = current.textContent
          try {
            const svg = renderDocsDiagram(renderedSource)
            image.src = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`
            image.style.minWidth = `${Number(/viewBox="0 0 ([\d.]+)/u.exec(svg)?.[1])}px`
            valid = true; diagramStatus.textContent = ''
          } catch (_error) {
            valid = false; sourceMode = true; image.removeAttribute('src'); diagramStatus.textContent = t('docsDiagramInvalid')
          }
          display()
        }
        toggle.onclick = () => {
          sourceMode = !sourceMode; display()
          if (sourceMode && editor.isEditable) {
            const position = getPos()
            if (position !== undefined) editor.chain().focus().setTextSelection(position + 1).run()
          }
        }
        const update = (): void => {
          const name = typeof current.attrs.language === 'string' ? current.attrs.language : 'plaintext'
          if (!Array.from(language.options).some(option => option.value === name)) {
            const option = document.createElement('option'); option.value = name; option.textContent = name; language.appendChild(option)
          }
          language.value = name; label.textContent = name === 'plaintext' ? t('docsPlainText') : name
          label.className = css.codeReadLanguage ?? ''; language.className = css.codeLanguage ?? ''
          code.className = `language-${name}`
          clearTimeout(previewTimer)
          if (isDiagram() && renderedSource !== current.textContent) {
            if (renderedSource === undefined) draw()
            else previewTimer = setTimeout(draw, 150)
          }
          display()
        }
        language.onchange = () => {
          if (!editor.isEditable) return
          const position = getPos()
          if (position === undefined) return
          editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs,
            language: language.value === 'plaintext' ? null : language.value }))
        }
        copy.onclick = () => {
          clearTimeout(reset)
          void navigator.clipboard.writeText(current.textContent).then(() => {
            copy.textContent = t('docsCopied'); status.textContent = ''
            reset = setTimeout(() => { copy.textContent = t('docsHistoryCopyCode') }, 2000)
          }).catch(() => { status.textContent = t('docsCodeCopyFailed') })
        }
        controls.append(language, label, status, toggle, copy); dom.append(controls, preview, diagramStatus, pre); update()
        return { dom, contentDOM: code,
          update: (next) => {
            if (next.type !== current.type || String(next.attrs.language).toLowerCase() === 'copyos-chart' || isStrategyFence(next.attrs.language)) return false
            current = next; update(); return true
          },
          stopEvent: event => event.target instanceof globalThis.Node
            && (controls.contains(event.target) || preview.contains(event.target) || diagramStatus.contains(event.target)),
          ignoreMutation: mutation => mutation.type !== 'selection' && !code.contains(mutation.target),
          destroy: () => { disposed = true; clearTimeout(reset); clearTimeout(previewTimer) },
        }
      }
    },
  }).configure({ lowlight, enableTabIndentation: true })
}

function literalPaste(text: string, context: ResolvedPos, schema: Schema): Slice {
  const paragraphs = text.split(/\r\n?|\n/u).map(line => schema.nodes.paragraph?.create(null,
    line ? schema.text(line, context.marks()) : undefined)).filter(node => node !== undefined)
  return Slice.maxOpen(Fragment.fromArray(paragraphs))
}
/** Parse Markdown and spreadsheet clipboard text; Shift-paste keeps literal text. */
export const DocsClipboard = Extension.create({
  name: 'docsDocumentPaste',
  addProseMirrorPlugins() {
    let preferPlain = false
    return [new Plugin({ props: {
      handleKeyDown: (_view, event) => {
        preferPlain = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v'
        return false
      },
      handlePaste: (view, event) => {
        if (!preferPlain) return false
        preferPlain = false
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined || view.state.selection.$from.parent.type.spec.code) return false
        view.dispatch(view.state.tr.replaceSelection(literalPaste(text, view.state.selection.$from, view.state.schema))
          .setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
        return true
      },
      clipboardTextParser: (text, context, plain, view) => {
        const schema = view.state.schema
        if (plain || preferPlain) {
          preferPlain = false
          return literalPaste(text, context, schema)
        }
        if (text.includes('\t')) {
          const rows = tsvParseRows(text)
          const width = rows.reduce((size, row) => Math.max(size, row.length), 0)
          if (width > 1) {
            const table: JSONContent = { type: 'table', content: rows.map(row => ({ type: 'tableRow',
              content: Array.from({ length: width }, (_, index) => ({ type: 'tableCell', content: [{ type: 'paragraph',
                ...(row[index] ? { content: [{ type: 'text', text: row[index] }] } : {}) }] })) })) }
            return new Slice(Fragment.from(schema.nodeFromJSON(table)), 0, 0)
          }
        }
        if (this.editor.markdown) {
          const parsed = schema.nodeFromJSON(this.editor.markdown.parse(text))
          return Slice.maxOpen(parsed.content)
        }
        return literalPaste(text, context, schema)
      },
    } })]
  },
})

/** Build one editor's schema and lossless table serializer without depending on hook initialization order.
 * @param t - Current interface dictionary.
 * @param resolveAsset - Capability-aware document attachment resolver.
 * @param comments - Current chart-value comment capability.
 * @param page - Supply the continuous page root separately.
 * @returns Matching rich nodes, Markdown, clipboard and placeholder extensions.
 */
export function docsRichExtensions(t: PropsLocale<'copyosFoundation'>['t'], resolveAsset: DocsAssetResolver, comments?: DocsChartComments, page = false): Extensions {
  let serializer: DOMSerializer | undefined, schema: Schema | undefined
  const table = Table.extend({
    addNodeView() {
      const parent = this.parent?.()
      return parent ? (props) => {
        const view = parent(props)
        if (!(view.dom instanceof HTMLElement)) return view
        const edges = document.createElement('div')
        edges.contentEditable = 'false'; edges.className = css.tableEdges ?? ''
        edges.setAttribute('data-doc-print-exclude', ''); edges.setAttribute('data-doc-table-edges', '')
        const allowed = (): boolean => {
          if (!this.editor.isEditable) return false
          const position = props.getPos()
          if (position === undefined) return false
          const resolved = this.editor.state.doc.resolve(position)
          for (let depth = resolved.depth; depth > 0; depth--) {
            if (resolved.node(depth).type.name === 'docSection' && resolved.node(depth).attrs.state === 'writing') return false
          }
          return true
        }
        for (const action of ['row', 'column'] as const) {
          const button = document.createElement('button')
          button.type = 'button'; button.textContent = '+'
          button.className = (action === 'row' ? css.tableAddRow : css.tableAddColumn) ?? ''
          button.setAttribute('aria-label', t(action === 'row' ? 'docsAppendRow' : 'docsAppendColumn'))
          button.addEventListener('mousedown', (event) => { event.preventDefault() })
          button.addEventListener('click', () => {
            if (!allowed()) return
            const position = props.getPos()
            if (position === undefined) return
            const node = this.editor.state.doc.nodeAt(position)
            if (!node || node.type.name !== 'table') return
            // The final cell makes either command append at the table's outer edge.
            let lastCell = position + 1
            node.descendants((child, offset) => {
              if (child.type.name === 'tableCell' || child.type.name === 'tableHeader') lastCell = position + offset + 2
            })
            const chain = this.editor.chain().focus().setTextSelection(lastCell + 1).command(({ tr }) => {
              tr.setMeta('copyos.docs.page.boundary', true); return true
            })
            if (action === 'row') chain.addRowAfter().run()
            else chain.addColumnAfter().run()
          })
          edges.append(button)
        }
        view.dom.append(edges)
        const stopEvent = view.stopEvent?.bind(view)
        view.stopEvent = event => (event.target instanceof globalThis.Node && edges.contains(event.target)) || (stopEvent?.(event) ?? false)
        return view
      } : null
    },
    renderMarkdown(node, helpers, context) {
      const rows = node.content ?? []
      const simple = rows.length > 0 && rows.every((row, index) => (row.content ?? []).every(cell =>
        cell.type === (index === 0 ? 'tableHeader' : 'tableCell') && Number(cell.attrs?.colspan ?? 1) === 1
        && Number(cell.attrs?.rowspan ?? 1) === 1 && !cell.attrs?.colwidth
        && cell.content?.length === 1 && cell.content[0]?.type === 'paragraph'
        && cell.content[0].content?.every(child => child.type === 'text' && !child.text?.includes('\n')) !== false))
      if (simple && this.parent) return this.parent(node, helpers, context)
      schema ??= getSchema(extensions)
      serializer ??= DOMSerializer.fromSchema(schema)
      const wrapper = document.createElement('div')
      wrapper.appendChild(serializer.serializeNode(schema.nodeFromJSON(node)))
      return wrapper.innerHTML
    },
  }).configure({ resizable: true })
  const extensions: Extensions = [
    StarterKit.configure({ ...(page ? { document: false as const } : {}), undoRedo: false, codeBlock: false, blockquote: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, isAllowedUri: (href, context) => context.defaultValidate(href)
        || readDocsInlineReference(href) !== undefined
        || /^copyos-doc-asset:[a-f0-9]{64}$/u.test(href) } }),
    docsBlockquote(t), docsCodeBlock(t, comments), docsImage(t, resolveAsset), DocsInlineReferences, DocsClipboard, Markdown,
    Placeholder.configure({ placeholder: t('docsPlaceholder') }),
    table, TableRow, TableCell, TableHeader, TaskList, docsTaskItem(t),
  ]
  return extensions
}
