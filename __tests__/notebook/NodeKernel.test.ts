import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotebookCell } from "vscode";
import { NodeKernel } from "../../src/notebook/NodeKernel";
import { initializeStorageTmpPath } from "../../src/utilities/fsUtil";

let scratchRoot: string;

beforeAll(async () => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "NodeKernel-test-"));
  await initializeStorageTmpPath(scratchRoot);
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

const makeCell = (text: string): NotebookCell =>
  ({
    document: {
      languageId: "javascript",
      getText: () => text,
    },
  } as unknown as NotebookCell);

describe("NodeKernel / variablesCell.replaceAllAt", () => {
  it("初回全置換: replaceAllAtFirst で _UpdateJSONCellValues に replaceAll:true のエントリが作られる", async () => {
    const kernel = await NodeKernel.create([]);
    const result = await kernel.run(makeCell("variablesCell.replaceAllAtFirst({ a: 1 });"));

    expect(result.stderr).not.toMatch(/ReferenceError/);
    expect(result.status).toBe("executed");
    expect(result.metadata?.updateJSONCellValues).toEqual([
      { cellIndex: 0, replaceAll: true, data: { a: 1 } },
    ]);
  }, 15000);

  it("既存の部分更新(setKeyValueAt)の後に全置換(replaceAllAt)すると内容が置き換わる", async () => {
    const kernel = await NodeKernel.create([]);
    const result = await kernel.run(
      makeCell("variablesCell.setKeyValueAt(0, 'x', 1); variablesCell.replaceAllAt(0, { b: 2 });")
    );

    expect(result.stderr).not.toMatch(/ReferenceError/);
    expect(result.status).toBe("executed");
    expect(result.metadata?.updateJSONCellValues).toEqual([
      { cellIndex: 0, replaceAll: true, data: { b: 2 } },
    ]);
  }, 15000);
});
