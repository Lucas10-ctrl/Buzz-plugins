import { reconcileDesignTextRuns } from './design-text-range.ts'
/** Reusable component content, visibility and nested main controls and their portable lifecycle operations. */
import { designComponentPropertyDefinitions, designComponentPropertyOwner, designComponentPropertyTarget, materializeDesignComponentDepartures } from './design-component-property-definitions.ts'
import { remapDesignSwapOverrides } from './design-instance-swap.ts'
import { designComponentGraphIssues, designComponentGraphValid } from './design-component-graph.ts'
import { applyDesignInstanceOverrides, designInstanceOverrideTarget } from './design-instance-overrides.ts'
import type {
  CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignComponentProperty, CopyOSDesignComponentPropertyValue,
  CopyOSDesignInstanceOverride,
} from './types.ts'
type Property = CopyOSDesignComponentProperty
type Override = CopyOSDesignInstanceOverride
const pathKey = (path: readonly string[]) => JSON.stringify(path)
const field = (property: Property) => property.type === 'text' ? 'text' : property.type==='boolean' ? 'visible' : 'componentId'
function propertyValue(property: Property, values: readonly CopyOSDesignComponentPropertyValue[] = []) {
  return values.find(value => value.propertyId === property.id)?.value ?? property.defaultValue
}
function records(property: Property, value: string | boolean, targets = property.targets): Override[] {
  return targets.map(path => ({ path, ...(property.type === 'text' ? { text: String(value) } : property.type==='boolean' ? { visible: Boolean(value) } : { componentId:String(value) }) }))
}
function mergeRecords(...arrays: readonly (readonly Override[])[]): Override[] {
  const result = new Map<string,Override>()
  for (const array of arrays) for (const record of array) {
    const key = pathKey(record.path)
    result.set(key,{ ...result.get(key),
      ...Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)),path:[...record.path] })
  }
  return [...result.values()]
}
function clearFields(overrides: readonly Override[] | undefined, definitions: readonly Property[]): Override[] | undefined {
  if (!overrides) return overrides
  const result = overrides.flatMap((override) => {
    const controlled = definitions.filter(property => property.targets.some(path => pathKey(path) === pathKey(override.path)))
    const text = controlled.some(property => property.type === 'text'), visible = controlled.some(property => property.type === 'boolean')
    const swap=controlled.some(property=>property.type==='instance-swap')
    const next = { ...override,...(text ? { text:undefined } : {}),...(visible ? { visible:undefined } : {}),
      ...(swap?{ componentId:undefined }:{}) }
    return next.effectStyleId !== undefined || next.effects !== undefined || next.text !== undefined ||
      next.textRuns !== undefined || next.fontFeatures !== undefined || next.fontVariations !== undefined ||
      next.visible !== undefined || next.componentId!==undefined ||
      next.blendMode !== undefined || next.textLayoutMetrics || next.textBaselineMetrics || next.gridCell || next.grid ||
      next.layout || next.layoutBindings ? [next] : []
  })
  return result
}
function component(document: CopyOSDesignDocument, id: string): CopyOSDesignNode {
  const node = document.nodes.find(item => item.id === id)
  if (node?.kind !== 'component' && node?.kind !== 'component-set') throw new Error('Select a main component')
  return node
}
function validateDefinition(document:CopyOSDesignDocument, owner:CopyOSDesignNode, definition:Property):void {
  if (document.nodes.some(node => node.id === definition.id)) throw new Error('Component property identity collides with a layer')
  if (!definition.name.trim() || definition.name.trim().length > 120) throw new Error('Component property needs a name')
  if (typeof definition.defaultValue !== (definition.type === 'boolean' ? 'boolean' : 'string')) throw new Error('Component property value type mismatch')
  if (definition.type === 'text' && definition.defaultValue.length > 100000) throw new Error('Component text exceeds 100000 characters')
  if (definition.type!=='instance-swap' && 'preferredValues' in definition) throw new Error('Only swap properties have preferred values')
  if (definition.type==='instance-swap' && ((definition.preferredValues?.length ?? 0)>100 ||
    new Set(definition.preferredValues).size!==(definition.preferredValues?.length ?? 0)))
    throw new Error('Preferred components require at most 100 unique identities')
  if (definition.type==='instance-swap' && document.nodes.find(node=>node.id===definition.defaultValue)?.kind!=='component')
    throw new Error('Component property replacement source not found')
  if (definition.type==='instance-swap' && definition.preferredValues?.some(id=>document.nodes.find(node=>node.id===id)?.kind!=='component'))
    throw new Error('Preferred component source not found')
  if (definition.targets.length > 100) throw new Error('Component property exceeds 100 targets')
  if (document.nodes.some(node => node.componentProperties?.some(item => item.id === definition.id && node.id !== owner.id)))
    throw new Error('Duplicate component property identity')
  for (const existing of owner.componentProperties ?? []) {
    if (existing.id === definition.id) continue
    if (existing.name.trim() === definition.name.trim()) throw new Error('Duplicate component property name')
    if (existing.type === definition.type && existing.targets.some(path =>
      definition.targets.some(target => pathKey(path) === pathKey(target))))
      throw new Error('Component target field already has a property')
  }
  const members = owner.kind === 'component-set' ? document.nodes.filter(node => node.parentId === owner.id && node.kind === 'component') : [owner]
  for (const member of members) {
    const projected = owner.kind === 'component-set' ? definition.targets.filter(path => path[0] === member.id).map(path => path.slice(1)) : definition.targets
    for (const existing of designComponentPropertyDefinitions(document, member.id)) {
      if (existing.id === definition.id) continue
      if (existing.name.trim() === definition.name.trim()) throw new Error('Duplicate effective component property name')
      if (existing.type === definition.type && existing.targets.some(path => projected.some(target => pathKey(path) === pathKey(target))))
        throw new Error('Component target field already has a property')
    }
    if (designComponentPropertyDefinitions(document, member.id).filter(property => property.id !== definition.id).length >= 100)
      throw new Error('A component supports at most 100 effective properties')
  }
  const seen = new Set<string>()
  for (const path of definition.targets) {
    if (seen.has(pathKey(path))) throw new Error('Duplicate component property target')
    seen.add(pathKey(path))
    const target = designComponentPropertyTarget(document,owner,path)
    if (!target || (definition.type === 'text' && target.kind !== 'text') ||
      (definition.type==='instance-swap' && target.kind!=='instance')) throw new Error('Invalid component property target')
  }
}

