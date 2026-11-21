// Dev probe: signs in to Notion MCP with createNotion() and keeps the tokens
// in a JSON file, so Notion's tools can be explored before wiring the UI.
// Usage: node test/notion-probe.mjs login            (prints the sign-in URL, waits for the callback)
//        node test/notion-probe.mjs tools
//        node test/notion-probe.mjs call <tool> '<json args>'
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createNotion } = require('../engine/notion.cjs');
const file = join(process.env.TMPDIR || '/tmp', 'notion-probe.json');
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const notion = createNotion({
  getSetting: (k, d) => store[k] ?? d,
  setSetting: (k, v) => { store[k] = v; writeFileSync(file, JSON.stringify(store), { mode: 0o600 }); },
  callbackBase: () => 'http://127.0.0.1:47321',
  openInBrowser: () => {},
  log: console.error,
  onChange: () => {},
});

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'login') {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/notion/callback') return res.end();
    try { await notion.finish(url.searchParams); res.end('connected'); console.log('CONNECTED', JSON.stringify(notion.status())); }
    catch (e) { res.end('failed ' + e.message); console.log('FAILED', e.message); }
    server.close();
  }).listen(47321, '127.0.0.1', async () => console.log('URL', (await notion.connect()).url));
} else if (cmd === 'tools') {
  for (const t of await notion.tools()) console.log(`## ${t.name}\n${t.description?.slice(0, 600)}\n${JSON.stringify(t.inputSchema).slice(0, 1500)}\n`);
} else if (cmd === 'call') {
  console.log(await notion.call(a, JSON.parse(b || '{}')));
}
