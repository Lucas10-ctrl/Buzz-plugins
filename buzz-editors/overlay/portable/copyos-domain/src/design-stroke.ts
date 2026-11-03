import { DESIGN_STROKE_STYLE_KEYS, designStrokeStyle, designStrokeAlignment } from './design-stroke-style.ts'
/** Shared per-edge stroke ownership and single-composite rounded border geometry. */
import { svgPathBbox } from 'svg-path-bbox'
import { designTextLayoutSignature } from './design-text-layout.ts'
import type { CopyOSDesignNode } from './types.ts'

/** Numeric stroke properties bind to shared pixel resources independently. */
export const DESIGN_STROKE_NUMBER_KEYS = ['strokeWidth','strokeTopWidth','strokeRightWidth','strokeBottomWidth','strokeLeftWidth'] as const
/** Component-root stroke fields with explicit local ownership. */
export const DESIGN_STROKE_KEYS = ['strokes','stroke','strokeVariableId','strokeOpacity','strokeAlign','strokeDash',...DESIGN_STROKE_STYLE_KEYS,...DESIGN_STROKE_NUMBER_KEYS] as const
/** Determine whether independent rectangular edge weights are supported.
 * @param node - Stored or resolved layer kind.
 * @returns Whether the layer has four rectangular border edges.
 */
export function designStrokeSupportsEdges(node: Pick<CopyOSDesignNode,'kind'>): boolean {
  return ['rectangle','frame','component','component-set','instance','image'].includes(node.kind)
}
/** Read four effective edge weights without replacing their scalar fallback.
 * @param node - Resolved node in its active token mode.
 * @returns Top/right/bottom/left pixel widths, including explicit zero sides.
 */
export function designStrokeWeights(node:CopyOSDesignNode):{ top:number;right:number;bottom:number;left:number } {
  const scalar=node.strokeWidth
  return designStrokeSupportsEdges(node) ? { top:node.strokeTopWidth ?? scalar,right:node.strokeRightWidth ?? scalar,
    bottom:node.strokeBottomWidth ?? scalar,left:node.strokeLeftWidth ?? scalar } : { top:scalar,right:scalar,bottom:scalar,left:scalar }
}
/** Check local component-root stroke ownership without interpreting legacy fallback fields as overrides.
 * @param node - Stored linked instance.
 * @param key - Stroke field to inspect.
 * @returns Whether a literal/reference or local numeric binding owns this property.
 */
export function designInstanceStrokeOwns(node:CopyOSDesignNode,key:typeof DESIGN_STROKE_KEYS[number]):boolean {
  return node.kind==='instance' && (node.instanceStroke?.[key]!==undefined ||
    DESIGN_STROKE_NUMBER_KEYS.some(numberKey=>numberKey===key && !!node.numericBindings?.[numberKey]))
}
/** Apply instance-root literals and local numeric ownership before resource resolution and layout.
 * @param source - Main component root, with inherited authored references.
 * @param instance - Linked instance retaining explicit local fields/bindings.
 * @returns Effective authored root; unresolved references remain live in the instance mode.
 */
export function applyDesignInstanceStroke(source:CopyOSDesignNode,instance:CopyOSDesignNode):CopyOSDesignNode {
  const local=instance.instanceStroke ?? {}
  const bindings={ ...source.numericBindings }
  const base={ ...source }
  if (local.strokeDash !== undefined && local.strokeDashes === undefined) Reflect.deleteProperty(base, 'strokeDashes')
  if (local.stroke!==undefined && local.strokeVariableId===undefined) base.strokeVariableId=null
  if (local.strokeWidth!==undefined || instance.numericBindings?.strokeWidth) {
    for (const key of DESIGN_STROKE_NUMBER_KEYS.slice(1)) { Reflect.deleteProperty(base,key); Reflect.deleteProperty(bindings,key) }
  }
  for (const key of DESIGN_STROKE_NUMBER_KEYS) {
    if (local[key]!==undefined) Reflect.deleteProperty(bindings,key)
    if (instance.numericBindings?.[key]) bindings[key]=instance.numericBindings[key]
  }
  return { ...base,...Object.fromEntries(Object.entries(local).filter(([,value])=>value!==undefined)),numericBindings:bindings }
}

