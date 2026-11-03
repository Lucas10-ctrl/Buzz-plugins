/** Rich document editor; the document model merges serialized Markdown into shared text. */
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { docsPeerLabel } from './DocsPresence.tsx'
import type { DocsPresencePeer } from './DocsModel.ts'
import { DocsPageDocument, docsPageSelectionParts, docsPageContext, docsPageExtensions, docsPageSelection,
  type DocsPageActions, type DocsPageContext, type DocsPageMove } from './DocsPageEditor.ts'
import { docsDiff } from './DocsDiff.ts'
import { docsAssetReference, type DocsAssetResolver } from './DocsAssetTypes.ts'
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { docsRichExtensions, type DocsCalloutTone } from './DocsRichExtensions.ts'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { CopyOSDocCommentThread, CopyOSDocAsset } from '../../../copyos-domain/src/types.ts'
import { docsSourceMap, type DocsTextRange, type DocsSourceMap } from './DocsSourceMap.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DocsWorkspace.module.css'
import { DocsSlashMenu } from './DocsSlashMenu.tsx'
import { DocsShortcuts } from './DocsShortcuts.tsx'
import { getMarkRange } from '@tiptap/core'
import { installDocsMarginSelection } from './DocsMarginSelection.ts'
import { DocsInlineReferencePicker, readDocsInlineReference, type DocsInlineReference } from './DocsInlineReference.tsx'

const EMPTY_THREADS: readonly CopyOSDocCommentThread[] = []

type Props = PropsLocale<'copyosFoundation'> & {
  readonly page?: DocsPageActions | undefined
  readonly captureEdit?: ((mutate: () => void) => void) | undefined
  readonly focusAfterSection?: string | undefined
  readonly focusPassage?: { readonly blockId: string; readonly range: DocsTextRange; readonly key: string } | undefined
  readonly diff?: { readonly other: string; readonly kind: 'added' | 'removed' } | undefined
  readonly peers?: readonly DocsPresencePeer[] | undefined
  readonly onCursor?: ((range?: DocsTextRange) => void) | undefined
  readonly content: string
  readonly resolveAsset?: DocsAssetResolver | undefined
  readonly onUploadFiles?: ((files: readonly File[]) => Promise<readonly CopyOSDocAsset[]>) | undefined
  readonly editable?: boolean
  readonly comments?: readonly CopyOSDocCommentThread[]
  readonly activeComment?: string | null
  readonly onComment?: ((quote: string, range: DocsTextRange) => void) | undefined
  readonly onCommentSelect?: ((id: string) => void) | undefined
  readonly onChange: (text: string) => void
  readonly onExit: () => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onAsk?: ((selection: string, range?: DocsTextRange) => void) | undefined
  readonly onFocus: () => void
}

