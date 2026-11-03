/** Durable Higgsfield text-to-image generations whose results are saved as CopyOS project files. */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { DESIGN_IMAGE_ASSET_DIRECTORY, DESIGN_IMAGE_ASSET_MAX_BYTES, DESIGN_IMAGE_ASSET_PREFIX } from './design-image-assets.ts'
import { CopyOSDesignImageStore } from './design-image-store.ts'
import type {
  CopyOSGenerationImage,
  CopyOSGenerationImageValue,
  CopyOSGenerationRecord,
  CopyOSGenerationStartRequest,
  CopyOSGenerationStatus,
} from './types.ts'

/** Expected generation failures: invalid requests, missing credentials, unknown records and provider rejections. */
export class CopyOSGenerationError extends Error {
  override name = 'CopyOSGenerationError'
}

const recordsDirectory = '.copyos/generations'
const imagesDirectory = 'assets/generated'
/** Safety bound for one downloaded result; larger responses are rejected before they are saved. */
const downloadLimitBytes = 25_000_000
const consecutiveFailureLimit = 5
const aspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const
const resolutions = ['720p', '1080p'] as const
const statuses = ['submitting', 'queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'] as const
const terminal = new Set<CopyOSGenerationStatus>(['completed', 'failed', 'nsfw', 'canceled'])
const mimeTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const
type ImageMimeType = keyof typeof mimeTypes

