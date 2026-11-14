// @vitest-environment jsdom
// The card, panel and Settings page drawn by React, with a fake recorder.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./git";
import { apply } from "./index";
import { targetFor } from "./target";
import type { Turn, Turns } from "./turns";

afterEach(cleanup);

const AGENT = "a".repeat(64);
const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "",
].join("\n");
const FILES: ChangedFile[] = [
  { path: "src/a.ts", status: "modified", additions: 1, deletions: 1, binary: false },
  { path: "docs/readme.md", status: "added", additions: 4, deletions: 0, binary: false },
  { path: "img/logo.png", status: "modified", additions: 0, deletions: 0, binary: true },
];
const TURN: Turn = {
  id: "t1",
  agent: AGENT,
  channelId: "chan",
  thread: "R".repeat(64),
  viewer: "me",
  origin: "https://relay.example",
  start: 1,
  end: 2,
  message: { id: "m1", at: 2 },
  checkouts: [{ dir: "/repo", prefix: "", label: "repo (main)", before: "b", after: "a", files: 3 }],
};

function fakeTurns(): Turns {
  return {
    watch: () => () => {},
    subscribe: () => () => {},
    version: () => 1,
    flush: () => {},
    claim: vi.fn(),
    cardsFor: (id: string) => (id === "m1" ? [TURN] : []),
    summary: async () => FILES,
    patch: vi.fn(async () => PATCH),
    images: async () => ({ before: new Uint8Array([1, 2, 3]), after: new Uint8Array([4, 5, 6, 7]) }),
    find: (id: string, index: number) =>
      id === "t1" && index === 0 ? { turn: TURN, checkout: TURN.checkouts[0], after: "a" } : undefined,
  } as unknown as Turns;
}

function setup({ running = true, saved = {} as Record<string, string> } = {}) {
  const got: Record<string, any> = {};
  const wakes: unknown[] = [];
  const storage = new Map(Object.entries(saved));
  const turns = fakeTurns();
  apply(
    {
      react: React,
      host: {},
      effect: () => {},
      agents: {
        snapshot: () => ({ running: running ? [{ key: `${AGENT}@relay`, pubkey: AGENT }] : [] }),
        wake: (key: string, wake: unknown) => wakes.push([key, wake]),
      },
      conversation: { registerAccessory: (a: unknown) => (got.accessory = a) },
      panels: { register: (p: unknown) => (got.panel = p) },
      settingsCards: { register: (s: unknown) => (got.settings = s) },
    },
    {
      turns,
      storage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      } as Storage,
    },
  );
  return { got, wakes, turns, storage };
}

const message = (id: string) => ({ id, channelId: "chan", authorId: AGENT, createdAt: 2 });

describe("registration", () => {
  it("registers a message card, a panel and a Settings page", () => {
    const { got } = setup();
    expect(got.accessory).toMatchObject({ id: "changes", placement: "message" });
    expect(got.panel.matches(targetFor("t1", 0, "src/a.ts"))).toBe(true);
    expect(got.panel.matches("https://example.com/")).toBe(false);
    expect(got.settings).toMatchObject({ id: "changesets", title: "Changesets", group: "App" });
  });
});

describe("the card", () => {
  it("lists the turn's files under its last message, and opens one", async () => {
    const { got, turns } = setup();
    const open = vi.fn(() => true);
    render(React.createElement(got.accessory.component, { message: message("m1"), canOpen: () => true, open }));
    expect(turns.claim).toHaveBeenCalled();
    await screen.findByText("src/");
    expect(screen.getByLabelText("Changeset: repo (main)").textContent).toContain("3 files changed");
    expect(screen.getByText("picture")).toBeTruthy();
    fireEvent.click(screen.getByTitle("src/a.ts"));
    expect(open).toHaveBeenCalledWith(targetFor("t1", 0, "src/a.ts"));
  });

  it("is empty under other messages", () => {
    const { got } = setup();
    const { container } = render(
      React.createElement(got.accessory.component, { message: message("m2"), canOpen: () => true, open: () => true }),
    );
    expect(container.textContent).toBe("");
  });
});

