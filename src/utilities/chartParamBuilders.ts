import { isDateTimeOrDate, isDateTimeOrDateOrTime, isTime, RdhKey, RdhRow, ResultSetData } from "@l-v-yonsama/rdh";
import type { ExtChartData, ExtChartJsInputParams, ExtChartOptions } from "../shared/ExtChartJs";
import { ChartsViewParams } from "../types/views";
import { createColors } from "./chartColorUtil";

// Internal leaf module: chart-type builders (and their exclusive helpers) shared by
// both chartUtil.ts (regular Chart.js params) and pairPlotChartUtil.ts (Pair Plot
// params, which reuse the histogram/scatter builders for each matrix cell). Neither
// chartUtil.ts nor pairPlotChartUtil.ts import from each other for this logic, so
// there's no import cycle between the two.

export const DEFAULT_CHART_OPTIONS: ExtChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
};

export const calcMax = (rows: RdhRow[], keys: string[]): number => {
  return rows.reduce((prev: number, cur: RdhRow): number => {
    const arr = keys.map((it) => cur.values[it]);
    if (!isNaN(prev)) {
      arr.push(prev);
    }
    return Math.max(...arr);
  }, NaN);
};

const groupByRows = (rdh: ResultSetData, label: string): { [key: string]: RdhRow[] } => {
  const groups: { [key: string]: RdhRow[] } = {};
  rdh.rows.forEach((row) => {
    const key = row.values[label];
    if (groups[key] === undefined) {
      groups[key] = [];
    }
    groups[key].push(row);
  });
  return groups;
};

const pointStyles: string[] = [
  "circle",
  "rect",
  "triangle",
  "rectRot",
  "cross",
  "line",
  "crossRot",
  "star",
];

export const createPointStyles = (size: number) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = pointStyles[i % pointStyles.length];
    arr.push(p);
  }
  return arr;
};

export const createScaleOptions = (params: {
  keys: RdhKey[];
  isX: boolean;
  text: string;
  nth?: number;
  min?: number;
  max?: number;
  stacked?: boolean;
  axisDisplay?: boolean;
  axisTitleDisplay?: boolean;
  gridDrawOnChartArea?: boolean;
}) => {
  const {
    isX,
    keys,
    text,
    nth,
    min,
    max,
    stacked,
    axisDisplay,
    axisTitleDisplay,
    gridDrawOnChartArea,
  } = params;
  const key = keys.find((it) => it.name === text);

  const options: any = {
    // axis: isX ? "x" : "y",
    position: isX ? "bottom" : (nth ?? 0) % 2 === 0 ? "left" : "right",
    display: axisDisplay === true || axisDisplay === undefined,
    title: {
      text,
      display: axisTitleDisplay === true || axisTitleDisplay === undefined,
    },
    grid: {
      drawOnChartArea: gridDrawOnChartArea === true || gridDrawOnChartArea === undefined,
    },
  };
  if (stacked === true) {
    options.stacked = true;
  }
  if (min !== undefined) {
    options.min = min;
  }
  if (max !== undefined) {
    options.max = max;
  }
  if (key && isDateTimeOrDateOrTime(key.type)) {
    options.type = "time";
    options.time = {
      unit: "day",
    };
    if (isDateTimeOrDate(key.type)) {
      options.time.displayFormats = {
        day: "MM-dd HH:mm:ss",
      };
    } else if (isTime(key.type)) {
      options.time.displayFormats = {
        hour: "HH:mm:ss",
      };
    } else {
      options.time.displayFormats = {
        day: "yyyy-MM-dd",
      };
    }
  } else {
    options.type = "linear";
  }
  return options;
};

