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
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DocsCommentEditor } from "../../../../portable/copyos-apps/src/client/DocsCommentEditor.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import {
  readCommentEditDraft,
  saveCommentEditDraft,
} from "../../../../portable/copyos-apps/src/client/DocsCommentDrafts.ts";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { createEditorText } from "./editor-locale.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";

const t = createEditorText(en);
const prefix = "buzz-comment-form-validation";
const message = {
  id: "comment",
  text: "Original comment",
  canEdit: true,
  deleted: false,
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const view = (props) =>
  createElement(
    EditorChromeProvider,
    { value: nativeEditorChrome },
    createElement(DocsCommentEditor, {
      message,
      threadId: "thread",
      draftPrefix: prefix,
      t,
      ...props,
    }),
  );
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("recovers a native textarea draft, preserves it after save failure and retries with keyboard submission", async () => {
  const request = deferred();
  const apply = vi
    .fn()
    .mockImplementationOnce(() => request.promise)
    .mockResolvedValueOnce({});
  const close = vi.fn();
  let ui = render(view({ apply, close, focus: true }));
  let input = screen.getByRole("textbox", { name: en.docsEditComment });
  await waitFor(() => expect(input).toHaveFocus());
  expect(input).toHaveAttribute("data-buzz-ui");
  expect(input).toHaveAttribute("maxlength", "5000");
  fireEvent.change(input, { target: { value: "Recovered revision" } });
  ui.unmount();
  ui = render(view({ apply, close }));
  input = screen.getByRole("textbox", { name: en.docsEditComment });
  expect(input).toHaveValue("Recovered revision");
  await userEvent.click(
    screen.getByRole("button", { name: en.docsSaveComment }),
  );
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: en.docsCancel })).toBeDisabled();
  await act(async () => {
    request.reject(new Error("Save unavailable"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Save unavailable",
  );
  expect(input).toHaveValue("Recovered revision");
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(input);
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenLastCalledWith({
    type: "edit",
    threadId: "thread",
    messageId: "comment",
    text: "Recovered revision",
    expectedText: "Original comment",
    expectedEditedAt: null,
  });
  expect(readCommentEditDraft(prefix, "thread", "comment")).toBeNull();
});

it("requires reviewing a concurrent edit, retains the composition and returns focus to the native textarea", async () => {
  const apply = vi.fn(async () => ({})),
    close = vi.fn();
  const ui = render(view({ apply, close }));
  const input = screen.getByRole("textbox", { name: en.docsEditComment });
  fireEvent.change(input, { target: { value: "My revision" } });
  const updated = {
    ...message,
    text: "Another author's revision",
    editedAt: "2026-11-01T01:00:00Z",
  };
  ui.rerender(view({ apply, close, message: updated }));
  expect(
    screen.getByRole("button", { name: en.docsSaveComment }),
  ).toBeDisabled();
  expect(input).toHaveValue("My revision");
  await userEvent.click(
    screen.getByRole("button", { name: en.docsCommentReviewCurrent }),
  );
  expect(input).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: en.docsSaveComment }),
  );
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "My revision",
      expectedText: updated.text,
      expectedEditedAt: updated.editedAt,
    }),
  );
});

it("does not clear a newer composition saved by another pane while an earlier save is pending", async () => {
  const request = deferred(),
    apply = vi.fn(() => request.promise),
    close = vi.fn();
  render(view({ apply, close }));
  fireEvent.change(screen.getByRole("textbox", { name: en.docsEditComment }), {
    target: { value: "Submitted revision" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: en.docsSaveComment }),
  );
  saveCommentEditDraft(prefix, "thread", "comment", {
    before: message.text,
    editedAt: null,
    text: "Newer pane composition",
    updatedAt: Date.now() + 1,
  });
  await act(async () => {
    request.resolve({});
  });
  expect(close).toHaveBeenCalledOnce();
  expect(readCommentEditDraft(prefix, "thread", "comment").text).toBe(
    "Newer pane composition",
  );
});
