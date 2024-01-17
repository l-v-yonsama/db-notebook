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
import * as os from "os";

const PREFIX = "  [notebook/SqlKernel]";

export class SqlKernel {
  driver: RDSBaseDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(cell: NotebookCell, variables: NotebookExecutionVariables): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName, markWithExplain, markWithExplainAnalyze, markWithinQuery }: CellMeta =
      cell.metadata;

    if (variables._skipSql === true) {
      return {
        stdout,
        stderr: "",
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

    const resolver = DBDriverResolver.getInstance();
    const toPositionedParameter = resolver
      .createDriver<RDSBaseDriver>(connectionSetting)
      .isPositionedParameterAvailable();
    const { query, binds } = normalizeQuery({
      query: cell.document.getText(),
      bindParams: variables,
      toPositionedParameter,
    });
    log(`${PREFIX} query:` + query);
    log(`${PREFIX} binds:` + JSON.stringify(binds));

    let metadata: RunResult["metadata"] = {};

    if (markWithExplainAnalyze) {
      const { message } = await resolver.flowTransaction<RDSBaseDriver>(
        connectionSetting,
        async (driver) => {
          this.driver = driver;
          metadata!.analyzedRdh = await driver.explainAnalyzeSql({
            sql: query,
            conditions: {
              binds,
            },
          });
        },
        {
          transactionControlType: "alwaysRollback",
        }
      );

      if (message) {
        stderrs.push(`Explain Analyze Error: ${message}`);
      }
    }

    if (markWithExplain) {
      const { message } = await resolver.workflow<RDSBaseDriver>(
        connectionSetting,
        async (driver) => {
          this.driver = driver;
          metadata!.explainRdh = await driver.explainSql({
            sql: query,
            conditions: {
              binds,
            },
          });
        }
      );
      if (message) {
        stderrs.push(`Explain Error: ${message}`);
      }
    }

    if (markWithinQuery !== false) {
      const { ok, message, result } = await resolver.workflow<RDSBaseDriver, ResultSetData>(
        connectionSetting,
        async (driver) => {
          this.driver = driver;
          return await driver.requestSql({
            sql: query,
            conditions: {
              binds,
            },
          });
        }
      );
      if (ok && result) {
        if (!result.meta.tableName) {
          result.meta.tableName = `CELL${cell.index + 1}`;
        }
        metadata!.rdh = result;
        metadata!.tableName = result.meta.tableName;
        metadata!.type = result.meta.type;
      } else {
        stderrs.push(`Execute query Error: ${message}`);
      }
    }
    this.driver = undefined;

    return {
      stdout,
      stderr: stderrs.join(os.EOL),
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
