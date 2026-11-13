// Built by build.mjs from src/main.js, acp.js and nostr.js. Edit those, then run: node build.mjs
// Hermes Agents for Buzz: an agent type whose agents are Hermes Agent
// profiles on this computer. Each agent runs `hermes -p <profile> acp`; each
// conversation it is in (a thread, a DM or a Solo chat) is one ACP session.

export const inject = ["react", "agents", "host"];

const TYPE_ID = "hermes";
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const START_MS = 90_000;
const HEX64 = /^[0-9a-f]{64}$/;
// Agent-to-agent turns allowed in one conversation before the owner speaks
// again, so two agents can't keep waking each other.
const MAX_HANDOFFS = 8;
const ROSTER_MS = 60_000;

export function apply(ctx) {
  const { agents, host } = ctx;
  const React = ctx.react;
  const runtime = new Runtime(host);
  ctx.effect(() => () => runtime.dispose());

  let profilesPromise;
  const loadProfiles = () =>
    (profilesPromise ??= host
      .runCommand("profiles")
      .then((out) =>
        String(out ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((name) => PROFILE.test(name)),
      )
      .catch(() => []));

  const { Create, SettingsTab } = createViews(React, loadProfiles);

  agents.register({
    id: TYPE_ID,
    title: "Hermes",
    description:
      "One of your Hermes Agent profiles on this computer, with its own memory, skills and model. Each thread it is mentioned in is one continuing session.",
    defaults: () => ({ config: { profile: "" } }),
    summary: (agent) => `Hermes · ${profileOf(agent.config) || "default"}`,
    Create,
    tabs: [{ id: "settings", title: "Settings", role: "settings", component: SettingsTab }],
    timeoutMs: 5 * 60_000,
    // Buzz refuses to start an agent with synced settings unless its type
    // declares them. The profile syncs; a synced copy without one keeps the
    // profile saved on this device.
    syncedSettings: {
      schema: { profile: "string" },
      withSynced: (config, settings) => ({
        ...config,
        profile: typeof settings?.profile === "string" ? settings.profile : profileOf(config),
      }),
    },
    run: (delivery) => runtime.run(delivery),
  });
}

const profileOf = (config) => {
  const name = typeof config?.profile === "string" ? config.profile.trim() : "";
  return PROFILE.test(name) ? name : "";
};

// ── Running agents ──────────────────────────────────────────────────────────

class Runtime {
  constructor(host) {
    this.host = host;
    this.workers = new Map(); // agent key -> Worker
    this.channelKinds = new Map(); // channel id -> Promise<"flat" | "threads">
    this.handoffs = new Map(); // conversation -> agent-to-agent turns since the owner spoke
    this.seen = new Map(); // agent key + conversation -> newest message it was given
    this.rosters = new Map(); // owner -> { at, promise: Map<pubkey, name> }
  }

  dispose() {
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
  }

  worker(key, profile) {
    const current = this.workers.get(key);
    if (current && current.profile === profile && !current.dead) return current;
    current?.stop();
    this.home ??= this.host
      .runCommand("home")
      .then((out) => (String(out ?? "").startsWith("/") ? String(out) : "/"))
      .catch(() => "/");
    const worker = new Worker(this.host, profile, this.home);
    this.workers.set(key, worker);
    return worker;
  }

  async run(delivery) {
    const { trigger, agent } = delivery;
    if (trigger.type !== "mention") return void delivery.ignored?.();
    const event = trigger.event;
    if (!event || event.pubkey === agent.pubkey) return void delivery.ignored?.();
    const channel = delivery.channelId ?? tagValue(event, "h");
    if (!channel) return void delivery.ignored?.();
    // The owner's messages, or a handoff from another of the owner's agents
    // (its owner attestation checked): the agent works with the owner's access.
    let from = null;
    let flat = false;
    try {
      if (event.pubkey !== agent.owner) {
        if ((await attestedOwner(event)) !== agent.owner) return void delivery.ignored?.();
        from = (await this.roster(agent)).get(event.pubkey) || (await profileName(agent, event.pubkey)) || "another agent";
      }
      flat = (await this.channelKind(agent, channel)) === "flat";
    } catch {
      return void delivery.ignored?.();
    }
    const root = flat ? null : rootOf(event);
    const place = flat ? channel : `${channel}/${root}`;
    if (from) {
      const count = this.handoffs.get(place) ?? 0;
      if (count >= MAX_HANDOFFS) return void delivery.ignored?.();
      this.handoffs.set(place, count + 1);
    } else this.handoffs.delete(place);
    const profile = profileOf(delivery.config);
    delivery.acknowledged?.();

    const done = this.turn(delivery, { event, agent, channel, profile, root, place, from }).then(
      () => ({ ok: true }),
      async (error) => {
        const message = String(error?.message ?? error).slice(0, 500);
        // Tags nobody: an error must not wake another agent.
        await reply(agent, channel, root, `⚠️ Hermes couldn't answer: ${message}`).catch(() => {});
        return { ok: false, error: message };
      },
    );
    delivery.workingUntil(done);
  }

  async turn(delivery, { event, agent, channel, profile, root, place, from }) {
    const worker = this.worker(agent.key, profile);
    const { sessionId, fresh } = await worker.session(place);
    delivery.interruptible?.(() => worker.cancel(sessionId));
    const roster = await this.roster(agent);
    const others = [...roster].filter(([key]) => key !== agent.pubkey).map(([, name]) => name);
    const seenKey = `${agent.key}|${place}`;

    let text = "";
    if (fresh) {
      text += intro(agent.name, others);
      const history = await recentMessages(agent, channel, root, event, roster, 0).catch(() => []);
      if (history.length) text += `\n\nEarlier in this conversation:\n${history.join("\n")}`;
      text += "\n\n";
    } else {
      // Messages posted since its last turn, such as other agents' replies.
      const since = this.seen.get(seenKey) ?? 0;
      const history = since ? await recentMessages(agent, channel, root, event, roster, since).catch(() => []) : [];
      if (history.length) text += `Since your last reply:\n${history.join("\n")}\n\n`;
    }
    this.seen.set(seenKey, Math.max(this.seen.get(seenKey) ?? 0, event.created_at ?? 0));
    text += from
      ? `New message from ${from}, another of your owner's agents, handing work to you:\n${messageText(event.content)}` +
        "\n\n(Do your part. If the plan names another agent to go after you, @mention that agent by name in your reply; otherwise don't @mention anyone.)"
      : `New message from your owner:\n${messageText(event.content)}`;

    const { notes, images } = await attachmentsOf(agent, event);
    if (notes.length) text += `\n\nAttached to this message:\n${notes.join("\n")}`;

    const answer = (await worker.prompt(sessionId, text, (step) => delivery.step?.(step), images)).trim();
    if (!answer) return;
    const { content, mentions } = withMentions(answer, roster, agent.pubkey);
    const posted = await reply(agent, channel, root, content, mentions);
    if (posted?.created_at) this.seen.set(seenKey, Math.max(this.seen.get(seenKey) ?? 0, posted.created_at));
  }

  /** The owner's agents in this community, by pubkey, from the owner's own
   * agent list (kind 30177). Empty when the community doesn't share it. */
  roster(agent) {
    const cached = this.rosters.get(agent.owner);
    if (cached && Date.now() - cached.at < ROSTER_MS) return cached.promise;
    const promise = agent
      .query([{ kinds: [30177], authors: [agent.owner], limit: 200 }])
      .then((events) => {
        const names = new Map();
        for (const e of events) {
          const key = tagValue(e, "d");
          if (e.pubkey !== agent.owner || !HEX64.test(key ?? "")) continue;
          let name = "";
          try {
            name = String(JSON.parse(e.content)?.name ?? "").trim();
          } catch {}
          if (name) names.set(key, name);
        }
        if (agent.name) names.set(agent.pubkey, agent.name);
        return names;
      })
      .catch(() => new Map(agent.name ? [[agent.pubkey, agent.name]] : []));
    this.rosters.set(agent.owner, { at: Date.now(), promise });
    return promise;
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
  constructor(host, profile, home) {
    this.host = host;
    this.home = home;
    this.profile = profile;
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
        log: (line) => console.warn(`[hermes ${this.profile || "default"}] ${line}`),
      },
    );
    const args = this.profile ? ["-p", this.profile, "acp"] : ["acp"];
    this.proc = await this.host.spawn("hermes", {
      args,
      cwd: "~",
      onStdout: (text) => this.acp.feed(text),
      onStderr: (text) => {
        this.stderr = (this.stderr + text).slice(-4000);
      },
    });
    void this.proc.exited.then((code) => {
      this.dead = true;
      this.acp.close(`Hermes stopped (exit ${code ?? "signal"}). ${lastLine(this.stderr)}`.trim());
    });
    await withTimeout(this.acp.initialize(), START_MS, "Hermes took too long to start");
  }

  async session(place) {
    await this.ready;
    let entry = this.sessions.get(place);
    if (entry) return { sessionId: await entry, fresh: false };
    entry = this.home.then((cwd) => this.acp.newSession(cwd));
    this.sessions.set(place, entry);
    entry.catch(() => this.sessions.delete(place));
    return { sessionId: await entry, fresh: true };
  }

  /** Runs one prompt after any earlier one in the same session. */
  prompt(sessionId, text, onStep, extra = []) {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const turn = new Turn({ onStep });
        this.turns.set(sessionId, turn);
        try {
          const result = await this.acp.prompt(sessionId, text, extra);
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

const intro = (name, others = []) =>
  `You are ${name}, running as an agent in Buzz, your owner's team chat. ` +
  "Your final reply is posted into this Buzz conversation for you, so write it as a chat message " +
  "(Markdown is fine) and don't say that you will post it. Keep it as short as the request allows." +
  (others.length
    ? `\n\nYour owner's other agents here: ${others.join(", ")}. Writing @ and an agent's exact name in your reply ` +
      "(for example @" + others[0] + ") wakes that agent in this conversation. Do that only to hand the work on, " +
      "for example when your owner set an order and you are not last. Don't @mention an agent just to talk about it."
    : "");

const MENTION_LINK = /\[(?:\\.|[^\]\\])*\]\(nostr:(?:npub|nprofile|note|nevent)1[a-z0-9]+\)/g;
const MENTION_BARE = /nostr:(?:npub|nprofile|note|nevent)1[a-z0-9]+/g;
const messageText = (content) =>
  String(content ?? "")
    .replace(MENTION_LINK, (link) => link.replace(/\]\(.*$/, "").replace(/^\[/, ""))
    .replace(MENTION_BARE, "")
    .trim();

// ── Attachments ──
// Buzz media URLs need the agent's sign-in, so Hermes can't open them itself.
// Buzz saves each one to a local file for the agent; images also go to Hermes
// as ACP image blocks so the model sees them, and every file's path is listed.

const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BASE64 = 7_000_000; // about 5 MB of image
const MEDIA_URL = /https?:\/\/[^\s)<>"']+\/media\/[0-9a-f]{64}(?:\.[A-Za-z0-9]+)?/g;

/** The Buzz media URLs in a message: its `imeta` tags, then links in its text. */
function mediaUrlsOf(event) {
  const urls = [];
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== "imeta") continue;
    for (const field of tag.slice(1)) {
      const value = String(field);
      if (value.startsWith("url ")) urls.push(value.slice(4).trim());
    }
  }
  urls.push(...(String(event?.content ?? "").match(MEDIA_URL) ?? []));
  return [...new Set(urls)].slice(0, MAX_ATTACHMENTS);
}

async function attachmentsOf(agent, event) {
  const notes = [];
  const images = [];
  const urls = mediaUrlsOf(event);
  if (!urls.length) return { notes, images };
  if (typeof agent.media !== "function") {
    notes.push("- (This Buzz can't download attachments for agents, so they could not be opened.)");
    return { notes, images };
  }
  for (const url of urls) {
    const name = url.split("/").pop();
    try {
      const media = await agent.media(url);
      const type = String(media?.type ?? "");
      notes.push(`- ${name}: saved at ${media.path} (${type || "unknown type"}, ${media.size} bytes)`);
      // Buzz includes `data` only for files the agent can be shown. Like Buzz's
      // own media tool, trust the file's first bytes for its image type.
      const image = media.data ? sniffImage(media.data) : undefined;
      if (image && media.data.length <= MAX_IMAGE_BASE64)
        images.push({ type: "image", mimeType: image, data: media.data });
    } catch (error) {
      notes.push(`- ${name}: could not be downloaded (${String(error?.message ?? error).slice(0, 200)})`);
    }
  }
  return { notes, images };
}

/** An image's MIME type from the start of its base64 data, or undefined. */
function sniffImage(base64) {
  let head;
  try {
    head = atob(String(base64).slice(0, 16));
  } catch {
    return undefined;
  }
  const at = (offset, ...bytes) => bytes.every((b, i) => head.charCodeAt(offset + i) === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
}

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

async function recentMessages(agent, channel, root, current, roster = new Map(), since = 0) {
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
    .filter((e) => !since || (e.created_at > since && e.pubkey !== agent.pubkey))
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-30)
    .map((e) => {
      const who =
        e.pubkey === agent.pubkey
          ? "You"
          : e.pubkey === agent.owner
            ? "Owner"
            : roster.get(e.pubkey)
              ? `${roster.get(e.pubkey)} (agent)`
              : `Member ${e.pubkey.slice(0, 8)}`;
      return `${who}: ${messageText(e.content).slice(0, 2000)}`;
    });
}

/** `@Name` of the owner's other agents, in prose (not code), as Buzz mention
 * links; their pubkeys tag the reply so Buzz wakes them. */
function withMentions(text, roster, self) {
  const names = [...roster].filter(([key, name]) => key !== self && name);
  if (!names.length || !text.includes("@")) return { content: text, mentions: [] };
  // Code is blanked to the same length so positions still match the text.
  const prose = text
    .replace(/^```[\s\S]*?^```/gm, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    .replace(/\[[^\]\n]*\]\([^)\n]*\)/g, (m) => " ".repeat(m.length));
  const byName = new Map();
  for (const [key, name] of names) {
    const lower = name.toLowerCase();
    byName.set(lower, [...(byName.get(lower) ?? []), key]);
  }
  const longest = [...byName.keys()].sort((a, b) => b.length - a.length);
  const found = [];
  for (const match of prose.matchAll(/(^|[\s(*_])@/g)) {
    const at = match.index + match[0].length - 1;
    const rest = prose.slice(at + 1).toLowerCase();
    const name = longest.find((n) => rest.startsWith(n) && /^($|[\s,;.!?:)\]}*_'’])/.test(rest.slice(n.length)));
    const keys = name ? byName.get(name) : [];
    if (keys?.length === 1) found.push({ at, length: name.length + 1, key: keys[0] });
  }
  let content = text;
  for (const { at, length, key } of [...found].reverse()) {
    const display = content.slice(at, at + length);
    content = `${content.slice(0, at)}[${display}](nostr:${npub(key)})${content.slice(at + length)}`;
  }
  return { content, mentions: [...new Set(found.map((f) => f.key))] };
}

/** A profile's display name, if the community has it. */
async function profileName(agent, pubkey) {
  const [profile] = await agent.query([{ kinds: [0], authors: [pubkey], limit: 1 }]).catch(() => []);
  try {
    const meta = JSON.parse(profile?.content ?? "{}");
    return String(meta.display_name || meta.name || "").trim();
  } catch {
    return "";
  }
}

function reply(agent, channel, root, content, mentions = []) {
  const tags = [["h", channel]];
  if (root) tags.push(["e", root, "", "reply"]);
  for (const key of mentions) tags.push(["p", key]);
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

function createViews(React, loadProfiles) {
  const h = React.createElement;

  function useProfiles() {
    const [profiles, setProfiles] = React.useState(null);
    React.useEffect(() => {
      let live = true;
      void loadProfiles().then((list) => live && setProfiles(list));
      return () => {
        live = false;
      };
    }, []);
    return profiles;
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

  function ProfileField({ value, onChange, disabled, profiles }) {
    const options = profiles ?? [];
    const known = !value || options.includes(value);
    return h(
      "label",
      { style: labelStyle },
      h("span", null, "Hermes profile"),
      h(
        "select",
        {
          value: value || "",
          disabled: disabled || profiles === null,
          onChange: (e) => onChange(e.target.value),
          style: selectStyle,
        },
        h("option", { value: "" }, "default"),
        ...options.map((name) => h("option", { key: name, value: name }, name)),
        known ? null : h("option", { value }, `${value} (not found)`),
      ),
      h(
        "span",
        { style: hintStyle },
        profiles === null
          ? "Looking for profiles in ~/.hermes/profiles…"
          : "Runs `hermes -p <profile> acp`, with that profile's memory, skills and model.",
      ),
    );
  }

  function Create({ config, onChange, disabled }) {
    const profiles = useProfiles();
    const profile = profileOf(config);
    return h(ProfileField, {
      value: profile,
      disabled,
      profiles,
      onChange: (next) => onChange({ ...config, profile: next }),
    });
  }

  function SettingsTab({ agent, save, settingsHost }) {
    const profiles = useProfiles();
    const saved = profileOf(agent.config);
    const [draft, setDraft] = React.useState(saved);
    const [status, setStatus] = React.useState("");
    const changed = draft !== saved;
    // Switching an existing agent to this type is held by Buzz until this tab
    // saves, so Save must work then even if the profile is left as it is.
    const dirty = changed || Boolean(settingsHost?.pendingSave);
    const onSave = async () => {
      setStatus("Saving…");
      try {
        await save({ ...agent.config, profile: draft });
        setStatus("Saved. The next message starts the new profile.");
      } catch (error) {
        setStatus(`Couldn't save: ${error?.message ?? error}`);
      }
    };
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 14, padding: "4px 0" } },
      settingsHost?.typeControl ? settingsHost.typeControl(changed) : null,
      h(ProfileField, { value: draft, onChange: setDraft, disabled: false, profiles }),
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

// ── ACP client ──
// A small ACP (Agent Client Protocol) client over a process's stdin/stdout.
// It is copied into plugin.js by build.mjs, and imported directly by the tests.

/** One JSON-RPC connection to an ACP agent. `proc` is { write(text) } and
 * `feed(text)` must be called with everything the process prints on stdout. */
class AcpConnection {
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
function defaultPermission(params) {
  const options = params?.options ?? [];
  const pick =
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind === "allow_always") ??
    options.find((o) => /allow|approve|yes/i.test(`${o.kind} ${o.name}`));
  if (!pick) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: pick.optionId } };
}

/** Collects one turn's reply and tool steps from session/update notifications. */
class Turn {
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

// ── Nostr helpers ──
// Small Nostr helpers for handoffs between the owner's agents, with no
// dependencies: BIP-340 signature checks for NIP-OA owner attestations
// (the `auth` tag Buzz signs onto every agent event), and npub encoding.

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];
const HEX = /^[0-9a-f]*$/;

const mod = (a, m = P) => ((a % m) + m) % m;

function pow(base, exp, m = P) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

/** a⁻¹ mod P, by the extended Euclidean algorithm. */
function inv(a) {
  let [u, v] = [mod(a), P];
  let [s0, s1] = [1n, 0n];
  while (u !== 0n) {
    const q = v / u;
    [u, v] = [v - q * u, u];
    [s0, s1] = [s1 - q * s0, s0];
  }
  return mod(s1);
}

// Jacobian points [X, Y, Z]; Z = 0 is infinity.
function dbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
  const YY = (Y * Y) % P;
  const S = (4n * X * YY) % P;
  const M = (3n * X * X) % P;
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * YY * YY), (2n * Y * Z) % P];
}

