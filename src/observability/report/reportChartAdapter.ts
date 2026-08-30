import type { ResultSetData } from "@l-v-yonsama/rdh";
import type { ReportChartSpec } from "../../notebook/report/reportTypes";
import type { ExtChartData, ExtChartOptions } from "../../shared/ExtChartJs";
import type { PreparedChartsViewParams } from "../../types/views";
import { createColors } from "../../utilities/chartColorUtil";

export function createReportChartViewParams(
  spec: ReportChartSpec,
  rdh: ResultSetData
): PreparedChartsViewParams {
  const labels = [...new Set(rdh.rows.map((row) => String(row.values[spec.xKey] ?? "")))];
  const points = new Map<string, Map<string, unknown>>();
  for (const row of rdh.rows) {
    const seriesId = String(row.values[spec.seriesKey] ?? "");
    const timestamp = String(row.values[spec.xKey] ?? "");
    let seriesPoints = points.get(seriesId);
    if (!seriesPoints) {
      seriesPoints = new Map();
      points.set(seriesId, seriesPoints);
    }
    seriesPoints.set(timestamp, row.values[spec.valueKey]);
  }

  const backgroundColors = createColors(spec.series.length, 0.28);
  const borderColors = createColors(spec.series.length, 0.9);
  const stacked = spec.type === "stacked-area";
  const timeAxis = spec.xAxis?.type === "time";
  const data: ExtChartData = {
    labels: timeAxis ? [] : labels,
    datasets: spec.series.map((series, index) => ({
      label: series.label,
      data: labels.map((label) => {
        const value = points.get(series.id)?.get(label) ?? null;
        return timeAxis ? { x: label, y: value } : value;
      }),
      backgroundColor: backgroundColors[index],
      borderColor: borderColors[index],
      borderWidth: 2,
      pointRadius: spec.type === "bar" ? undefined : 2,
      fill: stacked,
      stack: stacked ? "dashboard" : undefined,
      spanGaps: false,
    })),
  };
  const options: ExtChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      datalabels: { display: false },
      title: { display: true, text: spec.title },
      legend: { display: spec.series.length > 1, labels: { usePointStyle: true } },
      tooltip: { enabled: true },
    },
    interaction: { mode: "nearest", intersect: false },
    scales: {
      x: timeAxis
        ? {
            axis: "x",
            type: "time",
            time: createTimeOptions(spec.xAxis?.display ?? "auto"),
            ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          }
        : { axis: "x" },
      y: { axis: "y", stacked },
    },
  };
  return {
    title: spec.title,
    type: spec.type === "bar" ? "bar" : "line",
    preparedData: data,
    preparedOptions: options,
  };
}

function createTimeOptions(display: NonNullable<ReportChartSpec["xAxis"]>["display"]): {
  tooltipFormat: string;
  displayFormats?: Record<string, string>;
} {
  const tooltipFormat = "yyyy-MM-dd HH:mm:ss";
  switch (display) {
    case "time":
      return {
        tooltipFormat,
        displayFormats: {
          millisecond: "HH:mm:ss.SSS",
          second: "HH:mm:ss",
          minute: "HH:mm",
          hour: "HH:mm",
        },
      };
    case "date":
      return {
        tooltipFormat,
        displayFormats: { day: "yyyy-MM-dd", week: "yyyy-MM-dd", month: "yyyy-MM" },
      };
    case "date-time":
      return {
        tooltipFormat,
        displayFormats: {
          minute: "MM-dd HH:mm",
          hour: "MM-dd HH:mm",
          day: "yyyy-MM-dd",
        },
      };
    case "auto":
      return { tooltipFormat };
  }
}
