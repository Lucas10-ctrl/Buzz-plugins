#!/usr/bin/env node
// Social Poster engine: Postiz's social network connectors, without Postiz's
// servers. One Node process holds the accounts and the post queue in a SQLite
// file, publishes posts when they are due, and runs a small local web server
// for account logins (OAuth callbacks), media files and the `social-poster`
// command line tool.
//
//   social-poster-engine --stdio   started by the Buzz plugin; JSON lines on
//                                  stdin/stdout; exits when stdin closes
//   social-poster-engine           standalone (for example a systemd service)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const VERSION = '0.1.0';
const STDIO = process.argv.includes('--stdio');
const HOME = process.env.SOCIAL_POSTER_HOME || path.join(os.homedir(), '.local', 'share', 'social-poster');
const UPLOADS = path.join(HOME, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
fs.chmodSync(HOME, 0o700);

// Anything a connector prints must never reach stdout, which carries the
// protocol in --stdio mode.
const log = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
console.log = console.info = console.warn = console.error = console.debug = log;

// ── Storage ────────────────────────────────────────────────────────────────

const db = new DatabaseSync(path.join(HOME, 'social-poster.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    internal_id TEXT NOT NULL,
    root_internal_id TEXT,
    name TEXT NOT NULL,
    username TEXT,
    picture TEXT,
    token TEXT NOT NULL,
    refresh_token TEXT,
    token_expiration INTEGER,
    custom_instance_details TEXT,
    additional_settings TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ready',
    status_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    text TEXT NOT NULL,
    media TEXT NOT NULL DEFAULT '[]',
    settings TEXT NOT NULL DEFAULT '{}',
    publish_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    release_url TEXT,
    platform_post_id TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_due ON posts (status, publish_at);
  CREATE TABLE IF NOT EXISTS pending_logins (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    reconnect_account TEXT,
    created_at INTEGER NOT NULL
  );
`);
fs.chmodSync(path.join(HOME, 'social-poster.db'), 0o600);

const getSetting = (key, fallback = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));

const newId = () => crypto.randomBytes(9).toString('base64url');
const now = () => Date.now();

if (!getSetting('secret')) setSetting('secret', crypto.randomBytes(32).toString('hex'));
if (!getSetting('apiToken')) setSetting('apiToken', crypto.randomBytes(24).toString('hex'));
const PORT = Number(process.env.SOCIAL_POSTER_PORT || getSetting('port', 47321));
const callbackBase = () => String(getSetting('callbackBase', `http://127.0.0.1:${PORT}`)).replace(/\/+$/, '');

// ── Developer keys each network needs (from each Postiz connector) ─────────

const KEYS = {
  x: ['X_API_KEY', 'X_API_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  'linkedin-page': ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  reddit: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  instagram: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  'instagram-standalone': ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  threads: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  gmb: ['GOOGLE_GMB_CLIENT_ID', 'GOOGLE_GMB_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  'tiktok-business': ['TIKTOK_BUSINESS_CLIENT_ID', 'TIKTOK_BUSINESS_CLIENT_SECRET'],
  pinterest: ['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'],
  dribbble: ['DRIBBBLE_CLIENT_ID', 'DRIBBBLE_CLIENT_SECRET'],
  discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN_ID'],
  slack: ['SLACK_ID', 'SLACK_SECRET'],
  kick: ['KICK_CLIENT_ID', 'KICK_SECRET'],
  twitch: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
  mastodon: ['MASTODON_URL', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET'],
  wrapcast: ['NEYNAR_CLIENT_ID', 'NEYNAR_SECRET_KEY'],
  telegram: ['TELEGRAM_TOKEN'],
  vk: ['VK_ID'],
  whop: ['WHOP_CLIENT_ID'],
  tumblr: ['TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET'],
  mewe: ['MEWE_APP_ID', 'MEWE_API_KEY', 'MEWE_HOST'],
};
// Keys read once when the connectors load, so changing them needs a restart.
const LOAD_TIME_KEYS = new Set(['TELEGRAM_TOKEN']);
// Connectors that only work inside Postiz's browser extension.
const HIDDEN = new Set(['skool']);

function applyEnvironment() {
  process.env.JWT_SECRET = getSetting('secret');
  process.env.FRONTEND_URL = callbackBase();
  process.env.NEXT_PUBLIC_BACKEND_URL = callbackBase();
  process.env.UPLOAD_DIRECTORY = UPLOADS;
  process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'uploads';
  for (const [name, value] of Object.entries(getSetting('keys', {}))) {
    if (value) process.env[name] = value;
  }
}
applyEnvironment();

// The connectors are loaded only now, after their environment is in place.
const P = require('./dist/providers.cjs');
const manager = new P.IntegrationManager();
const provider = (identifier) => {
  const found = manager.getSocialIntegration(identifier);
  if (!found || HIDDEN.has(identifier)) throw new Error(`Unknown network "${identifier}"`);
  return found;
};

// ── Events to the plugin ───────────────────────────────────────────────────

const emit = (event, data = {}) => {
  if (STDIO) process.stdout.write(JSON.stringify({ event, ...data }) + '\n');
};
const changed = (what) => emit('changed', { what });

// ── Networks ───────────────────────────────────────────────────────────────

let providerCache;
async function listProviders() {
  if (!providerCache) {
    providerCache = [];
    for (const identifier of manager.getAllowedSocialsIntegrations()) {
      if (HIDDEN.has(identifier)) continue;
      const p = manager.getSocialIntegration(identifier);
      const fields = p.customFields ? await p.customFields() : null;
      providerCache.push({
        identifier,
        name: p.name,
        login: fields ? 'fields' : 'oauth',
        fields: (fields || []).map((f) => ({ key: f.key, label: f.label, type: f.type, defaultValue: f.defaultValue ?? '' })),
        pickPage: !!p.isBetweenSteps,
        keys: KEYS[identifier] || [],
        editor: p.editor || 'normal',
        maxLength: safe(() => p.maxLength()) ?? null,
        callbackUrl: `${callbackBase()}/integrations/social/${identifier}`,
        publicMediaOnly: ['instagram', 'instagram-standalone', 'threads', 'pinterest', 'tiktok', 'tiktok-business', 'facebook'].includes(identifier),
      });
    }
    providerCache.sort((a, b) => a.name.localeCompare(b.name));
  }
  const keys = getSetting('keys', {});
  return providerCache.map((p) => ({
    ...p,
    callbackUrl: `${callbackBase()}/integrations/social/${p.identifier}`,
    keysReady: p.keys.every((k) => !!keys[k] || (k === 'MASTODON_URL')),
  }));
}
function safe(fn) { try { return fn(); } catch { return undefined; } }

function getKeys({ provider: identifier }) {
  const keys = getSetting('keys', {});
  const names = identifier ? KEYS[identifier] || [] : Object.keys(keys);
  return Object.fromEntries(names.map((k) => [k, keys[k] ? mask(keys[k]) : '']));
}
const mask = (v) => (v.length <= 6 ? '••••' : `${v.slice(0, 3)}••••${v.slice(-3)}`);

function setKeys({ values }) {
  const keys = getSetting('keys', {});
  let restart = false;
  for (const [name, value] of Object.entries(values || {})) {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error(`Bad key name ${name}`);
    const v = String(value ?? '').trim();
    if (v.includes('••••')) continue; // a masked value shown back unchanged
    if (v) keys[name] = v; else delete keys[name];
    if (v) process.env[name] = v; else delete process.env[name];
    if (LOAD_TIME_KEYS.has(name)) restart = true;
  }
  setSetting('keys', keys);
  changed('providers');
  return { saved: true, restart };
}

// ── Accounts ───────────────────────────────────────────────────────────────

const accountRow = (id) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!row) throw new Error(`No account with id ${id}`);
  return row;
};
const publicAccount = (a) => ({
  id: a.id,
  network: a.provider,
  name: a.name,
  username: a.username,
  picture: a.picture,
  status: a.status,
  statusMessage: a.status_message,
  connectedAt: new Date(a.created_at).toISOString(),
});
const listAccounts = () => db.prepare('SELECT * FROM accounts ORDER BY provider, name').all().map(publicAccount);

/** The shape of Postiz's Prisma `Integration` record, which connectors read. */
const integrationOf = (a) => ({
  id: a.id,
  internalId: a.internal_id,
  rootInternalId: a.root_internal_id,
  organizationId: 'local',
  name: a.name,
  picture: a.picture,
  providerIdentifier: a.provider,
  type: 'social',
  token: a.token,
  refreshToken: a.refresh_token,
  tokenExpiration: a.token_expiration ? new Date(a.token_expiration) : null,
  profile: a.username,
  customInstanceDetails: a.custom_instance_details,
  additionalSettings: a.additional_settings || '[]',
  inBetweenSteps: a.status === 'needs_page',
  refreshNeeded: a.status === 'disconnected',
  disabled: false,
  deletedAt: null,
  postingTimes: '[]',
  customerId: null,
  createdAt: new Date(a.created_at),
  updatedAt: new Date(a.updated_at),
});

async function connect({ provider: identifier, fields, reconnect }) {
  const p = provider(identifier);
  const info = (await listProviders()).find((x) => x.identifier === identifier);
  const missing = (info?.keys || []).filter((k) => k !== 'MASTODON_URL' && !process.env[k]);
  if (missing.length) throw new Error(`Add your ${info.name} developer keys first: ${missing.join(', ')}`);
  if (p.customFields) {
    const code = Buffer.from(JSON.stringify(fields || {})).toString('base64');
    const account = await finishLogin(identifier, { code, codeVerifier: 'none', reconnect });
    return { connected: true, account };
  }
  const { url, codeVerifier, state } = await p.generateAuthUrl();
  db.prepare('DELETE FROM pending_logins WHERE created_at < ?').run(now() - 3600_000);
  db.prepare('INSERT OR REPLACE INTO pending_logins (state, provider, code_verifier, reconnect_account, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(state), identifier, String(codeVerifier ?? ''), reconnect || null, now());
  openInBrowser(url);
  return { connected: false, url, message: `A ${p.name} sign-in page opened in your browser. Approve it there; the account appears here when you're done.` };
}

async function finishLogin(identifier, { code, codeVerifier, refresh, reconnect }) {
  const p = provider(identifier);
  const auth = await p.authenticate({ code, codeVerifier, refresh });
  if (typeof auth === 'string') throw new Error(auth);
  if (auth.error) throw new Error(auth.error);
  if (!auth.id) throw new Error('The network did not return an account. Check the details and try again.');
  const name = auth.name || (auth.username ? auth.username.split('.')[0] : `Account ${String(auth.id).slice(0, 8)}`);
  const details = p.customFields ? P.AuthService.fixedEncryption(Buffer.from(code, 'base64').toString()) : null;
  const existing = reconnect
    ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(reconnect)
    : db.prepare('SELECT * FROM accounts WHERE provider = ? AND (internal_id = ? OR root_internal_id = ?)').get(identifier, String(auth.id), String(auth.id));
  const t = now();
  // Page-based networks (Facebook, LinkedIn Page, ...) sign in as a person,
  // then post as a page the owner picks in a second step.
  const status = p.isBetweenSteps ? 'needs_page' : 'ready';
  const values = {
    provider: identifier,
    name: name.trim(),
    username: auth.username || null,
    picture: auth.picture || null,
    token: auth.accessToken,
    refresh_token: auth.refreshToken || null,
    token_expiration: auth.expiresIn ? t + auth.expiresIn * 1000 : null,
    custom_instance_details: details,
    additional_settings: JSON.stringify(auth.additionalSettings || []),
  };
  let id;
  if (existing && status === 'ready') {
    id = existing.id;
    db.prepare(`UPDATE accounts SET name=?, username=?, picture=?, token=?, refresh_token=COALESCE(?, refresh_token), token_expiration=?,
      custom_instance_details=COALESCE(?, custom_instance_details), additional_settings=?, status='ready', status_message=NULL, updated_at=? WHERE id=?`)
      .run(values.name, values.username, values.picture, values.token, values.refresh_token,
        values.token_expiration, values.custom_instance_details, values.additional_settings, t, id);
  } else {
    id = existing?.id || newId();
    db.prepare(`INSERT OR REPLACE INTO accounts (id, provider, internal_id, root_internal_id, name, username, picture, token, refresh_token,
      token_expiration, custom_instance_details, additional_settings, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, identifier, String(auth.id), String(auth.id), values.name, values.username, values.picture, values.token, values.refresh_token,
        values.token_expiration, values.custom_instance_details, values.additional_settings, status, existing?.created_at || t, t);
  }
  changed('accounts');
  return publicAccount(accountRow(id));
}

async function listPages({ account }) {
  const a = accountRow(account);
  const p = provider(a.provider);
  const fetcher = typeof p.pages === 'function' ? 'pages' : typeof p.companies === 'function' ? 'companies' : null;
  if (!fetcher) throw new Error(`${p.name} has no pages to choose from`);
  const pages = await p[fetcher](a.token);
  return (pages || []).map((page) => ({
    id: String(page.id ?? page.pageId ?? ''),
    name: page.name || page.username || String(page.id),
    picture: page.picture?.data?.url || page.picture || null,
    raw: page,
  }));
}

async function selectPage({ account, page }) {
  const a = accountRow(account);
  const p = provider(a.provider);
  if (!p.fetchPageInformation) throw new Error(`${p.name} does not use pages`);
  const pages = await listPages({ account });
  const chosen = pages.find((x) => x.id === String(page?.id ?? page));
  const info = await p.fetchPageInformation(a.token, chosen ? chosen.raw : page);
  db.prepare(`UPDATE accounts SET internal_id=?, name=?, picture=?, token=?, username=?, status='ready', status_message=NULL, updated_at=? WHERE id=?`)
    .run(String(info.id), info.name, info.picture || null, info.access_token || a.token, info.username || a.username, now(), a.id);
  changed('accounts');
  return publicAccount(accountRow(a.id));
}

function removeAccount({ account }) {
  const a = accountRow(account);
  db.prepare("UPDATE posts SET status='cancelled', error='Account removed', updated_at=? WHERE account_id=? AND status='scheduled'").run(now(), a.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
  changed('accounts');
  changed('posts');
  return { removed: true };
}

async function refreshAccount(a) {
  const p = provider(a.provider);
  if (!a.refresh_token) throw new P.RefreshToken(a.provider, '{}', '{}', 'This account has no refresh token; connect it again.');
  const fresh = await p.refreshToken(a.refresh_token);
  if (!fresh?.accessToken) throw new Error('The network refused to refresh the login; connect the account again.');
  db.prepare('UPDATE accounts SET token=?, refresh_token=COALESCE(?, refresh_token), token_expiration=?, updated_at=? WHERE id=?')
    .run(fresh.accessToken, fresh.refreshToken || null, fresh.expiresIn ? now() + fresh.expiresIn * 1000 : null, now(), a.id);
  if (p.refreshWait) await new Promise((r) => setTimeout(r, 10_000));
  return accountRow(a.id);
}

// ── Posts ──────────────────────────────────────────────────────────────────

const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|$)/i;

function storeMedia(items) {
  return (items || []).map((item) => {
    const src = typeof item === 'string' ? item : item.path || item.url;
    const alt = typeof item === 'object' ? item.alt : undefined;
    if (!src) throw new Error('A media item has no path or URL');
    if (/^https:\/\//i.test(src)) return { type: VIDEO.test(src) ? 'video' : 'image', path: src, url: src, alt };
    const file = src.startsWith('~/') ? path.join(os.homedir(), src.slice(2)) : path.resolve(src);
    if (!fs.existsSync(file)) throw new Error(`Media file not found: ${src}`);
    if (path.dirname(file) === UPLOADS) {
      return { type: VIDEO.test(file) ? 'video' : 'image', path: file, url: `${callbackBase()}/uploads/${path.basename(file)}`, alt };
    }
    const name = `${newId()}${path.extname(file).toLowerCase()}`;
    fs.copyFileSync(file, path.join(UPLOADS, name));
    return { type: VIDEO.test(file) ? 'video' : 'image', path: path.join(UPLOADS, name), url: `${callbackBase()}/uploads/${name}`, alt };
  });
}

function resolveAccounts(list) {
  const all = db.prepare('SELECT * FROM accounts').all();
  if (!Array.isArray(list) || !list.length) throw new Error('Choose at least one account to post to');
  return list.map((ref) => {
    const key = String(ref).toLowerCase().replace(/^@/, '');
    const hits = all.filter((a) =>
      a.id === ref || a.provider === key || a.name.toLowerCase() === key || (a.username || '').toLowerCase().replace(/^@/, '') === key ||
      `${a.provider}:${(a.username || a.name).toLowerCase()}` === key);
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new Error(`No connected account matches "${ref}"`);
    throw new Error(`"${ref}" matches several accounts; use an account id (${hits.map((h) => h.id).join(', ')})`);
  });
}

function parseWhen(at) {
  if (at === undefined || at === null || at === '' || at === 'now') return now();
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) throw new Error(`Could not read the time "${at}"; use ISO 8601, e.g. 2026-11-24T09:00:00-05:00`);
  return t;
}

async function createPost({ accounts, text, media, at, settings, createdBy }) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('The post has no text');
  const targets = resolveAccounts(accounts);
  const providers = await listProviders();
  for (const a of targets) {
    if (a.status !== 'ready') throw new Error(`${a.name} (${a.provider}) is not ready: ${a.status_message || a.status}`);
    const info = providers.find((p) => p.identifier === a.provider);
    if (info?.maxLength && body.length > info.maxLength) throw new Error(`The text is ${body.length} characters; ${info.name} allows ${info.maxLength}`);
  }
  const when = parseWhen(at);
  const stored = storeMedia(media);
  const group = newId();
  const t = now();
  const ids = [];
  for (const a of targets) {
    const id = newId();
    const own = settings && typeof settings === 'object' ? settings[a.provider] ?? settings[a.id] ?? (isPerNetwork(settings) ? {} : settings) : {};
    db.prepare(`INSERT INTO posts (id, group_id, account_id, text, media, settings, publish_at, status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, group, a.id, body, JSON.stringify(stored), JSON.stringify(own || {}), when, 'scheduled', createdBy || null, t, t);
    ids.push(id);
  }
  changed('posts');
  setImmediate(tick);
  return { group, posts: ids.map(postById) };
}
const isPerNetwork = (s) => Object.keys(s).some((k) => KEYS[k] || ['bluesky', 'nostr', 'lemmy', 'medium', 'devto', 'hashnode', 'wordpress', 'listmonk', 'moltbook'].includes(k));

function postById(id) {
  const row = db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network, a.username AS account_username
    FROM posts p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.id = ?`).get(id);
  if (!row) throw new Error(`No post with id ${id}`);
  return publicPost(row);
}
const publicPost = (r) => ({
  id: r.id,
  group: r.group_id,
  account: r.account_id,
  accountName: r.account_name || '(removed account)',
  network: r.network,
  text: r.text,
  media: JSON.parse(r.media).map((m) => m.url),
  settings: JSON.parse(r.settings || '{}'),
  publishAt: new Date(r.publish_at).toISOString(),
  status: r.status,
  url: r.release_url,
  error: r.error,
  attempts: r.attempts,
  createdBy: r.created_by,
});

function listPosts({ status, limit = 100 } = {}) {
  const rows = status
    ? db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network FROM posts p LEFT JOIN accounts a ON a.id = p.account_id
        WHERE p.status = ? ORDER BY p.publish_at DESC LIMIT ?`).all(status, limit)
    : db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network FROM posts p LEFT JOIN accounts a ON a.id = p.account_id
        ORDER BY CASE p.status WHEN 'scheduled' THEN 0 WHEN 'publishing' THEN 0 ELSE 1 END, p.publish_at DESC LIMIT ?`).all(limit);
  return rows.map(publicPost);
}

function cancelPost({ post }) {
  const r = db.prepare("UPDATE posts SET status='cancelled', updated_at=? WHERE (id=? OR group_id=?) AND status='scheduled'").run(now(), post, post);
  if (!r.changes) throw new Error('Nothing to cancel: only scheduled posts can be cancelled');
  changed('posts');
  return { cancelled: Number(r.changes) };
}

function retryPost({ post, at }) {
  const r = db.prepare("UPDATE posts SET status='scheduled', error=NULL, publish_at=?, updated_at=? WHERE (id=? OR group_id=?) AND status IN ('failed','cancelled')")
    .run(parseWhen(at), now(), post, post);
  if (!r.changes) throw new Error('Only failed or cancelled posts can be retried');
  changed('posts');
  setImmediate(tick);
  return { scheduled: Number(r.changes) };
}

function deletePost({ post }) {
  const r = db.prepare("DELETE FROM posts WHERE (id=? OR group_id=?) AND status != 'publishing'").run(post, post);
  changed('posts');
  return { deleted: Number(r.changes) };
}

function editPost({ post, text, at }) {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post);
  if (!row || row.status !== 'scheduled') throw new Error('Only scheduled posts can be edited');
  db.prepare('UPDATE posts SET text=COALESCE(?, text), publish_at=?, updated_at=? WHERE id=?')
    .run(text ?? null, at !== undefined ? parseWhen(at) : row.publish_at, now(), post);
  changed('posts');
  return postById(post);
}

/** A file chosen in the Buzz page arrives as base64 and is kept in uploads/. */
function uploadMedia({ name, base64 }) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!/^\.(png|jpe?g|gif|webp|avif|mp4|mov|m4v|webm)$/.test(ext)) throw new Error('Use an image (PNG, JPG, GIF, WebP) or a video (MP4, MOV, WebM)');
  const bytes = Buffer.from(String(base64 || ''), 'base64');
  if (!bytes.length) throw new Error('The file is empty');
  if (bytes.length > 200 * 1024 * 1024) throw new Error('The file is larger than 200 MB');
  const file = path.join(UPLOADS, `${newId()}${ext}`);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return { path: file, name: String(name), size: bytes.length };
}

// ── Publishing ─────────────────────────────────────────────────────────────

const errorText = (err) => {
  const base = String(err?.message || err || 'Unknown error');
  const detail = err?.details?.[0];
  const body = detail?.body && detail.body !== '{}' ? ` (${String(detail.body).slice(0, 300)})` : '';
  return (base + body).slice(0, 1200);
};
const isType = (err, type) => err?.type === type || err?.constructor?.name === ({ refresh_token: 'RefreshToken', disconnect: 'Disconnect', bad_body: 'BadBody' })[type];

async function publish(row) {
  db.prepare("UPDATE posts SET status='publishing', attempts=attempts+1, updated_at=? WHERE id=?").run(now(), row.id);
  changed('posts');
  let account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(row.account_id);
  try {
    if (!account) throw new Error('The account was removed');
    const p = provider(account.provider);
    if (account.status === 'needs_page') throw new Error('Finish connecting this account: choose the page to post to');
    if (account.token_expiration && account.token_expiration < now() + 5 * 60_000 && account.refresh_token && !p.noRefreshBeforeCall) {
      account = await refreshAccount(account);
    }
    const details = [{
      id: row.id,
      message: P.stripHtmlValidation(p.editor || 'normal', row.text, true, false, true, p.mentionFormat, false),
      settings: JSON.parse(row.settings || '{}'),
      media: JSON.parse(row.media || '[]'),
    }];
    let result;
    try {
      result = await p.post(account.internal_id, account.token, details, integrationOf(account));
    } catch (err) {
      if (!isType(err, 'refresh_token')) throw err;
      account = await refreshAccount(account);
      result = await p.post(account.internal_id, account.token, details, integrationOf(account));
    }
    const first = (result || [])[0] || {};
    db.prepare("UPDATE posts SET status='published', release_url=?, platform_post_id=?, error=NULL, updated_at=? WHERE id=?")
      .run(first.releaseURL || null, first.postId ? String(first.postId) : null, now(), row.id);
    emit('published', { post: postById(row.id) });
  } catch (err) {
    const message = errorText(err);
    log(`[publish ${row.id}]`, message);
    if (account && (isType(err, 'disconnect') || isType(err, 'refresh_token'))) {
      db.prepare("UPDATE accounts SET status='disconnected', status_message=?, updated_at=? WHERE id=?").run(message, now(), account.id);
      changed('accounts');
    }
    db.prepare("UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?").run(message, now(), row.id);
    emit('failed', { post: postById(row.id) });
  }
  changed('posts');
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (;;) {
      const due = db.prepare("SELECT * FROM posts WHERE status='scheduled' AND publish_at <= ? ORDER BY publish_at LIMIT 1").get(now());
      if (!due) break;
      await publish(due);
    }
  } catch (err) {
    log('[scheduler]', err?.stack || err);
  } finally {
    ticking = false;
  }
}

// A post that was being published when the engine stopped may or may not be
// live; never send it again blindly.
db.prepare("UPDATE posts SET status='failed', error='Social Poster stopped while publishing this post. Check the account before you retry, so it is not posted twice.', updated_at=? WHERE status='publishing'").run(now());

// ── Helpers ────────────────────────────────────────────────────────────────

function openInBrowser(url) {
  if (process.env.SOCIAL_POSTER_NO_BROWSER) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    const env = { ...process.env };
    delete env.LD_LIBRARY_PATH;
    spawn(cmd, [url], { detached: true, stdio: 'ignore', env }).unref();
  } catch (err) {
    log('could not open browser:', err.message);
  }
}

function status() {
  const count = (s) => db.prepare('SELECT COUNT(*) AS n FROM posts WHERE status = ?').get(s).n;
  const next = db.prepare("SELECT MIN(publish_at) AS t FROM posts WHERE status='scheduled'").get().t;
  return {
    version: VERSION,
    dataFolder: HOME,
    callbackBase: callbackBase(),
    accounts: db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,
    scheduled: count('scheduled'),
    published: count('published'),
    failed: count('failed'),
    nextPostAt: next ? new Date(next).toISOString() : null,
  };
}

function setCallbackBase({ url }) {
  const v = String(url || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\/[^/]+$/.test(v)) throw new Error('Use an address like http://127.0.0.1:47321 or https://example.ngrok.app');
  if (v) setSetting('callbackBase', v); else db.prepare("DELETE FROM settings WHERE key='callbackBase'").run();
  applyEnvironment();
  changed('providers');
  return { callbackBase: callbackBase() };
}

// ── Methods (shared by stdio and the local HTTP API) ───────────────────────

const METHODS = {
  status: () => status(),
  'providers.list': () => listProviders(),
  'keys.get': getKeys,
  'keys.set': setKeys,
  'settings.callback': setCallbackBase,
  'accounts.list': () => listAccounts(),
  'accounts.connect': connect,
  'accounts.pages': listPages,
  'accounts.selectPage': selectPage,
  'accounts.remove': removeAccount,
  'posts.create': createPost,
  'media.upload': uploadMedia,
  open: ({ url }) => {
    if (!/^https:\/\//i.test(String(url))) throw new Error('Only https links can be opened');
    openInBrowser(String(url));
    return { opened: true };
  },
  'posts.list': listPosts,
  'posts.get': ({ post }) => postById(post),
  'posts.cancel': cancelPost,
  'posts.retry': retryPost,
  'posts.edit': editPost,
  'posts.delete': deletePost,
};

async function call(method, params) {
  const fn = METHODS[method];
  if (!fn) throw new Error(`Unknown method ${method}`);
  return fn(params || {});
}

// ── Local web server: logins, media, command line API ──────────────────────

const page = (title, message, ok = true) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<body style="font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:#222">
<h1 style="font-size:28px">${ok ? '✅' : '⚠️'} ${esc(title)}</h1><p>${esc(message)}</p><p style="color:#777">You can close this tab and go back to Buzz.</p></body>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function callbackParams(identifier, q) {
  const get = (k) => q.get(k) || '';
  if (identifier === 'x') return { state: get('oauth_token'), code: get('oauth_verifier') };
  if (identifier === 'tiktok-business') return { state: get('state'), code: get('auth_code') || get('code') };
  if (identifier === 'vk') return { state: get('state'), code: `${get('code')}&&&&${get('device_id')}` };
  if (identifier === 'mewe') return { state: get('state'), code: get('loginRequestToken') };
  return { state: get('state'), code: get('code') };
}

async function handleCallback(identifier, q, res) {
  if (q.get('error')) return send(res, 400, page('Not connected', q.get('error_description') || q.get('error'), false), 'text/html');
  const { state, code } = callbackParams(identifier, q);
  const pending = db.prepare('SELECT * FROM pending_logins WHERE state = ? AND provider = ?').get(state, identifier);
  if (!pending) return send(res, 400, page('Link expired', 'This sign-in link expired or was already used. Start again from Social Poster in Buzz.', false), 'text/html');
  db.prepare('DELETE FROM pending_logins WHERE state = ?').run(state);
  try {
    const account = await finishLogin(identifier, { code, codeVerifier: pending.code_verifier, refresh: q.get('refresh') || '', reconnect: pending.reconnect_account });
    emit('connected', { account });
    const next = account.status === 'needs_page' ? ' One more step in Buzz: choose which page this account posts to.' : '';
    send(res, 200, page(`${account.name} is connected`, `Social Poster can now post to this ${provider(identifier).name} account.${next}`), 'text/html');
  } catch (err) {
    log('[login]', err?.stack || err);
    send(res, 400, page('Not connected', errorText(err), false), 'text/html');
  }
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const token = getSetting('apiToken');
const authorized = (req) => {
  const h = String(req.headers.authorization || '');
  const given = Buffer.from(h.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, app: 'social-poster', version: VERSION, pid: process.pid });
    const cb = url.pathname.match(/^\/integrations\/social\/([a-z0-9-]+)\/?$/);
    if (req.method === 'GET' && cb) return await handleCallback(cb[1], url.searchParams, res);
    const media = url.pathname.match(/^\/uploads\/([A-Za-z0-9_-]+\.[a-z0-9]+)$/);
    if (req.method === 'GET' && media) {
      const file = path.join(UPLOADS, media[1]);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': require('mime-types').lookup(file) || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && (url.pathname === '/rpc' || url.pathname === '/shutdown')) {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      if (url.pathname === '/shutdown') {
        send(res, 200, { ok: true });
        return setTimeout(() => shutdown(0), 50);
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { method, params } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      return send(res, 200, { result: await call(method, params) });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 400, { error: errorText(err) });
  }
});

function writeApiFile() {
  const file = path.join(HOME, 'api.json');
  fs.writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${PORT}`, token, pid: process.pid }), { mode: 0o600 });
}

async function listen(attempt = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  }).catch(async (err) => {
    if (err.code !== 'EADDRINUSE' || attempt > 5) throw err;
    // An older engine (a standalone one, or one left over from a reload) holds
    // the port: ask it to stop, then try again.
    await fetch(`http://127.0.0.1:${PORT}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    return listen(attempt + 1);
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let timer;
function shutdown(code = 0) {
  clearInterval(timer);
  server.close();
  try { db.close(); } catch {}
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('unhandledRejection', (err) => log('[unhandled]', err?.stack || err));

(async () => {
  try {
    await listen();
  } catch (err) {
    log(`Social Poster could not use port ${PORT}: ${err.message}`);
    emit('fatal', { message: `Port ${PORT} is busy: ${err.message}` });
    return shutdown(1);
  }
  writeApiFile();
  timer = setInterval(tick, 15_000);
  setImmediate(tick);
  emit('ready', { status: status() });
  log(`Social Poster engine ${VERSION} on http://127.0.0.1:${PORT} (data in ${HOME})`);

  if (STDIO) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      try {
        const result = await call(msg.method, msg.params);
        process.stdout.write(JSON.stringify({ id: msg.id, result }) + '\n');
      } catch (err) {
        process.stdout.write(JSON.stringify({ id: msg.id, error: errorText(err) }) + '\n');
      }
    });
    rl.on('close', () => shutdown(0));
  }
})();
