import {
  BaseSQLSupportDriver,
  DBDriverResolver,
  DbDynamoTable,
  DbTable,
  toDeleteStatement,
  toInsertStatement,
  toUpdateStatement,
  toViewDataNormalizedQuery,
  toViewDataQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import {
  commands,
  NotebookCellData,
  NotebookCellKind,
  NotebookEdit,
  ProgressLocation,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  CREATE_NEW_NOTEBOOK,
  NOTEBOOK_TYPE,
  OPEN_MDH_VIEWER,
  REFRESH_SQL_HISTORIES,
} from "../constant";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { ViewConditionPanelEventData } from "../shared/MessageEventData";
import { SaveValuesInRdhParams } from "../shared/SaveValuesInRdhParams";
import { ViewConditionParams } from "../shared/ViewConditionParams";
import { CellMeta } from "../types/Notebook";
import { MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getDatabaseConfig } from "../utilities/configUtil";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[ViewConditionPanel]";

export class ViewConditionPanel extends BasePanel {
  public static currentPanel: ViewConditionPanel | undefined;
  private static stateStorage?: StateStorage;
  private tableRes: DbTable | DbDynamoTable | undefined;
  private supportEditMode = false;
  private numOfRowsLabel = "Current rows";
  private numOfRows = 0;
  private limit = getDatabaseConfig().limitRows;
  private rdhForUpdate?: ResultSetData;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    ViewConditionPanel.currentPanel = new ViewConditionPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    ViewConditionPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, tableRes: DbTable | DbDynamoTable, numOfRows: number) {
    if (ViewConditionPanel.currentPanel) {
      ViewConditionPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "ViewConditionPanelType",
        "View condition settings",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      ViewConditionPanel.currentPanel = new ViewConditionPanel(panel, extensionUri);
    }

    // Clone resource
    ViewConditionPanel.currentPanel.tableRes = tableRes;

    if (ViewConditionPanel.currentPanel.tableRes instanceof DbTable) {
      ViewConditionPanel.currentPanel.supportEditMode = true;
      ViewConditionPanel.currentPanel.numOfRowsLabel = "Current rows";
    } else {
      ViewConditionPanel.currentPanel.supportEditMode = true;
      ViewConditionPanel.currentPanel.numOfRowsLabel = "Estimated rows";
    }
    ViewConditionPanel.currentPanel.numOfRows = Math.min(100000, numOfRows);
    ViewConditionPanel.currentPanel.renderSub();
  }

  getComponentName(): ComponentName {
    return "ViewConditionPanel";
  }

  async renderSub() {
    if (!this.tableRes) {
      return;
    }
    const previewSql = await this.getPreviewSql({ all: [] }, false);
    const msg: ViewConditionPanelEventData = {
      command: "initialize",
      componentName: "ViewConditionPanel",
      value: {
        initialize: {
          tableRes: this.tableRes,
          limit: this.limit,
          numOfRows: this.numOfRows,
          previewSql,
          supportEditMode: this.supportEditMode,
          numOfRowsLabel: this.numOfRowsLabel,
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }

  public preDispose(): void {
    ViewConditionPanel.currentPanel = undefined;
  }

  private async getPreviewSql(
    conditions: ViewConditionParams["conditions"],
    specfyCondition: boolean
  ): Promise<string> {
    const { tableRes } = this;
    if (!tableRes || !ViewConditionPanel.stateStorage) {
      return "";
    }
    const { conName, schemaName } = tableRes.meta;
    const setting = await ViewConditionPanel.stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return "";
    }
    const driver = DBDriverResolver.getInstance().createSQLSupportDriver(setting);
    const isPositionedParameterAvailable = driver.isPositionedParameterAvailable();
    const toPositionalCharacter = driver.getPositionalCharacter();
    const isLimitAsTop = driver.isLimitAsTop();
    const isSchemaSpecificationSvailable = driver.isSchemaSpecificationSvailable();
    const sqlLang = driver.getSqlLang();

    try {
      const { query } = toViewDataNormalizedQuery({
        tableRes,
        schemaName: isSchemaSpecificationSvailable ? schemaName : undefined,
        toPositionedParameter: isPositionedParameterAvailable,
        toPositionalCharacter: toPositionalCharacter,
        limitAsTop: isLimitAsTop,
        conditions: specfyCondition ? conditions : undefined,
        limit: this.limit,
        sqlLang,
      });

      return query + "";
    } catch (_) {
      return "";
    }
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "saveValues":
        this.saveValues(params);
        break;
      case "cancel":
        this.dispose();
        return;
      case "ok":
        this.okProcess(params);
        break;
      default:
        break;
    }
  }

  private async okProcess(params: ViewConditionParams) {
    const { conditions, specfyCondition, limit, editable, preview } = params;

    if (preview) {
      this.limit = limit;
      const previewSql = await this.getPreviewSql(conditions, specfyCondition);

      if (params.openInNotebook) {
        const { tableRes } = this;
        if (!tableRes || !ViewConditionPanel.stateStorage) {
          return "";
        }
        const { conName, schemaName } = tableRes.meta;
        const cell = new NotebookCellData(NotebookCellKind.Code, previewSql, "sql");
        const metadata: CellMeta = {
          connectionName: conName,
        };
        cell.metadata = metadata;

        if (params.inActiveNotebook) {
          this.dispose();

          setTimeout(async () => {
            const activeEditor = window.activeNotebookEditor;

            if (activeEditor && activeEditor.notebook.notebookType === NOTEBOOK_TYPE) {
              const edit = new WorkspaceEdit();
              const notebookEdit = NotebookEdit.insertCells(activeEditor.selection.end, [cell]);
              edit.set(activeEditor.notebook.uri, [notebookEdit]);
              await workspace.applyEdit(edit);
            } else {
              showWindowErrorMessage("No active notebook editor found.");
              return;
            }
          }, 100);
        } else {
          // Create a new notebook with the cell
          commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
        }
        this.dispose();
      }

      // send to webview
      const msg: ViewConditionPanelEventData = {
        command: "set-preview-sql",
        componentName: "ViewConditionPanel",
        value: {
          setPreviewSql: {
            previewSql,
          },
        },
      };
      this.panel.webview.postMessage(msg);

      return;
    }

    const { tableRes } = this;
    if (!tableRes || !ViewConditionPanel.stateStorage) {
      return;
    }
    const { conName, schemaName } = tableRes.meta;
    const setting = await ViewConditionPanel.stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }

    const { ok, message, result } = await DBDriverResolver.getInstance().workflow<
      BaseSQLSupportDriver,
      ResultSetData
    >(setting, async (driver) => {
      const { query, binds } = toViewDataNormalizedQuery({
        tableRes,
        schemaName: driver.isSchemaSpecificationSvailable() ? schemaName : undefined,
        toPositionedParameter: driver.isPositionedParameterAvailable(),
        toPositionalCharacter: driver.getPositionalCharacter(),
        conditions: specfyCondition ? conditions : undefined,
        limit: this.limit,
        limitAsTop: driver.isLimitAsTop(),
        sqlLang: driver.getSqlLang(),
      });

      log(`${PREFIX} query:[${query}]`);
      log(`${PREFIX} binds:[${binds}]`);
      return await driver.requestSql({
        sql: query,
        conditions: {
          binds,
        },
        meta: {
          tableName: tableRes.name,
          compareKeys: tableRes.getCompareKeys(),
          comment: tableRes.comment,
          editable,
        },
      });
    });

    if (ok && result) {
      const driver = DBDriverResolver.getInstance().createSQLSupportDriver(setting);

      const { query, binds } = toViewDataQuery({
        tableRes,
        schemaName,
        conditions: specfyCondition ? conditions : undefined,
        limit: this.limit,
        limitAsTop: driver.isLimitAsTop(),
      });
      await ViewConditionPanel.stateStorage.addSQLHistory({
        connectionName: conName,
        sqlDoc: query,
        variables: binds,
        meta: result.meta,
        summary: result.summary,
      });
      commands.executeCommand(REFRESH_SQL_HISTORIES);
      if (editable) {
        this.rdhForUpdate = result;
        const msg: ViewConditionPanelEventData = {
          command: "set-rdh-for-update",
          componentName: "ViewConditionPanel",
          value: {
            rdhForUpdate: result,
          },
        };
        this.panel.webview.postMessage(msg);
      } else {
        const commandParam: MdhViewParams = { title: tableRes.name, list: [result] };
        commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
        this.dispose();
      }
    } else {
      showWindowErrorMessage(message);
      this.dispose();
    }
  }

  private async saveValues(params: SaveValuesInRdhParams) {
    const rdh = this.rdhForUpdate;
    if (rdh === undefined) {
      return;
    }
    const { connectionName, tableName } = rdh.meta;
    if (connectionName === undefined || tableName === undefined) {
      return;
    }

    const setting = await ViewConditionPanel.stateStorage?.getConnectionSettingByName(
      connectionName
    );
    if (!setting) {
      return;
    }

    const { insertList, updateList, deleteList } = params;
    const totalCount = insertList.length + updateList.length + deleteList.length;
    const increment = Math.floor(100 / totalCount);
    const { ok, message } = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        return await DBDriverResolver.getInstance().workflow<BaseSQLSupportDriver>(
          setting,
          async (driver) => {
            const toPositionedParameter = driver.isPositionedParameterAvailable();
            const toPositionalCharacter = driver.getPositionalCharacter();
            const sqlLang = driver.getSqlLang();

            let errorMessage = "";
            for (let i = 0; i < insertList.length; i++) {
              const prefix = `INSERT[${i + 1}/${insertList.length}] `;
              const { values } = insertList[i];
              try {
                const { query, binds } = toInsertStatement({
                  tableName,
                  columns: rdh.keys,
                  values,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                    toPositionalCharacter,
                  },
                  sqlLang,
                });
                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e) {
                if (e instanceof Error) {
                  errorMessage = e.message;
                  logError(`${prefix} NG:${e.message}`);
                } else {
                  errorMessage = "Error:" + e;
                  logError(`${prefix} NG:${e}`);
                }
              }
              progress.report({
                message: `Inserted [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            for (let i = 0; i < updateList.length; i++) {
              const prefix = `UPDATE[${i + 1}/${updateList.length}] `;
              const { values, conditions } = updateList[i];
              try {
                const { query, binds } = toUpdateStatement({
                  tableName,
                  columns: rdh.keys,
                  values,
                  conditions,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                    toPositionalCharacter,
                  },
                  sqlLang,
                });

                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e) {
                if (e instanceof Error) {
                  errorMessage = e.message;
                  logError(`${prefix} NG:${e.message}`);
                } else {
                  errorMessage = "Error:" + e;
                  logError(`${prefix} NG:${e}`);
                }
              }
              progress.report({
                message: `Updated [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            for (let i = 0; i < deleteList.length; i++) {
              const prefix = `DELETE[${i + 1}/${deleteList.length}] `;
              const { conditions } = deleteList[i];
              try {
                const { query, binds } = toDeleteStatement({
                  tableName,
                  columns: rdh.keys,
                  conditions,
                  bindOption: {
                    specifyValuesWithBindParameters: true,
                    toPositionedParameter,
                    toPositionalCharacter,
                  },
                  sqlLang,
                });
                log(`${prefix} sql:[${query}]`);
                log(`${prefix} binds:${JSON.stringify(binds)}`);

                const r = await driver.requestSql({
                  sql: query,
                  conditions: {
                    binds,
                  },
                });
                log(`${prefix} OK`);
              } catch (e) {
                if (e instanceof Error) {
                  errorMessage = e.message;
                  logError(`${prefix} NG:${e.message}`);
                } else {
                  errorMessage = "Error:" + e;
                  logError(`${prefix} NG:${e}`);
                }
              }
              progress.report({
                message: `Deleted [${i + 1}/${insertList.length}]`,
                increment,
              });
            }

            progress.report({
              increment: 100,
            });
            if (errorMessage) {
              throw new Error(errorMessage);
            }
          }
        );
      }
    );
    if (ok) {
      window.showInformationMessage("OK");
      this.dispose();
    } else if (message) {
      showWindowErrorMessage(message);
    }
  }
}
