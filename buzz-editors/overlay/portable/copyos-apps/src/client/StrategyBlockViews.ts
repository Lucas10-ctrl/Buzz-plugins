/** Strategy decision and page-section cards; the fenced JSON stays the editable source and controls never enter it. */
import type { NodeViewRendererProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseStrategyDecision, parseStrategySectionMarker, STRATEGY_DECISION_FENCE, STRATEGY_SECTION_FENCE,
  type StrategyDocDecision, type StrategyDocDesign, type StrategyDocSectionMarker } from '../../../copyos-domain/src/docs-strategy.ts'
import { renderStrategySectionHtml, strategyDesignSlots, STRATEGY_TEMPLATE_IDS } from '../../../copyos-domain/src/strategy-templates.ts'
import type { CopyOSPageSectionTemplateId } from '../../../copyos-domain/src/types.ts'
import type { strategyEn } from './locales/strategy.ts'
import css from './StrategyBlocks.module.css'

type Translate = PropsLocale<'copyosFoundation'>['t']
type StrategyKey = keyof typeof strategyEn

const STATUS_KEYS: Readonly<Record<StrategyDocDecision['status'], StrategyKey>> = {
  suggested: 'strategyStatusSuggested', confirmed: 'strategyStatusConfirmed', stale: 'strategyStatusStale',
}
const TEMPLATE_KEYS: Readonly<Record<CopyOSPageSectionTemplateId, StrategyKey>> = {
  'hero-split': 'strategyTemplateHeroSplit', 'hero-centered': 'strategyTemplateHeroCentered', 'hero-editorial': 'strategyTemplateHeroEditorial',
  'proof-bar': 'strategyTemplateProofBar', 'proof-metrics': 'strategyTemplateProofMetrics', 'benefit-grid': 'strategyTemplateBenefitGrid',
  'benefit-steps': 'strategyTemplateBenefitSteps', testimonial: 'strategyTemplateTestimonial', 'testimonial-pair': 'strategyTemplateTestimonialPair',
  comparison: 'strategyTemplateComparison', pricing: 'strategyTemplatePricing', faq: 'strategyTemplateFaq', 'cta-banner': 'strategyTemplateCtaBanner',
  'cta-proof': 'strategyTemplateCtaProof', 'custom-html': 'strategyTemplateCustom',
}
const SLOT_KEYS: Readonly<Record<string, StrategyKey>> = {
  eyebrow: 'strategySlotEyebrow', headline: 'strategySlotHeadline', subheadline: 'strategySlotSubheadline', button: 'strategySlotButton',
  items: 'strategySlotItems', quote: 'strategySlotQuote', name: 'strategySlotName', quote2: 'strategySlotQuote2', name2: 'strategySlotName2',
  proof: 'strategySlotProof', notes: 'strategySlotNotes',
}

/**
 * Report whether a code-block language renders as a strategy card.
 * @param language - Code-block language attribute.
 * @returns True for decision and page-section fences.
 */
