import { materializeDesignComponentDepartures } from './design-component-property-definitions.ts'
/** Concrete variant tables retain ordinary component identities and preservation-aware instance links. */
import { createDesignNode,resolveDesignNodes,duplicateDesignNode,designDescendants } from './design-model.ts'
import { reconcileDesignVariants } from './design-variant-names.ts'
import { swapDesignInstances } from './design-instance-swap.ts'
import { designVariantIssues } from './design-variant-validation.ts'
import { designComponentPropertyIssues } from './design-component-property-validation.ts'
import { designComponentGraphIssues } from './design-component-graph.ts'
import type { CopyOSDesignDocument,CopyOSDesignNode,CopyOSDesignVariantAxis,CopyOSDesignVariantValue } from './types.ts'

function checked(input:CopyOSDesignDocument,canonicalSets:readonly string[]=[]):CopyOSDesignDocument {
  const document=canonicalSets.length?reconcileDesignVariants(input,input,canonicalSets.map(id=>({ id,componentSet:true }))):input
  if (document.nodes.length>25000) throw new Error('Design exceeds 25000 authored layers')
  if (document.nodes.some(node=>node.width>100000 || node.height>100000 || node.width<1 || node.height<1))
    throw new Error('Variant bounds require dimensions from 1 to 100000')
  const issue=designVariantIssues(document)[0] ?? designComponentPropertyIssues(document)[0] ?? designComponentGraphIssues(document)[0]
  if (issue) throw new Error(issue)
  return document
}
function setNode(document:CopyOSDesignDocument,id:string):CopyOSDesignNode {
  const node=document.nodes.find(item=>item.id===id)
  if (node?.kind!=='component-set' || !node.componentSet) throw new Error('Select a component set')
  return node
}
function unique(base:string,values:readonly string[]):string {
  const root=base.trim() || 'Variant'
  let value=root.slice(0,120),index=2
  while(values.includes(value)) {const suffix=' '+String(index++);value=root.slice(0,120-suffix.length)+suffix}
  return value
}
function tuple(axes:readonly CopyOSDesignVariantAxis[],values:readonly CopyOSDesignVariantValue[]):string {
  const byId=new Map(values.map(item=>[item.axisId,item.value]))
  return JSON.stringify(axes.map(axis=>byId.get(axis.id)))
}
function expandedBounds(document:CopyOSDesignDocument,setId:string):CopyOSDesignDocument {
  const computed=resolveDesignNodes(document),set=computed.find(node=>node.id===setId)
  if (!set) return document
  const children=computed.filter(node=>node.parentId===setId)
  const width=Math.max(set.width,...children.map(node=>node.x+node.width))
  const height=Math.max(set.height,...children.map(node=>node.y+node.height))
  return { ...document,nodes:document.nodes.map(node=>node.id===setId?{ ...node,width,height }:node) }
}

/** Find the spatial default variant; ties use stored layer order, without a separate default flag.
 * @param document - Validated local component library.
 * @param setId - Component-set identity.
 * @param computed - Optional shared resolved nodes for batched inspection.
 * @returns Topmost then leftmost concrete member in current layout, or undefined for a missing/empty set.
 */
export function designComponentSetDefault(document:CopyOSDesignDocument,setId:string,computed?:readonly CopyOSDesignNode[])
  :CopyOSDesignNode|undefined {
  if (document.nodes.find(node=>node.id===setId)?.kind!=='component-set') return
  const nodes=computed ?? resolveDesignNodes(document)
  const first=nodes.filter(node=>node.parentId===setId && node.kind==='component').sort((a,b)=>a.y-b.y || a.x-b.x)[0]
  return document.nodes.find(node=>node.id===first?.id)
}

/** Group sibling main components as variants without changing their identities or instance links.
 * @param document - Validated scene.
 * @param componentIds - At least two editable sibling components outside an existing set.
 * @param newId - Fresh identity allocator for the set and initial axis.
 * @param options - Optional stable IDs and user-facing set/axis names.
 * @returns New scene and set selection; flow parents reflow naturally, free-layout component geometry is preserved.
 */
