import {
  AllSubDbResource,
  DbResource,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import dayjs from "dayjs";
import execa from "execa";
import { Uri, ViewColumn, WebviewPanel, env, window } from "vscode";
import { ActionCommand, WriteToClipboardParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  DBDumpOptionParams,
  DBExportSettingsInputParams,
  DBExportSettingsUIParams,
} from "../shared/DBDumpParams";
import { ERDiagramSettingParams } from "../shared/ERDiagram";
import { DBExportSettingsPanelEventData } from "../shared/MessageEventData";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { buildDumpCommand } from "../utilities/dumpCommandBuilder";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { createPreferredTerminal } from "../utilities/terminalUtil";
import { BasePanel } from "./BasePanel";

export type DockerContainerSummary = {
  id: string;
  name: string;
  image: string;
  status: string;
};

const PREFIX = "[DBExportSettingsPanel]";

export class DBExportSettingsPanel extends BasePanel {
  public static currentPanel: DBExportSettingsPanel | undefined;
  private static stateStorage?: StateStorage;
  private dbRes: DbResource | undefined;
  private variables: DBExportSettingsInputParams | undefined;
  private uiParams: DBExportSettingsUIParams = {
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
    DBExportSettingsPanel.currentPanel = new DBExportSettingsPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    DBExportSettingsPanel.stateStorage = storage;
  }

  getComponentName(): ComponentName {
    return "DBExportSettingsPanel";
  }

  public static render(extensionUri: Uri, dbRes: DbResource) {
    log(`${PREFIX} render`);
    if (DBExportSettingsPanel.currentPanel) {
      DBExportSettingsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.Two);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "DBExportSettingsType",
        "DB Export Settings",
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
      DBExportSettingsPanel.currentPanel = new DBExportSettingsPanel(panel, extensionUri);
    }
    DBExportSettingsPanel.currentPanel.dbRes = dbRes;
    DBExportSettingsPanel.currentPanel.renderSub();
  }

  private resetPreviewCommand() {
    if (!this.variables) {
      return;
    }

    // preview 用 → マスクあり
    this.uiParams.previewCommand = buildDumpCommand(this.variables, true);
  }

  private async createInputParams(
    dbRes: DbResource<AllSubDbResource>
  ): Promise<DBExportSettingsInputParams> {
    if (!DBExportSettingsPanel.stateStorage) {
      throw new Error("Missing stateStorage");
    }
    const { conName, schemaName } = dbRes.meta;
    const rdb = DBExportSettingsPanel.stateStorage.getFirstRdsDatabaseByName(conName);
    const con = await DBExportSettingsPanel.stateStorage.getConnectionSettingByName(conName);
    if (!con) {
      throw new Error("Missing Connection setting");
    }
    const schema = rdb?.getSchema({ isDefault: true });

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

    options.forEach(it=>{
      if(it.defaultValue && it.param===undefined){
        it.param = it.defaultValue;
      }
    });

    this.uiParams.tables =
      schema?.children.filter((it) => it.resourceType === ResourceType.Table) ?? [];
    this.uiParams.previewCommand = "";

    return {
      dbName: dbRes.name,
      dbType: con.dbType,
      executeDumpInDockerContainer: false,
      dockerContainerName: "",
      userName: con.user ?? "",
      password: con.password ?? "",
      schemaName: schema?.name ?? "",
      targetScope: "database",
      selectedTables: [],
      outputTarget: "file",
      outputFilePrefix: `${conName}_${dayjs(new Date()).format("MMDD_HHmmss")}`,
      options,
    };
  }

  async renderSub() {
    if (!this.dbRes) {
      return;
    }
    this.variables = await this.createInputParams(this.dbRes);
    await this.resetDockerParams();
    this.resetPreviewCommand();

    const msg: DBExportSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBExportSettingsPanel",
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
    DBExportSettingsPanel.currentPanel = undefined;
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

    try {
      // 既存の同名ターミナルがあれば再利用
      const terminalName = "DB Dump";
      let terminal = window.terminals.find((t) => t.name === terminalName);

      if (!terminal) {
        terminal = createPreferredTerminal(terminalName);
      }

      // ターミナルを前面に表示
      terminal.show(true);

      // 視認性向上用のコメント（shell によっては無視される）
      terminal.sendText(`echo "===== DB Dump Started: ${outputFilePrefix} ====="`, true);

      // 実際の dump コマンド送信
      terminal.sendText(command, true);
    } catch (e) {
      showWindowErrorMessage(e);
    }
  }

  private async handleChange(params: Partial<DBExportSettingsInputParams>) {
    if (!this.variables) {
      return;
    }
    this.variables.outputTarget = params.outputTarget!;
    this.variables.outputFormat = params.outputFormat!;
    this.variables.outputFilePrefix = params.outputFilePrefix!;
    this.variables.outputCompression = params.outputCompression;

    this.variables.userName = params.userName!;
    this.variables.password = params.password!;
    this.variables.targetScope = params.targetScope!;
    this.variables.executeDumpInDockerContainer = params.executeDumpInDockerContainer!;
    this.variables.dockerContainerName = params.dockerContainerName!;
    this.variables.selectedTables = params.selectedTables!;
    this.variables.options = params.options!;
    this.uiParams.scrollPos = (params as any).scrollPos;

    await this.resetDockerParams();
    this.resetPreviewCommand();
    const msg: DBExportSettingsPanelEventData = {
      command: "initialize",
      componentName: "DBExportSettingsPanel",
      value: {
        initialize: {
          params: this.variables,
          uiParams: this.uiParams,
        },
      },
    };

    this.getWebviewPanel().webview.postMessage(msg);
  }

  private async writeToClipboard(params: WriteToClipboardParams<ERDiagramSettingParams>) {
    if (!this.variables) {
      return;
    }

    const command = buildDumpCommand(this.variables, false);

    if (!command) {
      showWindowErrorMessage("Dump command is empty.");
      return;
    }
    env.clipboard.writeText(command);
  }

  private async resetDockerParams(): Promise<void> {
    if (!this.variables) {
      return;
    }

    const { dbType, executeDumpInDockerContainer } = this.variables;

    if (!executeDumpInDockerContainer) {
      return;
    }

    if (this.dockerContainers.length === 0) {
      try {
        this.dockerContainers = await this.listRunningContainers();
      } catch (e) {
        showWindowErrorMessage(e);
        return;
      }
    }

    const keywords = this.getDbTypeKeywords(dbType);

    const sorted = [...this.dockerContainers].sort((a, b) => {
      const sa = this.scoreContainer(a, keywords);
      const sb = this.scoreContainer(b, keywords);
      return sb - sa; // 高スコアを前へ
    });

    this.uiParams.dockerContainerItems = sorted.map((it) => ({
      label: `${it.name} (${it.image})`,
      value: it.name,
    }));
  }
  private getDbTypeKeywords(dbType: DBExportSettingsInputParams["dbType"]): string[] {
    switch (dbType) {
      case "MySQL":
        return ["mysql", "mariadb"];
      case "Postgres":
        return ["postgres", "postgresql"];
      default:
        return [];
    }
  }

  private scoreContainer(c: DockerContainerSummary, keywords: string[]): number {
    const haystack = `${c.name} ${c.image}`.toLowerCase();
    return keywords.some((kw) => haystack.includes(kw)) ? 1 : 0;
  }
  private async listRunningContainers(): Promise<DockerContainerSummary[]> {
    const { stdout } = await execa("docker", [
      "ps",
      "--format",
      "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
    ]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout.split("\n").map((line: string) => {
      const [id, name, image, status] = line.split("\t");
      return { id, name, image, status };
    });
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
    description: "データを含めない（DDLのみ）",
  },
  {
    id: "mysql-no-create-info",

    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--no-create-info",
    description: "テーブル定義を含めない（データのみ）",
    conflictsWith: ["mysql-no-data"],
  },
  {
    id: "mysql-skip-extended-insert",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--skip-extended-insert",
    description: "INSERT 文を 1 行ずつ出力する（diff 向け）",
  },
  {
    id: "mysql-complete-insert",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--complete-insert",
    description: "INSERT 文にカラム名を含める",
  },

  /* ========= filter ========= */
  {
    id: "mysql-where",
    group: "filter",
    riskLevel: "caution",
    enabled: false,
    option: "--where",
    description: "条件付きでデータを抽出",
    descriptionDetail: "WHERE句を指定して行を絞り込む 例) is_deleted = 0 LIMIT 10",
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
    description: "トランザクション内で一貫性を保つ",
  },
  {
    id: "mysql-quick",

    group: "performance",
    riskLevel: "safe",
    enabled: true,
    option: "--quick",
    description: "逐次取得してメモリ使用量を抑える",
  },
  {
    id: "mysql-disable-keys",

    group: "performance",
    riskLevel: "caution",
    enabled: false,
    option: "--disable-keys",
    description: "INSERT中はインデックス更新を停止",
  },

  /* ========= compat ========= */
  {
    id: "mysql-no-tablespaces",
    group: "compat",
    riskLevel: "safe",
    enabled: true,
    option: "--no-tablespaces",
    description: "テーブルスペース情報を含めない（権限エラー回避）",
  },
  {
    id: "mysql-default-charset",

    group: "compat",
    riskLevel: "safe",
    enabled: false,
    option: "--default-character-set",
    description: "文字コードを指定",
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
    description: "GTID情報の扱いを制御",
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
    description: "トリガーを含めない",
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
    description: "DDLのみダンプ",
  },
  {
    id: "pg-data-only",

    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--data-only",
    description: "データのみダンプ",
    conflictsWith: ["pg-schema-only"],
  },
  {
    id: "pg-column-inserts",
    group: "content",
    riskLevel: "safe",
    enabled: false,
    option: "--column-inserts",
    description: "INSERT文を1行ずつ（カラム名付き）出力する（diff向け）",
  },

  /* ========= filter ========= */
  {
    id: "pg-table",

    group: "filter",
    riskLevel: "safe",
    enabled: false,
    option: "--table",
    description: "特定テーブルのみ",
    argType: "string",
  },

  /* ========= performance ========= */
  {
    id: "pg-jobs",

    group: "performance",
    riskLevel: "caution",
    enabled: false,
    option: "--jobs",
    description: "並列ダンプ",
    argType: "number",
  },

  /* ========= compat ========= */
  // {
  //   id: "pg-format",

  //   group: "compat",
  //   riskLevel: "safe",
  //   enabled: false,
  //   option: "--format",
  //   description: "出力形式",
  //   argType: "enum",
  //   enumValues: ["plain", "custom", "directory"],
  //   defaultValue: "plain",
  // },

  /* ========= advanced ========= */
  {
    id: "pg-disable-triggers",

    group: "advanced",
    riskLevel: "danger",
    enabled: false,
    option: "--disable-triggers",
    description: "トリガーを無効化",
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
    description: "スキーマのみ出力",
  },

  /* ========= filter ========= */
  // {
  //   id: "sqlite-table",

  //   group: "filter",
  //   riskLevel: "safe",
  //   enabled: false,
  //   option: ".dump",
  //   description: "特定テーブルのみダンプ",
  //   argType: "string",
  // },

  /* ========= advanced ========= */
  {
    id: "sqlite-foreign-keys-off",

    group: "advanced",
    riskLevel: "danger",
    enabled: false,
    option: "PRAGMA foreign_keys=OFF;",
    description: "外部キー制約を無効化",
  },
];
