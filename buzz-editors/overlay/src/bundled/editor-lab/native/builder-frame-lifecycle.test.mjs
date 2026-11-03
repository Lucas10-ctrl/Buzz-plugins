// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Component, createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LandingPageVisualWorkspace } from "../../../../portable/copyos-apps/src/client/LandingPageVisualWorkspace.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";
import { pageActions } from "./pages-client.ts";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";

let root;
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error
      ? createElement("p", { role: "alert" }, this.state.error.message)
      : this.props.children;
  }
}

it("waits for the iframe document to have a head and body before configuring a replaced preview", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  root = await mkdtemp(join(tmpdir(), "buzz-frame-lifecycle-"));
  const repository = new EditorRepository(root);
  const workspaceId = "frame-lifecycle";
  const call = (operation, input) => repository.call({ operation, input });
  let page = await call("createPage", {
    workspaceId,
    title: "Frame lifecycle",
  });
  page = await call("addPageSection", {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
    title: "Editable section",
    templateId: "custom-html",
    label: "Original",
    html: "<section><h1>Editable</h1></section>",
  });
  const { readPageAsset, ...actions } = pageActions({ call });
  render(
    createElement(
      Boundary,
      null,
      createElement(
        EditorChromeProvider,
        { value: nativeEditorChrome },
        createElement(LandingPageVisualWorkspace, {
          workspaceId,
          t: (key) => en[key],
          actions,
        }),
      ),
    ),
  );
  const frame = await screen.findByTitle("Editable section canvas");
  const doc = frame.contentDocument;
  doc.body.innerHTML = "<section><h1>Editable</h1></section>";
  fireEvent.load(frame);
  // jsdom does not parse srcDoc. Model the transient incomplete document observed during replacement.
  doc.head.remove();
  doc.body.remove();
  const section = page.sections[0];
  await call("updatePageSectionVariant", {
    workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
    sectionId: section.id,
    variantId: section.selectedVariantId,
    html: "<section><h1>Updated</h1></section>",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
  await waitFor(() =>
    expect(frame.getAttribute("srcdoc")).toContain("Updated"),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const head = doc.createElement("head"),
    body = doc.createElement("body");
  body.innerHTML = "<section><h1>Updated</h1></section>";
  doc.documentElement.append(head, body);
  fireEvent.load(frame);
  expect(head.querySelector("[data-copyos-editor-style]")).toBeInTheDocument();
  expect(body.querySelector("[data-copyos-element]")).toBeInTheDocument();
  expect(errors).not.toHaveBeenCalled();
});

it("opens an explicit host page request once, after dirty text and its pending save settle", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  root = await mkdtemp(join(tmpdir(), "buzz-page-handoff-"));
  const repository = new EditorRepository(root);
  const workspaceId = "navigation-lifecycle";
  const first = await repository.call({
    operation: "createPage",
    input: { workspaceId, title: "Manual page" },
  });
  await repository.call({
    operation: "addPageSection",
    input: {
      workspaceId,
      pageId: first.id,
      title: "Manual section",
      templateId: "custom-html",
      label: "Original",
      html: "<section><h1>Original manual text</h1></section>",
    },
  });
  const second = await repository.call({
    operation: "createPage",
    input: { workspaceId, title: "Agent page" },
  });
  let release, began;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const { readPageAsset, ...actions } = pageActions({
    call: async (operation, input) => {
      if (operation === "updatePageSectionVariants") {
        began();
        await gate;
      }
      return repository.call({ operation, input });
    },
  });
  const ready = vi.fn();
  const props = {
    workspaceId,
    initialPageId: first.id,
    actions,
    t: (key) => en[key],
    onNavigationReady: ready,
  };
  const app = (request) =>
    createElement(
      EditorChromeProvider,
      { value: nativeEditorChrome },
      createElement(LandingPageVisualWorkspace, {
        ...props,
        ...(request ? { openPageRequest: request } : {}),
      }),
    );
  const view = render(app());
  const picker = await screen.findByRole("button", {
    name: "Page",
    exact: true,
  });
  await waitFor(() => expect(picker).toHaveTextContent(first.title));
  const frame = await screen.findByTitle("Manual section canvas");
  const doc = frame.contentDocument;
  doc.body.innerHTML = "<section><h1>Original manual text</h1></section>";
  fireEvent.load(frame);
  const heading = doc.querySelector("h1");
  heading.textContent = "Manual draft survives";
  fireEvent.input(heading);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(false));
  const request = { requestId: "open-agent-page-once", pageId: second.id };
  view.rerender(app(request));
  expect(picker).toHaveTextContent(first.title);
  expect(heading).toHaveTextContent("Manual draft survives");
  try {
    fireEvent.focusOut(heading);
    await started;
    expect(picker).toHaveTextContent(first.title);
    expect(ready).toHaveBeenLastCalledWith(false);
  } finally {
    await act(async () => {
      release();
    });
  }
  await waitFor(() => expect(picker).toHaveTextContent(second.title));
  const saved = await repository.call({
    operation: "readPage",
    input: { workspaceId, pageId: first.id },
  });
  expect(saved.sections[0].variants[0].html).toContain("Manual draft survives");
  fireEvent.click(picker);
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: first.title }),
  );
  await waitFor(() => expect(picker).toHaveTextContent(first.title));
  expect(picker).toBeEnabled();
});
