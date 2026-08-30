import {
  AwsDriver,
  DbResource,
  MetricTimeRange,
  MetricViewSelection,
  ResolvedMetricDashboard,
  ResolvedMetricTab,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Disposable, Uri, ViewColumn, window } from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import type {
  CloudWatchDashboardClientMessage,
  CloudWatchAutoRefreshMinutes,
  CloudWatchDashboardHostMessage,
  CloudWatchDashboardInitializePayload,
  CloudWatchMetricsPayload,
  DashboardMessageEnvelope,
} from "../shared/observability";
import {
  buildCloudWatchDashboardReport,
  buildCloudWatchReportFilename,
} from "../observability/cloudWatchDashboardNotebook";
import { saveCloudWatchReportNotebook } from "../notebook/report/reportNotebookFileUtil";
import {
  CLOUDWATCH_TIME_RANGE_SELECTOR_ID,
  DASHBOARD_TAB_SELECTOR_ID,
  filterCollectableCloudWatchPanels,
  toCloudWatchInitializePayload,
  toCloudWatchMetricsPayload,
} from "../observability/cloudWatchDashboardPresenter";
import { DashboardRequestCoordinator } from "../observability/DashboardRequestCoordinator";
import { getDashboardLaunchCapabilities } from "../observability/dashboardLaunch";
import { formatConnectionEnvironmentCapitalized } from "../utilities/connectionEnvironmentDisplay";
import { workflow } from "../utilities/driverResolver";
import { getErrorMessage } from "../utilities/errorUtil";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const RESOURCE_DASHBOARD_ID = "aws-cloudwatch-metrics";
const OVERVIEW_DASHBOARD_ID = "aws-cloudwatch-metrics-overview";
const DASHBOARD_IDS = new Set([RESOURCE_DASHBOARD_ID, OVERVIEW_DASHBOARD_ID]);
const PREFIX = "[CloudWatchMetricsPanel]";

type CollectionResult = {
  dashboard: ResolvedMetricDashboard;
  tab: ResolvedMetricTab;
  range: MetricTimeRange;
  initialize: CloudWatchDashboardInitializePayload;
  metrics: CloudWatchMetricsPayload;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && ["AbortError", "CanceledError"].includes(error.name);
}

export class CloudWatchMetricsPanel extends BasePanel {
  public static currentPanel: CloudWatchMetricsPanel | undefined;
  private static stateStorage: StateStorage;

  private readonly coordinator = new DashboardRequestCoordinator();
  private readonly dashboardDisposables: Disposable[] = [];
  private resource: DbResource | undefined;
  private dashboardId = RESOURCE_DASHBOARD_ID;
  private resourceKey = "";
  private webviewReady = false;
  private refreshWhenVisible = false;
  private selectionsByTab: Record<string, Record<string, string>> = {};
  private activeTabId: string | undefined;
  private rangesByTab: Record<string, MetricTimeRange> = {};
  private autoRefreshMinutesByTab: Record<string, CloudWatchAutoRefreshMinutes> = {};
  private lastInitialize: CloudWatchDashboardInitializePayload | undefined;
  private lastMetrics: CloudWatchMetricsPayload | undefined;
  private initializedResourceKey: string | undefined;
  private latestRequestId = 0;
  private inFlightRequestId: number | undefined;

  private constructor(panel: ReturnType<typeof window.createWebviewPanel>, extensionUri: Uri) {
    super(panel, extensionUri);
    this.dashboardDisposables.push(
      this.getWebviewPanel().onDidChangeViewState(({ webviewPanel }) => {
        if (!webviewPanel.visible) {
          this.coordinator.clearTimers();
          if (this.inFlightRequestId !== undefined && this.coordinator.cancelCurrent()) {
            this.refreshWhenVisible = true;
          }
          return;
        }
        if ((this.refreshWhenVisible || this.isAutoRefreshEnabled()) && this.webviewReady) {
          this.refreshWhenVisible = false;
          void this.refresh();
        }
      })
    );
  }

  static setStateStorage(storage: StateStorage): void {
    CloudWatchMetricsPanel.stateStorage = storage;
  }

  static render(extensionUri: Uri, resource: DbResource): void {
    CloudWatchMetricsPanel.renderDashboard(extensionUri, resource, RESOURCE_DASHBOARD_ID);
  }

  static renderOverview(extensionUri: Uri, resource: DbResource): void {
    CloudWatchMetricsPanel.renderDashboard(extensionUri, resource, OVERVIEW_DASHBOARD_ID);
  }

