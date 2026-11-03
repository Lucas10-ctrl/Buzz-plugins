/** Mode overrides patch resource values without changing shared identities or units. */
import type {
  CopyOSDesignDocument,
  CopyOSDesignVariable,
  CopyOSDesignNumberVariable,
} from './types.ts'
/** Select one explicit mode source without accidentally inheriting a second derivation. */
function numberSourceFields(base:CopyOSDesignNumberVariable,patch:CopyOSDesignTokenModeNumber|undefined):
Pick<CopyOSDesignNumberVariable,'aliasId'|'expression'> {
  if (!patch || (patch.aliasId===undefined && patch.expression===undefined)) return { aliasId:base.aliasId,expression:base.expression }
  if (patch.aliasId && patch.expression) throw new Error('Numeric alias and expression are mutually exclusive')
  if (patch.expression) return { expression:patch.expression,aliasId:null }
  const cleared=patch.expression===undefined && base.expression===undefined?undefined:null
  if (patch.aliasId) return { aliasId:patch.aliasId,expression:cleared }
  return { aliasId:null,expression:cleared }
}
type CopyOSDesignTokenModeNumber=NonNullable<CopyOSDesignDocument['tokenModes']>[number]['numberVariables'][number]
/** Read effective stored resources for one mode, before resolving aliases.
 * @param document - Native scene and resource library.
 * @param modeId - Mode UUID, or null for Base; omitted selects the document mode.
 * @returns Resource arrays retaining base identities and names.
 */
export function designModeResources(
  document: CopyOSDesignDocument,
  modeId: string | null = document.activeTokenModeId ?? null,
): {
  variables: CopyOSDesignVariable[]
  numberVariables: CopyOSDesignNumberVariable[]
} {
  if (modeId === null)
    return {
      variables: document.variables,
      numberVariables: document.numberVariables ?? [],
    }
  const mode = document.tokenModes?.find(m => m.id === modeId)
  if (!mode) throw new Error('Token mode not found')
  const colors = new Map(mode.variables.map(v => [v.id, v])),
    numbers = new Map(mode.numberVariables.map(v => [v.id, v]))
  if (
    [...colors.keys()].some(
      id => !document.variables.some(v => v.id === id),
    ) ||
    [...numbers.keys()].some(
      id => !document.numberVariables?.some(v => v.id === id),
    )
  )
    throw new Error('Mode override refers to a missing resource')
  return {
    variables: document.variables.map((v) => {
      const p = colors.get(v.id)
      return {
        ...v,
        ...(p?.value !== undefined ? { value: p.value } : {}),
        ...(p?.alpha !== undefined ? { alpha: p.alpha } : {}),
        ...(p?.alphaSource !== undefined ? { alphaSource: p.alphaSource } : {}),
        ...(p?.aliasId !== undefined ? { aliasId: p.aliasId } : {}),
      }
    }),
    numberVariables: (document.numberVariables ?? []).map((v) => {
      const p = numbers.get(v.id)
      return {
        ...v,
        ...(p?.value !== undefined ? { value: p.value } : {}),
        ...numberSourceFields(v,p),
      }
    }),
  }
}
/** Update a color literal/alias in the selected mode or Base.
 * @param document - Current native scene.
 * @param id - Existing color resource identity.
 * @param patch - Literal and/or alias fields to update.
 * @param modeId - Destination mode; omitted selects the document mode.
 * @returns An independent candidate for validation and commit.
 */
