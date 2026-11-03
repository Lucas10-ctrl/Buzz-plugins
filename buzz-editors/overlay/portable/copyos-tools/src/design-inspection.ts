/** Revision-bound, retrievable Page Designer inspection with a budget on the actual rendered JSON text. */
import { createHash } from 'node:crypto'
import { designAutoLayoutSuggestionFingerprint, designAutoLayoutSuggestionIds } from '../../copyos-domain/src/designs.ts'
import {
  designLayoutVersionContext, previewDesignLayoutVersion, designGridCellAlignmentContext,
  designAutoLayoutSuggestionContext, previewDesignAutoLayoutSuggestion,
  designAutoLayoutPaddingContext, designAutoLayoutAlignmentContext, designAutoLayoutContext,
  createDesignRenderScene, designBooleanSelection, designPathBounds, designInstanceGridCellContext,
  designInstanceGridConfigContext, designSemanticsStructureIssues,
  designInstanceLayoutContext, designColorCssValue,
  designComponentPropertyDefinitions,
  designComponentPropertyOwner,
  designComponentPropertyValues, designComponentPropertyTargetPage, designInstanceOverrideLayerPage,
  designInstanceSwapCandidateSummary, designComponentPropertySwapCandidateSummary, designComponentSetDefault,
  designNodePaints, designModeResources, resolveDesignModeColors, resolveDesignNumberVariables,
  resolveDesignCanvasBackground, exportDesignCss, designNodeStrokePaints, designLayerBlendContext, designNodeLayerBlendMode,
  designStrokeStyle, designStrokeAlignment, designStrokeWeights, designInstanceStrokeNode, designInstanceStrokeOwns,
  DESIGN_STROKE_STYLE_KEYS, DESIGN_STROKE_NUMBER_KEYS,
  designSizingContext, DESIGN_INSTANCE_SIZING_KEYS, designInstanceSizingOwns,
  designNodeCss, designTextMeasurementStatus, designAspectRatioContext,
  designTextRangeContext, designTextSegments, designEffectsContext, designEffectSpreadSupported,
  designEffectOpacity, designEffectColorAlpha, parseDesignPathContours,
} from '../../copyos-domain/src/design-model.ts'
import { summarizeDesignSystem } from './design-system-summary.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from '../../copyos-domain/src/types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const SECTIONS = ['boolean-operations','auto-layout-suggestion','grid-cell-alignment','layout-version','auto-layout-padding','auto-layout-alignment','auto-layout','overview','layers','authored-layers','children','colors','numbers','token-modes','mode-colors','mode-numbers',
  'text-styles','effect-styles','pages','semantics-structure','component-properties','property-targets','property-values','variants','variant-axes','variant-values',
  'instance-root','instance-layers','instance-cell','instance-grid','instance-layout','layer-blend','stroke-geometry','vector-paths','sizing','instance-overrides','fills','gradient-stops','strokes','stroke-gradient-stops','instance-swap-candidates',
  'property-swap-candidates','aspect-ratio','text-runs','effects','node-css','css','design-system','field'] as const
type Section = (typeof SECTIONS)[number]
const selectionSection=(section:unknown):boolean=>section==='boolean-operations' || section==='auto-layout-suggestion' || section==='auto-layout' || section==='auto-layout-alignment' || section==='grid-cell-alignment' || section==='layout-version'
/** Explicit scoped inspection selectors; opaque field handles and cursors retain the complete request context. */
export interface DesignInspectionRequest {
  workspace_id?: string | undefined
  suggestion_seed?: string | undefined
  page_id_json?: string | undefined
  layout_version?: string | undefined
  node_ids_json?: string | undefined
  token_mode_id?: string | undefined
  section?: string | undefined
  owner_id?: string | undefined
  property_id?: string | undefined
  axis_id?: string | undefined
  paint_id?: string | undefined
  instance_path_json?: string | undefined
  query?: string | undefined
  limit?: number | undefined
  max_bytes?: number | undefined
  revision?: number | undefined
  cursor?: string | undefined
  field_ref?: string | undefined
  component_property_id?: string | undefined
  component_property_query?: string | undefined
  component_property_cursor?: number | undefined
}
type Selector = {
  seed?: string | undefined
  section: Section
  page?: string | null | undefined
  model?: 'css' | 'legacy' | undefined
  owner?: string | undefined
  property?: string | undefined
  axis?: string | undefined
  paint?: string | undefined
  path: string[]
  ids: string[] | null
  query: string
}
type Row = { key: string; value: unknown }
type Page = { rows: Row[]; total: number; next: number | null; rejected?: number; unsearched?: number }
type Reference = {
  v: 1
  source: string
  selector: Selector
  offset: number
  key: string
  path: (string | number)[]
  selectionDigest?: string
}
const plain = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
function decode(value: string, label: string): unknown {
  if (value.length > 20000 || !/^[\w-]+$/.test(value)) throw new Error(`Invalid inspection ${label}`)
  try { return JSON.parse(Buffer.from(value,'base64url').toString('utf8')) }
  catch { throw new Error(`Invalid inspection ${label}`) }
}
function object(value: unknown): value is Record<string,
  unknown> { return value!==null && typeof value==='object' && !Array.isArray(value) }
