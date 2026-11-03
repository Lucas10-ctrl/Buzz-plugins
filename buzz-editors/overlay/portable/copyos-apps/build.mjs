import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('.', import.meta.url));
for (const args of [ ['../../node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.mts'], ['../../node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'] ]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(new URL('dist/copyos-apps.d.ts', import.meta.url), 'export * from "./types/copyos-apps/src/index";\n');
