/** Noninteractive page-backed Canvas artboards render the same selected HTML and resource URLs as Page Builder. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CopyOSPageDocument } from '../../../copyos-domain/src/types.ts'
import { embedCanvasPageResources, readCanvasPreviewBytes, type CanvasPageResourceCache } from './canvas-page-resources.ts'
import { buildFullPagePreviewDocument, collectPageStylesheets, projectAssetUrl, rewriteCssAssetUrls } from './LandingPageVisualWorkspace.tsx'
import { buildMeasuredCanvasDocument, buildStaticCanvasDocument } from './canvas-page-measurement.ts'

function markFrameInert(frame: HTMLIFrameElement | null): void { frame?.setAttribute('inert', '') }

/**
 * Render selected page variations in an opaque-origin frame at the artboard viewport size.
 * @param props - Current page, native dimensions and accessible title. projectPath resolves local assets;
 * optional previewCss overrides stylesheet loading and onResourceState reports parent-materialized asset readiness.
 * autoHeight enables only the nonce-authorized measurement bootstrap; onLayout receives validated bounded sizes or explicit failure.
 * @returns A pointer-inert, unfocusable page preview. Resources follow browser/endpoint policies;
 * project images/fonts are embedded within bounded bytes; unsupported or failed resources expose data-resource-state=error.
 * Authored scripts never run. Unsettled sizing falls back to sanitized, script-disabled content at the supplied height.
 */
