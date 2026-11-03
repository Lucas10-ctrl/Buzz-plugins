/** Strategy documents: decision and page-section blocks saved as fenced JSON inside Suite document Markdown. */
import { z } from 'zod'
import { STRATEGY_SLOT_HEADINGS, STRATEGY_TEMPLATE_IDS, strategyDesignSlots } from './strategy-templates.ts'
import type { CopyOSPageSectionTemplateId } from './types.ts'

/** Strategy decisions in document order; each one waits for the strategist's confirmation. */
export const STRATEGY_DOC_DECISIONS = ['metrics', 'hypothesis', 'idea', 'order'] as const
/** One strategy decision identity. */
export type StrategyDocDecisionId = typeof STRATEGY_DOC_DECISIONS[number]
/** Section label of each decision in the Strategy tab. */
export const STRATEGY_DOC_DECISION_LABELS: Readonly<Record<StrategyDocDecisionId, string>> = {
  metrics: 'Primary metrics', hypothesis: 'Hypothesis', idea: 'Big Idea', order: 'Section order',
}
/** Code-fence language of a decision block. */
export const STRATEGY_DECISION_FENCE = 'copyos-decision'
/** Code-fence language of a page-section design block. */
export const STRATEGY_SECTION_FENCE = 'copyos-section'

const line = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u0009\u000b-\u001f]/u.test(value),
  'Text must not contain control characters.')
const template = z.enum(STRATEGY_TEMPLATE_IDS as [CopyOSPageSectionTemplateId, ...CopyOSPageSectionTemplateId[]])
const optionId = z.enum(['a', 'b', 'c', 'd'])
const optionSchema = z.object({
  id: optionId,
  label: line(120),
  detail: z.string().max(600),
  reasons: z.array(line(300)).max(4),
  sections: z.array(z.object({ name: line(80), purpose: z.string().max(300) }).strict()).min(1).max(20).optional(),
}).strict()
const decisionSchema = z.object({
  version: z.literal(1),
  decision: z.enum(STRATEGY_DOC_DECISIONS),
  question: line(300),
  status: z.enum(['suggested', 'confirmed', 'stale']),
  recommended: optionId,
  chosen: optionId.optional(),
  options: z.array(optionSchema).min(1).max(4),
}).strict().superRefine((value, context) => {
  const ids = value.options.map(option => option.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Option ids must be unique.' })
  if (!ids.includes(value.recommended)) context.addIssue({ code: 'custom', path: ['recommended'], message: 'Recommend one of the options.' })
  if (value.chosen !== undefined && !ids.includes(value.chosen))
    context.addIssue({ code: 'custom', path: ['chosen'], message: 'The chosen option must be one of the options.' })
  if ((value.status === 'suggested') !== (value.chosen === undefined))
    context.addIssue({ code: 'custom', path: ['chosen'], message: 'Only confirmed or stale decisions have a chosen option.' })
  value.options.forEach((option, index) => {
    if ((value.decision === 'order') !== (option.sections !== undefined))
      context.addIssue({ code: 'custom', path: ['options', index, 'sections'],
        message: 'Section order options, and only those, list their sections.' })
  })
})
const designSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template'), id: template }).strict(),
  z.object({ kind: z.literal('library'), id: z.uuid(), title: line(160) }).strict(),
])
const sectionSchema = z.object({ version: z.literal(1), design: designSchema, status: z.enum(['suggested', 'confirmed']) }).strict()

/** One decision as saved in a `copyos-decision` fence; `chosen` is present once the strategist confirmed it. */
export type StrategyDocDecision = z.infer<typeof decisionSchema>
/** One option of a decision. */
export type StrategyDocOption = z.infer<typeof optionSchema>
/** A Builder section template or a section saved in the Builder's shared section library. */
export type StrategyDocDesign = z.infer<typeof designSchema>
/** Design marker saved in a `copyos-section` fence at the start of a page section. */
export type StrategyDocSectionMarker = z.infer<typeof sectionSchema>

