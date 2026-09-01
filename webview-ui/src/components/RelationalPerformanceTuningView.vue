<script setup lang="ts">
// RDB body content extracted from the formerly-monolithic
// PerformanceTuningPreviewPanel.vue (2026-08-24 follow-up, DynamoDB support,
// design doc §11.3's 3-component split). Toolbar/AI options/persistent
// warning note/AI Analysis/Collection issues/Information/Full context JSON
// stay in the shell (shared with DynamoDbPerformanceTuningView.vue); this
// component renders only what's genuinely RDB-specific: the header
// (Database/Status/SQL) and Performance snapshot/Execution plan.
//
// The shell mounts this component *twice* - once with part="header" inside
// its non-scrolling .header, once with part="body" inside its scrolling
// .scrollArea - rather than once with a single multi-root template: a Vue
// component's root nodes can only land at the one place it's invoked, so a
// single mount could never split its own output across two different parent
// containers the way the fixed-header/scrolling-body layout (unchanged from
// before this split) needs. See the `order` values in this file's own
// <style> for how the documented visual order within .scrollArea is
// preserved even though this component only contributes some of its
// siblings there.
import type { RelationalPerformanceTuningInitializeViewModel } from "@/utilities/vscode";
import { actualExecutionEvidenceSource, hasActualExecutionEvidence } from "@/utilities/vscode";
import { computed } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import PerformanceTuningSnapshot from "./base/PerformanceTuningSnapshot.vue";

const props = defineProps<{
  data: RelationalPerformanceTuningInitializeViewModel;
  part: "header" | "body";
}>();

const context = computed(() => props.data.context);

const isDmlEstimate = computed(
  () => context.value.statement.kind !== undefined && context.value.statement.kind !== "select"
);
const hasActualEvidence = computed(() => hasActualExecutionEvidence(context.value));
const actualEvidenceSource = computed(() => actualExecutionEvidenceSource(context.value));

// Keep meaningful very small runtime ratios visible. A fixed two-decimal
// display turns a valid nested-loop inner access such as 1 / 30,000 into
// "0.00x" or "0.00%", which looks like missing/zero evidence instead of a
// highly selective access.
const formatRatio = (value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  const text =
    value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 1_000)
      ? value.toPrecision(3)
      : value.toFixed(2);
  return `${text}x`;
};

const formatFractionAsPercent = (value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  const percent = value * 100;
  const text =
    percent !== 0 && Math.abs(percent) < 0.01 ? percent.toPrecision(3) : percent.toFixed(2);
  return `${text}%`;
};
const formatActualRows = (value: number | undefined): string =>
  value === undefined && isDmlEstimate.value ? "Not measured (DML)" : (value ?? "-").toString();
const formatRuntimeMetric = (
  value: number | undefined,
  format: (value: number | undefined) => string
): string => (value === undefined && isDmlEstimate.value ? "Not measured (DML)" : format(value));
</script>

