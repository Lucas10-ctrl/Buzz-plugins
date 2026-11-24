# vectors-icons: paths, SVG, booleans, arrows and icons

## Icons: import SVG, never rebuild from rotated rectangles
```js
const icon = figma.createNodeFromSvg(canvas.icon('search', { color: '#5f6368', size: 32, strokeWidth: 2 }))
bar.appendChild(icon)          // a frame holding one vector per SVG shape
const g = figma.createNodeFromSvg(canvas.icon('google-g', { size: 40 }))   // the four-colour G
```
`canvas.icons('chart')` (or the `listDesignIcons {query}` operation) lists what exists: 67 line icons and 17 brand marks.
Any SVG you write yourself works too: paths, rect/circle/ellipse/line/polyline/polygon, `<g transform>`, viewBox, `<use>`,
stroke caps/joins/dashes, `fill-rule`, opacity, linear and radial gradient fills. Text, images, filters, clip paths and masks
inside the SVG are left out and named in `warnings`: add them as Canvas layers.

## Vectors
```js
const v = figma.createVector()
v.vectorPaths = [{ windingRule: 'NONZERO', data: 'M0 40 C 60 0, 120 80, 180 30' }]   // any SVG path syntax (relative, arcs, H/V)
v.strokes = [figma.util.solidPaint('#e53935')]; v.strokeWeight = 6; v.strokeCap = 'ROUND'; v.strokeJoin = 'ROUND'; v.fills = []
```
`vectorNetwork` throws: use `vectorPaths` or `createNodeFromSvg`.

## Hand-drawn arrows (for "That's you →" callouts)
```js
const arrow = figma.createNodeFromSvg(`<svg width="220" height="160" viewBox="0 0 220 160" fill="none" stroke="#e53935" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 20 C 80 10, 170 40, 190 128"/><path d="M160 112 L 190 132 L 204 98"/></svg>`)
ad.appendChild(arrow); arrow.x = 640; arrow.y = 980; arrow.rotation = -6
```

## Shapes
`createRectangle`, `createEllipse` (pie/donut via SVG path; `arcData` throws), `createStar` (`pointCount`, `innerRadius`),
`createPolygon` (`pointCount`), `createLine` (a 1 px line along x: `resize(length, 0)`, `strokeWeight`, `strokes`, `rotation`).

## Booleans
`figma.union([a, b], parent)`, `subtract`, `intersect`, `exclude` make a real boolean shape (first child's fill). Useful for
speech bubbles (rounded rect ∪ triangle), cut-out badges (circle − circle), ticket shapes.
`figma.flatten` throws: keep the boolean, or union the parts.

## Sparklines and charts
Build the path from data:
```js
const pts = [12, 18, 15, 26, 31, 29, 44]
const d = pts.map((y, i) => `${i ? 'L' : 'M'}${i * 40} ${100 - y * 2}`).join(' ')
const line = figma.createVector(); line.vectorPaths = [{ windingRule: 'NONZERO', data: d }]
line.fills = []; line.strokes = [figma.util.solidPaint('#34a853')]; line.strokeWeight = 4; line.strokeJoin = 'ROUND'
```
