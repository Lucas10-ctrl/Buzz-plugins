import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository } from "../../../../portable/editor-host/src/store.ts";
import { EditorAgentBridge } from "./agent-bridge";
import { editorWorkspaceId } from "./workspace";

let root, repository;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-brand-"));
  repository = new EditorRepository(root);
});
afterEach(async () => {
  await repository.dispose();
  await rm(root, { recursive: true, force: true });
});
const call = (operation, input) => repository.call({ operation, input });
const guide = (
  workspaceId,
  css = ":root { --brand: #123456; --gap: 16px; } h1 { font-family: Inter; font-size: 32px; }",
) => ({
  workspaceId,
  name: "Client styles",
  css,
  sourceType: "file",
  sourceLabel: "client.css",
  expectedRevision: null,
});
const brand = (workspaceId) => ({
  workspaceId,
  title: "Client",
  positioning: "Helpful",
  audience: "Owners",
  voice: "Plain",
  differentiators: "Care",
  guardrails: "No hype",
});

it("keeps original project formats and Canvas tokens inside each Solo workspace, preserving unfiled work", async () => {
  const scope = "community:viewer";
  const one = editorWorkspaceId(scope, "one"),
    two = editorWorkspaceId(scope, "two");
  expect(editorWorkspaceId(scope, "")).toBe(scope);
  expect(editorWorkspaceId("another:viewer", "one")).not.toBe(one);
  await call("createBrand", brand(one));
  const saved = await call("saveStyleGuide", guide(one));
  const context = await call("readBrandContext", { workspaceId: one });
  expect(context.brands[0]).toMatchObject({
    title: "Client",
    voice: "Plain",
    guardrails: "No hype",
  });
  expect(context.guide).toEqual(saved.guide);
  expect(await call("getStyleGuide", { workspaceId: one })).toEqual(
    saved.guide,
  );
  expect(saved.guide.tokens.colors).toContain("#123456");
  expect(saved.guide.tokens.fonts).toContain("Inter");
  const { projectRoot } = await call("getPageWorkspace", { workspaceId: one });
  expect(
    JSON.parse(
      await readFile(join(projectRoot, "copyos.style-guide.json"), "utf8"),
    ),
  ).toMatchObject({ schema: "copyos.style-guide", css: guide(one).css });
  expect(await call("readBrandContext", { workspaceId: two })).toEqual({
    brands: [],
    guide: undefined,
    guideRevision: null,
  });
  expect(
    (await call("readBrandContext", { workspaceId: scope })).brands,
  ).toEqual([]);
  expect(await call("listPages", one)).toEqual([]);
});

it("rejects concurrent and stale replacements, including same-timestamp content changes", async () => {
  const results = await Promise.allSettled([
    call("saveStyleGuide", guide("one")),
    call("saveStyleGuide", guide("one", ":root { --brand: red; }")),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    results.find((result) => result.status === "rejected").reason.message,
  ).toContain("changed");
  const before = await call("readBrandContext", { workspaceId: "one" });
  const next = await call("saveStyleGuide", {
    ...guide("one", ":root { --brand: blue; }"),
    expectedRevision: before.guideRevision,
  });
  expect(next.guide.createdAt).toBe(before.guide.createdAt);
  expect(next.guideRevision).not.toBe(before.guideRevision);
  await expect(
    call("saveStyleGuide", {
      ...guide("one"),
      expectedRevision: before.guideRevision,
    }),
  ).rejects.toThrow("changed");
  expect(
    (await call("readBrandContext", { workspaceId: "one" })).guide.css,
  ).toContain("blue");
});

it("refuses linked brand directories and guide files without modifying the source", async () => {
  const a = await call("getPageWorkspace", { workspaceId: "one" });
  const b = await call("getPageWorkspace", { workspaceId: "two" });
  await call("saveStyleGuide", guide("two"));
  await call("createBrand", brand("two"));
  await symlink(join(b.projectRoot, "brand"), join(a.projectRoot, "brand"));
  await expect(call("createBrand", brand("one"))).rejects.toThrow(
    "symbolic link",
  );
  await rm(join(a.projectRoot, "brand"));
  await symlink(
    join(b.projectRoot, "copyos.style-guide.json"),
    join(a.projectRoot, "copyos.style-guide.json"),
  );
  await expect(
    call("readBrandContext", { workspaceId: "one" }),
  ).rejects.toThrow("symbolic link");
  expect(
    (await call("readBrandContext", { workspaceId: "two" })).brands,
  ).toHaveLength(1);
});

it("gives existing Buzz agents the selected workspace's brand data and refuses another workspace", async () => {
  const bridge = new EditorAgentBridge({ call });
  const tool = bridge.brandTool(),
    agent = { key: "local:agent", pubkey: "agent" },
    context = { channel: "dm" };
  await expect(
    tool.call(agent, context, { operation: "readBrandContext" }),
  ).rejects.toThrow("Open this agent");
  bridge.bind({
    workspaceId: "one",
    scope: "community:viewer",
    agentKey: agent.key,
    agent: agent.pubkey,
    channel: "dm",
  });
  await tool.call(agent, context, {
    operation: "createBrand",
    input: brand("one"),
  });
  const result = JSON.parse(
    await tool.call(agent, context, { operation: "readBrandContext" }),
  );
  expect(result.brands[0].voice).toBe("Plain");
  await expect(
    tool.call(agent, context, {
      operation: "readBrandContext",
      input: { workspaceId: "two" },
    }),
  ).rejects.toThrow("differs");
  await expect(
    tool.call({ ...agent, pubkey: "other" }, context, {
      operation: "readBrandContext",
    }),
  ).rejects.toThrow("Open this agent");
  bridge.clear();
  await expect(
    tool.call(agent, context, { operation: "readBrandContext" }),
  ).rejects.toThrow("Open this agent");
});
