/** Collision-safe shared CSS names for typed resource collections. */
import type { CopyOSDesignDocument } from './types.ts'
/** Canonical and eligible friendly CSS names share one collision-safe registry. */
export interface DesignTokenCssNames {
  color:Map<string,string>
  number:Map<string,string>
  friendlyColor:Map<string,string>
  friendlyNumber:Map<string,string>
}
/** Assign typed canonical names while preserving existing names when collections do not collide.
 * @param document - Color/numeric collections with independently valid resource identities.
 * @returns Canonical maps plus unique valid raw-name aliases outside the reserved canonical namespace.
 */
export function designTokenCssNames(document:Pick<CopyOSDesignDocument,'variables'|'numberVariables'>):DesignTokenCssNames {
  const colors=document.variables,numbers=document.numberVariables ?? [],counts=new Map<string,number>()
  const colorIds=new Set(colors.map(value=>value.id)),numberIds=new Set(numbers.map(value=>value.id))
  for (const value of [...colors,...numbers]) counts.set(value.name,(counts.get(value.name) ?? 0)+1)
  const result:DesignTokenCssNames={ color:new Map(),number:new Map(),friendlyColor:new Map(),friendlyNumber:new Map() }
  for (const [kind,values] of [['color',colors],['number',numbers]] as const) for (const value of values) {
    const collision=colorIds.has(value.id) && numberIds.has(value.id)
    result[kind].set(value.id,`--copyos-${collision?kind+'-':''}${value.id}`)
    if (/^--[A-Za-z_][\w-]*$/.test(value.name) && !value.name.startsWith('--copyos-') && counts.get(value.name)===1)
      result[kind==='color'?'friendlyColor':'friendlyNumber'].set(value.id,value.name)
  }
  return result
}
