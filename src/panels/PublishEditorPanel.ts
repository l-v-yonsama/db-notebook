import { DbSubscription, MqttQoS } from "@l-v-yonsama/multi-platform-database-drivers";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import {
  commands,
  NotebookCellData,
  NotebookCellKind,
  NotebookEdit,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { CREATE_NEW_NOTEBOOK, NOTEBOOK_TYPE } from "../constant";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { PublishEditorPanelEventData } from "../shared/MessageEventData";
import { PublishEditorParams } from "../shared/PublishEditorParams";
import { CellMeta } from "../types/Notebook";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[PublishEditorPanel]";

dayjs.extend(utc);

export class PublishEditorPanel extends BasePanel {
  public static currentPanel: PublishEditorPanel | undefined;
  static stateStorage: StateStorage | undefined;
  private conName = "";
  private subscriptionName = "";

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }
  static setStateStorage(stateStorage: StateStorage) {
    this.stateStorage = stateStorage;
  }
  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PublishEditorPanel.currentPanel = new PublishEditorPanel(panel, extensionUri);
  }

  public static render(extensionUri: Uri, topidRes: DbSubscription) {
    if (PublishEditorPanel.currentPanel) {
      PublishEditorPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "PublishEditorPanelViewType",
        "PublishEditorPanel",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      PublishEditorPanel.currentPanel = new PublishEditorPanel(panel, extensionUri);
    }
    PublishEditorPanel.currentPanel.renderSub(topidRes);
  }

  getComponentName(): ComponentName {
    return "PublishEditorPanel";
  }

  async renderSub(topidRes: DbSubscription): Promise<void> {
    this.subscriptionName = topidRes.name;
    this.conName = topidRes.meta.conName;

    this.init();
  }

  async init() {
    const msg2: PublishEditorPanelEventData = {
      command: "initialize",
      componentName: "PublishEditorPanel",
      value: {
        initialize: {
          conName: this.conName,
          subscriptionName: this.subscriptionName,
          langType: "json",
          numOfPayloads: 10,
        },
      },
    };
    this.panel.webview.postMessage(msg2);
  }

  public preDispose(): void {
    PublishEditorPanel.currentPanel = undefined;
  }

  private async getDriverManager(): Promise<MqttDriverManager | undefined> {
    const setting = await PublishEditorPanel.stateStorage!.getConnectionSettingByName(this.conName);
    if (!setting) {
      return undefined;
    }
    return MqttDriverManager.getInstance(setting);
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok":
        {
          const {
            subscriptionName,
            payload,
            qos,
            retain,
            langType,
            numOfPayloads,
            openInNotebook,
          } = params as PublishEditorParams;

          if (openInNotebook) {
            const text =
              langType === "javascript"
                ? this.createScript(params as PublishEditorParams)
                : payload;
            const cell = new NotebookCellData(NotebookCellKind.Code, text, langType);
            const metadata: CellMeta = {
              connectionName: this.conName,
              publishParams: {
                topicName: subscriptionName,
                qos: Number(qos) as MqttQoS,
                retain,
              },
            };
            cell.metadata = metadata;

            if (params.inActiveNotebook) {
              this.dispose();

              setTimeout(async () => {
                const activeEditor = window.activeNotebookEditor;

                if (activeEditor && activeEditor.notebook.notebookType === NOTEBOOK_TYPE) {
                  const edit = new WorkspaceEdit();
                  const notebookEdit = NotebookEdit.insertCells(activeEditor.selection.end, [cell]);
                  edit.set(activeEditor.notebook.uri, [notebookEdit]);
                  await workspace.applyEdit(edit);
                } else {
                  showWindowErrorMessage("No active notebook editor found.");
                  return;
                }
              }, 100);
            } else {
              // Create a new notebook with the cell
              commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
            }
            this.dispose();
          } else {
            const driverManager = await this.getDriverManager();
            if (!driverManager) {
              return;
            }
            try {
              await driverManager.publish(subscriptionName, payload, {
                qos: Number(qos) as MqttQoS,
                retain,
                isJsonMessage: langType === "json",
              });
              this.dispose();
            } catch (e) {
              showWindowErrorMessage(e);
            }
          }
        }
        return;
    }
  }
  createScript(params: PublishEditorParams): string {
    const lines: string[] = [];

    lines.push(`const subscriptionName = '${params.subscriptionName}';`);
    lines.push(``);
    lines.push(`const { ok, message, result } = await DBDriverResolver`);
    lines.push(`.getInstance()`);
    lines.push(`.workflow(getConnectionSettingByName('${this.conName}'), async (driver) => {`);
    lines.push(`  let startTime = new Date().getTime();`);
    lines.push(`  for(let i = 0; i < ${params.numOfPayloads}; i++) {`);
    lines.push(`    const payload = {`);
    lines.push("      dummy_string: `dummy_${i}`,");
    lines.push(`      dummy_number: 7 * i,`);
    lines.push(`      dummy_boolean: i % 2 === 0`);
    lines.push(`    };`);
    lines.push(``);
    lines.push(`    await driver.publish(subscriptionName, JSON.stringify(payload), {`);
    lines.push(`        qos: ${params.qos},`);
    lines.push(`        retain: ${params.retain},`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push("  return `elapsedTime: ${new Date().getTime() - startTime}msec`;");
    lines.push(`});`);
    lines.push(`console.log('ok', ok);`);
    lines.push(`console.log('message', message);`);
    lines.push(`console.log('result', result);`);

    return lines.join("\n") + "\n";
  }
}
