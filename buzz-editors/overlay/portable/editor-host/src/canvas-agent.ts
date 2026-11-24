import { CANVAS_GUIDE_TITLES, CANVAS_GUIDE_TOPICS } from "./canvas-guide.ts";

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
  "uploadDesignFont",
  "getDesignSystem",
  "getDesignMetadata",
  "listDesignIcons",
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
  "Build and check designs (ads, social posts, page artboards) in Canvas with the Figma Plugin API. " +
  "BEFORE your first runCanvasScript, call readCanvasGuide {} once: it is Canvas's equivalent of Figma's figma-use skill " +
  "(critical rules, the check loop, what is supported) and lists the topics (generate-design, api-reference, gotchas, text, " +
  "paints-effects-masks, vectors-icons, components-variables-styles, validation-and-recovery, figma-tools); read generate-design before building an ad. " +
  "runCanvasScript {designId, expectedRevision, code}: code is the body of an async function with a `figma` global shaped like the Figma Plugin API " +
  "(frames, auto layout incl. wrap/min/max/absolute, text with mixed ranges and any Google font, SOLID/GRADIENT/IMAGE paints with filters, " +
  "shadows, layer and background blur, blend modes, masks, corner smoothing, vectors, createNodeFromSvg, booleans, components and instances, " +
  "variables and modes, text styles, createAutoLayout, node.set, node.query) plus canvas.icon(name) for icons and brand marks. " +
  "Anything Canvas lacks throws with Figma's wording and the alternative. A script is atomic: on error nothing is saved. " +
  "Returns {revision, result, logs, warnings, unmeasuredText}. Pictures: (await figma.createImageAsync(path | https URL | data URL)).hash. " +
  "viewDesign {designId, artboardId?, scale? (0.1–3), top?, height?} returns the PNG you check: the same renderer, fonts and crops as exportDesign, " +
  "so at one scale it is the export. getDesignMetadata {designId, nodeId?, depth?}: XML layer outline like Figma's get_metadata. " +
  "exportDesign {designId, artboardId?, scale 1–3} writes the PNG and returns {path,width,height}. createDesign {title}. " +
  "readDesign {designId} returns every field (large); prefer getDesignSystem {designId} (components, text styles, variables per mode, named layers) " +
  "or inspectDesign. editDesign {designId, expectedRevision, changes:{upsertNodes:[{id (new uuid), kind, parentId, name, x, y, width, height, fill, " +
  "text, fontFamily, fontSize, fontWeight, …}], deleteNodeIds}} for small direct edits. " +
  "listDesignTemplates {category?, query?} lists ready ad templates (Product hero, Benefit callouts, Testimonial, Us vs them, Before and after, " +
  "3 reasons, Offer, Founder quote, UGC post; 1:1, 4:5, 9:16); insertDesignTemplate {designId, templateId, expectedRevision, position?}. " +
  "placeDesignImage {designId, expectedRevision, nodeId, source, scaleMode: FILL|FIT|CROP, zoom?, offsetX?, offsetY?, removeStrokes?, hideLayers?}. " +
  "putDesignImage {source} stores a picture. listDesignFonts; installDesignFonts {families:[Google family]}; uploadDesignFont {source: font file path or URL} " +
  "adds a brand font to the project once. listDesignIcons {query?}. Comments: listDesignComments/addDesignComment/setDesignCommentStatus. " +
  "Pages: previewDesignPage {designId,nodeId,expectedRevision}, buildDesignPage (+previewHash), reviewDesignPageUpdate/applyDesignPageUpdate. " +
  "getStyleGuide reads workspace branding. readCanvasGuide {topic?}. workspaceId is supplied by the host.";

/** Guide topics an agent can read (`readCanvasGuide {topic}`), with a one-line title each. */
export const CANVAS_GUIDE_TOPIC_NAMES: readonly string[] = Object.keys(CANVAS_GUIDE_TOPICS);

/**
 * One guide topic, with the list of the others appended to the main one.
 * @param topic - A topic name (default `canvas-use`).
 * @returns The markdown, or undefined for an unknown topic.
 */
export function canvasGuideTopic(topic = "canvas-use"): string | undefined {
  const text = CANVAS_GUIDE_TOPICS[topic];
  if (text === undefined) return undefined;
  if (topic !== "canvas-use") return text;
  return `${text}\n## Topics\n${CANVAS_GUIDE_TOPIC_NAMES.map((name) => `- ${name}: ${CANVAS_GUIDE_TITLES[name] ?? name}`).join("\n")}\n`;
}

/** The guide an agent reads first (the `canvas-use` topic). */
export const CANVAS_AGENT_GUIDE = canvasGuideTopic("canvas-use") ?? "";

/** The MCP server instruction that hands the guide to Claude automatically, as Figma's MCP hands it figma-use. */
export const CANVAS_AGENT_INSTRUCTION =
  "Before designing in Canvas, read the canvas-use guide (canvas tool, operation readCanvasGuide, or the canvas://guide/canvas-use resource): " +
  "it is Canvas's equivalent of Figma's figma-use skill. Read generate-design before building an ad.";
