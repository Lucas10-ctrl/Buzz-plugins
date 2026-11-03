/** Image nodes persist internal references, captions and width while the model owns permission-checked bytes. */
import Image from '@tiptap/extension-image'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocsAssetResolver } from './DocsAssetTypes.ts'
import css from './DocsWorkspace.module.css'
const attribute = (value: string): string => value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
const imageElement = (element: HTMLElement): HTMLElement | null => element.tagName === 'FIGURE' ? element.querySelector('img') : element
/** Create a schema image with asynchronous, document-scoped loading and native caption controls.
 * @param t - Current interface dictionary.
 * @param resolve - Capability-aware resolver owned by the document model.
 * @returns Block image extension retaining caption and width in Markdown-compatible figure HTML.
 */
export function docsImage(t: PropsLocale<'copyosFoundation'>['t'], resolve: DocsAssetResolver): typeof Image {
  return Image.extend({
    addAttributes() {
      return {
        src: { default: '', parseHTML: element => imageElement(element)?.getAttribute('src') ?? '' },
        alt: { default: '', parseHTML: element => imageElement(element)?.getAttribute('alt') ?? '' },
        title: { default: '', parseHTML: element => imageElement(element)?.getAttribute('title') ?? '' },
        caption: { default: '', parseHTML: element => element.tagName === 'FIGURE' ? element.querySelector('figcaption')?.textContent ?? '' : '' },
        mode: { default: 'column', parseHTML: element => element.getAttribute('data-width') === 'wide' ? 'wide' : 'column' },
      }
    },
    parseHTML() { return [{ tag: 'figure[data-doc-image]' }, { tag: 'img[src]' }] },
    renderHTML({ node }) {
      return ['figure', { 'data-doc-image': 'true', 'data-width': node.attrs.mode === 'wide' ? 'wide' : 'column' },
        ['img', { src: String(node.attrs.src ?? ''), alt: String(node.attrs.alt ?? ''), title: String(node.attrs.title ?? '') }],
        ['figcaption', {}, String(node.attrs.caption ?? '')]]
    },
    renderMarkdown(node) {
      const src = attribute(String(node.attrs?.src ?? '')), alt = attribute(String(node.attrs?.alt ?? ''))
      const title = attribute(String(node.attrs?.title ?? ''))
      const caption = attribute(String(node.attrs?.caption ?? '')), mode = node.attrs?.mode === 'wide' ? 'wide' : 'column'
      return `<figure data-doc-image="true" data-width="${mode}"><img src="${src}" alt="${alt}" title="${title}"><figcaption>${caption}</figcaption></figure>`
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let current = node, source: string | undefined, generation = 0
        const dom = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption')
        dom.className = css.docImage ?? ''; dom.setAttribute('data-doc-image', 'true')
        const captionText = document.createElement('span'), input = document.createElement('input'), controls = document.createElement('div')
        captionText.className = css.imageCaptionRead ?? ''; input.className = css.imageCaptionInput ?? ''
        input.placeholder = t('docsAddCaption'); input.setAttribute('aria-label', t('docsImageCaption')); input.maxLength = 2000
        input.setAttribute('data-doc-print-exclude', ''); input.contentEditable = 'false'
        const status = document.createElement('div'), retry = document.createElement('button')
        status.className = css.imageStatus ?? ''; status.setAttribute('data-doc-print-exclude', ''); status.setAttribute('role', 'status')
        retry.type = 'button'; retry.textContent = t('docsRetry'); retry.hidden = true
        const message = document.createElement('span'); status.append(message, retry)
        controls.className = css.imageControls ?? ''; controls.contentEditable = 'false'; controls.setAttribute('data-doc-print-exclude', '')
        const change = (attrs: { mode?: string; caption?: string }): void => {
          const position = getPos()
          if (!editor.isEditable || position === undefined) return
          editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, ...attrs }))
        }
        for (const mode of ['column', 'wide']) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.mode = mode
          button.textContent = t(mode === 'wide' ? 'docsImageWide' : 'docsImageColumn')
          button.onclick = () => { change({ mode }) }; controls.appendChild(button)
        }
        input.oninput = () => { change({ caption: input.value }) }
        const load = (): void => {
          const request = ++generation; img.hidden = true; status.hidden = false; retry.hidden = true; message.textContent = t('docsImageLoading')
          if (!source || !/^copyos-doc-asset:[a-f0-9]{64}$/u.test(source)) {
            message.textContent = t('docsImageNeedsUpload'); return
          }
          void resolve(source).then((asset) => {
            if (request !== generation) return
            if (!asset.image) throw new Error('Attachment is not an image')
            img.src = asset.url; img.alt = String(current.attrs.alt || asset.name); img.hidden = false; status.hidden = true
          }).catch(() => { if (request === generation) { message.textContent = t('docsImageUnavailable'); retry.hidden = false } })
        }
        retry.onclick = load
        const update = (): void => {
          const value = String(current.attrs.caption ?? '')
          img.alt = String(current.attrs.alt ?? ''); img.title = String(current.attrs.title ?? '')
          captionText.textContent = value; if (input.value !== value) input.value = value
          caption.hidden = !value && !editor.isEditable
          const mode = current.attrs.mode === 'wide' ? 'wide' : 'column'; dom.dataset.width = mode
          for (const button of controls.querySelectorAll('button')) {
            button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
          }
          const reference = String(current.attrs.src ?? '')
          if (reference !== source) { source = reference; load() }
        }
        caption.append(captionText, input); dom.append(controls, status, img, caption); update()
        return { dom,
          update: (next) => { if (next.type !== current.type) return false; current = next; update(); return true },
          stopEvent: event => event.target instanceof globalThis.Node
            && (controls.contains(event.target) || caption.contains(event.target) || status.contains(event.target)),
          ignoreMutation: mutation => mutation.type !== 'selection',
          destroy: () => { generation++ },
        }
      }
    },
  })
}
