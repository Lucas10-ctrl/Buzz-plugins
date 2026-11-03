import { alignDocsBlockGrip } from './DocsBlockAlignment.ts'
/** Body-block actions operate inside the page's single ProseMirror document. */
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { docsPageContext, type DocsPageActions, type DocsPageMove } from './DocsPageEditor.ts'
import { docsSourceMap } from './DocsSourceMap.ts'
import { docsSectionMenu } from './DocsSectionMenu.ts'
import css from './DocsWorkspace.module.css'

type Format = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock'
function paragraphs(editor: Editor, node: ProseMirrorNode): readonly ProseMirrorNode[] | undefined {
  if (node.isTextblock) return [editor.schema.node('paragraph', null, node.content)]
  if (!['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'].includes(node.type.name)) return undefined
  const result: ProseMirrorNode[] = []
  for (const child of node.content.content) {
    const values = paragraphs(editor, child)
    if (!values) return undefined
    result.push(...values)
  }
  return result
}
function converted(editor: Editor, node: ProseMirrorNode, format: Format): readonly ProseMirrorNode[] | undefined {
  const body = paragraphs(editor, node), schema = editor.schema
  if (!body) return undefined
  if (format === 'paragraph') return body
  if (format.startsWith('heading')) return body.map(child => schema.node('heading', { level: Number(format.slice(-1)) }, child.content))
  if (format === 'blockquote') return [schema.node('blockquote', null, body)]
  if (format === 'codeBlock') {
    const text = body.map(child => child.textContent).join('\n')
    return [schema.node('codeBlock', null, text ? schema.text(text) : undefined)]
  }
  const item = format === 'taskList' ? 'taskItem' : 'listItem'
  return [schema.node(format, null, body.map(child => schema.node(item, format === 'taskList' ? { checked: false } : null, child)))]
}

/** Add pointer and keyboard controls to individual paragraphs, lists, tables and other body blocks.
 * @param read - Live page permissions and document-model callbacks.
 * @returns A decoration plugin; controls and menus never enter saved Markdown.
 */
