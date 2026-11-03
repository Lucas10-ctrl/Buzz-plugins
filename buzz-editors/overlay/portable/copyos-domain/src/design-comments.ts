/**
 * Canvas review comments stored per design in `designs/<designId>.comments.json`, beside the design file and never inside it, so
 * adding or resolving a comment changes neither the design's revision nor an editor's unsaved draft.
 */
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { CopyOSDesignError } from './design-schema.ts'
import { CopyOSDesignRepository } from './designs.ts'
import type { CopyOSDesignComment, CopyOSDesignCommentList, CopyOSDesignCommentTarget } from './types.ts'

/** Most comments one design keeps. */
export const DESIGN_COMMENT_LIMIT = 2000

const coordinate = z.number().min(-10_000_000).max(10_000_000)
const pageId = z.uuid().nullable()
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('layer'), pageId, nodeId: z.uuid(), nodeName: z.string().max(200), x: coordinate, y: coordinate }).strict(),
  z.object({ kind: z.literal('point'), pageId, x: coordinate, y: coordinate }).strict(),
])
const bodySchema = z.string().trim().min(1).max(4000)
const statusSchema = z.enum(['open', 'resolved'])
const commentSchema = z.object({
  id: z.uuid(), body: bodySchema, status: statusSchema, target: targetSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict()
const fileSchema = z.object({
  schema: z.literal('copyos.design-comments'), version: z.literal(1), designId: z.uuid(),
  comments: z.array(commentSchema).max(DESIGN_COMMENT_LIMIT),
}).strict()

function parse<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new CopyOSDesignError(`Invalid ${field}: ${result.error.issues.map(issue => issue.message).join('; ')}`)
  return result.data
}

/** Review comments of saved designs; writes to one design's comments are serialized across processes. */
export class CopyOSDesignCommentRepository {
  private readonly designs = new CopyOSDesignRepository()

  /**
   * Read one design's comments.
   * @param root - Project root.
   * @param designId - Saved design identity.
   * @returns Comments oldest first; a design without a comments file has none.
   * @throws {CopyOSDesignError} If the design does not exist or the comments file is malformed.
   */
  async list(root: string, designId: string): Promise<CopyOSDesignCommentList> {
    const id = await this.existing(root, designId)
    return { designId: id, comments: await this.read(root, id) }
  }

  /**
   * Add one open comment.
   * @param root - Project root.
   * @param designId - Saved design identity.
   * @param body - Comment text; surrounding whitespace is removed.
   * @param target - Layer or page point the comment is pinned to.
   * @returns The stored comment.
   * @throws {CopyOSDesignError} If the design is missing, a field is invalid or the design already has 2000 comments.
   */
  async add(root: string, designId: string, body: unknown, target: unknown): Promise<CopyOSDesignComment> {
    const text = parse(bodySchema, body, 'comment text')
    const pinned: CopyOSDesignCommentTarget = parse(targetSchema, target, 'comment target')
    const id = await this.existing(root, designId)
    return await this.update(root, id, (comments) => {
      if (comments.length >= DESIGN_COMMENT_LIMIT) throw new CopyOSDesignError(`A design keeps at most ${DESIGN_COMMENT_LIMIT} comments`)
      const now = new Date().toISOString()
      const comment: CopyOSDesignComment = { id: randomUUID(), body: text, status: 'open', target: pinned, createdAt: now, updatedAt: now }
      return { comments: [...comments, comment], result: comment }
    })
  }

  /**
   * Resolve or reopen one comment.
   * @param root - Project root.
   * @param designId - Saved design identity.
   * @param commentId - Comment identity.
   * @param status - Desired status.
   * @returns The updated comment.
   * @throws {CopyOSDesignError} If the design or comment is missing or the status is invalid.
   */
  async setStatus(root: string, designId: string, commentId: string, status: unknown): Promise<CopyOSDesignComment> {
    const next = parse(statusSchema, status, 'comment status')
    const id = await this.existing(root, designId)
    return await this.update(root, id, (comments) => {
      const current = comments.find(comment => comment.id === commentId)
      if (!current) throw new CopyOSDesignError(`Comment '${commentId}' was not found`)
      const updated = { ...current, status: next, updatedAt: new Date().toISOString() }
      return { comments: comments.map(comment => comment.id === commentId ? updated : comment), result: updated }
    })
  }

  /**
   * Delete one comment; the file is removed with the last comment.
   * @param root - Project root.
   * @param designId - Saved design identity.
   * @param commentId - Comment identity.
   * @throws {CopyOSDesignError} If the design or comment is missing.
   */
  async delete(root: string, designId: string, commentId: string): Promise<void> {
    const id = await this.existing(root, designId)
    await this.update(root, id, (comments) => {
      if (!comments.some(comment => comment.id === commentId)) throw new CopyOSDesignError(`Comment '${commentId}' was not found`)
      return { comments: comments.filter(comment => comment.id !== commentId), result: undefined }
    })
  }

  private async existing(root: string, designId: string): Promise<string> {
    const id = parse(z.uuid(), designId, 'design identity')
    try { await this.designs.get(root, id) } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new CopyOSDesignError(`Design '${id}' was not found`)
      throw error
    }
    return id
  }

  private path(root: string, designId: string): string {
    return join(root, 'designs', `${designId}.comments.json`)
  }

  private async read(root: string, designId: string): Promise<CopyOSDesignComment[]> {
    let text: string
    try { text = await readFile(this.path(root, designId), 'utf8') } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    let json: unknown
    try { json = JSON.parse(text) } catch (error: unknown) {
      throw new CopyOSDesignError(`Design comments file is not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    const file = parse(fileSchema, json, 'design comments file')
    if (file.designId !== designId) throw new CopyOSDesignError('Design comments file belongs to another design')
    return file.comments
  }

  private async update<T>(root: string, designId: string,
    change: (comments: CopyOSDesignComment[]) => { comments: CopyOSDesignComment[]; result: T }): Promise<T> {
    const path = this.path(root, designId)
    return await withFileLock(path, async () => {
      const { comments, result } = change(await this.read(root, designId))
      if (comments.length) {
        const file = { schema: 'copyos.design-comments', version: 1, designId, comments }
        await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
      } else {
        try { await unlink(path) } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
      return result
    })
  }
}
