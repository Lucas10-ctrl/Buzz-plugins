import { mapDesignSemanticsTargets, mapDesignTextHyperlinks, reconcileDesignTextHyperlinks } from './design-text-hyperlink.ts'
import { designEffectNumberBindings, designEffectColorBindings } from './design-effect-values.ts'
import { designNumberExpressionReferences, mapDesignNumberExpressionReferences } from './design-number-expression.ts'
import { designAuthoredGridTracks } from './design-instance-grid.ts'
/** Immutable internal clipboard transport preserves selected copies separately from reusable dependency graphs. */
import { z } from 'zod'
import { CopyOSDesignError, parseDesignDocument, designDocumentSchemas } from './design-schema.ts'
import { snapshotDesignGeometry, resolveDesignNodes } from './design-model.ts'
import { markDesignInstanceSizingEdit } from './design-instance-sizing.ts'
import { designNodeModeIds } from './design-token-modes.ts'
import { designComponentPropertyDefinitions, materializeDesignComponentPropertyDefinitions } from './design-component-property-definitions.ts'
import { reconcileDesignComponentProperties, pruneDesignComponentProperties } from './design-component-properties.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignClipboardSnapshot,
  CopyOSDesignClipboardImportOptions, CopyOSDesignClipboardImportResult, CopyOSDesignGradient } from './types.ts'

// Page that receives the component masters an import brings along.
const IMPORTED_COMPONENTS_PAGE = 'Imported components'

