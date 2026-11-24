# canvas-use: designing in Canvas with the Figma Plugin API

Canvas is a local design tool that runs the **same Plugin API JavaScript you would send to Figma's `use_figma`**. Read this
once before your first `runCanvasScript`. It is Canvas's equivalent of Figma's `figma-use` skill, and it only describes what
Canvas really does. Anything Canvas cannot do yet throws an error in Figma's wording with the way to get the same look; it is
never silently drawn wrong.

Topics (read with `readCanvasGuide {topic}`, or the MCP resource `canvas://guide/<topic>`):
`canvas-use` (this page), `generate-design` (building an ad or a screen from scratch or from a brand), `api-reference`,
`gotchas`, `text`, `paints-effects-masks`, `vectors-icons`, `components-variables-styles`, `validation-and-recovery`,
`figma-tools` (Figma's MCP tools and their Canvas equivalents).

## 1. The loop

1. `createDesign {title}` → `{id, revision}` (or `listDesigns` / `readDesign` for an existing one).
2. `runCanvasScript {designId, expectedRevision, code}` → `{revision, result, logs, warnings, unmeasuredText, created}`.
   Pass the revision you got last; every successful script returns the next one.
3. `viewDesign {designId, artboardId, scale}` → the PNG. It is the **same renderer, fonts and crop as `exportDesign`**: at one
   scale it is byte-for-byte the export, so what you check is what ships.
4. `getDesignMetadata {designId, nodeId?, depth?}` → an XML outline (ids, types, names, geometry, rotation, fills, text, font,
   masks, effects), like Figma's `get_metadata`. Use it to check structure without a screenshot.
5. Fix with another script (find nodes by id or name) and check again. Then `exportDesign {designId, artboardId, scale}`.

## 2. Critical rules

1. **The code is the body of an async function.** Use top-level `await` and `return`. Do not wrap it in an IIFE and do not call
   `figma.closePlugin()` (it is accepted and does nothing).
2. **`return` is your output channel.** Return every created or changed node id (`return { frame: frame.id, created: [...] }`).
   Unlike Figma, `console.log` output does come back (in `logs`), but `return` is what later calls should rely on.
3. **A script is all or nothing.** If it throws, nothing is saved and the revision does not change, so it is always safe to fix
   the error and run it again. Errors carry the script's line number.
4. **Colours are 0–1**: `{ r: 1, g: 0.4, b: 0 }`. Put transparency on the paint (`{ type: 'SOLID', color, opacity: 0.5 }`).
   `figma.util.rgb('#ff6600')` and `figma.util.solidPaint('#ff6600', { opacity: 0.5 })` convert hex.
5. **Fills, strokes and effects are arrays you replace**: copy, change, reassign (`node.fills = [...]`). Changing an item of
   the array you read has no effect, as in Figma.
6. **Load every font before you touch text**: `await figma.loadFontAsync({ family: 'Poppins', style: 'SemiBold' })`. Any Google
   font installs itself on first use, with all its weights and italics; Inter is built in. Brand fonts that are not on Google
   are uploaded once per project with `uploadDesignFont {source: '/path/Brand-Bold.otf'}` and then load the same way.
   Style names are Figma's: `Thin`, `ExtraLight`, `Light`, `Regular`, `Medium`, `SemiBold`, `Bold`, `ExtraBold`, `Black`, plus
   `Italic` (`Bold Italic`). A style the family lacks throws `Font "X Y" has no such style. Installed styles: …`.
   There is no limit on how many fonts a project uses.
7. **`resize()` sets both sizing modes to FIXED**, exactly as Figma does. Call `resize()` first, then set
   `primaryAxisSizingMode` / `counterAxisSizingMode = 'AUTO'` or `layoutSizing* = 'HUG'`. A frame resized after you asked it to
   hug stays at the size you passed.
8. **`layoutSizingHorizontal/Vertical = 'FILL'` needs an auto-layout parent**: `appendChild` first, then set FILL. `HUG` is for
   auto-layout frames and for text. `primaryAxisSizingMode`/`counterAxisSizingMode` take `FIXED | AUTO`; `layoutSizing*` take
   `FIXED | HUG | FILL`. Do not mix the two enums.
9. **Wrapping text** needs `textAutoResize = 'HEIGHT'` and a width (`resize(width, h)` or FILL in an auto-layout parent).
   The default `WIDTH_AND_HEIGHT` never wraps.
10. **Use auto layout for anything whose children relate** (stacks, rows, chips, cards, buttons): `figma.createAutoLayout('VERTICAL', { itemSpacing: 12 })`.
    Use absolute `x`/`y` for free composition on an ad (a sticker on a photo), or `layoutPositioning = 'ABSOLUTE'` inside an
    auto-layout frame.
11. **Put top-level frames side by side**, not all at (0, 0): read `figma.currentPage.children` and place the new frame to the
    right of the last one (`x = last.x + last.width + 120`).
12. **Pictures come from files, URLs or data URLs**: `const img = await figma.createImageAsync('/abs/photo.jpg')`, then
    `{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }`. `figma.createImage(bytes)` is not available.
13. **`await` every promise** (`loadFontAsync`, `createImageAsync`, `getNodeByIdAsync`, `getLocal…Async`).
14. **One page.** A Canvas design has one page here; `figma.createPage()` adds to the current page with a warning.
15. **Read the warnings and `unmeasuredText`** in every result. A warning means something was approximated (it says what to do
    instead); `unmeasuredText` lists text that could not be measured (a missing font or glyph).

## 3. Efficient APIs (same as `use_figma`)

- `figma.createAutoLayout(direction?, props?)`: an auto-layout frame hugging both axes. `figma.createAutoLayout('VERTICAL', { name: 'Card', itemSpacing: 12, paddingTop: 24 })`.
- `node.set(props)`: many properties in one call; `layoutMode` is applied first, `width`/`height` go through `resize()`.
- `node.query(selector)` / `figma.currentPage.query(selector)`: CSS-like search inside the subtree.
  Types (`TEXT`, `FRAME`, `INSTANCE`…), `#id`, `[name=Card]`, `[name^=Head]`, `[name*=art]`, `[name$=Nav]`, dot paths with `*`
  (`[fills.0.type=SOLID]`, `[mainComponent.name=Button]`), combinators (`A B`, `A > B`, `A + B`, `A ~ B`), `,`, `*`,
  `:first-child`, `:last-child`, `:nth-child(n)`, `:not(…)`, `:is(…)`, `:where(…)`. The result has `length`, `first()`,
  `last()`, `toArray()`, `each()`, `map()`, `filter()`, `values(['name','x'])`, `set(props)`, `query()` and is iterable.
- `node.placeholder = true/false` is accepted (Canvas has nothing to shimmer; it is never drawn or exported).
- `node.screenshot()` cannot return a picture from a Canvas script: call `viewDesign` after the script.

Canvas extras:
- `canvas.icon(name, { color, size, strokeWidth })` returns SVG markup for `figma.createNodeFromSvg`: 67 line icons (search,
  star, check, x, arrows, chevrons, heart, thumbs-up, phone, mail, map-pin, clock, users, cart, shield-check, bar-chart, …) and
  brand marks (`google-g` in four colours, google, google-maps, facebook, instagram, tiktok, youtube, x, apple, shopify,
  whatsapp, pinterest, reddit, spotify, trustpilot, stripe, paypal). `canvas.icons('arrow')` or `listDesignIcons {query}` lists names.

## 4. Incremental workflow

- Build a whole ad in one script when you can; it is atomic, so a failure costs nothing. Split only when a script would be
  very long or when you want to look before continuing.
- Return ids and the facts you need next (sizes, counts). No state survives between scripts: pass ids as string literals.
- Order inside a script: fonts → pictures → the top frame (resize, fills, clip) → sections as auto-layout frames → text →
  free-floating decorations (stickers, arrows, badges) → effects.
- After composing, take one `viewDesign` at `scale: 0.5` (9:16 ads) or `1` (1:1), look properly (clipped words, overlaps,
  wrong wraps, missing pictures), fix, and look once more. Stop when it passes.

## 5. Pre-flight checklist

- [ ] Every font loaded with `await` before text is created or changed; style names spelled as Figma spells them.
- [ ] Colours 0–1, opacity on the paint.
- [ ] `resize()` before AUTO/HUG; FILL only after `appendChild` into an auto-layout frame.
- [ ] Wrapping text: `textAutoResize = 'HEIGHT'` plus a width.
- [ ] Pictures through `figma.createImageAsync`.
- [ ] New top-level frame placed away from existing ones; returns all ids.
- [ ] After the run: no warnings you did not expect, `unmeasuredText` empty.

## 6. Error recovery

- The script threw: nothing changed. Read the message (it names the property and the fix), correct it, run again with the
  same `expectedRevision`.
- `expectedRevision` mismatch: someone (or a previous call) changed the design. `readDesign` or `getDesignMetadata` for the
  current revision and state, then continue.
- It ran but looks wrong: `getDesignMetadata {nodeId}` for geometry, then a small script that changes only that node.
- `TypeError: object is not extensible: … has no property "x"`: a misspelt or non-Figma property name.
- `x is not supported in Canvas yet. …`: a real Figma feature Canvas lacks; the message says what to use instead.

## 7. Discover before you create

- `getDesignSystem {designId}`: components, text styles, variables (per mode) and named layers per frame.
- `getStyleGuide`: the project's brand colours, fonts and voice.
- `listDesignTemplates {query}` / `insertDesignTemplate`: ready ad layouts (product hero, benefit callouts, testimonial, us vs
  them, before/after, offer, founder quote, UGC post) in 1:1, 4:5 and 9:16.
- In a script: `figma.currentPage.query('FRAME').values(['name','width','height'])`, `await figma.getLocalTextStylesAsync()`,
  `(await figma.variables.getLocalVariableCollectionsAsync())[0]`.

## 8. Snippets

Ad frame with a photo, a dark gradient wash and a headline:

```js
await figma.loadFontAsync({ family: 'DM Sans', style: 'Bold' })
const photo = await figma.createImageAsync('/abs/street.jpg')
const ad = figma.createFrame()
ad.name = 'Ad 9:16'; ad.resize(1080, 1920); ad.clipsContent = true
ad.fills = [{ type: 'IMAGE', imageHash: photo.hash, scaleMode: 'FILL' }]
const wash = figma.createRectangle(); ad.appendChild(wash); wash.resize(1080, 1920)
wash.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]],
  gradientStops: [{ position: 0, color: { r: 0.03, g: 0.06, b: 0.16, a: 0.9 } }, { position: 0.6, color: { r: 0.03, g: 0.06, b: 0.16, a: 0 } }] }]
const head = figma.createText(); ad.appendChild(head)
head.fontName = { family: 'DM Sans', style: 'Bold' }; head.fontSize = 88
head.lineHeight = { unit: 'PERCENT', value: 105 }; head.letterSpacing = { unit: 'PERCENT', value: -2 }
head.characters = 'Get found on Google'
head.textAutoResize = 'HEIGHT'; head.resize(920, 100); head.x = 80; head.y = 260
head.fills = [figma.util.solidPaint('#ffffff')]
return { frame: ad.id }
```

A rotated sticker with a shadow, sized by its text:

```js
const tag = figma.createAutoLayout('HORIZONTAL', { name: 'Sticker', paddingLeft: 28, paddingRight: 28, paddingTop: 14, paddingBottom: 14, cornerRadius: 14 })
ad.appendChild(tag)
tag.fills = [figma.util.solidPaint('#ffd400')]
tag.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' }]
const label = figma.createText(); tag.appendChild(label)
label.fontName = { family: 'DM Sans', style: 'Bold' }; label.fontSize = 44; label.characters = '47% OFF'
tag.rotation = -8; tag.x = 640; tag.y = 1180
```

One text with a coloured word and a second font:

```js
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
await figma.loadFontAsync({ family: 'Noto Serif', style: 'Italic' })
const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Regular' }; t.fontSize = 64
t.characters = 'Show up on Google & ChatGPT'
const at = t.characters.indexOf('Google')
t.setRangeFills(at, at + 6, [figma.util.solidPaint('#1a73e8')])
t.setRangeFontName(at, at + 6, { family: 'Noto Serif', style: 'Italic' })
```
