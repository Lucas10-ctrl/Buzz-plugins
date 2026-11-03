/** Compact summary of the visual system one frame (or a whole page) uses, for reuse when composing new designs. */
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignPaint } from '../../copyos-domain/src/types.ts'

/** Entries kept per summary list; counts beyond it are reported as omitted. */
const LIST_LIMIT = { colors: 24, type: 20, spacing: 16, radii: 12, components: 30, samples: 3 } as const

interface Counted<T> { readonly value: T; count: number }

/** A shared resource a summary entry references. */
interface ResourceRef { id: string; name: string }

/** One summary list: entries ranked by use, with the count of entries left out. */
export interface DesignSystemList<T> { items: (T & { count: number })[]; omitted: number }

/** One distinct color with its color variable and the roles (fill, stroke, text) it plays. */
export interface DesignSystemColor { color: string; variable: ResourceRef | null; roles: string[] }

/** Visual system used inside one frame or page. */
export interface DesignSystemSummary {
  scope: { id: string; name: string; kind: string; width: number; height: number; layout: string }
    | { page_id: string | null; root_count: number }
  layer_count: number
  colors: DesignSystemList<DesignSystemColor>
  typography: DesignSystemList<TypeEntry>
  spacing: DesignSystemList<{ px: number; variable: ResourceRef | null }>
  corner_radii: DesignSystemList<{ px: number }>
  effects: DesignSystemList<{ style: ResourceRef | null; types: string[] }>
  components: DesignSystemList<{ id: string; name: string; defined: boolean }>
  auto_layout: { none: number; row: number; column: number; grid: number }
  notes: string[]
}

/** One distinct text treatment in scope. */
export interface TypeEntry {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  textCase: string
  textStyle: ResourceRef | null
  samples: string[]
}

function tally<T>(map: Map<string, Counted<T>>, key: string, value: T): void {
  const entry = map.get(key)
  if (entry) entry.count++
  else map.set(key, { value, count: 1 })
}

function ranked<T>(map: Map<string, Counted<T>>, limit: number, order?: (a: Counted<T>, b: Counted<T>) => number):
DesignSystemList<T> {
  const values = [...map.values()].sort(order ?? ((a, b) => b.count - a.count))
  const items = values.slice(0, limit).map(entry => ({ ...entry.value, count: entry.count }))
  return { items, omitted: Math.max(0, values.length - limit) }
}

function visiblePaints(node: CopyOSDesignNode, key: 'fills' | 'strokes'): readonly Pick<CopyOSDesignPaint, 'color' | 'variableId'>[] {
  const paints = node[key]
  if (paints) return paints.filter(paint => paint.visible && !paint.image && !paint.gradient)
  if (key === 'fills') return node.fill && node.fill !== 'transparent' ? [{ color: node.fill, variableId: node.fillVariableId }] : []
  return node.strokeWidth > 0 && node.stroke && node.stroke !== 'transparent' ? [{ color: node.stroke, variableId: node.strokeVariableId ?? null }] : []
}

/**
 * Summarize the colors, type scale, spacing, corner radii, effects and components used inside one root layer.
 * @param document - Saved design document.
 * @param nodes - Computed scene layers (stored layers with resolved layout and modes).
 * @param rootId - Frame, component or group to summarize; null summarizes every layer on the given page.
 * @param pageId - Page used when rootId is null; null selects the document's first page.
 * @returns JSON-compatible summary with counts; lists are ranked by use and report omitted entries.
 */
