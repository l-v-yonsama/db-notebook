import * as fs from "fs";
import * as path from "path";
import { getNodeModulePath } from "../../utilities/fsUtil";

// compile copies jsRuntimePrelude.d.ts next to this file as a .txt asset (see
// scripts/copy-prelude-asset.js) since tsc emits nothing for a .d.ts-only source. Vitest
// runs straight from src/ (no compile/copy step), where only the .d.ts exists -- so fall
// back to reading that directly when the copied .txt isn't there.
const resolvePreludeAssetPath = (): string => {
  for (const name of ["jsRuntimePrelude.txt", "jsRuntimePrelude.d.ts"]) {
    const candidate = path.join(__dirname, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`jsRuntimePrelude asset not found next to ${__dirname}`);
};

export const RAW_PRELUDE_TEXT = fs.readFileSync(resolvePreludeAssetPath(), { encoding: "utf8" });

export const PRELUDE_LINE_COUNT = RAW_PRELUDE_TEXT.split(/\r\n|\r|\n/).length;

// The prelude is authored with normal bare specifiers so it type-checks on its own
// against this extension's real node_modules (see tsconfig.prelude.json). But once its
// text is embedded into a virtual, schemeless document, there's no directory for the
// built-in TS server to resolve bare specifiers from. Rewriting to absolute paths avoids
// that ambiguity. jmespath itself ships no types, so it redirects to @types/jmespath.
const SPECIFIER_REWRITES: ReadonlyArray<{ specifier: string; moduleDir: string }> = [
  {
    specifier: "@l-v-yonsama/multi-platform-database-drivers",
    moduleDir: "@l-v-yonsama/multi-platform-database-drivers",
  },
  { specifier: "@l-v-yonsama/rdh", moduleDir: "@l-v-yonsama/rdh" },
  { specifier: "axios", moduleDir: "axios" },
  { specifier: "execa", moduleDir: "execa" },
  { specifier: "jmespath", moduleDir: "@types/jmespath" },
];

export const getEmbeddablePreludeText = (): string => {
  let text = RAW_PRELUDE_TEXT;
  for (const { specifier, moduleDir } of SPECIFIER_REWRITES) {
    const quotedSpecifier = `"${specifier}"`;
    const quotedAbsolutePath = `"${getNodeModulePath(moduleDir)}"`;
    text = text.split(quotedSpecifier).join(quotedAbsolutePath);
  }
  return text;
};
