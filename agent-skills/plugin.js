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
// - Slash commands: typing "/" in a message box lists your agents' skills.
//   When a Claude Code or Codex agent gets a message containing
//   "/skill-name", that skill's full instructions are added to the turn.

export const inject = ["react", "agents", "host", "conversation"];

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
/** The slash command that summons a skill: "Copy Review" → "copy-review". */
export const commandOf = (name) =>
  normalName(name)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The message text in a Buzz turn prompt, so thread history and
 * instructions never count as a summon. Claude Code turns carry it as the
 * "Content:" line of a <buzz-event> block; Codex turns as a JSON "Request:"
 * line. Without that framing the whole prompt is the message. */
export function messageText(prompt) {
  const text = String(prompt ?? "");
  const contents = [];
  const sections =
    /^<(buzz-events?|new-message-arrived-while-you-were-working)(?:\s[^<>\n]*)?>\n([\s\S]*?)\n<\/\1>$/gm;
  for (const [, , body] of text.matchAll(sections)) {
    const request = body.match(/^Request: (.*)$/m);
    if (request) {
      try {
        contents.push(String(JSON.parse(request[1])));
      } catch {
        contents.push(request[1]);
      }
      continue;
    }
    for (const block of body.split(/\n(?=--- Event \d+ )/)) {
      const start = block.indexOf("Content: ");
      if (start < 0) continue;
      const end = block.lastIndexOf("\nTags: ");
      contents.push(block.slice(start + 9, end > start ? end : undefined));
    }
  }
  return contents.length ? contents.join("\n\n") : text;
}

/** The enabled skills a message summons with "/command". */
export function summonedSkills(prompt, skills) {
  const text = messageText(prompt);
  if (!text.includes("/")) return [];
  return skills.filter((skill) => {
    const command = commandOf(skill.name);
    if (!command || skill.enabled === false) return false;
    return new RegExp(
      `(^|[\\s(>\\]*_])/${escapeRegExp(command)}(?=$|[\\s.,!?;:)*_\\]])`,
      "im",
    ).test(text);
  });
}

/** What a summoned skill adds to the turn. */
function summonContext(skills) {
  return skills
    .map(
      (skill) =>
        `The user summoned your skill /${commandOf(skill.name)} in this message. Follow it for this request:\n<skill name="${skill.name}">\n${skill.body.trim()}${folderNote(skill)}\n</skill>`,
    )
    .join("\n\n");
}

// ---- Skill folders ---------------------------------------------------------
// A skill can be linked to a folder (SKILL.md plus reference files). Buzz lets
// plugins read files but not list folders, so reference files are found by
// following the paths SKILL.md (and the files it points to) mention.

/** Files the plugin follows into, looking for more references. */
const TEXT_FILE = /\.(md|markdown|mdx|txt)$/i;
/** Extensions a bare or backticked path needs before it counts as a file. */
const REFERENCE_FILE =
  /\.(md|markdown|mdx|txt|json|jsonl|ya?ml|toml|csv|tsv|html?|css|xml|svg|py|js|mjs|cjs|ts|tsx|jsx|sh|bash|sql|ini|cfg|liquid|png|jpe?g|gif|webp|pdf)$/i;
/** An absolute, home ("~/…") or Windows drive path. */
const ABSOLUTE = /^([/\\~]|[a-z]:[\\/])/i;
const MAX_REFERENCES = 150;
const MAX_LOOKUPS = 400;
/** The most text one `read` returns. */
const READ_LIMIT = 120000;

