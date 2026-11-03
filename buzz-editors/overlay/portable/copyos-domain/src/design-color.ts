/** Native color resources keep RGB fallbacks separate from full-precision transparency. */
import type { CopyOSDesignNode,CopyOSDesignGradient } from './types.ts'
/** A native RGB literal and optional full-precision alpha; omission means fully opaque. */
export interface DesignColorValue { value:string;alpha?:number|undefined }
/** Serialize native colors without quantizing alpha into an eight-bit hex channel.
 * @param resource - Effective RGB literal and optional alpha.
 * @returns Existing hex6 for opaque values, otherwise canonical CSS rgb with exact numeric alpha.
 */
export function designColorVariableCss(resource:DesignColorValue):string {
  const alpha=resource.alpha ?? 1
  if (alpha===1) return resource.value
  const channels=[1,3,5].map(index=>Number.parseInt(resource.value.slice(index,index+2),16))
  return `rgb(${channels.join(' ')} / ${alpha})`
}
/** Read native hex6 or the canonical runtime CSS form without losing its alpha.
 * @param css - Native literal or renderer color produced by designColorVariableCss.
 * @returns RGB/alpha pair, or undefined for other CSS forms.
 */
export function designColorCssValue(css:string):DesignColorValue|undefined {
  if (/^#[\da-f]{6}$/i.test(css)) return { value:css,alpha:1 }
  const match=/^rgb\((\d+) (\d+) (\d+) \/ ([\d.e+-]+)\)$/.exec(css)
  if (!match) return
  const channels=match.slice(1,4).map(Number),alpha=Number(match[4])
  if (channels.some(channel=>channel<0 || channel>255) || !Number.isFinite(alpha) || alpha<0 || alpha>1) return
  return { value:'#'+channels.map(channel=>channel.toString(16).padStart(2,'0')).join(''),alpha }
}
/** Compose an additional paint opacity with an already resolved token color.
 * @param css - Native or canonical runtime color.
 * @param opacity - Authored paint/stroke opacity.
 * @returns CSS color carrying both factors once, without changing authored fields.
 */
export function designColorWithOpacity(css:string,opacity:number):string {
  const color=designColorCssValue(css)
  return color?designColorVariableCss({ value:color.value,alpha:(color.alpha ?? 1)*opacity }):css
}
/** Restore bound runtime CSS colors to native RGB fallbacks while retaining their live bindings and authored opacity.
 * @param node - Rendered layer; every other field, including geometry and text, is preserved.
 * @returns Native-compatible color fallbacks for inspector edits, clipboard copies and detach; no alpha is baked twice.
 */
export function restoreDesignTokenColorLiterals(node:CopyOSDesignNode):CopyOSDesignNode {
  const rgb=(value:string,bound:string|null|undefined):string=>bound?(designColorCssValue(value)?.value ?? value):value
  const gradient=(value:CopyOSDesignGradient|undefined):CopyOSDesignGradient|undefined=>value?{ ...value,
    stops:value.stops.map(stop=>({ ...stop,color:rgb(stop.color,stop.variableId) })) }:value
  return { ...node,fill:rgb(node.fill,node.fillVariableId),stroke:rgb(node.stroke,node.strokeVariableId),gradient:gradient(node.gradient),
    fills:node.fills?.map(paint=>({ ...paint,color:rgb(paint.color,paint.variableId),gradient:gradient(paint.gradient) })),
    strokes:node.strokes?.map(paint=>({ ...paint,color:rgb(paint.color,paint.variableId),gradient:gradient(paint.gradient) })),
    instanceStroke:node.instanceStroke && { ...node.instanceStroke,
      strokes:node.instanceStroke.strokes?.map(paint=>({ ...paint,
        color:rgb(paint.color,paint.variableId),gradient:gradient(paint.gradient) })) },
  }
}
