// Agent Cards: API v1 plugin for the Buzz desktop app.
//
// Gives agents two kinds of interactive message card:
// - Question card (`cards_ask`): up to 5 questions, single or multiple
//   choice or free text, with an optional "Something else" answer.
// - Approval card (`cards_approval`): Allow once / Deny / Always allow.
//
// How a card works:
// 1. The agent calls a tool. The tool posts a normal message as the agent:
//    readable text first, then a ```buzz-card JSON block.
// 2. On the owner's device (the one running the agent) the plugin draws that
//    message as a card with buttons. Elsewhere it reads as plain text.
// 3. The owner answers. The answer is saved on this device and the agent is
//    woken in the same conversation with the answer.
// The agent can also read an answer later with `cards_answer`.

export const inject = ["react", "agents", "conversation", "host"];

const PREFIX = "lucas.agent-cards.v1:";
const FENCE = "buzz-card";
const HEX64 = /^[0-9a-f]{64}$/i;
const CARD_ID = /^c_[0-9a-f]{16}$/;
const MAX_QUESTIONS = 5;
const MAX_OPTIONS = 12;
const MAX_TEXT = 2000;
const MAX_ANSWER = 4000;
const NO_RULES = Object.freeze([]);
const NO_REQUESTS = Object.freeze({});

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const pubkeyOf = (key) => String(key ?? "").slice(0, 64);

export function newCardId(random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(8));
  return `c_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** A sign-in link: https only. Returns the clean URL, or undefined. */
export function safeLink(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// ---- Card format ---------------------------------------------------------

/** Checks and cleans `cards_ask` questions. Throws a message the agent can act on. */
export function normalizeQuestions(input) {
  if (!Array.isArray(input) || input.length === 0)
    throw new Error("Give at least one question.");
  if (input.length > MAX_QUESTIONS)
    throw new Error(`Ask at most ${MAX_QUESTIONS} questions per card.`);
  const names = new Set();
  return input.map((raw, index) => {
    const q = raw && typeof raw === "object" ? raw : {};
    const prompt = clip(q.prompt, 500);
    if (!prompt) throw new Error(`Question ${index + 1} needs a prompt.`);
    const name = clip(q.name, 64) || `q${index + 1}`;
    if (names.has(name)) throw new Error(`Two questions are named "${name}".`);
    names.add(name);
    const type = q.type ?? (Array.isArray(q.options) ? "single" : "text");
    if (!["single", "multi", "text"].includes(type))
      throw new Error(`Question "${name}": type must be single, multi or text.`);
    const question = { name, prompt, type };
    if (type !== "text") {
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => clip(o, 200))
        .filter(Boolean);
      if (new Set(options).size !== options.length)
        throw new Error(`Question "${name}" repeats an option.`);
      if (options.length < 2 || options.length > MAX_OPTIONS)
        throw new Error(
          `Question "${name}" needs 2 to ${MAX_OPTIONS} options.`,
        );
      question.options = options;
      if (q.allowOther === true) question.allowOther = true;
    }
    return question;
  });
}

/** The message text for a card: readable on its own, then the card block. */
export function cardMessage(card) {
  // Agent text can quote untrusted content: break any code fence in it, so
  // only the block this function adds can be read as a card.
  const t = (value) => String(value ?? "").replace(/`{3,}/g, (run) => run.split("").join("\u200b"));
  const lines = [];
  if (card.kind === "signin") {
    lines.push(`**Sign in to ${t(card.service)}**${card.reason ? `: ${t(card.reason)}` : ""}`);
    if (card.url) lines.push("", `Sign-in page: ${card.url}`);
    if (card.code) lines.push(`Code: ${t(card.code)}`);
    lines.push("", "Reply here when you've signed in.");
  } else if (card.kind === "connect") {
    lines.push(`**Connect ${SERVICES[card.service]?.name ?? card.service}**${card.reason ? `: ${t(card.reason)}` : ""}`);
    lines.push("", "Open this chat in Buzz on the computer that runs this agent to connect it.");
  } else if (card.kind === "approval") {
    lines.push(`**Approval needed:** ${t(card.summary)}`);
    if (card.detail) lines.push("", t(card.detail));
    lines.push("", "Reply with: allow once, deny, or always allow.");
  } else {
    if (card.title) lines.push(`**${t(card.title)}**`, "");
    card.questions.forEach((q, i) => {
      const n = card.questions.length > 1 ? `${i + 1}. ` : "";
      lines.push(`${n}${t(q.prompt)}`);
      if (q.options) {
        const extra = q.allowOther ? ", or something else" : "";
        const how = q.type === "multi" ? "Pick any" : "Pick one";
        lines.push(`   ${how}: ${q.options.map(t).join(" / ")}${extra}`);
      }
    });
  }
  return `${lines.join("\n")}\n\n\`\`\`${FENCE}\n${JSON.stringify(card)}\n\`\`\``;
}

/** Card blocks: the closing fence starts a line, as Markdown's does. */
const cardBlocks = () =>
  new RegExp(`\`\`\`${FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, "g");

/** The card in a message's text, or null. Never throws. */
export function parseCard(content) {
  // The card is the last block: cardMessage always ends with it.
  const blocks = [...String(content ?? "").matchAll(cardBlocks())];
  const match = blocks.at(-1);
  if (!match) return null;
  let card;
  try {
    card = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!card || card.v !== 1 || !CARD_ID.test(card.id ?? "")) return null;
  if (!HEX64.test(card.agent ?? "")) return null;
  const optionalText = (value) => value === undefined || typeof value === "string";
  if (card.kind === "approval") {
    if (typeof card.summary !== "string" || !card.summary) return null;
    if (!optionalText(card.detail) || !optionalText(card.tool)) return null;
    if (!optionalText(card.action)) return null;
    if (card.request !== undefined && !REQUEST_ID.test(card.request)) return null;
    return card;
  }
  if (card.kind === "signin") {
    if (typeof card.service !== "string" || !card.service || card.service.length > 80) return null;
    if (!["link", "browser"].includes(card.method)) return null;
    if (![card.reason, card.code, card.command].every(optionalText)) return null;
    if (card.url !== undefined && safeLink(card.url) !== card.url) return null;
    if (card.method === "link" && !card.url) return null;
    return card;
  }
  if (card.kind === "connect") {
    if (!Object.hasOwn(SERVICES, card.service ?? "") || !optionalText(card.reason)) return null;
    return card;
  }
  if (!optionalText(card.title)) return null;
  if (card.kind === "question") {
    try {
      card.questions = normalizeQuestions(card.questions);
    } catch {
      return null;
    }
    return card;
  }
  return null;
}

/** Whether a card read from a message is the one this device posted. A
 * message can only be answered then, so quoted or altered copies can't. */
export function sameCard(saved, card) {
  const { key: _key, channel: _channel, local: _local, ...posted } = saved;
  return JSON.stringify(posted) === JSON.stringify(card);
}

/** A message's text with the card block taken out. */
export function proseOf(content) {
  return String(content ?? "")
    .replace(cardBlocks(), "")
    .trim();
}

/** Checks a question card's answers against its questions; returns them clean. */
export function checkAnswers(card, answers) {
  const out = {};
  for (const q of card.questions) {
    const value = answers?.[q.name];
    if (q.type === "text") {
      const text = clip(value, MAX_ANSWER);
      if (!text) throw new Error(`Answer "${q.prompt}"`);
      out[q.name] = text;
      continue;
    }
    const picked = (Array.isArray(value) ? value : value ? [value] : [])
      .map((v) => clip(v, MAX_ANSWER))
      .filter(Boolean);
    const known = picked.filter((v) => q.options.includes(v));
    const other = picked.filter((v) => !q.options.includes(v));
    if (other.length && !q.allowOther)
      throw new Error(`"${other[0]}" is not an option for "${q.prompt}"`);
    if (!picked.length) throw new Error(`Answer "${q.prompt}"`);
    if (q.type === "single") {
      if (picked.length !== 1) throw new Error(`Pick one for "${q.prompt}"`);
      out[q.name] = picked[0];
    } else {
      out[q.name] = [...known, ...other];
    }
  }
  return out;
}

/** What the agent is told when its owner answers. */
export function wakeText(card, answer) {
  if (card.kind === "signin") {
    if (answer.started)
      return `Agent Cards: your owner is ready to sign in to ${card.service}, card ${card.id}. Start the sign-in now${card.command ? ` (${card.command})` : ""}, in the background since it waits for the browser; it opens their browser. Then wait for it to finish.`;
    if (!answer.done)
      return `Agent Cards: your owner cancelled signing in to ${card.service}, card ${card.id}. Don't start it again unless they ask.`;
    return `Agent Cards: your owner says they've signed in to ${card.service}, card ${card.id}. Check it worked (for example gh auth status, shopify auth status, claude mcp get <name>), then continue the task. A newly added MCP server's tools only load in a new session: if so, tell your owner it'll be ready in your next conversation.`;
  }
  if (card.kind === "connect") {
    const service = SERVICES[card.service];
    return `Agent Cards: your owner connected ${service.name}${answer.who ? ` (as ${answer.who})` : ""}, card ${card.id}. Call the connections tool with action "call", service "${card.service}", and a method and path from the ${service.name} API (${service.docs}); Agent Cards adds the token. Continue the task.`;
  }
  if (card.kind === "approval") {
    const what = `"${card.summary}"${card.tool ? ` (tool: ${card.tool})` : ""}`;
    const note = answer.note ? ` Their note: ${answer.note}` : "";
    if (answer.decision === "deny")
      return `Agent Cards: your owner DENIED ${what}, card ${card.id}. Do not do it.${note}`;
    if (card.request)
      return `Agent Cards: your owner APPROVED ${what}, card ${card.id}. Retry exactly the same call now; it is allowed${answer.decision === "always" ? " from now on without asking" : " once"}.${note}`;
    const always =
      answer.decision === "always"
        ? ` They chose Always allow, so later cards_approval calls for tool "${card.tool}" are approved without asking.`
        : " This approval covers this one action only.";
    return `Agent Cards: your owner APPROVED ${what}, card ${card.id}. Go ahead now.${always}${note}`;
  }
  return `Agent Cards: your owner answered card ${card.id}${card.title ? ` ("${card.title}")` : ""}. Answers by question name: ${JSON.stringify(answer.answers)}. Continue the task with these answers.`;
}

