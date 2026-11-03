/** Atomic Figma import through a resource-limited worker. */
import { Worker } from 'node:worker_threads'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { CopyOSDesignError, parseDesignDocument } from './designs.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import type { CopyOSDesignDocument } from './types.ts'

/**
 * Import a local .fig without blocking the host event loop or replacing existing designs.
 * @param root - Registered project directory.
 * @param fileName - Original file name.
 * @param fileBase64 - Original binary file encoded as base64.
 * @returns the validated, atomically saved native design and import report; embedded images become project image files.
 */
export async function importFigDesign(
  root: string,
  fileName: string,
  fileBase64: string,
): Promise<CopyOSDesignDocument> {
  if (!/\.fig$/i.test(fileName) || fileBase64.length > 33_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64))
    throw new CopyOSDesignError('Choose a native .fig file no larger than 25 MB')
  const bytes = Buffer.from(fileBase64, 'base64')
  if (bytes.length > 25_000_000) throw new CopyOSDesignError('Figma imports are limited to 25 MB per file')
  const worker = new Worker(new URL('./fig-import-worker.js', import.meta.url), {
    execArgv: [],
    env: {},
    workerData: { bytes: new Uint8Array(bytes), fileName: basename(fileName) },
    resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
  })
  const document = await new Promise<CopyOSDesignDocument>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new CopyOSDesignError('Figma import exceeded 30 seconds. Try exporting fewer pages.'))
    }, 30000)
    worker.once('message', (value: unknown) => {
      clearTimeout(timer)
      try {
        const result = z.object({ document: z.unknown().optional(), error: z.string().optional() }).parse(value)
        if (result.error) throw new CopyOSDesignError(result.error)
        resolve(parseDesignDocument(result.document))
      } catch (error) {
        reject(error instanceof Error ? error : new CopyOSDesignError(String(error)))
      }
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(new CopyOSDesignError(`Figma import failed: ${error.message}`))
    })
    worker.once('exit', (_code) => {
      clearTimeout(timer)
      reject(new CopyOSDesignError('Figma decoder exceeded its memory limit or stopped unexpectedly'))
    })
  })
  await mkdir(join(root, 'designs', 'originals'), { recursive: true, mode: 0o700 })
  await writeFile(join(root, 'designs', 'originals', `${document.id}.fig`), bytes, { mode: 0o600, flag: 'wx' })
  const stored = await new CopyOSDesignImageStore().storeDocumentImages(root, document)
  await writeFileAtomic(join(root, 'designs', `${stored.id}.design.json`), `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  })
  return stored
}
