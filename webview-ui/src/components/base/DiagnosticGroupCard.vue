<script setup lang="ts">
import type { PerformanceTuningDiagnosticGroupViewModel } from "@/utilities/vscode";

// Renders host-prepared diagnostic groups without interpreting raw codes.
const props = defineProps<{
  group: PerformanceTuningDiagnosticGroupViewModel;
}>();

const tableRefOf = (schemaName: string | undefined, tableName: string | undefined): string =>
  [schemaName, tableName].filter(Boolean).join(".");
</script>

<template>
  <div class="DiagnosticGroupCard" :class="props.group.severity">
    <div class="summary-row">
      <span
        class="codicon"
        :class="props.group.severity === 'warning' ? 'codicon-warning' : 'codicon-info'"
        aria-hidden="true"
      ></span>
      <div class="text">
        <p class="title">{{ props.group.title }}</p>
        <p class="summary">{{ props.group.summary }}</p>
        <p v-if="props.group.suggestedAction" class="suggested-action">
          <span class="suggested-action-label">Suggested action:</span> {{ props.group.suggestedAction }}
        </p>
      </div>
    </div>

    <!-- Always present, even for a single-detail group - node ID/operation/
         object name must stay reachable per §4.4, and collapsed-by-default
         keeps the beginner-facing summary above the fold. -->
    <details class="technical-details">
      <summary>Technical details ({{ props.group.details.length }})</summary>
      <table>
        <thead>
          <tr>
            <th>Node</th>
            <th>Operation</th>
            <th>Object</th>
            <th>Table</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(d, i) in props.group.details" :key="i">
            <td>{{ d.nodeId ?? "" }}</td>
            <td>{{ d.operation ?? "" }}</td>
            <td>{{ d.objectName ?? "" }}</td>
            <td>{{ tableRefOf(d.schemaName, d.tableName) }}</td>
            <td>{{ d.technicalMessage }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped>
.DiagnosticGroupCard {
  border-left: 3px solid var(--vscode-editorWidget-border);
  padding: 4px 8px;
  margin-bottom: 8px;
  border-radius: 2px;
  background: var(--vscode-editorWidget-background);
}

/* Info is deliberately neutral/blue, never the warning color (§4.4) - a
   non-table plan source or a factual plan observation is not an issue. */
.DiagnosticGroupCard.info {
  border-left-color: var(--vscode-notificationsInfoIcon-foreground);
}

.DiagnosticGroupCard.warning {
  border-left-color: var(--vscode-editorWarning-foreground);
}

.summary-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.DiagnosticGroupCard.info .codicon {
  color: var(--vscode-notificationsInfoIcon-foreground);
}

.DiagnosticGroupCard.warning .codicon {
  color: var(--vscode-editorWarning-foreground);
}

.text {
  flex: 1 1 auto;
  min-width: 0;
}

.title {
  font-weight: 600;
  margin: 0 0 2px 0;
}

.summary {
  margin: 0;
}

.suggested-action {
  margin: 4px 0 0 0;
}

.suggested-action-label {
  font-weight: 600;
}

.technical-details {
  margin-top: 6px;
}

.technical-details summary {
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  font-size: 0.9em;
}

.technical-details table {
  border-collapse: collapse;
  width: 100%;
  margin: 4px 0 2px 0;
  font-size: 0.85em;
}

.technical-details th,
.technical-details td {
  border: 1px solid var(--vscode-editorWidget-border);
  padding: 2px 6px;
  text-align: left;
  vertical-align: top;
}
</style>
