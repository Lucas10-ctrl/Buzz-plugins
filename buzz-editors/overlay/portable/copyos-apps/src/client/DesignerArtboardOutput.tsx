/** Inspector sections for exact-size artboard variants and PNG/JPEG/WebP/SVG export of top-level artboards. */
import { useEffect, useState, type ReactNode } from 'react'
import { createDesignSizeVariant, packDesignExportBundle, type DesignExportBundleFile } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { rasterizeDesignArtboard, type DesignerRasterOptions } from './DesignerRasterExport.ts'
import { DesignerDisclosureSection } from './DesignerDisclosureSection.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import { useDesignerImageAssets } from './DesignerImageAssets.ts'
import css from './PageDesignerWorkspace.module.css'

const extensions = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg' } as const satisfies Record<DesignerRasterOptions['format'], string>
const formats = ['png', 'jpeg', 'webp', 'svg'] as const satisfies readonly DesignerRasterOptions['format'][]
const formatLabels = {
  png: 'designerOutputPng', jpeg: 'designerOutputJpeg', webp: 'designerOutputWebp', svg: 'designerOutputSvg',
} as const satisfies Record<DesignerRasterOptions['format'], CopyOSFoundationLocaleKey>

const sizes = [
  { key: 'designerOutputSquare', width: 1080, height: 1080 },
  { key: 'designerOutputPortrait', width: 1080, height: 1350 },
  { key: 'designerOutputStory', width: 1080, height: 1920 },
  { key: 'designerOutputLandscape', width: 1200, height: 628 },
] as const satisfies readonly { key: CopyOSFoundationLocaleKey; width: number; height: number }[]

/**
 * Create exact-size variants and download the selected artboard as an image.
 * @param props - Current document, selected node, all selected exportable artboards, saved revision and unsaved state, disabled state,
 *   copy, workspace commit, selection callback and bundled font URL.
 * @returns Two Properties sections for unlinked top-level frames, otherwise null.
 */