// ---- Guard: approvals enforced by agent hooks ------------------------------

/** Agent types whose tool calls a PreToolUse hook can stop. */
export const HOOK_HARNESSES = ["buzz.claude-code/claude-code", "buzz.codex/codex"];
const REQUEST_ID = /^r_[0-9a-f]{16}$/;
const GRANT_MS = 24 * 60 * 60 * 1000;

/** What needs approval when an owner turns the guard on. One regular
 * expression per line, matched (ignoring case) against the action: the tool
 * name, or "Bash: <command>" for shell commands. Lines starting # are notes. */
export const DEFAULT_PATTERNS = [
  "# Tools from other services that send, post, buy or delete (Buzz's own tools are never stopped)",
  "^mcp__(?!buzz__).*(send|post|publish|create|delete|remove|trash|archive|update|share|upload|schedule|invite|purchase|buy|pay|refund|cancel|deploy)",
  "# Shell commands that publish or destroy (matched anywhere in the command, across lines)",
  "^Bash: .*\\bgit\\b(\\s+-{1,2}\\S+(\\s+[^-\\s]\\S*)?)*\\s+push\\b",
  "^Bash: .*\\brm\\b(\\s+-{1,2}\\S+)*\\s+(-\\w*[rR]|--recursive)",
  "^Bash: .*\\bgh\\s+(pr\\s+(create|merge)|release\\s+create|repo\\s+delete|issue\\s+create)",
  "^Bash: .*\\bgh\\s+api\\b.*(-X|--method)\\s*(POST|PUT|PATCH|DELETE)",
  "^Bash: .*\\b(npm|pnpm|yarn)\\s+publish\\b",
  "^Bash: .*\\b(curl|wget)\\b.*(-X\\s*(POST|PUT|PATCH|DELETE)|--request\\s*(POST|PUT|PATCH|DELETE)|--data|--form|--upload-file|\\s-[dFT])",
];

/** Off until an owner turns it on for an agent. */
const DEFAULT_GUARD = Object.freeze({ on: false, patterns: DEFAULT_PATTERNS });
/** Ignore case, and let "." cross lines so a newline can't hide a command. */
const PATTERN_FLAGS = "is";
const MAX_ACTION = 8000;

const SHELL_TOOLS = new Set(["bash", "shell", "exec_command", "local_shell"]);
const isShell = (tool) => SHELL_TOOLS.has(String(tool).toLowerCase());

/** The action as patterns and the owner see it. */
export function actionText(tool, input) {
  const name = String(tool ?? "");
  if (isShell(name)) {
    const raw = input?.command ?? input?.cmd;
    const command = Array.isArray(raw) ? raw.join(" ") : raw;
    return `Bash: ${String(command ?? "")}`;
  }
  return name;
}

/** The action with its arguments, for the card, keys sorted so none can
 * be pushed out of view. Too long, it says how much is hidden. */
export function actionDetail(tool, input) {
  let text = actionText(tool, input);
  if (!isShell(tool)) {
    const args = JSON.stringify(JSON.parse(stableJson(input ?? {})), null, 2);
    if (args && args !== "{}") text += `\n${args}`;
  }
  if (text.length <= MAX_ACTION) return text;
  return `${text.slice(0, MAX_ACTION)}\n… ${text.length - MAX_ACTION} more characters not shown. Deny unless you trust the whole call.`;
}

/** Whether an owner's patterns protect an action. A bad pattern is skipped. */
export function isProtected(action, patterns) {
  return patterns.some((line) => {
    const source = String(line).trim();
    if (!source || source.startsWith("#")) return false;
    try {
      return new RegExp(source, PATTERN_FLAGS).test(action);
    } catch {
      return false;
    }
  });
}

/** Whether an Always allow rule covers an action: shell rules name one exact
 * command, other rules a tool. */
export function ruleCovers(rules, tool, action) {
  return rules.some(
    (rule) =>
      rule.source !== "card" &&
      (rule.action ? rule.action === action : rule.tool === tool && !isShell(tool)),
  );
}

/** Whether an Always allow given on an agent's own card covers a later card.
 * These never let a stopped call through: only the guard's own rules do. */
const cardRuleCovers = (rules, tool) =>
  rules.some((rule) => rule.source === "card" && rule.tool === tool);

const stableJson = (value) =>
  Array.isArray(value)
    ? `[${value.map(stableJson).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
          .join(",")}}`
      : JSON.stringify(value ?? null);

/** A fingerprint of one exact call: the same tool with the same arguments. */
export async function callHash(tool, input) {
  // A shell call is its command: Claude rewrites the description on a retry.
  const what = isShell(tool) ? actionText(tool, input) : stableJson(input);
  const bytes = new TextEncoder().encode(`${tool}\n${what}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The PreToolUse decision for one call; undefined lets it run. */
const stop = (reason) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
});

export async function guardCall(store, agentKey, input, now = Date.now()) {
  try {
    return await checkCall(store, agentKey, input, now);
  } catch (error) {
    // Fail closed: a broken check never lets a protected call through.
    console.warn("Agent Cards: approval check failed", error);
    return stop(`Stopped by Agent Cards: the approval check failed (${error?.message ?? error}). Don't retry; tell your owner.`);
  }
}

async function checkCall(store, agentKey, input, now) {
  const pubkey = pubkeyOf(agentKey);
  const settings = store.guard(pubkey);
  if (!settings.on) return undefined;
  const tool = String(input?.tool_name ?? "");
  if (!tool) return undefined;
  let toolInput = input?.tool_input ?? {};
  if (typeof toolInput === "string") {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      toolInput = { command: toolInput };
    }
  }
  const action = actionText(tool, toolInput);
  if (!isProtected(action, settings.patterns)) return undefined;
  if (ruleCovers(store.rules(pubkey), tool, action)) return undefined;
  const hash = await callHash(tool, toolInput);
  if (await store.useGrant(pubkey, hash, now)) return undefined;
  const id = `r_${hash.slice(0, 16)}`;
  await store.addRequest(pubkey, {
    id,
    hash,
    tool,
    action,
    detail: actionDetail(tool, toolInput),
    at: now,
  });
  return stop(`Stopped by Agent Cards: your owner approves this kind of action first. Call cards_approval with request "${id}" and a one-line summary of what this does and why, then end your turn without doing it another way. When you are woken with approval, retry exactly the same call: it is allowed once.`);
}

// ---- Connections: let agents use other services with the owner's token ---
//
// The owner pastes a token into a Connect card or the Connections tab. The
// token goes to the system keychain (through commands the manifest declares)
// and never into a message, the relay or the agent. The agent calls the
// service through the `connections` tool, which adds the token itself and
// only reaches that service's own address.

/** Services an agent can be connected to. Each one's origin is declared in
 * the manifest; requests go nowhere else. */
