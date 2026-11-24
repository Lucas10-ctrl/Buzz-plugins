// @ts-nocheck -- this tree ships no node_modules/@types; vitest transpiles
// this config, it is never type-checked here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest config for the web-clone browser-cleanup tests. They launch real
// headless Chrome and run /proc sweeps; under a full-suite load the
// throw-midway case can exceed vitest's default timeout, so the default run
// gets 60 s per test. Run from anywhere, e.g. with the Creative Studio
// checkout's vitest:
//   vitest run --config buzz-editors/overlay/vitest.config.mts
export default {
  test: {
    root: path.dirname(fileURLToPath(import.meta.url)),
    include: ['browser-host/editor-port/web-clone-*.test.mjs'],
    environment: 'node',
    testTimeout: 60_000,
  },
};
