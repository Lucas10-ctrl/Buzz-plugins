/** Canonical variant layer names are a reversible view of stable axes and concrete tuples. */
import { designVariantIssues } from './design-variant-validation.ts'
import type { CopyOSDesignDocument,CopyOSDesignVariantAxis,CopyOSDesignVariantValue } from './types.ts'

/** Maximum authored layer-name length, including losslessly quoted variant tuples and standalone copies. */
export const DESIGN_NODE_NAME_MAX_LENGTH=32768

const validToken=(value:string):boolean=>!!value && value.length<=120 && value.trim()===value
const quote=(value:string):string=>/[=,"\\\u0000-\u001f]/.test(value)?JSON.stringify(value):value
const key=(axes:readonly CopyOSDesignVariantAxis[],values:readonly CopyOSDesignVariantValue[]):string=>{
  const byId=new Map(values.map(value=>[value.axisId,value.value]))
  return JSON.stringify(axes.map(axis=>byId.get(axis.id)))
}

/** Format a complete tuple in stable axis order, quoting reserved characters without truncation.
 * @param axes - Named axes with valid unique identities and values.
 * @param values - Exactly one known choice per axis.
 * @returns Canonical `Axis=Value, Other=Choice` text; unsafe tokens are JSON strings, bounded to 32768 characters.
 */
export function formatDesignVariantName(axes:readonly CopyOSDesignVariantAxis[],values:readonly CopyOSDesignVariantValue[]):string {
  const choices=new Map(values.map(value=>[value.axisId,value.value]))
  if (!axes.length || new Set(axes.map(axis=>axis.id)).size!==axes.length ||
    new Set(axes.map(axis=>axis.name)).size!==axes.length || choices.size!==values.length || choices.size!==axes.length) throw new Error('Variant names require one value per axis')
  const name=axes.map((axis)=>{
    const value=choices.get(axis.id)
    if (!validToken(axis.name) || value===undefined || !validToken(value) || !axis.values.includes(value))
      throw new Error('Variant name refers to an unknown axis or value')
    return quote(axis.name)+'='+quote(value)
  }).join(', ')
  if (name.length>DESIGN_NODE_NAME_MAX_LENGTH) throw new Error('Variant name exceeds 32768 characters')
  return name
}

/** Parse exact named axes and values with optional authoring of new choices on existing axes.
 * @param axes - Existing named axes; names must be unique.
 * @param name - Plain or JSON-quoted axis/value tokens separated by equals and commas.
 * @param options - Allow new valid values without mutating axis inventories; unknown axes always reject.
 * @returns Complete tuple in axis order; malformed, duplicate, missing or unsupported fields throw.
 */
export function parseDesignVariantName(axes:readonly CopyOSDesignVariantAxis[],name:string,
  options?:{ allowNewValues?:boolean }):CopyOSDesignVariantValue[] {
  if (name.length>DESIGN_NODE_NAME_MAX_LENGTH) throw new Error('Variant name exceeds 32768 characters')
  let cursor=0
  const whitespace=():void=>{while(cursor<name.length && /\s/.test(name[cursor] ?? '')) cursor++}
  const token=(delimiter:string):string=>{
    whitespace()
    const start=cursor
    let value:string
    if (name[cursor]==='"') {
      cursor++
      let escaped=false,closed=false
      while(cursor<name.length) {
        const character=name[cursor++]
        if (escaped) {escaped=false;continue}
        if (character==='\\') {escaped=true;continue}
        if (character==='"') {closed=true;break}
      }
      if (!closed) throw new Error('Unclosed quoted variant token')
      try {value=JSON.parse(name.slice(start,cursor)) as string}
      catch(error) {if (!(error instanceof Error)) throw error;throw new Error('Invalid quoted variant token')}
      whitespace()
      if (cursor<name.length && name[cursor]!==delimiter) throw new Error('Unexpected characters after variant token')
    } else {
      while(cursor<name.length && name[cursor]!==delimiter) {
        if (/[=,"\\\u0000-\u001f]/.test(name[cursor] ?? '')) throw new Error('Quote reserved characters in variant names')
        cursor++
      }
      value=name.slice(start,cursor).trim()
    }
    if (!validToken(value)) throw new Error('Variant names require trimmed tokens of 1 to 120 characters')
    return value
  }
  const byName=new Map(axes.map(axis=>[axis.name,axis])),values=new Map<string,string>()
  if (byName.size!==axes.length || !axes.length) throw new Error('Variant axes require unique names')
  while(cursor<name.length) {
    const axisName=token('=')
    if (name[cursor++]!=='=') throw new Error('Variant names require Axis=Value pairs')
    const value=token(',')
    const axis=byName.get(axisName)
    if (!axis) throw new Error('Unknown variant axis')
    if (values.has(axis.id)) throw new Error('Duplicate variant axis')
    if (!options?.allowNewValues && !axis.values.includes(value)) throw new Error('Unknown variant value')
    values.set(axis.id,value)
    if (cursor<name.length) {cursor++;whitespace();if (cursor===name.length) throw new Error('Trailing variant separator')}
  }
  if (values.size!==axes.length) throw new Error('Variant names require every axis')
  return axes.map(axis=>({ axisId:axis.id,value:values.get(axis.id) ?? '' }))
}

/** Reconcile explicit layer-name and table edits while leaving untouched legacy names readable as stored.
 * @param before - Previous authored scene.
 * @param after - Candidate with raw node/name/table edits.
 * @param updates - Original partial field presence, including same-value name or table authoring intent.
 * @returns Candidate with exact name edits applied to tuples and affected set names canonicalized atomically.
 */
export function reconcileDesignVariants(before:CopyOSDesignDocument,after:CopyOSDesignDocument,
  updates:readonly { id:string }[]=[]):CopyOSDesignDocument {
  if (!before.nodes.some(node=>node.kind==='component-set') && !after.nodes.some(node=>node.kind==='component-set')) return after
  const previous=new Map(before.nodes.map(node=>[node.id,node])),byId=new Map(after.nodes.map(node=>[node.id,node]))
  const touched=new Map(updates.map(update=>[update.id,new Set(Object.keys(update))])),affected=new Set<string>()
  const renamed=new Map<string,CopyOSDesignVariantValue[]>(),additions=new Map<string,Map<string,string[]>>()
  for (const set of after.nodes) if (set.kind==='component-set' &&
    (JSON.stringify(set.componentSet)!==JSON.stringify(previous.get(set.id)?.componentSet) || touched.get(set.id)?.has('componentSet')))
    affected.add(set.id)
  for (const node of after.nodes) {
    const parent=byId.get(node.parentId ?? '')
    if (node.kind!=='component' || parent?.kind!=='component-set' || !parent.componentSet) continue
    const old=previous.get(node.id),fields=touched.get(node.id)
    const tupleChanged=JSON.stringify(node.variantValues)!==JSON.stringify(old?.variantValues)
    if (!old || old.parentId!==node.parentId || tupleChanged || fields?.has('variantValues')) affected.add(parent.id)
    const existing=old?.parentId===node.parentId
    const created=!old && previous.get(parent.id)?.kind==='component-set' && fields?.has('name')
    const nameChanged=(existing && (node.name!==old.name || fields?.has('name'))) || created
    if (!nameChanged) continue
    if (node.locked || parent.locked) throw new Error('Component variant is locked')
    const values=parseDesignVariantName(parent.componentSet.axes,node.name,{ allowNewValues:true })
    if ((tupleChanged || fields?.has('variantValues')) && key(parent.componentSet.axes,values)!==key(parent.componentSet.axes,node.variantValues ?? []))
      throw new Error('Conflicting variant name and tuple edits')
    const extra=additions.get(parent.id) ?? new Map<string,string[]>()
    for (const value of values) {
      const axis=parent.componentSet.axes.find(axis=>axis.id===value.axisId)
      if (axis && !axis.values.includes(value.value)) extra.set(axis.id,[...new Set([...extra.get(axis.id) ?? [],value.value])])
    }
    additions.set(parent.id,extra);renamed.set(node.id,values);affected.add(parent.id)
  }
  for (const old of before.nodes) if (old.variantValues && !byId.has(old.id) && old.parentId) affected.add(old.parentId)
  if (!affected.size) return after
  const axes=new Map(after.nodes.flatMap(set=>set.kind==='component-set' && set.componentSet ? [[set.id,
    set.componentSet.axes.map(axis=>({ ...axis,values:[...axis.values,...additions.get(set.id)?.get(axis.id) ?? []] }))] as const] : []))
  const nodes=after.nodes.map((node)=>{
    if (node.kind==='component-set' && affected.has(node.id)) return { ...node,componentSet:{ axes:axes.get(node.id) ?? [] } }
    if (node.kind==='component' && node.parentId && affected.has(node.parentId)) {
      const definitions=axes.get(node.parentId)
      if (!definitions) return node
      const values=renamed.get(node.id) ?? node.variantValues ?? []
      return { ...node,variantValues:values,name:formatDesignVariantName(definitions,values) }
    }
    return node
  })
  const candidate={ ...after,nodes },issue=designVariantIssues(candidate)[0]
  if (issue) throw new Error(issue)
  return candidate
}
