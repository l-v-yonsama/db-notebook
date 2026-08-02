import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr } from "@l-v-yonsama/rdh";
import {
  NotebookCell,
  NotebookCellKind,
  NotebookCellStatusBarAlignment,
  NotebookCellStatusBarItem,
  NotebookCellStatusBarItemProvider,
} from "vscode";
import {
  CELL_MARK_CELL_AS_MQTT,
  CELL_MARK_CELL_AS_PRE_EXECUTION,
  CELL_MARK_CELL_AS_SKIP,
  CELL_OPEN_HTTP_RESPONSE,
  CELL_OPEN_MDH,
  CELL_SHOW_METADATA_SETTINGS,
  CELL_SPECIFY_CONNECTION_TO_USE,
  CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE,
  CELL_SPECIFY_LOG_GROUP_TO_USE,
  CELL_SPECIFY_MQTT_EXPAND_JSON_COLUMN,
  CELL_SPECIFY_MQTT_QOS_TO_USE,
  CELL_SPECIFY_MQTT_RETAIN_TO_USE,
  CELL_SPECIFY_MQTT_TOPIC_TO_USE,
} from "../constant";
import type { RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta } from "../types/Notebook";
import { existsFileOnWorkspace } from "../utilities/fsUtil";
import {
  hasConnectionCell,
  isCwqlCell,
  isJsOrTsCell,
  isJsonValueCell,
  isMarkupCell,
  isMemcachedCell,
  isMqttCell,
  isSqlCell,
} from "../utilities/notebookUtil";
import { StateStorage } from "../utilities/StateStorage";
import { setupDbResource } from "./intellisense";

export class CellMetadataProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (!isSqlCell(cell)) {
      return undefined;
    }

    const {
      ruleFile,
      codeResolverFile,
      savingSharedVariables,
      sharedVariableName,
      useDatabaseName,
      chart,
    }: CellMeta = cell.metadata;
    let tooltip = "";

    tooltip = "$(gear) Show metadata";

    if (codeResolverFile) {
      let displayFileName = codeResolverFile;
      if (displayFileName.endsWith(".cresolver")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 10);
      }
      if (await existsFileOnWorkspace(codeResolverFile)) {
        tooltip += " $(replace) Use " + abbr(displayFileName, 18);
      } else {
        tooltip += " $(warning) Missing Code resolver " + abbr(displayFileName, 18);
      }
    }

    if (ruleFile) {
      let displayFileName = ruleFile;
      if (displayFileName.endsWith(".rrule")) {
        displayFileName = displayFileName.substring(0, displayFileName.length - 6);
      }
      if (await existsFileOnWorkspace(ruleFile)) {
        tooltip += " $(checklist) Use " + abbr(displayFileName, 18);
      } else {
        tooltip += " $(warning) Missing Rule " + abbr(displayFileName, 18);
      }
    }

    if (savingSharedVariables && sharedVariableName) {
      tooltip += " $(symbol-variable) " + abbr(sharedVariableName, 18);
    }

    if (useDatabaseName) {
      tooltip += " $(database) " + abbr(useDatabaseName, 18);
    }

    if (chart && chart.type) {
      switch (chart.type) {
        case "bar":
          tooltip += " $(graph) " + chart.type;
          break;
        case "doughnut":
        case "pie":
          tooltip += " $(pie-chart) " + chart.type;
          break;
        case "line":
          tooltip += " $(graph-line) " + chart.type;
          break;
        case "scatter":
        case "pairPlot":
          tooltip += " $(graph-scatter) " + chart.type;
          break;
        case "radar":
          tooltip += " $(graph) " + chart.type;
          break;
      }
    }

    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SHOW_METADATA_SETTINGS;
    item.tooltip = tooltip;
    return item;
  }
}

export class MarkCellAsSkipProvider implements NotebookCellStatusBarItemProvider {
  constructor() {}

  async provideCellStatusBarItems(
    cell: NotebookCell
  ): Promise<NotebookCellStatusBarItem | undefined> {
    if (cell.kind === NotebookCellKind.Markup) {
      return undefined;
    }

    const { markAsSkip }: CellMeta = cell.metadata;
    let tooltip = "";
    let text = "";
    if (markAsSkip === true) {
      tooltip = "Mark cell as Enabled";
      text = "$(debug-step-over) Skip";
    } else {
      tooltip = "Mark cell as skip";
      text = "$(circle-small-filled) Enabled";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_SKIP;
    item.tooltip = tooltip;
    return item;
  }
}

export class ConnectionSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!hasConnectionCell(cell)) {
      return undefined;
    }

    const { connectionName }: CellMeta = cell.metadata;
    let tooltip = "";
    if (connectionName) {
      if (this.stateStorage.hasConnectionSettingByName(connectionName)) {
        tooltip = "$(debug-disconnect) Use " + abbr(connectionName, 16);
        setupDbResource(connectionName);
      } else {
        tooltip = "$(error) Missing connection " + abbr(connectionName, 16);
      }
    } else {
      tooltip = "$(error) Specify connection";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_CONNECTION_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

export class MarkCellAsMqttProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (
      isCwqlCell(cell) ||
      isMemcachedCell(cell) ||
      isSqlCell(cell) ||
      isMarkupCell(cell) ||
      isJsOrTsCell(cell)
    ) {
      return undefined;
    }

    const { publishParams }: CellMeta = cell.metadata;

    let tooltip = "";
    let text = "";
    if (publishParams) {
      if (cell.document.languageId === "json") {
        tooltip = "Mark cell as General JSON";
        text = "$(arrow-swap) MQTT JSON";
      } else {
        tooltip = "Mark cell as General Plain text";
        text = "$(arrow-swap) MQTT Plain text";
      }
    } else {
      if (cell.document.languageId === "json") {
        tooltip = "Mark cell as MQTT";
        text = "$(arrow-swap) General JSON";
      } else {
        tooltip = "Mark cell as MQTT";
        text = "$(arrow-swap) Genaral Plain text";
      }
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_MQTT;
    item.tooltip = tooltip;
    return item;
  }
}

