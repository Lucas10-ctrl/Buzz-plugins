// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEditorConversation } from "./useEditorConversation.tsx";
import { writeView } from "../../../shared/view-state";
import { editorWorkspaceId, editorWorkspaceKey } from "./workspace";
import { EditorAgentBridge } from "./agent-bridge.ts";

const preview = vi.hoisted(() => ({ onSessionControl: undefined }));

// These cases exercise the editor's admission/open lifecycle; shared conversation rendering is tested by its owner.
vi.mock("../../../features/conversation/Conversation", () => ({
  ConversationChannel: ({ children }) => createElement("div", null, children),
}));
vi.mock("../../inbox/ChannelPreview", () => ({
  ChannelPreview: ({ channelName, onSessionControl }) => {
    preview.onSessionControl = onSessionControl;
    return createElement("p", null, `Native conversation ${channelName}`);
  },
}));
vi.mock("../../../shared/design-system/ui/Select", () => ({
  Select: ({ groups, value, disabled, onValueChange }) =>
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
afterEach(() => {
  cleanup();
  localStorage.clear();
  preview.onSessionControl = undefined;
});

function fixture({ canvasCopy = false, signal } = {}) {
  const listeners = new Set(),
    requests = [],
    agentsSnapshot = [];
  let choices = {
    selectable: [
      { pubkey: "a", name: "Agent A", managed: true },
      { pubkey: "b", name: "Agent B", managed: true },
    ],
  };
  const open = vi.fn(
    (members, signal) =>
      new Promise((resolve) => {
        requests.push({ members, signal, resolve });
      }),
  );
  const send = vi.fn();
  const solo = {
    status: "ready",
    data: {
      sections: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ],
      assignments: {},
    },
  };
  const makeSession = () => ({
    soloPreferences: {
      snapshot: () => solo,
      subscribe: () => () => {},
      ensure: vi.fn(),
    },
    agentChoices: {
      snapshot: () => choices,
      subscribe: () => () => {},
      ensure: vi.fn(),
    },
    directMessages: { available: true, open },
    messages: { send },
  });
  let connection = {
    session: makeSession(),
    status: "ready",
    scope: "community:owner",
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
      find: (pubkey) => ({ key: `local:${pubkey}` }),
      snapshot: () => agentsSnapshot,
      subscribe: () => () => {},
      sessionState: () => "idle",
      session: vi.fn(async () => {}),
    },
    conversation: {},
  };
  const bridge = new EditorAgentBridge({
    call: async () => {
      throw new Error(
        "No repository operation belongs to conversation opening",
      );
    },
  });
  vi.spyOn(bridge, "bind");
  const docs = {
    docId: "document",
    epoch: 3,
    scope: "selection",
    editMode: "suggest",
  };
  function Harness() {
    const editor = useEditorConversation(ctx, bridge, "Canvas");
    return createElement(
      "div",
      null,
      editor.workspaceControls,
      editor.content,
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            const request = canvasCopy
              ? editor.send(
                  "Build from selected copy",
                  undefined,
                  undefined,
                  {
                    designId: "target-design",
                  },
                  signal,
                )
              : editor.send("Refine the selection", docs);
            void request.catch(() => undefined);
          },
        },
        "Send editor request",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            void editor.stop();
          },
        },
        "Stop editor request",
      ),
    );
  }
  const view = render(createElement(Harness));
  const choose = (pubkey) =>
    fireEvent.change(screen.getByRole("combobox", { name: "Buzz agent" }), {
      target: { value: pubkey },
    });
  const finish = async (index, channel) => {
    await act(async () => {
      requests[index].resolve(channel);
    });
  };
  return {
    view,
    choose,
    finish,
    requests,
    send,
    bridge,
    ctx,
    docs,
    deleteWorkspace: (id) => {
      solo.data.sections = solo.data.sections.filter((item) => item.id !== id);
    },
    revoke: () => {
      choices = { selectable: [] };
    },
    replaceSession: () => {
      act(() => {
        connection = { ...connection, session: makeSession() };
        for (const listener of listeners) listener();
      });
    },
    replaceScope: (scope = "another-community") => {
      act(() => {
        connection = { ...connection, scope };
        for (const listener of listeners) listener();
      });
    },
  };
}

