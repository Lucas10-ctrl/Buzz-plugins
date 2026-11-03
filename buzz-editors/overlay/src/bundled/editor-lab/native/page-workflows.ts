/** Attach the retained clone workflow to the original start-screen request without changing the user's brief. */
export function pageWorkflowPrompt(workflow: string, prompt: string): string {
  if (workflow === "existing-page")
    return (
      "Use buzz_pages getWorkspace to obtain this conversation's isolated projectRoot. Resolve local subfolders against that root; keep existing source files intact. " +
      "Use your configured Buzz tools and approvals to inspect or clone the requested repository there. Create editable sections with buzz_pages and preserve unrelated pages and manual edits. Report missing capabilities rather than starting another agent harness.\n\n" +
      prompt.replace(
        /^Import this existing coded page into the CopyOS Builder/,
        "Import this existing coded page into the Buzz Page Builder",
      )
    );
  if (workflow !== "website-clone") return prompt;
  return (
    'Use buzz_pages prepareWorkflow with input {"workflow":"copyos-web-clone"} before cloning. ' +
    "Follow its original guide, scripts and returned projectRoot/baseDirectory. Use your normal Buzz tools and approvals. " +
    "Keep the reconstructed sections editable with buzz_pages; preserve existing pages and unrelated edits.\n\n" +
    prompt.replace(
      /^Import this permitted website into the CopyOS Builder/,
      "Import this permitted website into the Buzz Page Builder",
    )
  );
}
