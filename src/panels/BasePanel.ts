import { Disposable, Webview, WebviewPanel, Uri, ViewColumn } from "vscode";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { ComponentName } from "../shared/ComponentName";
import { ActionCommand } from "../shared/ActionParams";

export abstract class BasePanel {
  protected readonly panel: WebviewPanel;
  private _disposables: Disposable[] = [];

  protected constructor(panel: WebviewPanel, protected extensionUri: Uri) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.panel.webview.html = createWebviewContent(
      this.panel.webview,
      this.extensionUri,
      this.getComponentName()
    );
    this._setWebviewMessageListener(this.panel.webview);
  }

  protected getWebviewPanel(): WebviewPanel {
    return this.panel;
  }

  protected async loading(progress: number): Promise<void> {
    this.panel.webview.postMessage({
      command: "loading",
      componentName: this.getComponentName(),
      value: {
        loading: progress,
      },
    });
  }

  abstract getComponentName(): ComponentName;

  protected abstract recieveMessageFromWebview(message: ActionCommand): Promise<void>;

  protected abstract preDispose(): void;

  public dispose() {
    log(`${this.getComponentName()} dispose`);

    this.preDispose();
    this.panel.dispose();

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
        log(
          `${this.getComponentName()} ⭐️received message from webview command:[${message.command}]`
        );
        await this.recieveMessageFromWebview(message);
      },
      undefined,
      this._disposables
    );
  }
}
