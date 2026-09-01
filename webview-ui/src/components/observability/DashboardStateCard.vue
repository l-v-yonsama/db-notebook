<script setup lang="ts">
import type { DashboardDisplayStatus } from "@/utilities/vscode";

const props = defineProps<{
  status: DashboardDisplayStatus;
  title?: string;
  message?: string;
}>();

const defaultMessage: Record<DashboardDisplayStatus, string> = {
  loading: "Loading dashboard data…",
  ready: "Dashboard data is ready.",
  partial: "Some series could not be collected. Available data is still shown.",
  empty: "No datapoints are available for this view.",
  unconfigured: "Metrics are not configured for this target.",
  unavailable: "Metrics are unavailable for this target or endpoint.",
  error: "The dashboard could not be refreshed.",
  cancelled: "The refresh was cancelled. The last result is still available.",
};
</script>

<template>
  <div class="state-card" :class="status" role="status">
    <strong>{{ title ?? status.charAt(0).toUpperCase() + status.slice(1) }}</strong>
    <span>{{ message ?? defaultMessage[props.status] }}</span>
  </div>
</template>

<style scoped>
.state-card {
  display: grid;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--vscode-panel-border);
  border-left-width: 4px;
  background: var(--vscode-editorWidget-background);
}
.state-card.loading,
.state-card.ready {
  border-left-color: var(--vscode-editorInfo-foreground);
}
.state-card.partial,
.state-card.empty,
.state-card.unconfigured,
.state-card.unavailable,
.state-card.cancelled {
  border-left-color: var(--vscode-editorWarning-foreground);
}
.state-card.error {
  border-left-color: var(--vscode-editorError-foreground);
}
.state-card span {
  color: var(--vscode-descriptionForeground);
}
</style>
