// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DesignerReviewOverlay,
  DesignerCommentsPanel,
} from "../../../../portable/copyos-apps/src/client/DesignerReview.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";
const wrapper = ({ children }) =>
  createElement(EditorChromeProvider, { value: nativeEditorChrome }, children);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses native fields/actions for the original canvas comment target and retains a refused draft", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  let finish;
  const add = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const send = vi.fn(() => false);
  const view = render(
    createElement(DesignerReviewOverlay, {
      t: (key) => en[key],
      view: { x: 10, y: 20, zoom: 2 },
      mode: "comment",
      byId: new Map(),
      pageId: "page",
      comments: [],
      selectedComment: null,
      onSelectComment: vi.fn(),
      onAddComment: add,
      onSendComment: send,
      onMark: vi.fn(),
      onCancel: vi.fn(),
      onWheel: vi.fn(),
    }),
    { wrapper },
  );
  fireEvent.pointerDown(view.container.querySelector("[data-review-mode]"), {
    button: 0,
    clientX: 70,
    clientY: 100,
  });
  const field = screen.getByRole("textbox", {
    name: en.designerCommentPlaceholder,
  });
  expect(field).toHaveAttribute("data-buzz-ui");
  await waitFor(() => expect(field).toHaveFocus());
  fireEvent.change(field, { target: { value: "Keep this comment" } });
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true, isComposing: true });
  expect(add).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: en.commentsAdd });
  expect(button).toHaveAttribute("data-buzz-ui");
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  expect(add).toHaveBeenCalledExactlyOnceWith(
    { kind: "point", pageId: "page", x: 30, y: 40 },
    "Keep this comment",
  );
  expect(field).toBeDisabled();
  await act(async () => finish(false));
  expect(field).toHaveValue("Keep this comment");
  expect(field).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: en.designerSendToChat }));
  expect(send).toHaveBeenCalledExactlyOnceWith(
    { kind: "point", pageId: "page", x: 30, y: 40 },
    "Keep this comment",
  );
  await waitFor(() => expect(field).toBeEnabled());
  expect(field).toHaveValue("Keep this comment");
  fireEvent.click(button);
  await act(async () => finish(true));
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("keeps original comment identities for native resolve/reopen/delete actions", () => {
  const comment = {
    id: "comment",
    body: "Original note",
    status: "open",
    createdAt: "2026-11-01T12:00:00Z",
    target: { kind: "point", pageId: "page", x: 30, y: 40 },
  };
  const status = vi.fn(),
    remove = vi.fn();
  const props = {
    t: (key) => en[key],
    comments: [comment],
    selected: comment.id,
    error: null,
    onSelect: vi.fn(),
    onStatus: status,
    onDelete: remove,
    onPlace: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(createElement(DesignerCommentsPanel, props), { wrapper });
  const resolve = screen.getByRole("button", { name: en.commentsResolve });
  expect(resolve).toHaveAttribute("data-buzz-ui");
  fireEvent.click(resolve);
  expect(status).toHaveBeenCalledExactlyOnceWith(comment, "resolved");
  const resolved = { ...comment, status: "resolved" };
  view.rerender(
    createElement(DesignerCommentsPanel, { ...props, comments: [resolved] }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.commentsReopen }));
  expect(status).toHaveBeenLastCalledWith(resolved, "open");
  const deletion = screen.getByRole("button", {
    name: en.designerDeleteComment,
  });
  expect(deletion).toHaveAttribute("data-buzz-ui");
  fireEvent.click(deletion);
  expect(remove).toHaveBeenCalledExactlyOnceWith(resolved);
});
