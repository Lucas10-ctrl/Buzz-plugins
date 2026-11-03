// Artifact acceptance: build with `bin/node scripts/build-editor-host.mjs` before running this file.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DesktopEditorStore } from "../../src/bundled/editor-lab/native/desktop-store.ts";
import { createDesignNode } from "../../portable/copyos-domain/src/design-model.ts";
import { randomUUID } from "node:crypto";
import { shopifyFixture } from "./shopify-fixture.mjs";

let root;
let store;
let data;
let launchCount = 0;

it("runs the original Canvas copy library, comparison and template-import operations in the relocated worker", async () => {
  const workspaceId = "copy-build-target";
  const copy = await store.call("createCopyAsset", {
    workspaceId,
    title: "Saved copy",
    label: "Original",
    body: "Keep these words exactly.",
  });
  expect(
    await store.call("readCopyAsset", { workspaceId, copyId: copy.id }),
  ).toEqual(copy);
  let source = await store.call("createDesign", {
    workspaceId: "copy-reference",
    title: "Previous project",
  });
  const frame = createDesignNode("frame", randomUUID(), "Reference frame");
  const text = {
    ...createDesignNode("text", randomUUID(), "Reference copy"),
    parentId: frame.id,
    text: "Original editable text",
  };
  source = await store.call("saveDesign", {
    workspaceId: "copy-reference",
    document: { ...source, nodes: [frame, text] },
  });
  const template = await store.call("saveDesignTemplate", {
    workspaceId: "copy-reference",
    designId: source.id,
    nodeId: frame.id,
    title: "Reference hero",
    category: "Landing page",
    description: "Original captured scene",
  });
  const catalog = await store.call("listCanvasWorkspaces", {
    workspaceId,
    limit: 20,
  });
  const reference = catalog.workspaces.find((workspace) =>
    workspace.sampleDesigns.some((design) => design.id === source.id),
  );
  expect(reference).toBeDefined();
  expect(
    await store.call("readDesign", {
      workspaceId,
      workspaceRef: reference.workspaceRef,
      designId: source.id,
    }),
  ).toEqual(source);
  const target = await store.call("createDesign", {
    workspaceId,
    title: "Build from copy target",
  });
  const imported = await store.call("insertDesignTemplate", {
    workspaceId,
    designId: target.id,
    templateId: template.id,
    expectedRevision: target.revision,
  });
  expect(imported.selectedIds).toHaveLength(1);
  expect(
    imported.document.nodes.some(
      (node) => node.text === "Original editable text" && node.id !== text.id,
    ),
  ).toBe(true);
  await expect(
    store.call("editDesign", {
      workspaceId,
      workspaceRef: reference.workspaceRef,
      designId: source.id,
      expectedRevision: source.revision,
      changes: { deleteNodeIds: [frame.id] },
    }),
  ).rejects.toThrow("read-only");
  expect(
    await store.call("readDesign", {
      workspaceId: "copy-reference",
      designId: source.id,
    }),
  ).toEqual(source);
});

