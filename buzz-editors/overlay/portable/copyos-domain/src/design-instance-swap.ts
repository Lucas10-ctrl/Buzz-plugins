import { rebaseDesignTextRuns } from './design-text-runs.ts'
import { designComponentPropertyDefinitions } from './design-component-property-definitions.ts'
/** Local component swaps preserve uniquely matched content without detaching instances. */
import { designInstanceOverrideTarget } from './design-instance-overrides.ts'
import { reconcileDesignComponentProperties } from './design-component-properties.ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignInstanceOverride, CopyOSDesignComponentPropertyValue } from './types.ts'

type Metrics = { height: number; count: number }
function swapGraph(document: CopyOSDesignDocument) {
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  const children = new Map<string, string[]>(), reverse = new Map<string, string[]>()
  for (const node of document.nodes) {
    if (node.parentId) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node.id)
      children.set(node.parentId, siblings)
    }
  }
  const edges = (id: string, swaps: ReadonlyMap<string, string>): string[] => {
    const node = nodes.get(id)
    const componentId = swaps.get(id) ?? node?.componentId
    return [...children.get(id) ?? [], ...(node?.kind === 'instance' && componentId ? [componentId] : [])]
  }
  for (const node of document.nodes)
    for (const child of edges(node.id, new Map())) {
      const parents = reverse.get(child) ?? []
      parents.push(node.id)
      reverse.set(child, parents)
    }
  const rootIds = new Set(document.nodes.filter(node => node.parentId === null).map(node => node.id))
  const totals = new WeakMap<Map<string, Metrics>, number>()
  const calculate = (swaps: ReadonlyMap<string, string>, cached = new Map<string, Metrics>(), affected?: ReadonlySet<string>) => {
    const result = new Map<string, Metrics>(), visiting = new Set<string>()
    const visit = (id: string): Metrics => {
      if (visiting.has(id)) throw new Error('Cyclic layer or component hierarchy')
      const known = result.get(id) ?? (affected && !affected.has(id) ? cached.get(id) : undefined)
      if (known) return known
      if (visiting.size >= 64) throw new Error('Design nesting exceeds 64 layers')
      visiting.add(id)
      const descendants = edges(id, swaps).map(visit)
      const value = { height: 1 + Math.max(0, ...descendants.map(item => item.height)),
        count: 1 + descendants.reduce((sum, item) => sum + item.count, 0) }
      if (value.height > 64) throw new Error('Design nesting exceeds 64 layers')
      if (value.count > 50000) throw new Error('Expanded component scene exceeds 50000 layers')
      visiting.delete(id)
      result.set(id, value)
      return value
    }
    for (const id of affected ?? nodes.keys()) visit(id)
    let total = affected ? (totals.get(cached) ?? 0) : 0
    for (const id of affected ?? rootIds) if (rootIds.has(id))
      total += (result.get(id)?.count ?? 0) - (affected ? (cached.get(id)?.count ?? 0) : 0)
    if (total > 100000) throw new Error('Expanded scene exceeds 100000 layers')
    totals.set(result, total)
    return result
  }
  return { nodes, children, reverse, calculate }
}

function targetIndex(
  document: CopyOSDesignDocument,
  root: string,
  wantedPaths?: ReadonlySet<string>,
  wantedSignatures?: ReadonlySet<string>,
) {
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of document.nodes) if (node.parentId) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const paths = new Map<string, string>()
  const signatures = new Map<string, { count: number; path: string[]; node: CopyOSDesignNode }>()
  let count = 0
  const digest = (parent: string, kind: string, name: string) => bytesToHex(sha256(utf8ToBytes(JSON.stringify([parent, kind, name]))))
  const visit = (parent: string, signature: string, prefix: string[], depth: number): void => {
    if (depth > 64) throw new Error('Design nesting exceeds 64 layers')
    for (const node of children.get(parent) ?? []) {
      if (++count > 50000) throw new Error('Expanded component scene exceeds 50000 layers')
      const key = digest(signature, node.kind, node.name), path = [...prefix, node.id]
      if (!wantedSignatures || wantedSignatures.has(key)) {
        const previous = signatures.get(key)
        signatures.set(key, { count: (previous?.count ?? 0) + 1, path, node })
      }
      const pathKey = JSON.stringify(path)
      if (wantedPaths?.has(pathKey)) paths.set(pathKey, key)
      visit(node.id, key, prefix, depth + 1)
      if (node.kind === 'instance' && node.componentId && nodes.has(node.componentId))
        visit(node.componentId, digest(key, '$instance', ''), [...prefix, node.id], depth + 1)
    }
  }
  visit(root, '', [], 0)
  return { paths, signatures }
}

