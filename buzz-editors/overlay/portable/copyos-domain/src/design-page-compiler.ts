/** Deterministic semantic Page Builder markup from one native artboard; the original scene remains independent. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { createDesignRenderScene, designNodeCss, designTextHtmlContent, designTextSegments,
  exportDesignCss, exportDesignSvg, designTextMeasurementStatus } from './design-model.ts'
import { COPYOS_PAGE_HTML_MAX_LENGTH } from './page-html-limits.ts'
import { parseDesignDocument } from './design-schema.ts'
import { nodeCssContext } from './design-node-css-context.ts'
import { designTokenCssNames } from './design-token-css-names.ts'
import { designStrokeStyle } from './design-stroke-style.ts'
import { designStrokeWeights } from './design-stroke.ts'
import { designNodeStrokePaints } from './design-stroke-paints.ts'
import { normalizePageElementIds, inspectPageElements } from './page-elements.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignSemanticCommand, CopyOSDesignTextHyperlink } from './types.ts'
import type { DesignRenderContext } from './design-model.ts'

/** One native layer's primary editable semantic element or isolated SVG artwork wrapper. */
export interface DesignPageElementMapping {
  nodeId: string
  instancePath: string[]
  elementId: string
  tagName: string
  kind: 'semantic' | 'artwork'
}
/** A retained native limitation or external resource requirement; messages never claim missing application behavior exists. */
export interface DesignPageCompilationWarning {
  code: string
  nodeId: string
  instancePath: string[]
  message: string
}
/** Bounded, deterministic section HTML and source mapping; fonts name requested families without installing them. */
export interface DesignPageCompilation {
  html: string
  width: number
  height: number
  mapping: DesignPageElementMapping[]
  warnings: DesignPageCompilationWarning[]
  fonts: string[]
}

const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const hash = (value: string): string => bytesToHex(sha256(new TextEncoder().encode(value)))
const elementIdentity = (nodeId: string, path: readonly string[]) => path.length ? `canvas-${hash(`${nodeId}:${path.join('/')}`)}` : nodeId
const graphicWarnings = new Set(['svg-paint', 'svg-stroke', 'svg-geometry', 'image-transform', 'layer-compositing'])
const plainMarkupWarnings = new Set(['font-availability', 'paragraph-spacing'])
const paintProperty = (key: string) => key === 'background' || key.startsWith('background-') || key.startsWith('border-') || key === 'box-shadow'

// Own outer shadows survive overflow:hidden while descendants remain clipped. Paired inside/outside spreads form the native
// centered border ring without inserting a wrapper that would change flex/grid participation or intrinsic Hug/Fill sizing.
function clippedContainerStroke(document: CopyOSDesignDocument, raw: CopyOSDesignNode, effective: CopyOSDesignNode): string | undefined {
  if (!['rectangle', 'frame', 'component', 'component-set', 'instance'].includes(effective.kind) || raw.strokeAlign === 'inside') return
  const style = designStrokeStyle(raw)
  if (style.dashes.length || style.join !== 'miter' || style.miterLimit < Math.SQRT2) return
  const paints = designNodeStrokePaints(raw).filter(paint => paint.visible && paint.opacity > 0), paint = paints[0]
  if (paints.length !== 1 || !paint || paint.gradient || paint.image || paint.blendMode && paint.blendMode !== 'normal') return
  const names = designTokenCssNames(document), weights = designStrokeWeights(effective)
  const widths = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => {
    const edge = `stroke${side}Width` as const, property = raw[edge] === undefined ? 'strokeWidth' : edge
    const token = raw.numericBindings?.[property]
    return token ? `var(${names.number.get(token)})` : `${Number(weights[side.toLowerCase() as keyof typeof weights].toFixed(6))}px`
  })
  const width = widths[0]
  if (!width || new Set(widths).size !== 1 || !Object.values(weights).some(value => value > 0)) return
  // CSS adjusts small shadow corner radii nonlinearly; leave those rings to the native SVG fidelity path.
  const radii = [effective.radiusTopLeft ?? effective.radius, effective.radiusTopRight ?? effective.radius,
    effective.radiusBottomRight ?? effective.radius, effective.radiusBottomLeft ?? effective.radius]
  const [tl = 0, tr = 0, br = 0, bl = 0] = radii
  const ratio = Math.min(1, effective.width / (tl + tr || 1), effective.width / (bl + br || 1),
    effective.height / (tl + bl || 1), effective.height / (tr + br || 1))
  const spread = weights.top * (raw.strokeAlign === 'outside' ? 1 : 0.5)
  if (radii.some(radius => radius > 0 && radius * ratio < spread)) return
  const value = paint.variableId ? `var(${names.color.get(paint.variableId)})` : paint.color
  const opacity = paint.opacity * (raw.strokeOpacity ?? 1)
  const color = opacity === 1 ? value : `color-mix(in srgb, ${value} ${Number((opacity * 100).toFixed(6))}%, transparent)`
  if (raw.strokeAlign === 'outside') return `0 0 0 ${width} ${color}`
  const half = width.startsWith('var(') ? `calc(${width} / 2)` : `${Number((Number.parseFloat(width) / 2).toFixed(6))}px`
  return `0 0 0 ${half} ${color}, inset 0 0 0 ${half} ${color}`
}


/**
 * Compile one visible top-level frame into editable HTML, scoped resources and native layer mappings without changing its scene.
 * @param input - Valid native document, including local component masters and resource libraries.
 * @param nodeId - Top-level unlinked frame identity. Canvas placement is excluded from the page coordinate origin.
 * @returns Deterministic HTML within Page Builder's 1000000-character, 4096-node and depth-128 limits; unsupported fidelity rejects.
 * @throws {Error} If the source, component context, graphics/text requirements or complete output exceeds supported semantics or budgets.
 */