export function isStrategyFence(language: unknown): boolean {
  const name = String(language).toLowerCase()
  return name === STRATEGY_DECISION_FENCE || name === STRATEGY_SECTION_FENCE
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

interface Frame {
  readonly dom: HTMLDivElement
  readonly head: HTMLDivElement
  readonly sourceButton: HTMLButtonElement
  readonly error: HTMLParagraphElement
  readonly pre: HTMLPreElement
  readonly code: HTMLElement
}
function frame(t: Translate, language: string): Frame {
  const dom = element('div', css.card), head = element('div', css.head), sourceButton = element('button')
  const error = element('p', css.error), pre = element('pre', css.source), code = element('code')
  head.contentEditable = 'false'; error.contentEditable = 'false'; error.setAttribute('role', 'status')
  sourceButton.type = 'button'; sourceButton.textContent = t('strategyShowSource')
  code.className = `language-${language}`; pre.appendChild(code)
  return { dom, head, sourceButton, error, pre, code }
}
function replaceSource(view: NodeViewRendererProps['view'], position: number, node: ProseMirrorNode, source: string) {
  return view.state.tr.insertText(source, position + 1, position + 1 + node.content.size)
}

/**
 * Build the decision card around one `copyos-decision` code node.
 * Confirming a different option than the confirmed or stale one marks later confirmed decisions in the same tab stale.
 * @param props - Tiptap-owned node, view and position lifecycle.
 * @param t - Current interface dictionary.
 * @returns Node view whose source edits and confirmations go through editor transactions.
 */
export function strategyDecisionView(props: NodeViewRendererProps, t: Translate): NodeView {
  const { editor, getPos, view } = props
  let current = props.node, data: StrategyDocDecision | undefined, rendered: string | undefined
  let sourceMode = false, changing = false, picked: string | undefined
  const { dom, head, sourceButton, error, pre, code } = frame(t, STRATEGY_DECISION_FENCE)
  const kind = element('span', css.kind), status = element('span', css.status)
  head.append(kind, status, sourceButton)
  const body = element('div', css.body), question = element('p', css.question), options = element('div', css.options)
  body.contentEditable = 'false'
  options.setAttribute('role', 'radiogroup')
  const actions = element('div', css.actions), confirm = element('button', css.primary), change = element('button', css.quiet)
  const cancel = element('button', css.quiet), hint = element('p', css.hint)
  confirm.type = change.type = cancel.type = 'button'
  change.textContent = t('strategyChangeDecision'); cancel.textContent = t('strategyCancelChange')
  actions.append(confirm, change, cancel, hint); body.append(question, options, actions)
  dom.append(head, body, error, pre)

  const selecting = (): boolean => !!data && editor.isEditable && (data.status !== 'confirmed' || changing)
  const selected = (): string | undefined => data && (selecting() ? picked ?? data.chosen ?? data.recommended : data.chosen)
  const render = (): void => {
    dom.dataset.status = data?.status ?? 'invalid'
    kind.textContent = t('strategyDecision')
    status.hidden = !data; status.textContent = data ? t(STATUS_KEYS[data.status]) : ''
    error.hidden = !!data; error.textContent = data ? '' : t('strategyDecisionInvalid')
    body.hidden = !data || sourceMode; pre.hidden = !!data && !sourceMode
    sourceButton.textContent = t(sourceMode ? 'strategyShowCard' : 'strategyShowSource'); sourceButton.hidden = !data
    if (data) pre.setAttribute('data-doc-print-exclude', ''); else pre.removeAttribute('data-doc-print-exclude')
    if (!data) return
    question.textContent = data.question
    options.setAttribute('aria-label', data.question)
    const choice = selected()
    const active = document.activeElement
    const focused = active instanceof HTMLElement && options.contains(active) ? active.dataset.option : undefined
    options.replaceChildren(...data.options.map((option) => {
      const button = element('button', css.option), title = element('span', css.optionTitle), text = element('div', css.optionBody)
      button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(option.id === choice))
      button.disabled = !selecting(); button.dataset.option = option.id
      title.append(option.label)
      if (option.id === data?.recommended) title.append(element('span', css.recommended, t('strategyRecommended')))
      if (option.detail) text.append(element('p', undefined, option.detail))
      if (option.reasons.length) {
        const list = element('ul')
        for (const reason of option.reasons) list.append(element('li', undefined, reason))
        text.append(list)
      }
      if (option.sections) {
        const list = element('ol', css.outline)
        list.setAttribute('aria-label', t('strategyOptionSections'))
        for (const section of option.sections) {
          const item = element('li', undefined, `${section.name} `)
          if (section.purpose) item.append(element('small', undefined, section.purpose))
          list.append(item)
        }
        text.append(list)
      }
      button.append(element('span', css.radio), title, text)
      button.onclick = () => { if (selecting()) { picked = option.id; render() } }
      return button
    }))
    if (focused) options.querySelector<HTMLElement>(`[data-option="${focused}"]`)?.focus()
    const label = data.options.find(option => option.id === choice)?.label ?? ''
    confirm.textContent = t('strategyConfirmOption', { label })
    confirm.hidden = !selecting() || (data.status === 'confirmed' && choice === data.chosen)
    change.hidden = !editor.isEditable || data.status !== 'confirmed' || changing
    cancel.hidden = !changing
    actions.hidden = confirm.hidden && change.hidden && cancel.hidden && data.status !== 'stale'
    hint.textContent = data.status === 'stale' ? t('strategyStaleHint') : changing ? t('strategyChangeHint') : ''
    hint.hidden = hint.textContent === ''
  }
  const update = (): void => {
    if (rendered !== current.textContent) {
      rendered = current.textContent
      try { data = parseStrategyDecision(current.textContent) }
      catch (invalid: unknown) { void invalid; data = undefined } // Invalid source stays visible and editable as code.
      if (!data) sourceMode = false
    }
    render()
  }
  confirm.onclick = () => {
    const position = getPos(), chosen = selected()
    if (!editor.isEditable || !data || position === undefined || chosen === undefined) return
    const next = { ...data, status: 'confirmed' as const, chosen: chosen as StrategyDocDecision['recommended'] }
    let tr = view.state.tr
    if (data.chosen !== undefined && data.chosen !== chosen) {
      const later: { position: number; node: ProseMirrorNode; decision: StrategyDocDecision }[] = []
      view.state.doc.descendants((node, offset) => {
        const language = String(node.attrs.language).toLowerCase()
        if (offset <= position || node.type !== current.type || language !== STRATEGY_DECISION_FENCE) return
        try {
          const decision = parseStrategyDecision(node.textContent)
          if (decision.status === 'confirmed') later.push({ position: offset, node, decision })
        } catch (invalid: unknown) { void invalid } // Invalid decisions have no confirmation to mark stale.
      })
      for (const item of later.reverse())
        tr = tr.insertText(JSON.stringify({ ...item.decision, status: 'stale' }, null, 2), item.position + 1, item.position + 1 + item.node.content.size)
    }
    tr = tr.insertText(JSON.stringify(next, null, 2), position + 1, position + 1 + current.content.size)
    changing = false; picked = undefined
    view.dispatch(tr)
  }
  change.onclick = () => { changing = true; picked = undefined; render() }
  cancel.onclick = () => { changing = false; picked = undefined; render() }
  sourceButton.onclick = () => {
    sourceMode = !sourceMode; render()
    const position = getPos()
    if (sourceMode && editor.isEditable && position !== undefined) editor.chain().focus().setTextSelection(position + 1).run()
  }
  const permissions = new MutationObserver(render)
  permissions.observe(view.dom, { attributes: true, attributeFilter: ['contenteditable'] })
  update()
  return { dom, contentDOM: code,
    update: (next) => {
      if (next.type !== current.type || String(next.attrs.language).toLowerCase() !== STRATEGY_DECISION_FENCE) return false
      current = next; update(); return true
    },
    stopEvent: event => event.target instanceof globalThis.Node && !pre.contains(event.target),
    ignoreMutation: mutation => mutation.type !== 'selection' && !code.contains(mutation.target),
    destroy: () => { permissions.disconnect() },
  }
}

