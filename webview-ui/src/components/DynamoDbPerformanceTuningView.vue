<script setup lang="ts">
// DynamoDB body content (design doc §11.3's 3-component split - see
// RelationalPerformanceTuningView.vue's own top comment for the shared
// architecture, including why the shell mounts this component *twice*
// (part="header"/"body") instead of once). Renders items 1/2/3/5/6/7/8 of
// §11.3's documented display order; items 4/9/10/11 (Collection issues/
// Information/AI Analysis/Full context JSON) are shell-owned and shared
// with the RDB view - see PerformanceTuningPreviewPanel.vue.
import type { DynamoDbCapacityBreakdown } from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  DynamoDbPerformanceTuningHumanProfile,
  DynamoDbPerformanceTuningInitializeViewModel,
} from "@/utilities/vscode";
import { formatUtcWithLocal } from "@/utilities/vscode";
import { computed } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import ObservedSignalCard from "./base/ObservedSignalCard.vue";

const props = defineProps<{
  data: DynamoDbPerformanceTuningInitializeViewModel;
  part: "header" | "body";
}>();

const context = computed(() => props.data.context);

const infoCount = computed(
  () => props.data.diagnosticGroups.filter((g) => g.severity === "info").length
);
const observationComplete = computed(
  () => context.value.observation?.completeness === "complete" && !context.value.observation?.bounded
);

const allIndexes = computed(() => [
  ...context.value.table.localSecondaryIndexes,
  ...context.value.table.globalSecondaryIndexes,
]);

const evidenceLabel = (evidence: DynamoDbPerformanceTuningHumanProfile["evidence"]): string => {
  switch (evidence) {
    case "observed":
      return "Observed read";
    case "workload":
      return "Workload history only";
    case "none":
    default:
      return "Static only";
  }
};

const formatPercent = (value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  const percent = value * 100;
  return `${
    percent !== 0 && Math.abs(percent) < 0.01 ? percent.toPrecision(3) : percent.toFixed(2)
  }%`;
};

const formatCapacity = (c: DynamoDbCapacityBreakdown): string => {
  const parts: string[] = [];
  if (c.capacityUnits !== undefined) {
    parts.push(`${c.capacityUnits} total`);
  }
  if (c.readCapacityUnits !== undefined) {
    parts.push(`${c.readCapacityUnits} read`);
  }
  if (c.writeCapacityUnits !== undefined) {
    parts.push(`${c.writeCapacityUnits} write`);
  }
  return parts.length > 0 ? parts.join(" / ") : "-";
};

const seriesLatest = (values: number[]): number | string =>
  values.length > 0 ? values[values.length - 1] : "-";
const seriesMax = (values: number[]): number | string =>
  values.length > 0 ? Math.max(...values) : "-";
</script>

