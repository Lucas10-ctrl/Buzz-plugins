// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DesignerBuildFromCopy,
  designerBuildPrompt,
} from "../../../../portable/copyos-apps/src/client/DesignerBuildFromCopy.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";
import userEvent from "@testing-library/user-event";
import { canvasCopyPrompt } from "./canvas-copy.ts";

afterEach(cleanup);
const wrapper = ({ children }) =>
  createElement(EditorChromeProvider, { value: nativeEditorChrome }, children);
it("retains the complete original brief and user copy while naming only native tools in the host instructions", () => {
  const request = {
    kind: "email",
    goal: "Make an editable email",
    copyAsset: { id: "saved-copy", title: "Selected copy" },
    copyText: "Keep read_copyos_asset in this user text.\n[Not page copy.]",
    reference: { id: "reference-frame", name: "Reference" },
    referenceNote: "Keep the original style",
  };
  const design = { id: "target-design", title: "My design" };
  const original = designerBuildPrompt(request, design);
  const native = canvasCopyPrompt(request, design, designerBuildPrompt);
  expect(original).toContain("list_copyos_workspaces");
  for (const text of [
    request.copyText,
    request.goal,
    request.referenceNote,
    "as a new top-level artboard beside the existing ones",
    "Keep the copy word for word",
    "copy you could not place",
  ])
    expect(native).toContain(text);
  for (const operation of [
    "readCopy",
    "listDesignTemplates",
    "listWorkspaces",
    "listComparableDesigns",
    "insertDesignTemplate",
    "editDesign",
    "viewDesign",
  ])
    expect(native).toContain(`buzz_canvas ${operation}`);
  expect(native).toContain("workspaceRef");
  expect(native).toContain("expectedRevision");
});

it("loads the saved-copy picker and preserves all form answers after an unavailable Buzz conversation rejects submission", async () => {
  const copy = { id: "selected-copy", title: "Launch copy", kind: "copy" };
  const submit = vi.fn(async () => {
    throw new Error("Connect an available Buzz agent");
  });
  render(
    createElement(
      EditorChromeProvider,
      { value: nativeEditorChrome },
      createElement(DesignerBuildFromCopy, {
        t: (key) => en[key],
        reference: { id: "reference-frame", name: "Reference" },
        listCopy: async () => [copy],
        onSubmit: submit,
        onClose: vi.fn(),
      }),
    ),
  );
  const library = await screen.findByRole("combobox", {
    name: en.designerBuildCopyAsset,
  });
  const user = userEvent.setup();
  await user.click(library);
  await user.click(await screen.findByRole("option", { name: copy.title }));
  await user.click(
    screen.getByRole("combobox", { name: en.designerBuildKind }),
  );
  expect(await screen.findAllByRole("option")).toHaveLength(6);
  await user.click(
    screen.getByRole("option", {
      name: en.designerBuildKindEmail,
      exact: true,
    }),
  );
  await user.click(screen.getByRole("checkbox"));
  fireEvent.change(
    screen.getByRole("textbox", { name: en.designerBuildReferenceNote }),
    { target: { value: "Keep the manual artboard" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.designerBuildGoal }),
    { target: { value: "Keep manual work and improve the email" } },
  );
  const button = screen.getByRole("button", { name: en.designerBuildStart });
  expect(button).toHaveAttribute("data-buzz-ui");
  fireEvent.click(button);
  await screen.findByRole("alert");
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      copyAsset: { id: copy.id, title: copy.title },
      goal: "Keep manual work and improve the email",
      kind: "email",
      reference: null,
      referenceNote: "Keep the manual artboard",
    }),
    expect.any(AbortSignal),
  );
  expect(library).toHaveTextContent(copy.title);
  expect(
    screen.getByRole("textbox", { name: en.designerBuildGoal }),
  ).toHaveValue("Keep manual work and improve the email");
  await waitFor(() => expect(button).toBeEnabled());
  expect(
    screen.getByRole("combobox", { name: en.designerBuildKind }),
  ).toHaveTextContent(en.designerBuildKindEmail);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("keeps a revised brief open when the earlier admission finishes", async () => {
  let finish;
  const close = vi.fn();
  const submit = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    createElement(DesignerBuildFromCopy, {
      t: (key) => en[key],
      reference: null,
      onSubmit: submit,
      onClose: close,
    }),
    { wrapper },
  );
  const goal = screen.getByRole("textbox", { name: en.designerBuildGoal });
  fireEvent.change(goal, { target: { value: "Earlier brief" } });
  fireEvent.change(
    screen.getByRole("textbox", { name: en.designerBuildCopyText }),
    { target: { value: "Saved copy" } },
  );
  fireEvent.click(screen.getByRole("button", { name: en.designerBuildStart }));
  fireEvent.change(goal, { target: { value: "Keep this newer brief" } });
  await act(async () => {
    finish();
  });
  expect(close).not.toHaveBeenCalled();
  expect(goal).toHaveValue("Keep this newer brief");
  expect(
    screen.getByRole("button", { name: en.designerBuildStart }),
  ).toBeEnabled();
});

it("aborts pending admission on dismissal and ignores its late completion after reopening", async () => {
  let finish;
  const close = vi.fn();
  const submit = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    createElement(DesignerBuildFromCopy, {
      t: (key) => en[key],
      reference: null,
      onSubmit: submit,
      onClose: close,
    }),
    { wrapper },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.designerBuildGoal }),
    { target: { value: "Build an email" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.designerBuildCopyText }),
    { target: { value: "Saved copy" } },
  );
  fireEvent.click(screen.getByRole("button", { name: en.designerBuildStart }));
  const signal = submit.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: en.designerDone }));
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  close.mockClear();
  view.unmount();
  expect(signal.aborted).toBe(true);
  render(
    createElement(DesignerBuildFromCopy, {
      t: (key) => en[key],
      reference: null,
      onSubmit: submit,
      onClose: close,
    }),
    { wrapper },
  );
  await act(async () => {
    finish();
  });
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.getByRole("textbox", { name: en.designerBuildGoal }),
  ).toHaveValue("");
});
