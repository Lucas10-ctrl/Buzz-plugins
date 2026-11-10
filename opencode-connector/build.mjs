// Builds plugin.js next to manifest.json, so this folder installs as it is.
import { readFileSync, writeFileSync } from "node:fs";

const acp = readFileSync(new URL("./acp.js", import.meta.url), "utf8").replace(/^export /gm, "");
const main = readFileSync(new URL("./src/main.js", import.meta.url), "utf8").replace(
  /^import \{[^}]+\} from "\.\.\/acp\.js";\n/m,
  "",
);
writeFileSync(
  new URL("./plugin.js", import.meta.url),
  `// Built by build.mjs from src/main.js and acp.js. Edit those, then run: node build.mjs\n${main}\n// ── ACP client ──\n${acp}`,
);
console.log("built plugin.js");
