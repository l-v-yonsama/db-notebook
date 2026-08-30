import type {
  RdbAccumulatedSample,
  RdbProcessedSeries,
  ResolvedRdbDashboard,
  ResolvedRdbDashboardPanel,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  DashboardTimeSeries,
  RdbDashboardInitializePayload,
  RdbDashboardSeriesPayload,
  RdbDashboardPanelPresentation,
} from "../shared/observability";
import { compactRdbDashboardScope, rdbDashboardDisplayLabels } from "./rdbDashboardDisplay";

export const RDB_DASHBOARD_TAB_SELECTOR_ID = "dashboard-tab";

function panelPresentation(
  panel: ResolvedRdbDashboardPanel,
  dashboard: ResolvedRdbDashboard
): RdbDashboardPanelPresentation {
  const capability = dashboard.capabilities.find(
    (item) => item.sectionId === panel.sectionCapabilityId
  );
  return {
    id: panel.id,
    title: panel.title,
    purpose: panel.purpose,
    scope: {
      ...panel.scope,
      ...compactRdbDashboardScope({
        providerId: dashboard.providerId,
        databaseName: dashboard.target.displayName,
        scopeKind: panel.scope.kind,
        label: panel.scope.label,
      }),
    },
    visualization: panel.visualization,
    caveat: panel.caveat,
    metricIds: panel.metricIds,
    sectionStatus: capability?.status ?? "unavailable",
    sectionMessage: capability?.message,
    drilldownActions: panel.drilldownActions
      ?.filter((action) => action.enabled)
      .map((action) => ({ id: action.id, label: action.label, command: action.kind })),
  };
}

export function toRdbDashboardInitializePayload(params: {
  dashboard: ResolvedRdbDashboard;
  activeTabId?: string;
  environmentLabel?: string;
}): RdbDashboardInitializePayload {
  const { dashboard } = params;
  const displayLabels = rdbDashboardDisplayLabels(
    dashboard.providerId,
    dashboard.target.displayName
  );
  const tab = dashboard.tabs.find((item) => item.id === params.activeTabId) ?? dashboard.tabs[0];
  if (!tab) {
    throw new Error("The RDB dashboard provider did not return a dashboard tab.");
  }
  const panels = tab.panels.map((panel) => panelPresentation(panel, dashboard));
  const status = panels.some((panel) => panel.sectionStatus === "partial")
    ? "partial"
    : panels.every((panel) => panel.sectionStatus === "unavailable")
    ? "unavailable"
    : "ready";
  return {
    providerId: dashboard.providerId,
    variant: dashboard.variant,
    serverVersion: dashboard.serverVersion,
    definitionVersion: dashboard.definitionVersion,
    target: {
      ...dashboard.target,
      displayName: displayLabels.displayName,
      ...(displayLabels.displayName === dashboard.target.displayName
        ? {}
        : { fullDisplayName: dashboard.target.displayName }),
      scope: {
        ...dashboard.target.scope,
        ...compactRdbDashboardScope({
          providerId: dashboard.providerId,
          databaseName: dashboard.target.displayName,
          scopeKind: dashboard.target.scope.kind,
          label: dashboard.target.scope.label,
        }),
      },
      environmentLabel: params.environmentLabel,
    },
    status,
    tabs: dashboard.tabs.map((item) => ({ id: item.id, title: item.title })),
    activeTabId: tab.id,
    selectors: [
      {
        id: RDB_DASHBOARD_TAB_SELECTOR_ID,
        label: "Dashboard tab",
        value: tab.id,
        options: dashboard.tabs.map((item) => ({ value: item.id, label: item.title })),
      },
      ...tab.selectors,
    ],
    panels,
    notices: dashboard.notices,
    samplePolicy: {
      defaultIntervalMs: dashboard.samplePolicy.defaultIntervalMs,
      allowedIntervalMs: dashboard.samplePolicy.allowedIntervalMs,
    },
  };
}

function latestValue(series: RdbProcessedSeries): number | null {
  return series.points.at(-1)?.value ?? null;
}

function presentationSeries(series: RdbProcessedSeries): DashboardTimeSeries {
  const latest = series.points.at(-1);
  const dimensionLabel = series.dimensions
    ? Object.keys(series.dimensions)
        .sort()
        .map((key) => series.dimensions?.[key])
        .join(" / ")
    : "";
  const failedStatus = [...series.points]
    .reverse()
    .find((point) => ["unavailable", "forbidden", "failed"].includes(point.status))?.status;
  const hasValue = series.points.some((point) => point.value !== null);
  return {
    id: series.key,
    label: dimensionLabel ? `${series.metric.label} · ${dimensionLabel}` : series.metric.label,
    unit: series.metric.unit,
    selfObservation: series.metric.selfObservation,
    points: series.points.map((point) => ({ x: point.observedAt, y: point.value })),
    status:
      latest?.status === "forbidden"
        ? "forbidden"
        : latest?.status === "unavailable"
        ? "unavailable"
        : latest?.status === "failed"
        ? "failed"
        : hasValue
        ? latest?.status === "reset"
          ? "partial"
          : "complete"
        : failedStatus === "forbidden"
        ? "forbidden"
        : failedStatus === "unavailable"
        ? "unavailable"
        : failedStatus === "failed"
        ? "failed"
        : "no-data",
    diagnostics:
      latest && ["warming-up", "reset", "invalid-time"].includes(latest.status)
        ? [{ code: latest.status, message: latest.messageCode }]
        : undefined,
  };
}

export function toRdbDashboardSeriesPayload(params: {
  dashboard: ResolvedRdbDashboard;
  activeTabId?: string;
  accumulated: RdbAccumulatedSample;
  collectedAt: string;
}): RdbDashboardSeriesPayload {
  const tab =
    params.dashboard.tabs.find((item) => item.id === params.activeTabId) ??
    params.dashboard.tabs[0];
  if (!tab) {
    throw new Error("The RDB dashboard provider did not return a dashboard tab.");
  }
  const panelSeries = tab.panels.map((panel) => {
    const metricOrder = new Map(panel.metricIds.map((metricId, index) => [metricId, index]));
    const series = params.accumulated.series
      .filter((item) => panel.metricIds.includes(item.metric.id))
      .sort((left, right) => {
        const leftValue = latestValue(left);
        const rightValue = latestValue(right);
        if (leftValue === null && rightValue === null) {
          return left.key.localeCompare(right.key);
        }
        if (leftValue === null) {
          return 1;
        }
        if (rightValue === null) {
          return -1;
        }
        return Math.abs(rightValue) - Math.abs(leftValue) || left.key.localeCompare(right.key);
      })
      .slice(0, panel.topN ?? params.dashboard.samplePolicy.maxVisibleSeriesPerPanel)
      .sort(
        (left, right) =>
          (metricOrder.get(left.metric.id) ?? Number.MAX_SAFE_INTEGER) -
            (metricOrder.get(right.metric.id) ?? Number.MAX_SAFE_INTEGER) ||
          left.key.localeCompare(right.key)
      )
      .map(presentationSeries);
    return { panelId: panel.id, series };
  });
  const status = params.accumulated.diagnostics.some((item) =>
    ["warning", "error"].includes(item.severity)
  )
    ? "partial"
    : "ready";
  return {
    panelSeries,
    status,
    collectedAt: params.collectedAt,
    resetMarkers: params.accumulated.resetMarkers.map((marker) => ({
      metricId: marker.metricId,
      observedAt: marker.observedAt,
      reasonLabel: marker.reasonLabel,
    })),
    diagnostics: params.accumulated.diagnostics,
  };
}
