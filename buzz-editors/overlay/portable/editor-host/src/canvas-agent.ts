/**
 * The agent's Canvas tool surface, shared by Buzz (`buzz_canvas`) and Creative Studio (`canvas`): which CanvasStore operations an
 * agent may call, the tool description, and the guide returned by `readCanvasGuide`. Keep the hosts on these constants so a fix here
 * reaches every copy.
 */

/** Operations an agent may call, in addition to each host's own bridge-only operations. */
export const CANVAS_AGENT_OPERATIONS = [
  "listDesigns",
  "readDesign",
  "createDesign",
  "editDesign",
  "runCanvasScript",
  "placeDesignImage",
  "putDesignImage",
  "listDesignFonts",
  "installDesignFonts",
  "getDesignSystem",
  "listDesignComments",
  "addDesignComment",
  "setDesignCommentStatus",
  "listDesignTemplates",
  "readDesignTemplate",
  "insertDesignTemplate",
  "viewDesign",
  "exportDesign",
  "inspectDesign",
  "getStyleGuide",
  "previewDesignPage",
  "buildDesignPage",
  "reviewDesignPageUpdate",
  "applyDesignPageUpdate",
  "readCanvasGuide",
] as const;

/** Defaults an agent call gets unless it says otherwise. */
export function canvasAgentDefaults(
  operation: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (operation === "listDesignTemplates" && !("thumbnails" in input))
    return { ...input, thumbnails: false };
  if (operation === "insertDesignTemplate" && !("mergeByName" in input))
    return { ...input, mergeByName: true };
  return input;
}

/** Tool description: what each operation takes, with the fastest path first. */
export const CANVAS_AGENT_DESCRIPTION =
  "Build and check designs (ads, social posts, page artboards) in Canvas. Fastest path: runCanvasScript with Figma Plugin API JavaScript, " +
  "then viewDesign to check, then exportDesign. Call readCanvasGuide once for the full script API and the ad workflow. " +
  "runCanvasScript {designId, expectedRevision, code}: code runs with a `figma` global shaped like the Figma Plugin API (createFrame/Text/Rectangle/Ellipse/Line/Component, " +
  "auto layout props, fontName+characters, fills incl. IMAGE via (await figma.createImageAsync(pathOrUrl)).hash with scaleMode FILL/FIT/CROP/TILE, strokes, effects, cornerRadius, " +
  "findOne/findAll, resize, appendChild, clone, variables + setExplicitVariableModeForCollection, text styles). Top-level await and return work; text sizes you read are measured " +
  "with the real fonts. figma.loadFontAsync installs any Google font. Returns {revision, result, logs, warnings, unmeasuredText}. " +
  "createDesign {title}. readDesign {designId} returns every field (large); prefer getDesignSystem {designId} (components, text styles, variables per mode, named layers per frame) " +
  "or inspectDesign. editDesign {designId, expectedRevision, changes:{upsertNodes:[{id (new uuid), kind: frame|rectangle|ellipse|text|group, parentId, name, x, y, width, height, " +
  "fill:'#hex', radius, text, fontFamily, fontSize, fontWeight, lineHeight (multiplier), textAlign, textSizing: auto-width|auto-height|fixed, layout: none|row|column, gap, " +
  "paddingTop/Right/Bottom/Left, alignItems, justifyContent, widthSizing/heightSizing: fixed|hug|fill, fills:[{id,color,opacity,visible,variableId,image:{url,scaleMode}}], visible}], " +
  "deleteNodeIds, variables}}: only id and kind are required for a new layer; existing layers take partial fields. " +
  "listDesignTemplates {category?, query?} lists ready ad templates (Product hero, Benefit callouts, Testimonial, Us vs them, Before and after, 3 reasons, Offer, Founder quote, UGC post; " +
  "1:1, 4:5, 9:16). insertDesignTemplate {designId, templateId, expectedRevision, position?} adds one as an editable frame and returns selectedIds. " +
  "placeDesignImage {designId, expectedRevision, nodeId, source: file path | https URL | data URL, scaleMode: FILL|FIT|CROP, zoom?, offsetX?, offsetY?, removeStrokes?, hideLayers?:['_label']}. " +
  "putDesignImage {source} stores a picture and returns {url,width,height} for fills. listDesignFonts; installDesignFonts {families:[Google family]}. " +
  "viewDesign {designId, artboardId?, scale? (0.1–3), top?, height?} returns the PNG you check: the same renderer, fonts and crops as exportDesign, so at one scale it is the export. " +
  "exportDesign {designId, artboardId?, scale 1–3} writes the PNG and returns {path,width,height}. " +
  "Comments: listDesignComments/addDesignComment/setDesignCommentStatus. Pages: previewDesignPage {designId,nodeId,expectedRevision}, buildDesignPage (+previewHash), " +
  "reviewDesignPageUpdate/applyDesignPageUpdate. getStyleGuide reads workspace branding. workspaceId is supplied by the host.";

