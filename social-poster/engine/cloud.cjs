// Postiz Cloud link: the big networks (YouTube, X, Facebook, Instagram,
// LinkedIn, TikTok) only let approved apps post, and getting each app
// approved takes weeks. Postiz Cloud already has approved apps, so the owner
// signs in to Postiz once and then connects each channel with one click.
// Posts for those channels are handed to Postiz Cloud with their time, so they
// go out even when Buzz is closed; Social Poster keeps the calendar, the
// composer, the media library and Notion, and reads back each post's result.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTH_SERVER = process.env.POSTIZ_AUTH_SERVER || 'https://cli-auth.postiz.com';
const CLI_CREDENTIALS = path.join(os.homedir(), '.postiz', 'credentials.json');
const MAIN = ['youtube', 'x', 'facebook', 'instagram', 'linkedin-page', 'tiktok'];

function createCloud({ db, getSetting, setSetting, callbackBase, openInBrowser, newId, now, changed, log, uploads }) {
  for (const sql of ['ALTER TABLE accounts ADD COLUMN via TEXT', 'ALTER TABLE posts ADD COLUMN remote_group TEXT']) {
    try { db.exec(sql); } catch {}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS cloud_media (
    key TEXT PRIMARY KEY,        -- local file name
    remote_id TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  const creds = () => getSetting('postizCloud', null);
  let pendingLogin = null;
  let lastSync = 0;

  async function api(pathname, { method = 'GET', body, form } = {}) {
    const c = creds();
    if (!c) throw new Error('Sign in to Postiz first (Channels → Main channels).');
    const res = await fetch(`${c.apiUrl}/public/v1${pathname}`, {
      method,
      headers: { authorization: c.accessToken, ...(form ? {} : { 'content-type': 'application/json' }) },
      body: form || (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (res.status === 401) {
      setSetting('postizCloud', null);
      changed('cloud');
      throw new Error('Postiz signed Social Poster out. Sign in to Postiz again under Channels.');
    }
    if (!res.ok) {
      const msg = data?.message || data?.msg || (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(String(Array.isArray(msg) ? msg.join(' ') : msg).slice(0, 600));
      err.status = res.status;
      err.url = data?.url;
      throw err;
    }
    return data;
  }

  // ── Signing in ──────────────────────────────────────────────────────────

  function status() {
    const c = creds();
    return {
      connected: !!c,
      organization: c?.organizationId || null,
      pending: pendingLogin ? { code: pendingLogin.code, url: pendingLogin.url } : null,
      cliLogin: !c && fs.existsSync(CLI_CREDENTIALS),
      main: MAIN,
    };
  }

  /** Uses the Postiz login already on this computer if there is one, else Postiz's device sign-in. */
  async function signIn({ fresh } = {}) {
    if (!fresh && fs.existsSync(CLI_CREDENTIALS)) {
      try {
        const c = JSON.parse(fs.readFileSync(CLI_CREDENTIALS, 'utf8'));
        if (c.accessToken) {
          setSetting('postizCloud', { accessToken: c.accessToken, apiUrl: c.apiUrl || 'https://api.postiz.com', organizationId: c.organizationId || null });
          await syncAccounts({ force: true });
          changed('cloud');
          return { connected: true };
        }
      } catch (err) {
        setSetting('postizCloud', null);
        log('[postiz] saved login did not work:', err.message);
      }
    }
    const res = await fetch(`${AUTH_SERVER}/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Postiz sign-in is not available right now (${res.status}).`);
    const d = await res.json();
    const url = `${d.verification_uri}?code=${encodeURIComponent(d.user_code)}`;
    const login = { code: d.user_code, url, deadline: now() + (d.expires_in || 900) * 1000 };
    pendingLogin = login;
    openInBrowser(url);
    void (async () => {
      while (pendingLogin === login && now() < login.deadline) {
        await new Promise((r) => setTimeout(r, (d.interval || 5) * 1000));
        try {
          const r = await fetch(`${AUTH_SERVER}/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: d.device_code }) });
          const t = await r.json();
          if (r.ok && t.access_token) {
            setSetting('postizCloud', { accessToken: t.access_token, apiUrl: t.api_url || 'https://api.postiz.com', organizationId: t.organization_id || null });
            pendingLogin = null;
            await syncAccounts({ force: true }).catch((e) => log('[postiz]', e.message));
            changed('cloud');
            return;
          }
          if (t.error && t.error !== 'authorization_pending' && t.error !== 'slow_down') break;
        } catch {}
      }
      if (pendingLogin === login) { pendingLogin = null; changed('cloud'); }
    })();
    changed('cloud');
    return { connected: false, url, code: d.user_code };
  }

  function signOut() {
    setSetting('postizCloud', null);
    pendingLogin = null;
    db.prepare("UPDATE posts SET status='draft', error='Postiz was signed out', updated_at=? WHERE status='scheduled' AND account_id IN (SELECT id FROM accounts WHERE via='postiz')").run(now());
    db.prepare("DELETE FROM accounts WHERE via='postiz'").run();
    changed('cloud'); changed('accounts'); changed('posts');
    return { signedOut: true };
  }

  // ── Channels ────────────────────────────────────────────────────────────

  async function syncAccounts({ force } = {}) {
    if (!creds()) return [];
    if (!force && now() - lastSync < 60_000) return [];
    lastSync = now();
    const list = await api('/integrations');
    const hidden = new Set(getSetting('postizHidden', []));
    const seen = new Set();
    const t = now();
    for (const i of list) {
      if (hidden.has(i.id)) continue;
      const id = `pz_${i.id}`;
      seen.add(id);
      const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      const st = i.disabled ? 'disconnected' : 'ready';
      const msg = i.disabled ? 'This channel is turned off in Postiz.' : null;
      if (existing) {
        db.prepare('UPDATE accounts SET name=?, username=?, picture=?, avatar=CASE WHEN picture IS ? THEN avatar ELSE NULL END, status=?, status_message=?, updated_at=? WHERE id=?')
          .run(i.name, i.profile || null, i.picture || null, i.picture || null, st, msg, t, id);
      } else {
        db.prepare(`INSERT INTO accounts (id, provider, internal_id, root_internal_id, name, username, picture, token, additional_settings, status, status_message, created_at, updated_at, via)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, i.identifier, i.id, i.id, i.name, i.profile || null, i.picture || null, 'postiz-cloud', '[]', st, msg, t, t, 'postiz');
      }
    }
    for (const a of db.prepare("SELECT id FROM accounts WHERE via='postiz'").all()) {
      if (!seen.has(a.id)) {
        db.prepare("UPDATE posts SET status='draft', error='This channel was removed from Postiz', updated_at=? WHERE account_id=? AND status='scheduled'").run(t, a.id);
        db.prepare('DELETE FROM accounts WHERE id=?').run(a.id);
      }
    }
    changed('accounts');
    return list;
  }

  /** Opens Postiz's approved sign-in for one network; the channel shows up here once approved. */
  async function connectChannel({ network }) {
    if (!creds()) throw new Error('Sign in to Postiz first.');
    try {
      const r = await api('/integrations/connect', { method: 'POST', body: { integration: network, redirectUrl: `${callbackBase()}/postiz/connected` } });
      openInBrowser(r.url);
      watchForNew();
      return { url: r.url, message: 'A sign-in page opened in your browser. Approve it there; the channel appears here when you are done.' };
    } catch (err) {
      if (err.status === 402) {
        const e = new Error('Your Postiz plan has no free channel left. Upgrade the plan in Postiz, or remove a channel there, then try again.');
        e.upgradeUrl = err.url || 'https://platform.postiz.com/billing';
        throw e;
      }
      throw err;
    }
  }

  let watching = null;
  function watchForNew() {
    clearInterval(watching);
    let n = 0;
    watching = setInterval(() => {
      if (++n > 60) return clearInterval(watching);
      void syncAccounts({ force: true }).catch(() => {});
    }, 5000);
  }

  function hide({ account }) {
    const a = db.prepare("SELECT * FROM accounts WHERE id=? AND via='postiz'").get(account);
    if (!a) return false;
    setSetting('postizHidden', [...new Set([...getSetting('postizHidden', []), a.internal_id])]);
    return true;
  }

  async function options({ account, method, params }) {
    const r = await api(`/integration-trigger/${account.internal_id}`, { method: 'POST', body: { methodName: method, data: params || {} } });
    return r?.output ?? r;
  }

  // ── Posting ─────────────────────────────────────────────────────────────

  async function uploadFile(file) {
    const key = path.basename(file);
    const hit = db.prepare('SELECT * FROM cloud_media WHERE key=?').get(key);
    if (hit) return { id: hit.remote_id, path: hit.remote_path };
    const full = path.isAbsolute(file) ? file : path.join(uploads, file);
    const type = require('mime-types').lookup(full) || 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(full)], { type }), key);
    const r = await api('/upload', { method: 'POST', form });
    db.prepare('INSERT OR REPLACE INTO cloud_media (key, remote_id, remote_path, created_at) VALUES (?,?,?,?)').run(key, r.id, r.path, now());
    return { id: r.id, path: r.path };
  }

  const html = (text) => String(text || '').split('\n')
    .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');

  /** Hands one post to Postiz Cloud with its time. `files` are local media paths. */
  async function push({ row, account, files, settings, comments }) {
    const image = [];
    for (const f of files) {
      const up = await uploadFile(f.path);
      image.push({ id: up.id, path: up.path, ...(f.alt ? { alt: f.alt } : {}) });
    }
    const soon = row.publish_at <= now() + 60_000;
    const made = await api('/posts', {
      method: 'POST',
      body: {
        type: soon ? 'now' : 'schedule',
        date: new Date(Math.max(row.publish_at, now())).toISOString(),
        shortLink: false,
        tags: [],
        posts: [{
          integration: { id: account.internal_id },
          value: [{ content: html(row.text), image }, ...comments.map((c) => ({ content: html(c), image: [] }))],
          settings: { __type: account.provider, ...settings },
        }],
      },
    });
    // Postiz gives the post its own id; that id is how it is moved, removed and read back.
    const remote = made?.[0]?.postId;
    if (!remote) throw new Error('Postiz Cloud did not confirm the post.');
    db.prepare('UPDATE posts SET remote_group=?, error=NULL, updated_at=? WHERE id=?').run(remote, now(), row.id);
    return remote;
  }

  async function removeRemote(remote) {
    if (!remote || !creds()) return;
    try { await api(`/posts/${encodeURIComponent(remote)}`, { method: 'DELETE' }); } catch (err) {
      if (err.status !== 404) throw new Error(`Postiz Cloud did not remove the old version of this post: ${err.message}`);
    }
  }

  /** Reads back what Postiz Cloud did with the posts it holds. */
  async function syncPosts(onDone) {
    if (!creds()) return;
    const rows = db.prepare("SELECT * FROM posts WHERE remote_group IS NOT NULL AND status IN ('scheduled','publishing')").all();
    if (!rows.length) return;
    const from = Math.min(...rows.map((r) => r.publish_at)) - 86400_000;
    const to = Math.max(Math.max(...rows.map((r) => r.publish_at)), now()) + 86400_000;
    const res = await api(`/posts?startDate=${encodeURIComponent(new Date(from).toISOString())}&endDate=${encodeURIComponent(new Date(to).toISOString())}`);
    const byId = new Map((res.posts || []).map((p) => [p.id, p]));
    const done = new Set();
    for (const r of rows) {
      const p = byId.get(r.remote_group);
      if (!p) continue;
      if (p.state === 'PUBLISHED') {
        db.prepare("UPDATE posts SET status='published', release_url=?, platform_post_id=?, error=NULL, updated_at=? WHERE id=?").run(p.releaseURL || null, p.releaseId || null, now(), r.id);
        done.add(r.group_id);
      } else if (p.state === 'ERROR') {
        db.prepare("UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?").run(String(p.error || 'Postiz Cloud could not publish this post.').slice(0, 1200), now(), r.id);
        done.add(r.group_id);
      }
    }
    if (done.size) {
      changed('posts');
      for (const g of done) onDone?.(g);
    }
  }

  return { status, signIn, signOut, syncAccounts, connectChannel, hide, options, push, removeRemote, syncPosts, connected: () => !!creds(), MAIN };
}

module.exports = { createCloud };
