import {
  ConnectionSetting,
  DBDriverResolver,
  MemcacheDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as os from "os";
import { NotebookCell } from "vscode";
import { CellMeta, NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "  [notebook/MemcachedKernel]";

export class MemcachedKernel {
  driver: MemcacheDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(cell: NotebookCell, variables: NotebookExecutionVariables): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName }: CellMeta = cell.metadata;

    if (connectionName) {
      connectionSetting = await this.stateStorage.getConnectionSettingByName(connectionName);
    } else {
      return {
        stdout,
        stderr: "Specify the connection name to be used.",
        skipped: false,
        status: "error",
      };
    }
    if (!connectionSetting) {
      return {
        stdout,
        stderr: "Missing connection " + connectionName,
        skipped: false,
        status: "error",
      };
    }

    let metadata: RunResult["metadata"] = {};

    try {
      const resolver = DBDriverResolver.getInstance();

      const commandString = cell.document.getText();
      log(`${PREFIX} Command:` + commandString);

      const { ok, message, result } = await resolver.workflow<MemcacheDriver, ResultSetData>(
        connectionSetting,
        async (driver) => {
          this.driver = driver;
          return await driver.executeCommand(commandString);
        }
      );
      if (ok && result) {
        if (!result.meta.tableName) {
          result.meta.tableName = `CELL${cell.index + 1}`;
        }
        metadata!.rdh = result;
        metadata!.type = "select";
      } else {
        stderrs.push(`Execute Command Error: ${message}`);
      }

      this.driver = undefined;
    } catch (e) {
      let message = e instanceof Error ? e.message : e + "";
      logError(`${PREFIX} ${message}`);
      stderrs.push(message);
    }

    return {
      stdout,
      stderr: stderrs.join(os.EOL),
      skipped: false,
      status: stderrs.length > 0 ? "error" : "executed",
      metadata,
    };
  }

  async interrupt(): Promise<void> {
    if (this.driver) {
      log(`${PREFIX} [interrupt] disconnect`);
      const message = await this.driver.disconnect();
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
