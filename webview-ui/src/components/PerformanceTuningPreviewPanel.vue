<script setup lang="ts">
// Shared toolbar, diagnostics, comparison, AI analysis, and raw-context shell.
import type {
  DynamoDbPerformanceTuningInitializeViewModel,
  LabelValueItem,
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningComparisonViewState,
  PerformanceTuningPreviewPanelEventData,
  RelationalPerformanceTuningInitializeViewModel,
} from "@/utilities/vscode";
import { formatUtcWithLocal, vscode } from "@/utilities/vscode";
import { buildDynamoDbObservedReadNotice } from "@/utilities/dynamoDbObservedReadNotice";
import { computed, ref } from "vue";
import type { SecondaryItem } from "@/types/Components";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import DiagnosticGroupCard from "./base/DiagnosticGroupCard.vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import DynamoDbPerformanceTuningView from "./DynamoDbPerformanceTuningView.vue";
import PerformanceTuningComparisonView from "./PerformanceTuningComparisonView.vue";
import RelationalPerformanceTuningView from "./RelationalPerformanceTuningView.vue";

const relational = ref<RelationalPerformanceTuningInitializeViewModel | undefined>(undefined);
const dynamodb = ref<DynamoDbPerformanceTuningInitializeViewModel | undefined>(undefined);
const engine = computed(() =>
  relational.value ? "relational" : dynamodb.value ? "dynamodb" : undefined
);
const benchmark = computed(
  () => relational.value?.context.benchmark ?? dynamodb.value?.context.benchmark
);
const benchmarkCompleteness = computed(() => {
  const session = dynamodb.value?.context.benchmark;
  if (!session) return undefined;
  if (session.completeness) return session.completeness;
  const values = [...new Set(session.samples.map((sample) => sample.completeness))];
  return values.length === 1 ? values[0] : "mixed";
});
const benchmarkIsComplete = computed(() => benchmarkCompleteness.value === "complete");
const benchmarkBoundDescription = computed(
  () => dynamodb.value?.context.benchmark?.boundDescription
);
const formatMs = (value: number): string => `${Number(value.toFixed(2)).toLocaleString()} ms`;
// Shared shell fields from whichever engine is active.
const active = computed(() => relational.value ?? dynamodb.value);

const diagnosticGroups = computed(() => active.value?.diagnosticGroups ?? []);
// Host-side formatters already group and sort diagnostics by severity.
const infoGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "info"));
const issueGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "warning"));

const contextJson = computed(() =>
  active.value ? JSON.stringify(active.value.context, null, 2) : ""
);

// AI options are available as soon as a context is loaded.
const languageModels = ref<LabelValueItem[]>([]);
const languageModelId = ref("");
const translateResponse = ref(false);
const plainTextPrompt = ref("");
const translatedPlainTextPrompt = ref("");
const copyPromptForOtherAi = computed(() =>
  translateResponse.value ? translatedPlainTextPrompt.value : plainTextPrompt.value
);

// Comparison state is host-owned and arrives fully derived.
const comparison = ref<PerformanceTuningComparisonViewState>({ status: "idle" });

