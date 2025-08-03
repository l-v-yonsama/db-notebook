import {
  DbSubscription,
  MqttDatabase,
  MqttSubscriptionSetting,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { SubscriptionSettingPanelEventData } from "../shared/MessageEventData";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[SubscriptionSettingPanel]";

export class SubscriptionSettingPanel extends BasePanel {
  public static currentPanel: SubscriptionSettingPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private dbRes?: MqttDatabase;
  private subscriptionRes?: DbSubscription;
  private isNew = true;

  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    SubscriptionSettingPanel.currentPanel = new SubscriptionSettingPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    SubscriptionSettingPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "SubscriptionSettingPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok": {
        const { dbRes, isNew, subscriptionRes } = this;
        if (!dbRes) {
          return;
        }
        const { conName } = dbRes.meta;
        const setting = await SubscriptionSettingPanel.stateStorage!.getConnectionSettingByName(
          conName
        );
        if (!setting || !setting.mqttSetting) {
          return;
        }
        const manager = MqttDriverManager.getInstance(setting);
        const sb: MqttSubscriptionSetting = params;

        if (!setting.mqttSetting.subscriptionList) {
          setting.mqttSetting.subscriptionList = [];
        }

        if (isNew) {
          setting.mqttSetting.subscriptionList.push(sb);
          await SubscriptionSettingPanel.stateStorage!.editConnectionSetting(setting);
          await manager.addSubscription(dbRes, sb);
        } else {
          if (!subscriptionRes) {
            return;
          }
          // edit
          const prevSb = setting.mqttSetting.subscriptionList.find((it) => it.name === sb.name);
          if (prevSb) {
            prevSb.qos = sb.qos;
            prevSb.nl = sb.nl;
            prevSb.rap = sb.rap;
            prevSb.rh = sb.rh;

            await SubscriptionSettingPanel.stateStorage!.editConnectionSetting(setting);
          }

          await manager.editSubscription(dbRes, subscriptionRes, sb);
        }

        this.dispose();
      }
    }
  }

  protected preDispose(): void {
    SubscriptionSettingPanel.currentPanel = undefined;
  }

  public static render(
    extensionUri: Uri,
    params: { isNew: boolean; dbRes?: MqttDatabase; subscriptionRes?: DbSubscription }
  ) {
    if (SubscriptionSettingPanel.currentPanel) {
      SubscriptionSettingPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "SubscriptionSettingPanel",
        "SubscriptionSettingPanel",
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
      SubscriptionSettingPanel.currentPanel = new SubscriptionSettingPanel(panel, extensionUri);
    }
    SubscriptionSettingPanel.currentPanel.renderSub(params);
  }

  async renderSub(params: {
    isNew: boolean;
    dbRes?: MqttDatabase;
    subscriptionRes?: DbSubscription;
  }) {
    this.isNew = params.isNew;
    this.dbRes = params.dbRes;
    this.subscriptionRes = params.subscriptionRes;

    const sb = this.subscriptionRes;

    const msg: SubscriptionSettingPanelEventData = {
      command: "initialize",
      componentName: "SubscriptionSettingPanel",
      value: {
        initialize: {
          name: sb ? sb.name : "",
          qos: sb ? sb.qos : 0,
          nl: sb ? sb.nl ?? false : false,
          rap: sb ? sb.rap ?? false : false,
          rh: sb ? sb.rh ?? 0 : 0,
          isNew: this.isNew,
          allTopicNames: this.dbRes?.children.map((it) => it.name) ?? [],
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }
}
