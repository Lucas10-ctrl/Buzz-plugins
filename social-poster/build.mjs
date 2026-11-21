#!/usr/bin/env node
// Builds Social Poster on this computer:
//   1. vendor/postiz-app  — Postiz source at a pinned commit, with patches/ applied
//   2. engine/dist/providers.cjs — Postiz's connectors, bundled
//   3. ~/.local/bin/social-poster-engine and ~/.local/bin/social-poster — launchers
// The plugin itself (manifest.json, plugin.js) needs no build.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const engine = join(root, 'engine');
const postiz = join(root, 'vendor', 'postiz-app');
const POSTIZ_REPO = 'https://github.com/gitroomhq/postiz-app.git';
const POSTIZ_COMMIT = '6be4874631fea453f99115a78fd543c71820ab45';
const node = process.execPath;

// Buzz on Linux is an AppImage whose LD_LIBRARY_PATH breaks git and curl.
const env = { ...process.env };
delete env.LD_LIBRARY_PATH;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });

// 1. Postiz source
if (!existsSync(join(postiz, '.git'))) {
  mkdirSync(postiz, { recursive: true });
  run('git', ['init', '-q'], postiz);
  run('git', ['remote', 'add', 'origin', POSTIZ_REPO], postiz);
}
let head = '';
try {
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: postiz, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}
if (head !== POSTIZ_COMMIT) {
  console.log(`fetching Postiz ${POSTIZ_COMMIT.slice(0, 7)}…`);
  run('git', ['fetch', '-q', '--depth', '1', 'origin', POSTIZ_COMMIT], postiz);
  run('git', ['checkout', '-q', '--force', POSTIZ_COMMIT], postiz);
}
run('git', ['checkout', '-q', '--', '.'], postiz); // drop earlier patch results
for (const patch of readdirSync(join(root, 'patches')).filter((f) => f.endsWith('.patch')).sort()) {
  run('git', ['apply', join(root, 'patches', patch)], postiz);
  console.log(`applied patches/${patch}`);
}

// 2. Connectors
if (!existsSync(join(engine, 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], engine);
run(join(engine, 'node_modules', '.bin', 'esbuild'), [
  join(engine, 'providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--packages=external',
  `--tsconfig=${join(postiz, 'tsconfig.base.json')}`,
  `--outfile=${join(engine, 'dist', 'providers.cjs')}`,
  '--log-level=warning',
], postiz);
console.log('built engine/dist/providers.cjs');

// 3. Launchers. They drop Buzz's LD_LIBRARY_PATH (it breaks native modules and
// xdg-open) and name Node by absolute path, because Buzz's PATH may not
// include version-manager shims.
const bin = join(homedir(), '.local', 'bin');
mkdirSync(bin, { recursive: true });
for (const [name, target] of [
  ['social-poster-engine', join(engine, 'main.cjs')],
  ['social-poster', join(root, 'cli', 'social-poster.cjs')],
]) {
  writeFileSync(join(bin, name), `#!/bin/sh\n# Social Poster launcher, written by ${join(root, 'build.mjs')}\nunset LD_LIBRARY_PATH\nexec "${node}" "${target}" "$@"\n`);
  chmodSync(join(bin, name), 0o755);
  console.log(`installed ${join(bin, name)}`);
}
// 4. Posting while Buzz is closed (Linux): a systemd user timer runs
// `social-poster-engine --once` every 2 minutes. It exits at once when Buzz's
// engine is running or nothing is due.
if (process.platform === 'linux') {
  const units = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'social-poster.service'), `[Unit]\nDescription=Social Poster: publish posts that are due\n\n[Service]\nType=oneshot\nExecStart=${join(bin, 'social-poster-engine')} --once\n`);
  writeFileSync(join(units, 'social-poster.timer'), `[Unit]\nDescription=Social Poster: publish due posts while Buzz is closed\n\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=2min\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
  console.log(`wrote ${units}/social-poster.{service,timer}; turn it on with: systemctl --user enable --now social-poster.timer`);
}
console.log(`\nDone. In Buzz: Settings → Plugins → Manage plugins → Add → Browse → ${root}`);