// A fresh context invalidates the previous analysis.
const analysis = ref<PerformanceTuningAiAnalysisViewState>({ status: "idle" });
const isAnalyzing = computed(() => analysis.value.status === "running");
const analysisJson = computed(() =>
  analysis.value.result ? JSON.stringify(analysis.value.result, null, 2) : ""
);
const isRunningSecondaryAction = ref(false);
const tokenUsage = computed(
  () => analysis.value.result?.request?.tokenUsage ?? analysis.value.tokenUsage
);
const tokenUsagePercentage = computed(() => {
  const usage = tokenUsage.value;
  return usage && usage.maxInputTokens > 0
    ? (usage.inputTokens / usage.maxInputTokens) * 100
    : undefined;
});
const estimatedTokenUsage = computed(() => {
  const usage = tokenUsage.value;
  if (!usage) {
    return undefined;
  }
  const percentage =
    tokenUsagePercentage.value !== undefined ? tokenUsagePercentage.value.toFixed(1) : "-";
  return `${usage.inputTokens.toLocaleString()} / ${usage.maxInputTokens.toLocaleString()} tokens (${percentage}%)`;
});
const tokenUsageNearLimit = computed(
  () => tokenUsagePercentage.value !== undefined && tokenUsagePercentage.value >= 80
);
const tokenUsageTitle = computed(() =>
  tokenUsage.value
    ? `A ${tokenUsage.value.safetyMargin.toLocaleString()}-token safety margin is reserved for provider-side message framing.`
    : undefined
);
const aiInputDetail = computed(() => {
  const contextDetail =
    analysis.value.result?.request?.contextDetail ?? analysis.value.contextDetail;
  const comparisonDetail =
    analysis.value.result?.request?.comparison?.detail ?? analysis.value.comparisonDetail;
  const contextReduced = contextDetail === "compact";
  const comparisonReduced = comparisonDetail !== undefined && comparisonDetail !== "full";
  if (contextReduced && comparisonReduced) {
    return "Context and comparison reduced to fit this model";
  }
  if (contextReduced) {
    return "Context reduced to fit this model";
  }
  if (comparisonReduced) {
    return "Comparison reduced to fit this model";
  }
  return contextDetail === "full" ? "Full context included" : undefined;
});

// The collected context is useful evidence by itself. AI analysis and a
// baseline comparison enrich the report, but neither is a prerequisite.
// Avoid saving while an AI/benchmark refresh is in flight so the user never
// gets an ambiguous snapshot of the preceding state.
const canSaveNotebook = computed(
  () => Boolean(active.value) && !isAnalyzing.value && !isRunningSecondaryAction.value
);
const saveNotebookTitle = computed(() => {
  if (isAnalyzing.value || isRunningSecondaryAction.value) {
    return "Wait for the current analysis or measurement to finish before saving";
  }
  if (comparison.value.status === "ready") {
    if (analysis.value.status === "success" && !comparison.value.analysisStale) {
      return "Save the AI analysis and baseline comparison as a new Notebook under reports/performance-tuning/";
    }
    return "Save the baseline comparison as a new Notebook under reports/performance-tuning/";
  }
  if (analysis.value.status === "success" && !comparison.value.analysisStale) {
    return "Save the AI analysis as a new Notebook under reports/performance-tuning/";
  }
  return "Save the collected performance evidence as a new Notebook under reports/performance-tuning/";
});

// "Run Explain Analyze" (RDB) / "Run Observed Read" (DynamoDB) - one shared
// running flag + host round trip, since the two are mutually exclusive per
// engine (only one of the two buttons below is ever shown) and behave
// identically from the shell's perspective: optimistic true on click, reset
// by "stop-progress" or a fresh "initialize" (a successful run always
// replaces the whole panel via the latter, never a "success" branch of its
// own here).
const statementAllowsActualPlan = computed(
  () => relational.value?.context.statement.analyzeEligibility?.allowed ?? true
);
const actualPlanButtonTitle = computed(() => {
  if (!statementAllowsActualPlan.value) {
    return (
      relational.value?.context.statement.analyzeEligibility?.reason ??
      "Explain Analyze is limited to a single SELECT statement."
    );
  }
  return relational.value?.analyzedExecutionPlan.available
    ? "Run this SQL for real to measure its actual execution plan (real query execution - see the note below)"
    : relational.value?.analyzedExecutionPlan.message ?? "Not available for this database";
});

