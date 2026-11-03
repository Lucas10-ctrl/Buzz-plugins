import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Only the two retained original Builder workflows can place supporting files in a workspace. */
export const pageWorkflowSchema = z.enum([
  "copyos-web-clone",
  "shopify-section-export",
]);

/** Copy the original guide/scripts into a fresh workspace directory, without starting any program.
 * @param workspaceRoot - The editor repository's isolated workspace directory.
 * @param workflow - A retained, bundled workflow selected by the owner-bound agent tool.
 * @returns The original guide and exact local paths for the agent's normal execution tools.
 */
export async function preparePageWorkflow(
  workspaceRoot: string,
  workflow: z.infer<typeof pageWorkflowSchema>,
) {
  const projectRoot = await realpath(workspaceRoot);
  const bundle = fileURLToPath(
    new URL(`../../page-workflows/${workflow}/`, import.meta.url),
  );
  // A fresh directory avoids following files or symlinks a previous agent run left behind.
  const preparedDirectory = await mkdtemp(join(projectRoot, ".buzz-workflow-"));
  const baseDirectory = join(preparedDirectory, workflow);
  try {
    await cp(bundle, baseDirectory, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const source = await readFile(join(baseDirectory, "SKILL.md"), "utf8");
    const guide =
      workflow === "copyos-web-clone"
        ? source
            .replaceAll(
              "the skill base directory reported by the Harness `skill` tool",
              "the baseDirectory returned by buzz_pages prepareWorkflow",
            )
            .replaceAll(
              "normal Harness approval flow",
              "normal Buzz agent approval flow",
            )
            .replaceAll("its Harness preview", "its Buzz Page Builder preview")
        : source.replace(
            "```bash\npython <skill-folder>/scripts/validate_theme_files.py <output-dir>\n```",
            'Call `buzz_pages` with `operation: "validateShopifyExport"` and `input: {"directory":"exports/<export-folder>"}`. This runs the native schema/template validator on files in this isolated projectRoot. Fix its errors and inspect its limitations before delivering.',
          );
    return {
      workflow,
      projectRoot,
      baseDirectory,
      guide,
      instructions:
        "Work only inside projectRoot. Resolve every script/reference against baseDirectory. " +
        "Use your configured Buzz agent tools and approval rules. Do not start or configure another agent harness. " +
        "Use buzz_pages listPages/readPage/createPage/addPageSection and revision-checked mutations for editable sections. " +
        "Use buzz_canvas getStyleGuide to inspect existing project styles; preserve existing styles and propose changes. " +
        "Use buzz_brand readBrandContext for the same workspace’s positioning, audience, voice and guardrails. For a captured style system, propose differences before replacing an existing guide; use buzz_brand saveStyleGuide with the guideRevision as expectedRevision. " +
        "Report unavailable browser, file, validation or execution capabilities; never invent a successful check.",
      limitations:
        workflow === "shopify-section-export"
          ? [
              "Native validation checks schema/template files; full Liquid rendering, CSS/interaction fidelity and actual Shopify upload require separate verification.",
            ]
          : [],
    };
  } catch (error) {
    await rm(preparedDirectory, { recursive: true, force: true });
    throw error;
  }
}