function swapTextValue(document: CopyOSDesignDocument, root: string, path: readonly string[], fallback: string,
  values: readonly CopyOSDesignComponentPropertyValue[] = [], previousRoot = root): string {
  const property = designComponentPropertyDefinitions(document, root).find(item => item.type === 'text' &&
    item.targets.some(target => JSON.stringify(target) === JSON.stringify(path)))
  if (property?.type !== 'text') return fallback
  const previous = designComponentPropertyDefinitions(document, previousRoot).find(item => item.type === 'text' &&
    (item.id === property.id || item.name === property.name))
  const value = values.find(item => item.propertyId === previous?.id)?.value
  return typeof value === 'string' ? value : property.defaultValue
}
function remapTextRuns(record: CopyOSDesignInstanceOverride, source: CopyOSDesignNode | undefined,
  target: CopyOSDesignNode, from = source?.text, to = target.text): CopyOSDesignInstanceOverride['textRuns'] {
  if (!record.textRuns || record.text !== undefined || !source || from === undefined || from === to)
    return structuredClone(record.textRuns)
  return rebaseDesignTextRuns({ ...source, text: from, textRuns: record.textRuns }, to).textRuns
}

/** Remap contextual descendant records by unique ordinary and nested name/kind hierarchy.
 * @param document - Component library before the contextual replacement.
 * @param sourceId - Old main component.
 * @param targetId - New main component.
 * @param records - Paths rooted in the old main.
 * @param values - Explicit source TEXT values remain authoritative when matching controls survive the swap.
 * @returns Compatible uniquely matched records; stale text measurements are discarded.
 */
export function remapDesignSwapOverrides(document:CopyOSDesignDocument,sourceId:string,targetId:string,
  records:readonly CopyOSDesignInstanceOverride[], values:readonly CopyOSDesignComponentPropertyValue[]=[]):CopyOSDesignInstanceOverride[] {
  if (sourceId===targetId) return [...records]
  const source=targetIndex(document,sourceId,new Set(records.map(item=>JSON.stringify(item.path))))
  const target=targetIndex(document,targetId,undefined,new Set(source.paths.values()))
  return records.flatMap((item)=>{
    const signature=source.paths.get(JSON.stringify(item.path)),match=signature ? target.signatures.get(signature) : undefined
    if (!signature) {
      const root=document.nodes.find(node=>node.id===targetId)
      const explicit=root && designInstanceOverrideTarget(document.nodes,{ ...root,kind:'instance',componentId:targetId },item.path)
      return explicit ? [{ ...item }] : []
    }
    if (source.signatures.get(signature)?.count!==1 || match?.count!==1) return []
    const record:CopyOSDesignInstanceOverride={ path:match.path,
      ...(item.effects !== undefined ? { effects: structuredClone(item.effects) } : {}),
      ...(item.effectStyleId !== undefined ? { effectStyleId: item.effectStyleId } : {}),
      ...(item.fontFeatures !== undefined && match.node.kind === 'text' ? { fontFeatures: structuredClone(item.fontFeatures) } : {}),
      ...(item.fontVariations !== undefined && match.node.kind === 'text' ? { fontVariations: structuredClone(item.fontVariations) } : {}),
      ...(item.text!==undefined && match.node.kind==='text'?{ text:item.text }:{}),
      ...(item.textRuns!==undefined && match.node.kind==='text'?{ textRuns:remapTextRuns(item, source.signatures.get(signature)?.node, match.node,
        swapTextValue(document,sourceId,item.path,source.signatures.get(signature)?.node.text ?? '',values),
        swapTextValue(document,targetId,match.path,match.node.text,values,sourceId)) }:{}),
      ...(item.visible!==undefined?{ visible:item.visible }:{}),
      ...(item.blendMode!==undefined?{ blendMode:item.blendMode }:{}),
      ...(item.gridCell?{ gridCell:{ ...item.gridCell } }:{}),
      ...(item.grid?{ grid:structuredClone(item.grid) }:{}),
      ...(item.layout ? { layout: { ...item.layout } } : {}),
      ...(item.layoutBindings ? { layoutBindings: { ...item.layoutBindings } } : {}),
      ...(item.componentId!==undefined && match.node.kind==='instance'?{ componentId:item.componentId }:{}) }
    return record.effectStyleId!==undefined || record.effects!==undefined || record.text!==undefined ||
      record.textRuns!==undefined || record.fontFeatures!==undefined || record.fontVariations!==undefined ||
      record.visible!==undefined || record.componentId!==undefined ||
      record.blendMode!==undefined || record.gridCell || record.grid || record.layout || record.layoutBindings ? [record] : []
  })
}