const uuid = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function validSelector(value: unknown): value is Selector {
  return object(value) && SECTIONS.includes(value.section as Section) && value.section!=='field' &&
    ['owner','property','axis','paint'].every(key=>value[key]===undefined || uuid(value[key])) &&
    Array.isArray(value.path) && value.path.length<=64 && value.path.every(uuid) &&
    (value.ids===null || (Array.isArray(value.ids) && value.ids.length<=(selectionSection(value.section)?500:100) &&
      value.ids.every(uuid) && (!selectionSection(value.section) || new Set(value.ids).size===value.ids.length))) &&
    typeof value.query==='string' && value.query.length<=200 &&
    (value.section==='layout-version' ?
      (value.model==='css' || value.model==='legacy') && (value.page===null || uuid(value.page) || value.page===undefined) &&
      ((value.page!==undefined) !== (value.ids!==null)) && value.owner===undefined && !value.path.length &&
      value.property===undefined && value.axis===undefined && value.paint===undefined && value.query==='' :
      value.page===undefined && value.model===undefined) &&
    !(['auto-layout-alignment','grid-cell-alignment'].includes(String(value.section)) && (value.owner!==undefined && value.ids!==null ||
      value.path.length>0 && value.owner===undefined)) &&
    (value.section==='auto-layout-suggestion' ? uuid(value.seed) && value.ids!==null && value.ids.length>0 &&
      value.owner===undefined && !value.path.length && value.query==='' &&
      value.property===undefined && value.axis===undefined && value.paint===undefined : value.seed===undefined) &&
    Object.keys(value).every(key=>['seed','section','owner','property','axis','paint','path','ids','query','page','model'].includes(key))
}
function validReference(value: unknown): value is Reference {
  return object(value) && value.v===1 && typeof value.source==='string' && validSelector(value.selector) &&
    typeof value.offset==='number' && Number.isSafeInteger(value.offset) && value.offset>=0 &&
    typeof value.key==='string' && value.key.length<=10000 && Array.isArray(value.path) && value.path.length<=100 &&
    value.path.every(key=>(typeof key==='string' && !['__proto__','prototype','constructor'].includes(key)) ||
      (typeof key==='number' && Number.isSafeInteger(key) && key>=0)) &&
    (value.selectionDigest===undefined || selectionSection(value.selector.section) &&
      typeof value.selectionDigest==='string' && /^[a-f0-9]{64}$/.test(value.selectionDigest)) &&
    Object.keys(value).every(key=>['v','source','selector','offset','key','path','selectionDigest'].includes(key))
}
function integer(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${label} must be an integer from ${min} to ${max}`)
  return result
}
function identities(value: string | undefined, max: number, unique = true): string[] | null {
  if (value === undefined) return null
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length > max || parsed.some(id => !uuid(id)) ||
    (unique && new Set(parsed).size !== parsed.length)) throw new Error(`Expected at most ${max} unique layer identities`)
  return parsed as string[]
}
function smallObject(value: unknown): boolean {
  let remaining=800
  const visit=(item:unknown,depth:number):boolean=>{
    if (depth>20) return false
    if (typeof item==='string') {
      if (item.length>200 || item.startsWith('data:image/')) return false
      remaining-=Buffer.byteLength(JSON.stringify(item),'utf8')
    } else if (item!==null && typeof item==='object') {
      for (const [key,child] of Object.entries(item)) {
        if (key==='url' || key==='imageUrl') return false
        remaining-=key.length+4
        if (remaining<0 || !visit(child,depth+1)) return false
      }
    } else remaining-=20
    return remaining>=0
  }
  return visit(value,0)
}
/** Serialize exactly the text emitted by the JSON tool renderer.
 * @param value - Inspection JSON after normalization.
 * @returns Pretty JSON text whose UTF8 byte count is the enforced output budget.
 */
export function renderDesignInspection(value: JsonValue): string { return JSON.stringify(value,null,2) }
function measured(value: Record<string, unknown>): { value: JsonValue; bytes: number } {
  let normalized = plain({ ...value, returned_bytes: 0 })
  for (let i=0;i<8;i++) {
    const bytes=Buffer.byteLength(renderDesignInspection(normalized),'utf8')
    if ((normalized as Record<string,JsonValue>).returned_bytes===bytes) return { value:normalized,bytes }
    normalized=plain({ ...value,returned_bytes:bytes })
  }
  throw new Error('Inspection byte accounting did not settle')
}
/** Produce complete paged sections or resumable field chunks without publishing unbounded implicit details.
 * @param document - Valid native scene read from its registered/current workspace.
 * @param request - Explicit selectors, byte/record budget and revision-bound continuations.
 * @param authority - Authorized source project identity supplied by the tool, never published as a path.
 * @returns JSON bounded by the actual pretty-rendered UTF8 representation, including continuation metadata.
 */
export function inspectDesignPage(document: CopyOSDesignDocument, request: DesignInspectionRequest, authority = 'direct'): JsonValue {
  const budget=integer(request.max_bytes,32768,16384,65536,'max_bytes'), limit=integer(request.limit,20,1,100,'limit')
  if (request.revision!==undefined && request.revision!==document.revision) throw new Error('Design revision changed; restart inspection')
  const inspected=request.token_mode_id ? { ...document,
    activeTokenModeId:request.token_mode_id==='base'?null:request.token_mode_id }:document
  const source=digest(JSON.stringify([authority,request.workspace_id ?? '$session',document.id,document.revision,
    request.token_mode_id ?? '$saved']))
  if (request.token_mode_id && request.token_mode_id!=='base' && !document.tokenModes?.some(mode=>mode.id===request.token_mode_id))
    throw new Error('Inspection token mode was not found')
  if (request.query && request.query.length>200) throw new Error('Inspection query must not exceed200 characters')
  let selectedPage:string|null|undefined
  if (request.page_id_json!==undefined) {
    try { selectedPage=JSON.parse(request.page_id_json) as string|null }
    catch { throw new Error('page_id_json requires a JSON UUID or null') }
    if (selectedPage!==null && !uuid(selectedPage)) throw new Error('page_id_json requires a JSON UUID or null')
  }
  let selector:Selector={ seed:request.suggestion_seed,page:selectedPage,model:request.layout_version as Selector['model'],section:(request.section ?? 'layers') as Section,owner:request.owner_id,property:request.property_id,
    axis:request.axis_id,paint:request.paint_id,path:identities(request.instance_path_json,64,false) ?? [],
    ids:identities(request.node_ids_json,selectionSection(request.section ?? '')?500:100),query:request.query ?? '' }
  // Existing property-candidate selectors remain explicit aliases to the same paged engine.
  if (request.component_property_id!==undefined) {
    if (request.section!==undefined && request.section!=='property-swap-candidates') throw new Error('Property selectors require the property candidate section')
    if (!selector.ids || selector.ids.length!==1) throw new Error('Select exactly one property owner')
    selector={ ...selector,section:'property-swap-candidates',owner:selector.ids[0],property:request.component_property_id,
      query:request.component_property_query ?? selector.query }
  } else if (request.component_property_query!==undefined || request.component_property_cursor!==undefined)
    throw new Error('Property candidate search requires component_property_id')
  if (!SECTIONS.includes(selector.section)) throw new Error('Unknown design inspection section')
  if (selector.query.length>200) throw new Error('Inspection query must not exceed200 characters')
  let reference:Reference|undefined
  if (selector.section==='field') {
    if (!request.field_ref) throw new Error('field requires a returned field_ref')
    if ([request.owner_id,request.property_id,request.axis_id,request.paint_id,request.instance_path_json,
      request.node_ids_json,request.page_id_json,request.layout_version,request.suggestion_seed,request.query,request.component_property_id,
      request.component_property_query,
      request.component_property_cursor].some(value=>value!==undefined))
      throw new Error('Field references retain their selectors; do not supply collection selectors')
    const decoded=decode(request.field_ref,'field reference')
    if (!object(decoded) || decoded.source!==source)
      throw new Error('Field reference does not match this workspace/design/revision/mode')
    // Missing IDs affect eligibility only; their exact input remains bound through the selection digest.
    const encodedSelector=decoded.selector
    const compactIds:unknown[]|undefined=object(encodedSelector) && selectionSection(encodedSelector.section) &&
      Array.isArray(encodedSelector.ids)
      ? encodedSelector.ids : undefined
    const occupied=new Set(compactIds?.includes(null)?document.nodes.map(node=>node.id):[])
    let missingIndex=0
    const missing=():string=>{
      let id:string
      do { id='00000000-0000-4000-8000-'+(++missingIndex).toString(16).padStart(12,'0') } while(occupied.has(id))
      occupied.add(id)
      return id
    }
    if (compactIds?.includes(null) &&
      (typeof decoded.selectionDigest!=='string' || !/^[a-f0-9]{64}$/.test(decoded.selectionDigest)))
      throw new Error('Field reference does not match this workspace/design/revision/mode')
    const expanded=compactIds && object(encodedSelector) ? { ...decoded,selector:{ ...encodedSelector,
      ids:compactIds.map(id=>id===null ? missing() :
        typeof id==='number' && Number.isSafeInteger(id) && id>=0 ? document.nodes[id]?.id : id) } } : decoded
    if (!validReference(expanded)) throw new Error('Field reference does not match this workspace/design/revision/mode')
    reference=expanded
    selector=reference.selector
  } else if (request.field_ref!==undefined) throw new Error('field_ref requires section field')
  if (!reference) {
    if (selector.section==='auto-layout-suggestion' && [request.owner_id,request.property_id,request.axis_id,request.paint_id,
      request.instance_path_json,request.query,request.page_id_json,request.layout_version].some(value=>value!==undefined))
      throw new Error('auto-layout-suggestion accepts only its selection and suggestion_seed selectors')
    if (selector.section==='grid-cell-alignment' && (request.instance_path_json!==undefined && !selector.owner || request.query!==undefined))
      throw new Error('grid-cell-alignment accepts only its exclusive selection or owner/path selectors')
    if (selector.section==='layout-version' && [request.owner_id,request.property_id,request.axis_id,request.paint_id,
      request.instance_path_json,request.query].some(value=>value!==undefined))
      throw new Error('layout-version accepts only its scope and layout_version selectors')
    const scoped=['auto-layout-padding','children','component-properties','property-targets','property-values','variants','variant-axes','variant-values',
      'instance-root','instance-layers','instance-cell','instance-grid','instance-layout','layer-blend','stroke-geometry','vector-paths','sizing','instance-overrides','fills','gradient-stops','strokes','stroke-gradient-stops','instance-swap-candidates',
      'property-swap-candidates','mode-colors','mode-numbers','aspect-ratio','text-runs','effects','node-css']
    if (['auto-layout-alignment','grid-cell-alignment'].includes(selector.section) ?
      (selector.owner!==undefined && !uuid(selector.owner) || selector.owner!==undefined && selector.ids!==null) :
      selector.section==='design-system' ? selector.owner!==undefined && !uuid(selector.owner) :
        scoped.includes(selector.section) ? !uuid(selector.owner) : selector.owner!==undefined)
      throw new Error('Inspection section requires its supported owner selector')
    if (selector.ids!==null && !['layers','authored-layers','boolean-operations','auto-layout-suggestion','auto-layout','auto-layout-alignment','grid-cell-alignment','layout-version'].includes(selector.section) && request.component_property_id===undefined)
      throw new Error('node_ids_json requires layers or a supported selection section')
    if (selector.query && !['instance-swap-candidates','property-swap-candidates'].includes(selector.section))
      throw new Error('Search is supported only for candidate sections')
    if (selector.path.length && !['grid-cell-alignment','auto-layout-alignment','auto-layout-padding','fills','gradient-stops','strokes','stroke-gradient-stops','instance-cell','instance-grid','instance-layout','layer-blend','text-runs','effects','node-css'].includes(selector.section))
      throw new Error('Nested paths are supported only for grid-cell-alignment/auto-layout-alignment/auto-layout-padding/fills/gradient-stops/strokes/stroke-gradient-stops/instance-cell/instance-grid/instance-layout/layer-blend/text-runs/effects/node-css')
    if (['instance-cell','instance-grid','instance-layout'].includes(selector.section) && !selector.path.length)
      throw new Error('instance-cell/instance-grid/instance-layout requires instance_path_json')
    if (selector.property!==undefined && !['property-targets','property-swap-candidates'].includes(selector.section))
      throw new Error('Property selector is not supported by this section')
    if (selector.paint!==undefined && !['gradient-stops','stroke-gradient-stops'].includes(selector.section)) throw new Error('Paint selector requires gradient-stops or stroke-gradient-stops')
    if (selector.section==='stroke-gradient-stops' && !selector.paint) throw new Error('stroke-gradient-stops requires paint_id')
    if (selector.axis!==undefined && selector.section!=='variant-values') throw new Error('Axis selector requires variant-values')
    if (selector.section==='variant-values' && !selector.axis) throw new Error('variant-values requires axis_id')
    if (selector.section==='property-swap-candidates' && !selector.property) throw new Error('Property candidates require property_id')
  }
  if (selector.section==='auto-layout-suggestion' ? !uuid(selector.seed) : selector.seed!==undefined)
    throw new Error('suggestion_seed is a required UUID only for auto-layout-suggestion')
  if (selector.section==='design-system' && (selector.model!==undefined || selector.page!==undefined && selector.owner!==undefined))
    throw new Error('design-system accepts either owner_id or page_id_json, never both')
  if (selector.section==='layout-version' ?
    !['css','legacy'].includes(selector.model ?? '') || (selector.page!==undefined) === (selector.ids!==null) :
    selector.section!=='design-system' && (selector.page!==undefined || selector.model!==undefined))
    throw new Error('layout-version requires layout_version and exactly one of node_ids_json or page_id_json; selectors are section-specific')
  if (selectionSection(selector.section) && selector.section!=='layout-version' && !selector.ids?.length && !(['auto-layout-alignment','grid-cell-alignment'].includes(selector.section) && selector.owner)) throw new Error('Selection inspection requires node_ids_json')
  if (selector.section==='layout-version' && selector.ids!==null && !selector.ids.length)
    throw new Error('layout-version requires a nonempty selection')
  if (['auto-layout-alignment','grid-cell-alignment'].includes(selector.section) && selector.path.length && !selector.owner)
    throw new Error('Contextual alignment requires owner_id')
  const context=digest(JSON.stringify([source,selector,reference ? request.field_ref : null]))
  let offset=integer(request.component_property_cursor,0,0,100000,'component_property_cursor')
  if (request.cursor!==undefined) {
    const cursor=decode(request.cursor,'cursor')
    if (!object(cursor) || cursor.v!==1 || cursor.context!==context || typeof cursor.offset!=='number' || !Number.isSafeInteger(cursor.offset) || cursor.offset<0 ||
      cursor.field!==(reference ? request.field_ref : undefined)) throw new Error('Inspection cursor context or revision changed')
    offset=cursor.offset
  }
  const cursor=(next:number):string=>encode({ v:1,context,offset:next,...(reference?{ field:request.field_ref }:{}) })
  const byId=new Map(document.nodes.map(node=>[node.id,node]))
  let scene:ReturnType<typeof createDesignRenderScene>|undefined
  const render=():ReturnType<typeof createDesignRenderScene>=>scene ??= createDesignRenderScene(inspected)
  const owner=():CopyOSDesignNode=>{
    const node=byId.get(selector.owner ?? '')
    if (!node) throw new Error('Inspection owner was not found')
    return node
  }
  const contextual=(path=selector.path):{ node:CopyOSDesignNode;context:ReturnType<typeof createDesignRenderScene>['root'] }=>{
    const original=owner(), root=render(), stored=root.root.byId.get(original.id)
    if (!stored) throw new Error('Inspection layer was not found')
    if (!path.length) return { node:stored,context:root.root }
    let context=root.instance(stored,root.root)
    for (let i=0;i<path.length;i++) {
      if (!context) throw new Error('Nested instance context was not found')
      const node=context.byId.get(path[i] ?? '')
      if (!node) throw new Error('Nested instance target was not found')
      if (i===path.length-1) return { node,context }
      context=root.instance(node,context)
    }
    throw new Error('Nested instance target was not found')
  }
  const slice=<T>(values:readonly T[],start:number,take:number,key:(value:T,index:number)=>string,
    transform:(value:T)=>unknown=value=>value):Page=>({
    rows:values.slice(start,start+take).map((value,index)=>({ key:key(value,start+index),value:transform(value) })),total:values.length,
    next:start+take<values.length?start+take:null })
  const idKey=(value:unknown,index:number):string=>typeof value==='object' && value!==null && 'id' in value?String(value.id):String(index)
  const layer=(node:CopyOSDesignNode,mode:string|null):unknown=>({ ...node,fills:designNodePaints(node),
    strokes:designNodeStrokePaints(node),resolvedTokenModeId:mode,resolvedBlendMode:designNodeLayerBlendMode(node),
    ...(node.kind==='text'?{ resolvedTextMeasurement:designTextMeasurementStatus(node) }:{}),
    resolvedFill:designColorCssValue(node.fill),resolvedStroke:designColorCssValue(node.stroke),
    image_present:!!node.imageUrl || !!node.fills?.some(fill=>fill.image) || !!node.strokes?.some(paint=>paint.image),
    path_count:node.pathData?.paths.length ?? 0 })
  const setOwner=():CopyOSDesignNode=>{
    const node=owner(), member=node.kind==='instance'?byId.get(node.componentId ?? ''):node
    const set=node.kind==='component-set'?node:byId.get(member?.parentId ?? '')
    if (set?.kind!=='component-set' || !set.componentSet) throw new Error('Inspection owner has no component set')
    return set
  }
  const rows=(start:number,take:number):Page=>{
    switch(selector.section) {
      case 'boolean-operations': {
        const ids = selector.ids ?? []
        const scene = createDesignRenderScene(inspected).root.nodes
        const locked = (node: CopyOSDesignNode): boolean => {
          const seen = new Set<string>()
          let current: CopyOSDesignNode | undefined = node
          while (current && !seen.has(current.id)) {
            if (current.locked) return true
            seen.add(current.id)
            current = current.parentId ? byId.get(current.parentId) : undefined
          }
          return false
        }
        const results = ids.flatMap((id) => {
          const node = byId.get(id), effective = scene.find(value => value.id === id)
          if (node?.kind !== 'boolean') return []
          return [{ nodeId: id, operation: node.booleanOperation,
            operandIds: document.nodes.filter(value => value.parentId === id).map(value => value.id), locked: locked(node),
            empty: effective?.pathData?.paths.length === 0,
            bounds: effective?.pathData ? designPathBounds(effective.pathData) ?? null : null }]
        })
        return slice([{ selectionIds: ids, creation: designBooleanSelection(inspected, ids), results,
          limitations: ['Stored shape/path operands only; visible strokes and text require outlining support.',
            'Result geometry is derived; operands remain editable. Flatten explicitly replaces them.'] }], start, take, () => 'boolean-selection')
      }
      case 'auto-layout-suggestion': {
        const seed=selector.seed
        if (!seed) throw new Error('auto-layout-suggestion requires suggestion_seed')
        const context=designAutoLayoutSuggestionContext(inspected,selector.ids ?? [])
        const result=context.canSuggest ?
          previewDesignAutoLayoutSuggestion(inspected,selector.ids ?? [],designAutoLayoutSuggestionIds(seed)) : null
        const preview=result ? Object.fromEntries(Object.entries(result).filter(([key])=>key!=='document')) : null
        return slice([{ context,preview,review:{ fingerprint:designAutoLayoutSuggestionFingerprint(inspected,selector.ids ?? [],seed),
          modeId:inspected.activeTokenModeId ?? null,seed },
        limitation:'CopyOS bounded spatial inference; grouping and direction may need review. Geometry changes list stored layers only.' }],
        start,take,()=> 'auto-layout-suggestion')
      }
      case 'auto-layout-padding':return slice([designAutoLayoutPaddingContext(inspected,[{ nodeId:owner().id,path:selector.path }])],
        start,take,()=>JSON.stringify([selector.owner,selector.path]))
      case 'layout-version': {
        const model=selector.model
        if (model!=='css' && model!=='legacy') throw new Error('layout-version requires css or legacy')
        const scope=selector.page!==undefined ? { type:'page' as const,pageId:selector.page } :
          { type:'selection' as const,nodeIds:selector.ids ?? [] }
        const context=designLayoutVersionContext(inspected,scope)
        let preview:Record<string,unknown>|null=null
        if (context.canApply) {
          const result=previewDesignLayoutVersion(inspected,scope,model)
          preview={ changedIds:result.changedIds,geometryChanges:result.geometryChanges,targetCount:result.targetCount,
            changedCount:result.changedCount,geometryChangedCount:result.geometryChangedCount }
        }
        return slice([{ model,scope:scope.type==='selection'?{ type:scope.type } : scope,context,preview }],
          start,take,()=> 'layout-version')
      }
      case 'grid-cell-alignment':return slice([designGridCellAlignmentContext(inspected,selector.owner ?
        [{ nodeId:owner().id,path:selector.path }] : selector.ids ?? [])],start,take,()=> 'grid-cell-alignment')
      case 'auto-layout-alignment':return slice([designAutoLayoutAlignmentContext(inspected,selector.owner ?
        [{ nodeId:owner().id,path:selector.path }] : selector.ids ?? [])],start,take,()=>JSON.stringify([selector.owner,selector.path,'selection']))
      case 'design-system':return slice([summarizeDesignSystem(inspected,render().root.nodes,selector.owner ?? null,selector.page ?? null)],
        start,take,()=> 'design-system')
      case 'auto-layout':return slice([designAutoLayoutContext(inspected,selector.ids ?? [])],start,take,()=> 'selection')
      case 'overview':return slice([{ schema:document.schema,version:document.version,createdAt:document.createdAt,updatedAt:document.updatedAt,
        source:document.source,title:document.title,node_count:document.nodes.length,variable_count:document.variables.length,
        number_count:document.numberVariables?.length ?? 0,text_style_count:document.textStyles?.length ?? 0,
        effect_style_count:document.effectStyles?.length ?? 0,
        page_count:document.pages?.length ?? 0,mode_count:document.tokenModes?.length ?? 0,
        canvasBackground:document.canvasBackground,resolvedCanvasBackground:resolveDesignCanvasBackground(inspected),
        sections:SECTIONS }],start,take,idKey)
      case 'layers': {
        const values=render().root.nodes.filter(node=>selector.ids?selector.ids.includes(node.id):node.parentId===null)
        if (selector.ids?.some(id=>!byId.has(id))) throw new Error('Requested layer was not found')
        return { ...slice(values,start,take,idKey),rows:values.slice(start,start+take).map(node=>({ key:node.id,
          value:layer(node,render().root.modes.get(node.id) ?? null) })) }
      }
      case 'authored-layers': {
        if (selector.ids?.some(id=>!byId.has(id))) throw new Error('Requested layer was not found')
        return slice(document.nodes.filter(node=>selector.ids?selector.ids.includes(node.id):node.parentId===null),start,take,idKey)
      }
      case 'children':return slice(document.nodes.filter(node=>node.parentId===owner().id),start,take,idKey)
      case 'colors': {
        const resources=designModeResources(inspected)
        const mode=document.tokenModes?.find(value=>value.id===inspected.activeTokenModeId)
        const baseColors=new Map(document.variables.map(value=>[value.id,value]))
        const palette=new Map(resolveDesignModeColors(inspected).map(value=>[value.id,value]))
        const overridden=new Set(mode?.variables.map(value=>value.id))
        return slice(resources.variables,start,take,idKey,value=>({ ...value,
          resolvedValue:palette.get(value.id)?.value,resolvedAlpha:palette.get(value.id)?.alpha ?? 1,
          baseValue:baseColors.get(value.id)?.value,baseAlpha:baseColors.get(value.id)?.alpha ?? 1,overridden:overridden.has(value.id) }))
      }
      case 'numbers': {
        const values=designModeResources(inspected).numberVariables
        const mode=document.tokenModes?.find(value=>value.id===inspected.activeTokenModeId)
        const baseNumbers=new Map(document.numberVariables?.map(value=>[value.id,value]))
        const resolved=new Map(resolveDesignNumberVariables(values).map(value=>[value.id,value.value]))
        const overridden=new Set(mode?.numberVariables.map(value=>value.id))
        return slice(values,start,take,idKey,value=>({ ...value,resolvedValue:resolved.get(value.id),
          baseValue:baseNumbers.get(value.id)?.value,overridden:overridden.has(value.id) }))
      }
      case 'token-modes':return slice(document.tokenModes ?? [],start,take,idKey)
      case 'mode-colors':case 'mode-numbers': {
        const mode=document.tokenModes?.find(value=>value.id===selector.owner)
        if (!mode) throw new Error('Inspection mode was not found')
        return slice(selector.section==='mode-colors'?mode.variables:mode.numberVariables,start,take,idKey)
      }
      case 'text-styles':return slice(document.textStyles ?? [],start,take,idKey)
      case 'semantics-structure':return slice(designSemanticsStructureIssues(document).map(issue=>({ ...issue,name:byId.get(issue.nodeId)?.name ?? null })),
        start,take,issue=>`${issue.nodeId}:${issue.code}`)
      case 'effect-styles':return slice(document.effectStyles ?? [],start,take,idKey)
      case 'pages':return slice(document.pages ?? [],start,take,idKey,page=>({ ...page,
        resolvedCanvasBackground:resolveDesignCanvasBackground(inspected,page.id) }))
      case 'component-properties': {
        const node=owner(), id=node.kind==='instance'?node.componentId:node.id
        return slice(designComponentPropertyDefinitions(document,id ?? '').map(property=>({ ...property,propertyId:property.id,
          ownerId:designComponentPropertyOwner(document,property.id)?.id,
          shared:designComponentPropertyOwner(document,property.id)?.kind==='component-set',
          applicable:!!property.targets.length })),start,take,idKey)
      }
      case 'property-values':return slice(designComponentPropertyValues(inspected,owner().id).map(property=>({ ...property,
        propertyId:property.id,
        ownerId:designComponentPropertyOwner(document,property.id)?.id,shared:designComponentPropertyOwner(document,
          property.id)?.kind==='component-set',
        applicable:!!property.targets.length })),start,take,idKey)
      case 'property-targets': {
        if (selector.property) {
          const definition=designComponentPropertyDefinitions(document,
            owner().kind==='instance'?owner().componentId ?? '':owner().id).find(value=>value.id===selector.property)
          if (!definition) throw new Error('Inspection property was not found')
          return slice(definition.targets.map(path=>({ path,node:byId.get(path.at(-1) ?? '') })),start,take,(_,index)=>String(index))
        }
        const page=designComponentPropertyTargetPage(document,owner().kind==='instance'?owner().componentId ?? '':owner().id,
          { offset:start,limit:take })
        return { rows:page.layers.map(value=>({ key:JSON.stringify(value.path),value })),total:page.total,next:page.nextOffset }
      }
      case 'instance-root': {
        const instance=render().root.byId.get(owner().id),context=instance && render().instance(instance,render().root)
        const root=context?.byId.get(instance?.componentId ?? '')
        if (!root) throw new Error('Inspection instance root was not found')
        return slice([layer(root,context?.modes.get(root.id) ?? null)],start,take,idKey)
      }
      case 'instance-layers': {
        const page=designInstanceOverrideLayerPage(inspected,owner().id,{ offset:start,limit:take,scene:render() })
        return { rows:page.layers.map(value=>({ key:JSON.stringify(value.path),value:{ ...value,
          node:layer(value.node,contextual(value.path).context.modes.get(value.node.id) ?? null) } })),total:page.total,
        next:page.nextOffset }
      }
      case 'instance-cell': {
        const cell=designInstanceGridCellContext(inspected,owner().id,selector.path,render())
        if (!cell) throw new Error('Inspection instance cell was not found')
        const { node,parent,sourceCell,localCell,active,manual,locked,overridePath }=cell
        return slice([{ path:selector.path,overridePath,node:layer(node,cell.context.modes.get(node.id) ?? null),
          parent:{ id:parent.id,name:parent.name,layout:parent.layout,
            ...(parent.grid?{ grid:{ columnCount:parent.grid.columns.length,explicitRowCount:parent.grid.rows.length,
              autoRows:parent.grid.autoRows,autoPosition:parent.grid.autoPosition } }:{}) },
          sourceCell:sourceCell ?? null,localCell:localCell ?? null,active,manual,locked }],start,take,()=>JSON.stringify(selector.path))
      }
      case 'aspect-ratio': {
        const stored=owner(),value=designAspectRatioContext(inspected,stored.id,render())
        if (!value) throw new Error('Inspection aspect ratio layer was not found')
        return slice([{ targetId:stored.id,locked:value.locked,eligible:value.eligible,
          active:value.eligible && value.effectiveRatio!==null,owned:value.owned,limited:value.limited,
          effective:{ ratio:value.effectiveRatio,width:value.node.width,height:value.node.height,
            widthSizing:value.node.widthSizing ?? null,heightSizing:value.node.heightSizing ?? null },
          sourceRatio:value.sourceRatio,localRatio:value.localRatio,effectiveLimits:value.effectiveLimits,
        }],start,take,()=>stored.id)
      }
      case 'sizing': {
        const stored=owner(),value=designSizingContext(inspected,stored.id,render())
        if (!value) throw new Error('Inspection sizing layer was not found')
        const source=stored.kind==='instance'?byId.get(stored.componentId ?? ''):undefined
        const fields=(node:CopyOSDesignNode)=>Object.fromEntries(DESIGN_INSTANCE_SIZING_KEYS.flatMap(key=>
          node[key]!==undefined?[[key,node[key]]]:[]))
        const bindings=(node:CopyOSDesignNode)=>Object.fromEntries(DESIGN_INSTANCE_SIZING_KEYS.flatMap(key=>
          key!=='widthSizing' && key!=='heightSizing' && node.numericBindings?.[key]?[[key,node.numericBindings[key]]]:[]))
        return slice([{ targetId:stored.id,locked:value.locked,
          effective:{ ...fields(value.node),textSizing:value.node.textSizing ?? null,axis:value.axis },
          authored:fields(stored),source:source?fields(source):null,
          numericBindings:bindings(stored),sourceBindings:source?bindings(source):null,
          ownedKeys:DESIGN_INSTANCE_SIZING_KEYS.filter(key=>stored.kind==='instance'?
            designInstanceSizingOwns(stored,key):stored[key]!==undefined),
          parent:value.parent?{ id:value.parent.id,layout:value.parent.layout }:null,
        }],start,take,()=>stored.id)
      }
      case 'vector-paths': {
        const stored = owner()
        if (stored.kind !== 'path' || !stored.pathData) throw new Error('vector-paths requires a stored path layer')
        let ancestor: CopyOSDesignNode | undefined = stored, locked = false
        const seen = new Set<string>()
        while (ancestor && !seen.has(ancestor.id)) {
          locked ||= ancestor.locked; seen.add(ancestor.id)
          ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
        }
        const pathData = stored.pathData
        const contours = parseDesignPathContours(pathData)
        const records = contours.flatMap(contour => [
          ...contour.anchors.flatMap(anchor => [
            { type: 'point', target: { pathIndex: anchor.pathIndex, commandIndex: anchor.commandIndex, kind: 'anchor' },
              x: anchor.x, y: anchor.y },
            ...[anchor.incoming, anchor.outgoing].flatMap(handle => handle ? [{ type: 'point',
              target: { pathIndex: anchor.pathIndex, commandIndex: anchor.commandIndex, kind: handle.kind },
              x: handle.x, y: handle.y }] : []),
          ]),
          ...contour.segments.map(segment => ({ type: 'segment', pathIndex: contour.pathIndex, ...segment })),
        ]).map(record => ({ nodeId: stored.id, locked, width: pathData.width,
          height: pathData.height, ...record }))
        return slice(records, start, take, (_, index) => String(index))
      }
      case 'stroke-geometry': {
        const stored=owner(),node=stored.kind==='instance' ? designInstanceStrokeNode(inspected,stored,render()) : contextual().node
        const style=designStrokeStyle(node),keys=[...DESIGN_STROKE_STYLE_KEYS,'strokeAlign','strokeDash','strokeOpacity',...DESIGN_STROKE_NUMBER_KEYS] as const
        const source=stored.kind==='instance' ? byId.get(stored.componentId ?? '') : undefined
        const fields=(value:{ [K in typeof keys[number]]?:CopyOSDesignNode[K]|undefined })=>
          Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))
        const bindings=(value:CopyOSDesignNode)=>Object.fromEntries(DESIGN_STROKE_NUMBER_KEYS.flatMap(key=>
          value.numericBindings?.[key] ? [[key,value.numericBindings[key]]] : []))
        return slice([{ targetId:stored.id,active:style.supported,alignmentSupported:style.alignmentSupported,
          effective:{ cap:style.cap,join:style.join,miterLimit:style.miterLimit,dashes:style.dashes,dashOffset:style.dashOffset,
            alignment:designStrokeAlignment(node),widths:designStrokeWeights(node),opacity:node.strokeOpacity ?? 1 },
          authored:fields(stored),source:source?fields(source):null,local:stored.kind==='instance'?fields(stored.instanceStroke ?? {}):null,
          numericBindings:bindings(stored),sourceBindings:source?bindings(source):null,
          ownedKeys:keys.filter(key=>stored.kind==='instance'?designInstanceStrokeOwns(stored,key):stored[key]!==undefined),
          dormantKeys:!style.supported?[...DESIGN_STROKE_STYLE_KEYS]:!style.alignmentSupported?['strokeAlign']:[],
        }],start,take,()=>stored.id)
      }
      case 'layer-blend': {
        const value=designLayerBlendContext(inspected,owner().id,selector.path,render())
        if (!value) throw new Error('Inspection layer blend target was not found')
        return slice([{ path:selector.path,overridePath:value.overridePath,parentPath:value.parentPath,
          targetId:value.node.id,blendMode:value.effectiveBlendMode,sourceBlendMode:value.sourceBlendMode,
          localBlendMode:value.localBlendMode ?? null,owned:value.owned,locked:value.locked }],start,take,()=>JSON.stringify(selector.path))
      }
      case 'instance-layout': {
        const value=designInstanceLayoutContext(inspected,owner().id,selector.path,render())
        if (!value) throw new Error('Inspection instance layout was not found')
        const { target,node,layout,numericBindings,sourceLayout,sourceBindings,localLayout,localBindings,
          eligibility,active,locked,overridePath,parentPath }=value
        return slice([{ path:selector.path,overridePath,parentPath,targetId:target.id,
          node:layer(node,value.context.modes.get(node.id) ?? null),layout,numericBindings,
          sourceLayout,sourceBindings,localLayout:localLayout ?? null,localBindings:localBindings ?? null,
          eligibility,active,locked }],start,take,()=>JSON.stringify(selector.path))
      }
      case 'instance-grid': {
        const value=designInstanceGridConfigContext(inspected,owner().id,selector.path,render())
        if (!value) throw new Error('Inspection instance grid was not found')
        const { target,node,grid,sourceGrid,localGrid,active,locked,overridePath,parentPath }=value
        return slice([{ path:selector.path,overridePath,parentPath,targetId:target.id,
          node:layer(node,value.context.modes.get(node.id) ?? null),grid:grid ?? null,sourceGrid:sourceGrid ?? null,
          localGrid:localGrid ?? null,active,locked }],start,take,()=>JSON.stringify(selector.path))
      }
      case 'instance-overrides':return slice(owner().instanceOverrides ?? [],start,take,(_,index)=>String(index))
      case 'variants': {
        const set=setOwner(), defaultVariantId=designComponentSetDefault(inspected,set.id)?.id ?? null
        return slice(document.nodes.filter(node=>node.parentId===set.id && node.kind==='component').map(node=>({ ...node,
          defaultVariantId })),start,take,idKey)
      }
      case 'variant-axes':return slice(setOwner().componentSet?.axes ?? [],start,take,idKey)
      case 'variant-values': {
        const set=setOwner(),axis=set.componentSet?.axes.find(value=>value.id===selector.axis)
        if (!axis) throw new Error('Inspection axis was not found')
        const node=owner(),member=node.kind==='instance'?byId.get(node.componentId ?? ''):node
        if (member?.kind!=='component') throw new Error('variant-values requires a variant component or instance')
        const choices=new Map(member.variantValues?.map(value=>[value.axisId,value.value]))
        return slice(axis.values,start,take,(_,index)=>String(index),
          (value)=>{ const componentId=document.nodes.find(candidate=>candidate.parentId===set.id && candidate.kind==='component' &&
          set.componentSet?.axes.every(item=>candidate.variantValues?.find(choice=>choice.axisId===item.id)?.value===
            (item.id===axis.id?value:choices.get(item.id))))?.id ?? null
          return { value,componentId,combination_exists:componentId!==null,graph_validated:false }
          })
      }
      case 'strokes':return slice(designNodeStrokePaints(contextual().node).map(paint=>({ ...paint,
        resolvedColor:designColorCssValue(paint.color) })),start,take,idKey)
      case 'stroke-gradient-stops': {
        const paint=designNodeStrokePaints(contextual().node).find(value=>value.id===selector.paint)
        if (!paint) throw new Error('Inspection stroke paint was not found')
        return slice(paint.gradient?.stops.map(stop=>({ ...stop,resolvedColor:designColorCssValue(stop.color) })) ?? [],start,take,idKey)
      }
      case 'fills':return slice(designNodePaints(contextual().node).map(fill=>({ ...fill,
        resolvedColor:designColorCssValue(fill.color) })),start,take,idKey)
      case 'gradient-stops': {
        const node=contextual().node,paint=selector.paint?designNodePaints(node).find(value=>value.id===selector.paint):undefined
        if (selector.paint && !paint) throw new Error('Inspection paint was not found')
        return slice((selector.paint?paint?.gradient:node.gradient)?.stops.map(stop=>({ ...stop,
          resolvedColor:designColorCssValue(stop.color) })) ?? [],start,take,idKey)
      }
      case 'instance-swap-candidates': {
        if (selector.path.length) throw new Error('Candidate probes require a stored root instance')
        const page=designInstanceSwapCandidateSummary(inspected,owner().id,{ cursor:start,limit:take,query:selector.query })
        return { rows:page.candidates.map(node=>({ key:node.id,value:{ id:node.id,name:node.name } })),total:-1,next:page.nextCursor,
          rejected:page.rejected,unsearched:page.unsearched }
      }
      case 'property-swap-candidates': {
        const node=owner(),componentId=node.kind==='instance'?node.componentId:node.id
        const property=designComponentPropertyDefinitions(document,componentId ?? '').find(value=>value.id===selector.property)
        const propertyOwner=property && designComponentPropertyOwner(document,property.id)
        if (property?.type!=='instance-swap' || !propertyOwner) throw new Error('Select an instance-swap property')
        const page=designComponentPropertySwapCandidateSummary(inspected,propertyOwner.id,property.id,
          node.kind==='instance'?[node.id]:undefined,
          { cursor:start,limit:take,query:selector.query })
        return { rows:page.candidates.map(candidate=>({ key:candidate.id,value:{ id:candidate.id,name:candidate.name } })),
          total:-1,next:page.nextCursor,
          rejected:page.rejected,unsearched:page.unsearched }
      }
      case 'text-runs': {
        const target = designTextRangeContext(inspected, owner().id, selector.path)
        if (!target) throw new Error('Text runs require a text layer or linked text descendant')
        const node = target.node
        return slice([{
          nodeId: owner().id, targetId: node.id, instancePath: selector.path, overridePath: target.overridePath,
          locked: target.locked, effectiveModeId: target.effectiveModeId, text: node.text,
          base: { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight,
            fontFeatures: node.fontFeatures ?? [], fontVariations: node.fontVariations ?? [], fontStyle: node.fontStyle ?? 'normal', lineHeight: node.lineHeight, letterSpacing: node.letterSpacing ?? 0,
            textDecoration: node.textDecoration ?? 'none', textStyleId: node.textStyleId ?? null,
            numericBindings: node.numericBindings ?? {} },
          fontFeaturesOwned: target.localFontFeatures !== undefined, localFontFeatures: target.localFontFeatures ?? null,
          sourceFontFeatures: target.sourceFontFeatures ?? null,
          fontVariationsOwned: target.localFontVariations !== undefined, localFontVariations: target.localFontVariations ?? null,
          sourceFontVariations: target.sourceFontVariations ?? null,
          runs: node.textRuns ?? [], segments: designTextSegments(node),
          runsOwned: target.localRuns !== undefined, localRuns: target.localRuns ?? null,
          sourceRuns: target.sourceRuns ?? null, measurement: designTextMeasurementStatus(node),
        }], start, take, () => JSON.stringify([selector.owner, target.overridePath]))
      }
      case 'effects': {
        const target = designEffectsContext(inspected, owner().id, selector.path)
        if (!target) throw new Error('Effect target not found')
        return slice([{
          nodeId: owner().id, targetId: target.node.id, instancePath: selector.path,
          overridePath: target.overridePath, locked: target.locked, effectiveModeId: target.effectiveModeId,
          effects: target.effects, authoredEffects: target.authoredEffects, owned: target.owned, legacyShadow: target.legacyShadow,
          effectStyleId: target.effectStyleId, effectStyleOwned: target.effectStyleOwned,
          localEffectStyleId: target.localEffectStyleId ?? null,
          effectStyle: target.effectStyleId ? (() => {
            const style = document.effectStyles?.find(value => value.id === target.effectStyleId)
            return style ? { id: style.id, name: style.name, description: style.description ?? null } : null
          })() : null,
          localEffects: target.localEffects ?? null, sourceEffects: target.sourceEffects,
          shadowColors: target.effects.filter(effect => effect.type !== 'layer-blur').map(effect => ({
            effectId: effect.id, resolvedRGB: effect.color, resourceAlpha: designEffectColorAlpha(effect),
            opacity: effect.opacity, effectiveOpacity: designEffectOpacity(effect),
          })),
          spreadSupported: designEffectSpreadSupported(target.node),
        }], start, take, () => JSON.stringify([selector.owner, target.overridePath]))
      }
      case 'node-css':return slice([designNodeCss(inspected,{ nodeId:owner().id,instancePath:selector.path })],
        start,take,()=>JSON.stringify([selector.owner,selector.path]))
      case 'css':return { rows:[{ key:'css',value:exportDesignCss(inspected,false) }],total:1,next:null }
      default:throw new Error('Unsupported inspection section')
    }
  }
  const base={ id:document.id,revision:document.revision,section:reference?'field':selector.section,
    activeTokenModeId:document.activeTokenModeId ?? null,inspectedTokenModeId:inspected.activeTokenModeId ?? null,budget_bytes:budget }
  const nodeIndices=selectionSection(selector.section) && selector.ids ?
    new Map(document.nodes.map((node,index)=>[node.id,index])) : undefined
  const referenceSelector=nodeIndices && selector.ids ? { ...selector,ids:selector.ids.map(id=>nodeIndices.get(id) ?? null) } : selector
  const ref=(row:Row,path:(string|number)[],start:number):string=>encode({ v:1,source,selector:referenceSelector,
    offset:start,key:row.key,path,...(nodeIndices?{ selectionDigest:digest(JSON.stringify(selector.ids)) }:{}) })
  const summarize=(row:Row,start:number):unknown=>{
    if (typeof row.value!=='object' || row.value===null) return { record_ref:ref(row,[],start) }
    const result:Record<string,unknown>={}, field_refs:Record<string,string>={}, counts:Record<string,number>={}
    for (const [key,value] of Object.entries(row.value)) {
      if (value===undefined) continue
      if (typeof value==='string') {
        if (key==='imageUrl' || key==='url') { field_refs[key]=ref(row,[key],start);continue }
        result[key]=value.slice(0,200)
        if (value.length>200) { field_refs[key]=ref(row,[key],start);result[key+'_truncated']=true;result[key+'_length']=value.length }
      } else if (value!==null && typeof value==='object') {
        if (Array.isArray(value)) {
          counts[key]=value.length
          if (value.length<=20 && value.every(item=>typeof item!=='object' && (typeof item!=='string' || item.length<=200))) result[key]=value
          else field_refs[key]=ref(row,[key],start)
        } else {
          if (smallObject(value)) result[key]=value
          else field_refs[key]=ref(row,[key],start)
        }
      } else result[key]=value
    }
    if (Object.keys(counts).length) result.counts=counts
    if (Object.keys(field_refs).length) result.field_refs=field_refs
    result.record_ref=ref(row,[],start)
    return result
  }
  if (reference || selector.section==='css') {
    let value:unknown
    if (reference) {
      const found=rows(reference.offset,100).rows.find(row=>row.key===reference.key)
      if (!found) throw new Error('Inspection field record was not found')
      value=found.value
      for (const key of reference.path) {
        if (value===null || typeof value!=='object' || !Object.hasOwn(value,key) || ['__proto__','prototype',
          'constructor'].includes(String(key)))
          throw new Error('Inspection field path was not found')
        value=(value as Record<string|number,unknown>)[key]
      }
    } else value=rows(0,1).rows[0]?.value
    const serialized=Buffer.from(JSON.stringify(value),'utf8'), hash=digest(serialized.toString('utf8'))
    if (offset>serialized.length) throw new Error('Inspection chunk cursor exceeds field length')
    const chunkResult=(length:number):{ value:JsonValue;bytes:number }=>{
      let end=Math.min(serialized.length,offset+length)
      while(end>offset && end<serialized.length && ((serialized[end] ?? 0)&0xc0)===0x80) end--
      return measured({ ...base,encoding:'json-utf8-fragment',total_bytes:serialized.length,sha256:hash,
        chunk:serialized.subarray(offset,end).toString('utf8'),next_cursor:end<serialized.length?cursor(end):null,offset,
        returned:end-offset })
    }
    let low=0,high=serialized.length-offset
    while(low<high) {const middle=Math.ceil((low+high)/2);if(chunkResult(middle).bytes<=budget)low=middle;else high=middle-1}
    const result=chunkResult(low)
    if ((result.value as Record<string,JsonValue>).returned===0 && offset<serialized.length)
      throw new Error('Inspection chunk metadata exceeds its supported budget')
    return result.value
  }
  const page=rows(offset,limit),items:unknown[]=[]
  for (const row of page.rows) {
    let value=summarize(row,offset)
    if (measured({ ...base,total:page.total,returned:1,next_cursor:cursor(offset+1),items:[value] }).bytes>budget)
      value={ key:row.key,record_ref:ref(row,[],offset) }
    const next=page.next===null && items.length+1===page.rows.length?null:cursor(offset+items.length+1)
    if (measured({ ...base,total:page.total,returned:items.length+1,next_cursor:next,items:[...items,value],
      ...(page.rejected!==undefined?{ rejected:page.rejected,unsearched:page.unsearched }:{}) }).bytes>budget) break
    items.push(value)
  }
  if (!items.length && page.rows.length) throw new Error('Inspection record metadata exceeds its supported budget')
  // Candidate cursors count probes, while collection cursors count admitted records. Never discard safe probe results.
  if (page.rejected!==undefined && items.length<page.rows.length) {
    const smaller=inspectDesignPage(document,{ ...request,limit:Math.max(1,Math.floor(limit/2)) },authority)
    return smaller
  }
  const next=items.length<page.rows.length?offset+items.length:page.next
  let nextOffset=next
  for (;;) {
    const result=measured({ ...base,total:page.total<0?null:page.total,returned:items.length,
      next_cursor:nextOffset===null?null:cursor(nextOffset),items,
      ...(page.rejected!==undefined?{ rejected:page.rejected,unsearched:page.unsearched }:{}) })
    if (result.bytes<=budget) return result.value
    if (page.rejected!==undefined && limit>1) return inspectDesignPage(document,{ ...request,limit:Math.max(1,
      Math.floor(limit/2)) },authority)
    if (items.length<=1) throw new Error('Inspection record metadata exceeds its supported budget')
    items.pop()
    nextOffset=offset+items.length
  }
}