/** The full guide an agent reads once: script API, ad workflow and limits. */
export const CANVAS_AGENT_GUIDE = `# Canvas for agents

## Script API (runCanvasScript)
Write the same JavaScript you would send to Figma's use_figma. The code is the body of an async function: use await and return.
Supported, with Figma's names and units:
- figma.createFrame / createRectangle / createEllipse / createText / createLine / createComponent, component.createInstance(), instance.detachInstance(), figma.group(nodes, parent), node.clone(), node.remove()
- Geometry: x, y, resize(w, h), rotation, width/height (read: measured), absoluteBoundingBox, constraints {horizontal, vertical: MIN|MAX|CENTER|STRETCH|SCALE}
- Auto layout: layoutMode HORIZONTAL|VERTICAL, itemSpacing, counterAxisSpacing, padding*, primaryAxisAlignItems MIN|CENTER|MAX|SPACE_BETWEEN, counterAxisAlignItems MIN|CENTER|MAX|BASELINE,
  primaryAxisSizingMode / counterAxisSizingMode FIXED|AUTO, layoutSizingHorizontal / layoutSizingVertical FIXED|HUG|FILL (set after appendChild), layoutGrow, layoutAlign, layoutPositioning ABSOLUTE, layoutWrap, min/maxWidth/Height
- Paint: fills / strokes as Figma paints (SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, IMAGE), strokeWeight, strokeAlign, dashPattern, cornerRadius and per-corner radii, opacity, blendMode, clipsContent,
  effects (DROP_SHADOW, INNER_SHADOW, LAYER_BLUR). figma.util.rgb('#hex') and figma.util.solidPaint('#hex') help.
- Pictures: const img = await figma.createImageAsync('/abs/path.png' | 'https://…' | 'data:image/png;base64,…'); node.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }].
  CROP takes imageTransform [[a,0,tx],[0,d,ty]] (the visible window of the picture) or Canvas's own { zoom, offsetX, offsetY }. await img.getSizeAsync() gives its pixels.
- Text: await figma.loadFontAsync({ family, style }) first (any Google font installs itself; Inter is built in), then fontName, characters, fontSize, lineHeight {unit PIXELS|PERCENT|AUTO},
  letterSpacing {unit PIXELS|PERCENT}, textAlignHorizontal, textAlignVertical, textAutoResize WIDTH_AND_HEIGHT|HEIGHT|NONE|TRUNCATE, textCase, textDecoration, setRangeFills/FontName/FontSize,
  getStyledTextSegments. Symbols such as ★ ✓ ✕ draw with a symbol fallback font.
- Find: node.findOne(fn), findAll(fn), findChild, findChildren, findAllWithCriteria({ types }), figma.currentPage.children, figma.getNodeById(id)
- Variables: one collection (figma.variables.getLocalVariableCollectionsAsync()[0]) with a base mode plus added modes. COLOR and FLOAT variables; createVariable, setValueForMode,
  addMode, figma.variables.setBoundVariableForPaint(paint, 'color', v), node.setBoundVariable('cornerRadius' | 'itemSpacing' | 'paddingTop' | … , v),
  frame.setExplicitVariableModeForCollection(collection, modeId).
- Text styles: figma.getLocalTextStylesAsync(), figma.createTextStyle(), style.fontName / fontSize / lineHeight, text.textStyleId = style.id. A style sets family, weight and size together.
Not available: pages beyond the current one, paint and effect styles, masks, vector networks, exportAsync (use exportDesign), plugin UI.
Errors come back with the script's line number. Nothing is saved when a script throws.

## Ads from templates
1. listDesignTemplates {query: 'benefit'} → pick the size (1:1 1080×1080, 4:5 1080×1350, 9:16 1080×1920).
2. createDesign {title}, then insertDesignTemplate {designId, templateId, expectedRevision} for each ad. Each becomes an editable frame; all share one Brand collection and one set of text styles.
3. In one runCanvasScript:
   - Brand colours: const c = (await figma.variables.getLocalVariableCollectionsAsync())[0]; const m = c.addMode('MIILS'); set each color/* and radius/* variable with setValueForMode(m, …);
     frame.setExplicitVariableModeForCollection(c, m) on each ad frame.
   - Brand fonts: for (const s of await figma.getLocalTextStylesAsync()) if (s.name.startsWith('display/')) s.fontName = { family: 'Archivo Black', style: 'Regular' } (same for body/, strong/, quote/).
   - Words: frame.findOne(n => n.type === 'TEXT' && n.name === 'headline').characters = '…'. Fill only the named text layers, with ticked facts only. Hide what you don't use (node.visible = false).
4. Pictures: placeDesignImage {nodeId: the slot/* frame, source, scaleMode: 'FILL' for scenes, 'FIT' for the product cut-out, removeStrokes: true, hideLayers: ['_label']}.
5. viewDesign {artboardId, scale: 0.5} and look: no clipped or overlapping words, 9:16 words outside the top 270 px and bottom 670 px.
6. exportDesign {artboardId, scale: 1}.

## Checks the tools do for you
- Text is measured with the project's real fonts on every write (hug, wrap and auto-height are exact); unmeasuredText lists any layer that could not be.
- viewDesign notes list substituted fonts and missing pictures; there should be none before you export.
`;
