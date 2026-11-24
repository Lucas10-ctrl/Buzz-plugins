// Build the bundled Canvas ad template library from Designer's Figma file 0F3CgYAs2ejHh52wDwg5Uz: the nine sets dumped with
// figma-dump/dump-template.js (one variant per use_figma call), replayed through runCanvasScript, each at 1:1, 4:5 and 9:16. Writes library/<id>.json (+ .png) with ids derived from
// the template names, so rebuilding replaces the same templates. The build is deterministic: ids inside a template are uuid v5 values derived from the template name and the path
// inside it, and a template whose content did not change keeps the bytes already on disk (ids and createdAt included), so a rebuild only touches the templates that really changed.
// Run: node --import tsx packages/editor-host/canvas-templates/build.mts
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CanvasStore } from '../src/canvas-store.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Fixed namespace for the template-internal uuid v5 ids (any stable uuid works; this one is stable on purpose).
const ID_NAMESPACE = Buffer.from('9ba2bbc619f35c9d9c6f3f0e0a1b2c3d', 'hex')
/** uuid v5 (sha1-based) of `name` under ID_NAMESPACE, so the same name always gives the same id. */
function uuidv5(name: string): string {
  const h = createHash('sha1').update(Buffer.concat([ID_NAMESPACE, Buffer.from(name, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const s = h.subarray(0, 16).toString('hex')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}
/** Replace every uuid in the object with a uuid v5 of `seed + '/' + <path of its first occurrence>`. */
function stableIds(root: unknown, seed: string): void {
  const first = new Map<string, string>()
  const collect = (o: unknown, path: string): void => {
    if (Array.isArray(o)) { o.forEach((v, i) => collect(v, `${path}[${i}]`)); return }
    if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) collect(v, `${path}/${k}`); return }
    if (typeof o === 'string' && UUID_RE.test(o) && !first.has(o)) first.set(o, path)
  }
  collect(root, '')
  const map = new Map([...first].map(([id, path]) => [id, uuidv5(`${seed}/${path}`)]))
  const apply = (o: unknown, holder?: Record<string, unknown> | unknown[], key?: string | number): void => {
    if (Array.isArray(o)) { o.forEach((v, i) => apply(v, o, i)); return }
    if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) apply(v, o as Record<string, unknown>, k); return }
    if (typeof o === 'string' && map.has(o)) (holder as Record<string, unknown>)[key as string] = map.get(o)
  }
  apply(root)
}
/** JSON of the object with uuids replaced by first-occurrence placeholders and createdAt fields dropped — equal means "same content". */
function canonical(root: unknown): string {
  const map = new Map<string, string>()
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk)
    if (o && typeof o === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o)) { if (k === 'createdAt' || k === 'updatedAt') continue; out[k] = walk(v) }
      return out
    }
    if (typeof o === 'string' && UUID_RE.test(o)) { if (!map.has(o)) map.set(o, `#${map.size}`); return map.get(o) }
    return o
  }
  return JSON.stringify(walk(root))
}


