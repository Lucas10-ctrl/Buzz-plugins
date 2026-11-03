import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { pickPageFolder } from "./page-folder.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  isTauri.mockReturnValue(true);
});

it("opens Buzz’s existing folder picker at the bound project and validates its result through the same repository", async () => {
  const store = {
    call: vi.fn(async (operation) =>
      operation === "getPageWorkspace"
        ? { projectRoot: "/isolated/workspace" }
        : "source/site",
    ),
  };
  invoke.mockResolvedValue("/isolated/workspace/source/site");
  expect(await pickPageFolder(store, "current")).toBe("source/site");
  expect(invoke).toHaveBeenCalledWith("workspace_pick_folder", {
    title: "Choose a subfolder in this editor workspace",
    start: "/isolated/workspace",
  });
  expect(store.call.mock.calls).toEqual([
    ["getPageWorkspace", { workspaceId: "current" }],
    [
      "validatePageFolder",
      { workspaceId: "current", path: "/isolated/workspace/source/site" },
    ],
  ]);
});

it("preserves cancellation without validating or changing the selected subfolder", async () => {
  const store = {
    call: vi.fn(async () => ({ projectRoot: "/isolated/workspace" })),
  };
  invoke.mockResolvedValue(null);
  expect(await pickPageFolder(store, "current")).toBeNull();
  expect(store.call).toHaveBeenCalledTimes(1);
});

it("returns picker and validation failures to the original form and refuses unsupported web picking", async () => {
  const store = {
    call: vi.fn(async (operation) => {
      if (operation === "getPageWorkspace")
        return { projectRoot: "/isolated/workspace" };
      throw new Error("Choose a subfolder inside this editor workspace");
    }),
  };
  invoke.mockRejectedValueOnce(new Error("Picker failed"));
  await expect(pickPageFolder(store, "current")).rejects.toThrow(
    "Picker failed",
  );
  invoke.mockResolvedValue("/other/project");
  await expect(pickPageFolder(store, "current")).rejects.toThrow(
    "inside this editor workspace",
  );
  isTauri.mockReturnValue(false);
  store.call.mockClear();
  await expect(pickPageFolder(store, "current")).rejects.toThrow(
    "web preview has no native folder picker",
  );
  expect(store.call).not.toHaveBeenCalled();
});
