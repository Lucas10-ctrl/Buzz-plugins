/** Shared browser/host Mermaid rendering from saved source, without DOM or external resources. */
import { parseMermaid, renderMermaidSVG } from 'beautiful-mermaid'

const colors: Readonly<Record<string, string>> = {
  bg: '#ffffff', fg: '#262626', _text: '#262626', '_text-sec': '#626262', '_text-muted': '#626262',
  '_text-faint': '#a0a0a0', _line: '#737373', _arrow: '#404040', '_node-fill': '#f7f7f7',
  '_node-stroke': '#929292', '_group-fill': '#ffffff', '_group-hdr': '#f4f4f4', '_inner-stroke': '#dedede', '_key-badge': '#eeeeee',
}
/** Render supported Mermaid flow/state/sequence/class/ER/XY diagrams into an inert standalone SVG.
 * @param source - Saved Mermaid fence contents; bounded before layout.
 * @returns Resource-free SVG with literal label text and concrete colors for browser images and server rasterization.
 */
export function renderDocsDiagram(source: string): string {
  if (source.length > 20_000 || source.split(/[\n;]/u).length > 250)
    throw new Error('This diagram is too large. Split it into smaller diagrams.')
  const text = source.split('\n').filter(line => !line.trim().startsWith('%%')).join('\n').trim()
  const flowHeader = /^(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL)\b/u
  const otherHeader = /^(?:stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart(?:-beta)?)\b/u
  if (!flowHeader.test(text) && !otherHeader.test(text))
    throw new Error('Use a Mermaid flowchart, state, sequence, class, ER diagram or XY chart.')
  if (/^(?:graph|flowchart|stateDiagram)/u.test(text)) {
    // The renderer accepts an unfinished node label as a bare node; keep partial labels in source view instead.
    const delimiters: string[] = [], closing: Readonly<Record<string, string>> = { ']': '[', ')': '(', '}': '{' }
    let quoted = false
    for (let index = 0; index < text.length; index++) {
      const char = text[index]
      if (char === '\\') { index++; continue }
      if (char === '"') { quoted = !quoted; continue }
      if (quoted || !char) continue
      if ('[({'.includes(char)) delimiters.push(char)
      else if (closing[char] && delimiters.length && delimiters.pop() !== closing[char])
        throw new Error('Finish the diagram node label before previewing it.')
    }
    if (quoted || delimiters.length) throw new Error('Finish the diagram node label before previewing it.')
    const graph = parseMermaid(text)
    if (!graph.nodes.size) throw new Error('Add at least one diagram node.')
    if (graph.nodes.size > 200 || graph.edges.length > 300)
      throw new Error('This diagram is too large. Split it into smaller diagrams.')
  }
  const rendered = renderMermaidSVG(text, { font: 'Arial', bg: '#ffffff', fg: '#262626',
    muted: '#626262', line: '#737373', accent: '#404040', surface: '#f7f7f7', border: '#929292', interactive: false })
  const palette = { ...colors }
  for (const style of rendered.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    for (const match of (style[1] ?? '').matchAll(/--([\w-]+):\s*(#[a-f0-9]{3,8})\b/giu)) {
      if (match[1] && match[2]) palette[match[1]] = match[2]
    }
  }
  const svg = rendered.replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
    // The renderer escapes labels; inspect and resolve only markup, retaining literal resource-like prose.
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/gu, (tag: string) => {
      if (/<(?:script|foreignObject|image|iframe|object|use)\b/iu.test(tag))
        throw new Error('This diagram uses unsupported external resources or styles.')
      return tag.replace(/([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gu, (attribute: string, name: string) => {
        if (/^on|^(?:[\w-]+:)?(?:href|src)$/iu.test(name))
          throw new Error('This diagram uses unsupported external resources or styles.')
        if (/^(?:data-|aria-)/iu.test(name)) return attribute
        const resolved = attribute.replace(/var\(--([\w-]+)\)/gu, (match: string, color: string) => palette[color] ?? match)
        if (/url\(\s*['"]?(?!#)|var\(/iu.test(resolved))
          throw new Error('This diagram uses unsupported external resources or styles.')
        return resolved
      })
    })
    .replace('<svg ', '<svg font-family="Arial, sans-serif" ')
  const dimensions = /viewBox="0 0 ([\d.]+) ([\d.]+)"/u.exec(svg)
  const width = Number(dimensions?.[1]), height = Number(dimensions?.[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width * height > 40_000_000 || svg.length > 2_000_000)
    throw new Error('This diagram is too large to display. Split it into smaller diagrams.')
  return svg
}
