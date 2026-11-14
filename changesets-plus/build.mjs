// Bundles src/index.ts into the single self-contained plugin.js Buzz loads.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "plugin.js",
  legalComments: "inline",
  banner: {
    js: "// Changesets Plus: built from src/ by `pnpm build`. Do not edit.\n// Includes code from block/buzz-app (Apache-2.0) and @noble/curves (MIT).",
  },
});
