import {
  CapabilityStatus,
  DEFAULT_MAX_PAYLOAD_BYTES,
  PerformanceTuningContext,
  RDSBaseDriver,
  createPerformanceQueryDiagram,
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
  PerformanceTuningPreviewPanelEventData,
} from "../shared/MessageEventData";
import { PerformanceTuningAiAnalysisResult } from "../shared/PerformanceTuningAiAnalysis";
import { workflow } from "../utilities/driverResolver";
import { getErrorMessage } from "../utilities/errorUtil";
import { createCodeHtmlString } from "../utilities/highlighter";
import { buildLanguageModelSelection, defaultTranslateResponse } from "../utilities/lmModelSelection";
import { saveAiAnalysisAsNotebook } from "../utilities/performanceTuningAiNotebook";
import { buildAiAnalysisPrompt, buildPlainTextAnalysisPrompt } from "../utilities/performanceTuningAiPrompt";
import { buildPerformanceTuningDiagnosticGroups } from "../utilities/performanceTuningDiagnosticFormatter";
import { findPossibleDuplicateIndex } from "../utilities/performanceTuningIndexDuplication";
import { buildPerformanceTuningHumanSummary } from "../utilities/performanceTuningHumanSummary";
import {
  buildPlanTableMappingRows,
  formatActualPlanForDisplay,
  formatPlanTree,
} from "../utilities/performanceTuningPlanFormatter";
// Type-only: avoids a runtime circular import with performanceTuningPreview.ts,
// which imports this class (the value) the other way.
import type { PerformanceTuningPreviewRequest } from "../utilities/performanceTuningPreview";
import { BasePanel } from "./BasePanel";

// countTokens() is model-specific, but message framing added by the provider
// is not always visible in that count. Keep a small buffer so a request that
// is mathematically at the advertised boundary does not still fail at send.
const AI_INPUT_TOKEN_SAFETY_MARGIN = 128;

