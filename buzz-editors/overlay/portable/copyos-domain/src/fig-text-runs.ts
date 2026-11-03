import { importFigFontFeatures } from './fig-font-features.ts'
/** Import explicit Kiwi character-style identities without treating table positions as style identifiers. */
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { CopyOSDesignNode, CopyOSDesignTextRun, CopyOSDesignTextRunStyle } from './types.ts'
import { normalizeDesignTextRuns } from './design-text-runs.ts'

const supported = new Set([
  'styleID',
  'toggledOnOTFeatures',
  'toggledOffOTFeatures',
  'hyperlink',
  'fontName',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'fillPaints',
])
/** Line height Figma reports as Auto; CopyOS stores a font-size multiple and has no font-metric Auto value. */
export const FIG_AUTO_LINE_HEIGHT = 1.2

/**
 * Convert a Kiwi line height to a font-size multiple. Figma saves typed percentages as RAW multiples and Auto as
 * PERCENT 100, where PERCENT is relative to the font's natural line height (approximated by FIG_AUTO_LINE_HEIGHT).
 * @param lineHeight - Kiwi line height value and units.
 * @param fontSize - Resolved font size in pixels.
 * @param warn - Import review sink; PERCENT values report the approximation.
 * @returns Finite font-size multiple, or undefined for unknown units or non-finite values.
 */
