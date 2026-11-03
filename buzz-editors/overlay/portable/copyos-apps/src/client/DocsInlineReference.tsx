/** Local mention labels and calendar dates remain ordinary readable Markdown links. */
import { useState } from 'react'
import { Extension } from '@tiptap/core'
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocsWorkspace.module.css'

/** Reference values contain no account identity or notification authority. */
export type DocsInlineReference = { readonly kind: 'date' | 'mention'; readonly value: string }

/** Decode a supported local reference, rejecting malformed dates and escaped labels.
 * @param href - Stored Markdown destination.
 * @returns Valid local value, or undefined for ordinary and invalid links.
 */
export function readDocsInlineReference(href: string): DocsInlineReference | undefined {
  const match = /^copyos-doc-(date|mention):(.+)$/u.exec(href)
  if (!match) return undefined
  let value: string
  try { value = decodeURIComponent(match[2] ?? '') } catch (_error) { return undefined /* Malformed stored URI remains an ordinary link. */ }
  if (match[1] === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined
    const date = new Date(`${value}T12:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? { kind: 'date', value } : undefined
  }
  return value.trim() === value && value.length > 0 && value.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? { kind: 'mention', value } : undefined
}

/** Style valid reference links without adding another stored content representation. */
export const DocsInlineReferences = Extension.create({
  name: 'docsInlineReferences',
  addGlobalAttributes() {
    return [{ types: ['link'], attributes: { docReference: { default: null,
      renderHTML: (attributes) => {
        const reference = typeof attributes.href === 'string' ? readDocsInlineReference(attributes.href) : undefined
        return reference ? { 'data-doc-reference': reference.kind } : {}
      },
    } } }]
  },
})

/** Pick or inspect a reference; local mentions do not represent a people directory.
 * @param props - Current reference, edit permission, locale and commit/cancel actions.
 * @returns A shared accessible dialog with a native calendar or mention label input.
 */
export function DocsInlineReferencePicker({ reference, editable, error, save, close, t }: PropsLocale<'copyosFoundation'> & {
  readonly reference: DocsInlineReference
  readonly editable: boolean
  readonly error: string
  readonly save: (reference: DocsInlineReference) => void
  readonly close: () => void
}) {
  const [value, setValue] = useState(reference.value)
  const title = t(reference.kind === 'date' ? 'docsDate' : 'docsMention')
  const valid = readDocsInlineReference(`copyos-doc-${reference.kind}:${encodeURIComponent(value.trim())}`)
  return <Modal open title={title} closeLabel={t('docsClose')} onClose={close} onKeyDownCapture={(event) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    const first = controls[0], last = controls.at(-1), active = document.activeElement
    if (!controls.some(control => control === active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus()
    }
  }}>
    <form className={css.inlineReferenceForm} onSubmit={(event) => {
      event.preventDefault(); if (editable && valid) save(valid)
    }}>
      {reference.kind === 'mention' ? <p>{t('docsLocalMentionHint')}</p> : null}
      <label>{title}<input autoFocus type={reference.kind === 'date' ? 'date' : 'text'} aria-label={title}
        value={value} maxLength={reference.kind === 'date' ? undefined : 100} readOnly={!editable} required
        onInput={(event) => { setValue(event.currentTarget.value) }}
        onChange={(event) => { setValue(event.target.value) }} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div><Button type="button" variant="outline" onClick={close}>{t('docsClose')}</Button>
        {editable ? <Button type="submit" disabled={!valid}>{t('docsApplyReference')}</Button> : null}</div>
    </form>
  </Modal>
}