function add(a, b) {
  if (a[2] === 0n) return b;
  if (b[2] === 0n) return a;
  const [X1, Y1, Z1] = a;
  const [X2, Y2, Z2] = b;
  const Z1Z1 = (Z1 * Z1) % P;
  const Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P;
  const U2 = (X2 * Z1Z1) % P;
  const S1 = (Y1 * Z2 * Z2Z2) % P;
  const S2 = (Y2 * Z1 * Z1Z1) % P;
  if (U1 === U2) return S1 === S2 ? dbl(a) : [0n, 1n, 0n];
  const H = mod(U2 - U1);
  const R = mod(S2 - S1);
  const HH = (H * H) % P;
  const HHH = (H * HH) % P;
  const V = (U1 * HH) % P;
  const X3 = mod(R * R - HHH - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * HHH), (Z1 * Z2 * H) % P];
}

function mul(point, k) {
  let result = [0n, 1n, 0n];
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = dbl(addend);
    k >>= 1n;
  }
  return result;
}

function affine([X, Y, Z]) {
  if (Z === 0n) return undefined;
  const zi = inv(Z);
  const zi2 = (zi * zi) % P;
  return [(X * zi2) % P, (Y * zi2 * zi) % P];
}

function liftX(x) {
  if (x >= P) return undefined;
  const c = mod(x * x * x + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if ((y * y) % P !== c) return undefined;
  return [x, y % 2n === 0n ? y : P - y, 1n];
}

const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const big = (bytes) => BigInt(`0x${hexOf(bytes) || "0"}`);

async function sha256(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

/** BIP-340: whether `sig` (128 hex) signs the 32-byte `message` for x-only `pubkey` (64 hex). */
async function verifySchnorr(sig, message, pubkey) {
  if (!/^[0-9a-f]{128}$/.test(sig) || !/^[0-9a-f]{64}$/.test(pubkey) || message.length !== 32) return false;
  const point = liftX(BigInt(`0x${pubkey}`));
  if (!point) return false;
  const r = BigInt(`0x${sig.slice(0, 64)}`);
  const s = BigInt(`0x${sig.slice(64)}`);
  if (r >= P || s >= N) return false;
  const tag = await sha256(new TextEncoder().encode("BIP0340/challenge"));
  const e = mod(big(await sha256(tag, tag, bytesOf(sig.slice(0, 64)), bytesOf(pubkey), message)), N);
  const R = affine(add(mul([G[0], G[1], 1n], s), mul(point, mod(N - e, N))));
  return !!R && R[1] % 2n === 0n && R[0] === r;
}

const CLAUSE = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/;

function satisfied(conditions, event) {
  if (conditions === "") return true;
  return conditions.split("&").every((clause) => {
    const [, name, digits] = CLAUSE.exec(clause) ?? [];
    if (!name) return false;
    const value = Number(digits);
    if (name === "kind=") return event.kind === value;
    return name === "created_at<" ? event.created_at < value : event.created_at > value;
  });
}

/**
 * NIP-OA: the owner a signed event's single `auth` tag proves, or undefined.
 * The relay checks the event's own signature; this checks the owner's.
 */
async function attestedOwner(event) {
  const tags = (event?.tags ?? []).filter((t) => t[0] === "auth");
  if (tags.length !== 1) return undefined;
  const [, owner, conditions, sig] = tags[0];
  if (tags[0].length !== 4 || !/^[0-9a-f]{64}$/.test(owner ?? "") || owner === event.pubkey) return undefined;
  if (typeof conditions !== "string" || !HEX.test(sig ?? "") || !satisfied(conditions, event)) return undefined;
  try {
    const digest = await sha256(new TextEncoder().encode(`nostr:agent-auth:${event.pubkey}:${conditions}`));
    return (await verifySchnorr(sig, digest, owner)) ? owner : undefined;
  } catch {
    return undefined;
  }
}

// ── bech32 (npub) ──
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

/** `npub1…` for a 64-hex public key. */
function npub(pubkey) {
  const data = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytesOf(pubkey)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const hrp = "npub";
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const pm = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (pm >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}