export function combineDesignComponentsAsVariants(document:CopyOSDesignDocument,componentIds:readonly string[],newId:()=>string,
  options?:{ setId?:string;axisId?:string;name?:string;axisName?:string }):{ document:CopyOSDesignDocument;selection:string } {
  const selected=new Set(componentIds),components=document.nodes.filter(node=>selected.has(node.id))
  const first=components[0]
  if (selected.size<2 || components.length!==selected.size || !first || components.some(node=>node.kind!=='component' || node.locked))
    throw new Error('Select at least two editable main components')
  const parent=document.nodes.find(node=>node.id===first.parentId)
  if (parent?.locked || parent?.kind==='component-set' || components.some(node=>node.parentId!==first.parentId || node.pageId!==first.pageId))
    throw new Error('Variants require sibling components on the same page outside an existing set')
  const setId=options?.setId ?? newId(),axisId=options?.axisId ?? newId()
  if (document.nodes.some(node=>node.id===setId)) throw new Error('Component set identity already exists')
  const graphIssue=designComponentGraphIssues(document)[0]
  if (graphIssue) throw new Error(graphIssue)
  const computed=resolveDesignNodes(document),rendered=components.map(node=>computed.find(item=>item.id===node.id) ?? node)
  const x=Math.min(...rendered.map(node=>node.x)),y=Math.min(...rendered.map(node=>node.y))
  const width=Math.max(...rendered.map(node=>node.x+node.width))-x,height=Math.max(...rendered.map(node=>node.y+node.height))-y
  const segments=components.map(node=>node.name.split('/').map(value=>value.trim()))
  const common=segments[0] ?? []
  const infer=common.length>=2 && segments.every(parts=>parts.length===common.length &&
    parts[0]===common[0] && parts.every(Boolean))
  const axes:CopyOSDesignVariantAxis[]=[],values=new Map<string,CopyOSDesignVariantValue[]>()
  if (infer) {
    const combinations=new Set<string>()
    for (const parts of segments) {
      const key=JSON.stringify(parts.slice(1))
      if (combinations.has(key)) throw new Error('Component names infer duplicate variant combinations')
      combinations.add(key)
    }
    for(let index=1;index<common.length;index++) axes.push({ id:index===1?axisId:newId(),
      name:index===1?options?.axisName?.trim() || 'Variant':'Property '+String(index),
      values:[...new Set(segments.map(parts=>parts[index] ?? ''))] })
    components.forEach((node,index)=>values.set(node.id,axes.map((axis,column)=>({ axisId:axis.id,value:segments[index]?.[column+1] ?? '' }))))
  } else {
    const choices:string[]=[]
    for (const node of components) {const value=unique(node.name,choices);choices.push(value);values.set(node.id,[{ axisId,value }])}
    axes.push({ id:axisId,name:options?.axisName?.trim() || 'Variant',values:choices })
  }
  const set:CopyOSDesignNode={ ...createDesignNode('component-set',setId,options?.name?.trim() || (infer?common[0]:'Component set') || 'Component set'),
    parentId:first.parentId,pageId:first.pageId,x,y,width,height,layout:'none',padding:0,gap:0,clip:false,fillOpacity:0,
    absolutePosition:components.every(node=>node.absolutePosition),componentSet:{ axes } }
  const renderedById=new Map(rendered.map(node=>[node.id,node])),nodes:CopyOSDesignNode[]=[]
  let inserted=false
  for (const node of document.nodes) {
    if (selected.has(node.id)) {
      if (!inserted) {nodes.push(set);inserted=true}
      const visible=renderedById.get(node.id) ?? node
      nodes.push({ ...node,parentId:setId,x:visible.x-x,y:visible.y-y,width:visible.width,height:visible.height,
        constraints:node.constraints?{ ...node.constraints,referenceWidth:width,referenceHeight:height }:undefined,
        variantValues:values.get(node.id) })
    } else nodes.push(node)
  }
  return { document:checked({ ...document,nodes },[setId]),selection:setId }
}

