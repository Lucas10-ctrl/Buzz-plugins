/** Native non-destructive constructive geometry and rigid operand transforms. */
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignBooleanOperation } from './types.ts'
import { createDesignNode, resolveDesignNodes, snapshotDesignGeometry, designDescendants } from './design-model.ts'
import { designBooleanNodeEligibility, designBooleanNodePath, evaluateDesignBooleanGeometry } from './design-boolean-geometry.ts'
type Matrix = readonly [number, number, number, number, number, number]
function matrix(n: CopyOSDesignNode): Matrix {
  const angle=n.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),fx=n.flipX?-1:1,fy=n.flipY?-1:1
  const a=c*fx,b=s*fx,cc=-s*fy,d=c*fy
  return [a,b,cc,d,n.x+n.width/2-a*n.width/2-cc*n.height/2,n.y+n.height/2-b*n.width/2-d*n.height/2]
}
function placed(n:CopyOSDesignNode,m:Matrix):CopyOSDesignNode {
  const [a,b,c,d,e,f]=m,flipX=a*d-b*c<0,sign=flipX?-1:1
  return { ...n,x:e-n.width/2+a*n.width/2+c*n.height/2,y:f-n.height/2+b*n.width/2+d*n.height/2,
    rotation:Math.atan2(b/sign,a/sign)*180/Math.PI,flipX,flipY:false }
}
function multiply(a:Matrix,b:Matrix):Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
}
/** Creation eligibility failures, shared by native and interactive commands. */
export type DesignBooleanSelectionReason = 'select-two'|'missing-node'|'same-parent'|'locked'|'component'|'unsupported-operand'
/** Inspect operands without changing the document.
 * @param document - Native scene.
 * @param ids - Stored operand identities.
 * @returns Eligibility and the first actionable failure code.
 */
export function designBooleanSelection(document:CopyOSDesignDocument,ids:readonly string[]):
{ eligible:boolean;reason?:DesignBooleanSelectionReason } {
  const fail=(reason:DesignBooleanSelectionReason)=>({ eligible:false,reason })
  if (new Set(ids).size<2) return fail('select-two')
  const byId=new Map(resolveDesignNodes(document).map(n=>[n.id,n])),items=ids.map(id=>byId.get(id))
  if (items.some(n=>!n)) return fail('missing-node')
  const first=items[0]
  if(!first) return fail('missing-node')
  for(const item of items) {
    if(!item) continue
    if(item.parentId!==first.parentId || item.pageId!==first.pageId) return fail('same-parent')
    let ancestor:CopyOSDesignNode|undefined=item
    while(ancestor) {
      if(ancestor.locked) return fail('locked')
      if(ancestor.kind==='instance') return fail('component')
      ancestor=byId.get(ancestor.parentId??'')
    }
    const descendants=designDescendants(document.nodes,item.id)
    const operands=[item,...document.nodes.filter(n=>descendants.has(n.id)).map(n=>byId.get(n.id)??n)]
    if(operands.some(n=>!designBooleanNodeEligibility(n))) return fail('unsupported-operand')
  }
  return { eligible:true }
}
/** Derive every Boolean path once from current resolved operands; authored nodes remain untouched.
 * @param nodes - Resolved scene geometry.
 * @returns Scene projection retaining editable operands and container identities.
 */
export function projectDesignBooleanGeometry(nodes:readonly CopyOSDesignNode[]):CopyOSDesignNode[] {
  const done=new Map<string,CopyOSDesignNode>(),active=new Set<string>()
  const visit=(node:CopyOSDesignNode):CopyOSDesignNode=>{
    const cached=done.get(node.id);if(cached) return cached
    if(node.kind!=='boolean') return node
    if(active.has(node.id)) throw new Error('Cyclic Boolean operands')
    active.add(node.id)
    const operands=nodes.filter(n=>n.parentId===node.id&&n.visible).map(visit).map((n)=>{
      const pathData=designBooleanNodePath(n)
      if(!pathData) throw new Error('Unsupported Boolean operand')
      return { pathData,matrix:matrix(n) }
    })
    if(!node.booleanOperation) throw new Error('Boolean operation is missing')
    const result={ ...node,pathData:evaluateDesignBooleanGeometry(node.booleanOperation,operands,node.width,node.height) }
    done.set(node.id,result);active.delete(node.id);return result
  }
  return nodes.map(visit)
}
/** Refit Boolean containers around operand envelopes while retaining every operand's parent-space transform.
 * @param document - Current native scene.
 * @returns Fitted native document without a persisted result cache.
 */
