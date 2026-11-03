/** Inspector section authoring explicit page-export semantics for one stored layer; nothing is inferred from layer names. */
import { useEffect, useState, type ReactNode } from 'react'
import {
  DESIGN_SEMANTIC_COMMANDS,
  DESIGN_SEMANTIC_CONTROLS,
  DESIGN_SEMANTIC_FIELD_NAME_MAX_LENGTH,
  DESIGN_SEMANTIC_FIELD_TYPES,
  DESIGN_SEMANTIC_FORMS,
  DESIGN_SEMANTIC_GROUP_MAX_LENGTH,
  DESIGN_SEMANTIC_HEADINGS,
  DESIGN_SEMANTIC_LABEL_MAX_LENGTH,
  DESIGN_SEMANTIC_LANDMARKS,
  DESIGN_SEMANTIC_LISTS,
  DESIGN_SEMANTIC_POPOVER_ELEMENTS,
  DESIGN_SEMANTIC_STRUCTURE,
  designSemanticsStructureIssues,
  designSemanticsIssues,
  designSemanticsSchema,
  designTextHyperlinkUrlAllowed,
  editDesignNodes,
} from '../../../copyos-domain/src/design-model.ts'
import type { DesignSemanticsStructureIssue } from '../../../copyos-domain/src/design-model.ts'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
  CopyOSDesignSemanticCommand,
  CopyOSDesignSemanticElement,
  CopyOSDesignSemanticField,
  CopyOSDesignSemantics,
  CopyOSDesignTextHyperlink,
} from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'

type Translate = (key: CopyOSFoundationLocaleKey) => string
type LinkMode = 'none' | CopyOSDesignTextHyperlink['type']

const headingLabels: Record<(typeof DESIGN_SEMANTIC_HEADINGS)[number], CopyOSFoundationLocaleKey> = {
  h1: 'designerSemanticsH1', h2: 'designerSemanticsH2', h3: 'designerSemanticsH3',
  h4: 'designerSemanticsH4', h5: 'designerSemanticsH5', h6: 'designerSemanticsH6',
}
const landmarkLabels: Record<(typeof DESIGN_SEMANTIC_LANDMARKS)[number], CopyOSFoundationLocaleKey> = {
  header: 'designerSemanticsHeader', nav: 'designerSemanticsNav', main: 'designerSemanticsMain',
  footer: 'designerSemanticsFooter', aside: 'designerSemanticsAside', section: 'designerSemanticsSection',
  article: 'designerSemanticsArticle',
}
type StructureElement = (typeof DESIGN_SEMANTIC_LISTS)[number] | (typeof DESIGN_SEMANTIC_STRUCTURE)[number]
// Ordered pairs keep locale keys out of copy-like property names checked by the UI copy gate.
const structureLabels = new Map<StructureElement, CopyOSFoundationLocaleKey>([['ul', 'designerSemanticsUl'], ['ol', 'designerSemanticsOl'],
  ['li', 'designerSemanticsLi'], ['details', 'designerSemanticsDetails'], ['summary', 'designerSemanticsSummary']])
const controlLabels = new Map<(typeof DESIGN_SEMANTIC_CONTROLS)[number], CopyOSFoundationLocaleKey>([
  ['button', 'designerSemanticsButton'], ['dialog', 'designerSemanticsDialog']])
const formLabels = new Map<(typeof DESIGN_SEMANTIC_FORMS)[number], CopyOSFoundationLocaleKey>([
  ['form', 'designerSemanticsForm'], ['input', 'designerSemanticsInput'], ['textarea', 'designerSemanticsTextarea'],
  ['label', 'designerSemanticsLabelElement']])
const fieldTypeLabels = new Map<NonNullable<CopyOSDesignSemanticField['type']>, CopyOSFoundationLocaleKey>([
  ['text', 'designerSemanticsFieldTypeText'], ['email', 'designerSemanticsFieldTypeEmail'], ['tel', 'designerSemanticsFieldTypeTel'],
  ['url', 'designerSemanticsFieldTypeUrl'], ['number', 'designerSemanticsFieldTypeNumber']])
