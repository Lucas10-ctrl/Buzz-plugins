// Checks the Postiz Cloud link against the real Postiz account signed in on
// this computer (\`postiz auth:login\`): signs in, lists the channels, schedules
// a post for June 2027 on the Facebook channel, moves it, then deletes it.
// Nothing is published. Run: node test/postiz-cloud.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module'; const sharp = createRequire(new URL('../engine/', import.meta.url))('sharp');
const home = (await import('node:fs')).mkdtempSync((process.env.TMPDIR || '/tmp') + '/social-poster-cloud-');
const eng = spawn('social-poster-engine', ['--stdio'], { env: { ...process.env, SOCIAL_POSTER_HOME: home, SOCIAL_POSTER_PORT: '47391', SOCIAL_POSTER_NO_BROWSER: '1' } });
let buf = '', id = 0; const pend = new Map(); let ready;
const isReady = new Promise((r) => (ready = r));
eng.stderr.on('data', (d) => process.stderr.write('  [engine] ' + d));
eng.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.event === 'ready') ready(); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p[1](new Error(m.error)) : p[0](m.result); } } });
const call = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, [res, rej]); eng.stdin.write(JSON.stringify({ id: n, method, params }) + '\n'); });
const ok = (c, l) => console.log((c ? 'PASS ' : 'FAIL ') + l);
await isReady;
try {
const s0 = await call('cloud.status'); ok(!s0.connected && s0.cliLogin, 'sees the Postiz login on this computer');
const s = await call('cloud.signIn'); ok(s.connected, 'one click: signed in to Postiz');
const accts = await call('accounts.list');
console.log('  channels:', accts.map((a) => `${a.network}:${a.name}:${a.status}:${a.via}`).join(', '));
ok(accts.filter((a) => a.via === 'postiz').length === 5, '5 Postiz channels show up');
const x = await call('cloud.connect', { network: 'x' });
console.log('  connect X ->', JSON.stringify(x));
const png = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#4b2bd6' } }).png().toBuffer();
const m1 = await call('media.upload', { name: 'sp-test-1.png', base64: png.toString('base64') });
const fb = accts.find((a) => a.network === 'facebook');
const g = await call('posts.save', { accounts: [fb.id], text: 'Social Poster test, line one\nline two (this test post is deleted right away)', media: [{ id: m1.id }], mode: 'schedule', at: '2027-06-01T09:00:00-04:00' });
let row;
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1000)); row = (await call('posts.group', { group: g.group })).posts[0]; if (row.status !== 'scheduled' || (await call('posts.list', {})).length) { const db = row; } if (row.status === 'failed') break; }
console.log('  row:', row.status, row.error || '');
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(home + '/social-poster.db');
const rg = db.prepare('SELECT remote_group FROM posts WHERE id=?').get(row.id)?.remote_group;
ok(!!rg, `handed to Postiz Cloud (group ${rg})`);
var cred = JSON.parse((await import('node:fs')).readFileSync(process.env.HOME + '/.postiz/credentials.json', 'utf8'));
var list = async () => (await (await fetch(`${cred.apiUrl}/public/v1/posts?startDate=2027-05-30T00:00:00Z&endDate=2027-06-03T00:00:00Z`, { headers: { authorization: cred.accessToken } })).json()).posts || [];
const there = (await list()).find((p) => p.id === rg);
ok(!!there, `Postiz Cloud has it: state ${there?.state}, ${there?.publishDate}, content ${JSON.stringify(there?.content).slice(0, 80)}`);
await call('posts.move', { group: g.group, at: '2027-06-02T10:00:00-04:00' });
await new Promise((r) => setTimeout(r, 6000));
const after = await list();
const rg2 = db.prepare('SELECT remote_group FROM posts WHERE group_id=?').get(g.group)?.remote_group;
ok(after.filter((p) => p.id === rg2).length === 1 && after.find((p) => p.id === rg2)?.publishDate?.startsWith('2027-06-02'), 'moving it on the calendar moves it in Postiz (one copy)');
await call('posts.delete', { group: g.group });
await new Promise((r) => setTimeout(r, 2000));
ok(!(await list()).some((p) => p.id === rg || p.id === rg2), 'deleting it removes it from Postiz Cloud');
} catch (e) { console.log('ERROR', e.message); } finally { const left = await list(); console.log('  left in Postiz for that week:', left.map((p) => p.id + ' ' + p.content.slice(0, 40))); eng.stdin.end(); }
