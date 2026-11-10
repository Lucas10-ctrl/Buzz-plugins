// OpenCode connector for Buzz: an agent type whose agents run OpenCode on this
// computer. Each agent runs `opencode acp` and sets its chosen model on every
// session; each conversation it is in (a thread, a DM or a Solo chat) is one
// ACP session.
import { AcpConnection, Turn, setModel } from "../acp.js";

export const inject = ["react", "agents", "host"];

const TYPE_ID = "opencode";
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:@\/-]{0,200}$/;
const DEFAULT_MODEL = "lemonade/Qwen3.8-Flash-Next-Halogen";
const START_MS = 90_000;
const HEX64 = /^[0-9a-f]{64}$/;

export function apply(ctx) {
  const { agents, host } = ctx;
  const React = ctx.react;
  const runtime = new Runtime(host);
  ctx.effect(() => () => runtime.dispose());

  let modelsPromise;
  const loadModels = () =>
    (modelsPromise ??= host
      .runCommand("models")
      .then((out) =>
        String(out ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((name) => MODEL.test(name) && name.includes("/")),
      )
      .catch(() => []));

  const { Create, SettingsTab } = createViews(React, loadModels);

  agents.register({
    id: TYPE_ID,
    title: "OpenCode",
    description:
      "OpenCode on this computer, on the model you pick, including your local Lemonade models. Each thread it is mentioned in is one continuing session.",
    defaults: () => ({ config: { model: DEFAULT_MODEL } }),
    summary: (agent) => `OpenCode · ${modelOf(agent.config)}`,
    Create,
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: SettingsTab }],
    timeoutMs: 5 * 60_000,
    // Buzz refuses to start an agent with synced settings unless its type
    // declares them. The model syncs; a synced copy without one keeps the
    // model saved on this device.
    syncedSettings: {
      schema: { model: "string" },
      withSynced: (config, settings) => ({
        ...config,
        model: typeof settings?.model === "string" ? settings.model : modelOf(config),
      }),
    },
    run: (delivery) => runtime.run(delivery),
  });
}

const modelOf = (config) => {
  const name = typeof config?.model === "string" ? config.model.trim() : "";
  return MODEL.test(name) && name.includes("/") ? name : DEFAULT_MODEL;
};

// ── Running agents ──────────────────────────────────────────────────────────

class Runtime {
  constructor(host) {
    this.host = host;
    this.workers = new Map(); // agent key -> Worker
    this.channelKinds = new Map(); // channel id -> Promise<"flat" | "threads">
  }

  dispose() {
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
  }

  worker(key, model) {
    const current = this.workers.get(key);
    if (current && current.model === model && !current.dead) return current;
    current?.stop();
    this.home ??= this.host
      .runCommand("home")
      .then((out) => (String(out ?? "").startsWith("/") ? String(out) : "/"))
      .catch(() => "/");
    const worker = new Worker(this.host, model, this.home);
    this.workers.set(key, worker);
    return worker;
  }

  run(delivery) {
    const { trigger, agent } = delivery;
    if (trigger.type !== "mention") return void delivery.ignored?.();
    const event = trigger.event;
    // Only the owner's own messages: the agent works with the owner's access.
    if (!event || event.pubkey !== agent.owner) return void delivery.ignored?.();
    const channel = delivery.channelId ?? tagValue(event, "h");
    if (!channel) return void delivery.ignored?.();
    const model = modelOf(delivery.config);
    delivery.acknowledged?.();

    const done = this.turn(delivery, { event, agent, channel, model }).then(
      () => ({ ok: true }),
      async (error) => {
        const message = String(error?.message ?? error).slice(0, 500);
        const flat = (await this.channelKind(agent, channel)) === "flat";
        await reply(agent, channel, flat ? null : rootOf(event), `⚠️ OpenCode couldn't answer: ${message}`).catch(() => {});
        return { ok: false, error: message };
      },
    );
    delivery.workingUntil(done);
  }

  async turn(delivery, { event, agent, channel, model }) {
    const flat = (await this.channelKind(agent, channel)) === "flat";
    const root = flat ? null : rootOf(event);
    const place = flat ? channel : `${channel}/${root}`;
    const worker = this.worker(agent.key, model);
    const { sessionId, fresh } = await worker.session(place);
    delivery.interruptible?.(() => worker.cancel(sessionId));

    let text = "";
    if (fresh) {
      text += intro(agent.name);
      const history = await recentMessages(agent, channel, root, event).catch(() => []);
      if (history.length) text += `\n\nEarlier in this conversation:\n${history.join("\n")}`;
      text += "\n\n";
    }
    text += `New message from your owner:\n${messageText(event.content)}`;

    const answer = await worker.prompt(sessionId, text, (step) => delivery.step?.(step));
    if (answer.trim()) await reply(agent, channel, flat ? null : root, answer.trim());
  }