it("opens the selected native conversation without sending and preserves explicit Docs request permissions", async () => {
  const h = fixture();
  h.choose("a");
  expect(h.requests[0].members).toEqual(["a"]);
  expect(h.send).not.toHaveBeenCalled();
  await h.finish(0, "dm-a");
  expect(screen.getByText("Native conversation Agent A")).toBeTruthy();
  expect(h.bridge.bind).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "community:owner",
      channel: "dm-a",
      agent: "a",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send editor request" }));
  await h.finish(1, "dm-a");
  expect(h.send).toHaveBeenCalledExactlyOnceWith(
    "dm-a",
    "Canvas: Refine the selection",
    ["a"],
  );
  expect(h.bridge.bind).toHaveBeenLastCalledWith(
    expect.objectContaining({ docs: h.docs }),
  );
});

it("binds comparison access only when the structured copy request is admitted for the selected agent", async () => {
  const h = fixture({ canvasCopy: true });
  h.choose("a");
  await h.finish(0, "dm-a");
  expect(h.bridge.bind.mock.calls.at(-1)[0]).not.toHaveProperty("canvasCopy");
  fireEvent.click(screen.getByRole("button", { name: "Send editor request" }));
  expect(h.bridge.bind.mock.calls.at(-1)[0]).not.toHaveProperty("canvasCopy");
  await h.finish(1, "dm-a");
  expect(h.bridge.bind).toHaveBeenLastCalledWith(
    expect.objectContaining({
      agent: "a",
      channel: "dm-a",
      canvasCopy: { designId: "target-design" },
    }),
  );
  expect(h.bridge.bind.mock.calls.at(-1)[0]).not.toHaveProperty("docs");
  expect(h.send).toHaveBeenCalledExactlyOnceWith(
    "dm-a",
    "Canvas: Build from selected copy",
    ["a"],
  );
});

it("keeps the newer agent when an older conversation open finishes late", async () => {
  const h = fixture();
  h.choose("a");
  h.choose("b");
  expect(h.requests[0].signal.aborted).toBe(true);
  await h.finish(1, "dm-b");
  await h.finish(0, "dm-a");
  expect(screen.getByText("Native conversation Agent B")).toBeTruthy();
  expect(screen.queryByText("Native conversation Agent A")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(h.bridge.bind).toHaveBeenCalledTimes(1);
  expect(h.send).not.toHaveBeenCalled();
});

it("revokes Canvas comparison access before invoking the editor stop control", async () => {
  const h = fixture({ canvasCopy: true });
  const revoke = vi.spyOn(h.bridge, "endCanvasCopyRequest");
  h.choose("a");
  await h.finish(0, "dm-a");
  fireEvent.click(screen.getByRole("button", { name: "Send editor request" }));
  await h.finish(1, "dm-a");
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Stop editor request" }),
    );
  });
  expect(revoke).toHaveBeenCalledExactlyOnceWith("local:a", "dm-a");
  expect(h.ctx.agents.session).toHaveBeenCalledExactlyOnceWith(
    "local:a",
    { channelId: "dm-a" },
    "interrupt",
  );
  expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(
    h.ctx.agents.session.mock.invocationCallOrder[0],
  );
  await expect(
    h.bridge
      .canvasTool()
      .call(
        { key: "local:a", pubkey: "a" },
        { channel: "dm-a" },
        { operation: "listWorkspaces" },
      ),
  ).rejects.toThrow("Start Build from copy");
});

