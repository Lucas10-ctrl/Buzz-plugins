/** Batch DOM text measurements so many Canvas layers share forced layouts. */
import { useLayoutEffect } from 'react'

/** One phase of a measurement job; returning `false` ends that job before its later phases. */
export type DesignerMeasureStep = () => boolean | void

/** DOM measurement split into alternating write and read phases plus a final DOM cleanup. */
export interface DesignerMeasureJob {
  /** Phases run in order; phase `k` of every queued job runs before phase `k + 1` of any job. Even phases only write
   * the DOM and odd phases only read layout, so one batch forces at most one layout per odd phase. */
  steps: DesignerMeasureStep[]
  /** Removes temporary measurement elements; runs once after the job's last phase or failure. */
  cleanup?: () => void
}

let batchOpen = false
let queued: DesignerMeasureJob[] = []

function flush(jobs: DesignerMeasureJob[]): void {
  let live = jobs
  const failures: unknown[] = []
  try {
    for (let phase = 0; live.length; phase++) {
      live = live.filter((job) => {
        const step = job.steps[phase]
        if (!step) return false
        try {
          return step() !== false
        } catch (error) {
          failures.push(error)
          return false
        }
      })
    }
  } finally {
    for (const job of jobs) job.cleanup?.()
  }
  if (failures.length) throw failures[0]
}

/** Run a measurement now, or with the open Canvas commit batch so its reads share one layout per phase.
 * @param job - Phases that alternate DOM writes (even indexes, starting at 0) and layout reads (odd indexes).
 */
export function runDesignerMeasure(job: DesignerMeasureJob): void {
  if (batchOpen) queued.push(job)
  else flush([job])
}

function flushQueued(): void {
  batchOpen = false
  const jobs = queued
  queued = []
  if (jobs.length) flush(jobs)
}

/** Opens a measurement batch for the layout effects of the siblings rendered after it.
 * Render it before the measured subtree and {@link DesignerMeasureBatchEnd} after it; a microtask flushes the batch
 * when the end marker does not commit.
 * @returns No visible content.
 */
export function DesignerMeasureBatchStart(): null {
  useLayoutEffect(() => {
    if (batchOpen) return
    batchOpen = true
    queueMicrotask(() => { if (batchOpen) flushQueued() })
  })
  return null
}

/** Flushes the measurement batch opened by {@link DesignerMeasureBatchStart} after the measured subtree's layout effects.
 * @returns No visible content.
 */
export function DesignerMeasureBatchEnd(): null {
  useLayoutEffect(() => {
    if (batchOpen) flushQueued()
  })
  return null
}

/** Font-load notifications shared by every mounted text measurement. */
const fontWatchers = new Set<() => void>()
const readyWatchers = new Set<() => void>()
let fontsListening: EventTarget | null = null

function remeasure(watchers: Iterable<() => void>): void {
  const run = [...watchers]
  if (!run.length) return
  batchOpen = true
  try {
    for (const watcher of run) watcher()
  } finally {
    flushQueued()
  }
}

const loadingDone = (): void => { remeasure(fontWatchers) }

/** Remeasure text after browser fonts load, coalescing every mounted text into one batch per font event.
 * @param measure - Queues the text's measurement; called again for each font `loadingdone` event and once after
 *   pending font loads settle when fonts were still loading at registration.
 * @returns Disposer that stops all further remeasurement for this text.
 */
export function watchDesignerFonts(measure: () => void): () => void {
  const fonts: (EventTarget & { ready?: Promise<unknown>; status?: string }) | undefined =
    (document as Partial<Document>).fonts
  if (!fonts) return () => {}
  if (fontsListening !== fonts) {
    fontsListening?.removeEventListener('loadingdone', loadingDone)
    fontsListening = fonts
  }
  if (!fontWatchers.size) fonts.addEventListener('loadingdone', loadingDone)
  fontWatchers.add(measure)
  // A completed font set already supplied the glyphs used by the measurement that preceded registration.
  if (fonts.status !== 'loaded') {
    if (!readyWatchers.size)
      void fonts.ready?.then(() => {
        const run = [...readyWatchers]
        readyWatchers.clear()
        remeasure(run)
      })
    readyWatchers.add(measure)
  }
  return () => {
    readyWatchers.delete(measure)
    fontWatchers.delete(measure)
    if (!fontWatchers.size) fonts.removeEventListener('loadingdone', loadingDone)
  }
}
