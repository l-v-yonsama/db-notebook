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
import { ToWebviewMessageEventType } from "../types/ToWebviewMessageEvent";
import { ConditionOperator, RecordRule } from "../shared/RecordRule";
import { ActionCommand, UpdateTextDocumentActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { DbSchema, RdsDatabase } from "@l-v-yonsama/multi-platform-database-drivers";

const PREFIX = "[RecordRuleEditorProvider]";
const componentName = "RecordRuleEditor";

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
      this.context.extensionUri
    );

    const updateWebview = async () => {
      const recordRule = this.parseDoc(document);
      const connectionSettingNames = this.stateStorage.getConnectionSettingNames();
      let schema: DbSchema | undefined = undefined;
      if (recordRule.connectionName) {
        let dbs = this.stateStorage.getResourceByName(recordRule.connectionName);
        if (dbs === undefined) {
          dbs = await this.stateStorage.loadResource(recordRule.connectionName, false, true);
        }
        if (dbs && dbs[0] instanceof RdsDatabase) {
          schema = (dbs[0] as RdsDatabase).getSchema({ name: recordRule.schemaName });
        }
      }
      const msg: ToWebviewMessageEventType = {
        command: "create",
        componentName,
        value: {
          connectionSettingNames,
          schema,
          recordRule,
          scrollPos: this.scrollPos,
        },
      };
      webviewPanel.webview.postMessage(msg);
    };
    // Hook up event handlers so that we can synchronize the webview with the text document.
    //
    // The text document acts as our model, so we have to sync change in the document to our
    // editor and sync changes in the editor back to the document.
    //
    // Remember that a single text document can also be shared between multiple custom
    // editors (this happens for example when you split a custom editor)
    const changeDocumentSubscription = workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      this.scrollPos = 0;
      changeDocumentSubscription.dispose();
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
        case "add-rule":
          {
            recordRule.tableRule.details.push({
              ruleName: "",
              error: {
                column: "",
                limit: 100,
              },
              conditions: {
                any: [],
              },
            });
          }
          break;
        case "delete-rule":
          {
            const index = (values.detail as number) ?? 0;
            recordRule.tableRule.details.splice(index, 1);
          }
          break;
        case "duplicate-rule":
          {
            const index = (values.detail as number) ?? 0;
            const original = recordRule.tableRule.details[index];
            recordRule.tableRule.details.splice(index + 1, 0, {
              ...original,
              ruleName: original.ruleName + " copy",
            });
          }
          break;
        case "change":
          {
            if (values.detail === "connectionName") {
              let dbs = this.stateStorage.getResourceByName(recordRule.connectionName);
              if (dbs === undefined) {
                dbs = await this.stateStorage.loadResource(recordRule.connectionName, false, true);
              }
              if (dbs && dbs[0] instanceof RdsDatabase) {
                recordRule.schemaName = dbs[0].getSchema({ isDefault: true }).name;
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
      connectionName: "",
      schemaName: "",
      tableRule: {
        table: "",
        details: [],
      },
    };
  }
}
