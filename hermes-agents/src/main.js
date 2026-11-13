// Hermes Agents for Buzz: an agent type whose agents are Hermes Agent
// profiles on this computer. Each agent runs `hermes -p <profile> acp`; each
// conversation it is in (a thread, a DM or a Solo chat) is one ACP session.
import { AcpConnection, Turn } from "../acp.js";
import { attestedOwner, npub } from "../nostr.js";

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
