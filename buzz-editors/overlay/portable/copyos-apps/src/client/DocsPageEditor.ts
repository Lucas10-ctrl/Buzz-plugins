/** One ProseMirror document retains section identities inside a continuous editing surface. */
import { Extension, Node, type Editor, type Extensions, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { docsSectionMenu } from './DocsSectionMenu.ts'
import { docsBodyBlocks } from './DocsBodyBlocks.ts'
import { canJoin } from '@tiptap/pm/transform'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CopyOSDocBlock } from '../../../copyos-domain/src/types.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { docsSourceMap, type DocsTextRange } from './DocsSourceMap.ts'
import css from './DocsWorkspace.module.css'

/** Editable source associated with one stable section. */
export interface DocsPageValue { readonly id: string; readonly label: string; readonly content: string }
/** One body's exact source range inside a page-wide selection. */
export interface DocsPageSelectionPart { readonly blockId: string; readonly range: DocsTextRange }
/** Translate exact source ranges belonging to one moved body block. */
export interface DocsPageMove {
  readonly from: string
  readonly to: string
  readonly map: (range: DocsTextRange) => DocsTextRange | undefined
}
/** Live callbacks of one page editor; the owner retains the document model. */
export interface DocsPageActions {
  readonly blocks: readonly CopyOSDocBlock[]
  readonly assistantEdits?: Readonly<Record<string, number>> | undefined
  readonly editable: boolean
  readonly canAsk: boolean
  readonly stopped: boolean
  readonly recovering: boolean
  readonly t: PropsLocale<'copyosFoundation'>['t']
  readonly update: (values: readonly DocsPageValue[], boundary?: boolean, move?: DocsPageMove) => void
  readonly activate: (id: string | null) => void
  readonly cursor: (id?: string, range?: DocsTextRange) => void
  readonly ask: (id: string, quote?: string, range?: DocsTextRange, parts?: readonly DocsPageSelectionPart[], instruction?: string) => void
  readonly comment?: ((id: string, quote?: string, range?: DocsTextRange, parts?: readonly DocsPageSelectionPart[]) => void) | undefined
  readonly selectComment: (id: string) => void
  readonly move: (id: string, direction: number) => void
  readonly add: (after?: string, content?: string) => void
  readonly resume: (id: string) => void
  readonly copyLink?: ((id: string, range: DocsTextRange) => Promise<void>) | undefined
}
/** A section's body as a temporary document, with its position in the page. */
export interface DocsPageContext {
  readonly id: string
  readonly node: ProseMirrorNode
  readonly position: number
  readonly body: ProseMirrorNode
  readonly offset: number
}
function markdown(editor: Editor) {
  const manager = editor.markdown
  if (!manager) throw new Error('Page editor requires the Markdown extension')
  return manager
}
const EXTERNAL = 'copyos.docs.page.external'
function headingLabel(node: ProseMirrorNode | null): boolean {
  return !!node && node.type.name === 'heading' && node.attrs.docSectionLabel === true && node.textContent.length <= 200
    && Array.from({ length: node.childCount }, (_, index) => node.child(index)).every(child => child.isText && child.marks.length === 0)
}
/** Locate section body coordinates without changing the live selection.
 * @param editor - Page editor.
 * @param id - Stable section identity.
 * @param doc - Optional pre-transaction document used for anchor transfers.
 * @returns The section's body and its page offset, or undefined after removal.
 */
export function docsPageContext(editor: Editor, id: string, doc = editor.state.doc): DocsPageContext | undefined {
  let result: DocsPageContext | undefined
  doc.forEach((node, position) => {
    if (node.type.name !== 'docSection' || node.attrs.id !== id) return
    const title = headingLabel(node.firstChild), children = node.content.content.slice(title ? 1 : 0)
    result = { id, node, position, body: editor.schema.topNodeType.create(null, children),
      offset: position + 1 + (title ? (node.firstChild?.nodeSize ?? 0) : 0) }
  })
  return result
}
/** Locate the section containing one complete body selection.
 * @param editor - Page editor.
 * @param from - Selection start.
 * @param to - Selection end.
 * @returns Its section, or undefined for a heading or a selection spanning sections.
 */
