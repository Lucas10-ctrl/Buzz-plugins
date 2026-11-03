import { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
/** Browser-safe identities for explicit page-fragment elements; authored source is never reserialized. */
import { parseFragment, ErrorCodes, html as htmlNamespace, type DefaultTreeAdapterTypes } from 'parse5'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

const attribute = 'data-copyos-block-id'
const validId = /^[A-Za-z0-9_.:-]{1,128}$/
const styleTags = new Set('h1,h2,h3,p,blockquote,article,a,button,figure,figcaption,ul,li,div,span,strong,em,img,video,svg,hr'.split(','))
const inertTags = new Set(['head', 'base', 'link', 'meta', 'title', 'script', 'style', 'template', 'noscript'])
const svgResources = new Set(['defs', 'desc', 'clippath', 'mask', 'pattern', 'filter', 'lineargradient', 'radialgradient', 'stop', 'symbol', 'marker'])
type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.Node

/** One explicit rendered element; styleIndex retains its zero-based position in the legacy style selector. */
export interface CopyOSPageElement {
  id: string
  tagName: string
  parentId?: string | undefined
  /** Decoded plain text or accessible name, at most 160 UTF-16 code units. */
  label: string
  styleIndex?: number | undefined
}

type RecordEntry = {
  element: Element
  parent?: RecordEntry | undefined
  id?: string | undefined
  styleIndex?: number | undefined
  text: string
}
function digest(value: string): string { return bytesToHex(sha256(new TextEncoder().encode(value))) }
function label(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 160).replace(/[\uD800-\uDBFF]$/, '') }

function inspectSource(html: string): { records: RecordEntry[]; ids: Set<string> } {
  if (html.length > COPYOS_PAGE_HTML_MAX_LENGTH) throw new Error(`Page HTML exceeds ${COPYOS_PAGE_HTML_MAX_LENGTH} characters`)
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true, onParseError(error) {
    if (error.code === ErrorCodes.duplicateAttribute &&
      html.slice(Math.max(0, error.startOffset - 256), error.startOffset).match(/([^\s"'<>/=]+)\s*=?$/)?.[1]?.toLowerCase() === attribute)
      throw new Error('Page element contains duplicate identity attributes')
  } })
  const records: RecordEntry[] = [], ids = new Set<string>(), offsets = new Set<number>()
  const stack: { node: Node; depth: number; inert: boolean; templateContent: boolean; parent?: RecordEntry | undefined }[] =
    [{ node: fragment, depth: 0, inert: false, templateContent: false }]
  let count = 0, styleIndex = 0
  while (stack.length) {
    const frame = stack.pop()
    if (!frame) break
    if (++count > 4096) throw new Error('Page HTML exceeds 4096 parsed nodes')
    if (frame.depth > 128) throw new Error('Page HTML exceeds 128 nested levels')
    const { node } = frame
    let parent = frame.parent, inert = frame.inert
    if ('tagName' in node) {
      const tag = node.tagName.toLowerCase()
      const index = !frame.templateContent && styleTags.has(tag) ? styleIndex++ : undefined
      inert ||= inertTags.has(tag) || node.namespaceURI === htmlNamespace.NS.SVG && svgResources.has(tag)
      const authored = node.attrs.find(item => item.name === attribute)
      if (authored) {
        if (!validId.test(authored.value)) throw new Error('Page element identity must contain 1–128 safe ASCII characters')
        if (ids.has(authored.value)) throw new Error(`Duplicate page element identity '${authored.value}'`)
        ids.add(authored.value)
      }
      const location = node.sourceCodeLocation?.startTag
      if (!inert && location) {
        if (offsets.has(location.startOffset)) throw new Error('One authored start tag produces multiple rendered elements')
        offsets.add(location.startOffset)
        const record: RecordEntry = { element: node, parent, id: authored?.value, styleIndex: index, text: '' }
        records.push(record)
        parent = record
      }
    } else if (node.nodeName === '#text' && 'value' in node && !inert) {
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent)
        ancestor.text = (ancestor.text + node.value).replace(/\s+/g, ' ').slice(0, 162)
    }
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse())
      stack.push({ node: child, depth: frame.depth + 1, inert, templateContent: frame.templateContent, parent })
    if ('content' in node) stack.push({ node: node.content, depth: frame.depth + 1, inert: true, templateContent: true, parent })
  }
  return { records, ids }
}

