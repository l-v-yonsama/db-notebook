<script setup lang="ts">
import DashboardShell from "@/components/observability/DashboardShell.vue";
import DashboardStateCard from "@/components/observability/DashboardStateCard.vue";
import DashboardStatGrid from "@/components/observability/DashboardStatGrid.vue";
import DashboardTabs from "@/components/observability/DashboardTabs.vue";
import DashboardTimeSeriesChart from "@/components/observability/DashboardTimeSeriesChart.vue";
import DashboardNoticeList from "@/components/observability/DashboardNoticeList.vue";
import RdbResetMarkerLegend from "@/components/observability/RdbResetMarkerLegend.vue";
import RdbSamplingToolbar from "@/components/observability/RdbSamplingToolbar.vue";
import VsCodeButton from "@/components/base/VsCodeButton.vue";
import { isDashboardSeriesWarmup } from "@/utilities/dashboardSeries";
import type {
  DashboardDisplayStatus,
  DashboardTimeSeries,
  RdbDashboardHostMessage,
  RdbDashboardInitializePayload,
  RdbDashboardPanelPresentation,
  RdbDashboardSeriesPayload,
  RdbSamplingStatePayload,
} from "@/utilities/vscode";
import { isDashboardChartVisualization } from "@/utilities/vscode";
import { useDashboardMessageChannel } from "@/utilities/dashboardMessageChannel";
import { vscode } from "@/utilities/vscode";
import { computed, onMounted, ref } from "vue";

const DASHBOARD_ID = "rdb-database";
const TAB_SELECTOR_ID = "dashboard-tab";
const initialize = ref<RdbDashboardInitializePayload>();
const sample = ref<RdbDashboardSeriesPayload>();
const status = ref<DashboardDisplayStatus>("loading");
const errorMessage = ref<string>();
const messageChannel = useDashboardMessageChannel({
  dashboardIds: new Set([DASHBOARD_ID]),
  initialDashboardId: DASHBOARD_ID,
});
const post = messageChannel.post;
const sampling = ref<RdbSamplingStatePayload>({ state: "stopped", intervalMs: 10_000 });
const backgroundRefreshing = ref(false);
const loading = computed(() => status.value === "loading");
const sampleNotices = computed(() =>
  (sample.value?.diagnostics ?? []).map((diagnostic, index) => ({
    id: `${diagnostic.code}:${diagnostic.sectionId}:${index}`,
    severity: diagnostic.severity,
    title:
      diagnostic.code === "payload-truncated" ? "Display history truncated" : diagnostic.sectionId,
    message: diagnostic.message,
    code: diagnostic.code,
  }))
);

function recieveMessage(message: RdbDashboardHostMessage): void {
  const acceptance = messageChannel.acceptEnvelope(message);
  if (!acceptance.accepted) {
    return;
  }
  switch (message.command) {
    case "loading":
      if (acceptance.targetChanged) {
        initialize.value = undefined;
        sample.value = undefined;
      }
      backgroundRefreshing.value = message.payload.preserveResults === true && !!initialize.value;
      if (!backgroundRefreshing.value) {
        status.value = "loading";
      }
      errorMessage.value = undefined;
      return;
    case "initialize":
    case "set-dashboard":
      backgroundRefreshing.value = false;
      initialize.value = message.payload;
      status.value = message.payload.status;
      return;
    case "replace-series":
      backgroundRefreshing.value = false;
      sample.value = message.payload;
      status.value = message.payload.status;
      return;
    case "set-sampling-state":
      backgroundRefreshing.value = false;
      sampling.value = message.payload;
      return;
    case "set-error":
      backgroundRefreshing.value = false;
      status.value = "error";
      errorMessage.value = message.payload.message;
      return;
    case "refresh-cancelled":
      backgroundRefreshing.value = false;
      status.value = "cancelled";
      return;
  }
}

function series(panel: RdbDashboardPanelPresentation): DashboardTimeSeries[] {
  return sample.value?.panelSeries.find((item) => item.panelId === panel.id)?.series ?? [];
}

function isWarmup(panel: RdbDashboardPanelPresentation): boolean {
  return isDashboardSeriesWarmup(series(panel));
}

function resetMarkers(panel: RdbDashboardPanelPresentation) {
  return (sample.value?.resetMarkers ?? []).filter((marker) =>
    panel.metricIds.includes(marker.metricId)
  );
}

