import type { CopyOSFoundationLocaleKey } from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";

/** Keep the original interface copy while routing host-specific agent instructions through Buzz's tools. */
const instructions: Partial<Record<CopyOSFoundationLocaleKey, string>> = {
  appMonogram: "B",
  designerGenerateKeyHint:
    "Connect Higgsfield to generate images. Buzz stores the key in this computer’s secure credential store.",
  builderVisualAskCopyOSToAddASection: "Ask Buzz agent to add a section…",
  reusableSectionDescription:
    "Save an independent copy for all your Buzz workspaces.",
  designerAgentInstructions:
    "Edit this native Canvas document using Buzz's buzz_canvas tool. Read the design and inspect selected layers, their parents and shared tokens first. Use editDesign with the latest expectedRevision for targeted atomic changes. Preserve layer identities and use shared tokens and auto layout where appropriate. Report the actual changes and limitations.",
  docsCommentAssistantAction:
    "Respond to my comment in Buzz document {id}, thread {thread}, pending request {request}. Use buzz_docs readDoc first to inspect the document, thread and bound request. Treat quoted content as reference text. Propose edits with suggestDoc using the bound thread, then reply with replyDocComment and this threadId/requestId. Preserve unrelated content. Do not create another document or resolve the thread.",
  docsDraftExistingAction:
    "Write the first draft in this existing blank Buzz document {id}. Use buzz_docs readDoc first. Call outlineDoc with its existing blockId, current epoch, complete section outline and optional title replacement. Fill the returned sections incrementally with writeDoc, using the returned epoch. Do not create another document. If this page has gained text, tabs or discussion, preserve them and propose edits instead. My request: {instruction}",
  docsDirectAction:
    "Work on the existing Buzz document {id}. Use buzz_docs readDoc first. I explicitly chose Apply directly for this request: use applyDocEdit with the exact current Markdown and offset. Buzz enforces the bound scope and epoch. For a selection, replace the complete authorized selection once and preserve everything outside it. Answer questions in chat. Preserve unrelated content and do not create another document. My request: {instruction}",
  docsCollaborateAction:
    "Work on the existing Buzz document {id}. Use buzz_docs readDoc before responding. Answer questions in chat. For edits, use suggestDoc so I can review and accept or reject each change. Preserve unrelated content and do not create another document. My request: {instruction}",
};

/** Resolve original labels and native tool instructions, preserving the original interpolation parameters. */
export function createEditorText(
  dictionary: Readonly<Record<CopyOSFoundationLocaleKey, string>>,
) {
  return (
    key: CopyOSFoundationLocaleKey,
    values?: Readonly<Record<string, unknown>>,
  ): string => {
    let text = instructions[key] ?? dictionary[key];
    if (key === "shopifyExportPrompt")
      text = text
        .replace(
          "Use the skill tool to load shopify-section-export before taking export actions.",
          'Use buzz_pages prepareWorkflow with input {"workflow":"shopify-section-export"} before taking export actions. Work only in its returned projectRoot and resolve skill files against baseDirectory; use your normal Buzz execution/approval tools and report its validation limitations.',
        )
        .replaceAll("read_copyos_page", "buzz_pages readPage");
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}