function propertyScopes(document: Pick<CopyOSDesignDocument, 'nodes'>, owner: CopyOSDesignNode, property: Property)
  : { componentId: string; targets: string[][] }[] {
  return owner.kind === 'component-set'
    ? document.nodes.filter(node => node.parentId === owner.id && node.kind === 'component').map(node => ({
      componentId: node.id, targets: property.targets.filter(path => path[0] === node.id).map(path => path.slice(1)),
    })) : [{ componentId: owner.id, targets: property.targets }]
}
/** Page authored descendants while retaining stable set-prefixed and nested-instance target paths.
 * @param document - Validated native scene.
 * @param componentId - Main component or component-set identity.
 * @param options - Nonnegative row offset and retained-row limit (1–50000, default 20); hidden descendants remain available.
 * @returns This target page, complete target count and the next retrievable offset in authored traversal order.
 */
export function designComponentPropertyTargetPage(document:CopyOSDesignDocument,componentId:string,
  options:{ offset?:number;limit?:number }={})
  :{ layers:{ path:string[];names:string[];node:CopyOSDesignNode }[];total:number;offset:number;nextOffset:number|null } {
  const offset=Math.max(0,Math.trunc(options.offset ?? 0)),limit=Math.max(1,Math.min(50000,Math.trunc(options.limit ?? 20)))
  const owner = component(document,componentId)
  const byId = new Map(document.nodes.map(node => [node.id,node]))
  const children = new Map<string,CopyOSDesignNode[]>()
  for (const node of document.nodes) if (node.parentId) {
    const siblings = children.get(node.parentId) ?? [];siblings.push(node);children.set(node.parentId,siblings)
  }
  const result:{ path:string[];names:string[];node:CopyOSDesignNode }[]=[]
  let count=0
  const visit=(parent:string,prefix:string[],names:string[],depth:number):void=>{
    if (depth>64) throw new Error('Design nesting exceeds 64 layers')
    for (const node of children.get(parent) ?? []) {
      if (++count > 50000) throw new Error('Expanded component scene exceeds 50000 layers')
      if (count>offset && result.length<limit) result.push({ path:[...prefix,node.id],names:[...names,node.name],node })
      visit(node.id,prefix,[...names,node.name],depth+1)
      if (node.kind==='instance' && node.componentId && byId.has(node.componentId))
        visit(node.componentId,[...prefix,node.id],[...names,node.name],depth+1)
    }
  }
  if (owner.kind === 'component-set') {
    for (const member of children.get(componentId) ?? []) if (member.kind === 'component')
      visit(member.id,[member.id],[member.name],1)
  } else visit(componentId,[],[],0)
  return { layers:result,total:count,offset,nextOffset:offset+result.length<count ? offset+result.length : null }
}

/** Enumerate authored component descendants with ordinary names and stable nested-instance override paths.
 * @param document - Validated native scene.
 * @param componentId - Main component or component-set identity.
 * @param limit - Maximum target rows to allocate; traversal still reports the omitted count.
 * @returns Bounded target layers and omitted count; use designComponentPropertyTargetPage to retrieve tails.
 */
export function designComponentPropertyTargetSummary(document:CopyOSDesignDocument,componentId:string,limit=20)
  :{ layers:{ path:string[];names:string[];node:CopyOSDesignNode }[];omitted:number } {
  const page=designComponentPropertyTargetPage(document,componentId,{ limit })
  const layers=limit<=0 ? [] : page.layers
  return { layers,omitted:Math.max(0,page.total-layers.length) }
}

/** Enumerate all available component property targets for local authoring.
 * @param document - Validated scene.
 * @param componentId - Main identity.
 * @returns Target layers and nested paths, including hidden descendants.
 */
