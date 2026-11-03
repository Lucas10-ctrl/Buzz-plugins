/** Portable project-level style guide repository. */

import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { extractStyleTokenContexts } from './style-token-contexts.ts'
import {
  COPYOS_STYLE_GUIDE_VERSION,
  type CopyOSStyleGuideDocument,
  type CopyOSStyleGuideSaveRequest,
  type CopyOSStyleGuideTokens,
} from './types.ts'

/** Stable, human-readable style guide file at the project root. */
export const COPYOS_STYLE_GUIDE_FILE = 'copyos.style-guide.json'

const tokensSchema = z
  .object({
    colors: z.array(z.string()).max(128),
    fonts: z.array(z.string()).max(64),
    fontSizes: z.array(z.string()).max(64).default([]),
    fontWeights: z.array(z.string()).max(32).default([]),
    lineHeights: z.array(z.string()).max(64).default([]),
    letterSpacings: z.array(z.string()).max(64).default([]),
    spacing: z.array(z.string()).max(128).default([]),
    radii: z.array(z.string()).max(64).default([]),
    shadows: z.array(z.string()).max(64).default([]),
    breakpoints: z.array(z.string()).max(32).default([]),
    contentWidths: z.array(z.string()).max(64).default([]),
    durations: z.array(z.string()).max(32).default([]),
    easings: z.array(z.string()).max(32).default([]),
    rootFontSize: z.string().max(500).optional(),
    customProperties: z.record(z.string(), z.string()),
    customPropertyContexts: z
      .array(
        z
          .object({
            key: z.string().max(20000),
            name: z.string().max(200),
            selectors: z.array(z.string().max(500)).max(16),
            conditions: z.array(z.string().max(500)).max(16),
            rootFontSize: z.string().max(500).optional(),
            customProperties: z.record(z.string(), z.string().max(500)),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    customPropertyWarnings: z.array(z.string().max(500)).max(64).optional(),
  })
  .strict()

const styleGuideSchema = z
  .object({
    schema: z.literal('copyos.style-guide'),
    version: z.literal(COPYOS_STYLE_GUIDE_VERSION),
    name: z.string().trim().min(1).max(120),
    sourceType: z.enum(['css', 'file', 'website']),
    sourceLabel: z.string().trim().min(1).max(2_000),
    sourceUrl: z.url().max(4_096).optional(),
    css: z.string().max(1_000_000),
    tokens: tokensSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

/** A stored style guide or submitted CSS source is invalid. */
export class CopyOSStyleGuideFormatError extends Error {
  override readonly name = 'CopyOSStyleGuideFormatError'
}

type SaveRequest = Omit<CopyOSStyleGuideSaveRequest, 'workspaceId'>

/** Atomic repository for the single visual system owned by a CopyOS project. */
export class CopyOSStyleGuideRepository {
  /**
   * Read the current project style guide.
   * @param projectPath - Canonical CopyOS project root.
   * @returns the stored guide, or `undefined` when none exists.
   */
  async get(projectPath: string): Promise<CopyOSStyleGuideDocument | undefined> {
    const path = join(projectPath, COPYOS_STYLE_GUIDE_FILE)
    let source: string
    try {
      source = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    try {
      const document = styleGuideSchema.parse(JSON.parse(source))
      return {
        ...document,
        tokens: {
          ...document.tokens,
          customPropertyContexts: undefined,
          customPropertyWarnings: undefined,
          rootFontSize: undefined,
          ...extractStyleTokenContexts(document.css),
        },
      }
    } catch (error: unknown) {
      throw new CopyOSStyleGuideFormatError(`invalid CopyOS style guide at '${path}': ${errorMessage(error)}`)
    }
  }

  /**
   * Replace the project style guide while retaining its original creation date.
   * @param projectPath - Canonical CopyOS project root.
   * @param request - Complete CSS source and identifying metadata.
   * @returns the stored style-guide document.
   */
  async save(projectPath: string, request: SaveRequest): Promise<CopyOSStyleGuideDocument> {
    const existing = await this.get(projectPath)
    const now = new Date().toISOString()
    try {
      const document = styleGuideSchema.parse({
        schema: 'copyos.style-guide',
        version: COPYOS_STYLE_GUIDE_VERSION,
        name: request.name,
        sourceType: request.sourceType,
        sourceLabel: request.sourceLabel,
        ...(request.sourceUrl === undefined || request.sourceUrl.trim() === ''
          ? {}
          : { sourceUrl: request.sourceUrl }),
        css: request.css,
        tokens: extractStyleTokens(request.css),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      await this.writeAtomic(projectPath, document)
      return document
    } catch (error: unknown) {
      if (error instanceof CopyOSStyleGuideFormatError) throw error
      throw new CopyOSStyleGuideFormatError(`invalid CopyOS style guide: ${errorMessage(error)}`)
    }
  }

  private async writeAtomic(projectPath: string, document: CopyOSStyleGuideDocument): Promise<void> {
    const destination = join(projectPath, COPYOS_STYLE_GUIDE_FILE)
    const temporary = join(projectPath, `.${COPYOS_STYLE_GUIDE_FILE}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await rename(temporary, destination)
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}

/**
 * Extract a compact, deterministic token inventory without executing imported CSS.
 * @param css - Untrusted CSS text to inspect without evaluation.
 * @returns bounded color, font, and custom-property tokens.
 */
export function extractStyleTokens(css: string): CopyOSStyleGuideTokens {
  if (css.length > 1_000_000) throw new CopyOSStyleGuideFormatError('CSS exceeds the 1 MB style-guide limit')
  const scoped = extractStyleTokenContexts(css)

  const colors = uniqueMatches(css, /#[\da-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\([^)]{1,120}\)/g, 128)
  const fonts: string[] = []
  for (const match of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const value = match[1]?.trim()
    if (value !== undefined && value !== '' && !fonts.includes(value)) fonts.push(value.slice(0, 300))
    if (fonts.length === 64) break
  }
  return {
    colors,
    fonts,
    fontSizes: declarationValues(css, /font-size/i, 64),
    fontWeights: declarationValues(css, /font-weight/i, 32),
    lineHeights: declarationValues(css, /line-height/i, 64),
    letterSpacings: declarationValues(css, /letter-spacing/i, 64),
    spacing: declarationValues(css, /(?:margin|padding|gap|row-gap|column-gap)/i, 128),
    radii: declarationValues(css, /border(?:-[a-z]+)*-radius|border-radius/i, 64),
    shadows: declarationValues(css, /(?:box-shadow|text-shadow)/i, 64),
    breakpoints: uniqueMatches(css, /@media[^{}]*(?:min|max)-width\s*:\s*[^)]+/gi, 32),
    contentWidths: declarationValues(
      css.replace(/@media[^{}]*\{/gi, '@media{'),
      /(?:max-width|inline-size|max-inline-size)/i,
      64,
    ),
    durations: uniqueMatches(css, /\b\d*\.?\d+(?:ms|s)\b/g, 32),
    easings: uniqueMatches(
      css,
      /\b(?:linear|ease(?:-in|-out|-in-out)?|cubic-bezier\([^)]{1,120}\)|steps\([^)]{1,120}\))/gi,
      32,
    ),
    ...scoped,
  }
}

function declarationValues(source: string, property: RegExp, limit: number): readonly string[] {
  const values: string[] = []
  const declaration = /([a-zA-Z-]+)\s*:\s*([^;}{]+)/g
  for (const match of source.matchAll(declaration)) {
    const name = match[1]
    const value = match[2]?.trim()
    property.lastIndex = 0
    if (
      name !== undefined &&
      value !== undefined &&
      value !== '' &&
      property.test(name) &&
      !values.includes(value)
    ) {
      values.push(value.slice(0, 500))
    }
    if (values.length === limit) break
  }
  return values
}

function uniqueMatches(source: string, pattern: RegExp, limit: number): readonly string[] {
  const values: string[] = []
  for (const match of source.matchAll(pattern)) {
    const value = match[0]
    if (!values.includes(value)) values.push(value)
    if (values.length === limit) break
  }
  return values
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