/** One section saved in the Builder's shared section library. */
export interface StrategyLibrarySection { readonly id: string; readonly title: string; readonly category: string; readonly html: string }

let libraryLoader: (() => Promise<readonly StrategyLibrarySection[]>) | undefined

/**
 * Supply the Builder's shared section library to section design cards.
 * @param loader - Reads the library when a card's gallery opens.
 * @returns Disposer that removes this loader.
 */
export function provideStrategyDesignLibrary(loader: () => Promise<readonly StrategyLibrarySection[]>): () => void {
  libraryLoader = loader
  return () => { if (libraryLoader === loader) libraryLoader = undefined }
}

function preview(html: string, label: string | undefined): HTMLDivElement {
  // Section HTML renders inert: no scripts, no same-origin access, scaled down from a 720 px wide viewport.
  const frameBox = element('div', css.preview), iframe = element('iframe')
  iframe.setAttribute('sandbox', ''); iframe.tabIndex = -1
  if (label === undefined) frameBox.setAttribute('aria-hidden', 'true'); else iframe.setAttribute('aria-label', label)
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;color:#111}</style></head><body>${html}</body></html>`
  frameBox.append(iframe)
  return frameBox
}

/**
 * Build the section design card around one `copyos-section` marker: a preview of the suggested or chosen Builder design,
 * the copy fields it reads, and a gallery of Builder templates and library sections. Choosing or keeping a design confirms it.
 * @param props - Tiptap-owned node, view and position lifecycle.
 * @param t - Current interface dictionary.
 * @returns Node view whose design changes go through editor transactions.
 */
