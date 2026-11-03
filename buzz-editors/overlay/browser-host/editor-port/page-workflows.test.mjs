import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  mkdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";

let root;
let store;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-workflow-"));
  store = new EditorRepository(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const prepare = (workspaceId, workflow, extra = {}) =>
  store.call({
    operation: "preparePageWorkflow",
    input: { workspaceId, workflow, ...extra },
  });

it("refuses linked workspace directories before placing any workflow files outside their scope", async () => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "workspaces"));
  await expect(prepare("community", "copyos-web-clone")).rejects.toThrow(
    "parent must not be a symbolic link",
  );
  expect(await readdir(outside)).toEqual([]);
  await rm(join(root, "workspaces"));
  await mkdir(join(root, "workspaces"));
  const id = createHash("sha256").update("community").digest("hex");
  await symlink(outside, join(root, "workspaces", id));
  await expect(prepare("community", "copyos-web-clone")).rejects.toThrow(
    "workspace must not be a symbolic link",
  );
  expect(await readdir(outside)).toEqual([]);
});

it("retains runnable original clone scripts and references in the bound workspace without overwriting previous files", async () => {
  const prepared = await prepare("community", "copyos-web-clone");
  expect(relative(root, prepared.projectRoot)).toMatch(/^workspaces\//);
  expect(relative(prepared.projectRoot, prepared.baseDirectory)).toMatch(
    /^\.buzz-workflow-/,
  );
  expect(prepared.guide).toContain("source discovery");
  expect(prepared.guide).toContain(
    "baseDirectory returned by buzz_pages prepareWorkflow",
  );
  expect(prepared.guide).not.toContain("Harness `skill` tool");
  const reference = await readFile(
    join(prepared.baseDirectory, "references/deliverables.md"),
    "utf8",
  );
  expect(reference.length).toBeGreaterThan(100);
  const result = execFileSync(
    process.execPath,
    [
      join(prepared.baseDirectory, "scripts/init-clone.mjs"),
      "validation",
      "--url",
      "https://example.com",
      "--in-place",
    ],
    { cwd: prepared.projectRoot, encoding: "utf8" },
  );
  expect(result.trim()).toBe(prepared.projectRoot);
  expect(
    await readFile(join(prepared.projectRoot, "NOTES.md"), "utf8"),
  ).toContain("https://example.com");
  // A previous run can leave links; the next preparation gets a fresh directory.
  await symlink(
    join(prepared.projectRoot, "NOTES.md"),
    join(prepared.baseDirectory, "previous-output"),
  );
  const next = await prepare("community", "copyos-web-clone");
  expect(next.baseDirectory).not.toBe(prepared.baseDirectory);
  expect(await readdir(next.baseDirectory)).not.toContain("previous-output");
  const other = await prepare("other-community", "copyos-web-clone");
  expect(other.projectRoot).not.toBe(prepared.projectRoot);
});

it("keeps the full original Shopify requirements and routes its missing validator through the native operation", async () => {
  const prepared = await prepare("community", "shopify-section-export");
  expect(prepared.guide).toContain("FULL-PAGE MODE");
  expect(prepared.guide).toContain("six core blocks");
  expect(prepared.guide).toContain("validateShopifyExport");
  expect(prepared.guide).not.toContain("python <skill-folder>");
  expect(prepared.limitations).toEqual([
    expect.stringContaining(
      "actual Shopify upload require separate verification",
    ),
  ]);
  await expect(prepare("community", "../../private")).rejects.toThrow();
  await expect(
    prepare("community", "copyos-web-clone", { destination: "/tmp/unowned" }),
  ).rejects.toThrow();
});
