/** Copy slots per page-section template and the HTML a strategy section becomes in the Page Builder. */

import type { CopyOSPageSectionTemplateId } from './types.ts'

/** How a copy slot is edited: one line, a paragraph, or one list item per line. */
export type CopyOSStrategySlotKind = 'text' | 'long' | 'list'

/** One named copy field of a section template. */
export interface CopyOSStrategySlot {
  readonly key: string
  readonly kind: CopyOSStrategySlotKind
}

const eyebrow: CopyOSStrategySlot = { key: 'eyebrow', kind: 'text' }
const headline: CopyOSStrategySlot = { key: 'headline', kind: 'text' }
const subheadline: CopyOSStrategySlot = { key: 'subheadline', kind: 'long' }
const button: CopyOSStrategySlot = { key: 'button', kind: 'text' }
const items: CopyOSStrategySlot = { key: 'items', kind: 'list' }

/**
 * Copy slots for every Page Builder section template, in display order.
 * Strategy tools, the strategy section card and `renderStrategySectionHtml` all read this one map.
 */
export const TEMPLATE_COPY_SLOTS: Readonly<Record<CopyOSPageSectionTemplateId, readonly CopyOSStrategySlot[]>> = {
  'hero-split': [eyebrow, headline, subheadline, button],
  'hero-centered': [eyebrow, headline, subheadline, button],
  'hero-editorial': [headline, subheadline],
  'proof-bar': [items],
  'proof-metrics': [items],
  'benefit-grid': [headline, items],
  'benefit-steps': [headline, items],
  'testimonial': [{ key: 'quote', kind: 'long' }, { key: 'name', kind: 'text' }],
  'testimonial-pair': [{ key: 'quote', kind: 'long' }, { key: 'name', kind: 'text' }, { key: 'quote2', kind: 'long' }, { key: 'name2', kind: 'text' }],
  'comparison': [headline, items],
  'pricing': [headline, subheadline, items, button],
  'faq': [headline, items],
  'cta-banner': [headline, button],
  'cta-proof': [headline, button, { key: 'proof', kind: 'text' }],
  'custom-html': [{ key: 'notes', kind: 'long' }],
}

/** Document heading that introduces each copy slot in a strategy page section; parsing also accepts the slot key. */
export const STRATEGY_SLOT_HEADINGS: Readonly<Record<string, string>> = {
  eyebrow: 'Eyebrow', headline: 'Headline', subheadline: 'Subheadline', button: 'Button', items: 'Items',
  quote: 'Quote', name: 'Name', quote2: 'Second quote', name2: 'Second name', proof: 'Proof', notes: 'Notes',
}

/** Copy slots of a section chosen from the Builder's shared section library, whose HTML has no declared slots. */
export const LIBRARY_COPY_SLOTS: readonly CopyOSStrategySlot[] = [headline, subheadline, items, button, { key: 'notes', kind: 'long' }]

/**
 * Copy slots of a strategy section design.
 * @param design - A Builder template or a shared library section.
 * @param design.kind - Whether the design is a Builder template or a library section.
 * @param design.id - Template id or library section id.
 * @returns Slots in display order.
 */
export function strategyDesignSlots(design: { readonly kind: 'template'; readonly id: CopyOSPageSectionTemplateId }
  | { readonly kind: 'library'; readonly id: string }): readonly CopyOSStrategySlot[] {
  return design.kind === 'template' ? TEMPLATE_COPY_SLOTS[design.id] : LIBRARY_COPY_SLOTS
}

/** Template ids in the order the section card offers them. */
export const STRATEGY_TEMPLATE_IDS = Object.keys(TEMPLATE_COPY_SLOTS) as readonly CopyOSPageSectionTemplateId[]

/**
 * Report whether a key is a copy slot of a template.
 * @param templateId - Section template.
 * @param key - Candidate field key.
 * @returns True when the template declares the slot.
 */
