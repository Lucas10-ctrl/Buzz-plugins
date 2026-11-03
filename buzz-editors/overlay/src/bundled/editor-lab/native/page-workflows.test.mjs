import { expect, it } from "vitest";
import { pageWorkflowPrompt } from "./page-workflows.ts";

it("connects the original clone request to the retained Buzz workflow and preserves the user direction", () => {
  const original =
    "Import this permitted website into the CopyOS Builder as editable sections and elements.\nWebsite URL: https://example.com\nDirection: Preserve CopyOS words in my content.";
  const prompt = pageWorkflowPrompt("website-clone", original);
  expect(prompt).toContain(
    'buzz_pages prepareWorkflow with input {"workflow":"copyos-web-clone"}',
  );
  expect(prompt).toContain("Buzz Page Builder as editable sections");
  expect(prompt).toContain(original.split("\n").slice(1).join("\n"));
  expect(pageWorkflowPrompt("unrelated", original)).toBe(original);
});

it("resolves original existing-page requests in the bound Buzz workspace without changing the user brief", () => {
  const original =
    "Import this existing coded page into the CopyOS Builder for optimization.\nLocal workspace subfolder: source/site\nOptimization goal: Keep my original text.";
  const prompt = pageWorkflowPrompt("existing-page", original);
  expect(prompt).toContain("buzz_pages getWorkspace");
  expect(prompt).toContain(
    "Import this existing coded page into the Buzz Page Builder for optimization.",
  );
  expect(prompt).toContain(original.split("\n").slice(1).join("\n"));
});