export const createHistogramParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  const rows = params.rdh.rows;

  let max: number | undefined = undefined;
  if (params.multipleDataset && params.stacked !== true) {
    const minMaxNames: string[] = [params.data];
    if (params.data2) {
      minMaxNames.push(params.data2);
    }
    if (params.data3) {
      minMaxNames.push(params.data3);
    }
    if (params.data4) {
      minMaxNames.push(params.data4);
    }
    max = calcMax(rows, minMaxNames);
  }

  const options: ExtChartOptions = {
    ...DEFAULT_CHART_OPTIONS,
    plugins: {
      datalabels: {
        display: params.showDataLabels,
      },
      legend: {
        display: !!params.showLegend,
      },
      title: {
        display: params.showTitle,
        text: params.title,
      },
    },
    scales: {
      x: {
        axis: "x",
        stacked: params.stacked,
      },
      y: {
        axis: "y",
        title: {
          text: params.dataY,
        },
        max,
        stacked: params.stacked,
      },
    },
  };

  const data: ExtChartData = {
    labels: rows.filter((it, idx) => idx <= 9).map((it) => it.values.range),
    datasets: [],
  };

  if (params.rdh.keys.some((it) => it.name === params.label)) {
    const group = groupByRows(params.rdh, params.label);
    const groupKeys = Object.keys(group);
    const colors = createColors(groupKeys.length, 0.5);
    const borderColors = createColors(groupKeys.length, 0.9);
    data.datasets.push(
      ...groupKeys.map((label, idx) => {
        return {
          yAxisID: "y",
          label,
          backgroundColor: colors[idx],
          borderColor: borderColors[idx],
          borderWidth: 2,
          data: group[label].map((it) => it.values["value"]),
          stack: params.stacked ? "s0" : undefined,
        };
      })
    );
  } else {
    const colors = createColors(1, 0.5);
    const borderColors = createColors(1, 0.9);
    data.datasets.push({
      yAxisID: "y",
      label: "value",
      backgroundColor: colors[0],
      borderColor: borderColors[0],
      borderWidth: 2,
      data: rows.map((it) => it.values["value"]),
    });
  }

  return { options, data };
};

export const createScatterParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  const { keys, rows } = params.rdh;

  const options: ExtChartOptions = {
    ...DEFAULT_CHART_OPTIONS,
    plugins: {
      datalabels: {
        display: params.showDataLabels,
      },
      legend: {
        display: !!params.showLegend && !!params.label,
        labels: {
          usePointStyle: true,
        },
      },
      title: {
        display: params.showTitle,
        text: params.title,
        padding: 1,
        font: {
          size: 18,
        },
      },
    },
    scales: {
      x: createScaleOptions({
        isX: true,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.dataX,
      }),
      y: createScaleOptions({
        isX: false,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.dataY,
      }),
    },
  };

  const data: ExtChartData = {
    labels: [],
    datasets: [],
  };
  if (params.label) {
    const group = groupByRows(params.rdh, params.label);
    const groupKeys = Object.keys(group);
    const colors = createColors(groupKeys.length, 0.5);
    const colors2 = createColors(groupKeys.length, 0.9);
    const pointStyles = createPointStyles(groupKeys.length);
    data.datasets.push(
      ...groupKeys.map((label, idx) => {
        return {
          xAxisID: "x",
          yAxisID: "y",
          label,
          backgroundColor: colors[idx],
          pointStyle: pointStyles[idx],
          pointRadius: params.pointRadius ?? 6,
          pointBorderColor: colors2[idx],
          pointBorderWidth: 2,
          data: group[label].map((it) => ({
            x: it.values[params.dataX],
            y: it.values[params.dataY],
          })),
        };
      })
    );
  } else {
    data.datasets.push({
      xAxisID: "x",
      yAxisID: "y",
      label: params.label || params.dataX,
      backgroundColor: createColors(1, 0.5)[0],
      pointRadius: params.pointRadius ?? 6,
      pointBorderColor: createColors(1, 0.9)[0],
      pointBorderWidth: 2,
      data: rows.map((it) => ({ x: it.values[params.dataX], y: it.values[params.dataY] })),
    });
  }

  return { options, data };
};
