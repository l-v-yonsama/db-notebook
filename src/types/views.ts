import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";

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
