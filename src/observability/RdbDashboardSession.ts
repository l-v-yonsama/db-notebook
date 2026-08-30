import {
  ConnectionSetting,
  DBType,
  RdbAccumulatedSample,
  RdbDashboardCapabilities,
  RdbDashboardSelection,
  RdbDashboardTarget,
  RdbRawSampleBatch,
  RdbSampleAccumulator,
  RDSBaseDriver,
  ResolvedRdbDashboard,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { randomUUID } from "crypto";
import { createRDSDriver, removeDriver } from "../utilities/driverResolver";
import { log } from "../utilities/logger";

const PREFIX = "[RdbDashboardSession]";

export type RdbDashboardSessionSnapshot = {
  capabilities: RdbDashboardCapabilities;
  dashboard: ResolvedRdbDashboard;
  rawBatch: RdbRawSampleBatch;
  accumulated: RdbAccumulatedSample;
};

export class RdbDashboardSession {
  private driver: RDSBaseDriver | undefined;
  private dashboard: ResolvedRdbDashboard | undefined;
  private accumulator: RdbSampleAccumulator | undefined;
  private target: RdbDashboardTarget | undefined;
  private selection: RdbDashboardSelection = {};
  private sampleSessionId = "";
  private sequence = 0;
  private closePromise: Promise<void> | undefined;
  private collectionPromise:
    | Promise<{ rawBatch: RdbRawSampleBatch; accumulated: RdbAccumulatedSample }>
    | undefined;

  isOpen(): boolean {
    return this.driver !== undefined;
  }

  isCollecting(): boolean {
    return this.collectionPromise !== undefined;
  }

  async open(
    setting: ConnectionSetting,
    target: RdbDashboardTarget,
    selection: RdbDashboardSelection,
    signal: AbortSignal
  ): Promise<RdbDashboardSessionSnapshot> {
    await this.close();
    this.closePromise = undefined;
    const observerSetting: ConnectionSetting = {
      ...setting,
      database: target.databaseName,
      queryTimeoutMs: 3_000,
      // sql.js writes its in-memory image back on close unless readOnly is enabled.
      // Other vendors retain the user's setting; SQL Server readOnlyIntent can
      // route the observer to a different replica than the selected resource.
      ...(setting.dbType === DBType.SQLite ? { readOnly: true } : {}),
    };
    const driver = await createRDSDriver<RDSBaseDriver>(observerSetting, true);
    this.driver = driver;
    this.target = target;
    this.selection = { ...selection };
    this.sampleSessionId = randomUUID();
    this.sequence = 0;
    try {
      const connectionError = await driver.connect();
      if (connectionError) {
        throw new Error("The observer connection could not be opened for this database.");
      }
      if (signal.aborted) {
        throw new DOMException("RDB dashboard request was cancelled.", "AbortError");
      }
      const capabilitiesResult = await driver.checkRdbDashboardAvailability(target, { signal });
      if (!capabilitiesResult.ok || !capabilitiesResult.result) {
        throw new Error(capabilitiesResult.message || "RDB dashboard is unavailable.");
      }
      const dashboardResult = await driver.resolveRdbDashboard(target, selection, { signal });
      if (!dashboardResult.ok || !dashboardResult.result) {
        throw new Error(dashboardResult.message || "RDB dashboard could not be resolved.");
      }
      this.dashboard = dashboardResult.result;
      this.accumulator = new RdbSampleAccumulator(
        this.dashboard.metrics,
        this.dashboard.samplePolicy
      );
      const collected = await this.collectOnce(signal);
      return {
        capabilities: capabilitiesResult.result,
        dashboard: this.dashboard,
        ...collected,
      };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async collectOnce(
    signal: AbortSignal
  ): Promise<{ rawBatch: RdbRawSampleBatch; accumulated: RdbAccumulatedSample }> {
    if (this.collectionPromise) {
      throw new Error("An RDB dashboard sample is already being collected.");
    }
    if (!this.driver || !this.dashboard || !this.accumulator || !this.target) {
      throw new Error("The RDB dashboard observer session is not open.");
    }
    const driver = this.driver;
    const dashboard = this.dashboard;
    const accumulator = this.accumulator;
    const target = this.target;
    const collectionPromise = (async () => {
      const request = {
        target,
        sampleSessionId: this.sampleSessionId,
        definitionVersion: dashboard.definitionVersion,
        sequence: this.sequence++,
        selection: this.selection,
        metricIds: dashboard.metrics.map((metric) => metric.id),
      };
      const result = await driver.collectRdbDashboardSample(request, {
        signal,
        timeoutMs: dashboard.samplePolicy.queryTimeoutMs,
      });
      if (!result.ok || !result.result) {
        throw new Error(result.message || "RDB dashboard sample collection failed.");
      }
      if (signal.aborted) {
        throw new DOMException("RDB dashboard request was cancelled.", "AbortError");
      }
      if (this.driver !== driver || this.accumulator !== accumulator) {
        throw new DOMException("The RDB dashboard observer session changed.", "AbortError");
      }
      return {
        rawBatch: result.result,
        accumulated: accumulator.append(result.result),
      };
    })();
    this.collectionPromise = collectionPromise;
    try {
      return await collectionPromise;
    } finally {
      if (this.collectionPromise === collectionPromise) {
        this.collectionPromise = undefined;
      }
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    const driver = this.driver;
    this.driver = undefined;
    this.dashboard = undefined;
    this.accumulator = undefined;
    this.target = undefined;
    this.selection = {};
    this.collectionPromise = undefined;
    if (!driver) {
      return;
    }
    this.closePromise = (async () => {
      try {
        await driver.disconnect();
      } catch (error) {
        log(`${PREFIX} observer disconnect failed: ${String(error)}`);
      } finally {
        removeDriver(driver);
      }
    })();
    return this.closePromise;
  }
}
