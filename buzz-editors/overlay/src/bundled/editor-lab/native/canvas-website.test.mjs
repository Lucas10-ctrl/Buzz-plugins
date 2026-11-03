import { expect, it } from "vitest";
import { canvasWebsiteGuide, canvasWebsitePrompt } from "./canvas-website.ts";
import { designerWebsiteBuildPrompt } from "../../../../portable/copyos-apps/src/client/DesignerWebsiteBuildPrompt.ts";

it("preserves the original build brief and changes only its host destination and guide loader", () => {
  const native = canvasWebsitePrompt("workspace", "design", "frame", 7);
  expect(native.split("\n").slice(1)).toEqual(
    designerWebsiteBuildPrompt("workspace", "design", "frame", 7)
      .split("\n")
      .slice(1),
  );
  expect(native).toContain("Buzz Page Builder");
  expect(native).toContain(
    'readWorkflowGuide with input {"guide":"canvas-to-website"}',
  );
  expect(native).toContain("Saved source revision: 7");
});

it("maps every original guide tool to an advertised Buzz operation without removing workflow content", () => {
  const guide = canvasWebsiteGuide();
  for (const operation of [
    "readDesign",
    "inspectDesign",
    "viewDesign",
    "getStyleGuide",
    "previewDesignPage",
    "buildDesignPage",
  ])
    expect(guide).toContain(`buzz_canvas ${operation}`);
  for (const title of [
    "Understand the source",
    "Build in Builder",
    "Responsive layout is required",
    "Implement and test behavior",
    "Verify the actual saved page",
  ])
    expect(guide).toContain(`## ${title}`);
  expect(guide).toContain("previewHash");
  expect(guide).not.toMatch(/\b\w+_copyos_\w+\b/);
});
