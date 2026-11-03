// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement, useEffect, useState } from "react";
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
import { NativePageBuilder } from "./NativePageBuilder.tsx";
import { EditorAgentBridge } from "./agent-bridge.ts";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";

// Host lifetime tests substitute the view bundle and shared conversation rendering.
// The retained editor's navigation/draft guard is mounted in builder-frame-lifecycle.test.mjs.
vi.mock("../../../features/conversation/Conversation", () => ({
  ConversationChannel: ({ children }) => createElement("div", null, children),
}));
vi.mock("../../inbox/ChannelPreview", () => ({
  ChannelPreview: ({ channelName }) =>
    createElement("p", null, `Conversation with ${channelName}`),
}));
vi.mock("../../../shared/design-system/ui/Select", () => ({
  Select: ({ value, groups, disabled, onValueChange }) =>
    createElement(
      "select",
      {
        "aria-label": "Buzz agent",
        value,
        disabled,
        onChange: (event) => onValueChange(event.target.value),
      },
      createElement("option", { value: "" }, "Choose an agent"),
      groups.flatMap((group) =>
        group.options.map((option) =>
          createElement(
            "option",
            { key: option.value, value: option.value },
            option.label,
          ),
        ),
      ),
    ),
}));
vi.mock("../../../../portable/copyos-apps/dist/copyos-apps.js", () => ({
  en: {},
  EditorChromeProvider: ({ children }) => children,
  PageBuilder: ({
    onReturn,
    initialPageId,
    openPageRequest,
    onNavigationReady,
    t,
  }) => {
    useEffect(() => {
      onNavigationReady?.(true);
      return () => onNavigationReady?.(false);
    }, [onNavigationReady]);
    return createElement(
      "button",
      {
        type: "button",
        "data-resume-page": initialPageId ?? "",
        "data-open-page": openPageRequest?.pageId ?? "",
        onClick: () => onReturn("selected-saved-page"),
      },
      t("returnToCanvas"),
    );
  },
  BuilderStart: ({ startWorkflow }) => {
    const [error, setError] = useState("");
    return createElement(
      "div",
      null,
      error ? createElement("p", { role: "alert" }, error) : null,
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void startWorkflow("local-preview", "landing-page-builder");
          },
        },
        "Open blank page",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void startWorkflow(
              "local-preview",
              "website-clone",
              "Import this permitted website into the CopyOS Builder.\nWebsite URL: https://example.com",
            ).catch((error) => setError(error.message));
          },
        },
        "Start agent clone",
      ),
    );
  },
  buildPageActionPrompt: () => {
    throw new Error("This test does not send agent requests");
  },
}));

