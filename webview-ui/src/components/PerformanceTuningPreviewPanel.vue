<script setup lang="ts">
import type {
  LabelValueItem,
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningDiagnosticGroupViewModel,
  PerformanceTuningHumanSummary,
  PerformanceTuningPreviewPanelEventData,
  PlanTableMappingRowViewModel,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { CapabilityStatus, PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, ref } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import DiagnosticGroupCard from "./base/DiagnosticGroupCard.vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import PerformanceTuningSnapshot from "./base/PerformanceTuningSnapshot.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";

const context = ref<PerformanceTuningContext | undefined>(undefined);
const diagnosticGroups = ref<PerformanceTuningDiagnosticGroupViewModel[]>([]);
const planTreeText = ref<string | undefined>(undefined);
const actualPlanDisplayText = ref<string | undefined>(undefined);
const planTableMappingRows = ref<PlanTableMappingRowViewModel[]>([]);
const humanSummary = ref<PerformanceTuningHumanSummary | undefined>(undefined);
const queryDiagramAvailable = ref(false);
const queryDiagramHasWarnings = ref(false);
const sqlHtml = ref("");
const jsonHtml = ref("");
// "Copy Prompt for Other AI" (2026-08-21 follow-up) - see
// MessageEventData.ts's own doc comment on this field.
const plainTextPrompt = ref("");
const translatedPlainTextPrompt = ref("");
const payloadBytes = ref(0);
const maxPayloadBytes = ref(0);

// Analyze with AI's "Language model"/"Translate response" options
// (2026-08-19 follow-up, design doc §0) - shown whenever a context is
// loaded (not gated on analysis.status), since the choice has to be made
// *before* clicking Analyze with AI.
const languageModels = ref<LabelValueItem[]>([]);
const languageModelId = ref("");
const translateResponse = ref(false);

// Step 10 "Analyze with AI" (misc/design/performance-tuning-structured-ai-analysis-plan.ja.md
// §6.1). Reset to idle on every new "initialize" (a fresh preview
// invalidates whatever analysis was shown for the previous one - mirrors
// PerformanceTuningPreviewPanel.ts's own renderGeneration-based reset).
const analysis = ref<PerformanceTuningAiAnalysisViewState>({ status: "idle" });

// "Run EXPLAIN ANALYZE" (2026-08-20 follow-up). Whether this connection's
// Provider even supports analyze mode at all - drives the button's disabled
// state and its tooltip when it is disabled. isRunningActualPlan has no
// "success" branch of its own: a
// successful run replaces the whole panel via a fresh "initialize" instead
// (see initialize() below, which is also what resets this back to false).
const analyzedExecutionPlan = ref<CapabilityStatus>({ available: false });
const isRunningActualPlan = ref(false);

// Only used for the "Copy JSON" button (needs plain text, not the
// highlighted HTML) - kept in sync with what the extension side rendered
// into jsonHtml since both stringify the same context with the same args.
const contextJson = computed(() => (context.value ? JSON.stringify(context.value, null, 2) : ""));

const payloadExceeded = computed(
  () => maxPayloadBytes.value > 0 && payloadBytes.value > maxPayloadBytes.value
);
const copyPromptForOtherAi = computed(() =>
  translateResponse.value ? translatedPlainTextPrompt.value : plainTextPrompt.value
);
const statementAllowsActualPlan = computed(
  () => context.value?.statement.analyzeEligibility?.allowed ?? true
);
const isDmlEstimate = computed(
  () => context.value?.statement.kind !== undefined && context.value.statement.kind !== "select"
);
const actualPlanButtonTitle = computed(() => {
  if (!statementAllowsActualPlan.value) {
    return context.value?.statement.analyzeEligibility?.reason ?? "Explain Analyze is limited to a single SELECT statement.";
  }
  return analyzedExecutionPlan.value.available
    ? "Run this SQL for real to measure its actual execution plan (real query execution - see the note below)"
    : (analyzedExecutionPlan.value.message ?? "Not available for this database");
});

// Keep meaningful very small runtime ratios visible. A fixed two-decimal
// display turns a valid nested-loop inner access such as 1 / 30,000 into
// "0.00x" or "0.00%", which looks like missing/zero evidence instead of a
// highly selective access.
const formatRatio = (value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  const text = value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 1_000)
    ? value.toPrecision(3)
    : value.toFixed(2);
  return `${text}x`;
};

