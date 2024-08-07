import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import type { RunResultMetadata } from "../shared/RunResultMetadata";

export const copyRrm = (rrm: RunResultMetadata): RunResultMetadata => {
  const o = JSON.parse(JSON.stringify(rrm));
  if (rrm.rdh) {
    o.rdh = ResultSetDataBuilder.from(rrm.rdh).build();
  }
  if (rrm.explainRdh) {
    o.explainRdh = ResultSetDataBuilder.from(rrm.explainRdh).build();
  }
  return o;
};

const rrmToRdhList = (rrm: RunResultMetadata): ResultSetData[] => {
  const o = copyRrm(rrm);
  const rdhList: ResultSetData[] = [];
  if (o.rdh) {
    rdhList.push(o.rdh);
  }
  if (o.explainRdh) {
    rdhList.push(o.explainRdh);
  }
  if (o.analyzedRdh) {
    rdhList.push(o.analyzedRdh);
  }
  return rdhList;
};

export const rrmListToRdhList = (rrmList: RunResultMetadata[]): ResultSetData[] => {
  const rdhList: ResultSetData[] = [];
  rrmList.forEach((rrm) => {
    rdhList.push(...rrmToRdhList(rrm));
  });
  return rdhList;
};
