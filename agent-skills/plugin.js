// Agent Skills: API v1 plugin for the Buzz desktop app (0.7 preview).
//
// Each agent gets its own list of skills, saved in Buzz's agent storage under
// the agent's pubkey, so they follow the agent into every community.
//
// How an agent receives its skills:
// - Every agent type: the `agent_skills` tool lists and loads the calling
//   agent's own skills.
// - Claude Code and Codex agents: a UserPromptSubmit hook adds the skill list
//   (and any always-on skills in full) to the turn, once per session and again
//   whenever the skills change or the session is compacted.

export const inject = ["react", "agents", "host"];

const STORE_PREFIX = "lucas.agent-skills.v1:";
const TOOL = "agent_skills";
const HOOK_HARNESSES = ["buzz.claude-code/claude-code", "buzz.codex/codex"];
/** Always-on skill text injected per turn is capped so a large skill cannot
 * crowd out the conversation. */
const ALWAYS_ON_LIMIT = 24000;

const pubkeyOf = (key) => String(key ?? "").slice(0, 64);
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const normalName = (name) => String(name ?? "").trim().toLowerCase();

/** Reads YAML-ish frontmatter (name, description) from a SKILL.md file. */
export function parseSkillFile(text, fallbackName = "") {
  const source = String(text ?? "").replace(/^﻿/, "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fields = {};
  let body = source;
  if (match) {
    body = match[2];
    let current = null;
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (field) {
        current = field[1].toLowerCase();
        fields[current] = field[2];
      } else if (current && /^\s+\S/.test(line)) {
        fields[current] += ` ${line.trim()}`;
      }
    }
  }
  const clean = (value) =>
    String(value ?? "")
      .trim()
      .replace(/^[>|][-+]?\s*/, "")
      .replace(/^(["'])([\s\S]*)\1$/, "$2")
      .trim();
  return {
    name: clean(fields.name) || fallbackName,
    description: clean(fields.description),
    body: body.trim(),
  };
}

function createSkillStore(storage) {
  const listeners = new Set();
  const cache = new Map();
  const keyOf = (pubkey) => `${STORE_PREFIX}${pubkey}`;
  const read = (pubkey) => {
    if (!pubkey) return [];
    if (cache.has(pubkey)) return cache.get(pubkey);
    let skills = [];
    try {
      const raw = storage.get(keyOf(pubkey));
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.skills))
        skills = parsed.skills.filter(
          (skill) => skill && typeof skill.name === "string",
        );
    } catch (error) {
      console.warn("Agent Skills: could not read saved skills", error);
    }
    skills = Object.freeze(skills.map((skill) => Object.freeze({ ...skill })));
    cache.set(pubkey, skills);
    return skills;
  };
  const write = async (pubkey, skills) => {
    const frozen = Object.freeze(
      skills.map((skill) => Object.freeze({ ...skill })),
    );
    cache.set(pubkey, frozen);
    for (const listener of listeners) listener();
    await storage.set(
      keyOf(pubkey),
      frozen.length ? JSON.stringify({ version: 1, skills: frozen }) : null,
    );
  };
  return {
    list: read,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Adds or replaces (by id, then by name) a skill. */
    async save(pubkey, skill) {
      const skills = [...read(pubkey)];
      const entry = {
        id: skill.id || newId(),
        name: String(skill.name).trim(),
        description: String(skill.description ?? "").trim(),
        body: String(skill.body ?? ""),
        mode: skill.mode === "always" ? "always" : "on-demand",
        enabled: skill.enabled !== false,
        updatedAt: Date.now(),
      };
      if (!entry.name) throw new Error("A skill needs a name");
      const clash = skills.find(
        (other) =>
          other.id !== entry.id &&
          normalName(other.name) === normalName(entry.name),
      );
      let index = skills.findIndex((other) => other.id === entry.id);
      if (clash && index === -1) {
        // Same name, new entry: replace the existing skill.
        entry.id = clash.id;
        index = skills.indexOf(clash);
      } else if (clash) {
        throw new Error(`This agent already has a skill named "${clash.name}"`);
      }
      if (index === -1) skills.push(entry);
      else skills[index] = entry;
      await write(pubkey, skills);
      return entry;
    },
    async remove(pubkey, id) {
      await write(
        pubkey,
        read(pubkey).filter((skill) => skill.id !== id),
      );
    },
  };
}

/** What a Claude Code or Codex turn is told about the agent's skills. */
function skillContext(skills) {
  const enabled = skills.filter((skill) => skill.enabled !== false);
  if (!enabled.length) return "";
  const onDemand = enabled.filter((skill) => skill.mode !== "always");
  const always = enabled.filter((skill) => skill.mode === "always");
  const parts = [
    "# Your skills",
    "Your owner attached these skills to you in Buzz. They are yours alone; other agents have their own.",
  ];
  if (onDemand.length) {
    parts.push(
      `When a task matches a skill below, load it before you start with the \`${TOOL}\` tool (action "load" and the skill's name; search for the tool if it is not loaded yet) and follow its instructions.`,
      ...onDemand.map(
        (skill) =>
          `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}`,
      ),
    );
  }
  if (always.length) {
    parts.push("## Always-on skills", "Follow these on every task:");
    let budget = ALWAYS_ON_LIMIT;
    for (const skill of always) {
      let body = skill.body.trim();
      if (body.length > budget) {
        body = `${body.slice(0, Math.max(0, budget))}\n…[truncated: load the full text with ${TOOL}]`;
      }
      budget -= body.length;
      parts.push(`<skill name="${skill.name}">\n${body}\n</skill>`);
    }
  }
  return parts.join("\n");
}

/** A short, stable fingerprint of what was injected. */
function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

export async function apply(ctx) {
  const { agents, host } = ctx;
  const React = ctx.react;
  const store = createSkillStore(agents.storage);

  // ---- Tool: every agent type can list and load its own skills. ----------
  agents.addTool({
    name: TOOL,
    description:
      'Your skills: reusable instructions your owner attached to you in Buzz. Use action "list" to see each skill\'s name and description at the start of a task, and action "load" with a skill name to get its full instructions, then follow them.',
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "load"],
          description: '"list" your skills, or "load" one by name.',
        },
        name: {
          type: "string",
          description: 'The skill to load (for action "load").',
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async call(client, _context, args) {
      const skills = store
        .list(pubkeyOf(client?.key))
        .filter((skill) => skill.enabled !== false);
      if (args?.action === "load") {
        const wanted = normalName(args.name);
        if (!wanted) throw new Error('Give the name of the skill to load.');
        const skill =
          skills.find((s) => normalName(s.name) === wanted) ??
          skills.find((s) => normalName(s.name).includes(wanted));
        if (!skill) {
          const names = skills.map((s) => s.name).join(", ") || "none";
          throw new Error(
            `You have no skill named "${args.name}". Your skills: ${names}.`,
          );
        }
        return `# Skill: ${skill.name}\n${skill.description ? `${skill.description}\n` : ""}\n${skill.body}`;
      }
      if (!skills.length)
        return "You have no skills attached. Your owner can add them in this agent's Skills settings tab.";
      return skills
        .map(
          (s) =>
            `- ${s.name}${s.mode === "always" ? " (always on)" : ""}${s.description ? `: ${s.description}` : ""}`,
        )
        .join("\n");
    },
  });

  // ---- Hooks: Claude Code and Codex are told their skills each session. ---
  /** session id → fingerprint of the skill context it last received. */
  const told = new Map();
  ctx.effect(() => () => told.clear());
  for (const harness of HOOK_HARNESSES) {
    const forget = (_input, { session }) => {
      told.delete(`${harness}|${session}`);
      return undefined;
    };
    const resets =
      harness === "buzz.codex/codex"
        ? ["SessionStart", "PreCompact", "PostCompact"]
        : ["SessionStart", "PreCompact"];
    for (const event of resets) {
      try {
        agents.registerHook({ id: `reset-${event}`, harness, event, run: forget });
      } catch (error) {
        console.warn(`Agent Skills: ${harness} ${event} hook unavailable`, error);
      }
    }
    try {
      agents.registerHook({
        id: "skills",
        harness,
        event: "UserPromptSubmit",
        run(_input, { agent, session }) {
          const text = skillContext(store.list(pubkeyOf(agent)));
          const key = `${harness}|${session}`;
          const print = fingerprint(text);
          if (!text) {
            told.delete(key);
            return undefined;
          }
          if (told.get(key) === print) return undefined;
          told.set(key, print);
          return {
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: text,
            },
          };
        },
      });
    } catch (error) {
      console.warn(`Agent Skills: ${harness} prompt hook unavailable`, error);
    }
  }

  // ---- UI: a Skills tab on every agent's settings. -----------------------
  agents.registerTab({
    id: "skills",
    title: "Skills",
    component: createSkillsTab(React, store, agents, host),
  });
}