export function DesignerArtboardOutput({ doc, node, frames, revision, unsaved, disabled, t, commit, select, fontUrl, fontCss }: {
  doc: CopyOSDesignDocument
  node: CopyOSDesignNode
  /** Selected visible top-level unlinked frames; more than one exports a ZIP. */
  frames: readonly CopyOSDesignNode[]
  revision: number
  unsaved: boolean
  disabled: boolean
  t: (key: CopyOSFoundationLocaleKey) => string
  commit: (doc: CopyOSDesignDocument) => boolean
  select: (frame: CopyOSDesignNode) => void
  fontUrl: string
  /** Project font rules embedded beside Inter. */
  fontCss?: string | undefined
}): ReactNode {
  const imageAssets = useDesignerImageAssets()
  const [width, setWidth] = useState('1080'), [height, setHeight] = useState('1080')
  const [format, setFormat] = useState<DesignerRasterOptions['format']>('png'), [scale, setScale] = useState<DesignerRasterOptions['scale']>(1)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url) }, [file])
  useEffect(() => { setFile(null); setNotice('') }, [node.id])
  if (node.kind !== 'frame' || node.parentId !== null || node.pageLink) return null
  const create = (variantWidth: number, variantHeight: number): void => {
    try {
      const created = createDesignSizeVariant(doc, node.id, { width: variantWidth, height: variantHeight,
        name: t('designerOutputVariantName').replace('{name}', node.name).replace('{size}', `${variantWidth}×${variantHeight}`) }, randomUUID)
      const frame = created.document.nodes.find(item => item.id === created.frameId)
      setError('')
      if (commit(created.document) && frame) select(frame)
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const download = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob), link = globalThis.document.createElement('a')
    // Browsers may hold automatic downloads that start after asynchronous rendering; the link below always works.
    link.href = url; link.download = name; link.click()
    setFile({ url, name })
  }
  const safeName = (value: string): string => value.replace(/[\\/:*?"<>|]+/g, '-')
  // Rendered files are self-contained; project image references become embedded images once per export.
  let embedding: Promise<CopyOSDesignDocument> | undefined
  const embedded = (): Promise<CopyOSDesignDocument> => embedding ??= imageAssets ? imageAssets.embed(doc) : Promise.resolve(doc)
  const exportBatch = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const files: DesignExportBundleFile[] = []
      for (const frame of frames) {
        const result = await rasterizeDesignArtboard(await embedded(), frame.id, { format, scale, fontUrl, fontCss })
        const data = new Uint8Array(await result.blob.arrayBuffer())
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        files.push({ name: `${safeName(frame.name)}-${result.width}x${result.height}.${extensions[format]}`, data, frameId: frame.id,
          frameName: frame.name, width: result.width, height: result.height, scale, format, sha256: digest })
      }
      const zip = packDesignExportBundle({ id: doc.id, revision, title: doc.title, unsaved }, files, 'copyos-svg-canvas/1')
      download(new Blob([new Uint8Array(zip)], { type: 'application/zip' }), `${safeName(doc.title)}-${files.length}-images.zip`)
      setNotice(t('designerOutputBatchExported').replace('{count}', String(files.length)))
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const exportImage = async (): Promise<void> => {
    if (frames.length > 1) { await exportBatch(); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await rasterizeDesignArtboard(await embedded(), node.id, { format, scale, fontUrl, fontCss })
      download(result.blob, `${safeName(node.name)}-${result.width}x${result.height}.${extensions[format]}`)
      setNotice(t('designerOutputExported').replace('{size}', `${result.width} × ${result.height}`))
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const custom = [Number(width), Number(height)]
  const customValid = custom.every(value => Number.isInteger(value) && value >= 1 && value <= 20000)
  return <>
    <DesignerDisclosureSection title={t('designerOutputSizes')}>
      <p className={css.hint}>{t('designerOutputSizesHint')}</p>
      {sizes.map(size => <button key={size.key} type="button" disabled={disabled} onClick={() => { create(size.width, size.height) }}>
        {t(size.key)}</button>)}
      <label className={css.field}><span>{t('designerOutputWidth')}</span>
        <input aria-label={t('designerOutputWidth')} inputMode="numeric" value={width} disabled={disabled}
          onChange={(event) => { setWidth(event.currentTarget.value) }} /></label>
      <label className={css.field}><span>{t('designerOutputHeight')}</span>
        <input aria-label={t('designerOutputHeight')} inputMode="numeric" value={height} disabled={disabled}
          onChange={(event) => { setHeight(event.currentTarget.value) }} /></label>
      <button type="button" disabled={disabled || !customValid} onClick={() => { create(custom[0] ?? 0, custom[1] ?? 0) }}>
        {t('designerOutputCreateCustom')}</button>
    </DesignerDisclosureSection>
    <section className={css.propertySection} aria-label={t('designerOutputExport')}>
      <div className={css.sectionHeading}><h3>{t('designerOutputExport')}</h3></div>
      <label className={css.field}><span>{t('designerOutputFormat')}</span>
        <select aria-label={t('designerOutputFormat')} value={format}
          onChange={(event) => { const value = event.currentTarget.value; setFormat(formats.find(item => item === value) ?? 'png') }}>
          {formats.map(item => <option key={item} value={item}>{t(formatLabels[item])}</option>)}
        </select></label>
      <label className={css.field}><span>{t('designerOutputScale')}</span>
        <select aria-label={t('designerOutputScale')} value={scale}
          onChange={(event) => { const value = Number(event.currentTarget.value); setScale(value === 3 ? 3 : value === 2 ? 2 : 1) }}>
          <option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option>
        </select></label>
      {frames.length > 1 ? <p className={css.hint}>{t('designerOutputBatchHint').replace('{count}', String(frames.length))}</p>
        : <p className={css.hint}>{t('designerOutputPixels').replace('{size}', `${Math.round(node.width * scale)} × ${Math.round(node.height * scale)}`)}</p>}
      <button type="button" className={css.primary} disabled={busy} onClick={() => { void exportImage() }}>
        {busy ? t('designerOutputExporting') : frames.length > 1
          ? t('designerOutputBatchButton').replace('{count}', String(frames.length)) : t('designerOutputExportButton')}</button>
      <p className={css.hint}>{t('designerOutputFontHint')}</p>
      {notice ? <p role="status">{notice}</p> : null}
      {file ? <a href={file.url} download={file.name}>{t('designerOutputDownload').replace('{name}', file.name)}</a> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  </>
}
