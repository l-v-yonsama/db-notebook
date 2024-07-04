import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import type { CellMetaChart } from "./Notebook";

export type MdhViewParams = {
  title: string;
  list: ResultSetData[];
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
