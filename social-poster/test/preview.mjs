// Preview harness: shows the real plugin.js in a normal browser, talking to a
// real engine (demo data folder) through a tiny proxy, so the page can be
// screenshotted outside Buzz. Usage: node preview.mjs <demo-home> <port>
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [home, port = '47380'] = process.argv.slice(2);
const api = JSON.parse(readFileSync(join(home, 'api.json'), 'utf8'));
const pluginDir = new URL('../', import.meta.url).pathname;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Social Poster preview</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#1b1b1f;color:#e8e8ea}
.ui-card{background:#232328;border:1px solid #33333a}
button{background:#2d2d34;color:#e8e8ea;border:1px solid #44444c}
select option{background:#232328}
a{color:#8ab4ff}</style>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
</head><body><div id="root"></div>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script type="module">
const plugin = await import('/plugin.js');
let page; const listeners = [];
const host = { spawn: async (id, o) => {
  const proc = {
    write: async (line) => {
      const msg = JSON.parse(line);
      const r = await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method: msg.method, params: msg.params }) }).then(r => r.json());
      o.onStdout(JSON.stringify(r.error ? { id: msg.id, error: r.error } : { id: msg.id, result: r.result }) + '\\n');
    },
    kill: async () => {}, end: async () => {}, exited: new Promise(() => {}),
  };
  setTimeout(() => o.onStdout(JSON.stringify({ event: 'ready' }) + '\\n'), 50);
  return proc;
}};
plugin.apply({ react: React, pages: { register: p => page = p }, host, agents: { addTool(){} }, effect: f => f(), reflect: { get: () => undefined } });
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(page.component));
window.__tab = (label) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click();
</script></body></html>`;

http.createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }), res.end(html);
  if (req.url === '/plugin.js') return res.writeHead(200, { 'content-type': 'text/javascript' }), res.end(readFileSync(join(pluginDir, 'plugin.js')));
  if (req.url === '/rpc') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await fetch(`${api.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
    return res.writeHead(200, { 'content-type': 'application/json' }), res.end(await r.text());
  }
  res.writeHead(404).end();
}).listen(Number(port), '127.0.0.1', () => console.log(`preview on http://127.0.0.1:${port}`));
