/** Canvas image crops preview one document transaction until completion or cancellation. */
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignImagePaint,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import {
  cropDesignImage,
  designLayoutBox,
  designImageToCrop,
  designImageGeometry,
  designNodePaints,
  designNodeTransform,
  resolveDesignNodes,
  resizeDesignCropRect,
  resizeDesignCropImage,
  rotateDesignImage,
  DESIGN_IMAGE_LIMITS,
} from '../../../copyos-domain/src/design-model.ts'
import {
  DesignerCropOverlay,
  type CropHandleKind,
} from './DesignerCropOverlay.tsx'
import { DesignerCropToolbar } from './DesignerCropToolbar.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
import { loadDesignerImageElement, useDesignerImageAssets } from './DesignerImageAssets.ts'
type ImageMetadata = Pick<
  CopyOSDesignImagePaint,
  'sourceWidth' | 'sourceHeight'
>
type Session = { nodeId: string; paintId: string; aspect: string }
type Entry = { document: CopyOSDesignDocument; aspect: string }
type Drag = {
  entry: Entry
  node: CopyOSDesignNode
  image: CopyOSDesignImagePaint
  kind: CropHandleKind
  handle: string
  x: number
  y: number
  matrix: DOMMatrix
  angle: number
}
function cropBounds(node: CopyOSDesignNode) {
  const box = designLayoutBox(node)
  return {
    minWidth: Math.max(node.minWidth ?? 1, box.widthFloor),
    minHeight: Math.max(node.minHeight ?? 1, box.heightFloor),
    maxWidth: Math.max(node.maxWidth ?? 100000, box.widthFloor),
    maxHeight: Math.max(node.maxHeight ?? 100000, box.heightFloor),
  }
}
/** Own crop previews, local undo, source decoding and canvas pointer/keyboard edits.
 * @param props - Current scene, document transactions, selection and view.
 * @returns Crop entry, completion, events and temporary canvas controls.
 */
