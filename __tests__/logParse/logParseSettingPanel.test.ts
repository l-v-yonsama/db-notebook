import {
  LOG_EVENT_SPLIT_PRESETS,
  LogParser,
  SQL_LOG_PARSE_PRESETS,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, Uri, window, workspace, type WebviewPanel } from "vscode";
import { LogParseSettingPanel } from "../../src/panels/LogParseSettingPanel";
import type { SaveLogOptionParams } from "../../src/shared/ActionParams";
import { readResource, writeToResource } from "../../src/utilities/fsUtil";
import type { LogParseSettingPanelEventData } from "../../src/shared/MessageEventData";

vi.mock("../../src/panels/BasePanel", () => ({
  BasePanel: class {
    constructor(protected panel: WebviewPanel) {}
  },
}));
vi.mock("../../src/utilities/fsUtil", () => ({
  existsFileOnWorkspace: vi.fn(async () => true),
  readResource: vi.fn(async () =>
    [
      "2026-03-12 10:11:22 INFO com.example.Service - Application started",
      "2026-03-12 10:11:23 missing required fields",
    ].join("\n")
  ),
  writeToResource: vi.fn(),
  getIconPath: vi.fn(),
}));
vi.mock("vscode", async (importOriginal) => {
  const vscode = await importOriginal<typeof import("vscode")>();
  return {
    ...vscode,
    WorkspaceEdit: class extends vscode.WorkspaceEdit {
      replace(uri: Uri, range: unknown, newText: string) {
        this.set(uri, [{ range, newText }] as never);
      }
    },
    window: {
      ...vscode.window,
      visibleTextEditors: [],
      onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose() {} })),
      showSaveDialog: vi.fn(async () => undefined),
    },
    workspace: {
      ...vscode.workspace,
      onDidChangeTextDocument: vi.fn(() => ({ dispose() {} })),
      onDidSaveTextDocument: vi.fn(() => ({ dispose() {} })),
      textDocuments: [],
      findFiles: vi.fn(async () => [vscode.Uri.file("/workspace/test.log-parser.config.json")]),
      openTextDocument: vi.fn(),
    },
  };
});

const config = {
  split: LOG_EVENT_SPLIT_PRESETS.Simple.split,
  ...SQL_LOG_PARSE_PRESETS.MyBatis,
};
let configText: string;
let panel: LogParseSettingPanel;
let messages: LogParseSettingPanelEventData[];
let operationId: number;
let save: ReturnType<typeof vi.fn>;

const flushPreview = async () => {
  while (panel["previewTask"]) {
    await panel["previewTask"];
  }
};
const documentChanged = () => {
  const listener = vi.mocked(workspace.onDidChangeTextDocument).mock.calls.at(-1)![0];
  listener({ document: panel["logParserConfigDoc"] } as never);
};

const send = async (
  action: SaveLogOptionParams["action"],
  extra: Partial<SaveLogOptionParams> = {}
) => {
  await panel["recieveMessageFromWebview"]({
    command: "ok",
    params: { action, operationId: ++operationId, ...extra },
  });
  await flushPreview();
};
const lastWorkflow = () =>
  messages.filter((message) => message.command === "reset-config").at(-1)!.value["reset-config"]!
    .workflow;
const lastCompletion = () =>
  messages.filter((message) => message.command === "operation-completed").at(-1)!.value[
    "operation-completed"
  ]!;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  operationId = 0;
  configText = JSON.stringify(config);
  messages = [];
  workspace.workspaceFolders = [{ uri: Uri.file("/workspace"), name: "test", index: 0 }];
  save = vi.fn(async () => true);
  vi.mocked(workspace.openTextDocument).mockResolvedValue({
    isDirty: true,
    save,
    uri: Uri.file("/workspace/test.log-parser.config.json"),
    getText: () => configText,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  } as never);
  LogParseSettingPanel.revive(
    {
      webview: {
        postMessage: async (message: LogParseSettingPanelEventData) => {
          messages.push(message);
          return true;
        },
      },
    } as WebviewPanel,
    Uri.file("/extension")
  );
  panel = LogParseSettingPanel.currentPanel!;
  panel["logFileUri"] = Uri.file("/workspace/application.log");
  await panel.initialize();
  vi.mocked(commands.executeCommand).mockClear();
});

