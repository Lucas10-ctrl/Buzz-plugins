// run_canvas_script body: rebuild Figma template variants (dumped with figma-dump/dump-template.js) through the Figma-shaped API.
// The build script prepends `const DUMP = {...}; const PLACE = { x, y }; const ONLY = [...names] | null`.
const BRAND_MODES = ['Default', 'Example brand']
const brand = figma.variables.createVariableCollection('Brand')
const vars = {}
const existing = new Map((await figma.variables.getLocalVariablesAsync()).map(v => [v.name, v]))
const modeIds = { Default: brand.defaultModeId }
for (const mode of brand.modes) modeIds[mode.name] = mode.modeId
for (const name of BRAND_MODES) if (!modeIds[name]) modeIds[name] = brand.addMode(name)
const strings = {}
for (const v of DUMP.variables) {
  if (v.type === 'STRING') { strings[v.name] = v.values; continue }
  const variable = existing.get(v.name) || figma.variables.createVariable(v.name, brand, v.type)
  for (const mode of BRAND_MODES) variable.setValueForMode(modeIds[mode], v.values[mode])
  vars[v.name] = variable
}
const styles = new Map((await figma.getLocalTextStylesAsync()).map(s => [s.name, s]))
const loaded = new Set()
async function font(fontName) {
  const key = fontName.family + '|' + fontName.style
  if (!loaded.has(key)) { await figma.loadFontAsync({ family: fontName.family, style: fontName.style }); loaded.add(key) }
}
function role(bound) {
  if (!bound || !bound.fontFamily) return null
  if (bound.fontFamily === 'font/display/family') return 'display'
  if (bound.fontFamily === 'font/quote/family') return 'quote'
  return bound.fontStyle === 'font/strong/style' ? 'strong' : 'body'
}
function lineHeight(value) { return value.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: value.unit, value: Math.round(value.value * 100) / 100 } }
async function textStyle(n, r) {
  const lh = n.lineHeight.unit === 'AUTO' ? 'auto' : n.lineHeight.unit === 'PERCENT' ? Math.round(n.lineHeight.value) + '%' : Math.round(n.lineHeight.value) + 'px'
  const name = r + '/' + n.fontSize + '/' + lh
  if (styles.has(name)) return styles.get(name)
  const style = figma.createTextStyle()
  style.name = name
  await font(n.fontName)
  style.fontName = { family: n.fontName.family, style: n.fontName.style }
  style.fontSize = n.fontSize
  style.lineHeight = lineHeight(n.lineHeight)
  style.letterSpacing = n.letterSpacing
  styles.set(name, style)
  return style
}
function paints(list) {
  return (list || []).filter(p => p.type !== 'IMAGE').map(p => {
    const paint = { type: p.type, visible: p.visible, opacity: p.opacity, blendMode: p.blendMode }
    if (p.type === 'SOLID') { paint.color = { r: p.color.r, g: p.color.g, b: p.color.b }; if (p.colorVariable && vars[p.colorVariable]) return figma.variables.setBoundVariableForPaint(paint, 'color', vars[p.colorVariable]) }
    else { paint.gradientStops = p.gradientStops; paint.gradientTransform = p.gradientTransform }
    return paint
  })
}
const RADII = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius']
async function build(n, parent, parentAuto) {
  let node
  if (n.type === 'TEXT') node = figma.createText()
  else if (n.type === 'RECTANGLE') node = figma.createRectangle()
  else if (n.type === 'ELLIPSE') node = figma.createEllipse()
  else if (n.type === 'STAR') { node = figma.createStar(); node.pointCount = n.pointCount; node.innerRadius = n.innerRadius }
  else if (n.type === 'POLYGON') { node = figma.createPolygon(); node.pointCount = n.pointCount }
  else if (n.type === 'VECTOR') { node = figma.createVector(); node.resize(n.w, n.h); node.vectorPaths = n.vectorPaths }
  else node = figma.createFrame()
  node.name = n.name
  if (parent) parent.appendChild(node)
  if (n.type === 'TEXT') {
    const r = role(n.bound)
    await font(n.fontName)
    node.fontName = { family: n.fontName.family, style: n.fontName.style }
    if (r) node.textStyleId = (await textStyle(n, r)).id
    else { node.fontSize = n.fontSize; node.lineHeight = lineHeight(n.lineHeight); node.letterSpacing = n.letterSpacing }
    node.characters = n.characters
    node.textAlignHorizontal = n.textAlignHorizontal
    node.textAlignVertical = n.textAlignVertical
    node.textCase = n.textCase
    node.textDecoration = n.textDecoration
    node.textAutoResize = n.textAutoResize
    if (n.textAutoResize !== 'WIDTH_AND_HEIGHT') node.resize(n.w, n.h)
  } else {
    node.resize(Math.max(0.01, n.w), Math.max(0.01, n.h))
    if (n.layoutMode) {
      node.layoutMode = n.layoutMode
      node.itemSpacing = n.itemSpacing
      node.counterAxisSpacing = n.counterAxisSpacing || 0
      if (n.layoutWrap === 'WRAP') node.layoutWrap = 'WRAP'
      ;[node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft] = n.pad
      node.primaryAxisAlignItems = n.main
      node.counterAxisAlignItems = n.cross
      node.primaryAxisSizingMode = n.mainSizing
      node.counterAxisSizingMode = n.crossSizing
    }
    if (n.clip !== undefined) node.clipsContent = n.clip
  }
  node.fills = paints(n.fills)
  if (n.strokes) {
    node.strokes = paints(n.strokes)
    node.strokeWeight = n.strokeWeight
    node.strokeAlign = n.strokeAlign
    if (n.dashPattern && n.dashPattern.length) node.dashPattern = n.dashPattern
    if (n.strokeSides) { node.strokeTopWeight = n.strokeSides[0]; node.strokeRightWeight = n.strokeSides[1]; node.strokeBottomWeight = n.strokeSides[2]; node.strokeLeftWeight = n.strokeSides[3] }
  }
  if (n.radius !== undefined && !['TEXT', 'STAR', 'POLYGON', 'VECTOR'].includes(n.type)) {
    if (Array.isArray(n.radius)) RADII.forEach((key, i) => { node[key] = n.radius[i] })
    else node.cornerRadius = n.radius
    const bound = n.bound && n.bound.topLeftRadius
    if (bound && RADII.every(key => n.bound[key] === bound) && vars[bound]) node.setBoundVariable('cornerRadius', vars[bound])
    else for (const key of RADII) if (n.bound && n.bound[key] && vars[n.bound[key]]) node.setBoundVariable(key, vars[n.bound[key]])
  }
  if (n.effects) node.effects = n.effects
  if (n.opacity !== 1) node.opacity = n.opacity
  if (n.blendMode) node.blendMode = n.blendMode
  if (!n.visible) node.visible = false
  if (n.constraints) node.constraints = n.constraints
  if (parentAuto) {
    if (n.absolute) node.layoutPositioning = 'ABSOLUTE'
    if (n.sizeH) node.layoutSizingHorizontal = n.sizeH
    if (n.sizeV) node.layoutSizingVertical = n.sizeV
  }
  if (!parentAuto || n.absolute) { node.x = n.x; node.y = n.y }
  if (n.rotation) node.rotation = n.rotation
  for (const child of n.children || []) await build(child, node, !!n.layoutMode)
  return node
}
const made = []
let x = PLACE.x
for (const [key, variant] of Object.entries(DUMP.variants)) {
  if (ONLY && !ONLY.includes(key)) continue
  const [set, size] = key.split(' | ')
  const frame = await build(variant, null, false)
  frame.name = set + ' · ' + size.replace('Size=', '')
  frame.x = x; frame.y = PLACE.y
  x += variant.w + 120
  made.push({ id: frame.id, name: frame.name, w: frame.width, h: frame.height })
}
return made
