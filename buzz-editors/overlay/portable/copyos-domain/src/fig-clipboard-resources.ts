/** Local color resources carried by native Figma clipboard messages. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import type { CopyOSDesignDocument, CopyOSDesignVariable } from './types.ts'

const guidSchema = z.object({ sessionID: z.number().int().min(0).max(0xffffffff), localID: z.number().int().min(0).max(0xffffffff) })
const referenceSchema = z.object({ guid: guidSchema.optional(),
  assetRef: z.object({ key: z.string().min(1), version: z.string().optional() }).optional() })
const colorSchema = z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1),
  b: z.number().min(0).max(1), a: z.number().min(0).max(1) })
const valuesSchema = z.object({ entries: z.array(z.object({ modeID: guidSchema,
  variableData: z.object({ dataType: z.string(), resolvedDataType: z.string().optional(),
    value: z.object({ colorValue: colorSchema.optional(), alias: referenceSchema.optional() }) }) })).max(1000) })
const modesSchema = z.array(z.object({ id: guidSchema, name: z.string() })).max(1000)
const key = (guid: { sessionID: number; localID: number }): string => `${guid.sessionID}:${guid.localID}`
const hex = (color: z.infer<typeof colorSchema>): string => `#${[color.r, color.g, color.b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`

/** Clipboard color tokens and local asset/GUID lookup used for live paint bindings. */
export interface FigClipboardColorResources {
  variables: CopyOSDesignVariable[]
  paintId: (paint: Paint) => string | undefined
}

/**
 * Read single-mode literal COLOR resources; unsupported collections remain explicit warnings.
 * @param records - Clipboard-local node/resource records; asset keys never trigger network requests.
 * @param warn - Bounded import report collector.
 * @returns Native shared colors and their source-reference lookup.
 */
export function readFigClipboardColors(records: readonly NodeChange[], warn: (reason: string) => void): FigClipboardColorResources {
  const collections = new Map<string, string | null>()
  for (const record of records.filter(node => node.type === 'VARIABLE_SET')) {
    const modes = modesSchema.safeParse(record.variableSetModes)
    const mode = modes.success && modes.data.length === 1 ? modes.data[0] : undefined
    if (!mode) warn('Clipboard variable collections with unsupported or multiple modes retain saved paint values')
    const id = record.guid ? key(record.guid) : ''
    collections.set(id, mode ? key(mode.id) : null)
    if (typeof record.key === 'string') collections.set(record.key, mode ? key(mode.id) : null)
  }
  const references = new Map<string, string>(), variables: CopyOSDesignVariable[] = []
  for (const record of records.filter(node => node.type === 'VARIABLE')) {
    const set = referenceSchema.safeParse(record.variableSetID), values = valuesSchema.safeParse(record.variableDataValues)
    const setKey = set.success ? set.data.assetRef?.key ?? (set.data.guid ? key(set.data.guid) : '') : ''
    const mode = collections.get(setKey)
    const entry = values.success && values.data.entries.length === 1 ? values.data.entries[0] : undefined
    if (record.variableResolvedType !== 'COLOR' || !mode || !entry || key(entry.modeID) !== mode ||
      entry.variableData.dataType !== 'COLOR' || !entry.variableData.value.colorValue || entry.variableData.value.alias) {
      warn('Clipboard variable types, aliases or modes without a supported literal COLOR retain saved paint values'); continue
    }
    if (variables.length >= 500) { warn('Clipboard color resources beyond the native 500-token limit retain saved paint values'); continue }
    const color = entry.variableData.value.colorValue, id = randomUUID()
    if ((record.name?.trim().length ?? 0) > 120) warn('Clipboard color token names beyond 120 characters are shortened')
    variables.push({ id, name: (record.name?.trim() || 'Imported color').slice(0, 120), value: hex(color), alpha: color.a })
    if (record.guid) references.set(key(record.guid), id)
    if (typeof record.key === 'string') references.set(record.key, id)
  }
  const paintId = (paint: Paint): string | undefined => {
    const alias = paint.colorVar?.value?.alias
    if (!alias) return undefined
    return references.get(alias.assetRef?.key ?? (alias.guid ? key(alias.guid) : ''))
  }
  return { variables, paintId }
}

/**
 * Restore supported local live bindings after geometry conversion, retaining authored paint opacity.
 * @param document - Converted clipboard scene, mutated before destination admission.
 * @param records - Original clipboard records.
 * @param ids - Source GUID to native node identities.
 * @param colors - Local native color resource lookup.
 */
export function bindFigClipboardColors(document: CopyOSDesignDocument, records: readonly NodeChange[],
  ids: ReadonlyMap<string, string>, colors: FigClipboardColorResources): void {
  document.variables = colors.variables
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  for (const record of records) {
    const node = nodes.get(record.guid ? ids.get(key(record.guid)) ?? '' : '')
    if (!node) continue
    const fills = record.fillPaints ?? record.backgroundPaints ?? []
    if (node.fills) node.fills.forEach((paint, index) => {
      const source = fills[index], id = source ? colors.paintId(source) : undefined
      if (id) { paint.variableId = id; paint.opacity = source?.opacity ?? 1 }
    })
    else {
      const paint = fills.find(value => value.visible !== false) ?? fills[0], id = paint ? colors.paintId(paint) : undefined
      if (id) { node.fillVariableId = id; node.fillOpacity = paint?.opacity ?? 1 }
    }
    node.strokes?.forEach((paint, index) => {
      const source = record.strokePaints?.[index], id = source ? colors.paintId(source) : undefined
      if (id) { paint.variableId = id; paint.opacity = source?.opacity ?? 1 }
    })
  }
}
