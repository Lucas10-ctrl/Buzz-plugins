// Notion, through Notion's own MCP server (https://mcp.notion.com/mcp).
// Social Poster signs in with OAuth (dynamic client registration + PKCE, the
// callback lands on the engine's local web server), then calls Notion's MCP
// tools over streamable HTTP: fetch a content database, read each piece's
// caption and slides, and write the status and live link back.
'use strict';

const crypto = require('node:crypto');

const MCP_URL = 'https://mcp.notion.com/mcp';
const ISSUER = 'https://mcp.notion.com';

function createNotion({ getSetting, setSetting, callbackBase, openInBrowser, log, onChange }) {
  let session = null; // { id, tools }

  const state = () => getSetting('notion', {});
  const save = (patch) => {
    setSetting('notion', { ...state(), ...patch });
    onChange();
  };

  async function metadata() {
    const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
    if (!res.ok) throw new Error(`Notion sign-in is unavailable (${res.status})`);
    return res.json();
  }

  async function connect() {
    const meta = await metadata();
    const redirect = `${callbackBase()}/notion/callback`;
    let { client } = state();
    if (!client || client.redirect !== redirect) {
      const res = await fetch(meta.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Social Poster (Buzz)',
          redirect_uris: [redirect],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      if (!res.ok) throw new Error(`Notion refused to register Social Poster (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const reg = await res.json();
      client = { id: reg.client_id, secret: reg.client_secret || null, redirect };
      save({ client });
    }
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const st = crypto.randomBytes(16).toString('hex');
    save({ pending: { state: st, verifier, at: Date.now() } });
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: st,
      resource: MCP_URL,
    }).toString();
    openInBrowser(url.toString());
    return { url: url.toString() };
  }

  async function tokenRequest(params) {
    const meta = await metadata();
    const { client } = state();
    const body = new URLSearchParams({ client_id: client.id, ...params, resource: MCP_URL });
    if (client.secret) body.set('client_secret', client.secret);
    const res = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Notion sign-in failed: ${json.error_description || json.error || res.status}`);
    const tokens = {
      access: json.access_token,
      refresh: json.refresh_token || state().tokens?.refresh || null,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    };
    session = null;
    save({ tokens });
    return tokens;
  }

  async function finish(query) {
    const { pending } = state();
    if (query.get('error')) throw new Error(query.get('error_description') || query.get('error'));
    if (!pending || pending.state !== query.get('state')) throw new Error('This Notion sign-in link expired. Start again from Social Poster.');
    save({ pending: null });
    await tokenRequest({ grant_type: 'authorization_code', code: query.get('code'), redirect_uri: state().client.redirect, code_verifier: pending.verifier });
    const who = await call('notion-get-self', {}).catch(() => null);
    save({ connectedAt: Date.now(), workspace: who ? summarize(who).slice(0, 200) : null });
  }

  async function accessToken() {
    const { tokens } = state();
    if (!tokens?.access) throw new Error('Notion is not connected');
    if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60_000 && tokens.refresh) {
      return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh })).access;
    }
    return tokens.access;
  }

  async function rpc(method, params, { notify = false, retried = false } = {}) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await accessToken()}`,
    };
    if (session?.id) headers['mcp-session-id'] = session.id;
    if (session?.protocol) headers['mcp-protocol-version'] = session.protocol;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: crypto.randomUUID(), method, params };
    const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401 && !retried && state().tokens?.refresh) {
      await tokenRequest({ grant_type: 'refresh_token', refresh_token: state().tokens.refresh });
      return rpc(method, params, { notify, retried: true });
    }
    if (res.status === 404 && session?.id && !retried) {
      session = null; // the server forgot the session; start a new one
      await ensureSession();
      return rpc(method, params, { notify, retried: true });
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid && session) session.id = sid;
    if (notify) return null;
    if (!res.ok) throw new Error(`Notion MCP error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get('content-type') || '';
    let msg;
    if (type.includes('text/event-stream')) {
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = JSON.parse(line.slice(5).trim());
        if (data.id === body.id) msg = data;
      }
    } else {
      msg = await res.json();
    }
    if (!msg) throw new Error('Notion MCP sent no answer');
    if (msg.error) throw new Error(`Notion: ${msg.error.message || JSON.stringify(msg.error)}`);
    return { result: msg.result, sessionId: sid };
  }

  async function ensureSession() {
    if (session?.ready) return session;
    session = { id: null, protocol: null };
    const { result, sessionId } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'social-poster', version: '0.2.0' },
    });
    session.id = sessionId || session.id;
    session.protocol = result?.protocolVersion || '2025-06-18';
    await rpc('notifications/initialized', {}, { notify: true });
    const listed = await rpc('tools/list', {});
    session.tools = (listed.result?.tools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    session.ready = true;
    return session;
  }

  /** Calls one Notion MCP tool and returns its text content. */
  async function call(name, args) {
    await ensureSession();
    const { result } = await rpc('tools/call', { name, arguments: args });
    const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result?.isError) throw new Error(`Notion: ${text.slice(0, 500)}`);
    return text;
  }

  async function tools() {
    return (await ensureSession()).tools;
  }

  function status() {
    const s = state();
    return {
      connected: !!s.tokens?.access,
      connectedAt: s.connectedAt ? new Date(s.connectedAt).toISOString() : null,
      workspace: s.workspace || null,
      database: s.database || null,
      mapping: s.mapping || null,
    };
  }

  function disconnect() {
    session = null;
    const { client, database, mapping } = state();
    setSetting('notion', { client, database, mapping });
    onChange();
    return status();
  }

  return { connect, finish, call, tools, status, disconnect, save, state };
}

const summarize = (text) => String(text).replace(/\s+/g, ' ').trim();

module.exports = { createNotion };
