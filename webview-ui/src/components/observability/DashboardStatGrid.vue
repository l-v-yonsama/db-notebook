<script setup lang="ts">
import {
  dashboardSelfObservationLabel,
  dashboardSeriesDelta,
  latestDashboardValue,
} from "@/utilities/dashboardSeries";
import type { DashboardTimeSeries } from "@/utilities/vscode";

defineProps<{ series: DashboardTimeSeries[] }>();

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

function formatValue(value: number | null): string {
  return value === null ? "Unavailable" : numberFormat.format(value);
}

function formatDelta(series: DashboardTimeSeries): string | undefined {
  const delta = dashboardSeriesDelta(series);
  if (delta === undefined) {
    return undefined;
  }
  return `${delta >= 0 ? "+" : ""}${numberFormat.format(delta)}`;
}
</script>

<template>
  <dl class="stat-grid" aria-label="Current metric values">
    <div v-for="item in series" :key="item.id" class="stat">
      <dt>{{ item.label }}</dt>
      <dd>
        <strong>{{ formatValue(latestDashboardValue(item)) }}</strong>
        <span v-if="latestDashboardValue(item) !== null">{{ item.unit }}</span>
      </dd>
      <small v-if="formatDelta(item) !== undefined">
        Change {{ formatDelta(item) }} {{ item.unit }}
      </small>
      <small
        v-if="dashboardSelfObservationLabel(item)"
        class="observer-note"
        :class="{ warning: item.selfObservation !== 'excluded' }"
      >
        {{ dashboardSelfObservationLabel(item) }}
      </small>
      <small v-if="item.status !== 'complete'" class="status">{{ item.status }}</small>
    </div>
  </dl>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
  margin: 0;
}
.stat {
  display: grid;
  align-content: start;
  gap: 5px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}
dt {
  overflow-wrap: anywhere;
  color: var(--vscode-descriptionForeground);
}
dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}
dd strong {
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
}
small {
  color: var(--vscode-descriptionForeground);
}
.observer-note {
  color: var(--vscode-descriptionForeground);
}
.observer-note.warning {
  color: var(--vscode-editorWarning-foreground);
}
.status {
  text-transform: capitalize;
}
</style>