export const SERVICES = Object.freeze({
  github: {
    name: "GitHub",
    origin: "https://api.github.com",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    test: { method: "GET", path: "/user" },
    who: (b) => b?.login,
    token: "https://github.com/settings/personal-access-tokens",
    docs: "https://docs.github.com/rest",
  },
  notion: {
    name: "Notion",
    origin: "https://api.notion.com",
    headers: { "Notion-Version": "2022-06-28" },
    test: { method: "GET", path: "/v1/users/me" },
    who: (b) => b?.bot?.workspace_name ?? b?.name,
    token: "https://www.notion.so/profile/integrations",
    docs: "https://developers.notion.com/reference",
  },
  asana: {
    name: "Asana",
    origin: "https://app.asana.com",
    test: { method: "GET", path: "/api/1.0/users/me" },
    who: (b) => b?.data?.name ?? b?.data?.email,
    token: "https://app.asana.com/0/my-apps",
    docs: "https://developers.asana.com/reference",
  },
  linear: {
    name: "Linear",
    origin: "https://api.linear.app",
    auth: "plain",
    test: { method: "POST", path: "/graphql", body: { query: "{ viewer { name } }" } },
    who: (b) => b?.data?.viewer?.name,
    token: "https://linear.app/settings/account/security",
    docs: "https://linear.app/developers/graphql",
  },
  slack: {
    name: "Slack",
    origin: "https://slack.com",
    test: { method: "POST", path: "/api/auth.test" },
    ok: (b) => b?.ok === true,
    who: (b) => (b?.team ? `${b.user} in ${b.team}` : b?.user),
    token: "https://api.slack.com/apps",
    docs: "https://api.slack.com/methods",
  },
  airtable: {
    name: "Airtable",
    origin: "https://api.airtable.com",
    test: { method: "GET", path: "/v0/meta/whoami" },
    who: (b) => b?.email ?? b?.id,
    token: "https://airtable.com/create/tokens",
    docs: "https://airtable.com/developers/web/api",
  },
  stripe: {
    name: "Stripe",
    origin: "https://api.stripe.com",
    form: true,
    test: { method: "GET", path: "/v1/account" },
    who: (b) => b?.settings?.dashboard?.display_name ?? b?.email ?? b?.id,
    token: "https://dashboard.stripe.com/apikeys",
    docs: "https://docs.stripe.com/api",
  },
  klaviyo: {
    name: "Klaviyo",
    origin: "https://a.klaviyo.com",
    auth: "klaviyo",
    headers: { revision: "2024-10-15", Accept: "application/vnd.api+json" },
    test: { method: "GET", path: "/api/accounts/" },
    who: (b) => b?.data?.[0]?.attributes?.contact_information?.organization_name,
    token: "https://www.klaviyo.com/settings/account/api-keys",
    docs: "https://developers.klaviyo.com/en/reference",
  },
  hubspot: {
    name: "HubSpot",
    origin: "https://api.hubapi.com",
    test: { method: "GET", path: "/account-info/v3/details" },
    who: (b) => (b?.portalId ? `portal ${b.portalId}` : undefined),
    token: "https://app.hubspot.com/private-apps",
    docs: "https://developers.hubspot.com/docs/api/overview",
  },
});
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_RESPONSE = 60000;

const authHeader = (service, token) =>
  service.auth === "plain" ? token : service.auth === "klaviyo" ? `Klaviyo-API-Key ${token}` : `Bearer ${token}`;

/** Stripe-style form body: nested keys as a[b][0]. */
export function formEncode(value, prefix = "", out = new URLSearchParams()) {
  if (value === null || value === undefined) return out;
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      formEncode(item, prefix ? `${prefix}[${key}]` : key, out);
  } else out.append(prefix, String(value));
  return out;
}

/** The request to a service: only ever its own origin. Throws a message the
 * agent can act on. */
export function serviceRequest(id, token, call) {
  const service = SERVICES[id];
  if (!service) throw new Error(`Unknown service "${id}". Known: ${Object.keys(SERVICES).join(", ")}.`);
  const method = String(call?.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new Error(`method must be one of ${[...METHODS].join(", ")}.`);
  const path = String(call?.path ?? "");
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\s]/.test(path))
    throw new Error(`path must start with "/", e.g. ${service.test.path}`);
  const url = new URL(path, service.origin);
  if (url.origin !== service.origin) throw new Error(`Requests can only go to ${service.origin}.`);
  if (call?.query && typeof call.query === "object")
    for (const [key, value] of Object.entries(call.query))
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const headers = { ...(service.headers ?? {}), Authorization: authHeader(service, token) };
  let body;
  if (call?.body !== undefined && call.body !== null && method !== "GET") {
    if (typeof call.body === "string") body = call.body;
    else if (service.form) body = formEncode(call.body).toString();
    else body = JSON.stringify(call.body);
    headers["Content-Type"] = service.form ? "application/x-www-form-urlencoded" : "application/json";
  }
  return { url: url.toString(), method, headers, ...(body !== undefined ? { body } : {}), timeoutMs: 60000 };
}

/** Checks a token with the service's "who am I" call. Resolves with who it
 * belongs to; throws a message for the owner. */
export async function testConnection(host, id, token) {
  const service = SERVICES[id];
  let response;
  try {
    response = await host.request(serviceRequest(id, token, service.test));
  } catch (error) {
    throw new Error(`Couldn't reach ${service.name}: ${error?.message ?? error}`);
  }
  let body = null;
  try {
    body = JSON.parse(response.body);
  } catch {}
  const ok = response.status >= 200 && response.status < 300 && (!service.ok || service.ok(body));
  if (!ok)
    throw new Error(
      response.status === 403
        ? `${service.name} accepted the token, but it can't read your account details (${service.test.method} ${service.test.path}). Give it read access to your account and try again.`
        : response.status === 401 || (service.ok && !service.ok(body))
          ? `${service.name} didn't accept that token.`
          : `${service.name} answered ${response.status}.`,
    );
  return clip(service.who?.(body) ?? "", 120) || service.name;
}

// The keychain entry holds every token, as base64 JSON, so the manifest can
// declare fixed commands. Each platform has a read and a write command.
const KEYCHAIN = {
  linux: { read: "keychain-linux-read", write: "keychain-linux-write" },
  mac: { read: "keychain-mac-read", write: "keychain-mac-write" },
  windows: { read: "keychain-windows-read", write: "keychain-windows-write" },
};
export function platformOf(nav = globalThis.navigator) {
  const text = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  if (/mac/i.test(text)) return "mac";
  if (/win/i.test(text)) return "windows";
  return "linux";
}
const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const fromBase64 = (text) => new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

export function createKeychain(host, platform = platformOf()) {
  const ids = KEYCHAIN[platform];
  let queue = Promise.resolve();
  const serial = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  /** Every saved token by connection, or null when the keychain can't be read. */
  const read = async () => {
    const out = await host.runCommand(ids.read);
    if (out === null || out === undefined) return null;
    const text = out.trim();
    if (!text) return {};
    try {
      return JSON.parse(fromBase64(text));
    } catch {
      return null;
    }
  };
  const write = async (tokens) => {
    const value = toBase64(JSON.stringify(tokens));
    const input =
      platform === "mac" ? `add-generic-password -U -s buzz-agent-cards -a connections -w ${value}\n` : value;
    const out = await host.runCommand(ids.write, input);
    const failed = "Couldn't save to the system keychain. Check it's unlocked, then try again.";
    if (out === null || out === undefined) throw new Error(failed);
    // Some keychain tools report success when the save failed: check it stuck.
    const back = await read();
    if (JSON.stringify(back) !== JSON.stringify(tokens)) throw new Error(failed);
  };
  return {
    read,
    /** Changes saved tokens. `known` says whether tokens are expected, so a
     * keychain that can't be read is never overwritten with an empty list. */
    update: (change, known) =>
      serial(async () => {
        const tokens = await read();
        if (tokens === null && known)
          throw new Error("Couldn't read the system keychain. Check it's unlocked, then try again.");
        const next = change({ ...(tokens ?? {}) });
        await write(next);
      }),
  };
}

/** Whether a connection serves an agent. */
export const servesAgent = (connection, pubkey) =>
  !!connection && (connection.agents === "all" || (Array.isArray(connection.agents) && connection.agents.includes(pubkey)));

/** Saves a tested token and the connection's details. */
export async function connect({ store, keychain, host }, id, token, access) {
  const value = String(token ?? "").trim();
  if (!value) throw new Error("Paste a token first.");
  const who = await testConnection(host, id, value);
  await keychain.update((tokens) => ({ ...tokens, [id]: value }), Object.keys(store.connections()).length > 0);
  // Adding an agent keeps the others that already use it; narrowing is done
  // by choosing "Only" in the Connections tab of a connection that was "all".
  const before = store.connections()[id]?.agents;
  const agents =
    access !== "all" && Array.isArray(before) ? [...new Set([...before, ...access])] : access;
  await store.setConnection(id, { service: id, who, agents, at: Date.now() });
  return { who, access: agents };
}

/** Removes a connection. Its details go even when the keychain can't be
 * changed, so a lost or locked keychain entry never leaves it stuck; the
 * result says whether the token may still be in the keychain. */