export function useDesignerCrop({
  doc,
  getDocument,
  preview,
  commit,
  cancelPreview,
  select,
  selectionKey,
  zoom,
  t,
  error,
}: {
  doc: CopyOSDesignDocument | null
  getDocument: () => CopyOSDesignDocument | null
  preview: (doc: CopyOSDesignDocument) => void
  commit: (doc: CopyOSDesignDocument) => void
  cancelPreview: () => void
  select: (id: string) => void
  selectionKey: string
  zoom: number
  t: (key: CopyOSFoundationLocaleKey) => string
  error: (message: string) => void
}) {
  const imageAssets = useDesignerImageAssets()
  const [session, setSession] = useState<Session | null>(null),
    active = useRef(session)
  active.current = session
  const [loading, setLoading] = useState<string | null>(null),
    pending = useRef<HTMLImageElement | null>(null),
    generation = useRef(0)
  const drag = useRef<Drag | null>(null),
    past = useRef<Entry[]>([]),
    future = useRef<Entry[]>([]),
    [, refresh] = useState(0)
  const stopLoad = () => {
    generation.current++
    if (pending.current) {
      pending.current.onload = null
      pending.current.onerror = null
      pending.current = null
    }
    setLoading(null)
  }
  const finish = () => {
    stopLoad()
    if (!active.current) return
    active.current = null
    setSession(null)
    drag.current = null
    past.current = []
    future.current = []
    const next = getDocument()
    if (next) commit(next)
  }
  const cancel = () => {
    stopLoad()
    if (!active.current) return
    active.current = null
    setSession(null)
    drag.current = null
    past.current = []
    future.current = []
    cancelPreview()
  }
  useLayoutEffect(() => {
    if (active.current && selectionKey !== active.current.nodeId) finish()
    if (loading && selectionKey !== loading) stopLoad()
  }, [selectionKey])
  useLayoutEffect(
    () => () => {
      generation.current++
      if (pending.current) {
        pending.current.onload = null
        pending.current.onerror = null
        pending.current = null
      }
    },
    [],
  )
  const context = (document = getDocument()) => {
    const s = active.current
    if (!s || !document) return null
    const node = resolveDesignNodes(document).find(n => n.id === s.nodeId),
      paint = document.nodes
        .find(n => n.id === s.nodeId)
        ?.fills?.find(p => p.id === s.paintId)
    return node && paint?.image
      ? { document, node, paint, image: paint.image, session: s }
      : null
  }
  const publish = (next: CopyOSDesignDocument, record = false) => {
    const c = context()
    if (!c) return
    if (record) {
      past.current.push({ document: c.document, aspect: c.session.aspect })
      future.current = []
    }
    preview(next)
    refresh(n => n + 1)
    error('')
  }
  const imageDraft = (
    document: CopyOSDesignDocument,
    image: CopyOSDesignImagePaint,
  ) => {
    const s = active.current
    if (!s) return document
    if (
      !Number.isFinite(image.zoom ?? 1) ||
      (image.zoom ?? 1) < DESIGN_IMAGE_LIMITS.minZoom ||
      (image.zoom ?? 1) > DESIGN_IMAGE_LIMITS.maxZoom ||
      ![image.offsetX ?? 0, image.offsetY ?? 0].every(
        n =>
          Number.isFinite(n) && Math.abs(n) <= DESIGN_IMAGE_LIMITS.maxOffset,
      )
    )
      throw new Error(t('designerCropLimit'))
    return {
      ...document,
      nodes: document.nodes.map(n =>
        n.id === s.nodeId
          ? {
            ...n,
            fills: designNodePaints(n).map(p =>
              p.id === s.paintId ? { ...p, image } : p,
            ),
          }
          : n,
      ),
    }
  }
  const begin = (nodeId: string, paintId: string, metadata?: ImageMetadata) => {
    finish()
    cancelPreview()
    const document = getDocument()
    if (!document) return
    const nodes = resolveDesignNodes(document),
      node = nodes.find(n => n.id === nodeId),
      raw = document.nodes.find(n => n.id === nodeId),
      paint = raw
        ? designNodePaints(raw).find(p => p.id === paintId)
        : undefined
    if (!node || !paint?.image || ['instance', 'text'].includes(node.kind))
      return
    let ancestor: CopyOSDesignNode | undefined = node
    while (ancestor) {
      if (ancestor.locked) return
      if (!ancestor.visible) {
        error(t('designerCropVisible'))
        return
      }
      ancestor = nodes.find(n => n.id === ancestor?.parentId)
    }
    select(nodeId)
    const source = { ...paint.image, ...metadata },
      documentId = document.id,
      sourceUrl = source.url,
      request = ++generation.current
    const activate = (image: CopyOSDesignImagePaint) => {
      if (generation.current !== request) return
      const current = getDocument(),
        raw = current?.nodes.find(n => n.id === nodeId),
        currentPaint = raw
          ? designNodePaints(raw).find(p => p.id === paintId)
          : undefined
      if (
        !current ||
        current.id !== documentId ||
        !raw ||
        currentPaint?.image?.url !== sourceUrl
      ) {
        setLoading(null)
        return
      }
      const currentNodes = resolveDesignNodes(current),
        currentNode = currentNodes.find(n => n.id === nodeId)
      if (!currentNode || ['instance', 'text'].includes(currentNode.kind)) {
        setLoading(null)
        return
      }
      let parent: CopyOSDesignNode | undefined = currentNode
      while (parent) {
        if (parent.locked || !parent.visible) {
          setLoading(null)
          return
        }
        parent = currentNodes.find(n => n.id === parent?.parentId)
      }
      const latestImage = {
        ...currentPaint.image,
        sourceWidth: image.sourceWidth,
        sourceHeight: image.sourceHeight,
      }
      const s = { nodeId, paintId, aspect: 'free' }
      active.current = s
      setSession(s)
      past.current = []
      future.current = []
      preview(
        imageDraft(
          current,
          designImageToCrop(latestImage, currentNode.width, currentNode.height),
        ),
      )
      setLoading(null)
      error('')
    }
    if (source.sourceWidth && source.sourceHeight) {
      activate(source)
      return
    }
    const decoded = new Image()
    pending.current = decoded
    setLoading(nodeId)
    const cleanup = () => {
      decoded.onload = null
      decoded.onerror = null
      if (pending.current === decoded) pending.current = null
    }
    decoded.onload = () => {
      cleanup()
      if (generation.current !== request) return
      if (
        decoded.naturalWidth > 0 &&
        decoded.naturalWidth <= 100000 &&
        decoded.naturalHeight > 0 &&
        decoded.naturalHeight <= 100000
      )
        activate({
          ...source,
          sourceWidth: decoded.naturalWidth,
          sourceHeight: decoded.naturalHeight,
        })
      else {
        setLoading(null)
        error(t('designerImageInvalid'))
      }
    }
    decoded.onerror = () => {
      cleanup()
      if (generation.current === request) {
        setLoading(null)
        error(t('designerImageInvalid'))
      }
    }
    loadDesignerImageElement(imageAssets, sourceUrl, decoded)
  }
  const undo = (redo = false) => {
    const c = context()
    if (!c) return
    const entry = (redo ? future : past).current.pop()
    if (!entry) return
    ;(redo ? past : future).current.push({
      document: c.document,
      aspect: c.session.aspect,
    })
    const s = { ...c.session, aspect: entry.aspect }
    active.current = s
    setSession(s)
    preview(entry.document)
    refresh(n => n + 1)
  }
  const aspectRatio = (value: string, image: CopyOSDesignImagePaint) =>
    value === 'free'
      ? null
      : value === 'original'
        ? (image.sourceWidth ?? 1) / (image.sourceHeight ?? 1)
        : Number(value.split(':')[0]) / Number(value.split(':')[1])
  const adjust = (
    fn: (
      image: CopyOSDesignImagePaint,
      node: CopyOSDesignNode,
    ) => CopyOSDesignImagePaint,
  ) => {
    const c = context()
    if (!c) return
    try {
      publish(imageDraft(c.document, fn(c.image, c.node)), true)
    } catch {
      error(t('designerCropLimit'))
    }
  }
  const aspect = (value: string) => {
    const c = context()
    if (!c) return
    try {
      const ratio = aspectRatio(value, c.image)
      let next = c.document
      if (ratio) {
        const width = Math.min(c.node.width, c.node.height * ratio),
          height = width / ratio
        if (
          width < cropBounds(c.node).minWidth ||
          height < cropBounds(c.node).minHeight
        )
          throw new Error('Crop constraints')
        next = cropDesignImage(c.document, c.node.id, c.paint.id, {
          left: (c.node.width - width) / 2,
          top: (c.node.height - height) / 2,
          width,
          height,
        })
      }
      publish(next, true)
      const s = { ...c.session, aspect: value }
      active.current = s
      setSession(s)
    } catch {
      error(t('designerCropLimit'))
    }
  }
  const fit = () => {
    const c = context()
    if (!c) return
    try {
      const g = designImageGeometry(c.image, c.node.width, c.node.height),
        angle = ((c.image.rotation ?? 0) * Math.PI) / 180,
        width =
          Math.abs(Math.cos(angle)) * g.imageWidth +
          Math.abs(Math.sin(angle)) * g.imageHeight,
        height =
          Math.abs(Math.sin(angle)) * g.imageWidth +
          Math.abs(Math.cos(angle)) * g.imageHeight
      if (
        width < cropBounds(c.node).minWidth ||
        width > cropBounds(c.node).maxWidth ||
        height < cropBounds(c.node).minHeight ||
        height > cropBounds(c.node).maxHeight
      )
        throw new Error('Crop constraints')
      publish(
        cropDesignImage(c.document, c.node.id, c.paint.id, {
          left:
            c.node.width / 2 +
            (c.image.offsetX ?? 0) * c.node.width -
            width / 2,
          top:
            c.node.height / 2 +
            (c.image.offsetY ?? 0) * c.node.height -
            height / 2,
          width,
          height,
        }),
        true,
      )
      const s = { ...c.session, aspect: 'free' }
      active.current = s
      setSession(s)
    } catch {
      error(t('designerCropLimit'))
    }
  }
  const manipulate = (
    entry: Entry,
    node: CopyOSDesignNode,
    image: CopyOSDesignImagePaint,
    kind: CropHandleKind,
    handle: string,
    dx: number,
    dy: number,
    alt: boolean,
    shift: boolean,
    angle?: number,
  ) => {
    const c = context()
    if (!c) return
    try {
      let next: CopyOSDesignDocument
      if (kind === 'frame') {
        const ratio =
          aspectRatio(entry.aspect, image) ??
          (shift ? node.width / node.height : null)
        next = cropDesignImage(
          entry.document,
          node.id,
          c.paint.id,
          resizeDesignCropRect(
            node.width,
            node.height,
            handle,
            dx,
            dy,
            ratio,
            cropBounds(node),
            alt,
          ),
        )
      } else {
        const changed =
          kind === 'image'
            ? resizeDesignCropImage(
              image,
              node.width,
              node.height,
              handle as 'nw' | 'ne' | 'se' | 'sw',
              dx,
              dy,
              alt,
            )
            : kind === 'rotate'
              ? rotateDesignImage(
                image,
                node.width,
                node.height,
                Math.max(
                  -36000,
                  Math.min(
                    36000,
                    shift ? Math.round((angle ?? 0) / 15) * 15 : (angle ?? 0),
                  ),
                ),
              )
              : {
                ...image,
                offsetX: Math.max(
                  -DESIGN_IMAGE_LIMITS.maxOffset,
                  Math.min(
                    DESIGN_IMAGE_LIMITS.maxOffset,
                    (image.offsetX ?? 0) + dx / node.width,
                  ),
                ),
                offsetY: Math.max(
                  -DESIGN_IMAGE_LIMITS.maxOffset,
                  Math.min(
                    DESIGN_IMAGE_LIMITS.maxOffset,
                    (image.offsetY ?? 0) + dy / node.height,
                  ),
                ),
              }
        next = imageDraft(entry.document, changed)
      }
      publish(next)
    } catch {
      error(t('designerCropLimit'))
    }
  }
  const onStart = (
    e: PointerEvent<SVGElement>,
    kind: CropHandleKind,
    handle: string,
  ) => {
    const c = context()
    if (!c || e.button !== 0) return
    const matrix = e.currentTarget
      .closest<SVGGElement>('[data-designer-crop-overlay]')
      ?.getScreenCTM()
      ?.inverse()
    if (!matrix) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    const x = matrix.a * e.clientX + matrix.c * e.clientY + matrix.e,
      y = matrix.b * e.clientX + matrix.d * e.clientY + matrix.f
    drag.current = {
      entry: { document: c.document, aspect: c.session.aspect },
      node: c.node,
      image: c.image,
      kind,
      handle,
      x,
      y,
      matrix,
      angle:
        (Math.atan2(
          y - c.node.height / 2 - (c.image.offsetY ?? 0) * c.node.height,
          x - c.node.width / 2 - (c.image.offsetX ?? 0) * c.node.width,
        ) *
          180) /
        Math.PI,
    }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return false
    const m = d.matrix,
      x = m.a * e.clientX + m.c * e.clientY + m.e,
      y = m.b * e.clientX + m.d * e.clientY + m.f,
      current =
        (Math.atan2(
          y - d.node.height / 2 - (d.image.offsetY ?? 0) * d.node.height,
          x - d.node.width / 2 - (d.image.offsetX ?? 0) * d.node.width,
        ) *
          180) /
        Math.PI,
      delta = ((current - d.angle + 540) % 360) - 180
    manipulate(
      d.entry,
      d.node,
      d.image,
      d.kind,
      d.handle,
      x - d.x,
      y - d.y,
      e.altKey,
      e.shiftKey,
      (d.image.rotation ?? 0) + delta,
    )
    return true
  }
  const onEnd = (cancelled = false) => {
    const d = drag.current
    if (!d) return false
    drag.current = null
    if (cancelled) preview(d.entry.document)
    else {
      past.current.push(d.entry)
      future.current = []
    }
    refresh(n => n + 1)
    return true
  }
  const onHandleKey = (
    e: KeyboardEvent<SVGElement>,
    kind: CropHandleKind,
    handle: string,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
      return
    const c = context()
    if (!c) return
    e.preventDefault()
    e.stopPropagation()
    const entry = { document: c.document, aspect: c.session.aspect }
    past.current.push(entry)
    future.current = []
    const step = e.shiftKey ? 10 : 1,
      dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
      dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    manipulate(
      entry,
      c.node,
      c.image,
      kind,
      handle,
      dx,
      dy,
      e.altKey,
      false,
      (c.image.rotation ?? 0) + (dx || dy) * (e.shiftKey ? 1.5 : 1),
    )
  }
  const onKey = (e: KeyboardEvent) => {
    if (!active.current) return false
    if (e.key === 'Escape') cancel()
    else if (e.key === 'Enter') finish()
    else if (
      (e.ctrlKey || e.metaKey) &&
      ['z', 'y'].includes(e.key.toLowerCase())
    )
      undo(e.shiftKey || e.key.toLowerCase() === 'y')
    else if (e.key === ' ') return false
    else if (e.key.startsWith('Arrow')) {
      const c = context()
      if (c) {
        const step = e.shiftKey ? 10 : 1
        adjust(image => ({
          ...image,
          offsetX:
            (image.offsetX ?? 0) +
            (e.key === 'ArrowRight'
              ? step
              : e.key === 'ArrowLeft'
                ? -step
                : 0) /
              c.node.width,
          offsetY:
            (image.offsetY ?? 0) +
            (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) /
              c.node.height,
        }))
      }
    }
    e.preventDefault()
    return true
  }
  const current = context(doc),
    // Only an active crop needs its ancestor chain; resolving every node on each Canvas render is costly on large designs.
    nodes = doc && current ? resolveDesignNodes(doc) : [],
    chain: CopyOSDesignNode[] = []
  let ancestor = current?.node
  while (ancestor) {
    chain.unshift(ancestor)
    ancestor = nodes.find(n => n.id === ancestor?.parentId)
  }
  return {
    active: !!session,
    loading,
    begin,
    finish,
    cancel,
    onMove,
    onEnd,
    onKey,
    overlay: current ? (
      <DesignerCropOverlay
        node={current.node}
        paint={current.paint}
        transform={chain.map(designNodeTransform).join(' ')}
        zoom={zoom}
        extent={Math.max(window.innerWidth, window.innerHeight)}
        t={t}
        onStart={onStart}
        onKey={onHandleKey}
      />
    ) : null,
    toolbar: current ? (
      <DesignerCropToolbar
        image={current.image}
        aspect={current.session.aspect}
        t={t}
        onAspect={aspect}
        onZoom={(zoom) => {
          adjust(image => ({ ...image, zoom }))
        }}
        onRotation={(angle) => {
          adjust((image, node) =>
            rotateDesignImage(image, node.width, node.height, angle),
          )
        }}
        onFit={fit}
        onDone={finish}
        onCancel={cancel}
        canUndo={!!past.current.length}
        canRedo={!!future.current.length}
        onUndo={() => {
          undo()
        }}
        onRedo={() => {
          undo(true)
        }}
      />
    ) : loading ? (
      <div
        data-designer-crop-ui="true"
        className={css.cropLoading}
        role="status"
      >
        {t('designerImageDimensionsLoading')}
        <button type="button" onClick={stopLoad}>
          {t('cancel')}
        </button>
      </div>
    ) : null,
  }
}
