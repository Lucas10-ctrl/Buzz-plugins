// Builds plugin.js next to manifest.json, so this folder installs as it is.
import { readFileSync, writeFileSync } from "node:fs";

const strip = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/^export /gm, "");
const acp = strip("./acp.js");
const nostr = strip("./nostr.js");
const main = readFileSync(new URL("./src/main.js", import.meta.url), "utf8").replace(
  /^import \{[^}]+\} from "\.\.\/(?:acp|nostr)\.js";\n/gm,
  "",
);
writeFileSync(
  new URL("./plugin.js", import.meta.url),
  `// Built by build.mjs from src/main.js, acp.js and nostr.js. Edit those, then run: node build.mjs\n${main}\n// ── ACP client ──\n${acp}\n// ── Nostr helpers ──\n${nostr}`,
);
console.log("built plugin.js");