<template>
  <!-- 1. AWS region / table / index / collection status - rendered
       into the shell's fixed (non-scrolling) .header. -->
  <template v-if="part === 'header'">
    <div class="row">
      <span class="label">Table</span>
      <span>
        {{ context.service.tableName
        }}<span v-if="context.service.indexName">
          ({{ context.accessPattern.indexType ?? "index" }} {{ context.service.indexName }})</span
        >
        <span v-if="context.service.region" class="region"> ・ {{ context.service.region }}</span>
        <span v-if="context.service.endpointKind === 'custom'" class="region">
          ・ custom endpoint</span
        >
      </span>
    </div>
    <div class="row status-summary">
      <span class="label">Status</span>
      <span class="badge" :class="context.collection.status">{{ context.collection.status }}</span>
      <span v-if="context.collection.status === 'complete' && infoCount > 0" class="notes-hint">
        {{ infoCount }} {{ infoCount === 1 ? "note" : "notes" }}
      </span>
    </div>
    <!-- 2. Target PartiQL or ephemeral native Query input. Native values are
       supplied only in the Preview view model; they are not in Full Context,
       DBN, Comparison, or AI input. -->
    <div v-if="data.sqlHtml" class="row sql">
      <span class="label">PartiQL</span>
      <div class="code-panel">
        <div class="sql-block" v-html="data.sqlHtml"></div>
        <CopyToClipboardButton
          class="copy-btn"
          :content="context.statement.text ?? ''"
          title="Copy PartiQL"
        />
      </div>
    </div>
    <div v-else-if="data.nativeQuery" class="row native-query-row">
      <span class="label">Native Query</span>
      <div class="native-query-panel">
        <div class="native-query-target">{{ data.nativeQuery.target }}</div>
        <table class="native-query-table">
          <tbody>
            <tr>
              <th>Key condition</th>
              <td><code>{{ data.nativeQuery.keyCondition.resolved }}</code></td>
            </tr>
            <tr v-if="data.nativeQuery.filter">
              <th>Filter</th>
              <td><code>{{ data.nativeQuery.filter.resolved }}</code></td>
            </tr>
            <tr v-if="data.nativeQuery.projection">
              <th>Projection</th>
              <td><code>{{ data.nativeQuery.projection.resolved }}</code></td>
            </tr>
          </tbody>
        </table>
        <details class="native-query-details">
          <summary>Native Query details</summary>
          <table class="native-query-table detail-table">
            <tbody>
              <tr><th>KeyConditionExpression</th><td><code>{{ data.nativeQuery.keyCondition.raw }}</code></td></tr>
              <tr v-if="data.nativeQuery.filter"><th>FilterExpression</th><td><code>{{ data.nativeQuery.filter.raw }}</code></td></tr>
              <tr v-if="data.nativeQuery.projection"><th>ProjectionExpression</th><td><code>{{ data.nativeQuery.projection.raw }}</code></td></tr>
              <tr v-if="data.nativeQuery.select"><th>Select</th><td>{{ data.nativeQuery.select }}</td></tr>
              <tr><th>Consistent read</th><td>{{ data.nativeQuery.consistentRead }}</td></tr>
              <tr><th>Scan direction</th><td>{{ data.nativeQuery.scanDirection }}</td></tr>
              <tr v-if="data.nativeQuery.limit !== undefined"><th>Limit</th><td>{{ data.nativeQuery.limit }}</td></tr>
            </tbody>
          </table>
          <div v-if="data.nativeQuery.expressionAttributeNames.length" class="native-query-mapping">
            <strong>Expression attribute names</strong>
            <code v-for="item in data.nativeQuery.expressionAttributeNames" :key="item.token">
              {{ item.token }} = {{ item.name }}
            </code>
          </div>
          <div v-if="data.nativeQuery.expressionAttributeValues.length" class="native-query-mapping">
            <strong>Expression attribute values</strong>
            <code v-for="item in data.nativeQuery.expressionAttributeValues" :key="item.token">
              {{ item.token }} = {{ item.value }}
            </code>
          </div>
        </details>
      </div>
    </div>
    <div v-else class="row">
      <span class="label">Query</span>
      <span>Native Query on {{ data.accessPattern.targetRef }}</span>
    </div>
  </template>

  <!-- 3. Performance snapshot - rendered into the shell's scrolling .scrollArea. -->
  <template v-else>
    <div class="section dynamodb-performance-snapshot-section">
      <h3 class="section-title">Performance snapshot</h3>
      <div class="performance-snapshot">
        <div class="profile">
          <span class="profile-item"
            ><strong>Operation:</strong> {{ data.accessPattern.operationLabel }}</span
          >
          <span class="profile-item">
            <strong>Access path:</strong> {{ data.accessPattern.accessPathLabel }}
            <span v-if="data.humanSummary.profile.confidence === 'unknown'"> (unresolved)</span>
          </span>
          <span class="profile-item"
            ><strong>Evidence:</strong>
            {{ evidenceLabel(data.humanSummary.profile.evidence) }}</span
          >
          <span class="profile-item"
            ><strong>Collection:</strong> {{ data.humanSummary.profile.collectionStatus }}</span
          >
        </div>
        <p class="scope-detail">{{ data.humanSummary.profile.targetRef }}</p>

        <h4>Observed signals</h4>
        <p class="note">
          Deterministic summaries of collected DynamoDB facts; these are separate from the AI
          analysis.
        </p>
        <div class="signals">
          <ObservedSignalCard
            v-for="(signal, index) in data.humanSummary.signals"
            :key="`${signal.kind}-${index}`"
            :signal="signal"
          />
        </div>
      </div>
    </div>

    <!-- 5. Access pattern -->
    <div class="section dynamodb-access-pattern-section">
      <h3 class="section-title">Access pattern</h3>
      <p v-if="data.accessPattern.confidence === 'unknown'" class="section-note attention-note">
        <fa icon="triangle-exclamation" /> This statement's access path could not be safely
        classified. Treat the read cost as unknown.
      </p>
      <table class="kv-table">
        <tbody>
          <tr>
            <th>Operation</th>
            <td>{{ data.accessPattern.operationLabel }}</td>
          </tr>
          <tr>
            <th>Access path</th>
            <td>{{ data.accessPattern.accessPathLabel }}</td>
          </tr>
          <tr>
            <th>Target</th>
            <td>{{ data.accessPattern.targetRef }}</td>
          </tr>
          <tr>
            <th>Partition key</th>
            <td>{{ data.accessPattern.partitionKeyText }}</td>
          </tr>
          <tr v-if="data.accessPattern.sortKeyText">
            <th>Sort key</th>
            <td>{{ data.accessPattern.sortKeyText }}</td>
          </tr>
          <tr>
            <th>Post-read filter</th>
            <td>{{ data.accessPattern.postReadFilterText }}</td>
          </tr>
          <tr>
            <th>Projection</th>
            <td>{{ data.accessPattern.projectionText }}</td>
          </tr>
          <tr>
            <th>Consistency</th>
            <td>{{ data.accessPattern.consistentReadLabel }}</td>
          </tr>
          <tr v-if="data.accessPattern.apiLimitText">
            <th>DynamoDB API Limit</th>
            <td>{{ data.accessPattern.apiLimitText }}</td>
          </tr>
          <tr v-if="data.accessPattern.resultItemLimitText">
            <th>Max returned items</th>
            <td>{{ data.accessPattern.resultItemLimitText }}</td>
          </tr>
          <tr v-if="data.accessPattern.scanDirectionLabel">
            <th>Scan direction</th>
            <td>{{ data.accessPattern.scanDirectionLabel }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 6. Table and index definition. attributeDefinitions is only the
       table/index key attributes, never a full column list - DynamoDB is
       schemaless outside of keys (DynamoDbTableContext's own doc comment). -->
    <div class="section dynamodb-table-section">
      <h3 class="section-title">Table and index definition</h3>
      <table class="kv-table">
        <tbody>
          <tr>
            <th>Billing mode</th>
            <td>{{ context.table.billingMode }}</td>
          </tr>
          <tr>
            <th>Partition key</th>
            <td>
              {{ context.table.keySchema.partitionKey.attributeName }} ({{
                context.table.keySchema.partitionKey.attributeType
              }})
            </td>
          </tr>
          <tr v-if="context.table.keySchema.sortKey">
            <th>Sort key</th>
            <td>
              {{ context.table.keySchema.sortKey.attributeName }} ({{
                context.table.keySchema.sortKey.attributeType
              }})
            </td>
          </tr>
          <tr v-if="context.table.itemCount">
            <th>Item count</th>
            <td>{{ context.table.itemCount.value.toLocaleString() }} (approximate)</td>
          </tr>
          <tr v-if="context.table.tableSizeBytes">
            <th>Table size</th>
            <td>{{ context.table.tableSizeBytes.value.toLocaleString() }} bytes (approximate)</td>
          </tr>
          <tr v-if="context.table.ttl">
            <th>TTL</th>
            <td>
              {{ context.table.ttl.status
              }}<span v-if="context.table.ttl.attributeName">
                ({{ context.table.ttl.attributeName }})</span
              >
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="allIndexes.length > 0">
        <h4>Indexes</h4>
        <table class="kv-table index-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Partition key</th>
              <th>Sort key</th>
              <th>Projection</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="idx in allIndexes"
              :key="idx.indexName"
              :class="{ current: idx.indexName === context.service.indexName }"
            >
              <td>{{ idx.indexName }}</td>
              <td>{{ idx.indexType }}</td>
              <td>{{ idx.keySchema.partitionKey.attributeName }}</td>
              <td>{{ idx.keySchema.sortKey?.attributeName ?? "-" }}</td>
              <td>
                {{ idx.projection.projectionType }}
                <span
                  v-if="
                    idx.projection.nonKeyAttributes && idx.projection.nonKeyAttributes.length > 0
                  "
                >
                  ({{ idx.projection.nonKeyAttributes.join(", ") }})
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <p v-if="context.table.contributorInsights.length > 0" class="section-note">
        Contributor Insights:
        {{
          context.table.contributorInsights
            .map((ci) => `${ci.indexName ?? "table"}: ${ci.status}`)
            .join(", ")
        }}
      </p>
    </div>

    <!-- 7. Observed request -->
    <div class="section dynamodb-observed-section">
      <h3 class="section-title">Observed request</h3>
      <template v-if="context.observation">
        <div
          class="observation-completeness"
          :class="observationComplete ? 'complete' : 'incomplete'"
        >
          <span class="codicon" :class="observationComplete ? 'codicon-pass-filled' : 'codicon-warning'"></span>
          <strong>{{ observationComplete ? "COMPLETE" : "INCOMPLETE" }}</strong>
          <span>
            {{ observationComplete
              ? "The read reached the end of the result."
              : context.observation.boundDescription ?? "The full result was not observed." }}
          </span>
        </div>
        <table class="kv-table">
          <tbody>
            <tr>
              <th>Source</th>
              <td>{{ context.observation.source }}</td>
            </tr>
            <tr v-if="context.observation.observedAt">
              <th>Observed at</th>
              <td>{{ formatUtcWithLocal(context.observation.observedAt) }}</td>
            </tr>
            <tr>
              <th>Returned items</th>
              <td>{{ context.observation.returnedItemCount ?? "-" }}</td>
            </tr>
            <tr v-if="context.observation.evaluatedItemCount !== undefined">
              <th>Evaluated items</th>
              <td>{{ context.observation.evaluatedItemCount }}</td>
            </tr>
            <tr v-if="context.observation.filterPassRate !== undefined">
              <th>Filter pass rate</th>
              <td>{{ formatPercent(context.observation.filterPassRate) }}</td>
            </tr>
            <tr v-if="context.observation.consumedCapacity">
              <th>Consumed Capacity</th>
              <td>{{ formatCapacity(context.observation.consumedCapacity) }}</td>
            </tr>
            <tr>
              <th>Request / retry count</th>
              <td>
                {{ context.observation.requestCount ?? "-" }} /
                {{ context.observation.retryCount ?? "-" }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="context.observation.bounded" class="section-note attention-note">
          <fa icon="triangle-exclamation" />
          {{
            context.observation.boundDescription ??
            "This observation is bounded and may not reflect the statement's full result."
          }}
        </p>
      </template>
      <p v-else class="section-note">No read has been observed for this exact statement yet.</p>
    </div>

    <!-- 8. CloudWatch window metrics -->
    <div class="section dynamodb-cloudwatch-section">
      <h3 class="section-title">CloudWatch window metrics</h3>
      <template v-if="context.cloudWatch">
        <p class="section-note">
          Window: {{ formatUtcWithLocal(context.cloudWatch.window.startTime) }} –
          {{ formatUtcWithLocal(context.cloudWatch.window.endTime) }} (period
          {{ context.cloudWatch.window.periodSeconds }}s). Table/index/operation-level activity over
          that window, not only this statement.
        </p>
        <table v-if="context.cloudWatch.series.length > 0" class="kv-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Scope</th>
              <th>Statistic</th>
              <th>Latest</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(series, i) in context.cloudWatch.series" :key="i">
              <td>{{ series.metricName }}</td>
              <td>
                {{ series.scope }}{{ series.indexName ? ` (${series.indexName})` : ""
                }}{{ series.operation ? ` / ${series.operation}` : "" }}
              </td>
              <td>{{ series.statistic }}</td>
              <td v-if="series.noData" colspan="2">no data</td>
              <template v-else>
                <td>{{ seriesLatest(series.values) }}</td>
                <td>{{ seriesMax(series.values) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
        <p v-else class="section-note">No CloudWatch series were collected.</p>
      </template>
      <p v-else class="section-note">CloudWatch metrics were not collected.</p>
    </div>
  </template>
</template>

<style lang="scss" scoped>
/* Header rows - same rules as RelationalPerformanceTuningView.vue's
   identically-named classes (each scoped independently, no collision). */
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

  &.native-query-row {
    align-items: flex-start;
  }
}

.native-query-panel {
  flex: 1 1 auto;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 3px;
  background: var(--vscode-editorWidget-background);
}

.native-query-target {
  font-weight: 600;
  margin-bottom: 5px;
}

.native-query-table {
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 2px 6px;
    text-align: left;
    vertical-align: top;
  }

  th {
    width: 175px;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
  }

  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.native-query-details {
  margin-top: 6px;
  border-top: 1px solid var(--vscode-editorWidget-border);
  padding-top: 5px;

  > summary {
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
  }
}

.native-query-mapping {
  display: grid;
  grid-template-columns: minmax(170px, auto) 1fr;
  gap: 3px 8px;
  margin: 7px 6px 0;

  strong {
    grid-column: 1 / -1;
  }

  code {
    grid-column: 1 / -1;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.label {
  font-weight: 600;
  min-width: 110px;
  flex: 0 0 auto;
}

.region {
  color: var(--vscode-descriptionForeground);
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

/* Body sections - see RelationalPerformanceTuningView.vue's own comment on
   why `order` (not template position) controls the documented visual
   sequence. This view's four DynamoDB-only sections (5-8) sit where RDB's
   single execution-plan-section (order 4) would be; ai-analysis/
   advanced-details (shell-owned, shared) are bumped to 8/9 accordingly -
   see PerformanceTuningPreviewPanel.vue's own <style>. */
.dynamodb-performance-snapshot-section {
  order: 1;
}
.dynamodb-access-pattern-section {
  order: 4;
}
.dynamodb-table-section {
  order: 5;
}
.dynamodb-observed-section {
  order: 6;
}
.dynamodb-cloudwatch-section {
  order: 7;
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

  &.attention-note {
    color: var(--vscode-editorWarning-foreground);
  }
}

.observation-completeness {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  margin: 4px 0 8px;
  border: 1px solid;
  border-radius: 3px;

  &.complete {
    color: var(--vscode-testing-iconPassed);
    background: color-mix(in srgb, var(--vscode-testing-iconPassed) 10%, transparent);
  }

  &.incomplete {
    color: var(--vscode-editorWarning-foreground);
    background: var(--vscode-inputValidation-warningBackground);
    border-color: var(--vscode-inputValidation-warningBorder);
  }
}

/* --- Performance snapshot (mirrors base/PerformanceTuningSnapshot.vue's
     own styling - kept as an inline duplicate here rather than reusing that
     RDB-typed component, since its prop is PerformanceTuningHumanSummary,
     not this file's DynamoDbPerformanceTuningHumanSummary; see this file's
     top comment for why the RDB component itself is left untouched). --- */
.performance-snapshot {
  .profile {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .profile-item {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .scope-detail,
  .note,
  .raw-path {
    color: var(--vscode-descriptionForeground);
  }

  h4 {
    margin: 12px 0 4px;
  }

  .note {
    margin: 3px 0;
  }
}

/* --- Access pattern / Table definition / Observed request / CloudWatch:
     a shared small key/value + list table style. --- */
.kv-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9em;
  margin-bottom: 8px;

  th,
  td {
    border: 1px solid var(--vscode-editorWidget-border);
    padding: 2px 6px;
    text-align: left;
    vertical-align: top;
  }

  th {
    width: 160px;
    font-weight: 600;
    background: var(--vscode-editor-inactiveSelectionBackground);
  }
}

.index-table {
  th {
    width: auto;
  }

  tr.current {
    background: var(--vscode-editor-inactiveSelectionBackground);
  }
}
</style>
