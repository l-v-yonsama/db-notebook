import {
  commands,
  ExtensionContext,
  NotebookCell,
  NotebookCellStatusBarAlignment,
  NotebookCellStatusBarItem,
  NotebookCellStatusBarItemProvider,
  notebooks,
} from "vscode";
import {
  CELL_OPEN_MDH,
  CELL_OPEN_REPORT_CHART,
  NOTEBOOK_REPORT_TYPE,
  OPEN_CHARTS_VIEWER,
  SHOW_REPORT_ALL_CHARTS,
} from "../../constant";
import { createReportChartViewParams } from "../../observability/report/reportChartAdapter";
import type { NotebookToolbarClickEvent } from "../../types/Notebook";
import type { PreparedChartsViewParams } from "../../types/views";
import { getToolbarButtonClickedNotebookEditor } from "../../utilities/notebookUtil";
import { isPersistedReportOutputMetadata, isReportChartSpec } from "./reportTypes";

function createCellReportChartViewParams(cell: NotebookCell): PreparedChartsViewParams | undefined {
  const metadata = cell.outputs[0]?.metadata;
  const spec = cell.metadata.reportChart;
  if (!isPersistedReportOutputMetadata(metadata) || !isReportChartSpec(spec)) {
    return undefined;
  }
  return createReportChartViewParams(spec, metadata.rdh);
}

class ReportOutputsProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (!isPersistedReportOutputMetadata(cell.outputs[0]?.metadata)) {
      return undefined;
    }
    const item = new NotebookCellStatusBarItem(
      "$(table) Open outputs",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_MDH;
    item.tooltip = "Open saved outputs in panel";
    return item;
  }
}

class ReportChartProvider implements NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
    if (
      !isPersistedReportOutputMetadata(cell.outputs[0]?.metadata) ||
      !isReportChartSpec(cell.metadata.reportChart)
    ) {
      return undefined;
    }
    const item = new NotebookCellStatusBarItem(
      "$(graph) Open chart",
      NotebookCellStatusBarAlignment.Right
    );
    item.command = CELL_OPEN_REPORT_CHART;
    item.tooltip = "Open saved chart in panel";
    return item;
  }
}

export function registerReportNotebookStatusBarProviders(context: ExtensionContext): void {
  context.subscriptions.push(
    notebooks.registerNotebookCellStatusBarItemProvider(
      NOTEBOOK_REPORT_TYPE,
      new ReportOutputsProvider()
    ),
    notebooks.registerNotebookCellStatusBarItemProvider(
      NOTEBOOK_REPORT_TYPE,
      new ReportChartProvider()
    ),
    commands.registerCommand(CELL_OPEN_REPORT_CHART, async (cell: NotebookCell) => {
      const params = createCellReportChartViewParams(cell);
      if (!params) {
        return;
      }
      await commands.executeCommand(OPEN_CHARTS_VIEWER, params);
    }),
    commands.registerCommand(SHOW_REPORT_ALL_CHARTS, async (event: NotebookToolbarClickEvent) => {
      const editor = getToolbarButtonClickedNotebookEditor(event);
      if (!editor) {
        return;
      }
      const charts = editor.notebook
        .getCells()
        .map(createCellReportChartViewParams)
        .filter((item): item is PreparedChartsViewParams => item !== undefined);
      for (const chart of charts) {
        await commands.executeCommand(OPEN_CHARTS_VIEWER, chart);
      }
    })
  );
}
