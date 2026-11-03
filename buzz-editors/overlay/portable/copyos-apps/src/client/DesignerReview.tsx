/** Canvas review: comment placement and pins, Mark regions sent to chat with a picture, and the comments panel. */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type CSSProperties } from 'react'
import type { CopyOSDesignComment, CopyOSDesignCommentTarget, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import { useEditorChrome } from '../EditorChrome.tsx'
import type { DesignerReviewMode } from './DesignerHeaderTools.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string
/** Scene rectangle in CSS pixels. */
export interface DesignerSceneBox { x: number; y: number; width: number; height: number }
/** Canvas pan and zoom: screen = scene × zoom + offset, relative to the canvas container. */
export interface DesignerReviewView { x: number; y: number; zoom: number }

/**
 * A stored layer's scene box from its parent-relative geometry; rotation is ignored, so rotated layers report their unrotated box.
 * @param byId - Laid-out layers by id.
 * @param id - Layer to place.
 * @returns Scene box, or undefined for a missing layer.
 */
export function designerSceneBox(byId: ReadonlyMap<string, CopyOSDesignNode>, id: string): DesignerSceneBox | undefined {
  const node = byId.get(id)
  if (!node) return undefined
  let x = node.x, y = node.y, parent = node.parentId === null ? undefined : byId.get(node.parentId)
  for (let depth = 0; parent && depth < 256; depth++) {
    x += parent.x; y += parent.y
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
  }
  return { x, y, width: node.width, height: node.height }
}

/**
 * Scene point a comment pin marks.
 * @param byId - Laid-out layers by id.
 * @param target - Stored comment target.
 * @returns Scene point, or undefined when its layer no longer exists.
 */
export function designerCommentPoint(byId: ReadonlyMap<string, CopyOSDesignNode>, target: CopyOSDesignCommentTarget):
{ x: number; y: number } | undefined {
  if (target.kind === 'point') return { x: target.x, y: target.y }
  const box = designerSceneBox(byId, target.nodeId)
  return box ? { x: box.x + target.x, y: box.y + target.y } : undefined
}

/**
 * Layers a Mark region covers: the deepest visible layers that intersect it, so a region over one card names that card's parts,
 * not the whole page.
 * @param byId - Laid-out layers by id.
 * @param childrenById - Laid-out children by parent id.
 * @param roots - Top-level layers of the active page.
 * @param region - Marked scene region.
 * @param limit - Most layers to return.
 * @returns Layers in paint order, at most `limit`.
 */
export function designerLayersInRegion(byId: ReadonlyMap<string, CopyOSDesignNode>,
  childrenById: ReadonlyMap<string | null, readonly CopyOSDesignNode[]>, roots: readonly CopyOSDesignNode[], region: DesignerSceneBox,
  limit = 30): CopyOSDesignNode[] {
  const found: CopyOSDesignNode[] = []
  const meets = (box: DesignerSceneBox): boolean => box.x < region.x + region.width && box.x + box.width > region.x &&
    box.y < region.y + region.height && box.y + box.height > region.y
  const visit = (node: CopyOSDesignNode, depth: number): void => {
    if (!node.visible || found.length >= limit || depth > 64) return
    const box = designerSceneBox(byId, node.id)
    if (!box || !meets(box)) return
    const inside = (childrenById.get(node.id) ?? []).filter(child => child.visible)
    // A layer whose children cover the region is named through them; a leaf, or a layer the region fully contains, is named itself.
    const contained = box.x >= region.x && box.y >= region.y && box.x + box.width <= region.x + region.width &&
      box.y + box.height <= region.y + region.height
    if (contained || inside.length === 0) { found.push(node); return }
    for (const child of inside) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return found
}

interface Draft { kind: 'comment'; target: CopyOSDesignCommentTarget; screen: { x: number; y: number } }
interface MarkDraft { kind: 'mark'; region: DesignerSceneBox; screen: { x: number; y: number } }

/**
 * Transparent layer over the canvas: pins for open comments, comment placement and Mark region drawing while a review mode is on.
 * @param props - View transform, laid-out layers, mode, comments and the actions placing a comment or sending a Mark.
 * @returns The overlay.
 */
export function DesignerReviewOverlay({ t, view, mode, byId, pageId, comments, selectedComment, onSelectComment, onAddComment,
  onSendComment, onMark, onCancel, onWheel }: {
  t: Translate
  view: DesignerReviewView
  mode: DesignerReviewMode
  byId: ReadonlyMap<string, CopyOSDesignNode>
  pageId: string | null
  comments: readonly CopyOSDesignComment[]
  selectedComment: string | null
  onSelectComment: (id: string) => void
  onAddComment: (target: CopyOSDesignCommentTarget, body: string) => Promise<boolean>
  onSendComment?: ((target: CopyOSDesignCommentTarget, body: string) => boolean) | undefined
  onMark: (region: DesignerSceneBox, note: string, signal: AbortSignal) => Promise<boolean>
  onCancel: () => void
  /** Pan and zoom still reach the canvas while a review mode covers it. */
  onWheel: (event: WheelEvent) => void
}): ReactNode {
  const { Button, TextField } = useEditorChrome()
  const input = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | MarkDraft | null>(null)
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!draft) return
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => { cancelAnimationFrame(frame) }
  }, [draft])
  const pending = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    setDraft(null); setDrag(null); setBody(''); setBusy(false)
    return () => { pending.current?.abort(); pending.current = null }
  }, [mode, pageId])
  useEffect(() => {
    if (mode === null) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      pending.current?.abort(); pending.current = null; setBusy(false)
      if (draft) { setDraft(null); setBody('') } else onCancel()
    }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true) }
  }, [mode, draft, onCancel])
  const local = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = root.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const toScene = (point: { x: number; y: number }): { x: number; y: number } =>
    ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom })
  const toScreen = (point: { x: number; y: number }): { x: number; y: number } =>
    ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y })
  const layerAt = (event: ReactPointerEvent): string | undefined => {
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(event.clientX, event.clientY) : []
    for (const element of stack) {
      if (root.current?.contains(element)) continue
      const id = element.closest('[data-design-node]')?.getAttribute('data-design-node')
      if (id && byId.has(id)) return id
    }
    return undefined
  }
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || draft) return
    event.preventDefault()
    const point = local(event)
    if (mode === 'comment') {
      const scene = toScene(point), id = layerAt(event), node = id === undefined ? undefined : byId.get(id)
      const box = id === undefined ? undefined : designerSceneBox(byId, id)
      const target: CopyOSDesignCommentTarget = node && box
        ? { kind: 'layer', pageId, nodeId: node.id, nodeName: node.name.slice(0, 200), x: scene.x - box.x, y: scene.y - box.y }
        : { kind: 'point', pageId, x: scene.x, y: scene.y }
      setDraft({ kind: 'comment', target, screen: point })
      return
    }
    if (mode === 'mark') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ start: point, end: point })
    }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag) setDrag({ ...drag, end: local(event) })
  }
  const pointerUp = (): void => {
    if (!drag) return
    const left = Math.min(drag.start.x, drag.end.x), top = Math.min(drag.start.y, drag.end.y)
    const width = Math.abs(drag.end.x - drag.start.x), height = Math.abs(drag.end.y - drag.start.y)
    setDrag(null)
    if (width < 6 || height < 6) return
    const start = toScene({ x: left, y: top })
    setDraft({ kind: 'mark', region: { x: start.x, y: start.y, width: width / view.zoom, height: height / view.zoom },
      screen: { x: left + width, y: top + height } })
  }
  const finish = async (send: boolean): Promise<void> => {
    if (!draft || !body.trim() || busy) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const done = draft.kind === 'mark' ? await onMark(draft.region, body.trim(), controller.signal)
        : send && onSendComment ? onSendComment(draft.target, body.trim()) : await onAddComment(draft.target, body.trim())
      if (done && !controller.signal.aborted) { setDraft(null); setBody('') }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }
  const markBox = draft?.kind === 'mark' ? (() => {
    const start = toScreen({ x: draft.region.x, y: draft.region.y })
    return { left: start.x, top: start.y, width: draft.region.width * view.zoom, height: draft.region.height * view.zoom }
  })() : drag ? { left: Math.min(drag.start.x, drag.end.x), top: Math.min(drag.start.y, drag.end.y),
    width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y) } : null
  const pins = comments.flatMap((comment, index) => {
    if (comment.status !== 'open' || comment.target.pageId !== pageId) return []
    const point = designerCommentPoint(byId, comment.target)
    return point ? [{ comment, number: index + 1, screen: toScreen(point) }] : []
  })
  return (
    <div ref={root} className={css.reviewOverlay} data-review-mode={mode ?? 'none'}
      onPointerDown={mode ? pointerDown : undefined} onPointerMove={mode ? pointerMove : undefined}
      onPointerUp={mode ? pointerUp : undefined} onWheel={mode ? (event) => { onWheel(event.nativeEvent) } : undefined}>
      {pins.map(pin => <button key={pin.comment.id} type="button" className={css.reviewPin}
        data-selected={pin.comment.id === selectedComment} style={{ left: pin.screen.x, top: pin.screen.y }}
        aria-label={`${t('commentsTitle')} ${String(pin.number)}`} title={pin.comment.body}
        onPointerDown={(event) => { event.stopPropagation() }}
        onClick={() => { onSelectComment(pin.comment.id) }}>{pin.number}</button>)}
      {markBox ? <div className={css.reviewMarkBox} style={markBox} /> : null}
      {mode === 'comment' && !draft ? <p className={css.reviewHint} role="status">{t('designerCommentPlacementHint')}</p> : null}
      {mode === 'mark' && !draft ? <p className={css.reviewHint} role="status">{t('designerMarkPlacementHint')}</p> : null}
      {draft ? <form className={css.reviewCard} style={{ '--review-x': `${draft.screen.x + 8}px`, '--review-y': `${draft.screen.y + 8}px` } as CSSProperties}
        onPointerDown={(event) => { event.stopPropagation() }}
        onSubmit={(event) => { event.preventDefault(); void finish(false) }}>
        <p>{draft.kind === 'mark' ? t('designerMarkCardTitle')
          : draft.target.kind === 'layer' ? draft.target.nodeName : t('designerCommentOnCanvas')}</p>
        <TextField textareaRef={input} rows={3} disabled={busy} value={body}
          label={t(draft.kind === 'mark' ? 'designerMarkPlaceholder' : 'designerCommentPlaceholder')}
          labelVisibility="hidden" placeholder={t(draft.kind === 'mark' ? 'designerMarkPlaceholder' : 'designerCommentPlaceholder')}
          onValueChange={setBody}
          onTextareaKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault(); void finish(false)
            }
          }} />
        <div className={css.reviewActions}>
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => { setDraft(null); setBody('') }}>{t('cancel')}</Button>
          {draft.kind === 'comment' && onSendComment ? <Button type="button" size="sm" variant="outline" disabled={busy || !body.trim()}
            onClick={() => { void finish(true) }}>{t('designerSendToChat')}</Button> : null}
          <Button type="submit" size="sm" variant="prominent" disabled={busy || !body.trim()}>
            {t(draft.kind === 'mark' ? 'designerMarkAddToChat' : 'commentsAdd')}</Button>
        </div>
      </form> : null}
    </div>
  )
}

