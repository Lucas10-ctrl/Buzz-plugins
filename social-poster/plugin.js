// Social Poster for Buzz: write, schedule and publish social media posts.
// The work happens in a local engine (`social-poster-engine`, Postiz's
// connectors plus a small scheduler) that this plugin starts and talks to over
// JSON lines on stdin/stdout. This file is the Buzz page and the agent tools.

export const inject = ["react", "pages", "host", "agents"];

const PLUGIN_ID = "social-poster";

export function apply(ctx) {
  const React = ctx.react;
  const engine = new Engine(ctx.host);
  ctx.effect(() => {
    engine.start();
    return () => engine.stop();
  });

  const views = createViews(React, engine, ctx);
  ctx.pages.register({
    id: "main",
    title: "Social Poster",
    primary: true,
    icon: ICON,
    component: views.Page,
  });

  registerAgentTools(ctx, engine);
}

// ── Engine connection ───────────────────────────────────────────────────────

class Engine {
  constructor(host) {
    this.host = host;
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.state = { status: "starting", message: "" };
    this.stopped = false;
    this.restarts = 0;
    this.readyWaiters = [];
    this.stderr = "";
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.warn("[social-poster] listener failed", err);
      }
    }
  }

  setState(status, message = "") {
    this.state = { status, message };
    this.emit({ event: "state", ...this.state });
    if (status === "ready") {
      for (const w of this.readyWaiters.splice(0)) w.resolve();
    }
  }

  async start() {
    if (this.stopped) return;
    if (typeof this.host.spawn !== "function") {
      this.setState("failed", "This version of Buzz can't start local programs for plugins. Update Buzz on the desktop.");
      return;
    }
    this.setState("starting");
    this.buffer = "";
    this.stderr = "";
    try {
      const proc = await this.host.spawn("engine", {
        cwd: "~",
        onStdout: (text) => this.feed(text),
        onStderr: (text) => {
          this.stderr = (this.stderr + text).slice(-4000);
        },
      });
      if (this.stopped) {
        void proc.kill();
        return;
      }
      this.proc = proc;
      void proc.exited.then((code) => this.onExit(proc, code));
    } catch (err) {
      this.setState(
        "failed",
        `Couldn't start the Social Poster engine (${String(err?.message ?? err)}). ` +
          "Run `node build.mjs` in the Social Poster plugin folder so `social-poster-engine` is installed in ~/.local/bin.",
      );
    }
  }

  onExit(proc, code) {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const p of this.pending.values()) p.reject(new Error("The Social Poster engine stopped"));
    this.pending.clear();
    if (this.stopped) return;
    const last = this.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" ");
    if (this.restarts >= 5) {
      this.setState("failed", `The Social Poster engine keeps stopping (exit ${code ?? "signal"}). ${last}`.trim());
      return;
    }
    this.restarts += 1;
    this.setState("starting", "Restarting the engine…");
    setTimeout(() => void this.start(), Math.min(1000 * 2 ** this.restarts, 15000));
  }

  async restart() {
    this.restarts = 0;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      void proc.kill();
      await proc.exited.catch(() => {});
    }
    await this.start();
    await this.ready();
  }

  stop() {
    this.stopped = true;
    for (const w of this.readyWaiters.splice(0)) w.reject(new Error("Social Poster stopped"));
    void this.proc?.end?.().catch?.(() => {});
    void this.proc?.kill();
    this.proc = null;
  }

  feed(text) {
    this.buffer += text;
    let i;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (msg.event === "ready") {
        this.restarts = 0;
        this.setState("ready");
      } else if (msg.event === "fatal") {
        this.setState("failed", msg.message);
      } else if (msg.event) {
        this.emit(msg);
      }
    }
  }

  ready(ms = 30000) {
    if (this.state.status === "ready") return Promise.resolve();
    if (this.state.status === "failed") return Promise.reject(new Error(this.state.message));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.readyWaiters.push(waiter);
      setTimeout(() => {
        const at = this.readyWaiters.indexOf(waiter);
        if (at >= 0) {
          this.readyWaiters.splice(at, 1);
          reject(new Error("The Social Poster engine is not running yet"));
        }
      }, ms);
    });
  }

  async call(method, params = {}, timeoutMs = 120000) {
    await this.ready();
    if (!this.proc) throw new Error("The Social Poster engine is not running");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} took too long`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      void this.proc.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
}

// ── Agent tools ─────────────────────────────────────────────────────────────

function registerAgentTools(ctx, engine) {
  if (typeof ctx.agents?.addTool !== "function") return;
  const json = (v) => JSON.stringify(v, null, 2);
  const tools = [
    {
      name: "social_poster_accounts",
      description:
        "List the social media accounts connected in Social Poster (id, network, name, status). Use an id, a network name like \"x\" or \"linkedin\", or a username in social_poster_schedule.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: async () => json(await engine.call("accounts.list")),
    },
    {
      name: "social_poster_schedule",
      description:
        "Schedule (or publish now) one post to one or more connected social accounts through Social Poster. Only do this when your owner asked for the post to go out; it publishes publicly at the given time.",
      inputSchema: {
        type: "object",
        properties: {
          accounts: { type: "array", items: { type: "string" }, minItems: 1, description: "Account ids, network names (x, linkedin, bluesky...) or usernames." },
          text: { type: "string", description: "The post text, plain text." },
          at: { type: "string", description: "When to publish, ISO 8601 with time zone, e.g. 2026-11-24T09:00:00-05:00. Leave out to publish now." },
          media: { type: "array", items: { type: "string" }, description: "Absolute local file paths or https URLs of images/videos." },
          settings: { type: "object", description: "Optional network settings keyed by network, e.g. {\"reddit\": {\"subreddit\": [...]}}." },
        },
        required: ["accounts", "text"],
        additionalProperties: false,
      },
      call: async (client, _context, args) =>
        json(await engine.call("posts.create", { ...args, createdBy: client?.name || "agent" })),
    },
    {
      name: "social_poster_posts",
      description: "List posts in Social Poster with their status (scheduled, published, failed, cancelled), time, link and any error.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["scheduled", "publishing", "published", "failed", "cancelled"] },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
      call: async (_c, _x, args) => json(await engine.call("posts.list", args || {})),
    },
    {
      name: "social_poster_cancel",
      description: "Cancel a scheduled Social Poster post (by post id, or group id to cancel it on every account).",
      inputSchema: {
        type: "object",
        properties: { post: { type: "string" } },
        required: ["post"],
        additionalProperties: false,
      },
      call: async (_c, _x, args) => json(await engine.call("posts.cancel", args)),
    },
  ];
  for (const tool of tools) {
    try {
      ctx.agents.addTool(tool);
    } catch (err) {
      console.warn(`[social-poster] could not add agent tool ${tool.name}`, err);
    }
  }
}

// ── Page ────────────────────────────────────────────────────────────────────

const DEV_PORTALS = {
  x: "https://developer.x.com/en/portal/dashboard",
  linkedin: "https://www.linkedin.com/developers/apps",
  "linkedin-page": "https://www.linkedin.com/developers/apps",
  facebook: "https://developers.facebook.com/apps",
  instagram: "https://developers.facebook.com/apps",
  "instagram-standalone": "https://developers.facebook.com/apps",
  threads: "https://developers.facebook.com/apps",
  youtube: "https://console.cloud.google.com/apis/credentials",
  gmb: "https://console.cloud.google.com/apis/credentials",
  reddit: "https://www.reddit.com/prefs/apps",
  tiktok: "https://developers.tiktok.com/apps",
  "tiktok-business": "https://business-api.tiktok.com/portal/apps",
  pinterest: "https://developers.pinterest.com/apps/",
  discord: "https://discord.com/developers/applications",
  slack: "https://api.slack.com/apps",
  twitch: "https://dev.twitch.tv/console/apps",
  kick: "https://kick.com/settings/developer",
  telegram: "https://t.me/BotFather",
  tumblr: "https://www.tumblr.com/oauth/apps",
  dribbble: "https://dribbble.com/account/applications",
  wrapcast: "https://dev.neynar.com",
  whop: "https://whop.com/dashboard/developer",
  vk: "https://id.vk.com/about/business/go",
};

function createViews(React, engine, ctx) {
  const h = React.createElement;
  const ui = () => ctx.reflect?.get?.("ui");

  // Styles: calm, one column, large type; colors inherit from the host theme.
  const S = {
    page: { padding: "var(--space-panel-inset, 24px)", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 20, fontSize: 15, lineHeight: 1.5 },
    card: { padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRadius: 12 },
    h1: { margin: 0, fontSize: 26 },
    h2: { margin: 0, fontSize: 18 },
    hint: { margin: 0, opacity: 0.7, fontSize: 14 },
    row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    tabs: { display: "flex", gap: 8, flexWrap: "wrap" },
    input: { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", font: "inherit", width: "100%", boxSizing: "border-box" },
    textarea: { padding: 12, borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: 16, width: "100%", minHeight: 150, resize: "vertical", boxSizing: "border-box" },
    label: { display: "flex", flexDirection: "column", gap: 6, fontWeight: 600 },
    check: { display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.25)", cursor: "pointer" },
    item: { display: "flex", flexDirection: "column", gap: 6, padding: "14px 0", borderTop: "1px solid rgba(127,127,127,0.2)" },
    error: { color: "var(--color-danger, #d33)", margin: 0 },
    ok: { color: "var(--color-success, #2a8a4a)", margin: 0 },
    badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(127,127,127,0.35)", whiteSpace: "nowrap" },
    code: { fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "8px 10px", borderRadius: 6, background: "rgba(127,127,127,0.12)", wordBreak: "break-all", userSelect: "all" },
  };

  function Button({ onClick, children, variant = "subtle", disabled, type = "button" }) {
    const U = ui();
    if (U?.Button) return h(U.Button, { onClick, variant, disabled, type, size: "md" }, children);
    return h("button", { onClick, disabled, type, style: { padding: "8px 14px", borderRadius: 8, font: "inherit", cursor: disabled ? "default" : "pointer", fontWeight: variant === "prominent" ? 700 : 500 } }, children);
  }

  function useEngine() {
    const [state, setState] = React.useState(engine.state);
    const [version, setVersion] = React.useState(0);
    React.useEffect(
      () =>
        engine.subscribe((e) => {
          if (e.event === "state") setState({ status: e.status, message: e.message });
          if (e.event === "changed" || e.event === "published" || e.event === "failed" || e.event === "connected") setVersion((v) => v + 1);
        }),
      [],
    );
    return { state, version };
  }

  function useLoad(method, params, deps) {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      let live = true;
      engine
        .call(method, params)
        .then((d) => live && (setData(d), setError("")))
        .catch((e) => live && setError(String(e.message || e)));
      return () => {
        live = false;
      };
    }, deps);
    return { data, error };
  }

  const openLink = (url) => (e) => {
    e?.preventDefault?.();
    void engine.call("open", { url }).catch(() => window.open?.(url, "_blank"));
  };
  const Link = ({ href, children }) => h("a", { href, onClick: openLink(href), target: "_blank", rel: "noreferrer" }, children);

  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // ── Page shell ──
  function Page() {
    const { state, version } = useEngine();
    const [tab, setTab] = React.useState("write");
    let body;
    if (state.status === "failed") {
      body = h("section", { className: "ui-card", style: S.card },
        h("h2", { style: S.h2 }, "Social Poster isn't running"),
        h("p", { style: S.error }, state.message),
        h("div", null, h(Button, { onClick: () => void engine.restart().catch(() => {}) }, "Try again")));
    } else if (state.status !== "ready") {
      body = h("p", { style: S.hint }, state.message || "Starting Social Poster…");
    } else if (tab === "write") body = h(Write, { version, goTo: setTab });
    else if (tab === "queue") body = h(Queue, { version });
    else body = h(Accounts, { version });

    return h("div", { style: S.page },
      h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        h("h1", { style: S.h1 }, "Social Poster"),
        h("p", { style: S.hint }, "Write a post once, pick the accounts, and Social Poster publishes it at the time you choose. Posts go out while Buzz is open on this computer.")),
      h("div", { style: S.tabs },
        [["write", "Write a post"], ["queue", "Posts"], ["accounts", "Accounts"]].map(([id, label]) =>
          h(Button, { key: id, onClick: () => setTab(id), variant: tab === id ? "prominent" : "ghost" }, label))),
      body);
  }

  // ── Write ──
  function Write({ version, goTo }) {
    const accounts = useLoad("accounts.list", {}, [version]);
    const providers = useLoad("providers.list", {}, []);
    const [text, setText] = React.useState("");
    const [chosen, setChosen] = React.useState([]);
    const [mode, setMode] = React.useState("now");
    const [when, setWhen] = React.useState(defaultLater());
    const [files, setFiles] = React.useState([]);
    const [links, setLinks] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [result, setResult] = React.useState(null);

    const ready = (accounts.data || []).filter((a) => a.status === "ready");
    if (accounts.data && !ready.length) {
      return h("section", { className: "ui-card", style: S.card },
        h("h2", { style: S.h2 }, "Connect an account first"),
        h("p", null, "Social Poster needs at least one connected social media account before it can post."),
        h("div", null, h(Button, { variant: "prominent", onClick: () => goTo("accounts") }, "Connect an account")));
    }
    const limit = Math.min(...chosen.map((id) => {
      const a = ready.find((x) => x.id === id);
      return (providers.data || []).find((p) => p.identifier === a?.network)?.maxLength || Infinity;
    }), Infinity);
    const over = Number.isFinite(limit) && text.length > limit;
    const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

    async function pickFiles(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = "";
      for (const file of list) {
        setFiles((f) => [...f, { name: file.name, status: "uploading" }]);
        try {
          const base64 = await toBase64(file);
          const saved = await engine.call("media.upload", { name: file.name, base64 }, 300000);
          setFiles((f) => f.map((x) => (x.name === file.name && x.status === "uploading" ? { name: file.name, status: "ready", path: saved.path } : x)));
        } catch (err) {
          setFiles((f) => f.map((x) => (x.name === file.name && x.status === "uploading" ? { name: file.name, status: "failed", error: String(err.message || err) } : x)));
        }
      }
    }

    async function submit(e) {
      e?.preventDefault?.();
      setBusy(true);
      setResult(null);
      try {
        const media = [
          ...files.filter((f) => f.status === "ready").map((f) => f.path),
          ...links.split(/\s+/).map((s) => s.trim()).filter(Boolean),
        ];
        const at = mode === "now" ? undefined : new Date(when).toISOString();
        const r = await engine.call("posts.create", { accounts: chosen, text, media, at, createdBy: "owner" });
        setResult({ ok: true, message: mode === "now" ? `Publishing to ${r.posts.length} account(s) now. Check Posts for the links.` : `Scheduled for ${fmt(r.posts[0].publishAt)} on ${r.posts.length} account(s).` });
        setText("");
        setFiles([]);
        setLinks("");
      } catch (err) {
        setResult({ ok: false, message: String(err.message || err) });
      } finally {
        setBusy(false);
      }
    }

    const canSend = !busy && text.trim() && chosen.length && !over && !files.some((f) => f.status === "uploading");
    return h("form", { className: "ui-card", style: S.card, onSubmit: submit },
      h("label", { style: S.label }, "What do you want to post?",
        h("textarea", { style: S.textarea, value: text, onChange: (e) => setText(e.target.value), placeholder: "Write your post here…" })),
      h("p", { style: over ? S.error : S.hint }, Number.isFinite(limit) ? `${text.length} of ${limit} characters` : `${text.length} characters`),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("strong", null, "Post to"),
        accounts.error ? h("p", { style: S.error }, accounts.error) : null,
        ready.map((a) => h("label", { key: a.id, style: S.check },
          h("input", { type: "checkbox", checked: chosen.includes(a.id), onChange: () => toggle(a.id) }),
          a.picture ? h("img", { src: a.picture, alt: "", width: 28, height: 28, style: { borderRadius: 999 } }) : null,
          h("span", null, h("strong", null, a.name), " ", h("span", { style: S.hint }, `${networkName(providers.data, a.network)}${a.username ? ` · @${a.username}` : ""}`))))),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("strong", null, "Pictures or video (optional)"),
        h("input", { type: "file", multiple: true, accept: "image/*,video/*", onChange: pickFiles }),
        files.map((f, i) => h("div", { key: i, style: S.row },
          h("span", null, f.name), h("span", { style: S.badge }, f.status === "ready" ? "ready" : f.status === "uploading" ? "adding…" : "failed"),
          f.error ? h("span", { style: S.error }, f.error) : null,
          h(Button, { variant: "ghost", onClick: () => setFiles((all) => all.filter((_, j) => j !== i)) }, "Remove"))),
        h("input", { style: S.input, value: links, onChange: (e) => setLinks(e.target.value), placeholder: "Or paste https links to images or videos, separated by spaces" }),
        h("p", { style: S.hint }, "Instagram, Facebook, Threads, Pinterest and TikTok fetch media from the internet, so for those use https links rather than files from this computer.")),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("strong", null, "When"),
        h("label", { style: S.check }, h("input", { type: "radio", checked: mode === "now", onChange: () => setMode("now") }), "Publish now"),
        h("label", { style: S.check }, h("input", { type: "radio", checked: mode === "later", onChange: () => setMode("later") }), "Schedule for later"),
        mode === "later" ? h("input", { type: "datetime-local", style: S.input, value: when, onChange: (e) => setWhen(e.target.value) }) : null),

      result ? h("p", { style: result.ok ? S.ok : S.error }, result.message) : null,
      h("div", null, h(Button, { type: "submit", variant: "prominent", disabled: !canSend }, busy ? "Saving…" : mode === "now" ? "Publish now" : "Schedule post")));
  }

  // ── Posts ──
  function Queue({ version }) {
    const posts = useLoad("posts.list", { limit: 200 }, [version]);
    const [error, setError] = React.useState("");
    const act = (method, post) => engine.call(method, { post }).then(() => setError("")).catch((e) => setError(String(e.message || e)));
    if (posts.error) return h("p", { style: S.error }, posts.error);
    if (!posts.data) return h("p", { style: S.hint }, "Loading…");
    const groups = [
      ["Scheduled", posts.data.filter((p) => p.status === "scheduled" || p.status === "publishing").sort((a, b) => a.publishAt.localeCompare(b.publishAt))],
      ["Failed", posts.data.filter((p) => p.status === "failed")],
      ["Published", posts.data.filter((p) => p.status === "published")],
      ["Cancelled", posts.data.filter((p) => p.status === "cancelled")],
    ];
    if (!posts.data.length) return h("section", { className: "ui-card", style: S.card }, h("p", null, "No posts yet. Write one in “Write a post”."));
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
      error ? h("p", { style: S.error }, error) : null,
      groups.filter(([, list]) => list.length).map(([title, list]) =>
        h("section", { key: title, className: "ui-card", style: S.card },
          h("h2", { style: S.h2 }, `${title} (${list.length})`),
          list.map((p) => h("div", { key: p.id, style: S.item },
            h("div", { style: S.row },
              h("strong", null, p.accountName), h("span", { style: S.hint }, p.network),
              h("span", { style: S.badge }, p.status === "publishing" ? "publishing now" : fmt(p.publishAt)),
              p.createdBy && p.createdBy !== "owner" ? h("span", { style: S.hint }, `by ${p.createdBy}`) : null),
            h("p", { style: { margin: 0, whiteSpace: "pre-wrap" } }, p.text),
            p.media?.length ? h("p", { style: S.hint }, `${p.media.length} media file(s)`) : null,
            p.error ? h("p", { style: S.error }, p.error) : null,
            h("div", { style: S.row },
              p.url ? h(Link, { href: p.url }, "Open the post") : null,
              p.status === "scheduled" ? h(Button, { onClick: () => act("posts.cancel", p.id) }, "Cancel") : null,
              p.status === "failed" || p.status === "cancelled" ? h(Button, { onClick: () => act("posts.retry", p.id) }, "Post again now") : null,
              p.status !== "scheduled" && p.status !== "publishing" ? h(Button, { variant: "ghost", onClick: () => act("posts.delete", p.id) }, "Delete") : null))))));
  }

  // ── Accounts ──
  function Accounts({ version }) {
    const accounts = useLoad("accounts.list", {}, [version]);
    const providers = useLoad("providers.list", {}, [version]);
    const [network, setNetwork] = React.useState("");
    const [error, setError] = React.useState("");
    const remove = (a) => {
      if (!window.confirm?.(`Remove ${a.name}? Its scheduled posts are cancelled.`)) return;
      engine.call("accounts.remove", { account: a.id }).catch((e) => setError(String(e.message || e)));
    };

    return h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
      h("section", { className: "ui-card", style: S.card },
        h("h2", { style: S.h2 }, "Connected accounts"),
        error ? h("p", { style: S.error }, error) : null,
        accounts.data && !accounts.data.length ? h("p", null, "None yet. Connect your first account below.") : null,
        (accounts.data || []).map((a) => h("div", { key: a.id, style: S.item },
          h("div", { style: S.row },
            a.picture ? h("img", { src: a.picture, alt: "", width: 32, height: 32, style: { borderRadius: 999 } }) : null,
            h("strong", null, a.name),
            h("span", { style: S.hint }, `${networkName(providers.data, a.network)}${a.username ? ` · @${a.username}` : ""}`),
            a.status !== "ready" ? h("span", { style: S.badge }, a.status === "needs_page" ? "choose a page" : "needs reconnecting") : null),
          a.statusMessage ? h("p", { style: S.error }, a.statusMessage) : null,
          a.status === "needs_page" ? h(PagePicker, { account: a }) : null,
          h("div", { style: S.row },
            a.status === "disconnected" ? h(Button, { onClick: () => { setNetwork(a.network); } }, "Reconnect") : null,
            h(Button, { variant: "ghost", onClick: () => remove(a) }, "Remove"))))),

      h("section", { className: "ui-card", style: S.card },
        h("h2", { style: S.h2 }, "Connect an account"),
        h("label", { style: S.label }, "Network",
          h("select", { style: S.input, value: network, onChange: (e) => setNetwork(e.target.value) },
            h("option", { value: "" }, "Choose a network…"),
            (providers.data || []).map((p) => h("option", { key: p.identifier, value: p.identifier }, p.name)))),
        network && providers.data ? h(Connect, { key: network, info: providers.data.find((p) => p.identifier === network) }) : null),

      h(Advanced, { version }));
  }

  function PagePicker({ account }) {
    const pages = useLoad("accounts.pages", { account: account.id }, [account.id]);
    const [error, setError] = React.useState("");
    if (pages.error) return h("p", { style: S.error }, pages.error);
    if (!pages.data) return h("p", { style: S.hint }, "Loading the pages you manage…");
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      h("p", { style: { margin: 0 } }, "Which page should this account post to?"),
      error ? h("p", { style: S.error }, error) : null,
      pages.data.map((p) => h("div", { key: p.id, style: S.row },
        h(Button, { onClick: () => engine.call("accounts.selectPage", { account: account.id, page: p.id }).catch((e) => setError(String(e.message || e))) }, p.name))));
  }

  function Connect({ info }) {
    const keys = useLoad("keys.get", { provider: info.identifier }, [info.identifier]);
    const [values, setValues] = React.useState({});
    const [fields, setFields] = React.useState(() => Object.fromEntries(info.fields.map((f) => [f.key, f.defaultValue || ""])));
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState(null);
    const [editing, setEditing] = React.useState(false);

    async function saveKeys(e) {
      e?.preventDefault?.();
      setBusy(true);
      setMsg(null);
      try {
        const r = await engine.call("keys.set", { values });
        if (r.restart) await engine.restart();
        setMsg({ ok: true, text: "Keys saved." });
        setValues({});
        setEditing(false);
      } catch (err) {
        setMsg({ ok: false, text: String(err.message || err) });
      } finally {
        setBusy(false);
      }
    }

    async function connect(e) {
      e?.preventDefault?.();
      setBusy(true);
      setMsg(null);
      try {
        const r = await engine.call("accounts.connect", { provider: info.identifier, fields: info.login === "fields" ? fields : undefined });
        if (r.connected) setMsg({ ok: true, text: `${r.account.name} is connected.` });
        else setMsg({ ok: true, text: r.message, url: r.url });
      } catch (err) {
        setMsg({ ok: false, text: String(err.message || err) });
      } finally {
        setBusy(false);
      }
    }

    const needKeys = info.keys.length > 0;
    const showKeys = needKeys && (!info.keysReady || editing);
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
      showKeys
        ? h("form", { onSubmit: saveKeys, style: { display: "flex", flexDirection: "column", gap: 12 } },
            h("p", { style: { margin: 0 } }, `${info.name} only lets apps post after you create your own free developer app. Do this once:`),
            h("ol", { style: { margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 } },
              h("li", null, "Open the ", DEV_PORTALS[info.identifier] ? h(Link, { href: DEV_PORTALS[info.identifier] }, `${info.name} developer page`) : `${info.name} developer page`, " and create an app."),
              h("li", null, "Where it asks for a callback or redirect address, paste this:", h("div", { style: { ...S.code, marginTop: 6 } }, info.callbackUrl)),
              h("li", null, "Copy the app's keys into the boxes below and save.")),
            info.keys.map((k) => h("label", { key: k, style: S.label }, keyLabel(k),
              h("input", { style: S.input, type: /SECRET|TOKEN|KEY$/.test(k) && !/CLIENT_ID|APP_ID/.test(k) ? "password" : "text", autoComplete: "off",
                placeholder: keys.data?.[k] || (k === "MASTODON_URL" ? "https://mastodon.social" : ""),
                value: values[k] ?? "", onChange: (e) => setValues((v) => ({ ...v, [k]: e.target.value })) }))),
            h("div", { style: S.row }, h(Button, { type: "submit", variant: "prominent", disabled: busy || !Object.values(values).some(Boolean) }, "Save keys"),
              editing ? h(Button, { variant: "ghost", onClick: () => setEditing(false) }, "Cancel") : null))
        : null,

      !showKeys && info.login === "fields"
        ? h("form", { onSubmit: connect, style: { display: "flex", flexDirection: "column", gap: 12 } },
            h("p", { style: { margin: 0 } }, `Enter your ${info.name} details. They stay on this computer.`),
            info.identifier === "bluesky" ? h("p", { style: S.hint }, "Use an app password from Bluesky → Settings → Privacy and security → App passwords, not your main password.") : null,
            info.fields.map((f) => h("label", { key: f.key, style: S.label }, f.label,
              h("input", { style: S.input, type: f.type === "password" ? "password" : "text", autoComplete: "off", value: fields[f.key] ?? "", onChange: (e) => setFields((v) => ({ ...v, [f.key]: e.target.value })) }))),
            h("div", null, h(Button, { type: "submit", variant: "prominent", disabled: busy }, busy ? "Connecting…" : `Connect ${info.name}`)))
        : null,

      !showKeys && info.login === "oauth"
        ? h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
            h("p", { style: { margin: 0 } }, `Click connect and approve Social Poster in the ${info.name} page that opens in your browser.`),
            h("div", { style: S.row },
              h(Button, { variant: "prominent", onClick: connect, disabled: busy }, busy ? "Opening…" : `Connect ${info.name}`),
              needKeys ? h(Button, { variant: "ghost", onClick: () => setEditing(true) }, "Change developer keys") : null))
        : null,

      msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text, msg.url ? h("span", null, " ", h(Link, { href: msg.url }, "Open the sign-in page again")) : null) : null);
  }

  function Advanced({ version }) {
    const status = useLoad("status", {}, [version]);
    const [open, setOpen] = React.useState(false);
    const [url, setUrl] = React.useState("");
    const [msg, setMsg] = React.useState(null);
    if (!open) return h("div", null, h(Button, { variant: "ghost", onClick: () => setOpen(true) }, "Advanced settings"));
    return h("section", { className: "ui-card", style: S.card },
      h("h2", { style: S.h2 }, "Advanced settings"),
      status.data ? h("p", { style: S.hint }, `Data is stored in ${status.data.dataFolder}. ${status.data.scheduled} post(s) scheduled.`) : null,
      h("p", { style: { margin: 0 } }, "Callback address: networks send you back here after you sign in. Most accept the address on this computer. LinkedIn, Facebook and Instagram may require an https address; if so, put a tunnel address here (for example from ngrok or Cloudflare Tunnel) that forwards to the address shown."),
      status.data ? h("div", { style: S.code }, status.data.callbackBase) : null,
      h("input", { style: S.input, value: url, placeholder: "https://your-tunnel.example.com (leave empty to use this computer)", onChange: (e) => setUrl(e.target.value) }),
      h("div", { style: S.row }, h(Button, { onClick: () => engine.call("settings.callback", { url }).then((r) => setMsg({ ok: true, text: `Callback address is now ${r.callbackBase}` })).catch((e) => setMsg({ ok: false, text: String(e.message || e) })) }, "Save address")),
      h("p", { style: S.hint }, "Agents can also use Social Poster: Buzz agents get social_poster_* tools, and any agent with a terminal can run `social-poster --help`."),
      msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text) : null);
  }

  return { Page };
}

// ── Small helpers ───────────────────────────────────────────────────────────

function defaultLater() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function networkName(providers, id) {
  return (providers || []).find((p) => p.identifier === id)?.name || id;
}

function keyLabel(k) {
  const words = k.toLowerCase().split("_");
  const map = { id: "ID", api: "API", url: "address", app: "app", bot: "bot" };
  return words.map((w, i) => map[w] || (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

const ICON =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjODg4IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIyIDIgMTEgMTMiLz48cGF0aCBkPSJNMjIgMiAxNSAyMmwtNC05LTktNHoiLz48L3N2Zz4=";