  private static renderDashboard(
    extensionUri: Uri,
    resource: DbResource,
    dashboardId: string
  ): void {
    if (!CloudWatchMetricsPanel.currentPanel) {
      const panel = window.createWebviewPanel(
        "CloudWatchMetricsType",
        "CloudWatch Metrics",
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
      CloudWatchMetricsPanel.currentPanel = new CloudWatchMetricsPanel(panel, extensionUri);
    } else {
      CloudWatchMetricsPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    }
    CloudWatchMetricsPanel.currentPanel.setResource(resource, dashboardId);
  }

  getComponentName(): ComponentName {
    return "CloudWatchMetricsView";
  }

  private setResource(resource: DbResource, dashboardId: string): void {
    const capability = getDashboardLaunchCapabilities(resource).find(
      (item) => item.dashboardId === dashboardId
    );
    if (!capability) {
      void window.showErrorMessage(
        "This resource does not provide a CloudWatch metrics dashboard."
      );
      return;
    }
    const conName = typeof resource.meta?.conName === "string" ? resource.meta.conName : "";
    if (!conName) {
      void window.showErrorMessage("The resource connection could not be resolved.");
      return;
    }

    this.coordinator.cancelCurrent();
    this.dashboardId = dashboardId;
    this.resource = resource;
    this.resourceKey = `${conName}:${dashboardId}:${capability.providerId}:${resource.id}`;
    this.selectionsByTab = {};
    this.activeTabId = undefined;
    this.rangesByTab = {};
    this.autoRefreshMinutesByTab = {};
    this.lastInitialize = undefined;
    this.lastMetrics = undefined;
    this.initializedResourceKey = undefined;
    this.getWebviewPanel().title =
      dashboardId === OVERVIEW_DASHBOARD_ID
        ? `${resource.name} — CloudWatch Metrics Overview`
        : `${resource.name} — CloudWatch Metrics`;
    if (this.webviewReady) {
      void this.refresh();
    }
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const dashboardMessage = message as unknown as CloudWatchDashboardClientMessage;
    if (dashboardMessage.command === "ready") {
      if (!DASHBOARD_IDS.has(dashboardMessage.dashboardId)) {
        return;
      }
      if (this.webviewReady) {
        await this.replayLatestState();
        return;
      }
      this.webviewReady = true;
      await this.refresh();
      return;
    }
    if (
      dashboardMessage.dashboardId !== this.dashboardId ||
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
      case "setAutoRefresh":
        await this.setAutoRefresh(dashboardMessage.payload.intervalMinutes);
        return;
      case "close":
        this.dispose();
        return;
      case "exportToNotebook":
        await this.exportToNotebook();
        return;
    }
  }

  private async replayLatestState(): Promise<void> {
    if (this.lastInitialize) {
      await this.post("initialize", this.latestRequestId, this.lastInitialize);
    }
    if (this.lastMetrics) {
      await this.post("set-metrics", this.latestRequestId, this.lastMetrics);
    }
  }

  private async selectViewOption(selectorId: string, value: string): Promise<void> {
    if (selectorId === DASHBOARD_TAB_SELECTOR_ID) {
      if (!this.lastInitialize?.tabs.some((tab) => tab.id === value)) {
        return;
      }
      this.activeTabId = value;
    } else if (selectorId === CLOUDWATCH_TIME_RANGE_SELECTOR_ID) {
      const selector = this.lastInitialize?.selectors.find((item) => item.id === selectorId);
      if (!selector?.options.some((option) => option.value === value)) {
        return;
      }
      const tabId = this.activeTabId ?? this.lastInitialize?.activeTabId;
      if (!tabId) {
        return;
      }
      this.rangesByTab[tabId] = value as MetricTimeRange;
    } else {
      const selector = this.lastInitialize?.selectors.find((item) => item.id === selectorId);
      if (!selector?.options.some((option) => option.value === value)) {
        return;
      }
      const tabId = this.activeTabId ?? this.lastInitialize?.activeTabId;
      if (!tabId) {
        return;
      }
      this.selectionsByTab[tabId] = {
        ...(this.selectionsByTab[tabId] ?? {}),
        [selectorId]: value,
      };
    }
    await this.refresh();
  }

  private async cancelRefresh(): Promise<void> {
    const cancelled = this.coordinator.cancelCurrent();
    if (!cancelled) {
      return;
    }
    await this.post("refresh-cancelled", cancelled.requestId, {});
    this.scheduleAutoRefresh();
  }

  private async setAutoRefresh(intervalMinutes: CloudWatchAutoRefreshMinutes): Promise<void> {
    if (![0, 1, 5, 15].includes(intervalMinutes)) {
      return;
    }
    const tabId = this.activeTabId ?? this.lastInitialize?.activeTabId;
    if (!tabId || (intervalMinutes > 0 && !this.lastInitialize?.autoRefresh.allowed)) {
      return;
    }
    this.autoRefreshMinutesByTab[tabId] = intervalMinutes;
    if (this.lastInitialize) {
      this.lastInitialize = {
        ...this.lastInitialize,
        autoRefresh: {
          ...this.lastInitialize.autoRefresh,
          intervalMinutes,
        },
      };
      await this.post("set-dashboard", this.latestRequestId, this.lastInitialize);
    }
    this.scheduleAutoRefresh();
  }

  private isAutoRefreshEnabled(): boolean {
    const tabId = this.activeTabId ?? this.lastInitialize?.activeTabId;
    return Boolean(
      tabId &&
        this.lastInitialize?.autoRefresh.allowed &&
        (this.autoRefreshMinutesByTab[tabId] ?? 0) > 0
    );
  }

  private scheduleAutoRefresh(): void {
    this.coordinator.clearTimers();
    const tabId = this.activeTabId ?? this.lastInitialize?.activeTabId;
    const intervalMinutes = tabId ? this.autoRefreshMinutesByTab[tabId] ?? 0 : 0;
    if (
      intervalMinutes === 0 ||
      !this.lastInitialize?.autoRefresh.allowed ||
      !this.webviewReady ||
      !this.getWebviewPanel().visible
    ) {
      return;
    }
    const timer = setTimeout(() => void this.refresh(), intervalMinutes * 60_000);
    this.coordinator.registerTimer(timer);
  }

  private async exportToNotebook(): Promise<void> {
    if (!this.lastInitialize || !this.lastMetrics) {
      await window.showWarningMessage("Refresh the dashboard before exporting it to a notebook.");
      return;
    }
    const report = buildCloudWatchDashboardReport(
      this.lastInitialize,
      this.lastMetrics,
      this.dashboardId
    );
    const filename = buildCloudWatchReportFilename(
      this.lastInitialize,
      this.lastMetrics,
      this.dashboardId
    );
    const result = await saveCloudWatchReportNotebook(report, filename);
    if (!result.ok) {
      await window.showErrorMessage(result.message);
      return;
    }
    await window.showInformationMessage(`Saved ${result.relativePath}`);
  }

  private async refresh(): Promise<void> {
    const resource = this.resource;
    if (!resource || !this.resourceKey || !CloudWatchMetricsPanel.stateStorage) {
      return;
    }
    if (!this.getWebviewPanel().visible) {
      this.refreshWhenVisible = true;
      return;
    }

    this.coordinator.clearTimers();
    const token = this.coordinator.begin(this.resourceKey);
    this.latestRequestId = token.requestId;
    this.inFlightRequestId = token.requestId;
    await this.post("loading", token.requestId, { status: "loading" });

    try {
      const collected = await this.collect(resource, token.signal);
      if (!this.coordinator.isCurrent(token) || !this.getWebviewPanel().visible) {
        return;
      }
      this.activeTabId = collected.tab.id;
      this.rangesByTab[collected.tab.id] = collected.range;
      this.lastInitialize = collected.initialize;
      this.lastMetrics = collected.metrics;
      const command =
        this.initializedResourceKey === token.resourceKey ? "set-dashboard" : "initialize";
      await this.post(command, token.requestId, collected.initialize);
      this.initializedResourceKey = token.resourceKey;
      await this.post("set-metrics", token.requestId, collected.metrics);
      this.scheduleAutoRefresh();
    } catch (error) {
      if (isAbortError(error) || !this.coordinator.isCurrent(token)) {
        return;
      }
      log(`${PREFIX} refresh failed: ${getErrorMessage(error)}`);
      await this.post("set-error", token.requestId, {
        message: getErrorMessage(error),
      });
      this.scheduleAutoRefresh();
    } finally {
      if (this.inFlightRequestId === token.requestId) {
        this.inFlightRequestId = undefined;
      }
    }
  }

  private async collect(resource: DbResource, signal: AbortSignal): Promise<CollectionResult> {
    const capability = getDashboardLaunchCapabilities(resource).find(
      (item) => item.dashboardId === this.dashboardId
    );
    if (!capability) {
      throw new Error("CloudWatch dashboard capability is no longer available.");
    }
    const conName = String(resource.meta?.conName ?? "");
    const setting = await CloudWatchMetricsPanel.stateStorage.getConnectionSettingByName(conName);
    if (!setting?.awsSetting) {
      throw new Error(`AWS connection setting '${conName}' is unavailable.`);
    }
    const environmentLabel = setting.environment
      ? formatConnectionEnvironmentCapitalized(setting.environment)
      : undefined;

    const outcome = await workflow<AwsDriver, CollectionResult>(
      setting,
      async (driver) => {
        const adapter = driver.getMetricServiceAdapterRegistry().require(capability.providerId);
        const effectiveRegion = await driver.getEffectiveRegion();
        const target = await adapter.resolveTarget({
          resourceKey: this.resourceKey,
          displayName: resource.name,
          region: effectiveRegion,
          endpoint: setting.url,
          variant: capability.variant,
          hints: capability.hints,
          attributes: (resource as DbResource & { attr?: Record<string, unknown> }).attr,
          resources: resource.children.map((child) => ({
            resourceType: child.resourceType,
            displayName: child.name,
            attributes: (child as DbResource & { attr?: Record<string, unknown> }).attr,
          })),
          signal,
        });
        const initialDashboard = await adapter.resolveDashboard(
          target,
          (this.selectionsByTab[this.activeTabId ?? ""] ?? {}) as MetricViewSelection
        );
        const tab =
          initialDashboard.tabs.find((item) => item.id === this.activeTabId) ??
          initialDashboard.tabs[0];
        if (!tab) {
          throw new Error("The metric adapter did not provide a dashboard tab.");
        }
        const prerequisites = { ...initialDashboard.prerequisites };
        const panelsByPrerequisite = new Map(
          tab.panels
            .filter((panel) => panel.prerequisiteKey)
            .map((panel) => [panel.prerequisiteKey!, panel] as const)
        );
        await Promise.all(
          [...panelsByPrerequisite].map(async ([key, panel]) => {
            prerequisites[key] = await adapter.probePrerequisites(target, panel);
          })
        );
        const dashboard: ResolvedMetricDashboard = {
          ...initialDashboard,
          prerequisites,
        };
        const range = this.rangesByTab[tab.id] ?? tab.defaultRange;
        const queryRegions = [
          ...new Set(
            tab.panels.flatMap((panel) =>
              panel.queries.flatMap((query) =>
                query.endpoint?.region ? [query.endpoint.region] : []
              )
            )
          ),
        ];
        const displayRegion =
          queryRegions.length > 1
            ? `${queryRegions.length} resolved regions`
            : queryRegions[0] ?? target.endpoint.region;
        const initialize = toCloudWatchInitializePayload({
          dashboard,
          tab,
          range,
          environmentLabel,
          region: displayRegion,
          autoRefreshMinutes: this.autoRefreshMinutesByTab[tab.id] ?? 0,
        });
        const collectablePanels = filterCollectableCloudWatchPanels(tab.panels, prerequisites);
        const metricResult = await driver.collectCloudWatchMetricPanels(target.endpoint, {
          panels: collectablePanels,
          range,
          signal,
        });
        return {
          dashboard,
          tab,
          range,
          initialize,
          metrics: toCloudWatchMetricsPayload(metricResult),
        };
      },
      true
    );

    if (!outcome.ok || !outcome.result) {
      throw new Error(outcome.message || "CloudWatch metrics collection failed.");
    }
    return outcome.result;
  }

  private post<T extends CloudWatchDashboardHostMessage["command"]>(
    command: T,
    requestId: number,
    payload: Extract<CloudWatchDashboardHostMessage, { command: T }>["payload"]
  ): Thenable<boolean> {
    const message: DashboardMessageEnvelope<T, typeof payload> = {
      command,
      dashboardId: this.dashboardId,
      requestId,
      resourceKey: this.resourceKey,
      payload,
    };
    return this.getWebviewPanel().webview.postMessage(message);
  }

  protected preDispose(): void {
    this.coordinator.dispose();
    for (const disposable of this.dashboardDisposables.splice(0)) {
      disposable.dispose();
    }
    CloudWatchMetricsPanel.currentPanel = undefined;
  }
}
