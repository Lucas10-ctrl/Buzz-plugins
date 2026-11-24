// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../../features/relay/session";
import { WorkspacePicker } from "./WorkspacePicker";

afterEach(cleanup);

function store() {
  return {
    snapshot: () => ({
      status: "ready",
      data: {
        sections: [{ id: "launch", name: "Launch plan" }],
        assignments: {},
      },
    }),
    subscribe: () => () => {},
    ensure: vi.fn(),
  };
}

it.each([
  ["Buzz 1.0.6+ (sidebarPreferences only)", { sidebarPreferences: store() }],
  ["older Buzz (soloPreferences)", { soloPreferences: store() }],
])("lists workspaces on %s", async (_label, session) => {
  const view = render(
    <WorkspacePicker
      session={session as unknown as RelaySession}
      value=""
      onChange={() => {}}
      fullWidth
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add workspace" }));
  expect(
    await screen.findByRole("menuitemradio", { name: "Launch plan" }),
  ).toBeInTheDocument();
  view.rerender(
    <WorkspacePicker
      session={session as unknown as RelaySession}
      value="launch"
      onChange={() => {}}
      fullWidth
    />,
  );
  expect(
    screen.getByRole("button", { name: "Workspace: Launch plan" }),
  ).toBeInTheDocument();
});

it("still renders when Buzz exposes no workspace store", () => {
  render(
    <WorkspacePicker
      session={{} as RelaySession}
      value=""
      onChange={() => {}}
      fullWidth
    />,
  );
  expect(screen.getByText("No workspace")).toBeInTheDocument();
});
