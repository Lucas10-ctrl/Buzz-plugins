import type { Host, HostProcess } from "../../../features/host/service";
import {
  EditorLines,
  responseSchema,
} from "../../../../portable/editor-host/protocol";
import type { EditorStore } from "./pages-client";
import { processId } from "./editor-package";

type Pending = { resolve(value: unknown): void; reject(error: Error): void };
type Connection = {
  process: HostProcess;
  pending: Map<number, Pending>;
  error?: Error;
};

/** One plugin-owned stdio worker; a failed mutation is never replayed automatically. */
export class DesktopEditorStore implements EditorStore {
  private connecting: Promise<Connection> | undefined;
  private sequence = 0;
  private disposed = false;
  constructor(
    private readonly host: Pick<Host, "spawn">,
    private readonly dataRoot?: string,
  ) {}

  async call<T>(operation: string, input: unknown): Promise<T> {
    if (this.disposed) throw new Error("The editor service has closed");
    const connection = await this.connect();
    if (this.disposed || connection.error)
      throw connection.error ?? new Error("The editor service has closed");
    const id = ++this.sequence;
    const result = new Promise<unknown>((resolve, reject) => {
      connection.pending.set(id, { resolve, reject });
    });
    void result.catch(() => undefined);
    try {
      await connection.process.write(
        `${JSON.stringify({ id, operation, input })}\n`,
      );
    } catch (error) {
      const failure = new Error(
        `Editor write failed. Inspect saved work before retrying: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.fail(connection, failure);
      void connection.process.kill();
    }
    // Original repositories validate returned documents; the versioned envelope is checked below.
    return (await result) as T;
  }

  private connect(): Promise<Connection> {
    if (!this.connecting) {
      const connecting = this.start();
      this.connecting = connecting;
      void connecting.catch(() => {
        if (this.connecting === connecting) this.connecting = undefined;
      });
    }
    return this.connecting;
  }
  private fail(connection: Connection, error: Error): void {
    if (connection.error) return;
    connection.error = error;
    for (const pending of connection.pending.values()) pending.reject(error);
    connection.pending.clear();
    this.connecting = undefined;
  }
  private async start(): Promise<Connection> {
    const spawn = this.host.spawn?.bind(this.host);
    if (!spawn)
      throw new Error(
        "The original editors require Buzz Desktop’s repository host",
      );
    const pending = new Map<number, Pending>();
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A process may fail before spawn resolves; attach the rejection observer immediately.
    void ready.catch(() => undefined);
    let connection: Connection | undefined;
    let failure: Error | undefined;
    let started = false;
    let stderr = "";
    const fail = (error: Error) => {
      failure ??= error;
      rejectReady(error);
      if (connection) {
        this.fail(connection, error);
        void connection.process.kill();
      }
    };
    const lines = new EditorLines((line) => {
      const response = responseSchema.parse(JSON.parse(line));
      if (response.type === "ready") {
        if (started) throw new Error("Editor host sent duplicate startup data");
        started = true;
        resolveReady();
        return;
      }
      if (response.type === "fatal") {
        fail(new Error(response.error));
        return;
      }
      if (!started) throw new Error("Editor host replied before startup");
      const request = pending.get(response.id);
      if (!request)
        throw new Error("Editor host replied to an unknown request");
      pending.delete(response.id);
      if (response.ok) request.resolve(response.value);
      else request.reject(new Error(response.error));
    });
    const process = await spawn(processId("editor-repository"), {
      ...(this.dataRoot === undefined ? {} : { args: [this.dataRoot] }),
      onStdout: (chunk) => {
        try {
          lines.push(chunk);
        } catch {
          fail(new Error("Editor host sent an invalid protocol message"));
        }
      },
      onStderr: (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      },
    });
    connection = { process, pending };
    const current = connection;
    void process.exited.then((code) => {
      try {
        lines.end();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      const details = stderr
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const detail =
        details.find((line) => /^(?:\w*Error\b)/.test(line)) ?? details.at(-1);
      const error = new Error(
        `Editor host stopped (${code ?? "signal"}).${detail ? ` ${detail}` : ""} Inspect saved work before retrying.`,
      );
      rejectReady(error);
      this.fail(current, error);
    });
    try {
      if (failure) throw failure;
      await ready;
      if (failure) throw failure;
      if (this.disposed) throw new Error("The editor service has closed");
      return current;
    } catch (error) {
      await process.kill();
      throw error;
    }
  }

  /** Close stdin so accepted operations drain, then release the native process. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const connection = await this.connecting?.catch(() => undefined);
    if (!connection || connection.error) return;
    await connection.process.end().catch(() => undefined);
    await connection.process.exited;
  }
}
