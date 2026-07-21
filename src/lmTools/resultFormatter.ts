import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";

export function formatRdhForModel(rdh: ResultSetData, limit: number): string {
  const affected = rdh.summary?.affectedRows;
  if (rdh.rows.length === 0 && affected !== undefined) {
    return `OK. ${affected} row(s) affected.`;
  }
  return ResultSetDataBuilder.from(rdh).toString({ maxPrintLines: limit });
}
