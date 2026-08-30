<script setup lang="ts">
import DashboardShell from "@/components/observability/DashboardShell.vue";
import DashboardStateCard from "@/components/observability/DashboardStateCard.vue";
import DashboardTabs from "@/components/observability/DashboardTabs.vue";
import DashboardTimeSeriesChart from "@/components/observability/DashboardTimeSeriesChart.vue";
import DashboardToolbar from "@/components/observability/DashboardToolbar.vue";
import type {
  CloudWatchDashboardHostMessage,
  CloudWatchDashboardInitializePayload,
  CloudWatchMetricsPayload,
  CloudWatchPanelPresentation,
  DashboardDisplayStatus,
  DashboardMessageEnvelope,
  DashboardTimeSeries,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { computed, onMounted, ref } from "vue";

const DASHBOARD_ID = "aws-cloudwatch-metrics";
const DASHBOARD_IDS = new Set([DASHBOARD_ID, "aws-cloudwatch-metrics-overview"]);
const TAB_SELECTOR_ID = "dashboard-tab";

const initialize = ref<CloudWatchDashboardInitializePayload>();
const metrics = ref<CloudWatchMetricsPayload>();
const status = ref<DashboardDisplayStatus>("loading");
const errorMessage = ref<string>();
const currentRequestId = ref(-1);
const currentResourceKey = ref("");
const currentDashboardId = ref(DASHBOARD_ID);

const loading = computed(() => status.value === "loading");

function acceptEnvelope(message: CloudWatchDashboardHostMessage): boolean {
  if (!DASHBOARD_IDS.has(message.dashboardId)) {
    return false;
  }
  if (message.command === "loading") {
    if (message.requestId < currentRequestId.value) {
      return false;
    }
    currentRequestId.value = message.requestId;
    currentResourceKey.value = message.resourceKey;
    currentDashboardId.value = message.dashboardId;
    return true;
  }
  return (
    message.requestId === currentRequestId.value && message.resourceKey === currentResourceKey.value
  );
}

function recieveMessage(message: CloudWatchDashboardHostMessage): void {
  const targetChanged =
    message.command === "loading" &&
    (message.resourceKey !== currentResourceKey.value ||
      message.dashboardId !== currentDashboardId.value);
  if (!acceptEnvelope(message)) {
    return;
  }
  switch (message.command) {
    case "loading":
      if (targetChanged) {
        initialize.value = undefined;
        metrics.value = undefined;
      }
      status.value = "loading";
      errorMessage.value = undefined;
      return;
    case "initialize":
    case "set-dashboard":
      initialize.value = message.payload;
      status.value = message.payload.status;
      return;
    case "set-metrics":
      metrics.value = message.payload;
      status.value = message.payload.status;
      return;
    case "set-error":
      status.value = "error";
      errorMessage.value = message.payload.message;
      return;
    case "refresh-cancelled":
      status.value = "cancelled";
      return;
  }
}

function post<T extends string, P>(command: T, payload: P): void {
  if (!currentResourceKey.value) {
    return;
  }
  const message: DashboardMessageEnvelope<T, P> = {
    command,
    dashboardId: currentDashboardId.value,
    requestId: currentRequestId.value,
    resourceKey: currentResourceKey.value,
    payload,
  };
  vscode.postMessage(message);
}

function select(selectorId: string, value: string): void {
  post("selectViewOption", { selectorId, value });
}

function panelSeries(panel: CloudWatchPanelPresentation): DashboardTimeSeries[] {
  return metrics.value?.panelSeries.find((item) => item.panelId === panel.id)?.series ?? [];
}

function panelStatus(panel: CloudWatchPanelPresentation): DashboardDisplayStatus | undefined {
  if (panel.prerequisite?.status === "not-configured") {
    return "unconfigured";
  }
  if (["unknown", "not-applicable"].includes(panel.prerequisite?.status ?? "")) {
    return "unavailable";
  }
  const series = panelSeries(panel);
  if (series.some((item) => item.points.length > 0)) {
    return undefined;
  }
  if (series.some((item) => ["unavailable", "forbidden"].includes(item.status))) {
    return "unavailable";
  }
  if (series.some((item) => item.status === "failed")) {
    return "error";
  }
  if (metrics.value) {
    return "empty";
  }
  return undefined;
}

function panelStatusMessage(panel: CloudWatchPanelPresentation): string | undefined {
  if (panel.prerequisite && panel.prerequisite.status !== "configured") {
    return panel.prerequisite.message;
  }
  return panelStatus(panel) === "empty" ? panel.emptyHint : undefined;
}

onMounted(async () => {
  if (import.meta.env.DEV) {
    const fixture = new URLSearchParams(window.location.search).get("fixture");
    if (fixture === "sqs") {
      const { cloudWatchMetricsFixtureMessages } = await import("@/dev/cloudWatchMetricsFixture");
      cloudWatchMetricsFixtureMessages.forEach(recieveMessage);
      return;
    }
    if (fixture === "sqs-overview") {
      const { cloudWatchSqsOverviewFixtureMessages } = await import(
        "@/dev/cloudWatchSqsOverviewFixture"
      );
      cloudWatchSqsOverviewFixtureMessages.forEach(recieveMessage);
      return;
    }
    if (fixture === "s3-overview") {
      const { cloudWatchS3OverviewFixtureMessages } = await import(
        "@/dev/cloudWatchS3OverviewFixture"
      );
      cloudWatchS3OverviewFixtureMessages.forEach(recieveMessage);
      return;
    }
    if (fixture === "dynamodb") {
      const { cloudWatchDynamoDbFixtureMessages } = await import("@/dev/cloudWatchDynamoDbFixture");
      cloudWatchDynamoDbFixtureMessages.forEach(recieveMessage);
      return;
    }
    if (fixture === "s3" || fixture === "s3-unconfigured") {
      const { cloudWatchS3FixtureMessages, cloudWatchS3UnconfiguredFixtureMessages } = await import(
        "@/dev/cloudWatchS3Fixture"
      );
      const messages =
        fixture === "s3" ? cloudWatchS3FixtureMessages : cloudWatchS3UnconfiguredFixtureMessages;
      messages.forEach(recieveMessage);
      return;
    }
    if (fixture === "ses") {
      const { cloudWatchSesFixtureMessages } = await import("@/dev/cloudWatchSesFixture");
      cloudWatchSesFixtureMessages.forEach(recieveMessage);
      return;
    }
  }
  vscode.postMessage({ command: "ready", dashboardId: DASHBOARD_ID });
});

defineExpose({ recieveMessage });
</script>

<template>
  <div class="cloudwatch-view">
    <DashboardStateCard v-if="!initialize" :status="status" :message="errorMessage" />
    <DashboardShell
      v-else
      :target="initialize.target"
      :notices="initialize.notices"
      :collected-at="metrics?.collectedAt"
    >
      <DashboardTabs
        :tabs="initialize.tabs"
        :active-tab-id="initialize.activeTabId"
        @select="select(TAB_SELECTOR_ID, $event)"
      />
      <DashboardToolbar
        :selectors="initialize.selectors"
        :loading="loading"
        :query-count="initialize.queryCount"
        :auto-refresh-allowed="initialize.autoRefresh.allowed"
        :auto-refresh-minutes="initialize.autoRefresh.intervalMinutes"
        @select="select"
        @refresh="post('refresh', {})"
        @cancel="post('cancelRefresh', {})"
        @set-auto-refresh="post('setAutoRefresh', { intervalMinutes: $event })"
        @export="post('exportToNotebook', {})"
        @close="post('close', {})"
      />
      <DashboardStateCard v-if="['partial', 'cancelled'].includes(status)" :status="status" />
      <DashboardStateCard v-if="status === 'error'" status="error" :message="errorMessage" />
      <section class="panels" aria-label="CloudWatch metric panels">
        <details
          v-for="panel in initialize.panels"
          :key="panel.id"
          class="metric-panel"
          :open="!panel.collapsedByDefault"
        >
          <summary>
            <div>
              <h2>{{ panel.title }}</h2>
              <small>{{ panel.scope.label }} · {{ panel.emission }}</small>
            </div>
            <span>{{ panelSeries(panel).length || panel.queries.length }} series</span>
          </summary>
          <div class="panel-body">
            <p v-if="panel.caveat" class="caveat">{{ panel.caveat }}</p>
            <DashboardStateCard
              v-if="panelStatus(panel)"
              :status="panelStatus(panel)!"
              :title="panel.prerequisite?.title"
              :message="panelStatusMessage(panel)"
            />
            <DashboardTimeSeriesChart
              v-else-if="panelSeries(panel).length"
              :panel="panel"
              :series="panelSeries(panel)"
            />
          </div>
        </details>
      </section>
    </DashboardShell>
  </div>
</template>

<style scoped>
.cloudwatch-view {
  width: 100%;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 14px 18px 24px;
}
.panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(520px, 100%), 1fr));
  gap: 12px;
}
.metric-panel {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editorWidget-background);
}
.metric-panel > summary {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
  cursor: pointer;
  list-style-position: outside;
}
.metric-panel[open] > summary {
  margin-bottom: 8px;
}
.metric-panel > summary > div {
  flex: 1;
}
.panel-body {
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 1.05rem;
}
small,
.metric-panel > summary > span {
  color: var(--vscode-descriptionForeground);
}
.caveat {
  padding: 7px 9px;
  border-left: 3px solid var(--vscode-editorWarning-foreground);
  background: var(--vscode-textBlockQuote-background);
}
</style>