const roots = [];
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture({ connected = false, mediaAvailable = true } = {}) {
  // Geometry is exercised in the running browser; these cases check workflow and write lifetimes.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const root = await mkdtemp(join(tmpdir(), "buzz-builder-start-"));
  roots.push(root);
  const repository = new EditorRepository(root);
  const listeners = new Set();
  const choices = {
    selectable: connected
      ? [{ pubkey: "strategist", name: "Strategist", managed: true }]
      : [],
  };
  const agents = [];
  const solo = { status: "ready", data: { sections: [], assignments: {} } };
  const session = {
    soloPreferences: {
      snapshot: () => solo,
      subscribe: () => () => {},
      ensure() {},
    },
    agentChoices: {
      snapshot: () => choices,
      subscribe: () => () => {},
      ensure() {},
    },
    directMessages: { available: true, open: vi.fn(async () => "agent-dm") },
    messages: { send: vi.fn() },
  };
  let connection = {
    status: connected ? "ready" : "disconnected",
    scope: connected ? "local-preview" : null,
    session,
  };
  const ctx = {
    relay: {
      snapshot: () => connection,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    agents: {
      snapshot: () => agents,
      subscribe: () => () => {},
      find: () => ({ key: "strategist-key" }),
      sessionState: () => "idle",
    },
    conversation: {},
  };
  let heldOperation;
  const call = vi.fn(async (operation, input) => {
    if (heldOperation?.operation === operation) {
      heldOperation.started();
      await heldOperation.promise;
    }
    if (operation === "checkMediaSupport")
      return {
        available: mediaAvailable,
        instruction: "Install test media plugins",
      };
    return repository.call({ operation, input });
  });
  const store = { call };
  const bridge = new EditorAgentBridge(store);
  const original = await repository.call({
    operation: "createPage",
    input: { workspaceId: "local-preview", title: "Existing saved page" },
  });
  const view = render(createElement(NativePageBuilder, { ctx, store, bridge }));
  await screen.findByRole("button", { name: "Import page" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Import page" })).toBeEnabled(),
  );
  const hold = (operation) => {
    let release, started;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    const began = new Promise((resolve) => {
      started = resolve;
    });
    heldOperation = { operation, promise, started };
    return { began, release };
  };
  return {
    original,
    repository,
    view,
    hold,
    call,
    bridge,
    setMediaAvailable(value) {
      mediaAvailable = value;
    },
    session,
    changeScope(scope) {
      act(() => {
        connection = { ...connection, scope };
        for (const listener of listeners) listener();
      });
    },
  };
}

it("opens the start view after a saved page and returns without creating or changing content", async () => {
  const h = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  expect(
    screen.getByRole("region", { name: "Original Page Builder" }),
  ).toHaveFocus();
  expect(screen.getByRole("button", { name: "Open blank page" })).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Return to saved pages" }),
  );
  await screen.findByRole("button", { name: "Import page" });
  expect(
    screen.getByRole("region", { name: "Original Page Builder" }),
  ).toHaveFocus();
  expect(screen.getByRole("button", { name: "Import page" })).toHaveAttribute(
    "data-resume-page",
    "selected-saved-page",
  );
  expect(
    await h.repository.call({ operation: "listPages", input: "local-preview" }),
  ).toEqual([h.original]);
  expect(
    h.call.mock.calls.some(([operation]) => operation === "createPage"),
  ).toBe(false);
});

it("removes a workflow observer before a previous workspace’s page creation finishes", async () => {
  const h = await fixture({ connected: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Buzz agent" }), {
    target: { value: "strategist" },
  });
  await screen.findByText("Conversation with Strategist");
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  fireEvent.click(screen.getByRole("button", { name: "Start agent clone" }));
  await waitFor(() => expect(h.session.messages.send).toHaveBeenCalledTimes(1));
  const requestId = h.session.messages.send.mock.calls[0][1].match(
    /Workflow reference: ([\da-f-]+)\./u,
  )[1];
  const gate = h.hold("createPage");
  const tool = h.bridge.tool();
  const creation = tool.call(
    { key: "strategist-key", pubkey: "strategist" },
    { channel: "agent-dm" },
    {
      operation: "createPage",
      input: {
        title: "Previous workspace result",
        workflowRequestId: requestId,
      },
    },
  );
  try {
    await gate.began;
    h.changeScope("another-workspace");
    await screen.findByRole("button", { name: "Open blank page" });
  } finally {
    await act(async () => {
      gate.release();
      await creation;
    });
  }
  expect(
    screen.queryByRole("button", { name: "Open created page" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Agent created Previous workspace result"),
  ).not.toBeInTheDocument();
  expect(
    (
      await h.repository.call({
        operation: "listPages",
        input: "local-preview",
      })
    ).some((page) => page.title === "Previous workspace result"),
  ).toBe(true);
});

it("connects an admitted workflow message to its created page and opens only on the owner’s explicit action", async () => {
  const h = await fixture({ connected: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Buzz agent" }), {
    target: { value: "strategist" },
  });
  await screen.findByText("Conversation with Strategist");
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  fireEvent.click(screen.getByRole("button", { name: "Start agent clone" }));
  await waitFor(() => expect(h.session.messages.send).toHaveBeenCalledTimes(1));
  const [channel, prompt] = h.session.messages.send.mock.calls[0];
  expect(channel).toBe("agent-dm");
  const requestId = prompt.match(/Workflow reference: ([\da-f-]+)\./u)[1];
  expect(prompt).toContain("buzz_pages prepareWorkflow");
  expect(
    await screen.findByRole("button", { name: "Import page" }),
  ).toHaveAttribute("data-resume-page", "selected-saved-page");
  const tool = h.bridge.tool();
  await act(async () => {
    await tool.call(
      { key: "strategist-key", pubkey: "strategist" },
      { channel: "agent-dm" },
      { operation: "createPage", input: { title: "Unrelated result" } },
    );
  });
  expect(
    screen.queryByRole("button", { name: "Open created page" }),
  ).not.toBeInTheDocument();
  let created;
  await act(async () => {
    created = JSON.parse(
      await tool.call(
        { key: "strategist-key", pubkey: "strategist" },
        { channel: "agent-dm" },
        {
          operation: "createPage",
          input: { title: "Clone result", workflowRequestId: requestId },
        },
      ),
    );
  });
  const open = await screen.findByRole("button", { name: "Open created page" });
  await waitFor(() => expect(open).toBeEnabled());
  expect(screen.getByRole("button", { name: "Import page" })).toHaveAttribute(
    "data-open-page",
    "",
  );
  fireEvent.click(open);
  expect(screen.getByRole("button", { name: "Import page" })).toHaveAttribute(
    "data-open-page",
    created.id,
  );
  expect(
    await h.repository.call({
      operation: "readPage",
      input: { workspaceId: "local-preview", pageId: h.original.id },
    }),
  ).toEqual(h.original);
  h.changeScope("another-workspace");
  await screen.findByRole("button", { name: "Open blank page" });
  expect(
    screen.queryByRole("button", { name: "Open created page" }),
  ).not.toBeInTheDocument();
});

it("keeps the chooser open while page creation is pending, then opens the Builder body", async () => {
  const h = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  const gate = h.hold("createPage");
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open blank page" }));
    await gate.began;
    expect(
      screen.getByRole("button", { name: "Return to saved pages" }),
    ).toBeDisabled();
  } finally {
    await act(async () => {
      gate.release();
    });
  }
  await screen.findByRole("button", { name: "Import page" });
  expect(screen.getByRole("button", { name: "Import page" })).toHaveAttribute(
    "data-resume-page",
    "",
  );
  const pages = await h.repository.call({
    operation: "listPages",
    input: "local-preview",
  });
  expect(pages).toHaveLength(2);
  expect(pages.find((page) => page.id === h.original.id)).toEqual(h.original);
});

it("does not reopen a previous workspace after its pending creation completes", async () => {
  const h = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  const gate = h.hold("createPage");
  try {
    fireEvent.click(screen.getByRole("button", { name: "Open blank page" }));
    await gate.began;
    h.changeScope("another-workspace");
    await screen.findByRole("button", { name: "Open blank page" });
  } finally {
    await act(async () => {
      gate.release();
    });
  }
  expect(
    screen.queryByRole("button", { name: "Import page" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Return to saved pages" }),
  ).not.toBeInTheDocument();
  expect(
    await h.repository.call({
      operation: "listPages",
      input: "another-workspace",
    }),
  ).toEqual([]);
});

it("blocks clone dispatch for missing media support and permits retry after installation", async () => {
  const h = await fixture({ connected: true, mediaAvailable: false });
  fireEvent.change(screen.getByRole("combobox", { name: "Buzz agent" }), {
    target: { value: "strategist" },
  });
  await screen.findByText("Conversation with Strategist");
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  fireEvent.click(screen.getByRole("button", { name: "Start agent clone" }));
  await screen.findByText(/Install test media plugins/);
  expect(h.session.messages.send).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Return to saved pages" }),
  ).toBeEnabled();
  h.setMediaAvailable(true);
  fireEvent.click(screen.getByRole("button", { name: "Start agent clone" }));
  await waitFor(() => expect(h.session.messages.send).toHaveBeenCalledTimes(1));
});

it("does not send a clone after its workspace changes during the dependency probe", async () => {
  const h = await fixture({ connected: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Buzz agent" }), {
    target: { value: "strategist" },
  });
  await screen.findByText("Conversation with Strategist");
  fireEvent.click(screen.getByRole("button", { name: "Import page" }));
  const gate = h.hold("checkMediaSupport");
  fireEvent.click(screen.getByRole("button", { name: "Start agent clone" }));
  await gate.began;
  try {
    h.changeScope("changed-during-probe");
    await screen.findByRole("button", { name: "Open blank page" });
  } finally {
    await act(async () => {
      gate.release();
    });
  }
  expect(h.session.messages.send).not.toHaveBeenCalled();
});
