// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
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
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { nativeEditorChrome } from "./editor-chrome";
import { pageActions } from "./pages-client";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";
let root;
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture({
  twoSections = false,
  onPromptSection,
  onStagePromptSection,
  onReturn,
  scoped = false,
} = {}) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  root = await mkdtemp(join(tmpdir(), "buzz-builder-interaction-"));
  const repository = new EditorRepository(root),
    workspaceId = "interaction-check";
  const call = (operation, input) => repository.call({ operation, input });
  let page = await call("createPage", { workspaceId, title: "Cloned page" });
  page = await call("addPageSection", {
    workspaceId,
    pageId: page.id,
    title: "Contact form",
    templateId: "custom-html",
    label: "Original",
    html: '<div class="contact"><style>.contact h1{font-size:36px;text-align:start;direction:rtl}.contact h5{color:blue}</style><h1>Contact heading</h1><div><h5><span>Form introduction</span></h5><p>Supporting copy</p></div></div>',
  });
  if (twoSections)
    page = await call("addPageSection", {
      workspaceId,
      pageId: page.id,
      title: "Footer target",
      templateId: "custom-html",
      label: "Original",
      html: "<section><h2>Footer heading</h2></section>",
    });
  const other = await call("createPage", {
    workspaceId,
    title: "Another page",
  });
  await call("addPageSection", {
    workspaceId,
    pageId: other.id,
    title: "Another section",
    templateId: "custom-html",
    label: "Original",
    html: "<section><h1>Other heading</h1></section>",
  });
  const { readPageAsset, ...actions } = pageActions({ call });
  render(
    createElement(
      EditorChromeProvider,
      { value: nativeEditorChrome },
      createElement(LandingPageVisualWorkspace, {
        workspaceId,
        initialPageId: page.id,
        ...(scoped ? { pageId: page.id } : {}),
        t: (key) => en[key],
        actions,
        onPromptSection,
        onStagePromptSection,
        onReturn,
      }),
    ),
  );
  const frame = await screen.findByTitle("Contact form canvas");
  frame.contentDocument.body.innerHTML = page.sections[0].variants[0].html;
  fireEvent.load(frame);
  return { repository, call, page, other, frame, workspaceId, actions };
}
function transfer() {
  const data = new Map();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return [...data.keys()];
    },
    setData(type, value) {
      data.set(type, value);
    },
    getData(type) {
      return data.get(type) ?? "";
    },
  };
}
it("admits host editing handlers while blocking authored scripts before page content", async () => {
  const { frame } = await fixture();
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
  const source = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  const policy = source.head.firstElementChild;
  expect(policy.tagName).toBe("META");
  expect(policy.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(policy.getAttribute("content")).toBe(
    "script-src 'none'; object-src 'none'; frame-src 'none'",
  );
  expect(source.querySelector("h1").textContent).toBe("Contact heading");
});

it("uncovers the section during an element-library drag, inserts at the drop target and saves the original template", async () => {
  const h = await fixture();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add element", exact: true })[0],
  );
  const palette = screen.getByRole("dialog", { name: "Add element" });
  const block = screen.getByRole("button", {
    name: /Heading.*Add a new editable section heading/,
  });
  const dataTransfer = transfer();
  fireEvent.dragStart(block, { dataTransfer });
  expect(palette).toHaveStyle({ pointerEvents: "none", opacity: "0.15" });
  expect(block.isConnected).toBe(true);
  const target = h.frame.contentDocument.querySelector("p");
  expect(
    fireEvent.dragEnter(target, { dataTransfer, clientX: 10, clientY: 10 }),
  ).toBe(false);
  fireEvent.dragOver(target, { dataTransfer, clientX: 10, clientY: 10 });
  fireEvent.drop(target, { dataTransfer, clientX: 10, clientY: 10 });
  fireEvent.dragEnd(block, { dataTransfer });
  expect(
    screen.queryByRole("dialog", { name: "Add element" }),
  ).not.toBeInTheDocument();
  await waitFor(async () => {
    const pages = await h.call("listPages", h.workspaceId);
    expect(
      pages.find((page) => page.id === h.page.id).sections[0].variants[0].html,
    ).toContain("New section heading");
  });
});

