# gotchas: mistakes that cost a re-run

Most of these are the same in Figma; the Canvas-specific ones say so.

## resize() resets sizing to FIXED
```js
// WRONG: the frame stays 300×10 forever
f.layoutMode = 'VERTICAL'; f.primaryAxisSizingMode = 'AUTO'; f.resize(300, 10)
// RIGHT: resize first, then ask it to hug
f.layoutMode = 'VERTICAL'; f.resize(300, 10); f.primaryAxisSizingMode = 'AUTO'
// or: figma.createAutoLayout('VERTICAL') and give it a width with layoutSizingHorizontal = 'FIXED' + resize before HUG on the other axis
```

## FILL and HUG need the right context
`layoutSizingHorizontal = 'FILL'` only works on a child of an auto-layout frame: `parent.appendChild(child)` first.
`HUG` works on auto-layout frames and text. `primaryAxisSizingMode` takes `FIXED | AUTO`, never `HUG` or `FILL`.

## Wrapping text needs HEIGHT and a width
```js
t.textAutoResize = 'HEIGHT'; t.resize(880, t.height)   // wraps at 880
// in an auto-layout column: parent.appendChild(t); t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT'
```
`WIDTH_AND_HEIGHT` (the default) never wraps; `\n` is the only line break.

## Fonts
- `await figma.loadFontAsync(...)` before `characters`, `fontName`, `fontSize`, range calls or styles that use the font.
- Use the font's own style name as Figma lists it: `SemiBold` for Poppins and most Google fonts, `Semi Bold` for Figma's Inter;
  `Bold Italic`, not `BoldItalic`. Canvas ignores case and spaces in style names (`Semibold` works here), Figma does not,
  so a script that must also run in Figma needs the exact name.
- A style that names no weight (`Foo`, `Bold Condensed`) or that the family lacks throws `has no such style` in Canvas, as
  in Figma. It is never quietly drawn as Regular.
- SF Pro, Helvetica Neue and other system fonts are not Google fonts: use Inter (or upload the brand file once with
  `uploadDesignFont {source}`).
- Canvas installs Google fonts with every static weight and the optical-size axis, so DM Sans, Inter and Roboto Flex match
  Figma's letter fit at every size.

## Rotation turns around the top-left corner
As in Figma, `rotation` (and `relativeTransform`) pivots on the node's own top-left corner, so `x`/`y` stay the corner's
position. To rotate around the centre, compute the corner:
```js
const cx = x + w / 2, cy = y + h / 2, a = angle * Math.PI / 180
node.rotation = angle
node.x = cx - (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a)
node.y = cy + (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a)
```
Auto-sized text that grows after it was rotated keeps its top-left corner where it was, as in Figma.

## Colours
0–1, not 0–255. Put alpha on the paint's `opacity` (Canvas also folds a `color.a` on SOLID paints into the opacity, Figma does not).
Gradient stops do take `{ r, g, b, a }`.

## Gradient direction
`gradientTransform` maps the layer's unit square into gradient space, where the gradient runs from x = 0 to x = 1.
Identity `[[1,0,0],[0,1,0]]` = left → right. Top → bottom: `[[0,1,0],[-1,0,1]]`. Bottom → top: `[[0,-1,1],[1,0,0]]`.
For a CSS angle θ (0 = up, clockwise), with r = θ·π/180:
`[[Math.sin(r), -Math.cos(r), 0.5 - Math.sin(r)/2 + Math.cos(r)/2], [Math.cos(r), Math.sin(r), 0.5 - Math.cos(r)/2 - Math.sin(r)/2]]`.

## Arrays are replaced, not mutated
`node.fills[0].color = …` does nothing. `node.fills = [{ ...node.fills[0], color: … }]`.
`setBoundVariableForPaint` returns a new paint: reassign it.

## Masks clip the siblings above them
`isMask = true` on a layer turns it into a mask for every later sibling in the same parent, up to the next mask. The usual
idiom is `figma.group([maskShape, picture], parent)` with the mask first. The mask itself is not drawn. For a plain rounded
crop a frame with `clipsContent = true` and `cornerRadius` is simpler.

## Instance layers
Change only `characters`, `visible`, text ranges or nested swaps on an instance's layers; they become overrides. For
anything else (resize a child, recolour a rectangle) `detachInstance()` first, or change the main component.

## Emoji
Colour emoji draw from Noto Color Emoji at Figma's emoji size (one em wide, centred on the line). Figma's own renderer shows
Apple-style artwork, so emoji look like the Noto set, not like iOS. An emoji-only text with AUTO line height is as tall as
its font size, as in Figma. Emoji whose default is text (❤ ☺ ✔) draw as plain glyphs in the text colour unless followed by
U+FE0F, as in Figma.

## Things Canvas does not have (they throw, with the alternative)
Variants and component properties, team libraries, paint/effect/grid styles, sections, slices, text on a path,
`vectorNetwork`, `arcData`, `flatten`, `outlineStroke`, angular/diamond gradients, progressive blur, noise/texture/glass effects,
`exportAsync` (use `viewDesign`/`exportDesign`), `createImage(bytes)` (use `createImageAsync`), more than one page.