export function designComponentPropertyTargets(document:CopyOSDesignDocument,componentId:string)
  :{ path:string[];names:string[];node:CopyOSDesignNode }[] {
  return designComponentPropertyTargetSummary(document,componentId,50000).layers
}

/** Read reusable controls and their effective instance values without copying defaults into local records.
 * @param document - Complete scene.
 * @param instanceId - Linked instance identity.
 * @returns Definitions with effective value and explicit-local status.
 */
export function designComponentPropertyValues(document:CopyOSDesignDocument,instanceId:string)
  :(Property & { value:string|boolean;overridden:boolean })[] {
  const instance=document.nodes.find(node=>node.id===instanceId)
  if (instance?.kind!=='instance') return []
  return designComponentPropertyDefinitions(document,instance.componentId ?? '').map(property=>({ ...property,value:propertyValue(property,instance.componentPropertyValues),
    overridden:!!instance.componentPropertyValues?.some(item=>item.propertyId===property.id) }))
}

/** Apply authoritative defaults before layout; a prepared linked root can skip its already-applied controls.
 * @param nodes - Authored tree or linked component subtree.
 * @param skipRoot - Already prepared linked root identity.
 * @param library - Complete library for nested replacement mapping.
 * @returns Transient nodes with default content, visibility and nested mains applied, without changing stored records.
 */
export function applyDesignComponentDefaults(nodes:readonly CopyOSDesignNode[],skipRoot?:string,
  library:readonly CopyOSDesignNode[]=nodes):CopyOSDesignNode[] {
  let result=[...nodes]
  const byId=new Map(nodes.map(node=>[node.id,node]))
  const depth=(node:CopyOSDesignNode):number=>{
    let parent=node.parentId,count=0
    while (parent && count<64) {count++;parent=byId.get(parent)?.parentId ?? null}
    return count
  }
  const components=nodes.filter(node=>node.kind==='component' && node.id!==skipRoot && designComponentPropertyDefinitions({ nodes:library },node.id).length)
    .sort((a,b)=>depth(b)-depth(a))
  for (const owner of components) result=applyDesignInstanceOverrides(result,
    mergeRecords(...designComponentPropertyDefinitions({ nodes:library },owner.id)
      .map(property=>records(property,property.defaultValue))),library)
  return result
}

/** Prepare linked content with defaults, local control values and compatible outer overrides.
 * @param nodes - Authored source subtree.
 * @param source - Main component root carrying control definitions.
 * @param instance - Linked instance carrying local values and descendant overrides.
 * @param library - Complete library for nested replacement mapping.
 * @returns Transient controlled source tree, ready for token resolution and layout.
 */
export function applyDesignComponentInstance(nodes:readonly CopyOSDesignNode[],source:CopyOSDesignNode,
  instance:CopyOSDesignNode,library:readonly CopyOSDesignNode[]=nodes)
  :CopyOSDesignNode[] {
  const propertyRecords=designComponentPropertyDefinitions({ nodes:library },source.id).flatMap(property=>
    records(property,propertyValue(property,instance.componentPropertyValues)))
  return applyDesignInstanceOverrides(applyDesignComponentDefaults(nodes,source.id,library),
    mergeRecords(propertyRecords,instance.instanceOverrides ?? []),library)
}

/** Reconcile definition/value edits and controlled canvas edits while preserving unrelated manual fields.
 * @param before - Validated scene before a transaction.
 * @param after - Candidate after node/resource edits; native validation still checks new references.
 * @param updates - Optional explicit edit fields, retaining same-value source field intent.
 * @returns Candidate with removed controls baked, controlled manual edits synchronized and obsolete local values removed.
 */
