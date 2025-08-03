import {
  ConnectionSetting,
  DBDriverResolver,
  DbSubscription,
  isJson,
  MqttDatabase,
  MqttDriver,
  MqttQoS,
  MqttSubscriptionSetting,
  QueryParams,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import { Packet } from "mqtt-packet";
import { commands } from "vscode";
import {
  CLOSE_SUBSCRIPTION_PAYLOADS_VIEWER,
  OPEN_SUBSCRIPTION_PAYLOADS_VIEWER,
  SET_SUBSCRIPTION_PAYLOADS_VIEWER,
  UPDATE_SUBSCRIPTION_RES_AT_PAYLOADS_VIEWER,
} from "../constant";
import { ResourceTreeProvider } from "../resourceTree/ResourceTreeProvider";
import { SubscriptionPayloadsViewParams } from "../types/views";
import { showWindowErrorMessage } from "../utilities/alertUtil";
import { log } from "../utilities/logger";

export class MqttDriverManager {
  private static manageMap = new Map<string, MqttDriverManager>();
  private subscribeTimer: NodeJS.Timer | undefined = undefined;
  static dbResourceTree: ResourceTreeProvider;
  private subscriptionResList: DbSubscription[] = [];
  private beforeSummary: Record<
    string,
    {
      isSubscribed: boolean;
      numOfPayloads: number;
      lastTimestamp: number;
    }
  > = {};

  private constructor(private conSetting: ConnectionSetting, private driver: MqttDriver) {}

  static setDbResourceTreeProvider(dbResourceTree: ResourceTreeProvider) {
    MqttDriverManager.dbResourceTree = dbResourceTree;
  }

  static getInstance(conSetting: ConnectionSetting): MqttDriverManager {
    if (this.manageMap.has(conSetting.name)) {
      return this.manageMap.get(conSetting.name)!;
    }
    const driver = DBDriverResolver.getInstance().createDriver<MqttDriver>(conSetting);
    if (!driver) {
      throw new Error(`Driver ${conSetting.name} is not found`);
    }
    const manager = new MqttDriverManager(conSetting, driver);
    this.manageMap.set(conSetting.name, manager);
    return manager;
  }

  requestSql(params: QueryParams): Promise<ResultSetData> {
    return this.driver.requestSqlSub(params);
  }

  async connect(): Promise<string> {
    const r = this.driver.connect();
    return r;
  }

  isConnected(): boolean {
    return this.driver.isConnected;
  }

  async publish(
    subscription: string,
    message: string | Buffer,
    opts?: {
      qos?: MqttQoS;
      retain?: boolean;
      dup?: boolean;
      isJsonMessage?: boolean;
    }
  ): Promise<Packet | undefined> {
    if (opts?.isJsonMessage) {
      let text = Buffer.isBuffer(message) ? message.toString() : message;
      if (!isJson(text)) {
        throw new Error("Invalid JSON format");
      }
    }
    return await this.driver.publish(subscription, message, opts);
  }

  async clearTopicLasTimestamp(subscriptionName: string): Promise<void> {
    if (this.beforeSummary[subscriptionName]) {
      this.beforeSummary[subscriptionName].lastTimestamp = 0;
    }
  }

  async showSubscriptionView(subscriptionRes: DbSubscription): Promise<void> {
    const { conName } = subscriptionRes.meta;
    if (conName) {
      const rdh = this.driver.getByRdh(subscriptionRes.name);
      const commandParam: SubscriptionPayloadsViewParams = {
        conName,
        subscriptionRes: subscriptionRes,
        rdh: rdh.rows.length > 0 ? rdh : undefined,
      };
      commands.executeCommand(OPEN_SUBSCRIPTION_PAYLOADS_VIEWER, commandParam);
    }
  }

  async addSubscription(dbRes: MqttDatabase, sb: MqttSubscriptionSetting): Promise<void> {
    try {
      const { conName } = dbRes.meta;
      if (dbRes.children.find((it) => it.name === sb.name)) {
        throw new Error(`Subscription ${sb.name} is already exists.`);
      }
      const subscriptionRes = new DbSubscription(sb.name, sb.qos, {
        nl: sb.nl,
        rap: sb.rap,
        rh: sb.rh,
      });
      subscriptionRes.meta = {
        conName: conName,
        numOfPayloads: 0,
        parentRes: dbRes,
      };

      dbRes.addChild(subscriptionRes);

      MqttDriverManager.dbResourceTree.changeDbResourceTreeData(dbRes);

      await this.subscribe(subscriptionRes);
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
    }
  }

  editSubscription(
    dbRes: MqttDatabase,
    subscriptionRes: DbSubscription,
    sb: MqttSubscriptionSetting
  ) {
    try {
      const { conName } = dbRes.meta;

      const sbRes: any = subscriptionRes;
      sbRes.qos = sb.qos;
      sbRes.nl = sb.nl;
      sbRes.rap = sb.rap;
      sbRes.rh = sb.rh;

      MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
    }
  }

  async subscribe(subscriptionRes: DbSubscription, viewOpened = false): Promise<void> {
    try {
      const { conName } = subscriptionRes.meta;
      subscriptionRes.isInProgress = true;
      MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);
      log(`Subscribe to ${subscriptionRes.name}`);
      const params: MqttSubscriptionSetting = {
        name: subscriptionRes.name,
        qos: subscriptionRes.qos,
        nl: subscriptionRes.nl,
        rap: subscriptionRes.rap,
        rh: subscriptionRes.rh,
      };
      const r = this.driver.subscribe(params);
      const prevResIdx = this.subscriptionResList.findIndex(
        (it) => it.name === subscriptionRes.name
      );
      if (prevResIdx >= 0) {
        this.subscriptionResList.splice(prevResIdx, 1);
      }
      this.subscriptionResList.push(subscriptionRes);

      subscriptionRes.isSubscribed = true;

      if (!this.subscribeTimer) {
        this.subscribeTimer = setInterval(async () => {
          const summary = await this.driver.getTopicSummary();
          // console.log("summary=", summary);
          Object.keys(summary).forEach((subscription) => {
            const current = summary[subscription];
            if (
              current &&
              this.beforeSummary[subscription]?.lastTimestamp !== current.lastTimestamp
            ) {
              // diff
              const subscriptionRes = this.subscriptionResList.find(
                (it) => it.name === subscription
              );
              if (subscriptionRes) {
                subscriptionRes.isSubscribed = current.isSubscribed;
                subscriptionRes.meta.numOfPayloads = current.numOfPayloads;
                const jsonExpansion = subscriptionRes.meta.jsonExpansion ?? false;
                MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);
                const rdh = this.driver.getByRdh(subscription, {
                  jsonExpansion,
                });
                const commandParam: SubscriptionPayloadsViewParams = {
                  conName,
                  subscriptionRes,
                  rdh: rdh.rows.length > 0 ? rdh : undefined,
                };
                commands.executeCommand(SET_SUBSCRIPTION_PAYLOADS_VIEWER, commandParam);
              }
            }
          });
          this.beforeSummary = summary;

          if (
            Object.values(summary).every((it) => it.isSubscribed === false) &&
            this.subscribeTimer
          ) {
            this.clearIntervalTimer();
          }
        }, 1000);
      }

      if (!viewOpened) {
        await this.showSubscriptionView(subscriptionRes);
      }
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
    }
    subscriptionRes.isInProgress = false;
    MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);
  }

  private clearIntervalTimer() {
    if (this.subscribeTimer) {
      clearInterval(this.subscribeTimer);
      this.subscribeTimer = undefined;
    }
  }

  async removeSubscription(
    parentRes: MqttDatabase,
    subscriptionRes: DbSubscription
  ): Promise<void> {
    const { conName } = subscriptionRes.meta;
    if (subscriptionRes.isSubscribed) {
      await this.unsubscribe(subscriptionRes);
    }
    const idx = parentRes.children.findIndex((it) => it.name === subscriptionRes.name);
    if (idx >= 0) {
      parentRes.children.splice(idx, 1);
    }

    MqttDriverManager.dbResourceTree.changeDbResourceTreeData(parentRes);
    const commandParam: SubscriptionPayloadsViewParams = {
      conName,
      subscriptionRes,
    };
    commands.executeCommand(CLOSE_SUBSCRIPTION_PAYLOADS_VIEWER, commandParam);
  }

  async unsubscribe(subscriptionRes: DbSubscription): Promise<void> {
    if (!subscriptionRes.isSubscribed) {
      return;
    }
    try {
      subscriptionRes.isInProgress = true;
      MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);
      log(`Unsubscribe to ${subscriptionRes.name}`);
      await this.driver.unsubscribe(subscriptionRes.name);
      subscriptionRes.isSubscribed = false;
      const prevResIdx = this.subscriptionResList.findIndex(
        (it) => it.name === subscriptionRes.name
      );
      if (prevResIdx >= 0) {
        this.subscriptionResList.splice(prevResIdx, 1);
      }
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
    }
    subscriptionRes.isInProgress = false;
    MqttDriverManager.dbResourceTree.changeDbResourceTreeData(subscriptionRes);

    const { conName } = subscriptionRes.meta;
    const commandParam: SubscriptionPayloadsViewParams = {
      conName,
      subscriptionRes,
    };
    commands.executeCommand(UPDATE_SUBSCRIPTION_RES_AT_PAYLOADS_VIEWER, commandParam);
  }

  async getInfomationSchemas(): Promise<MqttDatabase[]> {
    const r = this.driver.getInfomationSchemas();
    return r;
  }

  static async end(conSetting: ConnectionSetting): Promise<string> {
    let message = "";
    try {
      this.getInstance(conSetting).clearIntervalTimer();
      const driver = this.manageMap.get(conSetting.name)?.driver;
      if (driver && driver.isConnected) {
        message = await driver.disconnect();
      }
    } catch (e) {
      console.error(e);
      showWindowErrorMessage(e);
    }
    this.manageMap.delete(conSetting.name);
    return message;
  }

  static async closeAll() {
    for (const driverManager of Array.from(this.manageMap.values())) {
      driverManager.clearIntervalTimer();
      await driverManager.driver.disconnect();
    }
    this.manageMap.clear();
  }
}