afterEach(() => {
  panel.preDispose();
  vi.useRealTimers();
});

describe("Automatic log previews", () => {
  it.each([
    [499, -1],
    [500, -1],
    [501, 500],
  ])("initializes a %i-line log with sample limit %i", async (total, expectedLimit) => {
    vi.mocked(readResource).mockResolvedValueOnce(
      Array(total)
        .fill("2026-03-12 10:11:22 INFO com.example.Service - Application started")
        .join("\n")
    );
    await panel.initialize();
    const initial = messages.filter((message) => message.command === "initialize").at(-1)!.value
      .initialize!;
    expect(initial.totalLogLines).toBe(total);
    expect(initial.linesToParse).toBe(expectedLimit);
    expect(initial.workflow.setup?.sampleLinesToParse).toBe(expectedLimit);
    expect(initial.workflow.rawPreview?.rows).toHaveLength(Math.min(total, 500));
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ linesToParse: expectedLimit }));
  });

  it("previews a selected config once without saving or opening the result view", async () => {
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ stage: "sqlExecution" }));
    expect(lastWorkflow()).toMatchObject({
      previewStatus: "ready",
      configuration: { availableStage: "sqlExecution", canParse: true },
      setup: { sql: { result: { sqlCount: 0 }, classifiedPreview: { rows: expect.any(Array) } } },
    });
    expect(lastWorkflow().setup?.sql?.classifiedPreview?.rows).toHaveLength(1);
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(parse).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it.each([
    [{ split: { fields: [] }, classify: [], extractors: [] }, undefined],
    [{ split: config.split, classify: [], extractors: [] }, "split"],
    [{ ...config, extractors: [] }, "classify"],
    [config, "sqlExecution"],
    [{ ...config, classify: [null], extractors: [null] }, "split"],
    [{ ...config, extractors: [null] }, "classify"],
  ] as const)("runs only the available stage for %j", async (value, stage) => {
    configText = JSON.stringify(value);
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(lastWorkflow().configuration.availableStage).toBe(stage);
    if (stage) {
      expect(parse).toHaveBeenCalledOnce();
      expect(parse).toHaveBeenCalledWith(expect.objectContaining({ stage }));
      expect(lastWorkflow().previewStatus).toBe("ready");
      const sample =
        stage === "sqlExecution" ? lastWorkflow().setup?.sql : lastWorkflow().setup?.split;
      expect(sample?.result).toMatchObject({ status: "success", stage });
      if (stage === "classify") {
        expect(sample?.classifiedPreview?.keys.some((k) => k.name === "eventType")).toBe(true);
      }
    } else {
      expect(parse).not.toHaveBeenCalled();
    }
    expect(JSON.parse(configText)).toEqual(value);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("debounces editing, preserves previous results while pending, and recovers from invalid JSON", async () => {
    vi.useFakeTimers();
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    const previous = lastWorkflow().setup?.sql?.preview;
    const parse = vi.spyOn(LogParser.prototype, "parse");
    const edited = structuredClone(config);
    edited.extractors[0].name = "first";
    configText = JSON.stringify(edited);
    documentChanged();
    expect(lastWorkflow()).toMatchObject({
      previewStatus: "waiting",
      configuration: { canParse: true },
    });
    expect(lastWorkflow().setup?.sql?.preview).toEqual(previous);
    await vi.advanceTimersByTimeAsync(800);
    edited.extractors[0].name = "second";
    configText = JSON.stringify(edited);
    documentChanged();
    await vi.advanceTimersByTimeAsync(999);
    expect(parse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushPreview();
    expect(parse).toHaveBeenCalledOnce();
    expect(lastWorkflow().previewStatus).toBe("ready");
    configText = "{";
    documentChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastWorkflow().configuration.canParse).toBe(false);
    expect(parse).toHaveBeenCalledOnce();
    configText = JSON.stringify(config);
    documentChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastWorkflow().configuration.canParse).toBe(true);
    expect(lastWorkflow().setup?.sql?.preview).toBeDefined();
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not reparse formatting-only edits or saves, and cancels timers on close", async () => {
    vi.useFakeTimers();
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    const parse = vi.spyOn(LogParser.prototype, "parse");
    configText = JSON.stringify(config, null, 2);
    documentChanged();
    await send("save-config");
    await vi.advanceTimersByTimeAsync(1000);
    expect(parse).not.toHaveBeenCalled();
    configText = JSON.stringify({ ...config, extractors: [] });
    documentChanged();
    panel.preDispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(parse).not.toHaveBeenCalled();
  });

  it("regenerates an invalidated cached result when the same config becomes valid again", async () => {
    vi.useFakeTimers();
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    const parse = vi.spyOn(LogParser.prototype, "parse");
    configText = "{";
    documentChanged();
    configText = JSON.stringify(config);
    documentChanged();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPreview();
    expect(lastWorkflow().setup?.sql?.preview).toBeDefined();
    expect(lastWorkflow().previewStatus).toBe("ready");
    expect(parse).toHaveBeenCalledOnce();
  });

  it("coalesces document changes from Apply and executes the final available stage once", async () => {
    vi.useFakeTimers();
    configText = JSON.stringify({ ...config, split: { fields: [] } });
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    vi.mocked(workspace.applyEdit).mockImplementationOnce(async (edit) => {
      configText = edit.get(Uri.file("/workspace/test.log-parser.config.json"))[0].newText;
      documentChanged();
      return true;
    });
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("apply-log-event-split-preset", { presetName: "Simple" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ stage: "sqlExecution" }));
    expect(lastWorkflow().previewStatus).toBe("ready");
  });

  it("does not preview after an unsuccessful preset edit", async () => {
    configText = JSON.stringify({ split: { fields: [] }, classify: [], extractors: [] });
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    vi.mocked(workspace.applyEdit).mockResolvedValueOnce(false);
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("apply-log-event-split-preset", { presetName: "Simple" });
    expect(parse).not.toHaveBeenCalled();
    expect(lastCompletion().error).toContain("Could not apply");
  });

  it("keeps only the latest preview when settings change during a run", async () => {
    const original = LogParser.prototype.parse;
    let release!: () => void;
    const parse = vi.spyOn(LogParser.prototype, "parse").mockImplementationOnce(function (params) {
      const result = original.call(this, params);
      return new Promise((resolve) => {
        release = () => resolve(result);
      }) as never;
    });
    await panel["recieveMessageFromWebview"]({
      command: "ok",
      params: { action: "set-config-file", logParserConfigFile: "test.log-parser.config.json" },
    });
    await Promise.resolve();
    expect(lastWorkflow().previewStatus).toBe("running");
    await panel["recieveMessageFromWebview"]({
      command: "ok",
      params: { action: "reset-sample-lines", linesToParse: 1 },
    });
    release();
    await flushPreview();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(lastWorkflow().setup?.sql?.result.linesToParse).toBe(1);
    const successful = messages.flatMap((m) => m.value["reset-config"]?.workflow.setup?.sql ?? []);
    expect(successful.every((s) => s.result.linesToParse === 1)).toBe(true);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("reports preview failures without retry loops, then retries on changed input", async () => {
    vi.useFakeTimers();
    const parse = vi.spyOn(LogParser.prototype, "parse").mockImplementationOnce(() => {
      throw new Error("Preview failed");
    });
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(lastWorkflow()).toMatchObject({
      previewStatus: "failed",
      previewError: "Preview failed",
      configuration: { canParse: true },
    });
    expect(lastCompletion().error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(parse).toHaveBeenCalledOnce();
    await send("reset-sample-lines", { linesToParse: 1 });
    expect(lastWorkflow().previewStatus).toBe("ready");
    expect(lastWorkflow().previewError).toBeUndefined();
  });

  it("updates sample and formatter previews without changing parse eligibility", async () => {
    panel["rawText"] = Array.from({ length: 12 }, () =>
      [
        "2026-03-12 10:11:22 DEBUG com.example.Mapper.findOrders - ==> Preparing: select id from orders where id = ?",
        "2026-03-12 10:11:22 DEBUG com.example.Mapper.findOrders - ==> Parameters: 1(Integer)",
        "2026-03-12 10:11:22 DEBUG com.example.Mapper.findOrders - <== Total: 1",
      ].join("\n")
    ).join("\n");
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(lastWorkflow().setup?.sql?.preview?.rows).toHaveLength(12);
    expect(lastWorkflow().setup?.sql?.classifiedPreview?.rows).toHaveLength(36);
    const payload = messages.filter((m) => m.command === "reset-config").at(-1)!.value[
      "reset-config"
    ]!;
    expect(payload.preset.sqlParseDetectionMessage).toContain("MyBatis");
    await send("reset-sample-lines", { linesToParse: 15 });
    expect(lastWorkflow().rawPreview?.rows).toHaveLength(15);
    expect(lastWorkflow().setup?.sql?.preview?.rows).toHaveLength(5);
    await send("reset-formatter-sql-language", { sqlLanguage: "mysql" });
    expect(lastWorkflow().configuration.canParse).toBe(true);
    expect(lastWorkflow().setup?.sql?.preview?.rows).toHaveLength(5);
    await send("parse", { linesToParse: -1 });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        extractedSqlResult: expect.objectContaining({
          sqlExecutions: expect.objectContaining({ length: 12 }),
        }),
      })
    );
  });

  it("prioritizes all-log parsing over a pending preview, without requiring sample confirmation", async () => {
    vi.useFakeTimers();
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    configText = JSON.stringify({
      ...config,
      extractors: config.extractors.map((e, i) => ({ ...e, name: `edited-${i}` })),
    });
    documentChanged();
    const parse = vi.spyOn(LogParser.prototype, "parse");
    await send("parse", { linesToParse: -1 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "sqlExecution", linesToParse: -1 })
    );
    expect(lastCompletion().error).toBeUndefined();
    expect(commands.executeCommand).toHaveBeenCalledOnce();
  });

  it("saves only on request and parses unsaved changes without saving", async () => {
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    const parse = vi.spyOn(LogParser.prototype, "parse");
    save.mockResolvedValueOnce(false);
    await send("save-config");
    expect(lastCompletion().error).toContain("save");
    expect(parse).not.toHaveBeenCalled();
    expect(commands.executeCommand).not.toHaveBeenCalled();
    await send("save-config");
    expect(lastCompletion().error).toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
    save.mockClear();
    const edited = structuredClone(config);
    edited.extractors[0].name = "unsaved-extractor";
    configText = JSON.stringify(edited);
    await send("parse", { linesToParse: -1 });
    expect(lastCompletion().error).toBeUndefined();
    expect(parse).toHaveBeenCalledOnce();
    expect(parse.mock.instances[0]["config"].extractors[0].name).toBe("unsaved-extractor");
    expect(save).not.toHaveBeenCalled();
    expect(commands.executeCommand).toHaveBeenCalledOnce();
    configText = JSON.stringify({ ...config, extractors: [] });
    await send("parse", { linesToParse: -1 });
    expect(lastCompletion().error).toBeTruthy();
    expect(parse).toHaveBeenCalledOnce();
  });

  it("starts with config selection and returns to it after clearing the selected file", async () => {
    expect(lastWorkflow().configuration.hasConfig).toBe(false);
    expect(lastWorkflow().rawPreview).toBeDefined();
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    expect(lastWorkflow().setup?.sql).toBeDefined();
    await send("set-config-file", { logParserConfigFile: "" });
    expect(lastWorkflow().configuration.hasConfig).toBe(false);
    expect(lastWorkflow().setup?.sql).toBeUndefined();
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(
      Uri.file("/workspace/new.log-parser.config.json")
    );
    vi.mocked(writeToResource).mockImplementationOnce(async (_uri, text) => {
      configText = text;
    });
    await send("create-new-config");
    expect(lastWorkflow().configuration).toMatchObject({
      hasConfig: true,
      canSplit: false,
      canParse: false,
    });
    expect(save).not.toHaveBeenCalled();
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("retains the selection on cancel and copies unsaved content without saving the original", async () => {
    await send("set-config-file", { logParserConfigFile: "test.log-parser.config.json" });
    await send("create-new-config");
    expect(lastWorkflow().configuration.canParse).toBe(true);
    const editedText = configText + "\n";
    configText = editedText;
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(
      Uri.file("/workspace/copy.log-parser.config.json")
    );
    await send("copy-config");
    expect(writeToResource).toHaveBeenCalledWith(expect.anything(), editedText);
    expect(save).not.toHaveBeenCalled();
    vi.mocked(writeToResource).mockClear();
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(Uri.file("/workspace/wrong.json"));
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined);
    await send("create-new-config");
    expect(writeToResource).not.toHaveBeenCalled();
  });
});