export function reconcileDesignComponentProperties(before:CopyOSDesignDocument,after:CopyOSDesignDocument,
  updates:readonly { id:string }[]=[]):CopyOSDesignDocument {
  if (!before.nodes.some(node=>node.componentProperties?.length) && !after.nodes.some(node=>node.componentProperties?.length)) return after
  after = materializeDesignComponentDepartures(before, after)
  for (const node of after.nodes) {
    const values=node.componentPropertyValues ?? []
    if (new Set(values.map(value=>value.propertyId)).size!==values.length) throw new Error('Duplicate component property value')
  }
  for (const owner of before.nodes) for (const property of owner.componentProperties ?? []) {
    const next=after.nodes.find(node=>node.id===owner.id)?.componentProperties?.find(item=>item.id===property.id)
    if (next && next.type!==property.type) throw new Error('Component property type is immutable')
  }
  const oldNodes=new Map(before.nodes.map(node=>[node.id,node]))
  const candidateNodes=new Map(after.nodes.map(node=>[node.id,node]))
  let nodes=pruneDesignComponentProperties(after,before).nodes.map(node=>node.kind==='instance'?{ ...node,
    componentPropertyValues:candidateNodes.get(node.id)?.componentPropertyValues }:node)
  const touched=new Map(updates.map(update=>[update.id,new Set(Object.keys(update))]))
  // Preserve appearance when an existing control or one of its target bindings is removed.
  for (const owner of before.nodes) for (const property of owner.componentProperties ?? []) {
    const current=nodes.find(node=>node.id===owner.id)?.componentProperties?.find(item=>item.id===property.id)
    const removed=property.targets.filter(path=>!current?.targets.some(target=>pathKey(path)===pathKey(target)))
    for (const scope of propertyScopes(before, owner, { ...property, targets: removed })) {
      const member = nodes.find(node => node.id === scope.componentId)
      if (!member) continue
      const valid = scope.targets.filter(path => designInstanceOverrideTarget(nodes,
        { ...member, kind: 'instance', componentId: member.id }, path))
      if (valid.length) {
        nodes = applyDesignInstanceOverrides(nodes, records(property, property.defaultValue, valid), nodes)
        nodes = nodes.map((node) => {
          if (node.kind !== 'instance' || node.componentId !== scope.componentId) return node
          const explicit = node.componentPropertyValues?.find(item => item.propertyId === property.id)
          const departed = owner.kind === 'component-set' && (member.parentId !== owner.id ||
            !nodes.some(value => value.id === owner.id && value.kind === 'component-set'))
          const oldLocal = departed
            ? oldNodes.get(node.id)?.componentPropertyValues?.find(item => item.propertyId === property.id)?.value : undefined
          const baked = valid.flatMap((path) => {
            const previous = node.instanceOverrides?.find(item => pathKey(item.path) === pathKey(path))?.[field(property)]
            return records(property, explicit?.value ?? oldLocal ?? previous ?? property.defaultValue, [path])
          })
          return { ...node, instanceOverrides: mergeRecords(node.instanceOverrides ?? [], baked) }
        })
      }
      if (!current) nodes = nodes.map(node => node.kind === 'instance' && node.componentId === scope.componentId ? { ...node,
        componentPropertyValues: node.componentPropertyValues?.filter(item => item.propertyId !== property.id) } : node)
    }
  }

  // Source target edits change their exposed default, including targets reached through stored nested instances.
  nodes=nodes.map((owner)=>{
    if (owner.kind!=='component' && owner.kind!=='component-set') return owner
    const properties=owner.componentProperties?.map((property)=>{
      const old=oldNodes.get(owner.id)?.componentProperties?.find(item=>item.id===property.id)
      if (!old) return property
      const changes:(string|boolean)[]=[]
      for (const scope of propertyScopes({ nodes }, owner, property)) {
        const targets = scope.targets.flatMap((path) => {
          const first = nodes.find(node => node.id === path[0])
          if (path.length < 2 || !first?.instanceOverrides?.some(record =>
            record.effectStyleId !== undefined || record.effects !== undefined ||
      record.text !== undefined || record.textRuns !== undefined || record.fontFeatures !== undefined ||
      record.fontVariations !== undefined ||
            record.visible !== undefined || record.componentId)) return [path]
          const member = nodes.find(node => node.id === scope.componentId)
          const mapped = member && designComponentPropertyContextPath({ ...after, nodes },
            { ...member, kind: 'instance', componentId: member.id }, path)
          return mapped && pathKey(mapped) !== pathKey(path) ? [path, mapped] : [path]
        })
        for (const path of targets) {
          const first = nodes.find(node => node.id === path[0]), previous = oldNodes.get(path[0] ?? '')
          const key = field(property)
          if (!first || !previous) continue
          const value = path.length === 1 ? first[key]
            : first.instanceOverrides?.find(item => pathKey(item.path) === pathKey(path.slice(1)))?.[key]
          const oldValue = path.length === 1 ? previous[key]
            : previous.instanceOverrides?.find(item => pathKey(item.path) === pathKey(path.slice(1)))?.[key]
          if (value !== undefined && value !== null &&
            (value !== oldValue || (path.length === 1 && touched.get(first.id)?.has(key)))) changes.push(value)
        }
      }
      if (new Set(changes).size>1) throw new Error('Controlled component targets need one shared value')
      const value=changes[0]
      if (old.defaultValue!==property.defaultValue) {
        if (value!==undefined && value!==property.defaultValue) throw new Error('Conflicting component default and target edits')
        return property
      }
      return value===undefined ? property : { ...property,defaultValue:value } as Property
    })
    return { ...owner,componentProperties:properties }
  })
  const definitions=new Map(nodes.filter(node=>node.kind==='component').map(node=>[node.id,designComponentPropertyDefinitions({ nodes },node.id)]))
  nodes=nodes.map((node)=>{
    if (node.kind!=='instance') return node
    const authored=definitions.get(node.componentId ?? '') ?? []
    const properties=node.instanceOverrides?.some(record=>record.effectStyleId!==undefined || record.effects!==undefined ||
      record.text!==undefined ||
      record.textRuns!==undefined || record.fontFeatures!==undefined || record.fontVariations!==undefined ||
      record.visible!==undefined || record.componentId)
      ? authored.map(property=>({ ...property,targets:property.targets.flatMap((path)=>{
        const mapped=designComponentPropertyContextPath({ ...after,nodes },node,path)
        return mapped && pathKey(mapped)!==pathKey(path)?[path,mapped]:[path]
      }) })) : authored
    const previous=oldNodes.get(node.id)
    const values=new Map((node.componentPropertyValues ?? []).map(item=>[item.propertyId,item.value]))
    for (const property of properties) {
      const key=field(property),changed:(string|boolean)[]=[]
      for (const target of property.targets) {
        const manual=node.instanceOverrides?.find(item=>pathKey(item.path)===pathKey(target))
        const oldManual=previous?.instanceOverrides?.find(item=>pathKey(item.path)===pathKey(target))
        if (manual?.[key]!==undefined && manual[key]!==oldManual?.[key]) changed.push(manual[key])
      }
      if (new Set(changed).size>1) throw new Error('Controlled component targets need one shared value')
      if (changed[0]!==undefined) {
        const explicit=node.componentPropertyValues?.find(item=>item.propertyId===property.id)
        const oldExplicit=previous?.componentPropertyValues?.find(item=>item.propertyId===property.id)
        if (explicit && explicit.value!==changed[0] &&
          (explicit.value!==oldExplicit?.value || touched.get(node.id)?.has('componentPropertyValues')))
          throw new Error('Conflicting component property and target edits')
        values.set(property.id,changed[0])
      }
    }
    return { ...node,componentPropertyValues:values.size ? [...values].map(([propertyId,value])=>({ propertyId,value })) : undefined,
      instanceOverrides:clearFields(node.instanceOverrides,properties) }
  })
  const candidate=reconcileDesignTextRuns(before, { ...after,nodes })
  if (nodes.some(node=>node.componentProperties?.some(property=>property.type==='instance-swap') ||
    node.instanceOverrides?.some(record=>record.componentId))) {
    const issue=designComponentGraphIssues(candidate)[0]
    if (issue) throw new Error(issue)
  }
  return candidate
}

