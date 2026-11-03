import { designComponentPropertyDefinitions, designComponentPropertyTarget } from './design-component-property-definitions.ts'
/** Browser-safe semantic validation for reusable component controls and their local values. */
import { designComponentOverrideTarget, designComponentPropertyContextPath } from './design-component-properties.ts'
import { designComponentGraphIssues } from './design-component-graph.ts'
import { regexes } from 'zod'
import type { CopyOSDesignDocument } from './types.ts'

const UUID = regexes.uuid()

/** Describe invalid component-control ownership, references, types, collisions and resource limits.
 * @param document - Candidate scene after shared property reconciliation.
 * @returns Bounded semantic errors; UUID syntax and property semantics follow native document parsing.
 */
export function designComponentPropertyIssues(document: CopyOSDesignDocument): string[] {
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  const issues: string[] = []
  const issue = (message: string): void => {
    if (issues.length < 100) issues.push(message)
  }
  const propertyIds = new Set<string>()
  let propertyTargets = 0,
    propertyValues = 0,
    propertyText = 0,
    propertyCount = 0
  for (const node of document.nodes) {
    if (node.componentProperties !== undefined && node.kind !== 'component' && node.kind !== 'component-set')
      issue('Only components and component sets may define component properties')
    if (node.componentPropertyValues !== undefined && node.kind !== 'instance')
      issue('Only instances may set component property values')
    if ((node.componentProperties?.length ?? 0) > 100)
      issue('A component supports at most 100 properties')
    if ((node.componentPropertyValues?.length ?? 0) > 100)
      issue('An instance supports at most 100 property values')
    const names = new Set<string>(),
      controlled = new Set<string>()
    for (const property of node.componentProperties ?? []) {
      if (++propertyCount > 10000) {
        issue('Design exceeds 10000 component property definitions')
        return issues
      }
      if (nodes.has(property.id))
        issue('Component property identities cannot collide with layer identities')
      if (!UUID.test(property.id)) issue('Component property identities must be UUIDs')
      if (propertyIds.has(property.id)) issue('Duplicate component property identity')
      propertyIds.add(property.id)
      const name = property.name.trim()
      if (!name || name.length > 120) issue('Component property names require 1 to 120 characters')
      if (names.has(name)) issue(`Duplicate component property name for ${node.name}`)
      names.add(name)
      if (typeof property.defaultValue !== (property.type === 'boolean' ? 'boolean' : 'string'))
        issue('Invalid component property default type')
      if (property.type === 'text' && typeof property.defaultValue === 'string') {
        propertyText += property.defaultValue.length
        if (property.defaultValue.length > 100000)
          issue('Component property text exceeds 100000 characters')
      }
      if (!['text', 'boolean', 'instance-swap'].includes(property.type))
        issue('Unsupported component property type')
      if (property.type === 'instance-swap') {
        if (
          !UUID.test(property.defaultValue) ||
          nodes.get(property.defaultValue)?.kind !== 'component'
        )
          issue('Instance-swap defaults require a local component')
        const preferred = property.preferredValues ?? []
        if (preferred.length > 100 || new Set(preferred).size !== preferred.length)
          issue('Instance-swap preferred values require at most 100 unique components')
        for (const id of preferred)
          if (!UUID.test(id) || nodes.get(id)?.kind !== 'component')
            issue('Missing preferred component')
      }
      if (property.targets.length > 100) issue('A component property supports at most 100 targets')
      for (const path of property.targets) {
        if (++propertyTargets > 10000) {
          issue('Design exceeds 10000 component property targets')
          return issues
        }
        if (!path.length || path.length > 64) {
          issue('Component property paths require 1 to 64 identities')
          continue
        }
        if (path.some(id => !UUID.test(id)))
          issue('Component property target identities must be UUIDs')
        const key = property.type + ':' + JSON.stringify(path)
        if (controlled.has(key)) issue(`Duplicate component property target for ${node.name}`)
        controlled.add(key)
        const target = designComponentPropertyTarget(document, node, path)
        if (!target) issue(`Missing component property target for ${node.name}`)
        else if (property.type === 'text' && target.kind !== 'text')
          issue('Text component properties require text targets')
        else if (property.type === 'instance-swap' && target.kind !== 'instance')
          issue('Instance-swap properties require instance targets')
      }
    }
    if (node.kind === 'component') {
      const effective = designComponentPropertyDefinitions(document, node.id)
      if (effective.length > 100) issue('A component supports at most 100 effective properties')
      const names = new Set<string>(), fields = new Set<string>()
      for (const property of effective) {
        if (names.has(property.name.trim())) issue('Duplicate effective component property name')
        names.add(property.name.trim())
        for (const path of property.targets) {
          const key = property.type + ':' + JSON.stringify(path)
          if (fields.has(key)) issue('Component target field already has a property')
          fields.add(key)
        }
      }
    }
    const values = new Set<string>()
    const definitions = new Map(
      designComponentPropertyDefinitions(document,node.componentId ?? '').map(property => [
        property.id,
        property,
      ]),
    )
    const controlledFields = new Set(
      [...definitions.values()].flatMap(property =>
        property.targets.map(path => property.type + ':' + JSON.stringify(path)),
      ),
    )
    for (const override of node.instanceOverrides ?? []) {
      if (
        override.componentId !== undefined &&
        (!UUID.test(override.componentId) || nodes.get(override.componentId)?.kind !== 'component')
      )
        issue('Contextual replacements require a local component')
      const path = JSON.stringify(override.path)
      if (
        (override.text !== undefined && controlledFields.has('text:' + path)) ||
        (override.visible !== undefined && controlledFields.has('boolean:' + path)) ||
        (override.componentId !== undefined && controlledFields.has('instance-swap:' + path))
      )
        issue('Controlled component property fields must use property values')
    }
    for (const value of node.componentPropertyValues ?? []) {
      if (++propertyValues > 10000) {
        issue('Design exceeds 10000 component property values')
        return issues
      }
      if (!UUID.test(value.propertyId)) issue('Component property value identities must be UUIDs')
      if (values.has(value.propertyId)) issue(`Duplicate component property value for ${node.name}`)
      values.add(value.propertyId)
      const definition = definitions.get(value.propertyId)
      if (!definition) issue(`Missing component property definition for ${node.name}`)
      else if (typeof value.value !== (definition.type === 'boolean' ? 'boolean' : 'string'))
        issue(`Invalid component property value type for ${node.name}`)
      if (
        definition?.type === 'instance-swap' &&
        (typeof value.value !== 'string' ||
          !UUID.test(value.value) ||
          nodes.get(value.value)?.kind !== 'component')
      )
        issue('Instance-swap values require a local component')
      if (definition?.type !== 'instance-swap' && typeof value.value === 'string') {
        propertyText += value.value.length
        if (value.value.length > 100000) issue('Component property text exceeds 100000 characters')
      }
    }
    if (propertyText > 8000000) {
      issue('Component property text exceeds 8000000 characters')
      return issues
    }
  }
  if (!issues.length) issues.push(...designComponentGraphIssues(document).slice(0, 100))
  if (!issues.length)
    for (const node of document.nodes)
      for (const override of node.instanceOverrides ?? []) {
        if (
          override.componentId !== undefined &&
          designComponentOverrideTarget(document, node, override.path)?.kind !== 'instance'
        )
          issue('Contextual component replacements require instance targets')
        if (override.text === undefined && override.visible === undefined && override.componentId === undefined)
          continue
        const field = override.text !== undefined ? 'text' : undefined
        const controlledTypes = new Set([
          ...(field ? [field] : []),
          ...(override.visible !== undefined ? ['boolean'] : []),
          ...(override.componentId !== undefined ? ['instance-swap'] : []),
        ])
        for (const property of designComponentPropertyDefinitions(document,node.componentId ?? '')) {
          if (!controlledTypes.has(property.type)) continue
          if (property.targets.some((path) => {
            const effective = designComponentPropertyContextPath(document, node, path)
            return effective && JSON.stringify(effective) === JSON.stringify(override.path)
          })) issue('Controlled component property fields must use property values')
        }
      }
  return issues
}

/** Check component-control semantics before a canvas transaction is published.
 * @param document - Candidate scene after shared reconciliation.
 * @returns Whether definitions and local values can be used without ambiguous or invalid controls.
 */
export function designComponentPropertiesValid(document: CopyOSDesignDocument): boolean {
  return designComponentPropertyIssues(document).length === 0
}