export async function disconnect({ store, keychain }, id) {
  let tokenRemoved = true;
  try {
    await keychain.update((tokens) => {
      delete tokens[id];
      return tokens;
    }, true);
  } catch {
    tokenRemoved = false;
  }
  await store.setConnection(id, null);
  return { tokenRemoved };
}

// ---- Storage ---------------------------------------------------------------

export function createStore(storage) {
  const listeners = new Set();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  // Reads are fresh, so a write from elsewhere is seen, but return the same
  // object while the stored text is unchanged, as useSyncExternalStore needs.
  const cache = new Map();
  const guards = new WeakMap();
  const cached = (key) => {
    const raw = storage.get(PREFIX + key) ?? null;
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value;
    let value = null;
    try {
      value = raw ? JSON.parse(raw) : null;
    } catch {
      value = null;
    }
    cache.set(key, { raw, value });
    return value;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    card: (id) => cached(`card:${id}`),
    async saveCard(card) {
      await storage.set(`${PREFIX}card:${card.id}`, JSON.stringify(card));
    },
    answer: (id) => cached(`answer:${id}`),
    /** A sign-in card's owner clicked Start. */
    started: (id) => cached(`started:${id}`),
    async markStarted(id) {
      const kept = await storage.add(`${PREFIX}started:${id}`, JSON.stringify({ at: Date.now() }));
      changed();
      return kept;
    },
    /** Saves the first answer only; resolves with the answer kept. */
    async answerOnce(id, answer) {
      const kept = await storage.add(
        `${PREFIX}answer:${id}`,
        JSON.stringify(answer),
      );
      changed();
      return JSON.parse(kept);
    },
    /** The agent's guard: off until its owner turns it on. */
    guard(pubkey) {
      const saved = cached(`guard:${pubkey}`);
      if (!saved) return DEFAULT_GUARD;
      if (!guards.has(saved))
        guards.set(saved, {
          on: saved.on === true,
          patterns: Array.isArray(saved.patterns) ? saved.patterns.map(String) : DEFAULT_PATTERNS,
        });
      return guards.get(saved);
    },
    async setGuard(pubkey, guard) {
      await storage.set(`${PREFIX}guard:${pubkey}`, JSON.stringify(guard));
      changed();
    },
    /** Calls the guard stopped, by request id, newest kept. */
    requests: (pubkey) => cached(`requests:${pubkey}`) ?? NO_REQUESTS,
    async addRequest(pubkey, request) {
      const kept = Object.values(this.requests(pubkey))
        .filter((r) => r.id !== request.id && request.at - r.at < GRANT_MS)
        .slice(-49);
      const next = Object.fromEntries([...kept, request].map((r) => [r.id, r]));
      await storage.set(`${PREFIX}requests:${pubkey}`, JSON.stringify(next));
      changed();
    },
    /** One-time passes for exact calls, by call hash. */
    async grant(pubkey, hash, now = Date.now()) {
      const grants = { ...(cached(`grants:${pubkey}`) ?? {}) };
      for (const [key, at] of Object.entries(grants))
        if (now - at > GRANT_MS) delete grants[key];
      grants[hash] = now;
      await storage.set(`${PREFIX}grants:${pubkey}`, JSON.stringify(grants));
    },
    /** Uses up the pass for this exact call; false when there is none. */
    async useGrant(pubkey, hash, now = Date.now()) {
      const grants = { ...(cached(`grants:${pubkey}`) ?? {}) };
      const at = grants[hash];
      if (at === undefined) return false;
      delete grants[hash];
      await storage.set(
        `${PREFIX}grants:${pubkey}`,
        Object.keys(grants).length ? JSON.stringify(grants) : null,
      );
      return now - at <= GRANT_MS;
    },
    /** Connected services, without their tokens. */
    connections: () => cached("connections") ?? NO_REQUESTS,
    async setConnection(id, connection) {
      const next = { ...(cached("connections") ?? {}) };
      if (connection) next[id] = connection;
      else delete next[id];
      await storage.set(`${PREFIX}connections`, Object.keys(next).length ? JSON.stringify(next) : null);
      changed();
    },
    rules: (pubkey) => cached(`rules:${pubkey}`) ?? NO_RULES,
    async setRules(pubkey, rules) {
      await storage.set(
        `${PREFIX}rules:${pubkey}`,
        rules.length ? JSON.stringify(rules) : null,
      );
      changed();
    },
  };
}

// ---- Plugin ----------------------------------------------------------------