/** Create one reusable control on a main component.
 * @param document - Native scene.
 * @param componentId - Main identity.
 * @param definition - Complete new text/boolean definition; identity is supplied by the caller.
 * @returns Controlled scene with defaults active and no conflicting descendant fields.
 */
export function createDesignComponentProperty(document:CopyOSDesignDocument,componentId:string,definition:Property):CopyOSDesignDocument {
  const owner=component(document,componentId)
  if (owner.componentProperties?.some(item=>item.id===definition.id)) throw new Error('Duplicate component property identity')
  if ((owner.componentProperties?.length ?? 0)>=100) throw new Error('Component exceeds 100 properties')
  validateDefinition(document,owner,definition)
  return reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>node.id===componentId?
    { ...node,componentProperties:[...node.componentProperties ?? [],{ ...definition,name:definition.name.trim() }] }:node) })
}

/** Edit a control without changing its type or identity.
 * @param document - Native scene.
 * @param componentId - Main identity.
 * @param propertyId - Existing control identity.
 * @param patch - Optional name, default, target or preferred component replacement.
 * @returns Candidate with removed targets baked and current targets controlled.
 */
export function editDesignComponentProperty(document:CopyOSDesignDocument,componentId:string,propertyId:string,
  patch:{ name?:string;defaultValue?:string|boolean;targets?:string[][];preferredValues?:string[]|undefined }):CopyOSDesignDocument {
  const owner=component(document,componentId),old=owner.componentProperties?.find(item=>item.id===propertyId)
  if (!old) throw new Error('Component property not found')
  const property={ ...old,...patch,name:patch.name?.trim() ?? old.name } as Property
  validateDefinition(document,owner,property)
  return reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>node.id===componentId?
    { ...node,componentProperties:node.componentProperties?.map(item=>item.id===propertyId?property:item) }:node) })
}

/** Remove a control while retaining its main default and current instance appearances.
 * @param document - Native scene.
 * @param componentId - Main identity.
 * @param propertyId - Existing control identity.
 * @returns Scene with target fields baked and obsolete local control values removed.
 */
export function removeDesignComponentProperty(document:CopyOSDesignDocument,componentId:string,propertyId:string):CopyOSDesignDocument {
  const owner=component(document,componentId)
  if (!owner.componentProperties?.some(item=>item.id===propertyId)) throw new Error('Component property not found')
  return reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>node.id===componentId?
    { ...node,componentProperties:node.componentProperties?.filter(item=>item.id!==propertyId) }:node) })
}

/** Set one explicit local control value and clear its redundant descendant fields.
 * @param document - Native scene.
 * @param instanceId - Linked instance identity.
 * @param propertyId - Control on the current main component.
 * @param value - String for text, boolean for visibility.
 * @returns Instance-local transaction preserving every other control and unrelated manual override.
 */
