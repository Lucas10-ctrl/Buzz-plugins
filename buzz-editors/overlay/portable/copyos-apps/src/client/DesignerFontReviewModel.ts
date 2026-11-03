/** Browser evidence and document-wide font substitutions without changing typography ownership. */
import type { CopyOSDesignDocument, CopyOSDesignTextRun } from '../../../copyos-domain/src/types.ts'
import { editDesignNodes, createDesignInstanceContextReader } from '../../../copyos-domain/src/design-model.ts'
import { designerCachedLocalFonts, designerFontName, normalizeDesignerFont } from './DesignerFonts.ts'

/** Positive family metadata never proves that an installed face or every glyph is available. */
export interface DesignerFontEvidence {
  loaded: readonly string[]
  local: readonly string[]
  loading: readonly string[]
  failed: readonly string[]
}
/** Stored primary-family usage, including dormant layer fallbacks and unused named styles. */
export interface DesignerFontReference {
  family: string
  key: string
  stacks: string[]
  faces: string[]
  layers: number
  styles: number
  status: 'available' | 'family-known' | 'fallback' | 'loading' | 'failed' | 'unverified'
}
const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])

/** Identify a CSS primary request without conflating generic keywords and quoted family names.
 * @param value - Complete authored CSS family stack.
 * @returns A report key suitable for scoped replacement and selected-layer lookup.
 */
