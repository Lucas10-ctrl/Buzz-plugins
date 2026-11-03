// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesignerReviewOverlay } from "../../../../portable/copyos-apps/src/client/DesignerReview.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { nativeEditorChrome } from "./editor-chrome.tsx";
const wrapper = ({ children }) =>
  createElement(EditorChromeProvider, { value: nativeEditorChrome }, children);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["escape", "mode", "page", "unmount"])(
  "retires pending original Mark work on %s",
  async (transition) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    let signal, complete;
    const mark = vi.fn((_region, _body, cancellation) => {
      signal = cancellation;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const props = {
      t: (key) => en[key],
      view: { x: 0, y: 0, zoom: 1 },
      mode: "mark",
      byId: new Map(),
      pageId: "page",
      comments: [],
      selectedComment: null,
      onSelectComment: () => {},
      onAddComment: async () => true,
      onMark: mark,
      onCancel: vi.fn(),
      onWheel: () => {},
    };
    const view = render(createElement(DesignerReviewOverlay, props), {
      reactStrictMode: true,
      wrapper,
    });
    const draw = () => {
      const surface = view.container.querySelector("[data-review-mode]");
      surface.setPointerCapture = () => {};
      fireEvent.pointerDown(surface, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(surface, { clientX: 90, clientY: 80 });
      fireEvent.pointerUp(surface);
    };
    draw();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "First mark" },
    });
    fireEvent.submit(screen.getByRole("textbox").closest("form"));
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole("textbox")).toBeDisabled();
    if (transition === "escape") {
      fireEvent.keyDown(window, { key: "Escape" });
      draw();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "New mark" },
      });
    } else if (transition === "mode")
      view.rerender(
        createElement(DesignerReviewOverlay, { ...props, mode: "comment" }),
      );
    else if (transition === "page")
      view.rerender(
        createElement(DesignerReviewOverlay, { ...props, pageId: "another" }),
      );
    else view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => complete(true));
    if (transition === "escape")
      expect(screen.getByRole("textbox")).toHaveValue("New mark");
    expect(mark).toHaveBeenCalledTimes(1);
  },
);