export function docsPageSelection(editor: Editor, from: number, to: number): DocsPageContext | undefined {
  const resolved = editor.state.doc.resolve(from)
  for (let depth = resolved.depth; depth > 0; depth--) {
    const section = resolved.node(depth)
    if (section.type.name !== 'docSection') continue
    const context = docsPageContext(editor, String(section.attrs.id))
    return context && from >= context.offset + 1 && to <= context.position + section.nodeSize - 1 ? context : undefined
  }
  return undefined
}
/** Map selected body text across section boundaries without widening the source scope.
 * @param editor - Continuous page editor.
 * @param blocks - Current stored section sources.
 * @param from - Selection start in the page.
 * @param to - Selection end in the page.
 * @returns Ordered nonempty source ranges; section metadata headings are excluded.
 */
export function docsPageSelectionParts(editor: Editor, blocks: readonly CopyOSDocBlock[], from: number, to: number):
readonly DocsPageSelectionPart[] {
  const result: DocsPageSelectionPart[] = []
  editor.state.doc.forEach((node) => {
    const id = String(node.attrs.id), context = docsPageContext(editor, id), source = blocks.find(block => block.id === id)
    if (!context || !source) return
    const start = Math.max(from, context.offset + 1), end = Math.min(to, context.position + node.nodeSize - 1)
    if (end <= start) return
    const range = docsSourceMap(editor, source.content, context.body, context.offset).sourceRange(start, end)
    if (range && range.to > range.from) result.push({ blockId: id, range })
  })
  return result
}
function valueOf(editor: Editor, node: ProseMirrorNode): DocsPageValue {
  const title = headingLabel(node.firstChild), children = node.content.content.slice(title ? 1 : 0)
  return { id: String(node.attrs.id), label: title ? (node.firstChild?.textContent ?? '') : '',
    content: markdown(editor).serialize({ type: 'doc', content: children.map(child => child.toJSON() as JSONContent) }) }
}
function sectionNode(editor: Editor, block: CopyOSDocBlock, assistantEdit = 0): ProseMirrorNode {
  const children: JSONContent[] = []
  if (block.label) children.push({ type: 'heading', attrs: { level: 2, docSectionLabel: true }, content: [{ type: 'text', text: block.label }] })
  children.push(...(markdown(editor).parse(block.content).content ?? []))
  if (!children.length) children.push({ type: 'paragraph' })
  return editor.schema.nodeFromJSON({ type: 'docSection', attrs: { id: block.id, state: block.state, assistantEdit }, content: children })
}

/** Cache exact stored Markdown for untouched sections while updating only changed section nodes. */
export class DocsPageDocument {
  private values = new Map<string, { node: ProseMirrorNode; value: DocsPageValue }>()
  /** Read the current section sources, preserving untouched serialization.
   * @param editor - Page editor.
   * @returns Current sections in document order.
   */
  read(editor: Editor): readonly DocsPageValue[] {
    const result: DocsPageValue[] = []
    editor.state.doc.forEach((node) => {
      const id = String(node.attrs.id), previous = this.values.get(id)
      const value = previous?.node.content.eq(node.content) ? previous.value : valueOf(editor, node)
      result.push(value); this.values.set(id, { node, value })
    })
    return result
  }
  /** Apply server/model changes without resetting unaffected section selections.
   * @param editor - Page editor.
   * @param blocks - Authoritative sections for the current tab.
   * @param assistantEdits - Newly observed, history-attributed assistant revisions by section.
   */
  sync(editor: Editor, blocks: readonly CopyOSDocBlock[], assistantEdits: Readonly<Record<string, number>> = {}): void {
    const current = this.read(editor), doc = editor.state.doc, tr = editor.state.tr
    const sameOrder = current.length === blocks.length && current.every((value, index) => value.id === blocks[index]?.id)
    if (sameOrder) {
      const positions: number[] = []; doc.forEach((_node, position) => { positions.push(position) })
      for (let index = blocks.length - 1; index >= 0; index--) {
        const block = blocks[index], value = current[index], node = doc.child(index), position = positions[index]
        if (!block || !value || position === undefined) throw new Error('Page section index is missing')
        if (value.label !== block.label || value.content !== block.content) {
          tr.replaceWith(position, position + node.nodeSize, sectionNode(editor, block, assistantEdits[block.id]))
        }
        else if (node.attrs.state !== block.state || node.attrs.assistantEdit !== (assistantEdits[block.id] ?? 0))
          tr.setNodeMarkup(position, undefined, { ...node.attrs, state: block.state, assistantEdit: assistantEdits[block.id] ?? 0 })
      }
    } else {
      const selection = editor.state.selection
      const anchor = docsPageSelection(editor, selection.anchor, selection.anchor)
      const head = docsPageSelection(editor, selection.head, selection.head)
      const nodes = blocks.map(block => sectionNode(editor, block, assistantEdits[block.id]))
      if (!nodes.length) nodes.push(editor.schema.node('docSection', { id: randomUUID(), state: 'ready' }, editor.schema.node('paragraph')))
      tr.replaceWith(0, doc.content.size, Fragment.fromArray(nodes))
      const restore = (context: DocsPageContext | undefined, old: number): number => {
        let position = 1
        tr.doc.forEach((node, offset) => {
          if (context && node.attrs.id === context.id) {
            position = offset + Math.max(1, Math.min(node.nodeSize - 1, old - context.position))
          }
        })
        return Math.min(tr.doc.content.size, position)
      }
      tr.setSelection(TextSelection.between(
        tr.doc.resolve(restore(anchor, selection.anchor)), tr.doc.resolve(restore(head, selection.head)),
      ))
    }
    if (tr.docChanged) editor.view.dispatch(tr.setMeta(EXTERNAL, true).setMeta('preventUpdate', true))
    const byId = new Map(blocks.map(block => [block.id, block]))
    this.values.clear()
    editor.state.doc.forEach((node) => {
      const id = String(node.attrs.id), original = byId.get(id)
      this.values.set(id, { node, value: original ? { id, label: original.label, content: original.content } : valueOf(editor, node) })
    })
  }
}

