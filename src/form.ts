import * as vscode from "vscode";
import { StateStorage } from "./utilities/StateStorage";
import {
  DBDriverResolver,
  DbResource,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ModeType } from "./shared/ModeType";
import { REFRESH_RESOURCES } from "./constant";
import { ToWebviewMessageEventType } from "./types/ToWebviewMessageEvent";
import { ActionCommand } from "./shared/ActionParams";
import { log } from "./utilities/logger";
import { createWebviewContent } from "./utilities/webviewUtil";

const PREFIX = "[form]";

let provider: SQLConfigurationViewProvider;

export function activateFormProvider(
  context: vscode.ExtensionContext,
  stateStorage: StateStorage
): SQLConfigurationViewProvider {
  provider = new SQLConfigurationViewProvider(
    "database-notebook.connectionForm",
    context,
    stateStorage
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(provider.viewId, provider));
  return provider;
}

export class SQLConfigurationViewProvider implements vscode.WebviewViewProvider {
  public readonly viewId: string;
  private readonly context: vscode.ExtensionContext;
  private webviewView?: vscode.WebviewView;
  private cacheForm?: { mode: ModeType; res?: DbResource } = undefined;

  constructor(
    viewId: string,
    context: vscode.ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    this.viewId = viewId;
    this.context = context;
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = createWebviewContent(webviewView.webview, this.context.extensionUri);

    // receive from webview
    webviewView.webview.onDidReceiveMessage(async (message: ActionCommand) => {
      const { command, params } = message;
      log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
      switch (command) {
        case "testConnectionSetting":
          {
            const driver = DBDriverResolver.getInstance().createDriver(params);
            const message = await driver.test(true);
            if (message) {
              vscode.window.showErrorMessage(message);
            } else {
              vscode.window.showInformationMessage("OK");
            }
            let msg: ToWebviewMessageEventType = {
              command: "ConnectionSetting-stop-progress",
              value: {},
            };
            this.webviewView?.webview.postMessage(msg);
          }
          break;
        case "saveConnectionSetting":
          const mode = message.mode;
          if (mode === "create" || mode === "clone") {
            if (mode === "clone") {
              params.id = undefined;
            }
            await this.stateStorage.addConnectionSetting(params);
          } else {
            await this.stateStorage.editConnectionSetting(params);
          }
          await vscode.commands.executeCommand(REFRESH_RESOURCES);
          break;
      }
    });

    if (this.cacheForm) {
      const { mode, res } = this.cacheForm;
      this.setForm(mode, res);
    }
  }

  setForm(mode: ModeType, res?: DbResource) {
    log(`${PREFIX} setForm mode:[${mode}]`);
    if (!this.webviewView) {
      vscode.window.showInformationMessage("Expand 'Resource properties' view", "OK");
      this.cacheForm = {
        mode,
        res,
      };
    } else {
      this.cacheForm = undefined;
    }
    this.show();

    let msg: ToWebviewMessageEventType;
    if (res?.resourceType === ResourceType.Connection || mode === "create") {
      const prohibitedNames =
        mode === "update" ? [] : this.stateStorage.getConnectionSettingNames();
      // send to webview
      msg = {
        command: "create",
        componentName: "ConnectionSetting",
        value: {
          mode,
          setting: res,
          prohibitedNames,
        },
      };
    } else {
      msg = {
        command: "create",
        componentName: "ResourceProperties",
        value: res?.getProperties() ?? {},
      };
    }
    log(`${PREFIX} setForm postMessage:[${JSON.stringify(msg)}]`);
    this.webviewView?.webview.postMessage(msg);
  }

  show() {
    this.webviewView?.show();
  }
}
