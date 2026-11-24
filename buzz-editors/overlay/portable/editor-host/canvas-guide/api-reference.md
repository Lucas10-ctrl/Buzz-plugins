# api-reference: what `runCanvasScript` supports

Names, units and behaviour follow the Figma Plugin API. "Throws" means the call fails with Figma-style wording and the way to
get the same look; nothing is ever accepted and then silently dropped.

## figma global

| Area | Supported |
|---|---|
| Create | `createFrame`, `createAutoLayout(direction?, props?)`, `createRectangle`, `createEllipse`, `createText`, `createLine`, `createStar`, `createPolygon`, `createVector`, `createComponent`, `createComponentFromNode(frameOrGroup)`, `createNodeFromSvg(svg)`, `createTextStyle`, `createImageAsync(path \| https URL \| data URL)` |
| Combine | `group(nodes, parent, index?)`, `union` / `subtract` / `intersect` / `exclude(nodes, parent, index?)` (real boolean shapes) |
| Find | `currentPage.children`, `currentPage.findOne/findAll/findChild/findChildren/findAllWithCriteria({types})`, `currentPage.query(selector)`, `getNodeById`, `getNodeByIdAsync`, `root.findAll` |
| Fonts | `loadFontAsync({family, style})` (installs any Google font), `listAvailableFontsAsync()` (the loaded faces) |
| Pictures | `createImageAsync(source)` → `{hash, getSizeAsync()}`, `getImageByHash(hash)` |
| Styles | `getLocalTextStyles(Async)`, `getStyleById(Async)`, `createTextStyle`; `getLocalPaintStyles` / `getLocalEffectStyles` return `[]` |
| Variables | `figma.variables.getLocalVariableCollections(Async)`, `getVariableCollectionById`, `getLocalVariables(Async)(type?)`, `getVariableById(Async)`, `createVariableCollection`, `createVariable(name, collection, 'COLOR' \| 'FLOAT')`, `setBoundVariableForPaint(paint, 'color', v)` (returns a new paint), `setBoundVariableForEffect` |
| Util | `figma.util.rgb('#hex')`, `rgba('#hex' or '#hexaa')`, `solidPaint('#hex', overrides?)`, `figma.mixed` |
| Other | `notify` (logged), `viewport` (inert), `commitUndo`, `closePlugin` (no-ops), `createPage` (adds to the current page, warns) |
| Canvas | `canvas.icon(name, {color, size, strokeWidth})` → SVG for `createNodeFromSvg`; `canvas.icons(query)` → names |

Throws with a hint: `combineAsVariants`, `createComponentSet` (one component per variant + `swapComponent`),
`importComponentByKeyAsync` / `importComponentSetByKeyAsync` / `importStyleByKeyAsync` (no team libraries: use
`getDesignSystem`, templates), `createPaintStyle` (bind a COLOR variable), `createEffectStyle` (set `effects`),
`createGridStyle`, `createSection`, `createSlice`, `createTextPath`, `createImage(bytes)` (use `createImageAsync`),
`flatten` (use `union`), `exportAsync` (use `viewDesign` / `exportDesign`).

## Every node

`id`, `type`, `name`, `parent`, `children`, `visible`, `locked`, `removed`, `remove()`, `clone()`, `set(props)`, `query(selector)`,
`findOne/findAll/findChild/findChildren/findAllWithCriteria/findOneWithCriteria`, `getPluginData/setPluginData`,
`getSharedPluginData/setSharedPluginData`, `toJSON()`.

Geometry: `x`, `y`, `width`, `height` (read: measured), `resize(w, h)` and `resizeWithoutConstraints` (both set Fixed sizing),
`rotation` (degrees, counter-clockwise, around the top-left corner as in Figma), `relativeTransform` (rotation and flips;
skew or scale throws and points to `resize`), `absoluteTransform`, `absoluteBoundingBox`, `absoluteRenderBounds`,
`constraints {horizontal, vertical: MIN | MAX | CENTER | STRETCH | SCALE}`, `lockAspectRatio()` / `unlockAspectRatio()`,
`targetAspectRatio`.

Appearance: `opacity`, `blendMode` (all 16 Figma modes, plus `PASS_THROUGH`), `fills`, `strokes`, `strokeWeight`,
per-side `strokeTopWeight/Right/Bottom/Left`, `strokeAlign INSIDE | CENTER | OUTSIDE`, `strokeCap`, `strokeJoin MITER | ROUND | BEVEL`,
`strokeMiterLimit`, `dashPattern`, `cornerRadius` and `topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius`,
`cornerSmoothing` (0–1, iOS squircle), `clipsContent`, `effects`, `isMask`, `maskType ALPHA | VECTOR | LUMINANCE`,
`setBoundVariable(field, variable)` for `cornerRadius`, `itemSpacing`, paddings, `strokeWeight`, `fontSize`, `lineHeight`,
`letterSpacing`, `paragraphSpacing`, radii; `boundVariables`; `setExplicitVariableModeForCollection(collection, modeId)`,
`clearExplicitVariableModeForCollection`, `explicitVariableModes`.

Accepted and ignored because they never show in an exported ad: `expanded`, `exportSettings`, `reactions`,
`constrainProportions`, `description`, `documentationLinks`, `guides`, `relaunchData`, `annotations`, `devStatus`,
`placeholder`. Everything else that is not listed here throws (`object is not extensible: … has no property "x"`), so a typo
never passes silently.

