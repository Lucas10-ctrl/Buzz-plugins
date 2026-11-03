/** Stroke inspector projections and ownership-aware selection edits share native component inheritance. */
import type {
  CopyOSDesignDocument,
  CopyOSDesignInstanceStroke,
  CopyOSDesignNode,
  CopyOSDesignGradient,
} from '../../../copyos-domain/src/types.ts'
import {
  createDesignRenderScene,
  designInstanceStrokeNode,
  designAuthoredStrokePaints,
  designInstanceStrokeOwns,
  DESIGN_STROKE_NUMBER_KEYS,
  DESIGN_STROKE_KEYS,
  editDesignInstanceStroke,
  editDesignNodes,
  restoreDesignTokenColorLiterals,
} from '../../../copyos-domain/src/design-model.ts'
const sideKeys = DESIGN_STROKE_NUMBER_KEYS.filter(key => key !== 'strokeWidth')
/** Resolve main/local stroke settings for the inspector without storing inherited fields.
 * @param document - Complete native scene.
 * @param selection - Selected geometry retaining ancestor lock state.
 * @returns Effective stroke fields with the selected identity, layout projection and geometry.
 */
export function designerStrokeItems(
  document: CopyOSDesignDocument,
  selection: readonly CopyOSDesignNode[],
): CopyOSDesignNode[] {
  const scene = selection.some(node => node.kind === 'instance')
    ? createDesignRenderScene(document)
    : null
  return selection.map((node) => {
    if (!scene || node.kind !== 'instance') return node
    const effective = restoreDesignTokenColorLiterals(
      designInstanceStrokeNode(document, node, scene),
    )
    return {
      ...node,
      ...Object.fromEntries(
        DESIGN_STROKE_KEYS.map(key => [key, effective[key as keyof CopyOSDesignNode]]),
      ),
    }
  })
}
/** Edit one stroke property across mixed ordinary/linked selections; scalar edits intentionally restore uniform sides.
 * @param document - Stored native scene.
 * @param selection - Editable inspector projections.
 * @param fields - Literal/reference changes; omitted properties remain untouched.
 * @returns One complete candidate, ready for a single preview or history commit.
 */
export function editDesignerStrokeSelection(
  document: CopyOSDesignDocument,
  selection: readonly CopyOSDesignNode[],
  fields: Partial<CopyOSDesignInstanceStroke>,
): CopyOSDesignDocument {
  const edit = {
    ...fields,
    ...(Object.hasOwn(fields, 'strokeWidth')
      ? Object.fromEntries(sideKeys.map(key => [key, undefined]))
      : {}),
  }
  let next = document
  for (const selected of selection) {
    if (selected.locked) continue
    const stored = next.nodes.find(node => node.id === selected.id)
    if (!stored) continue
    if (stored.kind === 'instance') next = editDesignInstanceStroke(next, stored.id, edit)
    else
      next = editDesignNodes(next, [
        {
          id: stored.id,
          ...edit,
          numericBindings: Object.fromEntries(
            Object.entries(stored.numericBindings ?? {}).filter(
              ([key]) => !Object.hasOwn(edit, key),
            ),
          ),
        },
      ])
  }
  return next
}
/** Restore scalar sides while retaining the current scalar token reference where possible.
 * @param document - Stored scene.
 * @param selection - Effective selected stroke settings.
 * @returns A candidate clearing only side ownership/bindings and establishing uniform instance ownership when required.
 */
export function uniformDesignerStrokeSelection(
  document: CopyOSDesignDocument,
  selection: readonly CopyOSDesignNode[],
): CopyOSDesignDocument {
  const scene = createDesignRenderScene(document)
  let next = document
  for (const selected of selection) {
    if (selected.locked) continue
    const stored = next.nodes.find(node => node.id === selected.id)
    if (!stored) continue
    const clear = Object.fromEntries(sideKeys.map(key => [key, undefined]))
    if (stored.kind !== 'instance' || designInstanceStrokeOwns(stored, 'strokeWidth')) {
      next = editDesignerStrokeSelection(next, [selected], clear)
      continue
    }
    const resolved = scene.root.byId.get(stored.id) ?? stored,
      source = scene.instance(resolved, scene.root)?.byId.get(resolved.componentId ?? ''),
      binding = source?.numericBindings?.strokeWidth
    next = editDesignInstanceStroke(next, stored.id, {
      ...clear,
      strokeWidth: binding ? undefined : selected.strokeWidth,
    })
    if (binding)
      next = editDesignNodes(next, [
        {
          id: stored.id,
          numericBindings: {
            ...next.nodes.find(node => node.id === stored.id)?.numericBindings,
            strokeWidth: binding,
          },
        },
      ])
  }
  return next
}

/** Move a stroke paint gradient without copying active-mode colors into authored fallbacks.
 * @param document - Immutable authored scene.
 * @param nodeId - Stored layer or linked root identity.
 * @param paintId - Current authored stroke paint identity.
 * @param gradient - Edited geometry and retained raw stops.
 * @returns Candidate owning only the stroke paint stack, retaining all geometry and other paints.
 */
export function editDesignerStrokeGradient(
  document: CopyOSDesignDocument,
  nodeId: string,
  paintId: string,
  gradient: CopyOSDesignGradient,
): CopyOSDesignDocument {
  const node = document.nodes.find(item => item.id === nodeId)
  if (!node || node.locked) return document
  const paints = designAuthoredStrokePaints(document, nodeId)
  if (!paints.some(paint => paint.id === paintId)) return document
  return editDesignerStrokeSelection(document, [node], {
    strokes: paints.map(paint => (paint.id === paintId ? { ...paint, gradient } : paint)),
  })
}
