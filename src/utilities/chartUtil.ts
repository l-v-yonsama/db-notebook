import type { ExtChartData, ExtChartJsInputParams, ExtChartOptions } from "../shared/ExtChartJs";
import { ChartsViewParams } from "../types/views";
import { createColors, tableau20 } from "./chartColorUtil";
import {
  calcMax,
  createHistogramParams,
  createPointStyles,
  createScaleOptions,
  createScatterParams,
  DEFAULT_CHART_OPTIONS,
} from "./chartParamBuilders";

// Re-exported so existing `import { createPairPlotChartParams } from "./chartUtil"` call sites
// keep working after the Pair Plot logic moved to pairPlotChartUtil.ts.
export { createPairPlotChartParams } from "./pairPlotChartUtil";

const createColors2 = (size: number, alpha = 0.9) => {
  const arr: string[] = [];
  for (let i = 0, j = 0; i < size; i++, j += 2) {
    const p = tableau20[j % 20];
    arr.push(`rgba(${p.r},${p.g},${p.b}, ${alpha})`);
  }
  return arr;
};

export const createChartJsParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  switch (params.type) {
    case "bar":
      return createBarParams(params);
    case "line":
      return createLineParams(params);
    case "histogram":
      return createHistogramParams(params);
    case "doughnut":
    case "pie":
      return createDoughnutOrPieParams(params);
    case "radar":
      return createRadarParams(params);
    case "scatter":
      return createScatterParams(params);
  }
  throw new Error("Not supported type" + params.type);
};

const createLineParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  const { rows, keys } = params.rdh;

  const options: ExtChartOptions = {
    ...DEFAULT_CHART_OPTIONS,
    plugins: {
      datalabels: {
        display: params.showDataLabels,
      },
      title: {
        display: params.showTitle,
        text: params.title,
      },
      legend: {
        display: params.multipleDataset,
        labels: {
          usePointStyle: true,
        },
      },
    },
    scales: {
      x: createScaleOptions({
        isX: true,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.label,
      }),
      y: createScaleOptions({
        isX: false,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.data,
      }),
    },
  };

  const data: ExtChartData = {
    labels: [],
    datasets: [],
  };

  const colors = createColors2(4, 0.5);
  const borderColors = createColors2(4, 0.9);
  const pointStyles = createPointStyles(4);

  data.labels = rows.map((it) => it.values[params.label]);
  data.datasets.push({
    xAxisID: "x",
    yAxisID: "y",
    label: params.data ?? "y1",
    backgroundColor: colors[0],
    pointStyle: pointStyles[0],
    pointRadius: params.pointRadius ?? 6,
    pointBorderColor: borderColors[0],
    pointBorderWidth: 2,
    data: rows.map((it) => it.values[params.data]),
  });
  if (params.multipleDataset) {
    if (params.data2) {
      options.scales!["y2"] = createScaleOptions({
        isX: false,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.data2!,
        nth: 1,
        gridDrawOnChartArea: false,
      });
      data.datasets.push({
        xAxisID: "x",
        yAxisID: "y2",
        label: params.data2 ?? "y2",
        backgroundColor: colors[1],
        pointStyle: pointStyles[1],
        borderDash: [5, 10],
        pointRadius: params.pointRadius ?? 6,
        pointBorderColor: borderColors[1],
        pointBorderWidth: 2,
        data: rows.map((it) => it.values[params.data2!]),
      });
    }
    if (params.data3) {
      options.scales!["y3"] = createScaleOptions({
        isX: false,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.data3!,
        nth: 2,
        gridDrawOnChartArea: false,
      });
      data.datasets.push({
        xAxisID: "x",
        yAxisID: "y3",
        label: params.data2 ?? "y3",
        pointStyle: pointStyles[2],
        backgroundColor: colors[2],
        pointRadius: params.pointRadius ?? 6,
        pointBorderColor: borderColors[2],
        pointBorderWidth: 2,
        data: rows.map((it) => it.values[params.data3!]),
      });
    }
    if (params.data4) {
      options.scales!["y4"] = createScaleOptions({
        isX: false,
        axisDisplay: !!params.showAxis,
        axisTitleDisplay: !!params.showAxisTitle,
        keys,
        text: params.data4!,
        nth: 3,
        gridDrawOnChartArea: false,
      });
      data.datasets.push({
        xAxisID: "x",
        yAxisID: "y4",
        label: params.data4 ?? "y4",
        pointStyle: pointStyles[3],
        backgroundColor: colors[3],
        borderDash: [5, 10],
        pointRadius: params.pointRadius ?? 6,
        pointBorderColor: borderColors[3],
        pointBorderWidth: 2,
        data: rows.map((it) => it.values[params.data4!]),
      });
    }
  }

  return { options, data };
};

