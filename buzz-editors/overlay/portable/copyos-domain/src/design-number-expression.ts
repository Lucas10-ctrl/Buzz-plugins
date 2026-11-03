/** Bounded, typed numeric arithmetic shared by native resources and the CSS compiler. */
import type { CopyOSDesignNumberExpression } from './types.ts'
/** A computed pixel dimension or unitless number. */
export interface DesignNumberExpressionValue { value:number;unit:'px'|'number' }
/** Formula input limits bound traversal before recursive parsing or evaluation. */
export const DESIGN_NUMBER_EXPRESSION_LIMITS = { nodes:128,depth:16,args:16 } as const
/** Validate structural limits and finite literals without evaluating references.
 * @param input - Untrusted AST; native schemas additionally require UUID references.
 * @returns Whether this is an exact supported expression within the published budgets.
 */
export function designNumberExpressionValid(input:unknown):input is CopyOSDesignNumberExpression {
  const pending:[unknown,number][]=[[input,1]]
  let count=0
  while (pending.length) {
    const entry=pending.pop()
    if (!entry) return false
    const [node,depth]=entry
    if (++count>DESIGN_NUMBER_EXPRESSION_LIMITS.nodes || depth>DESIGN_NUMBER_EXPRESSION_LIMITS.depth || !node || typeof node!=='object' || Array.isArray(node)) return false
    const value=node as Record<string,unknown>
    let keys:string[],children:unknown[]=[]
    switch (value.kind) {
      case 'literal':
        keys=['kind','value','unit']
        if (typeof value.value!=='number' || !Number.isFinite(value.value) ||
          (value.unit!=='px' && value.unit!=='number')) return false
        break
      case 'reference':
        keys=['kind','variableId']
        if (typeof value.variableId!=='string' || !value.variableId.length || value.variableId.length>20000) return false
        break
      case 'binary':
        keys=['kind','operator','left','right']
        if (typeof value.operator!=='string' || !['+','-','*','/'].includes(value.operator)) return false
        children=[value.left,value.right]
        break
      case 'min':case 'max':
        keys=['kind','args']
        if (!Array.isArray(value.args) || !value.args.length || value.args.length>DESIGN_NUMBER_EXPRESSION_LIMITS.args) return false
        children=value.args
        break
      case 'clamp':keys=['kind','min','preferred','max'];children=[value.min,value.preferred,value.max];break
      default:return false
    }
    if (Object.keys(value).some(key=>!keys.includes(key)) || keys.some(key=>!(key in value))) return false
    for (const child of children) pending.push([child,depth+1])
  }
  return true
}
/** Enumerate referenced identities in stable AST order, without duplicates.
 * @param expression - Bounded expression, with temporary CSS identifiers allowed before native compilation.
 * @returns Distinct references; invalid expressions return an empty array.
 */
export function designNumberExpressionReferences(expression:CopyOSDesignNumberExpression):string[] {
  if (!designNumberExpressionValid(expression)) return []
  const result=new Set<string>(),pending=[expression]
  while (pending.length) {
    const node=pending.pop()
    if (!node) break
    if (node.kind==='reference') result.add(node.variableId)
    else if (node.kind==='binary') pending.push(node.right,node.left)
    else if (node.kind==='min' || node.kind==='max') pending.push(...[...node.args].reverse())
    else if (node.kind==='clamp') pending.push(node.max,node.preferred,node.min)
  }
  return [...result]
}
/** Evaluate typed arithmetic with finite intermediates and CSS-compatible unit algebra.
 * @param expression - Literal/reference/arithmetic/function AST within the published limits.
 * @param lookup - Effective referenced values; absent references make the expression invalid.
 * @returns Computed value/unit, or undefined for bad structure, units, zero division or nonfinite results.
 */
