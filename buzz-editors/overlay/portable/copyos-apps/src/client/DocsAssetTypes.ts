/** Shared browser attachment contracts; no editor or React dependencies. */
import type { CopyOSDocAsset } from '../../../copyos-domain/src/types.ts'
/** Verified attachment metadata plus a browser-local URL owned by the document model. */
export interface DocsAssetSource extends CopyOSDocAsset { readonly url: string }
/** Resolve one internal document reference through its current capability. */
export type DocsAssetResolver = (reference: string) => Promise<DocsAssetSource>
/** Stable internal URI stored by image nodes and attachment links.
 * @param asset - Uploaded attachment metadata.
 * @returns Document-scoped reference, never a filesystem path.
 */
export function docsAssetReference(asset: CopyOSDocAsset): string { return `copyos-doc-asset:${asset.id}` }
/** Portable source for appending uploaded files outside a specific rich-text selection.
 * @param asset - Uploaded attachment metadata.
 * @returns Markdown image or attachment link.
 */
export function docsAssetMarkdown(asset: CopyOSDocAsset): string {
  const label = asset.name.replace(/[\\[\]]/gu, '\\$&')
  return `${asset.image ? '!' : ''}[${label}](${docsAssetReference(asset)})`
}