## Frames, components and auto layout

`layoutMode NONE | HORIZONTAL | VERTICAL`, `itemSpacing`, `counterAxisSpacing`, `paddingTop/Right/Bottom/Left`,
`horizontalPadding`, `verticalPadding`, `primaryAxisAlignItems MIN | CENTER | MAX | SPACE_BETWEEN`,
`counterAxisAlignItems MIN | CENTER | MAX | BASELINE`, `counterAxisAlignContent AUTO | SPACE_BETWEEN`,
`primaryAxisSizingMode` / `counterAxisSizingMode FIXED | AUTO`, `layoutWrap NO_WRAP | WRAP`, `itemReverseZIndex`,
`minWidth`, `maxWidth`, `minHeight`, `maxHeight`; children: `layoutSizingHorizontal` / `layoutSizingVertical FIXED | HUG | FILL`,
`layoutGrow`, `layoutAlign INHERIT | STRETCH`, `layoutPositioning AUTO | ABSOLUTE`.
`appendChild(node)`, `insertChild(index, node)`.

Components: `createComponent()`, `component.createInstance()`, `instance.mainComponent`, `getMainComponentAsync()`,
`instance.detachInstance()`, `instance.swapComponent(component)`. An instance's layers are reachable (`instance.children`,
`instance.findOne(...)`, ids `I<instance>;<layer>`): setting `characters`, `visible`, text range styles or a nested swap on them
stores an override; anything else on an instance layer throws and says to `detachInstance()` first.
Not yet: variants, component properties (`setProperties`, `addComponentProperty` throw with the alternative).

## Text

`characters`, `fontName`, `fontSize`, `fontWeight` (read), `lineHeight {unit: PIXELS | PERCENT | AUTO, value}`,
`letterSpacing {unit: PIXELS | PERCENT, value}`, `paragraphSpacing`, `textAlignHorizontal LEFT | CENTER | RIGHT | JUSTIFIED`,
`textAlignVertical TOP | CENTER | BOTTOM`, `textAutoResize WIDTH_AND_HEIGHT | HEIGHT | NONE | TRUNCATE`,
`textTruncation DISABLED | ENDING`, `maxLines`, `textCase ORIGINAL | UPPER | LOWER`, `textDecoration NONE | UNDERLINE | STRIKETHROUGH`,
`textStyleId`. Ranges: `setRangeFills`, `setRangeFontName`, `setRangeFontSize`, `setRangeTextDecoration`, `setRangeLetterSpacing`,
`setRangeLineHeight`, `getStyledTextSegments(fields)`. Colour emoji and symbols draw from fallback fonts.
Throws with a hint: `paragraphIndent`, `listSpacing`, `hangingPunctuation`, `hangingList`, `leadingTrim`, `textCase TITLE / SMALL_CAPS`.

## Paints and effects

Paints: `SOLID`, `GRADIENT_LINEAR`, `GRADIENT_RADIAL` (with `gradientTransform` and `gradientStops`), `IMAGE`
(`scaleMode FILL | FIT | CROP | TILE | STRETCH`, `imageTransform` for CROP, `scalingFactor` for TILE, `rotation`, `filters
{exposure, contrast, saturation, temperature, tint, highlights, shadows}` each −1..1), each with `opacity`, `visible`, `blendMode`.
`GRADIENT_ANGULAR`, `GRADIENT_DIAMOND`, `VIDEO` and `PATTERN` throw.
Effects: `DROP_SHADOW`, `INNER_SHADOW` (`color`, `offset`, `radius`, `spread`, `visible`), `LAYER_BLUR`, `BACKGROUND_BLUR`
(`radius`, `blurType NORMAL`). Progressive blur, `NOISE`, `TEXTURE` and `GLASS` throw.

## Vectors

`createVector()` + `vectorPaths = [{ windingRule: 'NONZERO' | 'EVENODD', data: 'M0 0 L10 10 C… Z' }]` (any SVG path syntax),
`createStar` (`pointCount`, `innerRadius`), `createPolygon` (`pointCount`), `createLine` (a 1 px line along x; `strokeWeight`,
`strokes`, `rotation`), `createNodeFromSvg` (paths, basic shapes, `<g>` transforms, viewBox, `<use>`, strokes with caps/joins/
dashes, opacity, linear and radial gradient fills; text, images, filters, clip paths and masks inside the SVG are reported in
`warnings`). `vectorNetwork`, `arcData` and `outlineStroke()` throw with the SVG alternative.

## Operations around the script

`createDesign`, `listDesigns`, `readDesign`, `getDesignSystem`, `getDesignMetadata`, `inspectDesign`, `viewDesign`, `exportDesign`,
`placeDesignImage`, `putDesignImage`, `listDesignFonts`, `installDesignFonts {families}`, `uploadDesignFont {source}`,
`listDesignIcons`, `listDesignTemplates`, `readDesignTemplate`, `insertDesignTemplate`, `editDesign`, comments
(`listDesignComments`, `addDesignComment`, `setDesignCommentStatus`), `getStyleGuide`, page building
(`previewDesignPage`, `buildDesignPage`, `reviewDesignPageUpdate`, `applyDesignPageUpdate`), `readCanvasGuide {topic}`.
