/** Project font files for the Canvas: install missing design families from Google Fonts, load project faces into the page, upload more. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CopyOSDesignDocument, CopyOSDesignFontFace, CopyOSDesignFontInstallValue, CopyOSDesignFontReadValue,
} from '../../../copyos-domain/src/types.ts'

/** Host font operations for one project; the workspace is bound by the caller. */
export interface DesignerProjectFontActions {
  list: () => Promise<CopyOSDesignFontFace[]>
  install: (families: string[]) => Promise<CopyOSDesignFontInstallValue>
  upload: (fileName: string, dataBase64: string) => Promise<CopyOSDesignFontFace>
  read: (file: string) => Promise<CopyOSDesignFontReadValue>
}

/** Fonts the Canvas has for the open design. */
export interface DesignerProjectFontsState {
  faces: readonly CopyOSDesignFontFace[]
  /** Design families that neither the bundled font, the project nor Google Fonts provide. */
  unavailable: readonly string[]
  busy: boolean
  error: string | null
  /** Add a font file to the project and load it. */
  upload: (file: File) => Promise<void>
}

/** Families the Canvas always has. */
const BUNDLED = new Set(['inter', 'copyosinter'])
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont'])
/** Font files already added to this page, by workspace and file. */
const loadedFiles = new Map<string, Promise<void>>()
/** Embeddable `@font-face` rules of loaded project faces, by workspace and file, for pictures drawn outside the page. */
const fontRules = new Map<string, Map<string, string>>()
/** Families already requested from Google Fonts in this page, by workspace. */
const requestedFamilies = new Map<string, Set<string>>()

const firstFamily = (value: string): string => value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? ''

/**
 * Families a design asks for that are not bundled or generic: each text layer's, run's and text style's first family.
 * @param doc - Open design.
 * @returns Distinct family names in first-use order.
 */
export function designerProjectFontFamilies(doc: CopyOSDesignDocument): string[] {
  const names = new Map<string, string>()
  const add = (value: string | undefined): void => {
    const family = value === undefined ? '' : firstFamily(value)
    if (family && !BUNDLED.has(family.toLowerCase()) && !GENERIC.has(family.toLowerCase()) && !names.has(family.toLowerCase()))
      names.set(family.toLowerCase(), family)
  }
  for (const node of doc.nodes) {
    if (node.kind !== 'text') continue
    add(node.fontFamily)
    for (const run of node.textRuns ?? []) add(run.style.fontFamily)
  }
  for (const style of doc.textStyles ?? []) add(style.fontFamily)
  return [...names.values()]
}

/**
 * Add project faces to the page's font set; each file loads once per page.
 * @param workspaceId - Project the files belong to.
 * @param faces - Installed faces.
 * @param read - Reads one file's bytes.
 * @returns Settles when every face has loaded or failed.
 */
export async function loadDesignerProjectFonts(workspaceId: string, faces: readonly CopyOSDesignFontFace[],
  read: DesignerProjectFontActions['read']): Promise<void> {
  const fontDocument: Partial<Document> = document
  if (!fontDocument.fonts || typeof FontFace !== 'function') return
  const fonts = fontDocument.fonts
  await Promise.allSettled(faces.map((face) => {
    const key = `${workspaceId}/${face.file}`
    let pending = loadedFiles.get(key)
    if (!pending) {
      pending = (async () => {
        const { dataBase64 } = await read(face.file)
        const bytes = Uint8Array.from(atob(dataBase64), character => character.charCodeAt(0))
        const weight = face.weightMin === face.weightMax ? String(face.weightMin) : `${String(face.weightMin)} ${String(face.weightMax)}`
        const loaded = await new FontFace(face.family, bytes, { style: face.style, weight }).load()
        fonts.add(loaded)
        const rules = fontRules.get(workspaceId) ?? new Map<string, string>()
        rules.set(face.file, `@font-face{font-family:${JSON.stringify(face.family)};src:url(data:font/${fontFormat(face.file)};base64,${dataBase64});` +
          `font-style:${face.style};font-weight:${weight}}`)
        fontRules.set(workspaceId, rules)
      })()
      // A failed file may be retried after a later install or upload.
      pending.catch((failure: unknown) => { void failure; loadedFiles.delete(key) })
      loadedFiles.set(key, pending)
    }
    return pending
  }))
}

