import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, basename, dirname, relative } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";
import { CopyOSPageRepository } from "../../portable/copyos-domain/src/pages.ts";
let root, store, projectRoot;
const call = (operation, input = {}) =>
  store.call({ operation, input: { workspaceId: "export-test", ...input } });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVIAAAAASUVORK5CYII=",
  "base64",
);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-project-export-"));
  store = new EditorRepository(root);
  ({ projectRoot } = await call("getPageWorkspace"));
});
afterEach(async () => {
  await store.dispose();
  await rm(root, { recursive: true, force: true });
});
async function file(path, content) {
  const destination = join(projectRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
async function page(html) {
  const result = await call("createPage", { title: "Portable project" });
  return call("addPageSection", {
    pageId: result.id,
    title: "Hero",
    label: "Selected",
    templateId: "custom-html",
    html,
  });
}
async function files(directory) {
  const result = {};
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else result[relative(directory, child)] = await readFile(child);
    }
  }
  await visit(directory);
  return result;
}
it.each(["vercel", "shopify"])(
  "retains the original %s formatter's output for managed-image pages",
  async (format) => {
    const image = await call("putDesignImage", {
      dataBase64: png.toString("base64"),
    });
    const saved = await page(
      `<h1>Original markup</h1><img src="${image.url}">`,
    );
    const original = new CopyOSPageRepository();
    const baseline =
      format === "vercel"
        ? await original.exportVercel(projectRoot, saved.id)
        : await original.exportShopify(projectRoot, saved.id);
    const expected = await files(baseline);
    const actual = await call("exportPage", { pageId: saved.id, format });
    expect(basename(actual.path)).toBe(basename(baseline));
    expect(await files(actual.path)).toEqual(expected);
    expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
    expect(await readdir(dirname(actual.path))).toEqual([
      basename(actual.path),
    ]);
  },
);
it.each(["vercel", "shopify"])(
  "carries ordinary local styles, fonts, images and selected content into %s",
  async (format) => {
    await file(
      "assets/site.css",
      '@import "nested/theme.css" layer(theme) screen;.hero{color:navy}',
    );
    await file(
      "assets/nested/theme.css",
      '@font-face{font-family:Project;src:url("../font.woff2")}.hero{background:url("../image.svg#dot")}',
    );
    await file("assets/font.woff2", Buffer.from([0, 1, 2, 255]));
    await file(
      "assets/image.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><circle id="dot" r="5"/></svg>',
    );
    let saved = await page(
      '<p>Unselected broken variation</p><img src="missing.png">',
    );
    saved = await call("addPageSectionVariant", {
      pageId: saved.id,
      sectionId: saved.sections[0].id,
      label: "Visible",
      html: '<link rel="stylesheet" href="assets/site.css"><h1 class="hero">Keep selected manual copy</h1><img src="assets/image.svg" srcset="assets/image.svg 1x, https://example.com/large.png 2x"><a href="/contact">Contact</a>',
    });
    const result = await call("exportPage", { pageId: saved.id, format });
    const exported = await files(result.path);
    const html = Object.entries(exported)
      .find(([name]) =>
        format === "vercel"
          ? name === "index.html"
          : name.startsWith("sections/"),
      )[1]
      .toString("utf8");
    expect(html).toContain("Keep selected manual copy");
    expect(html).not.toContain("Unselected broken");
    expect(html).toContain("data:text/css;base64,");
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).toContain("https://example.com/large.png");
    expect(html).toContain('href="/contact"');
    const css = Buffer.from(
      /data:text\/css;base64,([^"\s]+)/.exec(html)[1],
      "base64",
    ).toString("utf8");
    expect(css).toContain("data:font/woff2;base64,AAEC/w==");
    expect(css).toContain("@layer theme");
    expect(css).toContain("#dot");
    expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
    expect(
      Object.keys(exported).some((name) => name.startsWith("pages/")),
    ).toBe(false);
    expect(
      (await readdir(join(projectRoot, "exports"))).some((name) =>
        name.startsWith(".buzz-project-"),
      ),
    ).toBe(false);
  },
);
it.each(["vercel", "shopify"])(
  "preserves previous %s snapshots/manual changes and cleans up failed preparation",
  async (format) => {
    let saved = await page("<h1>First export</h1>");
    const first = await call("exportPage", { pageId: saved.id, format });
    await writeFile(join(first.path, "manual.txt"), "Keep manual export work");
    const before = await files(first.path);
    const second = await call("exportPage", { pageId: saved.id, format });
    expect(second.path).not.toBe(first.path);
    expect(await files(first.path)).toEqual(before);
    const entries = await readdir(join(projectRoot, "exports"));
    saved = await call("updatePageSectionVariant", {
      pageId: saved.id,
      sectionId: saved.sections[0].id,
      variantId: saved.sections[0].selectedVariantId,
      expectedRevision: saved.revision,
      html: '<img src="missing.png">',
    });
    await expect(
      call("exportPage", { pageId: saved.id, format }),
    ).rejects.toThrow();
    expect(await readdir(join(projectRoot, "exports"))).toEqual(entries);
    expect(await files(first.path)).toEqual(before);
    expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
  },
);
it("refuses linked assets and linked export directories before publishing a project", async () => {
  await file("private.svg", "<svg/>");
  await symlink(
    join(projectRoot, "private.svg"),
    join(projectRoot, "linked.svg"),
  );
  const saved = await page('<img src="linked.svg">');
  await expect(
    call("exportPage", { pageId: saved.id, format: "vercel" }),
  ).rejects.toThrow("symbolic");
  expect(await readdir(join(projectRoot, "exports"))).toEqual([]);
  await rm(join(projectRoot, "exports"), { recursive: true });
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(projectRoot, "exports"));
  await expect(
    call("exportPage", { pageId: saved.id, format: "shopify" }),
  ).rejects.toThrow("symbolic");
  expect(await readdir(outside)).toEqual([]);
});