it("styles the selected cloned element through the persistent inspector and saves a comment on its stable target", async () => {
  const h = await fixture();
  const heading = h.frame.contentDocument.querySelector("h1");
  fireEvent.click(heading);
  fireEvent.click(
    screen.getByRole("button", { name: "Style", expanded: false }),
  );
  expect(screen.getByRole("tab", { name: "Element" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("combobox", { name: "Size", exact: true }),
  ).toHaveValue("36px");
  expect(
    screen.getByRole("button", { name: "Right", pressed: true }),
  ).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Size", exact: true }),
    { target: { value: "48px" } },
  );
  await waitFor(async () => {
    const pages = await h.call("listPages", h.workspaceId);
    expect(
      pages.find((page) => page.id === h.page.id).sections[0].variants[0].html,
    ).toContain("font-size: 48px");
  });
  fireEvent.click(screen.getByRole("button", { name: en.builderComment }));
  fireEvent.click(heading);
  const comment = screen.getByRole("textbox", {
    name: en.builderVisualCommentOnThisElement,
  });
  fireEvent.change(comment, { target: { value: "Keep the heading editable" } });
  fireEvent.keyDown(comment, { key: "Enter", ctrlKey: true });
  await waitFor(async () => {
    const pages = await h.call("listPages", h.workspaceId);
    expect(
      pages.find((page) => page.id === h.page.id).comments[0],
    ).toMatchObject({
      body: "Keep the heading editable",
      elementId: heading.getAttribute("data-copyos-block-id"),
    });
  });
});

it("clears selection and review controls before switching to another page", async () => {
  const h = await fixture();
  fireEvent.click(h.frame.contentDocument.querySelector("h1"));
  fireEvent.click(
    screen.getByRole("button", { name: "Style", expanded: false }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Page", exact: true }));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: h.other.title }),
  );
  await screen.findByTitle("Another section canvas");
  await waitFor(() =>
    expect(
      screen.queryByRole("menu", { name: "Page", exact: true }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByText(new RegExp(en.pageElementTargetMissing)),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", {
      name: en.builderVisualSectionDesign,
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Style", expanded: false }),
  ).toBeInTheDocument();
});

it("sends actual markup geometry for the section drawn over, rather than the previously selected section", async () => {
  const onPromptSection = vi.fn(async () => {});
  const h = await fixture({ twoSections: true, onPromptSection });
  vi.stubGlobal("PointerEvent", MouseEvent);
  const articles = [
    ...document.querySelectorAll("article[data-copyos-section-id]"),
  ];
  vi.spyOn(articles[0], "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 200,
    top: 0,
    bottom: 100,
    width: 200,
    height: 100,
  });
  vi.spyOn(articles[1], "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 200,
    top: 100,
    bottom: 300,
    width: 200,
    height: 200,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.builderMark, exact: true }),
  );
  const svg = screen
    .getByRole("dialog", { name: en.builderVisualMarkPage })
    .querySelector("svg");
  fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 30 });
  fireEvent.pointerMove(svg, { clientX: 80, clientY: 70 });
  fireEvent.pointerUp(svg, { button: 0, clientX: 80, clientY: 70 });
  fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 150 });
  fireEvent.pointerMove(svg, { clientX: 100, clientY: 200 });
  fireEvent.pointerUp(svg, { button: 0, clientX: 100, clientY: 200 });
  expect(svg.querySelector("rect")).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.builderVisualAddANoteForThisMark }),
    { target: { value: "Adjust this area" } },
  );
  fireEvent.click(screen.getByTitle(en.builderVisualSendMarkToChat));
  await waitFor(() => expect(onPromptSection).toHaveBeenCalled());
  const args = onPromptSection.mock.calls[0];
  expect(args[2]).toBe("Contact form + Footer target");
  expect(args[3]).toContain(h.page.sections[0].id);
  expect(args[3]).toContain(h.page.sections[1].id);
  expect(args[3]).toContain('"x":20,"y":150,"width":80,"height":50');
  expect(args[3]).toContain("Adjust this area");
});

