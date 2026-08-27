<script setup lang="ts">
// "Comparison with baseline" (misc/specs/performance-tuning-baseline-
// comparison-implementation-plan.ja.md §12). One shared component for both
// engines: everything it renders comes from the Comparison Evidence, which
// the extension host already normalized into engine-neutral shapes.
//
// Nothing here computes an improvement, a rate, or a comparability verdict.
// Those are all decided host-side and arrive precomputed - this component
// only rounds for display and picks an icon. Rendering does not depend on an
// AI analysis having run (§12's "AI 分析前から全セクションを表示可能にする").
import type {
  ComparisonValue,
  NumericComparison,
  PerformanceTuningComparisonViewState,
} from "@/utilities/vscode";
import {
  allMetrics,
  assessmentDisplay,
  comparabilityDisplay,
  describeIndexChange,
  formatChange,
  formatImprovement,
  formatMetricValue,
  keyImprovements,
} from "@/utilities/performanceTuningComparisonDisplay";
import { computed } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

const props = defineProps<{ state: PerformanceTuningComparisonViewState }>();
const emit = defineEmits<{
  (e: "select"): void;
  (e: "clear"): void;
}>();

const evidence = computed(() => props.state.evidence);
const isLoading = computed(() => props.state.status === "loading");

const comparability = computed(() =>
  evidence.value ? comparabilityDisplay(evidence.value.comparability.level) : undefined
);
const improvements = computed(() => (evidence.value ? keyImprovements(evidence.value) : []));
const metrics = computed(() => (evidence.value ? allMetrics(evidence.value) : []));
const indexChanges = computed(() => evidence.value?.common.indexes.changes ?? []);
const queryDiff = computed(() => evidence.value?.common.query.diff ?? []);

// Access-path rows, normalized across engines: RDB has one row per table from
// its plan, DynamoDB has a single row describing the whole read.
const accessPathRows = computed(() => {
  const e = evidence.value;
  if (!e) {
    return [];
  }
  if (e.engineSpecific.kind === "rdb") {
    return e.engineSpecific.value.accessPath.changes.map((change) => ({
      target: change.target,
      baseline: change.baseline ? describeStep(change.baseline) : undefined,
      current: change.current ? describeStep(change.current) : undefined,
      changed: change.changed,
      note: change.ambiguous
        ? `This table is read by ${change.baselineNodeCount} plan step(s) in the baseline and ${change.currentNodeCount} now, so the steps cannot be matched one to one.`
        : undefined,
    }));
  }
  const value = e.engineSpecific.value;
  return [
    {
      target: value.accessTarget.current ?? value.accessTarget.baseline ?? "",
      baseline: value.accessPath.baseline,
      current: value.accessPath.current,
      changed: value.accessPath.changed,
      note: undefined,
    },
  ];
});

const describeStep = (step: { operation: string; indexName?: string }): string =>
  step.indexName ? `${step.operation} using ${step.indexName}` : step.operation;

// Engine-specific single-value rows, rendered as one flat "what changed"
// list rather than two divergent templates.
const structureRows = computed<Array<{ label: string; value: ComparisonValue<unknown> }>>(() => {
  const e = evidence.value;
  if (!e) {
    return [];
  }
  if (e.engineSpecific.kind === "rdb") {
    const v = e.engineSpecific.value;
    return [
      { label: "Vendor", value: v.vendor },
      { label: "Statement kind", value: v.statementKind },
      { label: "Plan mode", value: v.planMode },
      { label: "Evidence", value: v.evidenceKind },
      { label: "Dominant step", value: v.dominantCostNode },
    ];
  }
  const v = e.engineSpecific.value;
  return [
    { label: "Request type", value: v.language },
    { label: "Operation", value: v.operation },
    { label: "Read target", value: v.accessTarget },
    { label: "Partition key condition", value: v.partitionKeyCondition },
    { label: "Sort key condition", value: v.sortKeyCondition },
    { label: "Post-read filter", value: v.postReadFilter },
    { label: "Projection", value: v.projection },
    { label: "Consistent read", value: v.consistentRead },
    { label: "Scan direction", value: v.scanDirection },
    { label: "API Limit", value: v.limits.apiLimit },
    { label: "Result item cap", value: v.limits.resultItemLimit },
    { label: "Observation bound", value: v.limits.observationBound },
    { label: "Observation completeness", value: v.observationCompleteness },
  ];
});