/** Replace a contextual instance main without mutating its library node or authoring geometry.
 * @param document - Complete component library.
 * @param node - Effective instance in its current outer context.
 * @param componentId - Replacement main.
 * @returns Instance with matched content/named values and unchanged sizing, layout and transforms.
 */
export function swapDesignInstanceNode(document:CopyOSDesignDocument,node:CopyOSDesignNode,componentId:string):CopyOSDesignNode {
  if (node.kind!=='instance' || !node.componentId) throw new Error('Select a linked instance')
  if (document.nodes.find(item=>item.id===componentId)?.kind!=='component') throw new Error('Component source not found')
  if (node.componentId===componentId) return node
  const source=designComponentPropertyDefinitions(document,node.componentId)
  const target=designComponentPropertyDefinitions(document,componentId)
  return { ...node,componentId,textLayoutMetrics:undefined,textBaselineMetrics:undefined,
    instanceOverrides:remapDesignSwapOverrides(document,node.componentId,componentId,
      node.instanceOverrides ?? [],node.componentPropertyValues),
    componentPropertyValues:node.componentPropertyValues?.flatMap((value)=>{
      const property=source.find(item=>item.id===value.propertyId)
      if (!property) return []
      const matches=target.filter(item=>item.name===property.name && item.type===property.type)
      return matches.length===1 && matches[0] ? [{ ...value,propertyId:matches[0].id }] : []
    }) }
}

function instanceSwapProbe(document:CopyOSDesignDocument,nodeId:string) {
  const graph = swapGraph(document), instance = graph.nodes.get(nodeId)
  if (instance?.kind !== 'instance') return undefined
  const contextual=document.nodes.some(node=>node.componentProperties?.some(property=>property.type==='instance-swap') ||
    node.instanceOverrides?.some(record=>record.componentId))
  const baseline = graph.calculate(new Map()), affected = new Set([nodeId]), pending = [nodeId]
  for (let id = pending.pop(); id; id = pending.pop()) {
    for (const parent of graph.reverse.get(id) ?? []) if (!affected.has(parent)) {
      affected.add(parent)
      pending.push(parent)
    }
  }
  const allowed=(node:CopyOSDesignNode):boolean=>{
    try {
      graph.calculate(new Map([[nodeId, node.id]]), baseline, affected)
      if (contextual) swapDesignInstances(document,[{ nodeId,componentId:node.id }])
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return false
    }
  }
  return { instance,allowed }
}

/** Search general instance replacements with a bounded number of graph probes.
 * @param document - Validated native scene.
 * @param nodeId - Stored linked root instance identity.
 * @param options - Cheap name/ancestor/page query and probe cursor/limit (1–100, default 20) in authored order.
 * @returns Safe choices, rejected probes and remaining unsearched components; an empty page can still advance.
 */
export function designInstanceSwapCandidateSummary(document:CopyOSDesignDocument,nodeId:string,
  options:{ query?:string;cursor?:number;limit?:number }={})
  :{ candidates:CopyOSDesignNode[];nextCursor:number|null;unsearched:number;rejected:number } {
  const byId=new Map(document.nodes.map(node=>[node.id,node]))
  const instance=byId.get(nodeId)
  if (instance?.kind!=='instance') return { candidates:[],nextCursor:null,unsearched:0,rejected:0 }
  const terms=options.query?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? []
  const pages=new Map(document.pages?.map(page=>[page.id,page.name]))
  const choices=document.nodes.filter((node)=>{
    if (node.kind!=='component' || node.id===instance.componentId) return false
    if (!terms.length) return true
    const names=[node.name]
    let parent=node.parentId,pageId=node.pageId
    for (let depth=0;parent && depth<64;depth++) {
      const ancestor=byId.get(parent);if (!ancestor) break
      names.push(ancestor.name);pageId ??= ancestor.pageId;parent=ancestor.parentId
    }
    const page=pages.get(pageId ?? document.pages?.[0]?.id ?? '')
    if (page) names.push(page)
    const location=names.join(' / ').toLocaleLowerCase()
    return terms.every(term=>location.includes(term))
  })
  const cursor=Math.max(0,Math.min(choices.length,Math.trunc(options.cursor ?? 0)))
  const limit=Math.max(1,Math.min(100,Math.trunc(options.limit ?? 20)))
  const page=choices.slice(cursor,cursor+limit),probe=page.length ? instanceSwapProbe(document,nodeId) : undefined
  const candidates=page.filter(node=>probe?.allowed(node))
  const end=cursor+page.length,unsearched=choices.length-end
  return { candidates,nextCursor:unsearched?end:null,unsearched,rejected:page.length-candidates.length }
}