// A clipboard library is a transport fragment: external NODE hyperlinks remain metadata until destination admission.
// Validate every ordinary schema field using a link-free admission view, then restore only the strictly parsed run metadata.
function clipboardLibrary(input: unknown): CopyOSDesignDocument {
  if (!input || typeof input !== 'object' || !('nodes' in input) || !Array.isArray(input.nodes)) reject('Invalid clipboard library')
  const nodes = input.nodes.map(node => designDocumentSchemas.nodeSchema.parse(node))
  const remove = (node: CopyOSDesignNode): CopyOSDesignNode => ({ ...node,
    textRuns: mapDesignTextHyperlinks(node.textRuns, target => target.type === 'NODE' ? undefined : target),
    semantics: mapDesignSemanticsTargets(node, target => target.type === 'NODE' ? undefined : target),
    breakpoint: undefined,
    instanceOverrides: node.instanceOverrides?.map(record => ({ ...record,
      textRuns: mapDesignTextHyperlinks(record.textRuns, target => target.type === 'NODE' ? undefined : target) })),
  })
  const admitted = parseDesignDocument({ ...input, nodes: nodes.map(remove) })
  return { ...admitted, nodes }
}
const fresh = (): string => globalThis.crypto.randomUUID()
function reject(message: string): never { throw new CopyOSDesignError(message) }
const childIndexes = new WeakMap<readonly CopyOSDesignNode[], Map<string, string[]>>()
function subtree(nodes: readonly CopyOSDesignNode[], ids: readonly string[]): Set<string> {
  let children = childIndexes.get(nodes)
  if (!children) {
    children = new Map()
    for (const node of nodes) if (node.parentId) {
      const list = children.get(node.parentId) ?? []; list.push(node.id); children.set(node.parentId, list)
    }
    childIndexes.set(nodes, children)
  }
  const result = new Set<string>(), queue = [...ids]
  for (let id = queue.pop(); id; id = queue.pop()) if (!result.has(id)) {
    result.add(id)
    queue.push(...children.get(id) ?? [])
  }
  return result
}
function identityAllocator(occupied: Set<string>, newId: () => string): () => string {
  return () => {
    const id = newId()
    if (!z.uuid().safeParse(id).success || occupied.has(id)) reject('Clipboard identity allocator must return fresh UUIDs')
    occupied.add(id); return id
  }
}
function designIdentities(document: CopyOSDesignDocument): Set<string> {
  const result = new Set([document.id])
  for (const node of document.nodes) {
    result.add(node.id)
    for (const effect of [...node.effects ?? [], ...(node.instanceOverrides ?? []).flatMap(record => record.effects ?? [])])
      result.add(effect.id)
    for (const value of node.componentProperties ?? []) result.add(value.id)
    for (const value of node.componentSet?.axes ?? []) result.add(value.id)
    for (const fill of [...node.fills ?? [], ...node.strokes ?? [], ...node.instanceStroke?.strokes ?? []]) result.add(fill.id)
    const paints = [...node.fills ?? [], ...node.strokes ?? [], ...node.instanceStroke?.strokes ?? []]
    for (const gradient of [node.gradient, ...paints.map(fill => fill.gradient)])
      for (const stop of gradient?.stops ?? []) if (stop.id) result.add(stop.id)
  }
  for (const style of document.effectStyles ?? []) { result.add(style.id); for (const effect of style.effects) result.add(effect.id) }
  for (const value of [...document.variables, ...document.numberVariables ?? [], ...document.textStyles ?? [],
    ...document.tokenModes ?? [], ...document.pages ?? []]) result.add(value.id)
  return result
}
function references(node: CopyOSDesignNode, library: CopyOSDesignDocument): string[] {
  const result: string[] = []
  if (node.componentId) result.push(node.componentId)
  for (const override of node.instanceOverrides ?? []) if (override.componentId) result.push(override.componentId)
  for (const property of node.componentProperties ?? []) if (property.type === 'instance-swap')
    result.push(property.defaultValue, ...property.preferredValues ?? [])
  const definitions = node.componentPropertyValues?.length
    ? designComponentPropertyDefinitions(library, node.componentId ?? '')
    : []
  for (const value of node.componentPropertyValues ?? [])
    if (typeof value.value === 'string' && definitions.some(property => property.id === value.propertyId && property.type === 'instance-swap'))
      result.push(value.value)
  return result
}
function resourceClosure(document: CopyOSDesignDocument, nodes: readonly CopyOSDesignNode[], rootModes: ReadonlySet<string>)
  : Pick<CopyOSDesignDocument, 'variables' | 'numberVariables' | 'textStyles' | 'tokenModes' | 'effectStyles'> {
  const colors = new Set<string>(), numbers = new Set<string>(), styles = new Set<string>()
  const effectStyleIds = new Set(nodes.flatMap(node => [node.effectStyleId,
    ...(node.instanceOverrides ?? []).map(record => record.effectStyleId)])
    .filter((id): id is string => typeof id === 'string'))
  const effectStyles = document.effectStyles?.filter(style => effectStyleIds.has(style.id))
  const color = (id: string | null | undefined): void => { if (id) colors.add(id) }
  const number = (id: string | null | undefined): void => { if (id) numbers.add(id) }
  for (const node of nodes) {
    for (const id of designEffectColorBindings(node)) color(id)
    color(node.fillVariableId); color(node.strokeVariableId); color(node.instanceStroke?.strokeVariableId)
    for (const fill of [...node.fills ?? [], ...node.strokes ?? [], ...node.instanceStroke?.strokes ?? []]) {
      color(fill.variableId)
      for (const stop of fill.gradient?.stops ?? []) color(stop.variableId)
    }
    for (const stop of node.gradient?.stops ?? []) color(stop.variableId)
    for (const binding of designEffectNumberBindings(node)) number(binding.id)
    for (const id of Object.values(node.numericBindings ?? {})) number(id)
    for (const record of node.instanceOverrides ?? []) for (const id of Object.values(record.layoutBindings ?? {})) number(id)
    for (const track of designAuthoredGridTracks(node)) number(track.variableId)
    if (node.textStyleId) styles.add(node.textStyleId)
  }
  for (const style of effectStyles ?? []) {
    for (const id of designEffectColorBindings(style)) color(id)
    for (const binding of designEffectNumberBindings(style)) number(binding.id)
  }
  const visitedColors = new Set<string>(), visitedNumbers = new Set<string>()
  while (visitedColors.size < colors.size || visitedNumbers.size < numbers.size) {
    for (const id of colors) if (!visitedColors.has(id)) {
      visitedColors.add(id)
      const base = document.variables.find(value => value.id === id)
      if (!base) reject('Clipboard color reference is missing')
      for (const value of [base, ...document.tokenModes?.flatMap(mode => mode.variables.filter(value => value.id === id)) ?? []]) {
        color(value.aliasId)
        if (value.alphaSource?.kind === 'number') number(value.alphaSource.variableId)
      }
    }
    for (const id of numbers) if (!visitedNumbers.has(id)) {
      visitedNumbers.add(id)
      const base = document.numberVariables?.find(value => value.id === id)
      if (!base) reject('Clipboard numeric reference is missing')
      number(base.aliasId)
      if (base.expression) for (const target of designNumberExpressionReferences(base.expression)) number(target)
      for (const mode of document.tokenModes ?? []) for (const value of mode.numberVariables) if (value.id === id) {
        number(value.aliasId)
        if (value.expression) for (const target of designNumberExpressionReferences(value.expression)) number(target)
      }
    }
  }
  return { variables: document.variables.filter(value => colors.has(value.id)),
    numberVariables: document.numberVariables?.filter(value => numbers.has(value.id)),
    textStyles: document.textStyles?.filter(value => styles.has(value.id)), effectStyles,
    tokenModes: document.tokenModes?.filter(mode => colors.size || numbers.size || rootModes.has(mode.id) ||
      nodes.some(node => node.tokenModeId === mode.id)).map(mode => ({ ...mode,
      variables: mode.variables.filter(value => colors.has(value.id)),
      numberVariables: mode.numberVariables.filter(value => numbers.has(value.id)) })) }
}
/** Capture selected editable subtrees and their complete typed local library/resource dependencies.
 * @param input - Complete validated source scene; source globals are not imported into another document.
 * @param rootIds - Selected roots; redundant descendant selections are normalized.
 * @param options - Reliable source workspace source identity.
 * @param newId - Fresh UUID allocator for independently materialized standalone variant definitions.
 * @returns Detached internal snapshot with selected and library identity roles kept separate.
 */
