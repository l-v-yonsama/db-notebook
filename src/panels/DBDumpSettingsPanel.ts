import {
  ConnectionSetting,
  DbDatabase,
  DbResource,
  DBType,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import dayjs from "dayjs";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  DBDumpInputParams,
  DBDumpOptionParams,
  DBDumpSettingsUIParams,
} from "../shared/DBDumpParams";
import { ERDiagramSettingParams } from "../shared/ERDiagram";
import { DBDumpSettingsPanelEventData } from "../shared/MessageEventData";
import { DockerContainerSummary } from "../types/Docker";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { copyToClipboard } from "../utilities/clipboardUtil";
import {
  buildDockerContainerItems,
  listRunningDockerContainers,
} from "../utilities/dockerContainerUtil";
import { buildDumpCommand } from "../utilities/dumpCommandBuilder";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { createPreferredTerminal } from "../utilities/terminalUtil";
import { BasePanel } from "./BasePanel";

const PREFIX = "[DBDumpSettingsPanel]";

export class DBDumpSettingsPanel extends BasePanel {
  public static currentPanel: DBDumpSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private dbRes: DbResource | undefined;
  private rdb: DbDatabase | undefined;
  private con: ConnectionSetting | undefined;

  private variables: DBDumpInputParams | undefined;
  private uiParams: DBDumpSettingsUIParams = {
    schemas: [],
    tables: [],
    dockerContainerItems: [],
    previewCommand: "",
    scrollPos: 0,
  };
  private dockerContainers: DockerContainerSummary[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    DBDumpSettingsPanel.currentPanel = new DBDumpSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    DBDumpSettingsPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "DBDumpSettingsPanel";
  }

  public static render(extensionUri: Uri, dbRes: DbResource) {
    log(`${PREFIX} render`);
    if (DBDumpSettingsPanel.currentPanel) {
      DBDumpSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      const panel = window.createWebviewPanel(
        "DBDumpSettingsType",
        "DB Dump Settings",
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
      DBDumpSettingsPanel.currentPanel = new DBDumpSettingsPanel(panel, extensionUri);
    }
    DBDumpSettingsPanel.currentPanel.dbRes = dbRes;
    DBDumpSettingsPanel.currentPanel.renderSub();
  }

  private resetPreviewCommand() {
    if (!this.variables) {
      return;
    }
    this.uiParams.previewCommand = buildDumpCommand(this.variables, true);
  }

  private async createInputParams(): Promise<DBDumpInputParams> {
    const { con, dbRes } = this;
    if (!DBDumpSettingsPanel.stateStorage || !dbRes || !con) {
      throw new Error("Missing params");
    }
    const { conName, schemaName } = dbRes.meta;

    let options: DBDumpOptionParams[] = [];
    switch (con.dbType) {
      case "MySQL":
        options = mysqlDumpPresets;
        break;
      case "Postgres":
        options = postgresDumpPresets;
        break;
      case "SQLite":
        options = sqliteDumpPresets;
        break;
    }
    options = JSON.parse(JSON.stringify(options));

    options.forEach((it) => {
      if (it.defaultValue && it.param === undefined) {
        it.param = it.defaultValue;
      }
    });

    return {
      dbName: dbRes.name,
      dbType: con.dbType,
      executeDumpInDockerContainer: false,
      dockerContainerName: "",
      userName: con.user ?? "",
      password: con.password ?? "",
      targetScope: "database",
      selectedTables: [],
      selectedSchemas: schemaName ? [schemaName] : [],
      outputTarget: "file",
      outputFilePrefix: `${conName}_${dayjs().format("MMDD_HHmmss")}`,
      options,
    };
  }

  async renderSub() {
    if (!this.dbRes || !DBDumpSettingsPanel.stateStorage) {
      return;
    }

    const { conName } = this.dbRes.meta;
    this.rdb = DBDumpSettingsPanel.stateStorage.getFirstRdsDatabaseByName(conName);
    this.con = await DBDumpSettingsPanel.stateStorage.getConnectionSettingByName(conName);
    if (!this.con) {
      return;
    }

    this.variables = await this.createInputParams();
    await this.resetUiParams();

    const msg: DBDumpSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBDumpSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
          uiParams: this.uiParams,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    DBDumpSettingsPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "writeToClipboard":
        this.writeToClipboard(params);
        return;
      case "inputChange":
        this.handleChange(params);
        return;
      case "ok":
        this.dumpOnTerminal();
        return;
    }
  }

  private async dumpOnTerminal(): Promise<void> {
    if (!this.variables) {
      return;
    }

    const command = buildDumpCommand(this.variables, false);
    const { outputFilePrefix } = this.variables;

    if (!command) {
      showWindowErrorMessage("Dump command is empty.");
      return;
    }

    const terminalName = "DB Dump";
    let terminal = window.terminals.find((t) => t.name === terminalName);
    if (!terminal) {
      terminal = createPreferredTerminal(terminalName);
    }

    terminal.show(true);
    terminal.sendText(`echo "===== DB Dump Started: ${outputFilePrefix} ====="`, true);
    terminal.sendText(command, true);
  }

