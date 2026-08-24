<script setup lang="ts">
// Shared shell (2026-08-24 follow-up, DynamoDB support - design doc §11.3's
// 3-component split). Owns the toolbar, AI options, AI Analysis, Collection
// issues/Information (both already-engine-agnostic view models), and Full
// context JSON - see RelationalPerformanceTuningView.vue's top comment for
// why each per-engine child is mounted twice (part="header"/"body") rather
// than owning a `<section>` of its own.
import type {
  DynamoDbPerformanceTuningInitializeViewModel,
  LabelValueItem,
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningPreviewPanelEventData,
  RelationalPerformanceTuningInitializeViewModel,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { computed, ref } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import DiagnosticGroupCard from "./base/DiagnosticGroupCard.vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import DynamoDbPerformanceTuningView from "./DynamoDbPerformanceTuningView.vue";
import RelationalPerformanceTuningView from "./RelationalPerformanceTuningView.vue";

const relational = ref<RelationalPerformanceTuningInitializeViewModel | undefined>(undefined);
const dynamodb = ref<DynamoDbPerformanceTuningInitializeViewModel | undefined>(undefined);
const engine = computed(() => (relational.value ? "relational" : dynamodb.value ? "dynamodb" : undefined));
// Whichever of the two is currently set. Only the shell-owned fields shared
// by both (PerformanceTuningPreviewShellFields in MessageEventData.ts:
// jsonHtml/plainTextPrompt/.../languageModels/...) are ever read through
// this union; every per-engine field is read from relational/dynamodb
// directly instead (see the child component invocations below).
const active = computed(() => relational.value ?? dynamodb.value);

const diagnosticGroups = computed(() => active.value?.diagnosticGroups ?? []);
// buildPerformanceTuningDiagnosticGroups()/buildDynamoDbPerformanceTuningDiagnosticGroups()
// (extension-side) already sort information before warnings and never mix
// severities within one group - this just splits that single ordered list
// into the two display sections. Neither list is re-sorted or re-derived here.
const infoGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "info"));
const issueGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "warning"));

const contextJson = computed(() => (active.value ? JSON.stringify(active.value.context, null, 2) : ""));
// Payload-size display (with its own exceeded check) now lives in each
// engine's own header row - see Relational/DynamoDbPerformanceTuningView.vue -
// so the shell itself has no more use for that computation.

// AI options are available as soon as a context is loaded.
const languageModels = ref<LabelValueItem[]>([]);
const languageModelId = ref("");
const translateResponse = ref(false);
// "Copy Prompt for Other AI" (2026-08-21 follow-up) - see
// MessageEventData.ts's own doc comment on this field.
const plainTextPrompt = ref("");
const translatedPlainTextPrompt = ref("");
const copyPromptForOtherAi = computed(() =>
  translateResponse.value ? translatedPlainTextPrompt.value : plainTextPrompt.value
);

// A fresh context invalidates the previous analysis.
const analysis = ref<PerformanceTuningAiAnalysisViewState>({ status: "idle" });
const isAnalyzing = computed(() => analysis.value.status === "running");
const analysisJson = computed(() =>
  analysis.value.result ? JSON.stringify(analysis.value.result, null, 2) : ""
);

// "Run Explain Analyze" (RDB) / "Run Observed Read" (DynamoDB) - one shared
// running flag + host round trip, since the two are mutually exclusive per
// engine (only one of the two buttons below is ever shown) and behave
// identically from the shell's perspective: optimistic true on click, reset
// by "stop-progress" or a fresh "initialize" (a successful run always
// replaces the whole panel via the latter, never a "success" branch of its
// own here).
const isRunningSecondaryAction = ref(false);

const statementAllowsActualPlan = computed(
  () => relational.value?.context.statement.analyzeEligibility?.allowed ?? true
);
const actualPlanButtonTitle = computed(() => {
  if (!statementAllowsActualPlan.value) {
    return relational.value?.context.statement.analyzeEligibility?.reason ??
      "Explain Analyze is limited to a single SELECT statement.";
  }
  return relational.value?.analyzedExecutionPlan.available
    ? "Run this SQL for real to measure its actual execution plan (real query execution - see the note below)"
    : (relational.value?.analyzedExecutionPlan.message ?? "Not available for this database");
});