export function strategySectionView(props: NodeViewRendererProps, t: Translate): NodeView {
  const { editor, getPos, view } = props
  let current = props.node, marker: StrategyDocSectionMarker | undefined, rendered: string | undefined, sourceMode = false
  let browsing = false, library: readonly StrategyLibrarySection[] | undefined, libraryFailed = false
  const { dom, head, sourceButton, error, pre, code } = frame(t, STRATEGY_SECTION_FENCE)
  const kind = element('span', css.kind, t('strategySection')), status = element('span', css.status)
  head.append(kind, status, sourceButton)
  const body = element('div', css.body), summary = element('div', css.design), currentPreview = element('div')
  const details = element('div', css.designDetails), name = element('p', css.designName), fields = element('p', css.fields)
  const actions = element('div', css.actions), use = element('button', css.primary), change = element('button', css.quiet)
  const gallery = element('div', css.gallery)
  body.contentEditable = 'false'
  use.type = change.type = 'button'
  use.textContent = t('strategyUseDesign')
  actions.append(use, change); details.append(name, fields, actions); summary.append(currentPreview, details)
  body.append(summary, gallery); dom.append(head, body, error, pre)

  const designName = (design: StrategyDocDesign): string => design.kind === 'template' ? t(TEMPLATE_KEYS[design.id]) : design.title
  const designHtml = (design: StrategyDocDesign): string | undefined => design.kind === 'template'
    ? renderStrategySectionHtml(design.id, designName(design), sampleFields(design))
    : library?.find(item => item.id === design.id)?.html
  const sampleFields = (design: StrategyDocDesign): Record<string, string> => Object.fromEntries(strategyDesignSlots(design).map((slot) => {
    const key = SLOT_KEYS[slot.key], label = key ? t(key) : slot.key
    return [slot.key, slot.kind === 'list' ? `${label} 1\n${label} 2\n${label} 3` : label]
  }))
  const choose = (design: StrategyDocDesign): void => {
    const position = getPos()
    if (!editor.isEditable || position === undefined) return
    browsing = false
    view.dispatch(replaceSource(view, position, current, JSON.stringify({ version: 1, design, status: 'confirmed' })))
  }
  const tile = (design: StrategyDocDesign, html: string | undefined): HTMLButtonElement => {
    const button = element('button', css.tile), label = designName(design)
    button.type = 'button'; button.setAttribute('aria-label', label)
    button.setAttribute('aria-pressed', String(JSON.stringify(design) === JSON.stringify(marker?.design)))
    if (html !== undefined) button.append(preview(html, undefined))
    button.append(element('span', undefined, label))
    button.onclick = () => { choose(design) }
    return button
  }
  let galleryKey: string | undefined, previewKey: string | undefined
  const renderGallery = (): void => {
    gallery.hidden = !browsing
    // Rebuilding a preview frame reloads it, so frames are replaced only when what they show changes.
    const key = browsing ? JSON.stringify([marker?.design, library?.map(item => item.id), libraryFailed, editor.isEditable]) : undefined
    if (key === galleryKey) return
    galleryKey = key
    if (!browsing) { gallery.replaceChildren(); return }
    const templates = element('div', css.tiles), saved = element('div', css.tiles)
    templates.append(...STRATEGY_TEMPLATE_IDS.map(id => tile({ kind: 'template', id }, designHtml({ kind: 'template', id }))))
    if (library === undefined) saved.append(element('p', css.hint, t(libraryFailed ? 'strategyLibraryFailed' : 'strategyLibraryLoading')))
    else if (!library.length) saved.append(element('p', css.hint, t('strategyLibraryEmpty')))
    else saved.append(...library.map(item => tile({ kind: 'library', id: item.id, title: item.title.slice(0, 160) }, item.html)))
    gallery.replaceChildren(element('h4', undefined, t('strategyBuilderTemplates')), templates, element('h4', undefined, t('strategyLibrary')), saved)
  }
  const loadLibrary = (): void => {
    if (library !== undefined || libraryLoader === undefined) {
      if (libraryLoader === undefined) { library = []; render() }
      return
    }
    libraryFailed = false
    void libraryLoader().then((sections) => { library = sections; render() }, (failure: unknown) => {
      void failure // The gallery shows the failure; templates remain available.
      libraryFailed = true; render()
    })
  }
  const render = (): void => {
    dom.dataset.status = marker?.status ?? 'invalid'
    status.hidden = !marker; status.textContent = marker ? t(marker.status === 'confirmed' ? 'strategyStatusConfirmed' : 'strategyStatusSuggested') : ''
    error.hidden = !!marker; error.textContent = marker ? '' : t('strategySectionInvalid')
    body.hidden = !marker || sourceMode; pre.hidden = !!marker && !sourceMode
    sourceButton.textContent = t(sourceMode ? 'strategyShowCard' : 'strategyShowSource'); sourceButton.hidden = !marker
    if (marker) pre.setAttribute('data-doc-print-exclude', ''); else pre.removeAttribute('data-doc-print-exclude')
    if (!marker) return
    const { design } = marker, html = designHtml(design)
    if (html !== previewKey) {
      previewKey = html
      currentPreview.replaceChildren(...(html === undefined ? [] : [preview(html, t('strategyDesignPreview', { name: designName(design) }))]))
    }
    name.textContent = designName(design)
    fields.textContent = `${t('strategySectionFields')}: ${strategyDesignSlots(design).map((slot) => {
      const key = SLOT_KEYS[slot.key]
      return key ? t(key) : slot.key
    }).join(' · ')}`
    use.hidden = !editor.isEditable || marker.status === 'confirmed' || browsing
    change.hidden = !editor.isEditable
    change.textContent = t(browsing ? 'strategyCancelChange' : 'strategyChangeDesign')
    renderGallery()
  }
  const update = (): void => {
    if (rendered !== current.textContent) {
      rendered = current.textContent
      try { marker = parseStrategySectionMarker(current.textContent) }
      catch (invalid: unknown) { void invalid; marker = undefined } // Invalid markers stay visible and editable as code.
      if (marker?.design.kind === 'library') loadLibrary()
    }
    render()
  }
  use.onclick = () => { if (marker) choose(marker.design) }
  change.onclick = () => { browsing = !browsing; if (browsing) loadLibrary(); render() }
  sourceButton.onclick = () => {
    sourceMode = !sourceMode; render()
    const position = getPos()
    if (sourceMode && editor.isEditable && position !== undefined) editor.chain().focus().setTextSelection(position + 1).run()
  }
  const permissions = new MutationObserver(render)
  permissions.observe(view.dom, { attributes: true, attributeFilter: ['contenteditable'] })
  update()
  return { dom, contentDOM: code,
    update: (next) => {
      if (next.type !== current.type || String(next.attrs.language).toLowerCase() !== STRATEGY_SECTION_FENCE) return false
      current = next; update(); return true
    },
    stopEvent: event => event.target instanceof globalThis.Node && !pre.contains(event.target),
    ignoreMutation: mutation => mutation.type !== 'selection' && !code.contains(mutation.target),
    destroy: () => { permissions.disconnect() },
  }
}
