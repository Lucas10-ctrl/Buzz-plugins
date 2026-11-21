// Media library: every picture, video and PDF that Social Poster can attach.
// Files live in <data>/uploads; each has a row in `media` with its type, size,
// an optional public https address (`remote_url`, used by networks that fetch
// media themselves, like Instagram), and a small JPEG thumbnail for the page.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const IMAGE = /^\.(png|jpe?g|gif|webp|avif)$/;
const VIDEO = /^\.(mp4|mov|m4v|webm)$/;
const PDF = /^\.pdf$/;
const MAX_BYTES = 512 * 1024 * 1024;

function createMedia({ db, uploads, callbackBase, newId, changed, tunnel }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,            -- image | video | pdf
      file TEXT NOT NULL,            -- file name inside uploads/
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      remote_url TEXT,               -- public https copy, when there is one
      sha256 TEXT,
      thumb TEXT,                    -- data: URL, ~320px JPEG
      pages TEXT,                    -- PDFs: JSON list of page images in uploads/
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_sha ON media (sha256);
  `);

  let sharp;
  const getSharp = () => (sharp ??= require('sharp'));

  const kindOf = (name) => {
    const ext = path.extname(String(name || '')).toLowerCase();
    if (IMAGE.test(ext)) return 'image';
    if (VIDEO.test(ext)) return 'video';
    if (PDF.test(ext)) return 'pdf';
    return null;
  };

  /** Renders every page of a PDF to a JPEG next to it (needs pdftoppm). */
  function renderPdf(id, file) {
    const { execFileSync } = require('node:child_process');
    const prefix = path.join(uploads, `${id}-page`);
    const env = { ...process.env };
    delete env.LD_LIBRARY_PATH;
    try {
      execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=90', '-r', '144', file, prefix], { env, stdio: 'ignore', timeout: 180_000 });
    } catch (err) {
      throw new Error('Could not read the PDF pages. Install poppler (it provides pdftoppm) and add the PDF again.');
    }
    return fs.readdirSync(uploads).filter((f) => f.startsWith(`${id}-page`) && f.endsWith('.jpg')).sort((a, b) => num(a) - num(b));
  }
  const num = (f) => Number((f.match(/-(\d+)\.jpg$/) || [])[1] || 0);

  async function thumbnail(kind, file) {
    if (kind !== 'image') return { thumb: null };
    try {
      const img = getSharp()(file, { animated: false });
      const meta = await img.metadata();
      const buf = await getSharp()(file, { animated: false }).rotate().resize(360, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
      return { thumb: `data:image/jpeg;base64,${buf.toString('base64')}`, width: meta.width, height: meta.height };
    } catch {
      return { thumb: null };
    }
  }

  async function addBytes({ name, bytes, remoteUrl = null }) {
    const kind = kindOf(name);
    if (!kind) throw new Error('Use an image (PNG, JPG, GIF, WebP), a video (MP4, MOV, WebM) or a PDF');
    if (!bytes?.length) throw new Error('The file is empty');
    if (bytes.length > MAX_BYTES) throw new Error('The file is larger than 512 MB');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const same = db.prepare('SELECT * FROM media WHERE sha256 = ?').get(sha256);
    if (same) {
      if (remoteUrl && !same.remote_url) db.prepare('UPDATE media SET remote_url = ? WHERE id = ?').run(remoteUrl, same.id);
      return publicItem(db.prepare('SELECT * FROM media WHERE id = ?').get(same.id));
    }
    const id = newId();
    const file = `${id}${path.extname(name).toLowerCase()}`;
    const full = path.join(uploads, file);
    fs.writeFileSync(full, bytes, { mode: 0o600 });
    let pages = null;
    let shot = full;
    if (kind === 'pdf') {
      pages = renderPdf(id, full);
      if (!pages.length) throw new Error('This PDF has no pages');
      shot = path.join(uploads, pages[0]);
    }
    const { thumb, width = null, height = null } = await thumbnail(kind === 'pdf' ? 'image' : kind, shot);
    db.prepare(`INSERT INTO media (id, name, kind, file, size, width, height, remote_url, sha256, thumb, pages, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, String(name).slice(0, 200), kind, file, bytes.length, width, height, remoteUrl, sha256, thumb, pages ? JSON.stringify(pages) : null, Date.now());
    changed('media');
    return publicItem(db.prepare('SELECT * FROM media WHERE id = ?').get(id));
  }

  /** Adds a local file path or an https URL to the library (or finds it). */
  async function add(src, nameHint) {
    if (/^https:\/\//i.test(src)) {
      const res = await fetch(src, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Could not download ${src} (${res.status})`);
      const type = res.headers.get('content-type') || '';
      let name = nameHint || decodeURIComponent(new URL(src).pathname.split('/').pop() || 'file');
      if (!kindOf(name)) {
        const ext = type.includes('pdf') ? '.pdf' : type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('gif') ? '.gif'
          : type.includes('mp4') ? '.mp4' : type.includes('quicktime') ? '.mov' : type.includes('jpeg') || type.includes('jpg') ? '.jpg' : '';
        name += ext;
      }
      return addBytes({ name, bytes: Buffer.from(await res.arrayBuffer()), remoteUrl: src });
    }
    const file = src.startsWith('~/') ? path.join(os.homedir(), src.slice(2)) : path.resolve(src);
    if (!fs.existsSync(file)) throw new Error(`File not found: ${src}`);
    if (path.dirname(file) === uploads) {
      const row = db.prepare('SELECT * FROM media WHERE file = ?').get(path.basename(file));
      if (row) return publicItem(row);
    }
    return addBytes({ name: nameHint || path.basename(file), bytes: fs.readFileSync(file) });
  }

  const publicItem = (r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    size: r.size,
    width: r.width,
    height: r.height,
    remoteUrl: r.remote_url,
    thumb: r.thumb,
    pages: r.pages ? JSON.parse(r.pages).length : undefined,
    createdAt: new Date(r.created_at).toISOString(),
  });

  function get(id) {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
    if (!row) throw new Error(`Media ${id} is no longer in the library`);
    return row;
  }

  /**
   * The media items Postiz connectors read for one network. `mode` comes from
   * caps.cjs: 'file' (a local path), 'http' (the engine's local address) or
   * 'public' (a public https address; local files go through the tunnel).
   * A PDF becomes its page images unless the network posts documents.
   */
  async function forProvider(items, { mode, pdf }) {
    const out = [];
    for (const item of items) {
      const row = get(item.id);
      if (row.kind === 'pdf' && pdf !== 'document') {
        const pages = JSON.parse(row.pages || '[]');
        for (const [i, f] of pages.entries()) out.push(await one({ file: f, remote: null, kind: 'image', name: `${row.name} page ${i + 1}`, id: `${row.id}-${i + 1}` }, mode, item.alt));
        continue;
      }
      out.push(await one({ file: row.file, remote: row.remote_url, kind: row.kind, name: row.name, id: row.id }, mode === 'public-photos' && row.kind === 'video' ? 'file' : mode, item.alt));
    }
    return out;
  }

  async function one({ file, remote, kind, name, id }, mode, alt) {
    const local = path.join(uploads, file);
    let where;
    if (mode === 'file') where = fs.existsSync(local) ? local : remote;
    else if (mode === 'http') where = fs.existsSync(local) ? `${callbackBase()}/uploads/${file}` : remote;
    else where = remote || `${await tunnel.base()}/uploads/${file}`;
    if (!where) throw new Error(`"${name}" is missing from the media library`);
    return { id, type: kind === 'video' ? 'video' : 'image', path: where, url: where, alt: alt || undefined, name };
  }

  function list({ limit = 200, kind } = {}) {
    const rows = kind
      ? db.prepare('SELECT * FROM media WHERE kind = ? ORDER BY created_at DESC LIMIT ?').all(kind, limit)
      : db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(publicItem);
  }

  function remove({ id }) {
    const row = get(id);
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
    fs.rmSync(path.join(uploads, row.file), { force: true });
    for (const f of JSON.parse(row.pages || '[]')) fs.rmSync(path.join(uploads, f), { force: true });
    changed('media');
    return { removed: true };
  }

  return {
    kindOf,
    add,
    addBytes,
    get,
    item: (id) => publicItem(get(id)),
    forProvider,
    list,
    remove,
    upload: ({ name, base64 }) => addBytes({ name, bytes: Buffer.from(String(base64 || ''), 'base64') }),
  };
}

module.exports = { createMedia };
