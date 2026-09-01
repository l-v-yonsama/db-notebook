import {
  DbResource,
  RdbAccumulatedSample,
  RdbDashboardTarget,
  RdbRawSampleBatch,
  ResolvedRdbDashboard,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Disposable, Uri, ViewColumn, commands, window } from "vscode";
import { GET_LOCKS, GET_SESSIONS, SHOW_QUERY_STATISTICS } from "../constant";
import { DashboardRequestCoordinator } from "../observability/DashboardRequestCoordinator";
import { RdbDashboardSession } from "../observability/RdbDashboardSession";
import { rdbDashboardDisplayLabels } from "../observability/rdbDashboardDisplay";
import {
  buildRdbDashboardReport,
  buildRdbDashboardReportFilename,
} from "../observability/rdbDashboardNotebook";
import { saveRdbDashboardReportNotebook } from "../notebook/report/reportNotebookFileUtil";
import {
  RDB_DASHBOARD_TAB_SELECTOR_ID,
  toRdbDashboardInitializePayload,
  toRdbDashboardSeriesPayload,
} from "../observability/rdbDashboardPresenter";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import type {
  DashboardMessageEnvelope,
  RdbDashboardClientMessage,
  RdbDashboardHostMessage,
  RdbDashboardInitializePayload,
  RdbDashboardSeriesPayload,
  RdbSamplingState,
} from "../shared/observability";
import { formatConnectionEnvironmentCapitalized } from "../utilities/connectionEnvironmentDisplay";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { getDashboardLaunchCapabilities } from "../observability/dashboardLaunch";
import { BasePanel } from "./BasePanel";

const DASHBOARD_ID = "rdb-database";
const PREFIX = "[RdbDashboardPanel]";

export class RdbDashboardPanel extends BasePanel {
  static currentPanel: RdbDashboardPanel | undefined;
  private static stateStorage: StateStorage;

  private readonly coordinator = new DashboardRequestCoordinator();
  private readonly session = new RdbDashboardSession();
  private readonly dashboardDisposables: Disposable[] = [];
  private resource: DbResource | undefined;
  private resourceKey = "";
  private webviewReady = false;
  private activeTabId: string | undefined;
  private dashboard: ResolvedRdbDashboard | undefined;
  private accumulated: RdbAccumulatedSample | undefined;
  private lastRawBatch: RdbRawSampleBatch | undefined;
  private lastInitialize: RdbDashboardInitializePayload | undefined;
  private lastSeries: RdbDashboardSeriesPayload | undefined;
  private latestRequestId = 0;
  private samplingState: RdbSamplingState = "stopped";
  private samplingIntent = false;
  private sampleIntervalMs = 10_000;
  private sessionStartedAt: string | undefined;
  private hiddenDisconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private initializing = false;
  private initializeOnVisible = false;
  private refreshInFlight = false;

  private constructor(panel: ReturnType<typeof window.createWebviewPanel>, extensionUri: Uri) {
    super(panel, extensionUri);
    this.dashboardDisposables.push(
      this.getWebviewPanel().onDidChangeViewState(({ webviewPanel }) => {
        if (!webviewPanel.visible) {
          const wasSampling = this.samplingIntent;
          this.samplingIntent = false;
          this.coordinator.clearTimers();
          this.coordinator.cancelCurrent();
          if (wasSampling) {
            this.samplingState = "stopped";
            void this.postSamplingState(
              "Sampling stopped while the dashboard was hidden. Start it again to continue."
            );
          }
          this.scheduleHiddenDisconnect();
          return;
        }
        this.clearHiddenDisconnect();
        if (this.dashboard) {
          void this.postSamplingState();
        } else if (this.webviewReady && this.resource) {
          if (this.initializing) {
            this.initializeOnVisible = true;
          } else {
            void this.initializeTarget();
          }
        }
      })
    );
  }

