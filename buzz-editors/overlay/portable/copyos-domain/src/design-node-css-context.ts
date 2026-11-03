/** Raw contextual CSS inputs retain references while the shared scene supplies displayed geometry. */
import { createDesignRenderScene, createDesignInstanceContextReader, designDescendants } from './design-model.ts'
import { applyDesignComponentDefaults, applyDesignComponentInstance } from './design-component-properties.ts'
import { applyDesignInstanceLayout } from './design-instance-layout.ts'
import { applyDesignInstanceGrid } from './design-instance-grid.ts'
import { applyDesignInstanceStroke } from './design-stroke.ts'
import { resolveDesignDescendantLayout } from './design-descendant-layout.ts'
import { DESIGN_INSTANCE_SIZING_KEYS, designInstanceSizingOwns } from './design-instance-sizing.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignNumberVariables } from './design-token-values.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

interface NodeCssContext {
  raw: CopyOSDesignNode
  node: CopyOSDesignNode
  placementNode: CopyOSDesignNode
  parentRaw: CopyOSDesignNode | undefined
  parent: CopyOSDesignNode | undefined
  children: CopyOSDesignNode[]
  siblingsRaw: CopyOSDesignNode[]
  context: ReturnType<typeof createDesignRenderScene>['root']
  parentContext: ReturnType<typeof createDesignRenderScene>['root']
  numbers: ReadonlyMap<string, number>
  modeId: string | null
  overridePath: string[] | undefined
  naturalSize: () => { width: number; height: number }
}
const cache = new WeakMap<CopyOSDesignDocument, {
  scene: ReturnType<typeof createDesignRenderScene>
  byId: Map<string, CopyOSDesignNode>
  defaults: Map<string, CopyOSDesignNode>
  unconstrained: Map<string, CopyOSDesignDocument>
}>()
/** Read one contextual raw/resolved CSS target using a scene shared by immutable document identity.
 * @param document - Authored scene; callers replace its identity after edits.
 * @param id - Stored owner identity.
 * @param path - Optional linked descendant route.
 * @returns Raw token-bearing fields and displayed parent/child geometry in the same mode.
 */
