/** Discoverable editor shortcuts use the shared dialog and preserve the document selection on close. */
import { useLayoutEffect, useRef } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocsWorkspace.module.css'

/** Show localized keyboard help for the document editor.
 * @param props - Locale and close callback restoring focus to the editor.
 * @returns A keyboard-focusable shortcut dialog.
 */
export function DocsShortcuts({ t, close }: PropsLocale<'copyosFoundation'> & { readonly close: () => void }) {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { content.current?.focus() }, [])
  const shortcuts = [
    [t('docsBold'), 'Ctrl / ⌘ B'], [t('docsItalic'), 'Ctrl / ⌘ I'], [t('docsLink'), 'Ctrl / ⌘ K'],
    [t('docsComment'), 'Ctrl Alt / ⌘ ⌥ M'], [t('docsAskAssistant'), 'Ctrl / ⌘ J'],
    [t('docsUndo'), 'Ctrl / ⌘ Z'], [t('docsRedo'), 'Ctrl / ⌘ Shift Z'],
    [t('docsSlash'), '/'], [t('docsShortcuts'), 'Ctrl / ⌘ /'],
  ]
  return <Modal open title={t('docsShortcuts')} closeLabel={t('docsClose')} onClose={close} className={css.shortcuts ?? ''} contentClassName={css.shortcutsContent ?? ''}
    onKeyDownCapture={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0], last = buttons.at(-1), active = document.activeElement
      if (!buttons.some(button => button === active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus()
      }
    }}>
    <div ref={content} tabIndex={-1}><dl className={css.shortcutList}>
      {shortcuts.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}
    </dl><p>{t('docsShortcutsHint')}</p></div>
  </Modal>
}