const createBarParams = (params: ChartsViewParams): ExtChartJsInputParams => {
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
      title: {
        display: params.showTitle,
        text: params.title,
      },
    },
    scales: {
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
    labels: [],
    datasets: [],
  };

  const colors = createColors2(4, 0.5);
  const borderColors = createColors2(4, 0.9);

  data.labels = rows.map((it) => it.values[params.label]);
  data.datasets.push({
    yAxisID: "y",
    label: params.data ?? "y1",
    backgroundColor: colors[0],
    borderColor: borderColors[0],
    borderWidth: 2,
    data: rows.map((it) => it.values[params.data]),
    stack: params.stacked ? "s0" : undefined,
  });
  if (params.multipleDataset) {
    if (params.data2) {
      data.datasets.push({
        yAxisID: "y",
        label: params.data2 ?? "y2",
        backgroundColor: colors[1],
        borderColor: borderColors[1],
        borderWidth: 2,
        data: rows.map((it) => it.values[params.data2!]),
        stack: params.stacked ? "s0" : undefined,
      });
    }
    if (params.data3) {
      data.datasets.push({
        yAxisID: "y",
        label: params.data2 ?? "y3",
        backgroundColor: colors[2],
        borderColor: borderColors[2],
        borderWidth: 2,
        data: rows.map((it) => it.values[params.data3!]),
        stack: params.stacked ? "s0" : undefined,
      });
    }
    if (params.data4) {
      data.datasets.push({
        yAxisID: "y",
        label: params.data4 ?? "y4",
        backgroundColor: colors[3],
        borderColor: borderColors[3],
        borderWidth: 2,
        data: rows.map((it) => it.values[params.data4!]),
        stack: params.stacked ? "s0" : undefined,
      });
    }
  }

  return { options, data };
};

const createDoughnutOrPieParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  const rows = params.rdh.rows;

  const options: ExtChartOptions = {
    ...DEFAULT_CHART_OPTIONS,
    plugins: {
      datalabels: {
        display: params.showDataLabels,
        font: {
          weight: "bold",
        },
      },
      title: {
        display: params.showTitle,
        text: params.title,
      },
    },
  };

  const data: ExtChartData = {
    labels: rows.map((it) => it.values[params.label]),
    datasets: [
      {
        backgroundColor: createColors(rows.length, 0.5),
        borderColor: createColors(rows.length, 0.9),
        borderWidth: 2,
        data: rows.map((it) => it.values[params.data]),
      },
    ],
  };

  return { options, data };
};

const createRadarParams = (params: ChartsViewParams): ExtChartJsInputParams => {
  const rows = params.rdh.rows;
  const keys = params.rdh.keys;

  const options: ExtChartOptions = {
    ...DEFAULT_CHART_OPTIONS,
    plugins: {
      datalabels: {
        display: params.showDataLabels,
      },
      title: {
        display: params.showTitle,
        text: params.title,
      },
    },
  };

  const colors = createColors2(4, 0.13);
  const borderColors = createColors2(4, 0.6);

  const axisNames: string[] = [];

  if (keys.some((it) => it.name === params.data)) {
    axisNames.push(params.data);
  }
  if (keys.some((it) => it.name === params.data2)) {
    axisNames.push(params.data2!);
  }
  if (keys.some((it) => it.name === params.data3)) {
    axisNames.push(params.data3!);
  }
  if (keys.some((it) => it.name === params.data4)) {
    axisNames.push(params.data4!);
  }

  const getData = (hueValue: string) => {
    const data = axisNames.map((_) => 0);
    rows
      .filter((row) => (params.label ? row.values[params.label] === hueValue : true))
      .forEach((row) => {
        axisNames.forEach((axisName, idx) => {
          data[idx] += row.values[axisName];
        });
      });
    return data.map((it) => Number(it.toFixed(2)));
  };

  const data: ExtChartData = {
    labels: axisNames,
    datasets: [],
  };

  if (params.label) {
    const labels = [...new Set(rows.map((row) => row.values[params.label]))];
    labels.forEach((label, idx) => {
      data.datasets.push({
        fill: true,
        label,
        backgroundColor: colors[idx],
        borderColor: borderColors[idx],
        data: getData(label),
      });
    });
  } else {
    if (options.plugins) {
      options.plugins.legend = {
        display: false,
      };
    }
    data.datasets.push({
      fill: true,
      label: "y",
      backgroundColor: colors[0],
      borderColor: borderColors[0],
      data: getData(""),
    });
  }

  return { options, data };
};