<template>
  <!-- 1. Database / Status / SQL - rendered into the shell's fixed (non-scrolling) .header. -->
  <template v-if="part === 'header'">
    <div class="row">
      <span class="label">Database</span>
      <span
        >{{ context.database.vendor
        }}{{ context.database.version ? ` ${context.database.version}` : "" }} ・
        {{ context.database.databaseName
        }}<span v-if="context.database.schemaName">.{{ context.database.schemaName }}</span></span
      >
    </div>
    <div class="row status-summary">
      <span class="label">Status</span>
      <span class="badge" :class="context.collection.status">{{ context.collection.status }}</span>
      <!-- complete badge stays green even with informational notes present -
         this is a supplementary count, not a new status value. -->
      <span
        v-if="
          context.collection.status === 'complete' &&
          data.diagnosticGroups.some((g) => g.severity === 'info')
        "
        class="notes-hint"
      >
        {{ data.diagnosticGroups.filter((g) => g.severity === "info").length }}
        {{
          data.diagnosticGroups.filter((g) => g.severity === "info").length === 1 ? "note" : "notes"
        }}
      </span>
    </div>
    <div class="row sql">
      <span class="label">SQL</span>
      <div class="code-panel">
        <div class="sql-block" v-html="data.sqlHtml"></div>
        <CopyToClipboardButton class="copy-btn" :content="context.statement.sql" title="Copy SQL" />
      </div>
    </div>
  </template>

  <!-- 2. Performance snapshot - rendered into the shell's scrolling .scrollArea. -->
  <template v-else>
    <div class="section performance-snapshot-section">
      <h3 class="section-title">Performance snapshot</h3>
      <PerformanceTuningSnapshot :summary="data.humanSummary" />
      <p v-if="data.queryDiagramAvailable" class="section-note query-diagram-notice">
        A query-scoped structure view (ER diagram and relevant indexes) will be included when you
        save this analysis as a Notebook; view it in the saved DBN or HTML report.<span
          v-if="data.queryDiagramHasWarnings"
        >
          Some relationships could not be resolved conservatively; the saved Notebook includes the
          details.</span
        >
      </p>
    </div>

    <!-- 5. Execution plan: normalizedPlan is a tree, so it's rendered as an
       EXPLAIN-style indented text block rather than a table (a table would
       lose the parent-child structure); planTableMappings is a genuinely
       flat per-table array, so that one is a small table. Both come
       pre-formatted from performanceTuningPlanFormatter.ts - this component
       only renders. -->
    <div
      v-if="data.planTreeText || data.planTableMappingRows.length > 0"
      class="section execution-plan-section"
    >
      <h3 class="section-title">
        Execution plan
        <span v-if="context.executionPlan.mode === 'analyze'" class="badge analyzed-badge"
          >analyzed</span
        >
      </h3>
      <p v-if="context.executionPlan.executionTimeMs !== undefined" class="section-note">
        Real execution time: {{ context.executionPlan.executionTimeMs }} ms
      </p>
      <p v-if="context.executionPlan.actualPlan" class="section-note">
        Runtime evidence from {{ actualEvidenceSource }} is shown first. The estimated topology is
        retained below only for structured table/predicate metadata and comparison.
      </p>
      <p v-else-if="hasActualEvidence" class="section-note">
        Runtime evidence from {{ actualEvidenceSource }} is included in the normalized execution
        plan below.
      </p>
      <p v-else class="section-note">
        {{
          isDmlEstimate
            ? "DML statement — estimated plan only; runtime measurements are not collected."
            : "Estimated plan only — the SQL has not been executed for runtime measurements."
        }}
      </p>
      <div v-if="context.executionPlan.actualPlan" class="actual-plan-text-block">
        <h4>Actual execution plan ({{ context.executionPlan.actualPlan.source }})</h4>
        <pre class="plan-tree">{{
          data.actualPlanDisplayText ?? context.executionPlan.actualPlan.content
        }}</pre>
      </div>
      <details
        v-if="data.planTreeText"
        class="advanced-details"
        :open="!context.executionPlan.actualPlan"
      >
        <summary>
          {{
            context.executionPlan.actualPlan
              ? "Estimated plan topology"
              : hasActualEvidence
              ? `Actual execution plan (${actualEvidenceSource})`
              : "Execution plan topology"
          }}
        </summary>
        <pre class="plan-tree">{{ data.planTreeText }}</pre>
      </details>
      <table v-if="data.planTableMappingRows.length > 0" class="plan-table-mappings">
        <caption>
          Table metrics
        </caption>
        <thead>
          <tr>
            <th>Table</th>
            <th>Index</th>
            <th>Est. rows</th>
            <th>Actual rows</th>
            <th>Actual/est. ratio</th>
            <th>Access fraction</th>
            <th>Filter pass rate</th>
            <th>Columns used</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in data.planTableMappingRows" :key="`plan-table-${i}`">
            <td>{{ row.table }}</td>
            <td>{{ row.index ?? "-" }}</td>
            <td>{{ row.estimatedRows ?? "-" }}</td>
            <td>{{ formatActualRows(row.actualRows) }}</td>
            <td>{{ formatRuntimeMetric(row.rowEstimateRatio, formatRatio) }}</td>
            <td>{{ formatRuntimeMetric(row.tableAccessFraction, formatFractionAsPercent) }}</td>
            <td>
              {{ formatRuntimeMetric(row.predicateFilterSelectivity, formatFractionAsPercent) }}
            </td>
            <td>{{ row.columnsUsed ?? "-" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style lang="scss" scoped>
/* Header rows (Database/Status/SQL) - identical rules to the former
   PerformanceTuningPreviewPanel.vue's .header .row/.label/.sql-block, now
   scoped to this component since they only ever apply to elements this
   component itself renders (order/positioning still comes from the shell's
   own .header/.scrollArea flex containers). */
.row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;

  &.sql {
    align-items: flex-start;

    .code-panel {
      flex: 1 1 auto;
      min-width: 0;
    }
  }
}

.label {
  font-weight: 600;
  min-width: 110px;
  flex: 0 0 auto;
}

.sql-block {
  max-height: 160px;
  overflow: auto;
  border-radius: 3px;
}

.code-panel {
  position: relative;
}

.sql-block :deep(pre.code-highlight) {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  padding-right: 32px;
}

.copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
}

.badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.9em;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);

  &.complete {
    border-color: var(--vscode-testing-iconPassed);
  }

  &.partial {
    border-color: var(--vscode-editorWarning-foreground);
  }

  &.analyzed-badge {
    border-color: var(--vscode-notificationsInfoIcon-foreground);
    font-weight: normal;
    margin-left: 6px;
  }
}

.notes-hint {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}

.exceeded {
  color: var(--vscode-errorForeground);
  font-weight: 600;
}

.label-inline {
  font-weight: 600;
}

/* Body sections - `order` keeps the documented visual sequence (§6.1's
   layout, unchanged by the split) even though these are now flex siblings
   of the shell's own sections within its shared .scrollArea. */
.performance-snapshot-section {
  order: 1;
}
.execution-plan-section {
  order: 4;
}

.section {
  margin-bottom: 12px;
}

.section-title {
  font-size: 1em;
  margin: 0 0 4px 0;
}

.section-note {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
  margin: 0 0 8px 0;
}

.plan-tree {
  margin: 0 0 8px 0;
  padding: 6px 8px;
  max-height: 180px;
  overflow: auto;
  white-space: pre;
  font-size: 0.85em;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 3px;
}

.plan-table-mappings {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85em;

  caption {
    caption-side: top;
    margin: 0 0 4px 0;
    text-align: left;
    font-size: 1.1em;
    font-weight: 600;
  }

  th,
  td {
    border: 1px solid var(--vscode-editorWidget-border);
    padding: 2px 6px;
    text-align: left;
    vertical-align: top;
  }
}

.actual-plan-text-block {
  margin-top: 8px;

  h4 {
    margin: 0 0 4px 0;
    font-size: 0.95em;
  }
}
</style>
