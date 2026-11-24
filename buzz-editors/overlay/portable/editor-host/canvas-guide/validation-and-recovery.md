# validation-and-recovery: checking your work

## What every script result tells you
```json
{ "revision": 7, "result": { "frame": "…" }, "created": 23,
  "logs": ["…console.log output…"],
  "warnings": ["createNodeFromSvg: Text inside the SVG was left out; add it as a TEXT layer."],
  "unmeasuredText": [{ "id": "…", "code": "missing-glyph", "family": "Montserrat" }] }
```
- `warnings`: something was approximated or left out; each says what to do instead. Expect none on a finished ad.
- `unmeasuredText`: text Canvas could not measure: `missing-family` / `missing-style` (load the font), `missing-glyph`
  (a character no font has; change it or load a font that has it), `budget` (an absurdly long text).

## Structure: getDesignMetadata
`getDesignMetadata {designId, nodeId?, depth?}` returns an XML outline like Figma's `get_metadata`:
```xml
<frame id="…" name="Ad" x="0" y="0" width="1080" height="1920" fills="image:fill" clipsContent="true">
  <text id="…" name="Headline" x="80" y="260" width="920" height="186" font="DM Sans 700 88" text="Get found on Google" />
  <instance id="…" name="Chip" x="52" y="709" width="377" height="69" mainComponent="…" />
```
Check sizes, wraps (height ÷ line height = lines), positions and that nothing sits outside the frame, without a screenshot.
`inspectDesign` gives a compact per-frame summary; `readDesign` the full JSON (large).

## Pixels: viewDesign
`viewDesign {designId, artboardId, scale}` renders with the export's renderer and fonts: at `scale: 1` it equals
`exportDesign`. Use `scale: 0.5` for a 1080×1920 check, `top`/`height` to look at one band at full size. Its notes list
substituted fonts, missing pictures and missing glyphs.

## Look for
- Words cut off, overlapping or wrapping one word onto a new line; text too close to the edges (keep 9:16 copy out of the
  top 270 px and bottom 670 px for Reels/Stories UI).
- Pictures missing or cropped wrong (`scaleMode`, `imageTransform`).
- Contrast of text on photos.
- Shapes you meant to rotate around their centre that moved (rotation pivots on the top-left corner).

## Recovering
- A script that throws changes nothing: fix and re-run with the same `expectedRevision`.
- `expectedRevision` mismatch: `getDesignMetadata` (it is cheap), then continue from the current state.
- Undo a bad change: run a script that removes or resets the nodes (`figma.getNodeById(id).remove()`), or rebuild the frame:
  remove it by name at the start of the script so re-runs are idempotent:
  `for (const n of figma.currentPage.children.filter(n => n.name === 'Ad 9:16')) n.remove()`.

## Error messages and what they mean
| Message | Fix |
|---|---|
| `Font "Poppins Foo" has no such style. Installed styles: …` | Thrown by `loadFontAsync`, `fontName` or `setRangeFontName` for a made-up style or one the family lacks. Use one of the listed styles. Case and spaces are ignored in Canvas (`Semibold` = `SemiBold`), not in Figma. |
| `Cannot write to node with unloaded font "X Y"` | `await figma.loadFontAsync({ family: 'X', style: 'Y' })` first. |
| `object is not extensible: TEXT "Title" has no property "fontWeight"` | Not a Figma property (or read-only): use `fontName`. |
| `x is not supported in Canvas yet. …` | A Figma feature Canvas lacks; follow the alternative in the message. |
| `Cannot set properties of null (setting 'characters')` | `findOne` found nothing: check the name and type you searched for. |
| `The script made an invalid design: layer "Bad" (rectangle, width): …` | A value out of range (negative, NaN, huge); the layer and property are named. |
| `Unknown imageHash` | Use `(await figma.createImageAsync(source)).hash`. |
| `Range a..b is outside the text (length n)` | Compute ranges from the final `characters`. |
