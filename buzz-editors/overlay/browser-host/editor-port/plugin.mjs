import { fileURLToPath, pathToFileURL } from "node:url";

/** Development transport for the same domain store used by the native plugin worker. */
/** @param {string} root
 * @returns {Promise<import("vite").Plugin>} */
export async function editorPortPlugin(root) {
  // Load the staged Node program without bundling its native dependencies into Vite's configuration.
  const runtime = fileURLToPath(
    new URL("../../portable/editor-host/runtime/", import.meta.url),
  );
  const { EditorRepository } = await import(
    pathToFileURL(`${runtime}editor-host/src/store.js`).href
  );
  const { EDITOR_FRAME_MAX_UNITS } = await import(
    pathToFileURL(`${runtime}editor-host/protocol.js`).href
  );
  const { editorGenerationOptions, generationOperations } = await import(
    pathToFileURL(`${runtime}editor-host/src/generation-store.js`).href
  );
  const helper = fileURLToPath(
    new URL(
      `../../src-tauri/resources/bin/${process.platform === "win32" ? "buzz-editor-credentials.exe" : "buzz-editor-credentials"}`,
      import.meta.url,
    ),
  );
  const store = new EditorRepository(
    root,
    editorGenerationOptions(process.env, helper),
  );
  return {
    name: "buzz-editor-port",
    closeBundle: () => store.dispose(),
    configureServer(server) {
      server.middlewares.use("/api/editor-port", async (request, response) => {
        const origin = request.headers.origin;
        if (
          request.method !== "POST" ||
          request.headers["x-buzz-editor-port"] !== "1" ||
          (origin && origin !== `http://${request.headers.host}`)
        ) {
          response.writeHead(403).end();
          return;
        }
        try {
          const chunks = [];
          let bytes = 0;
          for await (const piece of request) {
            const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
            bytes += chunk.length;
            if (bytes > EDITOR_FRAME_MAX_UNITS)
              throw new Error("Editor request is too large");
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          // Browser preview has no authenticated native owner for secure storage or billable jobs.
          if (generationOperations.includes(input?.operation)) {
            response.writeHead(403, { "content-type": "application/json" }).end(
              JSON.stringify({
                ok: false,
                error:
                  "Canvas image generation requires Buzz Desktop’s secure credential store. Open Assets in the desktop lab.",
              }),
            );
            return;
          }
          const value = await store.call(input);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, value: value ?? null }));
        } catch (error) {
          response.setHeader("content-type", "application/json");
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Editor operation failed",
            }),
          );
        }
      });
    },
  };
}
