/** Map the shipped Kiwi state-group encoding without inferring variants from display names. */
import { randomUUID } from 'node:crypto'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { GUID } from '@open-pencil/kiwi/fig'
import { z } from 'zod'
import { formatDesignVariantName } from './design-variant-names.ts'
import { designVariantIssues } from './design-variant-validation.ts'
import type { CopyOSDesignNode, CopyOSDesignVariantAxis } from './types.ts'

// .fig embeds its own Kiwi schema, so validate these newer fields before trusting their runtime shapes.
const guidSchema = z.object({
  sessionID: z.number().int().min(0).max(4294967295),
  localID: z.number().int().min(0).max(4294967295),
})
const figVariantRecordSchema = z.object({
  type: z.string().optional(),
  isStateGroup: z.boolean().optional(),
  componentPropDefs: z
    .array(
      z.object({
        id: guidSchema.optional(),
        name: z.string().optional(),
        type: z.string().optional(),
        isDeleted: z.boolean().optional(),
      }),
    )
    .optional(),
  variantPropSpecs: z
    .array(z.object({ propDefId: guidSchema.optional(), value: z.string().optional() }))
    .optional(),
  stateGroupPropertyValueOrders: z
    .array(z.object({ property: z.string(), values: z.array(z.string()) }))
    .optional(),
})
const invalidTable =
  'Inconsistent component variant tables are retained as editable frames and main components'
const guid = (value: GUID | undefined): string =>
  value ? `${value.sessionID}:${value.localID}` : ''
const validName = (value: string): boolean =>
  value.length > 0 && value.length <= 120 && value.trim() === value

/** Preserve valid serialized state groups as sparse component tables; retain invalid groups as visual containers.
 * @param nodes - Imported editable geometry before variant metadata is attached.
 * @param rawById - Decoded records keyed by their new native layer identities.
 * @param warn - Import report collector; invalid tables never silently acquire guessed variant semantics.
 * @returns Nodes with valid state groups and member tuples, preserving every layer identity and geometry.
 */
export function importFigVariants(
  nodes: CopyOSDesignNode[],
  rawById: ReadonlyMap<string, NodeChange>,
  warn: (message: string) => void,
): CopyOSDesignNode[] {
  const replacements = new Map<string, CopyOSDesignNode>()
  const children = new Map<string, CopyOSDesignNode[]>()
  for (const node of nodes)
    if (node.parentId) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }
  for (const set of nodes) {
    const original = rawById.get(set.id)
    if (!original?.isStateGroup) continue
    const parsed = figVariantRecordSchema.safeParse(original)
    if (!parsed.success) {
      warn(invalidTable)
      continue
    }
    const raw = parsed.data
    const members = children.get(set.id) ?? []
    const definitions = (raw.componentPropDefs ?? []).filter(
      definition => definition.type === 'VARIANT' && !definition.isDeleted,
    )
    let invalid =
      raw.type !== 'FRAME' ||
      members.length < 1 ||
      members.length > 1000 ||
      members.some(member => member.kind !== 'component') ||
      definitions.length < 1 ||
      definitions.length > 20
    const definitionsByName = new Map(
      definitions.map(definition => [definition.name ?? '', definition]),
    )
    if (
      definitionsByName.size !== definitions.length ||
      definitions.some(definition => !guid(definition.id) || !validName(definition.name ?? ''))
    )
      invalid = true
    const order = raw.stateGroupPropertyValueOrders
    if (
      order &&
      (order.length !== definitions.length ||
        new Set(order.map(item => item.property)).size !== order.length ||
        order.some(item => !definitionsByName.has(item.property)))
    )
      invalid = true
    const ordered = order
      ? order
        .map(item => definitionsByName.get(item.property))
        .filter(item => item !== undefined)
      : definitions
    const rawAxes = new Map<string, CopyOSDesignVariantAxis>()
    for (const definition of ordered) {
      const key = guid(definition.id)
      if (rawAxes.has(key)) invalid = true
      rawAxes.set(key, {
        id: randomUUID(),
        name: definition.name ?? '',
        values: [...(order?.find(item => item.property === definition.name)?.values ?? [])],
      })
    }
    const tuples = new Map<string, { axisId: string; value: string }[]>()
    for (const member of members) {
      const parsedMember = figVariantRecordSchema.safeParse(rawById.get(member.id))
      if (!parsedMember.success) {
        invalid = true
        continue
      }
      const specs = parsedMember.data.variantPropSpecs ?? []
      const values = new Map<string, string>()
      if (specs.length !== definitions.length) invalid = true
      for (const spec of specs) {
        const key = guid(spec.propDefId),
          axis = rawAxes.get(key)
        if (!axis || values.has(key) || typeof spec.value !== 'string' || !validName(spec.value)) {
          invalid = true
          continue
        }
        values.set(key, spec.value)
        if (!order && !axis.values.includes(spec.value)) axis.values.push(spec.value)
        if (order && !axis.values.includes(spec.value)) invalid = true
      }
      tuples.set(
        member.id,
        [...rawAxes].flatMap(([key, axis]) => {
          const value = values.get(key)
          return value === undefined ? [] : [{ axisId: axis.id, value }]
        }),
      )
    }
    const axes = [...rawAxes.values()]
    if (
      axes.some(
        axis =>
          axis.values.length < 1 ||
          axis.values.length > 100 ||
          new Set(axis.values).size !== axis.values.length ||
          axis.values.some(value => !validName(value)),
      )
    )
      invalid = true
    const candidate: CopyOSDesignNode[] = [
      { ...set, kind: 'component-set', componentSet: { axes } },
      ...members.map(member => ({
        ...member,
        variantValues: tuples.get(member.id),
        name: invalid ? member.name : formatDesignVariantName(axes, tuples.get(member.id) ?? []),
      })),
    ]
    // Validate each disjoint authored table before attaching it; a whole-scene scan per set would be quadratic.
    if (!invalid && !designVariantIssues({ nodes: candidate }).length)
      for (const node of candidate) replacements.set(node.id, node)
    else warn(invalidTable)
  }
  return replacements.size ? nodes.map(node => replacements.get(node.id) ?? node) : nodes
}
