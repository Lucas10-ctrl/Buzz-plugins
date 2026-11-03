// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement, useState } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DocsHistory } from "../../../../portable/copyos-apps/src/client/DocsHistory.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { createEditorText } from "./editor-locale.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";

afterEach(cleanup);
const t = createEditorText(en);
const entry = (revision) => ({
  revision,
  actor: "user",
  savedAt: `2026-11-01T06:0${revision}:00.000Z`,
  name: "",
});
const version = (revision) => ({
  entry: entry(revision),
  title: `Draft ${revision}`,
  blocks: [
    {
      id: "block",
      label: "",
      content:
        "Manual introduction stays.\n\nReview passage.\n\nClosing stays.",
      state: "ready",
    },
  ],
});
function mount({ restore = vi.fn(async () => {}), loadFailure = false } = {}) {
  const load = vi.fn(async (before) =>
    before === undefined
      ? { entries: [entry(3), entry(2)], headRevision: 3, nextBefore: 2 }
      : { entries: [entry(1)], headRevision: 3 },
  );
  if (loadFailure) load.mockRejectedValueOnce(new Error("History unavailable"));
  const read = vi.fn(async (revision) => ({
    version: version(revision),
    ...(revision > 1 ? { previous: version(revision - 1) } : {}),
  }));
  const name = vi.fn(async (revision, name) => ({ ...entry(revision), name }));
  const closed = vi.fn();
  function Example() {
    const [open, setOpen] = useState(false);
    return createElement(
      EditorChromeProvider,
      { value: nativeEditorChrome },
      createElement(
        "button",
        { type: "button", onClick: () => setOpen(true) },
        "Open history",
      ),
      open &&
        createElement(DocsHistory, {
          docId: "doc",
          t,
          load,
          read,
          name,
          restore,
          onClose: () => {
            closed();
            setOpen(false);
          },
        }),
    );
  }
  render(createElement(Example));
  return { load, read, name, restore, closed, user: userEvent.setup() };
}

it("retains original version navigation, naming, change toggling, pagination and revision-checked restoration in Buzz controls", async () => {
  const h = mount();
  await h.user.click(screen.getByRole("button", { name: "Open history" }));
  const dialog = await screen.findByRole("dialog", { name: en.docsHistory });
  expect(dialog).toHaveClass("buzz-dialog");
  expect(
    await screen.findByRole("button", { name: /Version 3/ }),
  ).toHaveAttribute("data-buzz-ui");
  const restore = screen.getByRole("button", { name: en.docsHistoryRestore });
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: en.docsHistoryName }),
    ).toBeEnabled(),
  );
  expect(restore).toBeDisabled();
  await h.user.click(screen.getByRole("button", { name: /Version 2/ }));
  await waitFor(() => expect(restore).toBeEnabled());
  expect(
    within(dialog).getByText("1", { selector: "del" }),
  ).toBeInTheDocument();
  const changes = screen.getByRole("checkbox", {
    name: en.docsHistoryShowChanges,
  });
  expect(changes).toHaveAttribute("data-buzz-ui");
  await h.user.click(changes);
  expect(changes).not.toBeChecked();
  expect(
    within(dialog).queryByText("1", { selector: "del" }),
  ).not.toBeInTheDocument();
  const name = screen.getByRole("textbox", { name: en.docsHistoryName });
  expect(name).toHaveAttribute("data-buzz-ui");
  await h.user.type(name, "Reviewed draft");
  await h.user.click(
    screen.getByRole("button", { name: en.docsHistorySaveName }),
  );
  expect(h.name).toHaveBeenCalledExactlyOnceWith(2, "Reviewed draft");
  expect(
    await screen.findByRole("button", { name: /Reviewed draft/ }),
  ).toHaveAttribute("aria-current", "true");
  await h.user.click(screen.getByRole("button", { name: en.docsHistoryOlder }));
  await screen.findByRole("button", { name: /Version 1/ });
  expect(h.load).toHaveBeenLastCalledWith(2);
  await h.user.click(restore);
  expect(h.restore).toHaveBeenCalledExactlyOnceWith(2, 3);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(h.closed).toHaveBeenCalledTimes(1);
});

it("keeps the dialog and selection after a stale restore and prevents dismissal while the write is pending", async () => {
  let reject;
  const restore = vi.fn(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  const h = mount({ restore });
  await h.user.click(screen.getByRole("button", { name: "Open history" }));
  await h.user.click(await screen.findByRole("button", { name: /Version 2/ }));
  const apply = screen.getByRole("button", { name: en.docsHistoryRestore });
  await waitFor(() => expect(apply).toBeEnabled());
  await h.user.click(apply);
  const close = screen.getByRole("button", { name: en.docsClose });
  expect(close).toBeDisabled();
  await h.user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => {
    reject(new Error("The document changed; review the current version"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The document changed",
  );
  expect(screen.getByRole("button", { name: /Version 2/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await waitFor(() => expect(close).toBeEnabled());
  await h.user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Open history" })).toHaveFocus();
});

it("recovers a failed history load through the original retry action", async () => {
  const h = mount({ loadFailure: true });
  await h.user.click(screen.getByRole("button", { name: "Open history" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History unavailable",
  );
  await h.user.click(screen.getByRole("button", { name: en.docsRetry }));
  await screen.findByRole("button", { name: /Version 3/ });
  expect(h.load).toHaveBeenCalledTimes(2);
});