export async function apply(ctx) {
  const { agents, conversation, host } = ctx;
  const store = createStore(agents.storage);
  const keychain = createKeychain(host);
  const linked = { store, keychain, host };

  /** Posts `card` as the agent in the conversation it is working in. */
  async function post(client, context, card, local) {
    const channel = context?.channel;
    if (!channel) throw new Error("Cards can only be posted from a conversation.");
    const root =
      context.root && !context.topLevel && HEX64.test(context.root)
        ? context.root.toLowerCase()
        : undefined;
    const full = {
      v: 1,
      ...card,
      agent: pubkeyOf(client.key),
    };
    const tags = [["h", channel]];
    if (root) tags.push(["e", root, "", "reply"]);
    if (client.owner && HEX64.test(client.owner)) tags.push(["p", client.owner]);
    // `local` stays on this device: what the card approves, fixed when posted.
    await store.saveCard({ ...full, key: client.key, channel, ...(local ? { local } : {}) });
    const event = await client.publish({
      kind: 9,
      content: cardMessage(full),
      tags,
    });
    return event.id;
  }

  agents.addTool({
    name: "cards_ask",
    description:
      'Ask your owner one to five questions as an interactive card in this conversation, instead of asking in plain text. Use it when you need a decision or details from them to continue. Each question is single choice, multi choice or free text; set allowOther to let them write their own answer. The card posts right away and this returns its id. Then end your turn: you are woken with the answers when they reply, and you can read them any time with cards_answer.',
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional heading for the card." },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Short key the answer comes back under, e.g. tone.",
              },
              prompt: { type: "string", description: "The question." },
              type: { type: "string", enum: ["single", "multi", "text"] },
              options: {
                type: "array",
                items: { type: "string" },
                description: `2 to ${MAX_OPTIONS} choices, for single and multi.`,
              },
              allowOther: {
                type: "boolean",
                description: 'Adds a "Something else" choice with a text field.',
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
    async call(client, context, args) {
      const card = {
        id: newCardId(),
        kind: "question",
        ...(clip(args?.title, 200) ? { title: clip(args.title, 200) } : {}),
        questions: normalizeQuestions(args?.questions),
      };
      const event = await post(client, context, card);
      return `Posted question card ${card.id} (message ${event}). End your turn now; you will be woken with the answers. Do not repeat the questions in text.`;
    },
  });

  agents.addTool({
    name: "cards_approval",
    description:
      'Ask your owner to approve an action before you take it, as a card with Allow once, Deny and Always allow buttons. Use it before anything that sends, posts outside this chat, buys, deletes or changes something hard to undo. When Agent Cards stopped a tool call, pass the request id it gave you as "request": the card then shows the exact call, and once approved you retry that same call. Otherwise pass the tool or action name as "tool" so Always allow can remember it. If your owner already chose Always allow, this returns approved at once and posts nothing. Otherwise the card posts and this returns its id: end your turn and wait to be woken with the decision. Never take the action before it is approved.',
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One line saying what you will do, e.g. Send 12 outreach emails from lucas@…",
        },
        detail: {
          type: "string",
          description: "Optional detail: recipients, amounts, the exact text.",
        },
        tool: {
          type: "string",
          description: "The tool or action this approves, e.g. gmail_send. Needed for Always allow.",
        },
        request: {
          type: "string",
          description: "The request id (r_…) Agent Cards gave you when it stopped a tool call.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    async call(client, context, args) {
      const summary = clip(args?.summary, 300);
      if (!summary) throw new Error("Say what you want approval for in summary.");
      const pubkey = pubkeyOf(client.key);
      const requestId = clip(args?.request, 40);
      let request;
      if (requestId) {
        request = REQUEST_ID.test(requestId) ? store.requests(pubkey)[requestId] : undefined;
        if (!request)
          throw new Error(`No stopped call ${requestId} for you. Retry the tool call to get a new request id.`);
        if (ruleCovers(store.rules(pubkey), request.tool, request.action))
          return "Approved: your owner set Always allow for this. Retry the call.";
      }
      const tool = request ? request.tool : clip(args?.tool, 100);
      if (!request && tool && cardRuleCovers(store.rules(pubkey), tool))
        return `Approved: your owner set Always allow for "${tool}". Go ahead.`;
      const card = {
        id: newCardId(),
        kind: "approval",
        summary,
        ...(clip(args?.detail, MAX_TEXT) ? { detail: clip(args.detail, MAX_TEXT) } : {}),
        ...(tool ? { tool } : {}),
        // The exact call, from the guard, never from the agent's words.
        ...(request ? { request: request.id, action: request.detail } : {}),
      };
      const local = request ? { hash: request.hash, tool: request.tool, action: request.action } : undefined;
      const event = await post(client, context, card, local);
      return `Posted approval card ${card.id} (message ${event}). Status: pending. End your turn now and do not take the action; you will be woken with the decision.`;
    },
  });

  agents.addTool({
    name: "connections",
    description:
      `Use other services (${Object.values(SERVICES).map((s) => s.name).join(", ")}) with your owner's account. Action "list" shows which are connected for you. If the one you need isn't, action "request" with service and a short reason posts a Connect card: end your turn, and you are woken once your owner connects it. Action "call" makes one authenticated request to a connected service's own API: give service, method, path (e.g. /v1/users/me), and optionally query and body (JSON; Stripe takes form fields the same way). You never see the token; Agent Cards adds it.`,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "request", "call"] },
        service: { type: "string", enum: Object.keys(SERVICES) },
        reason: { type: "string", description: "For request: why you need it, shown on the card." },
        method: { type: "string", enum: [...METHODS] },
        path: { type: "string", description: "For call: the API path, starting with /." },
        query: { type: "object", description: "For call: query parameters." },
        body: { description: "For call: the request body, as JSON." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async call(client, context, args) {
      const pubkey = pubkeyOf(client.key);
      const connections = store.connections();
      const action = args?.action;
      if (action === "list")
        return Object.entries(SERVICES)
          .map(([id, service]) => {
            const c = connections[id];
            const state = !c ? "not connected" : servesAgent(c, pubkey) ? `connected as ${c.who}` : "connected for other agents only";
            return `- ${id} (${service.name}): ${state}. API: ${service.origin} · ${service.docs}`;
          })
          .join("\n");
      const id = String(args?.service ?? "");
      const service = SERVICES[id];
      if (!service) throw new Error(`Give service: one of ${Object.keys(SERVICES).join(", ")}.`);
      if (action === "request") {
        if (servesAgent(connections[id], pubkey))
          return `${service.name} is already connected for you. Use action "call".`;
        const card = {
          id: newCardId(),
          kind: "connect",
          service: id,
          ...(clip(args?.reason, 300) ? { reason: clip(args.reason, 300) } : {}),
        };
        const event = await post(client, context, card);
        return `Posted Connect card ${card.id} (message ${event}). End your turn now; you will be woken when your owner connects ${service.name}.`;
      }
      if (action !== "call") throw new Error('action must be "list", "request" or "call".');
      if (!servesAgent(connections[id], pubkey))
        throw new Error(`${service.name} isn't connected for you. Use action "request" to ask your owner.`);
      const tokens = await keychain.read();
      const token = tokens?.[id];
      if (!token) throw new Error(`The ${service.name} token couldn't be read from the system keychain. Ask your owner to check it's unlocked, or to reconnect ${service.name}.`);
      const response = await host.request(serviceRequest(id, token, args));
      let body = String(response.body ?? "");
      if (body.length > MAX_RESPONSE) body = `${body.slice(0, MAX_RESPONSE)}\n… ${body.length - MAX_RESPONSE} more characters cut. Ask for less (filters, pagination).`;
      const hint = response.status === 401 ? ` ${service.name} rejected the token; ask your owner to reconnect it.` : "";
      return `HTTP ${response.status}${hint}\n${body}`;
    },
  });

  agents.addTool({
    name: "cards_signin",
    description: [
      "Ask your owner to sign in to a service whose login isn't a token, as a card with a Sign in button. Two kinds:",
      '- method "link": a command-line login that prints a link (and maybe a code), e.g. gh auth login --web, shopify auth login, vercel login, gcloud auth login. Start it yourself first in the background so it keeps waiting, then pass the printed url and code. The card shows them; you are woken when your owner says they are done.',
      '- method "browser": a login that opens their browser itself, e.g. a remote MCP server with "Sign in with…". For Claude Code: first run claude mcp add --scope user --transport http <name> <url>, then pass command "claude mcp login <name>". For Codex: codex mcp add <name> --url <url>, then command "codex mcp login <name>". Don\'t run the login yet: you are woken when your owner clicks Start, then run it in the background, and woken again when they finish.',
      "First check whether they're already signed in (e.g. gh auth status). After posting, end your turn.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "What they sign in to, e.g. Shopify CLI, Notion." },
        method: { type: "string", enum: ["link", "browser"] },
        url: { type: "string", description: "For link: the https sign-in link the login printed." },
        code: { type: "string", description: "For link: the one-time code to enter, if any." },
        command: { type: "string", description: "The login command, shown on the card so your owner knows what runs." },
        reason: { type: "string", description: "Why you need it." },
      },
      required: ["service", "method"],
      additionalProperties: false,
    },
    async call(client, context, args) {
      const service = clip(args?.service, 80);
      if (!service) throw new Error("Say what to sign in to in service.");
      const method = args?.method;
      if (!["link", "browser"].includes(method)) throw new Error('method must be "link" or "browser".');
      const url = args?.url ? safeLink(args.url) : undefined;
      if (args?.url && !url) throw new Error("url must be an https link.");
      if (method === "link" && !url) throw new Error('method "link" needs the url the login printed.');
      const card = {
        id: newCardId(),
        kind: "signin",
        service,
        method,
        ...(url ? { url } : {}),
        ...(clip(args?.code, 64) ? { code: clip(args.code, 64) } : {}),
        ...(clip(args?.command, 300) ? { command: clip(args.command, 300) } : {}),
        ...(clip(args?.reason, 300) ? { reason: clip(args.reason, 300) } : {}),
      };
      const event = await post(client, context, card);
      return `Posted sign-in card ${card.id} (message ${event}). End your turn now; you will be woken when your owner ${method === "browser" ? "is ready to start" : "has signed in"}.`;
    },
  });

  agents.addTool({
    name: "cards_answer",
    description:
      "Read your owner's answer to one of your cards by its id (c_…), for example after a restart. Returns pending while they have not answered.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The card id, c_…" } },
      required: ["id"],
      additionalProperties: false,
    },
    async call(client, _context, args) {
      const id = clip(args?.id, 40);
      const card = CARD_ID.test(id) ? store.card(id) : null;
      if (!card || card.agent !== pubkeyOf(client.key))
        throw new Error(`You have no card ${id} on this device.`);
      const answer = store.answer(id);
      if (!answer) return JSON.stringify({ id, status: "pending" });
      const { nonce: _nonce, ...rest } = answer;
      return JSON.stringify({ id, status: "answered", ...rest });
    },
  });

  /** The agent running here that posted `message`, when the card is its own. */
  function cardOwner(message, card) {
    if (card.agent !== message.authorId) return undefined;
    if (message.signerId && message.signerId !== message.authorId) return undefined;
    const running = (agents.snapshot().running ?? []).filter(
      (agent) => agent.pubkey === card.agent,
    );
    // The same agent can run in several communities: prefer the membership
    // that posted the card, which this device saved when it posted it.
    const saved = store.card(card.id);
    if (!saved || !sameCard(saved, card)) return undefined;
    return running.find((agent) => agent.key === saved.key) ?? running[0];
  }

  conversation.registerMessage({
    id: "agent-card",
    title: "Agent card",
    matches(message) {
      const card = parseCard(message.content);
      if (!card || card.agent !== message.authorId) return false;
      // Draw cards only from agents: a person can't post one that looks like an agent's.
      return !!(agents.find?.(card.agent) || cardOwner(message, card));
    },
    component: createCard(ctx.react, store, agents, cardOwner, linked),
  });

  for (const harness of HOOK_HARNESSES) {
    try {
      agents.registerHook({
        id: "approvals",
        harness,
        event: "PreToolUse",
        run: (input, { agent }) => guardCall(store, agent, input),
      });
    } catch (error) {
      console.warn(`Agent Cards: ${harness} approval hook unavailable`, error);
    }
  }

  agents.registerTab({
    id: "connections",
    title: "Connections",
    component: createConnectionsTab(ctx.react, linked),
  });

  agents.registerTab({
    id: "cards",
    title: "Approvals",
    component: createRulesTab(ctx.react, store),
  });
}

// ---- UI ----------------------------------------------------------------------
//
// Drawn with Buzz's design-system classes (buzz-button, buzz-input,
// buzz-choice, …) and tokens, so cards look like the app's own. Each control
// carries data-buzz-ui, which opts it out of the app's fallback styles for
// bare elements. The card shell follows the huddle card's.