function joinBoundary(editor: Editor): boolean {
  if (!editor.isEditable || !editor.state.selection.empty) return false
  const { $from } = editor.state.selection
  if ($from.parentOffset !== 0 || $from.depth !== 2 || $from.index(1) !== 0) return false
  const section = $from.node(1), position = $from.before(1), previous = editor.state.doc.childBefore(position)
  if (section.type.name !== 'docSection' || !previous.node || section.attrs.state === 'writing' || previous.node.attrs.state === 'writing') return false
  const tr = editor.state.tr
  if (section.childCount === 1 && section.firstChild?.type.name === 'paragraph' && section.firstChild.content.size === 0) {
    tr.delete(position, position + section.nodeSize)
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(1, position - 1)), -1))
  } else {
    if (!canJoin(tr.doc, position)) return false
    tr.join(position)
    if (canJoin(tr.doc, position - 1)) tr.join(position - 1)
  }
  editor.view.dispatch(tr.setMeta('copyos.docs.page.boundary', true).scrollIntoView())
  return true
}
/** Build the continuous page schema, section controls and section-level writing locks.
 * @param read - Current page callbacks and permission state.
 * @returns Root, section and metadata extensions for a single editor.
 */
export function docsPageExtensions(read: () => DocsPageActions): Extensions {
  const root = Node.create({ name: 'doc', topNode: true, content: 'docSection+',
    renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n') },
  })
  const section = Node.create({ name: 'docSection', priority: 1200, content: 'block+', defining: true,
    addAttributes() { return { id: { default: null }, state: { default: 'ready' }, assistantEdit: { default: 0, rendered: false } } },
    parseHTML() { return [{ tag: 'section[data-doc-section]', getAttrs: () => ({ id: randomUUID(), state: 'ready' }) }] },
    renderHTML({ node }) { return ['section', { 'data-doc-section': String(node.attrs.id) }, 0] },
    renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n') },
    addKeyboardShortcuts() { return { Backspace: () => joinBoundary(this.editor) } },
    addNodeView() {
      return ({ node: initial }) => {
        let node = initial
        let attributionTimer: ReturnType<typeof setTimeout> | undefined
        const dom = document.createElement('section'), contentDOM = document.createElement('div')
        const clearAttribution = (): void => {
          if (attributionTimer !== undefined) clearTimeout(attributionTimer)
          attributionTimer = undefined
          delete dom.dataset.assistantRecent
          dom.removeAttribute('title')
        }
        dom.className = css.block ?? ''
        contentDOM.className = css.pageSectionContent ?? ''
        contentDOM.setAttribute('data-doc-section-content', '')
        const details = document.createElement('details'), summary = document.createElement('summary'), menu = document.createElement('div')
        details.className = css.blockHandle ?? ''; details.contentEditable = 'false'; details.setAttribute('data-doc-print-exclude', ''); summary.draggable = true
        summary.setAttribute('aria-label', read().t('docsBlockMenu')); summary.title = read().t('docsBlockMenu')
        const grip = document.createElement('span'); grip.className = css.blockGrip ?? ''; grip.setAttribute('aria-hidden', 'true'); summary.append(grip)
        menu.className = css.sectionMenu ?? ''; menu.id = `docs-section-actions-${randomUUID()}`
        menu.setAttribute('aria-label', read().t('docsBlockMenu'))
        const action = (label: Parameters<DocsPageActions['t']>[0], callback: () => void): HTMLButtonElement => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = read().t(label)
          button.setAttribute('role', 'menuitem'); button.tabIndex = -1
          if (label === 'docsDelete') button.dataset.delete = 'true'
          button.addEventListener('click', () => { if (!read().editable || node.attrs.state === 'writing') return; details.open = false; callback() })
          menu.append(button)
          return button
        }
        const askButton = action('docsAskAssistant', () => { if (read().canAsk) read().ask(String(node.attrs.id)) })
        const commentButton = action('docsComment', () => { read().comment?.(String(node.attrs.id)) })
        action('docsUp', () => { read().move(String(node.attrs.id), -1) }); action('docsDown', () => { read().move(String(node.attrs.id), 1) })
        action('docsDuplicate', () => { const value = read().blocks.find(block => block.id === node.attrs.id); read().add(String(node.attrs.id), value?.content) })
        action('docsDelete', () => {
          const context = docsPageContext(this.editor, String(node.attrs.id))
          if (context) {
            const position = context.position > 0 ? context.position - 1 : context.position + node.nodeSize
            this.editor.commands.setTextSelection(TextSelection.near(this.editor.state.doc.resolve(
              Math.min(this.editor.state.doc.content.size, position)), context.position > 0 ? -1 : 1).from)
          }
          read().move(String(node.attrs.id), 0)
          this.editor.commands.focus()
        })
        summary.addEventListener('dragstart', (event) => { event.dataTransfer?.setData('application/x-copyos-doc-block', String(node.attrs.id)) })
        dom.addEventListener('dragover', (event) => { if (read().editable && event.dataTransfer?.types.includes('application/x-copyos-doc-block')) event.preventDefault() })
        dom.addEventListener('drop', (event) => {
          if (!read().editable || !event.dataTransfer?.types.includes('application/x-copyos-doc-block')) return
          event.preventDefault()
          const blocks = read().blocks, source = blocks.findIndex(block => block.id === event.dataTransfer?.getData('application/x-copyos-doc-block'))
          const target = blocks.findIndex(block => block.id === node.attrs.id)
          const sourceBlock = blocks[source]
          if (sourceBlock && target >= 0 && source !== target) read().move(sourceBlock.id, target - source)
        })
        const status = document.createElement('div'), statusText = document.createElement('span'), retry = document.createElement('button')
        status.contentEditable = 'false'; status.className = css.pageSectionStatus ?? ''; status.setAttribute('data-doc-print-exclude', '')
        retry.type = 'button'; retry.textContent = read().t('docsRetry')
        retry.addEventListener('click', () => {
          if (read().editable && read().canAsk && !read().recovering) read().resume(String(node.attrs.id))
        })
        status.append(statusText, retry)
        details.append(summary); dom.append(details, status, contentDOM)
        const disposeMenu = docsSectionMenu(details, summary, menu)
        const update = (next: ProseMirrorNode): boolean => {
          if (next.type !== node.type || next.attrs.id !== node.attrs.id) return false
          const finishedWriting = (node.attrs.state === 'writing' || node.attrs.state === 'pending')
            && next.attrs.state !== 'writing' && next.attrs.state !== 'pending' && next.textContent.length > 0
          if (next.attrs.state === 'writing' || !next.content.eq(node.content)) clearAttribution()
          const attributedEdit = next.attrs.assistantEdit > 0 && next.attrs.assistantEdit !== node.attrs.assistantEdit
            && next.textContent.length > 0
          if (node.attrs.assistantEdit > 0 && !next.attrs.assistantEdit) clearAttribution()
          if (finishedWriting || attributedEdit) {
            clearAttribution()
            dom.dataset.assistantRecent = 'true'
            dom.title = read().t('docsAssistantUpdated')
            attributionTimer = setTimeout(clearAttribution, 10_000)
          }
          node = next; const locked = node.attrs.state === 'writing'
          if (locked) dom.title = read().t('docsWritingSection')
          dom.id = `doc-block-${String(node.attrs.id)}`
          dom.dataset.docSection = String(node.attrs.id)
          dom.dataset.docLabel = String(headingLabel(node.firstChild))
          dom.dataset.writing = String(locked)
          dom.dataset.state = String(node.attrs.state)
          details.hidden = !read().editable || locked
          askButton.hidden = askButton.disabled = !read().canAsk
          commentButton.hidden = commentButton.disabled = !read().comment
          if (details.hidden) details.open = false
          status.hidden = !['pending', 'failed', 'paused'].includes(String(node.attrs.state))
          statusText.textContent = read().t(node.attrs.state === 'pending' ? 'docsPending'
            : node.attrs.state === 'paused' ? 'docsPaused' : 'docsFailed')
          const failed = node.attrs.state === 'failed'
          retry.textContent = read().t(failed ? 'docsRetry' : 'docsContinue')
          retry.setAttribute('aria-label', read().t(failed ? 'docsRetrySection' : 'docsResumeSection', {
            section: (headingLabel(node.firstChild) ? node.firstChild?.textContent : undefined) || read().t('docsCurrentSection'),
          }))
          retry.disabled = read().recovering
          retry.hidden = !read().editable || !read().canAsk || (node.attrs.state === 'pending' && !read().stopped)
          if (locked) contentDOM.contentEditable = 'false'; else contentDOM.removeAttribute('contenteditable')
          return true
        }
        update(node)
        return { dom, contentDOM, update, destroy: () => { clearAttribution(); disposeMenu() },
          ignoreMutation: mutation => mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
          stopEvent: event => details.contains(event.target as globalThis.Node) || status.contains(event.target as globalThis.Node),
        }
      }
    },
  })
  const metadata = Extension.create({ name: 'docsPageMetadata', priority: 1000,
    addGlobalAttributes() { return [{ types: ['heading'], attributes: { docSectionLabel: { default: false, rendered: false } } }] },
    addProseMirrorPlugins() {
      return [new Plugin({
        props: { decorations(state) {
          const actions = read(), decorations: Decoration[] = []
          const resolved = state.selection.$from
          let active: ProseMirrorNode | undefined
          for (let depth = resolved.depth; depth > 0; depth--) {
            const node = resolved.node(depth)
            if (node.type.name === 'docSection') { active = node; break }
          }
          state.doc.forEach((node, position) => {
            decorations.push(Decoration.node(position, position + node.nodeSize, {
              'data-doc-permissions': `${actions.editable}:${actions.canAsk}:${Boolean(actions.comment)}:${actions.stopped}:${actions.recovering}`,
              ...(actions.editable && node === active ? { 'data-active-section': 'true' } : {}),
            }))
          })
          return DecorationSet.create(state.doc, decorations)
        } },
        filterTransaction(tr, state) {
          if (!tr.docChanged || tr.getMeta(EXTERNAL)) return true
          if (!read().editable) return false
          const locked = new Map<string, ProseMirrorNode>()
          state.doc.forEach((node) => { if (node.attrs.state === 'writing') locked.set(String(node.attrs.id), node) })
          tr.doc.forEach((node) => { if (locked.get(String(node.attrs.id))?.eq(node)) locked.delete(String(node.attrs.id)) })
          return locked.size === 0
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some(tr => tr.docChanged)) return null
          const ids = new Set<string>(), tr = state.tr
          state.doc.forEach((node, position) => {
            const id = typeof node.attrs.id === 'string' ? node.attrs.id : ''
            if (!id || ids.has(id)) tr.setNodeMarkup(position, undefined, { ...node.attrs, id: randomUUID() })
            ids.add(String(tr.doc.nodeAt(position)?.attrs.id))
          })
          return tr.docChanged ? tr.setMeta(EXTERNAL, transactions.some(item => item.getMeta(EXTERNAL))) : null
        },
      })]
    },
  })
  return [root, section, metadata, docsBodyBlocks(read)]
}
