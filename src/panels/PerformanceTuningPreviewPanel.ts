import {
  AnyPerformanceTuningContext,
  AwsDriver,
  CapabilityStatus,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DynamoDbPerformanceTuningCallOptions,
  DynamoDbPerformanceTuningContext,
  DynamoDbBenchmarkSample,
  PerformanceTuningBenchmarkSample,
  PerformanceTuningContext,
  RDSBaseDriver,
  createPerformanceQueryDiagram,
  isDynamoDbPerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationTokenSource,
  env,
  LanguageModelChatMessage,
  lm,
  ProgressLocation,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  type LanguageModelChat,
} from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningComparisonViewState,
  PerformanceTuningPreviewPanelEventData,
} from "../shared/MessageEventData";
import {
  PerformanceTuningAiAnalysisResult,
  type PerformanceTuningAiTokenUsage,
} from "../shared/PerformanceTuningAiAnalysis";
import type {
  ComparisonAiInputDetail,
  PerformanceTuningBaselineSelection,
  PerformanceTuningComparisonEvidence,
} from "../shared/PerformanceTuningComparison";
import { promptForBaselineSelection } from "../utilities/performanceTuningBaselineLoader";
import { buildPerformanceTuningComparisonEvidence } from "../utilities/performanceTuningComparison";
import {
  buildComparisonAiInput,
  COMPARISON_AI_INPUT_DETAILS,
  type ComparisonAiInput,
} from "../utilities/performanceTuningComparisonAiInput";
import { buildDynamoDbAccessPatternViewModel } from "../utilities/dynamoDbPerformanceTuningAccessPatternFormatter";
import { buildDynamoDbAiAnalysisPrompt, buildDynamoDbPlainTextAnalysisPrompt } from "../utilities/dynamoDbPerformanceTuningAiPrompt";
import { buildDynamoDbPerformanceTuningDiagnosticGroups } from "../utilities/dynamoDbPerformanceTuningDiagnosticFormatter";
import { buildDynamoDbPerformanceTuningHumanSummary } from "../utilities/dynamoDbPerformanceTuningHumanSummary";
import { saveDynamoDbAiAnalysisAsNotebook } from "../utilities/dynamoDbPerformanceTuningNotebook";
import { buildDynamoDbNativeQueryViewModel } from "../utilities/dynamoDbNativeQueryDisplay";
import { toDynamoDbQueryAnalysisInput } from "../utilities/dynamoDbQueryAnalysisInput";
import { workflow } from "../utilities/driverResolver";
import { getErrorMessage } from "../utilities/errorUtil";
import { createCodeHtmlString } from "../utilities/highlighter";
import {
  buildLanguageModelSelection,
  defaultTranslateResponse,
  isModelNotSupportedError,
  MODEL_NOT_SUPPORTED_ERROR_MESSAGE,
} from "../utilities/lmModelSelection";
import {
  saveAiAnalysisAsNotebook,
  type PerformanceTuningReportInput,
} from "../utilities/performanceTuningAiNotebook";
import { buildAiAnalysisPrompt, buildPlainTextAnalysisPrompt } from "../utilities/performanceTuningAiPrompt";
import { buildPerformanceTuningDiagnosticGroups } from "../utilities/performanceTuningDiagnosticFormatter";
import { findPossibleDuplicateIndex } from "../utilities/performanceTuningIndexDuplication";
import { buildPerformanceTuningHumanSummary } from "../utilities/performanceTuningHumanSummary";
import { excludeUnchangedSqlRecommendations } from "../utilities/performanceTuningAiRecommendationGuard";
import {
  buildDynamoDbBenchmarkSession,
  buildRdbBenchmarkSession,
  type BenchmarkRunCount,
} from "../utilities/performanceTuningBenchmark";
import {
  buildPlanTableMappingRows,
  formatActualPlanForDisplay,
  formatPlanTree,
} from "../utilities/performanceTuningPlanFormatter";
// Type-only: avoids a runtime circular import with performanceTuningPreview.ts/
// dynamoDbPerformanceTuningPreview.ts, which import this class (the value)
// the other way.
import type { PerformanceTuningPreviewRequest } from "../utilities/performanceTuningPreview";
import type { DynamoDbPerformanceTuningPreviewRequest } from "../utilities/dynamoDbPerformanceTuningPreview";
import { BasePanel } from "./BasePanel";

// countTokens() is model-specific, but message framing added by the provider
// is not always visible in that count. Keep a small buffer so a request that
// is mathematically at the advertised boundary does not still fail at send.
const AI_INPUT_TOKEN_SAFETY_MARGIN = 128;

// What one successful rung of the shrink ladder produced: the messages to
// send, whether the Current context was compacted, and the Comparison Input
// that actually travelled (undefined when no baseline is selected). The last
// field is what the saved analysis's request metadata records (§13.1).
//
// `baseline` pins the selection this request was built against. Nothing stops
// the user from picking a different baseline while the model is still
// streaming - the baseline buttons stay enabled and renderGeneration does not
// change - so reading `this.baseline` when the response lands would record
// (and mark fresh) a baseline the model never saw.
type PreparedAiRequest = {
  messages: LanguageModelChatMessage[];
  compact: boolean;
  inputTokens: number;
  maxInputTokens: number;
  safetyMargin: number;
  comparison?: ComparisonAiInput;
  baseline?: PerformanceTuningBaselineSelection;
  // The evidence the Comparison Input above was projected from, pinned for
  // the same reason.
  evidence?: PerformanceTuningComparisonEvidence;
};

class AiInputLimitError extends Error {
  constructor(
    message: string,
    readonly tokenUsage?: PerformanceTuningAiTokenUsage,
    readonly contextDetail?: "full" | "compact",
    readonly comparisonDetail?: ComparisonAiInputDetail,
  ) {
    super(message);
    this.name = "AiInputLimitError";
  }
}

/**
 * The comparison an AI result was actually produced against, captured when
 * the request was built. A saved report uses this rather than whatever is
 * selected at save time: the "AI request messages" cell claims to be the
 * exact prompt that was sent, so rebuilding it from a newer comparison would
 * make that claim false (§14).
 */
type AnalysisComparisonSnapshot = {
  evidence: PerformanceTuningComparisonEvidence;
  baselineContext: AnyPerformanceTuningContext;
  aiInput: ComparisonAiInput;
};

