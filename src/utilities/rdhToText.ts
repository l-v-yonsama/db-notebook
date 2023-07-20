import {
  ResultSetDataBuilder,
  ResultSetData,
  ToStringParam,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { WriteToClipboardParams } from "../shared/ActionParams";
import * as os from "os";

export const rdhListToText = (list: ResultSetData[], params: WriteToClipboardParams): string => {
  if (list.length === 1) {
    const rdb = ResultSetDataBuilder.from(list[0]);
    return rdbToText(rdb, params);
  }
  const retList: string[] = [];
  list.forEach((rdh, idx) => {
    const rdb = ResultSetDataBuilder.from(rdh);
    retList.push(`### [${idx + 1}/${list.length}] ${rdh.meta.tableName} (${rdh.meta.type})`);
    retList.join(os.EOL);
    retList.push(rdbToText(rdb, params));
  });
  retList.join(os.EOL);
  return retList.join(os.EOL);
};

const rdbToText = (rdb: ResultSetDataBuilder, params: WriteToClipboardParams): string => {
  const maxPrintLines = params.limit ?? 10;
  const outputDetail: ToStringParam = {
    maxPrintLines,
    withRowNo: params.withRowNo,
    withCodeLabel: params.withCodeLabel,
    withRuleViolation: params.withRuleViolation,
    ...createOutputDetail(params.outputWithType),
  };
  let ret = "";
  switch (params.fileType) {
    case "csv":
      ret = rdb.toCsv(outputDetail);
      break;
    case "tsv":
      ret = rdb.toCsv({ delimiter: "\t", ...outputDetail });
      break;
    case "markdown":
      ret = rdb.toMarkdown(outputDetail);
      break;
    case "text":
      ret = rdb.toString(outputDetail);
      break;
    default:
      throw new Error("Not supported file type.");
  }
  return ret + os.EOL;
};

const createOutputDetail = (
  outputWithType: WriteToClipboardParams["outputWithType"]
): { withComment: boolean; withType: boolean } => {
  switch (outputWithType) {
    case "none":
      return {
        withComment: false,
        withType: false,
      };
    case "withComment":
      return {
        withComment: true,
        withType: false,
      };
    case "withType":
      return {
        withComment: false,
        withType: true,
      };
    default:
      return {
        withComment: true,
        withType: true,
      };
  }
};
