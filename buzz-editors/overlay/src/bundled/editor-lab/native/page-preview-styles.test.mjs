import { expect, it, vi } from "vitest";
import postcss from "postcss";
import {
  compilePreviewStyles,
  resolvePreviewStyleUrls,
  resolvePreviewDeclarationUrls,
} from "../../../../portable/copyos-apps/src/PagePreviewStyles.ts";

it("retains SVG fragment targets when rebasing CSS and replacing private resource URLs", async () => {
  const compiled = await compilePreviewStyles(
    '.hero{filter:url("../image.svg#shadow")}',
    "styles/theme.css",
    async () => {
      throw new Error("No imports");
    },
  );
  expect(compiled.errors).toEqual([]);
  expect(compiled.css).toContain("/image.svg#shadow");
  const urls = new Map([["image.svg", "blob:workspace-image"]]);
  expect(resolvePreviewStyleUrls(compiled.css, urls)).toContain(
    "blob:workspace-image#shadow",
  );
  expect(
    resolvePreviewDeclarationUrls("filter:url(image.svg#shadow)", urls),
  ).toContain("blob:workspace-image#shadow");
});

it("preserves nested import order and layer, support and media conditions while rebasing each file independently", async () => {
  const files = new Map([
    [
      "styles/tokens/base.css",
      '@import "../palette.css";.inner{background:url("../../images/card\\20 frame.svg")}',
    ],
    ["styles/palette.css", ".inner{color:red}"],
  ]);
  const read = vi.fn(async (path) => {
    if (!files.has(path)) throw new Error("Missing CSS");
    return files.get(path);
  });
  const result = await compilePreviewStyles(
    '@import "tokens/base.css" layer(theme) supports(display: grid) screen and (min-width:600px);.hero{background:url("../hero.svg");color:blue}',
    "styles/root.css",
    read,
  );
  expect(result.errors).toEqual([]);
  expect(result.resources).toEqual(
    expect.arrayContaining([
      "styles/tokens/base.css",
      "styles/palette.css",
      "images/card frame.svg",
      "hero.svg",
    ]),
  );
  const root = postcss.parse(result.css);
  expect(root.first.name).toBe("layer");
  expect(root.first.params).toBe("theme");
  expect(root.first.first.name).toBe("supports");
  expect(root.first.first.params).toBe("(display: grid)");
  expect(root.first.first.first.name).toBe("media");
  expect(root.first.first.first.params).toBe("screen and (min-width:600px)");
  expect(result.css.indexOf("color:red")).toBeLessThan(
    result.css.indexOf("color:blue"),
  );
  expect(result.css).toContain('url("/images/card frame.svg")');
  const preview = resolvePreviewStyleUrls(
    result.css,
    new Map([
      ["images/card frame.svg", "blob:card"],
      ["hero.svg", "blob:hero"],
    ]),
  );
  expect(preview).toContain('url("blob:card")');
  expect(preview).toContain('url("blob:hero")');
});

it("keeps repeated imports under their own media conditions and cuts cycles without discarding unrelated rules", async () => {
  const read = async (path) => {
    if (path === "a.css") return '@import "b.css";.a{color:red}';
    if (path === "b.css") return '@import "a.css";.b{color:blue}';
    throw new Error("Missing CSS");
  };
  const result = await compilePreviewStyles(
    '@import "a.css" screen;@import url("a.css") print;.manual{color:green}',
    "",
    read,
  );
  expect(result.css).toContain("@media screen");
  expect(result.css).toContain("@media print");
  expect(result.css).toContain(".manual{color:green}");
  expect(result.errors).toEqual([
    "a.css: circular CSS import",
    "a.css: circular CSS import",
  ]);
  expect(result.css).not.toContain("@import");
});

it("reports missing and malformed imports while retaining the remaining authored CSS", async () => {
  const result = await compilePreviewStyles(
    '@import "missing.css";.manual{display:grid}',
    "",
    async () => {
      throw new Error("Not available");
    },
  );
  expect(result.css).toContain(".manual{display:grid}");
  expect(result.errors.join(" ")).toContain("Not available");
  const invalid = await compilePreviewStyles(
    "h1 { color:",
    "broken.css",
    async () => "",
  );
  expect(invalid.errors.join(" ")).toContain("broken.css");
  expect(invalid.css).toBe("");
});

it("does not fetch external imports and preserves data and fragment references", async () => {
  const read = vi.fn();
  const result = await compilePreviewStyles(
    '@import "https://example.com/site.css";.icon{filter:url(#filter);background:url(data:image/svg+xml;base64,AA==)}',
    "site.css",
    read,
  );
  expect(read).not.toHaveBeenCalled();
  expect(result.css).toContain('@import "https://example.com/site.css"');
  expect(result.css).toContain("url(#filter)");
  expect(result.css).toContain("url(data:image/svg+xml;base64,AA==)");
});

it("refuses imports and image references that escape the isolated project", async () => {
  const read = vi.fn();
  const result = await compilePreviewStyles(
    '@import "../outside.css";.image{background:url("../outside.svg")}',
    "",
    read,
  );
  expect(read).not.toHaveBeenCalled();
  expect(result.css).not.toContain("@import");
  expect(result.css).not.toContain('url("../outside.svg")');
  expect(result.errors).toEqual([
    "../outside.css: CSS import leaves the project",
    "../outside.svg: CSS resource leaves the project",
  ]);
});

it("resolves quoted parentheses and escaped quote characters as filenames rather than truncating URL tokens", async () => {
  const result = await compilePreviewStyles(
    '.a{background:url("card (one).svg")}.b{background:url("quoted\\".svg")}',
    "assets/site.css",
    async () => "",
  );
  expect(result.resources).toContain("assets/card (one).svg");
  expect(result.resources).toContain('assets/quoted".svg');
  const preview = resolvePreviewStyleUrls(
    result.css,
    new Map([
      ["assets/card (one).svg", "blob:one"],
      ['assets/quoted".svg', "blob:two"],
    ]),
  );
  expect(preview).toContain('url("blob:one")');
  expect(preview).toContain('url("blob:two")');
});