const commandLabels = new Map<CopyOSDesignSemanticCommand['type'], CopyOSFoundationLocaleKey>([
  ['show-modal', 'designerSemanticsCommandOpen'], ['close', 'designerSemanticsCommandClose'],
  ['toggle-popover', 'designerSemanticsCommandToggle']])
const structureHints = new Map<DesignSemanticsStructureIssue['code'], CopyOSFoundationLocaleKey>([
  ['needs-list', 'designerSemanticsNeedsList'], ['list-children', 'designerSemanticsListChildren'],
  ['summary-first', 'designerSemanticsSummaryFirst'], ['details-summary', 'designerSemanticsDetailsSummary'],
  ['command-target', 'designerSemanticsCommandTarget'], ['overlay-flow', 'designerSemanticsOverlayFlow'],
  ['label-target', 'designerSemanticsLabelTargetIssue'], ['submit-form', 'designerSemanticsSubmitForm'],
  ['field-content', 'designerSemanticsFieldContent']])
const containerKinds = new Set<CopyOSDesignNode['kind']>(['frame', 'group', 'component', 'instance'])
const landmarks = new Set<string>(DESIGN_SEMANTIC_LANDMARKS), popoverElements = new Set<string>(DESIGN_SEMANTIC_POPOVER_ELEMENTS)
const elementValues = new Set<string>([...DESIGN_SEMANTIC_HEADINGS, ...DESIGN_SEMANTIC_LANDMARKS, ...DESIGN_SEMANTIC_LISTS,
  ...DESIGN_SEMANTIC_STRUCTURE, ...DESIGN_SEMANTIC_CONTROLS, ...DESIGN_SEMANTIC_FORMS])
const formElements = new Set<string>(DESIGN_SEMANTIC_FORMS)
const fieldElement = (element: CopyOSDesignSemanticElement | undefined): boolean => element === 'input' || element === 'textarea'
// Elements that cannot also be links; text list items may wrap their content in a link.
const unlinkable = (node: CopyOSDesignNode, element: CopyOSDesignSemanticElement | undefined): boolean =>
  !!element && (landmarks.has(element) || element === 'ul' || element === 'ol' || element === 'details' || element === 'summary' ||
    element === 'button' || element === 'dialog' || formElements.has(element) || element === 'li' && node.kind !== 'text')

/** First `field`, `field2`, … name no stored field uses; names are never derived from layer names. */
function unusedFieldName(doc: CopyOSDesignDocument): string {
  const used = new Set(doc.nodes.map(n => n.semantics?.field?.name))
  for (let index = 1; ; index++) {
    const name = index === 1 ? 'field' : `field${index}`
    if (!used.has(name)) return name
  }
}

function isElement(value: string): value is CopyOSDesignSemanticElement {
  return elementValues.has(value)
}

/** Element options for text layers or containers, in heading/landmark, structure, control and form order; fields need one layer. */
function elementOptions(text: boolean, t: Translate, fields = true): ReactNode {
  return <>
    {text
      ? DESIGN_SEMANTIC_HEADINGS.map(value => <option key={value} value={value}>{t(headingLabels[value])}</option>)
      : DESIGN_SEMANTIC_LANDMARKS.map(value => <option key={value} value={value}>{t(landmarkLabels[value])}</option>)}
    {(text ? (['li', 'summary'] as const) : ([...DESIGN_SEMANTIC_LISTS, ...DESIGN_SEMANTIC_STRUCTURE] as const))
      .map(value => <option key={value} value={value}>{t(structureLabels.get(value) ?? 'designerSemanticsLi')}</option>)}
    {(text ? (['button'] as const) : DESIGN_SEMANTIC_CONTROLS)
      .map(value => <option key={value} value={value}>{t(controlLabels.get(value) ?? 'designerSemanticsButton')}</option>)}
    {(text ? (['label'] as const) : fields ? (['form', 'input', 'textarea'] as const) : (['form'] as const))
      .map(value => <option key={value} value={value}>{t(formLabels.get(value) ?? 'designerSemanticsForm')}</option>)}
  </>
}

