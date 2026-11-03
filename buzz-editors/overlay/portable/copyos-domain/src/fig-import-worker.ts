/** Isolated, memory-bounded native Figma decoder entry. */
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { decodeFigClipboard } from './fig-clipboard.ts'
import { decodeFigDocument } from './fig-import.ts'
import { figDecodeErrorSummary } from './fig-decode-error.ts'
try {
  const input = z.union([
    z.object({ kind: z.literal('clipboard'), bytes: z.instanceof(Uint8Array) }).strict(),
    z.object({ bytes: z.instanceof(Uint8Array), fileName: z.string() }).strict(),
  ]).parse(workerData)
  if ('kind' in input) parentPort?.postMessage(decodeFigClipboard(input.bytes))
  else parentPort?.postMessage({ document: decodeFigDocument(input.bytes, input.fileName) })
} catch (error) {
  parentPort?.postMessage({ error: figDecodeErrorSummary(error) })
} finally {
  parentPort?.close()
}
