import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  workspace,
  WorkspaceEdit,
  NotebookEdit,
  NotebookCell,
} from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import * as path from "path";
import { createWebviewContent } from "../utilities/webviewUtil";
import { NotebookCellMetadataPanelEventData } from "../shared/MessageEventData";
import { ComponentName } from "../shared/ComponentName";
import { CellMeta } from "../types/Notebook";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "[NotebookCellMetadataPanel]";

const componentName: ComponentName = "NotebookCellMetadataPanel";

export class NotebookCellMetadataPanel {
  public static currentPanel: NotebookCellMetadataPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private cell: NotebookCell | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = createWebviewContent(
      this._panel.webview,
      extensionUri,
      componentName
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  static setStateStorage(storage: StateStorage) {
    NotebookCellMetadataPanel.stateStorage = storage;
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    NotebookCellMetadataPanel.currentPanel = new NotebookCellMetadataPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, cell: NotebookCell) {
    log(`${PREFIX} render`);
    if (NotebookCellMetadataPanel.currentPanel) {
      NotebookCellMetadataPanel.currentPanel._panel.reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "NotebookCellMetadataPanel",
        "NotebookCellMetadataPanel",
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
      NotebookCellMetadataPanel.currentPanel = new NotebookCellMetadataPanel(panel, extensionUri);
    }
    NotebookCellMetadataPanel.currentPanel.cell = cell;
    NotebookCellMetadataPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.cell) {
      return;
    }
    const connectionSettingNames =
      NotebookCellMetadataPanel.stateStorage?.getConnectionSettingNames();
    if (!connectionSettingNames) {
      return;
    }

    const wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return;
    }
    const rootPath = wsfolder.fsPath;

    const codeFiles = await workspace.findFiles("**/*.cresolver", "**/node_modules/**");
    const codeFileItems = codeFiles.map((it) => ({
      label: path.relative(rootPath, it.fsPath),
      value: path.relative(rootPath, it.fsPath),
    }));
    const NO_USE = "Unused";
    codeFileItems.unshift({
      label: NO_USE,
      value: "",
    });

    const ruleFiles = await workspace.findFiles("**/*.rrule", "**/node_modules/**");
    const ruleFileItems = ruleFiles.map((it) => ({
      label: path.relative(rootPath, it.fsPath),
      value: path.relative(rootPath, it.fsPath),
    }));

    ruleFileItems.unshift({
      label: NO_USE,
      value: "",
    });

    const msg: NotebookCellMetadataPanelEventData = {
      command: "initialize",
      componentName: "NotebookCellMetadataPanel",
      value: {
        initialize: {
          metadata: {
            ...this.cell.metadata,
            markWithinQuery: this.cell.metadata.markWithinQuery !== false,
          },
          connectionSettingNames: ["", ...connectionSettingNames],
          codeFileItems,
          ruleFileItems,
        },
      },
    };

    this._panel.webview.postMessage(msg);
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    log(`${PREFIX} dispose`);

    NotebookCellMetadataPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      async (message: ActionCommand) => {
        const { command, params } = message;
        switch (command) {
          case "saveNotebookCellMetadata":
            if (!this.cell) {
              return;
            }
            {
              const newMetadata = {
                ...this.cell.metadata,
                ...params.metadata,
              };

              if (newMetadata.codeResolverFile === "") {
                delete newMetadata.codeResolverFile;
              }
              if (newMetadata.ruleFile === "") {
                delete newMetadata.ruleFile;
              }
              if (newMetadata.showComment === false) {
                delete newMetadata.showComment;
              }

              if (newMetadata.savingSharedVariables === false) {
                delete newMetadata.savingSharedVariables;
              }
              if (newMetadata.sharedVariableName === "") {
                delete newMetadata.sharedVariableName;
              }

              const edit = new WorkspaceEdit();
              const nbEdit = NotebookEdit.updateCellMetadata(this.cell.index, {
                ...newMetadata,
              });
              edit.set(this.cell.notebook.uri, [nbEdit]);
              await workspace.applyEdit(edit);
            }
            this.dispose();
            return;
          case "cancel":
            this.dispose();
            return;
        }
      },
      undefined,
      this._disposables
    );
  }
}
