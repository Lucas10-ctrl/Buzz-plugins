/** Shared semantic validation for local component sets and sparse variant tables. */
import { DESIGN_NODE_NAME_MAX_LENGTH } from './design-variant-names.ts'
import { regexes } from 'zod'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

const UUID = regexes.uuid()
const validName = (value: string): boolean =>
  value.length > 0 && value.length <= 120 && value.trim() === value

/** Describe invalid component-set ownership, axis identities and sparse variant combinations.
 * @param document - Candidate native design before rendering or publication.
 * @returns At most 100 semantic errors, with no mutation or inferred variant fallback.
 */
export function designVariantIssues(document: Pick<CopyOSDesignDocument, 'nodes'>): string[] {
  const issues: string[] = []
  const issue = (message: string): void => {
    if (issues.length < 100) issues.push(message)
  }
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  const reserved = new Set(
    document.nodes.flatMap(node => [
      node.id,
      ...(node.componentProperties ?? []).map(property => property.id),
    ]),
  )
  const axes = new Set<string>()
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of document.nodes) {
    if (node.name.length > DESIGN_NODE_NAME_MAX_LENGTH) issue('Layer names support at most 32768 characters')
    if (node.parentId) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }
    if (node.componentSet !== undefined && node.kind !== 'component-set')
      issue('Only component sets may define variant axes')
    if (node.kind === 'instance' && nodes.get(node.componentId ?? '')?.kind === 'component-set')
      issue('Instances must reference concrete component variants, not component sets')
    const parent = nodes.get(node.parentId ?? '')
    if (
      node.variantValues !== undefined &&
      (node.kind !== 'component' || parent?.kind !== 'component-set')
    )
      issue('Variant values require direct component membership in a component set')
    if (parent?.kind === 'component-set' && node.kind !== 'component')
      issue('Component sets contain only direct component variants')
  }
  for (const set of document.nodes) {
    if (set.kind !== 'component-set') continue
    if (!set.componentSet) {
      issue('Component sets require variant axes')
      continue
    }
    const definitions = set.componentSet.axes
    if (definitions.length < 1 || definitions.length > 20)
      issue('Component sets require 1 to 20 axes')
    const names = new Set<string>()
    const definitionsById = new Map(definitions.map(axis => [axis.id, axis]))
    for (const axis of definitions) {
      if (!UUID.test(axis.id) || reserved.has(axis.id) || axes.has(axis.id))
        issue('Variant axis identities must be globally unique UUIDs')
      axes.add(axis.id)
      if (!validName(axis.name) || names.has(axis.name))
        issue('Variant axis names require unique trimmed names of 1 to 120 characters')
      names.add(axis.name)
      if (
        axis.values.length < 1 ||
        axis.values.length > 100 ||
        new Set(axis.values).size !== axis.values.length ||
        axis.values.some(value => !validName(value))
      )
        issue('Variant axes require 1 to 100 unique trimmed values of 1 to 120 characters')
    }
    const members = children.get(set.id) ?? []
    if (members.length < 1 || members.length > 1000)
      issue('Component sets require 1 to 1000 variants')
    const tuples = new Set<string>()
    for (const member of members) {
      const values = member.variantValues ?? []
      if (
        values.length !== definitions.length ||
        new Set(values.map(value => value.axisId)).size !== values.length
      )
        issue('Variant members require exactly one value for every axis')
      for (const value of values)
        if (!definitionsById.get(value.axisId)?.values.includes(value.value))
          issue('Variant member refers to an unknown axis or value')
      const byAxis = new Map(values.map(value => [value.axisId, value.value]))
      const tuple = JSON.stringify(definitions.map(axis => byAxis.get(axis.id)))
      if (tuples.has(tuple)) issue('Component sets require unique variant combinations')
      tuples.add(tuple)
    }
  }
  return issues
}

/** Check whether authored component-set membership and sparse combinations are valid.
 * @param document - Candidate native design before rendering or publication.
 * @returns Whether the variant table is complete and unambiguous for its existing members.
 */
export function designVariantsValid(document: CopyOSDesignDocument): boolean {
  return designVariantIssues(document).length === 0
}
