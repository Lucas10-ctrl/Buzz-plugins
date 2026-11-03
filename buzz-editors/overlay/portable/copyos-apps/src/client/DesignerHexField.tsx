/** Paint hex drafts normalize shorthand and reject invalid values before mutation. */
import type { ReactNode } from 'react'
import { DesignerTextField } from './DesignerTextField.tsx'
/** Render a hex property with canonical display, commit, cancellation and invalid-draft reset.
 * @param props - Effective color, localized labels and literal mutation callback.
 * @returns An editable six-digit hex value; equal colors do not detach bindings.
 */
export function DesignerHexField({
  color,
  label,
  mixed,
  onCommit,
}: {
  color: string | null
  label: string
  mixed: string
  onCommit: (color: string) => void
}): ReactNode {
  return (
    <DesignerTextField
      label={label}
      placeholder={mixed}
      value={color?.replace('#', '').toUpperCase() ?? ''}
      suggestions={[]}
      normalize={(value) => {
        const hex = value.replace(/^#/, '')
        return /^[a-f\d]{6}$/i.test(hex)
          ? hex.toUpperCase()
          : /^[a-f\d]{3}$/i.test(hex)
            ? hex
              .split('')
              .map(c => c + c)
              .join('')
              .toUpperCase()
            : null
      }}
      onCommit={(hex) =>{  onCommit('#' + hex.toLowerCase()) }}
    />
  )
}
