import { commands, ExtensionContext } from "vscode";

import { createHash } from "crypto";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { BOTTOM_CHARTS_VIEWID } from "../constant";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { ExtChartData, ExtChartOptions, PairPlotChartParams } from "../shared/ExtChartJs";
import { ChartsViewEventData, ChartTabItem } from "../shared/MessageEventData";
import { ChartsViewParams } from "../types/views";
import { createChartJsParams, createPairPlotChartParams } from "../utilities/chartUtil";
import { StateStorage } from "../utilities/StateStorage";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";

const PREFIX = "[ChartsView]";

dayjs.extend(utc);

export class ChartsViewProvider extends BaseViewProvider {
  private currentTabId?: string;
  private items: ChartTabItem[] = [];

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "ChartsView";
  }

  async render(params: ChartsViewParams) {
    if (this.webviewView === undefined) {
      await commands.executeCommand("setContext", BOTTOM_CHARTS_VIEWID + ".visible", true);
    }

    await commands.executeCommand(BOTTOM_CHARTS_VIEWID + ".focus", { preserveFocus: true });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.renderSub(params);
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "closeTab":
        {
          const { tabId } = params;
          const idx = this.items.findIndex((it) => it.tabId === tabId);
          if (idx >= 0) {
            this.items.splice(idx, 1);
          }
          if (this.items.length === 0) {
            this.webviewView = undefined;
            this.items.splice(0, this.items.length);
            await commands.executeCommand("setContext", BOTTOM_CHARTS_VIEWID + ".visible", false);
          }
        }
        break;
    }
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true && this.items) {
      this.postMessage<ChartsViewEventData>({
        command: "init",
        componentName: "ChartsView",

        value: {
          init: {
            tabItems: this.items,
            currentTabId: this.currentTabId,
          },
        },
      });
    }
  }

  private async renderSub(params: ChartsViewParams): Promise<void> {
    const { title } = params;
    let item = this.getTabByTitle(title);
    if (item) {
      // Reset
      const tmpItem = await this.createTabItem(params);

      item.type = tmpItem.type;
      item.options = tmpItem.options;
      item.data = tmpItem.data;
      item.pairPlotChartParams = tmpItem.pairPlotChartParams;

      const msg: ChartsViewEventData = {
        command: "set-search-result",
        componentName: "ChartsView",
        value: {
          searchResult: {
            tabId: item.tabId,
            value: item,
          },
        },
      };
      this.postMessage<ChartsViewEventData>(msg);
      this.currentTabId = item.tabId;
      return;
    }

    item = await this.createTabItem(params);
    this.items.push(item);
    this.currentTabId = item.tabId;

    const msg2: ChartsViewEventData = {
      command: "add-tab-item",
      componentName: "ChartsView",
      value: {
        addTabItem: item,
      },
    };
    this.postMessage<any>(msg2);
    // return item;
  }

  private async createTabItem(params: ChartsViewParams): Promise<ChartTabItem> {
    const createTabId = () => createHash("md5").update(params.title).digest("hex");
    const tabId = createTabId();

    let data: ExtChartData | undefined = undefined;
    let options: ExtChartOptions | undefined = undefined;
    let pairPlotChartParams: PairPlotChartParams | undefined = undefined;

    if (params.type === "pairPlot") {
      pairPlotChartParams = createPairPlotChartParams(params);
    } else {
      const result = createChartJsParams({
        ...params,
        showAxis: true,
        showAxisTitle: true,
        showLegend: true,
      });
      data = result.data;
      options = result.options;
    }

    const item: ChartTabItem = {
      tabId,
      title: params.title,
      type: params.type,
      data,
      options,
      pairPlotChartParams,
    };

    return item;
  }

  private getTabByTitle(title: string): ChartTabItem | undefined {
    return this.items.find((it) => it.title === title);
  }
}