export function captureDesignClipboard(input: CopyOSDesignDocument, rootIds: readonly string[],
  options: { sourceWorkspaceId: string }, newId: () => string = fresh): CopyOSDesignClipboardSnapshot {
  const document = parseDesignDocument(input)
  if (!options.sourceWorkspaceId || !rootIds.length || new Set(rootIds).size !== rootIds.length)
    reject('Clipboard requires workspace source identity and unique selected roots')
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  for (const id of rootIds) if (!byId.has(id)) reject('Clipboard selected layer is missing')
  const requested = new Set(rootIds)
  const roots = rootIds.filter((id) => {
    let parent = byId.get(id)?.parentId
    for (let depth = 0; parent && depth < 64; depth++) {
      if (requested.has(parent)) return false
      parent = byId.get(parent)?.parentId
    }
    return true
  })
  const selected = subtree(document.nodes, roots), modes = designNodeModeIds(document)
  const computed = new Map(resolveDesignNodes(document).map(node => [node.id, node]))
  const occupied = designIdentities(document)
  const allocate = identityAllocator(occupied, newId)
  const materialized = new Map<string, Map<string, string>>()
  let selectedNodes = snapshotDesignGeometry(document, roots).nodes.filter(node => selected.has(node.id)).map((node) => {
    const parent = byId.get(node.parentId ?? '')
    if (node.kind === 'component' && parent?.kind === 'component-set' && !selected.has(parent.id)) {
      const result = materializeDesignComponentPropertyDefinitions(document, node.id, allocate)
      materialized.set(node.id, result.ids)
      return { ...node, parentId: null, variantValues: undefined, componentProperties: result.properties }
    }
    return { ...node, parentId: selected.has(node.parentId ?? '') ? node.parentId : null }
  })
  selectedNodes = selectedNodes.map((node) => {
    const ids = materialized.get(node.componentId ?? '')
    return { ...node, pageId: undefined, componentPropertyValues: node.componentPropertyValues?.map(value => ({ ...value,
      propertyId: ids?.get(value.propertyId) ?? value.propertyId })) }
  })
  const selectedLibrary = { ...document, nodes: [...document.nodes.filter(node => !selected.has(node.id)), ...selectedNodes] }
  const selectedMains = new Set(selectedNodes.filter(node => node.kind === 'component').map(node => node.id))
  const dependencies = new Set<string>(), queue: string[] = []
  for (const node of selectedNodes) for (const id of references(node, selectedLibrary)) if (!selectedMains.has(id)) queue.push(id)
  for (let id = queue.pop(); id; id = queue.pop()) {
    const main = byId.get(id)
    if (main?.kind !== 'component') reject('Clipboard component reference is missing')
    const parent = byId.get(main.parentId ?? '')
    const root = parent?.kind === 'component-set' ? parent.id : main.id
    if (dependencies.has(root)) continue
    const added = subtree(document.nodes, [root])
    for (const child of document.nodes) if (added.has(child.id) && !dependencies.has(child.id)) {
      dependencies.add(child.id)
      for (const reference of references(child, document)) queue.push(reference)
    }
  }
  const libraryNodes = document.nodes.filter(node => dependencies.has(node.id)).map(node => ({ ...node,
    pageId: undefined, parentId: dependencies.has(node.parentId ?? '') ? node.parentId : null }))
  const rootModes = new Set(roots.flatMap((id) => { const mode = modes.get(id); return mode ? [mode] : [] }))
  const resources = resourceClosure(document, [...selectedNodes, ...libraryNodes], rootModes)
  const library = clipboardLibrary({ ...document, ...resources, nodes: libraryNodes,
    pages: undefined, canvasBackground: undefined, activeTokenModeId: null, source: undefined })
  return structuredClone({ schema: 'copyos.design-clipboard', version: 1, sourceWorkspaceId: options.sourceWorkspaceId,
    sourceDesignId: document.id, rootIds: roots,
    rootSizing: roots.map(id => ({ id,
      widthSizing: computed.get(id)?.widthSizing ?? 'fixed', heightSizing: computed.get(id)?.heightSizing ?? 'fixed' })),
    rootModes: roots.map(id => ({ id, tokenModeId: modes.get(id) ?? null })),
    selectedNodes, library })
}