export function docsBodyBlocks(read: () => DocsPageActions): Extension {
  return Extension.create({ name: 'docsBodyBlocks',
    addProseMirrorPlugins() {
      const editor = this.editor, owner = randomUUID(), disposers = new WeakMap<globalThis.Node, () => void>()
      let drag: { position: number; doc: ProseMirrorNode } | undefined
      const orderedBody = (): { position: number; node: ProseMirrorNode; locked: boolean }[] => {
        const blocks: { position: number; node: ProseMirrorNode; locked: boolean }[] = []
        editor.state.doc.forEach((section, sectionPosition) => {
          section.forEach((child, offset) => {
            if (!child.attrs.docSectionLabel) blocks.push({ position: sectionPosition + 1 + offset,
              node: child, locked: section.attrs.state === 'writing' })
          })
        })
        return blocks
      }
      const moveBlock = (position: number, insert: number): void => {
        const node = editor.state.doc.nodeAt(position), source = editor.state.doc.resolve(position)
        const target = editor.state.doc.resolve(insert)
        if (!node || source.depth < 1 || target.depth < 1 || source.node(1).attrs.state === 'writing'
          || target.node(1).attrs.state === 'writing' || !read().editable) return
        const sourceId = String(editor.state.doc.resolve(position).node(1).attrs.id)
        const before = docsPageContext(editor, sourceId), tr = editor.state.tr
        const body = before?.node.content.content.filter(child => !child.attrs.docSectionLabel)
        if (body?.length === 1) tr.replaceWith(position, position + node.nodeSize, editor.schema.node('paragraph'))
        else tr.delete(position, position + node.nodeSize)
        const destination = tr.mapping.map(insert)
        tr.insert(destination, node)
        const targetId = String(tr.doc.resolve(destination).node(1).attrs.id)
        const after = docsPageContext(editor, targetId, tr.doc)
        const original = read().blocks.find(block => block.id === sourceId)
        if (before && after && original && editor.markdown) {
          const beforeMap = docsSourceMap(editor, original.content, before.body, before.offset)
          const afterMap = docsSourceMap(editor, editor.markdown.serialize(after.body.toJSON() as JSONContent), after.body, after.offset)
          const delta = destination - position
          const move: DocsPageMove = { from: sourceId, to: targetId, map: (range) => {
            const mapped = beforeMap.documentRange(range.from, range.to)
            return mapped && mapped.from >= position + 1 && mapped.to <= position + node.nodeSize - 1
              ? afterMap.sourceRange(mapped.from + delta, mapped.to + delta) : undefined
          } }
          tr.setMeta('copyos.docs.page.move', move)
        }
        tr.setSelection(TextSelection.near(tr.doc.resolve(destination + 1)))
        editor.view.dispatch(tr.setMeta('copyos.docs.page.boundary', true).scrollIntoView()); editor.view.focus()
      }
      return [new Plugin({ props: {
        decorations(state) {
          const actions = read(), decorations: Decoration[] = []
          if (!actions.editable && !actions.comment) return null
          state.doc.forEach((section, sectionPosition) => {
            if (section.attrs.state === 'writing') return
            const id = String(section.attrs.id)
            section.forEach((node, offset, index) => {
              if (node.attrs.docSectionLabel) return
              const position = sectionPosition + 1 + offset
              decorations.push(Decoration.node(position, position + node.nodeSize, {
                'data-active-body': String(state.selection.from >= position && state.selection.from < position + node.nodeSize),
              }))
              decorations.push(Decoration.widget(position, (_view, getPos) => {
                const details = document.createElement('details'), summary = document.createElement('summary'), menu = document.createElement('div')
                details.className = css.bodyBlockHandle ?? ''; details.contentEditable = 'false'; details.setAttribute('data-doc-print-exclude', '')
                summary.setAttribute('aria-label', read().t('docsBodyBlockMenu'))
                summary.title = read().t('docsBodyBlockMenu'); summary.draggable = read().editable
                const grip = document.createElement('span'); grip.className = css.blockGrip ?? ''; grip.setAttribute('aria-hidden', 'true')
                summary.append(grip); details.append(summary)
                menu.className = css.sectionMenu ?? ''; menu.id = `docs-body-actions-${randomUUID()}`
                menu.setAttribute('aria-label', read().t('docsBodyBlockMenu'))
                let disposed = false
                const target = () => {
                  const at = getPos(), context = docsPageContext(editor, id)
                  const current = at === undefined ? undefined : editor.state.doc.nodeAt(at)
                  return at !== undefined && context && current && at >= context.offset
                    && at + current.nodeSize <= context.position + context.node.nodeSize - 1 ? { at, node: current, context } : undefined
                }
                const passage = () => {
                  const current = target(), source = read().blocks.find(block => block.id === id)
                  if (!current || !source) return undefined
                  const range = docsSourceMap(editor, source.content, current.context.body, current.context.offset)
                    .sourceRange(current.at + 1, current.at + current.node.nodeSize - 1)
                  return range ? { ...current, range } : undefined
                }
                const apply = (operation: 'duplicate' | 'delete' | Format): void => {
                  const current = target()
                  if (!current || !read().editable) return
                  const tr = editor.state.tr, end = current.at + current.node.nodeSize
                  if (operation === 'duplicate') tr.insert(end, current.node)
                  else if (operation === 'delete') {
                    const body = current.context.node.content.content.filter(child => !child.attrs.docSectionLabel)
                    if (body.length === 1) tr.replaceWith(current.at, end, editor.schema.node('paragraph'))
                    else tr.delete(current.at, end)
                  } else {
                    const nodes = converted(editor, current.node, operation)
                    if (!nodes) return
                    tr.replaceWith(current.at, end, Fragment.fromArray([...nodes]))
                  }
                  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, current.at + 1))))
                  editor.view.dispatch(tr.setMeta('copyos.docs.page.boundary', true).scrollIntoView())
                  editor.commands.focus()
                }
                const button = (key: Parameters<DocsPageActions['t']>[0], run: () => void, close = true): HTMLButtonElement => {
                  const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.tabIndex = -1
                  item.textContent = read().t(key); item.addEventListener('click', () => { if (close) details.open = false; run() })
                  menu.append(item); return item
                }
                const main = (): void => {
                  menu.replaceChildren()
                  if (read().editable) {
                    const turn = button('docsTurnInto', () => {
                      menu.replaceChildren()
                      button('docsBackToActions', main, false)
                      const formats = [['paragraph', 'docsParagraph'], ['heading1', 'docsHeadingOne'], ['heading2', 'docsHeadingTwo'],
                        ['heading3', 'docsHeadingThree'], ['bulletList', 'docsBullet'], ['orderedList', 'docsNumbered'],
                        ['taskList', 'docsChecklist'], ['blockquote', 'docsQuote'], ['codeBlock', 'docsCodeBlock']] as const
                      for (const [format, label] of formats) button(label, () => { apply(format) })
                      details.dispatchEvent(new Event('toggle')); menu.querySelector('button')?.focus()
                    }, false)
                    turn.disabled = !paragraphs(editor, target()?.node ?? node)
                    button('docsDuplicateBlock', () => { apply('duplicate') })
                    const current = target(), blocks = orderedBody()
                    const index = blocks.findIndex(block => block.position === current?.at)
                    for (const [delta, label] of [[-1, 'docsUp'], [1, 'docsDown']] as const) {
                      const neighbor = blocks[index + delta]
                      const item = button(label, () => {
                        const active = target(), currentBlocks = orderedBody()
                        const destination = currentBlocks[currentBlocks.findIndex(block => block.position === active?.at) + delta]
                        if (active && destination && !destination.locked)
                          moveBlock(active.at, destination.position + (delta > 0 ? destination.node.nodeSize : 0))
                      })
                      item.disabled = !neighbor || neighbor.locked
                    }
                  }
                  if (read().copyLink) {
                    const copy = button('docsCopyBlockLink', () => {
                      const current = passage(), handler = read().copyLink
                      if (!current || !handler) return
                      copy.disabled = true
                      void handler(id, current.range).then(() => {
                        if (!disposed) { copy.textContent = read().t('docsCopied'); copy.disabled = false }
                      }).catch(() => {
                        if (!disposed) { copy.textContent = read().t('docsCopyLinkFailed'); copy.disabled = false }
                      })
                    }, false)
                    copy.setAttribute('aria-live', 'polite')
                    copy.disabled = !passage()
                  }
                  if (read().canAsk) button('docsAskAssistant', () => {
                    const current = passage()
                    if (current && read().canAsk) read().ask(id, current.node.textContent, current.range)
                  })
                  if (read().comment) {
                    const comment = button('docsComment', () => {
                      const current = passage()
                      if (current) read().comment?.(id, current.node.textContent, current.range)
                    })
                    comment.disabled = !passage()
                  }
                  if (read().editable) button('docsDeleteBlock', () => { apply('delete') }).dataset.delete = 'true'
                  details.dispatchEvent(new Event('toggle'))
                }
                summary.addEventListener('click', () => { if (!details.open) main() })
                summary.addEventListener('keydown', (event) => {
                  if (!details.open && ['Enter', ' ', 'ArrowDown'].includes(event.key)) main()
                })
                const dispose = docsSectionMenu(details, summary, menu)
                summary.addEventListener('dragstart', (event) => {
                  const current = target()
                  if (!read().editable || !current || !event.dataTransfer) { event.preventDefault(); return }
                  drag = { position: current.at, doc: editor.state.doc }
                  event.dataTransfer.setData('application/x-copyos-doc-body-block', owner); event.dataTransfer.effectAllowed = 'move'
                })
                summary.addEventListener('dragend', () => { drag = undefined })
                const stopAlignment = alignDocsBlockGrip(details, summary)
                disposers.set(details, () => { disposed = true; stopAlignment(); dispose() })
                return details
              }, { key: `body:${id}:${index}:${node.type.name}:${actions.editable}:${Boolean(actions.comment)}:${actions.canAsk}`,
                side: -1, ignoreSelection: true, stopEvent: () => true,
                destroy: (dom) => { disposers.get(dom)?.(); disposers.delete(dom) } }))
            })
          })
          return DecorationSet.create(state.doc, decorations)
        },
        handleDrop(view, event) {
          if (!read().editable || !drag || event.dataTransfer?.getData('application/x-copyos-doc-body-block') !== owner) return false
          event.preventDefault()
          const source = drag; drag = undefined
          if (source.doc !== view.state.doc) return true
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!hit) return true
          const resolved = view.state.doc.resolve(hit.pos)
          if (resolved.depth < 2) return true
          const at = resolved.before(2), target = view.state.doc.nodeAt(at), node = view.state.doc.nodeAt(source.position)
          if (!target || !node || target.attrs.docSectionLabel || resolved.node(1).attrs.state === 'writing' || at === source.position) return true
          const element = view.nodeDOM(at), box = element instanceof Element ? element.getBoundingClientRect() : undefined
          const insert = at + (box && event.clientY > box.top + box.height / 2 ? target.nodeSize : 0)
          moveBlock(source.position, insert)
          return true
        },
      } })]
    },
  })
}
