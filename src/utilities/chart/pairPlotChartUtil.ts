import {
  createRdhKey,
  GeneralColumnType,
  isNumericLike,
  RdhKey,
  ResultSetData,
  ResultSetDataBuilder,
} from "@l-v-yonsama/rdh";
import type {
  ExtChartJsInputParams,
  PairPlotChartCorrelationParam,
  PairPlotChartParam,
  PairPlotChartParams,
} from "../../shared/ExtChartJs";
import { ChartsViewParams } from "../../types/views";
import { createColors } from "./chartColorUtil";
import { createHistogramParams, createScatterParams } from "./chartParamBuilders";

const pointStyleSymbols: string[] = ["●", "■", "▲", "◆", "＋", "−", "×", "＊"];

const createPointStyleSymbols = (size: number) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = pointStyleSymbols[i % pointStyleSymbols.length];
    arr.push(p);
  }
  return arr;
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
