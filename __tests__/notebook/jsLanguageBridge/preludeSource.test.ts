import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { Uri } from "vscode";
import { initializeStoragePath } from "../../../src/utilities/fsUtil";
import {
  getEmbeddablePreludeText,
  PRELUDE_LINE_COUNT,
  RAW_PRELUDE_TEXT,
} from "../../../src/notebook/jsLanguageBridge/preludeSource";

beforeAll(() => {
  const fakeContext = {
    globalStorageUri: Uri.file("/tmp/db-notebook-test-storage"),
    asAbsolutePath: (relativePath: string) => path.join("/fake/extension/root", relativePath),
  } as unknown as ExtensionContext;
  initializeStoragePath(fakeContext);
});

describe("jsLanguageBridge/preludeSource", () => {
  it("bare specifierを絶対パスへ書き換えても行数が変わらない", () => {
    const rawLineCount = RAW_PRELUDE_TEXT.split(/\r\n|\r|\n/).length;

    expect(PRELUDE_LINE_COUNT).toBe(rawLineCount);
    expect(getEmbeddablePreludeText().split(/\r\n|\r|\n/).length).toBe(rawLineCount);
  });

  it("既知のbare specifierがすべて絶対パスへ置き換わる(jmespathは@types/jmespathへ)", () => {
    const embedded = getEmbeddablePreludeText();

    expect(embedded).not.toContain('"@l-v-yonsama/multi-platform-database-drivers"');
    expect(embedded).not.toContain('"@l-v-yonsama/rdh"');
    expect(embedded).not.toContain('"axios"');
    expect(embedded).not.toContain('"execa"');
    expect(embedded).not.toContain('"jmespath"');
    expect(embedded).toContain(path.join("/fake/extension/root", "node_modules", "@types/jmespath"));
  });
});
