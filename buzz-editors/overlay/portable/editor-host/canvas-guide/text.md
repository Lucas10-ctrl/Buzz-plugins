# text: Canvas's text model (it is Figma's)

Text is shaped and measured with Skia's paragraph engine (HarfBuzz) and the project's real font files, and drawn by the same
engine in `viewDesign` and `exportDesign`. Sizes you read back in a script (`t.width`, `t.height`) are the measured ones.

## Line height
- `{ unit: 'AUTO' }` (the default for new text) is the font's own line height: (ascender + descender + line gap) / em, from
  the font's horizontal header, as Figma uses. Inter ≈ 121%, Poppins 150%, DM Sans ≈ 130%, Caveat ≈ 126%.
- `{ unit: 'PERCENT', value: 110 }` and `{ unit: 'PIXELS', value: 72 }` are exact; extra space is shared above and below the
  line (half-leading), so the first baseline moves as in Figma.
- An emoji-only text with AUTO takes the emoji font's line box (one em).
- Changing `fontSize` keeps a PIXELS line height in pixels, as Figma does.

## Letter spacing
`{ unit: 'PERCENT', value: -2 }` is a percentage of the font size; `{ unit: 'PIXELS', value: 1.5 }` is absolute.

## Auto-resize
- `WIDTH_AND_HEIGHT`: one line per `\n`, the box hugs the text.
- `HEIGHT`: fixed width, wraps on word boundaries, the box grows down. Words longer than the width break.
- `NONE`: fixed box; text that does not fit overflows (it is not clipped unless a parent clips).
- `TRUNCATE` / `textTruncation = 'ENDING'` with `maxLines`: ends with an ellipsis.
A line that only just fits can wrap one word differently from Figma (sub-pixel advance differences); leave a few pixels of
slack in fixed-width headlines, and check with `viewDesign`.

## Mixed styles in one text
`setRangeFontName`, `setRangeFontSize`, `setRangeFills`, `setRangeTextDecoration`, `setRangeLetterSpacing`, `setRangeLineHeight`
over `[start, end)`. A mixed line takes the tallest line height of its runs. `getStyledTextSegments(['fontName', 'fills', …])`
reads them back. Load every font a range uses before setting it. Changing `characters` drops the ranges (set them after).

## Alignment
`textAlignHorizontal LEFT | CENTER | RIGHT | JUSTIFIED`, `textAlignVertical TOP | CENTER | BOTTOM` (inside a fixed box).

## Text on photos
Contrast comes from the layers under the text, never from the text itself: a gradient wash rectangle (`GRADIENT_LINEAR`
from 0.85 alpha to 0), a dark rounded panel at 0.6–0.8 opacity, or a `DROP_SHADOW` on the text with radius 8–16 and
alpha 0.35–0.5. `LAYER_BLUR` on a copy of the photo behind a panel, or `BACKGROUND_BLUR` on the panel itself, gives frosted glass.

## Fonts
- Any Google family by name with `loadFontAsync`; variable families get every weight and their optical-size axis (opsz =
  font size, as Figma's auto optical sizing).
- Brand files: `uploadDesignFont {source: '/path/Font-Bold.otf'}` once per project, then `loadFontAsync` by family name.
- No limit on fonts per project.
- Symbols (★ ✓ ✕ → ⌕ ✎) that a font lacks fall back to Noto Sans Symbols 2; colour emoji to Noto Color Emoji.
- A character no installed font has is reported in `unmeasuredText` (`missing-glyph`) and in `viewDesign` notes: fix it.
