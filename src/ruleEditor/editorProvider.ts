import {
  CancellationToken,
  CustomTextEditorProvider,
  Disposable,
  ExtensionContext,
  Range,
  TextDocument,
  WebviewPanel,
  WorkspaceEdit,
  window,
  workspace,
} from "vscode";

import { RECORD_RULE_TYPE } from "../constant";
import { createWebviewContent } from "../utilities/webviewUtil";
import { RecordRule } from "../shared/RecordRule";
import { ActionCommand, UpdateTextDocumentActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { DbSchema, RdsDatabase } from "@l-v-yonsama/multi-platform-database-drivers";
import { ComponentName } from "../shared/ComponentName";
import { RecordRuleEditorEventData } from "../shared/MessageEventData";

const PREFIX = "[RecordRuleEditorProvider]";
const componentName: ComponentName = "RecordRuleEditor";

export class RecordRuleEditorProvider implements CustomTextEditorProvider {
  private scrollPos: number = 0;

  public static register(context: ExtensionContext, stateStorage: StateStorage): Disposable {
    const provider = new RecordRuleEditorProvider(context, stateStorage);
    const providerRegistration = window.registerCustomEditorProvider(RECORD_RULE_TYPE, provider);
    return providerRegistration;
  }

  constructor(private readonly context: ExtensionContext, private stateStorage: StateStorage) {}

  public async resolveCustomTextEditor(
    document: TextDocument,
    webviewPanel: WebviewPanel,
    _token: CancellationToken
  ): Promise<void> {
    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };
    //    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    webviewPanel.webview.html = createWebviewContent(
      webviewPanel.webview,
      this.context.extensionUri,
      componentName
    );

    const updateWebview = async () => {
      log(`${PREFIX} updateWebview`);

      const recordRule = this.parseDoc(document);
      const connectionSettingNames = this.stateStorage.getConnectionSettingNames();
      let schema: DbSchema | undefined = undefined;
      if (recordRule.editor.connectionName) {
        let dbs = this.stateStorage.getResourceByName(recordRule.editor.connectionName);
        if (dbs === undefined) {
          const { ok, result } = await this.stateStorage.loadResource(
            recordRule.editor.connectionName,
            false,
            true
          );
          if (ok) {
            dbs = result;
          }
        }
        if (dbs && dbs[0] instanceof RdsDatabase) {
          schema = (dbs[0] as RdsDatabase).getSchema({ name: recordRule.editor.schemaName });
        }
      }
      const msg: RecordRuleEditorEventData = {
        command: "initialize",
        componentName: "RecordRuleEditor",
        value: {
          initialize: {
            connectionSettingNames,
            schema,
            recordRule,
            scrollPos: this.scrollPos,
          },
        },
      };
      webviewPanel.webview.postMessage(msg);
    };

    const changeDocumentSubscription = workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const changeViewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        log(`${PREFIX} onDidChangeViewState ${e}`);
        updateWebview();
      }
    });

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      log(`${PREFIX} webviewPanel.onDidDispose`);

      this.scrollPos = 0;
      changeDocumentSubscription.dispose();
      changeViewStateSubscription.dispose();
    });

    // Receive message from the webview.
    webviewPanel.webview.onDidReceiveMessage(async (message: ActionCommand) => {
      const { command, params } = message;
      log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
      switch (command) {
        case "cancel":
          webviewPanel.dispose();
          return;
        case "updateTextDocument":
          await this.updateTextDocument(document, params);
          // updateWebview();
          break;
      }
    });

    updateWebview();
  }

  private async updateTextDocument(
    document: TextDocument,
    params: UpdateTextDocumentActionCommand["params"]
  ) {
    const { newText, values, scrollPos } = params;
    this.scrollPos = scrollPos;
    const edit = new WorkspaceEdit();

    const recordRule = JSON.parse(newText) as RecordRule;
    if (values) {
      switch (values.name) {
        case "cancel":
          {
            const { editor } = recordRule;
            editor.visible = false;
            editor.item = undefined;
            editor.editingItemIndex = undefined;
          }
          break;
        case "save-rule":
          {
            const { tableRule, editor } = recordRule;
            if (editor.editingItemIndex === undefined) {
              tableRule.details.push(editor.item!);
            } else {
              tableRule.details.splice(editor.editingItemIndex, 1, editor.item!);
            }
            editor.visible = false;
            editor.item = undefined;
            editor.editingItemIndex = undefined;
          }
          break;
        case "add-rule":
          {
            if (recordRule.editor === undefined) {
              recordRule.editor = {
                visible: true,
                connectionName: "",
                schemaName: "",
                tableName: "",
              };
            }
            recordRule.editor.editingItemIndex = undefined;
            recordRule.editor.visible = true;
            recordRule.editor.item = {
              ruleName: "",
              error: {
                column: "",
                limit: 100,
              },
              conditions: {
                any: [],
              },
            };
          }
          break;
        case "delete-rule":
          {
            const index = (values.detail as number) ?? 0;
            recordRule.tableRule.details.splice(index, 1);
          }
          break;
        case "edit-rule":
          {
            const index = (values.detail as number) ?? 0;
            if (recordRule.editor === undefined) {
              recordRule.editor = {
                visible: true,
                connectionName: "",
                schemaName: "",
                tableName: "",
              };
            }
            recordRule.editor.editingItemIndex = index;
            recordRule.editor.visible = true;
            const original = recordRule.tableRule.details[index];
            recordRule.editor.item = {
              ...original,
            };
          }
          break;
        case "duplicate-rule":
          {
            const index = (values.detail as number) ?? 0;
            if (recordRule.editor === undefined) {
              recordRule.editor = {
                visible: true,
                connectionName: "",
                schemaName: "",
                tableName: "",
              };
            }
            recordRule.editor.editingItemIndex = undefined;
            recordRule.editor.visible = true;
            const original = recordRule.tableRule.details[index];
            recordRule.editor.item = {
              ...original,
              ruleName: "Copy of " + original.ruleName,
            };
          }
          break;
        case "change":
          {
            if (values.detail === "connectionName") {
              let dbs = this.stateStorage.getResourceByName(recordRule.editor.connectionName);
              if (dbs === undefined) {
                const { ok, result } = await this.stateStorage.loadResource(
                  recordRule.editor.connectionName,
                  false,
                  true
                );
                if (ok) {
                  dbs = result;
                }
              }
              if (dbs && dbs[0] instanceof RdsDatabase) {
                recordRule.editor.schemaName = dbs[0].getSchema({ isDefault: true }).name;
              }
            }
          }
          break;
      }
    }
    // Just replace the entire document every time for this example extension.
    // A more complete extension should compute minimal edits instead.
    edit.replace(
      document.uri,
      new Range(0, 0, document.lineCount, 0),
      JSON.stringify(recordRule, null, 1)
    );
    console.log("applyEdit forSave ", recordRule);
    return workspace.applyEdit(edit);
  }

  private parseDoc(doc: TextDocument): RecordRule {
    const text = doc.getText();
    if (text.length) {
      return JSON.parse(text) as RecordRule;
    }
    return {
      tableRule: {
        table: "",
        details: [],
      },
      editor: {
        connectionName: "",
        schemaName: "",
        tableName: "",
        visible: false,
      },
    };
  }
}