export function nodeCssContext(document: CopyOSDesignDocument, id: string, path: readonly string[]): NodeCssContext {
  let shared = cache.get(document)
  if (!shared) {
    shared = { scene: createDesignRenderScene(document), byId: new Map(document.nodes.map(node => [node.id, node])),
      defaults: new Map(applyDesignComponentDefaults(document.nodes).map(node => [node.id, node])), unconstrained: new Map() }
    cache.set(document, shared)
  }
  const { scene, byId, defaults: rootRaw } = shared
  const current = path.length ? createDesignInstanceContextReader(document, scene)(id, path) : undefined
  if (path.length && !current) throw new Error('CSS instance target not found')
  const palette = (mode: string | null) => new Map(resolveDesignNumberVariables(designModeResources(document, mode).numberVariables)
    .map(value => [value.id, value.value]))
  const effectiveRoot = (source: CopyOSDesignNode, owner: CopyOSDesignNode, mode: string | null): CopyOSDesignNode => {
    const root = applyDesignInstanceLayout(source, owner, palette(mode))
    const result = { ...applyDesignInstanceGrid(applyDesignInstanceStroke(root, owner), owner),
      ...Object.fromEntries(['x', 'y', 'rotation', 'flipX', 'flipY', 'opacity', 'visible', 'absolutePosition', 'constraints', 'gridCell']
        .map(key => [key, owner[key as keyof CopyOSDesignNode]])), blendMode: owner.blendMode ?? source.blendMode,
      targetAspectRatio: owner.targetAspectRatio === undefined ? source.targetAspectRatio : owner.targetAspectRatio }
    const bindings = { ...result.numericBindings }
    for (const key of DESIGN_INSTANCE_SIZING_KEYS) {
      const selected = designInstanceSizingOwns(owner, key) ? owner : source
      Object.assign(result, { [key]: selected[key] })
      Reflect.deleteProperty(bindings, key)
      if (key !== 'widthSizing' && key !== 'heightSizing' && selected.numericBindings?.[key]) bindings[key] = selected.numericBindings[key]
    }
    result.numericBindings = bindings
    if (owner.preserveLayout === false && (['width', 'height'] as const).some(axis =>
      owner[`${axis}Sizing`] === 'hug' && designInstanceSizingOwns(owner, `${axis}Sizing`))) result.preserveLayout = false
    return result
  }
  const prepare = (owner: CopyOSDesignNode, mode: string | null) => {
    const source = byId.get(owner.componentId ?? '')
    if (!source) throw new Error('CSS main component not found')
    const ids = designDescendants(document.nodes, source.id); ids.add(source.id)
    return applyDesignComponentInstance(document.nodes.filter(node => ids.has(node.id)), source, owner, document.nodes)
      .map(node => node.id === source.id ? effectiveRoot(node, owner, mode) : node)
  }
  let context = scene.root, raw = rootRaw.get(id), node = context.byId.get(id)
  let siblingsRaw = defaultsForParent(raw?.parentId ?? null)
  function defaultsForParent(parentId: string | null) { return [...rootRaw.values()].filter(item => item.parentId === parentId) }
  let parentRaw = raw ? rootRaw.get(raw.parentId ?? '') : undefined
  let parent = node ? context.byId.get(node.parentId ?? '') : undefined
  if (!raw || !node) throw new Error('CSS layer not found')
  for (const target of current?.effectivePath ?? []) {
    const linked = scene.instance(node, context)
    if (!linked) throw new Error('CSS instance context not found')
    const mode = context.modes.get(node.id) ?? null, template = prepare(raw, mode), map = new Map(template.map(item => [item.id, item]))
    context = linked
    node = context.byId.get(target)
    const selected = map.get(target)
    if (!node || !selected) throw new Error('CSS descendant not found')
    raw = resolveDesignDescendantLayout(selected, palette(context.modes.get(node.id) ?? null))
    parentRaw = map.get(raw.parentId ?? '')
    if (parentRaw) parentRaw = resolveDesignDescendantLayout(parentRaw, palette(context.modes.get(parentRaw.id) ?? null))
    parent = context.byId.get(node.parentId ?? '')
    siblingsRaw = template.filter(item => item.parentId === node?.parentId)
  }
  const placementNode = node, parentContext = context
  const modeId = context.modes.get(node.id) ?? null
  if (raw.kind === 'instance') {
    const linked = scene.instance(node, context), template = prepare(raw, modeId)
    const componentId = raw.componentId
    const root = template.find(item => item.id === componentId), displayed = linked?.byId.get(componentId ?? '')
    if (!root || !displayed || !linked) throw new Error('CSS main context not found')
    raw = root
    node = { ...displayed, ...Object.fromEntries(['x', 'y', 'width', 'height', 'widthSizing', 'heightSizing',
      'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'opacity', 'rotation', 'flipX', 'flipY', 'absolutePosition', 'gridCell']
      .map(key => [key, placementNode[key as keyof CopyOSDesignNode]])) }
    context = linked
  }
  const styleId = raw.textStyleId
  const style = document.textStyles?.find(value => value.id === styleId)
  if (style) raw = { ...raw, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
    fontFeatures: raw.fontFeatures ?? style.fontFeatures, fontVariations: raw.fontVariations ?? style.fontVariations,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing, fontStyle: style.fontStyle }
  const children = context.children.get(node.id) ?? []
  return { raw, node, placementNode, parentRaw, parent, children, siblingsRaw, context, parentContext, numbers: palette(modeId), modeId,
    overridePath: current?.overridePath,
    naturalSize: () => {
      let basis = shared.unconstrained.get(placementNode.id)
      if (!basis) {
        basis = { ...document, nodes: document.nodes.map(item =>
          item.id === placementNode.id ? { ...item, constraints: undefined } : item) }
        shared.unconstrained.set(placementNode.id, basis)
      }
      const natural = nodeCssContext(basis, id, path).placementNode
      return { width: natural.width, height: natural.height }
    } }
}