it("restores the element library after cancelling a drag without saving an insertion", async () => {
  const h = await fixture();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add element", exact: true })[0],
  );
  const block = screen.getByRole("button", {
    name: /Heading.*Add a new editable section heading/,
  });
  const dataTransfer = transfer();
  fireEvent.dragStart(block, { dataTransfer });
  fireEvent.dragEnd(block, { dataTransfer });
  expect(
    screen.getByRole("dialog", { name: "Add element" }).style.pointerEvents,
  ).not.toBe("none");
  expect(
    (await h.call("listPages", h.workspaceId)).find(
      (page) => page.id === h.page.id,
    ).revision,
  ).toBe(h.page.revision);
});

it("adds and queues marks as drafts, submitting only through the explicit Send action", async () => {
  const onPromptSection = vi.fn(async () => {}),
    onStagePromptSection = vi.fn(async () => {});
  await fixture({ onPromptSection, onStagePromptSection });
  for (const title of [
    en.builderVisualAddMarkToChatInput,
    en.builderVisualQueueMarkInChat,
  ]) {
    fireEvent.click(
      screen.getByRole("button", { name: en.builderMark, exact: true }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: en.builderVisualAddANoteForThisMark,
      }),
      { target: { value: "Prepare this feedback" } },
    );
    fireEvent.click(screen.getByTitle(title));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: en.builderVisualMarkPage }),
      ).not.toBeInTheDocument(),
    );
  }
  expect(onStagePromptSection).toHaveBeenCalledTimes(2);
  expect(onPromptSection).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.builderMark, exact: true }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.builderVisualAddANoteForThisMark }),
    { target: { value: "Send this feedback" } },
  );
  fireEvent.click(screen.getByTitle(en.builderVisualSendMarkToChat));
  await waitFor(() => expect(onPromptSection).toHaveBeenCalledTimes(1));
  expect(onPromptSection.mock.calls[0][3]).toContain("Send this feedback");
});

it("targets highlighted text in another section without requiring a click and preserves the text range", async () => {
  const h = await fixture({ twoSections: true });
  const frame = await screen.findByTitle("Footer target canvas");
  frame.contentDocument.body.innerHTML = h.page.sections[1].variants[0].html;
  fireEvent.load(frame);
  const heading = frame.contentDocument.querySelector("h2");
  const selection = frame.contentDocument.getSelection();
  const range = frame.contentDocument.createRange();
  range.setStart(heading.firstChild, 7);
  range.setEnd(heading.firstChild, 14);
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.pointerUp(heading, { button: 0 });
  fireEvent.click(
    screen.getByRole("button", { name: "Style", expanded: false }),
  );
  expect(screen.getByText("Design · Footer target")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Element" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(heading).toHaveAttribute("data-copyos-selected", "true");
  expect(selection.toString()).toBe("heading");
});

it("switches an already-open section inspector to keyboard-selected text in another section", async () => {
  const h = await fixture({ twoSections: true });
  fireEvent.click(
    screen.getByRole("button", { name: "Style", expanded: false }),
  );
  expect(screen.getByRole("tab", { name: "Section" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const frame = await screen.findByTitle("Footer target canvas");
  frame.contentDocument.body.innerHTML = h.page.sections[1].variants[0].html;
  fireEvent.load(frame);
  const heading = frame.contentDocument.querySelector("h2"),
    range = frame.contentDocument.createRange();
  range.selectNodeContents(heading);
  const selection = frame.contentDocument.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.keyUp(heading, { key: "ArrowRight", shiftKey: true });
  expect(screen.getByText("Design · Footer target")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Element" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(selection.toString()).toBe("Footer heading");
  expect(heading.contentEditable).toBe("true");
});

it("keeps a newly dropped element editable when selected, then persists typing without a reload", async () => {
  const h = await fixture();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add element", exact: true })[0],
  );
  const block = screen.getByRole("button", {
    name: /Heading.*Add a new editable section heading/,
  });
  const dataTransfer = transfer(),
    target = h.frame.contentDocument.querySelector("p");
  fireEvent.dragStart(block, { dataTransfer });
  fireEvent.dragEnter(target, { dataTransfer, clientX: 10, clientY: 10 });
  fireEvent.dragOver(target, { dataTransfer, clientX: 10, clientY: 10 });
  fireEvent.drop(target, { dataTransfer, clientX: 10, clientY: 10 });
  fireEvent.dragEnd(block, { dataTransfer });
  await waitFor(async () => {
    const saved = (await h.call("listPages", h.workspaceId)).find(
      (page) => page.id === h.page.id,
    );
    expect(saved.sections[0].variants[0].html).toContain("New section heading");
  });
  const heading = h.frame.contentDocument.querySelector("h2");
  fireEvent.click(heading);
  expect(heading.contentEditable).toBe("true");
  heading.textContent = "Dropped heading remains editable";
  fireEvent.input(heading);
  fireEvent.focusOut(heading);
  await waitFor(async () => {
    const saved = (await h.call("listPages", h.workspaceId)).find(
      (page) => page.id === h.page.id,
    );
    expect(saved.sections[0].variants[0].html).toContain(
      "Dropped heading remains editable",
    );
  });
});

it("clones, confirms deleting, and restores a page through the page picker", async () => {
  const h = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Page", exact: true }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Clone current page" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Page", exact: true }).textContent,
    ).toBe("Cloned page (copy)"),
  );
  const copyId = (await h.call("listPages", h.workspaceId)).find(
    (page) => page.title === "Cloned page (copy)",
  ).id;
  fireEvent.click(screen.getByRole("button", { name: "Page", exact: true }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Delete current page" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Delete this page?" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Delete current page", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Restore deleted page" }),
    ).toBeInTheDocument(),
  );
  expect(
    (await h.call("listPages", "interaction-check")).some(
      (p) => p.id === copyId,
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Restore deleted page" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Page", exact: true }),
    ).toHaveTextContent("Cloned page (copy)"),
  );
});

