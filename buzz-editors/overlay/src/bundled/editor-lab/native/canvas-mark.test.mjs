// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageDesignerWorkspace } from "../../../../portable/copyos-apps/src/client/PageDesignerWorkspace.tsx";
import { createDesignNode } from "../../../../portable/copyos-domain/src/design-model.ts";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
const captured = vi.hoisted(() => ({ review: undefined, raster: vi.fn() }));
vi.mock(
  "../../../../portable/copyos-apps/src/client/DesignerRasterExport.ts",
  () => ({ rasterizeDesignArtboard: captured.raster }),
);
vi.mock(
  "../../../../portable/copyos-apps/src/client/DesignerReview.tsx",
  async (original) => ({
    ...(await original()),
    DesignerReviewOverlay: (props) => {
      captured.review = props;
      return null;
    },
  }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  captured.raster.mockReset();
  captured.review = undefined;
});
function fixture() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const frame = {
    ...createDesignNode("frame", "frame", "Hero"),
    x: 100,
    y: 200,
    width: 400,
    height: 300,
  };
  const document = {
    schema: "copyos.design",
    version: 1,
    id: "design",
    title: "Original design",
    revision: 7,
    nodes: [frame],
    variables: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const mention = vi.fn(() => true),
    attach = vi.fn(() => null);
  const view = render(
    createElement(PageDesignerWorkspace, {
      workspaceId: `mark-${crypto.randomUUID()}`,
      t: (key) => en[key],
      actions: { listDesigns: async () => [document] },
      draftStore: {
        read: async () => null,
        clear: async () => {},
        write: async () => {},
      },
      onMentionSelection: mention,
      onAttachPicture: attach,
    }),
  );
  return { view, document, mention, attach };
}
it("retains the original crop, filename, structured note and attachment refusal", async () => {
  const h = fixture();
  await waitFor(() => expect(captured.review).toBeTruthy());
  const png = new Blob(["cropped png"], { type: "image/png" });
  captured.raster.mockResolvedValue({ blob: png });
  const region = { x: 130, y: 240, width: 80, height: 60 };
  await act(async () =>
    expect(
      await captured.review.onMark(
        region,
        "Refine this",
        new AbortController().signal,
      ),
    ).toBe(true),
  );
  expect(captured.raster).toHaveBeenCalledWith(
    h.document,
    "frame",
    expect.objectContaining({
      format: "png",
      scale: 2,
      region: { x: 30, y: 40, width: 80, height: 60 },
    }),
  );
  expect(h.attach).toHaveBeenCalledTimes(1);
  const file = h.attach.mock.calls[0][0];
  expect(file.name).toBe("Hero mark.png");
  expect(file.type).toBe("image/png");
  expect(file.size).toBe(png.size);
  expect(h.mention.mock.calls[0][0]).toContain('"revision":7');
  expect(h.mention.mock.calls[0][0]).toContain('"picture_attached":true');
  expect(h.mention.mock.calls[0][0]).toContain("\nRefine this\n");
  h.attach.mockReturnValue("Uploads unavailable");
  await act(async () =>
    captured.review.onMark(
      region,
      "Keep the note",
      new AbortController().signal,
    ),
  );
  expect(h.mention.mock.calls[1][0]).toContain('"picture_attached":false');
});
it.each(["complete", "reject"])(
  "discards a cancelled crop that later %s before either native draft command",
  async (result) => {
    const h = fixture();
    await waitFor(() => expect(captured.review).toBeTruthy());
    let finish, fail;
    captured.raster.mockReturnValue(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const controller = new AbortController();
    const pending = captured.review.onMark(
      { x: 130, y: 240, width: 80, height: 60 },
      "Cancelled",
      controller.signal,
    );
    controller.abort();
    await act(async () => {
      if (result === "reject") fail(new Error("Cancelled raster failed"));
      else finish({ blob: new Blob(["crop"], { type: "image/png" }) });
      expect(await pending).toBe(false);
    });
    expect(h.attach).not.toHaveBeenCalled();
    expect(h.mention).not.toHaveBeenCalled();
  },
);
