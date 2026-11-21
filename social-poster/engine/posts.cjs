// Posts: one "post" is what the owner writes once (text, pictures, follow-up
// comments, time) for several accounts. It is stored as a group (post_groups)
// and one row per account (posts), which is what gets published. Each account
// can have its own text, pictures and network options.
'use strict';

const { capsOf, settingsFor, problems } = require('./caps.cjs');

function createPosts(deps) {
  const { db, P, provider, accountRow, integrationOf, refreshAccount, media, newId, now, changed, emit, log, onGroupState } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_groups (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      media TEXT NOT NULL DEFAULT '[]',        -- [{id, alt}]
      comments TEXT NOT NULL DEFAULT '[]',     -- [text]
      overrides TEXT NOT NULL DEFAULT '{}',    -- {accountId: {text?, media?}}
      settings TEXT NOT NULL DEFAULT '{}',     -- {accountId: {...}}
      publish_at INTEGER NOT NULL,
      source TEXT,                              -- {type:'notion', page, url, title}
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // Groups for posts made by version 0.1, which had no group table.
  for (const r of db.prepare(`SELECT p.* FROM posts p LEFT JOIN post_groups g ON g.id = p.group_id WHERE g.id IS NULL GROUP BY p.group_id`).all()) {
    db.prepare(`INSERT INTO post_groups (id, text, media, publish_at, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(r.group_id, r.text, '[]', r.publish_at, r.created_by, r.created_at, r.updated_at);
  }
  db.prepare("UPDATE posts SET status='draft' WHERE status='cancelled'").run();

  const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const groupRow = (id) => {
    const g = db.prepare('SELECT * FROM post_groups WHERE id = ?').get(id);
    if (!g) throw new Error(`No post ${id}`);
    return g;
  };

  function parseWhen(at, fallback = now()) {
    if (at === undefined || at === null || at === '' || at === 'now') return fallback;
    const t = typeof at === 'number' ? at : Date.parse(at);
    if (!Number.isFinite(t)) throw new Error(`Could not read the time "${at}". Use a date like 2026-11-24T09:00:00-05:00`);
    return t;
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

  const mediaInfo = (items) => (items || []).map((m) => {
    const row = media.get(m.id);
    return { id: row.id, kind: row.kind, name: row.name, pages: row.pages ? J(row.pages, []).length : undefined };
  });

  /** What would go to one account: its own text/media if customized, else the shared ones. */
  function partFor(draft, accountId) {
    const o = draft.overrides?.[accountId] || {};
    return {
      text: o.text ?? draft.text ?? '',
      media: o.media ?? draft.media ?? [],
      settings: draft.settings?.[accountId] || {},
    };
  }

  function maxLengthOf(a) {
    const p = provider(a.provider);
    try { return p.maxLength(J(a.additional_settings, [])) || null; } catch { return null; }
  }

  /** Problems per account for a draft, as the composer shows them. */
  function validate(draft) {
    const out = {};
    for (const id of draft.accounts || []) {
      const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      if (!a) { out[id] = { errors: ['This account was removed'], warnings: [] }; continue; }
      const part = partFor(draft, id);
      let info;
      try { info = mediaInfo(part.media); } catch (err) { out[id] = { errors: [err.message], warnings: [] }; continue; }
      const res = problems(a.provider, { text: part.text, media: info, settings: settingsFor(a.provider, part.settings), maxLength: maxLengthOf(a), comments: draft.comments });
      if (a.status !== 'ready') res.errors.unshift(a.status === 'needs_page' ? 'Finish connecting this account: choose its page in Channels.' : 'Reconnect this account in Channels.');
      out[id] = res;
    }
    return out;
  }

  function save({ group, accounts, text = '', media: items = [], overrides = {}, settings = {}, comments = [], at, mode = 'draft', source, createdBy }) {
    // A draft may have no channels yet (for example a piece imported from Notion).
    const targets = mode === 'draft' && !(accounts || []).length ? [] : resolveAccounts(accounts);
    const ids = targets.map((a) => a.id);
    const draft = { accounts: ids, text, media: items, overrides, settings, comments: (comments || []).filter((c) => String(c).trim()), source };
    const t = now();
    const when = mode === 'now' ? t : parseWhen(at, t + 3600_000);
    if (mode !== 'draft') {
      if (mode === 'schedule' && when < t - 60_000) throw new Error('That time has passed. Pick a time in the future, or choose “Post now”.');
      const found = validate(draft);
      const bad = Object.entries(found).filter(([, v]) => v.errors.length);
      if (bad.length) {
        const err = new Error(bad.map(([id, v]) => `${targets.find((a) => a.id === id)?.name || id}: ${v.errors.join(' ')}`).join('\n'));
        err.problems = found;
        throw err;
      }
    }
    const status = mode === 'draft' ? 'draft' : 'scheduled';
    const gid = group || newId();
    const existing = db.prepare('SELECT * FROM post_groups WHERE id = ?').get(gid);
    const kept = existing ? db.prepare("SELECT account_id FROM posts WHERE group_id = ? AND status IN ('published','publishing')").all(gid).map((r) => r.account_id) : [];
    db.exec('BEGIN');
    try {
      if (existing) {
        db.prepare(`UPDATE post_groups SET text=?, media=?, comments=?, overrides=?, settings=?, publish_at=?, source=COALESCE(?, source), updated_at=? WHERE id=?`)
          .run(text, JSON.stringify(items), JSON.stringify(draft.comments), JSON.stringify(overrides), JSON.stringify(settings), when, source ? JSON.stringify(source) : null, t, gid);
        db.prepare("DELETE FROM posts WHERE group_id = ? AND status NOT IN ('published','publishing')").run(gid);
      } else {
        db.prepare(`INSERT INTO post_groups (id, text, media, comments, overrides, settings, publish_at, source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(gid, text, JSON.stringify(items), JSON.stringify(draft.comments), JSON.stringify(overrides), JSON.stringify(settings), when, source ? JSON.stringify(source) : null, createdBy || null, t, t);
      }
      for (const a of targets) {
        if (kept.includes(a.id)) continue;
        const part = partFor(draft, a.id);
        db.prepare(`INSERT INTO posts (id, group_id, account_id, text, media, settings, publish_at, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(newId(), gid, a.id, part.text, JSON.stringify(part.media), JSON.stringify(part.settings), when, status, createdBy || existing?.created_by || null, t, t);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    changed('posts');
    if (status === 'scheduled') {
      onGroupState(gid, 'scheduled');
      setImmediate(tick);
    }
    return getGroup({ group: gid });
  }

  function getGroup({ group }) {
    const g = groupRow(group);
    const rows = db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network FROM posts p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.group_id = ? ORDER BY a.provider`).all(group);
    const items = J(g.media, []);
    return {
      group: g.id,
      accounts: rows.map((r) => r.account_id),
      text: g.text,
      media: items.map((m) => ({ ...m, ...safeItem(m.id) })),
      comments: J(g.comments, []),
      overrides: J(g.overrides, {}),
      settings: J(g.settings, {}),
      publishAt: new Date(g.publish_at).toISOString(),
      source: J(g.source, null),
      createdBy: g.created_by,
      posts: rows.map(publicRow),
      status: groupStatus(rows),
    };
  }
  const safeItem = (id) => { try { return media.item(id); } catch { return { missing: true }; } };

  function groupStatus(rows) {
    const s = rows.map((r) => r.status);
    if (!s.length) return 'draft';
    if (s.every((x) => x === 'published')) return 'published';
    if (s.includes('failed')) return 'failed';
    if (s.includes('publishing')) return 'publishing';
    if (s.includes('scheduled')) return 'scheduled';
    if (s.includes('published')) return 'partial';
    return 'draft';
  }

  const publicRow = (r) => ({
    id: r.id,
    group: r.group_id,
    account: r.account_id,
    accountName: r.account_name || '(removed account)',
    network: r.network,
    text: r.text,
    publishAt: new Date(r.publish_at).toISOString(),
    status: r.status,
    url: r.release_url,
    error: r.error,
    attempts: r.attempts,
    createdBy: r.created_by,
  });

  /** Rows between two times for the calendar, with a thumbnail of the first picture. */
  function calendar({ from, to }) {
    const rows = db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network, g.media AS gmedia, g.source AS gsource, g.overrides AS goverrides
      FROM posts p JOIN post_groups g ON g.id = p.group_id LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.publish_at >= ? AND p.publish_at < ? ORDER BY p.publish_at`).all(parseWhen(from), parseWhen(to));
    const thumbs = new Map();
    const out = rows.map((r) => {
      const first = J(r.media, [])[0];
      let thumb = null;
      if (first) {
        if (!thumbs.has(first.id)) thumbs.set(first.id, safeItem(first.id).thumb || null);
        thumb = thumbs.get(first.id);
      }
      return { ...publicRow(r), mediaCount: J(r.media, []).length, thumb, fromNotion: !!J(r.gsource, null) };
    });
    // Drafts that have no channels yet still show on the calendar.
    const lonely = db.prepare(`SELECT g.* FROM post_groups g WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.group_id = g.id)
      AND g.publish_at >= ? AND g.publish_at < ?`).all(parseWhen(from), parseWhen(to)).map((g) => {
      const first = J(g.media, [])[0];
      return { id: g.id, group: g.id, account: null, accountName: 'No channels yet', network: null, text: g.text, publishAt: new Date(g.publish_at).toISOString(),
        status: 'draft', url: null, error: null, mediaCount: J(g.media, []).length, thumb: first ? safeItem(first.id).thumb || null : null, fromNotion: !!J(g.source, null), createdBy: g.created_by };
    });
    return [...out, ...lonely].sort((x, y) => x.publishAt.localeCompare(y.publishAt));
  }

  function move({ group, at }) {
    const when = parseWhen(at);
    if (when < now() - 60_000) throw new Error('Pick a time in the future.');
    const r = db.prepare("UPDATE posts SET publish_at=?, updated_at=? WHERE group_id=? AND status IN ('scheduled','draft','failed')").run(when, now(), group);
    db.prepare('UPDATE post_groups SET publish_at=?, updated_at=? WHERE id=?').run(when, now(), group);
    if (!r.changes) throw new Error('This post was already published, so it can’t be moved.');
    db.prepare("UPDATE posts SET status='scheduled', error=NULL WHERE group_id=? AND status='failed'").run(group);
    changed('posts');
    if (db.prepare("SELECT 1 FROM posts WHERE group_id=? AND status='scheduled'").get(group)) onGroupState(group, 'scheduled');
    return getGroup({ group });
  }

  function duplicate({ group }) {
    const g = getGroup({ group });
    return save({ accounts: g.accounts, text: g.text, media: g.media.map(({ id, alt }) => ({ id, alt })), overrides: g.overrides, settings: g.settings, comments: g.comments, at: new Date(Math.max(Date.parse(g.publishAt), now() + 3600_000)).toISOString(), mode: 'draft', createdBy: g.createdBy });
  }

  function remove({ group, post }) {
    const id = group || db.prepare('SELECT group_id FROM posts WHERE id = ?').get(post)?.group_id || post;
    const r = db.prepare("DELETE FROM posts WHERE group_id = ? AND status != 'publishing'").run(id);
    if (!db.prepare('SELECT 1 FROM posts WHERE group_id = ?').get(id)) db.prepare('DELETE FROM post_groups WHERE id = ?').run(id);
    changed('posts');
    return { deleted: Number(r.changes) };
  }

  /** Moves scheduled posts back to drafts, so they are not sent. */
  function unschedule({ post }) {
    const r = db.prepare("UPDATE posts SET status='draft', updated_at=? WHERE (id=? OR group_id=?) AND status='scheduled'").run(now(), post, post);
    if (!r.changes) throw new Error('Nothing to cancel: only scheduled posts can be cancelled');
    changed('posts');
    return { cancelled: Number(r.changes) };
  }

  function retry({ post, at }) {
    const r = db.prepare("UPDATE posts SET status='scheduled', error=NULL, publish_at=?, updated_at=? WHERE (id=? OR group_id=?) AND status IN ('failed','draft')")
      .run(parseWhen(at), now(), post, post);
    if (!r.changes) throw new Error('Only failed or draft posts can be sent again');
    changed('posts');
    setImmediate(tick);
    return { scheduled: Number(r.changes) };
  }

  function list({ status, limit = 100 } = {}) {
    const rows = status
      ? db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network FROM posts p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.status = ? ORDER BY p.publish_at DESC LIMIT ?`).all(status === 'cancelled' ? 'draft' : status, limit)
      : db.prepare(`SELECT p.*, a.name AS account_name, a.provider AS network FROM posts p LEFT JOIN accounts a ON a.id = p.account_id
          ORDER BY CASE p.status WHEN 'scheduled' THEN 0 WHEN 'publishing' THEN 0 ELSE 1 END, p.publish_at DESC LIMIT ?`).all(limit);
    return rows.map(publicRow);
  }

  /** For the command line and agent tools: media as paths or https links. */
  async function create({ accounts, text, media: srcs = [], at, settings = {}, comments = [], createdBy, draft }) {
    const targets = resolveAccounts(accounts);
    const items = [];
    for (const s of srcs || []) items.push({ id: (await media.add(String(s))).id });
    const per = {};
    for (const a of targets) per[a.id] = settings[a.provider] ?? settings[a.id] ?? (Object.keys(settings).some((k) => /^[a-z-]+$/.test(k) && capsOf(k) !== capsOf('__none__')) ? {} : settings);
    const g = save({ accounts: targets.map((a) => a.id), text, media: items, settings: per, comments, at, mode: draft ? 'draft' : at && at !== 'now' ? 'schedule' : 'now', createdBy });
    return { group: g.group, posts: g.posts };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

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
    const g = db.prepare('SELECT * FROM post_groups WHERE id = ?').get(row.group_id);
    let note = null;
    try {
      if (!account) throw new Error('The account was removed');
      const p = provider(account.provider);
      const c = capsOf(account.provider);
      if (account.status === 'needs_page') throw new Error('Finish connecting this account: choose the page to post to');
      if (account.token_expiration && account.token_expiration < now() + 5 * 60_000 && account.refresh_token && !p.noRefreshBeforeCall) {
        account = await refreshAccount(account);
      }
      const items = c.maxMedia === 0 ? [] : J(row.media, []);
      const info = items.map((m) => media.get(m.id));
      const settings = settingsFor(account.provider, J(row.settings, {}));
      if (c.pdf === 'document' && info.length === 1 && info[0].kind === 'pdf') settings.post_as_images_carousel = true;
      const files = await media.forProvider(items, { mode: c.media, pdf: c.pdf });
      const details = [{
        id: row.id,
        message: P.stripHtmlValidation(p.editor || 'normal', row.text, true, false, true, p.mentionFormat, false),
        settings,
        media: files,
      }];
      const send = async (fn) => {
        try { return await fn(); } catch (err) {
          if (!isType(err, 'refresh_token')) throw err;
          account = await refreshAccount(account);
          return fn();
        }
      };
      const result = await send(() => p.post(account.internal_id, account.token, details, integrationOf(account)));
      const first = (result || [])[0] || {};
      const comments = J(g?.comments, []);
      if (comments.length && c.comments && typeof p.comment === 'function' && first.postId) {
        let last;
        try {
          for (const [i, text] of comments.entries()) {
            const res = await send(() => p.comment(account.internal_id, String(first.postId), last, account.token,
              [{ id: `${row.id}-c${i + 1}`, message: P.stripHtmlValidation(p.editor || 'normal', text, true, false, true, p.mentionFormat, false), settings, media: [] }],
              integrationOf(account)));
            last = res?.[0]?.postId ? String(res[0].postId) : last;
          }
        } catch (err) {
          note = `Posted, but a follow-up comment failed: ${errorText(err)}`;
        }
      }
      db.prepare("UPDATE posts SET status='published', release_url=?, platform_post_id=?, error=?, updated_at=? WHERE id=?")
        .run(first.releaseURL || null, first.postId ? String(first.postId) : null, note, now(), row.id);
      emit('published', { post: publicRow({ ...db.prepare('SELECT * FROM posts WHERE id=?').get(row.id), account_name: account.name, network: account.provider }) });
    } catch (err) {
      const message = errorText(err);
      log(`[publish ${row.id}]`, message);
      if (account && (isType(err, 'disconnect') || isType(err, 'refresh_token'))) {
        db.prepare("UPDATE accounts SET status='disconnected', status_message=?, updated_at=? WHERE id=?").run(message, now(), account.id);
        changed('accounts');
      }
      db.prepare("UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?").run(message, now(), row.id);
      emit('failed', { post: publicRow({ ...db.prepare('SELECT * FROM posts WHERE id=?').get(row.id), account_name: account?.name, network: account?.provider }) });
    }
    changed('posts');
    const rows = db.prepare('SELECT * FROM posts WHERE group_id = ?').all(row.group_id);
    if (rows.every((r) => r.status === 'published' || r.status === 'failed')) onGroupState(row.group_id, groupStatus(rows), rows);
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

  return { save, validate, getGroup, calendar, move, duplicate, remove, unschedule, retry, list, create, tick, errorText, publicRow, resolveAccounts, parseWhen };
}

module.exports = { createPosts };
