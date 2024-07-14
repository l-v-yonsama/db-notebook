import {
  createRdhKey,
  GeneralColumnType,
  isDateTimeOrDate,
  isDateTimeOrDateOrTime,
  isNumericLike,
  isTime,
  RdhKey,
  RdhRow,
  ResultSetData,
  ResultSetDataBuilder,
} from "@l-v-yonsama/rdh";
import type {
  ExtChartData,
  ExtChartJsInputParams,
  ExtChartOptions,
  PairPlotChartCorrelationParam,
  PairPlotChartParam,
  PairPlotChartParams,
} from "../shared/ExtChartJs";
import { ChartsViewParams } from "../types/views";

const DEFAULT_CHART_OPTIONS: ExtChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
};

const calcMax = (rows: RdhRow[], keys: string[]): number => {
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

const tableau20 = [
  { r: 31, g: 119, b: 180 },
  { r: 174, g: 199, b: 232 },
  { r: 255, g: 127, b: 14 },
  { r: 255, g: 187, b: 120 },
  { r: 44, g: 160, b: 44 },
  { r: 152, g: 223, b: 138 },
  { r: 214, g: 39, b: 40 },
  { r: 255, g: 152, b: 150 },
  { r: 148, g: 103, b: 189 },
  { r: 197, g: 176, b: 213 },
  { r: 140, g: 86, b: 75 },
  { r: 196, g: 156, b: 148 },
  { r: 227, g: 119, b: 194 },
  { r: 247, g: 182, b: 210 },
  { r: 127, g: 127, b: 127 },
  { r: 199, g: 199, b: 199 },
  { r: 188, g: 189, b: 34 },
  { r: 219, g: 219, b: 141 },
  { r: 23, g: 190, b: 207 },
  { r: 158, g: 218, b: 229 },
];

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

const pointStyleSymbols: string[] = ["●", "■", "▲", "◆", "＋", "−", "×", "＊"];

const createPointStyles = (size: number) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = pointStyles[i % pointStyles.length];
    arr.push(p);
  }
  return arr;
};

const createPointStyleSymbols = (size: number) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = pointStyleSymbols[i % pointStyleSymbols.length];
    arr.push(p);
  }
  return arr;
};

const createColors = (size: number, alpha = 0.9) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = tableau20[i % 20];
    arr.push(`rgba(${p.r},${p.g},${p.b}, ${alpha})`);
  }
  return arr;
};

const createColors2 = (size: number, alpha = 0.9) => {
  const arr: string[] = [];
  for (let i = 0, j = 0; i < size; i++, j += 2) {
    const p = tableau20[j % 20];
    arr.push(`rgba(${p.r},${p.g},${p.b}, ${alpha})`);
  }
  return arr;
};