const formatFractionAsPercent = (value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  const percent = value * 100;
  const text = percent !== 0 && Math.abs(percent) < 0.01 ? percent.toPrecision(3) : percent.toFixed(2);
  return `${text}%`;
};
const formatActualRows = (value: number | undefined): string =>
  value === undefined && isDmlEstimate.value ? "Not measured (DML)" : (value ?? "-").toString();
const formatRuntimeMetric = (value: number | undefined, format: (value: number | undefined) => string): string =>
  value === undefined && isDmlEstimate.value ? "Not measured (DML)" : format(value);

// buildPerformanceTuningDiagnosticGroups() (extension-side) already sorts
// information before warnings and never mixes severities within one group -
// this just splits that single ordered list into the two display sections
// §6.1 puts in different places. Neither list is re-sorted or re-derived
// here (§7: grouping/copy stays entirely in that one pure function).
const infoGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "info"));
const issueGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "warning"));

// §6.4: "partial なのに画面上に理由が1件も表示されない状態を禁止する" - status
// is derived driver-side from unavailableSections/diagnostics together
// (db-drivers §2.2), so whenever it's 'partial', issueGroups is guaranteed
// non-empty by construction (every unavailableSections entry and every
// affectsCompleteness diagnostic becomes a warning-severity group). Nothing
// extra to compute here; this comment just records the invariant this
// template relies on.

const initialize = (v: PerformanceTuningPreviewPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  context.value = v.context;
  diagnosticGroups.value = v.diagnosticGroups;
  planTreeText.value = v.planTreeText;
  actualPlanDisplayText.value = v.actualPlanDisplayText;
  planTableMappingRows.value = v.planTableMappingRows;
  humanSummary.value = v.humanSummary;
  queryDiagramAvailable.value = v.queryDiagramAvailable;
  queryDiagramHasWarnings.value = v.queryDiagramHasWarnings;
  sqlHtml.value = v.sqlHtml;
  jsonHtml.value = v.jsonHtml;
  plainTextPrompt.value = v.plainTextPrompt;
  translatedPlainTextPrompt.value = v.translatedPlainTextPrompt;
  payloadBytes.value = v.payloadBytes;
  maxPayloadBytes.value = v.maxPayloadBytes;
  languageModels.value = v.languageModels;
  languageModelId.value = v.languageModelId;
  translateResponse.value = v.translateResponse;
  analysis.value = { status: "idle" };
  analyzedExecutionPlan.value = v.analyzedExecutionPlan;
  isRunningActualPlan.value = false;
};

const recieveMessage = (data: PerformanceTuningPreviewPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      initialize(value.initialize);
      break;
    case "analysis-update":
      if (value.analysis) {
        analysis.value = value.analysis;
      }
      break;
    case "stop-progress":
      // "Run EXPLAIN ANALYZE" cancelled or failed - a successful run
      // instead arrives as a fresh "initialize" above, which already
      // resets this itself. The failure/cancellation reason (if any) was
      // already shown as a native VS Code notification, extension-side.
      isRunningActualPlan.value = false;
      break;
  }
};

const close = (): void => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const analyzeWithAi = (): void => {
  vscode.postCommand({
    command: "analyzePerformanceTuningWithAi",
    params: { languageModelId: languageModelId.value, translateResponse: translateResponse.value },
  });
};

const saveAiAnalysisAsNotebook = (): void => {
  vscode.postCommand({
    command: "saveAiAnalysisAsNotebook",
    params: {},
  });
};