  /** DMs and Solo chats are answered at the top level; channels in the thread. */
  channelKind(agent, channel) {
    let kind = this.channelKinds.get(channel);
    if (!kind) {
      kind = agent
        .query([{ kinds: [39000], "#d": [channel], limit: 1 }])
        .then(([meta]) => {
          if (!meta) return "threads";
          const tags = meta.tags ?? [];
          const isDm = tags.some((t) => t[0] === "t" && t[1] === "dm");
          const isSolo =
            tags.some((t) => t[0] === "private") &&
            tags.some((t) => t.some((v, i) => i > 0 && /solo/i.test(String(v))));
          return isDm || isSolo ? "flat" : "threads";
        })
        .catch(() => "threads");
      this.channelKinds.set(channel, kind);
    }
    return kind;
  }
}

class Worker {
  constructor(host, model, home) {
    this.host = host;
    this.home = home;
    this.model = model;
    this.dead = false;
    this.sessions = new Map(); // place -> Promise<sessionId>
    this.turns = new Map(); // sessionId -> Turn
    this.queues = new Map(); // sessionId -> Promise
    this.stderr = "";
    this.ready = this.start();
    this.ready.catch(() => this.stop());
  }

  async start() {
    this.acp = new AcpConnection(
      { write: (text) => this.proc.write(text) },
      {
        onUpdate: (params) => this.turns.get(params?.sessionId)?.update(params?.update),
        log: (line) => console.warn(`[opencode ${this.model}] ${line}`),
      },
    );
    this.proc = await this.host.spawn("opencode", {
      args: ["acp"],
      cwd: "~",
      onStdout: (text) => this.acp.feed(text),
      onStderr: (text) => {
        this.stderr = (this.stderr + text).slice(-4000);
      },
    });
    void this.proc.exited.then((code) => {
      this.dead = true;
      this.acp.close(`OpenCode stopped (exit ${code ?? "signal"}). ${lastLine(this.stderr)}`.trim());
    });
    await withTimeout(this.acp.initialize(), START_MS, "OpenCode took too long to start");
  }

  async session(place) {
    await this.ready;
    let entry = this.sessions.get(place);
    if (entry) return { sessionId: await entry, fresh: false };
    entry = this.home.then(async (cwd) => {
      const sessionId = await this.acp.newSession(cwd);
      await setModel(this.acp, sessionId, this.model);
      return sessionId;
    });
    this.sessions.set(place, entry);
    entry.catch(() => this.sessions.delete(place));
    return { sessionId: await entry, fresh: true };
  }

  /** Runs one prompt after any earlier one in the same session. */
  prompt(sessionId, text, onStep) {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const turn = new Turn({ onStep });
        this.turns.set(sessionId, turn);
        try {
          const result = await this.acp.prompt(sessionId, text);
          if (result?.stopReason === "cancelled") return "";
          return turn.text;
        } finally {
          if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
        }
      });
    this.queues.set(sessionId, next);
    return next;
  }

  async cancel(sessionId) {
    await this.acp?.cancel(sessionId).catch(() => {});
  }

  stop() {
    this.dead = true;
    void this.proc?.kill();
  }
}

// ── Messages ────────────────────────────────────────────────────────────────

const intro = (name) =>
  `You are ${name}, running as an agent in Buzz, your owner's team chat. ` +
  "Your final reply is posted into this Buzz conversation for you, so write it as a chat message " +
  "(Markdown is fine) and don't say that you will post it. Keep it as short as the request allows.";

