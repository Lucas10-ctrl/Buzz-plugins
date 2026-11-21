// Mounts the real plugin.js in a stand-in for Buzz (jsdom + React 19 + a
// host.spawn that runs the declared engine) and uses it the way a person
// would: connect a Nostr account, write a post with a carousel from the media
// library, give one channel its own text, schedule it, find it on the
// calendar, reopen it, move it to drafts, and use the agent tools.
// Nothing is published.
import { JSDOM } from 'jsdom';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'FileReader', 'MouseEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'File', 'Blob']) {
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
const sharp = require('sharp');

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
const ctx = { react: React, pages: { register: (p) => (page = p) }, host, agents: { addTool: (t) => tools.set(t.name, t) }, effect: (f) => cleanups.push(f()) };

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
const buttons = (root = document) => [...root.querySelectorAll('button')];
const button = (label, root) => buttons(root).find((b) => b.textContent.trim() === label);
const navButton = (label) => buttons().find((b) => b.closest('nav') && b.textContent.includes(label));
const dialog = () => document.querySelector('[role=dialog]');
async function click(el) { if (!el) throw new Error('missing element'); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); }
async function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function chooseFiles(input, files) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
}
function toLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

try {
  plugin.apply(ctx);
  ok(page?.id === 'main' && page.title === 'Social Poster' && page.primary, 'registers the Social Poster page');
  ok(['social_poster_accounts', 'social_poster_schedule', 'social_poster_posts', 'social_poster_cancel'].every((n) => tools.has(n)), 'registers 4 agent tools');

  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(page.component)); });
  await until(() => text().includes('Monday') && text().includes('Sunday'), 'calendar');
  ok(true, 'opens on the month calendar');

  // Connect a channel
  await click(navButton('Channels'));
  await until(() => buttons().some((b) => b.textContent.trim().endsWith('Nostr')), 'channels page');
  await click(buttons().find((b) => b.textContent.trim().endsWith('Nostr')));
  await until(() => document.querySelector('input[type=password]'), 'nostr form');
  await type(document.querySelector('input[type=password]'), bytesToHex(generateSecretKey()));
  await click(button('Connect Nostr'));
  await until(() => text().includes('is connected'), 'nostr connected', 60000);
  ok(true, 'connected a Nostr channel from the Channels page');

  // Media library: upload 3 pictures
  await click(navButton('Media library'));
  await until(() => text().includes('Drop pictures'), 'media page');
  const files = [];
  for (const [i, c] of ['#ff0055', '#00aa66', '#3355ff'].entries()) {
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: c } }).png().toBuffer();
    files.push(new dom.window.File([png], `slide-${i + 1}.png`, { type: 'image/png' }));
  }
  await chooseFiles(document.querySelector('main input[type=file]'), files);
  await until(() => document.querySelectorAll('main img').length >= 3, 'thumbnails', 60000);
  ok(true, 'uploaded 3 pictures to the media library');

  // Create a post: pick the channel, write text, add the carousel from the library
  await click(buttons().find((b) => b.textContent.includes('Create post')));
  await until(() => dialog(), 'editor');
  await click(dialog().querySelector('button[aria-pressed]'));
  await type(dialog().querySelector('textarea'), 'Shared caption for every channel');
  await click(button('▣ Media library', dialog()));
  await until(() => text().includes('Choose from the media library') && dialog().querySelectorAll('img').length >= 3, 'library picker');
  const tiles = [...dialog().querySelectorAll('img')].map((img) => img.parentElement.parentElement);
  for (const t of tiles.slice(0, 3)) await click(t);
  await click(buttons(dialog()).find((b) => b.textContent.trim() === 'Add 3 to the post'));
  await until(() => text().includes('Carousel · 3 items'), 'carousel strip');
  ok(true, 'built a 3-picture carousel from the library');

  // Give the channel its own text
  const tabs = buttons(dialog()).filter((b) => b.style.padding === '5px 10px');
  await click(tabs[0]);
  await until(() => text().includes('uses the shared post'), 'channel tab');
  await click(buttons(dialog()).find((b) => b.textContent.startsWith('Write something different')));
  await type(dialog().querySelector('textarea'), 'Only for Nostr');
  await until(() => text().includes('This is the version for'), 'custom version');
  ok(dialog().querySelector('textarea').value === 'Only for Nostr', 'gave one channel its own text');

  await type(dialog().querySelector('input[type=datetime-local]'), toLocal(new Date(Date.now() + 2 * 3600_000)));
  await click(button('Add to calendar', dialog()));
  await until(() => !dialog(), 'editor closed', 30000);
  await click(navButton('Calendar'));
  await until(() => [...document.querySelectorAll('div[draggable]')].some((e) => e.textContent.includes('Only for Nostr')), 'chip on calendar');
  ok(true, 'the scheduled post shows on the calendar');

  // Week and list views
  await click(button('Week'));
  await until(() => [...document.querySelectorAll('div[draggable]')].some((e) => e.textContent.includes('Only for Nostr')), 'week view');
  ok(true, 'week view shows the post in its hour');
  await click(button('List'));
  await until(() => text().includes('Coming up') && text().includes('Scheduled'), 'list view');
  ok(true, 'list view shows the post and its status');
  await click(button('Month'));

  // Reopen it and save it as a draft
  await until(() => [...document.querySelectorAll('div[draggable]')].some((e) => e.textContent.includes('Only for Nostr')), 'chip');
  await click([...document.querySelectorAll('div[draggable]')].find((e) => e.textContent.includes('Only for Nostr')));
  await until(() => dialog() && text().includes('Edit post') && dialog().querySelector('textarea')?.value === 'Shared caption for every channel', 'editor reopened');
  ok(text().includes('Carousel · 3 items'), 'reopened post keeps its carousel and its texts');
  await click(button('Save as draft', dialog()));
  await until(() => !dialog(), 'closed');
  await click(navButton('Drafts'));
  await until(() => text().includes('Shared caption') || text().includes('Only for Nostr'), 'drafts list');
  ok(true, 'the post moved to Drafts');

  // Notion page without a connection
  await click(navButton('Notion'));
  await until(() => button('Connect Notion'), 'notion page');
  ok(true, 'Notion page offers to connect');

  // Agent tools
  const accounts = JSON.parse(await tools.get('social_poster_accounts').call({}, {}, {}));
  ok(accounts.length === 1 && accounts[0].network === 'nostr', 'agent tool lists the account');
  await click(navButton('Drafts'));
  const made = JSON.parse(await tools.get('social_poster_schedule').call({ name: 'Social Media Manager' }, {}, { accounts: ['nostr'], text: 'Agent draft', draft: true }));
  ok(made.posts[0].status === 'draft' && made.posts[0].createdBy === 'Social Media Manager', 'agent tool saves a draft as the agent');
  await until(() => text().includes('Agent draft'), 'agent draft appears live');
  ok(true, 'page updates live when an agent adds a post');

  await act(async () => { root.unmount(); });
} catch (err) {
  ok(false, err.message);
} finally {
  for (const c of cleanups) typeof c === 'function' && c();
  await Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.on('exit', r)))));
  ok(children.every((c) => c.exitCode !== null || c.signalCode), 'engine stopped when the plugin was disposed');
  process.exit();
}