// "Run EXPLAIN ANALYZE" (2026-08-20 follow-up). The confirmation itself is
// entirely host-side (a modal window.showWarningMessage - see
// PerformanceTuningPreviewPanel.ts's runActualPlan()); this only sets the
// optimistic "running" state so the button disables itself immediately -
// stop-progress above resets it again if the user declines that modal or
// the run fails.
const runActualPlan = (): void => {
  isRunningActualPlan.value = true;
  vscode.postCommand({
    command: "runActualPlan",
    params: {},
  });
};

const isAnalyzing = computed(() => analysis.value.status === "running");
const analysisJson = computed(() =>
  analysis.value.result ? JSON.stringify(analysis.value.result, null, 2) : ""
);

const evidenceLabel = (
  evidence:
    | NonNullable<PerformanceTuningAiAnalysisViewState["result"]>["findings"][number]["evidence"]
    | undefined
): string => {
  if (!evidence) {
    return "";
  }
  const parts: string[] = [];
  const tableRef = [evidence.schemaName, evidence.tableName].filter(Boolean).join(".");
  if (tableRef) {
    parts.push(`Table: ${tableRef}`);
  }
  if (evidence.indexName) {
    parts.push(`Index: ${evidence.indexName}`);
  }
  if (evidence.planNodeId) {
    parts.push(`Plan node: ${evidence.planNodeId}`);
  }
  if (evidence.diagnosticCode) {
    parts.push(`Diagnostic: ${evidence.diagnosticCode}`);
  }
  return parts.join(" / ");
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="PerformanceTuningPreviewPanel" v-if="context">
    <PanelActionToolbar @cancel="close" cancel-label="" cancel-title="Close">
      <template #left>
        <!-- "Run Explain Analyze" (2026-08-20 follow-up) - listed first
             since it's the button a user reaches for first (real execution
             plan before asking AI to analyze it), and deliberately a
             distinct icon/label from "Analyze with AI" below (that one only
             sends the already-collected context to an AI model; this one
             executes the SQL for real). Disabled, with the capability
             message as its tooltip, when this connection's Provider does
             not support analyze mode. Title Case to match "Analyze with AI"/
             "Save as Notebook" below. -->
        <VsCodeButton
          appearance="secondary"
          :disabled="isRunningActualPlan || !analyzedExecutionPlan.available || !statementAllowsActualPlan"
          :title="actualPlanButtonTitle"
          @click="runActualPlan"
        >
          <fa icon="circle-play" />{{ isRunningActualPlan ? "Running…" : "Run Explain Analyze" }}
        </VsCodeButton>
        <VsCodeButton :disabled="isAnalyzing" title="Analyze this context with AI" @click="analyzeWithAi">
          <fa icon="wand-magic-sparkles" />{{ isAnalyzing ? "Analyzing…" : "Analyze with AI" }}
        </VsCodeButton>
        <!-- "Copy Prompt for Other AI" (2026-08-21 follow-up) - for a user
             whose vscode.lm-exposed models are too limited (this extension
             only queries `vendor: "copilot"`, so this is only ever whatever
             models Copilot itself exposes) but who already has a ChatGPT/
             Claude.ai/Claude Code/Codex subscription they'd rather paste
             into directly. Copies the same domain-guided prompt as "Analyze
             with AI", just asking for a plain-text answer instead of JSON
             (see performanceTuningAiPrompt.ts's buildPlainTextAnalysisPrompt()) -
             no vscode.lm call happens for this button. -->
        <CopyToClipboardButton appearance="secondary" :content="copyPromptForOtherAi"
          title="Copy a prompt for pasting into another AI chat (ChatGPT, Claude.ai, Claude Code, Codex, ...)">
          <fa icon="comment-dots" />Copy Prompt for Other AI
        </CopyToClipboardButton>
        <VsCodeButton appearance="secondary" :disabled="analysis.status !== 'success'" title="Save the AI analysis as a new Notebook under reports/performance-tuning/"
          @click="saveAiAnalysisAsNotebook">
          <fa icon="book" />Save as Notebook
        </VsCodeButton>
      </template>
    </PanelActionToolbar>

    <!-- First layer of the "Run Explain Analyze" two-layer confirmation
         (2026-08-20 follow-up) - a persistent, always-visible warning next
         to the button, so the risk is visible *before* a user ever clicks
         it. The second layer (a blocking modal) is host-side, on click -
         see PerformanceTuningPreviewPanel.ts's runActualPlan(). Hidden once
         a run has already succeeded for this context (actualPlan
         present) - at that point the risk already materialized and is
         redundant with the actual plan shown below. -->
    <p v-if="!statementAllowsActualPlan" class="section-note">
      This {{ context.statement.kind ?? "non-SELECT" }} statement uses an estimated plan only. Actual runtime metrics are not collected here.
    </p>
    <p v-else-if="analyzedExecutionPlan.available && !context.executionPlan.actualPlan" class="section-note actual-plan-warning">
      <fa icon="triangle-exclamation" />
      "Run Explain Analyze" executes the SQL above for real against the database, instead of only
      estimating its plan.
    </p>

    <!-- 1. Database / Status / Payload size (§6.1) -->
    <div class="header">
      <!-- Analyze with AI's model/translation options (2026-08-19 follow-up) -
           always visible (not gated on analysis.status), since the choice
           has to be made before clicking the button in the toolbar above. -->
      <div class="row ai-options">
        <span class="label">AI options</span>
        <label for="languageModelId" class="label-inline">Language model</label>
        <VsCodeDropdown id="languageModelId" :items="languageModels" v-model="languageModelId"
          :disabled="isAnalyzing || languageModels.length === 0" style="width: 220px" />
        <VsCodeCheckbox v-model="translateResponse" :disabled="isAnalyzing">Translate response</VsCodeCheckbox>
      </div>
      <div class="row">
        <span class="label">Database</span>
        <span>{{ context.database.vendor }}{{ context.database.version ? ` ${context.database.version}` : "" }} ・
          {{ context.database.databaseName }}<span v-if="context.database.schemaName">.{{ context.database.schemaName }}</span></span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="badge" :class="context.collection.status">{{ context.collection.status }}</span>
        <!-- complete badge stays green even with informational notes present
             (§6.4) - this is a supplementary count, not a new status value. -->
        <span v-if="context.collection.status === 'complete' && infoGroups.length > 0" class="notes-hint">
          {{ infoGroups.length }} {{ infoGroups.length === 1 ? "note" : "notes" }}
        </span>
      </div>
      <div class="row">
        <span class="label">Payload size</span>
        <span :class="{ exceeded: payloadExceeded }">
          {{ payloadBytes.toLocaleString() }} / {{ maxPayloadBytes.toLocaleString() }} bytes
          <span v-if="payloadExceeded">(exceeds limit)</span>
        </span>
      </div>

      <!-- 2. SQL (§6.1) -->
      <div class="row sql">
        <span class="label">SQL</span>
        <div class="code-panel">
          <div class="sql-block" v-html="sqlHtml"></div>
          <CopyToClipboardButton class="copy-btn" :content="context.statement.sql" title="Copy SQL" />
        </div>
      </div>
    </div>

    <div class="scrollArea">
      <div v-if="humanSummary" class="section performance-snapshot-section">
        <h3 class="section-title">Performance snapshot</h3>
        <PerformanceTuningSnapshot :summary="humanSummary" />
        <p v-if="queryDiagramAvailable" class="section-note query-diagram-notice">
          A query-scoped ER diagram will be included when you save this analysis as a Notebook; view it in the saved DBN or HTML report.<span v-if="queryDiagramHasWarnings"> Some relationships could not be resolved conservatively; the saved Notebook includes the details.</span>
        </p>
      </div>

      <!-- 0. AI Analysis (Step 10, design doc §6.1). Always rendered, even at
           idle (2026-08-20 follow-up): a first-time user had no on-screen
           indication of *where* the result would show up until after
           clicking "Analyze with AI" - this idle-state hint gives that area
           a visible home from the start, doubling as a hint for the
           SQL/Information-first, Analyze-with-AI-second workflow. -->
      <div class="section ai-analysis">
        <div class="section-title-row">
          <h3 class="section-title">AI Analysis</h3>
          <CopyToClipboardButton v-if="analysisJson" class="copy-analysis-btn" :content="analysisJson" title="Copy AI analysis JSON" />
        </div>

        <p v-if="analysis.status === 'idle'" class="section-note">
          Review the SQL and details above, then click "Analyze with AI" to see the analysis results here.
        </p>

        <p v-else-if="analysis.status === 'running'" class="analysis-status">Analyzing with AI…</p>

        <div v-else-if="analysis.status === 'error'" class="analysis-error">
          <p>{{ analysis.errorMessage }}</p>
          <details v-if="analysis.rawResponseText" class="advanced-details">
            <summary>Raw AI response</summary>
            <pre class="raw-response">{{ analysis.rawResponseText }}</pre>
          </details>
        </div>

        <div v-else-if="analysis.status === 'success' && analysis.result">
          <p class="section-note">AI input: {{ analysis.result.request?.contextDetail === "compact" ? "Compact (raw vendor artifacts omitted for model limit)" : "Full" }}</p>
          <p class="analysis-summary">{{ analysis.result.summary }}</p>

          <div v-if="analysis.result.findings.length > 0" class="analysis-subsection">
            <h4>Findings</h4>
            <div
              v-for="(f, i) in analysis.result.findings"
              :key="`finding-${i}`"
              class="ai-card"
              :class="f.severity"
            >
              <p class="ai-card-title">{{ f.title }}</p>
              <p class="ai-card-detail">{{ f.detail }}</p>
              <p v-if="evidenceLabel(f.evidence)" class="ai-card-evidence">{{ evidenceLabel(f.evidence) }}</p>
            </div>
          </div>

          <div v-if="analysis.result.recommendations.length > 0" class="analysis-subsection">
            <h4>Recommendations</h4>
            <div
              v-for="(r, i) in analysis.result.recommendations"
              :key="`recommendation-${i}`"
              class="ai-card"
              :class="r.riskLevel ? `risk-${r.riskLevel}` : ''"
            >
              <p class="ai-card-title">{{ r.title }}</p>
              <p class="ai-card-detail">{{ r.detail }}</p>
              <p class="ai-card-rationale"><span class="label-inline">Rationale:</span> {{ r.rationale }}</p>
              <pre v-if="r.suggestedSql" class="ai-card-sql">{{ r.suggestedSql }}</pre>
              <!-- possibleDuplicateOfIndex (2026-08-21 follow-up) is
                   host-computed, never AI-authored - see
                   PerformanceTuningAiRecommendation's own doc comment. -->
              <p v-if="r.possibleDuplicateOfIndex" class="ai-card-duplicate-warning">
                <fa icon="triangle-exclamation" />
                Possible duplicate of existing index "{{ r.possibleDuplicateOfIndex }}" - verify before running.
              </p>
              <p v-if="evidenceLabel(r.evidence)" class="ai-card-evidence">{{ evidenceLabel(r.evidence) }}</p>
            </div>
          </div>

          <p class="analysis-note">
            Recommendations are AI-generated suggestions based on this one context snapshot. They are not applied
            automatically - review and run them yourself.
          </p>

          <div class="row">
            <span class="label">Confidence</span>
            <span class="badge" :class="`confidence-${analysis.result.confidence}`">{{ analysis.result.confidence }}</span>
          </div>

          <div v-if="analysis.result.missingContext.length > 0" class="analysis-subsection">
            <h4>Missing context</h4>
            <ul>
              <li v-for="(m, i) in analysis.result.missingContext" :key="`missing-${i}`">{{ m }}</li>
            </ul>
          </div>

          <p v-if="analysis.savedNotebookRelativePath" class="saved-hint">
            Saved to {{ analysis.savedNotebookRelativePath }}
          </p>
        </div>
      </div>

      <!-- 3. Collection issues: warning-severity diagnostics + unavailable
           sections, already merged into one list extension-side (§6.1/§6.3). -->
      <div v-if="issueGroups.length > 0" class="section">
        <h3 class="section-title">Collection issues</h3>
        <DiagnosticGroupCard v-for="g in issueGroups" :key="g.key" :group="g" />
      </div>

      <!-- 4. Information / plan notes: informational, never warning-colored
           (§6.1/§6.2). Shared framing sentence shown once here rather than
           repeated inside every group's own summary (2026-08-20 follow-up:
           several PLAN_OBSERVATION groups - one per distinct plan
           characteristic - used to each carry the identical explanatory
           sentence, stacking into a lot of repeated vertical space when a
           plan had several different characteristics; see
           performanceTuningDiagnosticFormatter.ts's PLAN_OBSERVATION case for
           the shortened per-group summary this replaces). -->
      <div v-if="infoGroups.length > 0" class="section">
        <h3 class="section-title">Information</h3>
        <p class="section-note">
          The items below describe execution-plan characteristics. On their own, they don't indicate a confirmed
          performance problem — see each item's technical details.
        </p>
        <DiagnosticGroupCard v-for="g in infoGroups" :key="g.key" :group="g" />
      </div>

      <!-- 5. Execution plan (2026-08-19 follow-up): normalizedPlan is a
           tree, so it's rendered as an EXPLAIN-style indented text block
           rather than a table (a table would lose the parent-child
           structure); planTableMappings is a genuinely flat per-table array,
           so that one is a small table. Both come pre-formatted from
           performanceTuningPlanFormatter.ts - this component only renders. -->
      <div v-if="planTreeText || planTableMappingRows.length > 0" class="section">
        <h3 class="section-title">
          Execution plan
          <span v-if="context.executionPlan.mode === 'analyze'" class="badge analyzed-badge">analyzed</span>
        </h3>
        <p v-if="context.executionPlan.executionTimeMs !== undefined" class="section-note">
          Real execution time: {{ context.executionPlan.executionTimeMs }} ms
        </p>
        <p v-if="context.executionPlan.actualPlan" class="section-note">
          Runtime evidence from {{ context.executionPlan.actualPlan.source }} is shown first. The estimated
          topology is retained below only for structured table/predicate metadata and comparison.
        </p>
        <p v-else class="section-note">
          {{ isDmlEstimate ? "DML statement — estimated plan only; runtime measurements are not collected." : "Estimated plan only — the SQL has not been executed for runtime measurements." }}
        </p>
        <div v-if="context.executionPlan.actualPlan" class="actual-plan-text-block">
          <h4>Actual execution plan ({{ context.executionPlan.actualPlan.source }})</h4>
          <pre class="plan-tree">{{ actualPlanDisplayText ?? context.executionPlan.actualPlan.content }}</pre>
        </div>
        <details v-if="planTreeText" class="advanced-details" :open="!context.executionPlan.actualPlan">
          <summary>{{ context.executionPlan.actualPlan ? "Estimated plan topology" : "Execution plan topology" }}</summary>
          <pre class="plan-tree">{{ planTreeText }}</pre>
        </details>
        <table v-if="planTableMappingRows.length > 0" class="plan-table-mappings">
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
            <tr v-for="(row, i) in planTableMappingRows" :key="`plan-table-${i}`">
              <td>{{ row.table }}</td>
              <td>{{ row.index ?? "-" }}</td>
              <td>{{ row.estimatedRows ?? "-" }}</td>
              <td>{{ formatActualRows(row.actualRows) }}</td>
              <td>{{ formatRuntimeMetric(row.rowEstimateRatio, formatRatio) }}</td>
              <td>{{ formatRuntimeMetric(row.tableAccessFraction, formatFractionAsPercent) }}</td>
              <td>{{ formatRuntimeMetric(row.predicateFilterSelectivity, formatFractionAsPercent) }}</td>
              <td>{{ row.columnsUsed ?? "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 6. Full context JSON, as "Advanced details" - collapsed by default
           (§6.5). -->
      <details class="section advanced-details">
        <summary class="section-title">Advanced details: Full context JSON</summary>
        <p class="advanced-note">
          This preview includes SQL, table definitions, and predicates exactly as collected. Review the content
          before sending it to an AI service.
        </p>
        <div class="code-panel json-panel">
          <div class="json-block" v-html="jsonHtml"></div>
          <CopyToClipboardButton class="copy-btn" :content="contextJson" title="Copy JSON" />
        </div>
      </details>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.PerformanceTuningPreviewPanel {
  /* Missing width:100% (every sibling panel root - ViewConditionPanel.vue's
     .view-conditional-root, ToolsView.vue's .root - sets this) meant this
     <section> shrank to its content's intrinsic width instead of filling
     the editor pane, which is also why the toolbar's Close button landed far
     short of the true right edge (nothing for `.tool-left{flex-grow:1}` to
     push against). */
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 8px 12px;
  box-sizing: border-box;
  overflow: hidden;

  .header {
    flex: 0 0 auto;

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

      /* `align-items: baseline` (the .row default) aligns by text baseline,
         which looks fine for plain text rows but goes ragged once the row
         mixes a <label>, a <vscode-dropdown>, and a <vscode-checkbox> - each
         of those custom elements has its own internal shadow-DOM baseline,
         so they don't land on a shared line. Vertically centering the row
         instead is the standard fix for a row of mixed form controls. */
      &.ai-options {
        align-items: center;
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
  }

  /* Wraps a code block + its floating copy button. `position: relative`
     makes it the positioning root for `.copy-btn` - same pattern RDH.vue
     already uses for its per-cell copy button (`td.vcell { position:
     relative }` + `.cell-actions { position: absolute }`), rather than
     putting the button as a flex sibling of the code block: a flex sibling
     only stays visible if the code block correctly shrinks to the row's
     available width, and an unbroken long SQL/JSON line can blow that
     sizing up (the block ends up sized to its content instead of the
     container, pushing the button off-screen). Taking the button out of
     flow avoids depending on that. `min-width: 0`/`min-height: 0` on the
     flex item itself is still needed so it can actually shrink within the
     row/column instead of growing to fit its (potentially very wide/tall)
     content. */
  .code-panel {
    position: relative;
  }

  /* createCodeHtmlString() (Prism, extension-side) renders
     <pre class="code-highlight"><code>...</code></pre> - v-html content
     bypasses Vue's `scoped` attribute, so these rules target it via
     :deep(). Colors/background/padding already come from the global
     .code-highlight rules in assets/scss/main.scss; only wrapping/sizing
     is overridden here. The extra right padding keeps code text from
     running under the floating copy button. */
  .sql-block :deep(pre.code-highlight),
  .json-block :deep(pre.code-highlight) {
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

    &.complete {
      background: var(--vscode-testing-iconPassed, #2e7d32);
      color: white;
    }

    &.partial {
      background: var(--vscode-editorWarning-foreground, #ff9800);
      color: black;
    }

    &.confidence-high {
      background: var(--vscode-testing-iconPassed, #2e7d32);
      color: white;
    }

    &.confidence-medium {
      background: var(--vscode-editorWarning-foreground, #ff9800);
      color: black;
    }

    &.confidence-low {
      background: var(--vscode-errorForeground, #f44336);
      color: white;
    }

    &.analyzed-badge {
      background: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
      color: white;
      font-weight: normal;
      margin-left: 6px;
    }
  }

  .notes-hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }

  /* "Run EXPLAIN ANALYZE" first-layer warning (2026-08-20 follow-up) - sits
     right under the toolbar, so the risk is visible before the button is
     ever clicked, not just in its tooltip. */
  .actual-plan-warning {
    color: var(--vscode-editorWarning-foreground, #ff9800);
    font-size: 0.85em;
    margin: 2px 0 6px 0;
  }

  .exceeded {
    color: var(--vscode-errorForeground);
    font-weight: 600;
  }

  /* The scrollable body between the fixed header and footer - Collection
     issues / Information / Advanced details can all be long, so only this
     area scrolls, keeping Database/Status/SQL always visible. */
  .scrollArea {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-top: 4px;

    .section {
      margin-bottom: 12px;
    }

    .section-title {
      font-size: 1em;
      margin: 0 0 4px 0;
    }

    .advanced-details > .section-title {
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
    }

    .advanced-note {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 4px 0 8px 0;
    }

    .section-note {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 0 0 8px 0;
    }

    .json-panel {
      min-height: 200px;
      max-height: 60vh;
      overflow: hidden;
      border-radius: 3px;
    }

    .json-block {
      height: 100%;
      max-height: 60vh;
      overflow: auto;

      :deep(pre.code-highlight) {
        font-size: 0.85em;
      }
    }

    /* --- Execution plan (2026-08-19 follow-up) --- */

    .plan-tree {
      margin: 0 0 8px 0;
      padding: 6px 8px;
      max-height: 180px;
      overflow: auto;
      white-space: pre;
      font-size: 0.85em;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15));
      border-radius: 3px;
    }

    /* Same border/padding/font-size as DiagnosticGroupCard.vue's
       .technical-details table, for visual consistency between the two
       "small detail table" spots this panel now has. */
    .plan-table-mappings {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.85em;

      th,
      td {
        border: 1px solid var(--vscode-editorWidget-border, #444);
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

    /* --- AI Analysis (Step 10) --- */

    .section-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;

      .section-title {
        margin: 0;
      }
    }

    .analysis-status {
      color: var(--vscode-descriptionForeground);
    }

    .analysis-error {
      color: var(--vscode-errorForeground);
    }

    .raw-response {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.85em;
      max-height: 200px;
      overflow: auto;
    }

    .analysis-summary {
      margin: 0 0 8px 0;
    }

    .analysis-subsection {
      margin: 8px 0;

      h4 {
        margin: 0 0 4px 0;
        font-size: 0.95em;
      }
    }

    .analysis-note {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin: 4px 0 8px 0;
    }

    .ai-card {
      border-left: 3px solid var(--vscode-editorWidget-border, #444);
      padding: 4px 8px;
      margin-bottom: 6px;
      border-radius: 2px;
      background: var(--vscode-editorWidget-background, transparent);

      &.info,
      &.low {
        border-left-color: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
      }

      &.warning,
      &.risk-medium {
        border-left-color: var(--vscode-editorWarning-foreground, #ff9800);
      }

      &.critical,
      &.risk-high {
        border-left-color: var(--vscode-errorForeground, #f44336);
      }
    }

    .ai-card-title {
      font-weight: 600;
      margin: 0 0 2px 0;
    }

    .ai-card-detail,
    .ai-card-rationale {
      margin: 0 0 2px 0;
    }

    .label-inline {
      font-weight: 600;
    }

    .ai-card-sql {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.85em;
      margin: 4px 0;
      padding: 4px 6px;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15));
      border-radius: 2px;
    }

    .ai-card-duplicate-warning {
      color: var(--vscode-editorWarning-foreground, #ff9800);
      font-size: 0.85em;
      margin: 4px 0;
    }

    .ai-card-evidence {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin: 2px 0 0 0;
    }

    .saved-hint {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 8px 0 0 0;
    }
  }
}
</style>