export function fitDesignBooleans(document:CopyOSDesignDocument):CopyOSDesignDocument {
  const booleanIds=new Set(document.nodes.filter(node=>node.kind==='boolean').map(node=>node.id))
  if(!booleanIds.size) return document
  const fittedIds=document.nodes.filter(node=>booleanIds.has(node.id)||booleanIds.has(node.parentId??'')).map(node=>node.id)
  let nodes=snapshotDesignGeometry(document,fittedIds).nodes.map(n=>({ ...n }))
  const fit=(id:string,active=new Set<string>())=>{
    if(active.has(id)) throw new Error('Cyclic Boolean operands');active.add(id)
    for(const child of nodes.filter(n=>n.parentId===id&&n.kind==='boolean')) fit(child.id,active)
    const node=nodes.find(n=>n.id===id),children=nodes.filter(n=>n.parentId===id)
    if(!node) throw new Error('Boolean container not found')
    if(!children.length) {active.delete(id);return}
    const points=children.flatMap((n)=>{
      const m=matrix(n),corners:readonly (readonly [number,number])[]=[[0,0],[n.width,0],[n.width,n.height],[0,n.height]]
      return corners.map(([x,y]):readonly [number,number]=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]])
    })
    const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]))
    const width=Math.max(1,Math.max(...points.map(p=>p[0]))-x),height=Math.max(1,Math.max(...points.map(p=>p[1]))-y)
    const m=matrix(node),next=placed({ ...node,width,height },[m[0],m[1],m[2],m[3],m[4]+m[0]*x+m[2]*y,m[5]+m[1]*x+m[3]*y])
    nodes=nodes.map(n=>n.id===id?next:n.parentId===id?{ ...n,x:n.x-x,y:n.y-y }:n);active.delete(id)
  }
  for(const n of nodes) if(n.kind==='boolean'&&!nodes.some(p=>p.id===n.parentId&&p.kind==='boolean')) fit(n.id)
  return { ...document,nodes }
}
/** Create one Boolean from eligible siblings in authored back-to-front order, inheriting the first operand's paint.
 * @param document - Native scene.
 * @param ids - At least two eligible siblings.
 * @param operation - Constructive operation.
 * @param id - Fresh container identity.
 * @returns Native scene retaining all operand identities.
 */
export function createDesignBoolean(
  document:CopyOSDesignDocument,ids:readonly string[],operation:CopyOSDesignBooleanOperation,id:string,
):CopyOSDesignDocument {
  const eligibility=designBooleanSelection(document,ids)
  if(!eligibility.eligible) throw new Error(`Boolean selection: ${eligibility.reason}`)
  if(document.nodes.some(n=>n.id===id)) throw new Error('Boolean identity already exists')
  const selected=new Set(ids),snapshot=snapshotDesignGeometry(document,ids)
  const items=snapshot.nodes.filter(n=>selected.has(n.id)),first=items[0]
  if(!first) throw new Error('Boolean operands not found')
  const container:CopyOSDesignNode={ ...createDesignNode('boolean',id,'Boolean'),parentId:first.parentId,pageId:first.pageId,
    x:0,y:0,width:1,height:1,radius:0,fill:first.fill,fills:first.fills,gradient:first.gradient,fillOpacity:first.fillOpacity,
    fillVariableId:first.fillVariableId,opacity:first.opacity,effects:first.effects,effectStyleId:first.effectStyleId,
    shadow:first.shadow,blendMode:first.blendMode,tokenModeId:first.tokenModeId,booleanOperation:operation,clip:false,layout:'none' }
  const nodes=snapshot.nodes.flatMap(n=>n.id===first.id?[container,{ ...n,parentId:id,constraints:undefined }]:
    selected.has(n.id)?[{ ...n,parentId:id,constraints:undefined }]:[n])
  return fitDesignBooleans({ ...document,nodes })
}
function editableBoolean(document:CopyOSDesignDocument,id:string):CopyOSDesignNode {
  const node=document.nodes.find(n=>n.id===id)
  if(node?.kind!=='boolean') throw new Error('Boolean container not found')
  let current:CopyOSDesignNode|undefined=node
  while(current) {
    if(current.locked) throw new Error('Boolean container is locked')
    if(current.kind==='instance') throw new Error('Edit an explicit main component target')
    const parentId:string|null=current.parentId
    current=document.nodes.find(n=>n.id===parentId)
  }
  return node
}
/** Switch live constructive operations.
 * @param document - Native scene.
 * @param ids - Boolean identities.
 * @param operation - New operation.
 * @returns Updated scene with unchanged operands.
 */
