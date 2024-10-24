import {
  AwsDriver,
  ConnectionSetting,
  DBDriverResolver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as os from "os";
import { NotebookCell } from "vscode";
import { CellMeta, NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "  [notebook/AwsKernel]";

export class AwsKernel {
  driver: AwsDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(cell: NotebookCell, variables: NotebookExecutionVariables): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName, logGroupName, logGroupStartTimeOffset }: CellMeta = cell.metadata;

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
    if (!logGroupName) {
      return {
        stdout,
        stderr: "Specify the logGroup name to be used.",
        skipped: false,
        status: "error",
      };
    }
    if (!logGroupStartTimeOffset) {
      return {
        stdout,
        stderr: "Specify the logGroup query start time offset.",
        skipped: false,
        status: "error",
      };
    }

    let metadata: RunResult["metadata"] = {};

    try {
      const resolver = DBDriverResolver.getInstance();

      const queryString = cell.document.getText();
      log(`${PREFIX} queryString:` + queryString);

      const { ok, message, result } = await resolver.workflow<AwsDriver, ResultSetData>(
        connectionSetting,
        async (driver) => {
          this.driver = driver;
          const now = Math.round(new Date().getTime() / 1000);
          let startTime: number;
          switch (logGroupStartTimeOffset) {
            case "1m":
              startTime = now - 60;
              break;
            case "5m":
              startTime = now - 60 * 5;
              break;
            case "15m":
              startTime = now - 60 * 15;
              break;
            case "30m":
              startTime = now - 60 * 30;
              break;
            case "1h":
              startTime = now - 60 * 60;
              break;
            case "6h":
              startTime = now - 60 * 60 * 6;
              break;
            case "12h":
              startTime = now - 60 * 60 * 12;
              break;
            case "1d":
              startTime = now - 60 * 60 * 24;
              break;
            case "1w":
              startTime = now - 60 * 60 * 24 * 7;
              break;
            default:
              throw new Error("Invalid logGroupStartTimeOffset");
          }
          return await driver.cloudwatchClient.scan({
            limit: undefined as unknown as number,
            keyword: queryString,
            target: logGroupName,
            targetResourceType: "LogGroup",
            startTime,
            endTime: now,
          });
        }
      );
      if (ok && result) {
        if (!result.meta.tableName) {
          result.meta.tableName = `CELL${cell.index + 1}`;
        }
        metadata!.rdh = result;
        metadata!.type = "select";
      } else {
        stderrs.push(`Execute query Error: ${message}`);
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
