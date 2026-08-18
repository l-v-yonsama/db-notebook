import type { EstimatedBindParameter } from "@l-v-yonsama/multi-platform-database-drivers";
import { GeneralColumnType } from "@l-v-yonsama/rdh";
import * as DBTypeConst from "@/types/lib/DBType";
import type { BindParameterRow } from "@/utilities/vscode";

// Pure Add/Del/renumber helpers behind BindParametersEditor.vue, kept out of
// the component itself so they stay unit-testable
// (misc/design/performance-tuning-query-statistics-parameter-input-plan.ja.md
// §7.3: "Add / Del / renumberはcomponent内のpure helperへ分離し、unit test
// 可能にする"). None of these ever throw or need a Vue instance.

// crypto.randomUUID() is available in every VS Code webview (Chromium-based,
// same as the design doc's own example at §5.2).
function newRowId(): string {
  return crypto.randomUUID();
}

// Turns a freshly-selected row's estimate (from ToolsViewProvider, always
// value: "") into the editable rows the table starts from.
export function estimatesToRows(estimates: EstimatedBindParameter[]): BindParameterRow[] {
  return estimates.map((estimate) => ({
    ...estimate,
    id: newRowId(),
    value: "",
  }));
}

// A manually-added row has no real position in the SQL text (`location` is
// omitted entirely, not faked as e.g. {line:0,column:0} - the UI shows `-`
// for that the same way it already does for an unresolved estimatedColumn)
// and no resolved column, so it always starts fully `unknown` (§4: "手動
// 追加時はVendor規約から生成する" for the marker only).
export function addBindParameterRow(rows: BindParameterRow[], dbType: string): BindParameterRow[] {
  const next: BindParameterRow = {
    id: newRowId(),
    position: rows.length + 1,
    marker: nextManualMarker(rows, dbType),
    estimatedColumn: undefined,
    estimatedType: GeneralColumnType.UNKNOWN,
    value: "",
  };
  return renumberBindParameterRows([...rows, next]);
}

export function deleteBindParameterRow(rows: BindParameterRow[], id: string): BindParameterRow[] {
  return renumberBindParameterRows(rows.filter((row) => row.id !== id));
}

// Reassigns `position` 1..N in the rows' current order - called after every
// Add/Del so `position` (what actually gets sent as plan.binds' order)
// never drifts from the row's displayed `No`.
export function renumberBindParameterRows(rows: BindParameterRow[]): BindParameterRow[] {
  return rows.map((row, idx) => ({ ...row, position: idx + 1 }));
}

export function updateBindParameterRowValue(
  rows: BindParameterRow[],
  id: string,
  value: string
): BindParameterRow[] {
  return rows.map((row) => (row.id === id ? { ...row, value } : row));
}

// Vendor marker conventions for a manually-added row (§4/§6.2's own
// per-Vendor table, applied in reverse: synthesizing instead of detecting).
// Oracle defaults to the numeric `:N` style rather than guessing a name -
// consistent with the Scanner already sorting numeric markers ahead of
// named ones for both Oracle and SQL Server.
//
// Compares against webview-ui's own local DBType mirror
// (@/types/lib/DBType.ts, same pattern as StatementStatisticsSortKey.ts)
// rather than db-drivers' DBType: that one is a plain exported object, and
// importing it as a *value* (not `import type`) would pull the whole (CJS)
// @l-v-yonsama/multi-platform-database-drivers package - including its AWS
// driver's @aws-sdk/* dependencies - into the webview bundle graph, which
// is exactly what breaks `npm run build:webview`. Every other webview-ui
// file that references a db-drivers export avoids this by using
// `import type` only; this file needs an actual runtime value (used in
// `switch`), so the local mirror sidesteps the package entirely instead.
function nextManualMarker(rows: BindParameterRow[], dbType: string): string {
  const nextNumber = rows.length + 1;
  switch (dbType) {
    case DBTypeConst.DBType.MySQL:
      return "?";
    case DBTypeConst.DBType.Postgres:
      return `$${nextNumber}`;
    case DBTypeConst.DBType.Oracle:
      return `:${nextNumber}`;
    case DBTypeConst.DBType.SQLServer:
      return `@${nextNumber}`;
    default:
      return "?";
  }
}
