// Read-only dump of Designer's ad template variants with variable bindings (by name), constraints and the Brand collection.
const vname = async id => { const v = await figma.variables.getVariableByIdAsync(id); return v ? v.name : null }
const rgb = c => ({ r: +c.r.toFixed(5), g: +c.g.toFixed(5), b: +c.b.toFixed(5), ...(c.a !== undefined ? { a: +c.a.toFixed(4) } : {}) })
async function paint(p) {
  const o = { type: p.type, visible: p.visible !== false, opacity: p.opacity ?? 1, blendMode: p.blendMode }
  if (p.type === 'SOLID') o.color = rgb(p.color)
  if (p.type === 'IMAGE') { o.scaleMode = p.scaleMode; o.imageHash = p.imageHash }
  if (p.type.startsWith('GRADIENT')) { o.gradientStops = p.gradientStops.map(s => ({ position: s.position, color: rgb(s.color) })); o.gradientTransform = p.gradientTransform }
  if (p.boundVariables && p.boundVariables.color) o.colorVariable = await vname(p.boundVariables.color.id)
  return o
}
const FIELDS = ['width', 'height', 'itemSpacing', 'counterAxisSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'cornerRadius',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight', 'fontSize', 'fontFamily', 'fontStyle', 'opacity', 'minWidth', 'maxWidth']
async function ser(n) {
  const o = { type: n.type, name: n.name, x: n.x, y: n.y, w: n.width, h: n.height, rotation: n.rotation || 0, opacity: n.opacity, visible: n.visible }
  if (n.blendMode && n.blendMode !== 'PASS_THROUGH') o.blendMode = n.blendMode
  if ('constraints' in n) o.constraints = n.constraints
  if ('fills' in n && Array.isArray(n.fills)) o.fills = await Promise.all(n.fills.map(paint))
  if ('strokes' in n && n.strokes.length) { o.strokes = await Promise.all(n.strokes.map(paint)); o.strokeWeight = n.strokeWeight; o.strokeAlign = n.strokeAlign; o.dashPattern = n.dashPattern
    if (n.strokeTopWeight !== undefined && [n.strokeTopWeight, n.strokeRightWeight, n.strokeBottomWeight, n.strokeLeftWeight].some(v => v !== n.strokeWeight)) o.strokeSides = [n.strokeTopWeight, n.strokeRightWeight, n.strokeBottomWeight, n.strokeLeftWeight] }
  if ('cornerRadius' in n) o.radius = n.cornerRadius === figma.mixed ? [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius] : n.cornerRadius
  if ('clipsContent' in n) o.clip = n.clipsContent
  if ('layoutMode' in n && n.layoutMode !== 'NONE') Object.assign(o, { layoutMode: n.layoutMode, itemSpacing: n.itemSpacing, counterAxisSpacing: n.counterAxisSpacing, layoutWrap: n.layoutWrap,
    pad: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft], main: n.primaryAxisAlignItems, cross: n.counterAxisAlignItems, mainSizing: n.primaryAxisSizingMode, crossSizing: n.counterAxisSizingMode })
  if ('layoutSizingHorizontal' in n) { o.sizeH = n.layoutSizingHorizontal; o.sizeV = n.layoutSizingVertical }
  if ('minWidth' in n) { const lim = {}; for (const f of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) { const v = n[f]; if (v !== undefined && v !== null && v !== 'auto' && !(f.startsWith('min') && v === 0)) lim[f] = v } if (Object.keys(lim).length) o.limits = lim }
  if ('targetAspectRatio' in n && n.targetAspectRatio) o.aspectRatio = n.targetAspectRatio.aspectRatio
  if ('layoutPositioning' in n) o.absolute = n.layoutPositioning === 'ABSOLUTE'
  if ('effects' in n && n.effects.length) o.effects = n.effects.map(e => ({ type: e.type, visible: e.visible, radius: e.radius, spread: e.spread, offset: e.offset, color: e.color ? rgb(e.color) : undefined }))
  if (n.boundVariables) { const b = {}; for (const f of FIELDS) { const v = n.boundVariables[f]; if (v && !Array.isArray(v)) b[f] = await vname(v.id); if (Array.isArray(v) && v.length) b[f] = await vname(v[0].id) } if (Object.keys(b).length) o.bound = b }
  if (n.type === 'TEXT') {
    const f = n.fontName === figma.mixed ? n.getRangeFontName(0, 1) : n.fontName
    Object.assign(o, { characters: n.characters, fontName: f, fontSize: n.fontSize === figma.mixed ? n.getRangeFontSize(0, 1) : n.fontSize,
      lineHeight: n.lineHeight === figma.mixed ? n.getRangeLineHeight(0, 1) : n.lineHeight, letterSpacing: n.letterSpacing === figma.mixed ? n.getRangeLetterSpacing(0, 1) : n.letterSpacing,
      textAlignHorizontal: n.textAlignHorizontal, textAlignVertical: n.textAlignVertical, textAutoResize: n.textAutoResize, textCase: n.textCase === figma.mixed ? 'ORIGINAL' : n.textCase,
      textDecoration: n.textDecoration === figma.mixed ? 'NONE' : n.textDecoration })
    const segs = n.getStyledTextSegments(['boundVariables'])
    const bv = segs[0] && segs[0].boundVariables || {}
    for (const key of ['fontFamily', 'fontStyle', 'fontSize']) if (bv[key]) { o.bound = o.bound || {}; o.bound[key] = await vname(bv[key].id) }
  }
  if (n.type === 'STAR') { o.pointCount = n.pointCount; o.innerRadius = n.innerRadius }
  if (n.type === 'POLYGON') o.pointCount = n.pointCount
  if (n.type === 'VECTOR') o.vectorPaths = n.vectorPaths
  if ('children' in n) o.children = await Promise.all(n.children.map(ser))
  return o
}
const out = { variants: {}, variables: [] }
const coll = await figma.variables.getVariableCollectionByIdAsync('VariableCollectionId:1:3')
out.modes = coll.modes
for (const id of coll.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); const values = {}
  for (const m of coll.modes) { const x = v.valuesByMode[m.modeId]; values[m.name] = x && typeof x === 'object' && 'r' in x ? rgb(x) : x && x.type === 'VARIABLE_ALIAS' ? { alias: await vname(x.id) } : x }
  out.variables.push({ name: v.name, type: v.resolvedType, values }) }
for (const variantId of __VARIANTS__) { const v = await figma.getNodeByIdAsync(variantId)
  out.variants[v.parent.name + ' | ' + v.name] = await ser(v) }
if (!__WITH_VARIABLES__) delete out.variables
return JSON.stringify(out)