const here = new URL('.', import.meta.url).pathname
const work = await mkdtemp(join(tmpdir(), 'canvas-templates-'))
const store = new CanvasStore(join(work, 'root'), async () => join(work, 'ws'))
const call = (operation: string, input: Record<string, unknown>) => store.call(operation, { workspaceId: 'templates', ...input }) as Promise<any>
const DESCRIPTIONS: Record<string, string> = {
  'Ad / Product hero': 'Scene picture full-bleed; a stack of text, product area and button, so a long headline shrinks the product area. Text: headline, subhead, callout-1, cta. Slots: slot/picture (FILL), slot/product (FIT).',
  'Ad / Benefit callouts': 'Product in the middle with four benefit pills. Text: headline, callout-1…4 (fill the TEXT layers). Slot: slot/product (FIT).',
  'Ad / Us vs them': 'Comparison table, ours vs the usual way. Text: headline, us-name, them-name, row-1…4, us-1…4, them-1…4. Slot: slot/product (FIT).',
  'Ad / Offer': 'Big offer on the accent colour. Text: badge, offer, subhead, urgency, code, cta (hide code/urgency when unused). Slot: slot/product (FIT).',
  'Ad / Testimonial': 'Review card over a scene. Text: proof, quote, name, role; stars are five star shapes (hide star-5 for a 4-star review). Slots: slot/picture (FILL), slot/product (FIT).',
  'Ad / Before and after': 'Two pictures side by side with labels. Text: headline, label-before, label-after. Slots: slot/before, slot/after (FILL), slot/product (FIT).',
  'Ad / 3 reasons': 'Three numbered reasons beside the product. Text: headline, reason-1…3-title, reason-1…3-detail. Slot: slot/product (FIT).',
  'Ad / Founder quote': 'Founder photo, big quote mark and quote. Text: quote, name, title (mark is the quote glyph; leave it). Slots: slot/picture (founder, FILL), slot/product (FIT).',
  'Ad / UGC post': 'A social post card over a background. Text: name, handle, post-text, stats. Slots: slot/background, slot/avatar, slot/picture (FILL).',
}
const RULES = ' Brand: add a mode to the Brand collection (or set its values) and set the frame\'s mode; set brand fonts on the text styles display/*, body/*, strong/*, quote/*. Fill only the named text layers; pictures go in slot/* with placeDesignImage (hide _label). 9:16: no words in the top 270 px or bottom 670 px (hidden _safe-zone).'
try {
  let design = await call('createDesign', { title: 'Ad templates' })
  const run = async (code: string) => {
    const result = await call('runCanvasScript', { designId: design.id, expectedRevision: design.revision, code, timeoutMs: 120_000 })
    design = await call('readDesign', { designId: design.id })
    return result
  }
  const dumps = (await readdir(join(here, 'figma-dump'))).filter(name => name.endsWith('.json')).sort()
  const replay = await readFile(join(here, 'replay-figma-dump.js'), 'utf8')
  let row = 0
  let variables: unknown[] | undefined
  const merged = new Map<string, Record<string, unknown>>()
  for (const name of dumps) {
    const dump = JSON.parse(await readFile(join(here, 'figma-dump', name), 'utf8'))
    variables ??= dump.variables
    for (const [key, variant] of Object.entries(dump.variants)) {
      const set = key.split(' | ')[0]!
      merged.set(set, { ...merged.get(set), [key]: variant })
    }
  }
  if (!variables) throw new Error('No dump holds the Brand variables')
  for (const [set, variants] of merged) {
    const dump = { variables, variants }
    const out = await run(`const DUMP = ${JSON.stringify(dump)}; const PLACE = { x: 0, y: ${row * 2040} }; const ONLY = null;\n${replay}`)
    console.log(set, out.result.map((item: { name: string }) => item.name).join(', '), out.warnings ?? '', out.unmeasuredText ?? '')
    row++
  }
  const library = join(here, 'library')
  await mkdir(library, { recursive: true })
  const frames = design.nodes.filter((node: { parentId: string | null; kind: string }) => node.parentId === null && node.kind === 'frame')
  for (const frame of frames) {
    const set = frame.name.split(' · ')[0]
    const summary = await call('saveDesignTemplate', { designId: design.id, nodeId: frame.id, title: frame.name, category: 'Ad',
      description: (DESCRIPTIONS[set] ?? '') + RULES })
    const hex = createHash('sha1').update(`creative-studio ad template ${frame.name}`).digest('hex')
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(8 + (parseInt(hex[16]!, 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    const source = join(work, 'root', 'design-templates')
    const file = JSON.parse(await readFile(join(source, `${summary.id}.json`), 'utf8'))
    stableIds(file, id)
    file.id = id
    file.sourceWorkspaceName = 'Creative Studio'
    const libJson = join(library, `${id}.json`)
    let prev: any = null
    try { prev = JSON.parse(await readFile(libJson, 'utf8')) } catch { /* new template */ }
    if (prev && canonical(prev) === canonical(file)) {
      // Content unchanged: keep the bytes already on disk (ids and timestamps included) so a rebuild only touches what really changed.
    } else {
      file.createdAt = prev?.createdAt ?? '2026-11-23T00:00:00.000Z'
      if (prev?.snapshot?.library && file.snapshot?.library) {
        file.snapshot.library.createdAt = prev.snapshot.library.createdAt
        file.snapshot.library.updatedAt = prev.snapshot.library.updatedAt
      }
      await writeFile(libJson, `${JSON.stringify(file)}\n`)
      try { await writeFile(join(library, `${id}.png`), await readFile(join(source, `${summary.id}.png`))) } catch { /* no preview */ }
    }
    await writeFile(join(work, `${frame.name.replace(/[^\w]+/g, '-')}.png`), Buffer.from((await call('viewDesign', { designId: design.id, artboardId: frame.id, scale: 1 })).dataBase64, 'base64'))
  }
  stableIds(design, 'ad-templates-design')
  const designPath = join(here, 'ad-templates.design.json')
  let prevDesign: any = null
  try { prevDesign = JSON.parse(await readFile(designPath, 'utf8')) } catch { /* first build */ }
  if (!prevDesign || canonical(prevDesign) !== canonical(design)) {
    if (prevDesign) { if ('createdAt' in prevDesign) design.createdAt = prevDesign.createdAt; if ('updatedAt' in prevDesign) design.updatedAt = prevDesign.updatedAt }
    await writeFile(designPath, `${JSON.stringify(design)}\n`)
  }
  console.log(`${frames.length} templates written to ${library}; previews in ${work}`)
} finally {
  await store.dispose()
}