const createScaleOptions = (params: {
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

const createHistogramParams = (params: ChartsViewParams): ExtChartJsInputParams => {
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

const createScatterParams = (params: ChartsViewParams): ExtChartJsInputParams => {
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

export const createPairPlotChartParams = (params: ChartsViewParams): PairPlotChartParams => {
  const rdb = ResultSetDataBuilder.from(params.rdh);
  const keys = rdb.rs.keys.filter((it) => isNumericLike(it.type));
  let hueLegends: {
    title: string;
    color: string;
    pointSymbol: string;
  }[] = [];
  if (rdb.hasKey(params.label)) {
    const titles = [...new Set(rdb.toVector(params.label))];
    const colors = createColors(titles.length);
    const pointSymbols = createPointStyleSymbols(titles.length);

    titles.forEach((title, idx) => {
      hueLegends.push({
        title,
        color: colors[idx],
        pointSymbol: pointSymbols[idx],
      });
    });
  }

  const ret: PairPlotChartParams = {
    showTitle: params.showTitle,
    hueLegends,
    matrix: [],
  };

  keys.forEach((ck, ci) => {
    const matrixRow: PairPlotChartParam[] = [];
    keys.forEach((rk, ri) => {
      if (rk.name === ck.name) {
        matrixRow.push({
          rowName: ck.name,
          colName: rk.name,
          type: "histogram",
          chartParams: createHistogramExtChartJsInputParamsForPairPlot(
            rk.name,
            hueLegends,
            params.label,
            params.rdh,
            params.showDataLabels
          ),
        });
      } else {
        if (ci < ri) {
          // Right part of histogram
          matrixRow.push({
            rowName: ck.name,
            colName: rk.name,
            type: "correlation",
            correlation: createCorrelation(rdb.sampleCorrelation(rk.name, ck.name)),
          });
        } else {
          // Left part of histogram
          matrixRow.push({
            rowName: ck.name,
            colName: rk.name,
            type: "scatter",
            chartParams: createScatterExtChartJsInputParamsForPairPlot(
              rdb.rs,
              rk,
              ck,
              params.label,
              params.showDataLabels
            ),
          });
        }
      }
    });
    ret.matrix.push(matrixRow);
    // histogram
  });

  return ret;
};

const createCorrelation = (value: number): PairPlotChartCorrelationParam => {
  const absV = Math.abs(value ? value : 0);
  let category: PairPlotChartCorrelationParam["category"];
  if (absV <= 0.2) {
    category = "very_weak";
  } else if (absV <= 0.4) {
    category = "weak";
  } else if (absV <= 0.6) {
    category = "moderate";
  } else if (absV <= 0.6) {
    category = "strong";
  } else {
    category = "very_strong";
  }

  return {
    value,
    category,
  };
};

const createHistogramExtChartJsInputParamsForPairPlot = (
  keyName: string,
  hueLegends: {
    title: string;
    color: string;
    pointSymbol: string;
  }[],
  hueName: string,
  rdh: ResultSetData,
  showDataLabels: boolean
): ExtChartJsInputParams => {
  const ret = new Array<Array<number>>();
  let leftEdge: number;
  let binWidth: number;
  try {
    const rdb = ResultSetDataBuilder.from(rdh);
    const values = rdb.toVector(keyName, true) as number[];
    let bins = 10;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      // fudge for non-variant data
      min = min - 0.5;
      max = max + 0.5;
    }

    var range = max - min;
    // make the bins slightly larger by expanding the range about 10%
    // this helps with dumb floating point stuff
    binWidth = (range + range * 0.05) / bins;
    var midpoint = (min + max) / 2;
    // even bin count, midpoint makes an edge
    leftEdge = midpoint - binWidth * Math.floor(bins / 2);
    if (bins % 2 !== 0) {
      // odd bin count, center middle bin on midpoint
      leftEdge = midpoint - binWidth / 2 - binWidth * Math.floor(bins / 2);
    }

    if (hueLegends.length > 0) {
      hueLegends.forEach((u) => ret.push(Array(bins).fill(0)));
    } else {
      ret.push(Array(bins).fill(0));
    }

    rdh.rows.forEach((row) => {
      const v: any = row.values;
      let arrIndex = 0;
      if (hueLegends.length > 0) {
        const hueV = v[hueName];
        arrIndex = hueLegends.findIndex((u) => u.title === hueV);
      }
      const arr = ret[arrIndex];
      const x: number = v[keyName];
      var binIndex = 0;
      while (x > (binIndex + 1) * binWidth + leftEdge) {
        binIndex++;
      }
      arr[binIndex]++;
    });
  } catch (e) {
    console.error(e);
  }

  const withHue = hueName && hueLegends.length ? true : false;
  const keys = [
    createRdhKey({ name: "labelX", type: GeneralColumnType.TEXT }),
    createRdhKey({ name: "range", type: GeneralColumnType.TEXT }),
    createRdhKey({ name: "value", type: GeneralColumnType.INTEGER }),
  ];
  if (withHue) {
    keys.push(createRdhKey({ name: "hue", type: GeneralColumnType.UNKNOWN }));
  }
  const rdb = new ResultSetDataBuilder(keys);
  ret.forEach((it, hueIndex) => {
    let range = leftEdge;
    it.forEach((v, lbIndex) => {
      const values: any = {
        labelX: `${lbIndex + 1}`,
        range: `${range.toFixed(2)}〜`,
        value: v,
      };
      if (withHue) {
        values.hue = hueLegends[hueIndex].title;
      }
      rdb.addRow(values);
      range += binWidth;
    });
  });

  return createHistogramParams({
    type: "histogram",
    rdh: rdb.build(),
    multipleDataset: withHue,
    data: "value",
    label: "hue",
    showDataLabels: showDataLabels,
    showTitle: false,
    title: "",
    dataX: "",
    dataY: "",
    stacked: true,
  });
};

const createScatterExtChartJsInputParamsForPairPlot = (
  rdh: ResultSetData,
  x: RdhKey,
  y: RdhKey,
  hue: string,
  showDataLabels: boolean
): ExtChartJsInputParams => {
  const keys: RdhKey[] = [x, y];
  let hueKey: RdhKey | undefined = undefined;
  if (hue) {
    hueKey = rdh.keys.find((it) => it.name === hue);
    if (hueKey) {
      keys.push(hueKey);
    }
  }

  return createScatterParams({
    type: "scatter",
    rdh: {
      created: new Date(),
      keys: [x, y],
      rows: rdh.rows.map((it) => {
        const values: any = {};
        if (hueKey) {
          values[hueKey.name] = it.values[hueKey.name];
        }
        values[x.name] = it.values[x.name];
        values[y.name] = it.values[y.name];
        return {
          meta: it.meta,
          values,
        };
      }),
      meta: rdh.meta,
    },
    multipleDataset: false,
    data: "",
    label: hue,
    showDataLabels,
    showTitle: false,
    showAxis: true,
    title: "",
    dataX: x.name,
    dataY: y.name,
    pointRadius: 3,
  });
};