const UI = { "data-buzz-ui": "" };
const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
    width: "fit-content",
    minWidth: "min(22rem, 100%)",
    maxWidth: "min(36rem, 100%)",
    boxSizing: "border-box",
    marginTop: "var(--space-1)",
    padding: "var(--space-3) var(--space-4)",
    border: "1px solid var(--border-standard)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-panel)",
  },
  header: { display: "flex", flexDirection: "column", gap: "var(--space-half)" },
  fieldset: { display: "flex", flexDirection: "column", gap: "var(--space-1)", border: 0, padding: 0, margin: 0, minWidth: 0 },
  legend: { padding: 0, marginBottom: "var(--space-1)", fontWeight: "var(--type-weight-medium)" },
  code: {
    margin: 0,
    padding: "var(--space-2) var(--space-3)",
    maxHeight: "12rem",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-caption)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-inset)",
  },
  pre: { margin: 0, whiteSpace: "pre-wrap" },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-1)" },
  tab: { display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "var(--space-4) 0" },
  section: { display: "flex", flexDirection: "column", gap: "var(--space-2)" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-standard)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-panel)",
  },
};

/** The card takes the opposite of the app's vibe level, so it stands out
 * from the messages around it: neutral when the app is "Buzzin'" (high), in
 * the accent colour when it is "Chillin'" (low). */
const VIBE = {
  subscribe(listener) {
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver !== "function") return () => {};
    const observer = new MutationObserver(listener);
    observer.observe(root, { attributes: true, attributeFilter: ["data-color-level"] });
    return () => observer.disconnect();
  },
  level: () => globalThis.document?.documentElement?.dataset?.colorLevel ?? "low",
};
const VIBEY_CARD = {
  background: "var(--accent-9)",
  borderColor: "transparent",
  color: "var(--accent-ink)",
  // Controls inside read against the accent fill.
  "--text-secondary": "var(--accent-ink)",
  "--text-subtle": "var(--accent-ink)",
  "--text-tertiary": "var(--accent-ink)",
  "--interaction-fill": "var(--accent-overlay-soft)",
  "--interaction-border": "var(--accent-ink)",
  "--affordance-prominent": "var(--accent-ink)",
  "--text-on-prominent": "var(--accent-9)",
};

const OTHER = "\u0000other";
const DECISIONS = { once: "Allowed once", always: "Always allowed", deny: "Denied" };

/** One line describing a saved answer. */
export function answerSummary(card, answer) {
  if (card.kind === "approval") return DECISIONS[answer.decision] ?? "Answered";
  if (card.kind === "signin") return answer.done ? `Signed in to ${card.service}` : "Sign-in cancelled";
  if (card.kind === "connect")
    return `Connected${answer.who ? ` as ${answer.who}` : ""} · ${answer.access === "all" ? "all your agents" : "this agent only"}`;
  return card.questions
    .map((q) => {
      const value = answer.answers?.[q.name];
      return `${q.prompt} ${Array.isArray(value) ? value.join(", ") : value}`;
    })
    .join("\n");
}

/** Saves the answer once, applies an approval, and wakes the agent with it. */
export async function submitAnswer(store, agents, message, card, agent, answer) {
  const nonce = newCardId();
  const kept = await store.answerOnce(card.id, { ...answer, at: Date.now(), nonce });
  // Someone answered first (another window): that answer stands, and the
  // agent was already woken with it.
  if (kept.nonce !== nonce) return kept;
  if (card.kind === "approval" && kept.decision !== "deny") {
    // What this card approves, as saved when it was posted: never looked up
    // again, so a later stopped call can't take its place.
    const request = card.request ? store.card(card.id)?.local : undefined;
    // A pass for the exact call the guard stopped: its retry runs once.
    if (request) await store.grant(card.agent, request.hash);
    if (kept.decision === "always" && card.tool) {
      const rule = !request
        ? { tool: card.tool, source: "card" }
        : isShell(request.tool)
          ? { tool: request.tool, action: request.action, source: "guard" }
          : { tool: request.tool, source: "guard" };
      const rules = store.rules(card.agent);
      if (!rules.some((r) => r.tool === rule.tool && r.action === rule.action && r.source === rule.source))
        await store.setRules(card.agent, [...rules, { ...rule, summary: card.summary, at: Date.now() }]);
    }
  }
  try {
    agents.wake(agent.key, {
      channel: message.channelId,
      // The card message's own signed thread, never what its text says. DMs,
      // Solo chats and whole-channel agents take a root too: they key by channel.
      root: (message.threadRootId ?? message.id).toLowerCase(),
      text: wakeText(card, kept),
    });
  } catch (e) {
    throw new Error(
      `Your answer is saved, but the agent could not be woken: ${e?.message ?? e}. It can read the answer with cards_answer.`,
    );
  }
  return kept;
}

function createControls(React) {
  const h = React.createElement;
  const Button = ({ variant = "subtle", children, ...props }) =>
    h(
      "button",
      { type: "button", ...UI, className: "buzz-button", "data-variant": variant, "data-size": "sm", "data-disabled": props.disabled ? "" : undefined, ...props },
      h("span", { className: "buzz-button-label" }, children),
    );
  /** A radio or checkbox drawn as Buzz's own control. The control itself
   * takes focus, so the app's focus ring shows on it. */
  function Choice({ multi, checked, label, disabled, onChange }) {
    const id = React.useId();
    const toggle = () => {
      if (!disabled) onChange();
    };
    return h(
      "label",
      { className: "buzz-choice", "data-size": "sm", onClick: (e) => (e.preventDefault(), toggle()) },
      h(
        "span",
        {
          ...UI,
          role: multi ? "checkbox" : "radio",
          "aria-checked": !!checked,
          "aria-disabled": disabled || undefined,
          "aria-labelledby": id,
          tabIndex: disabled ? -1 : 0,
          onKeyDown: (e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              toggle();
            }
          },
          className: multi ? "buzz-checkbox" : "buzz-radio",
          "data-size": "sm",
          "data-checked": checked ? "" : undefined,
          "data-disabled": disabled ? "" : undefined,
        },
        checked ? (multi ? h("span", { "aria-hidden": true, style: { fontSize: "0.7em", lineHeight: 1 } }, "✓") : h("span", { className: "buzz-radio-indicator" })) : null,
      ),
      h("span", null, h("span", { id, className: "buzz-choice-label" }, label)),
    );
  }
  return { Button, Choice };
}

/** Paste a token, choose who may use it, test it and save it to the keychain. */
function createConnectForm(React, linked, controls) {
  const h = React.createElement;
  const { useState } = React;
  const { Button, Choice } = controls;
  return function ConnectForm({ service: id, agent, onConnected, onCancel }) {
    const service = SERVICES[id];
    const [token, setToken] = useState("");
    const existing = linked.store.connections()[id]?.agents;
    const [access, setAccess] = useState(!agent || existing === "all" ? "all" : "one");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const save = async () => {
      setError("");
      setBusy(true);
      try {
        const agents = access === "all" || !agent ? "all" : [agent.pubkey];
        const result = await connect(linked, id, token, agents);
        setToken("");
        await onConnected?.({ who: result.who, access: result.access === "all" ? "all" : "one" });
      } catch (e) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    };
    return h(
      "form",
      {
        style: { display: "flex", flexDirection: "column", gap: "var(--space-2)" },
        onSubmit: (e) => {
          e.preventDefault();
          if (!busy) save();
        },
      },
      h(
        "label",
        { style: { display: "flex", flexDirection: "column", gap: "var(--space-1)" } },
        h("span", { className: "text-body-sm" }, `${service.name} token`),
        h("input", {
          ...UI,
          className: "buzz-input",
          "data-size": "sm",
          type: "password",
          autoComplete: "off",
          spellCheck: false,
          placeholder: "Paste it here. It goes to your system keychain, never into the chat.",
          value: token,
          disabled: busy,
          onChange: (e) => setToken(e.target.value),
        }),
      ),
      h(
        "span",
        { className: "text-caption text-subtle" },
        "Use the narrowest token that does the job: read-only if it only needs to read. ",
        h("a", { href: service.token, target: "_blank", rel: "noreferrer" }, `Create one in ${service.name}`),
        ".",
      ),
      agent
        ? h(
            "div",
            { ...UI, className: "buzz-radio-group", "data-size": "sm", role: "radiogroup", "aria-label": "Who can use it" },
            h(Choice, { checked: access === "one", disabled: busy, label: `Only ${agent.name}`, onChange: () => setAccess("one") }),
            h(Choice, { checked: access === "all", disabled: busy, label: "All my agents", onChange: () => setAccess("all") }),
          )
        : null,
      h(
        "div",
        { style: styles.actions },
        h(Button, { variant: "prominent", type: "submit", disabled: busy || !token.trim() }, busy ? "Checking…" : "Test and connect"),
        onCancel ? h(Button, { disabled: busy, onClick: onCancel }, "Cancel") : null,
      ),
      error ? h("p", { role: "alert", className: "text-body-sm text-danger", style: { margin: 0 } }, error) : null,
    );
  };
}

