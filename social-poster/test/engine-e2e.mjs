// End-to-end check of the engine over the same stdio protocol the Buzz plugin
// uses: start it in a throwaway data folder, list networks, connect a Nostr
// account with a new throwaway key, schedule a post, watch it publish, then
// check the command line tool against the same engine.
// Usage: node test/engine-e2e.mjs [--publish]   (without --publish nothing is posted)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../engine/', import.meta.url));
const { generateSecretKey } = require('nostr-tools');
const { bytesToHex } = require('@noble/hashes/utils');

const PUBLISH = process.argv.includes('--publish');
const home = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'social-poster-test-'));
const port = 47399;
const env = { ...process.env, SOCIAL_POSTER_HOME: home, SOCIAL_POSTER_PORT: String(port), SOCIAL_POSTER_NO_BROWSER: '1' };
const engine = spawn(join(homedir(), '.local/bin/social-poster-engine'), ['--stdio'], { env });

let buf = '', next = 1;
const waiting = new Map();
const events = [];
engine.stdout.setEncoding('utf8').on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error)) : w.resolve(msg.result); }
    else if (msg.event) events.push(msg);
  }
});
let stderr = '';
engine.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
const call = (method, params) => new Promise((resolve, reject) => {
  const id = next++;
  waiting.set(id, { resolve, reject });
  engine.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
const until = async (pred, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const hit = pred(); if (hit) return hit; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('timed out');
};
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1; };

try {
  await until(() => events.find((e) => e.event === 'ready'), 30_000);
  ok(true, 'engine started over stdio');

  const providers = await call('providers.list');
  ok(providers.length >= 34, `networks listed: ${providers.length}`);
  const x = providers.find((p) => p.identifier === 'x');
  ok(x && !x.keysReady && x.keys.join() === 'X_API_KEY,X_API_SECRET', 'X needs developer keys');

  await call('keys.set', { values: { LINKEDIN_CLIENT_ID: 'test-client-id', LINKEDIN_CLIENT_SECRET: 'test-secret' } });
  const masked = await call('keys.get', { provider: 'linkedin' });
  ok(masked.LINKEDIN_CLIENT_ID.includes('••••'), 'saved keys come back masked');
  const li = await call('accounts.connect', { provider: 'linkedin' }).catch((e) => ({ error: e.message }));
  ok(li.url?.startsWith('https://www.linkedin.com/oauth/v2/authorization') && li.url.includes(encodeURIComponent(`http://127.0.0.1:${port}/integrations/social/linkedin`)),
    'LinkedIn sign-in link built with the local callback');
  const missing = await call('accounts.connect', { provider: 'x' }).catch((e) => e.message);
  ok(/developer keys/.test(missing), 'connecting X without keys explains what is missing');

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  ok(health.ok && health.app === 'social-poster', 'local web server answers');
  const expired = await fetch(`http://127.0.0.1:${port}/integrations/social/linkedin?code=a&state=nope`);
  ok(expired.status === 400 && (await expired.text()).includes('expired'), 'unknown sign-in callback is refused');

  const key = bytesToHex(generateSecretKey());
  const conn = await call('accounts.connect', { provider: 'nostr', fields: { password: key } });
  ok(conn.connected && conn.account.network === 'nostr', `Nostr account connected (${conn.account.id})`);

  const future = await call('posts.create', { accounts: ['nostr'], text: 'later', at: new Date(Date.now() + 3600_000).toISOString() });
  ok(future.posts[0].status === 'scheduled', 'post scheduled for later');
  ok((await call('posts.cancel', { post: future.group })).cancelled === 1, 'scheduled post cancelled');
  const tooLong = await call('posts.create', { accounts: ['nostr'], text: 'x'.repeat(100_001) }).catch((e) => e.message);
  ok(/allows/.test(tooLong), 'over-length text refused');

  const cli = (...a) => execFileSync(join(homedir(), '.local/bin/social-poster'), a, { env, encoding: 'utf8' });
  ok(/nostr/.test(cli('accounts')), 'CLI lists the account');
  ok(/cancelled/.test(cli('list')), 'CLI lists posts');

  if (PUBLISH) {
    const text = `Social Poster test post ${new Date().toISOString()} (throwaway key, please ignore)`;
    const made = await call('posts.create', { accounts: [conn.account.id], text, createdBy: 'e2e' });
    const done = await until(() => events.find((e) => (e.event === 'published' || e.event === 'failed') && e.post.id === made.posts[0].id), 90_000);
    ok(done.event === 'published' && done.post.url, `published: ${done.post.url || done.post.error}`);
    const eventId = done.post.url?.split('/').pop();
    // Read the note back from a public relay to prove it is really live.
    const { Relay } = require('nostr-tools');
    const relay = await Relay.connect('wss://nos.lol');
    const found = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 10_000);
      relay.subscribe([{ ids: [eventId] }], { onevent: (e) => { clearTimeout(t); resolve(e); }, oneose: () => {} });
    });
    relay.close();
    ok(found?.content === text, `note ${eventId} read back from wss://nos.lol`);
  }
} catch (err) {
  ok(false, err.message);
  console.log(stderr.slice(-3000));
} finally {
  engine.stdin.end();
  await new Promise((r) => engine.on('exit', r));
  ok(true, 'engine exited when the plugin side closed stdin');
  console.log('data folder:', home);
}
