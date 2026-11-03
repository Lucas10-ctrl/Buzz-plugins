/** Explicit, atomic paragraph measurement over resolved native text contexts. */
import type { CopyOSDesignDocument, CopyOSDesignNode, CopyOSDesignTextMeasurementEngine } from './types.ts'
import type { DesignTextMeasurer, DesignTextMeasurementResult } from './design-text-measurement-types.ts'
import { createDesignRenderScene, type DesignRenderContext } from './design-model.ts'
import { createDesignInstanceContextLookup } from './design-instance-context.ts'
import { designTextLayoutSignature } from './design-text-layout.ts'
import { designTextBaselineSignature } from './design-baseline.ts'
import { designTextOverflow, designTextOverflowSignature } from './design-text-overflow.ts'
import { parseDesignDocument } from './design-schema.ts'

/** Caller-supplied transaction limits; selected roots include their rendered descendants. */
export interface DesignMeasureTextOptions {
  rootIds?: readonly string[]
  maxPasses: number
  maxJobs: number
  maxContexts: number
  signal?: AbortSignal
  /** Optional host event-loop yield before each actual engine call; cancellation is checked again afterward. */
  yieldControl?: () => Promise<void>
}
/** Completed staged document and bounded work accounting; no repository write occurs here. */
export interface DesignMeasureTextResult {
  document: CopyOSDesignDocument
  passes: number
  measured: number
  reused: number
  contexts: number
  skippedHidden: number
}
/** Expected measurement failures leave the caller's original document untouched. */
export class DesignMeasureTextError extends Error {
  constructor(readonly code: 'invalid-options' | 'invalid-selection' | 'unavailable' | 'budget' |
  'nonconvergent' | 'aborted' | 'invalid-result',
  message: string, readonly ownerId?: string, readonly path?: readonly string[], readonly reason?: string) {
    super(`${message}${ownerId ? `; owner ${ownerId}${path ? `; path ${JSON.stringify(path)}` : ''}` : ''}`)
    this.name = 'DesignMeasureTextError'
  }
}
type Measured = Extract<DesignTextMeasurementResult, { state: 'measured' }>
type Job = {
  ownerId: string
  path?: string[]
  node: CopyOSDesignNode
  stored: CopyOSDesignNode
  record?: NonNullable<CopyOSDesignNode['instanceOverrides']>[number]
}
const sameEngine = (a: CopyOSDesignTextMeasurementEngine | undefined, b: CopyOSDesignTextMeasurementEngine): boolean =>
  !!a && JSON.stringify(a) === JSON.stringify(b)
