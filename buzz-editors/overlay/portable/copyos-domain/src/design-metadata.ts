/**
 * Layer inspection shaped like Figma's `get_metadata`: an XML outline of a design, page or subtree with each layer's id, Figma
 * type, name and displayed geometry (parent-relative, after auto layout and text measurement), plus what an agent checks most:
 * rotation, visibility, opacity, text and its font, masks, effects and fills in short form.
 */
import { resolveDesignNodes } from './design-model.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

const TYPES: Record<string, string> = { frame: 'frame', group: 'group', rectangle: 'rectangle', ellipse: 'ellipse', text: 'text', image: 'rectangle',
  component: 'component', 'component-set': 'component-set', instance: 'instance', path: 'vector', boolean: 'boolean-operation' }
const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const round = (value: number): string => String(Math.round(value * 100) / 100)

function paints(node: CopyOSDesignNode): string {
  const list = node.fills ?? (node.fillOpacity === 0 ? [] : [{ color: node.fill, opacity: node.fillOpacity ?? 1, visible: true }])
  return list.filter(paint => paint.visible !== false).map((paint) => {
    const value = paint as { image?: { scaleMode?: string }; gradient?: { type?: string }; color?: string; opacity?: number }
    if (value.image) return `image:${value.image.scaleMode ?? 'fill'}`
    if (value.gradient) return `${value.gradient.type ?? 'linear'}-gradient`
    return `${value.color ?? ''}${(value.opacity ?? 1) < 1 ? `@${round(value.opacity ?? 1)}` : ''}`
  }).join(' ')
}

/**
 * Describe a design's layers as XML.
 * @param document - Design.
 * @param options - `nodeId` limits the outline to one layer and its descendants; `depth` limits nesting (default 12).
 * @returns XML text, one element per layer.
 * @throws {Error} When nodeId is not a layer of the design.
 */
export function describeDesignMetadata(document: CopyOSDesignDocument, options: { nodeId?: string; depth?: number } = {}): string {
  const resolved = new Map(resolveDesignNodes(document).map(node => [node.id, node]))
  const children = new Map<string | null, CopyOSDesignNode[]>()
  for (const node of document.nodes) {
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  const maxDepth = options.depth ?? 12
  const lines: string[] = []
  const write = (node: CopyOSDesignNode, depth: number): void => {
    const shown = resolved.get(node.id) ?? node
    const attributes: [string, string][] = [['id', node.id], ['name', node.name], ['x', round(shown.x)], ['y', round(shown.y)],
      ['width', round(shown.width)], ['height', round(shown.height)]]
    if (node.rotation) attributes.push(['rotation', round(-node.rotation)])
    if (!node.visible) attributes.push(['visible', 'false'])
    if (node.opacity !== undefined && node.opacity < 1) attributes.push(['opacity', round(node.opacity)])
    const fill = node.kind === 'text' ? '' : paints(node)
    if (fill) attributes.push(['fills', fill])
    if ((node as { mask?: boolean }).mask) attributes.push(['isMask', 'true'])
    if (node.clip) attributes.push(['clipsContent', 'true'])
    if (node.layout && node.layout !== 'none') attributes.push(['layoutMode', node.layout === 'row' ? 'HORIZONTAL' : node.layout === 'column' ? 'VERTICAL' : 'GRID'])
    if (node.absolutePosition) attributes.push(['layoutPositioning', 'ABSOLUTE'])
    const effects = (node.effects ?? []).filter(effect => effect.visible).map(effect => effect.type)
    if (effects.length) attributes.push(['effects', effects.join(' ')])
    if (node.blendMode && node.blendMode !== 'pass-through' && node.blendMode !== 'normal') attributes.push(['blendMode', node.blendMode])
    if (node.kind === 'instance' && node.componentId) attributes.push(['mainComponent', node.componentId])
    if (node.kind === 'text') {
      attributes.push(['font', `${node.fontFamily.replace(/["']/g, '')} ${String(node.fontWeight)}${node.fontStyle === 'italic' ? ' italic' : ''} ${round(node.fontSize)}`])
      attributes.push(['text', node.text.length > 120 ? `${node.text.slice(0, 117)}…` : node.text])
    }
    const tag = TYPES[node.kind] ?? 'frame'
    const indent = '  '.repeat(depth)
    const open = `${indent}<${tag} ${attributes.map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}`
    const kids = depth < maxDepth ? children.get(node.id) ?? [] : []
    if (!kids.length) { lines.push(`${open} />`); return }
    lines.push(`${open}>`)
    for (const child of kids) write(child, depth + 1)
    lines.push(`${indent}</${tag}>`)
  }
  if (options.nodeId) {
    const node = document.nodes.find(item => item.id === options.nodeId)
    if (!node) throw new Error(`No layer ${options.nodeId} in this design`)
    write(node, 0)
  } else {
    lines.push(`<design id="${escape(document.id)}" title="${escape(document.title)}">`)
    for (const node of children.get(null) ?? []) write(node, 1)
    lines.push('</design>')
  }
  return lines.join('\n')
}
