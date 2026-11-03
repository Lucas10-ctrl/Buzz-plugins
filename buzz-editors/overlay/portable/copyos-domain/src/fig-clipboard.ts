/** Decode native Figma selections into an editable scene for current-document clipboard admission. */
import { inflateSync } from 'fflate'
import { z } from 'zod'
import { ByteBuffer, compileSchema, decodeBinarySchema } from '@open-pencil/kiwi/schema-runtime'
import { parseFigKiwiContainer } from '@open-pencil/kiwi/fig/parse'
import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import { parseDesignDocument } from './designs.ts'
import { designDocumentValidationError } from './design-schema.ts'
import { convertFigRecords } from './fig-import.ts'
import { bindFigClipboardColors, readFigClipboardColors } from './fig-clipboard-resources.ts'
import type { FigClipboardDecodeResult } from './types.ts'

const guidSchema = z.object({ sessionID: z.number().int().min(0).max(0xffffffff), localID: z.number().int().min(0).max(0xffffffff) })
const vectorSchema = z.object({ x: z.number(), y: z.number() })
const colorSchema = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() })
const paintSchema = z.object({ type: z.enum(['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'CUSTOM', 'VIDEO', 'PATTERN', 'NOISE']),
  color: colorSchema.optional(), opacity: z.number().optional(), visible: z.boolean().optional(),
  colorVar: z.object({ value: z.object({ alias: z.object({ guid: guidSchema.optional(),
    assetRef: z.object({ key: z.string(), version: z.string().optional() }).optional() }).optional() }).optional(),
  dataType: z.string().optional(), resolvedDataType: z.string().optional() }).optional() }).loose()
const nodeSchema = z.object({ guid: guidSchema, phase: z.enum(['CREATED', 'REMOVED']).optional(), type: z.string().optional(),
  parentIndex: z.object({ guid: guidSchema, position: z.string() }).optional(), name: z.string().optional(),
  internalOnly: z.boolean().optional(), visible: z.boolean().optional(),
  locked: z.boolean().optional(), opacity: z.number().optional(),
  size: vectorSchema.optional(), transform: z.object({ m00: z.number(), m01: z.number(), m02: z.number(),
    m10: z.number(), m11: z.number(), m12: z.number() }).optional(),
  fillPaints: z.array(paintSchema).max(1000).optional(), strokePaints: z.array(paintSchema).max(1000).optional(),
  backgroundPaints: z.array(paintSchema).max(1000).optional(),
  textData: z.object({ characters: z.string() }).loose().optional(),
}).loose()
const messageSchema = z.object({ type: z.literal('NODE_CHANGES'), nodeChanges: z.array(z.custom<NodeChange>(value => nodeSchema.safeParse(value).success, 'Invalid Figma clipboard node fields')).min(1).max(100000),
  blobs: z.array(z.object({ bytes: z.instanceof(Uint8Array) })).max(100000).optional(),
  clipboardSelectionRegions: z.array(z.object({ nodes: z.array(guidSchema).min(1).max(25000) })).min(1).max(25000) })
const key = (guid: z.infer<typeof guidSchema>): string => `${guid.sessionID}:${guid.localID}`


/**
 * Decode a bounded fig-kiwi clipboard selection with its embedded schema; call inside the import worker.
 * @param bytes - Raw bytes from the Figma HTML clipboard data-buffer marker, limited to 25 MB.
 * @returns Independent native scene and authoritative selected roots for captureDesignClipboard.
 */
export function decodeFigClipboard(bytes: Uint8Array): FigClipboardDecodeResult {
  if (bytes.byteLength > 25000000) throw new Error('Figma clipboard selections are limited to 25 MB')
  if (bytes.byteLength < 20) throw new Error('Invalid Figma clipboard container')
  const payload = parseFigKiwiContainer(bytes)
  if (!payload) throw new Error('Invalid Figma clipboard container')
  const schema = decodeBinarySchema(new ByteBuffer(inflateSync(payload.schemaDeflated)))
  const codec = compileSchema(schema)
  if (!codec.decodeMessage) throw new Error('Figma clipboard schema has no Message decoder')
  const message = messageSchema.parse(codec.decodeMessage(payload.dataRaw))
  // The embedded binary schema validates every decoded field's primitive/message encoding;
  // the admission schema additionally bounds counts and validates owned selection and geometry fields.
  const records: NodeChange[] = message.nodeChanges
  const byId = new Map<string, NodeChange>()
  for (const record of records) {
    const id = record.guid ? key(record.guid) : ''
    byId.set(id, { ...byId.get(id), ...record })
  }
  const roots = message.clipboardSelectionRegions.flatMap(region => region.nodes.map(key))
  if (new Set(roots).size !== roots.length) throw new Error('Figma clipboard selection contains duplicate roots')
  const selected = new Set(roots)
  for (const root of roots) {
    const record = byId.get(root)
    if (!record || record.phase === 'REMOVED' || !record.type || ['DOCUMENT', 'CANVAS', 'VARIABLE', 'VARIABLE_SET'].includes(record.type))
      throw new Error('Figma clipboard selected layer is missing or unsupported')
    const seen = new Set([root])
    let parent = record.parentIndex?.guid
    while (parent) {
      const id = key(parent)
      if (seen.has(id)) throw new Error('Figma clipboard hierarchy contains a cycle')
      if (selected.has(id)) throw new Error('Figma clipboard selected roots overlap')
      seen.add(id); parent = byId.get(id)?.parentIndex?.guid
    }
  }
  const warnings = new Map<string, number>()
  const warn = (reason: string): void => { warnings.set(reason, (warnings.get(reason) ?? 0) + 1) }
  const colors = readFigClipboardColors([...byId.values()], warn)
  const normalized: NodeChange[] = [...byId.values()].filter(record => !['VARIABLE', 'VARIABLE_SET'].includes(record.type ?? '')).map((record) => {
    const cleanPaints = (paints: Paint[]): Paint[] => paints.map((paint) => {
      if (!colors.paintId(paint)) return paint
      const { colorVar: _colorVar, ...literal } = paint
      return literal
    })
    return { ...record, ...(record.type === 'CANVAS' && record.internalOnly ? { internalOnly: false, name: 'Clipboard dependencies' } : {}),
      ...(record.fillPaints ? { fillPaints: cleanPaints(record.fillPaints) } : {}),
      ...(record.strokePaints ? { strokePaints: cleanPaints(record.strokePaints) } : {}),
      ...(record.backgroundPaints ? { backgroundPaints: cleanPaints(record.backgroundPaints) } : {}) }
  })
  const converted = convertFigRecords(normalized, message.blobs?.map(blob => blob.bytes) ?? [], new Map(), 'Figma clipboard.fig')
  bindFigClipboardColors(converted.document, [...byId.values()], converted.ids, colors)
  const selectedIds = roots.map((root) => {
    const id = converted.ids.get(root)
    if (!id) throw new Error('Figma clipboard selected layer could not be converted')
    return id
  })
  if (converted.document.source) converted.document.source.warnings = [...converted.document.source.warnings,
    ...[...warnings].map(([reason, count]) => `${reason} (${count})`)].slice(0, 99)
  // The full report names each invalid field's path; the decoder's caller summarizes it for the user.
  const invalid = designDocumentValidationError(converted.document)
  if (invalid) throw invalid
  return { document: parseDesignDocument(converted.document), selectedIds }
}