const observationEligibility = computed(
  () => dynamodb.value?.context.statement.observationEligibility
);
const observedReadNotice = computed(() =>
  buildDynamoDbObservedReadNotice(dynamodb.value?.context.observation)
);
const observedReadButtonTitle = computed(() => {
  if (observationEligibility.value?.allowed === false) {
    return (
      observationEligibility.value.reason ?? "This statement is not eligible for Run Observed Read."
    );
  }
  return dynamodb.value?.observedReadCapability.available
    ? dynamodb.value.context.observation
      ? "Run another real read to refresh the observed measurements (real query execution - see the note below)"
      : "Read real items to measure this statement's actual Consumed Capacity and result shape (real query execution - see the note below)"
    : dynamodb.value?.observedReadCapability.message ?? "Not available for this connection";
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
  comparison.value = v.comparison;
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
      if (value.unavailableLanguageModelId) {
        languageModels.value = languageModels.value.filter(
          (model) => model.value !== value.unavailableLanguageModelId
        );
        if (languageModelId.value === value.unavailableLanguageModelId) {
          languageModelId.value = languageModels.value[0]?.value ?? "";
        }
      }
      break;
    case "comparison-update":
      if (value.comparison) {
        comparison.value = value.comparison;
      }
      // The host rebuilds external-AI prompts with each baseline transition.
      if (value.plainTextPrompt !== undefined) {
        plainTextPrompt.value = value.plainTextPrompt;
      }
      if (value.translatedPlainTextPrompt !== undefined) {
        translatedPlainTextPrompt.value = value.translatedPlainTextPrompt;
      }
      break;
    case "stop-progress":
      // Successful runs reset through initialize; failures are shown by the host.
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

// Confirmation is host-side; optimistic state disables the action immediately.
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

const benchmarkItems = computed<SecondaryItem[]>(() =>
  engine.value === "dynamodb"
    ? [
        { kind: "selection", label: "Page Benchmark (3 runs)", value: { runs: 3, mode: "page" } },
        { kind: "selection", label: "Page Benchmark (5 runs)", value: { runs: 5, mode: "page" } },
        { kind: "divider" },
        {
          kind: "selection",
          label: "Complete-result Benchmark (3 runs)",
          value: { runs: 3, mode: "completeResult" },
        },
        {
          kind: "selection",
          label: "Complete-result Benchmark (5 runs)",
          value: { runs: 5, mode: "completeResult" },
        },
      ]
    : [
        { kind: "selection", label: "Benchmark (3 runs)", value: 3 },
        { kind: "selection", label: "Benchmark (5 runs)", value: 5 },
      ]
);

const runBenchmark = (selection: unknown): void => {
  const runs =
    typeof selection === "object" && selection !== null && "runs" in selection
      ? (selection as { runs: unknown }).runs
      : selection;
  const mode =
    typeof selection === "object" && selection !== null && "mode" in selection
      ? (selection as { mode?: "page" | "completeResult" }).mode
      : undefined;
  if (runs !== 3 && runs !== 5) {
    return;
  }
  isRunningSecondaryAction.value = true;
  vscode.postCommand({
    command: "runPerformanceTuningBenchmark",
    params: { runs, mode },
  });
};

// The host owns the file picker; the webview never receives a path.
const selectBaseline = (): void => {
  vscode.postCommand({ command: "selectPerformanceTuningBaseline", params: {} });
};

const clearBaseline = (): void => {
  vscode.postCommand({ command: "clearPerformanceTuningBaseline", params: {} });
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
          :disabled="
            isRunningSecondaryAction ||
            !relational?.analyzedExecutionPlan.available ||
            !statementAllowsActualPlan
          "
          :title="actualPlanButtonTitle"
          @click="runActualPlan"
        >
          <fa icon="circle-play" />{{
            isRunningSecondaryAction ? "Running…" : "Run Explain Analyze"
          }}
        </VsCodeButton>
        <VsCodeButton
          v-else
          appearance="secondary"
          :disabled="
            isRunningSecondaryAction ||
            !dynamodb?.observedReadCapability.available ||
            observationEligibility?.allowed === false
          "
          :title="observedReadButtonTitle"
          @click="runObservedRead"
        >
          <fa icon="circle-play" />{{ isRunningSecondaryAction ? "Running…" : "Run Observed Read" }}
        </VsCodeButton>
        <SecondarySelectionAction
          title="Benchmark options"
          :items="benchmarkItems"
          :disabled="
            isRunningSecondaryAction ||
            (engine === 'relational'
              ? !relational?.analyzedExecutionPlan.available || !statementAllowsActualPlan
              : !dynamodb?.observedReadCapability.available ||
                observationEligibility?.allowed === false)
          "
          @onSelect="runBenchmark"
        />
        <VsCodeButton
          :disabled="isAnalyzing || languageModels.length === 0"
          title="Analyze this context with AI"
          @click="analyzeWithAi"
        >
          <fa icon="wand-magic-sparkles" />{{ isAnalyzing ? "Analyzing…" : "Analyze with AI" }}
        </VsCodeButton>
        <!-- Copies an equivalent plain-text prompt without invoking vscode.lm. -->
        <CopyToClipboardButton
          appearance="secondary"
          :content="copyPromptForOtherAi"
          title="Copy a prompt for pasting into another AI chat (ChatGPT, Claude.ai, Claude Code, Codex, ...)"
        >
          <fa icon="comment-dots" />Copy Prompt for Other AI
        </CopyToClipboardButton>
        <!-- The host selects the engine-specific report builder. -->
        <VsCodeButton
          appearance="secondary"
          :disabled="!canSaveNotebook"
          :title="saveNotebookTitle"
          @click="saveAiAnalysisAsNotebook"
        >
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
        This {{ relational?.context.statement.kind ?? "non-SELECT" }} statement uses an estimated
        plan only. Actual runtime metrics are not collected here.
      </p>
      <p
        v-else-if="relational?.analyzedExecutionPlan.available"
        class="section-note actual-plan-warning"
      >
        <fa icon="triangle-exclamation" />
        "Run Explain Analyze" executes the SQL above for real against the database, instead of only
        estimating its plan.
      </p>
    </template>
    <template v-else>
      <p v-if="observationEligibility?.allowed === false" class="section-note">
        Run Observed Read is not available for this statement: {{ observationEligibility.reason }}
      </p>
      <p
        v-else-if="dynamodb?.observedReadCapability.available"
        class="section-note actual-plan-warning"
      >
        <fa icon="triangle-exclamation" />
        {{ observedReadNotice }}
      </p>
    </template>

    <div class="header">
      <!-- Analyze with AI's model/translation options - always visible (not
           gated on analysis.status), since the choice has to be made before
           clicking the button in the toolbar above. -->
      <div class="row ai-options">
        <span class="label">AI options</span>
        <label for="languageModelId" class="label-inline">Language model</label>
        <VsCodeDropdown
          id="languageModelId"
          :items="languageModels"
          v-model="languageModelId"
          :disabled="isAnalyzing || languageModels.length === 0"
          style="width: 220px"
        />
        <VsCodeCheckbox v-model="translateResponse" :disabled="isAnalyzing"
          >Translate response</VsCodeCheckbox
        >
      </div>
      <RelationalPerformanceTuningView
        v-if="engine === 'relational'"
        :data="relational!"
        part="header"
      />
      <DynamoDbPerformanceTuningView v-else :data="dynamodb!" part="header" />
    </div>

    <div class="scrollArea">
      <RelationalPerformanceTuningView
        v-if="engine === 'relational'"
        :data="relational!"
        part="body"
      />
      <DynamoDbPerformanceTuningView v-else :data="dynamodb!" part="body" />

      <div v-if="benchmark" class="section benchmark-section">
        <h3 class="section-title">Benchmark</h3>
        <div
          v-if="engine === 'dynamodb' && benchmarkCompleteness"
          class="completion-banner"
          :class="benchmarkIsComplete ? 'complete' : 'incomplete'"
        >
          <span
            class="codicon"
            :class="benchmarkIsComplete ? 'codicon-pass-filled' : 'codicon-warning'"
          ></span>
          <strong>{{ benchmarkIsComplete ? "COMPLETE" : "INCOMPLETE" }}</strong>
          <span>
            {{
              benchmarkIsComplete
                ? "Every benchmark run reached the end of the result."
                : benchmarkBoundDescription ??
                  "At least one run stopped before the full result was evaluated."
            }}
          </span>
        </div>
        <p class="section-note">
          {{ benchmark.completedRuns }} ordinary measured runs; no hidden warm-up run.
          <span v-if="engine === 'relational'"
            >EXPLAIN ANALYZE was collected first and is excluded from these timings.</span
          >
          <span v-else>
            {{
              "mode" in benchmark && benchmark.mode === "completeResult"
                ? "Each sample followed continuation tokens up to the complete-result safety limits."
                : "Each sample measured one bounded API response."
            }}
          </span>
        </p>
        <p class="section-note">
          {{ formatUtcWithLocal(benchmark.startedAt) }} –
          {{ formatUtcWithLocal(benchmark.completedAt) }}
        </p>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Client elapsed</th>
              <th v-if="engine === 'dynamodb'">Returned / evaluated</th>
              <th v-if="engine === 'dynamodb'">Consumed read capacity</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sample in benchmark.samples" :key="sample.run">
              <td>{{ sample.run }}</td>
              <td>{{ formatMs(sample.clientElapsedTimeMs) }}</td>
              <td v-if="engine === 'dynamodb'">
                {{ "returnedItemCount" in sample ? sample.returnedItemCount ?? "—" : "—" }} /
                {{ "evaluatedItemCount" in sample ? sample.evaluatedItemCount ?? "—" : "—" }}
              </td>
              <td v-if="engine === 'dynamodb'">
                {{
                  "consumedCapacity" in sample
                    ? sample.consumedCapacity?.readCapacityUnits ??
                      sample.consumedCapacity?.capacityUnits ??
                      "—"
                    : "—"
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="benchmark-summary">
          Median {{ formatMs(benchmark.medianClientElapsedTimeMs) }} ・ Average
          {{ formatMs(benchmark.averageClientElapsedTimeMs) }} ・ Min / Max
          {{ formatMs(benchmark.minClientElapsedTimeMs) }} /
          {{ formatMs(benchmark.maxClientElapsedTimeMs) }}
        </p>
      </div>

      <!-- Always render the comparison entry point, including its idle state. -->
      <PerformanceTuningComparisonView
        :state="comparison"
        @select="selectBaseline"
        @clear="clearBaseline"
      />

      <!-- Keep the result area visible before the first AI request. -->
      <div class="section ai-analysis ai-analysis-section">
        <div class="section-title-row">
          <h3 class="section-title">AI Analysis</h3>
          <CopyToClipboardButton
            v-if="analysisJson"
            class="copy-analysis-btn"
            :content="analysisJson"
            title="Copy AI analysis JSON"
          />
        </div>

        <p v-if="analysis.status === 'idle'" class="section-note">
          Review the details above, then click "Analyze with AI" to see the analysis results here.
        </p>

        <div v-else-if="analysis.status === 'running'">
          <p class="analysis-status">Analyzing with AI…</p>
          <p v-if="aiInputDetail" class="section-note">{{ aiInputDetail }}</p>
          <p
            v-if="estimatedTokenUsage"
            class="section-note"
            :class="{ 'token-usage-warning': tokenUsageNearLimit }"
            :title="tokenUsageTitle"
          >
            Estimated AI input: {{ estimatedTokenUsage }}
            <span v-if="tokenUsageNearLimit"> — Near this model's input limit</span>
          </p>
        </div>

        <div v-else-if="analysis.status === 'error'" class="analysis-error">
          <p>{{ analysis.errorMessage }}</p>
          <p v-if="estimatedTokenUsage" class="section-note">
            Smallest attempted AI input: {{ estimatedTokenUsage }}
            <span v-if="analysis.contextDetail">
              — Current context {{ analysis.contextDetail
              }}<span v-if="analysis.comparisonDetail"
                >, comparison {{ analysis.comparisonDetail }}</span
              >
            </span>
          </p>
          <details v-if="analysis.rawResponseText" class="advanced-details">
            <summary>Raw AI response</summary>
            <pre class="raw-response">{{ analysis.rawResponseText }}</pre>
          </details>
        </div>

        <div v-else-if="analysis.status === 'success' && analysis.result">
          <!-- Mark AI output stale when it predates the current baseline. -->
          <p v-if="comparison.analysisStale" class="analysis-stale">
            <fa icon="triangle-exclamation" />
            Baseline changed; run Analyze with AI again. The analysis below was produced before the
            current baseline selection and does not reflect the comparison above.
          </p>
          <p v-if="aiInputDetail" class="section-note">AI input: {{ aiInputDetail }}</p>
          <p
            v-if="estimatedTokenUsage"
            class="section-note"
            :class="{ 'token-usage-warning': tokenUsageNearLimit }"
            :title="tokenUsageTitle"
          >
            Estimated AI input: {{ estimatedTokenUsage }}
            <span v-if="tokenUsageNearLimit"> — Near this model's input limit</span>
          </p>
          <div v-if="analysis.result.qualityIssues?.length" class="analysis-quality-warning">
            <p>
              <fa icon="triangle-exclamation" /> Some AI recommendations failed deterministic
              validation.
            </p>
            <ul>
              <li
                v-for="issue in analysis.result.qualityIssues"
                :key="`${issue.code}-${issue.recommendationTitle ?? ''}`"
              >
                {{ issue.message }}
              </li>
            </ul>
          </div>
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
              <p v-if="evidenceLabel(f.evidence)" class="ai-card-evidence">
                {{ evidenceLabel(f.evidence) }}
              </p>
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
              <p class="ai-card-rationale">
                <span class="label-inline">Rationale:</span> {{ r.rationale }}
              </p>
              <pre v-if="r.suggestedSql" class="ai-card-sql">{{ r.suggestedSql }}</pre>
              <!-- possibleDuplicateOfIndex is host-computed, never
                   AI-authored, and RDB-only (never set for a DynamoDB
                   context - see PerformanceTuningPreviewPanel.ts's
                   analyzeWithAi()). -->
              <p v-if="r.possibleDuplicateOfIndex" class="ai-card-duplicate-warning">
                <fa icon="triangle-exclamation" />
                Possible duplicate of existing index "{{ r.possibleDuplicateOfIndex }}" - verify
                before running.
              </p>
              <p v-if="evidenceLabel(r.evidence)" class="ai-card-evidence">
                {{ evidenceLabel(r.evidence) }}
              </p>
            </div>
          </div>

          <p class="analysis-note">
            Recommendations are AI-generated suggestions based on this one context snapshot. They
            are not applied automatically - review and run them yourself.
          </p>

          <div class="row">
            <span class="label">Confidence</span>
            <span class="badge" :class="`confidence-${analysis.result.confidence}`">{{
              analysis.result.confidence
            }}</span>
          </div>

          <div v-if="analysis.result.missingContext.length > 0" class="analysis-subsection">
            <h4>Missing context</h4>
            <ul>
              <li v-for="(m, i) in analysis.result.missingContext" :key="`missing-${i}`">
                {{ m }}
              </li>
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
          The items below describe
          {{ engine === "relational" ? "execution-plan" : "access-pattern/collection" }}
          characteristics. On their own, they don't indicate a confirmed performance problem — see
          each item's technical details.
        </p>
        <DiagnosticGroupCard v-for="g in infoGroups" :key="g.key" :group="g" />
      </div>

      <!-- Full context JSON, as "Advanced details" - collapsed by default. -->
      <details class="section advanced-details advanced-details-section">
        <summary class="section-title">Advanced details: Full context JSON</summary>
        <p class="advanced-note">
          This preview includes the statement/target, table definitions, and predicates exactly as
          collected. Review the content before sending it to an AI service.
        </p>
        <p v-if="active" class="advanced-note">
          Diagnostic context size: {{ active.payloadBytes.toLocaleString() }} /
          {{ active.maxPayloadBytes.toLocaleString() }} bytes
          <span v-if="active.maxPayloadBytes > 0 && active.payloadBytes > active.maxPayloadBytes">
            (exceeds collection limit)</span
          >
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

    /* Keep visible section order aligned with the saved report. */
    .collection-issues-section {
      order: 2;
    }
    .information-section {
      order: 3;
    }
    /* Deterministic comparison precedes the AI interpretation. */
    .comparison-section {
      order: 8;
    }
    .ai-analysis-section {
      order: 9;
    }
    .advanced-details-section {
      order: 10;
    }

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

    .completion-banner {
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

    .analysis-stale {
      color: var(--vscode-editorWarning-foreground);
      font-size: 0.9em;
      margin: 0 0 8px 0;
    }

    .token-usage-warning {
      color: var(--vscode-editorWarning-foreground);
    }

    .analysis-quality-warning {
      color: var(--vscode-editorWarning-foreground);
      border-left: 3px solid var(--vscode-editorWarning-foreground);
      padding: 4px 8px;
      margin: 0 0 8px 0;

      p,
      ul {
        margin: 2px 0;
      }
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