function createConnectionsTab(React, linked) {
  const h = React.createElement;
  const { useState, useSyncExternalStore } = React;
  const controls = createControls(React);
  const { Button } = controls;
  const ConnectForm = createConnectForm(React, linked, controls);
  const { store } = linked;
  return function ConnectionsTab({ agent }) {
    const pubkey = agent.pubkey ?? pubkeyOf(agent.key);
    const connections = useSyncExternalStore(store.subscribe, store.connections, store.connections);
    const [open, setOpen] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [error, setError] = useState("");
    React.useEffect(() => {
      setOpen(null);
      setConfirming(null);
      setError("");
    }, [pubkey]);
    const remove = async (id) => {
      setError("");
      setConfirming(null);
      const { tokenRemoved } = await disconnect(linked, id);
      if (!tokenRemoved)
        setError(`Disconnected ${SERVICES[id].name}, but its token couldn't be removed from the system keychain. Remove the "buzz-agent-cards" entry there if you no longer need it.`);
    };
    return h(
      "div",
      { style: styles.tab },
      h(
        "p",
        { className: "text-body-sm text-secondary", style: { margin: 0 } },
        `Services ${agent.name} can use with your account, through its connections tool. Tokens are kept in your system keychain; agents never see them.`,
      ),
      error ? h("p", { role: "alert", className: "text-body-sm text-danger", style: { margin: 0 } }, error) : null,
      Object.entries(SERVICES).map(([id, service]) => {
        const c = connections[id];
        const mine = servesAgent(c, pubkey);
        const state = !c ? "Not connected" : `Connected as ${c.who} · ${c.agents === "all" ? "all your agents" : mine ? `only ${agent.name}` : "other agents only"}`;
        return h(
          "div",
          { key: id, style: { ...styles.row, flexDirection: "column", alignItems: "stretch" } },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" } },
            h("div", null, h("strong", null, service.name), h("div", { className: "text-caption text-subtle" }, state)),
            h(
              "div",
              { style: styles.actions },
              open === id ? null : h(Button, { onClick: () => setOpen(id) }, c ? "Replace token" : "Connect"),
              c
                ? confirming === id
                  ? h(Button, { variant: "destructive", onClick: () => remove(id), title: "Every agent using it loses access, and the token is deleted" }, `Confirm: disconnect ${service.name}`)
                  : h(Button, { variant: "destructive", onClick: () => setConfirming(id) }, "Disconnect")
                : null,
            ),
          ),
          open === id
            ? h(ConnectForm, { key: `${pubkey}:${id}`, service: id, agent: { name: agent.name, pubkey }, onConnected: () => setOpen(null), onCancel: () => setOpen(null) })
            : null,
        );
      }),
    );
  };
}

function createCard(React, store, agents, cardOwner, linked) {
  const h = React.createElement;
  const { useState, useSyncExternalStore } = React;
  const controls = createControls(React);
  const { Choice } = controls;
  const ConnectForm = createConnectForm(React, linked, controls);
  // On the accent fill the main button is drawn inverted so it still stands out.
  const Primary = React.createContext("prominent");
  const Button = ({ variant, ...props }) =>
    h(controls.Button, { variant: variant === "prominent" ? React.useContext(Primary) : variant, ...props });
  const submit = (...args) => submitAnswer(store, agents, ...args);

  function Questions({ card, onSubmit, busy }) {
    const [values, setValues] = useState({});
    const [others, setOthers] = useState({});
    const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));
    const answers = () => {
      const out = {};
      for (const q of card.questions) {
        const value = values[q.name];
        const other = clip(others[q.name], MAX_ANSWER);
        if (q.type === "single") out[q.name] = value === OTHER ? other : value;
        else if (q.type === "multi") out[q.name] = (value ?? []).map((v) => (v === OTHER ? other : v));
        else out[q.name] = value;
      }
      return out;
    };
    return h(
      "form",
      {
        style: { display: "contents" },
        onSubmit: (event) => {
          event.preventDefault();
          onSubmit(answers());
        },
      },
      card.questions.map((q) => {
        const multi = q.type === "multi";
        const current = values[q.name];
        const otherOn = q.allowOther && (multi ? (current ?? []).includes(OTHER) : current === OTHER);
        return h(
          "fieldset",
          { key: q.name, style: styles.fieldset, disabled: busy },
          h("legend", { className: "text-body-sm", style: styles.legend }, q.prompt),
          q.type === "text"
            ? h("textarea", {
                ...UI,
                className: "buzz-textarea",
                rows: 3,
                value: current ?? "",
                onChange: (e) => set(q.name, e.target.value),
              })
            : h(
                "div",
                { ...UI, className: "buzz-radio-group", "data-size": "sm", role: multi ? "group" : "radiogroup" },
                [...q.options, ...(q.allowOther ? [OTHER] : [])].map((option) => {
                  const checked = multi ? (current ?? []).includes(option) : current === option;
                  return h(Choice, {
                    key: option,
                    multi,
                    checked,
                    disabled: busy,
                    name: `${card.id}:${q.name}`,
                    label: option === OTHER ? "Something else" : option,
                    onChange: () =>
                      set(q.name, multi ? (checked ? current.filter((v) => v !== option) : [...(current ?? []), option]) : option),
                  });
                }),
              ),
          otherOn
            ? h("input", {
                ...UI,
                className: "buzz-input",
                "data-size": "sm",
                placeholder: "Your answer",
                "aria-label": `Your answer: ${q.prompt}`,
                autoFocus: true,
                value: others[q.name] ?? "",
                onChange: (e) => setOthers((o) => ({ ...o, [q.name]: e.target.value })),
              })
            : null,
        );
      }),
      h("div", { style: styles.actions }, h(Button, { variant: "prominent", type: "submit", disabled: busy }, busy ? "Sending…" : "Send answers")),
    );
  }

  function SignIn({ card, started, busy, onStart, onDone }) {
    const [copied, setCopied] = useState(false);
    const host = card.url ? new URL(card.url).host : "";
    const copy = async () => {
      try {
        await globalThis.navigator?.clipboard?.writeText(card.code);
        setCopied(true);
      } catch {}
    };
    const finish = [
      h(Button, { key: "done", variant: card.method === "browser" ? "prominent" : "subtle", disabled: busy, onClick: () => onDone(true) }, "I've signed in"),
      h(Button, { key: "cancel", disabled: busy, onClick: () => onDone(false) }, "Cancel"),
    ];
    if (card.method === "browser")
      return started
        ? h(
            React.Fragment,
            null,
            h("p", { className: "text-body-sm", style: { margin: 0 } }, "Finish signing in in the browser window that opened, then come back here."),
            h("div", { style: styles.actions }, ...finish),
          )
        : h(
            React.Fragment,
            null,
            h("p", { className: "text-body-sm text-secondary", style: { margin: 0 } }, "Start opens your browser to sign in. Nothing runs until you click it."),
            h(
              "div",
              { style: styles.actions },
              h(Button, { variant: "prominent", disabled: busy, onClick: onStart }, "Start sign-in"),
              h(Button, { disabled: busy, onClick: () => onDone(false) }, "Cancel"),
            ),
          );
    return h(
      React.Fragment,
      null,
      card.code
        ? h(
            "div",
            { style: { ...styles.actions, gap: "var(--space-2)" } },
            h("span", { className: "text-body-sm" }, "Code"),
            h("code", { style: { ...styles.code, fontSize: "var(--text-body)", letterSpacing: "0.08em", padding: "var(--space-1) var(--space-2)" } }, card.code),
            h(Button, { onClick: copy }, copied ? "Copied" : "Copy"),
          )
        : null,
      h(
        "div",
        { style: styles.actions },
        h(
          "a",
          { ...UI, className: "buzz-button", "data-variant": React.useContext(Primary), "data-size": "sm", href: card.url, target: "_blank", rel: "noreferrer" },
          h("span", { className: "buzz-button-label" }, "Open sign-in page"),
        ),
        ...finish,
      ),
      h("span", { className: "text-caption text-subtle" }, `Opens ${host}. Only continue if that's the service you expect.`),
    );
  }

  function Approval({ card, onSubmit, busy }) {
    const [note, setNote] = useState("");
    const decide = (decision) => onSubmit({ decision, ...(clip(note, 500) ? { note: clip(note, 500) } : {}) });
    const always = card.request && card.action?.startsWith("Bash: ") ? "Always allow this command" : "Always allow";
    return h(
      React.Fragment,
      null,
      h("input", {
        ...UI,
        className: "buzz-input",
        "data-size": "sm",
        placeholder: "Note to the agent (optional)",
        "aria-label": "Note to the agent",
        value: note,
        disabled: busy,
        onChange: (e) => setNote(e.target.value),
      }),
      h(
        "div",
        { style: styles.actions },
        h(Button, { variant: "prominent", disabled: busy, onClick: () => decide("once") }, "Allow once"),
        card.tool ? h(Button, { disabled: busy, onClick: () => decide("always"), title: `Approve ${card.tool} from now on without asking` }, always) : null,
        h(Button, { variant: "destructive", disabled: busy, onClick: () => decide("deny") }, "Deny"),
      ),
    );
  }

  return function AgentCard({ message }) {
    const card = parseCard(message.content);
    const readAnswer = () => store.answer(card.id);
    const answer = useSyncExternalStore(store.subscribe, readAnswer, readAnswer);
    useSyncExternalStore(agents.subscribe, agents.snapshot, agents.snapshot);
    const vibey = useSyncExternalStore(VIBE.subscribe, VIBE.level, VIBE.level) !== "high";
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const agent = cardOwner(message, card);
    const prose = proseOf(message.content);

    const onSubmit = async (value) => {
      setError("");
      let clean = value;
      try {
        if (card.kind === "question") clean = { answers: checkAnswers(card, value) };
      } catch (e) {
        return setError(`${e?.message ?? e}.`);
      }
      setBusy(true);
      try {
        await submit(message, card, agent, clean);
      } catch (e) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    };

    const readStarted = () => store.started(card.id);
    const started = useSyncExternalStore(store.subscribe, readStarted, readStarted);
    const signin = card.kind === "signin";
    const approval = card.kind === "approval";
    const connecting = card.kind === "connect";
    const service = connecting ? SERVICES[card.service] : undefined;
    const title = approval ? card.summary : connecting ? `Connect ${service.name}` : signin ? `Sign in to ${card.service}` : card.title;
    const eyebrow = approval ? (card.request ? "Approval needed · stopped by Agent Cards" : "Approval needed") : connecting ? "Connect an app" : signin ? "Sign in" : "Question";
    const start = async () => {
      setError("");
      setBusy(true);
      try {
        if (store.started(card.id)) return;
        await store.markStarted(card.id);
        agents.wake(agent.key, {
          channel: message.channelId,
          root: (message.threadRootId ?? message.id).toLowerCase(),
          text: wakeText(card, { started: true }),
        });
      } catch (e) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    };

    let body;
    if (answer) {
      body = h(
        "p",
        { className: "text-body-sm text-secondary", style: styles.pre },
        `${answer.decision === "deny" ? "✕" : "✓"} ${answerSummary(card, answer)}${answer.note ? ` · “${answer.note}”` : ""}`,
      );
    } else if (!agent) {
      body = h("p", { className: "text-caption text-subtle", style: { margin: 0 } }, "Waiting for the agent's owner, on the computer that runs this agent.");
    } else if (signin) {
      body = h(SignIn, { card, started: !!started, busy, onStart: start, onDone: (done) => onSubmit({ done }) });
    } else if (connecting) {
      body = h(ConnectForm, {
        service: card.service,
        agent: { name: agent.name, pubkey: agent.pubkey },
        onConnected: ({ who, access }) => onSubmit({ who, access }),
      });
    } else if (approval) {
      body = h(Approval, { card, onSubmit, busy });
    } else {
      body = h(Questions, { card, onSubmit, busy });
    }

    return h(Primary.Provider, { value: vibey ? "inverted" : "prominent" }, h(
      "div",
      { style: vibey ? { ...styles.card, ...VIBEY_CARD } : styles.card, "data-agent-card": card.kind, "data-vibe": vibey ? "vibey" : "neutral", "aria-busy": busy || undefined },
      h(
        "div",
        { style: styles.header },
        h("span", { className: "text-caption text-subtle" }, eyebrow),
        title ? h("strong", null, title) : null,
      ),
      signin && card.reason ? h("p", { className: "text-body-sm text-secondary", style: styles.pre }, card.reason) : null,
      signin && card.command ? h("pre", { style: styles.code }, card.command) : null,
      connecting && card.reason ? h("p", { className: "text-body-sm text-secondary", style: styles.pre }, card.reason) : null,
      approval && card.detail ? h("p", { className: "text-body-sm text-secondary", style: styles.pre }, card.detail) : null,
      approval && (card.action || card.tool) ? h("pre", { style: styles.code }, card.action ?? card.tool) : null,
      !approval && !connecting && !signin && !answer && !agent && prose ? h("p", { className: "text-body-sm", style: styles.pre }, prose) : null,
      body,
      error ? h("p", { role: "alert", className: "text-body-sm text-danger", style: { margin: 0 } }, error) : null,
    ));
  };
}