/** Find all safe local replacements, excluding the current main component.
 * @param document - Validated scene.
 * @param nodeId - Stored linked instance identity.
 * @returns Complete safe choices in authored order; use designInstanceSwapCandidateSummary for bounded probing.
 */
export function designInstanceSwapCandidates(document:CopyOSDesignDocument,nodeId:string):CopyOSDesignNode[] {
  const probe=instanceSwapProbe(document,nodeId)
  return probe ? document.nodes.filter(node=>node.kind==='component' && node.id!==probe.instance.componentId && probe.allowed(node)) : []
}

/** Swap linked main components simultaneously, preserving unique hierarchy-matched text and visibility.
 * @param document - Validated scene before the transaction.
 * @param swaps - Unique instance identities and local component targets; final graph limits are checked atomically.
 * @returns New scene retaining geometry, sizing, modes and root settings; stale text measurements are discarded.
 */
export function swapDesignInstances(
  document: CopyOSDesignDocument,
  swaps: readonly { nodeId: string; componentId: string }[],
): CopyOSDesignDocument {
  if (!swaps.length) return document
  const graph = swapGraph(document), replacements = new Map<string, string>()
  for (const swap of swaps) {
    if (replacements.has(swap.nodeId)) throw new Error('Duplicate instance swaps')
    if (graph.nodes.get(swap.nodeId)?.kind !== 'instance') throw new Error('Select a linked instance')
    if (graph.nodes.get(swap.componentId)?.kind !== 'component') throw new Error('Component source not found')
    replacements.set(swap.nodeId, swap.componentId)
  }
  graph.calculate(replacements)
  if (swaps.every(swap => graph.nodes.get(swap.nodeId)?.componentId === swap.componentId)) return document
  const targetDocument = { ...document, nodes: document.nodes.map(node => replacements.has(node.id)
    ? { ...node, componentId: replacements.get(node.id) ?? node.componentId } : node) }
  const candidate = {
    ...document,
    nodes: document.nodes.map((node) => {
      const crossed = (path:readonly string[]) => path.slice(0,-1).some(id =>
        replacements.has(id) && replacements.get(id) !== graph.nodes.get(id)?.componentId)
      if ((node.kind === 'component' || node.kind === 'component-set') && node.componentProperties?.some(property => property.targets.some(crossed))) {
        const indexes = new Map<string, { source: ReturnType<typeof targetIndex>; target: ReturnType<typeof targetIndex> }>()
        return { ...node, componentProperties: node.componentProperties.map(property => ({ ...property,
          targets: property.targets.flatMap((path) => {
            if (!crossed(path)) return [path]
            const prefix = node.kind === 'component-set' ? path.slice(0, 1) : []
            const root = prefix[0] ?? node.id, relative = prefix.length ? path.slice(1) : path
            let index = indexes.get(root)
            if (!index) {
              const paths = node.componentProperties?.flatMap(value => value.targets.filter(crossed)
                .filter(target => !prefix.length || target[0] === root).map(target => prefix.length ? target.slice(1) : target)) ?? []
              const source = targetIndex(document, root, new Set(paths.map(target => JSON.stringify(target))))
              index = { source, target: targetIndex(targetDocument, root, undefined, new Set(source.paths.values())) }
              indexes.set(root, index)
            }
            const signature = index.source.paths.get(JSON.stringify(relative)), match = signature
              ? index.target.signatures.get(signature) : undefined
            return signature && index.source.signatures.get(signature)?.count === 1 && match?.count === 1
              ? [[...prefix, ...match.path]] : []
          }),
        })) }
      }

      const componentId = replacements.get(node.id) ?? node.componentId
      const changedComponent = componentId !== node.componentId
      const crossesSwap = (item: CopyOSDesignInstanceOverride) => item.path.slice(0, -1).some(id =>
        replacements.has(id) && replacements.get(id) !== graph.nodes.get(id)?.componentId)
      if (!componentId || node.kind !== 'instance' ||
        (!changedComponent && !node.instanceOverrides?.some(crossesSwap))) return node
      const overrides: CopyOSDesignInstanceOverride[] = []
      const records = (node.instanceOverrides ?? []).filter(item =>
        (changedComponent || crossesSwap(item)) &&
        (item.effectStyleId !== undefined || item.effects !== undefined || item.text !== undefined ||
          item.textRuns !== undefined || item.fontFeatures !== undefined || item.fontVariations !== undefined ||
          item.visible !== undefined || item.componentId !== undefined ||
          item.blendMode !== undefined || item.gridCell || item.grid || item.layout || item.layoutBindings))
      if (!changedComponent) overrides.push(...(node.instanceOverrides ?? []).filter(item => !crossesSwap(item)))
      if (records.length && node.componentId) {
        const source = targetIndex(document, node.componentId, new Set(records.map(item => JSON.stringify(item.path))))
        const target = targetIndex(targetDocument, componentId, undefined, new Set(source.paths.values()))
        for (const item of records) {
          const signature = source.paths.get(JSON.stringify(item.path))
          const match = signature && target.signatures.get(signature)
          if (!signature || source.signatures.get(signature)?.count !== 1 || !match || match.count !== 1) continue
          overrides.push({ path: match.path,
            ...(item.effects !== undefined ? { effects: structuredClone(item.effects) } : {}),
            ...(item.effectStyleId !== undefined ? { effectStyleId: item.effectStyleId } : {}),
            ...(item.fontFeatures !== undefined && match.node.kind === 'text' ? { fontFeatures: structuredClone(item.fontFeatures) } : {}),
            ...(item.fontVariations !== undefined && match.node.kind === 'text' ? { fontVariations: structuredClone(item.fontVariations) } : {}),
            ...(item.text !== undefined && match.node.kind === 'text' ? { text: item.text } : {}),
            ...(item.textRuns !== undefined && match.node.kind === 'text'
              ? { textRuns: remapTextRuns(item, source.signatures.get(signature)?.node, match.node,
                swapTextValue(document,node.componentId,item.path,source.signatures.get(signature)?.node.text ?? '',node.componentPropertyValues),
                swapTextValue(targetDocument,componentId,match.path,match.node.text,node.componentPropertyValues,node.componentId)) } : {}),
            ...(item.visible !== undefined ? { visible: item.visible } : {}),
            ...(item.blendMode !== undefined ? { blendMode: item.blendMode } : {}),
            ...(item.gridCell ? { gridCell: { ...item.gridCell } } : {}),
            ...(item.grid ? { grid: structuredClone(item.grid) } : {}),
            ...(item.layout ? { layout: { ...item.layout } } : {}),
            ...(item.layoutBindings ? { layoutBindings: { ...item.layoutBindings } } : {}),
            ...(item.componentId !== undefined && match.node.kind==='instance' ? { componentId:item.componentId } : {}) })
        }
      }
      const sourceProperties=designComponentPropertyDefinitions(document,node.componentId ?? '')
      const targetProperties=designComponentPropertyDefinitions(document,componentId)
      const values=changedComponent ? (node.componentPropertyValues ?? []).flatMap((value)=>{
        const property=sourceProperties.find(item=>item.id===value.propertyId)
        if (!property) return []
        const matches=targetProperties.filter(item=>item.name===property.name && item.type===property.type)
        const unique=sourceProperties.filter(item=>item.name===property.name && item.type===property.type).length===1
        return unique && matches.length===1 && matches[0] ? [{ ...value,propertyId:matches[0].id }] : []
      }) : node.componentPropertyValues
      return { ...node, componentId, instanceOverrides: overrides,componentPropertyValues:values,
        ...(changedComponent ? { textLayoutMetrics: undefined, textBaselineMetrics: undefined } : {}) }
    }),
  }
  return reconcileDesignComponentProperties(document,candidate)
}

/** Swap one linked instance using the same atomic mapping rules as batch agent edits.
 * @param document - Validated scene.
 * @param nodeId - Stored linked instance identity.
 * @param componentId - New local main component identity.
 * @returns Updated scene, or the same identity when the source already matches.
 */
export function swapDesignInstanceComponent(
  document: CopyOSDesignDocument,
  nodeId: string,
  componentId: string,
): CopyOSDesignDocument {
  return swapDesignInstances(document, [{ nodeId, componentId }])
}
