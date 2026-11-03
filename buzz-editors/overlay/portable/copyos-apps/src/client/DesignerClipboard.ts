/** OS clipboard transport for lossless native scenes and explicitly converted Figma scenes. */
import { parseDesignClipboardSnapshot } from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSDesignClipboardSnapshot } from '../../../copyos-domain/src/types.ts'
/** Maximum decoded clipboard scene bytes admitted before parsing. */
export const DESIGN_CLIPBOARD_MAX_BYTES = 25_000_000
const maxEncoded = 4 * Math.ceil(DESIGN_CLIPBOARD_MAX_BYTES / 3)
const nativeMarker = 'copyos-design-clipboard'
/** Recognized OS scene formats; native data is fully admitted by importDesignClipboard. */
export type DesignerClipboardInput = { type: 'native'; snapshot: CopyOSDesignClipboardSnapshot } | { type: 'figma'; dataBase64: string }
function boundedBase64(value: string): string {
  if (!value.length || value.length > maxEncoded || value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid design clipboard encoding')
  const bytes = atob(value)
  if (bytes.length > DESIGN_CLIPBOARD_MAX_BYTES || btoa(bytes) !== value) throw new Error('Invalid design clipboard size')
  return bytes
}
/** Text controls and inline editing retain native browser clipboard behavior.
 * @param target - Event destination, including descendants of text editors.
 * @returns Whether browser text clipboard handling owns the event.
 */
export function designerClipboardEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')
}
/** Read recognized rich payloads only; arbitrary HTML/text never silently becomes a design.
 * @param html - HTML received from the OS clipboard.
 * @returns A bounded native snapshot or Figma container for host decoding.
 */
export function readDesignerClipboard(html: string): DesignerClipboardInput {
  if (html.length > maxEncoded + 4096) throw new Error('Design clipboard exceeds limit')
  const native = html.match(/\(copyos-design-clipboard\)([\s\S]*?)\(\/copyos-design-clipboard\)/)
  if (native?.[1]) {
    const bytes = Uint8Array.from(boundedBase64(native[1]), ch => ch.charCodeAt(0))
    const snapshot: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return { type: 'native', snapshot: parseDesignClipboardSnapshot(snapshot) }
  }
  const figma = html.match(/\(figma\)([\s\S]*?)\(\/figma\)/)
  if (!figma?.[1]) throw new Error('Unsupported design clipboard')
  const bytes = boundedBase64(figma[1])
  if (!bytes.startsWith('fig-kiwi')) throw new Error('Invalid Figma clipboard')
  return { type: 'figma', dataBase64: figma[1] }
}
/** Generate an independent native snapshot with readable plain text alongside the rich format.
 * @param snapshot - Native capture including reusable dependencies.
 * @returns Lossless HTML and readable plain text representations.
 */
export function writeDesignerClipboard(snapshot: CopyOSDesignClipboardSnapshot): { html: string; text: string } {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
  if (bytes.length > DESIGN_CLIPBOARD_MAX_BYTES) throw new Error('Design clipboard exceeds limit')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  const text = snapshot.selectedNodes.filter(node => snapshot.rootIds.includes(node.id)).map(node => node.kind === 'text' ? node.text : node.name).join('\n')
  return { html: `<meta charset="utf-8"><span data-copyos-design="<!--(${nativeMarker})${btoa(binary)}(/${nativeMarker})-->"></span>`, text }
}
/** OS permission failures are surfaced by the caller; there is no module-memory fallback.
 * @param snapshot - Valid native capture to publish to the OS clipboard.
 * @returns Settlement after the OS accepts both representations.
 */
export async function writeDesignerClipboardOS(snapshot: CopyOSDesignClipboardSnapshot): Promise<void> {
  const { html, text } = writeDesignerClipboard(snapshot)
  const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined
  if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') throw new Error('Clipboard write unavailable')
  await clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
}
/** Context menus can request clipboard access; keyboard paste uses its trusted PasteEvent.
 * @returns Bounded HTML from the OS clipboard, or a rejected permission/format error.
 */
export async function readDesignerClipboardOS(): Promise<string> {
  const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined
  if (!clipboard || typeof clipboard.read !== 'function') throw new Error('Clipboard read unavailable')
  const items = await clipboard.read()
  for (const item of items) if (item.types.includes('text/html')) {
    const blob = await item.getType('text/html')
    if (blob.size > maxEncoded + 4096) throw new Error('Design clipboard exceeds limit')
    return blob.text()
  }
  throw new Error('Unsupported design clipboard')
}
