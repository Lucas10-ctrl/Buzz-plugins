/** Canvas header tools in Builder's toolbar style: Templates, Import and Build from copy, then Comment, Mark and View comments. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip, IconPlusOutlineRegular, IconFolderOpenOutlineRegular, IconSparkleRegular, IconNewChatOutlineRegular,
  IconListPenOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

/** Canvas review interaction that owns pointer input on the canvas. */
export type DesignerReviewMode = 'comment' | 'mark' | null

/** One Import menu entry. */
export interface DesignerImportItem {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean | undefined
  readonly run: () => void
}

/**
 * Render the Canvas header tool group.
 * @param props - Translator, open panels, review mode, open comment count and the actions each button runs;
 *   an omitted action hides its button.
 * @returns The grouped header buttons.
 */
export function DesignerHeaderTools({ t, disabled, templatesOpen, onTemplates, importItems, buildOpen, onBuildFromCopy,
  reviewMode, onReviewMode, markAvailable, commentsOpen, onToggleComments, openComments }: {
  t: (key: CopyOSFoundationLocaleKey) => string
  disabled: boolean
  templatesOpen: boolean
  onTemplates?: (() => void) | undefined
  importItems: readonly DesignerImportItem[]
  buildOpen: boolean
  onBuildFromCopy?: (() => void) | undefined
  reviewMode: DesignerReviewMode
  onReviewMode: (mode: DesignerReviewMode) => void
  /** Mark needs a chat to send to. */
  markAvailable: boolean
  commentsOpen: boolean
  onToggleComments?: (() => void) | undefined
  openComments: number
}): ReactNode {
  const [importOpen, setImportOpen] = useState(false)
  const importMenu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!importOpen) return
    const close = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !importMenu.current?.contains(event.target)) setImportOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setImportOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [importOpen])
  const reviewing = onToggleComments !== undefined || markAvailable
  return (
    <div className={css.headerTools} aria-label={t('designerHeaderTools')}>
      {onTemplates ? <button type="button" className={css.headerAdd} data-active={templatesOpen} aria-pressed={templatesOpen}
        disabled={disabled} onClick={onTemplates}>
        <IconPlusOutlineRegular size={14} />{t('designerTemplates')}
      </button> : null}
      <div ref={importMenu} className={css.headerMenu}>
        <button type="button" className={css.headerAdd} aria-haspopup="menu" aria-expanded={importOpen}
          disabled={disabled || importItems.length === 0} onClick={() => { setImportOpen(open => !open) }}>
          <IconFolderOpenOutlineRegular size={14} />{t('designerImport')}<IconChevronDownOutlineRegular size={10} />
        </button>
        {importOpen ? <div role="menu" className={css.headerMenuBody}>
          {importItems.map(item => <button key={item.id} type="button" role="menuitem" disabled={item.disabled}
            onClick={() => { setImportOpen(false); item.run() }}>{item.label}</button>)}
        </div> : null}
      </div>
      {onBuildFromCopy ? <button type="button" className={css.headerAdd} data-active={buildOpen} aria-pressed={buildOpen}
        disabled={disabled} onClick={onBuildFromCopy}>
        <IconSparkleRegular size={14} />{t('designerBuildFromCopy')}
      </button> : null}
      {reviewing ? <span className={css.headerDivider} aria-hidden="true" /> : null}
      {onToggleComments ? <Tooltip label={t('builderComment')} portal side="bottom" delayMs={400}>
        <button type="button" className={css.headerIcon} aria-label={t('builderComment')} title={t('designerCommentHint')}
          data-active={reviewMode === 'comment'} aria-pressed={reviewMode === 'comment'} disabled={disabled}
          onClick={() => { onReviewMode(reviewMode === 'comment' ? null : 'comment') }}><IconNewChatOutlineRegular size={16} /></button>
      </Tooltip> : null}
      {markAvailable ? <Tooltip label={t('builderMark')} portal side="bottom" delayMs={400}>
        <button type="button" className={css.headerIcon} aria-label={t('builderMark')} title={t('designerMarkHint')}
          data-active={reviewMode === 'mark'} aria-pressed={reviewMode === 'mark'} disabled={disabled}
          onClick={() => { onReviewMode(reviewMode === 'mark' ? null : 'mark') }}><IconListPenOutlineRegular size={16} /></button>
      </Tooltip> : null}
      {onToggleComments ? <Tooltip label={t('builderComments')} portal side="bottom" delayMs={400}>
        <button type="button" className={css.headerIcon} aria-label={t('builderComments')} data-active={commentsOpen}
          aria-pressed={commentsOpen} disabled={disabled} onClick={onToggleComments}><span>{openComments}</span></button>
      </Tooltip> : null}
    </div>
  )
}