export function compileDesignArtboard(input: CopyOSDesignDocument, nodeId: string): DesignPageCompilation {
  const document = parseDesignDocument(input), source = document.nodes.find(node => node.id === nodeId)
  const breakpointOf = source?.breakpoint && document.nodes.find(node => node.id === source.breakpoint?.sourceFrameId)
  if (breakpointOf) throw new Error(`'${source.name}' is a breakpoint of '${breakpointOf.name}'; build that artboard to include this layout`)
  const { declarations: _declarations, ...result } = compileFrame(document, nodeId, false)
  return result
}

/** Text element content before semantic link wrapping; `links` lists the node-link placeholders it contains and their targets. */
interface CompiledText {
  content: string
  links: { key: string; target: string }[]
}
/** One compiled frame plus final per-element declarations and text contents, which breakpoint diffs compare. */
interface CompiledFrame extends DesignPageCompilation {
  declarations: Map<string, Map<string, string>>
  texts: Map<string, CompiledText>
}
/** One visible breakpoint of the converted artboard, compiled for a viewport range above the previous breakpoint's maximum. */
interface CompiledBreakpoint {
  frame: CopyOSDesignNode
  /** Text variant key and media range identity, `max-<maxWidth>`. */
  range: string
  compiled: CompiledFrame
}
/** Breakpoint text that may replace one desktop text element in its range; links target desktop layer identities. */
interface TextAlternate extends CompiledText {
  range: string
  frameName: string
}

const linkKey = /__copyos_node_link_\d+__/g
// Node-link placeholders are numbered per compilation, so comparisons substitute their targets.
const comparableText = (text: CompiledText): string =>
  text.content.replace(linkKey, key => `#${text.links.find(link => link.key === key)?.target ?? ''}`)

// Closed dialogs and popovers are hidden by the browser, so hidden overlay layers compile as shown.
const overlay = (node: CopyOSDesignNode): boolean => node.semantics?.element === 'dialog' || !!node.semantics?.popover
const showOverlays = (document: CopyOSDesignDocument): CopyOSDesignDocument => document.nodes.some(node => !node.visible && overlay(node))
  ? { ...document, nodes: document.nodes.map(node => !node.visible && overlay(node) ? { ...node, visible: true } : node) } : document

