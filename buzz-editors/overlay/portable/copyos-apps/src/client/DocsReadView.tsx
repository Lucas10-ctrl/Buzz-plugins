/** Document-specific read views retain tables and callouts without changing the shared Markdown renderer's HTML policy. */
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import css from './DocsWorkspace.module.css'
import { DocsRichBlock } from './DocsRichBlock.tsx'
const idle = (): void => {}
/** Render document body fragments with the same table and callout semantics as the editor.
 * @param props - Body text, current interface dictionary and standard Markdown labels.
 * @returns Read-only body; ordinary Markdown retains the lightweight shared renderer.
 */
export function DocsReadView({ text, labels, t, resolveAsset }: PropsLocale<'copyosFoundation'> & {
  readonly resolveAsset?: DocsAssetResolver | undefined
  readonly text: string
  readonly labels: Parameters<typeof MarkdownText>[0]['labels']
}): ReactNode {
  return <div className={css.readView}>{/<table(?:\s|>)/iu.test(text) || /copyos-doc-(?:asset|date|mention):/u.test(text)
    || /^\s*(?:`{3,}|~{3,})(?:mermaid|copyos-chart)(?:\s|$)/imu.test(text) || /^\s*>\s*\[!(?:NOTE|WARNING|TIP|IMPORTANT)\]/mu.test(text)
    ? <DocsRichBlock content={text} resolveAsset={resolveAsset} editable={false} t={t}
      onChange={idle} onExit={idle} onFocus={idle} onUndo={idle} onRedo={idle} />
    : <MarkdownText text={text} labels={labels} />}</div>
}