type Box={ x:number;y:number;width:number;height:number }
type Corner={ x:number;y:number;bevel?:boolean }
function rounded(box:Box,radii:Corner[]):string {
  const [tl,tr,br,bl]=radii
  if (!tl || !tr || !br || !bl) return ''
  const factor=Math.min(1,box.width/(tl.x+tr.x || 1),box.width/(bl.x+br.x || 1),
    box.height/(tl.y+bl.y || 1),box.height/(tr.y+br.y || 1))
  const [a,b,c,d]=radii.map(radius=>({ ...radius,x:radius.x*factor,y:radius.y*factor }))
  if (!a || !b || !c || !d) return ''
  const { x,y,width:w,height:h }=box
  const turn=(corner:Corner,x:number,y:number)=>corner.bevel?`L ${x} ${y}`:`A ${corner.x} ${corner.y} 0 0 1 ${x} ${y}`
  return `M ${x+a.x} ${y} H ${x+w-b.x} ${turn(b,x+w,y+b.y)} V ${y+h-c.y} ${turn(c,x+w-c.x,y+h)} H ${x+d.x} ${turn(d,x,y+h-d.y)} V ${y+a.y} ${turn(a,x+a.x,y)} Z`
}
/** Construct one even-odd border ring so unequal rounded edges never overlap their opacity.
 * @param node - Rectangular resolved source geometry; scaling belongs to the enclosing instance transform.
 * @returns Custom ring, nominal dash outline, mask stroke width and conservative painted bounds; undefined retains scalar rendering.
 */
export function designStrokeGeometry(node:CopyOSDesignNode):{
  path:string
  outline:string
  dashStrokeWidth:number
  bounds:Box
  dashSides:{ clip:string;width:number }[]
}|undefined {
  if (!designStrokeSupportsEdges(node) || !DESIGN_STROKE_NUMBER_KEYS.slice(1).some(key=>node[key]!==undefined)) return
  const weights=designStrokeWeights(node),max=Math.max(...Object.values(weights)),w=node.width,h=node.height
  const alignment=designStrokeAlignment(node),style=designStrokeStyle(node)
  const join=style.join==='miter' && style.miterLimit<Math.SQRT2?'bevel':style.join
  const factor=alignment==='outside'?1:alignment==='inside'?0:.5
  const out={ top:weights.top*factor,right:weights.right*factor,bottom:weights.bottom*factor,left:weights.left*factor }
  const inset={ top:weights.top-out.top,right:weights.right-out.right,bottom:weights.bottom-out.bottom,left:weights.left-out.left }
  let radii=[node.radiusTopLeft ?? node.radius,node.radiusTopRight ?? node.radius,
    node.radiusBottomRight ?? node.radius,node.radiusBottomLeft ?? node.radius]
  const [tl=0,tr=0,br=0,bl=0]=radii
  const ratio=Math.min(1,w/(tl+tr || 1),w/(bl+br || 1),h/(tl+bl || 1),h/(tr+br || 1))
  radii=radii.map(value=>value*ratio)
  const sides=[[out.left,out.top],[out.right,out.top],[out.right,out.bottom],[out.left,out.bottom]]
  const innerSides=[[inset.left,inset.top],[inset.right,inset.top],[inset.right,inset.bottom],[inset.left,inset.bottom]]
  const outer={ x:-out.left,y:-out.top,width:w+out.left+out.right,height:h+out.top+out.bottom }
  const inner={ x:inset.left,y:inset.top,width:w-inset.left-inset.right,height:h-inset.top-inset.bottom }
  const outerPath=rounded(outer,radii.map((r,index)=>({
    x:r>0?r+(sides[index]?.[0] ?? 0):join==='miter'?0:sides[index]?.[0] ?? 0,
    y:r>0?r+(sides[index]?.[1] ?? 0):join==='miter'?0:sides[index]?.[1] ?? 0,
    bevel:r===0 && join==='bevel',
  })))
  const innerPath=inner.width>0 && inner.height>0 ? rounded(inner,radii.map((r,index)=>({
    x:Math.max(0,r-(innerSides[index]?.[0] ?? 0)),y:Math.max(0,r-(innerSides[index]?.[1] ?? 0)),
  }))) : ''
  const left=inner.width>0?inner.x:w/2,right=inner.width>0?inner.x+inner.width:w/2
  const top=inner.height>0?inner.y:h/2,bottom=inner.height>0?inner.y+inner.height:h/2
  const ox=outer.x,oy=outer.y,or=ox+outer.width,ob=oy+outer.height
  const polygons=[[[ox,oy],[or,oy],[right,top],[left,top]],[[or,oy],[or,ob],[right,bottom],[right,top]],
    [[or,ob],[ox,ob],[left,bottom],[right,bottom]],[[ox,ob],[ox,oy],[left,top],[left,bottom]]]
  const values=[weights.top,weights.right,weights.bottom,weights.left]
  const dashSides=polygons.flatMap((points,index)=>values[index]? [{
    clip:points.map((point,i)=>`${i?'L':'M'} ${point[0]} ${point[1]}`).join(' ')+' Z',
    width:(values[index] ?? 0)*(alignment==='center'?1:2),
  }]:[])
  return { dashSides,path:max>0?outerPath+' '+innerPath:'',outline:rounded({ x:0,y:0,width:w,height:h },radii.map(r=>({ x:r,y:r }))),
    dashStrokeWidth:max*(alignment==='inside' || alignment==='outside'?2:1),bounds:outer }
}