/**
 * Parse the exact contents of a decision fence.
 * @param source - Fence contents without the fence lines.
 * @returns Validated decision.
 * @throws When JSON or fields are invalid.
 */
export function parseStrategyDecision(source: string): StrategyDocDecision {
  if (source.length > 20_000) throw new Error('This decision is too large.')
  return decisionSchema.parse(JSON.parse(source))
}

/**
 * Parse the exact contents of a page-section design fence.
 * @param source - Fence contents without the fence lines.
 * @returns Validated marker.
 * @throws When JSON, the design or the status is invalid.
 */
export function parseStrategySectionMarker(source: string): StrategyDocSectionMarker {
  return sectionSchema.parse(JSON.parse(source))
}

/**
 * Render a decision as its Markdown fence, with a trailing newline.
 * @param decision - Valid decision.
 * @returns Fenced JSON block.
 */
export function strategyDecisionMarkdown(decision: StrategyDocDecision): string {
  return `\`\`\`${STRATEGY_DECISION_FENCE}\n${JSON.stringify(decisionSchema.parse(decision), null, 2)}\n\`\`\`\n`
}

/**
 * Render a page-section design marker as its Markdown fence, without a trailing newline.
 * @param marker - Valid marker.
 * @returns Fenced JSON block.
 */
export function strategySectionMarkerMarkdown(marker: StrategyDocSectionMarker): string {
  return `\`\`\`${STRATEGY_SECTION_FENCE}\n${JSON.stringify(sectionSchema.parse(marker))}\n\`\`\``
}

/**
 * Render a page section's copy: one level-three heading per filled copy slot, in the design's slot order.
 * List slots become bullet lists, one item per non-empty line.
 * @param design - Section design whose slots apply.
 * @param fields - Copy keyed by slot; slots the design lacks are rejected.
 * @returns Markdown that follows the design marker.
 * @throws When a field names a slot the design does not have.
 */
export function strategySectionCopyMarkdown(design: StrategyDocDesign, fields: Readonly<Record<string, string>>): string {
  const slots = strategyDesignSlots(design)
  const unknown = Object.keys(fields).filter(key => !slots.some(slot => slot.key === key))
  if (unknown.length) {
    const name = design.kind === 'template' ? `Template ${design.id}` : 'A library section'
    throw new Error(`${name} has no ${unknown.join(', ')} slot. Its slots are ${slots.map(slot => slot.key).join(', ')}.`)
  }
  const parts: string[] = []
  for (const slot of slots) {
    const value = fields[slot.key]?.trim()
    if (!value) continue
    const body = slot.kind === 'list' ? value.split('\n').map(item => item.trim()).filter(Boolean).map(item => `- ${item}`).join('\n') : value
    parts.push(`### ${STRATEGY_SLOT_HEADINGS[slot.key] ?? slot.key}\n\n${body}`)
  }
  return parts.join('\n\n')
}