const keyFor = (job: Job): string => JSON.stringify([job.ownerId, job.path ?? null])
function cancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DesignMeasureTextError('aborted', 'Text measurement was cancelled')
}
function collect(document: CopyOSDesignDocument, options: DesignMeasureTextOptions): { jobs: Job[]; skippedHidden: number } {
  const scene = createDesignRenderScene(document), stored = new Map(document.nodes.map(node => [node.id, node])),
    lookup = createDesignInstanceContextLookup(document, scene), jobs: Job[] = []
  let skippedHidden = 0, visited = 0
  const selected = options.rootIds ? new Set(options.rootIds) : undefined
  if (selected && (selected.size !== options.rootIds?.length || !selected.size || selected.size > 500 ||
    [...selected].some(id => !stored.has(id))))
    throw new DesignMeasureTextError('invalid-selection', 'Select unique existing text measurement roots')
  const starts = selected ? [...selected].filter((id) => {
    let parent = stored.get(id)?.parentId
    while (parent) { if (selected.has(parent)) return false; parent = stored.get(parent)?.parentId }
    return true
  }).map(id => scene.root.byId.get(id)).filter((node): node is CopyOSDesignNode => !!node) : scene.root.children.get(null) ?? []
  const walk = (node: CopyOSDesignNode, context: DesignRenderContext, ownerId: string | undefined,
    prefix: string[], depth: number): void => {
    if (++visited > 100000 || depth > 64)
      throw new DesignMeasureTextError('budget', 'Text measurement traversal exceeds native scene limits')
    if (!node.visible) { skippedHidden++; return }
    if (node.kind === 'text') {
      if (jobs.length >= options.maxContexts) throw new DesignMeasureTextError('budget', 'Text measurement context budget exceeded')
      if (ownerId) {
        const effectivePath = [...prefix, node.id], target = lookup(ownerId, effectivePath)
        if (!target)
          throw new DesignMeasureTextError('invalid-result', 'Rendered text has no stable measurement owner', ownerId, effectivePath)
        jobs.push({ ownerId, path: target.overridePath, node, stored: target.stored, ...(target.record ? { record: target.record } : {}) })
      } else {
        const source = stored.get(node.id)
        if (!source) throw new DesignMeasureTextError('invalid-result', 'Stored text measurement owner is missing', node.id)
        jobs.push({ ownerId: node.id, node, stored: source })
      }
    }
    if (node.kind === 'instance') {
      const linked = scene.instance(node, context)
      if (!linked || !node.componentId)
        throw new DesignMeasureTextError('invalid-result', 'Linked text measurement context is unavailable', ownerId ?? node.id)
      for (const child of linked.children.get(node.componentId) ?? [])
        walk(child, linked, ownerId ?? node.id, ownerId ? [...prefix, node.id] : [], depth + 1)
    } else for (const child of context.children.get(node.id) ?? []) walk(child, context, ownerId, prefix, depth + 1)
  }
  for (const start of starts) {
    let ancestor = start.parentId, hidden = false
    while (ancestor) {
      const parent = scene.root.byId.get(ancestor)
      hidden ||= parent?.visible === false
      ancestor = parent?.parentId ?? null
    }
    if (hidden) skippedHidden++; else walk(start, scene.root, undefined, [], 0)
  }
  return { jobs, skippedHidden }
}
function ready(job: Job, engine: CopyOSDesignTextMeasurementEngine): boolean {
  const cache = job.record ?? job.stored, overflow = cache.textLayoutMetrics?.overflow
  if ((overflow && overflow.signature !== designTextOverflowSignature(job.node)) ||
    (designTextOverflow(job.node) && !overflow)) return false
  return cache.textLayoutMetrics?.signature === designTextLayoutSignature(job.node) && sameEngine(cache.textLayoutMetrics.engine, engine) &&
    !!cache.textBaselineMetrics?.some(metric => metric.signature === designTextBaselineSignature(job.node) &&
      sameEngine(metric.engine, engine))
}
function validResult(job: Job, result: Measured, engine: CopyOSDesignTextMeasurementEngine): void {
  const bounded = (n: number): boolean => Number.isFinite(n) && n >= 1 && n <= 100000
  if (result.layout.signature !== designTextLayoutSignature(job.node) ||
    result.baseline.signature !== designTextBaselineSignature(job.node) ||
    !bounded(result.layout.width) || !bounded(result.layout.height) || !Number.isFinite(result.baseline.baseline) ||
    result.baseline.baseline < 0 || result.baseline.baseline > 100000 || !sameEngine(result.layout.engine, engine) ||
    !sameEngine(result.baseline.engine, engine) ||
    (result.layout.overflow && (result.layout.overflow.signature !== designTextOverflowSignature(job.node) ||
      !bounded(result.layout.overflow.height) || !Number.isInteger(result.layout.overflow.lines) ||
      result.layout.overflow.lines < 1 || result.layout.overflow.lines > 200000)) ||
    (designTextOverflow(job.node) && !result.layout.overflow))
    throw new DesignMeasureTextError('invalid-result', 'Text measurer returned incompatible metrics', job.ownerId, job.path)
}
function stage(document: CopyOSDesignDocument, results: { job: Job; result: Measured }[]): CopyOSDesignDocument {
  const edits = new Map<string, CopyOSDesignNode>()
  for (const { job, result } of results) {
    const owner = edits.get(job.ownerId) ?? job.stored, previous = job.record ?? owner
    const baselines = [...previous.textBaselineMetrics ?? []], index = baselines.findIndex(metric =>
      metric.signature === result.baseline.signature && sameEngine(metric.engine, result.baseline.engine))
    if (index < 0) {
      if (baselines.length >= 32) throw new DesignMeasureTextError('budget', 'Text baseline cache budget exceeded', job.ownerId, job.path)
      baselines.push(result.baseline)
    } else baselines[index] = result.baseline
    const fields = { textLayoutMetrics: result.layout, textBaselineMetrics: baselines }
    if (job.path) {
      const records = owner.instanceOverrides ?? [], key = JSON.stringify(job.path),
        existing = records.findIndex(record => JSON.stringify(record.path) === key)
      if (existing < 0 && records.length >= 1000)
        throw new DesignMeasureTextError('budget', 'Instance measurement override budget exceeded', job.ownerId, job.path)
      const record = { ...job.record, path: job.path, ...fields }
      edits.set(owner.id, { ...owner, instanceOverrides: existing < 0 ? [...records, record] :
        records.map((value, i) => i === existing ? record : value) })
    } else edits.set(owner.id, { ...owner, ...fields })
  }
  return { ...document, nodes: document.nodes.map(node => edits.get(node.id) ?? node) }
}
/** Resolve, measure and reflow visible text until signatures and allocated widths stabilize.
 * @param document - Valid immutable native scene; current effective page, descendant and instance modes are retained.
 * @param options - Explicit budgets, optional subtree selection and host yielding; cancellation rejects before returning a candidate.
 * @param measurer - Injected paragraph engine with exact active font catalog identity; this module loads no fonts or host runtime.
 * @returns A fully validated candidate with measurement caches only; unavailable fonts, limits and nonconvergence reject atomically.
 */
