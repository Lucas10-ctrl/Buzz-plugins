import { expect, it, vi } from "vitest";
import {
  extractPreviewFonts,
  installPreviewFonts,
} from "../../../../portable/copyos-apps/src/PagePreviewFonts.ts";

function extract(css, blobs = new Map()) {
  let sequence = 0;
  return extractPreviewFonts(
    css,
    (path) => blobs.get(path),
    () => String(++sequence),
  );
}

function platform(load = async (face) => face) {
  const registered = new Set();
  const created = [];
  class Face {
    sizeAdjust = "100%";
    constructor(family, source, descriptors) {
      Object.assign(this, { family, source, descriptors });
      created.push(this);
    }
    load() {
      return load(this);
    }
  }
  return {
    registered,
    created,
    document: {
      fonts: {
        add: (face) => registered.add(face),
        delete: (face) => registered.delete(face),
      },
      defaultView: {
        FontFace: Face,
        matchMedia: () => ({ matches: true }),
        CSS: { supports: () => true },
      },
    },
  };
}

it("retains authored font rules, variable descriptors and enclosing conditions", async () => {
  const blob = new Blob(["font"]);
  const result = extract(
    '@media screen{@supports(display:grid){@font-face{font-family:"Project";src:local("Project"),url("assets/font.woff2") format("woff2");font-weight:100 900;font-style:oblique 0deg 12deg;unicode-range:U+20-7F;font-display:swap;size-adjust:110%}}}',
    new Map([["assets/font.woff2", blob]]),
  );
  expect(result.errors).toEqual([]);
  expect(result.css).toContain("/* buzz-preview-font:1 */");
  const face = result.faces.get("1");
  expect(face.family).toBe("Project");
  expect(face.descriptors).toMatchObject({
    weight: "100 900",
    style: "oblique 0deg 12deg",
    unicodeRange: "U+20-7F",
    display: "swap",
  });
  expect(face.sizeAdjust).toBe("110%");
  expect(face.conditions).toEqual([
    { kind: "media", value: "screen" },
    { kind: "supports", value: "(display:grid)" },
  ]);
  expect(face.sources).toEqual([
    { kind: "css", value: 'local("Project")' },
    { kind: "bytes", blob },
  ]);
  expect(face.css).toContain('url("assets/font.woff2")');
});

it("tries source fallbacks and removes failed faces while keeping successful faces until cancellation", async () => {
  const result = extract(
    '@font-face{font-family:Project;src:local("absent"),url("font.woff2")}',
    new Map([["font.woff2", new Blob(["bytes"])]]),
  );
  const host = platform(async (face) => {
    expect(host.registered.has(face)).toBe(true);
    if (typeof face.source === "string")
      throw new Error("Local font unavailable");
    return face;
  });
  const controller = new AbortController();
  expect(
    await installPreviewFonts(
      host.document,
      [...result.faces.values()],
      controller.signal,
    ),
  ).toEqual([]);
  expect(host.created).toHaveLength(2);
  expect([...host.registered]).toEqual([host.created[1]]);
  controller.abort();
  expect(host.registered.size).toBe(0);
});

it("cancellation removes a pending face and never registers it again after load resolves", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const host = platform(() => pending);
  const controller = new AbortController();
  const result = extract(
    '@font-face{font-family:Project;src:local("Project")}',
  );
  const loading = installPreviewFonts(
    host.document,
    [...result.faces.values()],
    controller.signal,
  );
  const unrelated = {};
  host.registered.add(unrelated);
  expect(host.created).toHaveLength(1);
  controller.abort();
  expect([...host.registered]).toEqual([unrelated]);
  resolve(host.created[0]);
  expect(await loading).toEqual([]);
  expect([...host.registered]).toEqual([unrelated]);
});

it("skips inactive conditions and reports missing sources without creating a face", async () => {
  const result = extract(
    "@media print{@font-face{font-family:Print;src:url(missing.woff2)}}@font-face{font-family:Missing;src:url(absent.woff2)}",
  );
  const host = platform();
  host.document.defaultView.matchMedia = vi.fn(() => ({ matches: false }));
  expect(
    await installPreviewFonts(
      host.document,
      [...result.faces.values()],
      new AbortController().signal,
    ),
  ).toEqual(["Missing: Missing font asset: absent.woff2"]);
  expect(host.created).toEqual([]);
});

it("decodes embedded binary font sources without creating a network URL", async () => {
  const result = extract(
    '@font-face{font-family:Embedded;src:url("data:font/woff2;base64,AAEC/w==")}',
  );
  const host = platform();
  const controller = new AbortController();
  expect(
    await installPreviewFonts(
      host.document,
      [...result.faces.values()],
      controller.signal,
    ),
  ).toEqual([]);
  expect([...new Uint8Array(host.created[0].source)]).toEqual([0, 1, 2, 255]);
  controller.abort();
});
