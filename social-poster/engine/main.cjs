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

const VERSION = '0.4.0';
const STDIO = process.argv.includes('--stdio');
// --once: publish whatever is due, then exit. A systemd timer runs this so
// posts go out while Buzz is closed; it does nothing when an engine is running.
const ONCE = process.argv.includes('--once');
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
for (const sql of ['ALTER TABLE accounts ADD COLUMN avatar TEXT', 'ALTER TABLE media ADD COLUMN pages TEXT']) {
  try { db.exec(sql); } catch {}
}

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
const localBase = () => `http://127.0.0.1:${PORT}`;
// Where networks send you back after you sign in. Several big networks
// (TikTok, Meta, LinkedIn) only accept https addresses, so the default is a
// static page in the Buzz-plugins repo's GitHub Pages (relay/404.html) that
// forwards the browser straight to this engine on 127.0.0.1. Nothing is stored
// or run there; it is one redirect in your own browser.
const RELAY = 'https://lucas10-ctrl.github.io/Buzz-plugins/connect';
const callbackBase = () => String(getSetting('callbackBase', `${RELAY}/${PORT}`)).replace(/\/+$/, '');

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
  // Media is served by this engine on 127.0.0.1, which Postiz's guard against
  // fetching private addresses would refuse. Every media path here comes from
  // the owner's own library, so the guard is off.
  process.env.DISABLE_SSRF_PROTECTION = 'true';
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
        caps: capsOf(identifier),
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
  avatar: a.avatar || null,
  status: a.status,
  statusMessage: a.status_message,
  via: a.via || 'local',
  connectedAt: new Date(a.created_at).toISOString(),
});
async function listAccounts() {
  await fillAvatars().catch(() => {});
  return db.prepare('SELECT * FROM accounts ORDER BY provider, name').all().map(publicAccount);
}

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
  // Connectors read the choice under different names (Facebook and LinkedIn
  // Page: "page"; Instagram: "pageId"; others: "id"), as Postiz's own page
  // picker sends them. Give every one of them.
  const raw = chosen ? chosen.raw : (typeof page === 'object' ? page : { id: page });
  const info = await p.fetchPageInformation(a.token, { ...raw, page: raw.page ?? raw.id });
  db.prepare(`UPDATE accounts SET internal_id=?, name=?, picture=?, token=?, username=?, status='ready', status_message=NULL, updated_at=? WHERE id=?`)
    .run(String(info.id), info.name, info.picture || null, info.access_token || a.token, info.username || a.username, now(), a.id);
  changed('accounts');
  return publicAccount(accountRow(a.id));
}

async function removeAccount({ account }) {
  const a = accountRow(account);
  db.prepare("UPDATE posts SET status='draft', error='Account removed', updated_at=? WHERE account_id=? AND status='scheduled'").run(now(), a.id);
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

// ── Media, posts, Notion ───────────────────────────────────────────────────

const { createMedia } = require('./media.cjs');
const { createPosts } = require('./posts.cjs');
const { createTunnel } = require('./tunnel.cjs');
const { createNotion } = require('./notion.cjs');
const { createNotionContent } = require('./notion-content.cjs');
const { CAPS, capsOf } = require('./caps.cjs');

const tunnel = createTunnel({ home: HOME, port: PORT, log });
const media = createMedia({ db, uploads: UPLOADS, callbackBase: localBase, newId, changed, tunnel });
let notionContent;
const posts = createPosts({
  db, P, provider, accountRow, integrationOf, refreshAccount, media, newId, now, changed, emit, log,
  onGroupState: (group, state, rows) => void notionContent?.sync(group, state, rows),
});
const notion = createNotion({ getSetting, setSetting, callbackBase: localBase, openInBrowser: (u) => openInBrowser(u), log, onChange: () => changed('notion') });
notionContent = createNotionContent({ notion, db, media, posts, log, changed });
const errorText = posts.errorText;

// Version 0.3 could connect channels through Postiz Cloud. Social Poster now
// runs everything on this computer, so those channels and their stored Postiz
// login are removed; their scheduled posts go back to drafts.
const hasVia = db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'via');
for (const a of hasVia ? db.prepare("SELECT id FROM accounts WHERE via='postiz'").all() : []) {
  db.prepare("UPDATE posts SET status='draft', error='This channel was connected through Postiz Cloud. Connect it again under Channels.', updated_at=? WHERE account_id=? AND status IN ('scheduled','publishing')").run(now(), a.id);
  db.prepare('DELETE FROM accounts WHERE id=?').run(a.id);
}
db.exec("DELETE FROM settings WHERE key IN ('postizCloud','postizHidden'); DROP TABLE IF EXISTS cloud_media;");
const tick = posts.tick;

/** Options for a lookup field (Pinterest boards, Discord channels, ...). */
async function accountOptions({ account, method, params }) {
  const a = accountRow(account);
  const p = provider(a.provider);
  if (!/^[a-zA-Z]+$/.test(String(method)) || typeof p[method] !== 'function') throw new Error(`${p.name} has no "${method}" list`);
  const list = await p[method](a.token, params || {}, a.internal_id, integrationOf(a));
  const arr = Array.isArray(list) ? list : list?.results || list?.data || [];
  return arr.map((x) => ({
    value: String(x.id ?? x.value ?? x.name ?? x.subreddit ?? ''),
    label: String(x.name ?? x.label ?? x.title ?? x.display_name_prefixed ?? x.subreddit ?? x.id ?? ''),
    raw: x,
  })).filter((x) => x.value);
}

