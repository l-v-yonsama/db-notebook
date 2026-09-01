<script setup lang="ts">
import type { PerformanceTuningDiagnosticGroupViewModel } from "@/utilities/vscode";
import PerformanceTuningInsightCard from "./PerformanceTuningInsightCard.vue";

// Renders host-prepared diagnostic groups without interpreting raw codes.
const props = defineProps<{
  group: PerformanceTuningDiagnosticGroupViewModel;
}>();

const tableRefOf = (schemaName: string | undefined, tableName: string | undefined): string =>
  [schemaName, tableName].filter(Boolean).join(".");
</script>

<template>
  <PerformanceTuningInsightCard
    class="DiagnosticGroupCard"
    :tone="props.group.severity"
    :title="props.group.title"
    :summary="props.group.summary"
  >
    <p v-if="props.group.suggestedAction" class="suggested-action">
      <span class="suggested-action-label">Suggested action:</span>
      {{ props.group.suggestedAction }}
    </p>

    <template #details>
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
    </template>
  </PerformanceTuningInsightCard>
</template>

<style scoped>
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
