import { commands, ExtensionContext, Uri, window } from "vscode";

import { DbSubscription } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import { BOTTOM_TOPIC_PAYLOADS_VIEWID } from "../constant";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { ActionCommand, OutputParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { SubscriptionPayloadsViewEventData } from "../shared/MessageEventData";
import { SubscriptionPayloadsViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createBookFromList } from "../utilities/excelGenerator";
import { createHtmlFromRdhList } from "../utilities/htmlGenerator";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[SubscriptionPayloadsView]";

dayjs.extend(utc);

export class SubscriptionPayloadsViewProvider extends BaseViewProvider {
  private rdh: ResultSetData | null = null;
  private conName = "";
  private subscriptionRes: DbSubscription | null = null;
  private isSubscribed = false;
  private jsonExpansion = false;

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "SubscriptionPayloadsView";
  }

  async hide(params: SubscriptionPayloadsViewParams) {
    if (
      this.conName !== params.conName ||
      this.subscriptionRes?.name !== params.subscriptionRes.name
    ) {
      return;
    }
    await this.closeView(BOTTOM_TOPIC_PAYLOADS_VIEWID);
  }
  async render(params: SubscriptionPayloadsViewParams) {
    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_TOPIC_PAYLOADS_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_TOPIC_PAYLOADS_VIEWID + ".focus", { preserveFocus: true });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub(params);
  }

  async updateSubscriptionRes(params: SubscriptionPayloadsViewParams) {
    if (
      !this.webviewView ||
      this.conName !== params.conName ||
      this.subscriptionRes?.name !== params.subscriptionRes.name
    ) {
      return;
    }
    await this.setResult({
      conName: params.conName,
      subscriptionRes: params.subscriptionRes,
      rdh: this.rdh ? this.rdh : undefined,
    });
  }
  async setResult(params: SubscriptionPayloadsViewParams) {
    if (
      !this.webviewView ||
      this.conName !== params.conName ||
      this.subscriptionRes?.name !== params.subscriptionRes.name
    ) {
      return;
    }
    this.rdh = params.rdh ?? null;
    this.subscriptionRes = params.subscriptionRes;
    this.postMessage<SubscriptionPayloadsViewEventData>({
      command: "set-search-result",
      componentName: "SubscriptionPayloadsView",

      value: {
        searchResult: {
          rdh: this.rdh,
          isSubscribed: params.subscriptionRes.isSubscribed,
        },
      },
    });
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "ok":
        {
          const jsonExpansion = params.jsonExpansion;
          if (jsonExpansion === undefined) {
            return;
          }
          this.jsonExpansion = jsonExpansion;
          const setting = await this.stateStorage.getConnectionSettingByName(this.conName);
          if (!setting) {
            return;
          }
          if (!this.subscriptionRes) {
            return;
          }
          this.subscriptionRes.meta.jsonExpansion = this.jsonExpansion;
          await MqttDriverManager.getInstance(setting).clearTopicLasTimestamp(
            this.subscriptionRes.name
          );
        }
        break;
      case "subscribe":
        {
          const setting = await this.stateStorage.getConnectionSettingByName(this.conName);
          if (!setting || !this.subscriptionRes) {
            return;
          }
          await MqttDriverManager.getInstance(setting).subscribe(this.subscriptionRes);
        }
        break;
      case "unsubscribe":
        {
          const setting = await this.stateStorage.getConnectionSettingByName(this.conName);
          if (!setting || !this.subscriptionRes) {
            return;
          }
          await MqttDriverManager.getInstance(setting).unsubscribe(this.subscriptionRes);
        }
        break;
      case "cancel":
        await this.closeView(BOTTOM_TOPIC_PAYLOADS_VIEWID);
        break;
      case "output":
        this.output(params);
        break;
    }
  }

  private async output(data: OutputParams) {
    if (!this.rdh) {
      return;
    }
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${
      this.subscriptionRes?.name ?? "subscription"
    }.${fileExtension}`;
    const previousFolder = await this.stateStorage.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const uri = await window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, defaultFileName),
      filters: { "*": [fileExtension] },
    });
    if (!uri) {
      return;
    }
    await this.stateStorage.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message =
      data.fileType === "excel"
        ? await createBookFromList([this.rdh], uri.fsPath, {
            rdh: {
              outputAllOnOneSheet: true,
            },
            rule: {
              withRecordRule: true,
            },
          })
        : await createHtmlFromRdhList([this.rdh], uri.fsPath);
    if (message) {
      showWindowErrorMessage(message);
    } else {
      window.setStatusBarMessage(uri.fsPath, 3000);
    }
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true) {
      this.postMessage<SubscriptionPayloadsViewEventData>({
        command: "initialize",
        componentName: "SubscriptionPayloadsView",

        value: {
          initialize: {
            subscriptionName: this.subscriptionRes?.name ?? "",
            isSubscribed: this.isSubscribed,
            rdh: this.rdh,
          },
        },
      });
    }
  }

  private async renderSub(params: SubscriptionPayloadsViewParams): Promise<void> {
    this.conName = params.conName;
    this.subscriptionRes = params.subscriptionRes;
    this.isSubscribed = params.subscriptionRes.isSubscribed;
    this.rdh = params.rdh ? params.rdh : null;
    this.onDidChangeVisibility(true);
  }
}
