// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePagePreviewFonts } from "../../../../portable/copyos-apps/src/usePagePreviewFonts.ts";

it("loads only the current frame markers, follows media changes and cleans up listeners and owned faces", async () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const frameDocument = iframe.contentDocument;
  frameDocument.head.innerHTML =
    "<style>@media screen{/* buzz-preview-font:1 */}</style>";
  Object.defineProperty(frameDocument, "readyState", {
    value: "complete",
    configurable: true,
  });
  const fonts = new Set();
  Object.defineProperty(frameDocument, "fonts", { value: fonts });
  let matches = true;
  const listeners = new Set();
  const query = {
    get matches() {
      return matches;
    },
    addEventListener: (_type, callback) => listeners.add(callback),
    removeEventListener: (_type, callback) => listeners.delete(callback),
  };
  frameDocument.defaultView.matchMedia = () => query;
  const created = [];
  frameDocument.defaultView.FontFace = class {
    constructor(family) {
      this.family = family;
      created.push(this);
    }
    async load() {
      return this;
    }
  };
  const face = (family) => ({
    family,
    descriptors: {},
    sources: [{ kind: "css", value: 'local("Project")' }],
    conditions: [{ kind: "media", value: "screen" }],
  });
  const assets = {
    fontFaces: new Map([
      ["1", face("Used")],
      ["2", face("Unrelated library font")],
    ]),
  };
  const report = vi.fn();
  const { unmount } = renderHook(() =>
    usePagePreviewFonts({ current: iframe }, assets, report),
  );
  try {
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(expect.any(String), []),
    );
    expect(created.map((item) => item.family)).toEqual(["Used"]);
    expect(fonts.size).toBe(1);
    act(() => {
      matches = false;
      for (const listener of [...listeners]) listener();
    });
    await waitFor(() => expect(fonts.size).toBe(0));
    expect(created).toHaveLength(1);
    act(() => {
      matches = true;
      for (const listener of [...listeners]) listener();
    });
    await waitFor(() => expect(created).toHaveLength(2));
    expect(fonts.size).toBe(1);
  } finally {
    unmount();
    iframe.remove();
  }
  expect(fonts.size).toBe(0);
  expect(listeners.size).toBe(0);
});