export function designerFontRequestKey(value: string): string {
  const name = designerFontName(value).toLocaleLowerCase('en-US')
  const isGeneric = generic.has(name) && !/^\s*["']/.test(value)
  return `${isGeneric ? 'generic' : 'family'}:${name}`
}

/** Read registered web faces and previously authorized local metadata; never request permission or load a font.
 * @returns Positive browser evidence; unlisted families remain unverified.
 */
export function designerFontEvidence(): DesignerFontEvidence {
  const loaded = new Set<string>(), loading = new Set<string>(), failed = new Set<string>()
  const browser: Partial<Document> = document
  browser.fonts?.forEach((face) => {
    if (!normalizeDesignerFont(face.family)) return
    const family = designerFontName(face.family)
    if (face.status === 'loaded') loaded.add(family)
    else if (face.status === 'error') failed.add(family)
    else if (face.status === 'loading') loading.add(family)
  })
  return { loaded: [...loaded], loading: [...loading], failed: [...failed], local: designerCachedLocalFonts() }
}

/** Inventory all authored references, without treating CSS fallback checks as installed-font evidence.
 * @param document - Current native document.
 * @param evidence - Explicit browser family metadata.
 * @returns Stable primary-family groups with exact counts and authored face descriptions.
 */
export function designerFontReport(document: CopyOSDesignDocument, evidence: DesignerFontEvidence): DesignerFontReference[] {
  const groups = new Map<string, DesignerFontReference>()
  const stacks = new Map<string, Set<string>>(), faces = new Map<string, Set<string>>()
  const loaded = new Set(evidence.loaded.map(value => value.toLocaleLowerCase('en-US'))), local = new Set(evidence.local.map(value => value.toLocaleLowerCase('en-US'))),
    loading = new Set(evidence.loading.map(value => value.toLocaleLowerCase('en-US'))), failed = new Set(evidence.failed.map(value => value.toLocaleLowerCase('en-US')))
  const layerRequests = new Set<string>()
  const add = (family: string, weight: number, style: string, kind: 'layers' | 'styles', owner?: string): void => {
    const id = designerFontRequestKey(family)
    const name = designerFontName(family).toLocaleLowerCase('en-US')
    const isGeneric = id.startsWith('generic:')
    const status = (): DesignerFontReference['status'] => loaded.has(name) ? 'available' : local.has(name) ? 'family-known'
      : loading.has(name) ? 'loading' : failed.has(name) ? 'failed' : 'unverified'
    let group = groups.get(id)
    if (!group) {
      group = { family: !isGeneric && generic.has(name) ? JSON.stringify(designerFontName(family)) : designerFontName(family),
        key: id, stacks: [], faces: [], layers: 0, styles: 0,
        status: isGeneric ? 'fallback' : status() }
      groups.set(id, group)
      stacks.set(id, new Set()); faces.set(id, new Set())
    }
    const request = `${id}\0${owner ?? ''}`
    if (kind === 'styles' || !layerRequests.has(request)) group[kind]++
    if (kind === 'layers') layerRequests.add(request)
    if (!stacks.get(id)?.has(family)) { group.stacks.push(family); stacks.get(id)?.add(family) }
    const face = `${weight} ${style}`
    if (!faces.get(id)?.has(face)) { group.faces.push(face); faces.get(id)?.add(face) }
  }
  let readContext: ReturnType<typeof createDesignInstanceContextReader> | undefined
  for (const node of document.nodes) {
    if (node.kind === 'text') add(node.fontFamily, node.fontWeight, node.fontStyle ?? 'normal', 'layers', node.id)
    for (const run of node.textRuns ?? []) if (run.style.fontFamily !== undefined)
      add(run.style.fontFamily, run.style.fontWeight ?? node.fontWeight, run.style.fontStyle ?? node.fontStyle ?? 'normal', 'layers', node.id)
    for (const record of node.instanceOverrides ?? []) {
      const runs = record.textRuns?.filter(run => run.style.fontFamily !== undefined) ?? []
      if (!runs.length) continue
      readContext ??= createDesignInstanceContextReader(document)
      const target = readContext(node.id, record.path)?.node
      for (const run of runs) add(run.style.fontFamily ?? '', run.style.fontWeight ?? target?.fontWeight ?? node.fontWeight,
        run.style.fontStyle ?? target?.fontStyle ?? 'normal', 'layers', `${node.id}:${JSON.stringify(record.path)}`)
    }
  }
  for (const style of document.textStyles ?? []) add(style.fontFamily, style.fontWeight, style.fontStyle, 'styles')
  return [...groups.values()].sort((a, b) => a.family.localeCompare(b.family))
}

/** Replace a primary family throughout stored text and styles, preserving each existing fallback suffix.
 * @param document - Original transaction document.
 * @param requestKey - Exact report key; distinguishes quoted names from generic fallback keywords.
 * @param replacement - Valid CSS family or stack; its first family replaces the original primary.
 * @returns One immutable edit retaining style links, numeric bindings, content and other formatting.
 */
export function replaceDesignerDocumentFont(
  document: CopyOSDesignDocument,
  requestKey: string,
  replacement: string,
): CopyOSDesignDocument {
  const normalized = normalizeDesignerFont(replacement)
  if (!normalized) return document
  const primary = normalized.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)/)?.[0]?.trim()
  if (!primary) return document
  const source = requestKey
  const replace = (value: string): string => {
    if (designerFontRequestKey(value) !== source) return value
    const first = value.match(/^\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)/)?.[0] ?? value
    const suffix = value.slice(first.length)
    return suffix ? primary + suffix : normalized
  }
  const runFamilies = document.nodes.flatMap(node => [...(node.textRuns ?? []),
    ...(node.instanceOverrides ?? []).flatMap(record => record.textRuns ?? [])])
    .flatMap(run => run.style.fontFamily === undefined ? [] : [run.style.fontFamily])
  if ([...document.nodes.filter(node => node.kind === 'text').map(node => node.fontFamily),
    ...(document.textStyles ?? []).map(style => style.fontFamily), ...runFamilies]
    .some(value => designerFontRequestKey(value) === source && !normalizeDesignerFont(replace(value)))) return document
  const changedStyles = new Set<string>()
  const textStyles = document.textStyles?.map((style) => {
    const fontFamily = replace(style.fontFamily)
    if (fontFamily === style.fontFamily) return style
    changedStyles.add(style.id)
    return { ...style, fontFamily }
  })
  const replaceRuns = (runs: CopyOSDesignTextRun[] | undefined): CopyOSDesignTextRun[] | undefined => {
    const result = runs?.map((run) => {
      if (run.style.fontFamily === undefined) return run
      const fontFamily = replace(run.style.fontFamily)
      if (fontFamily === run.style.fontFamily) return run
      return { ...run, style: { ...run.style, fontFamily } }
    })
    return result?.some((run, index) => run !== runs?.[index]) ? result : runs
  }
  const runsById = new Map(document.nodes.map(node => [node.id, replaceRuns(node.textRuns)]))
  const affectedIds = new Set(document.nodes.filter(node => node.kind === 'text' &&
    (replace(node.fontFamily) !== node.fontFamily || changedStyles.has(node.textStyleId ?? '') ||
      runsById.get(node.id) !== node.textRuns)).map(node => node.id))
  let readContext: ReturnType<typeof createDesignInstanceContextReader> | undefined
  const edits: Parameters<typeof editDesignNodes>[1][number][] = []
  for (const node of document.nodes) {
    const edit: Parameters<typeof editDesignNodes>[1][number] = { id: node.id }
    const textRuns = runsById.get(node.id)
    if (textRuns !== node.textRuns) edit.textRuns = textRuns
    if (node.kind === 'text' && replace(node.fontFamily) !== node.fontFamily) edit.fontFamily = replace(node.fontFamily)
    if (affectedIds.has(node.id)) { edit.textLayoutMetrics = undefined; edit.textBaselineMetrics = undefined }
    const instanceOverrides = node.instanceOverrides?.flatMap((record) => {
      const runs = replaceRuns(record.textRuns)
      let affected = runs !== record.textRuns || affectedIds.has(record.path.at(-1) ?? '')
      if (!affected && affectedIds.size && (record.textLayoutMetrics || record.textBaselineMetrics?.length)) {
        readContext ??= createDesignInstanceContextReader(document)
        affected = affectedIds.has(readContext(node.id, record.path)?.node.id ?? '')
      }
      if (!affected) return [record]
      const updated = { ...record, ...(runs !== record.textRuns ? { textRuns: runs } : {}),
        textLayoutMetrics: undefined, textBaselineMetrics: undefined }
      return Object.entries(updated).some(([key, value]) => key !== 'path' && value !== undefined) ? [updated] : []
    })
    if (instanceOverrides && (instanceOverrides.length !== node.instanceOverrides?.length ||
      instanceOverrides.some((record, index) => record !== node.instanceOverrides?.[index]))) edit.instanceOverrides = instanceOverrides
    if (Object.keys(edit).length > 1) edits.push(edit)
  }
  if (!edits.length && !changedStyles.size) return document
  return editDesignNodes({ ...document, ...(textStyles ? { textStyles } : {}) }, edits)
}
