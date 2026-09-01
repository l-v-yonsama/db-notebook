import type {
  DbSubscription,
  ExtractedSqlResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import type { ExtChartData, ExtChartOptions } from "../shared/ExtChartJs";
import type { CellMetaChart } from "./Notebook";

export type MdhViewParams = {
  title: string;
  list: ResultSetData[];
};

export type LogParseResultViewParams = {
  title: string;
  rawLogs: ResultSetData;
  totalLogLines: number;
  linesToParse: number;
  extractedSqlResult?: ExtractedSqlResult;
};

export type DiffMdhViewTabParam = {
  title: string;
  comparable: boolean;
  undoable: boolean;
  list1: ResultSetData[];
  list2: ResultSetData[];
};

export type ChartsViewParams = CellMetaChart & {
  showLegend?: boolean;
  showAxis?: boolean;
  showAxisTitle?: boolean;
  pointRadius?: number;
  rdh: ResultSetData;
};

export type PreparedChartsViewParams = {
  title: string;
  type: "line" | "bar";
  preparedData: ExtChartData;
  preparedOptions: ExtChartOptions;
};

export type AnyChartsViewParams = ChartsViewParams | PreparedChartsViewParams;

export type SubscriptionPayloadsViewParams = {
  conName: string;
  subscriptionRes: DbSubscription;
  rdh?: ResultSetData;
};
