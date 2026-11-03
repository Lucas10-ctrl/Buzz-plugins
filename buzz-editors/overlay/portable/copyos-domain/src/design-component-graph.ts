import { designTextBoundary } from './design-text-runs.ts'
import { applyDesignInstanceGrid } from './design-instance-grid.ts'
import { designGridBudgetIssue } from './design-grid.ts'
/** Bound the actual contextual component graph, including exposed and manual nested swaps. */
import { applyDesignComponentDefaults, applyDesignComponentInstance } from './design-component-properties.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

/** A bounded contextual graph failure retains its owning validation domain. */
export interface DesignComponentGraphDiagnostic { kind:'grid'|'component';message:string }
class GridGraphError extends Error {}

/** Validate effective expansion rather than a union of mutually exclusive swap alternatives.
 * @param document - Candidate with syntactically valid component/property references.
 * @returns Typed grid-budget or component cycle/depth/expansion failures, including defaults and every stored local context.
 */
export function designComponentGraphDiagnostics(document:CopyOSDesignDocument):DesignComponentGraphDiagnostic[] {
  try {
    const library=document.nodes,byId=new Map(library.map(node=>[node.id,node]))
    const children=new Map<string,CopyOSDesignNode[]>()
    for (const node of library) if (node.parentId) {
      const list=children.get(node.parentId) ?? [];list.push(node);children.set(node.parentId,list)
    }
    const templates=new Map<string,CopyOSDesignNode[]>()
    const template=(id:string):CopyOSDesignNode[]=>{
      const known=templates.get(id);if (known) return known
      const root=byId.get(id);if (!root) throw new Error('Component source not found')
      const result=[root],pending=[root],seen=new Set<string>()
      for (let node=pending.pop();node;node=pending.pop()) {
        if (seen.has(node.id)) throw new Error('Cyclic layer or component hierarchy')
        seen.add(node.id)
        for (const child of children.get(node.id) ?? []) {result.push(child);pending.push(child)}
      }
      templates.set(id,result);return result
    }
    type Context={ identity:number;nodes:CopyOSDesignNode[];children:Map<string,CopyOSDesignNode[]> }
    let nextContextIdentity=0
    const context=(nodes:CopyOSDesignNode[]):Context=>{
      const children=new Map<string,CopyOSDesignNode[]>()
      for (const node of nodes) if (node.parentId) {
        const list=children.get(node.parentId) ?? [];list.push(node);children.set(node.parentId,list)
      }
      return { identity:nextContextIdentity++,nodes,children }
    }
    const contexts=new Map<string,Context>()
    const initial=context(applyDesignComponentDefaults(library))
    let total=0,rootCount=0
    const visit=(node:CopyOSDesignNode,current:Context,depth:number,active:ReadonlySet<string>):void=>{
      if (depth>=64) throw new Error('Design nesting exceeds 64 layers')
      if (++rootCount>50000) throw new Error('Expanded component scene exceeds 50000 layers')
      if (++total>100000) throw new Error('Expanded scene exceeds 100000 layers')
      if (node.textRuns?.some(run => !designTextBoundary(node.text, run.start) || !designTextBoundary(node.text, run.end)))
        throw new Error('Contextual text runs exceed text or split a UTF-16 character')
      if (node.layout==='grid') {
        if (node.grid && (!node.grid.columns.length || node.grid.columns.length>64 || node.grid.rows.length>4096))
          throw new GridGraphError('Invalid grid configuration')
        const issue=designGridBudgetIssue(node,current.children.get(node.id) ?? [])
        if (issue==='area') throw new GridGraphError('Grid occupied area exceeds 65536 cells')
        if (issue==='rows') throw new GridGraphError('Grid exceeds 4096 rows')
      }
      const identity=`${current.identity}:${node.id}`
      if (active.has(identity)) throw new Error('Cyclic layer or component hierarchy')
      const next=new Set(active);next.add(identity)
      for (const child of current.children.get(node.id) ?? []) visit(child,current,depth+1,next)
      if (node.kind!=='instance' || !node.componentId) return
      const source=byId.get(node.componentId)
      if (source?.kind!=='component') throw new Error('Component source not found')
      const key=JSON.stringify([node.componentId,node.componentPropertyValues,node.instanceOverrides,node.instanceGrid])
      let linked=contexts.get(key)
      if (!linked) {
        linked=context(applyDesignComponentInstance(template(source.id),source,node,library)
          .map(item=>item.id===source.id?applyDesignInstanceGrid(item,node):item))
        contexts.set(key,linked)
      }
      const root=linked.nodes.find(item=>item.id===source.id)
      if (!root) throw new Error('Component source not found')
      visit(root,linked,depth+1,next)
    }
    for (const root of initial.nodes) if (root.parentId===null) {rootCount=0;visit(root,initial,0,new Set())}
    return []
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return [{ kind:error instanceof GridGraphError?'grid':'component',message:error.message }]
  }
}


/** Preserve the string-only validation API while retaining domain details for specialized guards.
 * @param document - Candidate native scene.
 * @returns Contextual grid or component failure messages.
 */
export function designComponentGraphIssues(document:CopyOSDesignDocument):string[] {
  return designComponentGraphDiagnostics(document).map(issue=>issue.message)
}

/** Check contextual cycles and native expansion budgets before rendering or committing edits.
 * @param document - Candidate design.
 * @returns Whether every inherited and local context can expand safely.
 */
export function designComponentGraphValid(document:CopyOSDesignDocument):boolean {
  return designComponentGraphIssues(document).length===0
}
