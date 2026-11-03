/** Portable CRO experiment repository with explicit hypotheses and observed results. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { CopyOSAssetNotFoundError, CopyOSAssetRepository } from './assets.ts'
import { CopyOSPageNotFoundError, CopyOSPageRepository } from './pages.ts'
import { CopyOSScriptNotFoundError, CopyOSScriptRepository } from './scripts.ts'
import {
  COPYOS_EXPERIMENT_VERSION,
  type CopyOSExperimentCreateRequest,
  type CopyOSExperimentDocument,
  type CopyOSExperimentResultRequest,
} from './types.ts'

const text = z.string().trim().min(1).max(100_000)
const count = z.number().int().min(0).max(1_000_000_000)
const artifactKindSchema = z.enum(['page', 'copy', 'script', 'other'])
const resultSchema = z.object({
  controlVisitors: count,
  controlConversions: count,
  variantVisitors: count,
  variantConversions: count,
  outcome: z.enum(['control', 'variant', 'inconclusive']),
  analysis: text,
  recordedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.controlConversions > value.controlVisitors) {
    context.addIssue({ code: 'custom', path: ['controlConversions'], message: 'cannot exceed control visitors' })
  }
  if (value.variantConversions > value.variantVisitors) {
    context.addIssue({ code: 'custom', path: ['variantConversions'], message: 'cannot exceed variant visitors' })
  }
})

const experimentSchema = z.object({
  schema: z.literal('copyos.experiment'),
  version: z.literal(COPYOS_EXPERIMENT_VERSION),
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  status: z.enum(['draft', 'running', 'completed']),
  artifactKind: artifactKindSchema,
  artifactId: z.uuid().optional(),
  hypothesis: text,
  primaryMetric: z.string().trim().min(1).max(240),
  audience: text,
  controlLabel: z.string().trim().min(1).max(120),
  controlDescription: text,
  variantLabel: z.string().trim().min(1).max(120),
  variantDescription: text,
  result: resultSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.artifactKind === 'other' && value.artifactId !== undefined) {
    context.addIssue({ code: 'custom', path: ['artifactId'], message: 'must be omitted for other artifacts' })
  }
  if (value.artifactKind !== 'other' && value.artifactId === undefined) {
    context.addIssue({ code: 'custom', path: ['artifactId'], message: 'is required for a project artifact' })
  }
  if (value.status === 'completed' && value.result === undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'is required when an experiment is completed' })
  }
  if (value.status !== 'completed' && value.result !== undefined) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'is allowed only when an experiment is completed' })
  }
})

/** An experiment file, transition, relation, or submitted field is invalid. */
export class CopyOSExperimentFormatError extends Error {
  override readonly name = 'CopyOSExperimentFormatError'
}

/** A requested CRO experiment was not found. */
export class CopyOSExperimentNotFoundError extends Error {
  override readonly name = 'CopyOSExperimentNotFoundError'
}

type ExperimentCreate = Omit<CopyOSExperimentCreateRequest, 'workspaceId'>
type ResultCreate = Omit<CopyOSExperimentResultRequest, 'workspaceId'>

/** JSON-first experiment storage with validated transitions, atomic writes, and revisions. */
export class CopyOSExperimentRepository {
  /**
   * List experiments in newest-update order.
   * @param projectPath - Canonical CopyOS project root.
   * @returns validated experiment documents.
   */
  async list(projectPath: string): Promise<readonly CopyOSExperimentDocument[]> {
    const directory = join(projectPath, 'experiments')
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    const experiments = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.experiment.json'))
      .map(async entry => await this.read(join(directory, entry.name))))
    return experiments.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one experiment by stable id.
   * @param projectPath - Canonical CopyOS project root.
   * @param experimentId - Stable experiment identity.
   * @returns the validated complete experiment.
   */
  async get(projectPath: string, experimentId: string): Promise<CopyOSExperimentDocument> {
    const located = await this.find(projectPath, experimentId)
    if (located === undefined) throw new CopyOSExperimentNotFoundError(`experiment '${experimentId}' was not found`)
    return located.document
  }

  /**
   * Create a draft experiment and validate its optional project-artifact relationship.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Hypothesis, metric, audience, artifact, and two test definitions.
   * @returns the persisted draft experiment.
   */
  async create(projectPath: string, request: ExperimentCreate): Promise<CopyOSExperimentDocument> {
    await this.validateArtifact(projectPath, request.artifactKind, request.artifactId)
    const now = new Date().toISOString()
    const experiment = this.parse({
      schema: 'copyos.experiment', version: COPYOS_EXPERIMENT_VERSION, id: randomUUID(), status: 'draft',
      title: request.title, artifactKind: request.artifactKind,
      ...request.artifactId === undefined ? {} : { artifactId: request.artifactId },
      hypothesis: request.hypothesis, primaryMetric: request.primaryMetric, audience: request.audience,
      controlLabel: request.controlLabel, controlDescription: request.controlDescription,
      variantLabel: request.variantLabel, variantDescription: request.variantDescription,
      createdAt: now, updatedAt: now,
    })
    const directory = join(projectPath, 'experiments')
    await mkdir(directory, { recursive: true })
    await this.writeAtomic(join(directory, fileName(experiment)), experiment, 'wx')
    return experiment
  }

