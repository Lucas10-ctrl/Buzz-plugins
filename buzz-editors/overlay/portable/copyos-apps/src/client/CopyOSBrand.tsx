/** CopyOS occupants for the generic sidebar brand slots. */

import type { CSSProperties } from 'react'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CopyOSBrand.module.css'

/** Compact CopyOS monogram that follows the sidebar's requested size. */
export function CopyOSBrandMark({ size, t }: SidebarBrandMarkOwnerProps & PropsLocale<'copyosFoundation'>) {
  return <span className={css.mark} style={{ '--copyos-mark-size': `${size}px` } as CSSProperties}>{t('brandMark')}</span>
}

/** CopyOS wordmark without the independently slotted mark. */
export function CopyOSBrandName({ t }: PropsLocale<'copyosFoundation'>) {
  return <span className={css.name}>{t('brandName')}</span>
}
