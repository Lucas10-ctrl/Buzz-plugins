import { expect, it } from "vitest";
import { createEditorText } from "./editor-locale.ts";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
const editorText = createEditorText(en);

it("loads the original editable Shopify workflow through Buzz without removing its export requirements", () => {
  const prompt = editorText("shopifyExportPrompt", {
    page: "My page",
    section: "page-id",
  });
  expect(prompt).toContain(
    'prepareWorkflow with input {"workflow":"shopify-section-export"}',
  );
  expect(prompt).toContain("buzz_pages readPage");
  expect(prompt).toContain("My page");
  expect(prompt).toContain("page-id");
  expect(prompt).toContain(
    "Do not substitute the basic static Shopify exporter",
  );
  expect(prompt).toContain("Preserve the source page and its variations");
  expect(prompt).not.toContain("skill tool");
  expect(prompt).not.toContain("read_copyos_page");
});

it("keeps Docs review, direct-edit, outline and comment instructions on the actual Buzz operations", () => {
  for (const [key, operation] of [
    ["docsCollaborateAction", "suggestDoc"],
    ["docsDirectAction", "applyDocEdit"],
    ["docsDraftExistingAction", "outlineDoc"],
    ["docsCommentAssistantAction", "replyDocComment"],
  ]) {
    const prompt = editorText(key, {
      id: "document-id",
      instruction: "Keep my **manual** copy {unchanged}",
      thread: "thread-id",
      request: "request-id",
    });
    expect(prompt).toContain("document-id");
    expect(prompt).toContain("buzz_docs readDoc");
    expect(prompt).toContain(operation);
    expect(prompt).not.toMatch(/\b\w*_copyos_\w+\b/);
    if (key !== "docsCommentAssistantAction")
      expect(prompt).toContain("Keep my **manual** copy {unchanged}");
    else {
      expect(prompt).toContain("thread-id");
      expect(prompt).toContain("request-id");
    }
  }
  expect(
    editorText("docsCollaborateAction", { id: "doc", instruction: "Revise" }),
  ).toContain("accept or reject");
  expect(
    editorText("docsDirectAction", { id: "doc", instruction: "Revise" }),
  ).toContain("preserve everything outside");
});

it("retains original UI labels and resolves Canvas editing through the native tool", () => {
  expect(editorText("designerExportSvg")).toBe("Export SVG");
  const prompt = editorText("designerAgentInstructions");
  expect(prompt).toContain("buzz_canvas");
  expect(prompt).toContain("expectedRevision");
  expect(prompt).toContain("Preserve layer identities");
});