export function setDesignComponentPropertyValue(document:CopyOSDesignDocument,instanceId:string,propertyId:string,value:string|boolean)
  :CopyOSDesignDocument {
  const instance=document.nodes.find(node=>node.id===instanceId)
  const property=designComponentPropertyDefinitions(document,instance?.componentId ?? '').find(item=>item.id===propertyId)
  if (instance?.kind!=='instance' || !property) throw new Error('Component property not found')
  if (typeof value !== (property.type==='boolean'?'boolean':'string')) throw new Error('Component property value type mismatch')
  if (typeof value==='string' && value.length>100000) throw new Error('Component text exceeds 100000 characters')
  if (property.type==='instance-swap' && document.nodes.find(node=>node.id===value)?.kind!=='component')
    throw new Error('Component property replacement source not found')
  const values=new Map(instance.componentPropertyValues?.map(item=>[item.propertyId,item.value]))
  values.set(propertyId,value)
  return reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>node.id===instanceId?{ ...node,
    componentPropertyValues:[...values].map(([propertyId,value])=>({ propertyId,value })),
    instanceOverrides:clearFields(node.instanceOverrides,[property]) }:node) })
}

/** Reset one local control to its live main default.
 * @param document - Native scene.
 * @param instanceId - Linked instance identity.
 * @param propertyId - Control identity.
 * @returns Scene with the local value and controlled manual fields removed.
 */
export function resetDesignComponentPropertyValue(document:CopyOSDesignDocument,instanceId:string,propertyId:string):CopyOSDesignDocument {
  const instance=document.nodes.find(node=>node.id===instanceId)
  const property=designComponentPropertyDefinitions(document,instance?.componentId ?? '').find(item=>item.id===propertyId)
  if (instance?.kind!=='instance' || !property) throw new Error('Component property not found')
  return reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>node.id===instanceId?{ ...node,
    componentPropertyValues:node.componentPropertyValues?.filter(item=>item.propertyId!==propertyId),
    instanceOverrides:clearFields(node.instanceOverrides,[property]) }:node) })
}

/** Remap definition and target identities while cloning a component subtree.
 * @param properties - Optional definitions.
 * @param ids - Layer and property identities copied by the transaction.
 * @returns Independent definitions preserving external nested-source identities.
 */
export function remapDesignComponentPropertyDefinitions(properties:readonly Property[]|undefined,ids:ReadonlyMap<string,string>)
  :Property[]|undefined {
  return properties?.map(property=>({ ...property,id:ids.get(property.id) ?? property.id,
    targets:property.targets.map(path=>path.map(id=>ids.get(id) ?? id)),
    ...(property.type==='instance-swap'?{ defaultValue:ids.get(property.defaultValue) ?? property.defaultValue,
      preferredValues:property.preferredValues?.map(id=>ids.get(id) ?? id) }:{}) } as Property))
}

/** Remap local control references only when their definition was copied too.
 * @param values - Optional local records.
 * @param ids - Copied layer/property identities.
 * @param properties - Original definitions, required to remap component UUID values without changing UUID-shaped text.
 * @returns Independent local value records.
 */
export function remapDesignComponentPropertyValues(values:readonly CopyOSDesignComponentPropertyValue[]|undefined,
  ids:ReadonlyMap<string,string>,properties:readonly Property[]=[]):CopyOSDesignComponentPropertyValue[]|undefined {
  return values?.map(value=>({ ...value,propertyId:ids.get(value.propertyId) ?? value.propertyId,
    value:properties.some(property=>property.id===value.propertyId && property.type==='instance-swap') && typeof value.value==='string'
      ? ids.get(value.value) ?? value.value : value.value }))
}

/** Prune target paths invalidated by trusted deletion while retaining unattached controls.
 * @param document - Candidate after deleting or moving source layers.
 * @param before - Optional validated previous scene; only its removed definitions may prune value references.
 * @returns Scene retaining valid targets and rejecting newly invalid values at later native validation.
 */
export function pruneDesignComponentProperties(document:CopyOSDesignDocument,before?:CopyOSDesignDocument):CopyOSDesignDocument {
  const nodes=document.nodes.map(owner=>owner.kind==='component' || owner.kind==='component-set'?{ ...owner,componentProperties:owner.componentProperties?.map(property=>({ ...property,
    targets:property.targets.filter(path=>designComponentPropertyTarget(document,owner,path) ||
      (before && !before.nodes.find(node=>node.id===owner.id)?.componentProperties?.find(item=>item.id===property.id)?.targets
        .some(previous=>pathKey(previous)===pathKey(path)))) })) }:owner)
  const removed=new Map<string,Set<string>>()
  const currentNodes=new Map(nodes.map(node=>[node.id,node]))
  for (const owner of (before ?? document).nodes) {
    if (!owner.componentProperties?.length) continue
    const current=new Set(currentNodes.get(owner.id)?.componentProperties?.map(property=>property.id))
    removed.set(owner.id,new Set((owner.componentProperties ?? []).filter(property=>!current.has(property.id)).map(property=>property.id)))
  }
  return { ...document,nodes:nodes.map(node=>node.kind==='instance'?{ ...node,
    componentPropertyValues:node.componentPropertyValues
      ?.filter(value=>![...removed.values()].some(ids=>ids.has(value.propertyId))) }:node) }
}

/** Resolve manual override paths in authored or effective contextual swap space.
 * @param document - Complete component library.
 * @param instance - Stored or transient instance owning the record.
 * @param path - Authored path or an explicit path through a replacement main.
 * @returns Descendant target, or undefined when the path cannot be reached.
 */
