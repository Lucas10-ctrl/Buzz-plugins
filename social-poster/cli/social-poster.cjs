#!/usr/bin/env node
// social-poster: command line for the Social Poster engine running inside Buzz.
// Agents (and you) can schedule and check posts with it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = process.env.SOCIAL_POSTER_HOME || path.join(os.homedir(), '.local', 'share', 'social-poster');

const HELP = `social-poster — schedule social media posts through Social Poster in Buzz

Usage:
  social-poster status
  social-poster accounts                      connected accounts (id, network, name)
  social-poster networks                      every supported network and whether its keys are set
  social-poster post --to <account>[,<account>...] --text "..." [--at <time>] [--media <file or https url>]...
                     [--settings '<json>']    --at takes ISO 8601 (2026-11-24T09:00:00-05:00); leave it out to post now.
                                              <account> is an account id, a network name (x, linkedin) or a username.
  social-poster list [--status scheduled|published|failed|cancelled] [--limit N]
  social-poster show <post id>
  social-poster cancel <post id or group id>
  social-poster retry <post id or group id> [--at <time>]
  social-poster delete <post id or group id>

Add --json to any command for machine-readable output.
Social Poster must be running: open Buzz with the Social Poster plugin turned on.`;

function parse(argv) {
  const args = { _: [], media: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '-h' || a === '--help') { args[a.replace(/^-+/, '')] = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[++i];
      if (value === undefined) fail(`${a} needs a value`);
      if (key === 'media') args.media.push(value); else args[key] = value;
      continue;
    }
    args._.push(a);
  }
  return args;
}

function fail(message) {
  process.stderr.write(`social-poster: ${message}\n`);
  process.exit(1);
}

async function rpc(method, params) {
  let api;
  try { api = JSON.parse(fs.readFileSync(path.join(HOME, 'api.json'), 'utf8')); }
  catch { fail('Social Poster has not run on this computer yet. Turn on the Social Poster plugin in Buzz.'); }
  let res;
  try {
    res = await fetch(`${api.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
      body: JSON.stringify({ method, params }),
    });
  } catch {
    fail('Social Poster is not running. Open Buzz (with the Social Poster plugin on) and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) fail(body.error || `HTTP ${res.status}`);
  return body.result;
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const line = (p) => `${p.id}  ${p.status.padEnd(10)} ${when(p.publishAt).padEnd(22)} ${(p.network + ' · ' + p.accountName).padEnd(28)} ${p.text.replace(/\s+/g, ' ').slice(0, 60)}${p.url ? `\n${' '.repeat(14)}${p.url}` : ''}${p.error ? `\n${' '.repeat(14)}error: ${p.error}` : ''}`;

(async () => {
  const args = parse(process.argv.slice(2));
  const [cmd, target] = args._;
  if (!cmd || args.help || args.h) return console.log(HELP);
  const out = (data, text) => console.log(args.json ? JSON.stringify(data, null, 2) : text(data));

  switch (cmd) {
    case 'status':
      return out(await rpc('status'), (s) =>
        `Social Poster ${s.version}: ${s.accounts} accounts, ${s.scheduled} scheduled, ${s.published} published, ${s.failed} failed.` +
        (s.nextPostAt ? `\nNext post: ${when(s.nextPostAt)}` : ''));
    case 'accounts':
      return out(await rpc('accounts.list'), (list) => list.length
        ? list.map((a) => `${a.id}  ${a.network.padEnd(20)} ${a.name}${a.username ? ` (@${a.username})` : ''}${a.status !== 'ready' ? `  [${a.status}]` : ''}`).join('\n')
        : 'No accounts connected yet. Connect them in Buzz → Social Poster → Accounts.');
    case 'networks':
      return out(await rpc('providers.list'), (list) => list.map((p) =>
        `${p.identifier.padEnd(22)} ${p.name.padEnd(28)} ${p.login === 'fields' ? 'sign in with details' : p.keysReady ? 'keys set' : 'needs developer keys: ' + p.keys.join(', ')}`).join('\n'));
    case 'post': {
      if (!args.to) fail('--to is required (an account id, network name or username; comma-separated for several)');
      if (!args.text) fail('--text is required');
      let settings;
      if (args.settings) { try { settings = JSON.parse(args.settings); } catch { fail('--settings must be JSON'); } }
      const r = await rpc('posts.create', {
        accounts: args.to.split(',').map((s) => s.trim()).filter(Boolean),
        text: args.text, at: args.at, media: args.media, settings, createdBy: process.env.SOCIAL_POSTER_AGENT || 'cli',
      });
      return out(r, (x) => `Scheduled ${x.posts.length} post(s) (group ${x.group}):\n` + x.posts.map(line).join('\n'));
    }
    case 'list':
      return out(await rpc('posts.list', { status: args.status, limit: args.limit ? Number(args.limit) : 50 }),
        (list) => list.length ? list.map(line).join('\n') : 'No posts.');
    case 'show':
      if (!target) fail('show needs a post id');
      return out(await rpc('posts.get', { post: target }), line);
    case 'cancel':
      if (!target) fail('cancel needs a post id');
      return out(await rpc('posts.cancel', { post: target }), (r) => `Cancelled ${r.cancelled} post(s).`);
    case 'retry':
      if (!target) fail('retry needs a post id');
      return out(await rpc('posts.retry', { post: target, at: args.at }), (r) => `Scheduled ${r.scheduled} post(s) again.`);
    case 'delete':
      if (!target) fail('delete needs a post id');
      return out(await rpc('posts.delete', { post: target }), (r) => `Deleted ${r.deleted} post(s).`);
    default:
      fail(`unknown command "${cmd}". Run social-poster --help`);
  }
})();