const MENTION_LINK = /\[(?:\\.|[^\]\\])*\]\(nostr:(?:npub|nprofile|note|nevent)1[a-z0-9]+\)/g;
const MENTION_BARE = /nostr:(?:npub|nprofile|note|nevent)1[a-z0-9]+/g;
const messageText = (content) =>
  String(content ?? "")
    .replace(MENTION_LINK, (link) => link.replace(/\]\(.*$/, "").replace(/^\[/, ""))
    .replace(MENTION_BARE, "")
    .trim();

function tagValue(event, name) {
  return event?.tags?.find((t) => t[0] === name)?.[1];
}

/** The thread an event is in, by its NIP-10 markers; a top-level event is its own root. */
function rootOf(event) {
  const marked = (event.tags ?? []).filter((t) => t[0] === "e" && HEX64.test(t[1] ?? ""));
  const root = marked.find((t) => t[3] === "root");
  const reply = marked.find((t) => t[3] === "reply");
  return (root && reply ? root : reply ?? root)?.[1] ?? event.id;
}

async function recentMessages(agent, channel, root, current) {
  const filters =
    root && root !== current.id
      ? [{ ids: [root] }, { kinds: [9], "#e": [root], limit: 30 }]
      : root
        ? []
        : [{ kinds: [9], "#h": [channel], limit: 20 }];
  if (!filters.length) return [];
  const events = await agent.query(filters);
  const seen = new Set();
  return events
    .filter((e) => e.id !== current.id && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-30)
    .map((e) => {
      const who = e.pubkey === agent.pubkey ? "You" : e.pubkey === agent.owner ? "Owner" : `Member ${e.pubkey.slice(0, 8)}`;
      return `${who}: ${messageText(e.content).slice(0, 2000)}`;
    });
}

function reply(agent, channel, root, content) {
  const tags = [["h", channel]];
  if (root) tags.push(["e", root, "", "reply"]);
  return agent.publish({ kind: 9, content, tags });
}

const lastLine = (text) => text.trim().split("\n").pop()?.slice(0, 300) ?? "";

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ── Views ───────────────────────────────────────────────────────────────────

function createViews(React, loadModels) {
  const h = React.createElement;

  function useModels() {
    const [models, setModels] = React.useState(null);
    React.useEffect(() => {
      let live = true;
      void loadModels().then((list) => live && setModels(list));
      return () => {
        live = false;
      };
    }, []);
    return models;
  }

  const labelStyle = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };
  const hintStyle = { fontSize: 12, opacity: 0.7 };
  const selectStyle = {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid rgba(127,127,127,0.4)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
  };

  function ModelField({ value, onChange, disabled, models }) {
    const options = models ?? [];
    const known = options.includes(value);
    return h(
      "label",
      { style: labelStyle },
      h("span", null, "Model"),
      h(
        "select",
        {
          value,
          disabled: disabled || models === null,
          onChange: (e) => onChange(e.target.value),
          style: selectStyle,
        },
        ...options.map((name) => h("option", { key: name, value: name }, name)),
        known ? null : h("option", { value }, models === null ? value : `${value} (not found)`),
      ),
      h(
        "span",
        { style: hintStyle },
        models === null
          ? "Asking OpenCode for its models…"
          : "Runs `opencode acp` on this model. Lemonade models start with lemonade/.",
      ),
    );
  }

  function Create({ config, onChange, disabled }) {
    const models = useModels();
    const model = modelOf(config);
    return h(ModelField, {
      value: model,
      disabled,
      models,
      onChange: (next) => onChange({ ...config, model: next }),
    });
  }

  function SettingsTab({ agent, save, settingsHost }) {
    const models = useModels();
    const saved = modelOf(agent.config);
    const [draft, setDraft] = React.useState(saved);
    const [status, setStatus] = React.useState("");
    const changed = draft !== saved;
    // Switching an existing agent to this type is held by Buzz until this tab
    // saves, so Save must work then even if the model is left as it is.
    const dirty = changed || Boolean(settingsHost?.pendingSave);
    const onSave = async () => {
      setStatus("Saving…");
      try {
        await save({ ...agent.config, model: draft });
        setStatus("Saved. The next message uses the new model.");
      } catch (error) {
        setStatus(`Couldn't save: ${error?.message ?? error}`);
      }
    };
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 14, padding: "4px 0" } },
      settingsHost?.typeControl ? settingsHost.typeControl(changed) : null,
      h(ModelField, { value: draft, onChange: setDraft, disabled: false, models }),
      h(
        "div",
        { style: { display: "flex", gap: 10, alignItems: "center" } },
        h(
          "button",
          { type: "button", disabled: !dirty, onClick: onSave, style: { ...selectStyle, cursor: dirty ? "pointer" : "default" } },
          "Save",
        ),
        status ? h("span", { style: hintStyle }, status) : null,
      ),
    );
  }

  return { Create, SettingsTab };
}
