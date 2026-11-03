import type {
  DesignerBuildRequest,
  DesignerBuildTools,
} from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";

const tools: DesignerBuildTools = {
  readCopy: "buzz_canvas readCopy",
  listTemplates: "buzz_canvas listDesignTemplates",
  listWorkspaces: "buzz_canvas listWorkspaces",
  listDesigns: "buzz_canvas listComparableDesigns",
  insertTemplate: "buzz_canvas insertDesignTemplate",
  edit: "buzz_canvas editDesign",
  view: "buzz_canvas viewDesign",
};

/** Keep the complete original copy/reference/reuse brief while naming Buzz's scoped operations.
 * @param request - Original form answers, including the exact pasted copy.
 * @param design - Open original Canvas document.
 * @param render - The retained original prompt renderer.
 * @returns The original workflow followed by native operation arguments; no user text is replaced.
 */
export function canvasCopyPrompt(
  request: DesignerBuildRequest,
  design: { id: string; title: string },
  render: (
    request: DesignerBuildRequest,
    design: { id: string; title: string },
    tools: DesignerBuildTools,
  ) => string,
): string {
  return (
    `${render(request, design, tools)}\n\n` +
    "Buzz operations use operation plus input. readCopy takes copyId and returns selectedVariantId with the exact saved variants; use the selected body verbatim. " +
    "listWorkspaces pages through saved workspaces in this isolated editor profile with offset/limit and returns opaque workspaceRef values and sample designs. listComparableDesigns takes workspaceRef, offset and limit. Follow nextOffset and report invalid entries. " +
    "Comparison summaries show up to ten artboards and bounded name excerpts; use artboardCount and the truncation flags, then inspectDesign for the complete relevant structure. " +
    "Use workspaceRef only with listComparableDesigns/readDesign/inspectDesign/viewDesign/getStyleGuide to inspect previous work; those sources stay read-only. Omit workspaceRef for the current workspace and all writes. " +
    "To reuse saved project images from a comparison, call copyComparableImages with workspaceRef and urls (the copyos-asset references); it copies into the current workspace and leaves the source unchanged. " +
    "listDesignTemplates/readDesignTemplate use the shared original template library. insertDesignTemplate takes designId, templateId, expectedRevision and optional pageId; it preserves existing artboards and returns document and selectedIds. " +
    "Read the target design again before editDesign or insertion and pass its latest expectedRevision. editDesign changes use the original upsertNodes/deleteNodeIds/variables format. viewDesign takes designId, artboardId and expectedRevision; inspectDesign supplies bounded design-system and structure reads. " +
    "Never replace unrelated manual work. Do not claim a visual check without inspecting the actual rendered image; report unavailable agent capabilities."
  );
}