export function setDesignColorVariable(
  document: CopyOSDesignDocument,
  id: string,
  patch: Partial<Pick<CopyOSDesignVariable, 'value' | 'alpha' | 'alphaSource' | 'aliasId'>>,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignDocument {
  if (!document.variables.some(v => v.id === id))
    throw new Error('Color resource not found')
  if (modeId === null)
    return {
      ...document,
      variables: document.variables.map(v =>
        v.id === id ? { ...v, ...patch } : v,
      ),
    }
  if (!document.tokenModes?.some(m => m.id === modeId))
    throw new Error('Token mode not found')
  return {
    ...document,
    tokenModes: document.tokenModes.map((m) => {
      if (m.id !== modeId) return m
      const old = m.variables.find(v => v.id === id),
        next = { ...old, id, ...patch }
      return {
        ...m,
        variables: old
          ? m.variables.map(v => (v.id === id ? next : v))
          : [...m.variables, next],
      }
    }),
  }
}
/** Update a numeric literal/alias while preserving its collection unit.
 * @param document - Current native scene.
 * @param id - Existing numeric resource identity.
 * @param patch - Literal and/or alias fields to update.
 * @param modeId - Destination mode; omitted selects the document mode.
 * @returns An independent candidate for validation and commit.
 */
export function setDesignNumberVariable(
  document: CopyOSDesignDocument,
  id: string,
  patch: Partial<Pick<CopyOSDesignNumberVariable, 'value' | 'aliasId' | 'expression'>>,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignDocument {
  if (patch.aliasId && patch.expression) throw new Error('Numeric alias and expression are mutually exclusive')
  const variables=document.numberVariables ?? [],base=variables.find(v=>v.id===id)
  if (!base) throw new Error('Numeric resource not found')
  if (modeId === null)
    return {
      ...document,
      numberVariables: variables.map(v =>
        v.id === id ? { ...v, ...patch,
          ...(patch.aliasId!==undefined || patch.expression!==undefined?numberSourceFields(v,{ id,...patch }):{}),
        } : v,
      ),
    }
  if (!document.tokenModes?.some(m => m.id === modeId))
    throw new Error('Token mode not found')
  return {
    ...document,
    tokenModes: document.tokenModes.map((m) => {
      if (m.id !== modeId) return m
      const old = m.numberVariables.find(v => v.id === id),
        next = { ...old, id, ...patch,
          ...(patch.aliasId!==undefined || patch.expression!==undefined?numberSourceFields(base,{ id,...patch }):{}),
        }
      return {
        ...m,
        numberVariables: old
          ? m.numberVariables.map(v => (v.id === id ? next : v))
          : [...m.numberVariables, next],
      }
    }),
  }
}
/** Remove one mode override so its value and alias inherit Base again.
 * @param document - Current native scene.
 * @param kind - Resource collection.
 * @param id - Existing resource identity.
 * @param modeId - Override mode; omitted selects the document mode.
 * @returns The scene with only this override removed.
 */
export function resetDesignModeVariable(
  document: CopyOSDesignDocument,
  kind: 'color' | 'number',
  id: string,
  modeId: string | null = document.activeTokenModeId ?? null,
): CopyOSDesignDocument {
  if (
    kind === 'color'
      ? !document.variables.some(v => v.id === id)
      : !document.numberVariables?.some(v => v.id === id)
  )
    throw new Error('Resource not found')
  if (modeId === null)
    throw new Error('Base values cannot inherit another mode')
  if (!document.tokenModes?.some(m => m.id === modeId))
    throw new Error('Token mode not found')
  return {
    ...document,
    tokenModes: document.tokenModes.map(m =>
      m.id === modeId
        ? {
          ...m,
          ...(kind === 'color'
            ? { variables: m.variables.filter(v => v.id !== id) }
            : {
              numberVariables: m.numberVariables.filter(v => v.id !== id),
            }),
        }
        : m,
    ),
  }
}

/** A subtree render context replaces the component root's inherited mode for one instance. */
export interface DesignModeContext {
  nodeId: string
  modeId: string | null
}
/** Resolve nearest explicit layer/page mode, retaining Base as distinct from Auto.
 * @param document - Native layer tree and document default.
 * @param context - Optional rendered component root and the instance's mode.
 * @returns Effective mode IDs for every stored layer (null means Base).
 */
export function designNodeModeIds(
  document: CopyOSDesignDocument,
  context?: DesignModeContext,
): Map<string, string | null> {
  const modeIds = new Set(document.tokenModes?.map(m => m.id))
  if (document.activeTokenModeId && !modeIds.has(document.activeTokenModeId))
    throw new Error('Token mode not found')
  for (const owner of [...document.nodes, ...(document.pages ?? [])])
    if (
      owner.tokenModeId &&
      owner.tokenModeId !== 'base' &&
      !modeIds.has(owner.tokenModeId)
    )
      throw new Error('Token mode not found')
  const nodes = new Map(document.nodes.map(n => [n.id, n]))
  const pages = new Map(document.pages?.map(p => [p.id, p]))
  const result = new Map<string, string | null>(),
    visiting = new Set<string>()
  const explicit = (
    value: string | null | undefined,
  ): string | null | undefined =>
    value === 'base' ? null : (value ?? undefined)
  const visit = (id: string): string | null => {
    if (result.has(id)) return result.get(id) ?? null
    if (visiting.has(id)) throw new Error('Cyclic mode inheritance')
    const node = nodes.get(id)
    if (!node) throw new Error('Mode layer not found')
    visiting.add(id)
    const own = explicit(node.tokenModeId)
    const pageMode = explicit(
      pages.get(node.pageId ?? document.pages?.[0]?.id ?? '')?.tokenModeId,
    )
    const mode =
      context?.nodeId === id
        ? context.modeId
        : own !== undefined
          ? own
          : node.parentId && nodes.has(node.parentId)
            ? visit(node.parentId)
            : pageMode !== undefined
              ? pageMode
              : (document.activeTokenModeId ?? null)
    if (mode !== null && !document.tokenModes?.some(m => m.id === mode))
      throw new Error('Token mode not found')
    visiting.delete(id)
    result.set(id, mode)
    return mode
  }
  for (const node of document.nodes) visit(node.id)
  return result
}
// Inspector panels read one layer's mode many times per render; documents are replaced on edit, so the per-document map
// stays valid while the fields it reads keep their identity.
const nodeModeIdCache = new WeakMap<CopyOSDesignDocument, {
  nodes: CopyOSDesignDocument['nodes']
  length: number
  pages: CopyOSDesignDocument['pages']
  tokenModes: CopyOSDesignDocument['tokenModes']
  active: CopyOSDesignDocument['activeTokenModeId']
  modes: Map<string, string | null>
}>()
/** Read one layer's effective resource mode.
 * @param document - Current native scene.
 * @param nodeId - Layer identity.
 * @returns Effective UUID, or null for Base.
 */
export function designNodeModeId(
  document: CopyOSDesignDocument,
  nodeId: string,
): string | null {
  const cached = nodeModeIdCache.get(document)
  const modes = cached && cached.nodes === document.nodes && cached.length === document.nodes.length &&
    cached.pages === document.pages && cached.tokenModes === document.tokenModes &&
    cached.active === document.activeTokenModeId ? cached.modes : designNodeModeIds(document)
  if (modes !== cached?.modes)
    nodeModeIdCache.set(document, { nodes: document.nodes, length: document.nodes.length, pages: document.pages,
      tokenModes: document.tokenModes, active: document.activeTokenModeId, modes })
  if (!modes.has(nodeId)) throw new Error('Mode layer not found')
  return modes.get(nodeId) ?? null
}
/** Delete a mode and restore Auto on its layer/page assignments.
 * @param document - Current scene.
 * @param id - Existing mode identity.
 * @returns Candidate scene with dangling mode assignments cleared.
 */
export function removeDesignTokenMode(
  document: CopyOSDesignDocument,
  id: string,
): CopyOSDesignDocument {
  if (!document.tokenModes?.some(m => m.id === id))
    throw new Error('Token mode not found')
  return {
    ...document,
    activeTokenModeId:
      document.activeTokenModeId === id ? null : document.activeTokenModeId,
    tokenModes: document.tokenModes.filter(m => m.id !== id),
    nodes: document.nodes.map(n =>
      n.tokenModeId === id ? { ...n, tokenModeId: null } : n,
    ),
    pages: document.pages?.map(p =>
      p.tokenModeId === id ? { ...p, tokenModeId: null } : p,
    ),
  }
}
