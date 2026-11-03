/** Element-level three-way merge between a converted page and a later compilation of its native source. */
import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'

type Node = DefaultTreeAdapterTypes.Node
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Element = DefaultTreeAdapterTypes.Element

/** How elements changed differently by the page and the design resolve; nothing is chosen implicitly. */
export type DesignPageMergeResolution = 'keep-page' | 'use-design'
/** Merge outcome keyed by stable design element identities, plus `style:<n>` keys for top-level stylesheets. */
export interface DesignPageMergeResult {
  /** Merged fragment; untouched page content is reserialized through the same HTML serializer as compiled output. */
  html: string
  /** Design changes applied where the page still matched the previous design output. */
  designChanges: string[]
  /** Page edits retained where the design did not change the same element. */
  pageEdits: string[]
  /** Elements the page and design changed differently; resolved by the requested policy. */
  conflicts: string[]
  /** Design-added elements whose parent kept its page version, so they have no placement. */
  unplaced: string[]
}

const slotPrefix = 'copyos-merge-slot:'
const blockId = (node: Node): string | undefined =>
  'attrs' in node ? node.attrs.find(attribute => attribute.name === 'data-copyos-block-id')?.value : undefined

// Read-mode identities hash the complete compiled source, so they change with any design edit; Builder style inspection
// adds empty style attributes. Neither changes rendered content, so comparisons ignore both.
const comparable = (shell: string | undefined): string | undefined =>
  shell?.replace(/ data-copyos-block-id="block-[0-9a-f]{64}"/g, '').replace(/ style=""/g, '')

/** One parsed version: each owned element's markup with owned descendants replaced by slot comments. */
function shells(html: string, owned: ReadonlySet<string>): Map<string, string> {
  const fragment = parseFragment(html), result = new Map<string, string>()
  let styles = 0
  const slotFor = (node: Node, topLevel: boolean): string | undefined => {
    if (!('tagName' in node)) return undefined
    if (topLevel && node.tagName === 'style') return `style:${styles++}`
    const id = blockId(node)
    return id && owned.has(id) ? id : undefined
  }
  // Clone a subtree, replacing owned descendants by slot comments and recording their own shells.
  const clone = (node: Node, parent: ParentNode, topLevel: boolean): Node => {
    const key = slotFor(node, topLevel)
    if (key !== undefined) {
      if (result.has(key)) throw new Error(`Duplicate merge element '${key}'`)
      result.set(key, serializeOuter(cloneElement(node as Element, parent)))
      return { nodeName: '#comment', data: `${slotPrefix}${key}`, parentNode: parent, sourceCodeLocation: null }
    }
    return 'tagName' in node ? cloneElement(node, parent) : { ...node, parentNode: parent }
  }
  const cloneElement = (node: Element, parent: ParentNode): Element => {
    const copy: Element = { ...node, attrs: node.attrs.map(attribute => ({ ...attribute })), parentNode: parent, childNodes: [] }
    copy.childNodes = node.childNodes.map(child => clone(child, copy, false) as DefaultTreeAdapterTypes.ChildNode)
    return copy
  }
  const top = fragment.childNodes.map(child => clone(child, fragment, true))
  result.set('#fragment', top.map(node => 'tagName' in node ? serializeOuter(node) :
    node.nodeName === '#comment' && 'data' in node ? `<!--${node.data}-->` : serializeOuter(node)).join(''))
  return result
}

/**
 * Merge a converted page against the previous and current design compilations without losing unrelated page edits.
 * @param base - Compiled HTML of the design revision the page was last synchronized with.
 * @param page - Current saved page variant HTML, including Builder edits.
 * @param design - Compiled HTML of the current design revision.
 * @param owned - Design element identities from the previous and current mappings; other elements belong to their nearest owned ancestor.
 * @param resolution - Default policy for elements changed differently on both sides.
 * @param overrides - Per-element policies that replace the default for those conflicting keys.
 * @returns Deterministic merged HTML and the classified element identities.
 * @throws {Error} If any version repeats an owned identity.
 */
export function mergeDesignPageHtml(base: string, page: string, design: string, owned: ReadonlySet<string>,
  resolution: DesignPageMergeResolution, overrides: ReadonlyMap<string, DesignPageMergeResolution> = new Map()): DesignPageMergeResult {
  const b = shells(base, owned), o = shells(page, owned), t = shells(design, owned)
  const merged = new Map<string, string>(), designChanges: string[] = [], pageEdits: string[] = [], conflicts: string[] = []
  for (const key of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
    const before = comparable(b.get(key)), ours = comparable(o.get(key)), theirs = comparable(t.get(key))
    let value: string | undefined
    if (ours === before) { value = t.get(key); if (theirs !== before) designChanges.push(key) }
    else if (theirs === before) { value = o.get(key); pageEdits.push(key) }
    else if (theirs === ours) value = o.get(key)
    else { conflicts.push(key); value = (overrides.get(key) ?? resolution) === 'keep-page' ? o.get(key) : t.get(key) }
    if (value !== undefined) merged.set(key, value)
  }
  const placed = new Set<string>()
  const expand = (markup: string, depth: number): string => {
    if (depth > 256) throw new Error('Merged page exceeds 256 nested merge levels')
    return markup.replace(/<!--copyos-merge-slot:([^>]*?)-->/g, (_all, key: string) => {
      const value = merged.get(key)
      if (value === undefined || placed.has(key)) return ''
      placed.add(key)
      return expand(value, depth + 1)
    })
  }
  const html = expand(merged.get('#fragment') ?? '', 0)
  const unplaced = [...merged.keys()].filter(key => key !== '#fragment' && !placed.has(key))
  return { html, designChanges: designChanges.filter(key => key !== '#fragment'), pageEdits: pageEdits.filter(key => key !== '#fragment'),
    conflicts, unplaced }
}
