import {
  AwsDriver,
  DBDriverResolver,
  DbDynamoTable,
  DbDynamoTableColumn,
  QueryItemsAtClientInputParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
  commands,
  NotebookCellData,
  NotebookCellKind,
  NotebookEdit,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  CREATE_NEW_NOTEBOOK,
  NOTEBOOK_TYPE,
  OPEN_MDH_VIEWER,
  REFRESH_SQL_HISTORIES,
} from "../constant";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  DynamoDBConditionParams,
  DynamoQueryBuildMode,
  DynamoQueryFilter,
  DynamoQueryProjectionConstraintView,
  DynamoQueryProjectionMode,
} from "../shared/DynamoDBConditionParams";
import { DynamoQueryPanelEventData } from "../shared/MessageEventData";
import { CellMeta } from "../types/Notebook";
import { MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getDatabaseConfig } from "../utilities/configUtil";
import {
  buildDynamoProjectionExpression,
  computeDynamoProjectionConstraint,
  resolveDynamoConsistentRead,
  resolveDynamoProjectionSelection,
} from "../utilities/dynamoDbProjection";
import {
  buildDynamoQueryDisplayText,
  buildDynamoQueryStructuralKey,
} from "../utilities/dynamoDbQueryStructural";
import { restoreDynamoQueryPanelState } from "../utilities/dynamoDbQueryPanelHistory";
import { buildDynamoPartiqlSelect } from "../utilities/dynamoDbPartiqlBuilder";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[DynamoQueryPanel]";

dayjs.extend(utc);