// Host-side state and orchestration for the Preview and AI analysis. Build
// user-facing diagnostic groups here so rendering stays simple and testable.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

  private async buildMessagesWithinModelInputLimit(
    model: LanguageModelChat,
    context: PerformanceTuningContext,
    translateResponse: boolean,
    token: CancellationTokenSource["token"],
  ): Promise<{ messages: LanguageModelChatMessage[]; compact: boolean }> {
    const maximum = model.maxInputTokens;
    if (!Number.isFinite(maximum) || maximum <= AI_INPUT_TOKEN_SAFETY_MARGIN) {
      throw new Error("The selected AI model does not report a usable input-token limit.");
    }

    let compactTokens: number | undefined;
    for (const contextDetail of ["full", "compact"] as const) {
      const prompt = buildAiAnalysisPrompt(context, {
        translateResponse,
        language: env.language,
        contextDetail,
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
        return { messages, compact: contextDetail === "compact" };
      }
      if (contextDetail === "compact") {
        compactTokens = inputTokens;
      }
    }

    throw new Error(
      `The selected model accepts at most ${maximum} input tokens, but even the compact performance context requires ${compactTokens ?? "more"} tokens.`,
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
  // already has.
  private context: PerformanceTuningContext | undefined;
  private lastAnalysis: PerformanceTuningAiAnalysisResult | undefined;
  private analysisCancellationSource: CancellationTokenSource | undefined;

  // "Run EXPLAIN ANALYZE" (2026-08-20 follow-up) - the original request
  // (everything getPerformanceTuningContext() needs besides plan.mode
  // itself) and this connection's static capability to even do it at all,
  // both set once by render() and reused by runActualPlan() below so the
  // webview never needs to send either back. Not reset by renderSub() (the
  // analyze-mode re-run's own render path) since both stay constant across
  // the estimate/analyze pair for the same preview.
  private request: PerformanceTuningPreviewRequest | undefined;
  private analyzedExecutionPlan: CapabilityStatus = { available: false };
  // AbortController, not a vscode.CancellationTokenSource, since it feeds
  // getPerformanceTuningContext()'s own `{signal}` option directly - same
  // bridge (`token.onCancellationRequested(() => controller.abort())`)
  // startPerformanceTuningPreview() itself already uses for the initial
  // (estimate-mode) collection.
  private actualPlanRunController: AbortController | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
      panel,
      extensionUri
    );
  }

  public static render(
    extensionUri: Uri,
    context: PerformanceTuningContext,
    request: PerformanceTuningPreviewRequest,
    analyzedExecutionPlan: CapabilityStatus
  ) {
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
    // Held for "Run EXPLAIN ANALYZE" (runActualPlan() below) - constant
    // across the initial (estimate-mode) preview and any later analyze-mode
    // re-run of it, so only the first render() call's values matter; a
    // later renderSub()-only re-render (the re-run itself) does not touch
    // either field.
    PerformanceTuningPreviewPanel.currentPanel.request = request;
    PerformanceTuningPreviewPanel.currentPanel.analyzedExecutionPlan = analyzedExecutionPlan;
    PerformanceTuningPreviewPanel.currentPanel.renderSub(context);
  }

  getComponentName(): ComponentName {
    return "PerformanceTuningPreviewPanel";
  }

  private async renderSub(context: PerformanceTuningContext): Promise<void> {
    const myGeneration = ++this.renderGeneration;

    // A new context invalidates any AI analysis in flight or already shown
    // for the previous one - cancel the in-flight request (if any) and
    // clear the stale result so a stray "Save as Notebook" can't save
    // analysis text for a SQL statement no longer on screen.
    this.analysisCancellationSource?.cancel();
    this.analysisCancellationSource = undefined;
    // A new context (a fresh preview, or this same preview's own analyze-mode
    // re-run replacing itself) invalidates a still-running EXPLAIN ANALYZE
    // the same way - never let a stale one's result land after this one.
    this.actualPlanRunController?.abort();
    this.actualPlanRunController = undefined;
    this.context = context;
    this.lastAnalysis = undefined;

    // Computed here (not in the webview) so the number shown always matches
    // what RDSBaseDriver.enforcePayloadBudget() itself measured the result
    // against.
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

    // "Copy Prompt for Other AI" (2026-08-21 follow-up): precomputed here,
    // like sqlHtml/jsonHtml below, so the toolbar button can copy it
    // instantly with no round-trip - it's a pure string build, not an actual
    // vscode.lm call, so there's nothing to await.
    const plainTextPrompt = buildPlainTextAnalysisPrompt(context);
    const translatedPlainTextPrompt = buildPlainTextAnalysisPrompt(context, {
      translateResponse: true,
      language: env.language,
    });

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
    // off only for an English display language, same as Chat2QueryPanel.ts/
    // LMPromptCreatePanel.ts.
    const { languageModels, defaultLanguageModelId } = buildLanguageModelSelection(models);

    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "initialize",
      componentName: "PerformanceTuningPreviewPanel",
      value: {
        initialize: {
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
    }
  }

  // Step 10 "Analyze with AI" (design doc §6.1/§7/§11). Builds the prompt
  // from the currently-rendered context (never re-fetched, never re-sent by
  // the webview), calls the model directly the same way lmUtil.ts's SQL
  // annotation feature does (vscode.lm, not a LanguageModelTool - this is a
  // single deterministic request/response, not a conversational tool call),
  // and posts the parsed structured result back. Never throws past this
  // method - every failure path ends in an "error" analysis-update instead.
  private async analyzeWithAi(languageModelId: string, translateResponse: boolean): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context) {
      return;
    }
    const context = this.context;

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
          // Chat2QueryPanel.ts/lmUtil.ts use, instead of the old hardcoded
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

        let messages: LanguageModelChatMessage[];
        let compact = false;
        try {
          progress.report({ message: `Checking input size for ${model.family}...` });
          const prepared = await this.buildMessagesWithinModelInputLimit(
            model,
            context,
            translateResponse,
            cts.token,
          );
          messages = prepared.messages;
          compact = prepared.compact;
        } catch (e) {
          if (this.analysisCancellationSource === cts) {
            this.analysisCancellationSource = undefined;
          }
          await this.postAnalysisUpdate(myGeneration, {
            status: "error",
            errorMessage: `The AI request could not fit this model's input limit: ${getErrorMessage(e)}`,
          });
          return;
        }

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

        const result: PerformanceTuningAiAnalysisResult = {
          formatVersion: 1,
          summary: typeof parsed.summary === "string" ? parsed.summary : "",
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          // possibleDuplicateOfIndex (2026-08-21 follow-up, summary.md's
          // Full Context improvement item 4) is host-computed here, never
          // trusted from the model's own JSON - a deterministic backstop
          // for the model's own duplicate-index self-check (prompt item 3),
          // independent of whether the model actually followed it.
          recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((r) => ({
            ...r,
            possibleDuplicateOfIndex: findPossibleDuplicateIndex(r?.suggestedSql, context)?.matchedIndexName,
          })),
          confidence:
            parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
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
          },
          generatedAt: new Date().toISOString(),
        };

        if (myGeneration !== this.renderGeneration) {
          // A newer preview replaced this one while the request was in flight -
          // don't let a stale result become the one "Save as Notebook" would save.
          return;
        }
        this.lastAnalysis = result;
        await this.postAnalysisUpdate(myGeneration, { status: "success", result });
      }
    );
  }

  // Step 10 "Save as Notebook" (design doc §8). Always creates a brand new
  // .dbn under reports/performance-tuning/ - never appends to an existing
  // Notebook, never prompts a save dialog (both decided with the user, §16.1).
  private async saveAnalysisAsNotebook(): Promise<void> {
    const myGeneration = this.renderGeneration;
    if (!this.context || !this.lastAnalysis) {
      return;
    }

    const result = await saveAiAnalysisAsNotebook(this.context, this.lastAnalysis);
    if (!result.ok) {
      window.showErrorMessage(result.message);
      return;
    }

    window.showInformationMessage(`Saved AI analysis to ${result.relativePath}`);

    if (myGeneration !== this.renderGeneration) {
      return;
    }
    await this.postAnalysisUpdate(myGeneration, {
      status: "success",
      result: this.lastAnalysis,
      savedNotebookRelativePath: result.relativePath,
    });
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
    const eligibility = this.context?.statement.analyzeEligibility;
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
        this.actualPlanRunController = controller;
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

        if (this.actualPlanRunController === controller) {
          this.actualPlanRunController = undefined;
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

  // Generic "clear whatever loading indicator you're showing" signal, same
  // BaseMessageEventDataCommand ScanPanel.ts/DynamoQueryPanel.ts etc. already
  // use for the identical purpose - the webview's own isRunningActualPlan
  // resets on this rather than needing a dedicated command/payload just for
  // "the run didn't succeed" (the error text itself already went to
  // window.showErrorMessage above, or there is none - a user-declined
  // confirmation is not an error).
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
    analysis: PerformanceTuningAiAnalysisViewState
  ): Promise<void> {
    if (generation !== this.renderGeneration) {
      // Superseded by a newer preview - never let a stale analysis update
      // land on top of it (same reasoning as renderSub()'s own guard).
      return;
    }
    const msg: PerformanceTuningPreviewPanelEventData = {
      command: "analysis-update",
      componentName: "PerformanceTuningPreviewPanel",
      value: { analysis },
    };
    await this.getWebviewPanel().webview.postMessage(msg);
  }

  protected preDispose(): void {
    this.analysisCancellationSource?.cancel();
    this.actualPlanRunController?.abort();
    PerformanceTuningPreviewPanel.currentPanel = undefined;
  }
}