it.each(["interrupt", "new"])(
  "revokes only this editor’s matching request when its native composer requests %s",
  async (action) => {
    const h = fixture();
    const docs = vi.spyOn(h.bridge, "endDocumentRequest");
    const pages = vi.spyOn(h.bridge, "endPageWorkflow");
    const canvas = vi.spyOn(h.bridge, "endCanvasCopyRequest");
    h.choose("a");
    await h.finish(0, "dm-a");
    const notify = preview.onSessionControl;
    notify("a", { channelId: "dm-a" }, "compact");
    notify("b", { channelId: "dm-a" }, action);
    notify("a", { channelId: "other-dm" }, action);
    notify("a", { channelId: "dm-a", root: "thread" }, action);
    for (const revoke of [docs, pages, canvas])
      expect(revoke).not.toHaveBeenCalled();
    notify("a", { channelId: "dm-a" }, action);
    for (const revoke of [docs, pages, canvas])
      expect(revoke).toHaveBeenCalledExactlyOnceWith("local:a", "dm-a");
    expect(h.ctx.agents.session).not.toHaveBeenCalled();
    h.replaceScope();
    notify("a", { channelId: "dm-a" }, action);
    for (const revoke of [docs, pages, canvas])
      expect(revoke).toHaveBeenCalledTimes(1);
    h.replaceScope("community:owner");
    h.view.unmount();
    notify("a", { channelId: "dm-a" }, action);
    for (const revoke of [docs, pages, canvas])
      expect(revoke).toHaveBeenCalledTimes(1);
  },
);

it("refuses a dismissed copy brief before admission and never sends when its open finishes late", async () => {
  const controller = new AbortController();
  const h = fixture({ canvasCopy: true, signal: controller.signal });
  h.choose("a");
  await h.finish(0, "dm-a");
  h.bridge.bind.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Send editor request" }));
  controller.abort();
  expect(h.requests[1].signal.aborted).toBe(true);
  await h.finish(1, "dm-a");
  expect(h.bridge.bind).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send editor request" }));
  expect(h.requests).toHaveLength(2);
  expect(h.send).not.toHaveBeenCalled();
});

it("revokes pending opens and the selection when the live session changes, even at the same scope", async () => {
  const h = fixture();
  h.choose("a");
  h.replaceSession();
  expect(h.requests[0].signal.aborted).toBe(true);
  await h.finish(0, "old-dm");
  expect(screen.getByRole("combobox", { name: "Buzz agent" }).value).toBe("");
  expect(screen.queryByText("Native conversation Agent A")).toBeNull();
  expect(h.bridge.bind).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});

it("rechecks agent eligibility after admission and ignores opens completed after unmount", async () => {
  const h = fixture();
  h.choose("a");
  h.revoke();
  await h.finish(0, "removed-dm");
  expect(screen.getByRole("alert").textContent).toContain(
    "no longer available",
  );
  expect(h.bridge.bind).not.toHaveBeenCalled();
  h.view.unmount();
  const next = fixture();
  next.choose("b");
  next.view.unmount();
  expect(next.requests[0].signal.aborted).toBe(true);
  await next.finish(0, "late-dm");
  expect(next.bridge.bind).not.toHaveBeenCalled();
  expect(next.send).not.toHaveBeenCalled();
});

it("cancels an old workspace opening and binds the next request only to the selected Solo workspace", async () => {
  const h = fixture();
  h.choose("a");
  act(() => {
    writeView("community:owner", editorWorkspaceKey, "two");
  });
  expect(h.requests[0].signal.aborted).toBe(true);
  await h.finish(0, "old-dm");
  expect(h.bridge.bind).not.toHaveBeenCalled();
  h.choose("a");
  await h.finish(1, "new-dm");
  expect(h.bridge.bind).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workspaceId: editorWorkspaceId("community:owner", "two"),
      scope: "community:owner",
    }),
  );
});

it("does not rebind a working agent turn into another Solo workspace", async () => {
  const h = fixture();
  h.choose("a");
  await h.finish(0, "shared-agent-dm");
  h.ctx.agents.sessionState = () => "active";
  act(() => {
    writeView("community:owner", editorWorkspaceKey, "two");
  });
  h.choose("a");
  await h.finish(1, "shared-agent-dm");
  expect(h.bridge.bind).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain(
    "still working in another editor workspace",
  );
});

it("refuses admission if the selected Solo workspace is deleted while its DM opens", async () => {
  writeView("community:owner", editorWorkspaceKey, "two");
  const h = fixture();
  h.choose("a");
  h.deleteWorkspace("two");
  await h.finish(0, "deleted-workspace-dm");
  expect(h.bridge.bind).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
  expect(
    screen
      .getAllByRole("alert")
      .some((item) => item.textContent.includes("no longer available")),
  ).toBe(true);
});
