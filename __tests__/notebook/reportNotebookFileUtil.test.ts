import { NotebookData, Uri, ViewColumn, window, workspace } from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveCloudWatchReportNotebook } from "../../src/notebook/report/reportNotebookFileUtil";

function createReport(): NotebookData {
  const report = new NotebookData([]);
  report.metadata = { reportKind: "aws-cloudwatch-metrics" };
  return report;
}

describe("saveCloudWatchReportNotebook", () => {
  beforeEach(() => {
    workspace.workspaceFolders = [{ uri: Uri.file("/workspace"), name: "workspace", index: 0 }];
    vi.mocked(workspace.fs.stat).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(workspace.openNotebookDocument).mockResolvedValue({} as never);
    vi.mocked(workspace.fs.createDirectory).mockClear();
    vi.mocked(workspace.fs.writeFile).mockClear();
    vi.mocked(window.showNotebookDocument).mockClear();
  });

  afterEach(() => {
    workspace.workspaceFolders = undefined;
  });

  it("saves beneath reports/cw-metrics and opens beside the current editor", async () => {
    const result = await saveCloudWatchReportNotebook(
      createReport(),
      "metrics-dynamodb-Vehicles-20260830-090812.dbnr"
    );

    expect(result).toMatchObject({
      ok: true,
      relativePath: "reports/cw-metrics/metrics-dynamodb-Vehicles-20260830-090812.dbnr",
    });
    expect(workspace.fs.createDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/workspace/reports/cw-metrics" })
    );
    expect(workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: "/workspace/reports/cw-metrics/metrics-dynamodb-Vehicles-20260830-090812.dbnr",
      }),
      expect.any(Uint8Array)
    );
    expect(window.showNotebookDocument).toHaveBeenCalledWith(expect.anything(), {
      viewColumn: ViewColumn.Two,
    });
  });

  it("does not write when no workspace folder is open", async () => {
    workspace.workspaceFolders = undefined;
    const result = await saveCloudWatchReportNotebook(createReport(), "metrics-sqs-orders.dbnr");

    expect(result).toMatchObject({ ok: false });
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
