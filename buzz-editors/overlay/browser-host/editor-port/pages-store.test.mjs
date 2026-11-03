import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
  rename,
  readdir,
  mkdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorRepository as PagesStore } from "../../portable/editor-host/src/store.ts";

describe("original Page Builder storage through the Buzz adapter", () => {
  let root;
  let store;
  const workspaceId = "test-community";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "buzz-pages-"));
    store = new PagesStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const call = (operation, fields) =>
    store.call({ operation, input: { workspaceId, ...fields } });

  it("reads imported section media across workspaces without admitting traversal or linked files", async () => {
    const assets = join(root, "section-library", "library-assets", "imported");
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, "image.svg"), "<svg/>");
    const path = "library-assets/imported/image.svg";
    for (const workspaceId of ["first", "second"]) {
      const file = await store.call({
        operation: "readPageAsset",
        input: { workspaceId, path },
      });
      expect(Buffer.from(file.dataBase64, "base64").toString()).toBe("<svg/>");
    }
    await expect(
      call("readPageAsset", { path: "library-assets/../outside.svg" }),
    ).rejects.toThrow("project-relative");
    await symlink(join(assets, "image.svg"), join(assets, "linked.svg"));
    await expect(
      call("readPageAsset", { path: "library-assets/imported/linked.svg" }),
    ).rejects.toThrow("symbolic links");
    let page = await call("createPage", { title: "Shared section export" });
    page = await call("addPageSection", {
      pageId: page.id,
      expectedRevision: page.revision,
      title: "Shared image",
      templateId: "custom-html",
      label: "Library",
      html: `<section><img src="${path}"></section>`,
    });
    for (const format of ["html", "vercel", "shopify"]) {
      const exported = await call("exportPage", { pageId: page.id, format });
      if (format === "html")
        expect(await readFile(exported.path, "utf8")).toContain(
          "data:image/svg+xml;base64,",
        );
      else expect((await readdir(exported.path)).length).toBeGreaterThan(0);
    }
    const library = join(root, "section-library");
    await rename(library, `${library}-original`);
    await symlink(`${library}-original`, library);
    await expect(call("readPageAsset", { path })).rejects.toThrow(
      "symbolic links",
    );
    await expect(
      call("exportPage", { pageId: page.id, format: "html" }),
    ).rejects.toThrow("symbolic links");
  });

  it("saves, inserts, moves and removes original reusable sections without changing the independent page copy", async () => {
    const template = await call("saveReusableSection", {
      title: "Reusable hero",
      category: "Reusable",
      description: "Original section-library workflow",
      html: "<section><h1>Saved library copy</h1></section>",
    });
    const list = () =>
      store.call({ operation: "listReusableSections", input: workspaceId });
    expect(
      (await list()).find((section) => section.id === template.id)?.html,
    ).toBe(template.html);
    let page = await call("createPage", { title: "Library insertion" });
    page = await call("addPageSection", {
      pageId: page.id,
      expectedRevision: page.revision,
      title: template.title,
      templateId: "custom-html",
      label: "Library",
      html: template.html,
    });
    const inserted = page.sections[0];
    page = await call("updatePageSectionVariant", {
      pageId: page.id,
      expectedRevision: page.revision,
      sectionId: inserted.id,
      variantId: inserted.selectedVariantId,
      html: "<section><h1>Independent manual change</h1></section>",
    });
    expect(
      (await list()).find((section) => section.id === template.id)?.html,
    ).toBe(template.html);
    await call("moveReusableSection", {
      sectionId: template.id,
      category: "Problem Agitation",
    });
    expect(
      (await list()).find((section) => section.id === template.id)?.category,
    ).toBe("Problem Agitation");
    await expect(
      call("deleteReusableSection", {
        sectionId: template.id,
        confirmDelete: false,
      }),
    ).rejects.toThrow();
    await call("deleteReusableSection", {
      sectionId: template.id,
      confirmDelete: true,
    });
    expect(await list()).toEqual([]);
    expect(
      (await call("readPage", { pageId: page.id })).sections[0].variants[0]
        .html,
    ).toContain("Independent manual change");
  });

  it("persists original editable sections, variants, comments and exports across host restarts", async () => {
    let page = await call("createPage", { title: "Campaign" });
    page = await call("addPageSection", {
      pageId: page.id,
      expectedRevision: page.revision,
      title: "Hero",
      templateId: "custom-html",
      label: "Original",
      html: "<section><h1>Manual title</h1></section>",
    });
    const sectionId = page.sections[0].id;
    page = await call("addPageSectionVariant", {
      pageId: page.id,
      sectionId,
      expectedRevision: page.revision,
      label: "Alternative",
      html: "<section><h1>Refined title</h1></section>",
    });
    const variantId = page.sections[0].variants[1].id;
    page = await call("selectPageSectionVariant", {
      pageId: page.id,
      sectionId,
      variantId,
      expectedRevision: page.revision,
    });
    page = await call("addPageComment", {
      pageId: page.id,
      sectionId,
      variantId,
      expectedRevision: page.revision,
      elementIndex: 0,
      elementLabel: "Hero",
      body: "Keep the title editable",
    });
    store = new PagesStore(root);
    expect(await call("readPage", { pageId: page.id })).toEqual(page);
    expect(
      await store.call({ operation: "listPages", input: workspaceId }),
    ).toEqual([page]);
    const exported = await call("exportPage", {
      pageId: page.id,
      format: "html",
    });
    const file = await call("readExport", exported);
    const html = Buffer.from(file.content, "base64").toString("utf8");
    expect(html).toContain("Refined title");
    expect(page.comments[0].body).toBe("Keep the title editable");
    expect(page.sections[0].variants[0].html).toContain("Manual title");
  });

  it("rejects stale agent edits and preserves unrelated manual sections", async () => {
    let page = await call("createPage", { title: "Concurrent editing" });
    for (const title of ["Hero", "Proof"])
      page = await call("addPageSection", {
        pageId: page.id,
        expectedRevision: page.revision,
        title,
        templateId: "custom-html",
        label: "Original",
        html: `<section>${title}</section>`,
      });
    const agentRead = page;
    const hero = page.sections[0];
    page = await call("updatePageSectionVariant", {
      pageId: page.id,
      sectionId: hero.id,
      variantId: hero.selectedVariantId,
      expectedRevision: page.revision,
      html: "<section>Manual edit</section>",
    });
    const proof = agentRead.sections[1];
    await expect(
      call("updatePageSectionVariant", {
        pageId: page.id,
        sectionId: proof.id,
        variantId: proof.selectedVariantId,
        expectedRevision: agentRead.revision,
        html: "<section>Agent edit</section>",
      }),
    ).rejects.toThrow("Page changed in another editor");
    page = await call("readPage", { pageId: page.id });
    page = await call("updatePageSectionVariant", {
      pageId: page.id,
      sectionId: proof.id,
      variantId: proof.selectedVariantId,
      expectedRevision: page.revision,
      html: "<section>Agent edit</section>",
    });
    expect(page.sections[0].variants[0].html).toContain("Manual edit");
    expect(page.sections[1].variants[0].html).toContain("Agent edit");
  });

  it("keeps workspace documents separate and rejects malformed operations", async () => {
    const page = await call("createPage", { title: "Private campaign" });
    expect(
      await store.call({ operation: "listPages", input: "another-community" }),
    ).toEqual([]);
    await expect(
      store.call({
        operation: "readPage",
        input: { workspaceId: "another-community", pageId: page.id },
      }),
    ).rejects.toThrow("was not found");
    await expect(
      call("deletePageSection", { pageId: "../escape", sectionId: page.id }),
    ).rejects.toThrow();
    await expect(call("runCommand", {})).rejects.toThrow(
      "Unknown editor operation",
    );
  });

  it("does not read files outside the export directory through a symlink", async () => {
    const page = await call("createPage", { title: "Export protection" });
    const exported = await call("exportPage", {
      pageId: page.id,
      format: "html",
    });
    const outside = join(root, "private.txt");
    await writeFile(outside, "not an export");
    const link = `${exported.path}.link`;
    await symlink(outside, link);
    await expect(call("readExport", { path: link })).rejects.toThrow(
      "Export is outside this workspace",
    );
  });

  it("rejects a redirected export root before writing, reading or validating outside the workspace", async () => {
    const page = await call("createPage", { title: "Export root protection" });
    const exported = await call("exportPage", {
      pageId: page.id,
      format: "html",
    });
    const directory = dirname(exported.path);
    const outside = join(root, "outside-exports");
    await rename(directory, outside);
    await symlink(outside, directory);
    await expect(
      call("readExport", { path: join(outside, basename(exported.path)) }),
    ).rejects.toThrow("exports must not be a symbolic link");
    await expect(
      call("exportPage", { pageId: page.id, format: "json" }),
    ).rejects.toThrow("exports must not be a symbolic link");
    await expect(
      call("validateShopifyExport", { directory: "exports" }),
    ).rejects.toThrow("exports must not be a symbolic link");
    expect(await readdir(outside)).toEqual([basename(exported.path)]);
  });
});
