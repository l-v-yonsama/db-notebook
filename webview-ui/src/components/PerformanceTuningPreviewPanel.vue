<script setup lang="ts">
import type {
  LabelValueItem,
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningDiagnosticGroupViewModel,
  PerformanceTuningPreviewPanelEventData,
  PlanTableMappingRowViewModel,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, ref } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import DiagnosticGroupCard from "./base/DiagnosticGroupCard.vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";

const context = ref<PerformanceTuningContext | undefined>(undefined);
const diagnosticGroups = ref<PerformanceTuningDiagnosticGroupViewModel[]>([]);
const planTreeText = ref<string | undefined>(undefined);
const planTableMappingRows = ref<PlanTableMappingRowViewModel[]>([]);
const sqlHtml = ref("");
const jsonHtml = ref("");
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

// Only used for the "Copy JSON" button (needs plain text, not the
// highlighted HTML) - kept in sync with what the extension side rendered
// into jsonHtml since both stringify the same context with the same args.
const contextJson = computed(() => (context.value ? JSON.stringify(context.value, null, 2) : ""));

const payloadExceeded = computed(
  () => maxPayloadBytes.value > 0 && payloadBytes.value > maxPayloadBytes.value
);

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
  planTableMappingRows.value = v.planTableMappingRows;
  sqlHtml.value = v.sqlHtml;
  jsonHtml.value = v.jsonHtml;
  payloadBytes.value = v.payloadBytes;
  maxPayloadBytes.value = v.maxPayloadBytes;
  languageModels.value = v.languageModels;
  languageModelId.value = v.languageModelId;
  translateResponse.value = v.translateResponse;
  analysis.value = { status: "idle" };
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
        <VsCodeButton :disabled="isAnalyzing" title="Analyze this context with AI" @click="analyzeWithAi">
          <fa icon="wand-magic-sparkles" />{{ isAnalyzing ? "Analyzing…" : "Analyze with AI" }}
        </VsCodeButton>
        <VsCodeButton appearance="secondary" :disabled="analysis.status !== 'success'" title="Save the AI analysis as a new Notebook under reports/performance-tuning/"
          @click="saveAiAnalysisAsNotebook">
          <fa icon="book" />Save as Notebook
        </VsCodeButton>
      </template>
    </PanelActionToolbar>

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
      <!-- 0. AI Analysis (Step 10, design doc §6.1) -->
      <div class="section ai-analysis" v-if="analysis.status !== 'idle'">
        <div class="section-title-row">
          <h3 class="section-title">AI Analysis</h3>
          <CopyToClipboardButton v-if="analysisJson" class="copy-analysis-btn" :content="analysisJson" title="Copy AI analysis JSON" />
        </div>

        <p v-if="analysis.status === 'running'" class="analysis-status">Analyzing with AI…</p>

        <div v-else-if="analysis.status === 'error'" class="analysis-error">
          <p>{{ analysis.errorMessage }}</p>
          <details v-if="analysis.rawResponseText" class="advanced-details">
            <summary>Raw AI response</summary>
            <pre class="raw-response">{{ analysis.rawResponseText }}</pre>
          </details>
        </div>

        <div v-else-if="analysis.status === 'success' && analysis.result">
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
           (§6.1/§6.2). -->
      <div v-if="infoGroups.length > 0" class="section">
        <h3 class="section-title">Information</h3>
        <DiagnosticGroupCard v-for="g in infoGroups" :key="g.key" :group="g" />
      </div>

      <!-- 5. Execution plan (2026-08-19 follow-up): normalizedPlan is a
           tree, so it's rendered as an EXPLAIN-style indented text block
           rather than a table (a table would lose the parent-child
           structure); planTableMappings is a genuinely flat per-table array,
           so that one is a small table. Both come pre-formatted from
           performanceTuningPlanFormatter.ts - this component only renders. -->
      <div v-if="planTreeText || planTableMappingRows.length > 0" class="section">
        <h3 class="section-title">Execution plan</h3>
        <pre v-if="planTreeText" class="plan-tree">{{ planTreeText }}</pre>
        <table v-if="planTableMappingRows.length > 0" class="plan-table-mappings">
          <thead>
            <tr>
              <th>Table</th>
              <th>Index</th>
              <th>Est. rows</th>
              <th>Columns used</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in planTableMappingRows" :key="`plan-table-${i}`">
              <td>{{ row.table }}</td>
              <td>{{ row.index ?? "-" }}</td>
              <td>{{ row.estimatedRows ?? "-" }}</td>
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
  }

  .notes-hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
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
      max-height: 300px;
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