export function designComponentOverrideTarget(document:CopyOSDesignDocument,instance:CopyOSDesignNode,path:readonly string[])
  :CopyOSDesignNode|undefined {
  const authored=designInstanceOverrideTarget(document.nodes,instance,path)
  if (authored) return authored
  let owner=instance
  for (const [index,id] of path.entries()) {
    const source=document.nodes.find(node=>node.id===owner.componentId)
    if (!source || owner.kind!=='instance') return
    const nodes=applyDesignComponentInstance(document.nodes,source,owner,document.nodes)
    const target=designInstanceOverrideTarget(nodes,owner,[id])
    if (!target) return
    if (index===path.length-1) return target
    owner=target
  }
}

/** Find replacements safe in every default or selected instance context; preferred values remain hints.
 * @param document - Component library.
 * @param ownerId - Main component defining the control.
 * @param property - Saved property identity, or an unsaved instance-swap draft.
 * @param instanceIds - Selected local instances; omission tests the main default and all inherited contexts.
 * @returns Safe local components, including the current component when valid.
 */
export function designComponentPropertySwapCandidates(document:CopyOSDesignDocument,ownerId:string,
  property:string|Extract<Property,{ type:'instance-swap' }>,instanceIds?:readonly string[]):CopyOSDesignNode[] {
  const owner=typeof property==='string' ? designComponentPropertyOwner(document,property) : document.nodes.find(node=>node.id===ownerId)
  const definition=typeof property==='string' ? owner?.componentProperties?.find(item=>item.id===property) : property
  ownerId=owner?.id ?? ownerId
  if ((owner?.kind!=='component' && owner?.kind!=='component-set') || definition?.type!=='instance-swap') return []
  if (instanceIds?.some(id=>!document.nodes.some(node=>node.id===id && node.kind==='instance' && designComponentPropertyDefinitions(document,node.componentId ?? '').some(value=>value.id===definition.id)))) return []
  return document.nodes.filter((candidate)=>{
    if (candidate.kind!=='component') return false
    const selected=new Set(instanceIds)
    const nodes=document.nodes.map((node)=>{
      if (instanceIds && selected.has(node.id)) return { ...node,componentPropertyValues:[
        ...(node.componentPropertyValues ?? []).filter(value=>value.propertyId!==definition.id),
        { propertyId:definition.id,value:candidate.id }] }
      if (!instanceIds && node.id===ownerId) return { ...node,componentProperties:[
        ...(node.componentProperties ?? []).filter(item=>item.id!==definition.id),{ ...definition,defaultValue:candidate.id }] }
      return node
    })
    try { return designComponentGraphValid(reconcileDesignComponentProperties(document,{ ...document,nodes })) }
    catch (error) { if (!(error instanceof Error)) throw error;return false }
  })
}

/** Read every component reference that must survive a delete transaction, including preferred hints.
 * @param document - Complete scene.
 * @param excludingNodeIds - Nodes being removed together; their own references do not block the deletion.
 * @returns Referenced local main identities, including raw, exposed and contextual replacements.
 */
export function designReferencedComponentIds(document:CopyOSDesignDocument,excludingNodeIds:ReadonlySet<string>=new Set())
  :ReadonlySet<string> {
  const result=new Set<string>()
  for (const node of document.nodes) {
    if (excludingNodeIds.has(node.id)) continue
    if (node.componentId) result.add(node.componentId)
    for (const record of node.instanceOverrides ?? []) if (record.componentId) result.add(record.componentId)
    for (const property of node.componentProperties ?? []) if (property.type==='instance-swap') {
      result.add(property.defaultValue)
      for (const id of property.preferredValues ?? []) result.add(id)
    }
    const definitions=designComponentPropertyDefinitions(document,node.componentId ?? '')
    for (const value of node.componentPropertyValues ?? [])
      if (definitions.some(property=>property.id===value.propertyId && property.type==='instance-swap') && typeof value.value==='string')
        result.add(value.value)
  }
  return result
}

/** Search safe swap choices with a bounded number of complete contextual graph probes.
 * @param document - Validated component library.
 * @param ownerId - Main defining the primary control.
 * @param property - Saved control identity or an unsaved instance-swap draft.
 * @param instanceIds - Local contexts; omission edits the inherited main default.
 * @param options - Cheap name/ancestor query, probe cursor/limit, and simultaneous additional property contexts.
 * @returns Safe choices in this page, rejected probes and unsearched candidate count; nextCursor reaches later choices.
 */
