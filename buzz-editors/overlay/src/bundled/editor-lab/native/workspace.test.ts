import { expect, it } from "vitest";
import { workspacePreferences } from "./workspace";

const store = (id: string) => ({
  snapshot: () => ({
    data: { sections: [{ id, name: id }], assignments: { channel: id } },
  }),
  subscribe: () => () => {},
  ensure: async () => {},
});

it("reads Solo workspaces on Buzz builds that still have soloPreferences", () => {
  const solo = store("solo");
  expect(
    workspacePreferences({
      soloPreferences: solo,
      sidebarPreferences: store("x"),
    }),
  ).toBe(solo);
});

it("reads the unified workspaces from sidebarPreferences on Buzz 1.0.6 and later", () => {
  const sidebar = store("work");
  const preferences = workspacePreferences({ sidebarPreferences: sidebar });
  expect(preferences).toBe(sidebar);
  expect(preferences.snapshot().data?.assignments.channel).toBe("work");
});

it("returns an empty store instead of throwing when neither exists", () => {
  const preferences = workspacePreferences({});
  expect(preferences.snapshot().data).toBeUndefined();
  expect(typeof preferences.subscribe(() => {})).toBe("function");
});
