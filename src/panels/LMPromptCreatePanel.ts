import {
  AwsDatabase,
  DBDriverResolver,
  isRDSType,
  RDSBaseDriver,
  RdsDatabase,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  commands,
  lm,
  NotebookCell,
  NotebookEdit,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { MainController } from "../notebook/controller";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { LMPromptCreateConditionParams } from "../shared/LMPromptCreateConditionParams";
import { LMPromptCreatePanelEventData } from "../shared/MessageEventData";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta } from "../types/Notebook";
import { createPrompt } from "../utilities/lmUtil";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[LMPromptCreatePanel]";

export class LMPromptCreatePanel extends BasePanel {
  public static currentPanel: LMPromptCreatePanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private static controller: MainController | undefined;
  private cell: NotebookCell | undefined;
  private translateResponse = true;
  private withTableDefinition = false;
  private withRetrievedExecutionPlan = false;
  private languageModelId = "";

  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    LMPromptCreatePanel.currentPanel = new LMPromptCreatePanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    LMPromptCreatePanel.stateStorage = storage;
  }

  static setMainController(controller: MainController) {
    LMPromptCreatePanel.controller = controller;
  }

  getComponentName(): ComponentName {
    return "LMPromptCreatePanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok": {
        const myParams: LMPromptCreateConditionParams = params;
        const { preview } = myParams;
        this.translateResponse = myParams.translateResponse;
        this.withTableDefinition = myParams.withTableDefinition;
        this.withRetrievedExecutionPlan = myParams.withRetrievedExecutionPlan;
        this.languageModelId = myParams.languageModelId;

        if (!this.cell) {
          return;
        }

        const prompt = await this.createPrompt();
        if (!prompt) {
          return;
        }

        if (preview) {
          // send to webview
          const msg: LMPromptCreatePanelEventData = {
            command: "set-prompts",
            componentName: "LMPromptCreatePanel",
            value: {
              setPrompts: {
                assistantPromptText: prompt.assistant,
                userPromptText: prompt.user,
              },
            },
          };
          this.panel.webview.postMessage(msg);
        } else {
          const metadata: CellMeta = {
            ...this.cell.metadata,
          };
          metadata.lmPromptCreateConditions = {
            languageModelId: this.languageModelId,
            translateResponse: this.translateResponse,
            withTableDefinition: this.withTableDefinition,
            withRetrievedExecutionPlan: this.withRetrievedExecutionPlan,
          };
          const edit = new WorkspaceEdit();
          const nbEdit = NotebookEdit.updateCellMetadata(this.cell.index, metadata);
          edit.set(this.cell.notebook.uri, [nbEdit]);

          await workspace.applyEdit(edit);

          LMPromptCreatePanel.controller?.setSqlMode("None");
          LMPromptCreatePanel.controller?.setLMEvaluateTarget("Query");
          commands.executeCommand("notebook.cell.execute", {
            ranges: [{ start: this.cell.index, end: this.cell.index + 1 }],
            document: this.cell.notebook.uri,
          });
          this.dispose();
        }
      }
    }
  }

  private async createPrompt(): Promise<{ assistant: string; user: string } | undefined> {
    if (!this.cell) {
      return undefined;
    }
    const { connectionName }: CellMeta = this.cell.metadata;
    if (!connectionName) {
      return undefined;
    }
    const dbs = LMPromptCreatePanel.stateStorage?.getResourceByName(connectionName);
    if (!dbs || dbs.length === 0) {
      return undefined;
    }
    const dbProduct =
      LMPromptCreatePanel.stateStorage?.getDBProductByConnectionName(connectionName);
    if (!dbProduct) {
      return undefined;
    }

    const explainOutputMetadata: RunResultMetadata | undefined = this.cell.outputs.find(
      (it) => it.metadata?.explainRdh || it.metadata?.analyzedRdh
    )?.metadata;

    const setting = await LMPromptCreatePanel.stateStorage?.getConnectionSettingByName(
      connectionName
    );
    if (!setting) {
      return undefined;
    }

    if (isRDSType(setting.dbType)) {
      const { ok, result } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
        setting,
        async (driver) => {
          return await createPrompt({
            db: dbs[0] as RdsDatabase,
            rdsDriver: driver,
            dbProduct,
            sql: this.cell!.document.getText(),
            explainRdh: explainOutputMetadata?.explainRdh ?? explainOutputMetadata?.analyzedRdh,
            translateResponse: this.translateResponse,
            withTableDefinition: this.withTableDefinition,
            withRetrievedExecutionPlan: this.withRetrievedExecutionPlan,
            withJSONResponseFormartForEngine: false,
          });
        }
      );

      if (ok && result) {
        return result;
      }
    }

    return await createPrompt({
      db: dbs[0] as AwsDatabase | RdsDatabase,
      dbProduct,
      sql: this.cell.document.getText(),
      explainRdh: explainOutputMetadata?.explainRdh ?? explainOutputMetadata?.analyzedRdh,
      translateResponse: this.translateResponse,
      withTableDefinition: this.withTableDefinition,
      withRetrievedExecutionPlan: this.withRetrievedExecutionPlan,
      withJSONResponseFormartForEngine: false,
    });
  }

  protected preDispose(): void {
    LMPromptCreatePanel.currentPanel = undefined;
  }

  public static render(extensionUri: Uri, cell: NotebookCell) {
    if (LMPromptCreatePanel.currentPanel) {
      LMPromptCreatePanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "LMPromptCreatePanel",
        "LMPromptCreatePanel",
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
      LMPromptCreatePanel.currentPanel = new LMPromptCreatePanel(panel, extensionUri);
    }
    LMPromptCreatePanel.currentPanel.cell = cell;
    LMPromptCreatePanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.cell) {
      return;
    }

    const models = await lm.selectChatModels({
      vendor: "copilot",
    });
    if (models.length === 0) {
      window.showErrorMessage("No model found. Please try again later.");
      return;
    }
    const languageModels = models.map((model) => ({
      label: model.name ? model.name : `${model.vendor} (${model.family})`,
      value: model.id,
    }));

    const { connectionName, lmPromptCreateConditions }: CellMeta = this.cell.metadata;
    if (!connectionName) {
      return;
    }
    if (lmPromptCreateConditions) {
      this.languageModelId = lmPromptCreateConditions.languageModelId;
      this.translateResponse = lmPromptCreateConditions.translateResponse;
      this.withTableDefinition = lmPromptCreateConditions.withTableDefinition;
      this.withRetrievedExecutionPlan = lmPromptCreateConditions.withRetrievedExecutionPlan;
    } else {
      this.languageModelId = languageModels[0].value;
      const gpt4oModel = models.find((model) => model.family.toLocaleLowerCase() === "gpt-4o");
      if (gpt4oModel) {
        this.languageModelId = gpt4oModel.id;
      }
      this.translateResponse = true;
      this.withTableDefinition = false;
      this.withRetrievedExecutionPlan = false;
    }

    const prompt = await this.createPrompt();
    if (!prompt) {
      return;
    }
    const explainOutputMetadata: RunResultMetadata | undefined = this.cell.outputs.find(
      (it) => it.metadata?.explainRdh || it.metadata?.analyzedRdh
    )?.metadata;
    const hasExplainPlan =
      explainOutputMetadata?.explainRdh !== undefined ||
      explainOutputMetadata?.analyzedRdh !== undefined;

    if (!hasExplainPlan && this.withRetrievedExecutionPlan) {
      this.withRetrievedExecutionPlan = false;
    }

    const msg: LMPromptCreatePanelEventData = {
      command: "initialize",
      componentName: "LMPromptCreatePanel",
      value: {
        initialize: {
          languageModels,
          languageModelId: this.languageModelId,
          assistantPromptText: prompt.assistant,
          userPromptText: prompt.user,
          hasExplainPlan,
          translateResponse: this.translateResponse,
          withTableDefinition: this.withTableDefinition,
          withRetrievedExecutionPlan: this.withRetrievedExecutionPlan,
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }
}