/** Replace the complete sparse variant table atomically, including axis renames and removed values.
 * @param document - Current scene.
 * @param setId - Editable component set.
 * @param configuration - Complete axes and exactly one tuple for every current direct member.
 * @returns Validated scene, without changing concrete component identities or existing instance selections.
 */
export function configureDesignComponentSet(document:CopyOSDesignDocument,setId:string,configuration:{
  axes:CopyOSDesignVariantAxis[]
  variants:{ componentId:string;values:CopyOSDesignVariantValue[] }[]
}):CopyOSDesignDocument {
  const set=setNode(document,setId),members=document.nodes.filter(node=>node.parentId===setId)
  if (set.locked || members.some(node=>node.locked)) throw new Error('Component set is locked')
  const values=new Map(configuration.variants.map(item=>[item.componentId,item.values]))
  if (values.size!==configuration.variants.length || values.size!==members.length || members.some(node=>!values.has(node.id)))
    throw new Error('Configure exactly one tuple for every component-set member')
  return checked({ ...document,nodes:document.nodes.map(node=>node.id===setId?{ ...node,
    componentSet:{ axes:configuration.axes.map(axis=>({ ...axis,
      values:[...axis.values] })) } }:values.has(node.id)?{ ...node,variantValues:values.get(node.id)?.map(value=>({ ...value })) }:node) },
  [setId])
}

/** Inspect an instance's current sparse-table choices and exact existing one-axis combinations.
 * @param document - Validated scene.
 * @param instanceId - Instance linked to a concrete component-set member.
 * @returns Set/current component and axes with missing combinations marked unavailable; final graph safety is checked when selecting.
 */
export function designInstanceVariants(document:CopyOSDesignDocument,instanceId:string):{
  set:CopyOSDesignNode
  component:CopyOSDesignNode
  axes:{
    id:string
    name:string
    values:string[]
    value:string
    options:{ value:string;componentId:string|null;available:boolean }[] }[]
}|undefined {
  const instance=document.nodes.find(node=>node.id===instanceId)
  if (instance?.kind!=='instance') return
  const component=document.nodes.find(node=>node.id===instance.componentId)
  const set=document.nodes.find(node=>node.id===component?.parentId)
  if (!component || set?.kind!=='component-set' || !set.componentSet) return
  const axes=set.componentSet.axes,members=document.nodes.filter(node=>node.parentId===set.id && node.kind==='component')
  const current=new Map(component.variantValues?.map(value=>[value.axisId,value.value]))
  const combinations=new Map<string,CopyOSDesignNode|null>()
  for (const member of members) {
    const key=tuple(axes,member.variantValues ?? [])
    combinations.set(key,combinations.has(key)?null:member)
  }
  return { set,component,axes:axes.map(axis=>({ ...axis,values:[...axis.values],value:current.get(axis.id) ?? '',
    options:axis.values.map((value)=>{
      const values=axes.map(item=>({ axisId:item.id,value:item.id===axis.id?value:current.get(item.id) ?? '' }))
      const target=combinations.get(tuple(axes,values))
      return { value,componentId:target?.id ?? null,available:!!target }
    }) })) }
}

/** Select exact sparse-table combinations through one preservation-aware atomic swap batch.
 * @param document - Validated scene.
 * @param selections - Instance identities and partial axis choices, merged with their current complete tuple.
 * @returns Updated scene; missing/ambiguous tuples and unsafe final graphs reject the entire batch.
 */
