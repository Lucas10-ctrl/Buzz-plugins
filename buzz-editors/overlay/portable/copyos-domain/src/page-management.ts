/** Buzz-owned page lifecycle actions around the unchanged original page repository. */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, lstat, link, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { parseCopyOSPageDocument, CopyOSPageConflictError } from './pages.ts'
import { withProjectArtifactAccess } from './project-artifact-transaction.ts'
import type { CopyOSPageDocument } from './types.ts'

async function safeDirectory(root: string, parts: readonly string[]): Promise<string> {
  let directory = root
  for (const part of parts) {
    directory = join(directory, part)
    try { await mkdir(directory) } catch (error: unknown) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe page directory')
  }
  return directory
}
async function readPage(path: string): Promise<CopyOSPageDocument> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe page file')
  return parseCopyOSPageDocument(JSON.parse(await readFile(path,'utf8')))
}
async function activePath(directory: string, id: string): Promise<string> {
  const matches: string[] = []
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (!entry.isFile() || !entry.name.endsWith('.page.json')) continue
    const path = join(directory,entry.name)
    if ((await readPage(path)).id === id) matches.push(path)
  }
  if (matches.length !== 1) throw new Error('Page is missing or has duplicate identities')
  return matches[0]!
}

/** Clone a saved revision, or move it to/from recoverable page trash, under the repository's page lock. */
export async function managePage(root: string, request: { pageId: string; expectedRevision: number }, action: 'clone' | 'delete' | 'restore'): Promise<CopyOSPageDocument> {
  return withProjectArtifactAccess(root, async () => {
    const directory = await safeDirectory(root, ['pages'])
    const trash = action === 'clone' ? undefined : await safeDirectory(root, ['.trash','pages'])
    // Trash names use the validated page UUID, independent of authored titles and slugs.
    const restored = action === 'restore' ? await readPage(join(trash!, `${request.pageId}.page.json`)) : undefined
    const active = restored ? join(directory, `${restored.slug}-${restored.id}.page.json`) : await activePath(directory,request.pageId)
    return withFileLock(active, async () => {
      const source = action === 'restore' ? join(trash!, `${request.pageId}.page.json`) : active
      const page = await readPage(source)
      if (page.id !== request.pageId || page.revision !== request.expectedRevision)
        throw new CopyOSPageConflictError('Page changed. Reload before managing it.')
      if (action === 'delete') {
        const destination = join(trash!, `${page.id}.page.json`)
        let created = false
        try { await link(active,destination); created = true }
        catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
          const original = await lstat(active), archived = await lstat(destination)
          if (!archived.isFile() || archived.isSymbolicLink() || original.dev !== archived.dev || original.ino !== archived.ino)
            throw new Error('Page trash already contains different content')
        }
        try { await unlink(active) }
        catch (error: unknown) {
          if (created) {
            try { await unlink(destination) }
            catch (rollback: unknown) { throw new AggregateError([error,rollback],'Could not finish or roll back page deletion') }
          }
          throw error
        }
        return page
      }
      if (action === 'restore') {
        await mkdir(directory, {recursive: true})
        await copyFile(source, active, constants.COPYFILE_EXCL)
        await unlink(source)
        return page
      }
      const now = new Date().toISOString(), id = randomUUID(), sections = new Map<string, string>(), variants = new Map<string, string>()
      const orphanId = (ids: Map<string,string>, old: string): string => {const id = randomUUID();ids.set(old,id);return id}
      const { conversion: _conversion, ...content } = page
      const clone = parseCopyOSPageDocument({...content, id, revision: 0, title: `${page.title.slice(0,153)} (copy)`,
        slug: `${page.slug.slice(0,78).replace(/-+$/, '')}-copy-${id}`, createdAt: now, updatedAt: now,
        sections: page.sections.map(section => {
          const sectionId = randomUUID(); sections.set(section.id, sectionId)
          const copied = section.variants.map(variant => {const variantId = randomUUID(); variants.set(variant.id, variantId);return {...variant,id:variantId,createdAt:now}})
          return {...section,id:sectionId,variants:copied,selectedVariantId:variants.get(section.selectedVariantId)}
        }),
        comments: page.comments?.map(comment => ({...comment,id:randomUUID(),sectionId:sections.get(comment.sectionId) ?? orphanId(sections,comment.sectionId),variantId:variants.get(comment.variantId) ?? orphanId(variants,comment.variantId)})),
      }, 'write')
      const destination = join(directory, `${clone.slug}-${id}.page.json`), temporary = join(directory, `.${id}.tmp`)
      await writeFile(temporary, `${JSON.stringify(clone,null,2)}\n`, {flag:'wx',mode:0o600})
      try { await copyFile(temporary,destination,constants.COPYFILE_EXCL) }
      finally { await unlink(temporary) }
      return clone
    })
  })
}