const snapshotSchema = z.object({ schema: z.literal('copyos.design-clipboard'), version: z.literal(1),
  sourceWorkspaceId: z.string().min(1).max(10000), sourceDesignId: z.uuid(), rootIds: z.array(z.uuid()).min(1).max(25000),
  rootModes: z.array(z.object({ id: z.uuid(), tokenModeId: z.uuid().nullable() }).strict()).max(25000),
  rootSizing: z.array(z.object({ id: z.uuid(), widthSizing: z.enum(['fixed', 'hug', 'fill']),
    heightSizing: z.enum(['fixed', 'hug', 'fill']) }).strict()).max(25000),
  selectedNodes: z.array(z.lazy(() => designDocumentSchemas.nodeSchema)).max(25000), library: z.unknown() }).strict()
/**
 * Validate serialized clipboard data before admitting external transport into native clipboard operations.
 * @param input - Untrusted decoded clipboard value.
 * @returns Validated snapshot with checked selected hierarchy, resource library and root context.
 */
export function parseDesignClipboardSnapshot(input: unknown): CopyOSDesignClipboardSnapshot {
  const result = snapshotSchema.safeParse(input)
  if (!result.success) reject(result.error.issues.map(issue => issue.message).join('; '))
  const library = clipboardLibrary(result.data.library)
  if (library.id !== result.data.sourceDesignId) reject('Clipboard source identity does not match its library')
  const ids = new Set(result.data.selectedNodes.map(node => node.id)), roots = new Set(result.data.rootIds)
  if (ids.size !== result.data.selectedNodes.length || roots.size !== result.data.rootIds.length ||
    result.data.rootIds.some(id => !ids.has(id)) ||
    result.data.selectedNodes.some(node => node.parentId !== null && !ids.has(node.parentId)) ||
    result.data.selectedNodes.some(node => (node.parentId === null) !== roots.has(node.id))) reject('Invalid clipboard selected hierarchy')
  if (result.data.rootModes.length !== roots.size || new Set(result.data.rootModes.map(value => value.id)).size !== roots.size ||
    result.data.rootModes.some(value => !roots.has(value.id) ||
      (value.tokenModeId && !library.tokenModes?.some(mode => mode.id === value.tokenModeId))))
    reject('Invalid clipboard root mode context')
  if (result.data.rootSizing.length !== roots.size || new Set(result.data.rootSizing.map(value => value.id)).size !== roots.size ||
    result.data.rootSizing.some(value => !roots.has(value.id))) reject('Invalid clipboard root sizing context')
  return { ...result.data, library }
}

/** Import one immutable snapshot with fresh cross-file identities and a single validated candidate.
 * @param input - Destination before the transaction; never mutated on rejection.
 * @param clipboard - Captured internal payload with reliable source identity.
 * @param options - Target workspace/page/parent and selected-root placement or explicit replacement.
 * @param newId - Fresh UUID allocator shared across every imported identity namespace.
 * @returns Valid native scene, requested selection and separately placed reusable library dependencies.
 */