export function selectDesignVariants(document:CopyOSDesignDocument,selections:readonly {
  nodeId:string
  values:readonly CopyOSDesignVariantValue[]
}[]):CopyOSDesignDocument {
  const swaps=selections.map((selection)=>{
    const instance=document.nodes.find(node=>node.id===selection.nodeId)
    const component=document.nodes.find(node=>node.id===instance?.componentId)
    const set=document.nodes.find(node=>node.id===component?.parentId)
    if (instance?.kind!=='instance' || instance.locked || !component || set?.kind!=='component-set' || !set.componentSet)
      throw new Error('Select an editable variant instance')
    const axes=set.componentSet.axes,values=new Map(component.variantValues?.map(value=>[value.axisId,value.value]))
    if (new Set(selection.values.map(value=>value.axisId)).size!==selection.values.length) throw new Error('Duplicate variant axis edit')
    for (const value of selection.values) {
      if (!axes.some(axis=>axis.id===value.axisId && axis.values.includes(value.value))) throw new Error('Unknown variant axis or value')
      values.set(value.axisId,value.value)
    }
    const expected=tuple(axes,[...values].map(([axisId,value])=>({ axisId,value })))
    const targets=document.nodes.filter(node=>node.parentId===set.id && node.kind==='component' && tuple(axes,node.variantValues ?? [])===expected)
    if (targets.length!==1 || !targets[0]) throw new Error('Variant combination unavailable')
    return { nodeId:selection.nodeId,componentId:targets[0].id }
  })
  return swapDesignInstances(document,swaps)
}

/** Finish ordinary duplication of a variant with a unique last-axis value and expanded set bounds.
 * @param document - Scene before duplication.
 * @param sourceId - Original concrete variant.
 * @param nodes - Scene containing its fresh subtree copies.
 * @param copyId - Copied concrete root.
 * @returns Scene nodes with a valid new tuple and last-axis choice, without altering other variants.
 */
export function completeDesignVariantDuplicate(document:CopyOSDesignDocument,sourceId:string,nodes:CopyOSDesignNode[],copyId:string)
  :CopyOSDesignNode[] {
  const source=document.nodes.find(node=>node.id===sourceId),set=document.nodes.find(node=>node.id===source?.parentId)
  if (!source || set?.kind!=='component-set' || !set.componentSet) return nodes
  const last=set.componentSet.axes.at(-1)
  if (source.locked || set.locked) throw new Error('Component set is locked')
  if (!last || last.values.length>=100) throw new Error('Variant axis supports at most 100 values')
  const current=source.variantValues?.find(value=>value.axisId===last.id)?.value ?? 'Variant'
  const value=unique(current,last.values)
  const definitions=set.componentSet.axes
  const next={ ...document,nodes:nodes.map(node=>node.id===set.id?{ ...node,componentSet:{ axes:definitions.map(axis=>axis.id===last.id?
    { ...axis,values:[...axis.values,value] }:axis) } }:node.id===copyId?{ ...node,variantValues:(source.variantValues ?? [])
    .map(item=>item.axisId===last.id?{ ...item,value }:{ ...item }) }:node) }
  return expandedBounds(checked(next,[set.id]),set.id).nodes
}

/** Duplicate a variant with fresh internal identities and a new last-axis value, positioned to the right of its set.
 * @param document - Validated scene.
 * @param sourceId - Editable variant, set (using its spatial default), or standalone main component.
 * @param newId - Fresh descendant/property identity allocator.
 * @param options - Optional stable root/set/axis identities and new-set names for standalone mains.
 * @returns New scene and component selection; existing instances keep their source links.
 */