it.each(["vercel", "shopify"])(
  "exports expanded %s resources without imposing the saved-page HTML limit",
  async (format) => {
    await file(
      "large.svg",
      `<svg xmlns="http://www.w3.org/2000/svg"><!--${" ".repeat(1_100_000)}--></svg>`,
    );
    const saved = await page('<h1>Small source page</h1><img src="large.svg">');
    const exported = await call("exportPage", { pageId: saved.id, format });
    const result = await files(exported.path);
    const html = Object.entries(result)
      .find(([name]) =>
        format === "vercel"
          ? name === "index.html"
          : name.startsWith("sections/"),
      )[1]
      .toString("utf8");
    expect(html.length).toBeGreaterThan(1_000_000);
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
  },
);

it.each(["vercel", "shopify"])(
  "normalizes managed image URL spellings for the original %s copier",
  async (format) => {
    const image = await call("putDesignImage", {
      dataBase64: png.toString("base64"),
    });
    const name = image.url.slice("copyos-asset:".length);
    const saved = await page(
      `<img src="./assets/images/${name}"><img src="/assets/images/${name}?v=1#detail">`,
    );
    const exported = await call("exportPage", { pageId: saved.id, format });
    const result = await files(exported.path);
    const html = Object.entries(result)
      .find(([name]) =>
        format === "vercel"
          ? name === "index.html"
          : name.startsWith("sections/"),
      )[1]
      .toString("utf8");
    const prefix = format === "vercel" ? "assets/images/" : "assets/";
    expect(result[`${prefix}${name}`]).toEqual(png);
    expect(html).not.toContain("./assets/images/");
    expect(html).not.toContain('src="/assets/images/');
    if (format === "shopify")
      expect(html).toContain(`{{ '${name}' | asset_url }}?v=1#detail`);
    else expect(html).toContain(`assets/images/${name}?v=1#detail`);
  },
);
it.each(["vercel", "shopify"])(
  "shares the first effective base URL across selected %s sections",
  async (format) => {
    let saved = await page(
      '<base href="https://cdn.example.test/"><h1>Remote base</h1>',
    );
    saved = await call("addPageSection", {
      pageId: saved.id,
      title: "Later section",
      label: "Original",
      templateId: "custom-html",
      html: '<base href="https://ignored.example.test/"><img src="hero.png"><link rel="stylesheet" href="theme.css">',
    });
    const exported = await call("exportPage", { pageId: saved.id, format });
    const result = await files(exported.path);
    const html = Object.entries(result)
      .filter(([name]) =>
        format === "vercel"
          ? name === "index.html"
          : name.startsWith("sections/"),
      )
      .map(([, bytes]) => bytes.toString("utf8"))
      .join("\n");
    expect(html).toContain('<base href="https://cdn.example.test/">');
    expect(html).toMatch(/<img\b[^>]*src="hero\.png"/u);
    expect(html).toContain('href="theme.css"');
    expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
  },
);
it("applies document-wide authored CSP to resource preparation in later sections", async () => {
  await file("image.svg", "<svg/>");
  let saved = await page(
    `<meta http-equiv="Content-Security-Policy" content="img-src 'self'"><h1>Policy</h1>`,
  );
  saved = await call("addPageSection", {
    pageId: saved.id,
    title: "Later section",
    label: "Original",
    templateId: "custom-html",
    html: '<img src="image.svg">',
  });
  await expect(
    call("exportPage", { pageId: saved.id, format: "vercel" }),
  ).rejects.toThrow("content security policy");
  expect(await readdir(join(projectRoot, "exports"))).toEqual([]);
});

it("keeps a managed-image project larger than one host file readable as separate export files", async () => {
  // The actual 50 MB threshold matters here: eleven individually valid stored-image files exceed it together.
  const names = [];
  for (let index = 0; index < 11; index++) {
    const bytes = Buffer.concat([png, Buffer.alloc(5_000_000, index)]);
    const name = `${createHash("sha256").update(bytes).digest("hex")}.png`;
    await file(`assets/images/${name}`, bytes);
    names.push(name);
  }
  const saved = await page(
    names.map((name) => `<img src="copyos-asset:${name}">`).join(""),
  );
  const exported = await call("exportPage", {
    pageId: saved.id,
    format: "vercel",
  });
  expect((await readdir(join(exported.path, "assets/images"))).sort()).toEqual(
    [...names].sort(),
  );
  const sample = await call("readExport", {
    path: join(exported.path, "assets/images", names[0]),
  });
  expect(Buffer.from(sample.content, "base64").length).toBe(
    png.length + 5_000_000,
  );
  expect(await call("readPage", { pageId: saved.id })).toEqual(saved);
});