export async function measureDesignText(document: CopyOSDesignDocument, options: DesignMeasureTextOptions,
  measurer: Pick<DesignTextMeasurer, 'measure' | 'engine'>): Promise<DesignMeasureTextResult> {
  for (const key of ['maxPasses', 'maxJobs', 'maxContexts'] as const)
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > (key === 'maxPasses' ? 64 : 100000))
      throw new DesignMeasureTextError('invalid-options', 'Text measurement budgets must be positive bounded integers')
  cancelled(options.signal)
  parseDesignDocument(document)
  let current = document, measured = 0
  const reused = new Set<string>(), measuredValues = new Map<string, Measured>()
  for (let pass = 1; pass <= options.maxPasses; pass++) {
    cancelled(options.signal)
    const { jobs, skippedHidden } = collect(current, options), results: { job: Job; result: Measured }[] = []
    for (const job of jobs) {
      cancelled(options.signal)
      if (ready(job, measurer.engine)) { if (pass === 1) reused.add(keyFor(job)); continue }
      const input = JSON.stringify([designTextLayoutSignature(job.node), designTextBaselineSignature(job.node)])
      let result = measuredValues.get(input)
      if (!result) {
        if (measured >= options.maxJobs)
          throw new DesignMeasureTextError('budget', 'Text measurement job budget exceeded', job.ownerId, job.path)
        if (options.yieldControl) await options.yieldControl()
        cancelled(options.signal)
        const value = await Promise.resolve(measurer.measure(job.node))
        cancelled(options.signal)
        measured++
        if (value.state !== 'measured')
          throw new DesignMeasureTextError('unavailable',
            `Text measurement unavailable: ${value.code}${value.family ? `; font ${JSON.stringify(value.family)}` : ''}`,
            job.ownerId, job.path, value.code)
        validResult(job, value, measurer.engine)
        result = value
        measuredValues.set(input, result)
      }
      results.push({ job, result })
    }
    if (!results.length) {
      cancelled(options.signal)
      parseDesignDocument(current)
      return { document: current, passes: pass, measured, reused: reused.size, contexts: jobs.length, skippedHidden }
    }
    current = stage(current, results)
    parseDesignDocument(current)
  }
  throw new DesignMeasureTextError('nonconvergent', 'Text layout did not converge within the measurement pass budget')
}
