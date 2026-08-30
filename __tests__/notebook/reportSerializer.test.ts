import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  CancellationToken,
  NotebookCellData,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookData,
} from "vscode";
import { describe, expect, it } from "vitest";
import { DBNotebookReportSerializer } from "../../src/notebook/report/reportSerializer";

const token = {} as CancellationToken;

describe("DBNotebookReportSerializer", () => {
  it("round-trips an RDB-compatible result-set output and chart metadata", async () => {
    const builder = new ResultSetDataBuilder(["timestamp", "metricId", "value"]);
    builder.addRow({ timestamp: "2026-08-30T00:00:00Z", metricId: "sessions", value: 3 });
    const rdh = builder.build();
    const cell = new NotebookCellData(NotebookCellKind.Code, "Saved snapshot.", "plaintext");
    cell.metadata = {
      cellLabel: "Sessions",
      reportChart: {
        version: 1,
        renderer: "chartjs",
        type: "line",
        title: "Sessions",
        dataShape: "long",
        xKey: "timestamp",
        seriesKey: "metricId",
        valueKey: "value",
        series: [{ id: "sessions", label: "Sessions" }],
      },
    };
    cell.outputs = [
      new NotebookCellOutput([NotebookCellOutputItem.text("preview", "text/markdown")], {
        schemaVersion: 1,
        kind: "result-set",
        rdh,
      }),
    ];
    const notebook = new NotebookData([cell]);
    notebook.metadata = { reportKind: "rdb-database" };

    const serializer = new DBNotebookReportSerializer();
    const bytes = await serializer.serializeNotebook(notebook, token);
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    expect(raw).toMatchObject({ formatVersion: 1, reportKind: "rdb-database" });
    expect(raw.cells[0].outputs[0].items[0]).toEqual({
      mime: "text/markdown",
      encoding: "utf8",
      data: "preview",
    });

    const restored = await serializer.deserializeNotebook(bytes, token);
    expect(restored.metadata?.reportKind).toBe("rdb-database");
    expect(
      (restored.cells[0].outputs?.[0].metadata as { rdh: { rows: unknown[] } }).rdh.rows
    ).toHaveLength(1);
    expect(
      (restored.cells[0].metadata as { reportChart: { series: unknown[] } }).reportChart.series
    ).toHaveLength(1);
  });

  it("rejects output MIME types without a registered codec", async () => {
    const cell = new NotebookCellData(NotebookCellKind.Code, "Saved snapshot.", "plaintext");
    cell.outputs = [new NotebookCellOutput([NotebookCellOutputItem.stdout("hidden")])];
    const notebook = new NotebookData([cell]);
    notebook.metadata = { reportKind: "aws-cloudwatch-metrics" };

    await expect(
      new DBNotebookReportSerializer().serializeNotebook(notebook, token)
    ).rejects.toThrow("Unsupported dashboard report output MIME type");
  });
});
