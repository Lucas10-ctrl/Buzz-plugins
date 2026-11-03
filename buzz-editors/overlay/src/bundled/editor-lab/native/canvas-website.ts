import originalGuide from "../../../../portable/guides/canvas-to-website.md?raw";
import { designerWebsiteBuildPrompt } from "../../../../portable/copyos-apps/src/client/DesignerWebsiteBuildPrompt";

/** Preserve the complete original workflow; only its host tool identifiers and argument spelling change. */
export function canvasWebsiteGuide(): string {
  const tools: Record<string, string> = {
    inspect_copyos_design: "buzz_canvas inspectDesign",
    read_copyos_design: "buzz_canvas readDesign",
    view_copyos_design: "buzz_canvas viewDesign",
    read_copyos_style_guide: "buzz_canvas getStyleGuide",
    preview_copyos_design_page: "buzz_canvas previewDesignPage",
    build_copyos_design_page: "buzz_canvas buildDesignPage",
  };
  return originalGuide
    .replace(/\b[a-z]+_copyos_[a-z_]+\b/g, (name) => {
      const native = tools[name];
      if (!native)
        throw new Error(
          `Canvas website guide has an unmapped host tool: ${name}`,
        );
      return native;
    })
    .replaceAll("preview_hash", "previewHash");
}

/** Keep the original responsive/interaction brief while loading its guide through the owner's Buzz tool session. */
export function canvasWebsitePrompt(
  workspaceId: string,
  designId: string,
  frameId: string,
  revision: number,
): string {
  return designerWebsiteBuildPrompt(workspaceId, designId, frameId, revision, {
    builderName: "Buzz Page Builder",
    loadGuide:
      'Use buzz_canvas readWorkflowGuide with input {"guide":"canvas-to-website"} before acting.',
  });
}