function createSkillsTab(React, store, agents, host) {
  const h = React.createElement;
  const { useState, useSyncExternalStore } = React;

  const styles = {
    root: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4, 16px)",
      padding: "var(--space-4, 16px) 0",
      color: "var(--text-standard, inherit)",
    },
    intro: { color: "var(--text-secondary, inherit)", margin: 0 },
    row: {
      display: "flex",
      gap: "var(--space-3, 12px)",
      alignItems: "flex-start",
      justifyContent: "space-between",
      padding: "var(--space-3, 12px) var(--space-4, 16px)",
    },
    list: { display: "flex", flexDirection: "column", gap: "var(--space-2, 8px)" },
    name: { fontWeight: 600, margin: 0 },
    desc: {
      color: "var(--text-secondary, inherit)",
      margin: "var(--space-1, 4px) 0 0",
      fontSize: "var(--text-sm, 13px)",
    },
    badge: {
      display: "inline-block",
      marginLeft: "var(--space-2, 8px)",
      padding: "0 var(--space-2, 8px)",
      borderRadius: "var(--radius-pill, 999px)",
      border: "1px solid var(--border, currentColor)",
      fontSize: "var(--text-xs, 11px)",
      fontWeight: 500,
      color: "var(--text-secondary, inherit)",
      verticalAlign: "middle",
    },
    actions: {
      display: "flex",
      gap: "var(--space-2, 8px)",
      flexWrap: "wrap",
      flexShrink: 0,
    },
    button: {
      font: "inherit",
      fontSize: "var(--text-sm, 13px)",
      padding: "var(--space-1, 4px) var(--space-3, 12px)",
      borderRadius: "var(--radius-control, 6px)",
      border: "1px solid var(--border, currentColor)",
      background: "var(--surface, transparent)",
      color: "inherit",
      cursor: "pointer",
    },
    primary: {
      background: "var(--text-standard, #111)",
      color: "var(--surface, #fff)",
      borderColor: "transparent",
    },
    field: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-1, 4px)",
      fontSize: "var(--text-sm, 13px)",
      fontWeight: 500,
    },
    input: {
      font: "inherit",
      fontWeight: 400,
      padding: "var(--space-2, 8px)",
      borderRadius: "var(--radius-control, 6px)",
      border: "1px solid var(--border-input, var(--border, currentColor))",
      background: "var(--surface, transparent)",
      color: "inherit",
    },
    textarea: {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "var(--text-sm, 13px)",
      minHeight: "16rem",
      resize: "vertical",
    },
    form: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3, 12px)",
      padding: "var(--space-4, 16px)",
    },
    error: { color: "var(--text-warning, #b45309)", margin: 0 },
    toolbar: { display: "flex", gap: "var(--space-2, 8px)", flexWrap: "wrap" },
  };
  const Button = ({ primary, ...props }) =>
    h("button", {
      type: "button",
      ...props,
      style: { ...styles.button, ...(primary ? styles.primary : {}), ...props.style },
    });

  function Editor({ initial, onSave, onCancel }) {
    const [draft, setDraft] = useState(
      initial ?? { name: "", description: "", body: "", mode: "on-demand", enabled: true },
    );
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const set = (field) => (event) =>
      setDraft((d) => ({ ...d, [field]: event.target.value }));
    const save = async () => {
      setError("");
      if (!draft.name.trim()) return setError("Give the skill a name.");
      if (!draft.body.trim()) return setError("Write the skill's instructions.");
      setSaving(true);
      try {
        await onSave(draft);
      } catch (e) {
        setError(e?.message ?? String(e));
        setSaving(false);
      }
    };
    return h(
      "div",
      { className: "ui-card", style: styles.form },
      h(
        "label",
        { style: styles.field },
        "Name",
        h("input", {
          style: styles.input,
          value: draft.name,
          placeholder: "e.g. copy-review",
          onChange: set("name"),
        }),
      ),
      h(
        "label",
        { style: styles.field },
        "When to use it",
        h("input", {
          style: styles.input,
          value: draft.description,
          placeholder: "One line the agent reads to decide when this skill applies",
          onChange: set("description"),
        }),
      ),
      h(
        "label",
        { style: styles.field },
        "Instructions (Markdown)",
        h("textarea", {
          style: { ...styles.input, ...styles.textarea },
          value: draft.body,
          placeholder: "Step-by-step instructions the agent follows when it uses this skill",
          onChange: set("body"),
        }),
      ),
      h(
        "label",
        { style: styles.field },
        "Load",
        h(
          "select",
          { style: styles.input, value: draft.mode, onChange: set("mode") },
          h("option", { value: "on-demand" }, "When a task matches (recommended)"),
          h("option", { value: "always" }, "Always: include in every turn"),
        ),
      ),
      error ? h("p", { role: "alert", style: styles.error }, error) : null,
      h(
        "div",
        { style: styles.toolbar },
        h(Button, { primary: true, disabled: saving, onClick: save }, saving ? "Saving…" : "Save skill"),
        h(Button, { onClick: onCancel, disabled: saving }, "Cancel"),
      ),
    );
  }

  function Importer({ onImport, onCancel }) {
    const [path, setPath] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const run = async () => {
      setError("");
      let file = path.trim();
      if (!file) return setError("Enter the path to a SKILL.md file or skill folder.");
      if (!/\.(md|markdown|txt)$/i.test(file)) file = `${file.replace(/\/+$/, "")}/SKILL.md`;
      if (typeof host?.readFile !== "function")
        return setError("This Buzz version can't read files for plugins.");
      setBusy(true);
      try {
        const bytes = await host.readFile(file);
        const text = new TextDecoder().decode(bytes);
        const folder = file.split("/").slice(-2, -1)[0] ?? "";
        const parsed = parseSkillFile(text, folder);
        if (!parsed.body) throw new Error("That file has no instructions.");
        await onImport(parsed);
      } catch (e) {
        const message = e?.message ?? String(e);
        setError(/No such file/i.test(message) ? `No file at ${file}` : message);
        setBusy(false);
      }
    };
    return h(
      "div",
      { className: "ui-card", style: styles.form },
      h(
        "label",
        { style: styles.field },
        "SKILL.md file or skill folder",
        h("input", {
          style: styles.input,
          value: path,
          placeholder: "~/.claude/skills/copywriting",
          onChange: (event) => setPath(event.target.value),
          onKeyDown: (event) => event.key === "Enter" && run(),
        }),
      ),
      h(
        "p",
        { style: { ...styles.desc, marginTop: 0 } },
        "Reads the name and description from the file's frontmatter. Only the SKILL.md text is copied; files next to it are not.",
      ),
      error ? h("p", { role: "alert", style: styles.error }, error) : null,
      h(
        "div",
        { style: styles.toolbar },
        h(Button, { primary: true, disabled: busy, onClick: run }, busy ? "Importing…" : "Import"),
        h(Button, { onClick: onCancel, disabled: busy }, "Cancel"),
      ),
    );
  }

  function CopyTo({ skill, from, onDone }) {
    const others = (agents.snapshot().agents ?? []).filter(
      (agent) => agent.pubkey !== from,
    );
    const [target, setTarget] = useState(others[0]?.pubkey ?? "");
    const [error, setError] = useState("");
    const copy = async () => {
      try {
        const { id: _id, ...rest } = skill;
        await store.save(target, rest);
        onDone(others.find((a) => a.pubkey === target)?.name ?? "agent");
      } catch (e) {
        setError(e?.message ?? String(e));
      }
    };
    if (!others.length)
      return h("p", { style: styles.desc }, "No other agents in this community.");
    return h(
      "div",
      { style: { ...styles.toolbar, alignItems: "center", marginTop: "var(--space-2, 8px)" } },
      h(
        "select",
        {
          style: styles.input,
          value: target,
          "aria-label": "Copy to agent",
          onChange: (event) => setTarget(event.target.value),
        },
        others.map((agent) => h("option", { key: agent.pubkey, value: agent.pubkey }, agent.name)),
      ),
      h(Button, { primary: true, onClick: copy }, "Copy"),
      h(Button, { onClick: () => onDone(null) }, "Cancel"),
      error ? h("p", { role: "alert", style: styles.error }, error) : null,
    );
  }

  return function SkillsTab({ agent }) {
    const pubkey = agent.pubkey ?? pubkeyOf(agent.key);
    const skills = useSyncExternalStore(store.subscribe, () => store.list(pubkey));
    const [mode, setMode] = useState(null); // null | "new" | "import" | {edit: id}
    const [copying, setCopying] = useState(null);
    const [status, setStatus] = useState("");
    const hooked = HOOK_HARNESSES.includes(agent.type);

    const saveAndClose = async (draft) => {
      const saved = await store.save(pubkey, draft);
      setMode(null);
      setStatus(`Saved "${saved.name}".`);
    };
    const toggle = (skill) =>
      store.save(pubkey, { ...skill, enabled: skill.enabled === false });
    const remove = async (skill) => {
      if (!globalThis.confirm?.(`Delete the skill "${skill.name}" from ${agent.name}?`)) return;
      await store.remove(pubkey, skill.id);
      setStatus(`Deleted "${skill.name}".`);
    };

    if (mode === "new") return h("div", { style: styles.root }, h(Editor, { onSave: saveAndClose, onCancel: () => setMode(null) }));
    if (mode === "import")
      return h(
        "div",
        { style: styles.root },
        h(Importer, {
          onImport: (parsed) => setMode({ edit: null, draft: { ...parsed, mode: "on-demand", enabled: true } }),
          onCancel: () => setMode(null),
        }),
      );
    if (mode && typeof mode === "object") {
      const initial = mode.draft ?? skills.find((s) => s.id === mode.edit);
      return h("div", { style: styles.root }, h(Editor, { initial, onSave: saveAndClose, onCancel: () => setMode(null) }));
    }

    return h(
      "div",
      { style: styles.root },
      h(
        "p",
        { style: styles.intro },
        `Skills are reusable instructions only ${agent.name} gets. It sees each skill's name and description, and loads the full instructions when a task matches.`,
        hooked
          ? ""
          : ` This agent type finds its skills through the ${TOOL} tool, so mention it in the agent's instructions if it doesn't check on its own.`,
      ),
      h(
        "div",
        { style: styles.toolbar },
        h(Button, { primary: true, onClick: () => { setStatus(""); setMode("new"); } }, "New skill"),
        h(Button, { onClick: () => { setStatus(""); setMode("import"); } }, "Import SKILL.md"),
      ),
      status ? h("p", { role: "status", style: styles.desc }, status) : null,
      skills.length
        ? h(
            "div",
            { style: styles.list },
            skills.map((skill) =>
              h(
                "div",
                { key: skill.id, className: "ui-card", style: { ...styles.row, flexDirection: "column", opacity: skill.enabled === false ? 0.6 : 1 } },
                h(
                  "div",
                  { style: { display: "flex", width: "100%", gap: "var(--space-3, 12px)", justifyContent: "space-between" } },
                  h(
                    "div",
                    { style: { minWidth: 0 } },
                    h(
                      "p",
                      { style: styles.name },
                      skill.name,
                      skill.mode === "always" ? h("span", { style: styles.badge }, "Always on") : null,
                      skill.enabled === false ? h("span", { style: styles.badge }, "Off") : null,
                    ),
                    skill.description ? h("p", { style: styles.desc }, skill.description) : null,
                  ),
                  h(
                    "div",
                    { style: styles.actions },
                    h(Button, { onClick: () => setMode({ edit: skill.id }) }, "Edit"),
                    h(Button, { onClick: () => toggle(skill) }, skill.enabled === false ? "Turn on" : "Turn off"),
                    h(Button, { onClick: () => setCopying(copying === skill.id ? null : skill.id) }, "Copy to…"),
                    h(Button, { onClick: () => remove(skill) }, "Delete"),
                  ),
                ),
                copying === skill.id
                  ? h(CopyTo, {
                      skill,
                      from: pubkey,
                      onDone: (name) => {
                        setCopying(null);
                        if (name) setStatus(`Copied "${skill.name}" to ${name}.`);
                      },
                    })
                  : null,
              ),
            ),
          )
        : h("p", { style: styles.desc }, "No skills yet."),
    );
  };
}