export function designComponentPropertySwapCandidateSummary(document:CopyOSDesignDocument,ownerId:string,
  property:string|Extract<Property,{ type:'instance-swap' }>,instanceIds?:readonly string[],options?:{
    query?:string
    cursor?:number
    limit?:number
    additionalContexts?:readonly {
      ownerId:string
      property:string|Extract<Property,{ type:'instance-swap' }>
      instanceIds?:readonly string[]
    }[]
  }):{ candidates:CopyOSDesignNode[];nextCursor:number|null;unsearched:number;rejected:number } {
  const byId=new Map(document.nodes.map(node=>[node.id,node]))
  const requests=[{ ownerId,property,instanceIds },...options?.additionalContexts ?? []].map((request)=>{
    const owner=typeof request.property==='string' ? designComponentPropertyOwner(document,request.property) : byId.get(request.ownerId)
    const definition=typeof request.property==='string' ? owner?.componentProperties?.find(item=>item.id===request.property) : request.property
    return { ...request,ownerId:owner?.id ?? request.ownerId,owner,definition }
  })
  const primary=requests[0]?.definition
  if (!primary || requests.some(request=>(request.owner?.kind!=='component' && request.owner?.kind!=='component-set') || request.definition?.type!=='instance-swap' ||
    request.instanceIds?.some(id=>byId.get(id)?.kind!=='instance' || !designComponentPropertyDefinitions(document,byId.get(id)?.componentId ?? '').some(value=>value.id===request.definition?.id))))
    return { candidates:[],nextCursor:null,unsearched:0,rejected:0 }
  const preferred=new Set(primary.type==='instance-swap'?primary.preferredValues:[])
  const query=options?.query?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? []
  const choices=document.nodes.filter((node)=>{
    if (node.kind!=='component') return false
    if (!query.length) return true
    const names=[node.name]
    let parent=node.parentId,pageId=node.pageId
    for(let depth=0;parent && depth<64;depth++) {
      const ancestor=byId.get(parent);if (!ancestor) break
      names.push(ancestor.name);pageId ??= ancestor.pageId;parent=ancestor.parentId
    }
    const page=document.pages?.find(item=>item.id===(pageId ?? document.pages?.[0]?.id))
    if (page) names.push(page.name)
    const location=names.reverse().join(' / ').toLocaleLowerCase()
    return query.every(term=>location.includes(term))
  }).sort((a,b)=>Number(preferred.has(b.id))-Number(preferred.has(a.id)) || a.id.localeCompare(b.id))
  const cursor=Math.max(0,Math.min(choices.length,Math.trunc(options?.cursor ?? 0)))
  const limit=Math.max(1,Math.min(100,Math.trunc(options?.limit ?? 20)))
  const page=choices.slice(cursor,cursor+limit),candidates:CopyOSDesignNode[]=[]
  for (const candidate of page) {
    const edited=new Map<string,CopyOSDesignNode>()
    for (const request of requests) {
      const definition=request.definition
      if (!definition || !request.owner) continue
      if (request.instanceIds) for (const id of request.instanceIds) {
        const node=edited.get(id) ?? byId.get(id)
        if (!node) continue
        edited.set(id,{ ...node,componentPropertyValues:[
          ...(node.componentPropertyValues ?? []).filter(value=>value.propertyId!==definition.id),
          { propertyId:definition.id,value:candidate.id }] })
      }
      else {
        const node=edited.get(request.ownerId) ?? request.owner
        edited.set(node.id,{ ...node,componentProperties:[
          ...(node.componentProperties ?? []).filter(item=>item.id!==definition.id),
          { ...definition,defaultValue:candidate.id } as Property] })
      }
    }
    try {
      const next=reconcileDesignComponentProperties(document,{ ...document,nodes:document.nodes.map(node=>edited.get(node.id) ?? node) })
      if (designComponentGraphValid(next)) candidates.push(candidate)
    } catch (error) { if (!(error instanceof Error)) throw error }
  }
  const end=cursor+page.length,unsearched=choices.length-end
  return { candidates,nextCursor:unsearched?end:null,unsearched,rejected:page.length-candidates.length }
}

/** Map a stable authored control path through current contextual replacement mains.
 * @param document - Complete library.
 * @param instance - Root instance carrying default/local/manual replacements.
 * @param path - Stable authored control target path.
 * @returns Effective path, or undefined when unique name/hierarchy matching cannot preserve the target.
 */
export function designComponentPropertyContextPath(document:CopyOSDesignDocument,instance:CopyOSDesignNode,path:readonly string[])
  :string[]|undefined {
  let owner=instance,remaining=[...path]
  const result:string[]=[]
  for(let depth=0;remaining.length && depth<64;depth++) {
    const source=document.nodes.find(node=>node.id===owner.componentId)
    if (!source || owner.kind!=='instance') return
    const nodes=applyDesignComponentInstance(document.nodes,source,owner,document.nodes)
    const target=designInstanceOverrideTarget(nodes,owner,[remaining[0] ?? ''])
    if (!target) return
    result.push(target.id)
    remaining=remaining.slice(1)
    if (!remaining.length) return result
    if (target.kind!=='instance' || !target.componentId) return
    const raw=document.nodes.find(node=>node.id===target.id)
    const from=designInstanceOverrideTarget(document.nodes,target,remaining) ? target.componentId : raw?.componentId
    if (!from) return
    const mapped=remapDesignSwapOverrides(document,from,target.componentId,[{ path:remaining,visible:true }])[0]
    if (!mapped) return
    remaining=mapped.path;owner=target
  }
}
