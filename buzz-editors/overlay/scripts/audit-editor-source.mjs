import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../portable/copyos-apps/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("SOURCE_MANIFEST.json", root), "utf8"),
);
const adapters = new Set([
  "CopyOSNewSession.tsx",
  "PageDesignerWorkspace.tsx",
  "PageDesignerWorkspace.module.css",
  "DocsRichBlock.tsx",
  // Preserve manual slash-menu scrolling across host/editor renders; regression: docs-slash-scroll.test.mjs.
  "DocsSlashMenu.tsx",
  "DocsBodyBlocks.ts",
  "locales.ts",
  "DocsHistory.tsx",
  "DocsCommentEditor.tsx",
  "DocsReadView.tsx",
  "DocsLibrary.tsx",
  "DocsWorkspace.module.css",
  // Buzz-native Docs chrome: margin comments, document list and breadcrumb header (2026-11-04).
  "DocsComments.tsx",
  "locales/docs.ts",
  "DesignerWebsiteBuildPrompt.ts",
  "DesignerBuildFromCopy.tsx",
  "DesignerReview.tsx",
  "DesignerGeneration.tsx",
  "DesignerGeneration.module.css",
  "LandingPageVisualWorkspace.tsx",
  "LandingPageWorkspace.tsx",
  "CopyOSPanel.module.css",
]);
const changed = [];
for (const [path, expected] of Object.entries(manifest.files)) {
  const file = new URL(`src/client/${path}`, root);
  const bytes = await readFile(file);
  // Imports are retargeted to the same extracted domain source, rather than the former host's package resolver.
  const normalized = /\.(ts|tsx)$/.test(path)
    ? Buffer.from(
        bytes
          .toString("utf8")
          .replace(
            /(['"])\.\.\/\.\.\/\.\.\/copyos-domain\/src\/([^'"]+)\.ts\1/g,
            (_, quote, leaf) =>
              `${quote}@deepseek-ai/dsh-copyos-projects/${leaf}${quote}`,
          ),
      )
    : bytes;
  const actual = createHash("sha256").update(normalized).digest("hex");
  if (actual !== expected) changed.push(path);
}
const unexpected = changed.filter((path) => !adapters.has(path));
if (unexpected.length)
  throw new Error(
    `Original editor files changed outside host adapters: ${unexpected.join(", ")}`,
  );
const portable = new URL("../portable/", import.meta.url);
const repositoryRoot = await realpath(new URL("../", import.meta.url));
for (const area of ["copyos-apps", "copyos-domain", "copyos-tools"]) {
  const installed = await realpath(new URL(`${area}/node_modules/`, portable));
  const location = relative(repositoryRoot, installed);
  if (
    location === ".." ||
    location.startsWith(`..${sep}`) ||
    isAbsolute(location)
  )
    throw new Error(`Editor dependencies leave the Buzz checkout: ${area}`);
}
const libraries = JSON.parse(
  await readFile(new URL("libraries/SOURCE_MANIFEST.json", portable), "utf8"),
);
for (const [path, expected] of Object.entries(libraries.files)) {
  if (!path.startsWith("portable/libraries/") || path.split("/").includes(".."))
    throw new Error(`Invalid retained library path: ${path}`);
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error(`Retained editor library changed: ${path}`);
}
const renderer = JSON.parse(
  await readFile(
    new URL("copyos-domain/PAGE_RENDERER_SOURCE.json", portable),
    "utf8",
  ),
);
const pageSource = await readFile(
  new URL("copyos-domain/src/pages.ts", portable),
  "utf8",
);
const exposedRenderer =
  "/** Render the original selected-section HTML without writing an export.\n * @param page - Saved page snapshot to render.\n * @returns The same HTML document used by the original HTML and Vercel exporters.\n */\nexport function standaloneHtml";
if (
  !pageSource.includes(exposedRenderer) ||
  createHash("sha256")
    .update(pageSource.replace(exposedRenderer, "function standaloneHtml"))
    .digest("hex") !== renderer.sha256
)
  throw new Error(
    "Original page renderer/repository changed outside its declared export adapter",
  );
const tools = JSON.parse(
  await readFile(new URL("TOOL_SOURCE_MANIFEST.json", portable), "utf8"),
);
for (const [path, expected] of Object.entries(tools.files)) {
  const bytes = await readFile(new URL(path, portable));
  const normalized = path.endsWith(".ts")
    ? Buffer.from(
        bytes
          .toString("utf8")
          .replaceAll(
            "'../../copyos-domain/src/designs.ts'",
            "'@deepseek-ai/dsh-copyos-projects'",
          )
          .replace(
            /'\.\.\/\.\.\/copyos-domain\/src\/(design-model|types)\.ts'/g,
            "'@deepseek-ai/dsh-copyos-projects/$1'",
          ),
      )
    : bytes;
  if (createHash("sha256").update(normalized).digest("hex") !== expected)
    throw new Error(
      `Original tool or guide changed outside import retargeting: ${path}`,
    );
}
const bundle = await readFile(new URL("dist/copyos-apps.js", root), "utf8");
for (const marker of ["__DSH_BOOT__", "__ModuleLoader__", "renderFactorySlot"])
  if (bundle.includes(marker))
    throw new Error(
      `Old application host marker remains in the editor bundle: ${marker}`,
    );
if (/__require\(["']react(?:["'/])/.test(bundle))
  throw new Error("Browser editor bundle requires React through CommonJS");
process.stdout.write(
  `${Object.keys(manifest.files).length} original editor files retained; ${changed.length} explicit host adapters; ${Object.keys(tools.files).length} original tool/guide files retained; ${Object.keys(libraries.files).length} retained library files verified; dependency directories stay inside the Buzz checkout; no old application boot markers or CommonJS React calls in ${fileURLToPath(new URL("dist/copyos-apps.js", root))}.\n`,
);
