// A small ACP (Agent Client Protocol) client over a process's stdin/stdout.
// It is copied into plugin.js by build.mjs, and imported directly by the tests.

/** One JSON-RPC connection to an ACP agent. `proc` is { write(text) } and
 * `feed(text)` must be called with everything the process prints on stdout. */
export class AcpConnection {
  constructor(proc, { onUpdate, onPermission, log } = {}) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    this.onUpdate = onUpdate ?? (() => {});
    this.onPermission = onPermission ?? defaultPermission;
    this.log = log ?? (() => {});
  }

  /** Feed stdout text; complete lines are parsed as JSON-RPC messages. */
  feed(text) {
    this.buffer += text;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.log(`ignored non-JSON output: ${line.slice(0, 200)}`);
        continue;
      }
      void this.handle(message);
    }
  }

  /** The process ended: every waiting request fails. */
  close(reason = "Hermes stopped") {
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error(reason));
    this.pending.clear();
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("Hermes is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method, params) {
    return this.send({ jsonrpc: "2.0", method, params });
  }

  send(message) {
    return Promise.resolve(this.proc.write(`${JSON.stringify(message)}\n`));
  }

  async handle(message) {
    // A response to one of our requests.
    if (message.id !== undefined && !message.method) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "Hermes returned an error");
        error.code = message.error.code;
        error.data = message.error.data;
        waiting.reject(error);
      } else waiting.resolve(message.result);
      return;
    }
    // A notification from the agent.
    if (message.method === "session/update") {
      try {
        this.onUpdate(message.params);
      } catch (error) {
        this.log(`update handler failed: ${error}`);
      }
      return;
    }
    // A request from the agent to us.
    if (message.id !== undefined && message.method) {
      try {
        let result;
        if (message.method === "session/request_permission")
          result = await this.onPermission(message.params);
        else {
          await this.send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: `Buzz does not offer ${message.method}` },
          });
          return;
        }
        await this.send({ jsonrpc: "2.0", id: message.id, result });
      } catch (error) {
        await this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: String(error?.message ?? error) },
        });
      }
    }
  }

  initialize() {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "buzz-hermes-plugin", version: "0.1.0" },
    });
  }

  async newSession(cwd, mcpServers = []) {
    const result = await this.request("session/new", { cwd, mcpServers });
    return result.sessionId;
  }

  /** `extra` is more ACP content blocks after the text, such as images. */
  prompt(sessionId, text, extra = []) {
    return this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }, ...extra],
    });
  }

  cancel(sessionId) {
    return this.notify("session/cancel", { sessionId });
  }
}

/** Allows once: Buzz only runs turns its owner asked for. */
export function defaultPermission(params) {
  const options = params?.options ?? [];
  const pick =
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind === "allow_always") ??
    options.find((o) => /allow|approve|yes/i.test(`${o.kind} ${o.name}`));
  if (!pick) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: pick.optionId } };
}

/** Collects one turn's reply and tool steps from session/update notifications. */
export class Turn {
  constructor({ onStep } = {}) {
    this.text = "";
    this.onStep = onStep ?? (() => {});
  }
  update(update) {
    const kind = update?.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const content = update.content;
      if (content?.type === "text" && typeof content.text === "string")
        this.text += content.text;
    } else if (kind === "tool_call") {
      this.onStep(String(update.title || update.kind || "tool"));
    }
  }
}