export class MqttTopicProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isMqttCell(cell)) {
      return undefined;
    }

    const { publishParams }: CellMeta = cell.metadata;
    if (!publishParams) {
      return undefined;
    }

    let text = "";
    let tooltip = "";
    if (publishParams.topicName) {
      text = `$(output) Topic:(${abbr(publishParams.topicName, 16)})`;
      tooltip = publishParams.topicName;
    } else {
      text = "$(error) Specify subscription";
      tooltip = "Specify subscription";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_MQTT_TOPIC_TO_USE;
    item.tooltip = text;
    return item;
  }
}

export class MqttRetainProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isMqttCell(cell)) {
      return undefined;
    }

    const { publishParams }: CellMeta = cell.metadata;
    if (!publishParams) {
      return undefined;
    }

    const text = `Retain:(${publishParams.retain === true ? "TRUE" : "FALSE"})`;
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_MQTT_RETAIN_TO_USE;
    item.tooltip = text;
    return item;
  }
}

export class MqttQosProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isMqttCell(cell)) {
      return undefined;
    }

    const { publishParams }: CellMeta = cell.metadata;
    if (!publishParams) {
      return undefined;
    }

    let tooltip = "";
    if (publishParams.qos !== undefined) {
      tooltip = `QOS:(${publishParams.qos})`;
    } else {
      tooltip = "$(error) Specify QOS";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_MQTT_QOS_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

export class MqttSubscribeExpandJsonColumnProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isSqlCell(cell)) {
      return undefined;
    }
    if (this.stateStorage.getDBTypeByConnectionName(cell.metadata.connectionName) !== DBType.Mqtt) {
      return undefined;
    }

    let { subscribeParams }: CellMeta = cell.metadata;
    if (!subscribeParams) {
      subscribeParams = {
        expandJsonColumn: false,
      };
    }

    const text = `Expand JSON column:(${
      subscribeParams.expandJsonColumn === true ? "TRUE" : "FALSE"
    })`;
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_MQTT_EXPAND_JSON_COLUMN;
    item.tooltip = text;
    return item;
  }
}

export class LogGroupSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isCwqlCell(cell)) {
      return undefined;
    }

    const { connectionName, logGroupName }: CellMeta = cell.metadata;
    if (!connectionName) {
      return undefined;
    }

    let tooltip = "";
    if (logGroupName) {
      tooltip = "$(list-ordered) Use " + abbr(logGroupName, 40);
    } else {
      tooltip = "$(error) Specify logGroup";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_LOG_GROUP_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

export class LogGroupQueryTimeSettingProvider implements NotebookCellStatusBarItemProvider {
  constructor(private stateStorage: StateStorage) {}

  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isCwqlCell(cell)) {
      return undefined;
    }

    const { logGroupStartTimeOffset }: CellMeta = cell.metadata;

    let tooltip = "";
    if (logGroupStartTimeOffset) {
      tooltip = "$(calendar) " + logGroupStartTimeOffset;
    } else {
      tooltip = "$(error) Specify start time offset";
    }
    const item = new NotebookCellStatusBarItem(tooltip, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE;
    item.tooltip = tooltip;
    return item;
  }
}

export class RdhProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rMetadata: RunResultMetadata | undefined = cell.outputs[0]?.metadata;
    if (!rMetadata) {
      return;
    }
    const { rdh, explainRdh, analyzedRdh } = rMetadata;
    if (rdh === undefined && explainRdh === undefined && analyzedRdh === undefined) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open outputs",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_MDH;
    item.tooltip = "Open outputs in panel";
    return item;
  }
}

export class HttpResponseProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    const rMetadata: RunResultMetadata | undefined = cell.outputs[0]?.metadata;
    if (!rMetadata) {
      return;
    }
    const { axiosEvent } = rMetadata;
    if (axiosEvent === undefined) {
      return;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open response",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_HTTP_RESPONSE;
    item.tooltip = "Open response in panel";
    return item;
  }
}

export class PreExecutionProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isJsonValueCell(cell)) {
      return undefined;
    }

    const { markAsRunInOrderAtJsonCell }: CellMeta = cell.metadata;
    let tooltip = "";
    let text = "";
    if (markAsRunInOrderAtJsonCell === true) {
      tooltip = "Mark as 'Run in order'";
      text = "$(circle-small) Run in order";
    } else {
      tooltip = "Mark as 'Pre execution'";
      text = "$(debug-step-into) Pre-execution";
    }
    const item = new NotebookCellStatusBarItem(text, NotebookCellStatusBarAlignment.Left);
    item.command = CELL_MARK_CELL_AS_PRE_EXECUTION;
    item.tooltip = tooltip;
    return item;
  }
}