export function summarizeDesignSystem(document: CopyOSDesignDocument, nodes: readonly CopyOSDesignNode[], rootId: string | null,
  pageId: string | null = null): DesignSystemSummary {
  const children = new Map<string | null, CopyOSDesignNode[]>()
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const byId = new Map(nodes.map(node => [node.id, node]))
  const root = rootId === null ? undefined : byId.get(rootId)
  if (rootId !== null && !root) throw new Error('Design system root layer was not found')
  const page = pageId ?? document.pages?.[0]?.id ?? null
  const scoped: CopyOSDesignNode[] = []
  const roots = root ? [root] : (children.get(null) ?? []).filter(node => (node.pageId ?? document.pages?.[0]?.id ?? null) === page)
  const pending = [...roots]
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (!next.visible) continue
    scoped.push(next)
    pending.push(...(children.get(next.id) ?? []))
  }
  const variables = new Map(document.variables.map(variable => [variable.id, variable.name]))
  const numbers = new Map(document.numberVariables?.map(variable => [variable.id, variable.name]) ?? [])
  const textStyles = new Map(document.textStyles?.map(style => [style.id, style.name]) ?? [])
  const effectStyles = new Map(document.effectStyles?.map(style => [style.id, style.name]) ?? [])
  const colors = new Map<string, Counted<DesignSystemColor>>()
  const type = new Map<string, Counted<TypeEntry>>()
  const spacing = new Map<string, Counted<{ px: number; variable: { id: string; name: string } | null }>>()
  const radii = new Map<string, Counted<{ px: number }>>()
  const components = new Map<string, Counted<{ id: string; name: string; defined: boolean }>>()
  const effects = new Map<string, Counted<{ style: { id: string; name: string } | null; types: string[] }>>()
  const layouts = { none: 0, row: 0, column: 0, grid: 0 }
  const color = (paint: Pick<CopyOSDesignPaint, 'color' | 'variableId'>, role: string): void => {
    const variable = paint.variableId ? { id: paint.variableId, name: variables.get(paint.variableId) ?? paint.variableId } : null
    const key = `${paint.color.toLowerCase()}|${variable?.id ?? ''}`
    tally(colors, key, { color: paint.color, variable, roles: [] })
    const roles = colors.get(key)?.value.roles
    if (roles && !roles.includes(role)) roles.push(role)
  }
  const space = (px: number | undefined, property: string, node: CopyOSDesignNode): void => {
    if (px === undefined || px <= 0) return
    const bound = node.numericBindings?.[property as keyof NonNullable<CopyOSDesignNode['numericBindings']>]
    tally(spacing, `${String(px)}|${bound ?? ''}`, { px, variable: bound ? { id: bound, name: numbers.get(bound) ?? bound } : null })
  }
  for (const node of scoped) {
    for (const paint of visiblePaints(node, 'fills')) color(paint, node.kind === 'text' ? 'text' : 'fill')
    for (const paint of visiblePaints(node, 'strokes')) color(paint, 'stroke')
    if (node.kind === 'text') {
      const style = node.textStyleId ? { id: node.textStyleId, name: textStyles.get(node.textStyleId) ?? node.textStyleId } : null
      const key = [node.fontFamily, node.fontSize, node.fontWeight, node.lineHeight, node.letterSpacing ?? 0, node.textCase ?? 'none',
        style?.id ?? ''].join('|')
      tally(type, key, { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight, lineHeight: node.lineHeight,
        letterSpacing: node.letterSpacing ?? 0, textCase: node.textCase ?? 'none', textStyle: style, samples: [] })
      const samples = type.get(key)?.value.samples
      const sample = node.text.trim().replace(/\s+/g, ' ').slice(0, 60)
      if (samples && sample && samples.length < LIST_LIMIT.samples && !samples.includes(sample)) samples.push(sample)
    }
    if (node.layout !== 'none') {
      layouts[node.layout]++
      space(node.gap, 'gap', node)
      if (node.layout === 'grid' || node.layoutWrap === 'wrap') space(node.crossGap, 'crossGap', node)
      for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) space(node[side] ?? node.padding, side, node)
    } else layouts.none++
    for (const corner of [node.radius, node.radiusTopLeft, node.radiusTopRight, node.radiusBottomRight, node.radiusBottomLeft])
      if (corner !== undefined && corner > 0) { tally(radii, String(corner), { px: corner }); break }
    if (node.kind === 'instance' && node.componentId) {
      const main = document.nodes.find(value => value.id === node.componentId)
      tally(components, node.componentId, { id: node.componentId, name: main?.name ?? node.componentId, defined: false })
    }
    if (node.kind === 'component' || node.kind === 'component-set') {
      const entry = components.get(node.id)
      if (entry) entry.value.defined = true
      else components.set(node.id, { value: { id: node.id, name: node.name, defined: true }, count: 0 })
    }
    const visibleEffects = node.effects?.filter(effect => effect.visible) ?? []
    if (node.effectStyleId || visibleEffects.length) {
      const style = node.effectStyleId ? { id: node.effectStyleId, name: effectStyles.get(node.effectStyleId) ?? node.effectStyleId } : null
      const types = [...new Set(visibleEffects.map(effect => effect.type))].sort()
      tally(effects, `${style?.id ?? ''}|${types.join(',')}`, { style, types })
    }
  }
  return {
    scope: root ? { id: root.id, name: root.name, kind: root.kind, width: root.width, height: root.height, layout: root.layout }
      : { page_id: page, root_count: roots.length },
    layer_count: scoped.length,
    colors: ranked(colors, LIST_LIMIT.colors),
    typography: ranked(type, LIST_LIMIT.type, (a, b) => b.value.fontSize - a.value.fontSize || b.count - a.count),
    spacing: ranked(spacing, LIST_LIMIT.spacing, (a, b) => a.value.px - b.value.px),
    corner_radii: ranked(radii, LIST_LIMIT.radii, (a, b) => a.value.px - b.value.px),
    effects: ranked(effects, LIST_LIMIT.colors),
    components: ranked(components, LIST_LIMIT.components),
    auto_layout: layouts,
    notes: [
      'Counts are visible stored layers in scope; linked instance contents count once, as their main component.',
      'Reuse listed variables, text styles and components by id; literal values without a variable are not shared tokens.',
    ],
  }
}