it("exports portable CSS, fonts and images through the relocated worker without changing saved HTML", async () => {
  const workspaceId = "native-portable-export";
  const { projectRoot } = await store.call("getPageWorkspace", { workspaceId });
  await mkdir(join(projectRoot, "assets"), { recursive: true });
  await writeFile(
    join(projectRoot, "assets", "site.css"),
    '@font-face{font-family:Project;src:url("font.woff2")}.hero{background:url("card.svg")}',
  );
  await writeFile(
    join(projectRoot, "assets", "font.woff2"),
    Buffer.from([1, 2, 3]),
  );
  await writeFile(
    join(projectRoot, "assets", "card.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  let page = await store.call("createPage", {
    workspaceId,
    title: "Portable artifact",
  });
  page = await store.call("addPageSection", {
    workspaceId,
    pageId: page.id,
    title: "Hero",
    templateId: "custom-html",
    label: "Original",
    html: '<link rel="stylesheet" href="assets/site.css"><h1 class="hero">Retain manual text</h1><img src="assets/card.svg">',
  });
  const exported = await store.call("exportPage", {
    workspaceId,
    pageId: page.id,
    format: "html",
  });
  const result = await store.call("readExport", {
    workspaceId,
    path: exported.path,
  });
  const html = Buffer.from(result.content, "base64").toString("utf8");
  expect(html).toContain("data:text/css;base64,");
  expect(html).toContain("data:image/svg+xml;base64,");
  expect(html).toContain("Retain manual text");
  const css = Buffer.from(
    html.match(/data:text\/css;base64,([^"\s]+)/u)[1],
    "base64",
  ).toString("utf8");
  expect(css).toContain("data:font/woff2;base64,AQID");
  expect(css).toContain("data:image/svg+xml;base64,");
  const saved = await store.call("readPage", { workspaceId, pageId: page.id });
  expect(saved.sections[0].variants[0].html).toContain(
    'href="assets/site.css"',
  );
});

it("validates the original project-subfolder choice through the relocated worker", async () => {
  const workspaceId = "native-folder-validation";
  const { projectRoot } = await store.call("getPageWorkspace", { workspaceId });
  const path = join(projectRoot, "source", "site");
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "index.html"),
    "<h1>Retain the original source</h1>",
  );
  expect(await store.call("validatePageFolder", { workspaceId, path })).toBe(
    "source/site",
  );
  await expect(
    store.call("validatePageFolder", { workspaceId, path: root }),
  ).rejects.toThrow("inside this editor workspace");
  expect(await readFile(join(path, "index.html"), "utf8")).toContain(
    "Retain the original source",
  );
});
// An explicit target/debug/bin override also checks Tauri's resource-copy output after native compilation.
const source = process.env.BUZZ_EDITOR_TEST_BIN
  ? resolve(process.env.BUZZ_EDITOR_TEST_BIN)
  : fileURLToPath(new URL("../../src-tauri/resources/bin/", import.meta.url));
const executable =
  process.platform === "win32" ? "buzz-editor-host.exe" : "buzz-editor-host";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-editor-artifact-"));
  data = join(root, "test-data");
  for (const file of [
    "editor-host.tgz",
    "editor-bootstrap.mjs",
    process.platform === "win32"
      ? "buzz-editor-credentials.exe"
      : "buzz-editor-credentials",
  ])
    await copyFile(
      join(source, file),
      join(root, file),
      constants.COPYFILE_FICLONE,
    );
  await copyFile(
    join(source, executable),
    join(root, executable),
    constants.COPYFILE_FICLONE,
  );
  await chmod(join(root, executable), 0o755);
  const manifest = JSON.parse(
    await readFile(
      new URL("../../src/bundled/editor-lab/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const declaration = manifest.host.processes.find(
    (process) => process.id === "editor-repository",
  );
  store = new DesktopEditorStore(
    {
      spawn: async (id, options = {}) => {
        if (id !== declaration.id)
          throw new Error("Undeclared desktop process");
        launchCount++;
        const env = { ...process.env };
        delete env.NODE_PATH;
        delete env.NODE_OPTIONS;
        const child = spawn(
          join(root, executable),
          [...declaration.args, ...(options.args ?? [])],
          { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
        );
        child.stdout
          .setEncoding("utf8")
          .on("data", (data) => options.onStdout?.(data));
        child.stderr
          .setEncoding("utf8")
          .on("data", (data) => options.onStderr?.(data));
        const exited = new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) => resolve(code));
        });
        return {
          write: (data) =>
            new Promise((resolve, reject) => {
              child.stdin.write(data, (error) =>
                error ? reject(error) : resolve(),
              );
            }),
          end: (data) =>
            new Promise((resolve) => {
              child.stdin.end(data, resolve);
            }),
          kill: async () => {
            child.kill();
          },
          exited,
        };
      },
    },
    data,
  );
}, 30_000);
afterAll(async () => {
  await store?.dispose();
  if (root) await rm(root, { recursive: true, force: true });
});