it("blocks page switching while cloning and releases the busy state when it finishes", async () => {
  const h = await fixture();
  let release, notify;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      notify = resolve;
    });
  const clone = h.actions.clonePage;
  h.actions.clonePage = async (input) => {
    notify();
    await gate;
    return clone(input);
  };
  const picker = screen.getByRole("button", { name: "Page", exact: true });
  fireEvent.click(picker);
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Clone current page" }),
  );
  try {
    await started;
    expect(picker).toBeDisabled();
  } finally {
    release();
  }
  await waitFor(() => expect(picker).toBeEnabled());
  expect(picker.textContent).toBe("Cloned page (copy)");
});

it("separates new page creation from import and guards import while an edit is dirty", async () => {
  const onReturn = vi.fn();
  const h = await fixture({ onReturn });
  fireEvent.click(
    screen.getByRole("button", { name: "New page", exact: true }),
  );
  expect(screen.getByRole("dialog", { name: "New page" })).toBeInTheDocument();
  expect(onReturn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Import page", exact: true }),
  );
  expect(onReturn).toHaveBeenCalledWith(h.page.id);
  onReturn.mockClear();
  const heading = h.frame.contentDocument.querySelector("h1");
  heading.textContent = "Unsaved text";
  fireEvent.input(heading);
  expect(
    screen.getByRole("button", { name: "Import page", exact: true }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "New page", exact: true }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Import page", exact: true }),
  );
  expect(onReturn).not.toHaveBeenCalled();
});

it("retains Return to Canvas for a scoped linked page without showing import or new actions", async () => {
  const onReturn = vi.fn();
  const h = await fixture({ onReturn, scoped: true });
  expect(
    screen.queryByRole("button", { name: "Import page", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New page", exact: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Return to Canvas" }));
  expect(onReturn).toHaveBeenCalledWith(h.page.id);
});

it("supplies standard text alongside the element payload for native drag delivery", async () => {
  const h = await fixture();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add element", exact: true })[0],
  );
  const block = screen.getByRole("button", {
    name: /Heading.*Add a new editable section heading/,
  });
  const source = transfer();
  fireEvent.dragStart(block, { dataTransfer: source });
  expect(source.getData("text/plain")).toBe("Heading");
  const native = source;
  const target = h.frame.contentDocument.querySelector("p");
  fireEvent.dragEnter(target, {
    dataTransfer: native,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.dragOver(target, {
    dataTransfer: native,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.drop(target, { dataTransfer: native, clientX: 10, clientY: 10 });
  source.dropEffect = native.dropEffect;
  fireEvent.dragEnd(block, { dataTransfer: source });
  await waitFor(async () => {
    const saved = (await h.call("listPages", h.workspaceId)).find(
      (p) => p.id === h.page.id,
    );
    expect(saved.sections[0].variants[0].html).toContain("New section heading");
  });
});