const imageSchema = z.object({
  file: z.string().regex(/^(?:assets\/generated\/[0-9a-f-]{36}-\d+|assets\/images\/[a-f0-9]{64})\.(?:png|jpg|webp)$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.number().int().min(1).max(downloadLimitBytes),
}).strict()
const recordSchema = z.object({
  id: z.uuid(),
  provider: z.literal('higgsfield'),
  model: z.string().min(1).max(200),
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.enum(aspectRatios),
  resolution: z.enum(resolutions),
  requestId: z.string().min(1).max(200).nullable(),
  status: z.enum(statuses),
  error: z.string().max(2000).nullable(),
  cancelRequested: z.boolean(),
  images: z.array(imageSchema).max(4),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()
const startSchema = z.object({
  workspaceId: z.string(),
  prompt: z.string().trim().min(1, 'Describe the image to generate').max(4000),
  aspectRatio: z.enum(aspectRatios),
  resolution: z.enum(resolutions),
}).strict()

/** Reads and writes generation records and their downloaded images inside one project folder. */
export class CopyOSGenerationRepository {
  /**
   * Read every generation record, newest first.
   * @param root - Project folder.
   * @returns Valid records; an unreadable record fails the listing with its file name.
   */
  async list(root: string): Promise<CopyOSGenerationRecord[]> {
    let names: string[]
    try { names = await readdir(join(root, recordsDirectory)) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const records = await Promise.all(names.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))
      .map(name => this.read(root, name.slice(0, -5))))
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Read one generation record.
   * @param root - Project folder.
   * @param id - Generation identity.
   * @returns The validated record.
   * @throws CopyOSGenerationError when the record is missing or invalid.
   */
  async read(root: string, id: string): Promise<CopyOSGenerationRecord> {
    if (!z.uuid().safeParse(id).success) throw new CopyOSGenerationError('Unknown generation')
    let text: string
    try { text = await readFile(join(root, recordsDirectory, `${id}.json`), 'utf8') } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new CopyOSGenerationError('Unknown generation')
      throw error
    }
    const parsed = recordSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new CopyOSGenerationError(`Generation record ${id}.json is invalid: ${parsed.error.message}`)
    return parsed.data
  }

  /**
   * Replace one generation record atomically.
   * @param root - Project folder.
   * @param record - Complete record.
   */
  async save(root: string, record: CopyOSGenerationRecord): Promise<void> {
    await writeFileAtomic(join(root, recordsDirectory, `${record.id}.json`), `${JSON.stringify(recordSchema.parse(record), null, 2)}\n`, { mode: 0o644 })
  }

  /**
   * Save one downloaded result. Results a design image can hold go into the project image store, so placing them reuses that file;
   * larger results are saved under `assets/generated/`.
   * @param root - Project folder.
   * @param id - Generation identity.
   * @param index - Result position.
   * @param bytes - Image content.
   * @param mimeType - Verified image type.
   * @returns Saved image entry for the record.
   */
  async saveImage(root: string, id: string, index: number, bytes: Uint8Array, mimeType: ImageMimeType): Promise<CopyOSGenerationImage> {
    if (bytes.byteLength <= DESIGN_IMAGE_ASSET_MAX_BYTES) {
      const reference = await new CopyOSDesignImageStore().put(root, bytes)
      return { file: `${DESIGN_IMAGE_ASSET_DIRECTORY}/${reference.slice(DESIGN_IMAGE_ASSET_PREFIX.length)}`, mimeType, bytes: bytes.byteLength }
    }
    const file = `${imagesDirectory}/${id}-${index}.${mimeTypes[mimeType]}`
    await mkdir(join(root, imagesDirectory), { recursive: true })
    await writeFile(join(root, file), bytes)
    return { file, mimeType, bytes: bytes.byteLength }
  }

  /**
   * Read one saved result image.
   * @param root - Project folder.
   * @param image - Image entry from a validated record.
   * @returns Image bytes.
   */
  async readImage(root: string, image: CopyOSGenerationImage): Promise<Buffer> {
    return readFile(join(root, imageSchema.parse(image).file))
  }
}

/** Provider status after one poll. */
export interface HiggsfieldStatus {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'
  imageUrls: string[]
}
/** Connection settings for Higgsfield's queue API. */
export interface HiggsfieldProviderOptions {
  /** API origin, for example `https://api.higgsfield.ai`. */
  baseUrl: string
  /** Read `KEY_ID:KEY_SECRET` at call time; undefined means not configured. */
  resolveCredentials: () => Promise<string | undefined>
  /** HTTP implementation; defaults to the global fetch. */
  fetch?: typeof fetch
}

const submitResponseSchema = z.object({ request_id: z.string().min(1).max(200) }).loose()
const statusResponseSchema = z.object({
  status: z.string(),
  images: z.array(z.object({ url: z.url() }).loose()).max(4).optional(),
  error: z.string().optional(),
  detail: z.unknown().optional(),
}).loose()

/** Higgsfield's documented asynchronous queue API: submit, status and cancel by request id. */
export class HiggsfieldProvider {
  private readonly fetch: typeof fetch
  /** @param options - API origin, credential lookup and optional HTTP implementation. */
  constructor(private readonly options: HiggsfieldProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * Whether credentials are configured, without exposing them.
   * @returns True when a credential value resolves.
   */
  async configured(): Promise<boolean> {
    return (await this.options.resolveCredentials()) !== undefined
  }

  /**
   * Submit one billable request.
   * @param model - Model path, for example `higgsfield-ai/soul/v2/standard`.
   * @param input - Model input fields.
   * @returns Provider request id.
   */
  async submit(model: string, input: Record<string, unknown>): Promise<string> {
    const body = await this.request('POST', `/${model}`, input)
    return submitResponseSchema.parse(body).request_id
  }

  /**
   * Read the current status of one request.
   * @param requestId - Provider request id.
   * @returns Normalized status and result image URLs.
   * @throws CopyOSGenerationError for an unknown provider status.
   */
  async status(requestId: string): Promise<HiggsfieldStatus> {
    const body = statusResponseSchema.parse(await this.request('GET', `/requests/${encodeURIComponent(requestId)}/status`))
    const status = body.status === 'cancelled' ? 'canceled' : body.status
    switch (status) {
      case 'queued': case 'in_progress': case 'completed': case 'failed': case 'nsfw': case 'canceled':
        return { status, imageUrls: body.images?.map(image => image.url) ?? [] }
      default:
        throw new CopyOSGenerationError(`Higgsfield reported unknown status ${JSON.stringify(body.status).slice(0, 80)}`)
    }
  }

  /**
   * Ask Higgsfield to cancel one request; only queued requests are eligible.
   * @param requestId - Provider request id.
   */
  async cancel(requestId: string): Promise<void> {
    await this.request('POST', `/requests/${encodeURIComponent(requestId)}/cancel`)
  }

  /**
   * Download one result image.
   * @param url - Result URL from a completed status: HTTPS, or on the configured API origin.
   * @returns Image bytes and verified type.
   * @throws CopyOSGenerationError for other URLs, unsupported types or oversized results.
   */
  async download(url: string): Promise<{ bytes: Uint8Array; mimeType: ImageMimeType }> {
    if (!url.startsWith('https://') && URL.parse(url)?.origin !== URL.parse(this.options.baseUrl)?.origin)
      throw new CopyOSGenerationError('Generated image URL is not HTTPS')
    const response = await this.fetch(url)
    if (!response.ok) throw new Error(`Generated image download failed with HTTP ${response.status}`)
    const declared = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (Number(response.headers.get('content-length') ?? 0) > downloadLimitBytes)
      throw new CopyOSGenerationError('Generated image exceeds the 25 MB download limit')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > downloadLimitBytes) throw new CopyOSGenerationError('Generated image exceeds the 25 MB download limit')
    const mimeType = sniffImage(bytes) ?? (declared in mimeTypes ? declared as ImageMimeType : undefined)
    if (!mimeType) throw new CopyOSGenerationError(`Generated result is not a PNG, JPEG or WebP image (${declared || 'no type'})`)
    return { bytes, mimeType }
  }

  private async request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
    const credentials = await this.options.resolveCredentials()
    if (credentials === undefined) throw new CopyOSGenerationError('Higgsfield credentials are not configured')
    const response = await this.fetch(`${this.options.baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { 'Authorization': `Key ${credentials}`, 'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    if (!response.ok) {
      const reason = response.status === 401 ? 'credentials were rejected'
        : response.status === 403 ? 'not enough credits or access denied'
          : providerDetail(text)
      // Server errors and rate limits are retried by the poller; other rejections are final.
      throw new (response.status >= 500 || response.status === 429 ? Error : CopyOSGenerationError)(`Higgsfield HTTP ${response.status}: ${reason}`)
    }
    const value: unknown = text ? JSON.parse(text) : {}
    return value
  }
}

function providerDetail(text: string): string {
  try {
    const detail: unknown = (JSON.parse(text) as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail.slice(0, 300)
    if (detail !== undefined) return JSON.stringify(detail).slice(0, 300)
  } catch (error) { if (!(error instanceof SyntaxError)) throw error }
  return text.slice(0, 300) || 'request rejected'
}

function sniffImage(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

/** Service settings; every value comes from the CopyOS projects plugin Config. */
export interface CopyOSGenerationServiceOptions {
  provider: HiggsfieldProvider
  repository: CopyOSGenerationRepository
  /** Text-to-image model path. */
  model: string
  /** Delay between status polls. */
  pollIntervalMs: number
  /** Abortable delay; tests replace it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('CopyOS generation polling stopped', { cause: signal.reason })) }, { once: true })
})

/**
 * Submits generations and polls them on the server, so closing the Canvas panel does not stop a request. Records are saved
 * after every change; polling for unfinished records resumes on the next listing after a restart.
 */
export class CopyOSGenerationService {
  private readonly pollers = new Map<string, Promise<void>>()
  /** Records whose submission request is in flight in this process; a listing must not fail them as interrupted. */
  private readonly submitting = new Set<string>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly lifetime = new AbortController()
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>

  /** @param options - Provider, repository, model and polling interval. */
  constructor(private readonly options: CopyOSGenerationServiceOptions) {
    this.sleep = options.sleep ?? defaultSleep
  }

  /**
   * Submit one billable generation and start polling it.
   * @param root - Project folder.
   * @param request - Prompt and output settings.
   * @returns The saved record; a provider rejection is saved as `failed`.
   * @throws CopyOSGenerationError for invalid input or missing credentials, before anything is sent.
   */
  async start(root: string, request: CopyOSGenerationStartRequest): Promise<CopyOSGenerationRecord> {
    const parsed = startSchema.safeParse(request)
    if (!parsed.success) throw new CopyOSGenerationError(parsed.error.issues.map(issue => issue.message).join('; '))
    if (!await this.options.provider.configured()) throw new CopyOSGenerationError('Higgsfield credentials are not configured')
    const now = new Date().toISOString()
    let record: CopyOSGenerationRecord = { id: randomUUID(), provider: 'higgsfield', model: this.options.model, prompt: parsed.data.prompt,
      aspectRatio: parsed.data.aspectRatio, resolution: parsed.data.resolution, requestId: null, status: 'submitting', error: null,
      cancelRequested: false, images: [], createdAt: now, updatedAt: now }
    const submitKey = key(root, record.id)
    this.submitting.add(submitKey)
    try {
      await this.options.repository.save(root, record)
      const requestId = await this.options.provider.submit(record.model, { prompt: record.prompt, aspect_ratio: record.aspectRatio,
        resolution: record.resolution, batch_size: 1 })
      record = await this.update(root, record.id, value => ({ ...value, requestId, status: 'queued', error: null }))
      this.poll(root, record.id)
    } catch (error) {
      const message = error instanceof CopyOSGenerationError ? error.message
        : `Higgsfield did not confirm the submission (${errorMessage(error)}); check your Higgsfield request history before retrying`
      record = await this.update(root, record.id, value => ({ ...value, status: 'failed', error: message }))
    } finally {
      this.submitting.delete(submitKey)
    }
    return record
  }

  /**
   * List records and resume polling for unfinished ones that are not already polled.
   * @param root - Project folder.
   * @returns Records, newest first.
   */
  async list(root: string): Promise<CopyOSGenerationRecord[]> {
    const records = await this.options.repository.list(root)
    const result: CopyOSGenerationRecord[] = []
    for (const record of records) {
      if (terminal.has(record.status) || this.pollers.has(key(root, record.id)) || this.submitting.has(key(root, record.id))) {
        result.push(record); continue
      }
      if (record.requestId === null) {
        // The process stopped between saving and Higgsfield's confirmation; resending could bill twice.
        result.push(await this.update(root, record.id, value => ({ ...value, status: 'failed',
          error: 'Submission was interrupted before Higgsfield confirmed it; check your Higgsfield request history before retrying' })))
        continue
      }
      this.poll(root, record.id)
      result.push(record)
    }
    return result
  }

  /**
   * Ask Higgsfield to cancel a queued or running generation.
   * @param root - Project folder.
   * @param id - Generation identity.
   * @returns The record with `cancelRequested`; the status becomes `canceled` only when Higgsfield reports it.
   * @throws CopyOSGenerationError when the generation already finished, has no request id, or Higgsfield refuses.
   */
  async cancel(root: string, id: string): Promise<CopyOSGenerationRecord> {
    const record = await this.options.repository.read(root, id)
    if (terminal.has(record.status)) throw new CopyOSGenerationError('This generation already finished')
    if (record.requestId === null) throw new CopyOSGenerationError('Higgsfield has not confirmed this generation yet')
    await this.options.provider.cancel(record.requestId)
    const updated = await this.update(root, id, value => ({ ...value, cancelRequested: true }))
    if (!terminal.has(updated.status)) this.poll(root, id)
    return updated
  }

  /**
   * Read one saved result as a data URL for a Canvas image layer.
   * @param root - Project folder.
   * @param id - Generation identity.
   * @param index - Result position.
   * @returns Data URL and type.
   * @throws CopyOSGenerationError when the result is missing or too large for a design image.
   */
  async readImage(root: string, id: string, index: number): Promise<CopyOSGenerationImageValue> {
    const image = (await this.options.repository.read(root, id)).images[index]
    if (!image) throw new CopyOSGenerationError('This generation has no saved image at that position')
    if (image.bytes > DESIGN_IMAGE_ASSET_MAX_BYTES) throw new CopyOSGenerationError('Generated image is too large to place on the Canvas (6 MB limit)')
    const bytes = await this.options.repository.readImage(root, image)
    return { dataUrl: `data:${image.mimeType};base64,${bytes.toString('base64')}`, mimeType: image.mimeType }
  }

  /**
   * Stop every poller; records stay unfinished and resume on the next listing.
   * @returns Settles after every poller and pending record write stopped.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('CopyOS generation service disposed'))
    await Promise.allSettled([...this.pollers.values(), ...this.writes.values()])
  }

  /**
   * Wait until the poller for one generation stops (tests and orderly shutdown).
   * @param root - Project folder.
   * @param id - Generation identity.
   */
  async settled(root: string, id: string): Promise<void> {
    await this.pollers.get(key(root, id))
  }

  private poll(root: string, id: string): void {
    const pollerKey = key(root, id)
    if (this.pollers.has(pollerKey) || this.lifetime.signal.aborted) return
    const run = this.pollUntilDone(root, id).catch((error: unknown) => {
      if (this.lifetime.signal.aborted) return
      return this.update(root, id, value => ({ ...value, status: 'failed', error: errorMessage(error) })).then(() => {})
    }).finally(() => { this.pollers.delete(pollerKey) })
    this.pollers.set(pollerKey, run)
  }

  private async pollUntilDone(root: string, id: string): Promise<void> {
    let failures = 0
    for (;;) {
      await this.sleep(this.options.pollIntervalMs, this.lifetime.signal)
      const record = await this.options.repository.read(root, id)
      if (terminal.has(record.status) || record.requestId === null) return
      let next: HiggsfieldStatus
      let images: CopyOSGenerationImage[] = []
      try {
        next = await this.options.provider.status(record.requestId)
        if (next.status === 'completed') {
          if (!next.imageUrls.length) throw new CopyOSGenerationError('Higgsfield completed without an image')
          images = await Promise.all(next.imageUrls.map(async (url, index) => {
            const result = await this.options.provider.download(url)
            return this.options.repository.saveImage(root, id, index, result.bytes, result.mimeType)
          }))
        }
      } catch (error) {
        if (error instanceof CopyOSGenerationError || ++failures >= consecutiveFailureLimit) throw error
        continue
      }
      failures = 0
      const status = next.status
      if (status === record.status && !images.length) continue
      await this.update(root, id, value => ({ ...value, status, images,
        error: status === 'nsfw' ? 'Higgsfield blocked this result under its content policy'
          : status === 'failed' ? 'Higgsfield reported that the generation failed'
            : status === 'canceled' ? 'Canceled' : null }))
      if (terminal.has(status)) return
    }
  }

  private update(root: string, id: string,
    change: (record: CopyOSGenerationRecord) => CopyOSGenerationRecord): Promise<CopyOSGenerationRecord> {
    const writeKey = key(root, id)
    const run = (this.writes.get(writeKey) ?? Promise.resolve()).then(async () => {
      const next = { ...change(await this.options.repository.read(root, id)), updatedAt: new Date().toISOString() }
      await this.options.repository.save(root, next)
      return next
    })
    this.writes.set(writeKey, run.then(() => {}, () => {}))
    return run
  }
}

const key = (root: string, id: string): string => `${root}\0${id}`
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