function createRulesTab(React, store) {
  const h = React.createElement;
  const { useState, useSyncExternalStore } = React;
  const { Button, Choice } = createControls(React);
  return function ApprovalsTab({ agent }) {
    const pubkey = agent.pubkey ?? pubkeyOf(agent.key);
    const readRules = () => store.rules(pubkey);
    const readGuard = () => store.guard(pubkey);
    const rules = useSyncExternalStore(store.subscribe, readRules, readRules);
    const guard = useSyncExternalStore(store.subscribe, readGuard, readGuard);
    const [draft, setDraft] = useState(null);
    const [status, setStatus] = useState("");
    React.useEffect(() => {
      setDraft(null);
      setStatus("");
    }, [pubkey]);
    const hooked = HOOK_HARNESSES.includes(agent.type);
    const reviewed = !!agent.protection;
    const text = draft ?? guard.patterns.join("\n");
    const badLine = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => {
        if (!line || line.startsWith("#")) return false;
        try {
          new RegExp(line, PATTERN_FLAGS);
          return false;
        } catch {
          return true;
        }
      });
    const savePatterns = async (patterns) => {
      await store.setGuard(pubkey, { ...guard, patterns });
      setDraft(null);
      setStatus("Saved.");
    };
    return h(
      "div",
      { style: styles.tab },
      h(
        "section",
        { style: styles.section },
        h("strong", null, "Ask me before risky actions"),
        h(
          "p",
          { className: "text-body-sm text-secondary", style: { margin: 0 } },
          hooked
            ? `When this is on, ${agent.name} can't run an action that matches the list below until you approve it on a card. Allow once lets that exact call run one time.`
            : `This needs a Claude Code or Codex agent. ${agent.name} can still ask for approval with a card, but nothing stops it from skipping the card.`,
        ),
        reviewed && hooked
          ? h("p", { role: "note", className: "text-body-sm", style: { margin: 0, color: "var(--text-warning)" } }, `${agent.name} runs with Buzz's security review, which doesn't run plugin checks, so this can't stop its actions.`)
          : null,
        hooked
          ? h(Choice, {
              multi: true,
              checked: !!guard.on,
              label: guard.on ? "On" : "Off",
              onChange: () => store.setGuard(pubkey, { ...guard, on: !guard.on }),
            })
          : null,
      ),
      hooked && guard.on
        ? h(
            "section",
            { style: styles.section },
            h("strong", null, "Actions that need approval"),
            h(
              "p",
              { className: "text-body-sm text-secondary", style: { margin: 0 } },
              'One pattern per line, matched against the tool name, or "Bash: " and the command for shell commands. Lines starting with # are notes.',
            ),
            h("textarea", {
              ...UI,
              className: "buzz-textarea",
              rows: 9,
              spellCheck: false,
              style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)" },
              "aria-invalid": badLine ? "true" : undefined,
              value: text,
              onChange: (e) => {
                setStatus("");
                setDraft(e.target.value);
              },
            }),
            badLine ? h("p", { role: "alert", className: "text-body-sm text-danger", style: { margin: 0 } }, `Not a valid pattern: ${badLine}`) : null,
            h(
              "div",
              { style: styles.actions },
              h(Button, { variant: "prominent", disabled: draft === null || !!badLine, onClick: () => savePatterns(text.split("\n")) }, "Save"),
              h(Button, { onClick: () => savePatterns(DEFAULT_PATTERNS) }, "Reset to defaults"),
              status ? h("span", { role: "status", className: "text-caption text-subtle" }, status) : null,
            ),
          )
        : null,
      h(
        "section",
        { style: styles.section },
        h("strong", null, "Always allowed"),
        rules.length
          ? rules.map((rule) =>
              h(
                "div",
                { key: `${rule.tool}|${rule.action ?? ""}`, style: styles.row },
                h(
                  "div",
                  { style: { minWidth: 0 } },
                  h("div", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)", overflowWrap: "anywhere" } }, rule.action ?? rule.tool),
                  rule.summary ? h("div", { className: "text-caption text-subtle" }, `First approved for: ${rule.summary}`) : null,
                ),
                h(Button, { onClick: () => store.setRules(pubkey, rules.filter((r) => r !== rule)) }, "Remove"),
              ),
            )
          : h("p", { className: "text-body-sm text-secondary", style: { margin: 0 } }, "Nothing yet. Choosing Always allow on an approval card adds it here."),
      ),
    );
  };
}
