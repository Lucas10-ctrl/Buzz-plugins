// Notion content calendar ↔ Social Poster, over Notion's MCP tools.
//  - link a database (for example "Content Calendar")
//  - list its pieces (rows) with status, channel, date and hook
//  - import a piece as a draft post: caption from the page's "Caption"
//    section (or the hook), pictures from "Slides" / the Asset property
//  - when the post is scheduled or published, write Status, Publish date and
//    Live post link back to the row
'use strict';

const CHANNELS = [
  [/short|reel/i, ['instagram', 'instagram-standalone', 'youtube', 'tiktok', 'tiktok-business']],
  [/instagram/i, ['instagram', 'instagram-standalone']],
  [/linkedin/i, ['linkedin', 'linkedin-page']],
  [/(^|\W)x($|\W)|twitter/i, ['x']],
  [/youtube/i, ['youtube']],
  [/tiktok/i, ['tiktok', 'tiktok-business']],
  [/facebook/i, ['facebook']],
  [/threads/i, ['threads']],
  [/pinterest/i, ['pinterest']],
  [/bluesky/i, ['bluesky']],
];

function createNotionContent({ notion, db, media, posts, log, changed }) {
  const cfg = () => notion.state().database || null;

  const pageId = (s) => {
    const m = String(s || '').replace(/-/g, '').match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
    return m ? m[1] : null;
  };
  const tag = (text, name) => {
    const m = String(text).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : null;
  };
  const jsonIn = (s) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch {}
    const m = String(s).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  };

  /** Links a Notion database (or one of its views) by URL. */
  async function setDatabase({ url }) {
    const text = await notion.call('notion-fetch', { id: url });
    const sources = [...text.matchAll(/collection:\/\/[0-9a-f-]+/gi)].map((m) => m[0]);
    if (!sources.length) throw new Error('That link is not a Notion database. Open the database in Notion, copy its link and paste it here.');
    const views = [...text.matchAll(/view:\/\/[0-9a-f-]+/gi)].map((m) => m[0]);
    const title = (text.match(/<database[^>]*>([^<]{1,120})/) || text.match(/title["']?\s*[:=]\s*["']([^"']+)/) || [])[1] || 'Content calendar';
    const schemaText = await notion.call('notion-fetch', { id: sources[0] }).catch(() => text);
    const schema = jsonIn(tag(schemaText, 'data-source-state')) || jsonIn(tag(schemaText, 'schema')) || {};
    const props = schema.schema || schema.properties || {};
    const names = Object.keys(props);
    const find = (re, type) => names.find((n) => re.test(n) && (!type || !props[n]?.type || props[n].type === type));
    const statusProp = find(/^status$/i) || 'Status';
    const optionsOf = (n) => (props[n]?.options || props[n]?.select?.options || []).map((o) => o.name || o).filter(Boolean);
    const options = optionsOf(statusProp);
    const mapping = {
      title: names.find((n) => props[n]?.type === 'title') || 'Piece',
      status: statusProp,
      channel: find(/channel|platform|network/i) || 'Channel',
      date: find(/publish date|post date|^date$/i, 'date') || 'Publish date',
      hook: find(/hook|caption|copy/i) || 'Hook / title',
      asset: find(/^asset$|files?|media/i, 'file') || 'Asset',
      link: find(/live post link|post link|live link|^url$/i, 'url') || 'Live post link',
      scheduled: options.find((o) => /schedul/i.test(o)) || '📅 Scheduled',
      published: options.find((o) => /publish/i.test(o)) || '🚀 Published',
      ready: options.find((o) => /approved|ready/i.test(o)) || '✅ Approved – ready to post',
      statusOptions: options,
    };
    notion.save({ database: { url, dataSource: sources[0], views, title: title.trim() }, mapping });
    changed('notion');
    return notion.status();
  }

  async function queryRows(source) {
    const tools = await notion.tools();
    const q = tools.find((t) => t.name === 'notion-query-data-sources');
    if (!q) throw new Error('Your Notion connection does not offer database queries.');
    const props = q.inputSchema?.properties || {};
    const attempts = [];
    if (props.mode) attempts.push({ mode: 'rows', data_source_url: source, limit: 100 });
    const view = cfg()?.views?.[0];
    if (props.mode && view) attempts.push({ mode: 'view', view_url: view });
    if (props.data) attempts.push({ data: { data_source_urls: [source], query: `SELECT * FROM "${source}" LIMIT 100` } });
    let lastErr;
    for (const args of attempts) {
      try {
        const text = await notion.call('notion-query-data-sources', args);
        const json = jsonIn(text);
        const rows = json?.results || json?.rows || (Array.isArray(json) ? json : null);
        if (rows) return rows;
        lastErr = new Error('Notion returned rows in a shape Social Poster does not know');
      } catch (err) {
        lastErr = err;
        log('[notion] query failed, trying next way:', err.message);
      }
    }
    throw lastErr || new Error('Could not read the database');
  }

  const textOf = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v.replace(/<[^>]+>/g, '').trim();
    if (Array.isArray(v)) return v.map(textOf).join(', ');
    if (typeof v === 'object') return textOf(v.name ?? v.plain_text ?? v.start ?? v.url ?? v.title ?? '');
    return String(v);
  };
  const rowValue = (row, name) => row[name] ?? row[`date:${name}:start`] ?? row.properties?.[name];

  async function pieces() {
    const c = cfg();
    if (!c) throw new Error('Choose your Notion content calendar first');
    const m = notion.state().mapping;
    const rows = await queryRows(c.dataSource);
    const linked = new Map(db.prepare("SELECT id, source FROM post_groups WHERE source IS NOT NULL").all()
      .map((g) => [JSON.parse(g.source).page, g.id]));
    return rows.map((row) => {
      const url = row.url || row.id || Object.values(row).find((v) => typeof v === 'string' && /notion\.(so|com)\//.test(v));
      const id = pageId(url);
      return {
        page: id,
        url: typeof url === 'string' && url.startsWith('http') ? url : id ? `https://www.notion.so/${id}` : null,
        title: textOf(rowValue(row, m.title)),
        status: textOf(rowValue(row, m.status)),
        channel: textOf(rowValue(row, m.channel)),
        date: textOf(rowValue(row, m.date)) || null,
        hook: textOf(rowValue(row, m.hook)),
        post: linked.get(id) || null,
      };
    }).filter((p) => p.page && !/publish/i.test(p.status));
  }

  const section = (md, re) => {
    const lines = String(md).split('\n');
    const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && re.test(l));
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  };

  /** Turns one Notion piece into a draft post and returns it. */
  async function importPiece({ page, accounts }) {
    const id = pageId(page);
    if (!id) throw new Error('That is not a Notion page link');
    const existing = db.prepare("SELECT id FROM post_groups WHERE json_extract(source, '$.page') = ?").get(id);
    if (existing) return posts.getGroup({ group: existing.id });
    const m = notion.state().mapping || {};
    const text = await notion.call('notion-fetch', { id });
    const props = jsonIn(tag(text, 'properties')) || {};
    const body = tag(text, 'content') ?? text;
    const caption = section(body, /caption|copy|text/i) || textOf(props[m.hook]) || '';
    const slides = section(body, /slides|images|media|carousel/i) ?? body;
    let urls = [...slides.matchAll(/!\[[^\]]*\]\((https:[^)\s]+)\)/g)].map((x) => x[1]);
    if (!urls.length) urls = [...slides.matchAll(/<image[^>]*source="(https:[^"]+)"/g)].map((x) => x[1]);
    if (!urls.length) {
      const asset = props[m.asset];
      urls = (Array.isArray(asset) ? asset : typeof asset === 'string' ? (jsonIn(asset) || asset.split(/[\s,]+/)) : [])
        .map((a) => (typeof a === 'string' ? a : a?.url || a?.external?.url || a?.file?.url)).filter((u) => /^https:/.test(u || ''));
    }
    const items = [];
    for (const u of urls) items.push({ id: (await media.add(u)).id });
    const channel = textOf(props[m.channel]);
    const nets = (CHANNELS.find(([re]) => re.test(channel)) || [null, []])[1];
    const chosen = accounts?.length ? accounts : db.prepare('SELECT id, provider FROM accounts').all().filter((a) => nets.includes(a.provider)).map((a) => a.id);
    const when = textOf(props[`date:${m.date}:start`] ?? props[m.date]);
    const at = when && Date.parse(when) > Date.now() ? (when.length <= 10 ? `${when}T09:00:00` : when) : undefined;
    const title = textOf(props[m.title]) || (text.match(/<page[^>]*title="([^"]+)"/) || [])[1] || 'Notion piece';
    return posts.save({
      accounts: chosen, text: caption, media: items, at, mode: 'draft',
      source: { type: 'notion', page: id, url: `https://www.notion.so/${id}`, title, channel },
      createdBy: 'Notion',
    });
  }

  /** Writes the post's state back to its Notion row. */
  async function sync(groupId, state, rows) {
    const g = db.prepare('SELECT * FROM post_groups WHERE id = ?').get(groupId);
    const src = g?.source ? JSON.parse(g.source) : null;
    if (src?.type !== 'notion' || !notion.status().connected) return;
    const m = notion.state().mapping || {};
    const properties = {};
    if (state === 'scheduled') {
      properties[m.status || 'Status'] = m.scheduled || '📅 Scheduled';
      properties[`date:${m.date || 'Publish date'}:start`] = new Date(g.publish_at).toISOString();
      properties[`date:${m.date || 'Publish date'}:is_datetime`] = 1;
    } else if (state === 'published' || state === 'partial') {
      properties[m.status || 'Status'] = m.published || '🚀 Published';
      const link = (rows || []).find((r) => r.release_url)?.release_url;
      if (link) properties[m.link || 'Live post link'] = link;
    } else return;
    try {
      await notion.call('notion-update-page', { page_id: src.page, command: 'update_properties', properties });
    } catch (err) {
      log('[notion] could not update the row:', err.message);
    }
  }

  return { setDatabase, pieces, importPiece, sync };
}

module.exports = { createNotionContent };