  /**
   * Move a draft experiment into its running state.
   * @param projectPath - Canonical CopyOS project root.
   * @param experimentId - Stable experiment identity.
   * @returns the updated running experiment.
   */
  async start(projectPath: string, experimentId: string): Promise<CopyOSExperimentDocument> {
    const located = await this.required(projectPath, experimentId)
    if (located.document.status !== 'draft') {
      throw new CopyOSExperimentFormatError(`experiment '${experimentId}' must be draft before it can start`)
    }
    return await this.update(projectPath, located, { ...located.document, status: 'running', updatedAt: new Date().toISOString() })
  }

  /**
   * Complete a running experiment with observed samples and a human-reviewed outcome.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Experiment identity, sample counts, reviewed outcome, and analysis.
   * @returns the completed experiment.
   */
  async recordResult(projectPath: string, request: ResultCreate): Promise<CopyOSExperimentDocument> {
    const located = await this.required(projectPath, request.experimentId)
    if (located.document.status !== 'running') {
      throw new CopyOSExperimentFormatError(`experiment '${request.experimentId}' must be running before results are recorded`)
    }
    const now = new Date().toISOString()
    return await this.update(projectPath, located, {
      ...located.document,
      status: 'completed',
      result: {
        controlVisitors: request.controlVisitors, controlConversions: request.controlConversions,
        variantVisitors: request.variantVisitors, variantConversions: request.variantConversions,
        outcome: request.outcome, analysis: request.analysis, recordedAt: now,
      },
      updatedAt: now,
    })
  }

  private async validateArtifact(projectPath: string, kind: ExperimentCreate['artifactKind'], id?: string): Promise<void> {
    if (kind === 'other') return
    if (id === undefined) throw new CopyOSExperimentFormatError('artifact id is required for a project artifact')
    try {
      if (kind === 'page') await new CopyOSPageRepository().get(projectPath, id)
      if (kind === 'script') await new CopyOSScriptRepository().get(projectPath, id)
      if (kind === 'copy') {
        const asset = await new CopyOSAssetRepository().get(projectPath, id)
        if (asset.kind !== 'copy') throw new CopyOSExperimentFormatError(`asset '${id}' is not copy`)
      }
    } catch (error: unknown) {
      if (error instanceof CopyOSPageNotFoundError || error instanceof CopyOSScriptNotFoundError
        || error instanceof CopyOSAssetNotFoundError) {
        throw new CopyOSExperimentFormatError(`${kind} artifact '${id}' was not found`)
      }
      throw error
    }
  }

  private async required(projectPath: string, experimentId: string): Promise<LocatedExperiment> {
    const located = await this.find(projectPath, experimentId)
    if (located === undefined) throw new CopyOSExperimentNotFoundError(`experiment '${experimentId}' was not found`)
    return located
  }

  private async find(projectPath: string, experimentId: string): Promise<LocatedExperiment | undefined> {
    const document = (await this.list(projectPath)).find(experiment => experiment.id === experimentId)
    return document === undefined
      ? undefined
      : { path: join(projectPath, 'experiments', fileName(document)), document }
  }

  private async update(projectPath: string, located: LocatedExperiment, value: unknown): Promise<CopyOSExperimentDocument> {
    const experiment = this.parse(value)
    await this.snapshot(projectPath, located.path, located.document.id)
    await this.writeAtomic(located.path, experiment)
    return experiment
  }

  private async read(path: string): Promise<CopyOSExperimentDocument> {
    try {
      return this.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error: unknown) {
      if (error instanceof CopyOSExperimentFormatError) throw error
      throw new CopyOSExperimentFormatError(`invalid CopyOS experiment at '${path}': ${errorMessage(error)}`)
    }
  }

  private parse(value: unknown): CopyOSExperimentDocument {
    try {
      return experimentSchema.parse(value)
    } catch (error: unknown) {
      throw new CopyOSExperimentFormatError(errorMessage(error))
    }
  }

  private async writeAtomic(destination: string, experiment: CopyOSExperimentDocument, flag: 'w' | 'wx' = 'w'): Promise<void> {
    const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(experiment, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      if (flag === 'wx') {
        await copyFile(temporary, destination, constants.COPYFILE_EXCL)
        await unlink(temporary)
      } else {
        await rename(temporary, destination)
      }
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async snapshot(projectPath: string, source: string, experimentId: string): Promise<void> {
    const directory = join(projectPath, '.copywriter', 'revisions', experimentId)
    await mkdir(directory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    await copyFile(source, join(directory, `${stamp}-${randomUUID()}.experiment.json`), constants.COPYFILE_EXCL)
  }
}

interface LocatedExperiment {
  readonly path: string
  readonly document: CopyOSExperimentDocument
}

function fileName(experiment: Pick<CopyOSExperimentDocument, 'id' | 'title'>): string {
  const slug = experiment.title.toLowerCase().normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 64) || 'experiment'
  return `${slug}-${experiment.id}.experiment.json`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
