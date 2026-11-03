import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("bundles host and retained editors against one production React instance", async () => {
  const roots = new Set();
  await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    mode: "production",
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: { write: false, reportCompressedSize: false },
    plugins: [
      {
        name: "observe-production-react-instances",
        generateBundle() {
          for (const id of this.getModuleIds()) {
            const match = id
              .replaceAll("\\", "/")
              .match(
                /^(.*\/node_modules\/react)\/(?:index\.js|cjs\/react\.[^/]+\.js)$/u,
              );
            if (match) roots.add(match[1]);
          }
        },
      },
    ],
  });
  expect(
    [...roots],
    "React hooks and the host renderer must share one dispatcher",
  ).toHaveLength(1);
}, 30_000);
