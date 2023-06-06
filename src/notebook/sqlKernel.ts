import { StateStorage } from "../utilities/StateStorage";
import {
  ConnectionSetting,
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetData,
  ResultSetDataBuilder,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult, NotebookExecutionVariables } from "../types/Notebook";
import { NotebookCell } from "vscode";
import { log } from "../utilities/logger";

const PREFIX = "[DBNotebookController]";

export const sqlKernelRun = async (
  cell: NotebookCell,
  stateStorage: StateStorage,
  variables: NotebookExecutionVariables
): Promise<RunResult> => {
  let stdout = "";
  let stderr = "";
  let connectionSetting: ConnectionSetting | undefined = undefined;
  const { connectionName }: CellMeta = cell.metadata;

  if (variables._skipSql === true) {
    return {
      stdout,
      stderr: "Skipped.",
    };
  }
  if (connectionName) {
    connectionSetting = await stateStorage.getConnectionSettingByName(connectionName);
  } else {
    return {
      stdout,
      stderr: "Specify the connection name to be used.",
    };
  }
  if (!connectionSetting) {
    return {
      stdout,
      stderr: "Missing connection " + connectionName,
    };
  }

  const { query, binds } = normalizeQuery({
    query: cell.document.getText(),
    bindParams: variables,
  });
  log(`${PREFIX} query:` + query);
  log(`${PREFIX} binds:` + JSON.stringify(binds));

  const { ok, message, result } = await DBDriverResolver.getInstance().workflow<
    RDSBaseDriver,
    ResultSetData
  >(
    connectionSetting,
    async (driver) =>
      await driver.requestSql({
        sql: query,
        conditions: {
          binds,
        },
      })
  );

  let metadata = undefined;
  if (ok && result) {
    if (!result.meta.tableName) {
      result.meta.tableName = `CELL${cell.index + 1}`;
    }
    metadata = { rdh: result };
  } else {
    stderr = message;
  }

  return {
    stdout,
    stderr,
    metadata,
  };
};