it("saves original pages, designs and reviewable Docs through the packaged stdio host outside the checkout", async () => {
  const workspaceId = "artifact-workspace";
  const workflow = await store.call("preparePageWorkflow", {
    workspaceId,
    workflow: "copyos-web-clone",
  });
  expect(workflow.projectRoot.startsWith(data)).toBe(true);
  await mkdir(join(workflow.projectRoot, "assets"), { recursive: true });
  const asset =
    '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語 café</text></svg>';
  await writeFile(
    join(workflow.projectRoot, "assets", "日本語 café.svg"),
    asset,
  );
  const previewAsset = await store.call("readPageAsset", {
    workspaceId,
    path: "assets/日本語 café.svg",
  });
  expect(previewAsset.mimeType).toBe("image/svg+xml");
  expect(
    await store.call("readPageAsset", {
      workspaceId,
      path: "assets/日本語 café.svg",
      knownVersion: previewAsset.version,
    }),
  ).toEqual({
    path: "assets/日本語 café.svg",
    version: previewAsset.version,
    unchanged: true,
  });
  expect(Buffer.from(previewAsset.dataBase64, "base64").toString("utf8")).toBe(
    asset,
  );
  await expect(
    store.call("readPageAsset", { workspaceId, path: "../outside.svg" }),
  ).rejects.toThrow();
  expect(
    await readFile(
      join(workflow.baseDirectory, "scripts/init-clone.mjs"),
      "utf8",
    ),
  ).toContain("Creates:");
  expect(workflow.guide).toContain(
    "baseDirectory returned by buzz_pages prepareWorkflow",
  );
  expect(
    await readFile(
      join(workflow.baseDirectory, "references/deliverables.md"),
      "utf8",
    ),
  ).toContain("NOTES.md");
  for (const [file, content] of shopifyFixture().files()) {
    const destination = join(workflow.projectRoot, "exports", "shopify", file);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  expect(
    await store.call("validateShopifyExport", {
      workspaceId,
      directory: "exports/shopify",
    }),
  ).toMatchObject({ valid: true, errors: [] });
  const page = await store.call("createPage", {
    workspaceId,
    title: "Standalone page",
  });
  const reusable = await store.call("saveReusableSection", {
    workspaceId,
    title: "Native shared section",
    category: "Reusable",
    description: "Original library save through the packaged repository",
    html: "<section>Reusable content</section>",
  });
  const library = await store.call("listReusableSections", workspaceId);
  expect(library.find((section) => section.id === reusable.id)?.html).toContain(
    "Reusable content",
  );
  // Stay below the original one-million-character section limit while exercising many pipe chunks.
  const html = `<section>${"Editable α ".repeat(80_000)}</section>`;
  const saved = await store.call("addPageSection", {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
    title: "Hero",
    templateId: "custom-html",
    label: "Original",
    html,
  });
  // The original editor adds stable block IDs; its editable text must survive transport intact.
  const savedHtml = saved.sections[0].variants[0].html;
  expect(savedHtml).toMatch(/^<section data-copyos-block-id="[^"]+">/);
  expect(
    savedHtml.slice(savedHtml.indexOf(">") + 1) ===
      html.slice("<section>".length),
  ).toBe(true);
  const reopened = await store.call("readPage", {
    workspaceId,
    pageId: page.id,
  });
  expect(reopened.sections[0].variants[0].html === savedHtml).toBe(true);
  const design = await store.call("createDesign", {
    workspaceId,
    title: "Standalone canvas",
  });
  expect(
    await store.call("readDesign", { workspaceId, designId: design.id }),
  ).toEqual(design);
  const frame = {
    ...createDesignNode("frame", randomUUID(), "Packaged artboard"),
    width: 320,
    height: 200,
  };
  const designed = await store.call("saveDesign", {
    workspaceId,
    document: { ...design, nodes: [frame] },
  });
  const inspected = await store.call("inspectDesign", {
    workspaceId,
    designId: design.id,
    revision: designed.revision,
    section: "design-system",
    owner_id: frame.id,
  });
  expect(inspected.items[0].scope.id).toBe(frame.id);
  expect(
    Buffer.byteLength(JSON.stringify(inspected, null, 2)),
  ).toBeLessThanOrEqual(32768);
  const rendered = await store.call("viewDesign", {
    workspaceId,
    designId: design.id,
    expectedRevision: designed.revision,
    maxWidth: 320,
  });
  expect(rendered).toMatchObject({
    width: 320,
    height: 200,
    design: { id: design.id, revision: designed.revision },
  });
  expect(Buffer.from(rendered.dataBase64, "base64").subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const conversion = {
    workspaceId,
    designId: design.id,
    nodeId: frame.id,
    expectedRevision: designed.revision,
  };
  const preview = await store.call("previewDesignPage", conversion);
  expect(preview.state).toBe("ready");
  const built = await store.call("buildDesignPage", {
    ...conversion,
    previewHash: preview.previewHash,
  });
  expect(built.page.conversion.sourceDesignId).toBe(design.id);
  const doc = await store.call("createDoc", {
    workspaceId,
    title: "Standalone Docs",
    sections: [],
  });
  const blockId = doc.blocks[0].id;
  const outlined = await store.call("outlineDoc", {
    workspaceId,
    docId: doc.id,
    blockId,
    epoch: doc.epoch,
    sections: ["Opening"],
    sessionId: "artifact-conversation",
  });
  const written = await store.call("writeDoc", {
    workspaceId,
    docId: doc.id,
    blockId,
    epoch: outlined.epoch,
    content: "Original manual text.",
    done: true,
  });
  const proposal = await store.call("suggestDoc", {
    workspaceId,
    docId: doc.id,
    blockId,
    expectedEpoch: written.epoch,
    before: "Original",
    after: "Refined",
    note: "Review me",
    start: 0,
  });
  expect(proposal.blocks[0].content).toBe("Original manual text.");
  const accepted = await store.call("reviewDocSuggestion", {
    workspaceId,
    docId: doc.id,
    suggestionId: proposal.suggestions[0].id,
    decision: "accept",
  });
  expect(accepted.blocks[0].content).toBe("Refined manual text.");
  const pdf = await store.call("exportDoc", {
    workspaceId,
    docId: doc.id,
    format: "pdf",
  });
  expect(Buffer.from(pdf.content, "base64").subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  const word = await store.call("exportDoc", {
    workspaceId,
    docId: doc.id,
    format: "word",
  });
  expect(Buffer.from(word.content, "base64").subarray(0, 2).toString()).toBe(
    "PK",
  );
  expect(launchCount).toBe(1);
});

it("starts the packaged, bounded Figma decoder instead of resolving a Harness worker", async () => {
  await expect(
    store.call("importDesign", {
      workspaceId: "artifact-workspace",
      fileName: "invalid.fig",
      fileBase64: Buffer.from("invalid Figma bytes").toString("base64"),
    }),
  ).rejects.toThrow("This is not a native Figma .fig file");
  const metadata = await store.call("getDesignFontMetadata", {
    workspaceId: "artifact-workspace",
    family: "Inter",
  });
  expect(metadata.state).toBe("available");
});

it("relocates the native credential helper and rejects malformed input before accessing storage", async () => {
  const helper = join(
    root,
    process.platform === "win32"
      ? "buzz-editor-credentials.exe"
      : "buzz-editor-credentials",
  );
  await chmod(helper, 0o755);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(helper, [], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(
      JSON.stringify({ operation: "set", value: "invalid-without-colon" }),
    );
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    ok: false,
    error: "Enter a Higgsfield KEY_ID:KEY_SECRET credential",
  });
  expect(result.stdout).not.toContain("invalid-without-colon");
  expect(result.stderr).toBe("");
});

it("exports resource-complete original project folders through the relocated worker", async () => {
  const workspaceId = "project-export-artifact";
  const { projectRoot } = await store.call("getPageWorkspace", { workspaceId });
  await mkdir(join(projectRoot, "assets"), { recursive: true });
  await writeFile(
    join(projectRoot, "assets", "site.css"),
    '.hero{background:url("image.svg")}',
  );
  await writeFile(
    join(projectRoot, "assets", "image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  let page = await store.call("createPage", {
    workspaceId,
    title: "Packaged export",
  });
  page = await store.call("addPageSection", {
    workspaceId,
    pageId: page.id,
    title: "Hero",
    label: "Original",
    templateId: "custom-html",
    html: '<link rel="stylesheet" href="assets/site.css"><h1 class="hero">Keep original copy</h1><img src="assets/image.svg">',
  });
  for (const format of ["vercel", "shopify"]) {
    const exported = await store.call("exportPage", {
      workspaceId,
      pageId: page.id,
      format,
    });
    const file =
      format === "vercel" ? "index.html" : "sections/copyos-1-hero.liquid";
    const result = await store.call("readExport", {
      workspaceId,
      path: join(exported.path, file),
    });
    const html = Buffer.from(result.content, "base64").toString("utf8");
    expect(html).toContain("Keep original copy");
    expect(html).toContain("data:text/css;base64,");
    expect(html).toContain("data:image/svg+xml;base64,");
  }
  expect(
    await store.call("readPage", { workspaceId, pageId: page.id }),
  ).toEqual(page);
});

it("persists original brand profiles and styleguide tokens through the relocated desktop worker", async () => {
  const workspaceId = JSON.stringify([
    "solo",
    "artifact:owner",
    "brand-client",
  ]);
  const created = await store.call("createBrand", {
    workspaceId,
    title: "Artifact brand",
    positioning: "Helpful",
    audience: "Owners",
    voice: "Plain",
    differentiators: "Care",
    guardrails: "No hype",
  });
  const saved = await store.call("saveStyleGuide", {
    workspaceId,
    name: "Artifact styles",
    css: ":root { --brand: #334455; } h1 { font-family: Inter; }",
    sourceType: "file",
    sourceLabel: "brand.css",
    expectedRevision: null,
  });
  const context = await store.call("readBrandContext", { workspaceId });
  expect(context.brands[0].id).toBe(created.id);
  expect(context.guideRevision).toBe(saved.guideRevision);
  expect(context.guide.tokens.colors).toContain("#334455");
  expect(await store.call("getStyleGuide", { workspaceId })).toEqual(
    context.guide,
  );
  expect(
    (await store.call("readBrandContext", { workspaceId: "other-workspace" }))
      .brands,
  ).toEqual([]);
});