  private async handleChange(params: Partial<DBDumpInputParams>) {
    if (!this.variables) {
      return;
    }

    assignDefined(this.variables, params);
    this.uiParams.scrollPos = (params as any).scrollPos;

    await this.resetUiParams();

    const msg: DBDumpSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBDumpSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
          uiParams: this.uiParams,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  private async writeToClipboard(_: WriteToClipboardParams<ERDiagramSettingParams>) {
    if (!this.variables) {
      return;
    }
    const command = buildDumpCommand(this.variables, false);
    if (!command) {
      showWindowErrorMessage("Dump command is empty.");
      return;
    }
    copyToClipboard(command);
  }

  private async resetUiParams() {
    const { con, dbRes, variables, uiParams } = this;
    if (!DBDumpSettingsPanel.stateStorage || !dbRes || !con || !variables) {
      throw new Error("Missing params");
    }

    uiParams.schemas = dbRes.findChildren({ resourceType: ResourceType.Schema }).map((it) => ({
      value: it.name,
      label: it.name + (it.comment ? ` (${it.comment})` : ""),
    }));

    uiParams.tables = [];
    dbRes
      .findChildren({ resourceType: ResourceType.Schema })
      .filter((it) => variables.selectedSchemas.includes(it.name))
      .forEach((schemaRes) => {
        const schemaName = schemaRes.name;
        schemaRes.findChildren({ resourceType: ResourceType.Table }).forEach((tableRes) => {
          const fullName =
            con.dbType === DBType.Postgres ? `${schemaName}.${tableRes.name}` : tableRes.name;
          uiParams.tables.push({
            value: fullName,
            label: fullName + (tableRes.comment ? ` (${tableRes.comment})` : ""),
          });
        });
      });

    await this.resetDockerParams();
    this.resetPreviewCommand();
  }

  private async resetDockerParams(): Promise<void> {
    if (!this.variables?.executeDumpInDockerContainer) return;

    if (this.dockerContainers.length === 0) {
      this.dockerContainers = await listRunningDockerContainers();
    }

    this.uiParams.dockerContainerItems = buildDockerContainerItems(
      this.dockerContainers,
      this.variables.dbType
    );
  }
}

function assignDefined<T extends object>(target: T, src: Partial<T>) {
  for (const [key, value] of Object.entries(src)) {
    if (value !== undefined) {
      (target as any)[key] = value;
    }
  }
}

const mysqlDumpPresets: DBDumpOptionParams[] = [
  /* ========= content ========= */
  {
    id: "mysql-no-data",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--no-data",
    description: "Exclude table data (schema only)",
  },
  {
    id: "mysql-no-create-info",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--no-create-info",
    description: "Exclude table definitions (data only)",
    conflictsWith: ["mysql-no-data"],
  },
  {
    id: "mysql-skip-extended-insert",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--skip-extended-insert",
    description: "Output one INSERT statement per row (useful for diffs)",
  },
  {
    id: "mysql-complete-insert",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--complete-insert",
    description: "Include column names in INSERT statements",
  },

  /* ========= filter ========= */
  {
    id: "mysql-where",
    group: "filter",
    riskLevel: "caution",
    enabled: false,
    option: "--where",
    description: "Dump only rows matching a condition",
    descriptionDetail: "Specify a WHERE clause to filter rows. Example: is_deleted = 0 LIMIT 10",
    argType: "string",
    param: "",
  },

  /* ========= performance ========= */
  {
    id: "mysql-single-transaction",
    group: "performance",
    riskLevel: "safe",
    enabled: true,
    option: "--single-transaction",
    description: "Ensure a consistent snapshot using a single transaction",
  },
  {
    id: "mysql-quick",
    group: "performance",
    riskLevel: "safe",
    enabled: true,
    option: "--quick",
    description: "Retrieve rows one at a time to reduce memory usage",
  },
  {
    id: "mysql-disable-keys",
    group: "performance",
    riskLevel: "caution",
    enabled: false,
    option: "--disable-keys",
    description: "Disable index updates during INSERT operations",
  },

  /* ========= compat ========= */
  {
    id: "mysql-no-tablespaces",
    group: "compat",
    riskLevel: "safe",
    enabled: true,
    option: "--no-tablespaces",
    description: "Do not include tablespace information (avoid permission errors)",
  },
  {
    id: "mysql-default-charset",
    group: "compat",
    riskLevel: "safe",
    enabled: false,
    option: "--default-character-set",
    description: "Specify the default character set",
    argType: "enum",
    enumValues: ["utf8mb4", "utf8"],
    defaultValue: "utf8mb4",
  },
  {
    id: "mysql-set-gtid-purged",
    group: "compat",
    riskLevel: "caution",
    enabled: false,
    option: "--set-gtid-purged",
    description: "Control how GTID information is included",
    argType: "enum",
    enumValues: ["ON", "OFF", "AUTO"],
    defaultValue: "OFF",
  },

  /* ========= advanced ========= */
  {
    id: "mysql-skip-triggers",
    group: "advanced",
    riskLevel: "danger",
    enabled: false,
    option: "--skip-triggers",
    description: "Exclude triggers from the dump",
  },
];

const postgresDumpPresets: DBDumpOptionParams[] = [
  /* ========= content ========= */
  {
    id: "pg-schema-only",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--schema-only",
    description: "Dump schema definitions only (no data)",
  },
  {
    id: "pg-data-only",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--data-only",
    description: "Dump table data only (no schema)",
    conflictsWith: ["pg-schema-only"],
  },
  {
    id: "pg-column-inserts",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--column-inserts",
    description: "Use one INSERT per row with explicit column names (diff-friendly)",
  },

  /* ========= advanced ========= */
  {
    id: "pg-disable-triggers",
    group: "advanced",
    riskLevel: "danger",
    enabled: false,
    option: "--disable-triggers",
    description: "Disable triggers during data restore",
  },
];

const sqliteDumpPresets: DBDumpOptionParams[] = [
  /* ========= content ========= */
  {
    id: "sqlite-schema-only",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: ".schema",
    description: "Output schema definitions only",
  },
];
