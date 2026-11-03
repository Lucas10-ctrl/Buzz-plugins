/** The desktop worker owns only document repositories and files; it has no agent harness or identity keys. */
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { once } from "node:events";
import { EditorRepository } from "./store.ts";
import {
  EditorLines,
  EDITOR_PROTOCOL_VERSION,
  requestSchema,
  type EditorResponse,
} from "../protocol.ts";

function defaultRoot(): string {
  const parent =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
        : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(parent, "buzz-editor-lab");
}
/** Run the same original repositories as the development host, draining accepted writes before stdin closes.
 * @param root - Absolute, isolated editor data directory; omission uses the plugin's own platform data folder.
 * @returns Once all accepted requests and output have settled.
 */
export async function start(root = defaultRoot()): Promise<void> {
  if (!isAbsolute(root))
    throw new Error("The editor data directory must be absolute");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const store = new EditorRepository(await realpath(root));
  const pending = new Set<Promise<void>>();
  let writes: Promise<void> = Promise.resolve();
  const emit = (value: EditorResponse): Promise<void> => {
    const line = `${JSON.stringify(value)}\n`;
    writes = writes.then(async () => {
      if (!process.stdout.write(line)) await once(process.stdout, "drain");
    });
    return writes;
  };
  const respond = async (source: string): Promise<void> => {
    const request = requestSchema.parse(JSON.parse(source));
    try {
      const value = await store.call({
        operation: request.operation,
        input: request.input,
      });
      await emit({
        type: "result",
        id: request.id,
        ok: true,
        value: value ?? null,
      });
    } catch (error) {
      await emit({
        type: "result",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  let fatal: Error | undefined;
  const lines = new EditorLines((source) => {
    const operation = respond(source).catch((error) => {
      fatal = error instanceof Error ? error : new Error(String(error));
      process.stdin.destroy();
    });
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  });
  await emit({ type: "ready", version: EDITOR_PROTOCOL_VERSION });
  process.stdin.setEncoding("utf8");
  try {
    for await (const chunk of process.stdin) {
      if (typeof chunk !== "string")
        throw new Error("Editor input must be UTF-8 text");
      lines.push(chunk);
    }
    lines.end();
  } catch (error) {
    fatal ??= error instanceof Error ? error : new Error(String(error));
  }
  await Promise.all(pending);
  if (fatal) {
    await emit({ type: "fatal", error: fatal.message });
    process.exitCode = 1;
  }
  try {
    await writes;
  } finally {
    await store.dispose();
  }
}