export function CanvasPagePreview({ page, width, height, title, projectPath, previewCss, onResourceState, autoHeight, onLayout }: {
  page: CopyOSPageDocument
  width: number
  height: number
  title: string
  projectPath?: string | undefined
  previewCss?: string | undefined
  onResourceState?: ((state: 'loading' | 'ready' | 'error') => void) | undefined
  autoHeight?: boolean | undefined
  onLayout?: ((value: { width: number; height: number; state: 'ready' | 'error' }) => void) | undefined
}): ReactNode {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const attach = useCallback((value: HTMLIFrameElement | null): void => { frame.current = value; markFrameInert(value) }, [])
  const layoutCallback = useRef(onLayout)
  useEffect(() => { layoutCallback.current = onLayout }, [onLayout])
  const stylesheetNames = JSON.stringify(collectPageStylesheets({ ...page, sections: page.sections.map(section => ({
    ...section, variants: section.variants.filter(variant => variant.id === section.selectedVariantId),
  })) }))
  const stylesheets = useMemo<readonly string[]>(() => JSON.parse(stylesheetNames) as readonly string[], [stylesheetNames])
  const resourceKey = JSON.stringify([projectPath, page.id, page.revision, page.updatedAt, stylesheets])
  const [loaded, setLoaded] = useState<{ key: string; css: string; failed: boolean }>()
  useEffect(() => {
    if (previewCss !== undefined || projectPath === undefined || stylesheets.length === 0) return
    const controller = new AbortController()
    let totalCssBytes = 0
    void Promise.all(stylesheets.map(async (stylesheet) => {
      if (stylesheets.length > 32) throw new Error('Too many project stylesheets')
      const url = projectAssetUrl(projectPath, stylesheet)
      if (url === null) throw new Error('Page stylesheet does not identify a project asset')
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      if (!response.ok) throw new Error('Page stylesheet could not be loaded')
      const bytes = await readCanvasPreviewBytes(response, controller.signal, 2 * 1024 * 1024)
      totalCssBytes += bytes.byteLength
      if (totalCssBytes > 4 * 1024 * 1024) throw new Error('Project stylesheets exceed the byte limit')
      return rewriteCssAssetUrls(new TextDecoder().decode(bytes), projectPath, stylesheet)
    })).then((styles) => {
      if (!controller.signal.aborted) setLoaded({ key: resourceKey, css: styles.join('\n'), failed: false })
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoaded({ key: resourceKey, css: '', failed: true })
        controller.abort()
      }
    })
    return () => { controller.abort() }
  }, [stylesheets, resourceKey, previewCss, projectPath])
  const automatic = previewCss === undefined && projectPath !== undefined && stylesheets.length > 0
  const current = loaded?.key === resourceKey ? loaded : undefined
  const sharedCss = previewCss ?? current?.css ?? ''
  const source = useMemo(() => buildFullPagePreviewDocument(page, projectPath,
    `html,body{margin:0;background:#fff}html{overflow:hidden}\n${sharedCss}`), [page, projectPath, sharedCss])
  const cache = useMemo<CanvasPageResourceCache>(() => new Map(), [projectPath, page.id, page.revision, page.updatedAt])
  const [embedded, setEmbedded] = useState<{ source: string; generation: string; projectPath: string; html: string; failed: boolean }>()
  const stylesState = !automatic ? 'ready' : current === undefined ? 'loading' : current.failed ? 'error' : 'ready'
  useEffect(() => {
    if (projectPath === undefined || stylesState === 'loading') return
    const controller = new AbortController()
    void embedCanvasPageResources(source, projectPath, controller.signal, cache).then((result) => {
      if (!controller.signal.aborted) setEmbedded({ source, generation: resourceKey, projectPath, ...result })
    }).catch(() => {
      if (!controller.signal.aborted) setEmbedded({ source, generation: resourceKey, projectPath, html: '', failed: true })
    })
    return () => { controller.abort() }
  }, [source, projectPath, cache, stylesState, resourceKey])
  const materialized = embedded?.source === source && embedded.projectPath === projectPath && embedded.generation === resourceKey
    ? embedded : undefined
  const resourceState = stylesState === 'error' || materialized?.failed ? 'error'
    : stylesState === 'loading' || projectPath !== undefined && materialized === undefined ? 'loading' : 'ready'
  const reportState = useRef(onResourceState)
  useEffect(() => { reportState.current = onResourceState }, [onResourceState])
  useEffect(() => { reportState.current?.(resourceState) }, [resourceState])
  const frameSource = projectPath === undefined ? source : materialized?.html ?? '<!doctype html><html><body style="margin:0;background:#fff"></body></html>'
  const measured = useMemo(() => {
    if (!autoHeight || resourceState !== 'ready') return null
    const token = randomUUID()
    return { token, html: buildMeasuredCanvasDocument(frameSource, token) }
  }, [autoHeight, resourceState, frameSource, width])
  const [layoutReady, setLayoutReady] = useState<string | null>(null)
  const [layoutFailure, setLayoutFailure] = useState<string | null>(null)
  const failed = measured !== null && layoutFailure === measured.token
  useEffect(() => {
    if (!measured) return
    let transitions = 0, lastHeight = -1, stopped = false
    const fail = (): void => {
      if (stopped) return
      stopped = true; setLayoutFailure(measured.token)
      layoutCallback.current?.({ width, height: 1, state: 'error' })
    }
    const deadline = window.setTimeout(fail, 6500)
    const receive = (event: MessageEvent): void => {
      if (stopped || event.source !== frame.current?.contentWindow || event.origin !== 'null') return
      const value: unknown = event.data
      if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'copyos-canvas-layout' ||
        !('token' in value) || value.token !== measured.token || !('width' in value) || value.width !== Math.round(width) ||
        !('height' in value) || typeof value.height !== 'number' || !Number.isInteger(value.height) ||
        value.height < 1 || value.height > 100000 || !('state' in value)) return
      if (value.state === 'error') { fail(); return }
      if (value.state !== 'ready') return
      window.clearTimeout(deadline)
      if (lastHeight === value.height) return
      if (++transitions > 8) { fail(); return }
      lastHeight = value.height; setLayoutReady(measured.token)
      layoutCallback.current?.({ width, height: value.height, state: 'ready' })
    }
    window.addEventListener('message', receive)
    return () => { stopped = true; window.clearTimeout(deadline); window.removeEventListener('message', receive) }
  }, [measured, width])
  const fixedSource = useMemo(() => buildStaticCanvasDocument(frameSource), [frameSource])
  const displayedSource = measured && !failed ? measured.html : fixedSource
  return <iframe key={displayedSource} ref={attach} title={title} width={width} height={height} tabIndex={-1}
    sandbox={measured && !failed ? 'allow-scripts' : ''} referrerPolicy="no-referrer"
    data-layout-state={failed ? 'error' : measured ? layoutReady === measured.token ? 'ready' : 'measuring' : 'fixed'}
    data-styles-state={stylesState} data-resource-state={resourceState}
    style={{ width, height, display: 'block', border: 0, background: '#fff', pointerEvents: 'none', userSelect: 'none' }}
    srcDoc={displayedSource} />
}