function fontFormat(file: string): string {
  const extension = file.split('.').pop()?.toLowerCase()
  return extension === 'woff2' || extension === 'woff' || extension === 'otf' ? extension : 'ttf'
}

/**
 * CSS that embeds every project face this page has loaded, for SVG pictures drawn as images, which cannot use the page's fonts.
 * @param workspaceId - Project whose faces to embed.
 * @returns `@font-face` rules with data URLs; empty before any face loads.
 */
export function designerProjectFontCss(workspaceId: string): string {
  return [...fontRules.get(workspaceId)?.values() ?? []].join('')
}

/**
 * Keep the open design's fonts available: load project faces, install missing families from Google Fonts once per page, and upload.
 * @param workspaceId - Open project.
 * @param doc - Open design, or null while loading.
 * @param actions - Host font operations; undefined disables project fonts.
 * @returns Installed faces, unavailable families, progress and the upload action.
 */
export function useDesignerProjectFonts(workspaceId: string, doc: CopyOSDesignDocument | null,
  actions: DesignerProjectFontActions | undefined): DesignerProjectFontsState {
  const [faces, setFaces] = useState<readonly CopyOSDesignFontFace[]>([])
  const [unavailable, setUnavailable] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(actions)
  live.current = actions
  const familyKey = useMemo(() => JSON.stringify(doc ? designerProjectFontFamilies(doc) : []), [doc])
  useEffect(() => {
    const fonts = live.current
    if (!fonts) return
    // Mutated by the cleanup; an object keeps the asynchronous reads from being narrowed to the initial value.
    const run = { active: true }
    const families = JSON.parse(familyKey) as string[]
    setBusy(true)
    void (async () => {
      try {
        let installed = await fonts.list()
        const have = new Set(installed.map(face => face.family.toLowerCase()))
        const requested = requestedFamilies.get(workspaceId) ?? new Set<string>()
        requestedFamilies.set(workspaceId, requested)
        const missing = families.filter(family => !have.has(family.toLowerCase()) && !requested.has(family.toLowerCase()))
        missing.forEach(family => requested.add(family.toLowerCase()))
        let notFound: string[] = []
        for (let start = 0; start < missing.length; start += 20) {
          const result = await fonts.install(missing.slice(start, start + 20))
          notFound = [...notFound, ...result.unavailable]
        }
        if (missing.length) installed = await fonts.list()
        await loadDesignerProjectFonts(workspaceId, installed, fonts.read)
        if (!run.active) return
        const now = new Set(installed.map(face => face.family.toLowerCase()))
        setFaces(installed)
        setUnavailable(families.filter(family =>
          !now.has(family.toLowerCase()) && (notFound.includes(family) || requested.has(family.toLowerCase()))))
        setError(null)
      } catch (failure: unknown) {
        if (run.active) setError(failure instanceof Error ? failure.message : String(failure))
      } finally { if (run.active) setBusy(false) }
    })()
    return () => { run.active = false }
  }, [workspaceId, familyKey])
  const upload = useCallback(async (file: File): Promise<void> => {
    const fonts = live.current
    if (!fonts) return
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      const face = await fonts.upload(file.name, btoa(binary))
      await loadDesignerProjectFonts(workspaceId, [face], fonts.read)
      const installed = await fonts.list()
      setFaces(installed)
      setUnavailable(current => current.filter(family => family.toLowerCase() !== face.family.toLowerCase()))
      setError(null)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setBusy(false) }
  }, [workspaceId])
  return { faces, unavailable, busy, error, upload }
}