/** Shared stroke footprint configuration for every paint kind; colors never affect geometry.
 * @param node - Resolved source node in its active mode.
 * @returns Unequal-edge ring or centered/doubled outline plus alignment and conservative paint area.
 */
export function designStrokePaintGeometry(node: CopyOSDesignNode): {
  ring: ReturnType<typeof designStrokeGeometry>
  alignment: 'inside' | 'outside' | 'center'
  width: number
  bounds: { x: number; y: number; width: number; height: number }
} {
  const ring = designStrokeGeometry(node)
  const alignable = ['rectangle', 'ellipse', 'frame', 'component', 'component-set', 'image', 'path', 'boolean', 'text'].includes(node.kind)
  const alignment = alignable ? designStrokeAlignment(node) : 'center'
  const weight=Math.max(...Object.values(designStrokeWeights(node)))
  const style=designStrokeStyle(node),half=weight*(alignment==='center'?.5:1)
  const out=(node.kind==='path'||node.kind==='boolean')?Math.max(half*(style.join==='miter'?style.miterLimit:1),
    style.cap==='square'?half*Math.SQRT2:half):weight*2
  let left = 0, top = 0, right = node.width, bottom = node.height
  if (node.kind === 'text' && node.textWrap === false && node.textLayoutMetrics?.signature === designTextLayoutSignature(node)) {
    right = Math.max(right, node.textLayoutMetrics.width)
    bottom = Math.max(bottom, node.textLayoutMetrics.height)
  }
  if (node.pathData) for (const path of node.pathData.paths) {
    try {
      const box = svgPathBbox(path.d), sx = node.width / node.pathData.width, sy = node.height / node.pathData.height
      if (box.every(Number.isFinite)) {
        left = Math.min(left, box[0] * sx); top = Math.min(top, box[1] * sy)
        right = Math.max(right, box[2] * sx); bottom = Math.max(bottom, box[3] * sy)
      }
    } catch (error) { if (!(error instanceof Error)) throw error }
  }
  return { ring, alignment, width: node.strokeWidth * (alignment === 'center' ? 1 : 2),
    bounds: ring?.bounds ?? { x: left - out, y: top - out, width: right - left + out * 2, height: bottom - top + out * 2 } }
}
