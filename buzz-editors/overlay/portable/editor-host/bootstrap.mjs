/** Materialize the immutable runtime archive because Tauri resources omit directory symlinks. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "tar";

/** Start the repository worker with an isolated executable tree, removed after accepted writes drain. */
export async function start(dataRoot) {
  const runtime = await mkdtemp(join(tmpdir(), "buzz-editor-runtime-"));
  let stopping = false;
  const stop = () => {
    stopping = true;
    // End the worker's input without abandoning operations it already accepted.
    process.stdin.push(null);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await extract({
      file: join(dirname(fileURLToPath(import.meta.url)), "editor-host.tgz"),
      cwd: runtime,
      strict: true,
    });
    if (stopping) return;
    const worker = await import(
      pathToFileURL(join(runtime, "editor-host/src/worker.js")).href
    );
    await worker.start(dataRoot);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await rm(runtime, { recursive: true, force: true });
  }
}
