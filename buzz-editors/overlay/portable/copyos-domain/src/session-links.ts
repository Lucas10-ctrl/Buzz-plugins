/** Portable relationships between Harness Sessions and CopyOS artifacts. */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import {
  COPYOS_SESSION_LINK_VERSION,
  type CopyOSSessionArtifactLink,
  type CopyOSSessionLinkDocument,
} from './types.ts'

const artifactSchema = z.object({
  kind: z.enum(['brand', 'research', 'brief', 'copy', 'page', 'script', 'experiment']),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  linkedAt: z.iso.datetime(),
}).strict()

const documentSchema = z.object({
  schema: z.literal('copyos.session-links'),
  version: z.literal(COPYOS_SESSION_LINK_VERSION),
  sessionId: z.string().trim().min(1).max(240),
  artifacts: z.array(artifactSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

/** A portable Session relationship file is malformed. */
export class CopyOSSessionLinkFormatError extends Error {
  override readonly name = 'CopyOSSessionLinkFormatError'
}

/** JSON repository for cross-process-safe Session relationship updates. */
export class CopyOSSessionLinkRepository {
  /**
   * List every Session relationship in newest-update order.
   * @param projectPath - Canonical CopyOS project root.
   * @returns validated relationship documents.
   */
  async list(projectPath: string): Promise<readonly CopyOSSessionLinkDocument[]> {
    const directory = sessionsDirectory(projectPath)
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }
    const documents = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.session.json'))
      .map(async entry => await this.read(join(directory, entry.name))))
    return documents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Add or refresh one artifact relationship for a Session.
   * @param projectPath - Canonical CopyOS project root.
   * @param sessionId - Harness Session identity.
   * @param artifact - Artifact identity and current title.
   * @returns the complete persisted relationship document.
   */
  async linkArtifact(
    projectPath: string,
    sessionId: string,
    artifact: Pick<CopyOSSessionArtifactLink, 'kind' | 'id' | 'title'>,
  ): Promise<CopyOSSessionLinkDocument> {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId === '') throw new CopyOSSessionLinkFormatError('session id must not be blank')
    const path = sessionPath(projectPath, normalizedSessionId)
    await mkdir(sessionsDirectory(projectPath), { recursive: true, mode: 0o700 })
    return await withFileLock(path, async () => {
      const existing = await this.readOptional(path)
      const now = new Date().toISOString()
      const nextLink = artifactSchema.parse({ ...artifact, linkedAt: now })
      const artifacts = [
        nextLink,
        ...(existing?.artifacts ?? []).filter(link => link.kind !== nextLink.kind || link.id !== nextLink.id),
      ]
      const document = this.parse({
        schema: 'copyos.session-links',
        version: COPYOS_SESSION_LINK_VERSION,
        sessionId: normalizedSessionId,
        artifacts,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      return document
    })
  }

  private async readOptional(path: string): Promise<CopyOSSessionLinkDocument | undefined> {
    try {
      return await this.read(path)
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  private async read(path: string): Promise<CopyOSSessionLinkDocument> {
    try {
      return this.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error: unknown) {
      if (error instanceof CopyOSSessionLinkFormatError) throw error
      if (isNodeError(error) && error.code === 'ENOENT') throw error
      throw new CopyOSSessionLinkFormatError(`invalid CopyOS Session relationships at '${path}': ${errorMessage(error)}`)
    }
  }

  private parse(value: unknown): CopyOSSessionLinkDocument {
    try {
      return documentSchema.parse(value)
    } catch (error: unknown) {
      throw new CopyOSSessionLinkFormatError(errorMessage(error))
    }
  }
}

function sessionsDirectory(projectPath: string): string {
  return join(projectPath, '.copywriter', 'sessions')
}

function sessionPath(projectPath: string, sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex')
  return join(sessionsDirectory(projectPath), `${digest}.session.json`)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
