// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { PagePreviewAssets } from "../../../../portable/copyos-apps/src/PagePreviewAssets.ts";
import {
  buildPreviewDocument,
  restoreProjectAssetUrls,
  rewriteCssAssetUrls,
} from "../../../../portable/copyos-apps/src/client/LandingPageVisualWorkspace.tsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.stubGlobal("Blob", NodeBlob);
  const create = vi.fn(() => `blob:buzz-asset-${crypto.randomUUID()}`);
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const files = new Map([
    [
      "assets/site.css",
      {
        mimeType: "text/css",
        text: '.hero{background-image:url("../images/日本語%20café.svg")}',
      },
    ],
    [
      "images/日本語 café.svg",
      {
        mimeType: "image/svg+xml",
        text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
    ],
    ["images/second.png", { mimeType: "image/png", text: "PNG fixture" }],
  ]);
  const read = vi.fn(async (path, knownVersion) => {
    const file = files.get(path);
    if (!file) throw new Error("Missing asset");
    if (knownVersion === file.text)
      return { path, version: file.text, unchanged: true };
    return {
      path,
      version: file.text,
      unchanged: false,
      mimeType: file.mimeType,
      dataBase64: Buffer.from(file.text).toString("base64"),
    };
  });
  const session = new PagePreviewAssets(read);
  return { session, read, files, create, revoke };
}

it("loads binary fonts from scoped CSS and restores authored inline declarations before persistence", async () => {
  const { files, session: cache } = fixture();
  files.set("assets/font.woff2", {
    mimeType: "font/woff2",
    text: "font fixture",
  });
  const authored =
    '@font-face{font-family:"Project Font";src:url("assets/font.woff2");font-weight:100 900}.hero{font-family:"Project Font"}';
  const html = `<style>${authored}</style><h1 class="hero">Original text</h1>`;
  const view = await cache.prepare([html]);
  try {
    expect(view.errors).toEqual([]);
    expect(view.fontFaces.size).toBe(1);
    const face = [...view.fontFaces.values()][0];
    expect(face.family).toBe("Project Font");
    expect(face.sources[0].kind).toBe("bytes");
    expect(await face.sources[0].blob.text()).toBe("font fixture");
    const preview = buildPreviewDocument(html, undefined, "", view);
    expect(preview).toContain("buzz-preview-font:1");
    const saved = restoreProjectAssetUrls(
      preview.replace("Original text", "Manual edit"),
      undefined,
      view,
    );
    expect(saved).toContain(`<style>${authored}</style>`);
    expect(saved).toContain("Manual edit");
    expect(saved).not.toContain("buzz-preview-font:");
    expect(saved).not.toContain("blob:");
  } finally {
    view.release();
    cache.dispose();
  }
});

it("uses private host resources for original image/srcset/SVG/CSS previews and restores portable paths before saving", async () => {
  const h = fixture();
  const html =
    '<link rel="stylesheet" href="assets/site.css"><section class="hero"><img src="images/日本語%20café.svg?v=1" srcset="images/second.png 2x"><svg><image href="/images/second.png"/></svg><p>Editable</p></section>';
  try {
    const view = await h.session.prepare([html]);
    expect(view.errors).toEqual([]);
    const css = rewriteCssAssetUrls(
      view.stylesheets.get("assets/site.css"),
      "",
      "assets/site.css",
      view,
    );
    const preview = buildPreviewDocument(html, undefined, css, view);
    expect(preview).not.toContain("/api/file");
    expect(preview).not.toContain('href="assets/site.css"');
    expect(preview).toContain(
      `src="${view.urls.get("images/日本語%20café.svg")}"`,
    );
    expect(preview).toContain(
      `srcset="${view.urls.get("images/second.png")} 2x"`,
    );
    expect(preview).toContain(`href="${view.urls.get("images/second.png")}"`);
    expect(css).toContain(view.urls.get("images/日本語%20café.svg"));
    const stored = restoreProjectAssetUrls(preview, undefined, view);
    expect(stored).not.toContain("blob:");
    expect(stored).toContain('src="images/日本語%20café.svg"');
    expect(stored).toContain('url("images/日本語%20café.svg")');
    const count = h.read.mock.calls.length;
    const next = await h.session.prepare([html, html]);
    expect(next.revision).toBe(view.revision);
    expect(h.read).toHaveBeenCalledTimes(count);
  } finally {
    h.session.dispose();
  }
  expect(h.revoke).toHaveBeenCalledTimes(h.create.mock.calls.length);
});

it("preserves external/data references and reports missing local resources without hiding successful ones", async () => {
  const h = fixture();
  try {
    const html =
      '<img src="https://example.com/public.png"><img src="data:image/png;base64,AA=="><img src="missing.png"><img src="images/second.png">';
    const view = await h.session.prepare([html]);
    expect(h.read.mock.calls.map(([path]) => path)).toEqual([
      "missing.png",
      "images/second.png",
    ]);
    expect(view.errors).toEqual(["missing.png: Missing asset"]);
    expect(buildPreviewDocument(html, undefined, "", view)).toContain(
      'src="https://example.com/public.png"',
    );
    expect(buildPreviewDocument(html, undefined, "", view)).toContain(
      'src="data:image/png;base64,AA=="',
    );
    expect(view.urls.has("images/second.png")).toBe(true);
    h.files.set("missing.png", {
      mimeType: "image/png",
      text: "Now available",
    });
    expect((await h.session.prepare([html])).errors).toEqual([]);
  } finally {
    h.session.dispose();
  }
});

