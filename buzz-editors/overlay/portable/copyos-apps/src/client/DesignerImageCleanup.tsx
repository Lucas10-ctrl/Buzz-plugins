/** Confirmed deletion of project image files that no project file and no open editor history uses. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSDesignImageFile } from '../../../copyos-domain/src/types.ts'
import { useDesignerImageHref } from './DesignerImageAssets.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './DesignerImageCleanup.module.css'

const PREVIEW_LIMIT = 24

type CleanupState =
  | { kind: 'scanning' }
  | { kind: 'ready'; files: CopyOSDesignImageFile[] }
  | { kind: 'removing'; files: CopyOSDesignImageFile[] }
  | { kind: 'done'; confirmed: number; removed: CopyOSDesignImageFile[] }
  | { kind: 'failed'; message: string }

/** Format a byte count with the browser locale's unit names.
 * @param bytes - Byte count.
 * @returns Kilobytes below one megabyte, otherwise megabytes with one decimal.
 */
export function formatDesignerImageBytes(bytes: number): string {
  const megabytes = bytes >= 1_000_000
  return new Intl.NumberFormat(undefined, { style: 'unit', unit: megabytes ? 'megabyte' : 'kilobyte', maximumFractionDigits: megabytes ? 1 : 0 })
    .format(megabytes ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000)))
}

function total(files: readonly CopyOSDesignImageFile[]): number {
  return files.reduce((sum, file) => sum + file.bytes, 0)
}

function Thumbnail({ fileName }: { fileName: string }): ReactNode {
  const href = useDesignerImageHref(`copyos-asset:${fileName}`)
  return <li className={css.thumbnail}>{href ? <img src={href} alt="" /> : null}</li>
}

/**
 * Scan for unused project images on open, preview them and delete them only after the user confirms.
 * @param props.find - Lists unused files; the caller adds the references its editor still holds.
 * @param props.remove - Deletes the confirmed files that are still unused and returns those deleted.
 * @param props.onClose - Closes the dialog; ignored while files are being deleted.
 * @param props.t - Locale lookup.
 * @returns The modal dialog.
 */
export function DesignerImageCleanup({ find, remove, onClose, t }: {
  find: () => Promise<CopyOSDesignImageFile[]>
  remove: (fileNames: string[]) => Promise<CopyOSDesignImageFile[]>
  onClose: () => void
  t: (key: CopyOSFoundationLocaleKey) => string
}): ReactNode {
  const [state, setState] = useState<CleanupState>({ kind: 'scanning' })
  useEffect(() => {
    let current = true
    find().then(
      (files) => { if (current) setState({ kind: 'ready', files }) },
      (error: unknown) => { if (current) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { current = false }
  }, [find])
  const removing = state.kind === 'removing'
  const close = (): void => { if (!removing) onClose() }
  const confirm = (files: CopyOSDesignImageFile[]): void => {
    setState({ kind: 'removing', files })
    remove(files.map(file => file.fileName)).then(
      (removed) => { setState({ kind: 'done', confirmed: files.length, removed }) },
      (error: unknown) => { setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
  }
  const files = state.kind === 'ready' || state.kind === 'removing' ? state.files : []
  return <Modal open title={t('designerCleanUpImages')} closeLabel={t('designerDone')} className={css.dialog ?? ''} onClose={close}
    description={t('designerCleanUpImagesDescription')}
    footer={<div className={css.footer}>
      {files.length ? <>
        <Button variant="outline" disabled={removing} onClick={close}>{t('cancel')}</Button>
        <Button variant="primary" disabled={removing} onClick={() => { confirm(files) }}>
          {removing ? t('designerCleanUpImagesDeleting') : t('designerCleanUpImagesDelete')}</Button>
      </> : <Button variant="primary" onClick={close}>{t('designerDone')}</Button>}
    </div>}>
    <div className={css.body}>
      {state.kind === 'scanning' ? <p role="status">{t('designerCleanUpImagesScanning')}</p> : null}
      {state.kind === 'failed' ? <p role="alert" className={css.error}>{t('designerCleanUpImagesFailed').replace('{error}', state.message)}</p> : null}
      {state.kind === 'ready' && !files.length ? <p role="status">{t('designerCleanUpImagesNone')}</p> : null}
      {files.length ? <section className={css.card} aria-label={t('designerCleanUpImagesFoundLabel')}>
        <h3>{t('designerCleanUpImagesFoundLabel')}</h3>
        <p className={css.summary}>{t('designerCleanUpImagesFound').replace('{count}', String(files.length))
          .replace('{size}', formatDesignerImageBytes(total(files)))}</p>
        <ul className={css.thumbnails}>
          {files.slice(0, PREVIEW_LIMIT).map(file => <Thumbnail key={file.fileName} fileName={file.fileName} />)}
        </ul>
        {files.length > PREVIEW_LIMIT ? <p className={css.hint}>
          {t('designerCleanUpImagesMore').replace('{count}', String(files.length - PREVIEW_LIMIT))}</p> : null}
        <p className={css.hint}>{t('designerCleanUpImagesWarning')}</p>
      </section> : null}
      {state.kind === 'done' ? <p role="status">{t('designerCleanUpImagesDone').replace('{count}', String(state.removed.length))
        .replace('{size}', formatDesignerImageBytes(total(state.removed)))}</p> : null}
      {state.kind === 'done' && state.removed.length < state.confirmed ? <p className={css.hint}>{t('designerCleanUpImagesKept')}</p> : null}
    </div>
  </Modal>
}
