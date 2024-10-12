import {
  AwsDriver,
  DBDriverResolver,
  DbDynamoTable,
  DbDynamoTableColumn,
  QueryItemsAtClientInputParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";
import { commands, Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { OPEN_MDH_VIEWER } from "../constant";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { DynamoDBConditionParams, DynamoQueryFilter } from "../shared/DynamoDBConditionParams";
import { DynamoQueryPanelEventData } from "../shared/MessageEventData";
import { MdhViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { getDatabaseConfig } from "../utilities/configUtil";
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

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    DynamoQueryPanel.currentPanel = new DynamoQueryPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    DynamoQueryPanel.stateStorage = storage;
  }

  public static render(extensionUri: Uri, tableRes: DbDynamoTable) {
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
    DynamoQueryPanel.currentPanel.renderSub(tableRes);
  }

  getComponentName(): ComponentName {
    return "DynamoQueryPanel";
  }

  async renderSub(tableRes: DbDynamoTable): Promise<void> {
    const { conName } = tableRes.meta;
    const setting = await DynamoQueryPanel.stateStorage?.getConnectionSettingByName(conName);
    if (!setting) {
      return;
    }
    this.tableRes = tableRes;
    this.numOfRows = tableRes.attr?.ItemCount ?? 0;
    this.target = "$table";
    this.pkValue = "";
    this.skValue = "";
    this.queryInput = undefined;
    this.filters = [];

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
          const { target, limit, pkValue, skValue, skOpe, preview, sortDesc, filters } =
            params as DynamoDBConditionParams;
          this.limit = limit;
          this.target = target;
          this.pkValue = pkValue;
          this.skValue = skValue;
          this.skOpe = skOpe;
          this.sortDesc = sortDesc;
          this.filters = filters;
          this.resetByTarget();

          if (preview) {
            this.init();
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
          } else {
            showWindowErrorMessage(message);
          }
        }
        return;
    }
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

    this.previewInput = JSON.stringify(this.queryInput, null, 2);
  }
}
