/**
 * run_canvas_script: an agent writes JavaScript against a Figma-Plugin-API-shaped `figma` global and the result is one validated Canvas
 * document. The API runs inside its own vm context (see canvas-script-api.source.js); only JSON strings cross into the host, so script
 * code never holds a host object. Text geometry read by the script (`text.height`, hug frames) comes from the same paragraph engine and
 * fonts that draw viewDesign and exportDesign.
 */
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { createDesignNode, detachDesignInstance, resolveDesignNodes } from '../../copyos-domain/src/design-model.ts'
import { measureDesignTextSync } from '../../copyos-domain/src/design-measure-text.ts'
import { createDesignTextMeasurer, designFontAutoLineHeight } from '../../copyos-domain/src/design-text-measurement.ts'
import { designDocumentFamilies, designFallbackFamilies, designUsesEmoji, designUsesSymbols } from '../../copyos-domain/src/design-agent-host.ts'
import { parseDesignDocument } from '../../copyos-domain/src/design-schema.ts'
import { importDesignSvg } from '../../copyos-domain/src/design-svg-import.ts'
import { designIconSvg, listDesignIcons, type DesignIconOptions } from '../../copyos-domain/src/design-icons.ts'
import type { DesignMeasurementFont, DesignTextMeasurer } from '../../copyos-domain/src/design-text-measurement-types.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignNodeKind } from '../../copyos-domain/src/types.ts'
import { CANVAS_SCRIPT_API_SOURCE } from './canvas-script-api.ts'

/** Host services a script may ask for; each is awaited outside the script context. */
export interface CanvasScriptHost {
  /** Faces the project can draw now: bundled faces plus installed project fonts, limited to `families` when given. */
  fonts(families?: readonly string[], options?: { emoji?: boolean; symbols?: boolean }): Promise<DesignMeasurementFont[]>
  /** Install a font family (Google Fonts) into the project; resolves when installed, rejects when unavailable. */
  installFont(family: string): Promise<void>
  /** Store a picture from a file path, http(s) URL or data: URL in the project; returns its Canvas reference and pixel size. */
  image(source: string): Promise<{ url: string; width: number; height: number }>
}

/** Outcome of one script run; nothing is saved here. */
export interface CanvasScriptResult {
  document: CopyOSDesignDocument
  /** JSON copy of the script's return value. */
  result: unknown
  created: string[]
  logs: string[]
  warnings: string[]
  /** Text layers the fonts could not measure; they keep their stored size. */
  unmeasured: { id: string; name: string; code: string; family?: string | undefined }[]
}

const KINDS: CopyOSDesignNodeKind[] = ['frame', 'group', 'rectangle', 'ellipse', 'text', 'image', 'component', 'component-set', 'instance', 'path', 'boolean']
const fontKey = (face: { family: string; weight: number; style: string }): string =>
  `${face.family.toLowerCase()}|${String(face.weight)}|${face.style}`

class Fonts {
  private measurer?: DesignTextMeasurer
  private faces: DesignMeasurementFont[] = []
  /** Families this run draws with: the design's own plus every family the script loads. Only these are registered, so a project
   * may hold any number of fonts. */
  readonly wanted = new Set<string>()
  /** Fallbacks this run needs: emoji and symbols found in the design or in the script's own source. */
  needs = { emoji: false, symbols: false }
  constructor(private readonly host: CanvasScriptHost) {}
  async load(): Promise<void> {
    this.faces = await this.host.fonts([...this.wanted], this.needs)
    this.measurer?.dispose()
    this.measurer = await createDesignTextMeasurer({ fonts: this.faces, fallbackFamilies: designFallbackFamilies(this.faces) })
  }
  keys(): string[] { return [...new Set(this.faces.map(fontKey))] }
  families(): string[] { return [...new Set(this.faces.map(face => face.family))] }
  get engine(): DesignTextMeasurer {
    if (!this.measurer) throw new Error('Fonts are not loaded')
    return this.measurer
  }
  dispose(): void { this.measurer?.dispose() }
  private readonly lineHeights = new Map<string, number>()
  /**
   * Figma's AUTO line height for a face: (ascender − descender + line gap) / units per em from the font's own metrics.
   * @param face - Family, weight and style.
   * @returns The multiplier, or 0 when the face is not loaded.
   */
  autoLineHeight(face: { family: string; weight: number; style: string }): number {
    const key = fontKey({ family: face.family, weight: face.weight, style: face.style === 'italic' ? 'italic' : 'normal' })
    const cached = this.lineHeights.get(key)
    if (cached !== undefined) return cached
    const same = this.faces.filter(item => item.family.toLowerCase() === face.family.toLowerCase())
    const found = same.find(item => item.weight === face.weight && item.style === face.style) ?? same[0]
    const value = found ? designFontAutoLineHeight(found.data) : 0
    this.lineHeights.set(key, value)
    return value
  }
}