export function isTemplateSlot(templateId: CopyOSPageSectionTemplateId, key: string): boolean {
  return TEMPLATE_COPY_SLOTS[templateId].some(slot => slot.key === key)
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const lines = (value: string | undefined): readonly string[] => (value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
const text = (fields: Readonly<Record<string, string>>, key: string): string => escapeHtml((fields[key] ?? '').trim())

/**
 * Render one strategy section's copy into the plain, inline-styled HTML the Page Builder stores.
 * Empty slots are omitted; the Builder and Canvas restyle the result.
 * @param templateId - Section template.
 * @param name - Section name, used when a template has no headline slot.
 * @param fields - Copy slot values; unknown keys are ignored.
 * @returns One `<section>` element with a `data-strategy-template` attribute.
 */
export function renderStrategySectionHtml(templateId: CopyOSPageSectionTemplateId, name: string,
  fields: Readonly<Record<string, string>>): string {
  const wrap = (style: string, body: string): string =>
    `<section data-strategy-template="${templateId}" style="padding:64px 24px;font-family:system-ui;${style}">${body}</section>`
  const h = (tag: 'h1' | 'h2', key = 'headline'): string => text(fields, key) ? `<${tag} style="margin:0 0 16px">${text(fields, key)}</${tag}>` : ''
  const p = (key: string): string => text(fields, key) ? `<p style="margin:0 0 24px;font-size:18px;line-height:1.55">${text(fields, key)}</p>` : ''
  const cta = text(fields, 'button') ? `<a href="#cta" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#111;color:#fff;text-decoration:none">${text(fields, 'button')}</a>` : ''
  const list = (style: string): string => {
    const entries = lines(fields['items'])
    return entries.length ? `<ul style="list-style:none;padding:0;margin:24px auto 0;max-width:1000px;${style}">${entries.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''
  }
  const quote = (quoteKey: string, nameKey: string): string => text(fields, quoteKey)
    ? `<figure style="margin:0"><blockquote style="margin:0;font-size:24px;line-height:1.4">“${text(fields, quoteKey)}”</blockquote>${text(fields, nameKey) ? `<figcaption style="margin-top:12px">${text(fields, nameKey)}</figcaption>` : ''}</figure>`
    : ''
  switch (templateId) {
    case 'hero-split':
    case 'hero-centered':
    case 'hero-editorial': {
      const center = templateId === 'hero-centered' ? 'text-align:center;' : ''
      const kicker = text(fields, 'eyebrow') ? `<p style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.08em">${text(fields, 'eyebrow')}</p>` : ''
      return wrap(center, `${kicker}${h('h1')}${p('subheadline')}${cta}`)
    }
    case 'proof-bar':
      return wrap('padding:24px;text-align:center;', list('display:flex;flex-wrap:wrap;justify-content:center;gap:24px;margin:0 auto'))
    case 'proof-metrics':
      return wrap('text-align:center;', list('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px'))
    case 'benefit-grid':
    case 'comparison':
      return wrap('', `${h('h2')}${list('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px')}`)
    case 'benefit-steps':
    case 'faq':
      return wrap('', `${h('h2')}${list('display:grid;gap:12px')}`)
    case 'testimonial':
      return wrap('text-align:center;', quote('quote', 'name'))
    case 'testimonial-pair':
      return wrap('', `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px">${quote('quote', 'name')}${quote('quote2', 'name2')}</div>`)
    case 'pricing':
      return wrap('', `${h('h2')}${p('subheadline')}${list('display:grid;gap:8px')}<div style="margin-top:24px">${cta}</div>`)
    case 'cta-banner':
    case 'cta-proof': {
      const proof = text(fields, 'proof') ? `<p style="margin:16px 0 0">${text(fields, 'proof')}</p>` : ''
      return wrap('text-align:center;', `${h('h2')}${cta}${proof}`)
    }
    case 'custom-html':
      return wrap('', `<h2 style="margin:0 0 12px">${escapeHtml(name)}</h2>${p('notes')}`)
  }
}
