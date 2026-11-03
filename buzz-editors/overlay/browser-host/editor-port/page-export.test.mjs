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
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { parseSrcset } from "srcset";
import { beforeEach, afterEach, expect, it } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";
import { embedPageResources } from "../../portable/editor-host/src/page-export.ts";

let root, repository, projectRoot;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-export-"));
  repository = new EditorRepository(root);
  ({ projectRoot } = await repository.call({
    operation: "getPageWorkspace",
    input: { workspaceId: "test" },
  }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const call = (operation, fields) =>
  repository.call({ operation, input: { workspaceId: "test", ...fields } });
async function file(path, content) {
  const location = join(projectRoot, path);
  await mkdir(join(location, ".."), { recursive: true });
  await writeFile(location, content);
}
function elements(html) {
  const result = [];
  const visit = (node) => {
    if ("tagName" in node) result.push(node);
    if ("content" in node) visit(node.content);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return result;
}
const attr = (element, name) =>
  element.attrs.find((item) => item.name === name)?.value;
const decode = (uri) =>
  Buffer.from(uri.slice(uri.indexOf(",") + 1).split("#")[0], "base64");

it("embeds nested conditional CSS, Unicode SVGs, variable fonts, srcset and inline backgrounds without rewriting unrelated markup", async () => {
  await file(
    "assets/site.css",
    '@import "nested/theme.css" layer(theme) supports(display:grid) screen;h1{color:blue}',
  );
  await file(
    "assets/nested/theme.css",
    '@font-face{font-family:"Project";src:url("../font.woff2");font-weight:100 900}.hero{background:url("../日本語%20café.svg#dot")}',
  );
  await file("assets/font.woff2", Buffer.from([0, 1, 2, 255]));
  await file(
    "assets/日本語 café.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><circle id="dot" r="5"/></svg>',
  );
  const authored =
    '<!-- Keep original -->\n<link rel="canonical" href="/landing"><link rel="stylesheet" media="screen" integrity="old" href="assets/site.css"><h1 class="hero">Keep all manual text</h1><img src="assets/日本語%20café.svg#dot" srcset="assets/日本語%20café.svg 1x, data:image/png;base64,AAAA 2x"><div style="background:url(assets/日本語%20café.svg)">Unrelated</div><script>const example="url(not-an-asset.png)";</script>';
  const html = await embedPageResources(projectRoot, authored);
  const nodes = elements(html);
  const link = nodes.find(
    (node) => node.tagName === "link" && attr(node, "rel") === "stylesheet",
  );
  const css = decode(attr(link, "href")).toString("utf8");
  expect(css).toContain("@layer theme");
  expect(css).toContain("@supports (display:grid)");
  expect(css).toContain("@media screen");
  expect(css).toContain("data:font/woff2;base64,AAEC/w==");
  expect(css).toContain("data:image/svg+xml;base64,");
  expect(css).toContain("#dot");
  expect(attr(link, "media")).toBe("screen");
  expect(attr(link, "integrity")).toBe(
    `sha384-${createHash("sha384").update(css).digest("base64")}`,
  );
  const image = nodes.find((node) => node.tagName === "img");
  expect(attr(image, "src")).toMatch(/^data:image\/svg\+xml;base64,.*#dot$/u);
  const candidates = parseSrcset(attr(image, "srcset"), { strict: true });
  expect(candidates[0].density).toBe(1);
  expect(candidates[0].url).toMatch(/^data:image\/svg\+xml;base64,/u);
  expect(candidates[1]).toEqual({
    url: "data:image/png;base64,AAAA",
    density: 2,
  });
  expect(html).toContain("<!-- Keep original -->");
  expect(html).toContain('<h1 class="hero">Keep all manual text</h1>');
  expect(html).toContain('<link rel="canonical" href="/landing">');
  expect(html).toContain(
    '<script>const example="url(not-an-asset.png)";</script>',
  );
});

it("publishes the original selected variation atomically and preserves the previous export on a missing asset", async () => {
  await file("image.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
  let page = await call("createPage", { title: "Portable" });
  page = await call("addPageSection", {
    pageId: page.id,
    title: "Hero",
    templateId: "custom-html",
    label: "Original",
    html: '<h1>First saved copy</h1><img src="image.svg">',
  });
  const first = await call("exportPage", { pageId: page.id, format: "html" });
  const original = await readFile(first.path, "utf8");
  expect(original).toContain("First saved copy");
  expect(original).toContain("data:image/svg+xml;base64,");
  page = await call("updatePageSectionVariant", {
    pageId: page.id,
    sectionId: page.sections[0].id,
    variantId: page.sections[0].selectedVariantId,
    expectedRevision: page.revision,
    html: '<h1>Unsatisfied export</h1><img src="missing.png">',
  });
  await expect(
    call("exportPage", { pageId: page.id, format: "html" }),
  ).rejects.toThrow();
  expect(await readFile(first.path, "utf8")).toBe(original);
  expect(await readdir(join(projectRoot, "exports"))).toEqual([
    "portable.html",
  ]);
  expect(
    (await call("readPage", { pageId: page.id })).sections[0].variants[0].html,
  ).toContain("missing.png");
});

it("retains external references without fetching and rejects local escapes, symlinks, missing imports and unsupported script bundles", async () => {
  const remote =
    '<img src="https://example.com/a.png"><link rel="stylesheet" href="https://example.com/site.css"><a href="/next">Next</a>';
  expect(await embedPageResources(projectRoot, remote)).toBe(remote);
  await file("assets/site.css", '@import "missing.css";');
  await file("private.svg", "<svg/>");
  await symlink(
    join(projectRoot, "private.svg"),
    join(projectRoot, "linked.svg"),
  );
  for (const html of [
    '<img src="../outside.png">',
    '<img src="linked.svg">',
    '<link rel="stylesheet" href="assets/site.css">',
    '<script src="app.js"></script>',
    '<base href="source/"><img src="local.svg">',
    '<img src="blob:expired">',
  ])
    await expect(embedPageResources(projectRoot, html)).rejects.toThrow();
});

it("preserves authored CSP without local embedding and keeps external-base resources external", async () => {
  const policy =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><h1>Original text</h1>';
  expect(await embedPageResources(projectRoot, policy)).toBe(policy);
  await expect(
    embedPageResources(projectRoot, `${policy}<img src="local.svg">`),
  ).rejects.toThrow("content security policy");
  const external =
    '<base href="https://example.com/site/"><link rel="stylesheet" href="style.css"><style>.hero{background:url(image.svg)}</style><img src="image.svg">';
  expect(await embedPageResources(projectRoot, external)).toBe(external);
});

it("embeds original Canvas-owned image references and preserves inline CSS import conditions", async () => {
  const name = `${"a".repeat(64)}.png`;
  await file(`assets/images/${name}`, Buffer.from([1, 2, 3]));
  await file(
    "theme.css",
    "@font-face{font-family:Fixture;src:url(font.woff2)}",
  );
  await file("font.woff2", Buffer.from([4, 5, 6]));
  const html = await embedPageResources(
    projectRoot,
    `<style>@import "theme.css" print;</style><img src="copyos-asset:${name}">`,
  );
  expect(html).toContain("@media print");
  expect(html).toContain("data:font/woff2;base64,BAUG");
  expect(html).toContain("data:image/png;base64,AQID");
  expect(html).not.toContain("copyos-asset:");
});
