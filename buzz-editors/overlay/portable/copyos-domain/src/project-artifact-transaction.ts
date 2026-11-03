/** Coordinated portable page/design publication and interrupted conversion recovery. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, realpath, rename, unlink, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

const scope = new AsyncLocalStorage<ReadonlySet<string>>()
const journalName = '.copyos/conversion-journal.json'
const artifactPath = z.union([
  z.string().regex(/^designs\/[0-9a-f-]{36}\.design\.json$/),
  z.string().regex(/^pages\/[a-z0-9-]+\.page\.json$/),
  z.string().regex(/^\.copyos\/conversions\/[0-9a-f-]{36}\/source\.design\.json$/),
])
const targetSchema = z.object({ path: artifactPath, before: z.string().nullable(), after: z.string() }).strict()
const journalSchema = z.object({ version: z.literal(1), id: z.uuid(), files: z.array(targetSchema).length(3) }).strict()
type Target = z.infer<typeof targetSchema>

const maximumArtifactBytes = 64_000_000
const archivePath = /^\.copyos\/conversions\/[0-9a-f-]{36}\/(?:source\.design\.json|generated\.html)$/
async function bytes(path: string): Promise<string | null> {
  try {
    const observed = await lstat(path)
    if (!observed.isFile() || observed.isSymbolicLink()) throw new Error('Conversion artifact must be a regular file')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const initial = await file.stat()
      if (!initial.isFile() || initial.dev !== observed.dev || initial.ino !== observed.ino)
        throw new Error('Conversion artifact changed before reading')
      if (initial.size > maximumArtifactBytes) throw new Error('Conversion artifact exceeds the 64000000-byte safety bound')
      const buffer = Buffer.alloc(initial.size)
      let offset = 0
      while (offset < buffer.length) {
        const chunk = await file.read(buffer, offset, buffer.length - offset, offset)
        if (!chunk.bytesRead) throw new Error('Conversion artifact changed while reading')
        offset += chunk.bytesRead
      }
      const tail = await file.read(Buffer.alloc(1), 0, 1, offset), final = await file.stat()
      if (tail.bytesRead || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs)
        throw new Error('Conversion artifact changed while reading')
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
    } finally { await file.close() }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
async function inspectPath(root: string, relative: string): Promise<string> {
  let current = root
  for (const part of relative.split('/').slice(0, -1)) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Conversion directories must not be symbolic links')
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  return join(root, relative)
}
async function safePath(root: string, relative: string): Promise<string> {
  let current = root
  for (const part of relative.split('/').slice(0, -1)) {
    current = join(current, part)
    try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Conversion directories must not be symbolic links') }
    catch (error: unknown) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { await mkdir(current, { mode: 0o700 }); await syncDirectory(dirname(current)) } else throw error }
  }
  return join(root, relative)
}
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const file = await open(path, 'r'); try { await file.sync() } finally { await file.close() }
}
async function durableWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(value, 'utf8'); await file.sync() } finally { await file.close() }
  try { await rename(temporary, path); await syncDirectory(dirname(path)) }
  finally { await unlink(temporary).catch(() => {}) }
}
async function admittedJournal(value: unknown): Promise<z.infer<typeof journalSchema>> {
  const journal = journalSchema.parse(value)
  if (new Set(journal.files.map(file => file.path)).size !== 3 || !journal.files[0]?.path.startsWith('.copyos/conversions/') || !journal.files[1]?.path.startsWith('pages/') || !journal.files[2]?.path.startsWith('designs/')) throw new Error('Invalid conversion recovery targets')
  const { parseDesignDocument } = await import('./design-schema.ts')
  const { parseCopyOSPageDocument } = await import('./pages.ts')
  const original = parseDesignDocument(JSON.parse(journal.files[0].after))
  const page = parseCopyOSPageDocument(JSON.parse(journal.files[1].after), 'write')
  const design = parseDesignDocument(JSON.parse(journal.files[2].after))
  const conversion = page.conversion
  if (journal.files[0].before !== null || journal.files[1].before !== null || journal.files[2].before === null ||
    conversion?.snapshotPath !== journal.files[0].path || conversion.sourceDesignId !== original.id ||
    conversion.sourceRevision !== original.revision || design.id !== original.id || design.revision !== original.revision + 1 ||
    journal.files[1].path !== `pages/${page.slug}-${page.id}.page.json` || journal.files[2].path !== `designs/${design.id}.design.json` ||
    !design.nodes.some(node => node.id === conversion.linkedFrameId && node.pageLink?.pageId === page.id))
    throw new Error('Conversion journal artifacts have inconsistent source metadata')
  return journal
}
async function recover(root: string): Promise<void> {
  try {
    const directory = await lstat(join(root, '.copyos'))
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe conversion journal directory')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  const journalPath = join(root, journalName)
  const source = await bytes(journalPath)
  if (source === null) return
  const journal = await admittedJournal(JSON.parse(source))
  // Reject every observed conflict before creating directories or publishing any target.
  const pending: { path: string; relative: string; after: string }[] = []
  for (const target of journal.files) {
    const path = await inspectPath(root, target.path)
    const current = await bytes(path)
    if (current !== target.before && current !== target.after) throw new Error(`Conversion recovery conflict: '${target.path}' changed outside the transaction`)
    if (current !== target.after) pending.push({ path, relative: target.path, after: target.after })
  }
  for (const target of pending) {
    await safePath(root, target.relative)
    await durableWrite(target.path, target.after)
  }
  await unlink(journalPath); await syncDirectory(dirname(journalPath))
}

/** Serialize portable page/design readers and conversion writers; recover prepared commits first.
 * @param root - Existing project root.
 * @param operation - Work performed under the project gate; nested same-project calls are reentrant.
 * @returns The operation result after any interrupted conversion has safely completed.
 */
