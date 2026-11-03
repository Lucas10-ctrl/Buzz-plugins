/** Shared effective sizing limits keep canvas transactions and native persistence in agreement. */
import { designInstanceSizingOwns, resolveDesignInstanceSizing } from './design-instance-sizing.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignNumberVariables } from './design-token-values.ts'
import type { CopyOSDesignDocument, CopyOSDesignNode } from './types.ts'

const CAPS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const

/** Check one node's effective bounds without changing authored snapshots or ownership.
 * @param node - Authored node, including instance-local sizing ownership and bindings.
 * @param source - Authored linked main component, or absence for ordinary nodes.
 * @param numbers - Alias-resolved numeric values in the context being checked.
 * @returns Whether every effective cap is in range and each minimum is at most its maximum.
 */
export function designNodeSizingLimitsValid(
  node: CopyOSDesignNode,
  source: CopyOSDesignNode | undefined,
  numbers: ReadonlyMap<string, number>,
): boolean {
  if (
    node.kind === 'instance' &&
    node.instanceSizingOverrides !== undefined &&
    source?.kind !== 'component'
  )
    return false
  const local = { ...node }
  for (const key of CAPS) {
    const owner =
      node.kind === 'instance' && source && !designInstanceSizingOwns(node, key) ? source : node
    const binding = owner.numericBindings?.[key]
    if (binding && !numbers.has(binding)) return false
    const ownBinding = node.numericBindings?.[key]
    if (ownBinding) local[key] = numbers.get(ownBinding)
  }
  const effective =
    node.kind === 'instance' && source ? resolveDesignInstanceSizing(source, local, numbers) : local
  for (const key of CAPS) {
    const value = effective[key]
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < (key.startsWith('min') ? 0 : 1) || value > 100000)
    )
      return false
  }
  return (
    (effective.minWidth ?? 0) <= (effective.maxWidth ?? 100000) &&
    (effective.minHeight ?? 0) <= (effective.maxHeight ?? 100000)
  )
}

/** Validate effective ordinary and linked-instance bounds in Base and every saved token mode.
 * @param document - Candidate canvas or native transaction, before publication.
 * @returns False for invalid cap domains, ordering, references, units or numeric aliases; never mutates the candidate.
 */
export function designSizingLimitsValid(document: CopyOSDesignDocument): boolean {
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  try {
    for (const modeId of [null, ...(document.tokenModes ?? []).map(mode => mode.id)]) {
      const resolved = new Map(
        resolveDesignNumberVariables(designModeResources(document, modeId).numberVariables).map(
          token => [token.id, token],
        ),
      )
      const numbers = new Map([...resolved].map(([id, token]) => [id, token.value]))
      for (const node of document.nodes) {
        for (const key of CAPS) {
          const binding = node.numericBindings?.[key]
          if (binding && resolved.get(binding)?.unit !== 'px') return false
        }
        const source = node.kind === 'instance' ? nodes.get(node.componentId ?? '') : undefined
        if (!designNodeSizingLimitsValid(node, source, numbers)) return false
      }
    }
    return true
  } catch (error) {
    // Alias/mode resolution rejects invalid candidate resources; non-Error defects remain visible.
    if (error instanceof Error) return false
    throw error
  }
}
