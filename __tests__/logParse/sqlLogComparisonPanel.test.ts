import { env, Memento, RelativePattern, Uri, window, workspace } from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_NAME } from "../../src/constant";
import { SqlLogComparisonPanel } from "../../src/panels/SqlLogComparisonPanel";
import { runSqlLogComparison } from "../../src/utilities/sqlLogComparison/runComparison";

vi.mock("../../src/utilities/sqlLogComparison/runComparison", () => ({
  runSqlLogComparison: vi.fn(async () => ({ summary: { formattedMatched: 1, equivalentMatched: 0, unmatched: 0, skipped: 0 } })),
  SqlLogComparisonCancelled: class extends Error {},
}));

const historyKey = `${EXTENSION_NAME}-sql-log-parser-config-history`;
const equivalenceOptionsKey = `${EXTENSION_NAME}-sql-log-comparison-equivalence-options`;
const savedState = new Map<string, unknown>();
const storage = {
  get: vi.fn((key: string, fallback: unknown) => savedState.get(key) ?? fallback),
  update: vi.fn(async (key: string, value: unknown) => { savedState.set(key, value); }),
} as unknown as Memento;

function currentPanel() { return vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value; }
function posted(type: string) {
  return currentPanel().webview.postMessage.mock.calls.map((call: unknown[]) => call[0]).filter((message: any) => message.value?.type === type);
}
async function send(message: unknown) {
  const listener = currentPanel().webview.onDidReceiveMessage.mock.calls[0][0];
  await listener(message);
}

beforeEach(() => {
  vi.clearAllMocks();
  savedState.clear();
  vi.mocked(workspace.findFiles).mockResolvedValue([]);
  workspace.workspaceFolders = [{ uri: Uri.file("/workspace"), name: "workspace", index: 0 }];
});
afterEach(() => {
  workspace.workspaceFolders = undefined;
  const panel = vi.mocked(window.createWebviewPanel).mock.results.at(-1)?.value;
  panel?.onDidDispose.mock.calls[0]?.[0]();
});

