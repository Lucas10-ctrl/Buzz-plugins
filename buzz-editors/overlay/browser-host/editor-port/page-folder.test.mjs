import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";

let root, repository, projectRoot;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-page-folder-"));
  repository = new EditorRepository(root);
  ({ projectRoot } = await repository.call({
    operation: "getPageWorkspace",
    input: { workspaceId: "one" },
  }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const choose = (path) =>
  repository.call({
    operation: "validatePageFolder",
    input: { workspaceId: "one", path },
  });

it("returns the original project-relative subfolder without copying or changing its source files", async () => {
  const directory = join(projectRoot, "source", "日本語 café");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), "<h1>Original source</h1>");
  expect(await choose(directory)).toBe("source/日本語 café");
  expect(await choose(join(directory, "..", "日本語 café"))).toBe(
    "source/日本語 café",
  );
});

it("refuses the project root, parent, another workspace and relative picker values", async () => {
  const other = await repository.call({
    operation: "getPageWorkspace",
    input: { workspaceId: "two" },
  });
  for (const path of [
    projectRoot,
    dirname(projectRoot),
    other.projectRoot,
    "source",
  ])
    await expect(choose(path)).rejects.toThrow("inside this editor workspace");
});

it("refuses symlinked directories, regular files and missing folders", async () => {
  const directory = join(projectRoot, "real");
  await mkdir(directory);
  await mkdir(join(directory, "nested"));
  await symlink(directory, join(projectRoot, "alias"), "dir");
  await writeFile(join(projectRoot, "index.html"), "<h1>Source</h1>");
  await expect(choose(join(projectRoot, "alias", "nested"))).rejects.toThrow(
    "without symbolic links",
  );
  await expect(choose(join(projectRoot, "index.html"))).rejects.toThrow(
    "must be a directory",
  );
  await expect(choose(join(projectRoot, "missing"))).rejects.toThrow();
});