export function addDesignVariant(document:CopyOSDesignDocument,sourceId:string,newId:()=>string,
  options?:{ componentId?:string;setId?:string;axisId?:string;name?:string;axisName?:string })
  :{ document:CopyOSDesignDocument;selection:string } {
  const graphIssue=designComponentGraphIssues(document)[0]
  if (graphIssue) throw new Error(graphIssue)
  const requested=document.nodes.find(node=>node.id===sourceId)
  const source=requested?.kind==='component-set'?designComponentSetDefault(document,sourceId):requested
  const set=document.nodes.find(node=>node.id===source?.parentId)
  if (source?.kind!=='component' || source.locked || set?.locked || requested?.locked) throw new Error('Select an editable variant or component')
  const rootAllocation=designDescendants(document.nodes,source.id).size
  let index=0
  const allocated=()=>index++===rootAllocation && options?.componentId ? options.componentId:newId()
  const nodes=duplicateDesignNode(document,source.id,allocated),old=new Set(document.nodes.map(node=>node.id))
  const copy=nodes.find(node=>node.parentId===source.parentId && node.kind==='component' && !old.has(node.id))
  if (!copy) throw new Error('Variant copy was not created')
  const computed=resolveDesignNodes(document),visible=computed.find(node=>node.id===source.id) ?? source
  const right=set?.kind==='component-set'?Math.max(...computed.filter(node=>node.parentId===set.id).map(node=>node.x+node.width)):
    visible.x+visible.width
  const next={ ...document,nodes:nodes.map(node=>node.id===copy.id?{ ...node,x:right+32,y:visible.y }:node) }
  if (set?.kind!=='component-set') {
    const combined=combineDesignComponentsAsVariants(next,[source.id,copy.id],newId,options)
    return { document:combined.document,selection:copy.id }
  }
  return { document:checked(expandedBounds(next,set.id),[set.id]),selection:copy.id }
}

/** Remove a set container while retaining concrete components and all existing instance links.
 * @param document - Validated scene.
 * @param setId - Editable set to dissolve.
 * @returns Independent main components; transforms are composed in free layout and flow parents reflow naturally.
 */
export function dissolveDesignComponentSet(document:CopyOSDesignDocument,setId:string):CopyOSDesignDocument {
  const set=setNode(document,setId)
  if (set.locked) throw new Error('Component set is locked')
  const graphIssue=designComponentGraphIssues(document)[0]
  if (graphIssue) throw new Error(graphIssue)
  const computed=resolveDesignNodes(document),visible=computed.find(node=>node.id===setId) ?? set
  const children=new Map(computed.filter(node=>node.parentId===setId).map(node=>[node.id,node]))
  const parent=computed.find(node=>node.id===set.parentId),angle=visible.rotation*Math.PI/180
  const signX=visible.flipX?-1:1,signY=visible.flipY?-1:1
  return checked(materializeDesignComponentDepartures(document, { ...document
    ,nodes:document.nodes.filter(node=>node.id!==setId).map((node)=>{
      const child=children.get(node.id);if (!child) return node
      const x=(child.x+child.width/2-visible.width/2)*signX,y=(child.y+child.height/2-visible.height/2)*signY
      return { ...node,parentId:set.parentId,variantValues:undefined,width:child.width,height:child.height,
        x:visible.x+visible.width/2+x*Math.cos(angle)-y*Math.sin(angle)-child.width/2,
        y:visible.y+visible.height/2+x*Math.sin(angle)+y*Math.cos(angle)-child.height/2,
        rotation:visible.rotation+signX*signY*child.rotation,flipX:!!visible.flipX!==!!child.flipX,flipY:!!visible.flipY!==!!child.flipY,
        opacity:visible.opacity*child.opacity,visible:visible.visible && child.visible,
        constraints:node.constraints && parent?{ ...node.constraints,referenceWidth:parent.width,referenceHeight:parent.height }:undefined }
    }) }))
}

/** Remap component-set axes and child membership when copying a complete set subtree.
 * @param node - Original set or concrete variant.
 * @param ids - Copied layer/property/axis identities.
 * @param includeMembership - Whether the copied variant remains inside its copied parent set.
 * @returns Independent variant metadata; standalone copies clear parent-set membership.
 */
export function remapDesignVariantMetadata(node:CopyOSDesignNode,ids:ReadonlyMap<string,string>,includeMembership=true)
  :Pick<CopyOSDesignNode,'componentSet'|'variantValues'> {
  return { componentSet:node.componentSet?{ axes:node.componentSet.axes.map(axis=>({ ...axis,
    id:ids.get(axis.id) ?? axis.id,values:[...axis.values] })) }:undefined,
  variantValues:includeMembership?node.variantValues?.map(value=>({ ...value,axisId:ids.get(value.axisId) ?? value.axisId })):undefined }
}
