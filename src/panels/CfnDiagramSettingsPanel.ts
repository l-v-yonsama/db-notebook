import {
  AwsDriver,
  generateDiagram,
  generateDrawioApplicationDiagram,
  generateDrawioArchitectureDiagram,
  generateDrawioCfnDependencyGraph,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { CfnDiagramGenerateParams } from "../shared/CfnDiagram";
import { ComponentName } from "../shared/ComponentName";
import {
  CfnDiagramSettingsInputParams,
  CfnDiagramSettingsPanelEventData,
} from "../shared/MessageEventData";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import {
  upsertCfnDiagramPreviewDrawio,
  type CfnTemplatePreview,
  upsertCfnDiagramPreviewNotebook,
} from "../utilities/cfnDiagramPreviewNotebook";
import { workflow } from "../utilities/driverResolver";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[CfnDiagramSettingsPanel]";

export class CfnDiagramSettingsPanel extends BasePanel {
  public static currentPanel: CfnDiagramSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private variables: CfnDiagramSettingsInputParams | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    CfnDiagramSettingsPanel.currentPanel = new CfnDiagramSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    CfnDiagramSettingsPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "CfnDiagramSettingsPanel";
  }

  public static render(extensionUri: Uri, params: CfnDiagramSettingsInputParams) {
    log(`${PREFIX} render`);
    if (CfnDiagramSettingsPanel.currentPanel) {
      CfnDiagramSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "CfnDiagramSettingsType",
        "CloudFormation Diagram Settings",
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
      CfnDiagramSettingsPanel.currentPanel = new CfnDiagramSettingsPanel(panel, extensionUri);
    }
    CfnDiagramSettingsPanel.currentPanel.variables = params;
    CfnDiagramSettingsPanel.currentPanel.renderSub();
  }

  async renderSub() {
    if (!this.variables) {
      return;
    }
    const msg: CfnDiagramSettingsPanelEventData = {
      command: "initialize",
      componentName: "CfnDiagramSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    CfnDiagramSettingsPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "createCfnDiagram":
        await this.createCfnDiagram(params);
        return;
    }
  }

  private async createCfnDiagram(params: CfnDiagramGenerateParams): Promise<void> {
    if (!this.variables || !CfnDiagramSettingsPanel.stateStorage) {
      return;
    }
    const { conName } = this.variables;
    const {
      stackNames,
      mode,
      viewpoint,
      auxiliaryTreatment,
      outputFormat = "Mermaid",
      includeLegend = true,
    } = params;
    if (stackNames.length === 0) {
      window.showWarningMessage("Select at least one stack.");
      return;
    }

    const setting = await CfnDiagramSettingsPanel.stateStorage.getConnectionSettingByName(
      conName
    );
    if (!setting) {
      return;
    }

    const templateSources: CfnTemplatePreview[] = [];
    const { ok, message, result } = await workflow<AwsDriver>(
      setting,
      async (driver) => {
        if (!driver.cloudFormationClient) {
          throw new Error("CloudFormation is not configured for this connection.");
        }
        const stackTemplates = await Promise.all(
          stackNames.map(async (stackName) => ({
            fileName: stackName,
            templateJSONString: await driver.cloudFormationClient!.getTemplate({ stackName, convertTo: "json" }),
            templateSource: await driver.cloudFormationClient!.getTemplate({ stackName, convertTo: "yaml" }),
          }))
        );
        const list = stackTemplates.map(({ fileName, templateJSONString, templateSource }) => ({
          fileName,
          templateJSONString,
          templateSource,
        }));
        templateSources.push(...stackTemplates.map(({ fileName, templateSource }) => ({
          stackName: fileName,
          source: templateSource,
        })));
        if (outputFormat === "Drawio") {
          const drawioParams = { mode, viewpoint, auxiliaryTreatment, list, options: { includeLegend } };
          if (mode === "ApplicationDiagram") {
            return generateDrawioApplicationDiagram(drawioParams);
          }
          if (mode === "ArchitectureDiagram") {
            return generateDrawioArchitectureDiagram(drawioParams);
          }
          return generateDrawioCfnDependencyGraph(drawioParams);
        }
        const diagram = generateDiagram({ mode, viewpoint, auxiliaryTreatment, list, options: { includeLegend } });
        const heading = `## CloudFormation diagram: ${stackNames.join(", ")} (${mode})\n\n`;
        return heading + diagram;
      },
      true
    );

    if (!ok || result === undefined) {
      showWindowErrorMessage(message);
      return;
    }

    if (outputFormat === "Drawio") {
      await upsertCfnDiagramPreviewDrawio(result);
    } else {
      await upsertCfnDiagramPreviewNotebook(result, templateSources);
    }
  }
}
