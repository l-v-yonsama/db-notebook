import * as vscode from "vscode";
import { StateStorage } from "./utilities/StateStorage";
import {
  DBDriverResolver,
  DbConnection,
  DbResource,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ModeType } from "./shared/ModeType";
import { CONNECTION_SETTING_FORM_VIEWID, REFRESH_RESOURCES } from "./constant";
import { ActionCommand } from "./shared/ActionParams";
import { log } from "./utilities/logger";
import { createWebviewContent } from "./utilities/webviewUtil";
import { ComponentName } from "./shared/ComponentName";
import { DBFormEventData } from "./shared/MessageEventData";

const PREFIX = "[form]";

let provider: SQLConfigurationViewProvider;

const componentName: ComponentName = "DBFormView";

export function activateFormProvider(
  context: vscode.ExtensionContext,
  stateStorage: StateStorage
): SQLConfigurationViewProvider {
  provider = new SQLConfigurationViewProvider(
    CONNECTION_SETTING_FORM_VIEWID,
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

    webviewView.webview.html = createWebviewContent(
      webviewView.webview,
      this.context.extensionUri,
      componentName
    );

    // receive from webview
    webviewView.webview.onDidReceiveMessage(async (message: ActionCommand) => {
      const { command, params } = message;
      // log(`${PREFIX} ⭐️received message from webview command:[${command}]`);
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
            let msg: DBFormEventData = {
              command: "stop-progress",
              componentName: "DBFormView",
              value: {
                subComponentName: "ConnectionSetting",
              },
            };
            this.webviewView?.webview.postMessage(msg);
          }
          break;
        case "saveConnectionSetting":
          const mode = message.mode;
          if (mode === "create" || mode === "duplicate") {
            if (mode === "duplicate") {
              params.id = undefined;
            }
            await this.stateStorage.addConnectionSetting(params);
          } else {
            await this.stateStorage.editConnectionSetting(params);
          }
          await vscode.commands.executeCommand(REFRESH_RESOURCES);
          const res = Object.assign(new DbConnection(params.name), params);
          this.setForm("show", res);

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
      return;
    } else {
      this.cacheForm = undefined;
    }

    this.show();

    let msg: DBFormEventData;
    if (res?.resourceType === ResourceType.Connection || mode === "create") {
      const prohibitedNames =
        mode === "update" ? [] : this.stateStorage.getConnectionSettingNames();
      // send to webview
      msg = {
        command: "initialize",
        componentName: "DBFormView",
        value: {
          subComponentName: "ConnectionSetting",
          connectionSetting: {
            mode,
            setting: res as DbConnection,
            prohibitedNames,
          },
        },
      };
    } else {
      msg = {
        command: "initialize",
        componentName: "DBFormView",
        value: {
          subComponentName: "ResourceProperties",
          resourceProperties: res?.getProperties() ?? {},
        },
      };
    }
    this.webviewView?.webview.postMessage(msg);
  }

  show() {
    this.webviewView?.show();
  }
}
