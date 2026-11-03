/** Pure typography transactions shared by font previews and final selections. */
import type {
  CopyOSDesignDocument,
  CopyOSDesignNode,
} from '../../../copyos-domain/src/types.ts'
import {
  designTextStyleValues,
  editDesignNodes,
} from '../../../copyos-domain/src/design-model.ts'

/** Change editable selected text while retaining displayed typography when detaching styles.
 * @param document - Original transaction document.
 * @param renderedSelection - Effective selected layers, including inherited resource values.
 * @param family - Requested font family.
 * @returns Updated document, or the original identity when no displayed family changes.
 */
export function editDesignerFontFamily(
  document: CopyOSDesignDocument,
  renderedSelection: readonly CopyOSDesignNode[],
  family: string,
): CopyOSDesignDocument {
  const stored = new Map(document.nodes.map(node => [node.id, node]))
  const changes: (Partial<CopyOSDesignNode> & { id: string })[] = []
  for (const rendered of renderedSelection) {
    const node = stored.get(rendered.id)
    if (
      rendered.kind !== 'text' || rendered.locked || node?.kind !== 'text' ||
      rendered.fontFamily === family
    ) continue
    changes.push({
      id: node.id,
      ...(node.textStyleId ? designTextStyleValues(rendered) : {}),
      textStyleId: null,
      fontFamily: family,
    })
  }
  return changes.length ? editDesignNodes(document, changes) : document
}

/** Change a named style’s family while retaining every layer reference.
 * @param document - Original transaction document.
 * @param styleId - Named typography resource identity.
 * @param family - Requested font family.
 * @returns Updated document, or the original identity when missing or unchanged.
 */
export function editDesignerTextStyleFont(
  document: CopyOSDesignDocument,
  styleId: string,
  family: string,
): CopyOSDesignDocument {
  const style = document.textStyles?.find(item => item.id === styleId)
  if (!style || style.fontFamily === family) return document
  return {
    ...document,
    textStyles: document.textStyles?.map(item =>
      item.id === styleId ? { ...item, fontFamily: family } : item,
    ),
  }
}
