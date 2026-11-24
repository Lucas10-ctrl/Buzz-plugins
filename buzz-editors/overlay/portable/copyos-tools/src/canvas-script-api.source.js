// Figma-Plugin-API-shaped document API for run_canvas_script. This file is plain JavaScript evaluated INSIDE an isolated vm
// context: it never sees host objects. It talks to the host only through two captured functions that take and return strings.
// Edit this file, then run `node packages/copyos-tools/scripts/embed-canvas-script.mjs` to refresh canvas-script-api.ts.
(function install(hostSync, hostAsync, inputJson) {
  'use strict'
  const input = JSON.parse(inputJson)
  const doc = input.document
  const defaults = input.defaults
  let loadedFonts = new Set(input.fonts.map(face => face.toLowerCase()))
  let installedFamilies = input.families
  const created = []
  const logs = []
  const warnings = []
  const pending = new Map()
  let nextCall = 1
  let uuids = []
  const mixed = Object.freeze({ toString: () => 'figma.mixed' })

  function call(op, value) {
    const answer = JSON.parse(hostSync(op, JSON.stringify(value === undefined ? null : value)))
    if (answer.error) throw new Error(answer.error)
    return answer.value
  }
  function callAsync(op, value) {
    return new Promise((resolve, reject) => {
      const id = nextCall++
      pending.set(id, { resolve, reject })
      hostAsync(op, JSON.stringify(value === undefined ? null : value), id)
    })
  }
  function settle(id, json) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    const answer = JSON.parse(json)
    if (answer.error) entry.reject(new Error(answer.error)); else entry.resolve(answer.value)
  }
  function uuid() {
    if (!uuids.length) uuids = call('ids', 64)
    return uuids.pop()
  }

  // ---------- document indexes ----------
  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const pages = doc.pages && doc.pages.length ? doc.pages : null
  let currentPageId = pages ? (input.pageId || pages[0].id) : null
  let geometry = null
  let unmeasured = []
  function touch() { geometry = null }
  function siblings(parentId, pageId) {
    return doc.nodes.filter(node => node.parentId === parentId && (parentId !== null || !pages || (node.pageId || pages[0].id) === pageId))
  }
  function layout() {
    if (geometry) return geometry
    for (let pass = 0; pass < 4; pass++) {
      const answer = call('layout', doc)
      for (const [id, fields] of Object.entries(answer.metrics)) {
        const node = byId.get(id)
        if (node) Object.assign(node, fields)
      }
      geometry = new Map(Object.entries(answer.geometry))
      unmeasured = answer.unmeasured
      // Stored sizes of auto-sized text follow their measurement, so containers never hug a stale size.
      let changed = false
      for (const [id, value] of geometry) {
        const node = byId.get(id)
        if (!node || node.kind !== 'text') continue
        const width = node.textSizing === 'auto-width' ? value.width : node.width
        const height = node.textSizing === 'fixed' ? node.height : value.height
        if (Math.abs(width - node.width) > 0.01 || Math.abs(height - node.height) > 0.01) {
          // As in Figma, a rotated text grows from its fixed top-left origin, not from its centre.
          const origin = node.rotation ? figmaOrigin(node) : null
          node.width = width; node.height = height; changed = true
          if (origin) placeOrigin(node, origin)
          const at = geometry.get(id)
          if (at) { at.x = node.x; at.y = node.y }
        }
      }
      if (!changed) break
    }
    return geometry
  }
  function box(node) {
    const value = layout().get(node.id)
    return value || { x: node.x, y: node.y, width: node.width, height: node.height }
  }

  // ---------- colours and paints ----------
  const clamp01 = value => Math.max(0, Math.min(1, Number(value)))
  const hex2 = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')
  function rgbToHex(color) {
    if (!color || typeof color !== 'object') throw new Error('Colors are {r,g,b} objects with 0..1 channels')
    return '#' + hex2(color.r) + hex2(color.g) + hex2(color.b)
  }
  function hexToRgb(hex) {
    const value = /^#?([0-9a-f]{6})/i.exec(String(hex || '#000000'))
    const digits = value ? value[1] : '000000'
    return { r: parseInt(digits.slice(0, 2), 16) / 255, g: parseInt(digits.slice(2, 4), 16) / 255, b: parseInt(digits.slice(4, 6), 16) / 255 }
  }
  const SCALE = { FILL: 'fill', FIT: 'fit', CROP: 'crop', TILE: 'tile', STRETCH: 'stretch' }
  const UNSCALE = { fill: 'FILL', fit: 'FIT', crop: 'CROP', tile: 'TILE', stretch: 'STRETCH' }
  const BLEND = { NORMAL: 'normal', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten',
    COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference',
    EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' }
  const UNBLEND = Object.fromEntries(Object.entries(BLEND).map(([key, value]) => [value, key]))
  const images = new Map()
  function imageCrop(paint, node, source) {
    // Figma CROP: imageTransform [[a,0,tx],[0,d,ty]] shows the image window tx..tx+a, ty..ty+d (fractions of the image).
    const result = {}
    if (paint.imageTransform) {
      const [[a, , tx], [, d, ty]] = paint.imageTransform
      const width = node.width, height = node.height
      if (source && source.width && source.height && a > 0 && d > 0) {
        const fillScale = Math.max(width / source.width, height / source.height)
        const shownWidth = width / a, shownHeight = height / d
        result.zoom = shownWidth / (source.width * fillScale)
        result.offsetX = (-tx * shownWidth - (width - shownWidth) / 2) / width
        result.offsetY = (-ty * shownHeight - (height - shownHeight) / 2) / height
      }
    }
    for (const key of ['zoom', 'offsetX', 'offsetY']) if (typeof paint[key] === 'number') result[key] = paint[key]
    return result
  }
  function toPaint(paint, node) {
    if (!paint || typeof paint !== 'object') throw new Error('A paint is an object such as { type: "SOLID", color: { r, g, b } }')
    const base = { id: uuid(), visible: paint.visible !== false, variableId: null, color: '#000000', opacity: paint.opacity === undefined ? 1 : clamp01(paint.opacity) }
    if (paint.blendMode && paint.blendMode !== 'NORMAL' && paint.blendMode !== 'PASS_THROUGH') base.blendMode = BLEND[paint.blendMode] || 'normal'
    if (paint.type === 'SOLID') {
      base.color = rgbToHex(paint.color)
      if (paint.color && paint.color.a !== undefined) base.opacity = base.opacity * clamp01(paint.color.a)
      const bound = paint.boundVariables && paint.boundVariables.color
      if (bound) base.variableId = variableIdOf(bound.id)
      return base
    }
    if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
      const t = paint.gradientTransform || [[1, 0, 0], [0, 1, 0]]
      base.gradient = { type: paint.type === 'GRADIENT_LINEAR' ? 'linear' : 'radial',
        stops: (paint.gradientStops || []).map(stop => ({ id: uuid(), position: clamp01(stop.position), color: rgbToHex(stop.color),
          opacity: stop.color && stop.color.a !== undefined ? clamp01(stop.color.a) : 1, variableId: null })),
        transform: [t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2]] }
      return base
    }
    if (paint.type === 'IMAGE') {
      const hash = paint.imageHash
      const source = images.get(hash) || (typeof hash === 'string' && hash.startsWith('copyos-asset:') ? { url: hash } : null)
      if (!source) throw new Error('Unknown imageHash. Use (await figma.createImageAsync(pathOrUrl)).hash')
      const scaleMode = SCALE[paint.scaleMode || 'FILL']
      if (!scaleMode) throw new Error('scaleMode is FILL, FIT, CROP, TILE or STRETCH')
      base.image = { url: source.url, scaleMode, ...(source.width ? { sourceWidth: source.width, sourceHeight: source.height } : {}) }
      if (scaleMode === 'crop') Object.assign(base.image, imageCrop(paint, node, source))
      if (scaleMode === 'tile' && typeof paint.scalingFactor === 'number') base.image.tileScale = paint.scalingFactor
      if (typeof paint.rotation === 'number' && paint.rotation) base.image.rotation = paint.rotation
      if (paint.filters && typeof paint.filters === 'object') {
        const filters = {}
        for (const [key, value] of Object.entries(paint.filters)) {
          if (!['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'].includes(key))
            throw new Error('Image filters are exposure, contrast, saturation, temperature, tint, highlights and shadows (each -1..1); got ' + key)
          if (Number(value)) filters[key] = Math.max(-1, Math.min(1, Number(value)))
        }
        if (Object.keys(filters).length) base.image.filters = filters
      }
      return base
    }
    throw new Error('Unsupported paint type ' + paint.type + ' (use SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL or IMAGE)')
  }
  function fromPaint(paint) {
    const out = { type: 'SOLID', visible: paint.visible !== false, opacity: paint.opacity, blendMode: UNBLEND[paint.blendMode || 'normal'] || 'NORMAL' }
    if (paint.image) {
      const image = paint.image
      return { type: 'IMAGE', visible: out.visible, opacity: out.opacity, blendMode: out.blendMode, imageHash: image.url,
        scaleMode: UNSCALE[image.scaleMode] || 'FILL', ...(image.zoom ? { zoom: image.zoom, offsetX: image.offsetX || 0, offsetY: image.offsetY || 0 } : {}),
        ...(image.filters ? { filters: { ...image.filters } } : {}) }
    }
    if (paint.gradient) {
      const g = paint.gradient, t = g.transform
      return { type: g.type === 'linear' ? 'GRADIENT_LINEAR' : 'GRADIENT_RADIAL', visible: out.visible, opacity: out.opacity, blendMode: out.blendMode,
        gradientTransform: [[t[0], t[2], t[4]], [t[1], t[3], t[5]]],
        gradientStops: g.stops.map(stop => ({ position: stop.position, color: { ...hexToRgb(stop.color), a: stop.opacity } })) }
    }
    out.color = hexToRgb(paint.color)
    if (paint.variableId) out.boundVariables = { color: { type: 'VARIABLE_ALIAS', id: paint.variableId } }
    return out
  }
  function paintsOf(node) {
    if (node.fills) return node.fills
    if (node.kind === 'image' && node.imageUrl) return [{ id: node.id, color: node.fill, opacity: 1, visible: true, variableId: null, image: { url: node.imageUrl, scaleMode: 'fill' } }]
    if ((node.fillOpacity ?? 1) === 0) return []
    return [{ id: node.id, color: node.fill, opacity: node.fillOpacity ?? 1, visible: true, variableId: node.fillVariableId || null, ...(node.gradient ? { gradient: node.gradient } : {}) }]
  }
  function setFills(node, value) {
    if (!Array.isArray(value)) throw new Error('fills must be an array of paints')
    const paints = value.map(paint => toPaint(paint, node))
    node.fills = paints
    const solid = paints.find(paint => !paint.image && !paint.gradient)
    if (solid) { node.fill = solid.color; node.fillVariableId = solid.variableId }
    node.fillOpacity = 1
    delete node.gradient
  }
  function strokesOf(node) {
    if (node.strokes) return node.strokes
    if (!node.strokeWidth) return []
    return [{ id: node.id, color: node.stroke, opacity: node.strokeOpacity ?? 1, visible: true, variableId: node.strokeVariableId || null }]
  }

  // ---------- fonts ----------
  const WEIGHTS = [['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200], ['light', 300], ['regular', 400], ['normal', 400],
    ['book', 400], ['medium', 500], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800], ['bold', 700],
    ['black', 900], ['heavy', 900]]
  const NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }
  // Lenient only about spelling: Figma's own names differ per font file (Inter has "Semi Bold", Poppins "SemiBold"), so case,
  // spaces, hyphens and underscores are ignored. A word that names no weight ("Foo", "Bold Condensed") is not a style.
  function parseStyleOrNull(style) {
    const key = String(style === undefined ? 'Regular' : style).toLowerCase().replace(/[\s_-]+/g, '')
    const italic = key.includes('italic') || key.includes('oblique')
    const rest = key.replace('italic', '').replace('oblique', '')
    if (rest === '') return { weight: 400, italic }
    const found = WEIGHTS.find(([name]) => rest === name)
    return found ? { weight: found[1], italic } : null
  }
  function parseStyle(style) { return parseStyleOrNull(style) || { weight: 400, italic: false } }
  function installedStyles(family) {
    const prefix = familyOf(family).toLowerCase() + '|'
    const faces = [...loadedFonts].filter(face => face.startsWith(prefix)).map(face => face.split('|'))
      .sort((a, b) => Number(a[1]) - Number(b[1]) || (a[2] === 'italic') - (b[2] === 'italic'))
    return faces.length ? faces.map(([, weight, style]) => styleName(Number(weight), style === 'italic')).join(', ') : 'none loaded yet'
  }
  function noSuchStyle(family, style) {
    return new Error('Font "' + familyOf(family) + ' ' + style + '" has no such style. Installed styles: ' + installedStyles(family))
  }
  // For fontName and range fonts: a made-up style throws instead of being drawn as Regular.
  function styleOf(fontName) {
    if (!fontName || typeof fontName !== 'object' || !fontName.family) throw new Error('fontName is { family, style }')
    const parsed = parseStyleOrNull(fontName.style)
    if (!parsed) throw noSuchStyle(fontName.family, fontName.style)
    return parsed
  }
  function styleName(weight, italic) {
    const name = NAMES[Math.round((weight || 400) / 100) * 100] || 'Regular'
    return italic ? (name === 'Regular' ? 'Italic' : name + ' Italic') : name
  }
  const familyOf = value => String(value || '').split(',')[0].trim().replace(/^["']|["']$/g, '')
  // A family whose name has a word starting with a digit ("Baloo 2") is stored quoted, so it stays valid CSS for the editor.
  const cssFamily = value => { const name = familyOf(value); return /(^|\s)\d/.test(name) ? JSON.stringify(name) : name }
  function fontKey(family, style) { const parsed = parseStyle(style); return familyOf(family).toLowerCase() + '|' + parsed.weight + '|' + (parsed.italic ? 'italic' : 'normal') }
  function requireFont(family, weight, italic) {
    const name = familyOf(family)
    if (loadedFonts.has(name.toLowerCase() + '|' + weight + '|' + (italic ? 'italic' : 'normal'))) return
    throw new Error('Cannot write to node with unloaded font "' + name + ' ' + styleName(weight, italic) + '". Please call figma.loadFontAsync({ family: "' + name +
      '", style: "' + styleName(weight, italic) + '" }) and await the returned promise first. (In Canvas any Google font installs itself; brand fonts are uploaded once with uploadDesignFont {source}.)')
  }

  // ---------- variables (one collection: base mode plus token modes) ----------
  const COLLECTION_ID = 'VariableCollectionId:canvas'
  const BASE_MODE = 'base'
  const variableIdOf = id => String(id).replace(/^VariableID:/, '')
  let collectionName = input.collectionName || 'Brand'
  function variableRecord(id) {
    const plain = variableIdOf(id)
    const color = doc.variables.find(variable => variable.id === plain)
    if (color) return { kind: 'COLOR', record: color }
    const number = (doc.numberVariables || []).find(variable => variable.id === plain)
    if (number) return { kind: 'FLOAT', record: number }
    return null
  }
  const variableProxies = new Map()
  function variableProxy(id) {
    const plain = variableIdOf(id)
    if (variableProxies.has(plain)) return variableProxies.get(plain)
    const found = variableRecord(plain)
    if (!found) return null
    const proxy = {
      get id() { return plain },
      get name() { return found.record.name },
      set name(value) { found.record.name = String(value) },
      get resolvedType() { return found.kind },
      get variableCollectionId() { return COLLECTION_ID },
      get key() { return plain },
      get valuesByMode() {
        const values = { [BASE_MODE]: found.kind === 'COLOR' ? { ...hexToRgb(found.record.value), a: found.record.alpha ?? 1 } : found.record.value }
        for (const mode of doc.tokenModes || []) {
          const list = found.kind === 'COLOR' ? mode.variables : mode.numberVariables
          const entry = list.find(item => item.id === plain)
          if (entry && entry.value !== undefined) values[mode.id] = found.kind === 'COLOR' ? { ...hexToRgb(entry.value), a: entry.alpha ?? 1 } : entry.value
        }
        return values
      },
      setValueForMode(modeId, value) {
        if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') throw new Error('Variable aliases are not supported by setValueForMode in Canvas')
        const literal = found.kind === 'COLOR' ? rgbToHex(value) : Number(value)
        const alpha = found.kind === 'COLOR' && value.a !== undefined ? clamp01(value.a) : undefined
        if (modeId === BASE_MODE) {
          found.record.value = literal
          if (alpha !== undefined && alpha !== 1) found.record.alpha = alpha; else delete found.record.alpha
        } else {
          const mode = (doc.tokenModes || []).find(item => item.id === modeId)
          if (!mode) throw new Error('Unknown modeId ' + modeId)
          const list = found.kind === 'COLOR' ? mode.variables : mode.numberVariables
          let entry = list.find(item => item.id === plain)
          if (!entry) { entry = { id: plain }; list.push(entry) }
          entry.value = literal
          if (alpha !== undefined && alpha !== 1) entry.alpha = alpha; else delete entry.alpha
        }
        touch()
      },
      remove() {
        doc.variables = doc.variables.filter(variable => variable.id !== plain)
        doc.numberVariables = (doc.numberVariables || []).filter(variable => variable.id !== plain)
        for (const mode of doc.tokenModes || []) {
          mode.variables = mode.variables.filter(item => item.id !== plain)
          mode.numberVariables = mode.numberVariables.filter(item => item.id !== plain)
        }
        variableProxies.delete(plain)
        touch()
      },
    }
    variableProxies.set(plain, proxy)
    return proxy
  }
  const collection = {
    get id() { return COLLECTION_ID },
    get name() { return collectionName },
    set name(value) { collectionName = String(value) },
    get key() { return COLLECTION_ID },
    get defaultModeId() { return BASE_MODE },
    get modes() { return [{ modeId: BASE_MODE, name: input.baseModeName || 'Default' }, ...(doc.tokenModes || []).map(mode => ({ modeId: mode.id, name: mode.name }))] },
    get variableIds() { return [...doc.variables.map(variable => variable.id), ...(doc.numberVariables || []).map(variable => variable.id)] },
    addMode(name) {
      doc.tokenModes = doc.tokenModes || []
      const mode = { id: uuid(), name: String(name), variables: [], numberVariables: [] }
      doc.tokenModes.push(mode)
      return mode.id
    },
    renameMode(modeId, name) {
      const mode = (doc.tokenModes || []).find(item => item.id === modeId)
      if (mode) mode.name = String(name)
    },
    removeMode(modeId) {
      doc.tokenModes = (doc.tokenModes || []).filter(item => item.id !== modeId)
      for (const node of doc.nodes) if (node.tokenModeId === modeId) delete node.tokenModeId
      touch()
    },
  }
  const variables = {
    async getLocalVariableCollectionsAsync() { return [collection] },
    getLocalVariableCollections() { return [collection] },
    async getVariableCollectionByIdAsync(id) { return id === COLLECTION_ID ? collection : null },
    getVariableCollectionById(id) { return id === COLLECTION_ID ? collection : null },
    async getLocalVariablesAsync(type) { return variables.getLocalVariables(type) },
    getLocalVariables(type) {
      return collection.variableIds.map(variableProxy).filter(variable => variable && (!type || variable.resolvedType === type))
    },
    async getVariableByIdAsync(id) { return variableProxy(id) },
    getVariableById(id) { return variableProxy(id) },
    createVariableCollection(name) { collectionName = String(name); return collection },
    createVariable(name, _collection, type) {
      const id = uuid()
      if (type === 'COLOR') doc.variables.push({ id, name: String(name), value: '#000000' })
      else if (type === 'FLOAT') { doc.numberVariables = doc.numberVariables || []; doc.numberVariables.push({ id, name: String(name), value: 0, unit: 'px' }) }
      else throw new Error('Canvas variables are COLOR or FLOAT. Use text styles (figma.createTextStyle) for brand fonts.')
      return variableProxy(id)
    },
    setBoundVariableForPaint(paint, field, variable) {
      if (field !== 'color') throw new Error('Only the color field of a paint can be bound')
      return { ...paint, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable ? variable.id : null } } }
    },
    setBoundVariableForEffect(effect, field, variable) {
      return { ...effect, boundVariables: { ...(effect.boundVariables || {}), [field]: { type: 'VARIABLE_ALIAS', id: variable.id } } }
    },
  }
  const BINDABLE = { width: 'width', height: 'height', minWidth: 'minWidth', maxWidth: 'maxWidth', minHeight: 'minHeight', maxHeight: 'maxHeight',
    itemSpacing: 'gap', counterAxisSpacing: 'crossGap', paddingLeft: 'paddingLeft', paddingRight: 'paddingRight', paddingTop: 'paddingTop',
    paddingBottom: 'paddingBottom', cornerRadius: 'radius', topLeftRadius: 'radiusTopLeft', topRightRadius: 'radiusTopRight',
    bottomLeftRadius: 'radiusBottomLeft', bottomRightRadius: 'radiusBottomRight', strokeWeight: 'strokeWidth', fontSize: 'fontSize',
    lineHeight: 'lineHeight', letterSpacing: 'letterSpacing', paragraphSpacing: 'paragraphSpacing' }

  // ---------- text styles ----------
  doc.textStyles = doc.textStyles || []
  const styleProxies = new Map()
  function textStyleProxy(id) {
    if (styleProxies.has(id)) return styleProxies.get(id)
    const record = doc.textStyles.find(style => style.id === id)
    if (!record) return null
    const apply = () => {
      for (const node of doc.nodes) if (node.kind === 'text' && node.textStyleId === id) copyStyle(node, record)
      touch()
    }
    const proxy = {
      type: 'TEXT',
      get id() { return id },
      get name() { return record.name },
      set name(value) { record.name = String(value) },
      get fontName() { return { family: familyOf(record.fontFamily), style: styleName(record.fontWeight, record.fontStyle === 'italic') } },
      set fontName(value) {
        const parsed = styleOf(value)
        requireFont(value.family, parsed.weight, parsed.italic)
        record.fontFamily = cssFamily(value.family); record.fontWeight = parsed.weight; record.fontStyle = parsed.italic ? 'italic' : 'normal'; apply()
      },
      get fontSize() { return record.fontSize },
      set fontSize(value) { record.fontSize = Number(value); apply() },
      get lineHeight() { return { unit: 'PERCENT', value: record.lineHeight * 100 } },
      set lineHeight(value) { record.lineHeight = lineHeightValue(value, record.fontSize); apply() },
      get letterSpacing() { return { unit: 'PIXELS', value: record.letterSpacing } },
      set letterSpacing(value) { record.letterSpacing = letterSpacingValue(value, record.fontSize); apply() },
      remove() { doc.textStyles = doc.textStyles.filter(style => style.id !== id); for (const node of doc.nodes) if (node.textStyleId === id) node.textStyleId = null; styleProxies.delete(id) },
    }
    styleProxies.set(id, proxy)
    return proxy
  }
  function copyStyle(node, style) {
    node.fontFamily = style.fontFamily; node.fontSize = style.fontSize; node.fontWeight = style.fontWeight
    node.lineHeight = style.lineHeight; node.letterSpacing = style.letterSpacing; node.fontStyle = style.fontStyle
  }
  function lineHeightValue(value, fontSize) {
    if (typeof value === 'number') return value > 4 ? value / fontSize : value
    if (!value || value.unit === 'AUTO') return 1.2
    if (value.unit === 'PERCENT') return Number(value.value) / 100
    if (value.unit === 'PIXELS') return Number(value.value) / fontSize
    throw new Error('lineHeight is { unit: "PIXELS" | "PERCENT" | "AUTO", value }')
  }
  function letterSpacingValue(value, fontSize) {
    if (typeof value === 'number') return value
    if (!value) return 0
    if (value.unit === 'PERCENT') return Number(value.value) / 100 * fontSize
    if (value.unit === 'PIXELS') return Number(value.value)
    throw new Error('letterSpacing is { unit: "PIXELS" | "PERCENT", value }')
  }

  /** Text runs with `style` merged over [start, end), as Figma's setRange* functions do. */
  function rangeRuns(existing, length, start, end, style) {
    if (!(start >= 0 && end <= length && start < end)) throw new Error('Range ' + start + '..' + end + ' is outside the text (length ' + length + ')')
    const runs = []
    for (const run of existing || []) {
      if (run.end <= start || run.start >= end) { runs.push(run); continue }
      if (run.start < start) runs.push({ start: run.start, end: start, style: { ...run.style } })
      runs.push({ start: Math.max(run.start, start), end: Math.min(run.end, end), style: { ...run.style, ...style } })
      if (run.end > end) runs.push({ start: end, end: run.end, style: { ...run.style } })
    }
    let cursor = start
    const covered = runs.filter(run => run.start < end && run.end > start).sort((a, b) => a.start - b.start)
    for (const run of covered) { if (run.start > cursor) runs.push({ start: cursor, end: run.start, style: { ...style } }); cursor = Math.max(cursor, run.end) }
    if (cursor < end) runs.push({ start: cursor, end, style: { ...style } })
    return runs.sort((a, b) => a.start - b.start)
  }

  // ---------- strict nodes: unknown properties fail as they do in Figma ----------
  // Figma properties Canvas does not draw yet. Setting one throws (never a silent no-op) with the way to get the same look.
  const UNSUPPORTED = {
    vectorNetwork: 'Set vectorPaths ([{ windingRule, data: "M0 0 L10 10 Z" }]) or use figma.createNodeFromSvg(svg) instead.',
    arcData: 'Draw arcs and donuts as a vector: figma.createNodeFromSvg(\'<svg …><path d="…"/></svg>\').',
    paragraphIndent: 'Indent with a separate text layer or padding on an auto-layout frame.',
    listSpacing: 'Write list markers into characters and use paragraphSpacing.',
    hangingPunctuation: 'Not drawn by Canvas; leave it off.',
    hangingList: 'Not drawn by Canvas; leave it off.',
    leadingTrim: 'Not drawn by Canvas; adjust y or lineHeight instead.',
    fillStyleId: 'Canvas has no paint styles: set fills, or bind a COLOR variable with figma.variables.setBoundVariableForPaint.',
    strokeStyleId: 'Canvas has no paint styles: set strokes, or bind a COLOR variable.',
    effectStyleId: 'Canvas has no effect styles in scripts: set effects directly.',
    gridStyleId: 'Canvas has no layout grids.',
    layoutGrids: 'Canvas has no layout grids; they never show in exports anyway.',
    overflowDirection: 'Prototyping is not part of Canvas.',
    numberOfFixedChildren: 'Prototyping is not part of Canvas.',
    componentPropertyReferences: 'Canvas component properties are not scriptable yet; set the instance layer directly (instance.findOne(…).characters).',
  }
  // Figma properties with no visual effect in an exported ad: accepted and ignored, as harmless.
  const IGNORED = new Set(['expanded', 'exportSettings', 'reactions', 'constrainProportions', 'description', 'descriptionMarkdown', 'documentationLinks',
    'guides', 'isExposedInstance', 'relaunchData', 'stuckNodes', 'annotations', 'devStatus', 'componentPropertyDefinitionsOrder'])
  function strict(self, label) {
    return new Proxy(self, {
      set(target, key, value) {
        if (typeof key === 'symbol') return Reflect.set(target, key, value)
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        if (descriptor) {
          if (descriptor.set || descriptor.writable) { target[key] = value; return true }
          throw new TypeError('Cannot set property ' + key + ' of ' + label() + ', which has only a getter')
        }
        if (IGNORED.has(key)) return true
        if (UNSUPPORTED[key]) throw new TypeError(key + ' is not supported in Canvas yet. ' + UNSUPPORTED[key])
        throw new TypeError('object is not extensible: ' + label() + ' has no property "' + key + '" (Canvas follows the Figma Plugin API names; check the spelling, or readCanvasGuide for what Canvas supports)')
      },
      defineProperty() { throw new TypeError('object is not extensible') },
      deleteProperty(_target, key) { throw new TypeError('Cannot delete property ' + String(key) + ' of ' + label()) },
    })
  }

  // ---------- nodes ----------
  const TYPES = { frame: 'FRAME', group: 'GROUP', rectangle: 'RECTANGLE', ellipse: 'ELLIPSE', text: 'TEXT', image: 'RECTANGLE',
    component: 'COMPONENT', 'component-set': 'COMPONENT_SET', instance: 'INSTANCE', path: 'VECTOR', boolean: 'BOOLEAN_OPERATION' }
  const CONTAINERS = new Set(['frame', 'group', 'component', 'component-set', 'boolean'])
  const proxies = new Map()
  const lines = new Map()
  // Stars, polygons and vectors are Canvas path layers; their outline is kept in a 100 x 100 box that Canvas scales to the layer.
  const shapes = new Map()
  function shapePath(spec) {
    if (spec.type === 'VECTOR') return { width: spec.width, height: spec.height, paths: spec.paths.map(path => ({ d: path.data, fillRule: path.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero' })) }
    const points = []
    const count = Math.max(3, Math.round(spec.pointCount))
    const steps = spec.type === 'STAR' ? count * 2 : count
    for (let i = 0; i < steps; i++) {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / steps
      const radius = spec.type === 'STAR' && i % 2 ? spec.innerRadius : 1
      points.push((50 + 50 * radius * Math.cos(angle)).toFixed(3) + ' ' + (50 + 50 * radius * Math.sin(angle)).toFixed(3))
    }
    return { width: 100, height: 100, paths: [{ d: 'M' + points.join(' L') + ' Z', fillRule: 'nonzero' }] }
  }
  function makeShape(spec, name) {
    const shape = makeNode('path', name)
    const node = byId.get(shape.id)
    node.width = 100; node.height = 100; node.radius = 0
    node.fills = [{ id: uuid(), color: '#d9d9d9', opacity: 1, visible: true, variableId: null }]; node.fill = '#d9d9d9'
    shapes.set(shape.id, spec)
    node.pathData = shapePath(spec)
    return shape
  }
  const pixelLineHeights = new Map()
  const autoLineHeights = new Set()
  const fontMetrics = new Map()
  const EMOJI_ONLY = /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1f1e6}-\u{1f1ff}\u{e0020}-\u{e007f}\u200d\ufe0e\ufe0f\u20e3#*0-9]|\s)+$/u
  const HAS_EMOJI = /[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}\u20e3]/u
  function autoLineHeight(n) {
    // An emoji-only text uses the emoji font's own line height (1 em), as Figma does.
    if (n.text && HAS_EMOJI.test(n.text) && EMOJI_ONLY.test(n.text)) {
      const key = 'emoji'
      if (!fontMetrics.has(key)) fontMetrics.set(key, call('lineHeight', { family: 'Noto Color Emoji', weight: 400, style: 'normal' }))
      if (fontMetrics.get(key)) return fontMetrics.get(key)
    }
    const key = fontKey(n.fontFamily, styleName(n.fontWeight, n.fontStyle === 'italic'))
    if (!fontMetrics.has(key)) fontMetrics.set(key, call('lineHeight', { family: familyOf(n.fontFamily), weight: n.fontWeight, style: n.fontStyle || 'normal' }))
    return fontMetrics.get(key) || 1.2
  }
  const percentSpacing = new Map()
  const JUSTIFY = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'between' }
  const ALIGN = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'baseline' }
  const UNJUSTIFY = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN', around: 'SPACE_BETWEEN', evenly: 'SPACE_BETWEEN' }
  const UNALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', baseline: 'BASELINE' }
  const CONSTRAINT_H = { MIN: 'left', MAX: 'right', CENTER: 'center', STRETCH: 'left-right', SCALE: 'scale' }
  const CONSTRAINT_V = { MIN: 'top', MAX: 'bottom', CENTER: 'center', STRETCH: 'top-bottom', SCALE: 'scale' }
  const invert = map => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]))

  function primaryAxis(node) { return node.layout === 'row' ? 'width' : 'height' }
  function parentOf(node) { return node.parentId ? byId.get(node.parentId) : null }
  function inFlow(node) { const parent = parentOf(node); return !!parent && ['row', 'column', 'grid'].includes(parent.layout) && !node.absolutePosition }

  function figmaOrigin(node) {
    // Canvas rotates around the centre; Figma's x/y name the rotated top-left origin.
    if (!node.rotation) return { x: node.x, y: node.y }
    const a = node.rotation * Math.PI / 180
    return { x: node.x - Math.cos(a) * node.width / 2 + Math.sin(a) * node.height / 2 + node.width / 2,
      y: node.y - Math.sin(a) * node.width / 2 - Math.cos(a) * node.height / 2 + node.height / 2 }
  }
  function placeOrigin(node, origin) {
    const a = (node.rotation || 0) * Math.PI / 180
    node.x = origin.x + Math.cos(a) * node.width / 2 - Math.sin(a) * node.height / 2 - node.width / 2
    node.y = origin.y + Math.sin(a) * node.width / 2 + Math.cos(a) * node.height / 2 - node.height / 2
  }

  // Figma transforms: rotation θ (degrees, counter-clockwise) gives relativeTransform [[cos θ, sin θ, x], [-sin θ, cos θ, y]].
  // Canvas stores a clockwise rotation about the layer centre, plus flipX / flipY.
  function transformOf(node, size) {
    const w = size ? size.width : node.width, h = size ? size.height : node.height
    const t = (-(node.rotation || 0)) * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t)
    const fx = node.flipX ? -1 : 1, fy = node.flipY ? -1 : 1
    const a = cos * fx, b = -sin * fx, c = sin * fy, d = cos * fy
    const cx = node.x + w / 2, cy = node.y + h / 2
    return [[a, c, cx - a * w / 2 - c * h / 2], [b, d, cy - b * w / 2 - d * h / 2]]
  }
  function setTransform(node, m) {
    if (!Array.isArray(m) || m.length !== 2 || !m.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)))
      throw new Error('relativeTransform must be a Transform [[a, c, tx], [b, d, ty]]')
    const [[a, c, tx], [b, d, ty]] = m
    const sx = Math.hypot(a, b), sy = Math.hypot(c, d), det = a * d - b * c
    if (Math.abs(a * c + b * d) > 1e-3) throw new Error('Canvas cannot skew a layer: relativeTransform must be a rotation (with optional flip). Rotate with node.rotation, and draw skewed shapes as vectors (vectorPaths or figma.createNodeFromSvg).')
    if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) throw new Error('Canvas transforms cannot scale a layer: relativeTransform must have unit-length columns. Use node.resize(width, height) to change its size.')
    const flip = det < 0
    const t = Math.atan2(flip ? c : -b, flip ? d : a)
    const w = node.width, h = node.height
    const cx = a * w / 2 + c * h / 2 + tx, cy = b * w / 2 + d * h / 2 + ty
    node.rotation = Math.abs(t) < 1e-9 ? 0 : -(t * 180 / Math.PI)
    if (flip) node.flipX = true; else delete node.flipX
    delete node.flipY
    node.x = cx - w / 2; node.y = cy - h / 2
  }
  const multiply = (m, n) => [[m[0][0] * n[0][0] + m[0][1] * n[1][0], m[0][0] * n[0][1] + m[0][1] * n[1][1], m[0][0] * n[0][2] + m[0][1] * n[1][2] + m[0][2]],
    [m[1][0] * n[0][0] + m[1][1] * n[1][0], m[1][0] * n[0][1] + m[1][1] * n[1][1], m[1][0] * n[0][2] + m[1][1] * n[1][2] + m[1][2]]]

  function appendTo(parentId, child, index) {
    const node = byId.get(child.id)
    if (!node) throw new Error('That node was removed')
    if (parentId !== null) {
      let cursor = parentId
      while (cursor) { if (cursor === node.id) throw new Error('A node cannot be placed inside itself'); cursor = byId.get(cursor).parentId }
    }
    const position = doc.nodes.indexOf(node)
    doc.nodes.splice(position, 1)
    node.parentId = parentId
    if (parentId === null) { if (pages) node.pageId = currentPageId; else delete node.pageId }
    else delete node.pageId
    const others = siblings(parentId, currentPageId)
    if (index === undefined || index >= others.length) {
      const last = others[others.length - 1]
      let at = last ? doc.nodes.indexOf(last) + 1 : doc.nodes.length
      if (last) { const tail = descendants(last.id); for (const id of tail) at = Math.max(at, doc.nodes.indexOf(byId.get(id)) + 1) }
      doc.nodes.splice(at, 0, node)
    } else doc.nodes.splice(doc.nodes.indexOf(others[Math.max(0, index)]), 0, node)
    touch()
  }
  function descendants(id) {
    const result = []
    const walk = parent => { for (const node of doc.nodes) if (node.parentId === parent) { result.push(node.id); walk(node.id) } }
    walk(id)
    return result
  }
  function removeNode(id) {
    const gone = new Set([id, ...descendants(id)])
    doc.nodes = doc.nodes.filter(node => !gone.has(node.id))
    for (const value of gone) { byId.delete(value); proxies.delete(value) }
    for (const node of doc.nodes) if (node.instanceOverrides) node.instanceOverrides = node.instanceOverrides.filter(record => !record.path.some(part => gone.has(part)))
    touch()
  }
  function makeNode(kind, name) {
    const node = JSON.parse(JSON.stringify(defaults[kind]))
    node.id = uuid()
    node.name = name
    node.x = 0; node.y = 0
    if (kind === 'frame' || kind === 'component') {
      node.width = 100; node.height = 100; node.gap = 0; node.padding = 0; node.widthSizing = 'fixed'; node.heightSizing = 'fixed'
      node.fills = [{ id: uuid(), color: '#ffffff', opacity: 1, visible: true, variableId: null }]; node.fill = '#ffffff'
      node.clip = kind === 'frame'
    } else if (kind === 'rectangle' || kind === 'ellipse') {
      node.width = 100; node.height = 100; node.radius = 0
      node.fills = [{ id: uuid(), color: '#d9d9d9', opacity: 1, visible: true, variableId: null }]; node.fill = '#d9d9d9'
    } else if (kind === 'text') {
      node.fontFamily = 'Inter'; node.fontSize = 12; node.fontWeight = 400; node.lineHeight = 1.2; node.letterSpacing = 0
      node.fill = '#000000'; node.fills = [{ id: uuid(), color: '#000000', opacity: 1, visible: true, variableId: null }]
      node.textSizing = 'auto-width'; node.width = 1; node.height = 1; node.text = ''
    } else if (kind === 'group') {
      node.fills = []; node.fill = '#ffffff'; node.fillOpacity = 0
    }
    node.parentId = null
    if (pages) node.pageId = currentPageId
    doc.nodes.push(node)
    byId.set(node.id, node)
    created.push(node.id)
    if (kind === 'text') { autoLineHeights.add(node.id); node.lineHeight = autoLineHeight(node) }
    touch()
    return proxy(node.id)
  }

  function find(rootId, predicate, firstOnly) {
    const found = []
    const walk = list => {
      for (const value of list) {
        if (predicate(value)) { found.push(value); if (firstOnly) return true }
        if (walk(value.children) && firstOnly) return true
      }
      return false
    }
    walk(rootId === null ? siblings(null, currentPageId).map(node => proxy(node.id)) : proxy(rootId).children)
    return found
  }

  // ---------- instance layers ----------
  // As in Figma, an instance's children are its main component's layers, with ids "I<instance>;<layer>". Canvas instances keep
  // text, text-range, visibility and component-swap overrides; any other change asks for detachInstance().
  const samePath = (a, b) => a.length === b.length && a.every((part, index) => part === b[index])
  function sublayers(instanceId, componentId, prefix) {
    const component = componentId && byId.get(componentId)
    if (!component) return []
    return siblings(component.id, currentPageId).map(child => sublayer(instanceId, [...prefix, child.id]))
  }
  function sublayer(instanceId, path) {
    const key = 'I' + instanceId + ';' + path.join(';')
    if (proxies.has(key)) return proxies.get(key)
    const instance = () => { const value = byId.get(instanceId); if (!value) throw new Error('The instance ' + instanceId + ' was removed'); return value }
    const target = () => { const value = byId.get(path[path.length - 1]); if (!value) throw new Error('The main component no longer has layer ' + path[path.length - 1]); return value }
    const record = create => {
      const owner = instance()
      let found = (owner.instanceOverrides || []).find(item => samePath(item.path, path))
      if (!found && create) { owner.instanceOverrides = owner.instanceOverrides || []; found = { path: [...path] }; owner.instanceOverrides.push(found) }
      return found
    }
    const label = () => TYPES[target().kind] + ' "' + target().name + '" in an instance'
    const refuse = field => { throw new Error('Cannot change ' + field + ' on ' + label() + ': Canvas instances override text, text ranges, visibility and swapped components only. ' +
      'Call instance.detachInstance() first to edit it freely, or change the main component.') }
    const text = () => { const found = record(false); return found && found.text !== undefined ? found.text : target().text }
    const runs = () => { const found = record(false); return found && found.textRuns !== undefined ? found.textRuns : found && found.text !== undefined ? [] : target().textRuns }
    const writeText = (value, textRuns) => {
      const t = target()
      if (t.kind !== 'text') throw new Error('characters exists only on TEXT nodes')
      requireFont(t.fontFamily, t.fontWeight, t.fontStyle === 'italic')
      const found = record(true)
      found.text = String(value)
      if (textRuns && textRuns.length) found.textRuns = textRuns; else delete found.textRuns
      delete found.textLayoutMetrics; delete found.textBaselineMetrics
      touch()
    }
    const parentPath = () => {
      // The layer's parent: the frame it sits in inside the component, or the instance itself.
      const t = target(), owner = path.length > 1 ? byId.get(path[path.length - 2]) : instance()
      const componentId = owner.kind === 'instance' ? owner.componentId : null
      if (t.parentId === componentId) return path.length > 1 ? sublayer(instanceId, path.slice(0, -1)) : proxy(instanceId)
      return sublayer(instanceId, [...path.slice(0, -1), t.parentId])
    }
    const self = {
      get id() { return key },
      get type() { return TYPES[target().kind] || 'FRAME' },
      get name() { return target().name },
      set name(_value) { refuse('name') },
      get removed() { return !byId.has(instanceId) },
      get parent() { return parentPath() },
      get children() {
        const t = target()
        if (t.kind === 'instance') return sublayers(instanceId, t.componentId, path)
        return siblings(t.id, currentPageId).map(child => sublayer(instanceId, [...path.slice(0, -1), child.id]))
      },
      get visible() { const found = record(false); return found && found.visible !== undefined ? found.visible : target().visible },
      set visible(value) { record(true).visible = !!value; touch() },
      get opacity() { return target().opacity }, set opacity(_value) { refuse('opacity') },
      get x() { return target().x }, get y() { return target().y }, get width() { return target().width }, get height() { return target().height },
      get rotation() { return -(target().rotation || 0) },
      get fills() { return paintsOf(target()).map(fromPaint) }, set fills(_value) { refuse('fills') },
      get strokes() { return strokesOf(target()).map(fromPaint) }, set strokes(_value) { refuse('strokes') },
      get effects() { return [] }, set effects(_value) { refuse('effects') },
      get characters() { return text() },
      set characters(value) { writeText(value, null) },
      get fontName() { const t = target(); return { family: familyOf(t.fontFamily), style: styleName(t.fontWeight, t.fontStyle === 'italic') } },
      set fontName(_value) { refuse('fontName') },
      get fontSize() { return target().fontSize }, set fontSize(_value) { refuse('fontSize') },
      setRangeFills(start, end, fills) {
        const solid = (fills || []).find(paint => paint.type === 'SOLID')
        if (!solid) throw new Error('Text ranges take one SOLID fill in Canvas')
        writeText(text(), rangeRuns(runs(), text().length, start, end, { fill: rgbToHex(solid.color) }))
      },
      setRangeFontName(start, end, fontName) {
        const parsed = styleOf(fontName)
        requireFont(fontName.family, parsed.weight, parsed.italic)
        writeText(text(), rangeRuns(runs(), text().length, start, end, { fontFamily: cssFamily(fontName.family), fontWeight: parsed.weight, fontStyle: parsed.italic ? 'italic' : 'normal' }))
      },
      setRangeFontSize(start, end, size) { writeText(text(), rangeRuns(runs(), text().length, start, end, { fontSize: Number(size) })) },
      swapComponent(component) {
        if (target().kind !== 'instance') throw new Error('swapComponent exists only on INSTANCE nodes')
        record(true).componentId = component.id; touch()
      },
      get mainComponent() { const t = target(); return t.kind === 'instance' && t.componentId ? proxy(t.componentId) : null },
      async getMainComponentAsync() { return self.mainComponent },
      findOne(predicate) { return findIn(self.children, predicate, true)[0] || null },
      findAll(predicate) { return findIn(self.children, predicate || (() => true), false) },
      findChild(predicate) { return self.children.find(predicate) || null },
      findChildren(predicate) { return self.children.filter(predicate || (() => true)) },
      findAllWithCriteria(criteria) { return findIn(self.children, withCriteria(criteria), false) },
      findOneWithCriteria(criteria) { return findIn(self.children, withCriteria(criteria), true)[0] || null },
      remove() { throw new Error('Cannot remove a layer of an instance (Figma refuses this too). Hide it with visible = false, or detachInstance() first.') },
      appendChild() { refuse('children') }, insertChild() { refuse('children') }, resize() { refuse('the size') },
      toString() { return '[' + self.type + ' ' + target().name + ' ' + key + ']' },
      toJSON() { return { id: key, type: self.type, name: target().name } },
    }
    const wrapped = strict(self, label)
    proxies.set(key, wrapped)
    return wrapped
  }
  function findIn(list, predicate, firstOnly) {
    const found = []
    const walk = items => {
      for (const value of items) {
        if (predicate(value)) { found.push(value); if (firstOnly) return true }
        if (walk(value.children) && firstOnly) return true
      }
      return false
    }
    walk(list)
    return found
  }
  function withCriteria(criteria) {
    const types = criteria && criteria.types ? new Set(criteria.types) : null
    return value => !types || types.has(value.type)
  }

  function proxy(id) {
    if (proxies.has(id)) return proxies.get(id)
    const node = () => { const value = byId.get(id); if (!value) throw new Error('The node ' + id + ' was removed'); return value }
    const edit = (fn) => { fn(node()); touch() }
    const self = {
      get id() { return id },
      get type() { const n = node(); return lines.has(id) ? 'LINE' : shapes.has(id) ? shapes.get(id).type : TYPES[n.kind] || 'FRAME' },
      get removed() { return !byId.has(id) },
      get name() { return node().name },
      set name(value) { edit(n => { n.name = String(value) }) },
      get parent() { const n = node(); return n.parentId ? proxy(n.parentId) : currentPage },
      get children() { const n = node(); return n.kind === 'instance' ? sublayers(id, n.componentId, []) : siblings(id, currentPageId).map(child => proxy(child.id)) },
      get visible() { return node().visible },
      set visible(value) { edit(n => { n.visible = !!value }) },
      get locked() { return node().locked },
      set locked(value) { edit(n => { n.locked = !!value }) },
      get opacity() { return node().opacity },
      set opacity(value) { edit(n => { n.opacity = clamp01(value) }) },
      get rotation() { return -(node().rotation || 0) },
      set rotation(value) {
        // A new text is 1×1 until measured; measure first so it turns about its real top-left corner, as in Figma.
        if (node().kind === 'text' && node().textSizing !== 'fixed') layout()
        edit(n => { const origin = figmaOrigin(n); n.rotation = -Number(value); placeOrigin(n, origin) })
      },
      get x() { const n = node(); return n.rotation ? figmaOrigin(n).x : (inFlow(n) || n.parentId ? box(n).x : n.x) },
      set x(value) { edit(n => { if (n.rotation) placeOrigin(n, { x: Number(value), y: figmaOrigin(n).y }); else n.x = Number(value) }) },
      get y() { const n = node(); return n.rotation ? figmaOrigin(n).y : (inFlow(n) || n.parentId ? box(n).y : n.y) },
      set y(value) { edit(n => { if (n.rotation) placeOrigin(n, { x: figmaOrigin(n).x, y: Number(value) }); else n.y = Number(value) }) },
      get width() { return box(node()).width },
      get height() { return box(node()).height },
      get absoluteTransform() {
        let m = null
        for (let cursor = node(); cursor; cursor = parentOf(cursor)) {
          const own = transformOf({ ...cursor, ...box(cursor) })
          m = m ? multiply(own, m) : own
        }
        return m
      },
      get absoluteBoundingBox() {
        const m = self.absoluteTransform, own = box(node())
        const xs = [0, own.width].flatMap(x => [0, own.height].map(y => m[0][0] * x + m[0][1] * y + m[0][2]))
        const ys = [0, own.width].flatMap(x => [0, own.height].map(y => m[1][0] * x + m[1][1] * y + m[1][2]))
        const x = Math.min(...xs), y = Math.min(...ys)
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
      },
      get absoluteRenderBounds() { return self.absoluteBoundingBox },
      get relativeTransform() { const n = node(); return transformOf({ ...n, ...box(n) }) },
      set relativeTransform(value) {
        const n = node()
        if (n.kind === 'text' && n.textSizing !== 'fixed') layout()
        edit(target => setTransform(target, value))
      },
      resize(width, height) {
        edit(n => {
          const origin = n.rotation ? figmaOrigin(n) : null
          n.width = Math.max(1, Number(width))
          // As in Figma, auto-height text keeps its measured height; only fixed text takes the height given.
          if (n.kind !== 'text' || n.textSizing === 'fixed') n.height = Math.max(1, Number(height))
          if (lines.has(id)) n.height = Math.max(n.height, lines.get(id).weight)
          if (n.kind === 'text') { if (n.textSizing === 'auto-width') n.textSizing = 'auto-height' }
          // As in Figma, resize() sets both axes of a frame to Fixed at the new size, Hug and Fill included (set Hug after resizing).
          else { n.widthSizing = 'fixed'; n.heightSizing = 'fixed' }
          if (origin) placeOrigin(n, origin)
        })
      },
      resizeWithoutConstraints(width, height) { self.resize(width, height) },
      remove() { removeNode(id) },
      clone() {
        const map = new Map()
        const source = [node(), ...descendants(id).map(child => byId.get(child))]
        for (const item of source) map.set(item.id, uuid())
        const copies = source.map(item => {
          const copy = JSON.parse(JSON.stringify(item))
          copy.id = map.get(item.id)
          if (item.id !== id) copy.parentId = map.get(item.parentId)
          if (copy.fills) copy.fills = copy.fills.map(paint => ({ ...paint, id: uuid() }))
          if (copy.strokes) copy.strokes = copy.strokes.map(paint => ({ ...paint, id: uuid() }))
          if (copy.effects) copy.effects = copy.effects.map(effect => ({ ...effect, id: uuid() }))
          delete copy.textLayoutMetrics; delete copy.textBaselineMetrics
          return copy
        })
        const after = descendants(id).map(child => doc.nodes.indexOf(byId.get(child)))
        const at = Math.max(doc.nodes.indexOf(node()), ...after) + 1
        doc.nodes.splice(at, 0, ...copies)
        for (const copy of copies) { byId.set(copy.id, copy); created.push(copy.id) }
        if (lines.has(id)) lines.set(copies[0].id, { ...lines.get(id) })
        touch()
        return proxy(copies[0].id)
      },
      appendChild(child) { if (!CONTAINERS.has(node().kind)) throw new Error('Only frames, groups and components can hold children'); appendTo(id, child) },
      insertChild(index, child) { if (!CONTAINERS.has(node().kind)) throw new Error('Only frames, groups and components can hold children'); appendTo(id, child, index) },
      findOne(predicate) { return find(id, predicate, true)[0] || null },
      findAll(predicate) { return find(id, predicate || (() => true), false) },
      findChild(predicate) { return self.children.find(predicate) || null },
      findChildren(predicate) { return self.children.filter(predicate || (() => true)) },
      findAllWithCriteria(criteria) { return find(id, withCriteria(criteria), false) },
      findOneWithCriteria(criteria) { return find(id, withCriteria(criteria), true)[0] || null },
      // paints
      get fills() { return paintsOf(node()).map(fromPaint) },
      set fills(value) {
        edit(n => {
          if (lines.has(id)) return
          if (value === mixed) return
          setFills(n, value)
        })
      },
      setFillStyleIdAsync() { warnings.push('Paint styles are not supported in Canvas; set fills or bind a variable'); return Promise.resolve() },
      get strokes() { return lines.has(id) ? lines.get(id).strokes : strokesOf(node()).map(fromPaint) },
      set strokes(value) {
        edit(n => {
          if (!Array.isArray(value)) throw new Error('strokes must be an array of paints')
          if (lines.has(id)) { lines.get(id).strokes = value; setFills(n, value); return }
          n.strokes = value.map(paint => toPaint(paint, n))
          const solid = n.strokes[0]
          if (solid) { n.stroke = solid.color; n.strokeVariableId = solid.variableId }
          if (value.length && !n.strokeWidth) n.strokeWidth = 1
        })
      },
      get strokeWeight() { return lines.has(id) ? lines.get(id).weight : node().strokeWidth },
      set strokeWeight(value) {
        edit(n => {
          if (lines.has(id)) { const line = lines.get(id); const y = n.y + n.height / 2; line.weight = Number(value); n.height = Number(value); n.y = y - n.height / 2; return }
          n.strokeWidth = Number(value)
        })
      },
      get strokeAlign() { return (node().strokeAlign || 'inside').toUpperCase() },
      set strokeAlign(value) { edit(n => { n.strokeAlign = String(value).toLowerCase() }) },
      get dashPattern() { return node().strokeDashes || [] },
      set dashPattern(value) { edit(n => { n.strokeDashes = value.map(Number); if (!value.length) delete n.strokeDash }) },
      get strokeCap() { return (node().strokeCap || 'butt').toUpperCase() === 'BUTT' ? 'NONE' : node().strokeCap.toUpperCase() },
      set strokeCap(value) { edit(n => { n.strokeCap = value === 'ROUND' ? 'round' : value === 'SQUARE' ? 'square' : 'butt' }) },
      set strokeTopWeight(value) { edit(n => { n.strokeTopWidth = Number(value) }) },
      set strokeBottomWeight(value) { edit(n => { n.strokeBottomWidth = Number(value) }) },
      set strokeLeftWeight(value) { edit(n => { n.strokeLeftWidth = Number(value) }) },
      set strokeRightWeight(value) { edit(n => { n.strokeRightWidth = Number(value) }) },
      get cornerRadius() { const n = node(); return [n.radiusTopLeft, n.radiusTopRight, n.radiusBottomLeft, n.radiusBottomRight].some(v => v !== undefined && v !== n.radius) ? mixed : n.radius },
      set cornerRadius(value) {
        edit(n => {
          if (n.kind === 'ellipse') return
          n.radius = Number(value); delete n.radiusTopLeft; delete n.radiusTopRight; delete n.radiusBottomLeft; delete n.radiusBottomRight
        })
      },
      get topLeftRadius() { const n = node(); return n.radiusTopLeft ?? n.radius },
      set topLeftRadius(value) { edit(n => { n.radiusTopLeft = Number(value) }) },
      get topRightRadius() { const n = node(); return n.radiusTopRight ?? n.radius },
      set topRightRadius(value) { edit(n => { n.radiusTopRight = Number(value) }) },
      get bottomLeftRadius() { const n = node(); return n.radiusBottomLeft ?? n.radius },
      set bottomLeftRadius(value) { edit(n => { n.radiusBottomLeft = Number(value) }) },
      get bottomRightRadius() { const n = node(); return n.radiusBottomRight ?? n.radius },
      set bottomRightRadius(value) { edit(n => { n.radiusBottomRight = Number(value) }) },
      get clipsContent() { return !!node().clip },
      set clipsContent(value) { edit(n => { n.clip = !!value }) },
      get blendMode() { const mode = node().blendMode; return mode ? (mode === 'pass-through' ? 'PASS_THROUGH' : UNBLEND[mode]) : 'PASS_THROUGH' },
      set blendMode(value) { edit(n => { if (value === 'PASS_THROUGH' || value === 'NORMAL') delete n.blendMode; else n.blendMode = BLEND[value] || 'normal' }) },
      // As in Figma, a mask clips every sibling above it in the same parent; the mask itself is not drawn.
      get isMask() { return !!node().mask },
      set isMask(value) { edit(n => { if (value) n.mask = true; else { delete n.mask; delete n.maskType } }) },
      get maskType() { return (node().maskType || 'alpha').toUpperCase() },
      set maskType(value) { edit(n => { const type = String(value).toLowerCase(); if (!['alpha', 'vector', 'luminance'].includes(type)) throw new Error('maskType is ALPHA, VECTOR or LUMINANCE'); n.maskType = type }) },
      get cornerSmoothing() { return node().cornerSmoothing || 0 },
      set cornerSmoothing(value) { edit(n => { const v = clamp01(value); if (v) n.cornerSmoothing = v; else delete n.cornerSmoothing }) },
      get strokeJoin() { return (node().strokeJoin || 'miter').toUpperCase() },
      set strokeJoin(value) { edit(n => { const join = String(value).toLowerCase(); if (!['miter', 'round', 'bevel'].includes(join)) throw new Error('strokeJoin is MITER, ROUND or BEVEL'); n.strokeJoin = join }) },
      get strokeMiterLimit() { return node().strokeMiterLimit ?? 4 },
      set strokeMiterLimit(value) { edit(n => { n.strokeMiterLimit = Number(value) }) },
      get effects() {
        return (node().effects || []).map(effect => effect.type === 'layer-blur' || effect.type === 'background-blur'
          ? { type: effect.type === 'layer-blur' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR', radius: effect.radius, visible: effect.visible } : {
          type: effect.type === 'drop-shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW', visible: effect.visible, offset: { x: effect.x, y: effect.y },
          radius: effect.blur, spread: effect.spread, color: { ...hexToRgb(effect.color), a: (effect.colorAlpha ?? 1) * effect.opacity }, blendMode: 'NORMAL' })
      },
      set effects(value) {
        edit(n => {
          if (!Array.isArray(value)) throw new Error('effects must be an array')
          n.effects = value.map(effect => {
            if (!effect || typeof effect !== 'object') throw new Error('An effect is an object such as { type: "DROP_SHADOW", color, offset, radius }')
            if (effect.blurType === 'PROGRESSIVE') throw new Error('Progressive blur is not supported in Canvas yet; use blurType NORMAL')
            if (effect.boundVariables && Object.keys(effect.boundVariables).length) throw new Error('Variables bound to effects are not supported in Canvas yet; set the effect colour and radius directly')
            if (effect.type === 'LAYER_BLUR') return { id: uuid(), type: 'layer-blur', visible: effect.visible !== false, radius: Number(effect.radius || 0) }
            if (effect.type === 'BACKGROUND_BLUR') return { id: uuid(), type: 'background-blur', visible: effect.visible !== false, radius: Number(effect.radius || 0) }
            if (effect.type === 'NOISE' || effect.type === 'TEXTURE' || effect.type === 'GLASS') throw new Error(effect.type + ' effects are not supported in Canvas yet; use a picture fill or a LAYER_BLUR')
            if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') throw new Error('Effects are DROP_SHADOW, INNER_SHADOW, LAYER_BLUR or BACKGROUND_BLUR')
            const color = effect.color || { r: 0, g: 0, b: 0, a: 0.25 }
            return { id: uuid(), type: effect.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow', visible: effect.visible !== false,
              x: Number(effect.offset ? effect.offset.x : 0), y: Number(effect.offset ? effect.offset.y : 0), blur: Number(effect.radius || 0),
              spread: Number(effect.spread || 0), color: rgbToHex(color), colorAlpha: color.a === undefined ? 1 : clamp01(color.a), opacity: 1 }
          })
          delete n.shadow
        })
      },
      // layout
      get layoutMode() { const layout = node().layout; return layout === 'row' ? 'HORIZONTAL' : layout === 'column' ? 'VERTICAL' : layout === 'grid' ? 'GRID' : 'NONE' },
      set layoutMode(value) {
        edit(n => {
          n.layout = value === 'HORIZONTAL' ? 'row' : value === 'VERTICAL' ? 'column' : value === 'GRID' ? 'grid' : 'none'
          n.widthSizing = n.widthSizing || 'fixed'; n.heightSizing = n.heightSizing || 'fixed'
          for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) if (n[side] === undefined) n[side] = n.padding
          n.preserveLayout = false
        })
      },
      get itemSpacing() { return node().gap },
      set itemSpacing(value) { edit(n => { n.gap = Number(value) }) },
      get counterAxisSpacing() { return node().crossGap ?? 0 },
      set counterAxisSpacing(value) { edit(n => { n.crossGap = Number(value) }) },
      get paddingTop() { const n = node(); return n.paddingTop ?? n.padding },
      set paddingTop(value) { edit(n => { n.paddingTop = Number(value) }) },
      get paddingRight() { const n = node(); return n.paddingRight ?? n.padding },
      set paddingRight(value) { edit(n => { n.paddingRight = Number(value) }) },
      get paddingBottom() { const n = node(); return n.paddingBottom ?? n.padding },
      set paddingBottom(value) { edit(n => { n.paddingBottom = Number(value) }) },
      get paddingLeft() { const n = node(); return n.paddingLeft ?? n.padding },
      set paddingLeft(value) { edit(n => { n.paddingLeft = Number(value) }) },
      set horizontalPadding(value) { self.paddingLeft = value; self.paddingRight = value },
      set verticalPadding(value) { self.paddingTop = value; self.paddingBottom = value },
      get primaryAxisAlignItems() { return UNJUSTIFY[node().justifyContent || 'start'] },
      set primaryAxisAlignItems(value) { edit(n => { n.justifyContent = JUSTIFY[value] || 'start' }) },
      get counterAxisAlignItems() { return UNALIGN[node().alignItems || 'start'] },
      set counterAxisAlignItems(value) { edit(n => { n.alignItems = ALIGN[value] || 'start' }) },
      get counterAxisAlignContent() { return node().alignContent === 'between' ? 'SPACE_BETWEEN' : 'AUTO' },
      set counterAxisAlignContent(value) { edit(n => { n.alignContent = value === 'SPACE_BETWEEN' ? 'between' : 'start' }) },
      get primaryAxisSizingMode() { const n = node(); return n[primaryAxis(n) + 'Sizing'] === 'hug' ? 'AUTO' : 'FIXED' },
      set primaryAxisSizingMode(value) { edit(n => { n[primaryAxis(n) + 'Sizing'] = value === 'AUTO' ? 'hug' : 'fixed' }) },
      get counterAxisSizingMode() { const n = node(); return n[(primaryAxis(n) === 'width' ? 'height' : 'width') + 'Sizing'] === 'hug' ? 'AUTO' : 'FIXED' },
      set counterAxisSizingMode(value) { edit(n => { n[(primaryAxis(n) === 'width' ? 'height' : 'width') + 'Sizing'] = value === 'AUTO' ? 'hug' : 'fixed' }) },
      get layoutSizingHorizontal() { const n = node(); return n.kind === 'text' ? (n.textSizing === 'auto-width' ? 'HUG' : (n.widthSizing === 'fill' ? 'FILL' : 'FIXED')) : (n.widthSizing || 'fixed').toUpperCase() },
      set layoutSizingHorizontal(value) {
        edit(n => {
          const sizing = String(value).toLowerCase()
          if (n.kind === 'text') {
            if (sizing === 'hug') { n.textSizing = 'auto-width'; delete n.widthSizing; return }
            if (n.textSizing === 'auto-width') n.textSizing = 'auto-height'
          }
          n.widthSizing = sizing
        })
      },
      get layoutSizingVertical() { const n = node(); return n.kind === 'text' ? (n.textSizing === 'fixed' ? (n.heightSizing === 'fill' ? 'FILL' : 'FIXED') : 'HUG') : (n.heightSizing || 'fixed').toUpperCase() },
      set layoutSizingVertical(value) {
        edit(n => {
          const sizing = String(value).toLowerCase()
          if (n.kind === 'text') {
            if (sizing === 'hug') { if (n.textSizing === 'fixed') n.textSizing = 'auto-height'; delete n.heightSizing; return }
            n.textSizing = 'fixed'
          }
          n.heightSizing = sizing
        })
      },
      get layoutGrow() { const parent = parentOf(node()); return parent && node()[primaryAxis(parent) + 'Sizing'] === 'fill' ? 1 : 0 },
      set layoutGrow(value) {
        const parent = parentOf(node())
        if (!parent || !['row', 'column'].includes(parent.layout)) return
        if (primaryAxis(parent) === 'width') self.layoutSizingHorizontal = Number(value) > 0 ? 'FILL' : 'FIXED'
        else self.layoutSizingVertical = Number(value) > 0 ? 'FILL' : 'FIXED'
      },
      get layoutAlign() { const parent = parentOf(node()); return parent && node()[(primaryAxis(parent) === 'width' ? 'height' : 'width') + 'Sizing'] === 'fill' ? 'STRETCH' : 'INHERIT' },
      set layoutAlign(value) {
        const parent = parentOf(node())
        if (!parent || !['row', 'column'].includes(parent.layout)) return
        const sizing = value === 'STRETCH' ? 'FILL' : 'FIXED'
        if (primaryAxis(parent) === 'width') self.layoutSizingVertical = sizing; else self.layoutSizingHorizontal = sizing
      },
      get layoutPositioning() { return node().absolutePosition ? 'ABSOLUTE' : 'AUTO' },
      set layoutPositioning(value) { edit(n => { n.absolutePosition = value === 'ABSOLUTE' }) },
      get layoutWrap() { return node().layoutWrap === 'wrap' ? 'WRAP' : 'NO_WRAP' },
      set layoutWrap(value) { edit(n => { n.layoutWrap = value === 'WRAP' ? 'wrap' : 'none' }) },
      get itemReverseZIndex() { return !!node().itemReverseZIndex },
      set itemReverseZIndex(value) { edit(n => { n.itemReverseZIndex = !!value }) },
      get minWidth() { return node().minWidth ?? null }, set minWidth(value) { edit(n => { if (value === null) delete n.minWidth; else n.minWidth = Number(value) }) },
      get maxWidth() { return node().maxWidth ?? null }, set maxWidth(value) { edit(n => { if (value === null) delete n.maxWidth; else n.maxWidth = Number(value) }) },
      get minHeight() { return node().minHeight ?? null }, set minHeight(value) { edit(n => { if (value === null) delete n.minHeight; else n.minHeight = Number(value) }) },
      get maxHeight() { return node().maxHeight ?? null }, set maxHeight(value) { edit(n => { if (value === null) delete n.maxHeight; else n.maxHeight = Number(value) }) },
      get constraints() { const c = node().constraints; const h = invert(CONSTRAINT_H), v = invert(CONSTRAINT_V); return { horizontal: c ? h[c.horizontal] : 'MIN', vertical: c ? v[c.vertical] : 'MIN' } },
      set constraints(value) { edit(n => { n.constraints = { horizontal: CONSTRAINT_H[value.horizontal] || 'left', vertical: CONSTRAINT_V[value.vertical] || 'top' } }) },
      // variables
      setBoundVariable(field, variable) {
        edit(n => {
          if (field === 'characters' || field === 'visible') throw new Error('Canvas binds COLOR and FLOAT variables only')
          const property = BINDABLE[field]
          if (!property) throw new Error('Field ' + field + ' cannot be bound in Canvas')
          n.numericBindings = n.numericBindings || {}
          if (variable) n.numericBindings[property] = variableIdOf(variable.id); else delete n.numericBindings[property]
        })
      },
      get boundVariables() {
        const n = node(), result = {}
        for (const [field, property] of Object.entries(BINDABLE)) if (n.numericBindings && n.numericBindings[property]) result[field] = { type: 'VARIABLE_ALIAS', id: n.numericBindings[property] }
        const paints = paintsOf(n).filter(paint => paint.variableId)
        if (paints.length) result.fills = paints.map(paint => ({ type: 'VARIABLE_ALIAS', id: paint.variableId }))
        return result
      },
      setExplicitVariableModeForCollection(_collection, modeId) {
        edit(n => {
          if (modeId === BASE_MODE) { n.tokenModeId = 'base'; return }
          if (!(doc.tokenModes || []).some(mode => mode.id === modeId)) throw new Error('Unknown modeId ' + modeId)
          n.tokenModeId = modeId
        })
      },
      clearExplicitVariableModeForCollection() { edit(n => { delete n.tokenModeId }) },
      get explicitVariableModes() { const mode = node().tokenModeId; return mode ? { [COLLECTION_ID]: mode === 'base' ? BASE_MODE : mode } : {} },
      // plugin data (kept only for this run)
      setPluginData(key, value) { pluginData.set(id + '|' + key, String(value)) },
      getPluginData(key) { return pluginData.get(id + '|' + key) || '' },
      setSharedPluginData(namespace, key, value) { pluginData.set(id + '|' + namespace + '|' + key, String(value)) },
      getSharedPluginData(namespace, key) { return pluginData.get(id + '|' + namespace + '|' + key) || '' },
      exportAsync() { return Promise.reject(new Error('Use the viewDesign or exportDesign operation to render; exportAsync is not available in scripts')) },
      toString() { return '[' + self.type + ' ' + node().name + ' ' + id + ']' },
      toJSON() { return { id, type: self.type, name: node().name } },
    }
    // text
    Object.defineProperties(self, {
      characters: {
        get() { return node().text },
        set(value) {
          edit(n => {
            if (n.kind !== 'text') throw new Error('characters exists only on TEXT nodes')
            requireFont(n.fontFamily, n.fontWeight, n.fontStyle === 'italic')
            for (const run of n.textRuns || []) if (run.style.fontFamily) requireFont(run.style.fontFamily, run.style.fontWeight || n.fontWeight, (run.style.fontStyle || n.fontStyle) === 'italic')
            const text = String(value)
            if (text !== n.text) delete n.textRuns
            n.text = text
            if (autoLineHeights.has(id)) n.lineHeight = autoLineHeight(n)
          })
        },
      },
      fontName: {
        get() { const n = node(); return { family: familyOf(n.fontFamily), style: styleName(n.fontWeight, n.fontStyle === 'italic') } },
        set(value) {
          edit(n => {
            if (value === mixed) return
            const parsed = styleOf(value)
            requireFont(value.family, parsed.weight, parsed.italic)
            n.fontFamily = cssFamily(value.family); n.fontWeight = parsed.weight; n.fontStyle = parsed.italic ? 'italic' : 'normal'
            n.textStyleId = null
            if (autoLineHeights.has(id)) n.lineHeight = autoLineHeight(n)
          })
        },
      },
      fontSize: {
        get() { return node().fontSize },
        set(value) {
          edit(n => {
            const size = Number(value)
            n.fontSize = size
            if (pixelLineHeights.has(id)) n.lineHeight = pixelLineHeights.get(id) / size
            if (percentSpacing.has(id)) n.letterSpacing = percentSpacing.get(id) / 100 * size
          })
        },
      },
      fontWeight: { get() { return node().fontWeight } },
      lineHeight: {
        get() {
          const n = node()
          if (autoLineHeights.has(id)) return { unit: 'AUTO' }
          return pixelLineHeights.has(id) ? { unit: 'PIXELS', value: pixelLineHeights.get(id) } : { unit: 'PERCENT', value: n.lineHeight * 100 }
        },
        set(value) {
          if (value === mixed) return
          edit(n => {
            if (value && value.unit === 'PIXELS') pixelLineHeights.set(id, Number(value.value)); else pixelLineHeights.delete(id)
            // AUTO is the font's own line height (ascender + descender + line gap), as in Figma, not a fixed 120%.
            if (!value || value.unit === 'AUTO') { autoLineHeights.add(id); n.lineHeight = autoLineHeight(n) }
            else { autoLineHeights.delete(id); n.lineHeight = lineHeightValue(value, n.fontSize) }
          })
        },
      },
      letterSpacing: {
        get() { return { unit: 'PIXELS', value: node().letterSpacing || 0 } },
        set(value) {
          edit(n => {
            if (value && value.unit === 'PERCENT') percentSpacing.set(id, Number(value.value)); else percentSpacing.delete(id)
            n.letterSpacing = letterSpacingValue(value, n.fontSize)
          })
        },
      },
      paragraphSpacing: { get() { return node().paragraphSpacing || 0 }, set(value) { edit(n => { n.paragraphSpacing = Number(value) }) } },
      textAlignHorizontal: {
        get() { const a = node().textAlign || 'left'; return a === 'justify' ? 'JUSTIFIED' : a.toUpperCase() },
        set(value) {
          if (!['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(value)) throw new Error('textAlignHorizontal is LEFT, CENTER, RIGHT or JUSTIFIED')
          edit(n => { n.textAlign = value === 'CENTER' ? 'center' : value === 'RIGHT' ? 'right' : value === 'JUSTIFIED' ? 'justify' : 'left' })
        },
      },
      textAlignVertical: {
        get() { const v = node().verticalAlign || 'top'; return v === 'center' ? 'CENTER' : v === 'bottom' ? 'BOTTOM' : 'TOP' },
        set(value) { edit(n => { n.verticalAlign = value === 'CENTER' ? 'center' : value === 'BOTTOM' ? 'bottom' : 'top' }) },
      },
      textAutoResize: {
        get() { const s = node().textSizing; return s === 'auto-width' ? 'WIDTH_AND_HEIGHT' : s === 'auto-height' ? 'HEIGHT' : (node().textTruncation === 'ending' ? 'TRUNCATE' : 'NONE') },
        set(value) {
          edit(n => {
            n.textSizing = value === 'WIDTH_AND_HEIGHT' ? 'auto-width' : value === 'HEIGHT' ? 'auto-height' : 'fixed'
            if (value === 'TRUNCATE') n.textTruncation = 'ending'
            delete n.widthSizing; delete n.heightSizing
          })
        },
      },
      textTruncation: {
        get() { return node().textTruncation === 'ending' ? 'ENDING' : 'DISABLED' },
        set(value) { edit(n => { n.textTruncation = value === 'ENDING' ? 'ending' : 'disabled' }) },
      },
      maxLines: { get() { return node().maxLines ?? null }, set(value) { edit(n => { n.maxLines = value === null ? null : Number(value) }) } },
      textCase: {
        get() { const c = node().textCase || 'none'; return c === 'uppercase' ? 'UPPER' : c === 'lowercase' ? 'LOWER' : c === 'capitalize' ? 'TITLE' : 'ORIGINAL' },
        set(value) {
          if (value === 'TITLE') throw new Error('textCase TITLE is not supported in Canvas yet; write the words capitalised in characters instead')
          if (value === 'SMALL_CAPS' || value === 'SMALL_CAPS_FORCED') throw new Error('textCase ' + value + ' is not supported in Canvas yet; use UPPER with a smaller fontSize, or a font with real small caps')
          if (!['UPPER', 'LOWER', 'ORIGINAL'].includes(value)) throw new Error('textCase is ORIGINAL, UPPER, LOWER, TITLE, SMALL_CAPS or SMALL_CAPS_FORCED')
          edit(n => { n.textCase = value === 'UPPER' ? 'uppercase' : value === 'LOWER' ? 'lowercase' : 'none' })
        },
      },
      textDecoration: {
        get() { const d = node().textDecoration || 'none'; return d === 'underline' ? 'UNDERLINE' : d === 'line-through' ? 'STRIKETHROUGH' : 'NONE' },
        set(value) { edit(n => { n.textDecoration = value === 'UNDERLINE' ? 'underline' : value === 'STRIKETHROUGH' ? 'line-through' : 'none' }) },
      },
      textStyleId: {
        get() { return node().textStyleId || '' },
        set(value) {
          edit(n => {
            if (!value) { n.textStyleId = null; return }
            const style = doc.textStyles.find(item => item.id === value)
            if (!style) throw new Error('Unknown text style ' + value)
            requireFont(style.fontFamily, style.fontWeight, style.fontStyle === 'italic')
            n.textStyleId = style.id; copyStyle(n, style)
          })
        },
      },
    })
    self.setTextStyleIdAsync = async value => { self.textStyleId = value }
    self.getStyledTextSegments = (fields) => {
      const n = node()
      const runs = (n.textRuns || []).slice().sort((a, b) => a.start - b.start)
      const segments = []
      let cursor = 0
      const push = (start, end, style) => {
        if (end <= start) return
        const segment = { characters: n.text.slice(start, end), start, end }
        for (const field of fields || []) {
          if (field === 'fontName') segment.fontName = { family: familyOf(style.fontFamily || n.fontFamily), style: styleName(style.fontWeight || n.fontWeight, (style.fontStyle || n.fontStyle) === 'italic') }
          if (field === 'fontSize') segment.fontSize = style.fontSize || n.fontSize
          if (field === 'fills') segment.fills = style.fill ? [{ type: 'SOLID', color: hexToRgb(style.fill), opacity: 1, visible: true }] : self.fills
          if (field === 'textDecoration') segment.textDecoration = (style.textDecoration || n.textDecoration || 'none') === 'underline' ? 'UNDERLINE' : 'NONE'
        }
        segments.push(segment)
      }
      for (const run of runs) { push(cursor, run.start, {}); push(run.start, run.end, run.style); cursor = run.end }
      push(cursor, n.text.length, {})
      return segments.length ? segments : [{ characters: '', start: 0, end: 0 }]
    }
    const setRange = (start, end, style) => {
      edit(n => {
        if (n.kind !== 'text') throw new Error('Range styles exist only on TEXT nodes')
        n.textRuns = rangeRuns(n.textRuns, n.text.length, start, end, style)
      })
    }
    self.setRangeFills = (start, end, fills) => {
      const solid = fills.find(paint => paint.type === 'SOLID')
      if (!solid) throw new Error('Text ranges take one SOLID fill in Canvas')
      setRange(start, end, { fill: rgbToHex(solid.color) })
    }
    self.setRangeFontName = (start, end, fontName) => {
      const parsed = styleOf(fontName)
      requireFont(fontName.family, parsed.weight, parsed.italic)
      setRange(start, end, { fontFamily: cssFamily(fontName.family), fontWeight: parsed.weight, fontStyle: parsed.italic ? 'italic' : 'normal' })
    }
    self.setRangeFontSize = (start, end, size) => setRange(start, end, { fontSize: Number(size) })
    self.setRangeTextDecoration = (start, end, value) => setRange(start, end, { textDecoration: value === 'UNDERLINE' ? 'underline' : value === 'STRIKETHROUGH' ? 'line-through' : 'none' })
    self.setRangeLetterSpacing = (start, end, value) => setRange(start, end, { letterSpacing: letterSpacingValue(value, node().fontSize) })
    self.setRangeLineHeight = (start, end, value) => setRange(start, end, { lineHeight: lineHeightValue(value, node().fontSize) })
    self.setRangeHyperlink = (start, end, value) => setRange(start, end, value ? { hyperlink: value.type === 'NODE' ? { type: 'NODE', value: value.value } : { type: 'URL', value: value.value } } : {})
    self.insertCharacters = (start, text) => { const n = node(); self.characters = n.text.slice(0, start) + text + n.text.slice(start) }
    self.deleteCharacters = (start, end) => { const n = node(); self.characters = n.text.slice(0, start) + n.text.slice(end) }
    // stars, polygons and vectors
    const reshape = (change) => edit(n => { const spec = shapes.get(id); if (!spec) throw new Error('Only STAR, POLYGON and VECTOR nodes have this property'); change(spec); n.pathData = shapePath(spec) })
    Object.defineProperties(self, {
      pointCount: { get() { return shapes.get(id)?.pointCount }, set(value) { reshape(spec => { spec.pointCount = Number(value) }) } },
      innerRadius: { get() { return shapes.get(id)?.innerRadius }, set(value) { reshape(spec => { spec.innerRadius = clamp01(value) }) } },
      vectorPaths: {
        get() { const n = node(); return (n.pathData?.paths || []).map(path => ({ windingRule: path.fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO', data: path.d })) },
        set(value) {
          edit(n => {
            const spec = { type: 'VECTOR', width: n.width, height: n.height, paths: value.map(path => ({ data: String(path.data), windingRule: path.windingRule })) }
            shapes.set(id, spec); n.kind = 'path'; n.pathData = shapePath(spec)
          })
        },
      },
    })
    // components
    self.createInstance = () => {
      const n = node()
      if (n.kind !== 'component') throw new Error('createInstance exists only on COMPONENT nodes')
      const instance = makeNode('instance', n.name)
      const record = byId.get(instance.id)
      record.componentId = n.id; record.width = n.width; record.height = n.height
      delete record.fills; record.widthSizing = n.widthSizing; record.heightSizing = n.heightSizing
      return instance
    }
    Object.defineProperty(self, 'mainComponent', { get() { const n = node(); return n.kind === 'instance' && n.componentId ? proxy(n.componentId) : null } })
    self.getMainComponentAsync = async () => self.mainComponent
    self.detachInstance = () => {
      const n = node()
      if (n.kind !== 'instance') throw new Error('detachInstance exists only on INSTANCE nodes')
      const answer = call('detach', { document: doc, id })
      doc.nodes = answer.nodes
      byId.clear(); for (const item of doc.nodes) byId.set(item.id, item)
      for (const value of answer.created) created.push(value)
      proxies.clear()
      touch()
      return proxy(id)
    }
    self.swapComponent = component => edit(n => { if (n.kind !== 'instance') throw new Error('swapComponent exists only on INSTANCE nodes'); n.componentId = component.id })
    self.resizeToFit = () => {}
    self.lockAspectRatio = () => edit(n => { n.targetAspectRatio = { x: n.width, y: n.height } })
    self.unlockAspectRatio = () => edit(n => { delete n.targetAspectRatio })
    Object.defineProperty(self, 'targetAspectRatio', { get() { const r = node().targetAspectRatio; return r ? { x: r.x, y: r.y } : null } })
    self.outlineStroke = () => { throw new Error('outlineStroke is not supported in Canvas yet; draw the outline as a vector (createNodeFromSvg)') }
    self.set = props => setProps(wrapped, props)
    self.setProperties = () => { throw new Error(NOT_IN_CANVAS.properties) }
    self.addComponentProperty = () => { throw new Error(NOT_IN_CANVAS.properties) }
    self.editComponentProperty = () => { throw new Error(NOT_IN_CANVAS.properties) }
    Object.defineProperty(self, 'componentProperties', { get() { return {} } })
    Object.defineProperty(self, 'componentPropertyDefinitions', { get() { return {} } })
    self.query = selector => queryWithin(wrapped, selector)
    // use_figma's progress shimmer: nothing to show while a script runs in Canvas, so it is accepted and never drawn or exported.
    let placeholder = false
    Object.defineProperty(self, 'placeholder', { get() { return placeholder }, set(value) { placeholder = !!value }, enumerable: true })
    self.screenshot = async () => { warnings.push('screenshot(): Canvas scripts cannot return pictures; call viewDesign {designId, artboardId} after the script for the exported pixels'); return null }
    const wrapped = strict(self, () => { const n = byId.get(id); return n ? self.type + ' "' + n.name + '"' : 'a removed node' })
    proxies.set(id, wrapped)
    return wrapped
  }
  const NOT_IN_CANVAS = {
    variants: 'Variants (component sets) are not supported in Canvas yet. Make one component per variant with figma.createComponent() and switch an instance with instance.swapComponent(otherComponent).',
    library: 'Canvas has no team libraries. Read this design\'s own components and styles (getDesignSystem), or add a ready ad with listDesignTemplates / insertDesignTemplate.',
    properties: 'Component properties are not supported in Canvas yet. Set the instance layer itself: instance.findOne(n => n.type === "TEXT" && n.name === "Label").characters = "…", or .visible = false.',
  }
  // ---------- use_figma helpers: node.query(selector), node.set(props), figma.createAutoLayout ----------
  /** Parse a CSS-like selector into comma-separated lists of [combinator, compound] steps. */
  function parseSelector(text) {
    const source = String(text)
    let at = 0
    const fail = () => { throw new Error('Invalid query selector "' + source + '" near position ' + at) }
    const space = () => { while (/\s/.test(source[at] || '')) at++ }
    const name = (id) => { const m = (id ? /^[A-Za-z0-9_\-:;]+/ : /^[A-Za-z0-9_\-]+/).exec(source.slice(at)); if (!m) fail(); at += m[0].length; return m[0] }
    const group = () => {
      const out = []
      let depth = 0, start = at
      while (at < source.length) { const c = source[at]; if (c === '(') depth++; else if (c === ')') { if (!depth) break; depth-- } at++ }
      out.push(source.slice(start, at))
      return out[0]
    }
    function compound() {
      const part = { type: null, id: null, attrs: [], pseudos: [] }
      let any = false
      for (;;) {
        const c = source[at]
        if (c === '*') { at++; any = true; continue }
        if (c === '#') { at++; part.id = name(true); any = true; continue }
        if (c === '[') {
          at++; space()
          const m = /^([A-Za-z0-9_.*]+)\s*(?:([*^$]?=)\s*("([^"]*)"|'([^']*)'|[^\]]*?))?\s*\]/.exec(source.slice(at))
          if (!m) fail()
          at += m[0].length
          part.attrs.push({ path: m[1].split('.'), op: m[2] || null, value: m[4] ?? m[5] ?? (m[3] === undefined ? null : m[3].trim()) })
          any = true; continue
        }
        if (c === ':') {
          at++
          const m = /^[a-z-]+/.exec(source.slice(at)); if (!m) fail(); at += m[0].length
          let arg = null
          if (source[at] === '(') { at++; arg = group(); if (source[at] !== ')') fail(); at++ }
          part.pseudos.push({ name: m[0], arg: arg === null ? null : ['not', 'is', 'where'].includes(m[0]) ? parseSelector(arg) : arg.trim() })
          any = true; continue
        }
        if (/[A-Za-z_]/.test(c || '') && !any) { part.type = name().toUpperCase(); any = true; continue }
        break
      }
      if (!any) fail()
      return part
    }
    const lists = []
    let steps = []
    space()
    while (at < source.length) {
      let combinator = steps.length ? ' ' : null
      space()
      if ('>+~'.includes(source[at])) { combinator = source[at]; at++; space() }
      else if (source[at] === ',') { at++; lists.push(steps); steps = []; space(); continue }
      steps.push({ combinator, part: compound() })
      const before = at; space(); if (at === before && at < source.length && !'>+~,'.includes(source[at])) fail()
    }
    if (steps.length) lists.push(steps)
    if (!lists.length) fail()
    return lists
  }
  /** Values at a dot path, with `*` matching every array element. */
  function valuesAt(node, path) {
    let current = [node]
    for (const key of path) {
      const next = []
      for (const value of current) {
        if (value === null || value === undefined) continue
        if (key === '*' && Array.isArray(value)) next.push(...value)
        else { let item; try { item = value[key] } catch { item = undefined } if (item !== undefined) next.push(item) }
      }
      current = next
    }
    return current
  }
  function attrMatches(node, attr) {
    const values = valuesAt(node, attr.path)
    if (attr.op === null) return values.some(value => value !== null && value !== undefined && value !== false)
    return values.some(raw => {
      const value = raw && typeof raw === 'object' && 'id' in raw ? String(raw.id) : String(raw)
      if (attr.op === '=') return value === attr.value
      if (attr.op === '*=') return value.includes(attr.value)
      if (attr.op === '^=') return value.startsWith(attr.value)
      return value.endsWith(attr.value)
    })
  }
  function siblingsOf(node) { const parent = node.parent; return parent && parent.children ? parent.children : [] }
  function compoundMatches(node, part) {
    if (part.type && part.type !== '*' && node.type !== part.type) return false
    if (part.id && node.id !== part.id) return false
    for (const attr of part.attrs) if (!attrMatches(node, attr)) return false
    for (const pseudo of part.pseudos) {
      const list = siblingsOf(node), index = list.findIndex(item => item.id === node.id)
      if (pseudo.name === 'first-child') { if (index !== 0) return false }
      else if (pseudo.name === 'last-child') { if (index !== list.length - 1) return false }
      else if (pseudo.name === 'nth-child') { if (index + 1 !== Number(pseudo.arg)) return false }
      else if (pseudo.name === 'not') { if (selectorMatches(node, pseudo.arg)) return false }
      else if (pseudo.name === 'is' || pseudo.name === 'where') { if (!selectorMatches(node, pseudo.arg)) return false }
      else throw new Error('Unsupported query pseudo-class :' + pseudo.name + ' (use :first-child, :last-child, :nth-child(n), :not(), :is(), :where())')
    }
    return true
  }
  function stepsMatch(node, steps, index) {
    const step = steps[index]
    if (!compoundMatches(node, step.part)) return false
    if (index === 0) return true
    const isNode = item => item && item.type !== 'PAGE' && item.type !== 'DOCUMENT'
    if (step.combinator === '>') { const parent = node.parent; return isNode(parent) && stepsMatch(parent, steps, index - 1) }
    if (step.combinator === ' ') { for (let parent = node.parent; isNode(parent); parent = parent.parent) if (stepsMatch(parent, steps, index - 1)) return true; return false }
    const list = siblingsOf(node), at = list.findIndex(item => item.id === node.id)
    if (step.combinator === '+') return at > 0 && stepsMatch(list[at - 1], steps, index - 1)
    for (let i = at - 1; i >= 0; i--) if (stepsMatch(list[i], steps, index - 1)) return true
    return false
  }
  function selectorMatches(node, lists) { return lists.some(steps => stepsMatch(node, steps, steps.length - 1)) }
  /** Figma's QueryResult: an iterable list of nodes with first/last/each/map/filter/values/set/query. */
  function queryResult(nodes) {
    const result = {
      get length() { return nodes.length },
      first() { return nodes[0] || null },
      last() { return nodes[nodes.length - 1] || null },
      toArray() { return nodes.slice() },
      each(fn) { nodes.forEach(fn); return result },
      map(fn) { return nodes.map(fn) },
      filter(fn) { return queryResult(nodes.filter(fn)) },
      values(keys) { return nodes.map(node => Object.fromEntries(keys.map(key => [key, valuesAt(node, String(key).split('.'))[0]]))) },
      set(props) { for (const node of nodes) node.set(props); return result },
      query(selector) { const seen = new Set(); return queryResult(nodes.flatMap(node => node.query(selector).toArray()).filter(node => !seen.has(node.id) && seen.add(node.id))) },
      [Symbol.iterator]() { return nodes[Symbol.iterator]() },
    }
    return result
  }
  /** node.query / page.query: every node in the subtree (not the scope itself) that matches the selector. */
  function queryWithin(scope, selector) {
    const lists = parseSelector(selector)
    return queryResult(scope.findAll(() => true).filter(node => selectorMatches(node, lists)))
  }
  /** node.set(props): layoutMode first, width/height through resize(), every other key through the node's own setters. */
  function setProps(target, props) {
    if (!props || typeof props !== 'object') throw new Error('set() takes an object of properties, such as { name: "Card", opacity: 0.5 }')
    if ('layoutMode' in props) target.layoutMode = props.layoutMode
    if ('width' in props || 'height' in props) target.resize('width' in props ? Number(props.width) : target.width, 'height' in props ? Number(props.height) : target.height)
    for (const [key, value] of Object.entries(props)) if (!['layoutMode', 'width', 'height'].includes(key)) target[key] = value
    return target
  }
  const pluginData = new Map()

  function pageProxy(pageId, name) {
    const page = {
      get id() { return pageId || '0:1' },
      type: 'PAGE',
      get name() { return name },
      get children() { return siblings(null, pageId).map(node => proxy(node.id)) },
      appendChild(child) { const previous = currentPageId; currentPageId = pageId; appendTo(null, child); currentPageId = previous },
      insertChild(index, child) { const previous = currentPageId; currentPageId = pageId; appendTo(null, child, index); currentPageId = previous },
      findOne(predicate) { const previous = currentPageId; currentPageId = pageId; try { return find(null, predicate, true)[0] || null } finally { currentPageId = previous } },
      findAll(predicate) { const previous = currentPageId; currentPageId = pageId; try { return find(null, predicate || (() => true), false) } finally { currentPageId = previous } },
      findAllWithCriteria(criteria) { return page.findAll(withCriteria(criteria)) },
      findChildren(predicate) { return page.children.filter(predicate || (() => true)) },
      findChild(predicate) { return page.children.find(predicate) || null },
      query(selector) { return queryWithin(page, selector) },
      selection: [],
      async loadAsync() {},
      setExplicitVariableModeForCollection() { warnings.push('Set the mode on each ad frame instead of the page') },
      toJSON() { return { id: page.id, type: 'PAGE', name } },
    }
    return page
  }
  const pageList = pages ? pages.map(page => pageProxy(page.id, page.name)) : [pageProxy(null, 'Page 1')]
  let currentPage = pageList.find(page => (page.id === currentPageId) || (!pages)) || pageList[0]

  function booleanOf(operation, nodes, parent, index) {
    if (!Array.isArray(nodes) || !nodes.length) throw new Error('A boolean operation needs at least one node')
    const group = figma.group(nodes, parent, index)
    const record = byId.get(group.id)
    const first = byId.get(nodes[0].id)
    record.kind = 'boolean'; record.name = operation[0].toUpperCase() + operation.slice(1)
    record.booleanOperation = operation
    record.fills = (first && paintsOf(first).map(paint => ({ ...paint, id: uuid() }))) || []
    const solid = record.fills.find(paint => !paint.image && !paint.gradient)
    if (solid) { record.fill = solid.color; record.fillOpacity = 1 }
    proxies.delete(group.id)
    touch()
    return proxy(group.id)
  }

  /** An SVG gradient (outer SVG coordinates) as a Figma gradient paint laid out over the shape's own bounding box. */
  function svgGradientPaint(fill) {
    const g = fill.gradient, width = Math.max(g.box.width, 1e-6), height = Math.max(g.box.height, 1e-6)
    const from = { x: g.from.x - g.box.x, y: g.from.y - g.box.y }, to = { x: g.to.x - g.box.x, y: g.to.y - g.box.y }
    const gradientStops = g.stops.map(stop => ({ position: stop.position, color: { ...hexToRgb(stop.color), a: stop.opacity } }))
    if (g.type === 'radial') {
      const rx = Math.max(g.rx, 1e-6), ry = Math.max(g.ry, 1e-6)
      return { type: 'GRADIENT_RADIAL', opacity: fill.opacity, gradientStops,
        gradientTransform: [[width / (2 * rx), 0, 0.5 - from.x / (2 * rx)], [0, height / (2 * ry), 0.5 - from.y / (2 * ry)]] }
    }
    // Pixel space: x' runs 0→1 along from→to, y' is 0.5 on that line; composed with unit → pixel scaling (width, height).
    const dx = to.x - from.x, dy = to.y - from.y, l2 = Math.max(dx * dx + dy * dy, 1e-9)
    return { type: 'GRADIENT_LINEAR', opacity: fill.opacity, gradientStops,
      gradientTransform: [[dx * width / l2, dy * height / l2, -(from.x * dx + from.y * dy) / l2],
        [-dy * width / l2, dx * height / l2, 0.5 - (dx * from.y - dy * from.x) / l2]] }
  }
  // ---------- the figma global ----------
  const figma = {
    mixed,
    get root() { return { type: 'DOCUMENT', name: doc.title, children: pageList, findAll: predicate => pageList.flatMap(page => page.findAll(predicate)),
      findOne: predicate => { for (const page of pageList) { const found = page.findOne(predicate); if (found) return found } return null } } },
    get currentPage() { return currentPage },
    set currentPage(page) { figma.setCurrentPageAsync(page) },
    async setCurrentPageAsync(page) { const found = pageList.find(item => item.id === page.id); if (found) { currentPage = found; currentPageId = pages ? found.id : null } },
    async loadAllPagesAsync() {},
    createPage() { warnings.push('Canvas keeps one page per design here; frames were added to the current page'); return currentPage },
    createFrame() { return makeNode('frame', 'Frame') },
    // use_figma's shortcut: an auto-layout frame hugging its content on both axes, with optional props.
    createAutoLayout(direction, props) {
      if (direction && typeof direction === 'object') { props = direction; direction = 'HORIZONTAL' }
      const frame = makeNode('frame', 'Frame')
      frame.layoutMode = direction === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL'
      frame.primaryAxisSizingMode = 'AUTO'; frame.counterAxisSizingMode = 'AUTO'
      if (props) frame.set(props)
      return frame
    },
    createComponent() { return makeNode('component', 'Component') },
    createRectangle() { return makeNode('rectangle', 'Rectangle') },
    createEllipse() { return makeNode('ellipse', 'Ellipse') },
    createText() { return makeNode('text', 'Text') },
    createLine() {
      const line = makeNode('rectangle', 'Line')
      const node = byId.get(line.id)
      node.height = 1; node.fills = [{ id: uuid(), color: '#000000', opacity: 1, visible: true, variableId: null }]; node.fill = '#000000'
      lines.set(line.id, { weight: 1, strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] })
      return line
    },
    createStar() { return makeShape({ type: 'STAR', pointCount: 5, innerRadius: 0.382 }, 'Star') },
    createPolygon() { return makeShape({ type: 'POLYGON', pointCount: 3 }, 'Polygon') },
    createVector() { return makeShape({ type: 'VECTOR', width: 100, height: 100, paths: [] }, 'Vector') },
    createComponentFromNode(source) {
      const node = byId.get(source.id)
      if (!node || !['frame', 'group'].includes(node.kind)) throw new Error('createComponentFromNode takes a FRAME or GROUP')
      node.kind = 'component'; touch()
      proxies.delete(source.id)
      return proxy(source.id)
    },
    group(nodes, parent, index) {
      if (!nodes.length) throw new Error('group needs at least one node')
      const boxes = nodes.map(item => ({ item, b: box(byId.get(item.id)) }))
      const minX = Math.min(...boxes.map(entry => entry.b.x)), minY = Math.min(...boxes.map(entry => entry.b.y))
      const maxX = Math.max(...boxes.map(entry => entry.b.x + entry.b.width)), maxY = Math.max(...boxes.map(entry => entry.b.y + entry.b.height))
      const group = makeNode('group', 'Group')
      const record = byId.get(group.id)
      record.x = minX; record.y = minY; record.width = Math.max(1, maxX - minX); record.height = Math.max(1, maxY - minY)
      appendTo(parent && parent.type !== 'PAGE' ? parent.id : null, group, index)
      for (const entry of boxes) { const child = byId.get(entry.item.id); child.x = entry.b.x - minX; child.y = entry.b.y - minY; appendTo(group.id, entry.item) }
      return group
    },
    createNodeFromSvg(svg) {
      const spec = call('svg', String(svg))
      const frame = makeNode('frame', 'svg')
      const record = byId.get(frame.id)
      record.width = spec.width; record.height = spec.height; record.clip = false
      setFills(record, [])
      for (const shape of spec.shapes) {
        const vector = makeShape({ type: 'VECTOR', width: spec.width, height: spec.height, paths: [{ data: shape.d, windingRule: shape.fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO' }] }, shape.name)
        const n = byId.get(vector.id)
        n.width = spec.width; n.height = spec.height
        setFills(n, shape.fill ? [shape.fill.gradient ? svgGradientPaint(shape.fill)
          : { type: 'SOLID', color: hexToRgb(shape.fill.color), opacity: shape.fill.opacity }] : [])
        if (shape.stroke) {
          n.strokes = [toPaint({ type: 'SOLID', color: hexToRgb(shape.stroke.color), opacity: shape.stroke.opacity }, n)]
          n.stroke = shape.stroke.color; n.strokeWidth = shape.stroke.width; n.strokeAlign = 'center'
          n.strokeCap = shape.stroke.cap; n.strokeJoin = shape.stroke.join
          if (shape.stroke.dashes.length) n.strokeDashes = shape.stroke.dashes
        }
        if (shape.opacity < 1) n.opacity = shape.opacity
        appendTo(frame.id, vector)
      }
      for (const warning of spec.warnings) warnings.push('createNodeFromSvg: ' + warning)
      return frame
    },
    union(nodes, parent, index) { return booleanOf('union', nodes, parent, index) },
    subtract(nodes, parent, index) { return booleanOf('subtract', nodes, parent, index) },
    intersect(nodes, parent, index) { return booleanOf('intersect', nodes, parent, index) },
    exclude(nodes, parent, index) { return booleanOf('exclude', nodes, parent, index) },
    flatten() { throw new Error('figma.flatten is not supported in Canvas yet; keep the shapes, or combine them with figma.union') },
    getNodeById(id) {
      if (byId.has(id)) return proxy(id)
      const match = /^I([^;]+);(.+)$/.exec(String(id))
      if (match && byId.has(match[1]) && match[2].split(';').every(part => byId.has(part))) return sublayer(match[1], match[2].split(';'))
      return null
    },
    async getNodeByIdAsync(id) { return figma.getNodeById(id) },
    async loadFontAsync(fontName) {
      if (!fontName || !fontName.family) throw new Error('loadFontAsync takes { family, style }')
      const parsed = parseStyleOrNull(fontName.style)
      const style = fontName.style === undefined ? 'Regular' : String(fontName.style)
      const key = parsed && familyOf(fontName.family).toLowerCase() + '|' + parsed.weight + '|' + (parsed.italic ? 'italic' : 'normal')
      if (key && loadedFonts.has(key)) return
      // Install the family first even for a made-up style, so the error lists the styles it really has.
      const answer = await callAsync('font', { family: familyOf(fontName.family), style: parsed ? style : 'Regular' })
      loadedFonts = new Set(answer.fonts.map(face => face.toLowerCase()))
      installedFamilies = answer.families
      touch()
      if (!key || !loadedFonts.has(key)) throw noSuchStyle(fontName.family, style)
    },
    async listAvailableFontsAsync() {
      return [...loadedFonts].map(face => { const [family, weight, style] = face.split('|'); const name = installedFamilies.find(item => item.toLowerCase() === family) || family
        return { fontName: { family: name, style: styleName(Number(weight), style === 'italic') } } })
    },
    async createImageAsync(source) {
      const answer = await callAsync('image', { source: String(source) })
      images.set(answer.url, answer)
      return { hash: answer.url, async getSizeAsync() { return { width: answer.width, height: answer.height } } }
    },
    createImage(bytes) {
      throw new Error('Use await figma.createImageAsync(pathOrUrl): Canvas reads the picture from a file path, an http(s) URL or a data: URL')
    },
    getImageByHash(hash) { const found = images.get(hash); return found ? { hash, async getSizeAsync() { return { width: found.width, height: found.height } } } : null },
    variables,
    getLocalTextStyles() { return doc.textStyles.map(style => textStyleProxy(style.id)) },
    async getLocalTextStylesAsync() { return figma.getLocalTextStyles() },
    getStyleById(id) { return textStyleProxy(id) },
    async getStyleByIdAsync(id) { return textStyleProxy(id) },
    createTextStyle() {
      const id = uuid()
      doc.textStyles.push({ id, name: 'Text style', fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.2, letterSpacing: 0, fontStyle: 'normal' })
      return textStyleProxy(id)
    },
    combineAsVariants() { throw new Error(NOT_IN_CANVAS.variants) },
    createComponentSet() { throw new Error(NOT_IN_CANVAS.variants) },
    async importComponentByKeyAsync() { throw new Error(NOT_IN_CANVAS.library) },
    async importComponentSetByKeyAsync() { throw new Error(NOT_IN_CANVAS.library) },
    async importStyleByKeyAsync() { throw new Error(NOT_IN_CANVAS.library) },
    createPaintStyle() { throw new Error('createPaintStyle is not supported in Canvas yet. Canvas has no paint styles: bind a COLOR variable with figma.variables.setBoundVariableForPaint instead.') },
    createEffectStyle() { throw new Error('createEffectStyle is not supported in Canvas yet. Set node.effects directly (keep the effect array in a const and reuse it).') },
    createGridStyle() { throw new Error('createGridStyle is not supported in Canvas: Canvas has no layout grids.') },
    createSection() { throw new Error('createSection is not supported in Canvas: put ads side by side as top-level frames instead.') },
    createSlice() { throw new Error('createSlice is not supported in Canvas: export a frame with exportDesign {artboardId} instead.') },
    createTextPath() { throw new Error('Text on a path is not supported in Canvas yet: rotate a TEXT layer, or split the words into rotated layers.') },
    getLocalPaintStyles() { return [] }, async getLocalPaintStylesAsync() { return [] },
    getLocalEffectStyles() { return [] }, async getLocalEffectStylesAsync() { return [] },
    notify(message) { logs.push('notify: ' + String(message)) },
    viewport: { scrollAndZoomIntoView() {}, center: { x: 0, y: 0 }, zoom: 1 },
    commitUndo() {},
    closePlugin() {},
    util: {
      rgb(value) { if (typeof value === 'string') return hexToRgb(value); return { r: value.r, g: value.g, b: value.b } },
      rgba(value) { if (typeof value === 'string') { const rgb = hexToRgb(value); const alpha = /^#?[0-9a-f]{6}([0-9a-f]{2})/i.exec(value); return { ...rgb, a: alpha ? parseInt(alpha[1], 16) / 255 : 1 } } return { r: value.r, g: value.g, b: value.b, a: value.a ?? 1 } },
      solidPaint(color, overrides) { const rgba = figma.util.rgba(color); return { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a, ...(overrides || {}) } },
    },
  }

  const show = value => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  const console = { log: (...args) => logs.push(args.map(show).join(' ')), warn: (...args) => logs.push('warn: ' + args.map(show).join(' ')),
    error: (...args) => logs.push('error: ' + args.map(show).join(' ')), info: (...args) => logs.push(args.map(show).join(' ')) }

  function finish(value) {
    let result
    try { result = value === undefined ? null : JSON.parse(JSON.stringify(value)) } catch { result = String(value) }
    return JSON.stringify({ document: doc, created: created.filter(id => byId.has(id)), logs, warnings, result })
  }
  // Canvas-only helpers, kept apart from the figma global so Figma scripts stay portable.
  const canvas = {
    icon(name, options) { return call('icon', { name: String(name), options: options || {} }) },
    icons(query) { return call('icons', query === undefined ? '' : String(query)) },
  }
  return { figma, canvas, console, settle, finish, unmeasured: () => unmeasured }
})
