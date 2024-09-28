import {
  ConnectionSetting,
  DBDriverResolver,
  RDSBaseDriver,
  hasSetVariableClause,
  normalizeQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as os from "os";
import { NotebookCell } from "vscode";
import { CellMeta, NotebookExecutionVariables, RunResult, SQLMode } from "../types/Notebook";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "  [notebook/SqlKernel]";

export class SqlKernel {
  driver: RDSBaseDriver | undefined;
  constructor(private stateStorage: StateStorage) {}

  public async run(
    cell: NotebookCell,
    variables: NotebookExecutionVariables,
    sqlMode: SQLMode
  ): Promise<RunResult> {
    let stdout = "";
    let stderrs: string[] = [];
    let connectionSetting: ConnectionSetting | undefined = undefined;
    const { connectionName }: CellMeta = cell.metadata;

    if (variables._skipSql === true) {
      return {
        stdout,
        stderr: "",
        skipped: true,
        status: "skipped",
      };
    }
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
      const driver = resolver.createSQLSupportDriver(connectionSetting);
      const toPositionedParameter = driver.isPositionedParameterAvailable();
      const toPositionalCharacter = driver.getPositionalCharacter();
      const { query, binds } = normalizeQuery({
        query: cell.document.getText(),
        bindParams: variables,
        toPositionedParameter,
        toPositionalCharacter,
      });
      log(`${PREFIX} query:` + query);
      log(`${PREFIX} binds:` + JSON.stringify(binds));

      if (sqlMode === "ExplainAnalyze") {
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

      if (sqlMode === "Explain") {
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

      if (sqlMode === "Query") {
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
          if (hasSetVariableClause(query)) {
            stderrs.push(
              `If you want to use variables, use bind parameters.\nSee: https://github.com/l-v-yonsama/db-notebook/blob/main/docs/examples/databaseNotebook.md#11-bind-parameters-in-query`
            );
          }
        }
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
