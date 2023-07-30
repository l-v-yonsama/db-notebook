import { StateStorage } from "../utilities/StateStorage";
import {
  ConnectionSetting,
  DBDriverResolver,
  RDSBaseDriver,
  ResultSetData,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { CellMeta, RunResult, NotebookExecutionVariables } from "../types/Notebook";
import { NotebookCell } from "vscode";
import { log } from "../utilities/logger";

const PREFIX = "  [notebook/SqlKernel]";

export class SqlKernel {
  driver: RDSBaseDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(cell: NotebookCell, variables: NotebookExecutionVariables): Promise<RunResult> {
    let stdout = "";
    let stderr = "";
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName }: CellMeta = cell.metadata;

    if (variables._skipSql === true) {
      return {
        stdout,
        stderr,
        skipped: true,
      };
    }
    if (connectionName) {
      connectionSetting = await this.stateStorage.getConnectionSettingByName(connectionName);
    } else {
      return {
        stdout,
        stderr: "Specify the connection name to be used.",
        skipped: false,
      };
    }
    if (!connectionSetting) {
      return {
        stdout,
        stderr: "Missing connection " + connectionName,
        skipped: false,
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
    >(connectionSetting, async (driver) => {
      this.driver = driver;
      return await driver.requestSql({
        sql: query,
        conditions: {
          binds,
        },
      });
    });
    this.driver = undefined;

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
      skipped: false,
      metadata,
    };
  }

  async interrupt(): Promise<void> {
    if (this.driver) {
      log(`${PREFIX} [interrupt] kill`);
      const message = await this.driver.kill();
      if (message) {
        log(`${PREFIX} interrupt result:${message}`);
      } else {
        log(`${PREFIX} [interrupt] success`);
      }
      this.driver = undefined;
    } else {
      log(`${PREFIX} No interrupt target`);
    }
  }
}
