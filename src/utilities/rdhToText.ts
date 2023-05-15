import { ResultSetDataHolder } from "@l-v-yonsama/multi-platform-database-drivers";
import { WriteToClipboardParams } from "../shared/ActionParams";
import * as os from "os";

export const rdhListToText = (
  list: ResultSetDataHolder[],
  params: WriteToClipboardParams
): string => {
  if (list.length === 1) {
    return rdhToText(list[0], params);
  }
  const retList: string[] = [];
  list.forEach((rdh, idx) => {
    retList.push(`### [${idx + 1}/${list.length}] ${rdh.meta.tableName} (${rdh.meta.type})`);
    retList.join(os.EOL);
    retList.push(rdhToText(rdh, params));
  });
  retList.join(os.EOL);
  return retList.join(os.EOL);
};

export const rdhToText = (rdh: ResultSetDataHolder, params: WriteToClipboardParams): string => {
  const outputDetail = createOutputDetail(params.outputWithType);
  let ret = "";
  switch (params.fileType) {
    case "csv":
      ret = rdh.toCsv(outputDetail);
      break;
    case "markdown":
      ret = rdh.toMarkdown(outputDetail);
      break;
    case "text":
      ret = rdh.toString({ maxPrintLines: 1000, ...outputDetail });
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
