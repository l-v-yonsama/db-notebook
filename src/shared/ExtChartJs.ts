import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";

export type ExtChartOptions = {
  responsive: boolean;
  maintainAspectRatio: boolean;
  animation: boolean;
  plugins?: {
    datalabels?: {
      display: boolean;
      font?: {
        weight?: string;
        size?: number;
      };
    };
    title?: {
      display?: boolean;
      text?: string;
      padding?: number;
      font?: {
        weight?: string;
        size?: number;
      };
    };
    legend?: {
      display?: boolean;
      labels?: {
        usePointStyle?: boolean;
      };
    };
  };
  scales?: {
    [key: string]: {
      axis?: string;
      title?: {
        text?: string;
      };
      min?: number;
      max?: number;
      stacked?: boolean;
    };
  };
};

export type ExtChartData = {
  labels: string[];
  datasets: any[];
};

export type ExtChartJsInputParams = {
  options: ExtChartOptions;
  data: ExtChartData;
};

export type PairPlotChartCorrelationParam = {
  value: number;
  category: "very_weak" | "weak" | "moderate" | "strong" | "very_strong";
};

export type PairPlotChartParam = {
  rowName: string;
  colName: string;
  type: "scatter" | "histogram" | "correlation";
  chartParams?: ExtChartJsInputParams;
  correlation?: PairPlotChartCorrelationParam;
};

export type PairPlotChartParams = {
  showTitle: boolean;
  hueLegends: {
    title: string;
    color: string;
    pointSymbol: string;
  }[];
  matrix: PairPlotChartParam[][];
};