  static setStateStorage(storage: StateStorage): void {
    RdbDashboardPanel.stateStorage = storage;
  }

  static render(extensionUri: Uri, resource: DbResource): void {
    if (!RdbDashboardPanel.currentPanel) {
      const panel = window.createWebviewPanel(
        "RdbDashboardType",
        "Database Dashboard",
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
      RdbDashboardPanel.currentPanel = new RdbDashboardPanel(panel, extensionUri);
    } else {
      RdbDashboardPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    }
    RdbDashboardPanel.currentPanel.setResource(resource);
  }

  getComponentName(): ComponentName {
    return "RdbDashboardView";
  }

  private setResource(resource: DbResource): void {
    const capability = getDashboardLaunchCapabilities(resource).find(
      (item) => item.dashboardId === DASHBOARD_ID
    );
    if (!capability) {
      void window.showErrorMessage("This resource does not provide a database dashboard.");
      return;
    }
    if (!resource.meta?.conName) {
      void window.showErrorMessage("The resource connection could not be resolved.");
      return;
    }
    this.samplingIntent = false;
    this.coordinator.clearTimers();
    this.coordinator.cancelCurrent();
    this.resource = resource;
    this.resourceKey = `${Date.now()}:${capability.providerId}:${resource.id}`;
    this.activeTabId = undefined;
    this.dashboard = undefined;
    this.accumulated = undefined;
    this.lastRawBatch = undefined;
    this.lastInitialize = undefined;
    this.lastSeries = undefined;
    this.sessionStartedAt = undefined;
    this.samplingState = "stopped";
    const titleName = rdbDashboardDisplayLabels(
      capability.providerId,
      String(capability.hints?.databaseName ?? resource.name)
    ).panelTitleName;
    this.getWebviewPanel().title = `${titleName} — Database Dashboard`;
    if (this.webviewReady) {
      const token = this.coordinator.begin(this.resourceKey);
      this.latestRequestId = token.requestId;
      void this.post("loading", token.requestId, { status: "loading" });
    }
    void this.session.close().then(() => {
      if (this.webviewReady && this.resource === resource) {
        if (this.initializing) {
          this.initializeOnVisible = true;
        } else {
          void this.initializeTarget();
        }
      }
    });
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const dashboardMessage = message as unknown as RdbDashboardClientMessage;
    if (dashboardMessage.command === "ready") {
      if (dashboardMessage.dashboardId !== DASHBOARD_ID) {
        return;
      }
      if (this.webviewReady) {
        await this.replayLatestState();
        return;
      }
      this.webviewReady = true;
      await this.initializeTarget();
      return;
    }
    if (
      dashboardMessage.dashboardId !== DASHBOARD_ID ||
      dashboardMessage.resourceKey !== this.resourceKey
    ) {
      return;
    }
    switch (dashboardMessage.command) {
      case "refresh":
        await this.refresh();
        return;
      case "cancelRefresh":
        await this.cancelRefresh();
        return;
      case "selectViewOption":
        await this.selectViewOption(
          dashboardMessage.payload.selectorId,
          dashboardMessage.payload.value
        );
        return;
      case "startSampling":
        await this.startSampling(dashboardMessage.payload.intervalMs);
        return;
      case "stopSampling":
        await this.stopSampling();
        return;
      case "changeSampleInterval":
        await this.changeSampleInterval(dashboardMessage.payload.intervalMs);
        return;
      case "openDrilldown":
        await this.openDrilldown(
          dashboardMessage.payload.actionId,
          dashboardMessage.payload.definitionVersion
        );
        return;
      case "exportToNotebook":
        await this.exportToNotebook();
        return;
      case "close":
        this.dispose();
        return;
    }
  }

  private async initializeTarget(): Promise<void> {
    const resource = this.resource;
    if (
      !resource ||
      !RdbDashboardPanel.stateStorage ||
      !this.getWebviewPanel().visible ||
      this.initializing
    ) {
      return;
    }
    this.initializing = true;
    try {
      await this.initializeTargetOnce(resource);
    } finally {
      this.initializing = false;
      const shouldInitializeCurrentResource =
        this.initializeOnVisible || this.resource !== resource;
      this.initializeOnVisible = false;
      if (
        shouldInitializeCurrentResource &&
        this.webviewReady &&
        this.resource &&
        this.getWebviewPanel().visible
      ) {
        void this.initializeTarget();
      }
    }
  }

  private async initializeTargetOnce(resource: DbResource): Promise<void> {
    const capability = getDashboardLaunchCapabilities(resource).find(
      (item) => item.dashboardId === DASHBOARD_ID
    );
    if (!capability) {
      return;
    }
    const setting = await RdbDashboardPanel.stateStorage.getConnectionSettingByName(
      String(resource.meta.conName)
    );
    if (this.resource !== resource || !this.getWebviewPanel().visible) {
      return;
    }
    if (!setting) {
      await this.showError("The database connection setting is unavailable.");
      return;
    }
    const token = this.coordinator.begin(this.resourceKey);
    this.latestRequestId = token.requestId;
    await this.post("loading", token.requestId, { status: "loading" });
    try {
      const target: RdbDashboardTarget = {
        resourceKey: this.resourceKey,
        databaseName: String(capability.hints?.databaseName ?? resource.name),
        dbType: setting.dbType,
      };
      const snapshot = await this.session.open(setting, target, {}, token.signal);
      if (!this.coordinator.isCurrent(token) || !this.getWebviewPanel().visible) {
        await this.session.close();
        return;
      }
      this.dashboard = snapshot.dashboard;
      this.accumulated = snapshot.accumulated;
      this.lastRawBatch = snapshot.rawBatch;
      this.activeTabId = snapshot.dashboard.tabs[0]?.id;
      this.sampleIntervalMs = snapshot.dashboard.samplePolicy.defaultIntervalMs;
      this.sessionStartedAt = snapshot.rawBatch.collectionStartedAt;
      this.lastInitialize = toRdbDashboardInitializePayload({
        dashboard: snapshot.dashboard,
        activeTabId: this.activeTabId,
        environmentLabel: setting.environment
          ? formatConnectionEnvironmentCapitalized(setting.environment)
          : undefined,
      });
      this.lastSeries = toRdbDashboardSeriesPayload({
        dashboard: snapshot.dashboard,
        activeTabId: this.activeTabId,
        accumulated: snapshot.accumulated,
        collectedAt: snapshot.rawBatch.collectionEndedAt,
      });
      await this.post("initialize", token.requestId, this.lastInitialize);
      await this.post("replace-series", token.requestId, this.lastSeries);
      await this.postSamplingState();
    } catch (error) {
      if (!this.coordinator.isCurrent(token)) {
        return;
      }
      log(`${PREFIX} initialize failed: ${String(error)}`);
      await this.showError("The database dashboard could not be loaded. Check the extension logs.");
    }
  }

  private async refresh(background = false): Promise<void> {
    if (!this.getWebviewPanel().visible) {
      return;
    }
    if (this.refreshInFlight || this.session.isCollecting()) {
      if (this.samplingIntent) {
        this.scheduleNextSample();
        await this.postSamplingState();
      }
      return;
    }
    if (!this.session.isOpen() || !this.dashboard) {
      await this.initializeTarget();
      return;
    }
    this.refreshInFlight = true;
    this.coordinator.clearTimers();
    const token = this.coordinator.begin(this.resourceKey);
    this.latestRequestId = token.requestId;
    await this.post("loading", token.requestId, {
      status: "loading",
      preserveResults: background,
    });
    try {
      const result = await this.session.collectOnce(token.signal);
      if (!this.coordinator.isCurrent(token) || !this.dashboard) {
        return;
      }
      this.accumulated = result.accumulated;
      this.lastRawBatch = result.rawBatch;
      this.lastSeries = toRdbDashboardSeriesPayload({
        dashboard: this.dashboard,
        activeTabId: this.activeTabId,
        accumulated: result.accumulated,
        collectedAt: result.rawBatch.collectionEndedAt,
      });
      await this.post("replace-series", token.requestId, this.lastSeries);
      await this.postSamplingState();
    } catch (error) {
      if (!this.coordinator.isCurrent(token)) {
        return;
      }
      log(`${PREFIX} refresh failed: ${String(error)}`);
      this.samplingState = "error";
      this.samplingIntent = false;
      await this.showError("The database dashboard sample could not be collected.");
      await this.postSamplingState("Sampling stopped after a collection error.");
    } finally {
      this.refreshInFlight = false;
      if (this.samplingIntent) {
        this.scheduleNextSample();
      }
    }
  }

  private async exportToNotebook(): Promise<void> {
    if (!this.dashboard || !this.accumulated || !this.lastRawBatch) {
      await window.showWarningMessage("Refresh the dashboard before exporting it to a notebook.");
      return;
    }
    const snapshot = {
      dashboard: this.dashboard,
      accumulated: this.accumulated,
      activeTabId: this.activeTabId,
      environmentLabel: this.lastInitialize?.target.environmentLabel,
      samplingStartedAt: this.sessionStartedAt,
      collectedAt: this.lastRawBatch.collectionEndedAt,
      intervalMs: this.sampleIntervalMs,
      samplingState: this.samplingState,
    };
    const report = buildRdbDashboardReport(snapshot);
    const result = await saveRdbDashboardReportNotebook(
      report,
      buildRdbDashboardReportFilename(snapshot)
    );
    if (!result.ok) {
      await window.showErrorMessage(result.message);
      return;
    }
    await window.showInformationMessage(`Saved ${result.relativePath}`);
  }

  private async selectViewOption(selectorId: string, value: string): Promise<void> {
    if (
      selectorId !== RDB_DASHBOARD_TAB_SELECTOR_ID ||
      !this.dashboard?.tabs.some((tab) => tab.id === value)
    ) {
      return;
    }
    this.activeTabId = value;
    if (!this.accumulated || !this.lastRawBatch) {
      return;
    }
    this.lastInitialize = toRdbDashboardInitializePayload({
      dashboard: this.dashboard,
      activeTabId: value,
      environmentLabel: this.lastInitialize?.target.environmentLabel,
    });
    this.lastSeries = toRdbDashboardSeriesPayload({
      dashboard: this.dashboard,
      activeTabId: value,
      accumulated: this.accumulated,
      collectedAt: this.lastRawBatch.collectionEndedAt,
    });
    await this.post("set-dashboard", this.latestRequestId, this.lastInitialize);
    await this.post("replace-series", this.latestRequestId, this.lastSeries);
  }

  private async startSampling(intervalMs: number): Promise<void> {
    if (!this.dashboard) {
      return;
    }
    if (!this.dashboard.samplePolicy.allowedIntervalMs.includes(intervalMs)) {
      return;
    }
    this.sampleIntervalMs = intervalMs;
    this.samplingIntent = true;
    this.samplingState = "running";
    await this.postSamplingState();
    this.scheduleNextSample();
  }

  private async stopSampling(): Promise<void> {
    this.samplingIntent = false;
    this.samplingState = "stopped";
    this.coordinator.clearTimers();
    await this.postSamplingState();
  }

  private async changeSampleInterval(intervalMs: number): Promise<void> {
    if (!this.dashboard?.samplePolicy.allowedIntervalMs.includes(intervalMs)) {
      return;
    }
    this.sampleIntervalMs = intervalMs;
    await this.postSamplingState();
    if (this.samplingIntent) {
      this.scheduleNextSample();
    }
  }

  private scheduleNextSample(): void {
    this.coordinator.clearTimers();
    if (!this.samplingIntent || !this.getWebviewPanel().visible) {
      return;
    }
    const timer = setTimeout(() => void this.refresh(true), this.sampleIntervalMs);
    this.coordinator.registerTimer(timer);
  }

  private async cancelRefresh(): Promise<void> {
    const token = this.coordinator.cancelCurrent();
    if (token) {
      await this.post("refresh-cancelled", token.requestId, {});
    }
    if (this.samplingIntent) {
      this.scheduleNextSample();
      await this.postSamplingState();
    }
  }

  private async openDrilldown(actionId: string, definitionVersion: number): Promise<void> {
    if (
      !this.dashboard ||
      definitionVersion !== this.dashboard.definitionVersion ||
      !this.resource
    ) {
      return;
    }
    const action = this.dashboard.tabs
      .flatMap((tab) => tab.panels)
      .flatMap((panel) => panel.drilldownActions ?? [])
      .find((item) => item.id === actionId && item.enabled);
    if (!action) {
      return;
    }
    const command =
      action.kind === "open-sessions"
        ? GET_SESSIONS
        : action.kind === "open-locks"
        ? GET_LOCKS
        : SHOW_QUERY_STATISTICS;
    await commands.executeCommand(command, this.resource);
  }

  private async replayLatestState(): Promise<void> {
    await this.post("loading", this.latestRequestId, { status: "loading" });
    if (!this.lastInitialize) {
      if (this.resource && this.getWebviewPanel().visible) {
        await this.initializeTarget();
      }
      return;
    }
    await this.post("initialize", this.latestRequestId, this.lastInitialize);
    if (this.lastSeries) {
      await this.post("replace-series", this.latestRequestId, this.lastSeries);
    }
    await this.postSamplingState();
  }

  private postSamplingState(message?: string): Thenable<boolean> {
    const startedAt = this.lastRawBatch?.collectionStartedAt;
    const endedAt = this.lastRawBatch?.collectionEndedAt;
    return this.post("set-sampling-state", this.latestRequestId, {
      state: this.samplingState,
      intervalMs: this.sampleIntervalMs,
      sessionStartedAt: this.sessionStartedAt,
      lastSampleAt: endedAt,
      lastSampleDurationMs:
        startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : undefined,
      nextSampleAt: this.samplingIntent
        ? new Date(Date.now() + this.sampleIntervalMs).toISOString()
        : undefined,
      message,
    });
  }

  private showError(message: string): Thenable<boolean> {
    return this.post("set-error", this.latestRequestId, { message });
  }

  private post<T extends RdbDashboardHostMessage["command"]>(
    command: T,
    requestId: number,
    payload: Extract<RdbDashboardHostMessage, { command: T }>["payload"]
  ): Thenable<boolean> {
    const envelope: DashboardMessageEnvelope<T, typeof payload> = {
      command,
      dashboardId: DASHBOARD_ID,
      requestId,
      resourceKey: this.resourceKey,
      payload,
    };
    return this.getWebviewPanel().webview.postMessage(envelope);
  }

  private scheduleHiddenDisconnect(): void {
    this.clearHiddenDisconnect();
    const delay = this.dashboard?.samplePolicy.hiddenDisconnectDelayMs ?? 30_000;
    this.hiddenDisconnectTimer = setTimeout(() => void this.session.close(), delay);
  }

  private clearHiddenDisconnect(): void {
    if (this.hiddenDisconnectTimer) {
      clearTimeout(this.hiddenDisconnectTimer);
    }
    this.hiddenDisconnectTimer = undefined;
  }

  protected preDispose(): void {
    this.samplingIntent = false;
    this.clearHiddenDisconnect();
    this.coordinator.dispose();
    for (const disposable of this.dashboardDisposables.splice(0)) {
      disposable.dispose();
    }
    void this.session.close();
    RdbDashboardPanel.currentPanel = undefined;
  }
}
