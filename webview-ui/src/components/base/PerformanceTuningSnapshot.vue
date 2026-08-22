<script setup lang="ts">
import type { PerformanceTuningHumanSummary } from "@/utilities/vscode";

defineProps<{ summary: PerformanceTuningHumanSummary }>();

const formatNumber = (value: number | undefined): string =>
  value === undefined ? "-" : value.toLocaleString();

const formatPercent = (value: number | undefined): string => {
  if (value === undefined) return "-";
  const percent = value * 100;
  return `${percent !== 0 && Math.abs(percent) < 0.01 ? percent.toPrecision(3) : percent.toFixed(2)}%`;
};

const isDml = (statementKind: string): boolean =>
  ["INSERT", "UPDATE", "DELETE"].includes(statementKind);
</script>

<template>
  <div class="performance-snapshot">
    <div class="profile">
      <span class="profile-item"><strong>Statement:</strong> {{ summary.profile.statementKind }}</span>
      <span class="profile-item"><strong>Evidence:</strong> {{ summary.profile.evidence === "actual" ? "Actual measured" : "Estimate only" }}</span>
      <span class="profile-item"><strong>Scope:</strong> {{ summary.profile.tableCount }} {{ summary.profile.tableCount === 1 ? "table" : "tables" }}</span>
      <span class="profile-item"><strong>Collection:</strong> {{ summary.profile.collectionStatus }}</span>
    </div>

    <p v-if="summary.profile.tableRefs.length > 0" class="scope-detail">
      {{ summary.profile.tableRefs.join(" · ") }}
    </p>

    <h4>Observed signals</h4>
    <p class="note">Deterministic summaries of collected database facts; these are separate from the AI analysis.</p>
    <div class="signals">
      <div v-for="(signal, index) in summary.signals" :key="`${signal.kind}-${signal.tableRef ?? index}`"
        class="signal" :class="signal.level">
        <div class="signal-heading">
          <span class="level">{{ signal.level }}</span>
          <strong>{{ signal.title }}</strong>
          <span v-if="signal.tableRef" class="table-ref">{{ signal.tableRef }}</span>
        </div>
        <p>{{ signal.summary }}</p>
        <p class="raw-path">Details: {{ signal.rawDataPath }}</p>
      </div>
    </div>

    <div v-if="summary.rowFlows.length > 0" class="row-flow">
      <h4>Table row flow</h4>
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>Table rows</th>
            <th>Accessed</th>
            <th>Local filter output</th>
            <th>Plan output</th>
            <th>Access fraction</th>
            <th>Filter pass rate</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(flow, index) in summary.rowFlows" :key="`${flow.tableRef}-${index}`">
            <td>
              {{ flow.tableRef }}
              <div class="raw-path">{{ flow.rawDataPath }}</div>
            </td>
            <td>{{ formatNumber(flow.totalRows) }}{{ flow.totalRows !== undefined && flow.totalRowsEstimated ? " (estimated)" : "" }}</td>
            <template v-if="!isDml(summary.profile.statementKind)">
              <td>{{ formatNumber(flow.accessedRows) }}</td>
              <td>{{ formatNumber(flow.filterOutputRows) }}</td>
              <td>{{ formatNumber(flow.planOutputRows) }}</td>
              <td>{{ formatPercent(flow.accessFraction) }}</td>
              <td>{{ formatPercent(flow.filterPassRate) }}</td>
            </template>
            <td v-else colspan="5">Not measured (DML)</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.performance-snapshot {
  .profile { display: flex; flex-wrap: wrap; gap: 6px; }
  .profile-item, .level {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .scope-detail, .note, .raw-path { color: var(--vscode-descriptionForeground); }
  h4 { margin: 12px 0 4px; }
  .note, .signal p { margin: 3px 0; }
  .signals { display: grid; gap: 6px; }
  .signal {
    border-left: 3px solid var(--vscode-panel-border);
    padding: 6px 8px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    &.attention { border-left-color: var(--vscode-editorWarning-foreground); }
    &.unknown { border-left-color: var(--vscode-descriptionForeground); }
  }
  .signal-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .level { font-size: 0.85em; text-transform: uppercase; }
  .table-ref { color: var(--vscode-descriptionForeground); }
  .raw-path { font-size: 0.85em; }
  .row-flow { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    border: 1px solid var(--vscode-panel-border);
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
}
</style>
