// Public links for media. Instagram, Facebook, Threads, Pinterest, TikTok
// photos and a few others download pictures themselves, so a file that is only
// on this computer needs a public https address. When such a post is due and a
// file has no public copy, the engine opens a Cloudflare quick tunnel
// (cloudflared, downloaded once) to its own web server. Through the tunnel the
// server answers only /uploads/<random file name>; everything else is refused.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RELEASE = {
  'linux-x64': 'cloudflared-linux-amd64',
  'linux-arm64': 'cloudflared-linux-arm64',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
};

function createTunnel({ home, port, log }) {
  let proc = null;
  let url = null;
  let starting = null;

  function binary() {
    const onPath = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'cloudflared')).find((f) => fs.existsSync(f));
    return onPath || path.join(home, 'bin', 'cloudflared');
  }

  async function download(target) {
    const asset = RELEASE[`${process.platform}-${process.arch}`];
    if (!asset || asset.endsWith('.tgz')) throw new Error('Install cloudflared (brew install cloudflared) so Social Poster can share media with Instagram and similar networks.');
    log('downloading cloudflared…');
    const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Could not download cloudflared (${res.status})`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  }

  async function start() {
    const bin = binary();
    if (!fs.existsSync(bin)) await download(bin);
    const env = { ...process.env };
    delete env.LD_LIBRARY_PATH;
    proc = spawn(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const found = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('The public media link did not start in time')), 45_000);
      const onData = (d) => {
        buf += d;
        const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) { clearTimeout(timer); resolve(m[0]); }
      };
      proc.stdout.setEncoding('utf8').on('data', onData);
      proc.stderr.setEncoding('utf8').on('data', onData);
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`cloudflared stopped (${code})`)); });
    });
    proc.on('exit', () => { proc = null; url = null; });
    // The name takes a few seconds to resolve worldwide; wait until it answers.
    for (let i = 0; i < 30; i++) {
      const ok = await fetch(`${found}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    url = found;
    log(`public media link: ${url}`);
    return url;
  }

  return {
    /** The public https base for /uploads, starting the tunnel if needed. */
    async base() {
      if (url) return url;
      starting ??= start().finally(() => { starting = null; });
      return starting;
    },
    current: () => url,
    stop() { proc?.kill(); proc = null; url = null; },
  };
}

module.exports = { createTunnel };