it("uses the stylesheet link's role for extensionless CSS resources", async () => {
  const h = fixture();
  h.files.set("styles", {
    mimeType: "application/octet-stream",
    text: "h1{color:green}",
  });
  try {
    expect(
      (
        await h.session.prepare(['<link rel="stylesheet" href="styles">'])
      ).stylesheets.get("styles"),
    ).toBe("h1{color:green}");
  } finally {
    h.session.dispose();
  }
});

it("renders inline local imports privately and restores the authored import before saving edited HTML", async () => {
  const h = fixture();
  const css = '@import "assets/site.css";.local{color:blue}';
  const html = `<style>${css}</style><section class="hero"><h1>Manual edit</h1><p>url(not-a-resource.png)</p></section>`;
  try {
    const view = await h.session.prepare([html]);
    expect(view.errors).toEqual([]);
    const preview = buildPreviewDocument(html, undefined, "", view);
    expect(preview).not.toContain("@import");
    expect(preview).toContain(".hero");
    expect(preview).toContain("blob:");
    const saved = restoreProjectAssetUrls(preview, undefined, view);
    expect(saved).toContain(`<style>${css}</style>`);
    expect(saved).toContain("<h1>Manual edit</h1>");
    expect(saved).not.toContain("blob:");
    expect(
      h.read.mock.calls.some(([path]) => path === "not-a-resource.png"),
    ).toBe(false);
    view.release();
  } finally {
    h.session.dispose();
  }
});

it("fences reads that complete after the editor closes and never creates a late object URL", async () => {
  const h = fixture();
  let release;
  const delayed = new PagePreviewAssets(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const result = delayed.prepare(['<img src="images/second.png">']);
  delayed.dispose();
  release({
    path: "images/second.png",
    version: "late",
    unchanged: false,
    mimeType: "image/png",
    dataBase64: "AA==",
  });
  const view = await result;
  expect(view.urls.size).toBe(0);
  expect(view.errors).toEqual([
    "images/second.png: Preview assets have closed",
  ]);
  expect(h.create).not.toHaveBeenCalled();
  h.session.dispose();
});

it("revalidates changed files while retaining old URLs until their rendered frames release them", async () => {
  const h = fixture();
  try {
    const html = '<img src="images/second.png">';
    const first = await h.session.prepare([html]);
    const oldUrl = first.urls.get("images/second.png");
    const leaveFrame = first.retain();
    first.release();
    h.files.set("images/second.png", {
      mimeType: "image/png",
      text: "New image content",
    });
    const next = await h.session.prepare([html], true);
    expect(next.urls.get("images/second.png")).not.toBe(oldUrl);
    expect(h.revoke).not.toHaveBeenCalledWith(oldUrl);
    leaveFrame();
    expect(h.revoke).toHaveBeenCalledWith(oldUrl);
    const unchanged = await h.session.prepare([html], true);
    expect(unchanged.revision).toBe(next.revision);
    expect(unchanged.urls.get("images/second.png")).toBe(
      next.urls.get("images/second.png"),
    );
    expect(h.create).toHaveBeenCalledTimes(2);
    next.release();
    unchanged.release();
  } finally {
    h.session.dispose();
  }
  expect(h.revoke).toHaveBeenCalledTimes(2);
});

it("fences an older refresh and keeps the current pending read available for deduplication", async () => {
  const h = fixture();
  const requests = [];
  const read = vi.fn(() => new Promise((resolve) => requests.push(resolve)));
  const session = new PagePreviewAssets(read);
  try {
    const html = '<img src="image.png">';
    const old = session.prepare([html], true);
    const current = session.prepare([html], true);
    requests[0]({
      path: "image.png",
      version: "old",
      unchanged: false,
      mimeType: "image/png",
      dataBase64: "AA==",
    });
    const oldView = await old;
    expect(oldView.errors).toEqual([
      "image.png: Preview asset refresh was superseded",
    ]);
    const shared = session.prepare([html]);
    expect(read).toHaveBeenCalledTimes(2);
    requests[1]({
      path: "image.png",
      version: "new",
      unchanged: false,
      mimeType: "image/png",
      dataBase64: "AQ==",
    });
    const [newView, sharedView] = await Promise.all([current, shared]);
    expect(newView.urls.get("image.png")).toBe(
      sharedView.urls.get("image.png"),
    );
    expect(h.create).toHaveBeenCalledTimes(1);
    oldView.release();
    newView.release();
    sharedView.release();
  } finally {
    session.dispose();
    h.session.dispose();
  }
});

it("releases resources removed from the active page once the previous frame leaves", async () => {
  const h = fixture();
  try {
    const previous = await h.session.prepare(['<img src="images/second.png">']);
    const url = previous.urls.get("images/second.png");
    const leave = previous.retain();
    previous.release();
    const empty = await h.session.prepare([]);
    expect(empty.urls.size).toBe(0);
    expect(h.revoke).not.toHaveBeenCalledWith(url);
    leave();
    expect(h.revoke).toHaveBeenCalledWith(url);
    empty.release();
  } finally {
    h.session.dispose();
  }
  expect(h.revoke).toHaveBeenCalledTimes(1);
});
