// @vitest-environment jsdom
import { createElement } from "react";
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorWorkspaceControl } from "./EditorWorkspaceControl";
import { NativeBrandSettings } from "./NativeBrandSettings";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";
import { editorWorkspaceId, editorWorkspaceKey } from "./workspace";
import { writeView } from "../../../shared/view-state";

// The shared control owns its menu. This fixture drives only its project selection callback.
vi.mock("../../../features/solo/WorkspaceControl", () => ({
  WorkspaceControl: ({ value, onChange }) =>
    createElement(
      "select",
      {
        "aria-label": "Workspace",
        value,
        onChange: (event) => onChange(event.target.value),
      },
      ["", "one", "two"].map((id) =>
        createElement("option", { key: id, value: id }, id || "No workspace"),
      ),
    ),
}));
let root, repository;
const scope = "community:viewer",
  active = () => true;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-brand-ui-"));
  repository = new EditorRepository(root);
  localStorage.clear();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  await repository.dispose();
  await rm(root, { recursive: true, force: true });
});
const store = {
  call: (operation, input) => repository.call({ operation, input }),
};
function mount() {
  const preferences = {
    status: "ready",
    data: {
      sections: [
        { id: "one", name: "Client One" },
        { id: "two", name: "Client Two" },
      ],
      assignments: {},
    },
  };
  const connection = {
    scope,
    status: "ready",
    session: {
      soloPreferences: {
        snapshot: () => preferences,
        subscribe: () => () => {},
        ensure: vi.fn(),
      },
    },
  };
  const ctx = {
    relay: { snapshot: () => connection, subscribe: () => () => {} },
    navigation: { open: vi.fn() },
  };
  render(createElement(NativeBrandSettings, { ctx, store, active }));
  return ctx;
}
const fill = (label, value) =>
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value },
  });

it("saves original brand and CSS records, reopens them, and keeps another Solo workspace empty", async () => {
  writeView(scope, editorWorkspaceKey, "one");
  mount();
  await screen.findByRole("textbox", { name: "Styleguide name" });
  fill("Styleguide name", "One styles");
  fill(
    "CSS source",
    ":root { --brand: #445566; } body { font-family: Inter; }",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save styleguide" }));
  await screen.findByText("Website styleguide saved.");
  expect(
    screen.getByRole("heading", { name: "Saved: One styles" }),
  ).toBeTruthy();
  for (const [label, value] of [
    ["Profile name", "One brand"],
    ["Positioning", "Helpful"],
    ["Audience", "Owners"],
    ["Brand voice", "Plain"],
    ["Differentiators", "Care"],
  ])
    fill(label, value);
  fireEvent.click(screen.getByRole("button", { name: "Save brand profile" }));
  await screen.findByText("Brand profile saved.");
  expect(screen.getByRole("heading", { name: "One brand" })).toBeTruthy();
  expect(document.querySelector("style[data-brand-css]")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), {
    target: { value: "two" },
  });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
  expect(screen.getByRole("textbox", { name: "Styleguide name" }).value).toBe(
    "One styles",
  );
  act(() => {
    writeView(scope, editorWorkspaceKey, "two");
  });
  await screen.findByText("Workspace: Client Two");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "CSS source" }).value).toBe(""),
  );
  expect(screen.queryByRole("heading", { name: "One brand" })).toBeNull();
  act(() => {
    writeView(scope, editorWorkspaceKey, "one");
  });
  await screen.findByRole("heading", { name: "One brand" });
  expect(screen.getByRole("textbox", { name: "Styleguide name" }).value).toBe(
    "One styles",
  );
});

it("keeps a failed stale CSS draft and reloads only after an explicit discard", async () => {
  writeView(scope, editorWorkspaceKey, "one");
  mount();
  await screen.findByRole("textbox", { name: "CSS source" });
  const workspaceId = editorWorkspaceId(scope, "one");
  await store.call("saveStyleGuide", {
    workspaceId,
    name: "Agent styles",
    css: ":root { --brand: blue; }",
    sourceType: "website",
    sourceLabel: "Agent capture",
    expectedRevision: null,
  });
  fill("CSS source", ":root { --brand: red; }");
  fireEvent.click(screen.getByRole("button", { name: "Save styleguide" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "CSS source" }).value).toContain(
    "red",
  );
  expect(
    (await store.call("readBrandContext", { workspaceId })).guide.css,
  ).toContain("blue");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Discard style draft and reload saved settings",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "CSS source" }).value).toContain(
      "blue",
    ),
  );
});

it("retires a workspace confirmation on community change or when an agent starts working", () => {
  const session = {},
    choose = vi.fn(() => true);
  const props = { session, owner: "community:one", projectId: "one", choose };
  const view = render(createElement(EditorWorkspaceControl, props));
  const select = () =>
    fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), {
      target: { value: "two" },
    });
  select();
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  view.rerender(
    createElement(EditorWorkspaceControl, { ...props, owner: "community:two" }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  view.rerender(createElement(EditorWorkspaceControl, props));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  select();
  view.rerender(
    createElement(EditorWorkspaceControl, { ...props, disabled: true }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  view.rerender(createElement(EditorWorkspaceControl, props));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});
