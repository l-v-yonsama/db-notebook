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

import { CODE_RESOLVER_TYPE } from "../constant";
import { createWebviewContent } from "../utilities/webviewUtil";
import {
  ActionCommand,
  NameWithComment,
  UpdateCodeResolverTextDocumentActionCommand,
} from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { RdsDatabase } from "@l-v-yonsama/multi-platform-database-drivers";
import { CodeResolverParams } from "../shared/CodeResolverParams";
import { ComponentName } from "../shared/ComponentName";
import { CodeResolverEditorEventData } from "../shared/MessageEventData";

const PREFIX = "[CodeResolverEditorProvider]";
const componentName: ComponentName = "CodeResolverEditor";

export class CodeResolverEditorProvider implements CustomTextEditorProvider {
  private scrollPos: number = 0;
  private tableNameList: NameWithComment[] = [];
  private columnNameList: NameWithComment[] = [];

  public static register(context: ExtensionContext, stateStorage: StateStorage): Disposable {
    const provider = new CodeResolverEditorProvider(context, stateStorage);
    const providerRegistration = window.registerCustomEditorProvider(CODE_RESOLVER_TYPE, provider);
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
    webviewPanel.webview.html = createWebviewContent(
      webviewPanel.webview,
      this.context.extensionUri,
      componentName
    );

    const updateWebview = async () => {
      // log(`${PREFIX} updateWebview`);

      const resolver = this.parseDoc(document);

      await this.initDbResourceParams(resolver.editor.connectionName);

      const connectionSettingNames = this.stateStorage.getConnectionSettingNames();
      const msg: CodeResolverEditorEventData = {
        command: "initialize",
        componentName: "CodeResolverEditor",
        value: {
          initialize: {
            connectionSettingNames: ["", ...connectionSettingNames],
            tableNameList: this.tableNameList,
            columnNameList: this.columnNameList,
            resolver,
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
        updateWebview();
      }
    });

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      this.scrollPos = 0;
      changeDocumentSubscription.dispose();
      changeViewStateSubscription.dispose();
    });

    // Receive message from the webview.
    webviewPanel.webview.onDidReceiveMessage(async (message: ActionCommand) => {
      const { command, params } = message;
      // log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
      switch (command) {
        case "updateCodeResolverTextDocument":
          await this.updateTextDocument(document, params);
          break;
      }
    });

    updateWebview();
  }

  private async updateTextDocument(
    document: TextDocument,
    params: UpdateCodeResolverTextDocumentActionCommand["params"]
  ) {
    const { newText, values, scrollPos } = params;
    this.scrollPos = scrollPos;
    const edit = new WorkspaceEdit();

    const codeResolver = JSON.parse(newText) as CodeResolverParams;
    if (values) {
      switch (values.name) {
        case "cancel":
          {
            const { editor } = codeResolver;
            editor.visible = false;
            editor.item = undefined;
            editor.editingItemIndex = undefined;
          }
          break;
        case "save-code-item":
          {
            const { items, editor } = codeResolver;
            if (editor.editingItemIndex === undefined) {
              items.push(editor.item!);
            } else {
              items.splice(editor.editingItemIndex, 1, editor.item!);
            }
            editor.visible = false;
            editor.item = undefined;
            editor.editingItemIndex = undefined;
          }
          break;
        case "add-code-item":
          {
            if (codeResolver.editor === undefined) {
              codeResolver.editor = {
                visible: true,
                connectionName: "",
              };
            }
            codeResolver.editor.editingItemIndex = undefined;
            codeResolver.editor.visible = true;
            codeResolver.editor.item = {
              title: "",
              description: "",
              resource: {
                column: {
                  regex: false,
                  pattern: "",
                },
              },
              details: [],
            };
          }
          break;
        case "delete-code-item":
          {
            const index = (values.detail as number) ?? 0;
            codeResolver.items.splice(index, 1);
          }
          break;
        case "edit-code-item":
          {
            const index = (values.detail as number) ?? 0;
            if (codeResolver.editor === undefined) {
              codeResolver.editor = {
                visible: true,
                connectionName: "",
              };
            }
            codeResolver.editor.editingItemIndex = index;
            codeResolver.editor.visible = true;
            const original = codeResolver.items[index];
            codeResolver.editor.item = {
              ...original,
            };
          }
          break;
        case "duplicate-code-item":
          {
            const index = (values.detail as number) ?? 0;
            if (codeResolver.editor === undefined) {
              codeResolver.editor = {
                visible: true,
                connectionName: "",
              };
            }
            codeResolver.editor.editingItemIndex = undefined;
            codeResolver.editor.visible = true;
            const original = codeResolver.items[index];
            codeResolver.editor.item = {
              ...original,
              title: "Copy of " + original.title,
            };
          }
          break;
        case "change":
          {
            if (values.detail === "connectionName") {
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
      JSON.stringify(codeResolver, null, 1)
    );

    return workspace.applyEdit(edit);
  }

  private async initDbResourceParams(connectionName?: string) {
    this.tableNameList = [];
    this.columnNameList = [];
    if (connectionName) {
      let dbs = this.stateStorage.getResourceByName(connectionName);
      if (dbs === undefined) {
        const { ok, result } = await this.stateStorage.loadResource(connectionName, false, true);
        if (ok && result?.db) {
          dbs = result.db;
        }
      }
      if (dbs && dbs[0] instanceof RdsDatabase) {
        const schema = dbs[0].getSchema({ isDefault: true });
        schema.children.forEach((table) => {
          this.tableNameList.push({
            name: table.name,
            comment: table.comment,
          });
        });
        this.columnNameList = schema.getUniqColumnNameWithComments();
      }
    }
  }

  private parseDoc(doc: TextDocument): CodeResolverParams {
    const text = doc.getText();
    if (text.length) {
      return JSON.parse(text) as CodeResolverParams;
    }
    return {
      items: [],
      editor: {
        connectionName: "",
        visible: false,
      },
    };
  }
}
