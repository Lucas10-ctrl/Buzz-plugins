import type { CopyOSDocCommentAnchor } from '../../../copyos-domain/src/types.ts'
/** URL intent for Suite documents; the plugin publishes changes through its injected hook. */
export interface DocsRoute {
  readonly workspaceId: string
  readonly docId: string
  readonly tabId: string | null
  readonly threadId: string | null
  readonly passage: CopyOSDocCommentAnchor | null
  readonly token: string | undefined
}
/** Parse a complete Suite document link without carrying unrelated application fragments.
 * @param hash - Current URL fragment.
 * @returns Document navigation intent, or null for other application routes.
 */
export function readDocsRoute(hash: string): DocsRoute | null {
  const params = new URLSearchParams(hash.replace(/^#/u, '')), workspaceId = params.get('workspace'), docId = params.get('doc')
  if (params.get('suite') !== 'docs' || !workspaceId || !docId) return null
  const start = params.get('anchorStart'), end = params.get('anchorEnd')
  const encoded = (value: string | null): value is string => value !== null && value.length > 0
    && value.length <= 4000 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  return { workspaceId, docId, tabId: params.get('tab'), threadId: params.get('thread'),
    passage: encoded(start) && encoded(end) ? { start, end } : null, token: params.get('token') ?? undefined }
}