export function evaluateDesignNumberExpression(expression:CopyOSDesignNumberExpression,
  lookup:(id:string)=>DesignNumberExpressionValue|undefined):DesignNumberExpressionValue|undefined {
  if (!designNumberExpressionValid(expression)) return
  const visit=(node:CopyOSDesignNumberExpression):DesignNumberExpressionValue|undefined=>{
    if (node.kind==='literal') return { value:node.value,unit:node.unit }
    if (node.kind==='reference') {
      const value=lookup(node.variableId)
      return value && Number.isFinite(value.value) && ['px','number'].includes(value.unit)?value:undefined
    }
    if (node.kind==='binary') {
      const left=visit(node.left),right=visit(node.right)
      if (!left || !right) return
      let value:number,unit:DesignNumberExpressionValue['unit']
      if (node.operator==='+' || node.operator==='-') {
        if (left.unit!==right.unit) return
        unit=left.unit;value=node.operator==='+'?left.value+right.value:left.value-right.value
      } else if (node.operator==='*') {
        if (left.unit==='px' && right.unit==='px') return
        unit=left.unit==='px' || right.unit==='px'?'px':'number';value=left.value*right.value
      } else {
        if (right.value===0 || (left.unit==='number' && right.unit==='px')) return
        unit=right.unit==='px'?'number':left.unit;value=left.value/right.value
      }
      return Number.isFinite(value)?{ value,unit }:undefined
    }
    const values=(node.kind==='clamp'?[node.min,node.preferred,node.max]:node.args).map(visit)
    if (values.some(value=>!value)) return
    const valid=values.filter((value):value is DesignNumberExpressionValue=>!!value)
    const unit=valid[0]?.unit
    if (!unit || valid.some(value=>value.unit!==unit)) return
    const numbers=valid.map(value=>value.value)
    const value=node.kind==='min'?Math.min(...numbers):node.kind==='max'?Math.max(...numbers):
      Math.max(numbers[0] ?? 0,Math.min(numbers[1] ?? 0,numbers[2] ?? 0))
    return Number.isFinite(value)?{ value,unit }:undefined
  }
  return visit(expression)
}
/** Remap only typed numeric references, retaining literal values and tree structure.
 * @param expression - Valid bounded formula.
 * @param map - Identity mapper for native clipboard or CSS import reservation.
 * @returns Formula with fresh references; malformed input throws before traversal.
 */
export function mapDesignNumberExpressionReferences(
  expression:CopyOSDesignNumberExpression,map:(id:string)=>string,
):CopyOSDesignNumberExpression {
  if (!designNumberExpressionValid(expression)) throw new Error('Invalid numeric expression')
  const visit=(node:CopyOSDesignNumberExpression):CopyOSDesignNumberExpression=>{
    if (node.kind==='reference') return { ...node,variableId:map(node.variableId) }
    if (node.kind==='binary') return { ...node,left:visit(node.left),right:visit(node.right) }
    if (node.kind==='clamp') return { ...node,min:visit(node.min),preferred:visit(node.preferred),max:visit(node.max) }
    if (node.kind==='min' || node.kind==='max') return { ...node,args:node.args.map(visit) }
    return { ...node }
  }
  return visit(expression)
}
/** Serialize a safe live CSS formula using a shared identity-to-CSS-name registry.
 * @param expression - Valid bounded AST.
 * @param nameForId - Canonical or eligible friendly custom-property name, including its -- prefix.
 * @returns CSS arithmetic/function source; malformed AST/name callbacks throw.
 */
export function designNumberExpressionCss(expression:CopyOSDesignNumberExpression,nameForId:(id:string)=>string=id=>`--copyos-${id}`):string {
  if (!designNumberExpressionValid(expression)) throw new Error('Invalid numeric expression')
  const print=(node:CopyOSDesignNumberExpression):string=>{
    if (node.kind==='literal') return String(node.value)+(node.unit==='px'?'px':'')
    if (node.kind==='reference') {
      const name=nameForId(node.variableId)
      if (!/^--[A-Za-z_][\w-]*$/.test(name)) throw new Error('Invalid numeric expression CSS name')
      return `var(${name})`
    }
    if (node.kind==='binary') return `calc(${print(node.left)} ${node.operator} ${print(node.right)})`
    if (node.kind==='clamp') return `clamp(${print(node.min)}, ${print(node.preferred)}, ${print(node.max)})`
    return `${node.kind}(${node.args.map(print).join(', ')})`
  }
  return print(expression)
}
export { designTokenCssNames,type DesignTokenCssNames } from './design-token-css-names.ts'