/**
 * Insert only missing element identities without changing any existing source byte.
 * @param html - HTML fragment, at most COPYOS_PAGE_HTML_MAX_LENGTH UTF-16 code units including inserted attributes.
 * @param options - Nonempty namespace up to 512 characters; read derives stable IDs from exact source, write mints fresh UUIDs.
 * @returns Source with IDs on every explicit rendered element. Invalid/duplicate IDs, ambiguous parser cloning,
 * more than 4096 parsed nodes or depth over 128 reject.
 */
export function normalizePageElementIds(html: string, options: { namespace: string; mode: 'read' | 'write' }): string {
  if (!options.namespace.length || options.namespace.length > 512) throw new Error('Page element namespace must contain 1–512 characters')
  const { records, ids } = inspectSource(html), sourceHash = options.mode === 'read' ? digest(html) : ''
  const insertions: { offset: number; value: string }[] = []
  for (const [ordinal, record] of records.entries()) {
    if (record.id) continue
    let id: string
    if (options.mode === 'read') id = `block-${digest(`${options.namespace}\0${sourceHash}\0${ordinal}`)}`
    else {
      id = `block-${randomUUID()}`
      let attempts = 1
      while (ids.has(id) && attempts++ < 32) id = `block-${randomUUID()}`
    }
    if (ids.has(id)) throw new Error('Generated page element identity conflicts with an existing identity')
    ids.add(id)
    const offset = record.element.sourceCodeLocation?.startTag?.startOffset
    if (offset === undefined) throw new Error('Page element has no authored start tag')
    const name = html.slice(offset).match(/^<[^\s/>]+/)
    if (!name) throw new Error('Page element start tag cannot receive an identity')
    insertions.push({ offset: offset + name[0].length, value: ` ${attribute}="${id}"` })
  }
  if (html.length + insertions.reduce((sum, item) => sum + item.value.length, 0) > COPYOS_PAGE_HTML_MAX_LENGTH)
    throw new Error(`Expanded page HTML exceeds ${COPYOS_PAGE_HTML_MAX_LENGTH} characters`)
  const chunks: string[] = []
  let cursor = 0
  for (const insertion of insertions.sort((left, right) => left.offset - right.offset)) {
    chunks.push(html.slice(cursor, insertion.offset), insertion.value)
    cursor = insertion.offset
  }
  chunks.push(html.slice(cursor))
  const result = chunks.join('')
  inspectSource(result)
  return result
}

/**
 * Inspect complete identities in normalized page source without a DOM, script execution or source mutation.
 * @param html - Normalized HTML fragment within the same size, node and nesting bounds as normalization.
 * @returns Explicit rendered elements in DOM order, nearest identified parent and optional legacy style-selector index;
 * missing or invalid identities reject.
 */
export function inspectPageElements(html: string): readonly CopyOSPageElement[] {
  return inspectSource(html).records.map((record) => {
    if (!record.id) throw new Error('Page element identity is missing; normalize the fragment before inspection')
    const accessible = record.element.attrs.find(item => item.name === 'aria-label')?.value
      || record.element.attrs.find(item => item.name === 'alt')?.value || record.element.attrs.find(item => item.name === 'title')?.value
    return { id: record.id, tagName: record.element.tagName, ...(record.parent?.id ? { parentId: record.parent.id } : {}),
      label: label(accessible || record.text) || label(record.element.tagName),
      ...(record.styleIndex !== undefined ? { styleIndex: record.styleIndex } : {}) }
  })
}
