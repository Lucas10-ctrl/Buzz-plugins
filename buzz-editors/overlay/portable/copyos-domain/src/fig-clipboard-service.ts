/** Decode-only native clipboard operations isolated from host credentials and document persistence. */
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { CopyOSDesignError, parseDesignDocument } from './designs.ts'
import { figDecodeErrorSummary } from './fig-decode-error.ts'
import type { FigClipboardDecodeResult } from './types.ts'

const replySchema = z.union([
  z.object({ error: z.string().min(1).max(20000) }).strict(),
  z.object({ document: z.unknown(), selectedIds: z.array(z.uuid()).min(1).max(25000) }).strict(),
])

/**
 * Decode one clipboard selection without writing a project or retaining a live worker.
 * @param dataBase64 - Canonical base64 fig-kiwi selection bytes, limited to 25 MB decoded.
 * @returns Validated editable scene and selected roots after the decoder has stopped.
 */
export async function decodeFigClipboardSelection(dataBase64: string): Promise<FigClipboardDecodeResult> {
  if (!dataBase64.length || dataBase64.length > 33333336 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64))
    throw new CopyOSDesignError('Choose a native Figma clipboard selection no larger than 25 MB')
  const bytes = Buffer.from(dataBase64, 'base64')
  if (bytes.length > 25000000) throw new CopyOSDesignError('Figma clipboard selections are limited to 25 MB')
  if (bytes.toString('base64') !== dataBase64) throw new CopyOSDesignError('Invalid Figma clipboard base64 data')
  const worker = new Worker(new URL('./fig-import-worker.js', import.meta.url), {
    execArgv: [],
    env: {},
    workerData: { kind: 'clipboard', bytes: new Uint8Array(bytes) },
    resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<FigClipboardDecodeResult>((resolve, reject) => {
      timer = setTimeout(() => { reject(new CopyOSDesignError('Figma clipboard decoding exceeded 30 seconds')) }, 30000)
      worker.once('message', (value: unknown) => {
        try {
          const reply = replySchema.parse(value)
          if ('error' in reply) throw new CopyOSDesignError(reply.error)
          const document = parseDesignDocument(reply.document), ids = new Set(reply.selectedIds)
          if (ids.size !== reply.selectedIds.length) throw new CopyOSDesignError('Figma clipboard decoder returned duplicate selected roots')
          const nodes = new Map(document.nodes.map(node => [node.id, node]))
          for (const id of ids) {
            const node = nodes.get(id)
            if (!node) throw new CopyOSDesignError('Figma clipboard decoder returned a missing selected root')
            let parent = node.parentId
            const seen = new Set([id])
            while (parent) {
              if (seen.has(parent) || ids.has(parent)) throw new CopyOSDesignError('Figma clipboard decoder returned overlapping selected roots')
              seen.add(parent); parent = nodes.get(parent)?.parentId ?? null
            }
          }
          resolve({ document, selectedIds: reply.selectedIds })
        } catch (error) {
          reject(error instanceof CopyOSDesignError ? error : new CopyOSDesignError(figDecodeErrorSummary(error)))
        }
      })
      worker.on('error', (error) => { reject(new CopyOSDesignError(`Figma clipboard decoder failed: ${error.message}`)) })
      worker.once('exit', () => {
        reject(new CopyOSDesignError('Figma clipboard decoder exceeded its memory limit or stopped unexpectedly'))
      })
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    worker.removeAllListeners('message')
    worker.removeAllListeners('exit')
    try { await worker.terminate() } finally { worker.removeAllListeners('error') }
  }
}
