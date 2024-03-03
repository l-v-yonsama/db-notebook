import {
  ExtensionContext,
  WebviewViewProvider,
  WebviewView,
  WebviewViewResolveContext,
  CancellationToken,
} from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { log } from "../utilities/logger";
import { createWebviewContent } from "../utilities/webviewUtil";
import { ComponentName } from "../shared/ComponentName";

export abstract class BaseViewProvider implements WebviewViewProvider {
  protected webviewView?: WebviewView;

  constructor(public readonly viewId: string, protected readonly context: ExtensionContext) {}

  protected postMessage<T = any>(msg: T) {
    this.webviewView?.webview.postMessage(msg);
  }

  async resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext<unknown>,
    _token: CancellationToken
  ): Promise<void> {
    webviewView.webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = createWebviewContent(
      webviewView.webview,
      this.context.extensionUri,
      this.getComponentName()
    );

    webviewView.onDidDispose(() => {
      log(this.getComponentName() + ": disposed");
    });
    webviewView.onDidChangeVisibility(() => this.onDidChangeVisibility(webviewView.visible));

    this.setWebviewMessageListener(webviewView);

    this.webviewView = webviewView;
  }

  abstract getComponentName(): ComponentName;

  protected abstract recieveMessageFromWebview(message: ActionCommand): Promise<void>;

  protected abstract onDidChangeVisibility(visible: boolean): void;

  private setWebviewMessageListener(webviewView: WebviewView) {
    webviewView.webview.onDidReceiveMessage(async (message: ActionCommand) => {
      log(
        `${this.getComponentName()} ⭐️received message from webview command:[${message.command}]`
      );
      await this.recieveMessageFromWebview(message);
    });
  }
}