/** `path` inside the skill folder, as "a/b.md", or "" when it leaves it. */
export function insideFolder(path) {
  const parts = [];
  for (const part of String(path ?? "").split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** `path` as a path inside `folder` ("a/b.md"), or "" when it is elsewhere.
 * A relative path is taken from the folder. An absolute one counts when it
 * is under the folder, or names the folder's own name, as skills written on
 * another computer do ("/home/someone/skills/copy-chief/references/a.md"). */
export function inFolder(path, folder = "") {
  const text = String(path ?? "").trim();
  if (!ABSOLUTE.test(text)) return insideFolder(text);
  const parts = text.split(/[\\/]+/).filter(Boolean);
  const base = String(folder).split(/[\\/]+/).filter(Boolean);
  const name = base[base.length - 1];
  if (!name) return "";
  const own = base.join("/");
  const joined = parts.join("/");
  if (joined.toLowerCase().startsWith(`${own.toLowerCase()}/`))
    return insideFolder(joined.slice(own.length + 1));
  const at = parts.map((part) => part.toLowerCase()).lastIndexOf(name.toLowerCase());
  return at >= 0 && at < parts.length - 1 ? insideFolder(parts.slice(at + 1).join("/")) : "";
}

/** File paths a Markdown text mentions: links, `code` and bare. */
export function referencedPaths(text) {
  const found = new Set();
  const add = (raw, anyExtension) => {
    let path = String(raw).trim().replace(/^<|>$/g, "").split(/[?#]/)[0];
    try {
      path = decodeURI(path);
    } catch {}
    path = path.replace(/[.,;:!?]+$/, "");
    if (!path || path.endsWith("/")) return;
    // URLs are not files; Windows drives ("C:") are.
    if (/^[a-z][a-z0-9+.-]+:/i.test(path)) return;
    if (!anyExtension && !REFERENCE_FILE.test(path)) return;
    if (!/\.[a-z0-9]{1,8}$/i.test(path)) return;
    found.add(path);
  };
  const source = String(text ?? "");
  for (const [, target] of source.matchAll(/\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g))
    add(target, true);
  for (const [, target] of source.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) add(target, true);
  for (const [, code] of source.matchAll(/`([^`\n]+)`/g))
    if (!/\s/.test(code.trim())) add(code, false);
  for (const [, bare] of source.matchAll(
    /(?:^|[\s("'*_[])((?:~?\/|\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[a-z0-9]{1,8})(?=$|[\s)"'*_\],;:!?]|\.(?:\s|$))/gim,
  ))
    add(bare, false);
  return [...found];
}

/** The reference files a skill folder's SKILL.md leads to, relative to the
 * folder. `readText(path)` reads one (relative to the folder) or rejects. */
export async function discoverReferences(readText, body, entry = "SKILL.md", folder = "") {
  const files = new Set();
  const tried = new Set([insideFolder(entry).toLowerCase()]);
  const queue = [{ dir: "", text: body, depth: 0 }];
  let lookups = 0;
  while (queue.length && files.size < MAX_REFERENCES) {
    const { dir, text, depth } = queue.shift();
    for (const ref of referencedPaths(text)) {
      // Relative to the file that mentions it, then to the folder itself.
      const candidates = ABSOLUTE.test(ref)
        ? [inFolder(ref, folder)]
        : [...new Set([insideFolder(`${dir}/${ref}`), insideFolder(ref)])];
      for (const path of candidates) {
        if (!path || files.has(path)) break;
        if (tried.has(path.toLowerCase())) continue;
        if (++lookups > MAX_LOOKUPS) return [...files].sort();
        tried.add(path.toLowerCase());
        let content;
        try {
          content = await readText(path);
        } catch {
          continue;
        }
        files.add(path);
        if (depth < 3 && TEXT_FILE.test(path))
          queue.push({ dir: path.split("/").slice(0, -1).join("/"), text: content, depth: depth + 1 });
        break;
      }
      if (files.size >= MAX_REFERENCES) break;
    }
  }
  return [...files].sort();
}

/** What an agent is told about a linked skill's folder. */
function folderNote(skill) {
  if (!skill.folder) return "";
  const files = skill.files ?? [];
  const lines = [
    "",
    "",
    `This skill is a folder: ${skill.folder}`,
    `When its instructions point to a file in it, read that file with the \`${TOOL}\` tool (action "read", name "${skill.name}", file "<path in the folder>"), or open it straight from the folder if you can read files.`,
  ];
  if (files.length)
    lines.push("Files it refers to:", ...files.map((file) => `- ${file}`));
  return lines.join("\n");
}

const decodeText = (bytes) => new TextDecoder().decode(bytes);

/** Reads a linked skill's entry file and finds its reference files. */
async function readSkillFolder(host, folder, entry = "SKILL.md") {
  if (typeof host?.readFile !== "function")
    throw new Error("This Buzz version can't read files for plugins.");
  const readText = async (path) => decodeText(await host.readFile(path, { cwd: folder }));
  const parsed = parseSkillFile(await readText(entry), folder.split(/[\\/]/).filter(Boolean).pop());
  const files = await discoverReferences(readText, parsed.body, entry, folder);
  return { ...parsed, files };
}

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
      if (skill.folder) {
        entry.folder = String(skill.folder);
        entry.entry = String(skill.entry || "SKILL.md");
        entry.files = Array.isArray(skill.files) ? skill.files.map(String) : [];
      }
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
      'A message that contains "/skill-name" summons that skill: use it for that request.',
      ...onDemand.map(
        (skill) =>
          `- ${skill.name} (/${commandOf(skill.name)})${skill.description ? `: ${skill.description}` : ""}`,
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
      parts.push(`<skill name="${skill.name}">\n${body}${folderNote(skill)}\n</skill>`);
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

  /** Re-reads a linked skill's folder so agents get its current text; keeps
   * the saved copy when the folder can't be read. */
  const refresh = async (pubkey, skill) => {
    if (!skill.folder) return skill;
    try {
      const fresh = await readSkillFolder(host, skill.folder, skill.entry);
      if (!fresh.body) return skill;
      if (
        fresh.body === skill.body &&
        JSON.stringify(fresh.files) === JSON.stringify(skill.files ?? [])
      )
        return skill;
      return await store.save(pubkey, { ...skill, body: fresh.body, files: fresh.files });
    } catch (error) {
      console.warn(`Agent Skills: could not read ${skill.folder}`, error);
      return skill;
    }
  };
  /** `refresh`, but never holding up a turn for long. */
  const refreshQuickly = (pubkey, skill) =>
    Promise.race([
      refresh(pubkey, skill),
      new Promise((resolve) => setTimeout(() => resolve(skill), 4000)),
    ]);

  // ---- Tool: every agent type can list and load its own skills. ----------
  agents.addTool({
    name: TOOL,
    description:
      'Your skills: reusable instructions your owner attached to you in Buzz. Use action "list" to see each skill\'s name and description at the start of a task, and action "load" with a skill name to get its full instructions, then follow them. Some skills are folders with reference files: use action "read" with the skill name and a file path to read one. A message containing "/skill-name" asks you to load and use that skill.',
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "load", "read"],
          description: '"list" your skills, "load" one by name, or "read" a file from a skill\'s folder.',
        },
        name: {
          type: "string",
          description: 'The skill to load or read from (for actions "load" and "read").',
        },
        file: {
          type: "string",
          description: 'A file path inside the skill\'s folder, e.g. "references/voice.md" (for action "read").',
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async call(client, _context, args) {
      const pubkey = pubkeyOf(client?.key);
      const skills = store.list(pubkey).filter((skill) => skill.enabled !== false);
      const find = () => {
        const wanted = normalName(args?.name).replace(/^\//, "");
        if (!wanted) throw new Error("Give the name of the skill.");
        const skill =
          skills.find((s) => normalName(s.name) === wanted) ??
          skills.find((s) => commandOf(s.name) === commandOf(wanted)) ??
          skills.find((s) => normalName(s.name).includes(wanted));
        if (!skill) {
          const names = skills.map((s) => s.name).join(", ") || "none";
          throw new Error(
            `You have no skill named "${args?.name}". Your skills: ${names}.`,
          );
        }
        return skill;
      };
      if (args?.action === "load") {
        const skill = await refresh(pubkey, find());
        return `# Skill: ${skill.name}\n${skill.description ? `${skill.description}\n` : ""}\n${skill.body}${folderNote(skill)}`;
      }
      if (args?.action === "read") {
        const skill = find();
        if (!skill.folder)
          throw new Error(`"${skill.name}" is a single instructions file, with no folder to read from.`);
        const file = inFolder(args?.file, skill.folder);
        if (!file) throw new Error("Give a file path inside the skill's folder.");
        let bytes;
        try {
          bytes = await host.readFile(file, { cwd: skill.folder });
        } catch (error) {
          const known = (skill.files ?? []).join(", ");
          throw new Error(
            `Could not read ${file} from ${skill.folder}: ${error?.message ?? error}.${known ? ` Files it refers to: ${known}.` : ""}`,
          );
        }
        if (bytes.subarray(0, 8000).includes(0))
          return `${file} is a binary file (${bytes.length} bytes) at ${skill.folder}/${file}.`;
        const text = decodeText(bytes);
        return text.length > READ_LIMIT
          ? `${text.slice(0, READ_LIMIT)}\n…[truncated: ${file} is ${text.length} characters]`
          : text;
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
        async run(input, { agent, session }) {
          const pubkey = pubkeyOf(agent);
          // Linked folders that this turn includes in full are re-read first.
          const listed = store.list(pubkey);
          const wanted = new Set(summonedSkills(input?.prompt, listed).map((s) => s.id));
          for (const skill of listed)
            if (skill.folder && skill.enabled !== false && (skill.mode === "always" || wanted.has(skill.id)))
              await refreshQuickly(pubkey, skill);
          const skills = store.list(pubkey);
          const text = skillContext(skills);
          const key = `${harness}|${session}`;
          const print = fingerprint(text);
          const parts = [];
          if (!text) told.delete(key);
          else if (told.get(key) !== print) {
            told.set(key, print);
            parts.push(text);
          }
          const summoned = summonedSkills(input?.prompt, skills);
          if (summoned.length) parts.push(summonContext(summoned));
          if (!parts.length) return undefined;
          return {
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: parts.join("\n\n"),
            },
          };
        },
      });
    } catch (error) {
      console.warn(`Agent Skills: ${harness} prompt hook unavailable`, error);
    }
  }

  // ---- Slash commands: "/" in a message box lists your agents' skills. ---
  if (typeof ctx.conversation?.registerCompletion === "function") {
    ctx.conversation.registerCompletion({
      id: "skill-commands",
      title: "Skills",
      order: 0,
      match: ({ text, start, end }) => slashQuery(text, start, end),
      component: createSlashMenu(React, store, agents),
    });
  }

  // ---- UI: a Skills tab on every agent's settings. -----------------------
  agents.registerTab({
    id: "skills",
    title: "Skills",
    component: createSkillsTab(React, store, agents, host, refresh),
  });
}

/** A "/command" being typed at the caret, at a word start; paths and URLs
 * (a "/" right after other text) never match. */
export function slashQuery(text, caret, end = caret) {
  if (!Number.isInteger(caret) || caret !== end || caret < 0 || caret > text.length)
    return null;
  const before = text.slice(Math.max(0, caret - 80), caret);
  const match = before.match(/(?:^|[\s([{])\/([a-z0-9_-]*)$/iu);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

/** Commands from the community's agents: one row per command, listing each
 * agent that has it. Agents already @mentioned in the draft come first. */
export function slashChoices(query, draft, agentList, skillsOf) {
  const wanted = commandOf(query);
  const mentioned = (agent) =>
    agent.name && String(draft ?? "").toLowerCase().includes(`@${agent.name.toLowerCase()}`);
  const rows = new Map();
  for (const agent of agentList) {
    for (const skill of skillsOf(agent.pubkey)) {
      const command = commandOf(skill.name);
      if (!command || skill.enabled === false) continue;
      if (wanted && !command.includes(wanted)) continue;
      const row = rows.get(command) ?? { command, skill, agents: [], mentioned: false, rank: 2 };
      row.agents.push(agent.name);
      row.mentioned ||= mentioned(agent);
      row.rank = Math.min(row.rank, command === wanted ? 0 : command.startsWith(wanted) ? 1 : 2);
      rows.set(command, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.mentioned) - Number(a.mentioned) ||
      a.rank - b.rank ||
      a.command.localeCompare(b.command),
  );
}

function createSlashMenu(React, store, agents) {
  const { useEffect, useSyncExternalStore } = React;
  // Bumped whenever skills or agents change, so the menu republishes.
  let version = 0;
  const subscribeAll = (listener) => {
    const changed = () => {
      version++;
      listener();
    };
    const a = store.subscribe(changed);
    const b = agents.subscribe(changed);
    return () => {
      a();
      b();
    };
  };
  return function SlashMenu({ query, observation, publish }) {
    const seen = useSyncExternalStore(subscribeAll, () => version);
    useEffect(() => {
      const choices = slashChoices(
        query.query,
        observation.text,
        agents.snapshot().agents ?? [],
        (pubkey) => store.list(pubkey),
      ).slice(0, 50);
      const dispose = publish({
        items: choices.map((row) => ({
          id: `skill:${row.command}`,
          label: `/${row.command}`,
          detail: [row.skill.description, row.agents.join(", ")]
            .filter(Boolean)
            .join(" · "),
          edit: { text: `/${row.command} ` },
        })),
      });
      return dispose || undefined;
    }, [query.query, query.start, observation.revision, seen]);
    return null;
  };
}

function createSkillsTab(React, store, agents, host, refresh) {
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
    const linked = Boolean(draft.folder);
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
      linked
        ? h(
            "p",
            { style: { ...styles.desc, marginTop: 0 } },
            `Linked to ${draft.folder}. The instructions come from its ${draft.entry || "SKILL.md"} and stay in sync: edit the file there, not here. `,
            (draft.files ?? []).length
              ? `The agent can read ${draft.files.length} reference file${draft.files.length === 1 ? "" : "s"}: ${draft.files.join(", ")}.`
              : "No reference files were found in its instructions; the agent can still read any file in the folder by path.",
          )
        : null,
      h(
        "label",
        { style: styles.field },
        linked ? "Instructions (from the folder, read-only)" : "Instructions (Markdown)",
        h("textarea", {
          style: { ...styles.input, ...styles.textarea, ...(linked ? { opacity: 0.75 } : {}) },
          value: draft.body,
          readOnly: linked,
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
    const [link, setLink] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const isFile = /\.(md|markdown|txt)$/i.test(path.trim());
    const isSkillFile = /(^|[\\/])SKILL\.md$/i.test(path.trim());
    // A folder, or a SKILL.md inside one, can be linked; a loose .md cannot.
    const canLink = !isFile || isSkillFile;
    const run = async () => {
      setError("");
      let file = path.trim();
      if (!file) return setError("Enter the path to a SKILL.md file or skill folder.");
      if (!isFile) file = `${file.replace(/[\\/]+$/, "")}/SKILL.md`;
      if (typeof host?.readFile !== "function")
        return setError("This Buzz version can't read files for plugins.");
      setBusy(true);
      try {
        const bytes = await host.readFile(file);
        const text = new TextDecoder().decode(bytes);
        const parts = file.split(/[\\/]/);
        const entry = parts.pop();
        const folderPath = parts.join("/");
        const parsed = parseSkillFile(text, parts[parts.length - 1] ?? "");
        if (!parsed.body) throw new Error("That file has no instructions.");
        if (link && canLink) {
          if (typeof host.resolveDirectory !== "function")
            throw new Error("This Buzz version can't link folders; turn off linking to copy the instructions only.");
          // The file was just read, so the folder exists and is not created.
          const folder = await host.resolveDirectory(folderPath);
          const found = await readSkillFolder(host, folder, entry);
          await onImport({ ...parsed, body: found.body, folder, entry, files: found.files });
        } else await onImport(parsed);
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
        "label",
        {
          style: {
            ...styles.field,
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-2, 8px)",
            fontWeight: 400,
            opacity: canLink ? 1 : 0.6,
          },
        },
        h("input", {
          type: "checkbox",
          checked: link && canLink,
          disabled: !canLink,
          onChange: (event) => setLink(event.target.checked),
        }),
        "Link the whole folder (recommended for skills with reference files)",
      ),
      h(
        "p",
        { style: { ...styles.desc, marginTop: 0 } },
        link && canLink
          ? "Reads the name and description from SKILL.md's frontmatter. The skill stays linked to the folder: changes to SKILL.md show up on the next use, and the agent can read the files it refers to, such as references/…"
          : "Reads the name and description from the file's frontmatter. Only the file's text is copied; files next to it are not.",
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
    const resync = async (skill) => {
      setStatus(`Reading ${skill.folder}…`);
      try {
        const fresh = await readSkillFolder(host, skill.folder, skill.entry);
        if (!fresh.body) throw new Error(`${skill.entry || "SKILL.md"} has no instructions`);
        await store.save(pubkey, { ...skill, body: fresh.body, files: fresh.files });
        setStatus(
          `Refreshed "${skill.name}": ${fresh.files.length} reference file${fresh.files.length === 1 ? "" : "s"}.`,
        );
      } catch (e) {
        setStatus(`Couldn't read "${skill.name}" from ${skill.folder}: ${e?.message ?? e}`);
      }
    };
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
        h(Button, { onClick: () => { setStatus(""); setMode("import"); } }, "Import skill"),
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
                      skill.folder
                        ? h(
                            "span",
                            { style: styles.badge, title: skill.folder },
                            `Folder · ${(skill.files ?? []).length} file${(skill.files ?? []).length === 1 ? "" : "s"}`,
                          )
                        : null,
                      skill.enabled === false ? h("span", { style: styles.badge }, "Off") : null,
                    ),
                    skill.description ? h("p", { style: styles.desc }, skill.description) : null,
                    skill.folder
                      ? h("p", { style: { ...styles.desc, wordBreak: "break-all" } }, skill.folder)
                      : null,
                  ),
                  h(
                    "div",
                    { style: styles.actions },
                    h(Button, { onClick: () => setMode({ edit: skill.id }) }, "Edit"),
                    skill.folder ? h(Button, { onClick: () => resync(skill) }, "Refresh") : null,
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