/** Measure text, then read every node's displayed box (parent-relative) and the measurement fields that changed. */
function layout(document: CopyOSDesignDocument, measurer: DesignTextMeasurer): {
  document: CopyOSDesignDocument
  geometry: Record<string, { x: number; y: number; width: number; height: number }>
  metrics: Record<string, Partial<CopyOSDesignNode>>
  unmeasured: { id: string; code: string; family?: string | undefined }[]
} {
  const measured = measureDesignTextSync(document, measurer)
  const before = new Map(document.nodes.map(node => [node.id, node]))
  const metrics: Record<string, Partial<CopyOSDesignNode>> = {}
  for (const node of measured.document.nodes) {
    const old = before.get(node.id)
    if (!old) continue
    const fields: Partial<CopyOSDesignNode> = {}
    if (node.textLayoutMetrics !== old.textLayoutMetrics) fields.textLayoutMetrics = node.textLayoutMetrics
    if (node.textBaselineMetrics !== old.textBaselineMetrics) fields.textBaselineMetrics = node.textBaselineMetrics
    if (node.instanceOverrides !== old.instanceOverrides) fields.instanceOverrides = node.instanceOverrides
    if (Object.keys(fields).length) metrics[node.id] = fields
  }
  const geometry: Record<string, { x: number; y: number; width: number; height: number }> = {}
  for (const node of resolveDesignNodes(measured.document))
    if (before.has(node.id)) geometry[node.id] = { x: node.x, y: node.y, width: node.width, height: node.height }
  return { document: measured.document, geometry, metrics, unmeasured: measured.unmeasured }
}

/**
 * Say which layer and property made a design invalid, in plain words, instead of the validator's raw paths.
 * @param document - The document the script produced.
 * @param error - The validation error.
 * @returns Up to five distinct problems, each naming the layer, its type and the property.
 */
export function describeInvalidDesign(document: CopyOSDesignDocument, error: unknown): string {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] } | undefined)?.issues
  if (!Array.isArray(issues)) return error instanceof Error ? error.message : String(error)
  const lines = new Set<string>()
  for (const issue of issues) {
    const [collection, index, ...rest] = issue.path
    const node = collection === 'nodes' && typeof index === 'number' ? document.nodes[index] : undefined
    const where = node ? `layer "${node.name}" (${node.kind}${rest.length ? `, ${rest.join('.')}` : ''})` : issue.path.join('.') || 'the design'
    lines.add(`${where}: ${issue.message}`)
    if (lines.size >= 5) break
  }
  const more = issues.length > lines.size ? ` (and ${String(issues.length - lines.size)} more)` : ''
  return [...lines].join('; ') + more
}

/**
 * Run one script against a document.
 * @param document - Saved design the script edits.
 * @param code - Script body; top-level `await` and `return` are allowed, as in use_figma.
 * @param host - Fonts and pictures.
 * @param options - Time budget and the page treated as figma.currentPage.
 * @returns The validated, text-measured candidate and the script's output.
 * @throws {Error} With the script's own error message (and line) when it throws, times out or produces an invalid document.
 */