export function figLineHeightRatio(lineHeight: { value: number; units: string }, fontSize: number,
  warn: (message: string) => void): number | undefined {
  const { value, units } = lineHeight
  // RAW multiples are 32-bit floats; rounding restores the typed percentage (140% → 1.4, not 1.39999998).
  const ratio = units === 'RAW' ? Math.round(value * 10000) / 10000 : units === 'PIXELS' ? value / fontSize
    : units === 'PERCENT' ? value / 100 * FIG_AUTO_LINE_HEIGHT : undefined
  if (units === 'PERCENT') warn(`Auto line height uses ${FIG_AUTO_LINE_HEIGHT}× font size; review against the font's natural line height`)
  return ratio !== undefined && Number.isFinite(ratio) ? ratio : undefined
}
const weight = (style: string): number => {
  const name = style.toLowerCase().replace(/[\s_-]/g, '')
  return name.includes('semibold') || name.includes('demibold')
    ? 600
    : name.includes('extrabold')
      ? 800
      : name.includes('black') || name.includes('heavy')
        ? 900
        : name.includes('bold')
          ? 700
          : name.includes('medium')
            ? 500
            : name.includes('extralight') || name.includes('ultralight')
              ? 200
              : name.includes('light')
                ? 300
                : name.includes('thin')
                  ? 100
                  : 400
}
function readStyle(
  raw: NodeChange,
  base: CopyOSDesignNode,
  warn: (message: string) => void,
): CopyOSDesignTextRunStyle {
  const fontFeatures = importFigFontFeatures(raw, warn)
  const result: CopyOSDesignTextRunStyle = fontFeatures === undefined ? {} : { fontFeatures }
  const numeric = (key: 'fontSize' | 'fontWeight', min: number, max: number) => {
    const value = raw[key]
    if (value === undefined) return
    if (
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (key !== 'fontWeight' || Number.isInteger(value))
    )
      result[key] = value
    else warn(`Invalid mixed text ${key} requires review; inherited value retained`)
  }
  numeric('fontSize', 1, 1000)
  numeric('fontWeight', 100, 900)
  if (raw.fontName !== undefined) {
    if (
      typeof raw.fontName.family === 'string' &&
      raw.fontName.family.length > 0 &&
      raw.fontName.family.length <= 200
    )
      result.fontFamily = raw.fontName.family
    else warn('Invalid mixed text font family requires review; inherited family retained')
    if (typeof raw.fontName.style === 'string') {
      result.fontStyle = /italic|oblique/i.test(raw.fontName.style) ? 'italic' : 'normal'
      if (result.fontWeight === undefined) result.fontWeight = weight(raw.fontName.style)
    }
  }
  const fontSize = result.fontSize ?? base.fontSize
  if (raw.lineHeight !== undefined) {
    const ratio = figLineHeightRatio(raw.lineHeight, fontSize, warn)
    if (ratio !== undefined && ratio >= 0.5 && ratio <= 10)
      result.lineHeight = ratio
    else warn('Unsupported mixed text line height requires review; inherited line height retained')
  }
  if (raw.letterSpacing !== undefined) {
    const value = raw.letterSpacing.value,
      units = raw.letterSpacing.units
    const spacing = units === 'PIXELS' ? value : units === 'PERCENT' ? (value * fontSize) / 100 : undefined
    if (spacing !== undefined && Number.isFinite(spacing) && spacing >= -1000 && spacing <= 1000) {
      result.letterSpacing = spacing
      if (units === 'PERCENT')
        warn(
          'Mixed text percentage tracking is stored at the current font size; review after font size changes',
        )
    } else warn('Unsupported mixed text tracking requires review; inherited tracking retained')
  }
  if (raw.textDecoration !== undefined) {
    const decoration = { NONE: 'none', UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' } as const
    if (
      raw.textDecoration === 'NONE' ||
      raw.textDecoration === 'UNDERLINE' ||
      raw.textDecoration === 'STRIKETHROUGH'
    )
      result.textDecoration = decoration[raw.textDecoration]
    else warn('Unsupported mixed text decoration requires review; inherited decoration retained')
  }
  if (raw.fillPaints !== undefined) {
    const paints = raw.fillPaints.filter(paint => paint.visible !== false && (paint.opacity ?? 1) > 0),
      paint = paints[0]
    if (
      paints.length === 1 &&
      paint?.type === 'SOLID' &&
      (paint.blendMode === undefined || paint.blendMode === 'NORMAL') &&
      (paint.opacity ?? 1) === 1 &&
      (paint.color?.a ?? 1) === 1 &&
      paint.color &&
      [paint.color.r, paint.color.g, paint.color.b].every(
        channel => Number.isFinite(channel) && channel >= 0 && channel <= 1,
      )
    ) {
      result.fill =
        '#' +
        [paint.color.r, paint.color.g, paint.color.b]
          .map(channel =>
            Math.round(channel * 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
    } else
      warn('Empty, translucent or nonsolid mixed text fills require review; inherited layer paint retained')
  }
  if (Object.keys(raw).some(key => !supported.has(key)))
    warn('Additional mixed text style properties require review; supported inline fields retained')
  return result
}
/** Decode supported sparse character styles using the embedded NodeChange styleID field.
 * @param raw - Decoded native text record; zero or absent trailing character identities inherit the base style.
 * @param base - Imported text and base typography before inline overrides.
 * @param warn - Import review sink; unsupported fields never claim equivalent native formatting.
 * @returns Canonical supported runs, or undefined when no valid run can be retained.
 */
export function importFigTextRuns(
  raw: NodeChange,
  base: CopyOSDesignNode,
  warn: (message: string) => void,
): CopyOSDesignTextRun[] | undefined {
  const table = raw.textData?.styleOverrideTable,
    ids = raw.textData?.characterStyleIDs
  if (!table?.length) return
  if (
    table.length > 10000 ||
    !ids ||
    ids.length > base.text.length ||
    ids.some(id => !Number.isInteger(id) || id < 0)
  ) {
    warn('Invalid or oversized mixed text style identities require review; base text style retained')
    return
  }
  const styles = new Map<number, NodeChange>()
  for (const entry of table) {
    const id = entry.styleID
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || styles.has(id)) {
      warn('Invalid or duplicate mixed text style identity requires review; base text style retained')
      return
    }
    styles.set(id, entry)
  }
  const parsed = new Map<number, CopyOSDesignTextRunStyle>(),
    runs: CopyOSDesignTextRun[] = []
  for (let start = 0; start < ids.length; ) {
    const id = ids[start] ?? 0
    let end = start + 1
    while (end < ids.length && ids[end] === id) end++
    if (id !== 0) {
      const entry = styles.get(id)
      if (!entry)
        warn('Missing mixed text style identity requires review; that range inherits the base style')
      else {
        let style = parsed.get(id)
        if (!style) {
          style = readStyle(entry, base, warn)
          parsed.set(id, style)
        }
        if (Object.keys(style).length) runs.push({ start, end, style })
      }
    }
    if (runs.length > 1000) {
      warn('Mixed text run budget exceeded; base text style retained')
      return
    }
    start = end
  }
  try {
    const normalized = normalizeDesignTextRuns(base.text, runs)
    return normalized.length ? normalized : undefined
  } catch (error) {
    // Malformed file ranges must not split a surrogate pair or discard the original text.
    if (!(error instanceof Error)) throw error
    warn('Mixed text character boundaries require review; base text style retained')
    return
  }
}