/** Edit document text with rich formatting, Markdown shortcuts, tables and slash insertion. */
export function DocsRichBlock({ page, captureEdit, focusAfterSection, focusPassage, content, diff, peers = [], onCursor,
  resolveAsset, onUploadFiles, editable = true,
  comments = EMPTY_THREADS,
  activeComment, onComment, onCommentSelect,
  onChange, onExit, onUndo, onRedo, onAsk, onFocus, t }: Props): ReactNode {
  const [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState('https://')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [inlineReference, setInlineReference] = useState<DocsInlineReference | null>(null)
  const [inlineReferenceError, setInlineReferenceError] = useState('')
  const referenceTarget = useRef<SelectionBookmark | null>(null)
  const referenceOriginal = useRef('')
  const slashId = useId(), slashA11y = useRef({ count: 0, index: 0 })
  const [recent, setRecent] = useState<readonly string[]>(() => {
    try {
      const raw = localStorage.getItem('copyos.docs.slash.recents')
      if (!raw || raw.length > 4000) return []
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 80).slice(0, 24) : []
    } catch (_error) { return [] /* Unavailable or malformed preferences never prevent editing. */ }
  })
  const [selection, setSelection] = useState(false),
    [query, setQuery] = useState<string | null>(null),
    [index, setIndex] = useState(0)
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [toolbarPosition, setToolbarPosition] = useState({ top: -44, left: 0 })
  const [commentError, setCommentError] = useState('')
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const [tableActive, setTableActive] = useState(false), [quoteActive, setQuoteActive] = useState(false)
  const [focused, setFocused] = useState(false)
  const [contextPosition, setContextPosition] = useState({ top: 0, left: 0 })
  const editorRef = useRef<Editor | null>(null)
  const focusedPassage = useRef<string | undefined>(undefined)
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (cursorTimer.current !== null) clearTimeout(cursorTimer.current) }, [])
  const sourceCache = useRef<{ doc: unknown; source: string; map: DocsSourceMap } | null>(null)
  const diffCache = useRef<{ doc: unknown; other: string; kind: string; decorations: DecorationSet } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const callbacks = { onChange, onExit, onUndo, onRedo, onAsk, onFocus, onComment, onCommentSelect,
    comments, activeComment, content, diff, editable, resolveAsset, onUploadFiles, peers, onCursor, page, captureEdit }
  const current = useRef(callbacks)
  current.current = callbacks
  const pageDocument = useRef(new DocsPageDocument())
  const pageReady = useRef(!page)
  const focusedAfterSection = useRef<string>()
  const pageMaps = useRef(new Map<string, { node: DocsPageContext['node']; source: string; offset: number; map: DocsSourceMap }>())
  const mapFor = (value: Editor, context?: DocsPageContext): DocsSourceMap => {
    if (!context) {
      if (sourceCache.current?.doc !== value.state.doc || sourceCache.current.source !== current.current.content)
        sourceCache.current = { doc: value.state.doc, source: current.current.content, map: docsSourceMap(value, current.current.content) }
      return sourceCache.current.map
    }
    const source = current.current.page?.blocks.find(block => block.id === context.id)?.content
      ?? pageDocument.current.read(value).find(block => block.id === context.id)?.content ?? ''
    const cached = pageMaps.current.get(context.id)
    if (cached?.node === context.node && cached.source === source && cached.offset === context.offset) return cached.map
    const map = docsSourceMap(value, source, context.body, context.offset)
    pageMaps.current.set(context.id, { node: context.node, source, offset: context.offset, map })
    return map
  }
  const selectionSource = (value: Editor, from: number, to: number) => {
    const context = current.current.page ? docsPageSelection(value, from, to) : undefined
    if (current.current.page && !context) return undefined
    return { context, range: mapFor(value, context).sourceRange(from, to) }
  }
  const syncVisibleSelection = (): void => {
    const value = editorRef.current
    if (!value) return
    const selection = value.view.dom.ownerDocument.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !value.view.dom.contains(selection.anchorNode)
      || !value.view.dom.contains(selection.focusNode)) return
    const anchor = value.view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const head = value.view.posAtDOM(selection.focusNode, selection.focusOffset)
    if (anchor === value.state.selection.anchor && head === value.state.selection.head) return
    const currentSelection = TextSelection.between(value.state.doc.resolve(anchor), value.state.doc.resolve(head))
    value.view.dispatch(value.state.tr.setSelection(currentSelection))
  }
  const askSelection = (): void => {
    const value = editorRef.current
    if (!value) return
    const { from, to } = value.state.selection, mapped = selectionSource(value, from, to)
    if (current.current.page) {
      if (!current.current.page.canAsk) return
      if (!mapped?.context) {
        const parts = docsPageSelectionParts(value, current.current.page.blocks, from, to), first = parts[0]
        if (!first) { setCommentError(t('docsSelectBodyText')); return }
        setCommentError('')
        current.current.page.ask(first.blockId, value.state.doc.textBetween(from, to, '\n'), first.range,
          parts.length > 1 ? parts : undefined)
        return
      }
      setCommentError(''); current.current.page.ask(mapped.context.id, value.state.doc.textBetween(from, to, '\n'), mapped.range)
    } else current.current.onAsk?.(value.state.doc.textBetween(from, to, '\n'), mapped?.range)
  }
  const updateSelection = (value: Editor): void => {
    const { from, to, $from } = value.state.selection
    if (current.current.page) {
      let id: string | null = null
      for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'docSection') id = String($from.node(depth).attrs.id)
      current.current.page.activate(id)
    }
    const inTable = value.isActive('table'), inQuote = value.isActive('blockquote')
    setTableActive(inTable); setQuoteActive(inQuote)
    if (inTable || inQuote) {
      const coords = value.view.coordsAtPos(from), bounds = host.current?.getBoundingClientRect()
      if (bounds) setContextPosition({ top: coords.top - bounds.top - 50, left: 0 })
    }
    if (value.isFocused && (current.current.onCursor || current.current.page) && cursorTimer.current === null) {
      cursorTimer.current = setTimeout(() => {
        cursorTimer.current = null
        if (value.isDestroyed || !value.isFocused) return
        const selection = value.state.selection, mapped = selectionSource(value, selection.from, selection.to)
        if (current.current.page) current.current.page.cursor(mapped?.context?.id, mapped?.range)
        else current.current.onCursor?.(mapped?.range)
      }, 50)
    }
    setSelection(from !== to)
    if (from !== to) {
      const coords = value.view.coordsAtPos(from),
        bounds = host.current?.getBoundingClientRect()
      if (bounds)
        setToolbarPosition({
          top: coords.top - bounds.top - 48,
          left: Math.max(0, Math.min(coords.left - bounds.left, bounds.width - 370)),
        })
    }
    const prefix = $from.parent.textBetween(0, $from.parentOffset, '')
    const match = /^\/([^\n]*)$/u.exec(prefix)
    if (match && from === to) {
      setQuery(match[1] ?? '')
      setSlashRange({ from: $from.start(), to: from })
    } else {
      setQuery(null)
      setSlashRange(null)
    }
  }
  useEffect(() => {
    setToolbarVisible(false)
    if (!selection) return
    const timer = setTimeout(() => {
      setToolbarVisible(true)
    }, 150)
    return () => {
      clearTimeout(timer)
    }
  }, [selection])

  const editor = useEditor({
    extensions: [...docsRichExtensions(t, (reference) => {
      const resolver = current.current.resolveAsset
      return resolver ? resolver(reference) : Promise.reject(new Error(t('docsImageUnavailable')))
    }, { available: () => !!(current.current.onComment || current.current.page?.comment), match: (from, to) => {
      const value = editorRef.current
      if (!value) return undefined
      const mapped = selectionSource(value, from, to), range = mapped?.range
      const thread = range && current.current.comments.find(item => !item.detached && !item.resolved && item.range
        && (item.ranges ?? [{ blockId: item.blockId, ...item.range }]).some(part =>
          (!mapped.context || part.blockId === mapped.context.id) && part.from < range.to && part.to > range.from))
      return thread ? { id: thread.id, active: thread.id === current.current.activeComment } : undefined
    }, start: (from, to, quote) => {
      const value = editorRef.current
      if (!value) return
      const mapped = selectionSource(value, from, to)
      if (!mapped?.range) { setCommentError(t('docsCommentSelectionError')); return }
      setCommentError('')
      if (current.current.page && mapped.context) current.current.page.comment?.(mapped.context.id, quote, mapped.range)
      else current.current.onComment?.(quote, mapped.range)
    } }, !!page), ...(page ? docsPageExtensions(() => {
      const value = current.current.page
      if (!value) throw new Error('The page editor no longer has its document callbacks')
      return value
    }) : [])],
    content: page ? { type: 'doc', content: [{ type: 'docSection', attrs: { id: page.blocks[0]?.id, state: 'ready' },
      content: [{ type: 'paragraph' }] }] } : content,
    editable,
    contentType: page ? 'json' : 'markdown',
    // DocsClipboard owns Markdown parsing, including literal Shift-paste.
    enablePasteRules: false,
    autofocus: false,
    onUpdate: ({ editor: value, transaction }) => {
      if (current.current.page) {
        if (pageReady.current) {
          const values = pageDocument.current.read(value)
          current.current.page.update(values, !!transaction.getMeta('copyos.docs.page.boundary')
          || transaction.getMeta('uiEvent') === 'paste' || transaction.getMeta('uiEvent') === 'drop',
          transaction.getMeta('copyos.docs.page.move') as DocsPageMove | undefined)
        }
      }
      else current.current.onChange(value.getMarkdown())
      updateSelection(value)
      setIndex(0)
    },
    onSelectionUpdate: ({ editor: value }) => {
      updateSelection(value)
    },
    onFocus: ({ editor: value }) => {
      setFocused(true); updateSelection(value)
      current.current.onFocus()
    },
    editorProps: {
      attributes: () => ({ class: css.richContent ?? '', spellcheck: 'true', 'aria-label': t(page ? 'docsPageBody' : 'docsParagraph'),
        ...(slashA11y.current.count ? { 'aria-controls': slashId, 'aria-haspopup': 'listbox',
          'aria-autocomplete': 'list', 'aria-activedescendant': `${slashId}-${slashA11y.current.index}` } : {}),
        role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': String(!current.current.editable),
        'data-doc-can-comment': String(!!(current.current.onComment || current.current.page?.comment)) }),
      decorations: (state) => {
        const value = editorRef.current
        if (value && current.current.diff && !current.current.editable && value.markdown) {
          const comparison = current.current.diff
          if (diffCache.current?.doc !== state.doc || diffCache.current.other !== comparison.other ||
            diffCache.current.kind !== comparison.kind)
            diffCache.current = { doc: state.doc, ...comparison,
              decorations: docsDiff(state.doc, value.schema.nodeFromJSON(value.markdown.parse(comparison.other)), comparison.kind) }
          return diffCache.current.decorations
        }
        if (!value || (!current.current.peers.length
          && !current.current.comments.some(thread => !thread.detached && !thread.resolved))) return null
        const decorations = current.current.comments.flatMap((thread) => {
          if (thread.detached || thread.resolved || !thread.range) return []
          const parts = thread.ranges ?? [{ blockId: thread.blockId, ...thread.range }]
          return parts.flatMap((part) => {
            const context = current.current.page ? docsPageContext(value, part.blockId) : undefined
            if (current.current.page && !context) return []
            const range = mapFor(value, context).documentRange(part.from, part.to)
            return range ? [Decoration.inline(range.from, range.to, { class: css.commentHighlight ?? '',
              'data-active': String(thread.id === current.current.activeComment), 'data-doc-comment': thread.id })] : []
          })
        })
        for (const peer of current.current.peers) {
          if (!peer.range) continue
          const context = current.current.page && peer.cursor ? docsPageContext(value, peer.cursor.blockId) : undefined
          if (current.current.page && !context) continue
          const range = mapFor(value, context).documentRange(peer.range.from, peer.range.to)
          if (!range) continue
          const label = docsPeerLabel(peer, t)
          if (range.to > range.from) decorations.push(Decoration.inline(range.from, range.to, { class: css.presenceSelection ?? '' }))
          decorations.push(Decoration.widget(range.to, () => {
            const caret = document.createElement('span')
            caret.className = css.presenceCaret ?? ''; caret.setAttribute('aria-label', label)
            caret.setAttribute('role', 'img'); caret.setAttribute('data-doc-print-exclude', ''); caret.contentEditable = 'false'
            const name = document.createElement('span'); name.textContent = label; name.className = css.presenceCaretLabel ?? ''
            caret.append(name)
            return caret
          }, { key: `peer:${peer.id}:${range.to}:${label}`, side: 1 }))
        }
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
  editorRef.current = editor
  useEffect(() => {
    const map = ({ transaction }: { transaction: Transaction }): void => {
      if (referenceTarget.current) referenceTarget.current = referenceTarget.current.map(transaction.mapping)
    }
    editor.on('transaction', map)
    return () => { editor.off('transaction', map) }
  }, [editor])
  const openInlineReference = (reference: DocsInlineReference, range?: { from: number; to: number }): void => {
    const selection = range ? TextSelection.create(editor.state.doc, range.from, range.to) : editor.state.selection
    referenceTarget.current = selection.getBookmark()
    referenceOriginal.current = editor.state.doc.textBetween(selection.from, selection.to)
    setInlineReference(reference); setInlineReferenceError(''); setQuery(null)
  }
  const closeInlineReference = (): void => {
    const target = referenceTarget.current
    referenceTarget.current = null; setInlineReference(null)
    if (!editor.isDestroyed && target) editor.view.dispatch(editor.state.tr.setSelection(target.resolve(editor.state.doc)))
    if (!editor.isDestroyed) editor.commands.focus()
  }
  const structuralEdit = () => editor.chain().focus().command(({ tr }) => {
    tr.setMeta('copyos.docs.page.boundary', true); return true
  })
  const saveInlineReference = (reference: DocsInlineReference): void => {
    if (!editor.isEditable || !referenceTarget.current) { closeInlineReference(); return }
    const selection = referenceTarget.current.resolve(editor.state.doc)
    if (editor.state.doc.textBetween(selection.from, selection.to) !== referenceOriginal.current) {
      setInlineReferenceError(t('docsReferenceChanged')); return
    }
    const apply = (): void => {
      editor.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, {
        type: 'text', text: reference.kind === 'mention' ? `@${reference.value}` : reference.value,
        marks: [{ type: 'link', attrs: { href: `copyos-doc-${reference.kind}:${encodeURIComponent(reference.value)}` } }],
      }).run()
    }
    referenceTarget.current = null; setInlineReference(null)
    if (current.current.captureEdit) current.current.captureEdit(apply)
    else apply()
  }
  useLayoutEffect(() => {
    if (!page) return
    pageDocument.current.sync(editor, page.blocks, page.assistantEdits); pageReady.current = true
  }, [editor, page?.blocks, page?.assistantEdits])
  useLayoutEffect(() => {
    if (!page || !focusAfterSection || focusedAfterSection.current === focusAfterSection) return
    const index = page.blocks.findIndex(block => block.id === focusAfterSection), next = page.blocks[index + 1]
    if (index < 0 || !next) return
    const context = docsPageContext(editor, next.id)
    if (!context) return
    focusedAfterSection.current = focusAfterSection
    editor.commands.setTextSelection(context.offset + 1)
    editor.commands.focus()
  }, [editor, page?.blocks, focusAfterSection])
  useLayoutEffect(() => {
    if (!page || !focusPassage || focusedPassage.current === focusPassage.key) return
    const context = docsPageContext(editor, focusPassage.blockId), block = page.blocks.find(block => block.id === focusPassage.blockId)
    if (!context || !block) return
    const range = docsSourceMap(editor, block.content, context.body, context.offset)
      .documentRange(focusPassage.range.from, focusPassage.range.to)
    if (!range) return
    focusedPassage.current = focusPassage.key
    editor.chain().setTextSelection(range).focus().scrollIntoView().run()
  }, [editor, page?.blocks, focusPassage])
  useEffect(() => {
    const surface = host.current?.closest<HTMLElement>('[data-doc-selection-surface]')
    if (surface && page?.editable) return installDocsMarginSelection(editor, surface)
  }, [editor, page?.editable])
  useEffect(() => {
    if (editor.isEditable !== editable) editor.setEditable(editable, false)
    editor.view.setProps({})
  }, [editor, editable, comments, activeComment, diff, peers, page?.editable, page?.canAsk, page?.comment, page?.stopped, page?.recovering])
  const startComment = (): void => {
    const { from, to } = editor.state.selection, quote = editor.state.doc.textBetween(from, to, '\n')
    const mapped = selectionSource(editor, from, to), range = mapped?.range
    if (!quote.trim()) { setCommentError(t('docsCommentSelectionError')); return }
    if (!range && current.current.page) {
      const parts = docsPageSelectionParts(editor, current.current.page.blocks, from, to), first = parts[0]
      if (!first) { setCommentError(t('docsSelectBodyText')); return }
      setCommentError('')
      current.current.page.comment?.(first.blockId, quote, first.range, parts)
      return
    }
    if (!range) { setCommentError(t('docsCommentSelectionError')); return }
    setCommentError('')
    if (current.current.page && mapped.context) current.current.page.comment?.(mapped.context.id, quote, range)
    else current.current.onComment?.(quote, range)
  }
  useEffect(() => {
    if (page || editor.getMarkdown() === content) return
    const { from, to } = editor.state.selection
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false })
    const max = editor.state.doc.content.size
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
  }, [editor, content, !!page])
  const upload = async (files: readonly File[], at?: number): Promise<void> => {
    const handler = current.current.onUploadFiles
    if (!handler || !current.current.editable || !files.length) return
    let bookmark: SelectionBookmark = editor.state.selection.getBookmark()
    if (at !== undefined) {
      bookmark = TextSelection.near(editor.state.doc.resolve(at)).getBookmark()
    }
    const map = ({ transaction }: { transaction: Transaction }) => { bookmark = bookmark.map(transaction.mapping) }
    editor.on('transaction', map)
    setUploading(value => value + 1); setCommentError('')
    try {
      const assets = await handler(files)
      if (editor.isDestroyed || !editor.isEditable) return
      const selection = bookmark.resolve(editor.state.doc)
      const nodes = assets.map(asset => asset.image ? { type: 'image', attrs: { src: docsAssetReference(asset), alt: asset.name } }
        : { type: 'paragraph', content: [{ type: 'text', text: asset.name, marks: [{ type: 'link', attrs: { href: docsAssetReference(asset) } }] }] })
      if (!editor.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, nodes).run()) throw new Error(t('docsUploadInsertFailed'))
    } catch (error: unknown) {
      if (!editor.isDestroyed) setCommentError(error instanceof Error ? error.message : t('docsUploadFailed'))
    } finally {
      editor.off('transaction', map)
      if (!editor.isDestroyed) setUploading(value => value - 1)
    }
  }
  const pickFiles = (image: boolean): void => {
    if (!fileInput.current) return
    fileInput.current.accept = image ? 'image/png,image/jpeg,image/webp,image/gif' : ''
    fileInput.current.click()
  }
  const choices: { key: CopyOSFoundationLocaleKey; command?: string; deferred?: boolean; apply: () => void }[] = [
    { key: 'docsDate', command: 'date', deferred: true, apply: () => {
      const now = new Date(), value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      openInlineReference({ kind: 'date', value }, slashRange ?? undefined)
    } },
    { key: 'docsMention', command: 'mention', deferred: true,
      apply: () => { openInlineReference({ kind: 'mention', value: '' }, slashRange ?? undefined) } },
    {
      key: 'docsParagraph',
      apply: () => {
        editor.chain().focus().setParagraph().run()
      },
    },
    {
      key: 'docsHeading',
      apply: () => {
        editor.chain().focus().toggleHeading({ level: 2 }).run()
      },
    },
    {
      key: 'docsBullet',
      apply: () => {
        editor.chain().focus().toggleBulletList().run()
      },
    },
    {
      key: 'docsNumbered',
      apply: () => {
        editor.chain().focus().toggleOrderedList().run()
      },
    },
    {
      key: 'docsChecklist',
      apply: () => {
        editor.chain().focus().toggleTaskList().run()
      },
    },
    {
      key: 'docsQuote',
      apply: () => {
        editor.chain().focus().toggleBlockquote().run()
      },
    },
    {
      key: 'docsCallout',
      apply: () => {
        editor.chain().focus().wrapIn('blockquote', { tone: 'info' }).run()
      },
    },
    {
      key: 'docsCodeBlock',
      apply: () => {
        editor.chain().focus().toggleCodeBlock().run()
      },
    },
    {
      key: 'docsChart',
      apply: () => {
        editor.chain().focus().insertContent([{ type: 'codeBlock', attrs: { language: 'copyos-chart' },
          content: [{ type: 'text', text: JSON.stringify({ version: 1, type: 'bar', title: t('docsChartExampleTitle'),
            xLabel: t('docsChartExampleX'), yLabel: t('docsChartExampleY'), rows: [
              { id: 'week-1', label: t('docsChartExampleFirst'), value: 12 },
              { id: 'week-2', label: t('docsChartExampleSecond'), value: 18 },
            ] }, null, 2) }] }, { type: 'paragraph' }]).run()
      },
    },
    {
      key: 'docsDiagram',
      apply: () => {
        editor.chain().focus().insertContent([{ type: 'codeBlock', attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: t('docsDiagramExample') }] }, { type: 'paragraph' }]).run()
      },
    },
    {
      key: 'docsTable',
      apply: () => {
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },
    {
      key: 'docsDivider',
      apply: () => {
        editor.chain().focus().setHorizontalRule().run()
      },
    },
  ]
  if (onUploadFiles) choices.push({ key: 'docsInsertImage', apply: () => { pickFiles(true) } }, { key: 'docsAttachFile', apply: () => { pickFiles(false) } })
  if (page?.canAsk) {
    const prepare = (instruction: string): void => {
      const currentPage = current.current.page
      if (!currentPage?.canAsk) return
      const context = docsPageSelection(editor, editor.state.selection.from, editor.state.selection.to)
      if (context) currentPage.ask(context.id, '', undefined, undefined, instruction)
    }
    choices.push({ key: 'docsSummarize', command: 'summarize', apply: () => { prepare(t('docsSummarizeRequest')) } },
      { key: 'docsContinueSection', command: 'continue', apply: () => { prepare(t('docsContinueSectionRequest')) } })
  }
  choices.push({ key: 'docsShortcuts', command: 'shortcuts', apply: () => { setShortcutsOpen(true) } })
  const filtered = query === null ? [] : choices.filter(choice =>
    t(choice.key).toLowerCase().includes(query.toLowerCase()) || choice.command?.includes(query.toLowerCase()))
    .sort((left, right) => {
      const a = recent.indexOf(left.key), b = recent.indexOf(right.key)
      return (a < 0 ? recent.length : a) - (b < 0 ? recent.length : b)
    })
  const selectedIndex = index % Math.max(1, filtered.length)
  slashA11y.current = { count: editable && focused ? filtered.length : 0, index: selectedIndex }
  useLayoutEffect(() => { editor.view.setProps({}) }, [editor, query, filtered.length, selectedIndex])
  const choose = (position: number): void => {
    const choice = filtered[position % filtered.length]
    if (!choice) return
    const apply = (): void => {
      if (slashRange && !choice.deferred) editor.commands.deleteRange(slashRange)
      choice.apply()
    }
    if (current.current.captureEdit) current.current.captureEdit(apply)
    else apply()
    const updated = [choice.key, ...recent.filter(key => key !== choice.key)].slice(0, 24)
    setRecent(updated)
    try { localStorage.setItem('copyos.docs.slash.recents', JSON.stringify(updated)) }
    catch (error) { console.warn('Unable to remember recent document commands', error) }
    setQuery(null)
  }
  return (
    <div
      ref={host}
      className={css.editor}
      data-editable={editable}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || shortcutsOpen || inlineReference) return
        if (editable && (event.key === 'Delete' || event.key === 'Backspace')
          && editor.state.selection instanceof TextSelection
          && editor.view.dom.ownerDocument.getSelection()?.isCollapsed === false) syncVisibleSelection()
        if ((event.ctrlKey || event.metaKey) && event.key === '/') {
          event.preventDefault(); event.stopPropagation(); setQuery(null); setShortcutsOpen(true); return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          if (query !== null) { event.stopPropagation(); setQuery(null); return }
          setQuery(null)
          setToolbarVisible(false)
          editor.commands.blur()
          current.current.onExit()
        }
        if (editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) current.current.onRedo()
          else current.current.onUndo()
        }
        if (editable && filtered.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Enter') choose(index)
          else setIndex((index + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length)
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
          syncVisibleSelection()
          event.preventDefault()
          event.stopPropagation()
          askSelection()
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'm' && (onComment || page?.comment)) {
          syncVisibleSelection()
          event.preventDefault(); event.stopPropagation(); startComment()
        }
        if (editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          syncVisibleSelection()
          event.preventDefault()
          setLink(String(editor.getAttributes('link').href ?? 'https://'))
          setLinkOpen(true)
        }
      }}
      onClick={(event) => {
        const referenceLink = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-doc-reference]') : null
        const reference = referenceLink ? readDocsInlineReference(referenceLink.getAttribute('href') ?? '') : undefined
        if (reference && referenceLink) {
          event.preventDefault(); event.stopPropagation()
          const position = editor.view.posAtDOM(referenceLink, 0), type = editor.schema.marks.link
          const range = type ? getMarkRange(editor.state.doc.resolve(position), type, { href: referenceLink.getAttribute('href') }) : undefined
          openInlineReference(reference, range || undefined); return
        }
        const file = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="copyos-doc-asset:"]') : null
        if (file && current.current.resolveAsset) {
          event.preventDefault()
          void current.current.resolveAsset(file.getAttribute('href') ?? '').then((asset) => {
            const link = document.createElement('a'); link.href = asset.url; link.download = asset.name; link.click()
          }).catch(() => { setCommentError(t('docsAssetDownloadFailed')) })
        }
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-doc-comment]') : null
        if (target?.dataset.docComment) current.current.onCommentSelect?.(target.dataset.docComment)
      }}
      onPasteCapture={(event) => {
        if (event.clipboardData.files.length && onUploadFiles && editable) {
          event.preventDefault(); event.stopPropagation(); void upload(Array.from(event.clipboardData.files))
        }
      }}
      onDragOver={(event) => { if (onUploadFiles && editable && event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDropCapture={(event) => {
        if (event.dataTransfer.files.length && onUploadFiles && editable) {
          event.preventDefault(); event.stopPropagation()
          const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void upload(Array.from(event.dataTransfer.files), at)
        }
      }}
      onFocusCapture={() => { setFocused(true) }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
          setQuery(null)
          setSelection(false)
          setToolbarVisible(false)
          current.current.onCursor?.()
          current.current.page?.cursor()
          current.current.onExit()
        }
      }}
    >
      {onUploadFiles ? <input ref={fileInput} type="file" hidden multiple aria-label={t('docsAttachFile')} onChange={(event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files)
      }} /> : null}
      {uploading ? <p className={css.uploadStatus} role="status">{t('docsUploading')}</p> : null}
      {commentError ? <p className={css.sectionError} role="alert">{commentError}</p> : null}
      {toolbarVisible && (editable || onComment || onAsk || page?.comment || page?.canAsk) ? (
        <div
          role="toolbar"
          aria-label={t('docsEdit')}
          className={css.formatbar}
          style={{ ...toolbarPosition, bottom: 'auto' }}
          onMouseDown={(e) => {
            e.preventDefault()
          }}
        >
          {onAsk || page?.canAsk ? <button
            className={css.askSelection}
            aria-label={t('docsAskAssistant')}
            onClick={() => {
              askSelection()
            }}
          >
            ✧ {t('docsAskAssistant')}
          </button> : null}
          {onComment || page?.comment ? <button aria-label={t('docsComment')} onClick={startComment}>{t('docsComment')}</button> : null}
          {editable ? <>
            <button
              aria-label={t('docsBold')}
              aria-pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              B
            </button>
            <button
              aria-label={t('docsItalic')}
              aria-pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              {t('docsItalicMark')}
            </button>
            <button
              aria-label={t('docsStrike')}
              aria-pressed={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              {t('docsStrikeMark')}
            </button>
            <button
              aria-label={t('docsCode')}
              aria-pressed={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              {'{}'}
            </button>
            <button
              aria-label={t('docsHeading')}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              {t('docsHeadingMark')}
            </button>
            <button
              aria-label={t('docsLink')}
              onClick={() => {
                setLink(String(editor.getAttributes('link').href ?? 'https://'))
                setLinkOpen(true)
              }}
            >
              ↗
            </button>
          </> : null}
        </div>
      ) : null}
      {editable && linkOpen ? (
        <form
          className={css.linkEditor}
          onSubmit={(e) => {
            e.preventDefault()
            if (/^(https?:|mailto:)/iu.test(link)) {
              editor.chain().focus().extendMarkRange('link').setLink({ href: link }).run()
              setLinkOpen(false)
            }
          }}
        >
          <input
            type="url"
            autoFocus
            aria-label={t('docsLink')}
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
            }}
          />
          <button type="submit">{t('docsLink')}</button>
          <button
            type="button"
            onClick={() => {
              setLinkOpen(false)
              editor.commands.focus()
            }}
          >
            {t('docsClose')}
          </button>
        </form>
      ) : null}
      {editable && focused && (tableActive || quoteActive) ? <div className={css.contextTools} style={contextPosition} role="toolbar"
        aria-label={t(tableActive ? 'docsTableActions' : 'docsCalloutTone')} onMouseDown={(event) => { if (!(event.target instanceof HTMLSelectElement)) event.preventDefault() }}>
        {tableActive ? <>
          <button onClick={() => { structuralEdit().addRowAfter().run() }}>{t('docsAddRow')}</button>
          <button onClick={() => { structuralEdit().addColumnAfter().run() }}>{t('docsAddColumn')}</button>
          <button onClick={() => { structuralEdit().deleteRow().run() }}>{t('docsDeleteRow')}</button>
          <button onClick={() => { structuralEdit().deleteColumn().run() }}>{t('docsDeleteColumn')}</button>
          <button onClick={() => { structuralEdit().toggleHeaderRow().run() }}>{t('docsHeaderRow')}</button>
          <button disabled={!editor.can().mergeCells()} onClick={() => { structuralEdit().mergeCells().run() }}>{t('docsMergeCells')}</button>
          <button disabled={!editor.can().splitCell()} onClick={() => { structuralEdit().splitCell().run() }}>{t('docsSplitCell')}</button>
        </> : <>
          <select aria-label={t('docsCalloutTone')} value={String(editor.getAttributes('blockquote').tone ?? 'quote')}
            onChange={(event) => { editor.chain().focus().updateAttributes('blockquote', {
              tone: event.target.value === 'quote' ? null : event.target.value as DocsCalloutTone,
            }).run() }}>
            <option value="quote">{t('docsQuote')}</option><option value="info">{t('docsToneInfo')}</option>
            <option value="warning">{t('docsToneWarning')}</option><option value="success">{t('docsToneSuccess')}</option>
            <option value="neutral">{t('docsToneNeutral')}</option>
          </select>
        </>}
      </div> : null}
      <EditorContent editor={editor} />
      {editable && focused && filtered.length ? <DocsSlashMenu id={slashId} label={t('docsSlash')}
        choices={filtered.map(choice => ({ id: choice.key, label: t(choice.key), ...(choice.command ? { command: choice.command } : {}) }))}
        index={selectedIndex} anchor={() => editor.view.coordsAtPos(slashRange?.from ?? editor.state.selection.from)}
        choose={choose} close={() => { setQuery(null) }} /> : null}
      {shortcutsOpen ? <DocsShortcuts t={t} close={() => { setShortcutsOpen(false); editor.commands.focus() }} /> : null}
      {inlineReference ? <DocsInlineReferencePicker reference={inlineReference} editable={editable} t={t}
        error={inlineReferenceError} save={saveInlineReference} close={closeInlineReference} /> : null}
    </div>
  )
}
