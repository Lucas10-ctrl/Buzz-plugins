/** Short, readable failure text for Figma decoding, which can raise validation reports far larger than any message channel. */
import { z } from 'zod'

/** Characters kept from one decoding failure; longer text is cut and marked. */
const MAX_SUMMARY = 4000
/** Kinds of validation issue listed before the remainder is counted. */
const LISTED_ISSUES = 8

/**
 * Summarize a decoding failure for the user: validation reports become a count plus each kind of issue (field and message) with
 * how often it occurs and one example path.
 * @param error - Value thrown while decoding.
 * @returns At most 4,000 characters.
 */
export function figDecodeErrorSummary(error: unknown): string {
  let text: string
  if (error instanceof z.ZodError) {
    // Group by field name and message, so one report shows every kind of problem with how many layers have it.
    const groups = new Map<string, { example: string; count: number }>()
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? '(root)')
      const key = `${field}: ${issue.message}`
      const group = groups.get(key)
      if (group) group.count++
      else groups.set(key, { example: issue.path.map(String).join('.') || '(root)', count: 1 })
    }
    const listed = [...groups.entries()].slice(0, LISTED_ISSUES)
      .map(([key, group]) => `${key} (${String(group.count)}×, e.g. ${group.example})`)
    const more = groups.size - listed.length
    text = `The converted layers failed validation (${String(error.issues.length)} issue${error.issues.length === 1 ? '' : 's'}): ` +
      listed.join('; ') + (more > 0 ? `; and ${String(more)} more kinds` : '')
  } else text = error instanceof Error ? error.message : 'The Figma data could not be decoded'
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text
}
