/** File-backed CopyOS skill management over the Harness skill roots. */

import { access, mkdir, readdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import type {
  CopyOSSkillDocument,
  CopyOSSkillEnabledRequest,
  CopyOSSkillImportRequest,
  CopyOSSkillSaveRequest,
  CopyOSSkillScope,
  CopyOSWorkflowId,
} from './types.ts'

const ACTIVE_FILE = 'SKILL.md'
const DISABLED_FILE = 'SKILL.md.disabled'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const WORKFLOWS = [
  'copywriter',
  'landing-page-builder',
  'canvas',
  'docs',
  'website-clone',
  'existing-page',
  'strategy',
  'cro-analyst',
  'ad-scriptwriter',
  'creative-strategist',
  'researcher',
] as const satisfies readonly CopyOSWorkflowId[]

const workflowSchema = z.enum(WORKFLOWS)
const frontmatterSchema = z.object({
  name: z.string().regex(SKILL_NAME),
  description: z.string().trim().min(1).max(4_000),
  whenToUse: z.string().trim().max(4_000).optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
  metadata: z.object({
    copyos: z.object({ workflows: z.array(workflowSchema).max(WORKFLOWS.length).optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough()

/** Submitted skill content or an existing skill file is invalid. */
export class CopyOSSkillFormatError extends Error {
  override readonly name = 'CopyOSSkillFormatError'
}

/** Requested skill is missing or its destination already exists. */
export class CopyOSSkillConflictError extends Error {
  override readonly name = 'CopyOSSkillConflictError'
}

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly workflows: readonly CopyOSWorkflowId[]
}

/** Repository for project-scoped and universal CopyOS skill bundles. */
export class CopyOSSkillRepository {
  /** @param universalSkillsRoot - Repository-owned skills shared by every CopyOS project. */
  constructor(private readonly universalSkillsRoot: string) {}

  /**
   * Read all editable project and universal skills without resolving precedence.
   * @param projectPath - Canonical CopyOS project root.
   * @returns project and universal skill documents in stable display order.
   */
  async list(projectPath: string): Promise<CopyOSSkillDocument[]> {
    const [project, global] = await Promise.all([
      this.listRoot(projectPath, 'project'),
      this.listRoot(projectPath, 'global'),
    ])
    return [...project, ...global].sort((left, right) => left.name.localeCompare(right.name)
      || left.scope.localeCompare(right.scope))
  }

  /**
   * Create or replace one canonical skill bundle while preserving its resources.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - canonical skill fields and target scope.
   * @returns the stored skill document.
   */
  async save(projectPath: string, request: Omit<CopyOSSkillSaveRequest, 'workspaceId'>): Promise<CopyOSSkillDocument> {
    const normalized = validateSave(request)
    const root = this.root(projectPath, normalized.scope)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const originalName = request.originalName ?? normalized.name
    requireSkillName(originalName)
    let directory = join(root, originalName)
    const destinationDirectory = join(root, normalized.name)
    if (originalName !== normalized.name) {
      if (await exists(destinationDirectory)) {
        throw new CopyOSSkillConflictError(`skill '${normalized.name}' already exists in ${normalized.scope} skills`)
      }
      if (await exists(directory)) await rename(directory, destinationDirectory)
      directory = destinationDirectory
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const active = join(directory, ACTIVE_FILE)
    const disabled = join(directory, DISABLED_FILE)
    const activeExists = await exists(active)
    const disabledExists = await exists(disabled)
    if (activeExists && disabledExists) {
      throw new CopyOSSkillConflictError(`skill '${normalized.name}' has both enabled and disabled instruction files`)
    }
    if (normalized.enabled && disabledExists) await rename(disabled, active)
    if (!normalized.enabled && activeExists) await rename(active, disabled)
    const path = normalized.enabled ? active : disabled
    await writeFileAtomic(path, renderSkill(normalized), { mode: 0o600, dirMode: 0o700 })
    return { ...normalized, path }
  }

  /**
   * Import one complete Markdown skill as an enabled bundle.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Markdown source and target scope.
   * @returns the imported skill document.
   */
  async import(projectPath: string, request: Omit<CopyOSSkillImportRequest, 'workspaceId'>): Promise<CopyOSSkillDocument> {
    const parsed = parseSkill(request.markdown)
    return await this.save(projectPath, {
      scope: request.scope,
      name: parsed.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      content: parsed.content,
      enabled: true,
      modelInvocable: parsed.modelInvocable,
      userInvocable: parsed.userInvocable,
      workflows: parsed.workflows,
    })
  }

  /**
   * Switch catalog visibility by renaming the instruction file in place.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Skill identity, scope, and desired enabled state.
   * @returns the updated skill document.
   */
  async setEnabled(
    projectPath: string,
    request: Omit<CopyOSSkillEnabledRequest, 'workspaceId'>,
  ): Promise<CopyOSSkillDocument> {
    requireSkillName(request.name)
    const directory = join(this.root(projectPath, request.scope), request.name)
    const active = join(directory, ACTIVE_FILE)
    const disabled = join(directory, DISABLED_FILE)
    const source = request.enabled ? disabled : active
    const destination = request.enabled ? active : disabled
    if (!await exists(source)) {
      if (!await exists(destination)) throw new CopyOSSkillConflictError(`skill '${request.name}' was not found`)
    } else {
      if (await exists(destination)) {
        throw new CopyOSSkillConflictError(`skill '${request.name}' has conflicting instruction files`)
      }
      await rename(source, destination)
    }
    return await this.read(directory, request.scope, request.enabled)
  }

  private async listRoot(projectPath: string, scope: CopyOSSkillScope): Promise<CopyOSSkillDocument[]> {
    const root = this.root(projectPath, scope)
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }
    const skills: CopyOSSkillDocument[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue
      const directory = join(root, entry.name)
      const active = await exists(join(directory, ACTIVE_FILE))
      const disabled = await exists(join(directory, DISABLED_FILE))
      if (active && disabled) {
        throw new CopyOSSkillFormatError(`skill '${entry.name}' has both enabled and disabled instruction files`)
      }
      if (!active && !disabled) continue
      skills.push(await this.read(directory, scope, active))
    }
    return skills
  }

  private async read(directory: string, scope: CopyOSSkillScope, enabled: boolean): Promise<CopyOSSkillDocument> {
    const path = join(directory, enabled ? ACTIVE_FILE : DISABLED_FILE)
    let parsed: ParsedSkill
    try {
      parsed = parseSkill(await readFile(path, 'utf8'))
    } catch (error: unknown) {
      if (error instanceof CopyOSSkillFormatError) throw error
      throw new CopyOSSkillFormatError(`invalid CopyOS skill at '${path}': ${errorMessage(error)}`)
    }
    return { ...parsed, scope, enabled, path }
  }

  private root(projectPath: string, scope: CopyOSSkillScope): string {
    return scope === 'project' ? join(projectPath, 'skills') : this.universalSkillsRoot
  }
}

function validateSave(request: Omit<CopyOSSkillSaveRequest, 'workspaceId'>): Omit<CopyOSSkillDocument, 'path'> {
  requireSkillName(request.name)
  const description = request.description.trim()
  const whenToUse = request.whenToUse.trim()
  const content = request.content.trim()
  if (description.length === 0 || description.length > 4_000) {
    throw new CopyOSSkillFormatError('skill description must contain between 1 and 4000 characters')
  }
  if (whenToUse.length > 4_000) throw new CopyOSSkillFormatError('skill usage guidance must be at most 4000 characters')
  if (content.length === 0 || content.length > 500_000) {
    throw new CopyOSSkillFormatError('skill instructions must contain between 1 and 500000 characters')
  }
  if (!request.modelInvocable && !request.userInvocable) {
    throw new CopyOSSkillFormatError('a skill must allow automatic or explicit invocation')
  }
  const workflows = workflowSchema.array().max(WORKFLOWS.length).parse([...new Set(request.workflows)])
  return {
    name: request.name,
    description,
    whenToUse,
    content,
    scope: request.scope,
    enabled: request.enabled,
    modelInvocable: request.modelInvocable,
    userInvocable: request.userInvocable,
    workflows,
  }
}

function parseSkill(markdown: string): ParsedSkill {
  const normalized = markdown.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new CopyOSSkillFormatError('skill Markdown must begin with YAML frontmatter')
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) throw new CopyOSSkillFormatError('skill Markdown frontmatter is not closed')
  const after = normalized.slice(end + 4)
  if (after !== '' && !after.startsWith('\n')) throw new CopyOSSkillFormatError('skill frontmatter closing marker must occupy its own line')
  try {
    const data = frontmatterSchema.parse(parseYaml(normalized.slice(4, end)))
    const content = after.replace(/^\n/u, '').trim()
    if (content.length === 0 || content.length > 500_000) {
      throw new CopyOSSkillFormatError('skill instructions must contain between 1 and 500000 characters')
    }
    const modelInvocable = data['disable-model-invocation'] !== true
    const userInvocable = data['user-invocable'] !== false
    if (!modelInvocable && !userInvocable) {
      throw new CopyOSSkillFormatError('a skill must allow automatic or explicit invocation')
    }
    return {
      name: data.name,
      description: data.description,
      whenToUse: data.whenToUse ?? '',
      content,
      modelInvocable,
      userInvocable,
      workflows: data.metadata?.copyos?.workflows ?? [],
    }
  } catch (error: unknown) {
    if (error instanceof CopyOSSkillFormatError) throw error
    throw new CopyOSSkillFormatError(`invalid skill Markdown: ${errorMessage(error)}`)
  }
}

function renderSkill(skill: Omit<CopyOSSkillDocument, 'path'>): string {
  const frontmatter = {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === '' ? {} : { whenToUse: skill.whenToUse }),
    'disable-model-invocation': !skill.modelInvocable,
    'user-invocable': skill.userInvocable,
    ...(skill.workflows.length === 0 ? {} : { metadata: { copyos: { workflows: skill.workflows } } }),
  }
  return `---\n${stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${skill.content.trim()}\n`
}

function requireSkillName(name: string): void {
  if (!SKILL_NAME.test(name)) {
    throw new CopyOSSkillFormatError('skill name must use lowercase kebab-case')
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
