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
import {
  buildDynamoDbAiAnalysisPrompt,
  buildDynamoDbPlainTextAnalysisPrompt,
} from "../utilities/dynamoDbPerformanceTuningAiPrompt";
import { buildDynamoDbPerformanceTuningDiagnosticGroups } from "../utilities/dynamoDbPerformanceTuningDiagnosticFormatter";
import { buildDynamoDbPerformanceTuningHumanSummary } from "../utilities/dynamoDbPerformanceTuningHumanSummary";
import { saveDynamoDbAiAnalysisAsNotebook } from "../utilities/dynamoDbPerformanceTuningNotebook";
import { buildDynamoDbNativeQueryViewModel } from "../utilities/dynamoDbNativeQueryDisplay";
import { toDynamoDbQueryAnalysisInput } from "../utilities/dynamoDbQueryAnalysisInput";
import { workflow } from "../utilities/driverResolver";
import { getErrorMessage } from "../utilities/errorUtil";
import { createCodeHtmlString } from "../utilities/highlighter";
import {
  buildTranslateResponseLabel,
  buildLanguageModelSelection,
  defaultTranslateResponse,
  isResponseTranslationAvailable,
  isModelNotSupportedError,
  MODEL_NOT_SUPPORTED_ERROR_MESSAGE,
} from "../utilities/lmModelSelection";
import {
  saveAiAnalysisAsNotebook,
  type PerformanceTuningReportInput,
} from "../utilities/performanceTuningAiNotebook";
import {
  buildAiAnalysisPrompt,
  buildPlainTextAnalysisPrompt,
} from "../utilities/performanceTuningAiPrompt";
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

// Reserve a small buffer for provider message framing not reflected by countTokens().
const AI_INPUT_TOKEN_SAFETY_MARGIN = 128;

// Captures the exact request, context detail, and baseline sent to the model.
type PreparedAiRequest = {
  messages: LanguageModelChatMessage[];
  compact: boolean;
  inputTokens: number;
  maxInputTokens: number;
  safetyMargin: number;
  comparison?: ComparisonAiInput;
  baseline?: PerformanceTuningBaselineSelection;
  evidence?: PerformanceTuningComparisonEvidence;
};

class AiInputLimitError extends Error {
  constructor(
    message: string,
    readonly tokenUsage?: PerformanceTuningAiTokenUsage,
    readonly contextDetail?: "full" | "compact",
    readonly comparisonDetail?: ComparisonAiInputDetail
  ) {
    super(message);
    this.name = "AiInputLimitError";
  }
}

/** Comparison state captured with the exact AI request that used it. */
type AnalysisComparisonSnapshot = {
  evidence: PerformanceTuningComparisonEvidence;
  baselineContext: AnyPerformanceTuningContext;
  aiInput: ComparisonAiInput;
};

