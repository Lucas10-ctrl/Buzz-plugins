// Mounts the real plugin.js in a stand-in for Buzz (jsdom + React 19 + a
// host.spawn that runs the declared process) and clicks through it the way a
// person would: connect a Nostr account, schedule a post, cancel it, then use
// the agent tools. Nothing is published.
import { JSDOM } from 'jsdom';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'FileReader', 'MouseEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
  globalThis[k] ??= dom.window[k];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.confirm = () => true;

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = React;

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
const plugin = await import('../plugin.js');
const home = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'social-poster-ui-'));
const require = createRequire(new URL('../engine/', import.meta.url));
const { generateSecretKey } = require('nostr-tools');
const { bytesToHex } = require('@noble/hashes/utils');

const children = [];
const host = {
  async spawn(id, options) {
    const decl = manifest.host.processes.find((p) => p.id === id);
    if (!decl) throw new Error(`undeclared process ${id}`);
    const child = spawn(decl.program, [...(decl.args ?? []), ...(options.args ?? [])], {
      env: { ...process.env, SOCIAL_POSTER_HOME: home, SOCIAL_POSTER_PORT: '47398', SOCIAL_POSTER_NO_BROWSER: '1' },
    });
    children.push(child);
    child.stdout.setEncoding('utf8').on('data', (d) => options.onStdout?.(d));
    child.stderr.setEncoding('utf8').on('data', (d) => options.onStderr?.(d));
    return {
      write: async (t) => void child.stdin.write(t),
      end: async () => void child.stdin.end(),
      kill: async () => void child.kill(),
      exited: new Promise((r) => child.on('exit', (c) => r(c))),
    };
  },
};
let page;
const tools = new Map();
const cleanups = [];
const ctx = {
  react: React,
  pages: { register: (p) => (page = p) },
  host,
  agents: { addTool: (t) => tools.set(t.name, t) },
  effect: (f) => cleanups.push(f()),
  reflect: { get: () => undefined },
};

const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => document.body.textContent;
async function until(pred, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await act(async () => { await sleep(100); });
    if (pred()) return true;
  }
  throw new Error(`timed out waiting for: ${label}\n--- page ---\n${text().slice(0, 1500)}`);
}
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
async function click(el) { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); }
async function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}

try {
  plugin.apply(ctx);
  ok(page?.id === 'main' && page.title === 'Social Poster' && page.primary, 'registers the Social Poster page');
  ok(['social_poster_accounts', 'social_poster_schedule', 'social_poster_posts', 'social_poster_cancel'].every((n) => tools.has(n)), 'registers 4 agent tools');

  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(page.component)); });
  await until(() => text().includes('Connect an account first'), 'empty state');
  ok(true, 'engine started; Write tab asks to connect an account first');

  await click(button('Accounts'));
  await until(() => document.querySelector('select')?.options.length > 30, 'network list');
  ok(document.querySelector('select').options.length >= 35, `network picker lists ${document.querySelector('select').options.length - 1} networks`);

  await type(document.querySelector('select'), 'x');
  await until(() => text().includes('Where it asks for a callback'), 'X key instructions');
  ok(text().includes('http://127.0.0.1:47398/integrations/social/x'), 'X shows the callback address to paste into the developer app');

  await type(document.querySelector('select'), 'nostr');
  await until(() => text().includes('Nostr private key'), 'nostr fields');
  await type(document.querySelector('input[type=password]'), bytesToHex(generateSecretKey()));
  await click(button('Connect Nostr'));
  await until(() => text().includes('is connected'), 'nostr connected', 60000);
  ok(true, 'connected a Nostr account from the Accounts tab');

  await click(button('Write a post'));
  await until(() => document.querySelector('textarea'), 'composer');
  await click(document.querySelector('input[type=checkbox]'));
  await type(document.querySelector('textarea'), 'Hello from the Social Poster UI test');
  await until(() => text().includes('of 100000 characters'), 'char counter');
  ok(true, 'character counter uses the network limit');
  await click([...document.querySelectorAll('input[type=radio]')][1]);
  await until(() => document.querySelector('input[type=datetime-local]'), 'date field');
  await click(button('Schedule post'));
  await until(() => text().includes('Scheduled for'), 'scheduled message');
  ok(true, 'scheduled a post from the composer');

  await click(button('Posts'));
  await until(() => text().includes('Scheduled (1)'), 'queue');
  ok(text().includes('Hello from the Social Poster UI test'), 'post shows in the Posts tab');
  await click(button('Cancel'));
  await until(() => text().includes('Cancelled (1)'), 'cancelled');
  ok(true, 'cancelled it from the Posts tab');

  const accounts = JSON.parse(await tools.get('social_poster_accounts').call({}, {}, {}));
  ok(accounts.length === 1 && accounts[0].network === 'nostr', 'agent tool lists the account');
  const made = JSON.parse(await tools.get('social_poster_schedule').call({ name: 'Social Media Manager' }, {}, {
    accounts: ['nostr'], text: 'Agent scheduled this', at: new Date(Date.now() + 86400_000).toISOString(),
  }));
  ok(made.posts[0].status === 'scheduled' && made.posts[0].createdBy === 'Social Media Manager', 'agent tool schedules a post as the agent');
  await until(() => text().includes('by Social Media Manager'), 'agent post appears live in the page');
  ok(true, 'page updates live when an agent schedules');
  const cancelled = JSON.parse(await tools.get('social_poster_cancel').call({}, {}, { post: made.group }));
  ok(cancelled.cancelled === 1, 'agent tool cancels');

  await act(async () => { root.unmount(); });
} catch (err) {
  ok(false, err.message);
} finally {
  for (const c of cleanups) typeof c === 'function' && c();
  await Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.on('exit', r)))));
  ok(children.every((c) => c.exitCode !== null || c.signalCode), 'engine stopped when the plugin was disposed');
  process.exit();
}