export class DynamoQueryPanel extends BasePanel {
  public static currentPanel: DynamoQueryPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private tableRes: DbDynamoTable | undefined = undefined;
  private queryInput: QueryItemsAtClientInputParams | undefined = undefined;
  private numOfRows = 0;
  private limit = getDatabaseConfig().limitRows;
  private target = "";
  private pkName = "";
  private skName = "";
  private pkValue = "";
  private skValue = "";
  private pkAttr = "";
  private skAttr = "";
  private skOpe = "";
  private previewInput = "";
  private sortDesc = false;
  private filters: DynamoQueryFilter[] = [];
  private projectionMode: DynamoQueryProjectionMode = "default";
  private projectedAttributes: string[] = [];
  private consistentRead = false;
  private buildMode: DynamoQueryBuildMode = "nativeQuery";
  private projectionConstraint: DynamoQueryProjectionConstraintView = {
    availableAttributes: [],
    projectedAttributes: [],
    allowAllTableAttributesOption: false,
    restrictToProjected: false,
    consistentReadAllowed: true,
  };

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    DynamoQueryPanel.currentPanel = new DynamoQueryPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    DynamoQueryPanel.stateStorage = storage;
  }

  public static async render(
    extensionUri: Uri,
    tableRes: DbDynamoTable,
    historyInput?: QueryItemsAtClientInputParams
  ): Promise<void> {
    if (tableRes === null || tableRes === undefined) {
      throw new Error("tableRes must be defined");
    }
    if (DynamoQueryPanel.currentPanel) {
      DynamoQueryPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "DynamoQueryPanelViewType",
        "DynamoDB Query Panel",
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
      DynamoQueryPanel.currentPanel = new DynamoQueryPanel(panel, extensionUri);
    }
    await DynamoQueryPanel.currentPanel.renderSub(tableRes, historyInput);
  }

  getComponentName(): ComponentName {
    return "DynamoQueryPanel";
  }

  async renderSub(
    tableRes: DbDynamoTable,
    historyInput?: QueryItemsAtClientInputParams
  ): Promise<void> {
    const { conName } = tableRes.meta;
    const setting = await DynamoQueryPanel.stateStorage?.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    this.tableRes = tableRes;
    this.numOfRows = tableRes.attr?.ItemCount ?? 0;
    this.target = "$table";
    this.limit = getDatabaseConfig().limitRows;
    this.pkValue = "";
    this.skValue = "";
    this.skOpe = "";
    this.sortDesc = false;
    this.queryInput = undefined;
    this.filters = [];
    this.projectionMode = "default";
    this.projectedAttributes = [];
    this.consistentRead = false;
    this.buildMode = "nativeQuery";

    if (historyInput) {
      const restored = restoreDynamoQueryPanelState(historyInput, tableRes);
      this.target = restored.target;
      this.limit = restored.limit ?? this.limit;
      this.pkValue = restored.pkValue;
      this.skValue = restored.skValue;
      this.skOpe = restored.skOpe;
      this.sortDesc = restored.sortDesc;
      this.filters = restored.filters;
      this.projectionMode = restored.projectionMode;
      this.projectedAttributes = restored.projectedAttributes;
      this.consistentRead = restored.consistentRead;
    }

    this.resetByTarget();
    this.init();
  }

  async init() {
    if (this.tableRes === undefined) {
      return;
    }
    const msg2: DynamoQueryPanelEventData = {
      command: "initialize",
      componentName: "DynamoQueryPanel",
      value: {
        initialize: {
          tableRes: this.tableRes,
          previewInput: this.previewInput,
          limit: this.limit,
          numOfRows: this.numOfRows,
          pkName: this.pkName,
          skName: this.skName,
          pkValue: this.pkValue,
          skValue: this.skValue,
          pkAttr: this.pkAttr,
          skAttr: this.skAttr,
          skOpe: this.skOpe,
          target: this.target,
          sortDesc: this.sortDesc,
          filters: this.filters,
          columnItems: this.tableRes.children.map((it) => ({
            label: `${it.name} [${it.attrType}]`,
            value: it.name,
          })),
          projectionMode: this.projectionMode,
          projectedAttributes: this.projectedAttributes,
          consistentRead: this.consistentRead,
          buildMode: this.buildMode,
          projectionConstraint: this.projectionConstraint,
        },
      },
    };
    this.panel.webview.postMessage(msg2);
  }

  public preDispose(): void {
    DynamoQueryPanel.currentPanel = undefined;
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;

    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "ok":
        {
          const {
            target,
            limit,
            pkValue,
            skValue,
            skOpe,
            preview,
            sortDesc,
            filters,
            projectionMode,
            projectedAttributes,
            consistentRead,
            buildMode,
            openInNotebook,
            inActiveNotebook,
          } = params as DynamoDBConditionParams;
          this.limit = limit;
          this.target = target;
          this.pkValue = pkValue;
          this.skValue = skValue;
          this.skOpe = skOpe;
          this.sortDesc = sortDesc;
          this.filters = filters;
          // Never trusted as-is - resetByTarget() re-derives the
          // constraint for `target` and re-resolves both against it before
          // building queryInput (design doc §6.5).
          this.projectionMode = projectionMode;
          this.projectedAttributes = projectedAttributes;
          this.consistentRead = consistentRead;
          this.buildMode = buildMode ?? "nativeQuery";
          this.resetByTarget();

          if (openInNotebook) {
            if (this.buildMode !== "partiql") {
              showWindowErrorMessage("Select PartiQL before opening the query in a Notebook.");
              return;
            }
            if (!this.pkValue || !this.queryInput) {
              showWindowErrorMessage("Enter a partition key value before opening the query.");
              return;
            }
            if (this.projectionMode === "specific" && this.projectedAttributes.length === 0) {
              showWindowErrorMessage("Select at least one Projection attribute.");
              return;
            }
            await this.openPartiqlInNotebook(inActiveNotebook === true);
            return;
          }

          if (preview) {
            this.init();
            return;
          }

          if (this.projectionMode === "specific" && this.projectedAttributes.length === 0) {
            showWindowErrorMessage("Select at least one Projection attribute before executing the Query.");
            return;
          }

          const { tableRes, queryInput } = this;
          if (!tableRes || !queryInput || !DynamoQueryPanel.stateStorage) {
            return;
          }
          const { conName } = tableRes.meta;
          const setting = await DynamoQueryPanel.stateStorage.getConnectionSettingByName(conName);
          if (!setting) {
            return;
          }

          const { ok, message, result } = await DBDriverResolver.getInstance().workflow<
            AwsDriver,
            ResultSetData
          >(setting, async (driver) => {
            log(`${PREFIX} query:[${queryInput}]`);

            return await driver.dynamoClient.queryItemsAtClient(queryInput);
          });

          if (ok && result) {
            const commandParam: MdhViewParams = { title: tableRes.name, list: [result] };
            commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
            await this.saveHistory({
              connectionName: conName,
              queryInput,
              result,
              status: "success",
            });
          } else {
            showWindowErrorMessage(message);
            await this.saveHistory({
              connectionName: conName,
              queryInput,
              status: "error",
              errorMessage: message,
            });
          }
        }
        return;
    }
  }

  private async openPartiqlInNotebook(inActiveNotebook: boolean): Promise<void> {
    const { tableRes, queryInput } = this;
    if (!tableRes || !queryInput) {
      return;
    }
    let partiql: string;
    try {
      partiql = buildDynamoPartiqlSelect({ input: queryInput, sortKeyName: this.skName });
    } catch (error) {
      showWindowErrorMessage(error);
      return;
    }

    const cell = new NotebookCellData(NotebookCellKind.Code, partiql, "sql");
    const metadata: CellMeta = { connectionName: tableRes.meta.conName };
    cell.metadata = metadata;

    if (!inActiveNotebook) {
      await commands.executeCommand(CREATE_NEW_NOTEBOOK, [cell]);
      this.dispose();
      return;
    }

    // Closing the webview returns focus to the previously active Notebook;
    // mirror ViewConditionPanel's delayed insertion path.
    this.dispose();
    setTimeout(async () => {
      const activeEditor = window.activeNotebookEditor;
      if (!activeEditor || activeEditor.notebook.notebookType !== NOTEBOOK_TYPE) {
        showWindowErrorMessage("No active notebook editor found.");
        return;
      }
      const edit = new WorkspaceEdit();
      const notebookEdit = NotebookEdit.insertCells(activeEditor.selection.end, [cell]);
      edit.set(activeEditor.notebook.uri, [notebookEdit]);
      await workspace.applyEdit(edit);
    }, 100);
  }

  // Saves a Query Panel execution (success or failure) to SQL History as a
  // "dynamodbQuery"-kind entry (design doc §7.1/§7.2), and refreshes the
  // History tree the same way every other addSQLHistory() caller does. A
  // failed execution reuses the same structuralKey, so StateStorage's own
  // merge logic (never this method's job) folds it into the prior success
  // instead of overwriting it.
  private async saveHistory(params: {
    connectionName: string;
    queryInput: QueryItemsAtClientInputParams;
    result?: ResultSetData;
    status: "success" | "error";
    errorMessage?: string;
  }): Promise<void> {
    if (!DynamoQueryPanel.stateStorage) {
      return;
    }
    const { connectionName, queryInput, result, status, errorMessage } = params;
    const displayText = buildDynamoQueryDisplayText(queryInput);
    const structuralKey = buildDynamoQueryStructuralKey(queryInput);

    await DynamoQueryPanel.stateStorage.addSQLHistory({
      connectionName,
      sqlDoc: displayText,
      request: {
        kind: "dynamodbQuery",
        origin: "dynamoQueryPanel",
        input: queryInput,
        structuralKey,
        displayText,
      },
      meta: result?.meta,
      summary: result?.summary,
      executedAt: Date.now(),
      status,
      errorMessage,
    });
    commands.executeCommand(REFRESH_SQL_HISTORIES);
  }

  private resetByTarget() {
    if (this.tableRes === undefined) {
      return;
    }
    let pkCol: DbDynamoTableColumn | undefined = undefined;
    let skCol: DbDynamoTableColumn | undefined = undefined;
    let indexName: string | undefined = undefined;

    if (this.target === "$table") {
      pkCol = this.tableRes.children.find((it) => it.pk);
      skCol = this.tableRes.children.find((it) => it.sk);
    } else if (this.target.startsWith("$lsi:")) {
      indexName = this.target.slice(5);
      const lsi = this.tableRes.attr.lsi.find((it) => it.IndexName === indexName);
      if (lsi) {
        lsi.KeySchema?.forEach((key) => {
          if (key.KeyType === "HASH") {
            pkCol = this.tableRes?.children.find((it) => it.name === key.AttributeName);
          }
          if (key.KeyType === "RANGE") {
            skCol = this.tableRes?.children.find((it) => it.name === key.AttributeName);
          }
        });
      }
    } else if (this.target.startsWith("$gsi:")) {
      indexName = this.target.slice(5);
      const gsi = this.tableRes.attr.gsi.find((it) => it.IndexName === indexName);
      if (gsi) {
        gsi.KeySchema?.forEach((key) => {
          if (key.KeyType === "HASH") {
            pkCol = this.tableRes?.children.find((it) => it.name === key.AttributeName);
          }
          if (key.KeyType === "RANGE") {
            skCol = this.tableRes?.children.find((it) => it.name === key.AttributeName);
          }
        });
      }
    }
    this.pkName = pkCol?.name ?? "";
    this.pkAttr = pkCol?.attrType ?? "";
    this.skName = skCol?.name ?? "";
    this.skAttr = skCol?.attrType ?? "";

    // Never trust the webview's own projectionMode/projectedAttributes/
    // consistentRead as final - re-derive the constraint for the (possibly
    // just-switched-to) target and re-resolve both against it, so a target
    // switch clears an invalid selection immediately and a forged webview
    // message can't smuggle e.g. GSI + consistentRead:true through (design
    // doc §6.2/§6.5).
    this.projectionConstraint = computeDynamoProjectionConstraint(this.tableRes, this.target);
    const resolvedProjection = resolveDynamoProjectionSelection({
      mode: this.projectionMode,
      attributes: this.projectedAttributes,
      constraint: this.projectionConstraint,
    });
    this.projectionMode = resolvedProjection.mode;
    this.projectedAttributes = resolvedProjection.attributes;
    this.consistentRead = resolveDynamoConsistentRead(this.consistentRead, this.projectionConstraint);

    this.queryInput = {
      TableName: this.tableRes.name,
      IndexName: indexName,
      ExpressionAttributeNames: {
        "#pk": this.pkName,
      },
      KeyConditionExpression: `#pk = :pk`,
      ExpressionAttributeValues: {},
      Limit: this.limit,
    };
    if (this.sortDesc) {
      this.queryInput.ScanIndexForward = false;
    }
    if (this.consistentRead) {
      // Left unset (never an explicit `false`) when off - eventual
      // consistency is DynamoDB's own unset-Query default (design doc
      // §6.2).
      this.queryInput.ConsistentRead = true;
    }
    const expressionAttributeValues = this.queryInput.ExpressionAttributeValues as any;
    expressionAttributeValues[":pk"] = {};
    expressionAttributeValues[":pk"][this.pkAttr] = this.pkValue;
    if (this.skName && this.skValue && this.skOpe) {
      this.queryInput!.ExpressionAttributeNames!["#sk"] = this.skName;
      switch (this.skOpe) {
        case "equal":
          this.queryInput.KeyConditionExpression += ` AND #sk = :sk`;
          break;
        case "lessThan":
          this.queryInput.KeyConditionExpression += ` AND #sk < :sk`;
          break;
        case "lessThanInclusive":
          this.queryInput.KeyConditionExpression += ` AND #sk <= :sk`;
          break;
        case "greaterThan":
          this.queryInput.KeyConditionExpression += ` AND #sk > :sk`;
          break;
        case "greaterThanInclusive":
          this.queryInput.KeyConditionExpression += ` AND #sk >= :sk`;
          break;
        case "between":
          this.queryInput.KeyConditionExpression += ` AND #sk BETWEEN :sk1 AND :sk2`;
          break;
        case "beginsWith":
          this.queryInput.KeyConditionExpression += ` AND begins_with(#sk, :sk)`;
          break;
      }
      if (this.skOpe === "between") {
        const vals = this.skValue.split(",");
        if (vals.length >= 2) {
          expressionAttributeValues[":sk1"] = {};
          expressionAttributeValues[":sk1"][this.skAttr] = vals[0].trim();
          expressionAttributeValues[":sk2"] = {};
          expressionAttributeValues[":sk2"][this.skAttr] = vals[1].trim();
        }
      } else {
        expressionAttributeValues[":sk"] = {};
        expressionAttributeValues[":sk"][this.skAttr] = this.skValue;
      }
    }
    if (this.filters.length > 0) {
      this.queryInput.FilterExpression = "";
    }
    this.filters.forEach((filter, idx) => {
      const escapedFilterName = filter.name.replace(/['"]/g, "").replace(/ /g, "_");
      const flterAlias = `#f${idx}_${escapedFilterName}`;
      const filterValueKey = `:f${idx}_${escapedFilterName}`;
      const filterAttrType = this.tableRes?.children.find(
        (it) => it.name === filter.name
      )?.attrType;
      if (!filterAttrType) {
        return;
      }
      this.queryInput!.ExpressionAttributeNames![flterAlias] = filter.name;
      if (idx > 0) {
        this.queryInput!.FilterExpression += " AND ";
      }
      switch (filter.operator) {
        case "equal":
          this.queryInput!.FilterExpression += `${flterAlias} = ${filterValueKey}`;
          break;
        case "lessThan":
          this.queryInput!.FilterExpression += `${flterAlias} < ${filterValueKey}`;
          break;
        case "lessThanInclusive":
          this.queryInput!.FilterExpression += `${flterAlias} <= ${filterValueKey}`;
          break;
        case "greaterThan":
          this.queryInput!.FilterExpression += `${flterAlias} > ${filterValueKey}`;
          break;
        case "greaterThanInclusive":
          this.queryInput!.FilterExpression += `${flterAlias} >= ${filterValueKey}`;
          break;
        case "between":
          this.queryInput!.FilterExpression += `${flterAlias} BETWEEN :F${idx}${escapedFilterName}1 AND :F${idx}${escapedFilterName}2`;
          break;
        case "beginsWith":
          this.queryInput!.FilterExpression += `begins_with(${flterAlias}, ${filterValueKey})`;
          break;
        case "contains":
          this.queryInput!.FilterExpression += `contains(${flterAlias}, ${filterValueKey})`;
          break;
      }
      if (filter.operator === "between") {
        const vals = filter.value.split(",");
        if (vals.length >= 2) {
          expressionAttributeValues[`:F${idx}${escapedFilterName}1`] = {};
          expressionAttributeValues[`:F${idx}${escapedFilterName}1`][filterAttrType] =
            vals[0].trim();
          expressionAttributeValues[`:F${idx}${escapedFilterName}2`] = {};
          expressionAttributeValues[`:F${idx}${escapedFilterName}2`][filterAttrType] =
            vals[1].trim();
        }
      } else {
        expressionAttributeValues[filterValueKey] = {};
        expressionAttributeValues[filterValueKey][filterAttrType] = filter.value;
      }
    });

    const projection = buildDynamoProjectionExpression(this.projectionMode, this.projectedAttributes);
    if (projection.select) {
      this.queryInput.Select = projection.select;
    }
    if (projection.projectionExpression) {
      this.queryInput.ProjectionExpression = projection.projectionExpression;
      Object.assign(this.queryInput.ExpressionAttributeNames!, projection.expressionAttributeNames);
    }

    if (this.buildMode === "partiql") {
      try {
        this.previewInput = buildDynamoPartiqlSelect({
          input: this.queryInput,
          sortKeyName: this.skName,
        });
      } catch (error) {
        this.previewInput = `PartiQL build error: ${(error as Error).message}`;
      }
    } else {
      this.previewInput = JSON.stringify(this.queryInput, null, 2);
    }
  }
}
