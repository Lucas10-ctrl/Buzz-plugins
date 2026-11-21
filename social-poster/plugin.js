// Social Poster for Buzz: a calendar, a post composer (shared text plus
// per-channel versions, pictures, carousels, PDFs, video, follow-up
// comments, network options and a live preview), a media library and a Notion
// content-calendar import. The work happens in a local engine
// (`social-poster-engine`: Postiz's connectors plus a scheduler) that this
// plugin starts and talks to over JSON lines on stdin/stdout.

export const inject = ["react", "pages", "host", "agents"];

export function apply(ctx) {
  const React = ctx.react;
  const engine = new Engine(ctx.host);
  ctx.effect(() => {
    engine.start();
    return () => engine.stop();
  });
  ctx.pages.register({
    id: "main",
    title: "Social Poster",
    primary: true,
    icon: ICON,
    component: createApp(React, engine),
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
      try { fn(event); } catch (err) { console.warn("[social-poster] listener failed", err); }
    }
  }
  setState(status, message = "") {
    this.state = { status, message };
    this.emit({ event: "state", ...this.state });
    if (status === "ready") for (const w of this.readyWaiters.splice(0)) w.resolve();
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
        onStderr: (text) => { this.stderr = (this.stderr + text).slice(-4000); },
      });
      if (this.stopped) { void proc.kill(); return; }
      this.proc = proc;
      void proc.exited.then((code) => this.onExit(proc, code));
    } catch (err) {
      this.setState("failed", `Couldn't start the Social Poster engine (${String(err?.message ?? err)}). Run \`node build.mjs\` in the Social Poster plugin folder so \`social-poster-engine\` is installed in ~/.local/bin.`);
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
    if (proc) { void proc.kill(); await proc.exited.catch(() => {}); }
    await this.start();
    await this.ready();
  }
  stop() {
    this.stopped = true;
    for (const w of this.readyWaiters.splice(0)) w.reject(new Error("Social Poster stopped"));
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
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          const err = new Error(msg.error);
          err.problems = msg.problems;
          p.reject(err);
        } else p.resolve(msg.result);
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
        if (at >= 0) { this.readyWaiters.splice(at, 1); reject(new Error("The Social Poster engine is not running yet")); }
      }, ms);
    });
  }
  async call(method, params = {}, timeoutMs = 120000) {
    await this.ready();
    if (!this.proc) throw new Error("The Social Poster engine is not running");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} took too long`)); }, timeoutMs);
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
      description: "List the social media accounts connected in Social Poster (id, network, name, status). Use an id, a network name like \"x\" or \"linkedin\", or a username in social_poster_schedule.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: async () => json(await engine.call("accounts.list")),
    },
    {
      name: "social_poster_schedule",
      description: "Create a post in Social Poster for one or more connected accounts: a draft for the owner to review (draft: true), a scheduled post, or publish now. Several images make a carousel; a PDF is posted as a LinkedIn document or split into pages elsewhere. Only schedule or publish when the owner asked for it to go out.",
      inputSchema: {
        type: "object",
        properties: {
          accounts: { type: "array", items: { type: "string" }, minItems: 1, description: "Account ids, network names (x, linkedin, instagram...) or usernames." },
          text: { type: "string", description: "The post text, plain text." },
          at: { type: "string", description: "When to publish, ISO 8601 with time zone, e.g. 2026-11-24T09:00:00-05:00. Leave out to publish now (unless draft)." },
          media: { type: "array", items: { type: "string" }, description: "Absolute local file paths or https URLs of images, MP4 videos or a PDF, in carousel order." },
          comments: { type: "array", items: { type: "string" }, description: "Follow-up comments posted under the post (a thread on X)." },
          settings: { type: "object", description: "Network options keyed by network, e.g. {\"youtube\": {\"title\": \"...\"}, \"pinterest\": {\"board\": \"123\"}}." },
          draft: { type: "boolean", description: "Save as a draft on the calendar instead of scheduling it." },
        },
        required: ["accounts", "text"],
        additionalProperties: false,
      },
      call: async (client, _context, args) => json(await engine.call("posts.create", { ...args, createdBy: client?.name || "agent" }, 300000)),
    },
    {
      name: "social_poster_posts",
      description: "List posts in Social Poster with their status (draft, scheduled, published, failed), time, link and any error.",
      inputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: ["draft", "scheduled", "publishing", "published", "failed"] }, limit: { type: "integer", minimum: 1, maximum: 200 } },
        additionalProperties: false,
      },
      call: async (_c, _x, args) => json(await engine.call("posts.list", args || {})),
    },
    {
      name: "social_poster_cancel",
      description: "Stop a scheduled Social Poster post from going out (it goes back to drafts). Use the post id, or its group id for every account.",
      inputSchema: { type: "object", properties: { post: { type: "string" } }, required: ["post"], additionalProperties: false },
      call: async (_c, _x, args) => json(await engine.call("posts.cancel", args)),
    },
  ];
  for (const tool of tools) {
    try { ctx.agents.addTool(tool); } catch (err) { console.warn(`[social-poster] could not add agent tool ${tool.name}`, err); }
  }
}

// ── Look ────────────────────────────────────────────────────────────────────

const ACCENT = "#6d4aff";
const NETWORK = {
  x: ["X", "#111111"], linkedin: ["in", "#0a66c2"], "linkedin-page": ["in", "#0a66c2"], instagram: ["IG", "#d62976"], "instagram-standalone": ["IG", "#d62976"],
  facebook: ["f", "#1877f2"], threads: ["@", "#000000"], youtube: ["▶", "#ff0000"], tiktok: ["♪", "#111111"], "tiktok-business": ["♪", "#111111"],
  pinterest: ["P", "#e60023"], reddit: ["r", "#ff4500"], bluesky: ["B", "#1185fe"], mastodon: ["M", "#6364ff"], discord: ["D", "#5865f2"],
  slack: ["S", "#4a154b"], telegram: ["T", "#229ed9"], nostr: ["N", "#8e30eb"], gmb: ["G", "#4285f4"], wordpress: ["W", "#21759b"],
  medium: ["M", "#000000"], devto: ["D", "#0a0a0a"], hashnode: ["H", "#2962ff"], lemmy: ["L", "#00bc8c"], twitch: ["T", "#9146ff"], kick: ["K", "#53fc18"],
  tumblr: ["t", "#36465d"], vk: ["VK", "#0077ff"], wrapcast: ["F", "#855dcd"], dribbble: ["●", "#ea4c89"], listmonk: ["✉", "#0055d4"], whop: ["W", "#ff6243"], mewe: ["M", "#17377e"], moltbook: ["m", "#444444"],
};
const net = (id) => NETWORK[id] || [String(id || "?").slice(0, 1).toUpperCase(), "#777777"];
const STATE = {
  draft: { label: "Draft", color: "#8a8a99", border: "1px dashed #8a8a99" },
  scheduled: { label: "Scheduled", color: ACCENT, border: `1px solid ${ACCENT}` },
  publishing: { label: "Posting now", color: "#d98a00", border: "1px solid #d98a00" },
  published: { label: "Posted", color: "#1f9d55", border: "1px solid #1f9d55" },
  partial: { label: "Partly posted", color: "#1f9d55", border: "1px solid #1f9d55" },
  failed: { label: "Needs attention", color: "#d93838", border: "1px solid #d93838" },
};
const LINE = "1px solid rgba(127,127,127,0.18)";
const S = {
  shell: { display: "flex", height: "100%", minHeight: 560, width: "100%", fontSize: 15, lineHeight: 1.45, boxSizing: "border-box", overflow: "hidden" },
  side: { width: 250, flex: "0 0 250px", borderRight: LINE, padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", boxSizing: "border-box" },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
  head: { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: LINE, flexWrap: "wrap" },
  body: { flex: 1, overflow: "auto", padding: 20, boxSizing: "border-box" },
  h1: { margin: 0, fontSize: 22, fontWeight: 700 },
  h2: { margin: 0, fontSize: 17, fontWeight: 700 },
  hint: { margin: 0, opacity: 0.65, fontSize: 13.5 },
  btn: { padding: "8px 14px", borderRadius: 9, border: "1px solid rgba(127,127,127,0.3)", background: "rgba(127,127,127,0.08)", color: "inherit", font: "inherit", fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" },
  primary: { padding: "9px 16px", borderRadius: 9, border: `1px solid ${ACCENT}`, background: ACCENT, color: "#fff", font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  ghost: { padding: "6px 10px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", fontSize: 14, cursor: "pointer" },
  danger: { padding: "8px 14px", borderRadius: 9, border: "1px solid rgba(217,56,56,0.5)", background: "transparent", color: "#d93838", font: "inherit", fontSize: 14, cursor: "pointer" },
  seg: { display: "inline-flex", border: "1px solid rgba(127,127,127,0.3)", borderRadius: 9, overflow: "hidden" },
  input: { padding: "9px 11px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: 14.5, width: "100%", boxSizing: "border-box" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontWeight: 600, fontSize: 14 },
  card: { border: "1px solid rgba(127,127,127,0.2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  error: { color: "#d93838", margin: 0, fontSize: 14 },
  ok: { color: "#1f9d55", margin: 0, fontSize: 14 },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, background: "rgba(127,127,127,0.12)", wordBreak: "break-all", userSelect: "all" },
  overlay: { position: "fixed", inset: 0, background: "rgba(10,10,20,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { background: "Canvas", color: "CanvasText", borderRadius: 16, width: "min(1180px, 100%)", height: "min(860px, 100%)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
};

// ── App ─────────────────────────────────────────────────────────────────────

function createApp(React, engine) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const DAY = 86400000;

  // ── data ──
  function useEngine() {
    const [state, setState] = useState(engine.state);
    const [version, setVersion] = useState(0);
    useEffect(() => engine.subscribe((e) => {
      if (e.event === "state") setState({ status: e.status, message: e.message });
      else setVersion((v) => v + 1);
    }), []);
    return { state, version };
  }
  function useLoad(method, params, deps) {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const key = JSON.stringify(params ?? {});
    useEffect(() => {
      let live = true;
      engine.call(method, params).then((d) => live && (setData(d), setError(""))).catch((e) => live && setError(errText(e)));
      return () => { live = false; };
    }, [...deps, key]);
    return { data, error };
  }
  const errText = (e) => String(e?.message || e);
  const open = (url) => (e) => { e?.preventDefault?.(); void engine.call("open", { url }).catch(() => window.open?.(url, "_blank")); };
  const Link = ({ href, children }) => h("a", { href, onClick: open(href), style: { color: ACCENT } }, children);
  const confirmed = (text) => (typeof window.confirm === "function" ? window.confirm(text) : true);

  // ── small pieces ──
  function Avatar({ account, size = 34 }) {
    const [label, color] = net(account?.network);
    return h("span", { style: { position: "relative", display: "inline-flex", width: size, height: size, flex: `0 0 ${size}px` } },
      account?.avatar
        ? h("img", { src: account.avatar, alt: "", width: size, height: size, style: { borderRadius: "50%", objectFit: "cover", width: size, height: size } })
        : h("span", { style: { width: size, height: size, borderRadius: "50%", background: "rgba(127,127,127,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.42 } }, (account?.name || "?").slice(0, 1).toUpperCase()),
      account?.network ? h("span", { style: { position: "absolute", right: -3, bottom: -3, minWidth: size * 0.46, height: size * 0.46, padding: "0 2px", boxSizing: "border-box", borderRadius: 999, background: color, color: "#fff", fontSize: Math.max(8, size * 0.26), fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid Canvas" } }, label) : null);
  }
  function Pill({ status }) {
    const st = STATE[status] || STATE.draft;
    return h("span", { style: { fontSize: 12, fontWeight: 600, color: st.color, border: st.border, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" } }, st.label);
  }
  function Seg({ value, options, onChange }) {
    return h("div", { style: S.seg }, options.map(([v, l]) => h("button", { key: v, type: "button", onClick: () => onChange(v),
      style: { ...S.ghost, borderRadius: 0, padding: "7px 14px", background: value === v ? "rgba(109,74,255,0.16)" : "transparent", fontWeight: value === v ? 700 : 500 } }, l)));
  }

  // ── shell ──
  function App() {
    const { state, version } = useEngine();
    const [view, setView] = useState("calendar");
    const [editor, setEditor] = useState(null);
    const accounts = useLoad("accounts.list", {}, [version, state.status]);
    const providers = useLoad("providers.list", {}, [state.status]);

    if (state.status === "failed") {
      return h("div", { style: { padding: 32, maxWidth: 640 } }, h("h1", { style: S.h1 }, "Social Poster isn't running"), h("p", { style: S.error }, state.message),
        h("button", { style: S.btn, onClick: () => void engine.restart().catch(() => {}) }, "Try again"));
    }
    if (state.status !== "ready") return h("p", { style: { padding: 32, opacity: 0.7 } }, state.message || "Starting Social Poster…");

    const shared = { version, accounts: accounts.data || [], providers: providers.data || [], openEditor: setEditor, setView };
    const nav = [["calendar", "Calendar", "▦"], ["drafts", "Drafts", "✎"], ["media", "Media library", "▣"], ["notion", "Notion", "N"], ["channels", "Channels", "◎"]];
    return h("div", { style: S.shell },
      h("aside", { style: S.side },
        h("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, h("span", { style: { width: 30, height: 30, borderRadius: 9, background: ACCENT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 } }, "✈"), h("strong", { style: { fontSize: 17 } }, "Social Poster")),
        h("button", { style: { ...S.primary, padding: "11px 14px", fontSize: 15 }, onClick: () => setEditor({ preset: {} }) }, "+ Create post"),
        h("nav", { style: { display: "flex", flexDirection: "column", gap: 2 } }, nav.map(([id, label, icon]) =>
          h("button", { key: id, onClick: () => setView(id), style: { ...S.ghost, textAlign: "left", display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: view === id ? "rgba(109,74,255,0.14)" : "transparent", fontWeight: view === id ? 700 : 500 } },
            h("span", { style: { width: 18, textAlign: "center", opacity: 0.8 } }, icon), label))),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 6 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("strong", { style: { fontSize: 12.5, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5 } }, "Channels"),
            h("button", { style: { ...S.ghost, fontSize: 13, color: ACCENT }, onClick: () => setView("channels") }, "+ Add")),
          shared.accounts.length ? shared.accounts.map((a) => h("div", { key: a.id, style: { display: "flex", alignItems: "center", gap: 10, opacity: a.status === "ready" ? 1 : 0.6 } },
            h(Avatar, { account: a, size: 30 }), h("span", { style: { fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } }, a.name),
            a.status !== "ready" ? h("span", { title: a.status === "needs_page" ? "Choose a page" : "Reconnect", style: { width: 8, height: 8, borderRadius: 9, background: "#d93838" } }) : null))
            : h("p", { style: S.hint }, "No channels yet."))),
      h("main", { style: S.main },
        view === "calendar" ? h(CalendarView, shared)
          : view === "drafts" ? h(DraftsView, shared)
          : view === "media" ? h(MediaView, shared)
          : view === "notion" ? h(NotionView, shared)
          : h(ChannelsView, shared)),
      editor ? h(Editor, { ...shared, ...editor, close: () => setEditor(null) }) : null);
  }

  // ── Calendar ──
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const startOfWeek = (d) => { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY); };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function CalendarView({ version, accounts, openEditor }) {
    const [mode, setMode] = useState("month");
    const [cursor, setCursor] = useState(() => new Date());
    const [filter, setFilter] = useState("");
    const [msg, setMsg] = useState("");
    const range = useMemo(() => {
      if (mode === "day") { const s = startOfDay(cursor); return [s, new Date(s.getTime() + DAY)]; }
      if (mode === "week") { const s = startOfWeek(cursor); return [s, new Date(s.getTime() + 7 * DAY)]; }
      if (mode === "list") { const s = startOfDay(new Date()); return [new Date(s.getTime() - 7 * DAY), new Date(s.getTime() + 120 * DAY)]; }
      const s = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      return [s, new Date(s.getTime() + 42 * DAY)];
    }, [mode, cursor]);
    const items = useLoad("posts.calendar", { from: range[0].toISOString(), to: range[1].toISOString() }, [version]);
    const byAccount = Object.fromEntries(accounts.map((a) => [a.id, a]));
    const list = (items.data || []).filter((p) => !filter || p.account === filter);
    const step = (dir) => {
      const d = new Date(cursor);
      if (mode === "day") d.setDate(d.getDate() + dir);
      else if (mode === "week") d.setDate(d.getDate() + 7 * dir);
      else d.setMonth(d.getMonth() + dir);
      setCursor(d);
    };
    const title = mode === "day" ? cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : mode === "week" ? `${fmtDay(range[0])} – ${fmtDay(new Date(range[1].getTime() - DAY))}`
      : mode === "list" ? "Coming up" : cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    async function drop(group, when) {
      try {
        if (when.getTime() < Date.now()) throw new Error("Pick a day or time in the future.");
        await engine.call("posts.move", { group, at: when.toISOString() });
        setMsg("");
      } catch (e) { setMsg(errText(e)); }
    }
    const newAt = (d) => openEditor({ preset: { at: d.toISOString() } });
    const env = { list, byAccount, drop, newAt, openEditor };
    return h(React.Fragment, null,
      h("div", { style: S.head },
        h("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
          mode !== "list" ? h("button", { style: S.btn, onClick: () => step(-1), "aria-label": "Previous" }, "‹") : null,
          h("h1", { style: { ...S.h1, minWidth: 200, textAlign: "center", fontSize: 19 } }, title),
          mode !== "list" ? h("button", { style: S.btn, onClick: () => step(1), "aria-label": "Next" }, "›") : null),
        mode !== "list" ? h("button", { style: S.btn, onClick: () => setCursor(new Date()) }, "Today") : null,
        h("div", { style: { flex: 1 } }),
        h("select", { style: { ...S.input, width: "auto" }, value: filter, onChange: (e) => setFilter(e.target.value), "aria-label": "Show channel" },
          h("option", { value: "" }, "All channels"), accounts.map((a) => h("option", { key: a.id, value: a.id }, a.name))),
        h(Seg, { value: mode, onChange: setMode, options: [["day", "Day"], ["week", "Week"], ["month", "Month"], ["list", "List"]] })),
      msg ? h("p", { style: { ...S.error, padding: "8px 20px" } }, msg) : null,
      items.error ? h("p", { style: { ...S.error, padding: 20 } }, items.error) : null,
      h("div", { style: { ...S.body, padding: mode === "month" ? 12 : 0 } },
        mode === "month" ? h(MonthGrid, { ...env, start: range[0], month: cursor.getMonth() })
          : mode === "list" ? h(ListView, env)
          : h(TimeGrid, { ...env, start: range[0], days: mode === "day" ? 1 : 7 })));
  }

  function Chip({ p, byAccount, openEditor, compact }) {
    const st = STATE[p.status] || STATE.draft;
    const account = byAccount[p.account] || { name: p.accountName, network: p.network };
    return h("div", {
      draggable: p.status !== "published" && p.status !== "publishing",
      onDragStart: (e) => { e.dataTransfer.setData("text/plain", p.group); e.dataTransfer.effectAllowed = "move"; },
      onClick: (e) => { e.stopPropagation(); openEditor({ group: p.group }); },
      title: `${account.name} · ${st.label}${p.error ? ` · ${p.error}` : ""}`,
      style: { display: "flex", gap: 7, alignItems: "center", padding: compact ? "3px 6px" : "5px 7px", borderRadius: 8, border: st.border, borderLeft: `4px solid ${st.color}`,
        background: "rgba(127,127,127,0.07)", cursor: "pointer", fontSize: 12.5, overflow: "hidden", minHeight: 26, boxSizing: "border-box" },
    },
      p.account ? h(Avatar, { account, size: 20 }) : h("span", { style: { fontSize: 14 } }, "✎"),
      h("span", { style: { fontWeight: 700, opacity: 0.85, whiteSpace: "nowrap" } }, fmtTime(p.publishAt)),
      p.status === "published" ? h("span", { style: { color: st.color, fontWeight: 800 } }, "✓") : p.status === "failed" ? h("span", { style: { color: st.color, fontWeight: 800 } }, "!") : null,
      h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, opacity: 0.9 } }, p.status === "draft" ? `Draft: ${p.text || "(no text)"}` : p.text || "(no text)"),
      p.thumb && !compact ? h("img", { src: p.thumb, alt: "", width: 22, height: 22, style: { borderRadius: 4, objectFit: "cover" } }) : null);
  }

  const dropTarget = (when, drop) => ({
    onDragOver: (e) => { e.preventDefault(); e.currentTarget.style.outline = `2px solid ${ACCENT}`; },
    onDragLeave: (e) => { e.currentTarget.style.outline = "none"; },
    onDrop: (e) => { e.preventDefault(); e.currentTarget.style.outline = "none"; const g = e.dataTransfer.getData("text/plain"); if (g) void drop(g, typeof when === "function" ? when(g) : when); },
  });

  function MonthGrid({ list, byAccount, drop, newAt, openEditor, start, month }) {
    const [expanded, setExpanded] = useState(null);
    const today = new Date();
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY));
    return h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 } },
      WEEKDAYS.map((d) => h("div", { key: d, style: { textAlign: "center", fontWeight: 600, fontSize: 13, opacity: 0.7, padding: "4px 0" } }, d)),
      days.map((d) => {
        const posts = list.filter((p) => sameDay(new Date(p.publishAt), d));
        const past = d.getTime() + DAY < Date.now();
        const isOpen = expanded === d.getTime();
        const shown = isOpen ? posts : posts.slice(0, 3);
        const at9 = new Date(d); at9.setHours(9, 0, 0, 0);
        const keepTime = (group) => { const p = list.find((x) => x.group === group); const t = p ? new Date(p.publishAt) : at9; const n = new Date(d); n.setHours(t.getHours(), t.getMinutes(), 0, 0); return n; };
        return h("div", {
          key: d.getTime(),
          onClick: () => !past && newAt(at9.getTime() > Date.now() ? at9 : new Date(Date.now() + 3600000)),
          ...(past ? {} : dropTarget(keepTime, drop)),
          style: { minHeight: 116, borderRadius: 10, padding: 6, display: "flex", flexDirection: "column", gap: 4, cursor: past ? "default" : "pointer", boxSizing: "border-box",
            background: past ? "repeating-linear-gradient(135deg, rgba(127,127,127,0.05) 0 6px, transparent 6px 12px)" : "rgba(127,127,127,0.06)",
            opacity: d.getMonth() === month ? 1 : 0.55, border: sameDay(d, today) ? `2px solid ${ACCENT}` : "1px solid rgba(127,127,127,0.14)" },
        },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h("span", { style: { fontWeight: sameDay(d, today) ? 800 : 600, fontSize: 13, color: sameDay(d, today) ? ACCENT : "inherit" } }, d.getDate()),
            !past ? h("span", { style: { opacity: 0.35, fontSize: 15 } }, "+") : null),
          shown.map((p) => h(Chip, { key: p.id, p, byAccount, openEditor, compact: true })),
          posts.length > 3 ? h("button", { style: { ...S.ghost, fontSize: 12, padding: "2px 4px", color: ACCENT }, onClick: (e) => { e.stopPropagation(); setExpanded(isOpen ? null : d.getTime()); } }, isOpen ? "Show less" : `+${posts.length - 3} more`) : null);
      }));
  }

  function TimeGrid({ list, byAccount, drop, newAt, openEditor, start, days }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = 7 * 56; }, [start.getTime(), days]);
    const cols = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * DAY));
    const today = new Date();
    const grid = `64px repeat(${days}, minmax(0, 1fr))`;
    return h("div", { ref, style: { height: "100%", overflow: "auto" } },
      h("div", { style: { display: "grid", gridTemplateColumns: grid, position: "sticky", top: 0, zIndex: 2, background: "Canvas", borderBottom: LINE } },
        h("div", null), cols.map((d) => h("div", { key: d.getTime(), style: { padding: "10px 6px", textAlign: "center", fontWeight: 700, color: sameDay(d, today) ? ACCENT : "inherit" } },
          d.toLocaleDateString(undefined, { weekday: "short" }), " ", h("span", { style: { fontSize: 18 } }, d.getDate())))),
      Array.from({ length: 24 }, (_, hr) => h("div", { key: hr, style: { display: "grid", gridTemplateColumns: grid, minHeight: 56 } },
        h("div", { style: { fontSize: 12, opacity: 0.6, textAlign: "right", padding: "4px 8px 0 0" } }, new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: "numeric" })),
        cols.map((d) => {
          const slot = new Date(d); slot.setHours(hr, 0, 0, 0);
          const past = slot.getTime() + 3600000 < Date.now();
          const posts = list.filter((p) => { const t = new Date(p.publishAt); return sameDay(t, d) && t.getHours() === hr; });
          const nowLine = sameDay(d, today) && today.getHours() === hr;
          return h("div", {
            key: d.getTime(),
            onClick: () => !past && newAt(slot.getTime() > Date.now() ? slot : new Date(Date.now() + 600000)),
            ...(past ? {} : dropTarget(slot, drop)),
            style: { borderTop: "1px solid rgba(127,127,127,0.12)", borderLeft: "1px solid rgba(127,127,127,0.12)", padding: 3, display: "flex", flexDirection: "column", gap: 3, position: "relative", cursor: past ? "default" : "pointer",
              background: past ? "rgba(127,127,127,0.045)" : "transparent" },
          },
            nowLine ? h("div", { style: { position: "absolute", left: 0, right: 0, top: `${(today.getMinutes() / 60) * 100}%`, height: 2, background: "#e0245e", zIndex: 1 } }) : null,
            posts.map((p) => h(Chip, { key: p.id, p, byAccount, openEditor })));
        }))));
  }

  function ListView({ list, byAccount, openEditor }) {
    const groups = {};
    for (const p of list) (groups[startOfDay(new Date(p.publishAt)).getTime()] ||= []).push(p);
    const keys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    if (!keys.length) return h("p", { style: { padding: 24, opacity: 0.7 } }, "Nothing planned yet. Click “Create post” to start.");
    return h("div", { style: { padding: 20, display: "flex", flexDirection: "column", gap: 18, maxWidth: 900 } }, keys.map((k) => h("section", { key: k, style: { display: "flex", flexDirection: "column", gap: 8 } },
      h("h2", { style: S.h2 }, new Date(k).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })),
      groups[k].map((p) => {
        const a = byAccount[p.account] || { name: p.accountName, network: p.network };
        return h("div", { key: p.id, role: "button", tabIndex: 0, onClick: () => openEditor({ group: p.group }), style: { ...S.card, flexDirection: "row", alignItems: "center", gap: 12, cursor: "pointer" } },
          h("strong", { style: { width: 70 } }, fmtTime(p.publishAt)), p.account ? h(Avatar, { account: a }) : null,
          h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { style: { fontWeight: 600 } }, a.name), h("div", { style: { opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.text || "(no text)"),
            p.error ? h("div", { style: S.error }, p.error) : null),
          p.thumb ? h("img", { src: p.thumb, alt: "", width: 44, height: 44, style: { borderRadius: 6, objectFit: "cover" } }) : null,
          h(Pill, { status: p.status }), p.url ? h(Link, { href: p.url }, "Open") : null);
      }))));
  }

  // ── Drafts ──
  function DraftsView({ version, accounts, openEditor }) {
    const range = useMemo(() => ({ from: new Date(Date.now() - 365 * DAY).toISOString(), to: new Date(Date.now() + 730 * DAY).toISOString() }), []);
    const items = useLoad("posts.calendar", range, [version]);
    const groups = new Map();
    for (const p of items.data || []) {
      if (p.status !== "draft" && p.status !== "failed") continue;
      const g = groups.get(p.group) || { ...p, accounts: [] };
      if (p.account) g.accounts.push(p.account);
      if (p.status === "failed") { g.status = "failed"; g.error = p.error; }
      groups.set(p.group, g);
    }
    const byAccount = Object.fromEntries(accounts.map((a) => [a.id, a]));
    return h(React.Fragment, null,
      h("div", { style: S.head }, h("h1", { style: S.h1 }, "Drafts and posts that need attention")),
      h("div", { style: S.body }, !groups.size ? h("p", { style: { opacity: 0.7 } }, "No drafts. Anything you save as a draft, or import from Notion, shows up here.") :
        h("div", { style: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 900 } }, [...groups.values()].map((g) => h("div", { key: g.group, role: "button", tabIndex: 0, onClick: () => openEditor({ group: g.group }),
          style: { ...S.card, flexDirection: "row", alignItems: "center", cursor: "pointer" } },
          g.thumb ? h("img", { src: g.thumb, alt: "", width: 56, height: 56, style: { borderRadius: 8, objectFit: "cover" } }) : h("div", { style: { width: 56, height: 56, borderRadius: 8, background: "rgba(127,127,127,0.12)" } }),
          h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 } },
            h("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } }, h(Pill, { status: g.status }), g.fromNotion ? h("span", { style: { fontSize: 12, opacity: 0.7 } }, "From Notion") : null,
              h("span", { style: S.hint }, fmtDay(g.publishAt), " · ", fmtTime(g.publishAt))),
            h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, g.text || "(no text yet)"),
            g.error ? h("div", { style: S.error }, g.error) : null),
          h("div", { style: { display: "flex", gap: 4 } }, g.accounts.length ? g.accounts.map((id) => (byAccount[id] ? h(Avatar, { key: id, account: byAccount[id], size: 26 }) : null)) : h("span", { style: S.hint }, "No channels yet")))))));
  }

  // ── Media library ──
  function useUploader(onAdded) {
    const [busy, setBusy] = useState([]);
    const [error, setError] = useState("");
    async function addFiles(files) {
      setError("");
      for (const file of Array.from(files || [])) {
        setBusy((b) => [...b, file.name]);
        try {
          if (file.size > 200 * 1024 * 1024) throw new Error(`${file.name} is larger than 200 MB`);
          const base64 = await toBase64(file);
          const item = await engine.call("media.upload", { name: file.name, base64 }, 600000);
          onAdded?.(item);
        } catch (e) { setError(errText(e)); }
        finally { setBusy((b) => b.filter((n) => n !== file.name)); }
      }
    }
    return { busy, error, addFiles };
  }
  function DropZone({ onFiles, busy }) {
    const input = useRef(null);
    const [over, setOver] = useState(false);
    return h("div", {
      onClick: () => input.current?.click(),
      onDragOver: (e) => { e.preventDefault(); setOver(true); }, onDragLeave: () => setOver(false),
      onDrop: (e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); },
      style: { border: `2px dashed ${over ? ACCENT : "rgba(127,127,127,0.35)"}`, borderRadius: 12, padding: 18, textAlign: "center", cursor: "pointer", background: over ? "rgba(109,74,255,0.08)" : "transparent" },
    },
      h("input", { ref: input, type: "file", multiple: true, accept: "image/*,video/mp4,video/quicktime,application/pdf", style: { display: "none" }, onChange: (e) => { onFiles(e.target.files); e.target.value = ""; } }),
      h("strong", null, busy?.length ? `Adding ${busy.join(", ")}…` : "Drop pictures, videos or a PDF here, or click to choose"),
      h("p", { style: { ...S.hint, marginTop: 4 } }, "Several pictures make a carousel. A PDF is posted as a swipeable document on LinkedIn and as separate slides elsewhere."));
  }
  function Tile({ item, selected, onToggle, onRemove, order }) {
    return h("div", { style: { position: "relative", borderRadius: 10, overflow: "hidden", border: selected ? `3px solid ${ACCENT}` : "1px solid rgba(127,127,127,0.2)", cursor: onToggle ? "pointer" : "default", background: "rgba(127,127,127,0.08)" }, onClick: onToggle },
      h("div", { style: { aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } },
        item.thumb ? h("img", { src: item.thumb, alt: item.name, draggable: false, style: { width: "100%", height: "100%", objectFit: "cover" } }) : h("span", { style: { fontSize: 30, opacity: 0.6 } }, item.kind === "video" ? "▶" : "📄")),
      h("div", { style: { position: "absolute", left: 6, top: 6, display: "flex", gap: 4 } },
        order ? h("span", { style: { background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 6 } }, order) : null,
        item.kind !== "image" ? h("span", { style: { background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 6 } }, item.kind === "pdf" ? `PDF · ${item.pages || "?"} pages` : "VIDEO") : null),
      onRemove ? h("button", { onClick: (e) => { e.stopPropagation(); onRemove(); }, title: "Delete", style: { position: "absolute", right: 6, top: 6, ...S.ghost, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "1px 8px" } }, "×") : null,
      h("div", { style: { fontSize: 12, padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, item.name));
  }
  function MediaView({ version, picking, onPick }) {
    const [bump, setBump] = useState(0);
    const lib = useLoad("media.list", {}, [version, bump]);
    const [chosen, setChosen] = useState([]);
    const up = useUploader((item) => { setBump((b) => b + 1); if (picking) setChosen((c) => (c.includes(item.id) ? c : [...c, item.id])); });
    const [kind, setKind] = useState("");
    const items = (lib.data || []).filter((m) => !kind || m.kind === kind);
    const content = h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
      h(DropZone, { onFiles: up.addFiles, busy: up.busy }), up.error ? h("p", { style: S.error }, up.error) : null,
      h("div", null, h(Seg, { value: kind, onChange: setKind, options: [["", "Everything"], ["image", "Pictures"], ["video", "Videos"], ["pdf", "PDFs"]] })),
      lib.data && !items.length ? h("p", { style: S.hint }, "Nothing here yet.") : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 } }, items.map((m) =>
        h(Tile, { key: m.id, item: m, selected: chosen.includes(m.id), order: picking && chosen.includes(m.id) ? chosen.indexOf(m.id) + 1 : null,
          onToggle: picking ? () => setChosen((c) => (c.includes(m.id) ? c.filter((x) => x !== m.id) : [...c, m.id])) : undefined,
          onRemove: picking ? undefined : () => { if (confirmed(`Delete ${m.name} from the library?`)) void engine.call("media.remove", { id: m.id }).then(() => setBump((b) => b + 1)).catch(() => {}); } }))));
    if (picking) {
      return h("div", { style: { display: "flex", flexDirection: "column", gap: 12, height: "100%" } },
        h("div", { style: { display: "flex", alignItems: "center" } }, h("h2", { style: S.h2 }, "Choose from the media library"), h("span", { style: { ...S.hint, marginLeft: 10 } }, "Click pictures in the order you want them.")),
        h("div", { style: { flex: 1, overflow: "auto" } }, content),
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } }, h("button", { style: S.btn, onClick: () => onPick([]) }, "Cancel"),
          h("button", { style: S.primary, disabled: !chosen.length, onClick: () => onPick(chosen.map((id) => (lib.data || []).find((m) => m.id === id)).filter(Boolean)) }, chosen.length ? `Add ${chosen.length} to the post` : "Choose files")));
    }
    return h(React.Fragment, null, h("div", { style: S.head }, h("h1", { style: S.h1 }, "Media library")), h("div", { style: S.body }, content));
  }

  // ── Editor ──
  function Editor({ group, preset = {}, close, accounts, providers, setView }) {
    const ready = accounts.filter((a) => a.status === "ready");
    const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
    const provOf = (a) => providers.find((p) => p.identifier === a?.network);
    const [loaded, setLoaded] = useState(!group);
    const [d, setD] = useState(() => ({ accounts: preset.accounts || [], text: preset.text || "", media: [], overrides: {}, settings: {}, comments: [], at: toLocalInput(preset.at ? new Date(preset.at) : nextHour()), source: null, posts: [] }));
    const [tab, setTab] = useState("all");
    const [problems, setProblems] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [picking, setPicking] = useState(false);
    const [menu, setMenu] = useState(false);
    const [current, setCurrent] = useState(group || null);
    const fileInput = useRef(null);
    const up = useUploader((item) => addMedia([item]));

    useEffect(() => {
      if (!group) return;
      engine.call("posts.group", { group }).then((g) => {
        setD({ accounts: g.accounts, text: g.text, media: g.media, overrides: g.overrides || {}, settings: g.settings || {}, comments: g.comments || [], at: toLocalInput(new Date(g.publishAt)), source: g.source, posts: g.posts, status: g.status });
        setLoaded(true);
      }).catch((e) => setError(errText(e)));
    }, [group]);

    const draftKey = JSON.stringify([d.accounts, d.text, d.media.map((m) => m.id), d.overrides && stripOverrides(d.overrides), d.settings, d.comments]);
    useEffect(() => {
      if (!loaded) return undefined;
      const t = setTimeout(() => {
        engine.call("posts.validate", { accounts: d.accounts, text: d.text, media: d.media.map(({ id, alt }) => ({ id, alt })), overrides: stripOverrides(d.overrides), settings: d.settings, comments: d.comments })
          .then(setProblems).catch(() => {});
      }, 350);
      return () => clearTimeout(t);
    }, [draftKey, loaded]);
    useEffect(() => { if (tab !== "all" && !d.accounts.includes(tab)) setTab("all"); }, [d.accounts.join(",")]);

    const published = new Set((d.posts || []).filter((p) => p.status === "published" || p.status === "publishing").map((p) => p.account));
    const ov = tab !== "all" ? d.overrides[tab] : null;
    const custom = !!(tab !== "all" && ov && (ov.text !== undefined || ov.media !== undefined));
    const text = custom && ov.text !== undefined ? ov.text : d.text;
    const media = custom && ov.media !== undefined ? ov.media : d.media;
    const editable = tab === "all" || custom;
    const setText = (v) => setD((x) => (tab === "all" ? { ...x, text: v } : { ...x, overrides: { ...x.overrides, [tab]: { ...x.overrides[tab], text: v } } }));
    const setMediaList = (fn) => setD((x) => {
      if (tab === "all") return { ...x, media: fn(x.media) };
      const cur = x.overrides[tab]?.media ?? x.media;
      return { ...x, overrides: { ...x.overrides, [tab]: { ...x.overrides[tab], media: fn(cur) } } };
    });
    function addMedia(items) { setMediaList((list) => [...list, ...items.filter((m) => !list.some((x) => x.id === m.id)).map((m) => ({ id: m.id, name: m.name, kind: m.kind, thumb: m.thumb, pages: m.pages }))]); }
    const toggleAccount = (id) => setD((x) => ({ ...x, accounts: x.accounts.includes(id) ? x.accounts.filter((a) => a !== id) : [...x.accounts, id] }));

    const tabAccount = tab !== "all" ? byId[tab] : null;
    const limits = d.accounts.map((id) => ({ a: byId[id], max: provOf(byId[id])?.maxLength })).filter((x) => x.a && x.max);
    const strict = tab !== "all" ? limits.find((x) => x.a.id === tab) : limits.filter((x) => d.overrides[x.a.id]?.text === undefined).sort((a, b) => a.max - b.max)[0];
    const over = !!strict && text.length > strict.max;
    const caps = tabAccount ? provOf(tabAccount)?.caps : null;
    const errorsFor = (id) => (d.accounts.includes(id) ? problems[id]?.errors || [] : []);
    const anyErrors = d.accounts.some((id) => errorsFor(id).length);

    async function save(mode) {
      setBusy(mode); setError("");
      try {
        const g = await engine.call("posts.save", {
          group: current || undefined, accounts: d.accounts, text: d.text, media: d.media.map(({ id, alt }) => ({ id, alt })), overrides: stripOverrides(d.overrides),
          settings: d.settings, comments: d.comments.filter((c) => c.trim()), at: new Date(d.at).toISOString(), mode, source: d.source || undefined,
        }, 300000);
        setCurrent(g.group);
        close();
      } catch (e) {
        if (e.problems) setProblems(e.problems);
        setError(errText(e));
      } finally { setBusy(""); }
    }
    async function remove() {
      if (!current || !confirmed("Delete this post? Posts already published stay on the networks.")) return;
      await engine.call("posts.delete", { group: current }).catch((e) => setError(errText(e)));
      close();
    }
    async function duplicate() {
      const g = await engine.call("posts.duplicate", { group: current }).catch((e) => (setError(errText(e)), null));
      if (g) { setCurrent(g.group); setD((x) => ({ ...x, posts: g.posts, status: g.status, at: toLocalInput(new Date(g.publishAt)) })); setError(""); }
    }

    if (!loaded) return h("div", { style: S.overlay }, h("div", { style: { ...S.modal, alignItems: "center", justifyContent: "center" } }, error ? h("p", { style: S.error }, error) : "Loading…"));

    const channelRow = h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      h("strong", null, "Post to"),
      ready.length ? h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } }, ready.map((a) => {
        const on = d.accounts.includes(a.id);
        return h("button", { key: a.id, onClick: () => !published.has(a.id) && toggleAccount(a.id), title: `${a.name} (${provOf(a)?.name || a.network})${published.has(a.id) ? " · already posted" : ""}`, "aria-pressed": on,
          style: { ...S.ghost, padding: 3, borderRadius: 999, border: on ? `3px solid ${ACCENT}` : "3px solid transparent", opacity: on ? 1 : 0.45 } }, h(Avatar, { account: a, size: 40 }));
      })) : h("p", { style: S.hint }, "No channels yet. ", h("a", { href: "#", onClick: (e) => { e.preventDefault(); close(); setView("channels"); }, style: { color: ACCENT } }, "Connect one"), " first; you can still save this as a draft."));

    const tabs = d.accounts.length ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderBottom: LINE, paddingBottom: 8 } },
      h("button", { onClick: () => setTab("all"), style: { ...S.btn, background: tab === "all" ? "rgba(109,74,255,0.16)" : "transparent", fontWeight: tab === "all" ? 700 : 500 } }, "All channels"),
      d.accounts.map((id) => {
        const a = byId[id]; if (!a) return null;
        const errs = errorsFor(id).length;
        const isCustom = !!(d.overrides[id] && (d.overrides[id].text !== undefined || d.overrides[id].media !== undefined));
        return h("button", { key: id, onClick: () => setTab(id), title: errs ? errorsFor(id).join(" ") : a.name,
          style: { ...S.btn, display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: tab === id ? "rgba(109,74,255,0.16)" : "transparent", fontWeight: tab === id ? 700 : 500 } },
          h(Avatar, { account: a, size: 22 }), h("span", { style: { maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" } }, a.name),
          isCustom ? h("span", { title: "Has its own version", style: { width: 7, height: 7, borderRadius: 9, background: "#e052ff" } }) : null,
          errs ? h("span", { style: { background: "#d93838", color: "#fff", borderRadius: 999, fontSize: 11, padding: "0 6px", fontWeight: 700 } }, errs) : null);
      })) : null;

    const modeRow = tab !== "all" ? h("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14 } },
      custom
        ? [h("span", { key: "a" }, `This is the version for ${tabAccount?.name}.`), h("button", { key: "b", style: S.btn, onClick: () => { if (confirmed("Use the shared post for this channel again? Its own text and pictures are removed.")) setD((x) => { const o = { ...x.overrides }; delete o[tab]; return { ...x, overrides: o }; }); } }, "Use the shared post again")]
        : [h("span", { key: "a", style: { opacity: 0.75 } }, `${tabAccount?.name} uses the shared post.`), h("button", { key: "b", style: S.btn, onClick: () => setD((x) => ({ ...x, overrides: { ...x.overrides, [tab]: { text: x.text, media: x.media } } })) }, `Write something different for ${provOf(tabAccount)?.name || "this channel"}`)]) : null;

    const textBox = h("div", { style: { border: `1px solid ${over ? "#d93838" : "rgba(127,127,127,0.3)"}`, borderRadius: 12, overflow: "hidden" } },
      h("textarea", { value: text, readOnly: !editable, onChange: (e) => setText(e.target.value), placeholder: editable ? "Write your post…" : "", "aria-label": "Post text",
        style: { ...S.input, border: "none", borderRadius: 0, minHeight: 190, fontSize: 16, lineHeight: 1.5, resize: "vertical", opacity: editable ? 1 : 0.7 } }),
      h("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderTop: LINE, flexWrap: "wrap" } },
        editable ? h("button", { style: S.ghost, onClick: () => fileInput.current?.click(), title: "Upload from this computer" }, "⬆ Upload") : null,
        editable ? h("button", { style: S.ghost, onClick: () => setPicking(true) }, "▣ Media library") : null,
        h("input", { ref: fileInput, type: "file", multiple: true, accept: "image/*,video/mp4,video/quicktime,application/pdf", style: { display: "none" }, onChange: (e) => { void up.addFiles(e.target.files); e.target.value = ""; } }),
        h("div", { style: { flex: 1 } }),
        up.busy.length ? h("span", { style: S.hint }, "Adding…") : null,
        h("span", { style: { fontSize: 12.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: over ? "#fff" : "inherit", background: over ? "#d93838" : "rgba(127,127,127,0.12)" } },
          strict ? `${text.length} / ${strict.max}${tab === "all" && limits.length > 1 ? ` (${provOf(strict.a)?.name})` : ""}` : `${text.length} characters`)));

    const mediaStrip = media.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      h("span", { style: S.hint }, media.length > 1 ? `Carousel · ${media.length} items in this order` : "1 item", editable && media.length > 1 ? " · drag to reorder" : ""),
      h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } }, media.map((m, i) => h("div", {
        key: m.id, draggable: editable,
        onDragStart: (e) => e.dataTransfer.setData("text/x-media", String(i)),
        onDragOver: (e) => { if (editable) e.preventDefault(); },
        onDrop: (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData("text/x-media")); if (Number.isFinite(from) && from !== i) setMediaList((l) => { const c = [...l]; const [x] = c.splice(from, 1); c.splice(i, 0, x); return c; }); },
        style: { width: 104, position: "relative", cursor: editable ? "grab" : "default" },
      },
        h(Tile, { item: m, order: media.length > 1 ? i + 1 : null }),
        editable ? h("button", { onClick: () => setMediaList((l) => l.filter((_, j) => j !== i)), title: "Remove", "aria-label": `Remove ${m.name}`, style: { position: "absolute", right: 4, bottom: 30, ...S.ghost, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "0 7px" } }, "×") : null)))) : null;

    const commentsBox = tab === "all" ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      d.comments.map((c, i) => h("div", { key: i, style: { display: "flex", gap: 8, alignItems: "flex-start" } },
        h("span", { style: { ...S.hint, paddingTop: 10, width: 82 } }, `Comment ${i + 1}`),
        h("textarea", { value: c, onChange: (e) => setD((x) => ({ ...x, comments: x.comments.map((v, j) => (j === i ? e.target.value : v)) })), style: { ...S.input, minHeight: 64, resize: "vertical" } }),
        h("button", { style: S.ghost, onClick: () => setD((x) => ({ ...x, comments: x.comments.filter((_, j) => j !== i) })), title: "Remove" }, "×"))),
      h("div", null, h("button", { style: { ...S.btn, color: ACCENT }, onClick: () => setD((x) => ({ ...x, comments: [...x.comments, ""] })) }, "+ Add a follow-up comment")),
      d.comments.length ? h("p", { style: S.hint }, "Posted under the post right after it goes out (a thread on X). Instagram and LinkedIn comments are text only.") : null) : null;

    const needsOptions = tab === "all" && d.accounts.filter((id) => errorsFor(id).some((e) => /options/.test(e)));
    const left = h("div", { style: { flex: "1 1 600px", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: LINE } },
      h("div", { style: { flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 } },
        d.source ? h("div", { style: { ...S.hint, opacity: 0.85 } }, "From Notion: ", d.source.url ? h(Link, { href: d.source.url }, d.source.title || "open the page") : d.source.title) : null,
        channelRow, tabs, modeRow, textBox, up.error ? h("p", { style: S.error }, up.error) : null, mediaStrip, commentsBox,
        tabAccount && caps?.settings?.length ? h(Options, { account: tabAccount, caps, value: d.settings[tab] || {}, onChange: (v) => setD((x) => ({ ...x, settings: { ...x.settings, [tab]: v } })) }) : null,
        needsOptions && needsOptions.length ? h("p", { style: S.hint }, "Some channels need options (like a board or a title). Open their tab above.") : null),
      d.accounts.some((id) => errorsFor(id).length || problems[id]?.warnings?.length) ? h("div", { style: { padding: "10px 20px", borderTop: LINE, maxHeight: 130, overflow: "auto", background: "rgba(217,56,56,0.06)" } },
        d.accounts.map((id) => {
          const p = problems[id];
          if (!p || (!p.errors?.length && !p.warnings?.length)) return null;
          return h("div", { key: id, style: { fontSize: 13.5, marginBottom: 4 } }, h("a", { href: "#", onClick: (e) => { e.preventDefault(); setTab(id); }, style: { fontWeight: 700, color: "inherit" } }, byId[id]?.name || id), ": ",
            h("span", { style: { color: "#d93838" } }, p.errors.join(" ")), p.warnings?.length ? h("span", { style: { opacity: 0.7 } }, " ", p.warnings.join(" ")) : null);
        })) : null);

    const previewAccount = tabAccount || byId[d.accounts[0]];
    const right = h("div", { style: { flex: "0 1 420px", minWidth: 300, overflow: "auto", padding: 20, background: "rgba(127,127,127,0.05)", display: "flex", flexDirection: "column", gap: 12 } },
      h("strong", null, "Preview"),
      h(Preview, { account: previewAccount, provider: provOf(previewAccount), text: previewAccount && !custom && d.overrides[previewAccount.id]?.text !== undefined ? d.overrides[previewAccount.id].text : text, media: previewAccount && !custom && d.overrides[previewAccount.id]?.media ? d.overrides[previewAccount.id].media : media, comments: d.comments }));

    return h("div", { style: S.overlay, onMouseDown: (e) => { if (e.target === e.currentTarget && !busy) close(); } },
      h("div", { style: S.modal, role: "dialog", "aria-label": current ? "Edit post" : "Create post" },
        h("div", { style: { display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: LINE, gap: 10 } },
          h("h1", { style: { ...S.h1, fontSize: 20 } }, current ? "Edit post" : "Create post"), d.status ? h(Pill, { status: d.status }) : null,
          h("div", { style: { flex: 1 } }),
          (d.posts || []).filter((p) => p.url).map((p) => h("span", { key: p.id, style: { fontSize: 13 } }, h(Link, { href: p.url }, `Open on ${byId[p.account]?.name || p.network}`))),
          h("button", { style: { ...S.ghost, fontSize: 20 }, onClick: close, "aria-label": "Close" }, "×")),
        picking ? h("div", { style: { flex: 1, overflow: "hidden", padding: 20 } }, h(MediaView, { version: 0, picking: true, onPick: (items) => { if (items.length) addMedia(items); setPicking(false); } }))
          : h("div", { style: { flex: 1, display: "flex", overflow: "hidden" } }, left, right),
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: LINE, flexWrap: "wrap" } },
          current ? h("button", { style: S.danger, onClick: remove }, "Delete") : null,
          current ? h("button", { style: S.btn, onClick: duplicate }, "Duplicate") : null,
          error ? h("p", { style: { ...S.error, flex: 1, whiteSpace: "pre-wrap", maxHeight: 60, overflow: "auto" } }, error) : h("div", { style: { flex: 1 } }),
          h("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 } }, "When",
            h("input", { type: "datetime-local", value: d.at, onChange: (e) => setD((x) => ({ ...x, at: e.target.value })), style: { ...S.input, width: "auto" } })),
          h("button", { style: S.btn, disabled: !!busy, onClick: () => save("draft") }, busy === "draft" ? "Saving…" : "Save as draft"),
          h("div", { style: { position: "relative", display: "flex" } },
            h("button", { style: { ...S.primary, borderTopRightRadius: 0, borderBottomRightRadius: 0, opacity: anyErrors || !d.accounts.length ? 0.55 : 1 }, disabled: !!busy || !d.accounts.length, onClick: () => save("schedule") }, busy === "schedule" ? "Scheduling…" : "Add to calendar"),
            h("button", { style: { ...S.primary, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(255,255,255,0.35)", padding: "9px 10px" }, onClick: () => setMenu((m) => !m), "aria-label": "More ways to send" }, "▾"),
            menu ? h("div", { style: { position: "absolute", right: 0, bottom: "110%", background: "Canvas", border: "1px solid rgba(127,127,127,0.3)", borderRadius: 10, padding: 4, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", minWidth: 160 } },
              h("button", { style: { ...S.ghost, width: "100%", textAlign: "left" }, disabled: !!busy || !d.accounts.length, onClick: () => { setMenu(false); void save("now"); } }, busy === "now" ? "Posting…" : "Post now")) : null))));
  }

  function Options({ account, caps, value, onChange }) {
    const set = (k, v) => onChange({ ...value, [k]: v });
    return h("div", { style: S.card }, h("strong", null, `${account.name} options`),
      caps.settings.map((f) => {
        const v = value[f.key] ?? f.default ?? (f.type === "toggle" ? false : "");
        if (f.type === "toggle") return h("label", { key: f.key, style: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 } },
          h("input", { type: "checkbox", checked: !!v, onChange: (e) => set(f.key, e.target.checked), style: { marginTop: 3 } }), h("span", null, f.label, f.help ? h("span", { style: { ...S.hint, display: "block" } }, f.help) : null));
        if (f.type === "select") return h("label", { key: f.key, style: S.label }, f.label,
          h("select", { style: S.input, value: v, onChange: (e) => set(f.key, e.target.value) }, f.options.map((o) => h("option", { key: o.value, value: o.value }, o.label))));
        if (f.type === "lookup") return h(LookupField, { key: f.key, account, field: f, value: v, onChange: (x) => set(f.key, x) });
        return h("label", { key: f.key, style: S.label }, f.label + (f.required ? "" : " (optional)"),
          h("input", { style: S.input, value: v, maxLength: f.max, onChange: (e) => set(f.key, e.target.value) }), f.help ? h("span", { style: S.hint }, f.help) : null);
      }));
  }
  function LookupField({ account, field, value, onChange }) {
    const [q, setQ] = useState("");
    const [opts, setOpts] = useState(null);
    const [err, setErr] = useState("");
    const searchable = /subreddit/i.test(field.method);
    const load = useCallback(() => {
      setErr("");
      engine.call("accounts.options", { account: account.id, method: field.method, params: searchable ? { word: q } : {} }).then(setOpts).catch((e) => setErr(errText(e)));
    }, [account.id, field.method, q]);
    useEffect(() => { if (!searchable) load(); }, [account.id]);
    return h("div", { style: S.label }, field.label,
      searchable ? h("div", { style: { display: "flex", gap: 6 } }, h("input", { style: S.input, value: q, placeholder: "Search…", onChange: (e) => setQ(e.target.value) }), h("button", { style: S.btn, onClick: load }, "Search")) : null,
      h("select", { style: S.input, value: value || "", onChange: (e) => onChange(e.target.value) },
        h("option", { value: "" }, opts || searchable ? "Choose…" : "Loading…"), (opts || []).map((o) => h("option", { key: o.value, value: o.value }, o.label)),
        value && !(opts || []).some((o) => o.value === value) ? h("option", { value }, value) : null),
      err ? h("span", { style: S.error }, err) : null);
  }

  function Preview({ account, provider, text, media, comments }) {
    const [i, setI] = useState(0);
    useEffect(() => setI(0), [media.length]);
    if (!account) return h("p", { style: S.hint }, "Choose a channel to see how the post will look.");
    const doc = provider?.caps?.pdf === "document" && media.length === 1 && media[0].kind === "pdf";
    const square = /instagram|tiktok/.test(account.network);
    const cur = media[Math.min(i, media.length - 1)];
    const pdf = media.find((m) => m.kind === "pdf");
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
      h("div", { style: { background: "Canvas", borderRadius: 14, border: "1px solid rgba(127,127,127,0.2)", overflow: "hidden" } },
        h("div", { style: { display: "flex", gap: 10, alignItems: "center", padding: 12 } }, h(Avatar, { account, size: 38 }),
          h("div", null, h("div", { style: { fontWeight: 700 } }, account.name), h("div", { style: S.hint }, account.username ? `@${account.username}` : provider?.name))),
        text ? h("div", { style: { padding: "0 12px 12px", whiteSpace: "pre-wrap", fontSize: 14.5 } }, text.length > 600 ? `${text.slice(0, 600)}… see more` : text) : null,
        cur ? h("div", { style: { position: "relative", background: "#111" } },
          cur.thumb ? h("img", { src: cur.thumb, alt: "", style: { width: "100%", display: "block", aspectRatio: square ? "1 / 1" : "auto", objectFit: "cover" } })
            : h("div", { style: { height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 40 } }, cur.kind === "video" ? "▶" : "📄"),
          doc ? h("div", { style: { position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "6px 10px", fontSize: 13 } }, `Document · ${cur.pages || "?"} pages · swipe`) : null,
          media.length > 1 ? h("button", { onClick: () => setI((x) => Math.max(0, x - 1)), "aria-label": "Previous slide", style: { position: "absolute", left: 8, top: "45%", ...S.ghost, background: "rgba(0,0,0,0.5)", color: "#fff", borderRadius: 999 } }, "‹") : null,
          media.length > 1 ? h("button", { onClick: () => setI((x) => Math.min(media.length - 1, x + 1)), "aria-label": "Next slide", style: { position: "absolute", right: 8, top: "45%", ...S.ghost, background: "rgba(0,0,0,0.5)", color: "#fff", borderRadius: 999 } }, "›") : null,
          media.length > 1 ? h("div", { style: { position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 } }, media.map((_, j) => h("span", { key: j, style: { width: 6, height: 6, borderRadius: 9, background: j === i ? "#fff" : "rgba(255,255,255,0.45)" } }))) : null) : null,
        h("div", { style: { display: "flex", gap: 18, padding: "10px 12px", opacity: 0.55, fontSize: 13 } }, h("span", null, "♡ Like"), h("span", null, "💬 Comment"), h("span", null, "↗ Share"))),
      comments.filter((c) => c.trim()).map((c, j) => h("div", { key: j, style: { marginLeft: 26, padding: 10, borderRadius: 12, border: "1px solid rgba(127,127,127,0.2)", background: "Canvas", fontSize: 14, whiteSpace: "pre-wrap" } }, c)),
      pdf && !doc ? h("p", { style: S.hint }, `The PDF is posted as ${pdf.pages || "its"} separate slides on ${provider?.name}.`) : null);
  }

  // ── Notion ──
  function NotionView({ version, openEditor }) {
    const st = useLoad("notion.status", {}, [version]);
    const [url, setUrl] = useState("");
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState("");
    const [pieces, setPieces] = useState(null);
    const [changing, setChanging] = useState(false);
    const s = st.data;
    const loadPieces = () => { setBusy("load"); setMsg(null); engine.call("notion.pieces", {}, 180000).then(setPieces).catch((e) => setMsg({ ok: false, text: errText(e) })).finally(() => setBusy("")); };
    useEffect(() => { if (s?.connected && s?.database) loadPieces(); }, [s?.connected, s?.database?.dataSource]);
    let body;
    if (!s) body = h("p", { style: S.hint }, "Loading…");
    else if (!s.connected) body = h("div", { style: { ...S.card, maxWidth: 640 } },
      h("h2", { style: S.h2 }, "Connect Notion"),
      h("p", { style: { margin: 0 } }, "Social Poster reads your content calendar through Notion's own MCP connection. Each piece becomes a draft post with its caption and slides. When the post is scheduled or goes out, Social Poster updates its Status in Notion and adds the live link."),
      h("div", null, h("button", { style: S.primary, onClick: () => engine.call("notion.connect").then((r) => setMsg({ ok: true, text: "Approve Social Poster in the Notion page that just opened in your browser.", url: r.url })).catch((e) => setMsg({ ok: false, text: errText(e) })) }, "Connect Notion")));
    else if (!s.database || changing) body = h("div", { style: { ...S.card, maxWidth: 640 } },
      h("h2", { style: S.h2 }, "Which database holds your content plan?"),
      h("p", { style: { margin: 0 } }, "Open the database in Notion (for example “Content Calendar”), copy its link and paste it here."),
      h("input", { style: S.input, value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://www.notion.so/…" }),
      h("div", { style: { display: "flex", gap: 8 } }, h("button", { style: S.primary, disabled: !url || !!busy, onClick: () => { setBusy("db"); engine.call("notion.setDatabase", { url }, 120000).then(() => { setMsg(null); setChanging(false); }).catch((e) => setMsg({ ok: false, text: errText(e) })).finally(() => setBusy("")); } }, busy === "db" ? "Reading…" : "Use this database"),
        changing ? h("button", { style: S.ghost, onClick: () => setChanging(false) }, "Cancel") : null));
    else body = h("div", { style: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 1000 } },
      h("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } },
        h("span", null, "Reading ", h("strong", null, s.database.title), ". Pieces that are not published yet:"),
        h("button", { style: S.btn, onClick: loadPieces, disabled: !!busy }, busy === "load" ? "Loading…" : "Refresh"),
        h("button", { style: S.ghost, onClick: () => setChanging(true) }, "Use another database")),
      pieces && !pieces.length ? h("p", { style: S.hint }, "Every piece in this database is already published.") : null,
      (pieces || []).map((p) => h("div", { key: p.page, style: { ...S.card, flexDirection: "row", alignItems: "center", gap: 14 } },
        h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } },
          h("strong", null, p.title || "(untitled)"), p.hook ? h("span", { style: { opacity: 0.8, fontSize: 14 } }, p.hook) : null,
          h("span", { style: S.hint }, [p.status, p.channel, p.date].filter(Boolean).join(" · "))),
        p.url ? h(Link, { href: p.url }, "Open in Notion") : null,
        p.post ? h("button", { style: S.btn, onClick: () => openEditor({ group: p.post }) }, "Open post")
          : h("button", { style: S.primary, disabled: busy === p.page, onClick: () => { setBusy(p.page); engine.call("notion.import", { page: p.page }, 300000).then((g) => openEditor({ group: g.group })).catch((e) => setMsg({ ok: false, text: errText(e) })).finally(() => setBusy("")); } }, busy === p.page ? "Importing…" : "Create post"))));
    return h(React.Fragment, null,
      h("div", { style: S.head }, h("h1", { style: S.h1 }, "Notion content calendar"), h("div", { style: { flex: 1 } }),
        s?.connected ? h("button", { style: S.ghost, onClick: () => engine.call("notion.disconnect").catch(() => {}) }, "Disconnect Notion") : null),
      h("div", { style: { ...S.body, display: "flex", flexDirection: "column", gap: 12 } },
        msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text, msg.url ? h("span", null, " ", h(Link, { href: msg.url }, "Open it again")) : null) : null,
        st.error ? h("p", { style: S.error }, st.error) : null, body));
  }

  // ── Channels ──
  const DEV_PORTALS = {
    x: "https://console.x.com", linkedin: "https://www.linkedin.com/developers/apps", "linkedin-page": "https://www.linkedin.com/developers/apps",
    facebook: "https://developers.facebook.com/apps", instagram: "https://developers.facebook.com/apps", "instagram-standalone": "https://developers.facebook.com/apps", threads: "https://developers.facebook.com/apps",
    youtube: "https://console.cloud.google.com/apis/credentials", gmb: "https://console.cloud.google.com/apis/credentials", reddit: "https://www.reddit.com/prefs/apps",
    tiktok: "https://developers.tiktok.com/apps", "tiktok-business": "https://business-api.tiktok.com/portal/apps", pinterest: "https://developers.pinterest.com/apps/",
    discord: "https://discord.com/developers/applications", slack: "https://api.slack.com/apps", twitch: "https://dev.twitch.tv/console/apps", kick: "https://kick.com/settings/developer",
    telegram: "https://t.me/BotFather", tumblr: "https://www.tumblr.com/oauth/apps", dribbble: "https://dribbble.com/account/applications", wrapcast: "https://dev.neynar.com",
    whop: "https://whop.com/dashboard/developer", vk: "https://id.vk.com/about/business/go",
  };
  function ChannelsView({ version, accounts, providers }) {
    const [network, setNetwork] = useState("");
    const [error, setError] = useState("");
    const info = providers.find((p) => p.identifier === network);
    return h(React.Fragment, null,
      h("div", { style: S.head }, h("h1", { style: S.h1 }, "Channels")),
      h("div", { style: S.body }, h("div", { style: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 } },
        h(MainChannels, { accounts, providers }),
        h("section", { style: S.card }, h("h2", { style: S.h2 }, "Connected"), error ? h("p", { style: S.error }, error) : null,
          accounts.length ? accounts.map((a) => h("div", { key: a.id, style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid rgba(127,127,127,0.15)" } },
            h(Avatar, { account: a, size: 38 }), h("div", { style: { flex: 1 } }, h("strong", null, a.name), h("div", { style: S.hint }, `${providers.find((p) => p.identifier === a.network)?.name || a.network}${a.username ? ` · @${String(a.username).replace(/^@/, "")}` : ""}`)),
            a.status === "needs_page" ? h(PagePicker, { account: a }) : null,
            a.status === "disconnected" ? h("button", { style: S.btn, onClick: () => setNetwork(a.network) }, "Reconnect") : null,
            h("button", { style: S.ghost, onClick: () => { if (confirmed(`Remove ${a.name}? Its scheduled posts go back to drafts.`)) engine.call("accounts.remove", { account: a.id }).catch((e) => setError(errText(e))); } }, "Remove")))
            : h("p", { style: S.hint }, "None yet. Pick a network below.")),
        h("section", { style: S.card }, h("h2", { style: S.h2 }, "Add a channel"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 } }, providers.map((p) =>
            h("button", { key: p.identifier, onClick: () => setNetwork(p.identifier), style: { ...S.btn, display: "flex", alignItems: "center", gap: 8, background: network === p.identifier ? "rgba(109,74,255,0.16)" : "transparent" } },
              h("span", { style: { width: 22, height: 22, flex: "0 0 22px", borderRadius: 6, background: net(p.identifier)[1], color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" } }, net(p.identifier)[0]),
              h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, p.name)))),
          info ? h(Connect, { key: info.identifier, info, setup: SETUP[info.identifier] }) : null),
        h(Advanced, { version }))));
  }
  // One-time developer-app notes for the main networks, shown above the steps.
  const SETUP = {
    youtube: ["Create a project, turn on \"YouTube Data API v3\", and set up the consent screen as External.",
      "Set the consent screen to \"In production\". In testing mode Google signs you out every 7 days. When you sign in, Google warns that the app is not verified: click Advanced, then continue.",
      "Create an OAuth client of the type \"Web application\".",
      "Google keeps videos from a new app private until the app passes Google's free YouTube audit. Ask for the audit once your first upload works."],
    x: ["X charges for every post made by an app: about 1.5 cents a post, or 20 cents if the post has a link. You buy credits in the X developer console first.",
      "Under User authentication settings, turn on OAuth 1.0a with \"Read and write\" permission.",
      "Copy the API Key and API Key Secret (the consumer keys)."],
    facebook: ["Choose the app type \"Business\" and add the product \"Facebook Login for Business\".",
      "Leave the app in Development mode. It can then post to the Facebook Pages and Instagram accounts you manage, with no review by Meta.",
      "The same app and keys work for both Facebook and Instagram."],
    instagram: ["Instagram connects through a Meta (Facebook) app. Your Instagram account must be a Business or Creator account linked to your Facebook Page.",
      "Create a Meta app of the type \"Business\" and add \"Facebook Login for Business\". Leave it in Development mode: it can post to accounts you manage with no review.",
      "The same app and keys work for both Facebook and Instagram."],
    "linkedin-page": ["When you create the app, link it to your LinkedIn company page.",
      "Under Products, add \"Sign In with LinkedIn using OpenID Connect\" and request \"Community Management API\". LinkedIn reviews that request, which can take a few days.",
      "Once it is approved, copy the Client ID and Client Secret."],
    tiktok: ["Add \"Login Kit\" and \"Content Posting API\". Turn on Direct Post.",
      "Until TikTok audits your app, posts go up as private (\"Only me\"). Ask for the audit on the app page once your first post works.",
      "Videos upload straight from this computer. Photo posts need a web address you have verified with TikTok, so start with videos."],
  };
  const MAIN = [["youtube", "YouTube", ["youtube"]], ["x", "X (Twitter)", ["x"]], ["facebook", "Facebook Page", ["facebook"]],
    ["instagram", "Instagram", ["instagram", "instagram-standalone"]], ["linkedin-page", "LinkedIn Page", ["linkedin-page", "linkedin"]], ["tiktok", "TikTok", ["tiktok", "tiktok-business"]]];
  function MainChannels({ accounts, providers }) {
    const [open, setOpen] = useState("");
    const [busy, setBusy] = useState("");
    const [msg, setMsg] = useState(null);
    const info = providers.find((p) => p.identifier === open);
    async function connect(id) {
      const p = providers.find((x) => x.identifier === id);
      setMsg(null);
      if (!p?.keysReady) { setOpen(open === id ? "" : id); return; }
      setOpen(""); setBusy(id);
      try { const r = await engine.call("accounts.connect", { provider: id }); setMsg({ ok: true, text: r.message, url: r.url }); }
      catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(""); }
    }
    return h("section", { style: S.card },
      h("h2", { style: S.h2 }, "Main channels"),
      h("p", { style: { margin: 0 } }, "Everything runs on this computer. Each network needs its own free developer app once. After that, Connect opens the network's sign-in page and the channel appears here."),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 } }, MAIN.map(([id, name, nets]) => {
        const mine = accounts.filter((a) => nets.includes(a.network));
        const ready = providers.find((x) => x.identifier === id)?.keysReady;
        const [label, color] = net(id);
        return h("div", { key: id, style: { display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, border: `1px solid ${open === id ? ACCENT : "rgba(127,127,127,0.25)"}` } },
          h("span", { style: { width: 34, height: 34, flex: "0 0 34px", borderRadius: 9, background: color, color: "#fff", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" } }, label),
          h("div", { style: { flex: 1, minWidth: 0 } }, h("strong", null, name),
            h("div", { style: { ...S.hint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, mine.length ? `✓ ${mine.map((a) => a.name).join(", ")}` : ready ? "Ready to connect" : "Needs a developer app")),
          h("button", { style: mine.length || !ready ? S.btn : S.primary, disabled: !!busy, onClick: () => connect(id) }, busy === id ? "Opening…" : !ready ? "Set up" : mine.length ? "Add another" : "Connect"));
      })),
      msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text, msg.url ? h("span", null, " ", h(Link, { href: msg.url }, "Open the sign-in page again")) : null) : null,
      info ? h(Connect, { key: info.identifier, info, setup: SETUP[info.identifier] }) : null);
  }
  function PagePicker({ account }) {
    const pages = useLoad("accounts.pages", { account: account.id }, [account.id]);
    const [error, setError] = useState("");
    if (pages.error) return h("span", { style: S.error }, pages.error);
    if (!pages.data) return h("span", { style: S.hint }, "Loading pages…");
    return h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" } }, h("span", null, "Post as which page?"), error ? h("span", { style: S.error }, error) : null,
      pages.data.map((p) => h("button", { key: p.id, style: S.btn, onClick: () => engine.call("accounts.selectPage", { account: account.id, page: p.id }).catch((e) => setError(errText(e))) }, p.name)));
  }
  function Connect({ info, setup }) {
    const keys = useLoad("keys.get", { provider: info.identifier }, [info.identifier]);
    const [values, setValues] = useState({});
    const [fields, setFields] = useState(() => Object.fromEntries(info.fields.map((f) => [f.key, f.defaultValue || ""])));
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [editing, setEditing] = useState(false);
    async function saveKeys(e) {
      e?.preventDefault?.(); setBusy(true); setMsg(null);
      try { const r = await engine.call("keys.set", { values }); if (r.restart) await engine.restart(); setMsg({ ok: true, text: "Keys saved." }); setValues({}); setEditing(false); }
      catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
    }
    async function connect(e) {
      e?.preventDefault?.(); setBusy(true); setMsg(null);
      try { const r = await engine.call("accounts.connect", { provider: info.identifier, fields: info.login === "fields" ? fields : undefined }); setMsg(r.connected ? { ok: true, text: `${r.account.name} is connected.` } : { ok: true, text: r.message, url: r.url }); }
      catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
    }
    const showKeys = info.keys.length > 0 && (!info.keysReady || editing);
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid rgba(127,127,127,0.15)", paddingTop: 12 } },
      h("strong", null, info.name),
      showKeys ? h("form", { onSubmit: saveKeys, style: { display: "flex", flexDirection: "column", gap: 10 } },
        h("p", { style: { margin: 0 } }, `${info.name} only lets apps post after you create your own free developer app. Do this once:`),
        h("ol", { style: { margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 } },
          h("li", null, "Open the ", DEV_PORTALS[info.identifier] ? h(Link, { href: DEV_PORTALS[info.identifier] }, `${info.name} developer page`) : `${info.name} developer page`, " and create an app."),
          ...(setup || []).map((t, i) => h("li", { key: `s${i}` }, t)),
          h("li", null, "Where it asks for a callback or redirect address, paste:", h("div", { style: { ...S.code, marginTop: 6 } }, info.callbackUrl)),
          h("li", null, "Copy the app's keys into the boxes below and save.")),
        info.keys.map((k) => h("label", { key: k, style: S.label }, keyLabel(k), h("input", { style: S.input, type: /SECRET|TOKEN/.test(k) ? "password" : "text", autoComplete: "off", placeholder: keys.data?.[k] || (k === "MASTODON_URL" ? "https://mastodon.social" : ""), value: values[k] ?? "", onChange: (e) => setValues((v) => ({ ...v, [k]: e.target.value })) }))),
        h("div", { style: { display: "flex", gap: 8 } }, h("button", { type: "submit", style: S.primary, disabled: busy || !Object.values(values).some(Boolean) }, "Save keys"), editing ? h("button", { type: "button", style: S.ghost, onClick: () => setEditing(false) }, "Cancel") : null)) : null,
      !showKeys && info.login === "fields" ? h("form", { onSubmit: connect, style: { display: "flex", flexDirection: "column", gap: 10 } },
        h("p", { style: { margin: 0 } }, `Enter your ${info.name} details. They stay on this computer.`),
        info.identifier === "bluesky" ? h("p", { style: S.hint }, "Use an app password from Bluesky → Settings → Privacy and security → App passwords, not your main password.") : null,
        info.fields.map((f) => h("label", { key: f.key, style: S.label }, f.label, h("input", { style: S.input, type: f.type === "password" ? "password" : "text", autoComplete: "off", value: fields[f.key] ?? "", onChange: (e) => setFields((v) => ({ ...v, [f.key]: e.target.value })) }))),
        h("div", null, h("button", { type: "submit", style: S.primary, disabled: busy }, busy ? "Connecting…" : `Connect ${info.name}`))) : null,
      !showKeys && info.login === "oauth" ? h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        h("button", { style: S.primary, onClick: connect, disabled: busy }, busy ? "Opening…" : `Connect ${info.name}`),
        info.keys.length ? h("button", { style: S.ghost, onClick: () => setEditing(true) }, "Change developer keys") : null,
        h("span", { style: S.hint }, `Approve Social Poster in the ${info.name} page that opens in your browser.`)) : null,
      msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text, msg.url ? h("span", null, " ", h(Link, { href: msg.url }, "Open the sign-in page again")) : null) : null);
  }
  function Advanced({ version }) {
    const status = useLoad("status", {}, [version]);
    const [show, setShow] = useState(false);
    const [url, setUrl] = useState("");
    const [msg, setMsg] = useState(null);
    if (!show) return h("div", null, h("button", { style: S.ghost, onClick: () => setShow(true) }, "Advanced settings"));
    return h("section", { style: S.card }, h("h2", { style: S.h2 }, "Advanced settings"),
      status.data ? h("p", { style: S.hint }, `Data is stored in ${status.data.dataFolder}. ${status.data.scheduled} scheduled, ${status.data.drafts} drafts.`) : null,
      h("p", { style: { margin: 0 } }, "Callback address: networks send you back here after you sign in. LinkedIn and Meta may require an https address; if so, put a tunnel address here that forwards to this computer."),
      status.data ? h("div", { style: S.code }, status.data.callbackBase) : null,
      h("input", { style: S.input, value: url, placeholder: "https://your-tunnel.example.com (leave empty to use this computer)", onChange: (e) => setUrl(e.target.value) }),
      h("div", null, h("button", { style: S.btn, onClick: () => engine.call("settings.callback", { url }).then((r) => setMsg({ ok: true, text: `Callback address is now ${r.callbackBase}` })).catch((e) => setMsg({ ok: false, text: errText(e) })) }, "Save address")),
      h("p", { style: S.hint }, "Instagram, Facebook, Threads, Pinterest and TikTok download pictures themselves. For files that are only on this computer, Social Poster opens a temporary public link (Cloudflare) that serves only those files while posts go out."),
      h("p", { style: S.hint }, "Agents can use Social Poster too: Buzz agents get social_poster_* tools, and any agent with a terminal can run `social-poster --help`."),
      msg ? h("p", { style: msg.ok ? S.ok : S.error }, msg.text) : null);
  }

  return App;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripOverrides(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (!v) continue;
    const x = {};
    if (v.text !== undefined) x.text = v.text;
    if (v.media !== undefined) x.media = v.media.map(({ id, alt }) => ({ id, alt }));
    if (Object.keys(x).length) out[k] = x;
  }
  return out;
}
function nextHour() { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return d; }
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function keyLabel(k) {
  const map = { id: "ID", api: "API", url: "address" };
  return k.toLowerCase().split("_").map((w, i) => map[w] || (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
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
