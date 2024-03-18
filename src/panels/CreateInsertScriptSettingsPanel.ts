import {
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  env,
  NotebookCellData,
  commands,
  NotebookCellKind,
} from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { ComponentName } from "../shared/ComponentName";
import { CreateInsertScriptSettingsPanelEventData } from "../shared/MessageEventData";
import { getIconPath } from "../utilities/fsUtil";
import {
  DbTable,
  RdhKey,
  createRdhKey,
  isNumericLike,
  isTextLike,
  toInsertStatement,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { BasePanel } from "./BasePanel";
import { CreateScriptConditionParams } from "../shared/CreateScriptConditionParams";
import { CREATE_NEW_NOTEBOOK } from "../constant";
import { CellMeta } from "../types/Notebook";

const PREFIX = "[CreateInsertScriptSettingsPanel]";

export class CreateInsertScriptSettingsPanel extends BasePanel {
  public static currentPanel: CreateInsertScriptSettingsPanel | undefined;
  private schemaName?: string;
  private tableRes?: DbTable;
  private assignSchemaName = true;
  private onlyNotNullColumns = false;
  private withComments = true;
  private compactSql = false;
  private langType: "sql" | "javascript" = "sql";

  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    CreateInsertScriptSettingsPanel.currentPanel = new CreateInsertScriptSettingsPanel(
      panel,
      extensionUri
    );
  }

  getComponentName(): ComponentName {
    return "CreateInsertScriptSettingsPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok": {
        const { preview, openInNotebook } = params as CreateScriptConditionParams;

        this.assignSchemaName = (params as CreateScriptConditionParams).assignSchemaName;
        this.onlyNotNullColumns = (params as CreateScriptConditionParams).onlyNotNullColumns;
        this.withComments = (params as CreateScriptConditionParams).withComments;
        this.compactSql = (params as CreateScriptConditionParams).compactSql;
        this.langType = (params as CreateScriptConditionParams).lang;

        const previewSql = this.createPreviewText();
        if (openInNotebook) {
          const cell = new NotebookCellData(NotebookCellKind.Code, previewSql, this.langType);
          const metadata: CellMeta = {
            connectionName: this.tableRes?.meta?.conName,
          };
          cell.metadata = metadata;

          commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
          this.dispose();
        } else {
          if (preview) {
            // send to webview
            const msg: CreateInsertScriptSettingsPanelEventData = {
              command: "set-preview-sql",
              componentName: "CreateInsertScriptSettingsPanel",
              value: {
                setPreviewSql: {
                  previewSql,
                },
              },
            };
            this.panel.webview.postMessage(msg);
          } else {
            env.clipboard.writeText(previewSql);
            this.dispose();
          }
        }
      }
    }
  }

  protected preDispose(): void {
    CreateInsertScriptSettingsPanel.currentPanel = undefined;
  }

  public static render(extensionUri: Uri, schemaName: string, tableRes: DbTable) {
    if (CreateInsertScriptSettingsPanel.currentPanel) {
      CreateInsertScriptSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "CreateInsertScriptSettingsPanelType",
        "CreateInsertScriptSettingsPanel",
        ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      panel.iconPath = getIconPath("output.svg");
      CreateInsertScriptSettingsPanel.currentPanel = new CreateInsertScriptSettingsPanel(
        panel,
        extensionUri
      );
    }
    CreateInsertScriptSettingsPanel.currentPanel.schemaName = schemaName;
    CreateInsertScriptSettingsPanel.currentPanel.tableRes = tableRes;
    CreateInsertScriptSettingsPanel.currentPanel.renderSub();
  }

  async renderSub(): Promise<void> {
    if (!this.tableRes) {
      return;
    }
    const previewSql = this.createPreviewText();
    const msg: CreateInsertScriptSettingsPanelEventData = {
      command: "initialize",
      componentName: "CreateInsertScriptSettingsPanel",
      value: {
        initialize: {
          tableRes: this.tableRes,
          assignSchemaName: this.assignSchemaName,
          onlyNotNullColumns: this.onlyNotNullColumns,
          withComments: this.withComments,
          compactSql: this.compactSql,
          langType: this.langType,
          previewSql,
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }

  private createPreviewText(): string {
    if (!this.tableRes) {
      return "";
    }
    const { name, children, comment, meta } = this.tableRes;
    const { conName } = meta;

    const columns: RdhKey[] = [];
    const values: { [key: string]: any } = {};

    children
      .filter((it) => it.nullable === false || this.onlyNotNullColumns === false)
      .forEach((it) => {
        columns.push(
          createRdhKey({
            name: it.name,
            type: it.colType,
            comment: it.comment,
          })
        );

        if (isTextLike(it.colType)) {
          values[it.name] = "";
        } else if (isNumericLike(it.colType)) {
          values[it.name] = 0;
        } else {
          values[it.name] = null;
        }
      });

    if (this.langType === "sql") {
      const { query } = toInsertStatement({
        schemaName: this.assignSchemaName === true ? this.schemaName : undefined,
        tableName: name,
        tableComment: comment,
        columns,
        values,
        bindOption: { specifyValuesWithBindParameters: false },
        compactSql: this.compactSql,
        withComment: this.withComments,
      });

      return query;
    }

    // js
    const tableNameWithSchema =
      this.assignSchemaName && this.schemaName ? `${this.schemaName}.${name}` : name;
    const contents: string[] = [];
    contents.push(`const setting = getConnectionSettingByName('${conName}');`);
    contents.push(
      `const { ok, message, result } = await DBDriverResolver.getInstance().flowTransaction(setting, async (driver) => {`
    );
    contents.push(`  const bindParams = {};`);
    Object.keys(values).forEach((name) => {
      const column = children.find((column) => column.name === name);
      if (this.withComments && column?.comment) {
        contents.push(
          `  bindParams['${name}'] = ${JSON.stringify(values[name])}; // ${column.comment}`
        );
      } else {
        contents.push(`  bindParams['${name}'] = ${JSON.stringify(values[name])};`);
      }
    });
    contents.push(``);
    contents.push(`  const { query, binds } = normalizeQuery({`);
    contents.push(
      `    query: 'INSERT INTO ${tableNameWithSchema} (${columns
        .map((it) => it.name)
        .join(",")}) VALUES (${columns.map((it) => ":" + it.name).join(",")})',`
    );
    contents.push(`    bindParams,`);
    contents.push(`    toPositionedParameter: driver.isPositionedParameterAvailable(),`);
    contents.push(`  });`);
    contents.push(``);
    contents.push(`  return await driver.requestSql({ sql: query, conditions: { binds } });`);
    contents.push(`}, { transactionControlType: 'rollbackOnError' });`);
    contents.push(``);
    contents.push(`console.log('ok', ok);`);
    contents.push(`console.log('message', message);`);
    contents.push(`if (ok && result) {`);
    contents.push(`  writeResultSetData('title', result);`);
    contents.push(`}`);
    contents.push(``);

    return contents.join("\n");
  }
}