/**
 * Comments list beside the canvas: open and resolved counts, each comment's layer, text and age, with Resolve/Reopen and Delete.
 * @param props - Comments, the selected one, and status, delete, select and close actions.
 * @returns The panel.
 */
export function DesignerCommentsPanel({ t, comments, selected, error, onSelect, onStatus, onDelete, onPlace, onClose }: {
  t: Translate
  comments: readonly CopyOSDesignComment[]
  selected: string | null
  error: string | null
  onSelect: (comment: CopyOSDesignComment) => void
  onStatus: (comment: CopyOSDesignComment, status: CopyOSDesignComment['status']) => void
  onDelete: (comment: CopyOSDesignComment) => void
  onPlace: () => void
  onClose: () => void
}): ReactNode {
  const { Button } = useEditorChrome()
  const open = comments.filter(comment => comment.status === 'open').length
  return (
    <aside className={css.headerDrawer} aria-label={t('commentsTitle')}>
      <header>
        <div><h2>{t('commentsTitle')}</h2>
          <small>{t('commentsSummary').replace('{open}', String(open)).replace('{resolved}', String(comments.length - open))}</small></div>
        <button type="button" onClick={onPlace}>{t('commentsAdd')}</button>
        <button type="button" aria-label={t('designerDone')} onClick={onClose}>×</button>
      </header>
      <p className={css.headerDrawerNote}>{t('designerCommentsPrivacy')}</p>
      {error ? <p role="alert">{error}</p> : null}
      {comments.length === 0 ? <p className={css.headerDrawerEmpty}>{t('commentsEmpty')}<br /><small>{t('designerCommentsEmptyHint')}</small></p> : null}
      <ol className={css.commentList}>
        {comments.map((comment, index) => <li key={comment.id} data-status={comment.status} data-selected={comment.id === selected}>
          <button type="button" className={css.commentTarget} onClick={() => { onSelect(comment) }}>
            <span>{index + 1}</span>{comment.target.kind === 'layer' ? comment.target.nodeName : t('designerCommentOnCanvas')}
          </button>
          <p>{comment.body}</p>
          <footer>
            <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
            <Button type="button" size="sm" variant="ghost" onClick={() => { onStatus(comment, comment.status === 'open' ? 'resolved' : 'open') }}>
              {t(comment.status === 'open' ? 'commentsResolve' : 'commentsReopen')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { onDelete(comment) }}>{t('designerDeleteComment')}</Button>
          </footer>
        </li>)}
      </ol>
    </aside>
  )
}
