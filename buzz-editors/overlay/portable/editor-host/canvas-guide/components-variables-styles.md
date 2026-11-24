# components-variables-styles: components, instances, variables, modes and text styles

## Components and instances
```js
const chip = figma.createComponent()
chip.name = 'Chip'; chip.layoutMode = 'HORIZONTAL'; chip.primaryAxisSizingMode = 'AUTO'; chip.counterAxisSizingMode = 'AUTO'
chip.paddingLeft = 16; chip.paddingRight = 16; chip.paddingTop = 8; chip.paddingBottom = 8; chip.cornerRadius = 10
const label = figma.createText(); label.name = 'Label'; chip.appendChild(label); label.characters = 'label'
for (const text of ['❌ page 4 on Google', '❌ unseen by ChatGPT']) {
  const inst = chip.createInstance(); list.appendChild(inst)
  inst.findOne(n => n.type === 'TEXT' && n.name === 'Label').characters = text   // an override; the instance stays linked
}
figma.currentPage.appendChild(chip); chip.x = ad.x; chip.y = ad.y + ad.height + 80   // keep masters off the artboard
```
- Overrides on instance layers: `characters`, `visible`, text range styles, nested `swapComponent`. Other changes throw and
  say to `detachInstance()` (or change the main component, which updates every instance).
- `instance.mainComponent`, `await instance.getMainComponentAsync()`, `instance.swapComponent(other)`, `instance.detachInstance()`.
- `figma.createComponentFromNode(frame)` turns an existing frame or group into a component.
- Not yet: variants (`combineAsVariants`), component properties (`setProperties`, `addComponentProperty`). Make one component
  per variant and swap; set instance layers directly.

## Variables
One collection per design ("Brand") with a base mode; add modes for brands or themes.
```js
const c = (await figma.variables.getLocalVariableCollectionsAsync())[0]
const ink = figma.variables.createVariable('color/ink', c, 'COLOR')
ink.setValueForMode(c.modes[0].modeId, { r: 0.08, g: 0.09, b: 0.23 })
const radius = figma.variables.createVariable('radius/card', c, 'FLOAT'); radius.setValueForMode(c.modes[0].modeId, 22)
card.fills = [figma.variables.setBoundVariableForPaint(figma.util.solidPaint('#000000'), 'color', ink)]
card.setBoundVariable('cornerRadius', radius)
const dark = c.addMode('Dark'); ink.setValueForMode(dark, { r: 1, g: 1, b: 1 }); ad.setExplicitVariableModeForCollection(c, dark)
```
- Types: `COLOR` and `FLOAT`. `STRING` and `BOOLEAN` throw (use text styles for fonts). Aliases between variables throw.
- Bindable: paint colour, `cornerRadius` and per-corner radii, `itemSpacing`, `counterAxisSpacing`, paddings, `strokeWeight`,
  `fontSize`, `lineHeight`, `letterSpacing`, `paragraphSpacing`, `width`/`height` and min/max sizes.
- `variable.scopes` and code syntax are accepted for compatibility but do not change anything in Canvas.

## Text styles
```js
const h = figma.createTextStyle(); h.name = 'display/xl'
await figma.loadFontAsync({ family: 'Poppins', style: 'Bold' })
h.fontName = { family: 'Poppins', style: 'Bold' }; h.fontSize = 72; h.lineHeight = { unit: 'PERCENT', value: 105 }
headline.textStyleId = h.id
```
Changing a style updates every text that uses it. Paint, effect and grid styles do not exist in Canvas: use COLOR variables
for shared colours and a shared `effects` array in your script for shadows.

## Templates as a design system
`listDesignTemplates {query, category}` → `insertDesignTemplate {designId, templateId, expectedRevision}` adds a finished ad
frame that shares the design's Brand collection and text styles. Re-brand it in one script: add a mode, set the colour
variables, point the `display/`, `body/`, `strong/` and `quote/` text styles at the brand fonts, fill the named text layers.
