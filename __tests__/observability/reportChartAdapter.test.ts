import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { describe, expect, it } from "vitest";
import type { ReportChartSpec } from "../../src/notebook/report/reportTypes";
import { createReportChartViewParams } from "../../src/observability/report/reportChartAdapter";

const baseSpec: ReportChartSpec = {
  version: 1,
  renderer: "chartjs",
  type: "line",
  title: "Consumed capacity",
  dataShape: "long",
  xKey: "timestamp",
  seriesKey: "metricId",
  valueKey: "value",
  series: [{ id: "read", label: "Table read" }],
};

function createRdh() {
  const builder = new ResultSetDataBuilder(["timestamp", "metricId", "value"]);
  builder.addRow({ timestamp: "2026-08-30T07:49:00.000Z", metricId: "read", value: 0 });
  builder.addRow({ timestamp: "2026-08-30T07:50:00.000Z", metricId: "read", value: 1 });
  return builder.build();
}

describe("createReportChartViewParams", () => {
  it("uses a readable Chart.js time scale when requested", () => {
    const result = createReportChartViewParams(
      { ...baseSpec, xAxis: { type: "time", display: "auto" } },
      createRdh()
    );

    expect(result.preparedData.labels).toEqual([]);
    expect(result.preparedData.datasets[0].data).toEqual([
      { x: "2026-08-30T07:49:00.000Z", y: 0 },
      { x: "2026-08-30T07:50:00.000Z", y: 1 },
    ]);
    expect(result.preparedOptions.scales?.x).toMatchObject({
      type: "time",
      ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
      time: { tooltipFormat: "yyyy-MM-dd HH:mm:ss" },
    });
  });

  it("keeps the former category-axis representation when xAxis is omitted", () => {
    const result = createReportChartViewParams(baseSpec, createRdh());

    expect(result.preparedData.labels).toEqual([
      "2026-08-30T07:49:00.000Z",
      "2026-08-30T07:50:00.000Z",
    ]);
    expect(result.preparedData.datasets[0].data).toEqual([0, 1]);
    expect(result.preparedOptions.scales?.x?.type).toBeUndefined();
  });

  it("does not insert gaps from another series when time observations are asynchronous", () => {
    const builder = new ResultSetDataBuilder(["timestamp", "metricId", "value"]);
    builder.addRow({ timestamp: "2026-08-30T07:49:00.000Z", metricId: "read", value: 1 });
    builder.addRow({ timestamp: "2026-08-30T07:49:01.000Z", metricId: "write", value: 2 });
    builder.addRow({ timestamp: "2026-08-30T07:50:00.000Z", metricId: "read", value: 3 });
    const result = createReportChartViewParams(
      {
        ...baseSpec,
        xAxis: { type: "time", display: "auto" },
        series: [
          { id: "read", label: "Read" },
          { id: "write", label: "Write" },
        ],
      },
      builder.build()
    );

    expect(result.preparedData.datasets[0].data).toEqual([
      { x: "2026-08-30T07:49:00.000Z", y: 1 },
      { x: "2026-08-30T07:50:00.000Z", y: 3 },
    ]);
    expect(result.preparedData.datasets[1].data).toEqual([{ x: "2026-08-30T07:49:01.000Z", y: 2 }]);
  });
});
