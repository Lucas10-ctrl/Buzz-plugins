# paints-effects-masks: fills, gradients, pictures, shadows, blurs, blend modes, masks and corners

## Paints (fills and strokes)
```js
{ type: 'SOLID', color: { r, g, b }, opacity: 1 }
{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r, g, b, a } }, …] }
{ type: 'GRADIENT_RADIAL', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [...] }   // centre 0.5,0.5, radius 0.5 of the box
{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' | 'STRETCH', filters: { exposure: 0.1, contrast: 0.2, saturation: -1, temperature: 0.3, tint: 0, highlights: -0.2, shadows: 0.2 } }
```
- Several fills stack bottom to top; each has its own `opacity`, `visible` and `blendMode`.
- CROP: `imageTransform: [[sx, 0, tx], [0, sy, ty]]` is the visible window of the picture (as in Figma). `scalingFactor` sets TILE size.
- Image filters (−1..1) are baked into the export: saturation −1 is black and white, temperature > 0 warmer.
- Strokes: `strokeWeight`, `strokeAlign INSIDE | CENTER | OUTSIDE`, per-side weights on frames and rectangles, `dashPattern [10, 6]`,
  `strokeCap`, `strokeJoin`. A stroke-only ellipse is a ring.

## Effects
```js
node.effects = [
  { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' },
  { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.14 }, offset: { x: 0, y: -3 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' },
  { type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 40, visible: true },
  { type: 'BACKGROUND_BLUR', blurType: 'NORMAL', radius: 30, visible: true },
]
```
- Blur radius means what it means in Figma (Gaussian sigma = radius / 2).
- `BACKGROUND_BLUR` blurs everything drawn behind the layer, inside the layer's shape, under its own fill: give the layer a
  semi-transparent fill (white at 0.6–0.85 for iOS frosted panels).
- A blurred picture that bleeds past the frame keeps solid edges, as in Figma.
- Shadows on text follow the glyphs, as in Figma.

## Blend modes
`node.blendMode` and per-paint `blendMode`: NORMAL, MULTIPLY, SCREEN, OVERLAY, DARKEN, LIGHTEN, COLOR_DODGE, COLOR_BURN,
HARD_LIGHT, SOFT_LIGHT, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY (and PASS_THROUGH on groups and frames).
Typical ad uses: a tone rectangle in MULTIPLY to darken a photo, SOFT_LIGHT for a warm glow, SCREEN for light leaks.

## Masks and clipping
- `frame.clipsContent = true` clips children to the frame's shape, including `cornerRadius` and `cornerSmoothing`.
- `isMask = true`: the layer masks every later sibling in its parent (until the next mask) and is not drawn itself.
  `maskType = 'ALPHA'` (default, the mask's opacity), `'VECTOR'` (its outline), `'LUMINANCE'` (its brightness).
```js
// circular zoom of a photo with a thick ring: the mask clips the picture after it in the same group
const disc = figma.createEllipse(); disc.resize(420, 420); disc.isMask = true
const pic = figma.createRectangle(); pic.resize(420, 420)
pic.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'CROP', imageTransform: [[0.3, 0, 0.55], [0, 0.3, 0.2]] }]
ad.appendChild(disc); ad.appendChild(pic)
const zoom = figma.group([disc, pic], ad); zoom.name = 'Zoom'; zoom.x = 600; zoom.y = 300
const ring = figma.createEllipse(); ad.appendChild(ring); ring.resize(420, 420); ring.x = 600; ring.y = 300
ring.fills = []; ring.strokes = [figma.util.solidPaint('#ffd400')]; ring.strokeWeight = 14; ring.strokeAlign = 'INSIDE'
```
A frame with `clipsContent = true` and `cornerRadius` = half its size does the same for a plain circle.

## Corners
`cornerRadius`, per-corner radii, and `cornerSmoothing` 0–1 (0.6 = iOS squircle) on frames, rectangles and components; it
applies to fills, strokes, clipping and shadows.