describe("SQL log comparison panel", () => {
  it("opens the shared webview and defaults output to the before log folder", async () => {
    const before = Uri.file("/workspace/logs/old.log");
    const after = Uri.file("/workspace/logs/new.log");
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, before, [before, after]);
    await send({ command: "ready" });
    expect(currentPanel().webview.html).toContain("SqlLogComparisonPanel");
    expect(posted("files").at(-1)).toMatchObject({ value: { paths: {
      beforeFile: before.fsPath, afterFile: after.fsPath, outputDirectory: "/workspace/logs",
    } } });
    expect(workspace.findFiles).toHaveBeenCalledWith(expect.objectContaining({ pattern: "*/*/*.log-parser.config.json" }) as RelativePattern, expect.any(String));
    expect(window.showQuickPick).not.toHaveBeenCalled();
  });

  it("previews the actual equivalence result as options change", async () => {
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage);
    await send({ command: "ready" });
    expect(posted("preview").at(-1)).toMatchObject({ value: { revision: 0, preview: { status: "DIFF" } } });
    expect(posted("preview").at(-1).value.preview.diffText).toMatch(/[+-]/);

    await send({ command: "preview", revision: 1, options: { dialect: "mysql", equivalence: {
      ignoreIdentifierCase: true,
      ignoreSingleTableAlias: true,
      ignoreOrdinaryComments: true,
      ignoreOptimizerHints: true,
      normalizeDateFunctions: true,
      ignoreDateTimeLiteralValues: false,
      removeRedundantWhereParentheses: true,
    } } });
    const update = posted("preview").at(-1).value;
    expect(update.revision).toBe(1);
    expect(update.preview.status).toBe("DIFF");

    await send({ command: "preview", revision: 2, options: { dialect: "mysql", equivalence: {
      ignoreIdentifierCase: true,
      ignoreSingleTableAlias: true,
      ignoreOrdinaryComments: true,
      ignoreOptimizerHints: true,
      normalizeDateFunctions: true,
      ignoreDateTimeLiteralValues: true,
      removeRedundantWhereParentheses: true,
    } } });
    const matched = posted("preview").at(-1).value;
    expect(matched.revision).toBe(2);
    expect(matched.preview.status).toBe("EQUIVALENT_MATCH");
    expect(matched.preview.beforeSql).toBe(matched.preview.afterSql);
    expect(matched.preview.diffText).toBeUndefined();
  });

  it.each(["sqlite", "plsql"] as const)("previews %s with its selected dialect", async (dialect) => {
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage);
    await send({ command: "preview", revision: 1, options: { dialect, equivalence: {
      ignoreIdentifierCase: true,
      ignoreSingleTableAlias: true,
      ignoreOrdinaryComments: true,
      ignoreOptimizerHints: true,
      normalizeDateFunctions: true,
      ignoreDateTimeLiteralValues: true,
      removeRedundantWhereParentheses: true,
    } } });
    expect(posted("preview").at(-1)).toMatchObject({ value: { revision: 1, preview: { status: "EQUIVALENT_MATCH" } } });
  });

  it("restores saved equivalence checkboxes when the panel opens again", async () => {
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage);
    await send({ command: "ready" });
    expect(posted("equivalenceOptions").at(-1).value.equivalence).toBeUndefined();
    expect(savedState.has(equivalenceOptionsKey)).toBe(false);

    const equivalence = {
      ignoreIdentifierCase: true,
      ignoreSingleTableAlias: true,
      ignoreOrdinaryComments: true,
      ignoreOptimizerHints: true,
      normalizeDateFunctions: true,
      ignoreDateTimeLiteralValues: true,
      removeRedundantWhereParentheses: true,
    };
    await send({ command: "preview", revision: 1, options: { dialect: "mysql", equivalence } });
    expect(savedState.get(equivalenceOptionsKey)).toEqual(equivalence);
    currentPanel().onDidDispose.mock.calls[0][0]();

    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage);
    await send({ command: "ready" });
    expect(posted("equivalenceOptions").at(-1).value.equivalence).toEqual(equivalence);
    expect(posted("preview").at(-1)).toMatchObject({ value: { revision: 0, preview: { status: "EQUIVALENT_MATCH" } } });
  });

  it("swaps the logs and follows the new before folder until output is chosen", async () => {
    const before = Uri.file("/workspace/old/old.log");
    const after = Uri.file("/workspace/new/new.log");
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, undefined, [before, after]);
    await send({ command: "swap" });
    expect(posted("files").at(-1)).toMatchObject({ value: { paths: {
      beforeFile: after.fsPath, afterFile: before.fsPath, outputDirectory: "/workspace/new",
    } } });
  });

  it("offers shallow project parser configs and runs from the selected output folder", async () => {
    const before = Uri.file("/workspace/old.log");
    const after = Uri.file("/workspace/new.log");
    const beforeParser = Uri.file("/workspace/old.log-parser.config.json");
    const afterParser = Uri.file("/workspace/settings/new.log-parser.config.json");
    vi.mocked(workspace.findFiles).mockResolvedValue([beforeParser, afterParser]);
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, undefined, [before, after]);
    await send({ command: "ready" });
    expect(posted("parserChoices").at(-1)).toMatchObject({ value: { choices: [
      { value: beforeParser.toString() }, { value: afterParser.toString() },
    ] } });
    await send({ command: "selectParserConfig", field: "beforeParserConfigFile", uri: beforeParser.toString() });
    await send({ command: "selectParserConfig", field: "afterParserConfigFile", uri: afterParser.toString() });
    await send({ command: "run", options: { dialect: "mysql", equivalence: { normalizeDateFunctions: false, removeRedundantWhereParentheses: true } } });
    expect(runSqlLogComparison).toHaveBeenCalledWith(expect.objectContaining({
      beforeFile: before,
      afterFile: after,
      outputFile: expect.objectContaining({ fsPath: expect.stringMatching(/^\/workspace\/sql-log-comparison-.*\.xlsx$/) }),
      settings: { beforeParserConfigFile: beforeParser, afterParserConfigFile: afterParser, dialect: "mysql", equivalence: { normalizeDateFunctions: false, removeRedundantWhereParentheses: true } },
    }));
    expect(posted("reportReady").at(-1)).toMatchObject({ value: { ready: true } });
    await send({ command: "openReport" });
    expect(env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: expect.stringMatching(/\.xlsx$/) }));
    await send({ command: "preview", revision: 2, options: { dialect: "mysql", equivalence: { normalizeDateFunctions: true } } });
    expect(posted("reportReady").at(-1)).toMatchObject({ value: { ready: false } });
    await send({ command: "openReport" });
    expect(env.openExternal).toHaveBeenCalledTimes(1);
  });

  it("selects an output folder and keeps Open Report disabled after a failed run", async () => {
    const before = Uri.file("/workspace/old.log");
    const after = Uri.file("/workspace/new.log");
    const parser = Uri.file("/workspace/parser.log-parser.config.json");
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, undefined, [before, after]);
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([parser]).mockResolvedValueOnce([parser]).mockResolvedValueOnce([Uri.file("/reports")]);
    await send({ command: "pick", field: "beforeParserConfigFile" });
    await send({ command: "pick", field: "afterParserConfigFile" });
    await send({ command: "pick", field: "outputDirectory" });
    expect(window.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ canSelectFiles: false, canSelectFolders: true }));
    vi.mocked(runSqlLogComparison).mockRejectedValueOnce(new Error("save failed"));
    await send({ command: "run", options: { dialect: "mysql" } });
    expect(posted("status").at(-1)).toMatchObject({ value: { kind: "error", message: "save failed" } });
    expect(posted("reportReady").at(-1)).toMatchObject({ value: { ready: false } });
    expect(savedState.has(historyKey)).toBe(false);
  });

  it("restores each log's last parser config when the panel opens again", async () => {
    const before = Uri.file("/workspace/old.log");
    const after = Uri.file("/workspace/new.log");
    const beforeParser = Uri.file("/external/old.log-parser.config.json");
    const afterParser = Uri.file("/external/new.log-parser.config.json");
    savedState.set(historyKey, [
      [before.fsPath, beforeParser.fsPath],
      [after.fsPath, afterParser.fsPath],
    ]);

    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, undefined, [before, after]);
    await send({ command: "ready" });
    expect(posted("files").at(-1)).toMatchObject({ value: { paths: {
      beforeParserConfigFile: beforeParser.fsPath,
      afterParserConfigFile: afterParser.fsPath,
    } } });
    expect(posted("parserChoices").at(-1)).toMatchObject({ value: { choices: [
      { value: beforeParser.toString() }, { value: afterParser.toString() },
    ] } });

    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([Uri.file("/workspace/other.log")]);
    await send({ command: "pick", field: "beforeFile" });
    expect(posted("files").at(-1).value.paths.beforeParserConfigFile).toBeUndefined();

    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([before]);
    await send({ command: "pick", field: "beforeFile" });
    expect(posted("files").at(-1).value.paths.beforeParserConfigFile).toBe(beforeParser.fsPath);
    expect(posted("parserChoices").at(-1).value.choices).toContainEqual(expect.objectContaining({ value: beforeParser.toString() }));
  });

  it("keeps the most recently parsed 50 log/config pairs", async () => {
    savedState.set(historyKey, Array.from({ length: 50 }, (_, index) => [
      `/workspace/log${index}.log`, `/workspace/config${index}.json`,
    ]));
    const before = Uri.file("/workspace/log0.log");
    const after = Uri.file("/workspace/new.log");
    const afterParser = Uri.file("/workspace/new.json");
    SqlLogComparisonPanel.show(Uri.file("/extension"), "4.0.0", storage, undefined, [before, after]);
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([afterParser]);
    await send({ command: "pick", field: "afterParserConfigFile" });
    await send({ command: "run", options: { dialect: "mysql" } });

    const history = savedState.get(historyKey) as [string, string][];
    expect(history).toHaveLength(50);
    expect(history.some(([logPath]) => logPath === "/workspace/log1.log")).toBe(false);
    expect(history.at(-2)).toEqual([before.fsPath, "/workspace/config0.json"]);
    expect(history.at(-1)).toEqual([after.fsPath, afterParser.fsPath]);
  });
});