export function importDesignClipboard(input: CopyOSDesignDocument, clipboard: CopyOSDesignClipboardSnapshot,
  options: CopyOSDesignClipboardImportOptions, newId: () => string = fresh): CopyOSDesignClipboardImportResult {
  const destination = parseDesignDocument(input), snapshot = parseDesignClipboardSnapshot(clipboard)
  const optionResult = z.object({ destinationWorkspaceId: z.string().min(1).max(10000), pageId: z.uuid().optional(),
    parentId: z.uuid().nullable().optional(), offset: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    position: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    replaceIds: z.array(z.uuid()).max(25000).optional() }).strict().safeParse(options)
  if (!optionResult.success) reject(optionResult.error.issues.map(issue => issue.message).join('; '))
  if (options.pageId && !destination.pages?.some(page => page.id === options.pageId)) reject('Clipboard destination page is missing')
  const parent = options.parentId ? destination.nodes.find(node => node.id === options.parentId) : undefined
  if (options.parentId && !parent) reject('Clipboard destination parent is missing')
  const removed = subtree(destination.nodes, options.replaceIds ?? [])
  for (const id of options.replaceIds ?? []) if (!destination.nodes.some(node => node.id === id)) reject('Clipboard replacement layer is missing')
  if (parent && removed.has(parent.id)) reject('Clipboard destination parent is being replaced')
  const sameDocument = options.destinationWorkspaceId === snapshot.sourceWorkspaceId && destination.id === snapshot.sourceDesignId
  if (options.destinationWorkspaceId !== snapshot.sourceWorkspaceId &&
    [...snapshot.selectedNodes, ...snapshot.library.nodes].some(node => node.pageLink))
    reject('Linked page screens cannot be pasted into another workspace until page transfer is supported')
  const library = snapshot.library, selected = snapshot.selectedNodes
  const sourceById = new Map([...library.nodes, ...selected].map(node => [node.id, node]))
  const selectedById = new Map(selected.map(node => [node.id, node])), libraryById = new Map(library.nodes.map(node => [node.id, node]))
  const destinationById = new Map(destination.nodes.map(node => [node.id, node]))
  const selectedMains = new Set(selected.filter(node => node.kind === 'component').map(node => node.id))
  const dependencies = new Set<string>(), queue: string[] = []
  const selectedLibrary = { ...library, nodes: [...sourceById.values()] }
  for (const node of selected) for (const id of references(node, selectedLibrary))
    if (!selectedMains.has(id) && !(sameDocument && destinationById.get(id)?.kind === 'component')) queue.push(id)
  for (let id = queue.pop(); id; id = queue.pop()) {
    const main = libraryById.get(id)
    if (main?.kind !== 'component') reject('Clipboard library is incomplete; linked components cannot become empty frames')
    const parent = libraryById.get(main.parentId ?? '')
    const root = parent?.kind === 'component-set' ? parent.id : main.id
    if (dependencies.has(root)) continue
    for (const childId of subtree(library.nodes, [root])) {
      if (dependencies.has(childId)) continue
      dependencies.add(childId)
      const child = libraryById.get(childId)
      if (!child) reject('Clipboard library hierarchy is incomplete')
      for (const reference of references(child, library))
        if (!(sameDocument && destinationById.get(reference)?.kind === 'component')) queue.push(reference)
    }
  }
  const dependencyNodes = library.nodes.filter(node => dependencies.has(node.id))
  const occupied = new Set([...designIdentities(destination), ...designIdentities(library)])
  for (const id of designIdentities({ ...library, nodes: selected })) occupied.add(id)
  const allocate = identityAllocator(occupied, newId)
  const selectedIds = new Map<string, string>(), dependencyIds = new Map<string, string>()
  const resources = { color: new Map<string, string>(), number: new Map<string, string>(),
    style: new Map<string, string>(), effectStyle: new Map<string, string>(), mode: new Map<string, string>() }
  const identities = (nodes: readonly CopyOSDesignNode[], ids: Map<string, string>): void => {
    for (const node of nodes) {
      ids.set(node.id, allocate())
      for (const property of node.componentProperties ?? []) ids.set(property.id, allocate())
      for (const axis of node.componentSet?.axes ?? []) ids.set(axis.id, allocate())
    }
  }
  identities(selected, selectedIds); identities(dependencyNodes, dependencyIds)
  for (const [kind, values] of [['color', library.variables], ['number', library.numberVariables ?? []],
    ['style', library.textStyles ?? []], ['effectStyle', library.effectStyles ?? []], ['mode', library.tokenModes ?? []]] as const)
    for (const value of values) resources[kind].set(value.id, sameDocument ? value.id : allocate())
  type Scope = 'selected' | 'library' | 'existing'
  const componentScope = (scope: Scope, id: string): Scope => {
    if (scope === 'selected' && selectedMains.has(id)) return 'selected'
    if (scope === 'existing') return 'existing'
    if (sameDocument && destinationById.get(id)?.kind === 'component' && (scope === 'selected' || !dependencyIds.has(id))) return 'existing'
    return 'library'
  }
  const mapId = (scope: Scope, id: string): string => scope === 'existing' ? id :
    (scope === 'selected' ? selectedIds.get(id) ?? dependencyIds.get(id) : dependencyIds.get(id)) ?? id
  const mapComponent = (scope: Scope, id: string): string => mapId(componentScope(scope, id), id)
  const sourceNode = (scope: Scope, id: string): CopyOSDesignNode | undefined =>
    scope === 'selected' ? selectedById.get(id) ?? libraryById.get(id) : libraryById.get(id) ?? selectedById.get(id)
  const path = (values: readonly string[], initialScope: Scope): string[] => {
    let scope = initialScope
    return values.map((id, index) => {
      const mapped = mapId(scope, id), node = sourceNode(scope, id)
      if (index < values.length - 1 && node?.kind === 'instance' && node.componentId) scope = componentScope(scope, node.componentId)
      return mapped
    })
  }
  const resourceId = (id: string | null | undefined, kind: keyof typeof resources = 'color'): string | null | undefined =>
    id ? resources[kind].get(id) ?? id : id
  const effect = (value: import('./types.ts').CopyOSDesignEffect): import('./types.ts').CopyOSDesignEffect => ({ ...value,
    id: allocate(), ...(value.type !== 'layer-blur' ? { colorVariableId: resourceId(value.colorVariableId) ?? undefined } : {}),
    numericBindings: value.numericBindings && Object.fromEntries(Object.entries(value.numericBindings)
      .map(([key, id]) => [key, resourceId(id, 'number') ?? undefined])),
  })
  const gradient = (value: CopyOSDesignGradient | undefined): CopyOSDesignGradient | undefined => value && ({ ...value,
    stops: value.stops.map(stop => ({ ...stop, ...(stop.id ? { id: allocate() } : {}), variableId: resourceId(stop.variableId) })) })
  let pages = destination.pages, existingNodes = destination.nodes
  let activePageId = options.pageId ?? destination.pages?.[0]?.id ?? null
  let dependencyPageId: string | null = null
  if (dependencyNodes.length) {
    if (!pages?.length) {
      activePageId = allocate()
      pages = [{ id: activePageId, name: 'Page 1' }]
      existingNodes = existingNodes.map(node => ({ ...node, pageId: activePageId ?? undefined }))
    }
    // Later imports reuse the first page with this exact name, so repeated pastes do not add duplicate pages.
    const reused = pages.find(page => page.name === IMPORTED_COMPONENTS_PAGE)
    dependencyPageId = reused?.id ?? allocate()
    if (!reused) pages = [...pages, { id: dependencyPageId, name: IMPORTED_COMPONENTS_PAGE }]
  }
  const roots = selected.filter(node => snapshot.rootIds.includes(node.id))
  const minX = Math.min(...roots.map(node => node.x)), minY = Math.min(...roots.map(node => node.y))
  const offset = options.offset ?? { x: 24, y: 24 }
  const origin = options.position ?? { x: minX + offset.x, y: minY + offset.y }
  const modeByRoot = new Map(snapshot.rootModes.map(value => [value.id, value.tokenModeId]))
  const sizingByRoot = new Map(snapshot.rootSizing.map(value => [value.id, value]))
  const parentAllocates = parent && !parent.preserveLayout && ['row', 'column', 'grid'].includes(parent.layout)
  let removedNodeLinks = 0
  const hyperlink = (target: import('./types.ts').CopyOSDesignTextHyperlink) => {
    if (target.type === 'URL') return target
    const mapped = selectedIds.get(target.value) ?? dependencyIds.get(target.value)
    if (mapped) return { ...target, value: mapped }
    if (sameDocument && destinationById.has(target.value) && !removed.has(target.value)) return target
    removedNodeLinks++; return undefined
  }
  const remap = (node: CopyOSDesignNode, scope: 'selected' | 'library'): CopyOSDesignNode => {
    const ids = scope === 'selected' ? selectedIds : dependencyIds, root = scope === 'selected' && snapshot.rootIds.includes(node.id)
    const linkedScope = node.componentId ? componentScope(scope, node.componentId) : scope
    const definitions = designComponentPropertyDefinitions(scope === 'selected' ? selectedLibrary : library, node.componentId ?? '')
    const definitionById = new Map(definitions.map(property => [property.id, property]))
    const properties = node.componentProperties?.map((property) => { const mapped = { ...property,
      id: mapId(scope, property.id), targets: property.targets.map(target => path(target, scope)) }
    return property.type === 'instance-swap' ? { ...mapped, type: 'instance-swap' as const, defaultValue: mapComponent(scope, property.defaultValue),
      preferredValues: property.preferredValues?.map(id => mapComponent(scope, id)) }
      : { ...property, id: mapped.id, targets: mapped.targets } })
    const values = node.componentPropertyValues?.map(value => ({ ...value,
      propertyId: mapId(linkedScope, value.propertyId),
      value: definitionById.get(value.propertyId)?.type === 'instance-swap' && typeof value.value === 'string'
        ? mapComponent(scope, value.value) : value.value }))
    const result: CopyOSDesignNode = { ...node,
      textRuns: mapDesignTextHyperlinks(node.textRuns, hyperlink),
      semantics: mapDesignSemanticsTargets(node, hyperlink),
      breakpoint: undefined, breakpointSourceId: undefined,
      id: mapId(scope, node.id), parentId: root ? options.parentId ?? null : (node.parentId ? ids.get(node.parentId) ?? null : null),
      pageId: (scope === 'selected' ? activePageId : dependencyPageId) ?? undefined,
      componentId: node.componentId ? mapComponent(scope, node.componentId) : null,
      componentProperties: properties, componentPropertyValues: values,
      componentSet: node.componentSet ? { axes: node.componentSet.axes.map(axis => ({ ...axis, id: mapId(scope, axis.id) })) } : undefined,
      variantValues: node.variantValues?.map(value => ({ ...value, axisId: mapId(scope, value.axisId) })),
      instanceOverrides: node.instanceOverrides?.map(override => ({ ...override,
        textRuns: mapDesignTextHyperlinks(override.textRuns, hyperlink),
        ...(override.effects ? { effects: override.effects.map(effect) } : {}),
        effectStyleId: resourceId(override.effectStyleId, 'effectStyle'),
        path: path(override.path, linkedScope),
        ...(override.componentId ? { componentId: mapComponent(scope, override.componentId) } : {}),
        ...(override.layoutBindings ? { layoutBindings: Object.fromEntries(Object.entries(override.layoutBindings)
          .map(([key, id]) => [key, resourceId(id, 'number')])) } : {}),
        ...(override.grid ? { grid: { ...override.grid,
          columns: override.grid.columns?.map(track => ({ ...track, variableId: resourceId(track.variableId, 'number') })),
          rows: override.grid.rows?.map(track => ({ ...track, variableId: resourceId(track.variableId, 'number') })),
          implicitRow: override.grid.implicitRow && { ...override.grid.implicitRow,
            variableId: resourceId(override.grid.implicitRow.variableId, 'number') },
        } } : {}),
      })),
      instanceStroke: node.instanceStroke && { ...node.instanceStroke, strokeVariableId:resourceId(node.instanceStroke.strokeVariableId),
        strokes:node.instanceStroke.strokes?.map(paint=>({ ...paint,id:allocate(),
          variableId:resourceId(paint.variableId) ?? null,gradient:gradient(paint.gradient) })) },
      fillVariableId: resourceId(node.fillVariableId) ?? null, strokeVariableId: resourceId(node.strokeVariableId),
      textStyleId: resourceId(node.textStyleId, 'style'), tokenModeId: resourceId(node.tokenModeId, 'mode'),
      numericBindings: node.numericBindings && Object.fromEntries(Object.entries(node.numericBindings).map(([key, value]) => [key, resourceId(value, 'number')])),
      effects: node.effects?.map(effect), effectStyleId: resourceId(node.effectStyleId, 'effectStyle'),
      strokes:node.strokes?.map(paint=>({ ...paint,id:allocate(),
        variableId:resourceId(paint.variableId) ?? null,gradient:gradient(paint.gradient) })),
      gradient: gradient(node.gradient), fills: node.fills?.map(fill => ({ ...fill, id: allocate(),
        variableId: resourceId(fill.variableId) ?? null, gradient: gradient(fill.gradient) })),
      instanceGrid:node.instanceGrid && { ...node.instanceGrid,
        columns:node.instanceGrid.columns?.map(track=>({ ...track,variableId:resourceId(track.variableId,'number') })),
        rows:node.instanceGrid.rows?.map(track=>({ ...track,variableId:resourceId(track.variableId,'number') })),
        implicitRow:node.instanceGrid.implicitRow && { ...node.instanceGrid.implicitRow,variableId:resourceId(node.instanceGrid.implicitRow.variableId,'number') },
      },
      grid: node.grid && { ...node.grid, columns: node.grid.columns.map(track => ({ ...track, variableId: resourceId(track.variableId, 'number') })),
        rows: node.grid.rows.map(track => ({ ...track, variableId: resourceId(track.variableId, 'number') })),
        implicitRow: { ...node.grid.implicitRow, variableId: resourceId(node.grid.implicitRow.variableId, 'number') } },
      ...(root ? { x: node.x - minX + origin.x, y: node.y - minY + origin.y,
        ...(!sameDocument ? { tokenModeId: resourceId(modeByRoot.get(node.id), 'mode') ?? 'base' } : {}),
        ...(node.constraints && parent ? { constraints: { ...node.constraints,
          referenceWidth: parent.width, referenceHeight: parent.height } } : {}) } : {}),
    }
    if (root && !parentAllocates) {
      const sizing = sizingByRoot.get(node.id), edits: Partial<CopyOSDesignNode> = {}
      if (sizing?.widthSizing === 'fill') { edits.width = result.width; edits.widthSizing = 'fixed' }
      if (sizing?.heightSizing === 'fill') { edits.height = result.height; edits.heightSizing = 'fixed' }
      if (Object.keys(edits).length) return markDesignInstanceSizingEdit(result, { ...edits, numericBindings: result.numericBindings })
    }
    return result
  }
  const requiredResource = (id: string, kind: keyof typeof resources = 'color'): string => resourceId(id, kind) ?? reject('Clipboard resource is missing')
  const colors = library.variables.map(value => ({ ...value, id: requiredResource(value.id), aliasId: resourceId(value.aliasId),
    alphaSource: value.alphaSource?.kind === 'number' ? { ...value.alphaSource, variableId: requiredResource(value.alphaSource.variableId, 'number') } : value.alphaSource }))
  const numbers = library.numberVariables?.map(value => ({ ...value, id: requiredResource(value.id, 'number'),
    expression:value.expression?mapDesignNumberExpressionReferences(value.expression,id=>requiredResource(id,'number')):value.expression,
    aliasId: resourceId(value.aliasId, 'number') }))
  const styles = library.textStyles?.map(value => ({ ...value, id: requiredResource(value.id, 'style') }))
  const effectStyles = library.effectStyles?.map(value => ({ ...value, id: requiredResource(value.id, 'effectStyle'), effects: value.effects.map(effect) }))
  const modes = library.tokenModes?.map(mode => ({ ...mode, id: requiredResource(mode.id, 'mode'),
    variables: mode.variables.map(value => ({ ...value, id: requiredResource(value.id), aliasId: resourceId(value.aliasId),
      alphaSource: value.alphaSource?.kind === 'number' ? { ...value.alphaSource, variableId: requiredResource(value.alphaSource.variableId, 'number') } : value.alphaSource })),
    numberVariables: mode.numberVariables.map(value => ({ ...value, id: requiredResource(value.id, 'number'),
      expression:value.expression?mapDesignNumberExpressionReferences(value.expression,id=>requiredResource(id,'number')):value.expression,
      aliasId: resourceId(value.aliasId, 'number') })) }))
  const append = <T extends { id: string }>(existing: readonly T[] | undefined, imported: readonly T[] | undefined): T[] =>
    [...existing ?? [], ...imported?.filter(value => !existing?.some(previous => previous.id === value.id)) ?? []]
  const imported = selected.map(node => remap(node, 'selected'))
  let libraryCopies = dependencyNodes.map(node => remap(node, 'library'))
  // New masters start 100 px right of the masters already on a reused page, keeping their relative layout.
  const placedMasters = existingNodes.filter(node => node.parentId === null && node.pageId === dependencyPageId)
  const arriving = libraryCopies.filter(node => node.parentId === null)
  if (placedMasters.length && arriving.length) {
    const shift = Math.max(...placedMasters.map(node => node.x + node.width)) + 100 - Math.min(...arriving.map(node => node.x))
    libraryCopies = libraryCopies.map(node => node.parentId === null ? { ...node, x: node.x + shift } : node)
  }
  let candidate: CopyOSDesignDocument = { ...destination, pages,
    nodes: [...existingNodes.filter(node => !removed.has(node.id)), ...libraryCopies, ...imported],
    variables: append(destination.variables, colors), numberVariables: append(destination.numberVariables, numbers),
    textStyles: append(destination.textStyles, styles), effectStyles: append(destination.effectStyles, effectStyles),
    tokenModes: append(destination.tokenModes, modes) }
  candidate = reconcileDesignComponentProperties(destination, pruneDesignComponentProperties(candidate, destination))
  const document = parseDesignDocument(reconcileDesignTextHyperlinks(destination, candidate))
  return { document, ...(removedNodeLinks ? { removedNodeLinks, notices: [`Removed ${removedNodeLinks} internal text link(s) whose destinations were not copied into this document.`] } : {}), selectedIds: snapshot.rootIds.map(id => selectedIds.get(id) ?? reject('Clipboard selected identity is missing')),
    dependencyIds: libraryCopies.map(node => node.id), dependencyPageId, activePageId }
}