const changedStructureRows = computed(() => structureRows.value.filter((row) => row.value.changed));

const formatSideValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "—";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.join(", ");
  }
  return String(value);
};

const evidenceJson = computed(() =>
  evidence.value ? JSON.stringify(evidence.value, null, 2) : ""
);

const metricRow = (metric: NumericComparison) => assessmentDisplay(metric.assessment);
</script>

<template>
  <div class="section comparison-section">
    <div class="section-title-row">
      <h3 class="section-title">Comparison with baseline</h3>
      <CopyToClipboardButton
        v-if="evidenceJson"
        :content="evidenceJson"
        title="Copy Comparison Evidence JSON"
      />
    </div>

    <div class="row baseline-row">
      <VsCodeButton
        appearance="secondary"
        :disabled="isLoading"
        :title="state.baseline
          ? 'Pick a different saved report to compare this preview against'
          : 'Pick a saved Performance Tuning report to compare this preview against'"
        @click="emit('select')"
      >
        <fa icon="code-compare" />{{ state.baseline ? "Change Baseline…" : "Compare with Baseline…" }}
      </VsCodeButton>
      <VsCodeButton
        v-if="state.baseline"
        appearance="secondary"
        :disabled="isLoading"
        title="Stop comparing against this baseline"
        @click="emit('clear')"
      >
        <fa icon="xmark" />Clear Baseline
      </VsCodeButton>
      <span v-if="state.baseline" class="baseline-file" :title="state.baseline.sourcePath">
        {{ state.baseline.fileName }}
      </span>
    </div>

    <p v-if="state.errorMessage" class="comparison-error">
      <fa icon="circle-exclamation" />{{ state.errorMessage }}
    </p>

    <p v-if="isLoading" class="section-note">Loading baseline…</p>

    <p v-else-if="!evidence" class="section-note">
      Select a saved report from reports/performance-tuning/ to see what changed between it and this
      preview. The comparison is computed by the extension, so it works without running an AI
      analysis.
    </p>

    <template v-else>
      <!-- 1. Baseline and comparability -->
      <div class="row comparability-row" v-if="comparability">
        <span class="label">Comparability</span>
        <span class="assessment" :class="comparability.tone">
          <fa :icon="comparability.icon" />{{ comparability.text }}
        </span>
        <span class="collected-at">
          baseline collected {{ state.baseline?.collectedAt ?? "unknown" }} · current collected
          {{ evidence.source.current.collectedAt ?? "unknown" }}
        </span>
      </div>

      <!-- 7. Comparison notes: shown up here (not at the bottom) whenever
           something blocks or qualifies the comparison, so a reader never
           reads a metric table before the caveat that applies to it. -->
      <ul class="reason-list">
        <li
          v-for="(reason, i) in evidence.comparability.reasons"
          :key="`reason-${i}`"
          :class="reason.level"
        >
          <fa
            :icon="reason.level === 'notComparable'
              ? 'circle-xmark'
              : reason.level === 'partiallyComparable'
                ? 'triangle-exclamation'
                : 'circle-info'"
          />
          <span>{{ reason.message }}</span>
          <span v-if="reason.detail" class="reason-detail">{{ reason.detail }}</span>
        </li>
      </ul>

      <!-- 2. Key improvements -->
      <div class="comparison-subsection">
        <h4>Key changes</h4>
        <p v-if="improvements.length === 0" class="section-note">
          No comparable metric moved enough to summarize. The full table below still shows every
          value collected on both sides.
        </p>
        <ul v-else class="improvement-list">
          <li v-for="entry in improvements" :key="entry.metric.key">
            <span class="assessment" :class="metricRow(entry.metric).tone">
              <fa :icon="metricRow(entry.metric).icon" />{{ metricRow(entry.metric).text }}
            </span>
            <span class="improvement-label">{{ entry.metric.label }}</span>
            <span class="improvement-value">
              {{ formatMetricValue(entry.metric.baseline, entry.metric.unit) }} →
              {{ formatMetricValue(entry.metric.current, entry.metric.unit) }}
              ({{ entry.improvement }})
            </span>
          </li>
        </ul>
      </div>

      <!-- 3. Query changes -->
      <div class="comparison-subsection">
        <h4>Request changes</h4>
        <p v-if="!evidence.common.query.changed" class="section-note">
          The request text is identical on both sides.
        </p>
        <template v-else>
          <div class="code-panel">
            <pre class="query-diff"><span
              v-for="(line, i) in queryDiff"
              :key="`diff-${i}`"
              class="diff-line"
              :class="line.kind"
            >{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }} {{ line.text }}