/** Drop fields left without a role so the stored record satisfies the at-least-one-field and label-owner rules. */
function normalize(node: CopyOSDesignNode, next: CopyOSDesignSemantics): CopyOSDesignSemantics | undefined {
  const landmark = !!next.element && landmarks.has(next.element)
  const labelled = node.kind === 'image' || !!next.link || landmark || next.element === 'button' || next.element === 'dialog' ||
    next.element === 'form' || fieldElement(next.element)
  const popover = !!next.popover && containerKinds.has(node.kind) && (!next.element || popoverElements.has(next.element))
  const result: CopyOSDesignSemantics = {
    ...(next.element ? { element: next.element } : {}),
    ...(next.link ? { link: next.link } : {}),
    ...(labelled && next.label !== undefined && (node.kind === 'image' || next.label.trim()) ? { label: next.label } : {}),
    ...(next.element === 'details' && next.open ? { open: true } : {}),
    ...(next.element === 'details' && next.group ? { group: next.group } : {}),
    ...(next.element === 'button' && next.submit ? { submit: true } : next.element === 'button' && next.command ? { command: next.command } : {}),
    ...(fieldElement(next.element) && next.field ? { field: {
      name: next.field.name,
      ...(next.element === 'input' && next.field.type && next.field.type !== 'text' ? { type: next.field.type } : {}),
      ...(next.field.required ? { required: true } : {}) } } : {}),
    ...(next.element === 'label' && next.labelFor ? { labelFor: next.labelFor } : {}),
    ...(popover ? { popover: true } : {}),
  }
  return result.element || result.link || result.label !== undefined || result.popover ? result : undefined
}

function sameSemantics(a: CopyOSDesignSemantics | undefined, b: CopyOSDesignSemantics | undefined): boolean {
  return a?.element === b?.element && a?.label === b?.label && a?.link?.type === b?.link?.type && a?.link?.value === b?.link?.value &&
    !!a?.open === !!b?.open && a?.group === b?.group && a?.command?.type === b?.command?.type &&
    a?.command?.target === b?.command?.target && !!a?.popover === !!b?.popover && a?.field?.name === b?.field?.name &&
    a?.field?.type === b?.field?.type && !!a?.field?.required === !!b?.field?.required && a?.labelFor === b?.labelFor &&
    !!a?.submit === !!b?.submit
}

/** Issues the candidate adds beyond those the current document already reports. */
function addedIssues(before: CopyOSDesignDocument, after: CopyOSDesignDocument): string[] {
  const remaining = designSemanticsIssues(before, new Map(before.nodes.map(n => [n.id, n])))
  return designSemanticsIssues(after, new Map(after.nodes.map(n => [n.id, n]))).filter((issue) => {
    const index = remaining.indexOf(issue)
    if (index < 0) return true
    remaining.splice(index, 1)
    return false
  })
}

/** Text draft that publishes on Enter or blur, reverts on Escape and keeps rejected values for correction. */
function DraftField({ label, value, maxLength = DESIGN_SEMANTIC_LABEL_MAX_LENGTH, disabled, invalid, onCommit }: {
  label: string
  value: string
  maxLength?: number
  disabled: boolean
  invalid: boolean
  onCommit: (value: string) => boolean
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const publish = () => {
    if (draft !== null && onCommit(draft)) setDraft(null)
  }
  return (
    <label className={css.field}>
      <span>{label}</span>
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={draft ?? value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onBlur={publish}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); publish() }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null); onCommit(value) }
        }}
      />
    </label>
  )
}

