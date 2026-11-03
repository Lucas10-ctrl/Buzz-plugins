// Artifact-backed HTTP acceptance: stage the repository runtime before running this file.
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { editorPortPlugin } from "./plugin.mjs";
import { generationOperations } from "../../portable/editor-host/src/generation-store.ts";
it("refuses every native generation operation at the browser development route before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "buzz-editor-http-"));
  const plugin = await editorPortPlugin(root);
  let handler;
  plugin.configureServer({
    middlewares: {
      use: (_path, value) => {
        handler = value;
      },
    },
  });
  const server = createServer((request, response) =>
    handler(request, response),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/editor-port`;
  try {
    for (const operation of generationOperations) {
      // Empty inputs are deliberate: even a missing guard cannot reach OS credentials.
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-buzz-editor-port": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation, input: {} }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: expect.stringContaining("Buzz Desktop"),
      });
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-buzz-editor-port": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operation: "listPages",
        input: "fixture",
      }),
    });
    expect(response.status).toBe(200);
  } finally {
    await plugin.closeBundle();
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});