interface Fence { readonly language: string; readonly source: string; readonly start: number; readonly end: number }
function fences(markdown: string): Fence[] {
  const found: Fence[] = []
  for (const match of markdown.matchAll(/^```([\w-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gmu))
    found.push({ language: (match[1] ?? '').toLowerCase(), source: match[2] ?? '', start: match.index, end: match.index + match[0].length })
  return found
}

/** A valid decision fence located in one section's Markdown. */
export interface StrategyDocDecisionFence {
  readonly decision: StrategyDocDecision
  /** Exact fence text, including the fence lines. */
  readonly text: string
  /** Offset of the fence in the section Markdown. */
  readonly start: number
}

/**
 * Find valid decision fences in one section; invalid fences are skipped.
 * @param markdown - Section Markdown.
 * @returns Decisions in reading order.
 */
export function strategyDecisionFences(markdown: string): StrategyDocDecisionFence[] {
  return fences(markdown).filter(fence => fence.language === STRATEGY_DECISION_FENCE).flatMap((fence) => {
    try { return [{ decision: parseStrategyDecision(fence.source), text: markdown.slice(fence.start, fence.end), start: fence.start }] }
    catch (invalid: unknown) { void invalid; return [] } // Invalid fences render as code and never count as decisions.
  })
}

/** The first valid design marker located in one section's Markdown. */
export interface StrategyDocMarkerFence {
  readonly marker: StrategyDocSectionMarker
  /** Exact fence text, including the fence lines. */
  readonly text: string
  /** Offset of the fence in the section Markdown. */
  readonly start: number
  /** Offset just after the fence. */
  readonly end: number
}

/**
 * Find the first valid design marker in one section; invalid markers are skipped.
 * @param markdown - Section Markdown.
 * @returns The marker, or undefined.
 */
export function strategyMarkerFence(markdown: string): StrategyDocMarkerFence | undefined {
  for (const fence of fences(markdown).filter(item => item.language === STRATEGY_SECTION_FENCE)) {
    try {
      const marker = parseStrategySectionMarker(fence.source)
      return { marker, text: markdown.slice(fence.start, fence.end), start: fence.start, end: fence.end }
    }
    catch (invalid: unknown) { void invalid } // An invalid marker leaves an ordinary document section.
  }
  return undefined
}

function decisionMap(markdown: string): Map<StrategyDocDecisionId, StrategyDocDecision> {
  return new Map(strategyDecisionFences(markdown).map(fence => [fence.decision.decision, fence.decision]))
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Reject an assistant change to the strategist's confirmations in one section: confirming or marking stale a decision,
 * altering or removing a confirmed decision, confirming a section design, or changing or removing a confirmed design.
 * The assistant writes `suggested` decisions and designs and may replace a stale decision with a new suggestion.
 * @param before - Section Markdown before the assistant write.
 * @param after - Section Markdown the write would save.
 * @throws When the write changes the strategist's confirmations.
 */
export function assertAssistantStrategyEdit(before: string, after: string): void {
  const touched = (text: string): boolean => text.includes(STRATEGY_DECISION_FENCE) || text.includes(STRATEGY_SECTION_FENCE)
  if (!touched(before) && !touched(after)) return
  const refused = (): never => {
    throw new Error('Only the strategist can confirm a decision or section design, or change one they already confirmed. '
      + 'Write suggestions and ask them to confirm in the document.')
  }
  const previous = decisionMap(before), next = decisionMap(after)
  for (const [id, decision] of previous) {
    const changed = next.get(id)
    if (decision.status === 'confirmed' && (changed === undefined || !same(decision, changed))) refused()
  }
  for (const [id, decision] of next) {
    const prior = previous.get(id)
    if (decision.status !== 'suggested' && (prior === undefined || !same(prior, decision))) refused()
  }
  const priorMarker = strategyMarkerFence(before)?.marker, nextMarker = strategyMarkerFence(after)?.marker
  if (priorMarker?.status === 'confirmed' && !same(priorMarker, nextMarker)) refused()
  if (nextMarker?.status === 'confirmed' && !same(priorMarker, nextMarker)) refused()
}

/** One page section read from a strategy document. */
export interface StrategyDocSection {
  readonly blockId: string
  readonly name: string
  readonly design: StrategyDocDesign
  readonly status: StrategyDocSectionMarker['status']
  /** Copy keyed by slot; list slots hold one item per line. */
  readonly fields: Readonly<Record<string, string>>
  /** Level-three headings that match no slot of the design. */
  readonly unmatched: readonly string[]
}

/** Document section fields the strategy readers use. */
export interface StrategyDocBlock { readonly id: string; readonly label: string; readonly content: string }

/**
 * Read a page section from one document section that contains a valid `copyos-section` marker.
 * @param block - Document section; its label is the page section name.
 * @returns The section, or undefined when the Markdown has no valid marker.
 */
export function readStrategySection(block: StrategyDocBlock): StrategyDocSection | undefined {
  const found = strategyMarkerFence(block.content)
  if (!found) return undefined
  const { design, status } = found.marker, slots = strategyDesignSlots(design)
  const fields: Record<string, string> = {}, unmatched: string[] = []
  for (const part of block.content.slice(found.end).split(/^###[ \t]+/mu).slice(1)) {
    const newline = part.indexOf('\n'), heading = (newline < 0 ? part : part.slice(0, newline)).trim()
    const body = newline < 0 ? '' : part.slice(newline + 1).trim()
    const wanted = heading.toLowerCase()
    const slot = slots.find(item => item.key.toLowerCase() === wanted || (STRATEGY_SLOT_HEADINGS[item.key] ?? '').toLowerCase() === wanted)
    if (!slot) { unmatched.push(heading); continue }
    fields[slot.key] = slot.kind === 'list'
      ? body.split('\n').map(item => item.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, '').trim()).filter(Boolean).join('\n')
      : body
  }
  return { blockId: block.id, name: block.label, design, status, fields, unmatched }
}

/** Decisions and page sections of a strategy document. */
export interface StrategyDocReading {
  readonly decisions: ReadonlyMap<StrategyDocDecisionId, { readonly blockId: string; readonly decision: StrategyDocDecision }>
  readonly sections: readonly StrategyDocSection[]
}

/**
 * Read every valid decision and page section of a document, in document order; a later duplicate decision is ignored.
 * @param blocks - Document sections in reading order.
 * @returns Decisions by id and page sections.
 */
export function readStrategyDocument(blocks: readonly StrategyDocBlock[]): StrategyDocReading {
  const decisions = new Map<StrategyDocDecisionId, { blockId: string; decision: StrategyDocDecision }>()
  const sections: StrategyDocSection[] = []
  for (const block of blocks) {
    for (const fence of strategyDecisionFences(block.content))
      if (!decisions.has(fence.decision.decision)) decisions.set(fence.decision.decision, { blockId: block.id, decision: fence.decision })
    const section = readStrategySection(block)
    if (section) sections.push(section)
  }
  return { decisions, sections }
}

/**
 * List the document attachments a section links to, in order of first appearance.
 * @param markdown - Section Markdown.
 * @returns Attachment ids from `copyos-doc-asset:` links.
 */
export function strategySectionAttachments(markdown: string): readonly string[] {
  return [...new Set([...markdown.matchAll(/copyos-doc-asset:([a-f0-9]{64})(?![a-f0-9])/gu)].map(match => match[1] ?? ''))]
}

/** Stages of strategy work in order; each stage starts once every earlier stage is finished. */
export const STRATEGY_STAGES = ['why', 'metrics', 'data', 'hypothesis', 'idea', 'order', 'designs', 'copy'] as const
/** One strategy stage identity. */
export type StrategyStageId = typeof STRATEGY_STAGES[number]
/** Label of the first Strategy-tab section; a document whose main tab starts with it is a strategy document. */
export const STRATEGY_DOC_WHY_SECTION = 'What are we doing and why?'
/** Data analysis section label; the strategist uploads heatmaps, scrollmaps, surveys and polls here. */
export const STRATEGY_DOC_DATA_SECTION = 'Data analysis'
/** Conversion narrative section label; it follows the Big Idea decision in the same stage. */
export const STRATEGY_DOC_NARRATIVE_SECTION = 'Conversion narrative'
/** Strategy-tab sections each stage adds; the design and copy stages work in the Page tab instead. */
export const STRATEGY_STAGE_SECTIONS: Readonly<Record<StrategyStageId, readonly string[]>> = {
  why: [STRATEGY_DOC_WHY_SECTION], metrics: [STRATEGY_DOC_DECISION_LABELS.metrics], data: [STRATEGY_DOC_DATA_SECTION],
  hypothesis: [STRATEGY_DOC_DECISION_LABELS.hypothesis], idea: [STRATEGY_DOC_DECISION_LABELS.idea, STRATEGY_DOC_NARRATIVE_SECTION],
  order: [STRATEGY_DOC_DECISION_LABELS.order], designs: [], copy: [],
}
const STAGE_DECISIONS: Partial<Record<StrategyStageId, StrategyDocDecisionId>> = {
  metrics: 'metrics', hypothesis: 'hypothesis', idea: 'idea', order: 'order',
}

/** Document fields the stage reader uses. */
export interface StrategyStageDocument {
  readonly id: string
  readonly blocks: readonly (StrategyDocBlock & { readonly state: string; readonly tabId?: string | undefined })[]
}
/** Where a strategy document stands. */
export interface StrategyStageProgress {
  /** The first unfinished stage, or `copy` once every stage is finished. */
  readonly stage: StrategyStageId
  /** True when the stage's sections, or for the design and copy stages the page sections, exist. */
  readonly started: boolean
  /** True only when every stage, including `stage`, is finished. */
  readonly finished: boolean
}

/**
 * Report whether a document is a strategy document: its main tab starts with the "What are we doing and why?" section.
 * @param document - Saved document.
 * @returns True for documents made by `createStrategyDocument`.
 */
export function isStrategyDocument(document: StrategyStageDocument): boolean {
  return document.blocks.find(block => (block.tabId ?? document.id) === document.id)?.label === STRATEGY_DOC_WHY_SECTION
}

/**
 * Find the stage a strategy document is on. Written stages finish once their sections hold text; decisions finish once
 * confirmed; designs finish once every page section design is confirmed; copy finishes once every page section has copy.
 * @param document - Saved strategy document.
 * @returns The first unfinished stage and whether it has started.
 */
export function strategyStageProgress(document: StrategyStageDocument): StrategyStageProgress {
  const main = document.blocks.filter(block => (block.tabId ?? document.id) === document.id)
  const page = document.blocks.filter(block => (block.tabId ?? document.id) !== document.id)
  const { decisions } = readStrategyDocument(main)
  const sections = page.map(block => readStrategySection(block))
  const written = (label: string): boolean =>
    main.some(block => block.label === label && block.state === 'ready' && block.content.trim() !== '')
  const confirmed = (id: StrategyDocDecisionId): boolean => decisions.get(id)?.decision.status === 'confirmed'
  const designed = page.length > 0 && sections.every(section => section?.status === 'confirmed')
  const done: Record<StrategyStageId, boolean> = {
    why: written(STRATEGY_DOC_WHY_SECTION), metrics: confirmed('metrics'), data: written(STRATEGY_DOC_DATA_SECTION),
    hypothesis: confirmed('hypothesis'), idea: confirmed('idea') && written(STRATEGY_DOC_NARRATIVE_SECTION), order: confirmed('order'),
    designs: designed,
    copy: designed && page.every(block => block.state === 'ready') && sections.every(section => Object.keys(section?.fields ?? {}).length > 0),
  }
  const stage = STRATEGY_STAGES.find(id => !done[id])
  if (stage === undefined) return { stage: 'copy', started: true, finished: true }
  const started = stage === 'designs' ? page.length > 0 : stage === 'copy'
    ? sections.some(section => Object.keys(section?.fields ?? {}).length > 0)
    : STRATEGY_STAGE_SECTIONS[stage].every(label => main.some(block => block.label === label))
  return { stage, started, finished: false }
}

/**
 * Name the decision a stage asks the strategist to confirm.
 * @param stage - Strategy stage.
 * @returns The decision, or undefined for written, design and copy stages.
 */
export function strategyStageDecision(stage: StrategyStageId): StrategyDocDecisionId | undefined {
  return STAGE_DECISIONS[stage]
}
