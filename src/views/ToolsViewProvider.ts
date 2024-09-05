import {
  ConnectionSetting,
  DBDriverResolver,
  DbResource,
  RDSBaseDriver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import * as path from "path";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { BOTTOM_TOOLS_VIEWID } from "../constant";
import { ActionCommand, OutputParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { ToolsViewEventData } from "../shared/MessageEventData";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { createBookFromList } from "../utilities/excelGenerator";
import { createHtmlFromRdhList } from "../utilities/htmlGenerator";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[ToolsView]";
dayjs.extend(utc);

type ToolsViewMode = "sessions" | "locks";

export type ToolsViewParams = {
  viewMode: ToolsViewMode;
  conName: string;
  res?: DbResource;
};

export class ToolsViewProvider extends BaseViewProvider {
  private rdh: ResultSetData | undefined = undefined;
  private res: DbResource | undefined = undefined;
  private viewMode: ToolsViewMode = "sessions";
  private settings: ConnectionSetting | undefined;

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "ToolsView";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "kill":
        this.kill(params.sessionOrPid);
        break;
      case "cancel":
        {
          this.webviewView = undefined;
          this.clear();

          await commands.executeCommand("setContext", BOTTOM_TOOLS_VIEWID + ".visible", false);
        }
        break;
      case "refresh":
        await this.searchAndRefresh();
        break;
      case "output":
        this.output(params);
        break;
    }
  }

  async render(params: ToolsViewParams) {
    const { viewMode, conName, res } = params;
    this.viewMode = viewMode;
    this.res = res;

    const setting = await this.stateStorage.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    this.settings = setting;
    this.clear();

    await this.search();

    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_TOOLS_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_TOOLS_VIEWID + ".focus", {
      preserveFocus: true,
    });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub();
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true) {
      this.postMessage<ToolsViewEventData>({
        command: "refresh",
        componentName: "ToolsView",

        value: {
          refresh: {
            mode: this.viewMode,
            rdh: this.rdh,
          },
        },
      });
    }
  }

  private async renderSub() {
    this.onDidChangeVisibility(true);
  }

  private async searchAndRefresh() {
    await this.search();
    await this.renderSub();
  }

  private async search() {
    const { viewMode, res, settings } = this;
    if (settings === undefined) {
      return;
    }

    if (viewMode === "locks" || viewMode === "sessions") {
      if (res === undefined) {
        return;
      }
      const { ok, message, result } = await DBDriverResolver.getInstance().workflow<
        RDSBaseDriver,
        ResultSetData
      >(settings, async (driver) => {
        if (viewMode === "sessions") {
          return await driver.getSessions(res.name);
        } else {
          return await driver.getLocks(res.name);
        }
      });
      if (ok && result) {
        this.rdh = result;
      } else {
        showWindowErrorMessage(message);
        return;
      }
    }
  }

  private async output(data: OutputParams) {
    if (!this.rdh) {
      return;
    }
    const fileExtension = data.fileType === "excel" ? "xlsx" : "html";
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_${this.viewMode}.${fileExtension}`;
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
      window.showInformationMessage(uri.fsPath);
    }
  }

  private async kill(sessionOrPid: number | undefined) {
    const { viewMode, res, settings } = this;
    if (settings === undefined) {
      return;
    }
    if (sessionOrPid === undefined || isNaN(sessionOrPid)) {
      return;
    }
    const answer = await window.showInformationMessage(
      `Are you sure to terminate(kill) session:${sessionOrPid}?`,
      "YES",
      "NO"
    );
    if (answer !== "YES") {
      return;
    }
    const { ok, message, result } = await DBDriverResolver.getInstance().workflow<
      RDSBaseDriver,
      string
    >(settings, async (driver) => {
      return await driver.kill(sessionOrPid);
    });
    if (ok) {
      if (result) {
        showWindowErrorMessage(result);
        return;
      } else {
        window.showInformationMessage("OK");
        await this.searchAndRefresh();
      }
    } else {
      showWindowErrorMessage(message);
      return;
    }
  }

  private clear() {
    this.viewMode = "sessions";
    this.rdh = undefined;
  }
}
