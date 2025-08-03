import { ConnectionSetting, normalizeQuery } from "@l-v-yonsama/multi-platform-database-drivers";
import * as os from "os";
import { NotebookCell } from "vscode";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { CellMeta, NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "  [notebook/MqttKernel]";

export class MqttKernel {
  // driver: AwsDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(cell: NotebookCell, variables: NotebookExecutionVariables): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName, publishParams }: CellMeta = cell.metadata;

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
    if (!publishParams?.topicName) {
      return {
        stdout,
        stderr: "Specify the topic name to be used.",
        skipped: false,
        status: "error",
      };
    }
    const driverManager = MqttDriverManager.getInstance(connectionSetting);
    if (!driverManager.isConnected()) {
      return {
        stdout,
        stderr: "Not connected. Please connect at DB resource view.",
        skipped: false,
        status: "error",
      };
    }

    let metadata: RunResult["metadata"] = {};

    try {
      const payload = cell.document.getText();
      log(`${PREFIX} payload:` + payload);

      let startTime = new Date().getTime();
      const packet = await driverManager.publish(publishParams.topicName, payload, {
        qos: publishParams.qos,
        retain: publishParams.retain,
        isJsonMessage: cell.document.languageId === "json",
      });
      metadata.mqttPublishResult = {
        ok: true,
        elapsedTime: new Date().getTime() - startTime,
        subscription: publishParams.topicName,
        payloadLength: payload.length,
      };
      if (packet) {
        metadata.mqttPublishResult.messageId = packet.messageId;
      }

      // this.driver = undefined;
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

  public async requestSql(
    cell: NotebookCell,
    variables: NotebookExecutionVariables
  ): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName, subscribeParams }: CellMeta = cell.metadata;

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

    const driverManager = MqttDriverManager.getInstance(connectionSetting);
    if (!driverManager.isConnected()) {
      return {
        stdout,
        stderr: "Not connected. Please connect at DB resource view.",
        skipped: false,
        status: "error",
      };
    }

    let metadata: RunResult["metadata"] = {};

    try {
      const payload = cell.document.getText();
      log(`${PREFIX} payload:` + payload);

      let startTime = new Date().getTime();

      if (variables._skipSql === true) {
        return {
          stdout,
          stderr: "",
          skipped: true,
          status: "skipped",
          metadata,
        };
      }
      const toPositionedParameter = false; // SQLite
      const toPositionalCharacter = undefined; // SQLite
      const { query, binds } = normalizeQuery({
        query: cell.document.getText(),
        bindParams: variables,
        toPositionedParameter,
        toPositionalCharacter,
      });
      log(`${PREFIX} query:` + query);
      log(`${PREFIX} binds:` + JSON.stringify(binds));

      const result = await driverManager.requestSql({
        sql: query,
        conditions: {
          binds,
        },
        meta: {
          jsonExpansion: subscribeParams?.expandJsonColumn === true,
        },
      });

      if (!result.meta.tableName) {
        result.meta.tableName = `CELL${cell.index + 1}`;
      }
      metadata!.rdh = result;
      metadata!.tableName = result.meta.tableName;
      metadata!.type = result.meta.type;
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
    // if (this.driver) {
    //   log(`${PREFIX} [interrupt] kill`);
    //   const message = await this.driver.kill();
    //   if (message) {
    //     log(`${PREFIX} interrupt result:${message}`);
    //   } else {
    //     log(`${PREFIX} [interrupt] success`);
    //   }
    //   this.driver = undefined;
    // } else {
    //   log(`${PREFIX} No interrupt target`);
    // }
  }
}
