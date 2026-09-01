import type {
  CloudWatchMetricPanelsResult,
  MetricPrerequisiteResult,
  MetricSeries,
  MetricTimeRange,
  ResolvedMetricDashboard,
  ResolvedMetricPanel,
  ResolvedMetricTab,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  CloudWatchDashboardInitializePayload,
  CloudWatchAutoRefreshMinutes,
  CloudWatchMetricsPayload,
  CloudWatchPanelPresentation,
  DashboardDisplayStatus,
  DashboardNotice,
  DashboardTimeSeries,
} from "../shared/observability";

export const CLOUDWATCH_TIME_RANGE_SELECTOR_ID = "dashboard-time-range";
export const DASHBOARD_TAB_SELECTOR_ID = "dashboard-tab";

export function filterCollectableCloudWatchPanels(
  panels: readonly ResolvedMetricPanel[],
  prerequisites: Readonly<Record<string, MetricPrerequisiteResult>>
): ResolvedMetricPanel[] {
  return panels.filter((panel) => {
    if (!panel.prerequisiteKey) {
      return true;
    }
    return prerequisites[panel.prerequisiteKey]?.status === "configured";
  });
}

const TIME_RANGES: Array<{ value: MetricTimeRange; label: string }> = [
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "12h", label: "12 hours" },
  { value: "3d", label: "3 days" },
  { value: "15d", label: "15 days" },
  { value: "30d", label: "30 days" },
];

function prerequisiteNotice(
  key: string,
  prerequisite: MetricPrerequisiteResult
): DashboardNotice | undefined {
  switch (prerequisite.status) {
    case "configured":
    case "not-applicable":
      return undefined;
    case "not-configured":
      return {
        id: `prerequisite-${key}`,
        severity: "warning",
        title: prerequisite.enablement.title,
        message: [...prerequisite.enablement.steps, prerequisite.enablement.costNotice]
          .filter(Boolean)
          .join(" "),
        documentationUrl: prerequisite.enablement.documentationUrl,
      };
    case "unknown":
      return {
        id: `prerequisite-${key}`,
        severity: "warning",
        title: "Metric configuration could not be verified",
        message: prerequisite.message,
        code: prerequisite.requiredPermissions.join(", "),
      };
  }
}

function panelPrerequisitePresentation(
  prerequisite: MetricPrerequisiteResult | undefined
): CloudWatchPanelPresentation["prerequisite"] {
  if (!prerequisite) {
    return undefined;
  }
  switch (prerequisite.status) {
    case "configured":
      return { status: "configured" };
    case "not-configured":
      return {
        status: "not-configured",
        title: prerequisite.enablement.title,
        message: [...prerequisite.enablement.steps, prerequisite.enablement.costNotice]
          .filter(Boolean)
          .join(" "),
      };
    case "unknown":
      return {
        status: "unknown",
        title: "Metric configuration could not be verified",
        message: prerequisite.message,
      };
    case "not-applicable":
      return {
        status: "not-applicable",
        title: "Metrics do not apply",
        message: prerequisite.reason,
      };
  }
}

function toPanelPresentation(
  panel: ResolvedMetricPanel,
  prerequisite: MetricPrerequisiteResult | undefined
): CloudWatchPanelPresentation {
  return {
    id: panel.id,
    title: panel.title,
    purpose: panel.purpose,
    scope: panel.scope,
    visualization: panel.visualization,
    emission: panel.emission,
    cost: panel.cost,
    queries: panel.queries.map((query) => ({
      id: query.id,
      namespace: query.namespace,
      metricName: query.metricName,
      statistic: query.statistic,
      label: query.label,
      unit: query.unit,
      dimensions: query.dimensions,
    })),
    derivedSeries: panel.derive?.map((series) => ({ ...series })),
    thresholds: panel.thresholds,
    emptyHint: panel.emptyHint,
    caveat: panel.caveat,
    collapsedByDefault: panel.collapsedByDefault,
    prerequisite: panelPrerequisitePresentation(prerequisite),
  };
}