</span></pre>
          </div>
          <p v-if="evidence.common.query.diffTruncated" class="section-note">
            The diff was truncated for display. Both full request bodies remain in the Comparison
            Evidence JSON below.
          </p>
          <div class="row query-copy-row">
            <CopyToClipboardButton
              v-if="evidence.common.query.baseline?.text"
              appearance="secondary"
              :content="evidence.common.query.baseline.text"
              title="Copy the baseline request"
            >Copy baseline</CopyToClipboardButton>
            <CopyToClipboardButton
              v-if="evidence.common.query.current?.text"
              appearance="secondary"
              :content="evidence.common.query.current.text"
              title="Copy the current request"
            >Copy current</CopyToClipboardButton>
          </div>
        </template>
      </div>

      <!-- 4. Access path / execution plan changes -->
      <div class="comparison-subsection">
        <h4>Access path changes</h4>
        <table class="comparison-table">
          <thead>
            <tr><th>Target</th><th>Baseline</th><th>Current</th><th>Assessment</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in accessPathRows" :key="row.target">
              <td>{{ row.target }}</td>
              <td>{{ formatSideValue(row.baseline) }}</td>
              <td>{{ formatSideValue(row.current) }}</td>
              <td>
                <span class="assessment" :class="row.changed ? 'positive' : 'neutral'">
                  <fa :icon="row.changed ? 'circle-arrow-right' : 'circle-minus'" />
                  {{ row.changed ? "Changed" : "No change" }}
                </span>
                <span v-if="row.note" class="row-note">{{ row.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <table v-if="changedStructureRows.length > 0" class="comparison-table">
          <thead>
            <tr><th>Property</th><th>Baseline</th><th>Current</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in changedStructureRows" :key="row.label">
              <td>{{ row.label }}</td>
              <td>{{ formatSideValue(row.value.baseline) }}</td>
              <td>{{ formatSideValue(row.value.current) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 5. Index and schema changes: definition first, then use, kept on
           separate rows because "an index exists" and "the query uses it" are
           different facts (§12). -->
      <div class="comparison-subsection">
        <h4>Index changes</h4>
        <p v-if="indexChanges.length === 0" class="section-note">
          All {{ evidence.common.indexes.unchangedCount }} index definition(s) observed on both sides
          are identical.
        </p>
        <ul v-else class="index-change-list">
          <li v-for="(change, i) in indexChanges" :key="`index-${i}`">
            <fa :icon="describeIndexChange(change).icon" />
            <span class="index-change-label">{{ describeIndexChange(change).label }}</span>
            <code>{{ describeIndexChange(change).detail }}</code>
          </li>
        </ul>
        <div class="row">
          <span class="label">Indexes used</span>
          <span>{{ formatSideValue(evidence.common.indexes.used.baseline) }}</span>
          <span>→</span>
          <span>{{ formatSideValue(evidence.common.indexes.used.current) }}</span>
        </div>
      </div>

      <!-- 6. Metric comparison -->
      <div class="comparison-subsection">
        <h4>Metric comparison</h4>
        <p v-if="metrics.length === 0" class="section-note">
          Neither side collected a metric that both could report.
        </p>
        <table v-else class="comparison-table">
          <thead>
            <tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th><th>Assessment</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in metrics" :key="m.key" :class="metricRow(m).tone">
              <td>{{ m.label }}</td>
              <td>{{ formatMetricValue(m.baseline, m.unit) }}</td>
              <td>{{ formatMetricValue(m.current, m.unit) }}</td>
              <td>
                {{ formatChange(m) }}
                <span v-if="formatImprovement(m)" class="improvement-inline">
                  ({{ formatImprovement(m) }})
                </span>
              </td>
              <td>
                <span class="assessment" :class="metricRow(m).tone">
                  <fa :icon="metricRow(m).icon" />{{ metricRow(m).text }}
                </span>
                <span v-if="m.reason" class="row-note">{{ m.reason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 8. Advanced details -->
      <details class="advanced-details">
        <summary>Advanced details: Comparison Evidence JSON</summary>
        <p class="advanced-note">
          Every figure above comes from this object. It also records the baseline file it was built
          from<span v-if="state.baseline?.sourcePath"> ({{ state.baseline.sourcePath }})</span> and
          the SHA-256 of the baseline context, so a saved report can be verified later.
        </p>
        <pre class="evidence-json">{{ evidenceJson }}</pre>
      </details>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.comparison-section {
  .section-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;

    .section-title {
      margin: 0;
      font-size: 1em;
    }
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
    flex-wrap: wrap;

    .label {
      font-weight: 600;
      min-width: 110px;
      flex: 0 0 auto;
    }
  }

  .baseline-file {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
  }

  .collected-at {
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
  }

  .comparison-error {
    color: var(--vscode-errorForeground);
    font-size: 0.9em;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }

  .section-note {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin: 0 0 8px 0;
  }

  .comparison-subsection {
    margin: 10px 0;

    h4 {
      margin: 0 0 4px 0;
      font-size: 0.95em;
    }
  }

  /* Icon + text always travel together, so an improvement is never signalled
     by color alone (§12). The tone classes only tint what the text already
     says. */
  .assessment {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;

    &.positive { color: var(--vscode-testing-iconPassed); }
    &.negative { color: var(--vscode-errorForeground); }
    &.neutral { color: var(--vscode-foreground); }
    &.unknown { color: var(--vscode-descriptionForeground); }
  }

  .reason-list {
    list-style: none;
    padding: 0;
    margin: 4px 0 8px 0;
    font-size: 0.9em;

    li {
      display: flex;
      gap: 6px;
      align-items: baseline;
      margin-bottom: 2px;

      &.notComparable { color: var(--vscode-errorForeground); }
      &.partiallyComparable { color: var(--vscode-editorWarning-foreground); }
      &.comparable { color: var(--vscode-descriptionForeground); }
    }
  }

  .reason-detail {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }

  .improvement-list,
  .index-change-list {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 3px;
      flex-wrap: wrap;
    }
  }

  .improvement-label,
  .index-change-label {
    font-weight: 600;
  }

  .improvement-value,
  .improvement-inline {
    color: var(--vscode-descriptionForeground);
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
    margin-bottom: 8px;

    th,
    td {
      text-align: left;
      padding: 2px 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
    }

    th {
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
  }

  .row-note {
    display: block;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
  }

  .code-panel {
    position: relative;
  }

  .query-diff {
    margin: 0;
    font-size: 0.85em;
    max-height: 300px;
    overflow: auto;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 2px;
    padding: 4px 6px;
  }

  .diff-line {
    display: block;
    white-space: pre-wrap;
    word-break: break-word;

    &.added {
      background: var(--vscode-diffEditor-insertedTextBackground);
    }

    &.removed {
      background: var(--vscode-diffEditor-removedTextBackground);
    }
  }

  .query-copy-row {
    margin-top: 4px;
  }

  .advanced-details > summary {
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
  }

  .advanced-note {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin: 4px 0 8px 0;
  }

  .evidence-json {
    font-size: 0.85em;
    max-height: 40vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
}
</style>