onMounted(() => vscode.postMessage({ command: "ready", dashboardId: DASHBOARD_ID }));
defineExpose({ recieveMessage });
</script>

<template>
  <div class="rdb-dashboard-view">
    <DashboardStateCard v-if="!initialize" :status="status" :message="errorMessage" />
    <DashboardShell
      v-else
      :target="initialize.target"
      :notices="initialize.notices"
      :collected-at="sample?.collectedAt"
    >
      <DashboardTabs
        :tabs="initialize.tabs"
        :active-tab-id="initialize.activeTabId"
        @select="post('selectViewOption', { selectorId: TAB_SELECTOR_ID, value: $event })"
      />
      <RdbSamplingToolbar
        :sampling="sampling"
        :allowed-interval-ms="initialize.samplePolicy.allowedIntervalMs"
        :loading="loading"
        :updating="backgroundRefreshing"
        @start="post('startSampling', { intervalMs: $event })"
        @stop="post('stopSampling', {})"
        @interval="post('changeSampleInterval', { intervalMs: $event })"
        @refresh="post('refresh', {})"
        @cancel="post('cancelRefresh', {})"
        @export="post('exportToNotebook', {})"
        @close="post('close', {})"
      />
      <DashboardStateCard v-if="status === 'error'" status="error" :message="errorMessage" />
      <DashboardStateCard v-else-if="status === 'partial'" status="partial" />
      <DashboardNoticeList :notices="sampleNotices" />
      <RdbResetMarkerLegend :markers="sample?.resetMarkers ?? []" />
      <section
        class="panels"
        role="tabpanel"
        :id="`dashboard-tabpanel-${initialize.activeTabId}`"
        :aria-labelledby="
          initialize.tabs.length > 1 ? `dashboard-tab-${initialize.activeTabId}` : undefined
        "
        aria-label="Database metric panels"
      >
        <article
          v-for="panel in initialize.panels"
          :key="panel.id"
          class="metric-panel"
          :aria-labelledby="`rdb-panel-${panel.id}`"
        >
          <header>
            <div>
              <h2 :id="`rdb-panel-${panel.id}`">{{ panel.title }}</h2>
              <small :title="panel.scope.fullLabel ?? panel.scope.label">{{
                panel.scope.label
              }}</small>
            </div>
            <span>{{ series(panel).length }} series</span>
          </header>
          <p v-if="panel.caveat" class="caveat">{{ panel.caveat }}</p>
          <DashboardStateCard
            v-if="panel.sectionStatus === 'unavailable'"
            status="unavailable"
            :message="panel.sectionMessage"
          />
          <DashboardStateCard
            v-else-if="isWarmup(panel)"
            status="empty"
            title="Warming up"
            message="A second sample is required to calculate rates."
          />
          <DashboardStateCard v-else-if="series(panel).length === 0" status="empty" />
          <DashboardStatGrid
            v-else-if="panel.visualization === 'stat-grid'"
            :series="series(panel)"
          />
          <DashboardTimeSeriesChart
            v-else-if="isDashboardChartVisualization(panel.visualization)"
            :panel="panel"
            :series="series(panel)"
            :reset-markers="resetMarkers(panel)"
          />
          <DashboardStateCard
            v-else
            status="unavailable"
            title="Visualization unavailable"
            :message="`The ${panel.visualization} visualization is not supported in this dashboard yet.`"
          />
          <footer v-if="panel.drilldownActions?.length">
            <VsCodeButton
              v-for="action in panel.drilldownActions"
              :key="action.id"
              appearance="secondary"
              :title="`${action.label} in another view`"
              @click="
                post('openDrilldown', {
                  actionId: action.id,
                  definitionVersion: initialize.definitionVersion,
                })
              "
            >
              <span class="codicon codicon-link-external drilldown-icon" aria-hidden="true"></span>
              {{ action.label }}
            </VsCodeButton>
          </footer>
        </article>
      </section>
    </DashboardShell>
  </div>
</template>

<style scoped>
.rdb-dashboard-view {
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
header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
  font-size: 1.05rem;
}
small,
header > span {
  color: var(--vscode-descriptionForeground);
}
.caveat {
  padding: 7px 9px;
  border-left: 3px solid var(--vscode-editorWarning-foreground);
  background: var(--vscode-textBlockQuote-background);
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.drilldown-icon {
  margin-right: 6px;
}
</style>