export async function runCanvasScript(document: CopyOSDesignDocument, code: string, host: CanvasScriptHost,
  options: { timeoutMs?: number; pageId?: string } = {}): Promise<CanvasScriptResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const fonts = new Fonts(host)
  for (const family of designDocumentFamilies(document)) fonts.wanted.add(family)
  // Text set by the script is only known as it runs, so its source is scanned too (literal characters and \u escapes).
  const unescaped = code.replace(/\\u\{([0-9a-f]+)\}/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})\\u([0-9a-f]{4})/gi, (_m, a: string, b: string) => String.fromCharCode(parseInt(a, 16), parseInt(b, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  const texts = [unescaped, ...document.nodes.flatMap(node => node.kind === 'text' ? [node.text] : [])].join('\n')
  fonts.needs = { emoji: designUsesEmoji(texts), symbols: designUsesSymbols(texts) }
  await fonts.load()
  const defaults = Object.fromEntries(KINDS.map(kind => [kind, createDesignNode(kind, 'id', kind)]))
  let finished: (value: string) => void = () => {}
  let failed: (error: Error) => void = () => {}
  const done = new Promise<string>((resolve, reject) => { finished = resolve; failed = reject })
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' })
  const run = (source: string): unknown => vm.runInContext(source, context, { timeout: timeoutMs, filename: 'canvas-script-host.js' })
  const answer = (work: () => unknown): string => {
    try { return JSON.stringify({ value: work() }) } catch (error: unknown) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  const resume = (id: number, json: string): void => {
    try { run(`__settle(${String(id)}, ${JSON.stringify(json)})`) } catch (error: unknown) {
      failed(new Error(`Script stopped: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
  context.__hostSync = (op: string, json: string): string => answer(() => {
    const value: unknown = JSON.parse(json)
    if (op === 'ids') return Array.from({ length: Math.min(1000, Number(value) || 64) }, () => randomUUID())
    if (op === 'layout') {
      const result = layout(value as CopyOSDesignDocument, fonts.engine)
      return { geometry: result.geometry, metrics: result.metrics, unmeasured: result.unmeasured }
    }
    if (op === 'svg') return importDesignSvg(String(value))
    if (op === 'icon') { const icon = value as { name: string; options: DesignIconOptions }; return designIconSvg(icon.name, icon.options) }
    if (op === 'icons') return listDesignIcons(String(value))
    if (op === 'lineHeight') return fonts.autoLineHeight(value as { family: string; weight: number; style: string })
    if (op === 'detach') {
      const input = value as { document: CopyOSDesignDocument; id: string }
      const before = new Set(input.document.nodes.map(node => node.id))
      const detached = detachDesignInstance(input.document, input.id, randomUUID)
      return { nodes: detached.nodes, created: detached.nodes.filter(node => !before.has(node.id)).map(node => node.id) }
    }
    throw new Error(`Unknown host operation ${op}`)
  })
  context.__hostAsync = (op: string, json: string, id: number): void => {
    void (async () => {
      const value = JSON.parse(json) as Record<string, string>
      if (op === 'font') {
        const family = value.family ?? ''
        if (!fonts.families().some(name => name.toLowerCase() === family.toLowerCase())) {
          fonts.wanted.add(family)
          await fonts.load()
          if (!fonts.families().some(name => name.toLowerCase() === family.toLowerCase())) {
            await host.installFont(family)
            await fonts.load()
          }
        }
        return { fonts: fonts.keys(), families: fonts.families() }
      }
      if (op === 'image') return await host.image(value.source ?? '')
      throw new Error(`Unknown host operation ${op}`)
    })().then(value => { resume(id, JSON.stringify({ value })) },
      (error: unknown) => { resume(id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) })
  }
  context.__done = (json: string): void => { finished(json) }
  context.__fail = (message: string): void => { failed(new Error(message)) }
  context.__input = JSON.stringify({ document, defaults, fonts: fonts.keys(), families: fonts.families(), pageId: options.pageId })
  const timer = setTimeout(() => { failed(new Error(`Script did not finish within ${String(timeoutMs / 1000)} s`)) }, timeoutMs)
  try {
    run(`(() => {
      const api = (${CANVAS_SCRIPT_API_SOURCE})(globalThis.__hostSync, globalThis.__hostAsync, globalThis.__input)
      const done = globalThis.__done, fail = globalThis.__fail
      for (const key of ['__hostSync', '__hostAsync', '__input', '__done', '__fail']) delete globalThis[key]
      globalThis.figma = api.figma
      globalThis.canvas = api.canvas
      globalThis.console = api.console
      Object.defineProperty(globalThis, '__settle', { value: api.settle })
      Object.defineProperty(globalThis, '__start', { value: (body) => body().then(
        value => { done(api.finish(value)) },
        error => { fail(error && error.stack ? String(error.stack).split('\\n').slice(0, 3).join('\\n') : String(error)) }) })
    })()`)
    try {
      vm.runInContext(`__start(async () => {\n${code}\n})`, context, { timeout: timeoutMs, filename: 'canvas-script.js', lineOffset: -1 })
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    const output = JSON.parse(await done) as { document: CopyOSDesignDocument; created: string[]; logs: string[]; warnings: string[]; result: unknown }
    let candidate: CopyOSDesignDocument
    try { candidate = parseDesignDocument(output.document) } catch (error: unknown) {
      throw new Error(`The script made an invalid design: ${describeInvalidDesign(output.document, error)}`)
    }
    const measured = layout(candidate, fonts.engine)
    const names = new Map(candidate.nodes.map(node => [node.id, node.name]))
    return {
      document: parseDesignDocument(measured.document), result: output.result, created: output.created, logs: output.logs.slice(0, 200),
      warnings: [...new Set(output.warnings)],
      unmeasured: measured.unmeasured.map(item => ({ ...item, name: names.get(item.id) ?? '' })),
    }
  } finally {
    clearTimeout(timer)
    fonts.dispose()
  }
}
