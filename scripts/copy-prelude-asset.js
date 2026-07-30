// tsc emits nothing for a .d.ts-only file, so the JS runtime that reads the prelude as
// text (src/notebook/jsLanguageBridge/preludeSource.ts) needs a plain-text copy in out/.
// The copy is named .txt (not .ts/.d.ts) so .vscodeignore's blanket "**/*.ts" exclusion
// doesn't strip it from the packaged VSIX.
const fs = require("fs");
const path = require("path");

const src = path.join(
  __dirname,
  "..",
  "src",
  "notebook",
  "jsLanguageBridge",
  "jsRuntimePrelude.d.ts"
);
const destDir = path.join(__dirname, "..", "out", "notebook", "jsLanguageBridge");
const dest = path.join(destDir, "jsRuntimePrelude.txt");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