describe("the panel", () => {
  const renderPanel = (got: Record<string, any>, file = "src/a.ts") =>
    render(React.createElement(got.panel.component, { target: targetFor("t1", 0, file), close: () => {} }));

  it("shows a file in one column, then side by side", async () => {
    const { got } = setup();
    renderPanel(got);
    await screen.findByText("TWO");
    expect(screen.getByRole("radio", { name: "One column" }).getAttribute("aria-checked")).toBe("true");
    // One column: old and new numbers in separate gutters, a row per line.
    const rows = () => [...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows()).toContain("2+TWOAsk");
    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    await waitFor(() => expect(rows().some((r) => r?.includes("two") && r.includes("TWO"))).toBe(true));
  });

  it("follows the saved layout and asks git for the saved context", async () => {
    const { got, turns } = setup({ saved: { "lucas.changesets-plus.prefs.v1": JSON.stringify({ layout: "split", context: 10 }) } });
    renderPanel(got);
    await screen.findByText("TWO");
    expect(screen.getByRole("radio", { name: "Side by side" }).getAttribute("aria-checked")).toBe("true");
    expect(turns.patch).toHaveBeenCalledWith("t1", 0, FILES[0], 10);
  });

  it("filters the file list", async () => {
    const { got } = setup();
    renderPanel(got);
    await screen.findByText("TWO");
    const list = () => screen.getByRole("list", { name: "Changed files" }).textContent;
    expect(list()).toContain("readme.md");
    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "img" } });
    expect(list()).not.toContain("readme.md");
    expect(list()).toContain("logo.png");
    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "nothing" } });
    expect(list()).toContain("No files match.");
  });

  it("shows a picture before and after", async () => {
    const { got } = setup();
    globalThis.URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    globalThis.URL.revokeObjectURL = vi.fn();
    renderPanel(got, "img/logo.png");
    const before = await screen.findByAltText("img/logo.png, before");
    const after = screen.getByAltText("img/logo.png, after");
    expect(before.getAttribute("src")).toMatch(/^blob:/);
    expect(after.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.getByText(/Before/).textContent).toContain("3 B");
    expect(screen.getByText(/After/).textContent).toContain("4 B");
  });

  it("asks the agent about a line in the turn's thread", async () => {
    const { got, wakes } = setup();
    renderPanel(got);
    await screen.findByText("TWO");
    // Old line 2 ("two") and new line 2 ("TWO"): ask about the added one.
    const buttons = screen.getAllByLabelText("Ask about line 2");
    fireEvent.click(buttons[buttons.length - 1] as Element);
    fireEvent.change(screen.getByPlaceholderText("Your question (optional)"), { target: { value: "Why uppercase?" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ask agent" })));
    expect(wakes).toHaveLength(1);
    const [key, wake] = wakes[0] as [string, { channel: string; root: string; text: string }];
    expect(key).toBe(`${AGENT}@relay`);
    expect(wake.channel).toBe("chan");
    expect(wake.root).toBe("r".repeat(64));
    expect(wake.text).toContain("`src/a.ts` in `/repo`, line 2 (after your change)");
    expect(wake.text).toContain("Their question: Why uppercase?");
  });

  it("says when the agent isn't running here", async () => {
    const { got, wakes } = setup({ running: false });
    renderPanel(got);
    await screen.findByText("TWO");
    fireEvent.click(screen.getAllByLabelText("Ask about line 1")[0] as Element);
    expect(screen.getByRole("button", { name: "Ask agent" }).hasAttribute("disabled")).toBe(true);
    expect(wakes).toHaveLength(0);
  });

  it("says when the changeset isn't on this computer", () => {
    const { got } = setup();
    render(React.createElement(got.panel.component, { target: targetFor("zzz", 0), close: () => {} }));
    expect(screen.getByRole("alert").textContent).toContain("another Buzz");
  });
});

describe("Settings", () => {
  it("changes the layout and text size, with a live preview", async () => {
    const { got, storage } = setup();
    render(React.createElement(got.settings.component, { active: () => true }));
    expect(screen.getByText("Preview")).toBeTruthy();
    const sample = () => document.querySelector("tbody tr td:last-child") as HTMLElement;
    expect(sample().style.fontSize).toBe("13px");
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(sample().style.fontSize).toBe("15px");
    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(JSON.parse(storage.get("lucas.changesets-plus.prefs.v1") as string)).toMatchObject({ layout: "split", size: "lg" });
    // Side by side: a row holds the old and new line.
    const first = document.querySelector("tbody tr")?.textContent ?? "";
    expect(first).toContain("export function greet(name) {");
    expect(first).toContain('export function greet(name = "there") {');
  });
});
