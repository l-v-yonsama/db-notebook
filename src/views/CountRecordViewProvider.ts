import { commands, window, ExtensionContext, ProgressLocation, Uri, env } from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import {
  ChangeInNumbersAnnotation,
  DBDriverResolver,
  DbSchema,
  GeneralColumnType,
  RDSBaseDriver,
  RdhRow,
  RdhRowMeta,
  ResultSetData,
  ResultSetDataBuilder,
  createRdhKey,
  sleep,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID } from "../constant";
import { ActionCommand, OutputParams } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { CountRecordViewEventData } from "../shared/MessageEventData";
import { waitUntil } from "../utilities/waitUntil";
import { BaseViewProvider } from "./BaseViewProvider";
import path = require("path");
import { createBookFromList } from "../utilities/excelGenerator";

const PREFIX = "[CountRecordView]";
dayjs.extend(utc);

export class CountRecordViewProvider extends BaseViewProvider {
  private schemaRes: DbSchema | undefined = undefined;
  private selectedTableNames: string[] = [];
  private mode: "setting" | "running" | "show" = "setting";
  private rdh: ResultSetData | undefined = undefined;

  constructor(
    viewId: string,
    context: ExtensionContext,
    private readonly stateStorage: StateStorage
  ) {
    super(viewId, context);
  }

  getComponentName(): ComponentName {
    return "CountRecordView";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "cancel":
        this.webviewView = undefined;
        this.init();

        await commands.executeCommand(
          "setContext",
          BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID + ".visible",
          false
        );
        break;
      case "countAllTables":
        this.doCount(params.selectedTableNames);
        break;
      case "output":
        this.output(params);
        break;
    }
  }

  async render(schemaRes: DbSchema) {
    if (this.webviewView === undefined) {
      await commands.executeCommand(
        "setContext",
        BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID + ".visible",
        true
      );
    }

    await commands.executeCommand(BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID + ".focus", {
      preserveFocus: true,
    });

    await waitUntil(() => this.webviewView !== undefined, 100);

    this.init();

    this.schemaRes = schemaRes;
    this.schemaRes.children.forEach((it) => this.selectedTableNames.push(it.name));

    this.renderSub();
  }

  protected onDidChangeVisibility(visible: boolean): void {
    if (visible === true) {
      if (!this.schemaRes) {
        return;
      }
      this.postMessage<CountRecordViewEventData>({
        command: "refresh",
        componentName: "CountRecordView",

        value: {
          refresh: {
            schemaRes: this.schemaRes,
            selectedTableNames: this.selectedTableNames,
            mode: this.mode,
            rdh: this.rdh,
          },
        },
      });
    }
  }

  private async renderSub() {
    this.onDidChangeVisibility(true);
  }

  private async output(data: OutputParams) {
    if (!this.rdh) {
      return;
    }
    const defaultFileName = `${dayjs().format("MMDD_HHmm")}_count_for_tables.xlsx`;
    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(path.join("./", defaultFileName)),
      filters: { "*": ["xlsx"] },
    });
    if (!uri) {
      return;
    }
    const message = await createBookFromList([this.rdh], uri.fsPath, {
      rdh: {
        outputAllOnOneSheet: true,
        outputWithType: data.outputWithType,
      },
    });
    if (message) {
      window.showErrorMessage(message);
    } else {
      window.showInformationMessage(uri.fsPath);
    }
  }

  private async doCount(selectedTableNames: string[]) {
    this.selectedTableNames.splice(0, this.selectedTableNames.length);
    selectedTableNames.forEach((it) => this.selectedTableNames.push(it));
    let rdb: ResultSetDataBuilder;

    let prevRow: RdhRow | undefined = undefined;
    const rowValues: { [key: string]: number | string } = {};

    const connectionSetting = await this.stateStorage.getConnectionSettingByName(
      this.schemaRes?.meta.conName
    );
    if (!connectionSetting) {
      window.showErrorMessage("Missing connection " + this.schemaRes?.meta.conName);
      return;
    }

    if (this.rdh === undefined) {
      const keys = selectedTableNames.map((it) =>
        createRdhKey({
          name: it,
          comment: this.schemaRes?.children.find((t) => t.name === it)?.comment,
          type: GeneralColumnType.NUMERIC,
        })
      );
      keys.unshift(
        createRdhKey({
          name: "TOTAL",
          comment: "Total number of records",
          type: GeneralColumnType.NUMERIC,
        })
      );
      keys.unshift(
        createRdhKey({
          name: "TIME",
          comment: "Execution time",
          type: GeneralColumnType.TEXT,
        })
      );
      rdb = new ResultSetDataBuilder(keys);
    } else {
      rdb = ResultSetDataBuilder.from(this.rdh);
      rdb.updateMeta({
        schemaName: this.schemaRes?.name,
        connectionName: connectionSetting.name,
        tableName: "Count for all tables",
        comment: "Count for all tables",
      });
      if (this.rdh.rows.length) {
        prevRow = this.rdh.rows[this.rdh.rows.length - 1];
      }
    }

    this.mode = "running";
    await this.renderSub();

    const resolver = DBDriverResolver.getInstance();

    rowValues["TIME"] = dayjs().format("HH:mm:ss");

    const { ok, message } = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
      },
      async (progress, token) => {
        let driverForKill: RDSBaseDriver | undefined = undefined;

        token.onCancellationRequested(() => {
          driverForKill?.kill();
        });

        return await resolver.workflow<RDSBaseDriver>(connectionSetting, async (driver) => {
          driverForKill = driver;

          const increment = (1.0 / this.selectedTableNames.length) * 100;
          let total = 0;
          for (let i = 0; i < this.selectedTableNames.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }
            const selectedTableName = this.selectedTableNames[i];
            const count = await driver.count({
              schema: this.schemaRes?.name,
              table: selectedTableName,
            });

            rowValues[selectedTableName] = count!;
            total += count!;

            progress.report({
              message: `Count table: ${selectedTableName}`,
              increment,
            });
            if ((i + 1) % 10 === 0) {
              await sleep(50);
            }
          }
          rowValues["TOTAL"] = total;

          progress.report({
            message: `Completed.`,
            increment: 100,
          });
        });
      }
    );

    this.mode = "show";

    if (ok) {
      const meta: RdhRowMeta = {};

      if (prevRow !== undefined) {
        Object.keys(rowValues)
          .filter((it) => it !== "TIME")
          .forEach((name) => {
            if (rowValues[name] !== prevRow?.values[name]) {
              const cin: ChangeInNumbersAnnotation = {
                type: "Cin",
                values: {
                  value: (rowValues[name] as number) - prevRow?.values[name],
                },
              };
              meta[name] = [cin];
            }
          });
      }

      rdb.addRow(rowValues, meta);
      this.rdh = rdb.build();
      this.renderSub();
    } else {
      this.rdh = rdb.build();
      this.renderSub();
      window.showErrorMessage(`Count Error: ${message}`);
    }
  }

  private init() {
    this.schemaRes = undefined;
    this.selectedTableNames.splice(0, this.selectedTableNames.length);
    this.mode = "setting";
    this.rdh = undefined;
  }
}
