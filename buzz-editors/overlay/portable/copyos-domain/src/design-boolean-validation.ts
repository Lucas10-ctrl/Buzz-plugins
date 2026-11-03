/** Lightweight native Boolean admission shared by storage and interactive previews. */
import { designBooleanNodeEligibility } from './design-boolean-geometry.ts'
import { designColorVariableCss } from './design-color.ts'
import { designModeResources } from './design-token-modes.ts'
import { resolveDesignColorVariables, resolveDesignNumberVariables } from './design-token-values.ts'
import { DESIGN_STROKE_NUMBER_KEYS } from './design-stroke.ts'
import type { CopyOSDesignDocument } from './types.ts'

/** Validate Boolean source geometry across every saved token mode without evaluating constructive paths.
 * @param document - Authored scene, including any candidate preview edits.
 * @returns Whether all containers and their operands can be represented faithfully.
 */
export function designBooleansDocumentValid(document: CopyOSDesignDocument): boolean {
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  if (!document.nodes.some(node => node.kind === 'boolean'))
    return document.nodes.every(node => node.booleanOperation === undefined)
  for (const node of document.nodes) {
    if (node.kind === 'boolean') {
      if (!node.booleanOperation || node.layout !== 'none' || node.pathData !== undefined) return false
    } else if (node.booleanOperation !== undefined) return false
    const parent = nodes.get(node.parentId ?? '')
    if (parent?.kind === 'boolean' && (parent.pageId ?? document.pages?.[0]?.id) !==
      (node.pageId ?? document.pages?.[0]?.id)) return false
  }
  try {
    for (const modeId of [null, ...(document.tokenModes ?? []).map(mode => mode.id)]) {
      const resources = designModeResources(document, modeId)
      const values = new Map(resolveDesignNumberVariables(resources.numberVariables).map(value => [value.id, value.value]))
      const colors = new Map(resolveDesignColorVariables(resources.variables, resources.numberVariables)
        .map(value => [value.id, designColorVariableCss(value)]))
      for (const node of document.nodes) if (nodes.get(node.parentId ?? '')?.kind === 'boolean') {
        const effective = { ...node, stroke: colors.get(node.strokeVariableId ?? '') ?? node.stroke,
          strokes: node.strokes?.map(paint => ({ ...paint, color: colors.get(paint.variableId ?? '') ?? paint.color })) }
        for (const key of DESIGN_STROKE_NUMBER_KEYS) {
          const value = values.get(node.numericBindings?.[key] ?? '')
          if (value !== undefined) effective[key] = value
        }
        if (!designBooleanNodeEligibility(effective)) return false
      }
    }
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}
