// Bundles src/ and CodeMirror into the single plugin.js Buzz loads.
// Run: npm install && npm run build
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.js"],
  outfile: "plugin.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  banner: {
    js: "// Local Files plugin for Buzz. Generated from src/ by build.mjs; edit src/ and run `npm run build`.\n// Bundles CodeMirror (MIT); see THIRD-PARTY-NOTICES.md.",
  },
});
