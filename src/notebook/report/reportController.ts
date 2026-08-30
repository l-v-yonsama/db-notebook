import { ExtensionContext, NotebookController, notebooks, window } from "vscode";
import { NOTEBOOK_REPORT_TYPE } from "../../constant";

export class ReportNotebookController {
  private readonly controller: NotebookController;

  constructor(context: ExtensionContext) {
    this.controller = notebooks.createNotebookController(
      "database-notebook-report-controller",
      NOTEBOOK_REPORT_TYPE,
      "Dashboard report (snapshot)"
    );
    this.controller.supportedLanguages = ["plaintext", "typescript", "sql", "json"];
    this.controller.supportsExecutionOrder = false;
    this.controller.executeHandler = async () => {
      await window.showInformationMessage(
        "Dashboard reports are saved snapshots and cannot be executed or refreshed."
      );
    };
    context.subscriptions.push(this.controller);
  }
}