export function setDesignBooleanOperation(
  document:CopyOSDesignDocument,ids:readonly string[],operation:CopyOSDesignBooleanOperation,
):CopyOSDesignDocument {
  ids.forEach(id=>editableBoolean(document,id))
  return { ...document,nodes:document.nodes.map(n=>ids.includes(n.id)?{ ...n,booleanOperation:operation }:n) }
}
/** Dissolve one Boolean while preserving immediate operands and their transforms.
 * @param document - Native scene.
 * @param id - Boolean identity.
 * @returns Scene with operands replacing the container in their existing order.
 */
export function ungroupDesignBoolean(document:CopyOSDesignDocument,id:string):CopyOSDesignDocument {
  const node=editableBoolean(document,id),resolved=new Map(resolveDesignNodes(document).map(n=>[n.id,n])),parent=resolved.get(id)??node
  if(document.nodes.some(n=>n.parentId===id&&n.locked)) throw new Error('Boolean operand is locked')
  const children=document.nodes.filter(n=>n.parentId===id).map(n=>({
    ...placed(resolved.get(n.id)??n,multiply(matrix(parent),matrix(resolved.get(n.id)??n))),parentId:node.parentId }))
  return fitDesignBooleans({ ...document,nodes:document.nodes.flatMap(n=>n.id===id?children:n.parentId===id?[]:[n]) })
}
/** Explicitly replace a Boolean and its operands with the current editable vector result.
 * @param document - Native scene.
 * @param id - Boolean identity retained by the vector.
 * @returns Scene containing an independent path, including empty results.
 */
export function flattenDesignBoolean(document:CopyOSDesignDocument,id:string):CopyOSDesignDocument {
  editableBoolean(document,id)
  const resolved=projectDesignBooleanGeometry(resolveDesignNodes(document)).find(n=>n.id===id),removed=designDescendants(document.nodes,id)
  if(!resolved) throw new Error('Boolean result not found')
  if(document.nodes.some(n=>removed.has(n.id)&&n.locked)) throw new Error('Boolean operand is locked')
  return { ...document,nodes:document.nodes.filter(n=>!removed.has(n.id))
    .map(n=>n.id===id?{ ...resolved,kind:'path' as const,booleanOperation:undefined }:n) }
}
/** Scale live operands uniformly when a Boolean is resized; independent axis scaling requires flattening.
 * @param before - Authored scene before the edit.
 * @param after - Candidate geometry edits.
 * @param ids - Explicitly resized container identities.
 * @returns Candidate with proportionally scaled source geometry and detached geometric size bindings.
 */
export function resizeDesignBooleanOperands(
  before:CopyOSDesignDocument,after:CopyOSDesignDocument,ids:readonly string[],
):CopyOSDesignDocument {
  let result=after
  for(const id of ids) {
    const source=before.nodes.find(node=>node.id===id),target=result.nodes.find(node=>node.id===id)
    if(source?.kind!=='boolean'||!target) continue
    const widthChanged=source.width!==target.width,heightChanged=source.height!==target.height
    if(!widthChanged&&!heightChanged) continue
    const sx=target.width/source.width,sy=target.height/source.height
    if(widthChanged&&heightChanged&&Math.abs(sx-sy)>1e-8)
      throw new Error('Boolean operands support proportional resizing; flatten for independent width and height')
    const scale=widthChanged?sx:sy,descendants=designDescendants(before.nodes,id)
    const computed=new Map(resolveDesignNodes(result).map(node=>[node.id,node]))
    result={ ...result,nodes:result.nodes.map((node)=>{
      if(node.id===id) return { ...node,width:source.width*scale,height:source.height*scale,
        numericBindings:Object.fromEntries(Object.entries(node.numericBindings??{}).filter(([key])=>key!=='width'&&key!=='height')) }
      if(!descendants.has(node.id)) return node
      node=computed.get(node.id)??node
      const numericBindings={ ...node.numericBindings }
      for(const key of ['width','height','radius','radiusTopLeft','radiusTopRight','radiusBottomLeft','radiusBottomRight'] as const)
        Reflect.deleteProperty(numericBindings,key)
      return { ...node,x:node.x*scale,y:node.y*scale,width:node.width*scale,height:node.height*scale,
        radius:node.radius*scale,radiusTopLeft:node.radiusTopLeft===undefined?undefined:node.radiusTopLeft*scale,
        radiusTopRight:node.radiusTopRight===undefined?undefined:node.radiusTopRight*scale,
        radiusBottomLeft:node.radiusBottomLeft===undefined?undefined:node.radiusBottomLeft*scale,
        radiusBottomRight:node.radiusBottomRight===undefined?undefined:node.radiusBottomRight*scale,
        constraints:undefined,widthSizing:'fixed' as const,heightSizing:'fixed' as const,numericBindings }
    }) }
  }
  return result
}