export async function withProjectArtifactAccess<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const canonical = await realpath(root)
  if (scope.getStore()?.has(canonical)) return operation()
  const directory = join(tmpdir(), `copyos-artifact-gates-${process.getuid?.() ?? 'user'}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Unsafe portable artifact lock directory')
  const lockPath = join(directory, createHash('sha256').update(canonical).digest('hex'))
  const run = async () => scope.run(new Set([...(scope.getStore() ?? []), canonical]), async () => {
    await recover(canonical)
    return operation()
  })
  if (process.platform === 'win32') return withFileLock(lockPath, run)
  const file = await open(lockPath, 'a+', 0o600)
  try {
    const deadline = Date.now() + 30_000
    while (true) {
      try { await tryLockExclusive(file.fd); break }
      catch (error: unknown) { if (!(error instanceof Error && 'code' in error && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')) || Date.now() >= deadline) throw error; await setTimeout(20) }
    }
    return await run()
  } finally { await file.close() }
}

/** Prepare and publish an exact three-file conversion under the project gate.
 * @param root - Project root already held by the caller's artifact gate.
 * @param files - Archive, new page, and updated design, in publication order, with exact original bytes.
 * @returns Resolves after all files and journal removal are durable.
 */
export async function commitProjectArtifacts(root: string, files: readonly Target[]): Promise<void> {
  const canonical = await realpath(root)
  if (!scope.getStore()?.has(canonical)) throw new Error('Conversion commit requires its project artifact gate')
  const journal = await admittedJournal({ version: 1, id: randomUUID(), files })
  for (const target of journal.files) {
    const path = await inspectPath(canonical, target.path)
    if (await bytes(path) !== target.before) throw new Error(`Conversion conflict: '${target.path}' changed before publication`)
  }
  const journalPath = await inspectPath(canonical, journalName)
  if (await bytes(journalPath) !== null) throw new Error('A conversion journal already exists')
  const source = JSON.stringify(journal)
  if (Buffer.byteLength(source, 'utf8') > maximumArtifactBytes)
    throw new Error('Conversion recovery journal exceeds its 64000000-byte safety bound')
  const path = await safePath(canonical, journalName)
  await durableWrite(path, source)
  await recover(canonical)
}

/** Durably create one new conversion archive file before any page or design references it.
 * @param root - Project root already held by the caller's artifact gate.
 * @param relative - `.copyos/conversions/<uuid>/source.design.json` or `.copyos/conversions/<uuid>/generated.html`.
 * @param value - Complete UTF-8 file content.
 * @returns Resolves after the file and its directory entry are durable; existing files, symbolic-link ancestors and other paths reject.
 */
export async function writeConversionArchive(root: string, relative: string, value: string): Promise<void> {
  const canonical = await realpath(root)
  if (!scope.getStore()?.has(canonical)) throw new Error('Conversion archive writes require their project artifact gate')
  if (!archivePath.test(relative)) throw new Error('Invalid conversion archive path')
  const path = await safePath(canonical, relative)
  if (await bytes(path) !== null) throw new Error('Conversion archive already exists')
  await durableWrite(path, value)
}

/** Read one conversion archive file without following symbolic links, within the artifact byte bound.
 * @param root - Project root already held by the caller's artifact gate.
 * @param relative - Archive path admitted by writeConversionArchive.
 * @returns Exact UTF-8 content; missing files, symbolic-link ancestors and other paths reject.
 */
export async function readConversionArchive(root: string, relative: string): Promise<string> {
  const canonical = await realpath(root)
  if (!scope.getStore()?.has(canonical)) throw new Error('Conversion archive reads require their project artifact gate')
  if (!archivePath.test(relative)) throw new Error('Invalid conversion archive path')
  const value = await bytes(await inspectPath(canonical, relative))
  if (value === null) throw new Error(`Conversion archive '${relative}' is missing`)
  return value
}