/** Small round pictures for accounts, kept as data: URLs (the page can't load remote images). */
async function fillAvatars() {
  const sharp = require('sharp');
  for (const a of db.prepare('SELECT id, picture FROM accounts WHERE avatar IS NULL AND picture IS NOT NULL').all()) {
    try {
      const res = await fetch(a.picture, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize(96, 96, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
      db.prepare('UPDATE accounts SET avatar=? WHERE id=?').run(`data:image/jpeg;base64,${buf.toString('base64')}`, a.id);
    } catch {
      db.prepare("UPDATE accounts SET avatar='' WHERE id=?").run(a.id);
    }
  }
}

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
    drafts: count('draft'),
    notion: notion.status(),
    publicMediaLink: tunnel.current(),
  };
}

function setCallbackBase({ url }) {
  const v = String(url || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\/[^/\s]+(\/[^\s?#]*)?$/.test(v)) throw new Error('Use an address like http://127.0.0.1:47321 or https://example.ngrok.app');
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
  'accounts.remove': (p) => removeAccount(p),
  'accounts.options': accountOptions,
  // media library
  'media.list': (p) => media.list(p),
  'media.upload': (p) => media.upload(p),
  'media.add': ({ src, name }) => media.add(String(src), name),
  'media.remove': (p) => media.remove(p),
  // the composer and calendar
  'posts.validate': (p) => posts.validate(p),
  'posts.save': (p) => posts.save(p),
  'posts.group': (p) => posts.getGroup(p),
  'posts.calendar': (p) => posts.calendar(p),
  'posts.move': (p) => posts.move(p),
  'posts.duplicate': (p) => posts.duplicate(p),
  'posts.delete': (p) => posts.remove(p),
  // command line and agent tools
  'posts.create': (p) => posts.create(p),
  'posts.list': (p) => posts.list(p),
  'posts.get': ({ post }) => posts.list({ limit: 100000 }).find((x) => x.id === post || x.group === post) || (() => { throw new Error(`No post with id ${post}`); })(),
  'posts.cancel': (p) => posts.unschedule(p),
  'posts.retry': (p) => posts.retry(p),
  // Notion
  'notion.status': () => notion.status(),
  'notion.connect': () => notion.connect(),
  'notion.disconnect': () => notion.disconnect(),
  'notion.setDatabase': (p) => notionContent.setDatabase(p),
  'notion.pieces': () => notionContent.pieces(),
  'notion.import': (p) => notionContent.importPiece(p),
  open: ({ url }) => {
    if (!/^https:\/\//i.test(String(url))) throw new Error('Only https links can be opened');
    openInBrowser(String(url));
    return { opened: true };
  },
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

const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  // Requests that come through the public media tunnel may only read media.
  const viaTunnel = !LOCAL_HOSTS.has(String(req.headers.host || '')) && !String(callbackBase()).includes(String(req.headers.host || '#'));
  if (viaTunnel && !(req.method === 'GET' && (/^\/uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(url.pathname) || url.pathname === '/health'))) {
    return send(res, 404, { error: 'not found' });
  }
  try {
    if (req.method === 'GET' && url.pathname === '/notion/callback') {
      try {
        await notion.finish(url.searchParams);
        emit('notion', { status: notion.status() });
        return send(res, 200, page('Notion is connected', 'Social Poster can now read your content calendar and update it when posts go out.'), 'text/html');
      } catch (err) {
        return send(res, 400, page('Notion is not connected', errorText(err), false), 'text/html');
      }
    }
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, app: 'social-poster', version: VERSION, pid: process.pid });
    const cb = url.pathname.match(/^\/integrations\/social\/([a-z0-9-]+)\/?$/);
    if (req.method === 'GET' && cb) return await handleCallback(cb[1], url.searchParams, res);
    const file_ = url.pathname.match(/^\/uploads\/([A-Za-z0-9_-]+\.[a-z0-9]+)$/);
    if (req.method === 'GET' && file_) {
      const file = path.join(UPLOADS, file_[1]);
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
      try {
        return send(res, 200, { result: await call(method, params) });
      } catch (err) {
        return send(res, 400, { error: errorText(err), problems: err.problems });
      }
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
  tunnel.stop();
  server.close();
  try { db.close(); } catch {}
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('unhandledRejection', (err) => log('[unhandled]', err?.stack || err));

(async () => {
  if (ONCE) {
    // Buzz's engine (or a standalone one) is running and publishes on its own.
    const up = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
    if (up) return process.exit(0);
    const due = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status='scheduled' AND publish_at <= ?").get(now()).n;
    if (!due) return process.exit(0);
  }
  try {
    await listen();
  } catch (err) {
    log(`Social Poster could not use port ${PORT}: ${err.message}`);
    emit('fatal', { message: `Port ${PORT} is busy: ${err.message}` });
    return shutdown(1);
  }
  writeApiFile();
  if (ONCE) {
    await tick();
    log('Social Poster: background check done');
    return shutdown(0);
  }
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
        process.stdout.write(JSON.stringify({ id: msg.id, error: errorText(err), problems: err.problems }) + '\n');
      }
    });
    rl.on('close', () => shutdown(0));
  }
})();