const observationEligibility = computed(() => dynamodb.value?.context.statement.observationEligibility);
const observedReadButtonTitle = computed(() => {
  if (observationEligibility.value?.allowed === false) {
    return observationEligibility.value.reason ?? "This statement is not eligible for Run Observed Read.";
  }
  return dynamodb.value?.observedReadCapability.available
    ? "Read real items to measure this statement's actual Consumed Capacity and result shape (real query execution - see the note below)"
    : (dynamodb.value?.observedReadCapability.message ?? "Not available for this connection");
});

const initialize = (v: PerformanceTuningPreviewPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  if (v.engine === "relational") {
    relational.value = v;
    dynamodb.value = undefined;
  } else {
    dynamodb.value = v;
    relational.value = undefined;
  }
  languageModels.value = v.languageModels;
  languageModelId.value = v.languageModelId;
  translateResponse.value = v.translateResponse;
  plainTextPrompt.value = v.plainTextPrompt;
  translatedPlainTextPrompt.value = v.translatedPlainTextPrompt;
  analysis.value = { status: "idle" };
  isRunningSecondaryAction.value = false;
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
      // "Run Explain Analyze"/"Run Observed Read" cancelled or failed - a
      // successful run instead arrives as a fresh "initialize" above, which
      // already resets this itself. The failure/cancellation reason (if
      // any) was already shown as a native VS Code notification,
      // extension-side.
      isRunningSecondaryAction.value = false;
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

// The confirmation itself is entirely host-side (a modal
// window.showWarningMessage - see PerformanceTuningPreviewPanel.ts's
// runActualPlan()/runObservedRead()); these only set the optimistic
// "running" state so the button disables itself immediately -
// stop-progress above resets it again if the user declines that modal or
// the run fails.
const runActualPlan = (): void => {
  isRunningSecondaryAction.value = true;
  vscode.postCommand({
    command: "runActualPlan",
    params: {},
  });
};

const runObservedRead = (): void => {
  isRunningSecondaryAction.value = true;
  vscode.postCommand({
    command: "runObservedRead",
    params: {},
  });
};

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
  // DynamoDB counterpart (design doc §12) - DynamoDB evidence has no
  // schema/table/index/plan-node identity of its own to point at the same
  // way (PerformanceTuningAiEvidenceRef.contextPath's own doc comment).
  if (evidence.contextPath) {
    parts.push(`Context: ${evidence.contextPath}`);
  }
  return parts.join(" / ");
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="PerformanceTuningPreviewPanel" v-if="engine">
    <PanelActionToolbar @cancel="close" cancel-label="" cancel-title="Close">
      <template #left>
        <!-- "Run Explain Analyze" (RDB) / "Run Observed Read" (DynamoDB) -
             listed first since it's the button a user reaches for first
             (real evidence before asking AI to analyze it), and
             deliberately a distinct icon/label from "Analyze with AI" below
             (that one only sends the already-collected context to an AI
             model; this one executes for real). Disabled, with the
             capability/eligibility message as its tooltip, when this
             connection/statement does not support it. -->
        <VsCodeButton
          v-if="engine === 'relational'"
          appearance="secondary"
          :disabled="isRunningSecondaryAction || !relational?.analyzedExecutionPlan.available || !statementAllowsActualPlan"
          :title="actualPlanButtonTitle"
          @click="runActualPlan"
        >
          <fa icon="circle-play" />{{ isRunningSecondaryAction ? "Running…" : "Run Explain Analyze" }}
        </VsCodeButton>
        <VsCodeButton
          v-else
          appearance="secondary"
          :disabled="isRunningSecondaryAction || !dynamodb?.observedReadCapability.available || observationEligibility?.allowed === false"
          :title="observedReadButtonTitle"
          @click="runObservedRead"
        >
          <fa icon="circle-play" />{{ isRunningSecondaryAction ? "Running…" : "Run Observed Read" }}
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
             with AI", just asking for a plain-text answer instead of JSON -
             no vscode.lm call happens for this button. -->
        <CopyToClipboardButton appearance="secondary" :content="copyPromptForOtherAi"
          title="Copy a prompt for pasting into another AI chat (ChatGPT, Claude.ai, Claude Code, Codex, ...)">
          <fa icon="comment-dots" />Copy Prompt for Other AI
        </CopyToClipboardButton>
        <!-- Save as Notebook: DynamoDB analyses can't be saved yet (its own
             report cell structure is separate, not-yet-implemented work -
             design doc §13) - see PerformanceTuningPreviewPanel.ts's
             saveAnalysisAsNotebook() for the host-side half of this gate. -->
        <VsCodeButton appearance="secondary" :disabled="analysis.status !== 'success' || engine === 'dynamodb'"
          :title="engine === 'dynamodb' ? 'Not yet available for DynamoDB analyses' : 'Save the AI analysis as a new Notebook under reports/performance-tuning/'"
          @click="saveAiAnalysisAsNotebook">
          <fa icon="book" />Save as Notebook
        </VsCodeButton>
      </template>
    </PanelActionToolbar>

    <!-- First layer of the "Run Explain Analyze"/"Run Observed Read"
         two-layer confirmation - a persistent, always-visible warning next
         to the button, so the risk is visible *before* a user ever clicks
         it. The second layer (a blocking modal) is host-side, on click. -->
    <template v-if="engine === 'relational'">
      <p v-if="!statementAllowsActualPlan" class="section-note">
        This {{ relational?.context.statement.kind ?? "non-SELECT" }} statement uses an estimated plan only. Actual runtime metrics are not collected here.
      </p>
      <p v-else-if="relational?.analyzedExecutionPlan.available" class="section-note actual-plan-warning">
        <fa icon="triangle-exclamation" />
        "Run Explain Analyze" executes the SQL above for real against the database, instead of only
        estimating its plan.
      </p>
    </template>
    <template v-else>
      <p v-if="observationEligibility?.allowed === false" class="section-note">
        Run Observed Read is not available for this statement: {{ observationEligibility.reason }}
      </p>
      <p v-else-if="dynamodb?.observedReadCapability.available" class="section-note actual-plan-warning">
        <fa icon="triangle-exclamation" />
        "Run Observed Read" reads real items from the table above (a single response, up to 100 items),
        instead of only classifying the statement statically.
      </p>
    </template>

    <div class="header">
      <!-- Analyze with AI's model/translation options - always visible (not
           gated on analysis.status), since the choice has to be made before
           clicking the button in the toolbar above. -->
      <div class="row ai-options">
        <span class="label">AI options</span>
        <label for="languageModelId" class="label-inline">Language model</label>
        <VsCodeDropdown id="languageModelId" :items="languageModels" v-model="languageModelId"
          :disabled="isAnalyzing || languageModels.length === 0" style="width: 220px" />
        <VsCodeCheckbox v-model="translateResponse" :disabled="isAnalyzing">Translate response</VsCodeCheckbox>
      </div>
      <RelationalPerformanceTuningView v-if="engine === 'relational'" :data="relational!" part="header" />
      <DynamoDbPerformanceTuningView v-else :data="dynamodb!" part="header" />
    </div>

    <div class="scrollArea">
      <RelationalPerformanceTuningView v-if="engine === 'relational'" :data="relational!" part="body" />
      <DynamoDbPerformanceTuningView v-else :data="dynamodb!" part="body" />

      <!-- AI Analysis is always rendered, even at idle: a first-time user
           had no on-screen indication of *where* the result would show up
           until after clicking "Analyze with AI" - this idle-state hint
           gives that area a visible home from the start, doubling as a hint
           for the evidence-first, Analyze-with-AI-second workflow. -->
      <div class="section ai-analysis ai-analysis-section">
        <div class="section-title-row">
          <h3 class="section-title">AI Analysis</h3>
          <CopyToClipboardButton v-if="analysisJson" class="copy-analysis-btn" :content="analysisJson" title="Copy AI analysis JSON" />
        </div>

        <p v-if="analysis.status === 'idle'" class="section-note">
          Review the details above, then click "Analyze with AI" to see the analysis results here.
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
              <!-- possibleDuplicateOfIndex is host-computed, never
                   AI-authored, and RDB-only (never set for a DynamoDB
                   context - see PerformanceTuningPreviewPanel.ts's
                   analyzeWithAi()). -->
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

      <!-- Collection issues: warning-severity diagnostics + unavailable
           sections, already merged into one list extension-side, for
           whichever engine is active. -->
      <div v-if="issueGroups.length > 0" class="section collection-issues-section">
        <h3 class="section-title">Collection issues</h3>
        <DiagnosticGroupCard v-for="g in issueGroups" :key="g.key" :group="g" />
      </div>

      <!-- Information: informational, never warning-colored. Shared framing
           sentence shown once here rather than repeated inside every
           group's own summary. -->
      <div v-if="infoGroups.length > 0" class="section information-section">
        <h3 class="section-title">Information</h3>
        <p class="section-note">
          The items below describe {{ engine === "relational" ? "execution-plan" : "access-pattern/collection" }}
          characteristics. On their own, they don't indicate a confirmed performance problem — see each item's
          technical details.
        </p>
        <DiagnosticGroupCard v-for="g in infoGroups" :key="g.key" :group="g" />
      </div>

      <!-- Full context JSON, as "Advanced details" - collapsed by default. -->
      <details class="section advanced-details advanced-details-section">
        <summary class="section-title">Advanced details: Full context JSON</summary>
        <p class="advanced-note">
          This preview includes the statement/target, table definitions, and predicates exactly as collected.
          Review the content before sending it to an AI service.
        </p>
        <div class="code-panel json-panel">
          <div class="json-block" v-html="active?.jsonHtml"></div>
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

      /* `align-items: baseline` (the .row default) aligns by text baseline,
         which looks fine for plain text rows but goes ragged once the row
         mixes a <label>, a <vscode-dropdown>, and a <vscode-checkbox> - each
         of those custom elements has its own internal shadow-DOM baseline,
         so they don't land on a shared line. Vertically centering the row
         instead is the standard fix for a row of mixed form controls. */
      &.ai-options {
        display: grid;
        grid-template-columns: 110px max-content 220px max-content;
        align-items: center;

        .label {
          min-width: 0;
        }
      }
    }

    .label {
      font-weight: 600;
      min-width: 110px;
      flex: 0 0 auto;
    }
  }

  /* Wraps the Full Context JSON code block + its floating copy button - see
     RelationalPerformanceTuningView.vue's own .code-panel comment (this is
     the same pattern, just for the shell's shared JSON section instead of a
     per-engine SQL/PartiQL row). */
  .code-panel {
    position: relative;
  }

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
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);

    &.confidence-high {
      border-color: var(--vscode-testing-iconPassed);
    }

    &.confidence-medium {
      border-color: var(--vscode-editorWarning-foreground);
    }

    &.confidence-low {
      border-color: var(--vscode-errorForeground);
    }
  }

  /* "Run Explain Analyze"/"Run Observed Read" first-layer warning - sits
     right under the toolbar, so the risk is visible before the button is
     ever clicked, not just in its tooltip. */
  .actual-plan-warning {
    color: var(--vscode-editorWarning-foreground);
    font-size: 0.85em;
    margin: 2px 0 6px 0;
  }

  .label-inline {
    font-weight: 600;
  }

  /* The scrollable body between the fixed header and footer - Collection
     issues / Information / AI Analysis / Advanced details, plus each
     engine's own body sections, can all be long, so only this area scrolls,
     keeping the header always visible. */
  .scrollArea {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-top: 4px;
    display: flex;
    flex-direction: column;

    /* Keep the visible reading order aligned with the saved DBN report -
       see RelationalPerformanceTuningView.vue's/DynamoDbPerformanceTuningView.vue's
       own <style> for their sections' order values (1 and 4-7 respectively;
       only one of the two is ever mounted at a time, so their numbering
       never has to avoid colliding with each other, only with these). */
    .collection-issues-section { order: 2; }
    .information-section { order: 3; }
    .ai-analysis-section { order: 8; }
    .advanced-details-section { order: 9; }

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

    /* --- AI Analysis --- */

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
      border-left: 3px solid var(--vscode-editorWidget-border);
      padding: 4px 8px;
      margin-bottom: 6px;
      border-radius: 2px;
      background: var(--vscode-editorWidget-background);

      &.info,
      &.low {
        border-left-color: var(--vscode-notificationsInfoIcon-foreground);
      }

      &.warning,
      &.risk-medium {
        border-left-color: var(--vscode-editorWarning-foreground);
      }

      &.critical,
      &.risk-high {
        border-left-color: var(--vscode-errorForeground);
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

    .ai-card-sql {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.85em;
      margin: 4px 0;
      padding: 4px 6px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 2px;
    }

    .ai-card-duplicate-warning {
      color: var(--vscode-editorWarning-foreground);
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