export function toCloudWatchInitializePayload(input: {
  dashboard: ResolvedMetricDashboard;
  tab: ResolvedMetricTab;
  range: MetricTimeRange;
  environmentLabel?: string;
  region?: string;
  autoRefreshMinutes?: CloudWatchAutoRefreshMinutes;
}): CloudWatchDashboardInitializePayload {
  const { dashboard, tab, range, environmentLabel, region } = input;
  const activePrerequisiteKeys = new Set(
    tab.panels.flatMap((panel) => (panel.prerequisiteKey ? [panel.prerequisiteKey] : []))
  );
  const notices = Object.entries(dashboard.prerequisites)
    .filter(([key]) => activePrerequisiteKeys.has(key))
    .map(([key, prerequisite]) => prerequisiteNotice(key, prerequisite))
    .filter((notice): notice is DashboardNotice => notice !== undefined);
  const namespace = tab.panels[0]?.queries[0]?.namespace ?? "CloudWatch";

  return {
    providerId: dashboard.providerId,
    variant: dashboard.variant,
    target: {
      resourceKey: dashboard.target.resourceKey,
      displayName: dashboard.target.displayName,
      sourceLabel: ["CloudWatch", namespace, region].filter(Boolean).join(" / "),
      environmentLabel,
      scope: {
        kind: tab.panels[0]?.scope.kind ?? "resource",
        label: dashboard.target.scopeLabel,
      },
    },
    status: "loading",
    tabs: dashboard.tabs.map(({ id, title }) => ({ id, title })),
    activeTabId: tab.id,
    selectors: [
      {
        id: CLOUDWATCH_TIME_RANGE_SELECTOR_ID,
        label: "Time range",
        value: range,
        options: TIME_RANGES,
      },
      ...tab.selectors,
    ],
    panels: tab.panels.map((panel) =>
      toPanelPresentation(
        panel,
        panel.prerequisiteKey ? dashboard.prerequisites[panel.prerequisiteKey] : undefined
      )
    ),
    notices,
    range,
    queryCount: tab.panels.reduce((count, panel) => count + panel.queries.length, 0),
    autoRefresh: {
      allowed: tab.autoRefreshAllowed,
      intervalMinutes: tab.autoRefreshAllowed ? input.autoRefreshMinutes ?? 0 : 0,
    },
  };
}

function toTimeSeries(series: MetricSeries): DashboardTimeSeries {
  return {
    id: series.id,
    label: series.label,
    unit: series.unit,
    status: series.status,
    points: series.points.map((point) => ({ x: point.timestamp, y: point.value })),
    diagnostics: series.messages.map((message) => ({
      code: message.code,
      message: message.value,
    })),
  };
}

function resolveDisplayStatus(series: readonly MetricSeries[]): DashboardDisplayStatus {
  if (series.length === 0 || series.every((item) => item.status === "no-data")) {
    return "empty";
  }
  const hasData = series.some((item) => item.points.length > 0);
  const hasFailure = series.some((item) =>
    ["partial", "unavailable", "forbidden", "failed"].includes(item.status)
  );
  if (hasData && hasFailure) {
    return "partial";
  }
  if (series.some((item) => item.status === "partial")) {
    return "partial";
  }
  if (series.every((item) => ["unavailable", "forbidden"].includes(item.status))) {
    return "unavailable";
  }
  if (series.every((item) => item.status === "failed")) {
    return "error";
  }
  return hasData ? "ready" : "empty";
}

export function toCloudWatchMetricsPayload(
  result: CloudWatchMetricPanelsResult
): CloudWatchMetricsPayload {
  const allSeries = result.panels.flatMap((panel) => panel.series);
  return {
    panelSeries: result.panels.map((panel) => ({
      panelId: panel.panelId,
      series: panel.series.map(toTimeSeries),
    })),
    status: resolveDisplayStatus(allSeries),
    collectedAt: result.endTime,
    periodSeconds: result.periodSeconds,
  };
}