function compileFrame(input: CopyOSDesignDocument, nodeId: string, breakpointMode: boolean): CompiledFrame {
  const document = showOverlays(input), source = document.nodes.find(node => node.id === nodeId)
  if (!source || source.kind !== 'frame' || source.parentId !== null || source.pageLink || !source.visible)
    throw new Error('Convert one visible, unlinked top-level native frame')
  const scene = createDesignRenderScene(document), frame = scene.root.byId.get(nodeId)
  if (!frame) throw new Error('Native artboard could not be resolved')
  const scope = `[data-canvas-conversion="${nodeId}"]`
  const mapping: DesignPageElementMapping[] = [], warnings: DesignPageCompilationWarning[] = [], fonts = new Set<string>()
  const rules: string[] = [], finalDeclarations = new Map<string, Map<string, string>>()
  const texts = new Map<string, CompiledText>(), textRanges = new Map<string, Map<string, string>>()
  const revealedIds = breakpointMode ? new Set<string>() : breakpointRevealedIds(document, nodeId)
  const breakpoints = breakpointMode ? [] : compileBreakpoints(document, nodeId)
  const alternates = textAlternates(document, nodeId, breakpoints)
  const pendingLinks: { key: string; nodeId: string; path: string[]; target: string }[] = []
  const pendingCommands: { key: string; nodeId: string; path: string[]; command: CopyOSDesignSemanticCommand; elementId: string }[] = []
  const popovers = new Map<string, { nodeId: string }>()
  const pendingLabels: { key: string; nodeId: string; path: string[]; target: string }[] = []
  // Field names of each enclosing form while its children compile; forms never nest.
  const forms: string[][] = []
  const warningKeys = new Set<string>()
  let emitted = 0, generated = 0
  const budget = (characters: number): void => {
    generated += characters
    if (generated > COPYOS_PAGE_HTML_MAX_LENGTH) throw new Error(`Compiled page exceeds ${COPYOS_PAGE_HTML_MAX_LENGTH} characters`)
  }
  const warn = (code: string, ownerId: string, path: readonly string[], message: string): void => {
    const key = `${code}:${ownerId}:${path.join('/')}:${message}`
    if (warningKeys.has(key)) return
    warningKeys.add(key); warnings.push({ code, nodeId: ownerId, instancePath: [...path], message })
    if (warnings.length > 1000) throw new Error('Conversion exceeds 1000 fidelity warnings')
  }
  function unsupported(node: CopyOSDesignNode, detail: string): never { throw new Error(`Cannot convert '${node.name}': ${detail}`) }
  const nativeSvg = (node: CopyOSDesignNode, elementId: string, modeId: string | null, background: boolean): string => {
    const art = { ...node, kind: node.kind === 'boolean' ? 'path' as const : background ? 'rectangle' as const : node.kind,
      parentId: null, pageId: undefined, pageLink: undefined, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, opacity: 1,
      widthSizing: 'fixed' as const, heightSizing: 'fixed' as const, numericBindings: undefined, booleanOperation: undefined,
      componentId: null, componentProperties: undefined, componentPropertyValues: undefined, instanceOverrides: undefined,
      instanceLayout: undefined, instanceStroke: undefined, instanceSizingOverrides: undefined,
      componentSet: undefined, variantValues: undefined,
      tokenModeId: modeId ?? 'base',
      ...(background ? { effects: [], shadow: undefined, effectStyleId: undefined, layout: 'none' as const } : {}) }
    let svg = exportDesignSvg({ ...document, activeTokenModeId: modeId, nodes: [art] })
    const box = svg.match(/viewBox="([\d.e+\- ]+)"/)?.[1]?.split(' ').map(Number)
    if (!box || box.length !== 4 || box.some(value => !Number.isFinite(value))) unsupported(node, 'isolated SVG bounds are unavailable')
    const [left = 0, top = 0, width = 0, height = 0] = box
    if (background && node.clip && (left < 0 || top < 0 || left + width > node.width || top + height > node.height))
      unsupported(node, 'clipped container artwork needs a separate overflow and child-clip wrapper')
    const prefix = `art-${elementId}-`
    svg = svg.replace(/\bid="([^"]+)"/g, (_all, id: string) => `id="${prefix}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (_all, id: string) => `url(#${prefix}${id})`)
      .replace(/href="#([^"]+)"/g, (_all, id: string) => `href="#${prefix}${id}"`)
    return svg.replace('<svg ', `<svg aria-hidden="true" style="position:absolute;left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px;overflow:visible;pointer-events:none" `)
  }
  const href = (target: CopyOSDesignTextHyperlink, ownerId: string, path: string[]): string => {
    if (target.type === 'URL') return ` href="${escape(target.value)}" target="_blank" rel="noopener noreferrer"`
    const key = `__copyos_node_link_${pendingLinks.length}__`
    pendingLinks.push({ key, nodeId: ownerId, path, target: target.value })
    return ` href="${key}"`
  }
  let mains = 0
  const emit = (node: CopyOSDesignNode, context: DesignRenderContext, ownerId: string, path: string[],
    trail: string[], depth: number, zIndex?: number, linked = false, parentTag = '', phrasingParent = false): string => {
    if (depth > 64) unsupported(node, 'conversion exceeds 64 native nesting levels')
    // Desktop-hidden layers shown by a breakpoint are emitted hidden and revealed only in that range.
    const revealed = !node.visible && !path.length && revealedIds.has(node.id)
    if (!node.visible && !revealed) {
      warn('hidden-layer', ownerId, path, 'Hidden native content stays in the preserved source scene and is not emitted.'); return ''
    }
    if (node.pageLink) unsupported(node, 'an existing Builder link cannot be converted as native content')
    if (++emitted > 1000) unsupported(node, 'conversion exceeds 1000 visible native layers')
    if (node.pathData && node.pathData.paths.reduce((sum, item) => sum + item.d.length, 0) > 200000 ||
      [node.imageUrl, ...(node.fills ?? []).map(paint => paint.image?.url ?? '')].some(url => url.length > 200000))
      unsupported(node, 'native artwork exceeds the page markup budget')
    const css = designNodeCss(document, { nodeId: ownerId, instancePath: path })
    const cssContext = nodeCssContext(document, ownerId, path), effective = cssContext.node
    let children = context.children.get(node.id) ?? [], childContext = context, childTrail = trail, inherited = node.semantics
    if (node.kind === 'instance') {
      const instance = scene.instance(node, context)
      if (!instance || !node.componentId || !instance.byId.has(node.componentId)) unsupported(node, 'the linked component main is unavailable')
      children = instance.children.get(node.componentId) ?? []; childContext = instance; childTrail = [...trail, node.id]
      inherited ??= instance.byId.get(node.componentId)?.semantics
      if (path.length === 0) childTrail = []
    }
    const hasChildren = node.kind !== 'boolean' && children.some(child => child.visible)
    const imagePaints = effective.fills?.filter(paint => paint.visible && paint.opacity > 0)
    const complexImage = node.kind === 'image' && imagePaints !== undefined &&
      (imagePaints.length !== 1 || !imagePaints[0]?.image)
    const projectedStroke = hasChildren && effective.clip && inherited?.element !== 'input' && inherited?.element !== 'textarea' &&
      !css.warnings.some(item => graphicWarnings.has(item.code) && item.code !== 'svg-stroke')
      ? clippedContainerStroke(document, cssContext.raw, effective) : undefined
    const graphic = complexImage || node.kind === 'path' || node.kind === 'boolean' ||
      css.warnings.some(item => graphicWarnings.has(item.code) && !(item.code === 'svg-stroke' && projectedStroke))
    if (node.kind === 'text' && graphic) unsupported(node, 'complex glyph paints or strokes need an editable HTML text compositor')
    if (hasChildren && graphic && css.warnings.some(item => item.property === 'filter' || item.code === 'layer-compositing'))
      unsupported(node, 'container compositing cannot be flattened without losing editable descendants')
    for (const item of css.warnings) {
      if (graphicWarnings.has(item.code) || plainMarkupWarnings.has(item.code) ||
        item.code === 'text-layout' && !item.message.includes('line-cap')) continue
      warn(item.code, ownerId, path, item.message)
    }
    const semantics = inherited, root = node.id === nodeId && !path.length
    const shown = children.filter(child => child.visible)
    if ((semantics?.element === 'ul' || semantics?.element === 'ol') && shown.some(child => child.semantics?.element !== 'li'))
      unsupported(node, 'every visible layer inside a list must be a list item')
    if (semantics?.element === 'details' && shown[0]?.semantics?.element !== 'summary')
      unsupported(node, 'a disclosure needs a visible summary as its first layer')
    if (semantics?.element === 'li' && parentTag !== 'ul' && parentTag !== 'ol') unsupported(node, 'list items require a parent list')
    if (semantics?.link && linked) unsupported(node, 'links cannot be placed inside links or buttons')
    if (semantics?.element === 'button' && linked) unsupported(node, 'buttons cannot be placed inside links or other buttons')
    if (semantics?.link && root) unsupported(node, 'the artboard root cannot be a link; link a child layer instead')
    if (node.kind === 'text' && (linked || semantics?.link) && designTextSegments(effective).some(segment => segment.style.hyperlink))
      unsupported(node, 'inline text links cannot be nested inside a layer link')
    const field = semantics?.element === 'input' || semantics?.element === 'textarea'
    if (semantics?.element === 'form' && forms.length) unsupported(node, 'forms cannot contain other forms')
    if (field && linked) unsupported(node, 'fields cannot be placed inside links or buttons')
    if (field && (shown.length > 1 || shown.some(child => child.kind !== 'text')))
      unsupported(node, 'a field may contain only one text layer, which becomes its placeholder')
    if (field && !semantics.field) unsupported(node, 'a field needs a submitted field name')
    if (field && graphic) unsupported(node, 'field paints and strokes must be expressible in CSS: solid or gradient fills and one inside stroke')
    if (semantics?.submit && !forms.length) unsupported(node, 'submit buttons must be inside a form')
    if (semantics?.element === 'main' && ++mains === 2)
      warn('duplicate-main', ownerId, path, 'A page should contain one main landmark; review the duplicated main elements.')
    const elementId = elementIdentity(ownerId, path), declarations = new Map(css.declarations.map(item => [item.property, item.value]))
    const artwork = graphic && !hasChildren
    if (graphic) {
      for (const property of [...declarations.keys()]) if (paintProperty(property) && (artwork || !property.startsWith('border-')) ||
        artwork && property === 'filter') declarations.delete(property)
      if (artwork) declarations.set('overflow', 'visible')
      else declarations.set('border-color', 'transparent')
    }
    if (projectedStroke) declarations.set('box-shadow', projectedStroke)
    if (artwork) declarations.delete('color')
    if (zIndex !== undefined) declarations.set('z-index', String(zIndex))
    // Inside headings, summaries, buttons and labels only phrasing content is valid, so unmarked layers become block spans.
    let tagName: string = semantics?.element ?? (root ? 'section' : phrasingParent ? 'span' : node.kind === 'text' ? 'p' : 'div')
    let content = '', semanticAttrs = ''
    const heading = /^h[1-6]$/.test(tagName)
    const phrasing = heading || tagName === 'summary' || tagName === 'button' || tagName === 'label' || tagName === 'span'
    const mode = node.id === nodeId && !path.length ? css.effectiveModeId ?? 'base' : node.tokenModeId
    if (node.kind === 'text') {
      if (effective.widthSizing === 'fill' && effective.textWrap !== false && effective.textSizing !== 'auto-width' &&
        effective.textSizing !== 'auto-height' && effective.heightSizing !== 'hug' &&
        css.requirements.some(item => item.code === 'parent-layout'))
        warn('fixed-height-reflow', ownerId, path,
          'Fill-width text retains its authored fixed height and can overlap or clip when resized; use auto/Hug height for reflowing content.')
      const measurement = designTextMeasurementStatus(effective)
      if (measurement?.state === 'missing' || measurement?.state === 'stale')
        warn('text-measurement', ownerId, path,
          'Native intrinsic metrics are missing or stale; the semantic page measures text with its supplied browser fonts.')
      fonts.add(effective.fontFamily)
      for (const segment of designTextSegments(effective)) fonts.add(segment.style.fontFamily)
      const paints = effective.fills?.filter(paint => paint.visible && paint.opacity > 0)
      if (paints && paints.length > 1) unsupported(node, 'multiple text paint stacks need an editable HTML compositor')
      if (effective.textTruncation === 'ending' && (!effective.maxLines || effective.paragraphSpacing))
        unsupported(node, 'uncapped or paragraph-spaced native ellipsis needs explicit HTML line semantics')
      const hyperlinkPattern = new RegExp(
        '<span data-copyos-hyperlink-type="(URL|NODE)" data-copyos-hyperlink-value="([^"]*)"' +
        /([^>]*)>([\s\S]*?)<\/span>/.source, 'g')
      const linkStart = pendingLinks.length
      content = designTextHtmlContent(effective).replace(hyperlinkPattern,
        (_all, type: string, value: string, attrs: string, text: string) => {
          if (type === 'URL') return `<a href="${value}" target="_blank" rel="noopener noreferrer"${attrs}>${text}</a>`
          const key = `__copyos_node_link_${pendingLinks.length}__`
          pendingLinks.push({ key, nodeId: ownerId, path, target: value })
          return `<a href="${key}"${attrs}>${text}</a>`
        })
      if (effective.paragraphSpacing || effective.verticalAlign && effective.verticalAlign !== 'top' || effective.textTruncation === 'ending') {
        if (tagName === 'p') tagName = 'div'
        if (effective.verticalAlign && effective.verticalAlign !== 'top') {
          declarations.set('display', 'flex'); declarations.set('flex-direction', 'column')
          declarations.set('justify-content', effective.verticalAlign === 'center' ? 'center' : 'flex-end')
        }
        const clamp = effective.textTruncation === 'ending' ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${effective.maxLines};overflow:hidden;` : ''
        content = `<div style="width:100%;min-height:0;flex-shrink:0;${clamp}">${content}</div>`
      }
      const own = { content, links: pendingLinks.slice(linkStart).map(link => ({ key: link.key, target: link.target })) }
      texts.set(elementId, own)
      const choices = alternates.get(elementId)
      if (choices) {
        // Each range whose text differs gets one hidden copy inside this element, so the element and its mapping stay single.
        const desktopText = comparableText(own), ranges = new Map<string, string>()
        const variants: { key: string; text: string; content: string }[] = []
        for (const choice of choices) {
          const text = comparableText(choice)
          if (text === desktopText) continue
          let variant = variants.find(item => item.text === text)
          if (!variant) {
            const relinked = choice.content.replace(linkKey, (key) => {
              const next = `__copyos_node_link_${pendingLinks.length}__`
              pendingLinks.push({ key: next, nodeId: ownerId, path, target: choice.links.find(link => link.key === key)?.target ?? '' })
              return next
            })
            variant = { key: choice.range, text, content: relinked }; variants.push(variant)
          }
          ranges.set(choice.range, variant.key)
          warn('breakpoint-text-variant', ownerId, path, `Text in breakpoint '${choice.frameName}' differs from desktop; the page carries ` +
            'that copy for its range, and Builder text edits change only the copy shown at the editing width.')
        }
        if (variants.length) {
          const wrapper = phrasing || tagName === 'p' ? 'span' : 'div'
          content = [{ key: 'desktop', content }, ...variants].map(variant =>
            `<${wrapper} data-copyos-text-variant="${variant.key}">${variant.content}</${wrapper}>`).join('')
          textRanges.set(elementId, ranges)
        }
      }
      // Headings and paragraphs admit only phrasing content; native text spans never contain markup, so every div is a wrapper.
      if (phrasing || tagName === 'p') content = content.replaceAll('<div style="', '<span style="display:block;').replaceAll('</div>', '</span>')
      if (semantics?.link) content = `<a${href(semantics.link, ownerId, path)}${semantics.label?.trim()
        ? ` aria-label="${escape(semantics.label)}"` : ''}>${content}</a>`
      budget(content.length)
    } else if (artwork) { content = nativeSvg(effective, elementId, css.effectiveModeId, false); budget(content.length) }
    else {
      if (graphic) { content += nativeSvg(effective, elementId, css.effectiveModeId, true); budget(content.length) }
      const paint = effective.fills?.filter(item => item.visible && item.opacity > 0)
      const image = node.kind === 'image' ? paint?.find(item => item.image)?.image ??
        (effective.imageUrl ? { url: effective.imageUrl, scaleMode: 'fill' as const } : undefined) : undefined
      if (image) {
        for (const property of [...declarations.keys()]) if (property.startsWith('background-')) declarations.delete(property)
        declarations.set('object-fit', image.scaleMode === 'fit' ? 'contain' : image.scaleMode === 'stretch' ? 'fill' : 'cover')
        tagName = 'img'
        content = ''
        declarations.set('display', 'block')
      }
      const nested = node.kind === 'instance' || path.length > 0
      if (field) {
        // The field's one text layer supplies its placeholder text and color, typography and inset; it is not emitted as its own element.
        const placeholder = shown[0]
        if (placeholder) {
          const childOwner = nested ? ownerId : placeholder.id, childPath = nested ? [...childTrail, placeholder.id] : []
          const text = designNodeCss(document, { nodeId: childOwner, instancePath: childPath })
          const typed = new Map(text.declarations.map(item => [item.property, item.value]))
          for (const [property, value] of typed)
            if (/^(?:font|letter-spacing|line-height|text-align|text-transform)/.test(property)) declarations.set(property, value)
          if (typed.get('position') === 'absolute') {
            const left = typed.get('left'), top = typed.get('top')
            if (left && !declarations.has('padding-left')) declarations.set('padding-left', left)
            if (top && tagName === 'textarea' && !declarations.has('padding-top')) declarations.set('padding-top', top)
          }
          const value = nodeCssContext(document, childOwner, childPath).node.text
          if (value) semanticAttrs += ` placeholder="${escape(value)}"`
          const color = typed.get('color')
          if (color) {
            const rule = `${scope} [data-copyos-block-id="${elementId}"]::placeholder{color:${color};opacity:1;}`
            budget(rule.length); rules.push(rule)
          }
        }
      } else if (node.kind !== 'boolean') {
        if (tagName === 'form') forms.push([])
        content += children.map((child, index) => {
          const childOwner = nested ? ownerId : child.id, childPath = nested ? [...childTrail, child.id] : []
          return emit(child, childContext, childOwner, childPath, childTrail, depth + 1,
            effective.itemReverseZIndex ? children.length - index : undefined, linked || !!semantics?.link || tagName === 'button', tagName,
            phrasingParent || phrasing)
        }).join('')
        if (tagName === 'form') {
          const names = forms.pop() ?? []
          warn('form-handoff', ownerId, path, names.length
            ? `This form has no submission destination; connect it at development handoff. Submitted fields: ${names.join(', ')}.`
            : 'This form has no submission destination and no fields; connect it at development handoff.')
          if (new Set(names).size !== names.length)
            warn('form-field-names', ownerId, path, 'Two or more fields in this form share a submitted name.')
        }
      }
      if (image) {
        const alt = semantics?.label ?? node.name
        content = ` src="${escape(image.url)}" alt="${escape(alt)}"`; budget(content.length)
        if (semantics?.label === undefined)
          warn('image-alt', ownerId, path, 'Image alt text uses the native layer name and needs a descriptive accessibility review.')
        if (semantics?.link) {
          const fit = declarations.get('object-fit') ?? 'cover'
          declarations.delete('object-fit'); tagName = 'a'; semanticAttrs = href(semantics.link, ownerId, path)
          content = `<img${content} style="display:block;width:100%;height:100%;object-fit:${fit}">`
        }
      }
    }
    if (node.kind !== 'text' && node.kind !== 'image' && semantics?.link) {
      tagName = 'a'; semanticAttrs = href(semantics.link, ownerId, path)
      if (!declarations.has('display')) declarations.set('display', 'block')
    }
    if (semantics?.label?.trim() && node.kind !== 'image' && (tagName === 'a' || !heading && semantics.element))
      semanticAttrs += ` aria-label="${escape(semantics.label)}"`
    if (tagName === 'details' && semantics?.open) semanticAttrs += ' open'
    if (tagName === 'details' && semantics?.group) semanticAttrs += ` name="${escape(semantics.group)}"`
    if (field && semantics.field) {
      const submitted = semantics.field
      semanticAttrs = ` name="${escape(submitted.name)}"${tagName === 'input' ? ` type="${submitted.type ?? 'text'}"` : ''}` +
        `${submitted.required ? ' required' : ''}${semanticAttrs}`
      forms.at(-1)?.push(submitted.name)
      if (!semantics.label?.trim() && !document.nodes.some(item => item.semantics?.labelFor === node.id))
        warn('field-label', ownerId, path, 'This field has no visible label or accessible name; add a label layer or a field name for assistive technology.')
    }
    if (tagName === 'form') semanticAttrs = ` method="dialog" data-copyos-form-handoff="pending"${semanticAttrs}`
    if (tagName === 'label' && semantics?.labelFor !== undefined) {
      const key = `__copyos_node_label_${pendingLabels.length}__`
      pendingLabels.push({ key, nodeId: ownerId, path, target: semantics.labelFor })
      semanticAttrs += ` for="${key}"`
    }
    if (tagName === 'button' && semantics?.submit) semanticAttrs = ` type="submit"${semanticAttrs}`
    else if (tagName === 'button') {
      semanticAttrs = ` type="button"${semanticAttrs}`
      if (semantics?.command) {
        const key = `__copyos_node_command_${pendingCommands.length}__`
        pendingCommands.push({ key, nodeId: ownerId, path, command: semantics.command, elementId })
        semanticAttrs += ` commandfor="${key}" command="${semantics.command.type}"`
      } else warn('button-action', ownerId, path, 'This button has no native command; implement its behavior in Builder.')
    }
    const popover = !!semantics?.popover
    if (popover) { semanticAttrs += ' popover'; popovers.set(elementId, { nodeId: ownerId }) }
    if (tagName === 'dialog' || popover) {
      // The browser places open overlays in the top layer, outside the artboard flow and coordinates.
      if (declarations.get('position') !== 'absolute')
        unsupported(node, 'dialogs and popovers must be absolutely positioned so closing them keeps the page layout')
      for (const property of ['position', 'left', 'top', 'right', 'bottom']) declarations.delete(property)
      if (tagName === 'dialog') warn('dialog-placement', ownerId, path, 'The open dialog is centered in the viewport, not at its canvas position.')
    }
    if (graphic) warn('isolated-svg', ownerId, path, 'This layer uses isolated editable SVG artwork; paint values retain the compiled native mode snapshot.')
    if (node.id === nodeId && !path.length) {
      declarations.set('position', 'relative'); declarations.delete('left'); declarations.delete('top'); declarations.set('max-width', '100%')
      // A breakpoint artboard describes the full viewport width within its range.
      if (breakpointMode) declarations.set('width', '100%')
      warn('responsive-root', ownerId, path, 'The artboard width is capped to its containing page; authored child sizing and free-positioned geometry remain authoritative.')
    }
    if (tagName === 'span' && !declarations.has('display')) declarations.set('display', 'block')
    if (tagName !== 'dialog' && !popover) declarations.set('margin', '0')
    if (revealed) declarations.set('display', 'none')
    const selector = elementId === nodeId ? scope : `${scope} [data-copyos-block-id="${elementId}"]`
    const rule = `${selector}{${[...declarations].map(([property, value]) => `${property}:${value};`).join('')}}`
    budget(rule.length); rules.push(rule); finalDeclarations.set(elementId, new Map(declarations))
    mapping.push({ nodeId: ownerId, instancePath: [...path], elementId, tagName, kind: artwork ? 'artwork' : 'semantic' })
    const attrs = ` data-copyos-block-id="${elementId}" id="copyos-element-${elementId}"${mode ? ` data-copyos-mode="${mode}"` : ''}`
    budget(attrs.length + semanticAttrs.length + tagName.length * 2 + 5 + (elementId === nodeId ? nodeId.length + 26 : 0))
    if (tagName === 'img') return `<img${attrs}${content}>`
    if (tagName === 'input') return `<input${attrs}${semanticAttrs}>`
    return `<${tagName}${attrs}${semanticAttrs}${elementId === nodeId ? ` data-canvas-conversion="${nodeId}"` : ''}>${content}</${tagName}>`
  }
  let markup = emit(frame, scene.root, frame.id, [], [], 0)
  const anchors: string[] = []
  for (const command of pendingCommands) {
    const target = mapping.find(item => item.nodeId === command.command.target && item.instancePath.length === 0)
    if (!target) {
      markup = markup.replace(` commandfor="${command.key}" command="${command.command.type}"`, ' disabled')
      warn('unresolved-command', command.nodeId, command.path, 'The button command targets a layer outside the converted artboard; the button is disabled.')
      continue
    }
    const wanted = command.command.type === 'toggle-popover' ? popovers.has(target.elementId) : target.tagName === 'dialog'
    if (!wanted) throw new Error(`Cannot convert button command: '${command.command.type}' needs a ${command.command.type === 'toggle-popover'
      ? 'popover' : 'dialog'} target`)
    markup = markup.replace(`commandfor="${command.key}"`, `commandfor="copyos-element-${target.elementId}"`)
    const anchored = popovers.get(target.elementId)
    if (command.command.type === 'toggle-popover' && anchored && !anchors.some(rule => rule.includes(`--copyos-anchor-${target.elementId}`))) {
      // The first trigger anchors the popover at its authored offset; browsers without anchor positioning center it.
      const offset = (id: string, from: string): { x: number; y: number } => {
        let current = scene.root.byId.get(id), x = 0, y = 0
        for (let depth = 0; current && current.id !== from && depth < 10000; depth++) {
          x += current.x; y += current.y; current = current.parentId ? scene.root.byId.get(current.parentId) : undefined
        }
        return { x, y }
      }
      const popover = offset(anchored.nodeId, nodeId), trigger = offset(command.nodeId, nodeId), name = `--copyos-anchor-${target.elementId}`
      const select = (id: string) => `${scope} [data-copyos-block-id="${id}"]`
      anchors.push(`${select(command.elementId)}{anchor-name:${name};}` +
        `${select(target.elementId)}{position:fixed;position-anchor:${name};inset:auto;margin:0;` +
        `left:calc(anchor(left) + ${popover.x - trigger.x}px);top:calc(anchor(top) + ${popover.y - trigger.y}px);}`)
    }
  }
  for (const label of pendingLabels) {
    const target = mapping.find(item => item.nodeId === label.target && item.instancePath.length === 0)
    if (target && (target.tagName === 'input' || target.tagName === 'textarea'))
      markup = markup.replace(`for="${label.key}"`, `for="copyos-element-${target.elementId}"`)
    else {
      markup = markup.replace(` for="${label.key}"`, '')
      warn('unresolved-label', label.nodeId, label.path, 'The label names a layer that is not a field in the converted artboard; it labels nothing.')
    }
  }
  for (const link of pendingLinks) {
    const target = mapping.find(item => item.nodeId === link.target && item.instancePath.length === 0)
    if (target) markup = markup.replace(`href="${link.key}"`, `href="#copyos-element-${target.elementId}"`)
    else {
      markup = markup.replace(`href="${link.key}"`, 'aria-disabled="true"')
      warn('unresolved-node-link', link.nodeId, link.path, 'The native text link points outside the converted artboard; no destination is invented.')
    }
  }
  const media = breakpointRules(document, nodeId, scope, breakpoints, finalDeclarations, mapping, textRanges, warn) +
    (anchors.length ? `\n@supports (position-anchor: --copyos){\n${anchors.join('\n')}\n}` : '')
  budget(media.length)
  const resources = exportDesignCss(document).replaceAll(':root', scope).replaceAll(', [data-copyos-mode=', `, ${scope} [data-copyos-mode=`)
  budget(resources.length)
  // Authored geometry draws any markers, so list and disclosure defaults are reset before element rules.
  const resets = `${scope} ul,${scope} ol{list-style:none;padding:0;}${scope} summary{list-style:none;cursor:pointer;}` +
    `${scope} summary::-webkit-details-marker{display:none;}` +
    `${scope} button{display:block;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:inherit;cursor:pointer;}` +
    `${scope} dialog,${scope} [popover]{padding:0;border:0;background:none;color:inherit;overflow:visible;max-width:none;max-height:none;}` +
    `${scope} input,${scope} textarea{display:block;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;resize:none;}` +
    // Element rules may set display; closed overlays stay hidden above them. Separate rules keep one unknown pseudo-class local.
    `${scope} dialog:not([open]){display:none;}${scope} [popover]:not(:popover-open){display:none;}` + (textRanges.size
    ? `${scope} [data-copyos-text-variant]{display:none;}${scope} [data-copyos-text-variant="desktop"]{display:contents;}` : '')
  const stylesheet = `${scope} *{box-sizing:border-box;}${scope} a{color:inherit;text-decoration:inherit;}${resets}\n${resources}\n${rules.join('\n')}${media}`
    .replaceAll('<', '\\3c ')
  const html = normalizePageElementIds(`<style>${stylesheet}</style>${markup}`, { namespace: `conversion:${document.id}:${nodeId}`, mode: 'read' })
  const emittedOrder = new Map(inspectPageElements(html).map((item, index) => [item.id, index]))
  mapping.sort((left, right) => (emittedOrder.get(left.elementId) ?? 0) - (emittedOrder.get(right.elementId) ?? 0))
  warn('native-behavior', nodeId, [], 'Native layers describe layout and content, not form submission, application state or backend actions; review and implement those behaviors in Builder.')
  if (fonts.size) warn('font-availability', nodeId, [], 'Requested font families must be supplied by the page runtime; conversion does not establish installed-font availability.')
  const result = { html, width: frame.width, height: frame.height, mapping, warnings, fonts: [...fonts].sort(),
    declarations: finalDeclarations, texts }
  if (JSON.stringify({ mapping, warnings, fonts: result.fonts }).length > 250000) throw new Error('Conversion metadata exceeds 250000 characters')
  return result
}

/** Desktop layers whose copy is visible in a visible breakpoint of this artboard, so the page can reveal them in that range. */
function breakpointRevealedIds(document: CopyOSDesignDocument, nodeId: string): Set<string> {
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  const frames = new Set(document.nodes.filter(frame => frame.parentId === null && frame.visible &&
    frame.breakpoint?.sourceFrameId === nodeId).map(frame => frame.id))
  const revealed = new Set<string>()
  if (!frames.size) return revealed
  for (const node of document.nodes) {
    if (!node.visible || !node.breakpointSourceId) continue
    let current = node
    for (let depth = 0; current.parentId && depth < 10000; depth++) current = byId.get(current.parentId) ?? current
    if (frames.has(current.id)) revealed.add(node.breakpointSourceId)
  }
  return revealed
}

/** Compile each visible breakpoint of an artboard, narrowest first, skipping ranges that do not widen the previous one. */
function compileBreakpoints(document: CopyOSDesignDocument, nodeId: string): CompiledBreakpoint[] {
  const frames = document.nodes.filter(node => node.breakpoint?.sourceFrameId === nodeId && node.parentId === null && node.visible)
    .sort((left, right) => (left.breakpoint?.maxWidth ?? 0) - (right.breakpoint?.maxWidth ?? 0))
  const result: CompiledBreakpoint[] = []
  let previous = 0
  for (const frame of frames) {
    const maxWidth = frame.breakpoint?.maxWidth ?? 0
    if (maxWidth <= previous) continue
    result.push({ frame, range: `max-${maxWidth}`, compiled: compileFrame(document, frame.id, true) })
    previous = maxWidth
  }
  return result
}

/** Desktop element identity a breakpoint element restyles, or undefined for a breakpoint-only layer. */
function desktopTarget(byId: ReadonlyMap<string, CopyOSDesignNode>, nodeId: string, breakpoint: CompiledBreakpoint,
  item: DesignPageElementMapping): string | undefined {
  const owner = item.nodeId === breakpoint.frame.id ? nodeId : byId.get(item.nodeId)?.breakpointSourceId
  return owner === undefined ? undefined : elementIdentity(owner, item.instancePath)
}

/** Breakpoint text contents keyed by the desktop element they would replace, with node links retargeted to desktop layers. */
function textAlternates(document: CopyOSDesignDocument, nodeId: string,
  breakpoints: readonly CompiledBreakpoint[]): Map<string, TextAlternate[]> {
  const result = new Map<string, TextAlternate[]>()
  if (!breakpoints.length) return result
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  for (const breakpoint of breakpoints) {
    const items = new Map(breakpoint.compiled.mapping.map(item => [item.elementId, item]))
    for (const [elementId, text] of breakpoint.compiled.texts) {
      const item = items.get(elementId), target = item && desktopTarget(byId, nodeId, breakpoint, item)
      if (!target) continue
      const links = text.links.map(link => ({ key: link.key, target: byId.get(link.target)?.breakpointSourceId ?? link.target }))
      result.set(target, [...result.get(target) ?? [], { ...text, links, range: breakpoint.range, frameName: breakpoint.frame.name }])
    }
  }
  return result
}

type Warn = (code: string, ownerId: string, path: readonly string[], message: string) => void
/**
 * Express each compiled breakpoint as range-scoped overrides of the desktop elements it restyles.
 * Structure comes from the desktop artboard; breakpoint-only layers are reported, not emitted, and text elements that carry
 * breakpoint copies show the copy selected for each range.
 */
function breakpointRules(document: CopyOSDesignDocument, nodeId: string, scope: string, breakpoints: readonly CompiledBreakpoint[],
  desktop: ReadonlyMap<string, ReadonlyMap<string, string>>, desktopMapping: readonly DesignPageElementMapping[],
  textRanges: ReadonlyMap<string, ReadonlyMap<string, string>>, warn: Warn): string {
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  const inside = (id: string, rootId: string): boolean => {
    let current = byId.get(id)
    for (let depth = 0; current?.parentId && depth < 10000; depth++) {
      if (current.parentId === rootId) return true
      current = byId.get(current.parentId)
    }
    return false
  }
  const desktopIds = new Set(desktopMapping.map(item => item.elementId))
  const selector = (id: string): string => id === nodeId ? scope : `${scope} [data-copyos-block-id="${id}"]`
  let css = '', previous = 0
  for (const breakpoint of breakpoints) {
    const { frame, compiled } = breakpoint, maxWidth = frame.breakpoint?.maxWidth ?? 0, seen = new Set<string>(), rules: string[] = []
    for (const item of compiled.mapping) {
      const target = desktopTarget(byId, nodeId, breakpoint, item)
      if (!target || !desktopIds.has(target)) {
        warn('breakpoint-only-layer', item.nodeId, item.instancePath,
          `Layer in breakpoint '${frame.name}' has no linked desktop layer; it is not emitted. Add it to the desktop artboard and hide it there.`)
        continue
      }
      seen.add(target)
      const base = desktop.get(target) ?? new Map<string, string>()
      const next = compiled.declarations.get(item.elementId) ?? new Map<string, string>()
      const changes = [...next].filter(([property, value]) => base.get(property) !== value).map(([property, value]) => `${property}:${value};`)
      // revert restores the user-agent default (block for div, list-item for li); unset would make display inline.
      for (const property of base.keys()) if (!next.has(property)) changes.push(`${property}:revert;`)
      if (changes.length) rules.push(`${selector(target)}{${changes.join('')}}`)
    }
    for (const id of desktopIds) if (!seen.has(id)) rules.push(`${scope} [data-copyos-block-id="${id}"]{display:none;}`)
    for (const [id, ranges] of textRanges) {
      const variant = ranges.get(breakpoint.range)
      if (variant) rules.push(`${selector(id)} [data-copyos-text-variant="desktop"]{display:none;}` +
        `${selector(id)} [data-copyos-text-variant="${variant}"]{display:contents;}`)
    }
    // Reordered stored children of flex and grid containers keep desktop markup and take CSS order in this range.
    for (const parent of document.nodes) {
      const source = parent.breakpointSourceId ?? (parent.id === frame.id ? nodeId : undefined)
      if (!source || !(parent.id === frame.id || inside(parent.id, frame.id)) || !['row', 'column', 'grid'].includes(parent.layout)) continue
      const mobileOrder = document.nodes.filter(child => child.parentId === parent.id && child.visible && child.breakpointSourceId)
        .map(child => child.breakpointSourceId ?? '')
      const desktopOrder = document.nodes.filter(child => child.parentId === source && mobileOrder.includes(child.id))
        .map(child => child.id)
      if (mobileOrder.every((id, index) => desktopOrder[index] === id)) continue
      mobileOrder.forEach((id, index) => { if (desktopIds.has(id)) rules.push(`${scope} [data-copyos-block-id="${id}"]{order:${index};}`) })
    }
    const range = previous ? `(min-width: ${previous + 1}px) and (max-width: ${maxWidth}px)` : `(max-width: ${maxWidth}px)`
    if (rules.length) css += `\n@media ${range}{\n${rules.join('\n')}\n}`
    previous = maxWidth
  }
  return css
}