/** Author heading, landmark, link and accessible-name semantics for one selected stored layer.
 * @param props - Current document, selected stored node, disabled state (locked layer or pending text edit), copy and workspace commit.
 * @returns A Properties section, or null for linked Page Builder screens whose page owns its semantics.
 */
export function DesignerSemantics({ doc, node, disabled, t, commit }: {
  doc: CopyOSDesignDocument
  node: CopyOSDesignNode
  disabled: boolean
  t: Translate
  commit: (doc: CopyOSDesignDocument) => boolean
}): ReactNode {
  const semantics = node.semantics
  const link = semantics?.link
  const [linkMode, setLinkMode] = useState<LinkMode>(link?.type ?? 'none')
  const [search, setSearch] = useState('')
  const [problem, setProblem] = useState<CopyOSFoundationLocaleKey | null>(null)
  const [urlInvalid, setUrlInvalid] = useState(false)
  useEffect(() => {
    setLinkMode(link?.type ?? 'none')
    setUrlInvalid(false)
  }, [node.id, link?.type])
  useEffect(() => { setProblem(null) }, [node.id])
  if (node.pageLink) return null

  const text = node.kind === 'text', image = node.kind === 'image', container = containerKinds.has(node.kind)
  const landmark = !!semantics?.element && landmarks.has(semantics.element)
  const structural = !landmark && (unlinkable(node, semantics?.element) || !!semantics?.popover)
  const structure = designSemanticsStructureIssues(doc).filter(issue => issue.nodeId === node.id)
  const children = doc.nodes.filter(n => n.parentId === node.id)
  const inlineLinks = text && !!node.textRuns?.some(run => run.style.hyperlink)
  const byId = new Map(doc.nodes.map(n => [n.id, n]))
  let linkedAncestor = false
  for (let parent = node.parentId ? byId.get(node.parentId) : undefined, depth = 0; parent && depth < 10000;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined, depth++)
    if (parent.semantics?.link || parent.semantics?.element === 'button') { linkedAncestor = true; break }
  const descendants = new Set<string>([node.id])
  for (let grew = true; grew;) {
    grew = false
    for (const n of doc.nodes)
      if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) { descendants.add(n.id); grew = true }
  }
  const linkedDescendant = doc.nodes.some(n => n.id !== node.id && descendants.has(n.id) &&
    (!!n.semantics?.link || n.semantics?.element === 'button'))
  const linkBlocked = !link && (inlineLinks || linkedAncestor || linkedDescendant)

  const write = (next: CopyOSDesignSemantics): boolean => {
    const value = normalize(node, next)
    if (sameSemantics(value, semantics)) { setProblem(null); return true }
    if (value && !designSemanticsSchema.safeParse(value).success) { setProblem('designerSemanticsLabelInvalid'); return false }
    const candidate = editDesignNodes(doc, [{ id: node.id, semantics: value }])
    if (addedIssues(doc, candidate).length || !commit(candidate)) { setProblem('designerSemanticsRejected'); return false }
    setProblem(null)
    return true
  }
  const writeLink = (target: CopyOSDesignTextHyperlink | undefined): boolean => write({ ...semantics, link: target })
  // Only the layer-link picker lists other layers; large documents hold thousands.
  const query = search.toLowerCase()
  const choices = linkMode === 'NODE'
    ? doc.nodes.filter(n => n.id !== node.id && n.name.toLowerCase().includes(query)).slice(0, 100) : []
  const chosen = link?.type === 'NODE' && link.value !== node.id ? doc.nodes.find(n => n.id === link.value) : undefined
  const labelKey: CopyOSFoundationLocaleKey | null = image ? 'designerSemanticsAlt'
    : landmark ? 'designerSemanticsRegionName' : link ? 'designerSemanticsLinkName'
      : semantics?.element === 'button' ? 'designerSemanticsButtonName' : semantics?.element === 'dialog' ? 'designerSemanticsDialogName'
        : semantics?.element === 'form' ? 'designerSemanticsFormName' : fieldElement(semantics?.element) ? 'designerSemanticsFieldAccessibleName' : null
  const command = semantics?.command
  const commandTargets = command ? doc.nodes.filter(n => n.id !== node.id &&
    (command.type === 'toggle-popover' ? !!n.semantics?.popover : n.semantics?.element === 'dialog')) : []
  const fieldTargets = doc.nodes.filter(n => fieldElement(n.semantics?.element))
  const popoverAllowed = container && node.parentId !== null && (!semantics?.element || popoverElements.has(semantics.element))

  return (
    <section className={css.propertySection} aria-label={t('designerSemantics')}>
      <div className={css.sectionHeading}><h3>{t('designerSemantics')}</h3></div>
      <p className={css.hint}>{t('designerSemanticsHint')}</p>
      {text || container ? (
        <label className={css.field}>
          <span>{t('designerSemanticsElement')}</span>
          <select
            aria-label={t('designerSemanticsElement')}
            value={semantics?.element ?? ''}
            disabled={disabled}
            onChange={(event) => {
              const value = event.currentTarget.value
              const element = isElement(value) ? value : undefined
              if (unlinkable(node, element) && link) { setProblem('designerSemanticsLandmarkLinked'); return }
              const field = fieldElement(element) && !semantics?.field ? { field: { name: unusedFieldName(doc) } } : {}
              write({ ...semantics, element, ...field })
            }}
          >
            <option value="">{t(text ? 'designerSemanticsParagraph' : 'designerNone')}</option>
            {elementOptions(text, t)}
          </select>
        </label>
      ) : null}
      {semantics?.element === 'details' ? (
        <>
          <label className={css.check}>
            <input type="checkbox" checked={!!semantics.open} disabled={disabled}
              onChange={(event) => { write({ ...semantics, open: event.currentTarget.checked }) }} />
            {t('designerSemanticsExpanded')}
          </label>
          <DraftField
            key={`${node.id}:group`}
            label={t('designerSemanticsGroup')}
            value={semantics.group ?? ''}
            maxLength={DESIGN_SEMANTIC_GROUP_MAX_LENGTH}
            disabled={disabled}
            invalid={problem === 'designerSemanticsLabelInvalid'}
            onCommit={value => write({ ...semantics, group: value.trim() || undefined })}
          />
          <p className={css.hint}>{t('designerSemanticsGroupHint')}</p>
        </>
      ) : null}
      {semantics?.element === 'form' ? <p className={css.hint}>{t('designerSemanticsFormHint')}</p> : null}
      {fieldElement(semantics?.element) && semantics?.field ? (
        <>
          <DraftField
            key={`${node.id}:field-name`}
            label={t('designerSemanticsFieldKey')}
            value={semantics.field.name}
            maxLength={DESIGN_SEMANTIC_FIELD_NAME_MAX_LENGTH}
            disabled={disabled}
            invalid={problem === 'designerSemanticsFieldKeyInvalid'}
            onCommit={(value) => {
              const field = semantics.field
              if (!field) return false
              const next = { ...semantics, field: { ...field, name: value.trim() } }
              if (!designSemanticsSchema.safeParse(normalize(node, next)).success) { setProblem('designerSemanticsFieldKeyInvalid'); return false }
              return write(next)
            }}
          />
          {semantics.element === 'input' ? (
            <label className={css.field}>
              <span>{t('designerSemanticsFieldType')}</span>
              <select aria-label={t('designerSemanticsFieldType')} value={semantics.field.type ?? 'text'} disabled={disabled}
                onChange={(event) => {
                  const field = semantics.field, type = DESIGN_SEMANTIC_FIELD_TYPES.find(value => value === event.currentTarget.value)
                  if (field && type) write({ ...semantics, field: { ...field, type } })
                }}>
                {DESIGN_SEMANTIC_FIELD_TYPES.map(value => <option key={value} value={value}>{t(fieldTypeLabels.get(value) ?? 'designerSemanticsFieldTypeText')}</option>)}
              </select>
            </label>
          ) : null}
          <label className={css.check}>
            <input type="checkbox" checked={!!semantics.field.required} disabled={disabled}
              onChange={(event) => {
                const field = semantics.field
                if (field) write({ ...semantics, field: { ...field, required: event.currentTarget.checked || undefined } })
              }} />
            {t('designerSemanticsFieldRequired')}
          </label>
          <p className={css.hint}>{t('designerSemanticsFieldHint')}</p>
        </>
      ) : null}
      {semantics?.element === 'label' ? (
        <label className={css.field}>
          <span>{t('designerSemanticsLabelTarget')}</span>
          <select aria-label={t('designerSemanticsLabelTarget')} value={semantics.labelFor ?? ''} disabled={disabled}
            onChange={(event) => { write({ ...semantics, labelFor: event.currentTarget.value || undefined }) }}>
            <option value="">{t('designerSemanticsLabelTargetNone')}</option>
            {semantics.labelFor && !fieldTargets.some(n => n.id === semantics.labelFor)
              ? <option value={semantics.labelFor}>{byId.get(semantics.labelFor)?.name ?? semantics.labelFor}</option> : null}
            {fieldTargets.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
      ) : null}
      {semantics?.element === 'button' ? (
        <>
          <label className={css.check}>
            <input type="checkbox" checked={!!semantics.submit} disabled={disabled}
              onChange={(event) => { write({ ...semantics, submit: event.currentTarget.checked || undefined, command: undefined }) }} />
            {t('designerSemanticsSubmit')}
          </label>
          {semantics.submit ? null : <>
            <label className={css.field}>
              <span>{t('designerSemanticsCommand')}</span>
              <select aria-label={t('designerSemanticsCommand')} value={command?.type ?? ''} disabled={disabled}
                onChange={(event) => {
                  const type = DESIGN_SEMANTIC_COMMANDS.find(value => value === event.currentTarget.value)
                  if (!type) { write({ ...semantics, command: undefined }); return }
                  const fits = (n: CopyOSDesignNode) => n.id !== node.id &&
                    (type === 'toggle-popover' ? !!n.semantics?.popover : n.semantics?.element === 'dialog')
                  const target = command && byId.get(command.target), first = target && fits(target) ? target : doc.nodes.find(fits)
                  if (!first) { setProblem(type === 'toggle-popover' ? 'designerSemanticsNoPopover' : 'designerSemanticsNoDialog'); return }
                  write({ ...semantics, command: { type, target: first.id } })
                }}>
                <option value="">{t('designerNone')}</option>
                {DESIGN_SEMANTIC_COMMANDS.map(value => <option key={value} value={value}>{t(commandLabels.get(value) ?? 'designerNone')}</option>)}
              </select>
            </label>
            {command ? (
              <label className={css.field}>
                <span>{t('designerSemanticsCommandTargetLayer')}</span>
                <select aria-label={t('designerSemanticsCommandTargetLayer')} value={command.target} disabled={disabled}
                  onChange={(event) => { write({ ...semantics, command: { ...command, target: event.currentTarget.value } }) }}>
                  {commandTargets.some(n => n.id === command.target) ? null
                    : <option value={command.target}>{byId.get(command.target)?.name ?? command.target}</option>}
                  {commandTargets.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </label>
            ) : <p className={css.hint}>{t('designerSemanticsButtonHint')}</p>}
          </>}
        </>
      ) : null}
      {popoverAllowed ? (
        <>
          <label className={css.check}>
            <input type="checkbox" checked={!!semantics?.popover} disabled={disabled || !!link}
              onChange={(event) => { write({ ...semantics, popover: event.currentTarget.checked || undefined }) }} />
            {t('designerSemanticsPopover')}
          </label>
          {semantics?.popover ? <p className={css.hint}>{t('designerSemanticsPopoverHint')}</p> : null}
        </>
      ) : null}
      {structure.map(issue => <p key={issue.code} className={css.hint} role="status">
        {t(structureHints.get(issue.code) ?? 'designerSemanticsRejected')}</p>)}
      {structure.some(issue => issue.code === 'overlay-flow') ? (
        <button type="button" disabled={disabled} onClick={() => {
          if (!commit(editDesignNodes(doc, [{ id: node.id, absolutePosition: true }]))) setProblem('designerSemanticsRejected')
        }}>{t('designerSemanticsMakeAbsolute')}</button>
      ) : null}
      {structure.some(issue => issue.code === 'list-children') ? (
        <button type="button" disabled={disabled} onClick={() => {
          const items = children.filter(child => child.semantics?.element !== 'li' && !(child.semantics?.link && child.kind !== 'text'))
          const candidate = editDesignNodes(doc, items.map(child => ({ id: child.id, semantics: { ...child.semantics, element: 'li' as const,
            ...(child.semantics?.element && landmarks.has(child.semantics.element) ? { label: undefined } : {}) } })))
          if (addedIssues(doc, candidate).length || !commit(candidate)) setProblem('designerSemanticsRejected')
        }}>{t('designerSemanticsMakeItems')}</button>
      ) : null}
      {structure.some(issue => issue.code === 'details-summary') && children[0] && !(children[0].semantics?.link && children[0].kind !== 'text') ? (
        <button type="button" disabled={disabled} onClick={() => {
          const first = children[0]
          if (!first) return
          const candidate = editDesignNodes(doc, [{ id: first.id, semantics: { ...first.semantics, element: 'summary' as const, link: undefined, label: undefined } }])
          if (addedIssues(doc, candidate).length || !commit(candidate)) setProblem('designerSemanticsRejected')
        }}>{t('designerSemanticsMakeSummary')}</button>
      ) : null}
      {landmark || structural ? <p className={css.hint}>{t(landmark ? 'designerSemanticsLandmarkLinkHint' : 'designerSemanticsStructureLinkHint')}</p> : (
        <>
          <label className={css.field}>
            <span>{t('designerSemanticsLink')}</span>
            <select
              aria-label={t('designerSemanticsLink')}
              value={linkMode}
              disabled={disabled || linkBlocked}
              onChange={(event) => {
                const value = event.currentTarget.value
                const mode: LinkMode = value === 'URL' || value === 'NODE' ? value : 'none'
                setUrlInvalid(false)
                if (mode === 'none') { if (writeLink(undefined)) setLinkMode('none') } else setLinkMode(mode)
              }}
            >
              <option value="none">{t('designerNone')}</option>
              <option value="URL">{t('designerSemanticsLinkUrl')}</option>
              <option value="NODE">{t('designerSemanticsLinkLayer')}</option>
            </select>
          </label>
          {inlineLinks ? <p className={css.hint}>{t('designerSemanticsInlineLinkHint')}</p> : null}
          {!inlineLinks && !link && (linkedAncestor || linkedDescendant) ? <p className={css.hint}>{t('designerSemanticsNestedLinkHint')}</p> : null}
          {linkMode === 'URL' ? (
            <>
              <DraftField
                key={`${node.id}:url`}
                label={t('designerSemanticsUrl')}
                value={link?.type === 'URL' ? link.value : ''}
                disabled={disabled}
                invalid={urlInvalid}
                onCommit={(value) => {
                  const current = link?.type === 'URL' ? link.value : ''
                  if (value === current) { setUrlInvalid(false); return true }
                  if (!designTextHyperlinkUrlAllowed(value)) { setUrlInvalid(true); return false }
                  setUrlInvalid(false)
                  return writeLink({ type: 'URL', value })
                }}
              />
              {urlInvalid ? <p className={css.hint} role="alert">{t('designerSemanticsUrlInvalid')}</p> : null}
            </>
          ) : null}
          {linkMode === 'NODE' ? (
            <>
              <input
                aria-label={t('designerSemanticsLayerSearch')}
                value={search}
                disabled={disabled}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              <select
                aria-label={t('designerSemanticsLinkLayer')}
                value={chosen?.id ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (value) writeLink({ type: 'NODE', value })
                }}
              >
                <option value="">{t('designerLinkChooseLayer')}</option>
                {chosen && !choices.some(n => n.id === chosen.id) ? <option value={chosen.id}>{chosen.name}</option> : null}
                {choices.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <p className={css.hint}>{t('designerSemanticsLayerHint')}</p>
            </>
          ) : null}
        </>
      )}
      {labelKey ? (
        <>
          <DraftField
            key={`${node.id}:label:${labelKey}`}
            label={t(labelKey)}
            value={semantics?.label ?? ''}
            disabled={disabled || (image && semantics?.label === '')}
            invalid={problem === 'designerSemanticsLabelInvalid'}
            onCommit={value => write({ ...semantics, label: value.trim() ? value : undefined })}
          />
          {image ? (
            <>
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={semantics?.label === ''}
                  disabled={disabled}
                  onChange={(event) => { write({ ...semantics, label: event.currentTarget.checked ? '' : undefined }) }}
                />
                {t('designerSemanticsDecorative')}
              </label>
              <p className={css.hint}>{t('designerSemanticsAltHint')}</p>
            </>
          ) : null}
        </>
      ) : null}
      {problem ? <p className={css.hint} role="alert">{t(problem)}</p> : null}
    </section>
  )
}

/**
 * Set the element of several selected layers of the same family in one commit; links and names stay single-layer edits.
 * @param props - Current document, selected stored nodes, disabled state, copy and workspace commit.
 * @returns A Properties section when every node is text or every node is a container, otherwise a hint.
 */
export function DesignerSemanticsMulti({ doc, nodes, disabled, t, commit }: {
  doc: CopyOSDesignDocument
  nodes: readonly CopyOSDesignNode[]
  disabled: boolean
  t: Translate
  commit: (doc: CopyOSDesignDocument) => boolean
}): ReactNode {
  const [problem, setProblem] = useState<CopyOSFoundationLocaleKey | null>(null)
  if (nodes.some(node => node.pageLink)) return null
  const text = nodes.every(node => node.kind === 'text')
  const container = nodes.every(node => containerKinds.has(node.kind))
  const elements = new Set(nodes.map(node => node.semantics?.element ?? ''))
  const [shared] = elements
  return <section className={css.propertySection} aria-label={t('designerSemantics')}>
    <div className={css.sectionHeading}><h3>{t('designerSemantics')}</h3></div>
    {text || container ? <label className={css.field}>
      <span>{t('designerSemanticsElement')}</span>
      <select aria-label={t('designerSemanticsElement')} value={elements.size === 1 ? shared ?? '' : 'mixed'} disabled={disabled}
        onChange={(event) => {
          const value = event.currentTarget.value, element = isElement(value) ? value : undefined
          if (value === 'mixed') return
          if (nodes.some(node => unlinkable(node, element) && node.semantics?.link)) { setProblem('designerSemanticsLandmarkLinked'); return }
          const candidate = editDesignNodes(doc,
            nodes.map(node => ({ id: node.id, semantics: normalize(node, { ...node.semantics, element }) })))
          if (addedIssues(doc, candidate).length || !commit(candidate)) { setProblem('designerSemanticsRejected'); return }
          setProblem(null)
        }}>
        {elements.size > 1 ? <option value="mixed" disabled>{t('designerSemanticsMixed')}</option> : null}
        <option value="">{t(text ? 'designerSemanticsParagraph' : 'designerNone')}</option>
        {elementOptions(text, t, false)}
      </select>
    </label> : null}
    <p className={css.hint}>{t(text || container ? 'designerSemanticsMultiHint' : 'designerSemanticsMultiMixedKinds')}</p>
    {problem ? <p className={css.hint} role="alert">{t(problem)}</p> : null}
  </section>
}