// Host-side state and orchestration for the Preview and AI analysis. Build
// user-facing diagnostic groups here so rendering stays simple and testable.
// One panel class, shared by both engines (design doc §11.3's "共通 shell") -
// see renderSub()'s isDynamoDbPerformanceTuningContext() branch for where
// the two diverge.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

  /**
   * One rung of the shrink ladder: which Current-context projection and
   * which Comparison Input projection this attempt used. Recorded on the
   * saved analysis so a reader can tell exactly what the model was shown
   * (§13.1's "無言で切り捨てない").
   */
  private comparisonAttempt(
    detail: ComparisonAiInputDetail,
    evidence: PerformanceTuningComparisonEvidence | undefined = this.comparison.evidence,
  ): ComparisonAiInput | undefined {
    return evidence ? buildComparisonAiInput(evidence, detail) : undefined;
  }

  /**
   * The order §13.1 prescribes for fitting a request into a model's input
   * window: switch the Current context to its compact projection first, then
   * drop the comparison's raw diff hunks (never the two query bodies), then
   * drop its collection differences and comparable-level notes. Without a
   * baseline this collapses to the original full/compact pair.
   */
  private rdbAttemptLadder(hasComparison: boolean = Boolean(this.comparison.evidence)): Array<{
    contextDetail: "full" | "compact";
    comparisonDetail: ComparisonAiInputDetail;
  }> {
    const contextDetails = ["full", "compact"] as const;
    if (!hasComparison) {
      return contextDetails.map((contextDetail) => ({ contextDetail, comparisonDetail: "full" }));
    }
    return [
      ...contextDetails.map((contextDetail) => ({
        contextDetail,
        comparisonDetail: "full" as const,
      })),
      { contextDetail: "compact" as const, comparisonDetail: "noDiffHunks" as const },
      { contextDetail: "compact" as const, comparisonDetail: "minimal" as const },
    ];
  }

  private async buildMessagesWithinModelInputLimit(
    model: LanguageModelChat,
    context: PerformanceTuningContext,
    translateResponse: boolean,
    token: CancellationTokenSource["token"],
    baseline: PerformanceTuningBaselineSelection | undefined,
    evidence: PerformanceTuningComparisonEvidence | undefined,
  ): Promise<PreparedAiRequest> {
    const maximum = model.maxInputTokens;
    if (!Number.isFinite(maximum) || maximum <= AI_INPUT_TOKEN_SAFETY_MARGIN) {
      throw new Error("The selected AI model does not report a usable input-token limit.");
    }

    let smallest:
      | { inputTokens: number; contextDetail: "full" | "compact"; comparisonDetail: ComparisonAiInputDetail }
      | undefined;
    for (const { contextDetail, comparisonDetail } of this.rdbAttemptLadder(Boolean(evidence))) {
      const comparison = this.comparisonAttempt(comparisonDetail, evidence);
      const prompt = buildAiAnalysisPrompt(context, {
        translateResponse,
        language: env.language,
        contextDetail,
        comparison,
      });
      const messages = [
        LanguageModelChatMessage.Assistant(prompt.assistant),
        LanguageModelChatMessage.User(prompt.user),
      ];
      const inputTokens = (
        await Promise.all(messages.map((message) => model.countTokens(message, token)))).reduce(
        (total, count) => total + count,
        0,
      );
      if (inputTokens + AI_INPUT_TOKEN_SAFETY_MARGIN <= maximum) {
        return {
          messages,
          compact: contextDetail === "compact",
          inputTokens,
          maxInputTokens: maximum,
          safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          comparison,
          baseline,
          evidence,
        };
      }
      if (!smallest || inputTokens < smallest.inputTokens) {
        smallest = { inputTokens, contextDetail, comparisonDetail };
      }
    }

    throw new AiInputLimitError(
      evidence
        ? `The selected model accepts at most ${maximum} input tokens, but even the smallest context and comparison require ${smallest?.inputTokens ?? "more"} tokens. Clear the baseline, or choose a model with a larger input window.`
        : `The selected model accepts at most ${maximum} input tokens, but even the compact performance context requires ${smallest?.inputTokens ?? "more"} tokens.`,
      smallest
        ? {
            inputTokens: smallest.inputTokens,
            maxInputTokens: maximum,
            safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          }
        : undefined,
      smallest?.contextDetail,
      smallest?.comparisonDetail,
    );
  }

  // DynamoDB counterpart of the above. Walks every comparison projection
  // against the full Current context first, then retries them against an
  // AI-only compact Current projection. The latter summarizes raw CloudWatch
  // arrays and verbose diagnostics; the Full Context kept on screen and in a
  // saved Notebook is never modified.
  private async buildDynamoDbMessagesWithinModelInputLimit(
    model: LanguageModelChat,
    context: DynamoDbPerformanceTuningContext,
    translateResponse: boolean,
    token: CancellationTokenSource["token"],
    baseline: PerformanceTuningBaselineSelection | undefined,
    evidence: PerformanceTuningComparisonEvidence | undefined,
  ): Promise<PreparedAiRequest> {
    const maximum = model.maxInputTokens;
    if (!Number.isFinite(maximum) || maximum <= AI_INPUT_TOKEN_SAFETY_MARGIN) {
      throw new Error("The selected AI model does not report a usable input-token limit.");
    }

    const ladder: Array<{
      contextDetail: "full" | "compact";
      comparisonDetail: ComparisonAiInputDetail;
    }> = evidence
      ? [
          ...COMPARISON_AI_INPUT_DETAILS.map((comparisonDetail) => ({
            contextDetail: "full" as const,
            comparisonDetail,
          })),
          ...COMPARISON_AI_INPUT_DETAILS.map((comparisonDetail) => ({
            contextDetail: "compact" as const,
            comparisonDetail,
          })),
        ]
      : [
          { contextDetail: "full", comparisonDetail: "full" },
          { contextDetail: "compact", comparisonDetail: "full" },
        ];
    let smallest:
      | { inputTokens: number; contextDetail: "full" | "compact"; comparisonDetail: ComparisonAiInputDetail }
      | undefined;
    for (const { contextDetail, comparisonDetail } of ladder) {
      const comparison = this.comparisonAttempt(comparisonDetail, evidence);
      const prompt = buildDynamoDbAiAnalysisPrompt(context, {
        translateResponse,
        language: env.language,
        contextDetail,
        comparison,
      });
      const messages = [
        LanguageModelChatMessage.Assistant(prompt.assistant),
        LanguageModelChatMessage.User(prompt.user),
      ];
      const inputTokens = (
        await Promise.all(messages.map((message) => model.countTokens(message, token)))).reduce(
        (total, count) => total + count,
        0,
      );
      if (inputTokens + AI_INPUT_TOKEN_SAFETY_MARGIN <= maximum) {
        return {
          messages,
          compact: contextDetail === "compact",
          inputTokens,
          maxInputTokens: maximum,
          safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          comparison,
          baseline,
          evidence,
        };
      }
      if (!smallest || inputTokens < smallest.inputTokens) {
        smallest = { inputTokens, contextDetail, comparisonDetail };
      }
    }

    throw new AiInputLimitError(
      evidence
        ? `The selected model accepts at most ${maximum} input tokens, but the smallest DynamoDB context and comparison still require ${smallest?.inputTokens ?? "more"} tokens. Clear the baseline, or choose a model with a larger input window.`
        : `The selected model accepts at most ${maximum} input tokens, but even the compact DynamoDB performance context requires ${smallest?.inputTokens ?? "more"} tokens.`,
      smallest
        ? {
            inputTokens: smallest.inputTokens,
            maxInputTokens: maximum,
            safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          }
        : undefined,
      smallest?.contextDetail,
      smallest?.comparisonDetail,
    );
  }

  // The singleton panel can be re-render()ed with a new context before a
  // prior renderSub() call's async syntax highlighting finishes (e.g. Query
  // Statistics' 9b lets a user trigger back-to-back previews from different
  // rows). Guards against the slower, older call posting its result after
  // the newer one already has (§10 Phase 5 "PerformanceTuningPreviewPanel...
  // にもrenderGenerationを持たせる"). Also reused as the AI analysis
  // generation guard below - a fresh renderSub() (new context) invalidates
  // any AI analysis that was still running against the previous one.
  private renderGeneration = 0;

  // The context most recently rendered, and the most recent successful AI
  // analysis of it (if any) - held as instance state because
  // analyzePerformanceTuningWithAi/saveAiAnalysisAsNotebook carry no params
  // (design doc §12): the webview never re-sends data the extension host
  // already has. Union of both engines (2026-08-24 follow-up, DynamoDB
  // support) - see isDynamoDbPerformanceTuningContext() for how methods below
  // narrow it.
  private context: AnyPerformanceTuningContext | undefined;
  private lastAnalysis: PerformanceTuningAiAnalysisResult | undefined;
  private analysisCancellationSource: CancellationTokenSource | undefined;
  // A provider may advertise a model through selectChatModels() and reject
  // it only when sendRequest() reaches the backend. Quarantine that model for
  // this Preview panel's lifetime; closing the panel creates a fresh instance
  // and therefore retries against a newly queried provider list.
  private readonly unavailableLanguageModelIds = new Set<string>();

  // Baseline comparison (§6, §12). The selection holds its own immutable
  // Context snapshot, so nothing here ever re-reads the .dbn - a comparison
  // already on screen stays reproducible even if that file is later moved or
  // edited (§6.3). `comparison` is derived state, always rebuilt from
  // `baseline` + `this.context` rather than cached across a re-collection.
  // Both survive a renderSub() (an EXPLAIN ANALYZE / Observed Read re-run of
  // the same preview) and are cleared by render()/renderDynamoDb() (a
  // genuinely new preview, whose baseline may not even be the same engine).
  private baseline: PerformanceTuningBaselineSelection | undefined;
  // Pinned at request-build time; see AnalysisComparisonSnapshot.
  private lastAnalysisComparison: AnalysisComparisonSnapshot | undefined;
  private comparison: PerformanceTuningComparisonViewState = { status: "idle" };
  // The directory the last baseline was picked from, so the next dialog opens
  // there. Panel-scoped on purpose: §6.1 allows remembering a directory but
  // not persisting a baseline's absolute path into global settings.
  private lastBaselineDirectory: Uri | undefined;
  // The baseline the AI analysis currently on screen was produced under.
  // Compared against the live selection to decide `analysisStale` - the
  // Preview must never present an older analysis as commentary on a newer
  // comparison (§12).
  private analysisBaselineSha256: string | undefined;

  // "Run EXPLAIN ANALYZE" (2026-08-20 follow-up) - the original RDB request
  // (everything getPerformanceTuningContext() needs besides plan.mode
  // itself) and this connection's static capability to even do it at all,
  // both set once by render() and reused by runActualPlan() below so the
  // webview never needs to send either back. Not reset by renderSub() (the
  // analyze-mode re-run's own render path) since both stay constant across
  // the estimate/analyze pair for the same preview.
  private request: PerformanceTuningPreviewRequest | undefined;
  private analyzedExecutionPlan: CapabilityStatus = { available: false };
  // "Run Observed Read" - the DynamoDB counterpart of the two fields above,
  // kept as separate fields (not shared ones) since exactly one of
  // request/dynamoDbRequest is ever set for a given preview (render() clears
  // the other) - see renderDynamoDb()/render() below.
  private dynamoDbRequest: DynamoDbPerformanceTuningPreviewRequest | undefined;
  private observedReadCapability: CapabilityStatus = { available: false };
  // AbortController, not a vscode.CancellationTokenSource, since it feeds
  // getPerformanceTuningContext()/getDynamoDbPerformanceTuningContext()'s own
  // `{signal}` option directly - same bridge
  // (`token.onCancellationRequested(() => controller.abort())`)
  // startPerformanceTuningPreview()/startDynamoDbPerformanceTuningPreview()
  // themselves already use for the initial (estimate-mode/static) collection.
  // Shared by runActualPlan() and runObservedRead(): the two are mutually
  // exclusive (a panel shows exactly one engine's context at a time), so one
  // field is enough.
  private secondaryExecutionController: AbortController | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
      panel,
      extensionUri
    );
  }

  private static ensurePanel(extensionUri: Uri): PerformanceTuningPreviewPanel {
    if (PerformanceTuningPreviewPanel.currentPanel) {
      PerformanceTuningPreviewPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "PerformanceTuningPreviewPanelType",
        "Performance Tuning Preview",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
        panel,
        extensionUri
      );
    }
    return PerformanceTuningPreviewPanel.currentPanel;
  }

  public static render(
    extensionUri: Uri,
    context: PerformanceTuningContext,
    request: PerformanceTuningPreviewRequest,
    analyzedExecutionPlan: CapabilityStatus
  ) {
    const panel = PerformanceTuningPreviewPanel.ensurePanel(extensionUri);
    // Held for "Run EXPLAIN ANALYZE" (runActualPlan() below) - constant
    // across the initial (estimate-mode) preview and any later analyze-mode
    // re-run of it, so only the first render() call's values matter; a
    // later renderSub()-only re-render (the re-run itself) does not touch
    // either field.
    panel.request = request;
    panel.dynamoDbRequest = undefined;
    panel.analyzedExecutionPlan = analyzedExecutionPlan;
    panel.observedReadCapability = { available: false };
    panel.clearBaseline();
    panel.renderSub(context);
  }

  // DynamoDB counterpart of render() (design doc §11.3's shared shell -
  // startDynamoDbPerformanceTuningPreview()'s own entry point).
  public static renderDynamoDb(
    extensionUri: Uri,
    context: DynamoDbPerformanceTuningContext,
    request: DynamoDbPerformanceTuningPreviewRequest,
    observedReadCapability: CapabilityStatus
  ) {
    const panel = PerformanceTuningPreviewPanel.ensurePanel(extensionUri);
    panel.request = undefined;
    panel.dynamoDbRequest = request;
    panel.analyzedExecutionPlan = { available: false };
    panel.observedReadCapability = observedReadCapability;
    panel.clearBaseline();
    panel.renderSub(context);
  }

  getComponentName(): ComponentName {
    return "PerformanceTuningPreviewPanel";
  }

  private async renderSub(context: AnyPerformanceTuningContext): Promise<void> {
    const myGeneration = ++this.renderGeneration;

    // A new context invalidates any AI analysis in flight or already shown
    // for the previous one - cancel the in-flight request (if any) and
    // clear the stale result so a stray "Save as Notebook" can't save
    // analysis text for a statement no longer on screen.
    this.analysisCancellationSource?.cancel();
    this.analysisCancellationSource = undefined;
    // A new context (a fresh preview, or this same preview's own re-run
    // replacing itself) invalidates a still-running EXPLAIN ANALYZE/Run
    // Observed Read the same way - never let a stale one's result land after
    // this one.
    this.secondaryExecutionController?.abort();
    this.secondaryExecutionController = undefined;
    this.context = context;
    this.lastAnalysis = undefined;
    this.lastAnalysisComparison = undefined;
    this.analysisBaselineSha256 = undefined;
    // A re-run (EXPLAIN ANALYZE / Observed Read) replaces the Current side of
    // an existing comparison, so the evidence has to be rebuilt against the
    // new numbers rather than kept (§16 Phase 2).
    this.rebuildComparison();

    if (isDynamoDbPerformanceTuningContext(context)) {
      await this.renderDynamoDbSub(context, myGeneration);
      return;
    }
    await this.renderRelationalSub(context, myGeneration);
  }

  private async renderRelationalSub(context: PerformanceTuningContext, myGeneration: number): Promise<void> {
    // Computed here (not in the webview) so the number shown always matches
    // what RDSBaseDriver.enforcePayloadBudget() itself measured the result
    // against.
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    // "Copy Prompt for Other AI" (2026-08-21 follow-up): precomputed here,
    // like sqlHtml/jsonHtml below, so the toolbar button can copy it
    // instantly with no round-trip - it's a pure string build, not an actual
    // vscode.lm call, so there's nothing to await.
    // Built through the shared helper so a re-run that kept its baseline
    // (renderSub() rebuilds the comparison before this point) carries the
    // same Comparison Input the Copilot path would send (§13.2).
    const { plainTextPrompt, translatedPlainTextPrompt } = this.buildPlainTextPrompts()!;

    const [sqlHtml, jsonHtml, models] = await Promise.all([
      createCodeHtmlString({ code: context.statement.sql, lang: "sql" }),
      createCodeHtmlString({ code: contextJson, lang: "json" }),
      lm.selectChatModels({ vendor: "copilot" }),
    ]);

    if (myGeneration !== this.renderGeneration) {
      // A newer render() call started (and possibly already finished) while
      // this one was highlighting - never let the older result win.
      return;
    }

    const diagnosticGroups = buildPerformanceTuningDiagnosticGroups(
      context.collection.diagnostics,
      context.collection.unavailableSections
    );

    // Execution plan display (2026-08-19 follow-up, design doc). Two
    // separate renderers for two separate data shapes - see
    // performanceTuningPlanFormatter.ts's top comment.
    const planTreeText = context.executionPlan.normalizedPlan
      ? formatPlanTree(context.executionPlan.normalizedPlan)
      : undefined;
    const actualPlanDisplayText = formatActualPlanForDisplay(context.executionPlan.actualPlan);
    const planTableMappingRows = buildPlanTableMappingRows(context.planTableMappings);
    const humanSummary = buildPerformanceTuningHumanSummary(context);
    const queryDiagram = createPerformanceQueryDiagram(context);

    // "Language model"/"Translate response" defaults for Analyze with AI
    // (2026-08-19 follow-up, design doc §0). No gpt-4o-family preference
    // (deliberately - see lmModelSelection.ts); translateResponse defaults
    // off only for an English display language.
    const { languageModels, defaultLanguageModelId } = buildLanguageModelSelection(
      models.filter((model) => !this.unavailableLanguageModelIds.has(model.id))
    );

    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningPreviewPanel",
      value: {
        initialize: {
          engine: "relational",
          context,
          diagnosticGroups,
          planTreeText,
          actualPlanDisplayText,
          planTableMappingRows,
          humanSummary,
          queryDiagramAvailable: Boolean(queryDiagram),
          queryDiagramHasWarnings: (queryDiagram?.warnings.length ?? 0) > 0,
          sqlHtml,
          jsonHtml,
          plainTextPrompt,
          translatedPlainTextPrompt,
          payloadBytes,
          maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
          languageModels,
          languageModelId: defaultLanguageModelId,
          translateResponse: defaultTranslateResponse(env.language),
          analyzedExecutionPlan: this.analyzedExecutionPlan,
          comparison: this.comparison,
        },
      },
    };
    this.getWebviewPanel().webview.postMessage(msg);
  }

  private async renderDynamoDbSub(context: DynamoDbPerformanceTuningContext, myGeneration: number): Promise<void> {
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    // Same shared helper as the RDB path - see its comment there.
    const { plainTextPrompt, translatedPlainTextPrompt } = this.buildPlainTextPrompts()!;

    const [sqlHtml, jsonHtml, models] = await Promise.all([
      // Only a PartiQL statement has SQL-like text to highlight - see
      // DynamoDbPerformanceTuningInitializeViewModel.sqlHtml's own comment.
      context.statement.text
        ? createCodeHtmlString({ code: context.statement.text, lang: "sql" })
        : Promise.resolve(undefined),
      createCodeHtmlString({ code: contextJson, lang: "json" }),
      lm.selectChatModels({ vendor: "copilot" }),
    ]);

    if (myGeneration !== this.renderGeneration) {
      return;
    }

    const diagnosticGroups = buildDynamoDbPerformanceTuningDiagnosticGroups(
      context.collection.diagnostics,
      context.collection.unavailableSections,
    );
    const humanSummary = buildDynamoDbPerformanceTuningHumanSummary(context);
    const accessPattern = buildDynamoDbAccessPatternViewModel(context.accessPattern);
    const nativeQuery = this.dynamoDbRequest?.statement.request.kind === "query"
      ? buildDynamoDbNativeQueryViewModel(this.dynamoDbRequest.statement.request.input)
      : undefined;
    const { languageModels, defaultLanguageModelId } = buildLanguageModelSelection(
      models.filter((model) => !this.unavailableLanguageModelIds.has(model.id))
    );

    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningPreviewPanel",
      value: {
        initialize: {
          engine: "dynamodb",
          context,
          diagnosticGroups,
          accessPattern,
          humanSummary,
          sqlHtml,
          nativeQuery,
          jsonHtml,
          plainTextPrompt,
          translatedPlainTextPrompt,
          payloadBytes,
          // Matches RDB's own default (DynamoDbPerformanceTuningProvider.ts's
          // DEFAULT_MAX_PAYLOAD_BYTES is intentionally the same value) - one
          // displayed budget, not a second constant to keep in sync.
          maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
          languageModels,
          languageModelId: defaultLanguageModelId,
          translateResponse: defaultTranslateResponse(env.language),
          observedReadCapability: this.observedReadCapability,
          comparison: this.comparison,
        },
      },
    };
    this.getWebviewPanel().webview.postMessage(msg);
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    switch (message.command) {
      case "cancel":
        this.dispose();
        break;
      case "analyzePerformanceTuningWithAi":
        await this.analyzeWithAi(message.params.languageModelId, message.params.translateResponse);
        break;
      case "saveAiAnalysisAsNotebook":
        await this.saveAnalysisAsNotebook();
        break;
      case "runActualPlan":
        await this.runActualPlan();
        break;
      case "runObservedRead":
        await this.runObservedRead();
        break;
      case "runPerformanceTuningBenchmark":
        await this.runBenchmark(message.params.runs, message.params.mode);
        break;
      case "selectPerformanceTuningBaseline":
        await this.selectBaseline();
        break;
      case "clearPerformanceTuningBaseline":
        this.clearBaseline();
        await this.postComparisonUpdate(this.renderGeneration);
        break;
    }
  }

  // "Compare with Baseline..." / "Change Baseline..." (§6.1). A failed pick
  // deliberately leaves the previous selection in place: replacing a working
  // comparison with nothing because the user opened the wrong file is a worse
  // outcome than an error message next to the comparison that still stands
  // (§17.5).
  private async selectBaseline(): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context) {
      return;
    }
    this.comparison = { ...this.comparison, status: "loading", errorMessage: undefined };
    await this.postComparisonUpdate(myGeneration);

    const loaded = await promptForBaselineSelection({ lastDirectory: this.lastBaselineDirectory });
    if (myGeneration !== this.renderGeneration) {
      // A newer preview replaced this one while the dialog was open - its own
      // render already published a fresh comparison state.
      return;
    }
    if (!loaded.ok) {
      // A cancelled dialog is not an error; it just restores what was there.
      this.comparison = {
        ...this.comparison,
        status: this.baseline ? "ready" : "idle",
        errorMessage: "cancelled" in loaded ? undefined : loaded.message,
      };
      await this.postComparisonUpdate(myGeneration);
      return;
    }

    const built = buildPerformanceTuningComparisonEvidence({
      baseline: loaded.selection,
      current: this.context,
    });
    if (!built.ok) {
      this.comparison = {
        ...this.comparison,
        status: this.baseline ? "ready" : "idle",
        errorMessage: built.message,
      };
      await this.postComparisonUpdate(myGeneration);
      return;
    }

    this.baseline = loaded.selection;
    this.lastBaselineDirectory = loaded.selection.source.sourcePath
      ? Uri.joinPath(Uri.file(loaded.selection.source.sourcePath), "..")
      : this.lastBaselineDirectory;
    this.comparison = {
      status: "ready",
      baseline: loaded.selection.source,
      evidence: built.evidence,
      analysisStale: this.isAnalysisStale(),
    };
    await this.postComparisonUpdate(myGeneration);
  }

  private clearBaseline(): void {
    this.baseline = undefined;
    this.comparison = { status: "idle", analysisStale: this.isAnalysisStale() };
  }

  /**
   * Recomputes the evidence against whatever `this.context` now holds. Called
   * from renderSub() so a re-collected Current side never leaves the previous
   * run's numbers on screen labelled as the current ones.
   */
  private rebuildComparison(): void {
    const baseline = this.baseline;
    if (!baseline || !this.context) {
      this.comparison = { status: "idle" };
      return;
    }
    const built = buildPerformanceTuningComparisonEvidence({ baseline, current: this.context });
    if (!built.ok) {
      // Only reachable if a re-run somehow produced a different engine, which
      // the request state makes impossible - handled rather than asserted so
      // the panel degrades to "no comparison" instead of showing a stale one.
      this.baseline = undefined;
      this.comparison = { status: "idle", errorMessage: built.message };
      return;
    }
    this.comparison = {
      status: "ready",
      baseline: baseline.source,
      evidence: built.evidence,
      analysisStale: this.isAnalysisStale(),
    };
  }

  /**
   * True when an AI result is on screen and the baseline it was produced
   * under is not the one selected now (including "none" in either direction).
   */
  private isAnalysisStale(): boolean {
    if (!this.lastAnalysis) {
      return false;
    }
    return this.analysisBaselineSha256 !== this.baseline?.source.contextSha256;
  }

  /**
   * "Copy Prompt for Other AI" is precomputed host-side, so it has to be
   * rebuilt whenever the baseline changes - §13.2 requires the external-AI
   * path to carry the same Comparison Input as the Copilot path, at full
   * detail (a manual paste has no token limit to shrink against).
   */
  private buildPlainTextPrompts(): { plainTextPrompt: string; translatedPlainTextPrompt: string } | undefined {
    const context = this.context;
    if (!context) {
      return undefined;
    }
    const comparison = this.comparisonAttempt("full");
    if (isDynamoDbPerformanceTuningContext(context)) {
      return {
        plainTextPrompt: buildDynamoDbPlainTextAnalysisPrompt(context, { comparison }),
        translatedPlainTextPrompt: buildDynamoDbPlainTextAnalysisPrompt(context, {
          translateResponse: true,
          language: env.language,
          comparison,
        }),
      };
    }
    return {
      plainTextPrompt: buildPlainTextAnalysisPrompt(context, { comparison }),
      translatedPlainTextPrompt: buildPlainTextAnalysisPrompt(context, {
        translateResponse: true,
        language: env.language,
        comparison,
      }),
    };
  }

  private async postComparisonUpdate(generation: number): Promise<void> {
    if (generation !== this.renderGeneration) {
      return;
    }
    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "comparison-update",
      componentName: "PerformanceTuningPreviewPanel",
      value: { comparison: this.comparison, ...this.buildPlainTextPrompts() },
    };
    await this.getWebviewPanel().webview.postMessage(msg);
  }

  // Step 10 "Analyze with AI" (design doc §6.1/§7/§11). Builds the prompt
  // from the currently-rendered context (never re-fetched, never re-sent by
  // the webview), calls the model directly through vscode.lm rather than a
  // LanguageModelTool. This is a
  // single deterministic request/response, not a conversational tool call),
  // and posts the parsed structured result back. Never throws past this
  // method - every failure path ends in an "error" analysis-update instead.
  // Shared by both engines: PerformanceTuningAiAnalysisResult is the same
  // response shape either way (design doc §12), only the prompt differs.
  private async analyzeWithAi(languageModelId: string, translateResponse: boolean): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context) {
      return;
    }
    const context = this.context;
    // Pin the selected baseline and its derived evidence at the instant the
    // analysis starts. Model lookup and token counting both await, while the
    // baseline controls remain interactive; every prompt rung and the saved
    // request metadata must therefore use this one immutable pair.
    const baseline = this.baseline;
    const evidence = this.comparison.evidence;

    await this.postAnalysisUpdate(myGeneration, { status: "running" });

    // Standard VS Code progress + cancel affordance, same convention as
    // startPerformanceTuningPreview() (this feature's own Step 9a/9b code)
    // and HistoryTreeCommand.ts's EXECUTE_SQL_HISTORY - not a bespoke
    // in-panel Cancel button. `cts` (below) is still needed alongside this:
    // it's what lets renderSub() (a newer preview replacing this one) and
    // preDispose() (panel closed) cancel an in-flight request from *outside*
    // this method, which the notification's own token cannot do on its own -
    // token.onCancellationRequested bridges the two.
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: "Analyzing performance tuning context with AI...",
      },
      async (progress, token) => {
        const cts = new CancellationTokenSource();
        this.analysisCancellationSource = cts;
        token.onCancellationRequested(() => cts.cancel());

        progress.report({ message: "Looking up available AI models..." });

        let model;
        try {
          // By-id resolution against the model the user picked in the
          // dropdown (2026-08-19 follow-up) - same send-time lookup pattern
          // used by the preview, instead of the old hardcoded
          // `{ vendor: "copilot" }` + first-result pick.
          [model] = await lm.selectChatModels(
            languageModelId ? { id: languageModelId } : { vendor: "copilot" }
          );
        } catch (e) {
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: `Failed to look up available AI models: ${getErrorMessage(e)}`,
          });
          return;
        }
        if (!model) {
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage:
              "No models found. Please check your network connection and ensure Copilot is set up properly before trying again.",
          });
          return;
        }

        let prepared: PreparedAiRequest;
        try {
          progress.report({ message: `Checking input size for ${model.family}...` });
          prepared = isDynamoDbPerformanceTuningContext(context)
            ? await this.buildDynamoDbMessagesWithinModelInputLimit(
                model,
                context,
                translateResponse,
                cts.token,
                baseline,
                evidence,
              )
            : await this.buildMessagesWithinModelInputLimit(
                model,
                context,
                translateResponse,
                cts.token,
                baseline,
                evidence,
              );
        } catch (e) {
          if (this.analysisCancellationSource === cts) {
            this.analysisCancellationSource = undefined;
          }
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: `The AI request could not fit this model's input limit: ${getErrorMessage(e)}`,
            ...(e instanceof AiInputLimitError
              ? {
                  tokenUsage: e.tokenUsage,
                  contextDetail: e.contextDetail,
                  comparisonDetail: e.comparisonDetail,
                }
              : {}),
          });
          return;
        }

        const { messages, compact } = prepared;
        await this.postAnalysisUpdate(myGeneration, {
          status: "running",
          tokenUsage: {
            inputTokens: prepared.inputTokens,
            maxInputTokens: prepared.maxInputTokens,
            safetyMargin: prepared.safetyMargin,
          },
          contextDetail: compact ? "compact" : "full",
          comparisonDetail: prepared.comparison?.detail,
        });
        progress.report({
          message: compact
            ? `Sending compact context to ${model.family}...`
            : `Sending context to ${model.family}...`,
        });

        let accumulatedResponse = "";
        try {
          const chatResponse = await model.sendRequest(messages, {}, cts.token);
          for await (const fragment of chatResponse.text) {
            if (cts.token.isCancellationRequested) {
              await this.postAnalysisUpdate(myGeneration, {
                status: "error",
                errorMessage: "The request was cancelled.",
              });
              return;
            }
            accumulatedResponse += fragment;
          }
        } catch (e) {
          if (isModelNotSupportedError(e)) {
            this.unavailableLanguageModelIds.add(model.id);
            await this.postAnalysisUpdate(
              myGeneration,
              {
                status: "error",
                errorMessage: MODEL_NOT_SUPPORTED_ERROR_MESSAGE,
              },
              model.id,
            );
            return;
          }
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: `The AI request failed: ${getErrorMessage(e)}`,
          });
          return;
        } finally {
          if (this.analysisCancellationSource === cts) {
            this.analysisCancellationSource = undefined;
          }
        }

        progress.report({ message: "Parsing AI response..." });

        // The model is only asked for these five fields (§7) - formatVersion/
        // model/generatedAt are filled in here, host-side, never trusted from
        // the model's own reply.
        let parsed: Partial<
          Pick<
            PerformanceTuningAiAnalysisResult,
            "summary" | "findings" | "recommendations" | "confidence" | "missingContext"
          >
        >;
        try {
          parsed = JSON.parse(accumulatedResponse);
        } catch (e) {
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: "The AI response could not be parsed as structured JSON.",
            rawResponseText: accumulatedResponse,
          });
          return;
        }

        const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((r) => ({
          ...r,
          possibleDuplicateOfIndex: isDynamoDbPerformanceTuningContext(context)
            ? undefined
            : findPossibleDuplicateIndex(r?.suggestedSql, context)?.matchedIndexName,
        }));
        const recommendationReview = isDynamoDbPerformanceTuningContext(context)
          ? { recommendations, qualityIssues: [] }
          : excludeUnchangedSqlRecommendations({
              currentSql: context.statement.sql,
              recommendations,
            });

        const result: PerformanceTuningAiAnalysisResult = {
          formatVersion: 1,
          summary: typeof parsed.summary === "string" ? parsed.summary : "",
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          // possibleDuplicateOfIndex (2026-08-21 follow-up, summary.md's
          // Full Context improvement item 4) is host-computed here, never
          // trusted from the model's own JSON - a deterministic backstop
          // for the model's own duplicate-index self-check (prompt item 3),
          // independent of whether the model actually followed it. RDB
          // only (design doc §12: "possibleDuplicateOfIndex の host-side
          // CREATE INDEX 検査は RDB Context の場合だけ実行する") - DynamoDB has
          // no CREATE INDEX concept at all to check against.
          recommendations: recommendationReview.recommendations,
          ...(recommendationReview.qualityIssues.length > 0
            ? { qualityIssues: recommendationReview.qualityIssues }
            : {}),
          confidence:
            recommendationReview.qualityIssues.length > 0
              ? "low"
              : parsed.confidence === "high" || parsed.confidence === "medium"
                ? parsed.confidence
                : "low",
          missingContext: Array.isArray(parsed.missingContext) ? parsed.missingContext : [],
          model: {
            id: model.id,
            vendor: model.vendor,
            family: model.family,
            version: model.version,
            name: model.name,
          },
          request: {
            promptFormatVersion: 1,
            translateResponse,
            language: env.language,
            contextDetail: compact ? "compact" : "full",
            tokenUsage: {
              inputTokens: prepared.inputTokens,
              maxInputTokens: prepared.maxInputTokens,
              safetyMargin: prepared.safetyMargin,
            },
            // Records the rung of the shrink ladder this request actually
            // used, so a saved report never implies the model was shown more
            // of the comparison than it was (§13.1).
            ...(prepared.comparison && prepared.baseline
              ? {
                  comparison: {
                    detail: prepared.comparison.detail,
                    omittedFields: prepared.comparison.omittedFields,
                    baselineFileName: prepared.baseline.source.fileName,
                    baselineContextSha256: prepared.baseline.source.contextSha256,
                  },
                }
              : {}),
          },
          generatedAt: new Date().toISOString(),
        };

        if (myGeneration !== this.renderGeneration) {
          // A newer preview replaced this one while the request was in flight -
          // don't let a stale result become the one "Save as Notebook" would save.
          return;
        }
        this.lastAnalysis = result;
        // Records which baseline this result was produced under - the one the
        // request was actually built from, which may no longer be the selected
        // one if the user changed it mid-flight (§12).
        this.analysisBaselineSha256 = prepared.baseline?.source.contextSha256;
        this.lastAnalysisComparison =
          prepared.comparison && prepared.baseline && prepared.evidence
            ? {
                evidence: prepared.evidence,
                baselineContext: prepared.baseline.context,
                aiInput: prepared.comparison,
              }
            : undefined;
        await this.postAnalysisUpdate(myGeneration, { status: "success", result });
        // The comparison state carries `analysisStale`, which only becomes
        // meaningful once an analysis exists - so it has to be re-published
        // here, not just on the baseline transitions themselves.
        this.comparison = { ...this.comparison, analysisStale: this.isAnalysisStale() };
        await this.postComparisonUpdate(myGeneration);
      }
    );
  }

  // Step 10 "Save as Notebook" (design doc §8/§13). Always creates a brand
  // new .dbn under reports/performance-tuning/ - never appends to an
  // existing Notebook, never prompts a save dialog (both decided with the
  // user, §16.1). DynamoDbPerformanceTuningContext gets its own report cell
  // structure (design doc §13) via a separate builder rather than being
  // forced through saveAiAnalysisAsNotebook()'s RDB-shaped cells.
  private async saveAnalysisAsNotebook(): Promise<void> {
    const myGeneration = this.renderGeneration;
    const evidence = this.comparison.evidence;
    if (!this.context) {
      return;
    }
    const context = this.context;

    // A stale analysis was produced against a different baseline than the one
    // selected now. Folding it into a report whose comparison chapter is about
    // the current baseline would present it as commentary on a comparison it
    // never saw - exactly what §12 forbids - and would also make the "AI
    // request messages" cell describe a prompt that was never sent. The
    // deterministic comparison is still worth saving on its own, so the
    // analysis is dropped rather than the whole save being refused.
    const analysisIsStale = this.isAnalysisStale();
    const analysis = analysisIsStale ? undefined : this.lastAnalysis;
    const analysisComparison = analysisIsStale ? undefined : this.lastAnalysisComparison;

    const comparison =
      evidence && this.baseline
        ? { evidence, baselineContext: this.baseline.context }
        : undefined;
    const input: PerformanceTuningReportInput = {
      analysis,
      comparison,
      // The exact Comparison Input that travelled with the request above, so
      // the saved messages are reproduced rather than rebuilt (§14).
      analysisComparisonInput: analysisComparison?.aiInput,
    };
    const result = isDynamoDbPerformanceTuningContext(context)
      ? await saveDynamoDbAiAnalysisAsNotebook(context, input)
      : await saveAiAnalysisAsNotebook(context, input);
    if (!result.ok) {
      window.showErrorMessage(result.message);
      return;
    }

    const reportDescription = comparison
      ? "comparison report"
      : analysis
        ? "AI analysis"
        : "performance evidence report";
    window.showInformationMessage(
      analysisIsStale
        ? `Saved ${reportDescription} to ${result.relativePath}. The AI analysis on screen was produced against a different baseline, so it was left out - run Analyze with AI again to include it.`
        : `Saved ${reportDescription} to ${result.relativePath}`
    );

    if (myGeneration !== this.renderGeneration) {
      return;
    }
    // The saved-path hint lives on the analysis view state, which only
    // renders when an analysis actually exists; a comparison-only save (and a
    // save that dropped a stale analysis) has already reported itself through
    // the notification above.
    if (analysis) {
      await this.postAnalysisUpdate(myGeneration, {
        status: "success",
        result: analysis,
        savedNotebookRelativePath: result.relativePath,
      });
    }
  }

  // "Run EXPLAIN ANALYZE" (2026-08-20 follow-up). Actually executes the
  // target SQL against the database (server-side, real I/O) to measure its
  // real execution plan, replacing this panel's whole context with the
  // analyze-mode result on success - never triggered without the user
  // explicitly confirming that in the modal warning below, on top of the
  // static warning text already shown next to the button in the webview
  // (two-layer confirmation, per the design discussion this follows up on).
  // v1 is SELECT-only by product decision; db-drivers' own
  // validatePerformanceTuningContextParams() enforces that fail-closed
  // regardless (isSingleSelectStatement()), so this method does not
  // re-check the statement text itself.
  private async runActualPlan(): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.request || !this.analyzedExecutionPlan.available) {
      return;
    }
    const context = this.context;
    // this.request only being set for an RDB preview (render()/renderDynamoDb()
    // never set both) makes this unreachable in practice; guarded anyway so
    // this method stays type-safe against `context`'s union type without an
    // unsound cast.
    if (!context || isDynamoDbPerformanceTuningContext(context)) {
      return;
    }
    const eligibility = context.statement.analyzeEligibility;
    if (eligibility?.allowed === false) {
      void window.showErrorMessage(
        eligibility.reason ?? "Explain Analyze is limited to a single SELECT statement."
      );
      return;
    }
    const request = this.request;

    const confirmed = await window.showWarningMessage(
      `This runs the SQL for real against "${request.connectionSetting.name}" to measure its actual execution plan, instead of only estimating it. Continue?`,
      { modal: true },
      "Run"
    );
    if (confirmed !== "Run") {
      await this.postStopProgress();
      return;
    }

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: "Running EXPLAIN ANALYZE...",
      },
      async (_progress, token) => {
        const controller = new AbortController();
        this.secondaryExecutionController = controller;
        token.onCancellationRequested(() => controller.abort());

        const { ok, message, result } = await workflow<RDSBaseDriver, PerformanceTuningContext>(
          request.connectionSetting,
          (driver) =>
            driver
              .getPerformanceTuningContext(
                {
                  databaseName: request.databaseName,
                  statement: request.statement,
                  plan: { ...request.plan, mode: "analyze", allowExecution: true },
                  targetTables: request.targetTables,
                  tableAliasMap: request.tableAliasMap,
                },
                { signal: controller.signal }
              )
              .then((r) => {
                if (!r.ok || !r.result) {
                  throw new Error(r.message);
                }
                return r.result;
              }),
          true
        );

        if (this.secondaryExecutionController === controller) {
          this.secondaryExecutionController = undefined;
        }
        if (myGeneration !== this.renderGeneration) {
          // A newer preview replaced this one while the run was in flight -
          // never let a stale result land on top of it.
          return;
        }

        if (ok && result) {
          await this.renderSub(result);
          return;
        }

        window.showErrorMessage(`Failed to run EXPLAIN ANALYZE.${message ? ` ${message}` : ""}`);
        await this.postStopProgress();
      }
    );
  }

  // "Run Observed Read" - the DynamoDB counterpart of runActualPlan() above.
  // Actually reads real items (server-side, real I/O, capped at a single API
  // response / a small item count by db-drivers - see
  // DynamoDbExecutionMetaTracker/DYNAMODB_OBSERVED_READ_MAX_ITEMS) to measure
  // this statement's real Consumed Capacity and result shape. Same two-layer
  // confirmation as runActualPlan() (static warning text in the webview, plus
  // this modal). v1 only supports the PartiQL entry points (SQL History,
  // executed Notebook cells) - see DynamoDbPerformanceTuningPreviewRequest's
  // own doc comment for why the native-Query (Dynamo Query Panel) variant
  // isn't wired in yet.
  private async runObservedRead(): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.dynamoDbRequest || !this.observedReadCapability.available) {
      return;
    }
    const context = this.context;
    if (!context || !isDynamoDbPerformanceTuningContext(context)) {
      return;
    }
    if (!context.statement.observationEligibility.allowed) {
      void window.showErrorMessage(
        context.statement.observationEligibility.reason ??
          "Run Observed Read is not available for this statement."
      );
      return;
    }
    const request = this.dynamoDbRequest;

    const confirmed = await window.showWarningMessage(
      `This reads real items from "${request.connectionSetting.name}" (a single response, up to 100 items) to measure this statement's actual Consumed Capacity and result shape. Continue?`,
      { modal: true },
      "Run"
    );
    if (confirmed !== "Run") {
      await this.postStopProgress();
      return;
    }

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: "Running observed read...",
      },
      async (_progress, token) => {
        const controller = new AbortController();
        this.secondaryExecutionController = controller;
        token.onCancellationRequested(() => controller.abort());

        // partiql: no `parameters` - observationEligibility.allowed already
        // guarantees this statement's text has no unresolved `?` marker to
        // bind (§7.1/§7.4, Decision 1 of the design review). query: the
        // *real* QueryItemsAtClientInputParams (= QueryCommandInput,
        // ExpressionAttributeValues included) this.dynamoDbRequest already
        // holds - this is the one call in the whole flow that genuinely
        // needs real values, since it actually executes.
        const execution: DynamoDbPerformanceTuningCallOptions["execution"] =
          request.statement.request.kind === "partiql"
            ? { kind: "partiql" }
            : { kind: "query", input: request.statement.request.input };
        // The static `statement.request` sent alongside it, in contrast,
        // always uses the values-free mirror - same reasoning as
        // startDynamoDbPerformanceTuningPreview()'s own staticRequest.
        const staticRequest =
          request.statement.request.kind === "partiql"
            ? request.statement.request
            : { kind: "query" as const, input: toDynamoDbQueryAnalysisInput(request.statement.request.input) };

        const { ok, message, result } = await workflow<AwsDriver, DynamoDbPerformanceTuningContext>(
          request.connectionSetting,
          (driver) =>
            driver
              .getDynamoDbPerformanceTuningContext(
                {
                  statement: {
                    source: request.statement.source,
                    request: staticRequest,
                    workload: request.workload,
                  },
                  observation: { mode: "executeOnce", allowExecution: true },
                },
                { signal: controller.signal, execution }
              )
              .then((r) => {
                if (!r.ok || !r.result) {
                  throw new Error(r.message);
                }
                return r.result;
              }),
          true
        );

        if (this.secondaryExecutionController === controller) {
          this.secondaryExecutionController = undefined;
        }
        if (myGeneration !== this.renderGeneration) {
          return;
        }

        if (ok && result) {
          await this.renderSub(result);
          return;
        }

        window.showErrorMessage(`Failed to run observed read.${message ? ` ${message}` : ""}`);
        await this.postStopProgress();
      }
    );
  }

  private async runBenchmark(
    runs: BenchmarkRunCount,
    mode: "page" | "completeResult" = "page"
  ): Promise<void> {
    if (runs !== 3 && runs !== 5) {
      await this.postStopProgress();
      return;
    }
    if (this.context && isDynamoDbPerformanceTuningContext(this.context)) {
      await this.runDynamoDbBenchmark(runs, mode);
    } else {
      await this.runRdbBenchmark(runs);
    }
  }

  // Option A: collect one actual plan first, then execute the ordinary SELECT
  // N times. The instrumented EXPLAIN ANALYZE duration remains execution-plan
  // evidence and is never included in the benchmark distribution.
  private async runRdbBenchmark(runs: BenchmarkRunCount): Promise<void> {
    const myGeneration = this.renderGeneration;
    const request = this.request;
    const context = this.context;
    if (!request || !context || isDynamoDbPerformanceTuningContext(context) || !this.analyzedExecutionPlan.available) {
      await this.postStopProgress();
      return;
    }
    if (context.statement.analyzeEligibility?.allowed === false) {
      void window.showErrorMessage(context.statement.analyzeEligibility.reason ?? "Benchmark is limited to a single SELECT statement.");
      await this.postStopProgress();
      return;
    }
    const confirmed = await window.showWarningMessage(
      `This runs EXPLAIN ANALYZE once and then executes the SQL normally ${runs} times against "${request.connectionSetting.name}". All executions read real data. Continue?`,
      { modal: true },
      "Run Benchmark"
    );
    if (confirmed !== "Run Benchmark") {
      await this.postStopProgress();
      return;
    }

    await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: true, title: `Running benchmark (${runs} runs)...` },
      async (progress, token) => {
        const controller = new AbortController();
        this.secondaryExecutionController = controller;
        let driverForKill: RDSBaseDriver | undefined;
        token.onCancellationRequested(() => {
          controller.abort();
          void driverForKill?.kill();
        });
        const { ok, message, result } = await workflow<RDSBaseDriver, PerformanceTuningContext>(
          request.connectionSetting,
          async (driver) => {
            driverForKill = driver;
            progress.report({ message: "Collecting actual execution plan..." });
            const actual = await driver.getPerformanceTuningContext(
              {
                databaseName: request.databaseName,
                statement: request.statement,
                plan: { ...request.plan, mode: "analyze", allowExecution: true },
                targetTables: request.targetTables,
                tableAliasMap: request.tableAliasMap,
              },
              { signal: controller.signal }
            );
            if (!actual.ok || !actual.result) {
              throw new Error(actual.message);
            }
            const startedAt = new Date().toISOString();
            const samples: PerformanceTuningBenchmarkSample[] = [];
            for (let index = 0; index < runs; index += 1) {
              if (controller.signal.aborted) {
                throw new Error("Benchmark cancelled.");
              }
              progress.report({ message: `Running ordinary SELECT ${index + 1}/${runs}...` });
              const started = Date.now();
              const rdh = await driver.requestSql({
                sql: request.statement.sql,
                // QueryParams predates Performance Tuning and declares binds
                // as string[], while the plan path correctly retains typed
                // bind values. Preserve those runtime values exactly; do not
                // stringify numbers/nulls and accidentally benchmark a
                // different predicate.
                conditions: { binds: request.plan.binds as string[] | undefined },
                prepare: { useDatabaseName: request.databaseName },
              });
              samples.push({
                run: index + 1,
                clientElapsedTimeMs: Date.now() - started,
                returnedRowCount: rdh.summary?.selectedRows ?? rdh.rows.length,
              });
            }
            actual.result.benchmark = buildRdbBenchmarkSession({
              startedAt,
              completedAt: new Date().toISOString(),
              requestedRuns: runs,
              samples,
            });
            return actual.result;
          },
          true
        );
        if (this.secondaryExecutionController === controller) {
          this.secondaryExecutionController = undefined;
        }
        if (myGeneration !== this.renderGeneration) {
          return;
        }
        if (ok && result) {
          await this.renderSub(result);
          return;
        }
        window.showErrorMessage(`Failed to run benchmark.${message ? ` ${message}` : ""}`);
        await this.postStopProgress();
      }
    );
  }

  private async runDynamoDbBenchmark(
    runs: BenchmarkRunCount,
    mode: "page" | "completeResult"
  ): Promise<void> {
    const myGeneration = this.renderGeneration;
    const request = this.dynamoDbRequest;
    const context = this.context;
    if (!request || !context || !isDynamoDbPerformanceTuningContext(context) || !this.observedReadCapability.available) {
      await this.postStopProgress();
      return;
    }
    if (!context.statement.observationEligibility.allowed) {
      void window.showErrorMessage(context.statement.observationEligibility.reason ?? "Benchmark is not available for this statement.");
      await this.postStopProgress();
      return;
    }
    const completeResult = mode === "completeResult";
    const confirmed = await window.showWarningMessage(
      completeResult
        ? `This performs ${runs} real reads against "${request.connectionSetting.name}" and follows continuation tokens to complete each result, with hard safety limits of 10 pages, 1,000 evaluated items, and 30 seconds per run. Continue?`
        : `This performs ${runs} real, bounded reads against "${request.connectionSetting.name}" (one response, up to 100 evaluated items per run). Continue?`,
      { modal: true },
      "Run Benchmark"
    );
    if (confirmed !== "Run Benchmark") {
      await this.postStopProgress();
      return;
    }

    await window.withProgress(
      { location: ProgressLocation.Notification, cancellable: true, title: `Running DynamoDB benchmark (${runs} runs)...` },
      async (progress, token) => {
        const controller = new AbortController();
        this.secondaryExecutionController = controller;
        token.onCancellationRequested(() => controller.abort());
        const execution: DynamoDbPerformanceTuningCallOptions["execution"] =
          request.statement.request.kind === "partiql"
            ? { kind: "partiql" }
            : { kind: "query", input: request.statement.request.input };
        const staticRequest = request.statement.request.kind === "partiql"
          ? request.statement.request
          : { kind: "query" as const, input: toDynamoDbQueryAnalysisInput(request.statement.request.input) };

        const { ok, message, result } = await workflow<AwsDriver, DynamoDbPerformanceTuningContext>(
          request.connectionSetting,
          async (driver) => {
            progress.report({ message: `Running observed read 1/${runs} and collecting context...` });
            const first = await driver.getDynamoDbPerformanceTuningContext(
              {
                statement: { source: request.statement.source, request: staticRequest, workload: request.workload },
                observation: {
                  mode: completeResult ? "executeComplete" : "executeOnce",
                  allowExecution: true,
                  ...(completeResult
                    ? { maxPages: 10, maxEvaluatedItems: 1000, timeoutMs: 30_000 }
                    : {}),
                },
              },
              { signal: controller.signal, execution }
            );
            if (!first.ok || !first.result?.observation || first.result.observation.clientElapsedTimeMs === undefined) {
              throw new Error(first.message || "The first observed read did not return elapsed-time evidence.");
            }
            const startedAt = first.result.observation.observedAt ?? new Date().toISOString();
            const samples: DynamoDbBenchmarkSample[] = [
              {
                run: 1,
                clientElapsedTimeMs: first.result.observation.clientElapsedTimeMs,
                requestCount: first.result.observation.requestCount,
                retryCount: first.result.observation.retryCount,
                returnedItemCount: first.result.observation.returnedItemCount,
                evaluatedItemCount: first.result.observation.evaluatedItemCount,
                filterPassRate: first.result.observation.filterPassRate,
                consumedCapacity: first.result.observation.consumedCapacity,
                completeness: first.result.observation.completeness ?? (first.result.observation.bounded ? "bounded" : "complete"),
              },
            ];
            for (let index = 1; index < runs; index += 1) {
              if (controller.signal.aborted) {
                throw new Error("Benchmark cancelled.");
              }
              progress.report({ message: `Running observed read ${index + 1}/${runs}...` });
              const observed = completeResult
                ? execution.kind === "partiql"
                  ? await driver.dynamoClient.observePartiqlReadComplete({
                      statement:
                        request.statement.request.kind === "partiql"
                          ? request.statement.request.text
                          : "",
                      maxPages: 10,
                      timeoutMs: 30_000,
                      signal: controller.signal,
                    })
                  : await driver.dynamoClient.observeNativeQueryReadComplete({
                      input: execution.input,
                      maxPages: 10,
                      maxEvaluatedItems: 1000,
                      timeoutMs: 30_000,
                      signal: controller.signal,
                    })
                : execution.kind === "partiql"
                  ? await driver.dynamoClient.observePartiqlRead({
                      statement:
                        request.statement.request.kind === "partiql"
                          ? request.statement.request.text
                          : "",
                      maxEvaluatedItems: 100,
                      signal: controller.signal,
                    })
                  : await driver.dynamoClient.observeNativeQueryRead({
                      input: execution.input,
                      maxEvaluatedItems: 100,
                      signal: controller.signal,
                    });
              samples.push({
                run: index + 1,
                clientElapsedTimeMs: observed.clientElapsedTimeMs,
                requestCount: observed.requestCount,
                retryCount: observed.retryCount,
                returnedItemCount: observed.returnedItemCount,
                evaluatedItemCount: observed.scannedItemCount,
                filterPassRate:
                  observed.scannedItemCount !== undefined && observed.scannedItemCount > 0
                    ? observed.returnedItemCount / observed.scannedItemCount
                    : undefined,
                consumedCapacity: observed.capacityBreakdown,
                completeness: observed.hasMorePages ? "bounded" : "complete",
              });
            }
            first.result.benchmark = buildDynamoDbBenchmarkSession({
              startedAt,
              completedAt: new Date().toISOString(),
              requestedRuns: runs,
              samples,
              mode,
              ...(completeResult
                ? {
                    boundDescription:
                      "Complete-result Benchmark reached a safety limit (10 pages / 1,000 evaluated items / 30 seconds).",
                  }
                : {
                    boundDescription:
                      "Page Benchmark intentionally stops after one API response / 100 evaluated items.",
                  }),
            });
            return first.result;
          },
          true
        );
        if (this.secondaryExecutionController === controller) {
          this.secondaryExecutionController = undefined;
        }
        if (myGeneration !== this.renderGeneration) {
          return;
        }
        if (ok && result) {
          await this.renderSub(result);
          return;
        }
        window.showErrorMessage(`Failed to run benchmark.${message ? ` ${message}` : ""}`);
        await this.postStopProgress();
      }
    );
  }

  // Generic "clear whatever loading indicator you're showing" signal, same
  // BaseMessageEventDataCommand ScanPanel.ts/DynamoQueryPanel.ts etc. already
  // use for the identical purpose - the webview's own isRunningActualPlan/
  // isRunningObservedRead resets on this rather than needing a dedicated
  // command/payload just for "the run didn't succeed" (the error text itself
  // already went to window.showErrorMessage above, or there is none - a
  // user-declined confirmation is not an error).
  private async postStopProgress(): Promise<void> {
    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "stop-progress",
      componentName: "PerformanceTuningPreviewPanel",
      value: {},
    };
    await this.getWebviewPanel().webview.postMessage(msg);
  }

  private async postAnalysisUpdate(
    generation: number,
    analysis: PerformanceTuningAiAnalysisViewState,
    unavailableLanguageModelId?: string,
  ): Promise<void> {
    if (generation !== this.renderGeneration) {
      // Superseded by a newer preview - never let a stale analysis update
      // land on top of it (same reasoning as renderSub()'s own guard).
      return;
    }
    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "analysis-update",
      componentName: "PerformanceTuningPreviewPanel",
      value: { analysis, unavailableLanguageModelId },
    };
    await this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    this.analysisCancellationSource?.cancel();
    this.secondaryExecutionController?.abort();
    PerformanceTuningPreviewPanel.currentPanel = undefined;
  }
}
