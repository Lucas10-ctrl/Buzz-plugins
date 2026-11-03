/** Shared font-menu copy for layer and named-style editing. */
import type { DesignerFontPicker } from './DesignerFontPicker.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
/** Resolve the owning locale's font-picker labels.
 * @param t - CopyOS locale lookup.
 * @returns Complete labels for either typography entry point.
 */
export function designerFontLabels(
  t: (key: CopyOSFoundationLocaleKey) => string,
): Parameters<typeof DesignerFontPicker>[0]['labels'] {
  return {
    font: t('designerFont'),
    mixed: t('designerMixed'),
    search: t('designerFontSearch'),
    custom: t('designerFontCustom'),
    documentFonts: t('designerFontDocument'),
    bundledFonts: t('designerFontBundled'),
    localFonts: t('designerFontLocal'),
    loadLocalFonts: t('designerFontLoadLocal'),
    localDenied: t('designerFontLocalDenied'),
    localUnsupported: t('designerFontLocalUnsupported'),
    noResults: t('designerFontNoResults'),
    more: t('designerFontMore'),
  }
}