// Host-side orchestration shared by relational and DynamoDB previews.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

  /** Builds one documented context/comparison projection for an AI request. */
  private comparisonAttempt(
    detail: ComparisonAiInputDetail,
    evidence: PerformanceTuningComparisonEvidence | undefined = this.comparison.evidence
  ): ComparisonAiInput | undefined {
    return evidence ? buildComparisonAiInput(evidence, detail) : undefined;
  }

  /** Orders request projections from full evidence to the smallest safe form. */
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
    evidence: PerformanceTuningComparisonEvidence | undefined
  ): Promise<PreparedAiRequest> {
    const maximum = model.maxInputTokens;
    if (!Number.isFinite(maximum) || maximum <= AI_INPUT_TOKEN_SAFETY_MARGIN) {
      throw new Error("The selected AI model does not report a usable input-token limit.");
    }

    let smallest:
      | {
          inputTokens: number;
          contextDetail: "full" | "compact";
          comparisonDetail: ComparisonAiInputDetail;
        }
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
        await Promise.all(messages.map((message) => model.countTokens(message, token)))
      ).reduce((total, count) => total + count, 0);
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
        ? `The selected model accepts at most ${maximum} input tokens, but even the smallest context and comparison require ${
            smallest?.inputTokens ?? "more"
          } tokens. Clear the baseline, or choose a model with a larger input window.`
        : `The selected model accepts at most ${maximum} input tokens, but even the compact performance context requires ${
            smallest?.inputTokens ?? "more"
          } tokens.`,
      smallest
        ? {
            inputTokens: smallest.inputTokens,
            maxInputTokens: maximum,
            safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          }
        : undefined,
      smallest?.contextDetail,
      smallest?.comparisonDetail
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
    evidence: PerformanceTuningComparisonEvidence | undefined
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
      | {
          inputTokens: number;
          contextDetail: "full" | "compact";
          comparisonDetail: ComparisonAiInputDetail;
        }
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
        await Promise.all(messages.map((message) => model.countTokens(message, token)))
      ).reduce((total, count) => total + count, 0);
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
        ? `The selected model accepts at most ${maximum} input tokens, but the smallest DynamoDB context and comparison still require ${
            smallest?.inputTokens ?? "more"
          } tokens. Clear the baseline, or choose a model with a larger input window.`
        : `The selected model accepts at most ${maximum} input tokens, but even the compact DynamoDB performance context requires ${
            smallest?.inputTokens ?? "more"
          } tokens.`,
      smallest
        ? {
            inputTokens: smallest.inputTokens,
            maxInputTokens: maximum,
            safetyMargin: AI_INPUT_TOKEN_SAFETY_MARGIN,
          }
        : undefined,
      smallest?.contextDetail,
      smallest?.comparisonDetail
    );
  }

  // Prevents asynchronous rendering or analysis from overwriting a newer context.
  private renderGeneration = 0;

  // The webview sends commands only; context and analysis remain host-side.
  private context: AnyPerformanceTuningContext | undefined;
  private lastAnalysis: PerformanceTuningAiAnalysisResult | undefined;
  private analysisCancellationSource: CancellationTokenSource | undefined;
  // Avoid retrying a model that the provider rejected during this panel session.
  private readonly unavailableLanguageModelIds = new Set<string>();

  // Baselines are immutable snapshots; comparison is always derived from baseline + context.
  private baseline: PerformanceTuningBaselineSelection | undefined;
  // Pinned at request-build time; see AnalysisComparisonSnapshot.
  private lastAnalysisComparison: AnalysisComparisonSnapshot | undefined;
  private comparison: PerformanceTuningComparisonViewState = { status: "idle" };
  // Remember the last folder for this panel without persisting an absolute path.
  private lastBaselineDirectory: Uri | undefined;
  // Identifies analyses made stale by a later baseline change.
  private analysisBaselineSha256: string | undefined;

  // Original requests stay host-side for confirmed reruns.
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

  // DynamoDB entry point for the shared preview shell.
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

    // Cancel work tied to the previous context before replacing it.
    this.analysisCancellationSource?.cancel();
    this.analysisCancellationSource = undefined;
    this.secondaryExecutionController?.abort();
    this.secondaryExecutionController = undefined;
    this.context = context;
    this.lastAnalysis = undefined;
    this.lastAnalysisComparison = undefined;
    this.analysisBaselineSha256 = undefined;
    // Rebuild comparison evidence because a rerun replaces the current side.
    this.rebuildComparison();

    if (isDynamoDbPerformanceTuningContext(context)) {
      await this.renderDynamoDbSub(context, myGeneration);
      return;
    }
    await this.renderRelationalSub(context, myGeneration);
  }

  private async renderRelationalSub(
    context: PerformanceTuningContext,
    myGeneration: number
  ): Promise<void> {
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    // Precompute external-AI prompts with the same comparison input as Copilot.
    const { plainTextPrompt, translatedPlainTextPrompt } = this.buildPlainTextPrompts()!;

    const [sqlHtml, jsonHtml, models] = await Promise.all([
      createCodeHtmlString({ code: context.statement.sql, lang: "sql" }),
      createCodeHtmlString({ code: contextJson, lang: "json" }),
      lm.selectChatModels({ vendor: "copilot" }),
    ]);

    if (myGeneration !== this.renderGeneration) {
      // A newer render superseded this asynchronous preparation.
      return;
    }

    const diagnosticGroups = buildPerformanceTuningDiagnosticGroups(
      context.collection.diagnostics,
      context.collection.unavailableSections
    );

    const planTreeText = context.executionPlan.normalizedPlan
      ? formatPlanTree(context.executionPlan.normalizedPlan)
      : undefined;
    const actualPlanDisplayText = formatActualPlanForDisplay(context.executionPlan.actualPlan);
    const planTableMappingRows = buildPlanTableMappingRows(context.planTableMappings);
    const humanSummary = buildPerformanceTuningHumanSummary(context);
    const queryDiagram = createPerformanceQueryDiagram(context);

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
          translateResponseLabel: buildTranslateResponseLabel(env.language),
          analyzedExecutionPlan: this.analyzedExecutionPlan,
          comparison: this.comparison,
        },
      },
    };
    this.getWebviewPanel().webview.postMessage(msg);
  }

  private async renderDynamoDbSub(
    context: DynamoDbPerformanceTuningContext,
    myGeneration: number
  ): Promise<void> {
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    const { plainTextPrompt, translatedPlainTextPrompt } = this.buildPlainTextPrompts()!;

    const [sqlHtml, jsonHtml, models] = await Promise.all([
      // Only PartiQL has SQL-like text to highlight.
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
      context.collection.unavailableSections
    );
    const humanSummary = buildDynamoDbPerformanceTuningHumanSummary(context);
    const accessPattern = buildDynamoDbAccessPatternViewModel(context.accessPattern);
    const nativeQuery =
      this.dynamoDbRequest?.statement.request.kind === "query"
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
          translateResponseLabel: buildTranslateResponseLabel(env.language),
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

  // Preserve the existing baseline when a replacement cannot be loaded.
  private async selectBaseline(): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context) {
      return;
    }
    this.comparison = { ...this.comparison, status: "loading", errorMessage: undefined };
    await this.postComparisonUpdate(myGeneration);

    const loaded = await promptForBaselineSelection({ lastDirectory: this.lastBaselineDirectory });
    if (myGeneration !== this.renderGeneration) {
      // A newer preview replaced this one while the dialog was open.
      return;
    }
    if (!loaded.ok) {
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

  /** Recomputes baseline evidence against the current context. */
  private rebuildComparison(): void {
    const baseline = this.baseline;
    if (!baseline || !this.context) {
      this.comparison = { status: "idle" };
      return;
    }
    const built = buildPerformanceTuningComparisonEvidence({ baseline, current: this.context });
    if (!built.ok) {
      // Fail closed instead of showing evidence derived from an incompatible context.
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

  /** True when the visible AI result used a different baseline. */
  private isAnalysisStale(): boolean {
    if (!this.lastAnalysis) {
      return false;
    }
    return this.analysisBaselineSha256 !== this.baseline?.source.contextSha256;
  }

  /** Builds full-detail external-AI prompts for the current baseline. */
  private buildPlainTextPrompts():
    | { plainTextPrompt: string; translatedPlainTextPrompt: string }
    | undefined {
    const context = this.context;
    if (!context) {
      return undefined;
    }
    const translateResponse = isResponseTranslationAvailable(env.language);
    const comparison = this.comparisonAttempt("full");
    if (isDynamoDbPerformanceTuningContext(context)) {
      return {
        plainTextPrompt: buildDynamoDbPlainTextAnalysisPrompt(context, { comparison }),
        translatedPlainTextPrompt: buildDynamoDbPlainTextAnalysisPrompt(context, {
          translateResponse,
          language: env.language,
          comparison,
        }),
      };
    }
    return {
      plainTextPrompt: buildPlainTextAnalysisPrompt(context, { comparison }),
      translatedPlainTextPrompt: buildPlainTextAnalysisPrompt(context, {
        translateResponse,
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

  // Runs one structured AI analysis against the currently rendered context.
  private async analyzeWithAi(languageModelId: string, translateResponse: boolean): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context) {
      return;
    }
    const context = this.context;
    // The webview normally sends false when the English-only control is
    // hidden. Enforce the locale policy host-side as well so no English UI
    // request can add a translation instruction from stale/tampered state.
    const effectiveTranslateResponse =
      translateResponse && isResponseTranslationAvailable(env.language);
    // Pin the baseline because controls remain interactive during model I/O.
    const baseline = this.baseline;
    const evidence = this.comparison.evidence;

    await this.postAnalysisUpdate(myGeneration, { status: "running" });

    // Bridge notification cancellation with context replacement and panel disposal.
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
          // Resolve the selected model again at send time.
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
                effectiveTranslateResponse,
                cts.token,
                baseline,
                evidence
              )
            : await this.buildMessagesWithinModelInputLimit(
                model,
                context,
                effectiveTranslateResponse,
                cts.token,
                baseline,
                evidence
              );
        } catch (e) {
          if (this.analysisCancellationSource === cts) {
            this.analysisCancellationSource = undefined;
          }
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: `The AI request could not fit this model's input limit: ${getErrorMessage(
              e
            )}`,
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
              model.id
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

        // Host code owns metadata fields that are not part of the model response.
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

        const recommendations = (
          Array.isArray(parsed.recommendations) ? parsed.recommendations : []
        ).map((r) => ({
          ...r,
          possibleDuplicateOfIndex: isDynamoDbPerformanceTuningContext(context)
            ? undefined
            : findPossibleDuplicateIndex(r?.suggestedQuery, context)?.matchedIndexName,
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
          // Duplicate-index detection is deterministic host-side RDB validation.
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
            translateResponse: effectiveTranslateResponse,
            language: env.language,
            contextDetail: compact ? "compact" : "full",
            tokenUsage: {
              inputTokens: prepared.inputTokens,
              maxInputTokens: prepared.maxInputTokens,
              safetyMargin: prepared.safetyMargin,
            },
            // Record the exact comparison projection sent to the model.
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
          // Discard a response for a superseded preview.
          return;
        }
        this.lastAnalysis = result;
        // Track the baseline actually sent, not the current control value.
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
        // Publish staleness now that an analysis exists.
        this.comparison = { ...this.comparison, analysisStale: this.isAnalysisStale() };
        await this.postComparisonUpdate(myGeneration);
      }
    );
  }

  // Saves a new engine-specific report under reports/performance-tuning/.
  private async saveAnalysisAsNotebook(): Promise<void> {
    const myGeneration = this.renderGeneration;
    const evidence = this.comparison.evidence;
    if (!this.context) {
      return;
    }
    const context = this.context;

    // Omit stale AI text while retaining deterministic comparison evidence.
    const analysisIsStale = this.isAnalysisStale();
    const analysis = analysisIsStale ? undefined : this.lastAnalysis;
    const analysisComparison = analysisIsStale ? undefined : this.lastAnalysisComparison;

    const comparison =
      evidence && this.baseline ? { evidence, baselineContext: this.baseline.context } : undefined;
    const input: PerformanceTuningReportInput = {
      analysis,
      comparison,
      // Preserve the exact Comparison Input that travelled with the request.
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

  // Executes confirmed SELECT-only EXPLAIN ANALYZE and replaces the current context.
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

  // Executes one confirmed, bounded DynamoDB read and replaces the current context.
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

        // Native Query values are supplied only to the execution path.
        const execution: DynamoDbPerformanceTuningCallOptions["execution"] =
          request.statement.request.kind === "partiql"
            ? { kind: "partiql" }
            : { kind: "query", input: request.statement.request.input };
        // Static collection receives a values-free request mirror.
        const staticRequest =
          request.statement.request.kind === "partiql"
            ? request.statement.request
            : {
                kind: "query" as const,
                input: toDynamoDbQueryAnalysisInput(request.statement.request.input),
              };

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
    if (
      !request ||
      !context ||
      isDynamoDbPerformanceTuningContext(context) ||
      !this.analyzedExecutionPlan.available
    ) {
      await this.postStopProgress();
      return;
    }
    if (context.statement.analyzeEligibility?.allowed === false) {
      void window.showErrorMessage(
        context.statement.analyzeEligibility.reason ??
          "Benchmark is limited to a single SELECT statement."
      );
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
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: `Running benchmark (${runs} runs)...`,
      },
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
    if (
      !request ||
      !context ||
      !isDynamoDbPerformanceTuningContext(context) ||
      !this.observedReadCapability.available
    ) {
      await this.postStopProgress();
      return;
    }
    if (!context.statement.observationEligibility.allowed) {
      void window.showErrorMessage(
        context.statement.observationEligibility.reason ??
          "Benchmark is not available for this statement."
      );
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
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: `Running DynamoDB benchmark (${runs} runs)...`,
      },
      async (progress, token) => {
        const controller = new AbortController();
        this.secondaryExecutionController = controller;
        token.onCancellationRequested(() => controller.abort());
        const execution: DynamoDbPerformanceTuningCallOptions["execution"] =
          request.statement.request.kind === "partiql"
            ? { kind: "partiql" }
            : { kind: "query", input: request.statement.request.input };
        const staticRequest =
          request.statement.request.kind === "partiql"
            ? request.statement.request
            : {
                kind: "query" as const,
                input: toDynamoDbQueryAnalysisInput(request.statement.request.input),
              };

        const { ok, message, result } = await workflow<AwsDriver, DynamoDbPerformanceTuningContext>(
          request.connectionSetting,
          async (driver) => {
            progress.report({
              message: `Running observed read 1/${runs} and collecting context...`,
            });
            const first = await driver.getDynamoDbPerformanceTuningContext(
              {
                statement: {
                  source: request.statement.source,
                  request: staticRequest,
                  workload: request.workload,
                },
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
            if (
              !first.ok ||
              !first.result?.observation ||
              first.result.observation.clientElapsedTimeMs === undefined
            ) {
              throw new Error(
                first.message || "The first observed read did not return elapsed-time evidence."
              );
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
                completeness:
                  first.result.observation.completeness ??
                  (first.result.observation.bounded ? "bounded" : "complete"),
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
    unavailableLanguageModelId?: string
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
