/** Explicit page semantics authored on native layers; omission keeps generic containers, paragraphs and layer-name image alternatives. */
import { z } from 'zod'
import { designTextHyperlinkSchema } from './design-text-hyperlink.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignSemanticCommand, CopyOSDesignSemanticElement, CopyOSDesignSemanticField }
  from './types.ts'

/** Heading elements admitted only on text layers. */
export const DESIGN_SEMANTIC_HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Landmark and sectioning elements admitted only on frame, group, component and instance containers. */
export const DESIGN_SEMANTIC_LANDMARKS = ['header', 'nav', 'main', 'footer', 'aside', 'section', 'article'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** List containers whose every child is a list item; admitted on containers only. */
export const DESIGN_SEMANTIC_LISTS = ['ul', 'ol'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Structural elements with parent or child requirements: list items, disclosures and their first-child summaries. */
export const DESIGN_SEMANTIC_STRUCTURE = ['li', 'details', 'summary'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Interactive elements: buttons on text or containers and modal dialogs on containers. */
export const DESIGN_SEMANTIC_CONTROLS = ['button', 'dialog'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Form elements: forms and fields on containers, labels on text layers. */
export const DESIGN_SEMANTIC_FORMS = ['form', 'input', 'textarea', 'label'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Input field types; omission submits plain text. */
export const DESIGN_SEMANTIC_FIELD_TYPES = ['text', 'email', 'tel', 'url', 'number'] as const satisfies
  readonly NonNullable<CopyOSDesignSemanticField['type']>[]
/** Maximum field name length in UTF-16 code units. */
export const DESIGN_SEMANTIC_FIELD_NAME_MAX_LENGTH = 100
/** Button actions; dialog commands target dialogs and the popover command targets popovers. */
export const DESIGN_SEMANTIC_COMMANDS = ['show-modal', 'close', 'toggle-popover'] as const satisfies readonly CopyOSDesignSemanticCommand['type'][]
/** Elements a popover container may also carry. */
export const DESIGN_SEMANTIC_POPOVER_ELEMENTS = ['nav', 'ul', 'ol'] as const satisfies readonly CopyOSDesignSemanticElement[]
/** Maximum exclusive disclosure group name length in UTF-16 code units. */
export const DESIGN_SEMANTIC_GROUP_MAX_LENGTH = 100
/** Maximum accessible-name length in UTF-16 code units. */
export const DESIGN_SEMANTIC_LABEL_MAX_LENGTH = 500

const containerKinds = new Set<CopyOSDesignNode['kind']>(['frame', 'group', 'component', 'instance'])
const headings = new Set<string>(DESIGN_SEMANTIC_HEADINGS), landmarks = new Set<string>(DESIGN_SEMANTIC_LANDMARKS)
const lists = new Set<string>(DESIGN_SEMANTIC_LISTS), popoverElements = new Set<string>(DESIGN_SEMANTIC_POPOVER_ELEMENTS)
const controlCharacters = /[\u0000-\u001F\u007F]/u
const fields = new Set<string>(['input', 'textarea'])

/** Strict stored semantics; at least one field is required so an empty record never claims ownership. */
export const designSemanticsSchema = z.object({
  element: z.enum([...DESIGN_SEMANTIC_HEADINGS, ...DESIGN_SEMANTIC_LANDMARKS, ...DESIGN_SEMANTIC_LISTS, ...DESIGN_SEMANTIC_STRUCTURE,
    ...DESIGN_SEMANTIC_CONTROLS, ...DESIGN_SEMANTIC_FORMS]).optional(),
  label: z.string().max(DESIGN_SEMANTIC_LABEL_MAX_LENGTH).refine(value => !controlCharacters.test(value), 'Accessible labels cannot contain control characters').optional(),
  link: designTextHyperlinkSchema.optional(),
  open: z.boolean().optional(),
  group: z.string().max(DESIGN_SEMANTIC_GROUP_MAX_LENGTH)
    .refine(value => value.trim() === value && value.length > 0 && !controlCharacters.test(value),
      'Disclosure group names are 1–100 characters without control characters or surrounding spaces').optional(),
  command: z.object({ type: z.enum(DESIGN_SEMANTIC_COMMANDS), target: z.string().min(1).max(200) }).strict().optional(),
  popover: z.literal(true).optional(),
  field: z.object({
    name: z.string().regex(new RegExp(`^[A-Za-z][A-Za-z0-9_.-]{0,${DESIGN_SEMANTIC_FIELD_NAME_MAX_LENGTH - 1}}$`),
      'Field names start with a letter and use 1–100 letters, digits, underscores, periods or hyphens'),
    type: z.enum(DESIGN_SEMANTIC_FIELD_TYPES).optional(),
    required: z.literal(true).optional(),
  }).strict().optional(),
  labelFor: z.string().min(1).max(200).optional(),
  submit: z.literal(true).optional(),
}).strict().refine(value => value.element !== undefined || value.label !== undefined || value.link !== undefined ||
  value.popover !== undefined,
'Semantics require an element, label, link or popover')

/**
 * Report kind and hierarchy conflicts that would otherwise produce invalid or misleading page markup.
 * @param document - Complete authored graph.
 * @param nodes - Stored node index for NODE destination and ancestor lookup.
 * @returns Human-readable issues; an empty list admits every stored semantics record.
 */
export function designSemanticsIssues(document: Pick<CopyOSDesignDocument, 'nodes'>, nodes: ReadonlyMap<string, CopyOSDesignNode>): string[] {
  const issues: string[] = []
  for (const node of document.nodes) {
    const semantics = node.semantics
    if (!semantics) continue
    if (node.pageLink) issues.push(`Linked Builder screens own their page semantics: ${node.name}`)
    if (semantics.element && headings.has(semantics.element) && node.kind !== 'text')
      issues.push(`Heading elements require a text layer: ${node.name}`)
    if (semantics.element && landmarks.has(semantics.element) && !containerKinds.has(node.kind))
      issues.push(`Landmark elements require a frame, group, component or instance: ${node.name}`)
    const element = semantics.element
    if (element && landmarks.has(element) && semantics.link)
      issues.push(`A landmark cannot also be a link; link a child layer instead: ${node.name}`)
    if (element && (lists.has(element) || element === 'details') && !containerKinds.has(node.kind))
      issues.push(`List and disclosure elements require a frame, group, component or instance: ${node.name}`)
    if (element && (lists.has(element) || element === 'details' || element === 'summary' || element === 'li' && node.kind !== 'text') && semantics.link)
      issues.push(`Structural elements cannot also be links; link a child layer instead: ${node.name}`)
    if ((element === 'li' || element === 'summary') && !containerKinds.has(node.kind) && node.kind !== 'text')
      issues.push(`List items and summaries require a text layer or a container: ${node.name}`)
    if (semantics.open !== undefined && element !== 'details') issues.push(`Only disclosures can be expanded by default: ${node.name}`)
    if (semantics.group !== undefined && element !== 'details') issues.push(`Only disclosures can join an exclusive group: ${node.name}`)
    if ((element === 'button' || element === 'dialog' || semantics.popover) && semantics.link)
      issues.push(`Buttons, dialogs and popovers cannot also be links; link a child layer instead: ${node.name}`)
    if (element === 'button' && !containerKinds.has(node.kind) && node.kind !== 'text')
      issues.push(`Buttons require a text layer or a container: ${node.name}`)
    if ((element === 'dialog' || semantics.popover) && (!containerKinds.has(node.kind) || node.parentId === null))
      issues.push(`Dialogs and popovers require a frame, group, component or instance inside an artboard: ${node.name}`)
    if (semantics.popover && element && !popoverElements.has(element))
      issues.push(`Popovers can only also be navigation or lists: ${node.name}`)
    if (semantics.command && element !== 'button') issues.push(`Only buttons can run commands: ${node.name}`)
    if (semantics.command && !nodes.has(semantics.command.target))
      issues.push(`Button commands require an existing stored layer: ${node.name}`)
    if (semantics.label !== undefined && node.kind !== 'image' && !semantics.link && element !== 'button' && element !== 'dialog' &&
      element !== 'form' && !(element && fields.has(element)) && !(element && landmarks.has(element)))
      issues.push(`Accessible labels require an image, a link, a button, a dialog, a landmark, a form or a field: ${node.name}`)
    if ((element === 'form' || element && fields.has(element)) && !containerKinds.has(node.kind))
      issues.push(`Forms and fields require a frame, group, component or instance: ${node.name}`)
    if (element === 'label' && node.kind !== 'text') issues.push(`Field labels require a text layer: ${node.name}`)
    if ((element === 'form' || element === 'label' || element && fields.has(element)) && semantics.link)
      issues.push(`Forms, fields and labels cannot also be links; link a child layer instead: ${node.name}`)
    if (element && fields.has(element) && !semantics.field) issues.push(`Fields require a submitted field name: ${node.name}`)
    if (semantics.field && !(element && fields.has(element))) issues.push(`Only inputs and text areas can define a field: ${node.name}`)
    if (semantics.field?.type && element !== 'input') issues.push(`Only inputs can choose a field type: ${node.name}`)
    if (semantics.labelFor !== undefined && element !== 'label') issues.push(`Only field labels can name a field: ${node.name}`)
    if (semantics.labelFor !== undefined && !nodes.has(semantics.labelFor))
      issues.push(`Field labels require an existing stored layer: ${node.name}`)
    if (semantics.submit && element !== 'button') issues.push(`Only buttons can submit forms: ${node.name}`)
    if (semantics.submit && semantics.command) issues.push(`A submit button cannot also run a command: ${node.name}`)
    if (semantics.label !== undefined && !semantics.label.trim() && node.kind !== 'image')
      issues.push(`Only images may declare an empty decorative label: ${node.name}`)
    if (semantics.link?.type === 'NODE' && !nodes.has(semantics.link.value))
      issues.push(`Layer link targets require an existing stored layer: ${node.name}`)
    if ((semantics.link || element === 'button') && node.kind === 'text' && node.textRuns?.some(run => run.style.hyperlink))
      issues.push(`A linked or button text layer cannot also contain inline text links: ${node.name}`)
    if (semantics.link || element === 'button') for (let parent = node.parentId ? nodes.get(node.parentId) : undefined, depth = 0;
      parent && depth < 10000; parent = parent.parentId ? nodes.get(parent.parentId) : undefined, depth++)
      if (parent.semantics?.link || parent.semantics?.element === 'button') {
        issues.push(`Links and buttons cannot contain other links or buttons: ${node.name}`); break
      }
    if (element === 'form' || element && fields.has(element)) for (let parent = node.parentId ? nodes.get(node.parentId) : undefined,
      depth = 0; parent && depth < 10000; parent = parent.parentId ? nodes.get(parent.parentId) : undefined, depth++) {
      const owner = parent.semantics?.element
      if (element === 'form' && owner === 'form') { issues.push(`Forms cannot contain other forms: ${node.name}`); break }
      if (element !== 'form' && (parent.semantics?.link || owner === 'button' || owner && fields.has(owner))) {
        issues.push(`Fields cannot be placed inside links, buttons or other fields: ${node.name}`); break
      }
    }
  }
  return issues
}

/**
 * Incomplete list, disclosure or overlay structure that blocks conversion but stays valid while the user authors it step by step.
 * `command-target` marks a button whose target is not a dialog (dialog commands) or popover (`toggle-popover`); `overlay-flow`
 * marks a dialog or popover that occupies auto-layout flow, which the page removes it from while it is closed. `label-target` marks a
 * label naming a layer that is not an input or text area, `submit-form` a submit button outside a form, and `field-content` a field
 * holding anything but one text layer, which becomes its placeholder.
 */
export interface DesignSemanticsStructureIssue {
  nodeId: string
  code: 'needs-list' | 'list-children' | 'summary-first' | 'details-summary' | 'command-target' | 'overlay-flow' | 'label-target'
    | 'submit-form' | 'field-content'
}
/**
 * Report stored list, disclosure and overlay gaps; conversion additionally checks visible and instance-expanded children.
 * @param document - Complete authored graph; child order is stored node order.
 * @returns One issue per affected layer and rule, in stored order.
 */
export function designSemanticsStructureIssues(document: Pick<CopyOSDesignDocument, 'nodes'>): DesignSemanticsStructureIssue[] {
  const issues: DesignSemanticsStructureIssue[] = [], children = new Map<string, CopyOSDesignNode[]>()
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  for (const node of document.nodes) if (node.parentId) children.set(node.parentId, [...children.get(node.parentId) ?? [], node])
  for (const node of document.nodes) {
    const element = node.semantics?.element, parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (element === 'li' && !(parent?.semantics?.element && lists.has(parent.semantics.element))) issues.push({ nodeId: node.id, code: 'needs-list' })
    if (element && lists.has(element) && (children.get(node.id) ?? []).some(child => child.semantics?.element !== 'li'))
      issues.push({ nodeId: node.id, code: 'list-children' })
    if (element === 'summary' && !(parent?.semantics?.element === 'details' && children.get(parent.id)?.[0]?.id === node.id))
      issues.push({ nodeId: node.id, code: 'summary-first' })
    if (element === 'details' && children.get(node.id)?.[0]?.semantics?.element !== 'summary')
      issues.push({ nodeId: node.id, code: 'details-summary' })
    const command = node.semantics?.command, target = command ? nodes.get(command.target)?.semantics : undefined
    if (command && (command.type === 'toggle-popover' ? !target?.popover : target?.element !== 'dialog'))
      issues.push({ nodeId: node.id, code: 'command-target' })
    if ((element === 'dialog' || node.semantics?.popover) && parent && !parent.preserveLayout &&
      ['row', 'column', 'grid'].includes(parent.layout) && !node.absolutePosition)
      issues.push({ nodeId: node.id, code: 'overlay-flow' })
    const labelled = node.semantics?.labelFor !== undefined ? nodes.get(node.semantics.labelFor)?.semantics?.element : undefined
    if (element === 'label' && node.semantics?.labelFor !== undefined && !(labelled && fields.has(labelled)))
      issues.push({ nodeId: node.id, code: 'label-target' })
    if (node.semantics?.submit) {
      let form = false
      for (let owner = parent, depth = 0; owner && depth < 10000; owner = owner.parentId ? nodes.get(owner.parentId) : undefined, depth++)
        if (owner.semantics?.element === 'form') { form = true; break }
      if (!form) issues.push({ nodeId: node.id, code: 'submit-form' })
    }
    const content = children.get(node.id) ?? []
    if (element && fields.has(element) && (content.length > 1 || content.some(child => child.kind !== 'text')))
      issues.push({ nodeId: node.id, code: 'field-content' })
  }
  return issues
}
