/** Atomic, portable filesystem repository for CopyOS project metadata. */

import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  COPYOS_PROJECT_VERSION,
  type CopyOSProjectDocument,
} from './types.ts'

/** Portable marker that distinguishes a CopyOS project from a generic Workspace. */
export const COPYOS_PROJECT_FILE = 'copyos.project.json'

/** Initial user-owned asset directories created for every project. */
export const COPYOS_PROJECT_DIRECTORIES = [
  'brand',
  'research',
  'briefs',
  'pages',
  'copy',
  'scripts',
  'experiments',
  'exports',
  'skills',
] as const

const projectDocumentSchema = z.object({
  schema: z.literal('copyos.project'),
  version: z.literal(COPYOS_PROJECT_VERSION),
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

/** A requested project path is absent or not a directory. */
export class CopyOSProjectPathError extends Error {
  override readonly name = 'CopyOSProjectPathError'
}

/** A project marker exists but does not match the supported schema. */
export class CopyOSProjectFormatError extends Error {
  override readonly name = 'CopyOSProjectFormatError'
}

/** Filesystem repository whose marker and assets travel with the user folder. */
export class CopyOSProjectRepository {
  /**
   * Create a project marker and initial asset tree, or read an existing marker.
   * @param inputPath - Existing project directory.
   * @param requestedName - Optional display name for a newly created marker.
   * @returns canonical path and portable document.
   */
  async initialize(
    inputPath: string,
    requestedName?: string,
  ): Promise<{ readonly path: string; readonly document: CopyOSProjectDocument }> {
    const path = await this.requireDirectory(inputPath)
    const existing = await this.read(path)
    if (existing !== undefined) return { path, document: existing }

    const name = normalizeName(requestedName ?? basename(path))
    for (const directory of COPYOS_PROJECT_DIRECTORIES) {
      await mkdir(join(path, directory), { recursive: true })
    }
    const now = new Date().toISOString()
    const document: CopyOSProjectDocument = {
      schema: 'copyos.project',
      version: COPYOS_PROJECT_VERSION,
      projectId: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
    }
    await this.writeAtomic(path, document)
    return { path, document }
  }

  /**
   * Read a project marker when the directory is a CopyOS project.
   * @param inputPath - Project candidate directory.
   * @returns parsed document, or undefined when no marker exists.
   */
  async read(inputPath: string): Promise<CopyOSProjectDocument | undefined> {
    const marker = join(inputPath, COPYOS_PROJECT_FILE)
    let source: string
    try {
      source = await readFile(marker, 'utf8')
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    try {
      return projectDocumentSchema.parse(JSON.parse(source))
    } catch (error: unknown) {
      throw new CopyOSProjectFormatError(`invalid CopyOS project marker at '${marker}': ${errorMessage(error)}`)
    }
  }

  private async requireDirectory(inputPath: string): Promise<string> {
    let path: string
    try {
      path = await realpath(inputPath)
      if (!(await stat(path)).isDirectory()) throw new CopyOSProjectPathError(`CopyOS project path is not a directory: ${path}`)
    } catch (error: unknown) {
      if (error instanceof CopyOSProjectPathError) throw error
      throw new CopyOSProjectPathError(`CopyOS project directory is unavailable: ${inputPath}`)
    }
    return path
  }

  private async writeAtomic(path: string, document: CopyOSProjectDocument): Promise<void> {
    const destination = join(path, COPYOS_PROJECT_FILE)
    const temporary = join(path, `.${COPYOS_PROJECT_FILE}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(temporary, destination)
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (name.length === 0) throw new CopyOSProjectFormatError('CopyOS project name must not be blank')
  if (name.length > 120) throw new CopyOSProjectFormatError('CopyOS project name must be at most 120 characters')
  return name
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
