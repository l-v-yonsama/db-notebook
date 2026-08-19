import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  PerformanceTuningContext,
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
} from "vscode";
import { ActionCommand } from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import {
  PerformanceTuningAiAnalysisViewState,
  PerformanceTuningPreviewPanelEventData,
} from "../shared/MessageEventData";
import { PerformanceTuningAiAnalysisResult } from "../shared/PerformanceTuningAiAnalysis";
import { getErrorMessage } from "../utilities/errorUtil";
import { createCodeHtmlString } from "../utilities/highlighter";
import { buildLanguageModelSelection, defaultTranslateResponse } from "../utilities/lmModelSelection";
import { saveAiAnalysisAsNotebook } from "../utilities/performanceTuningAiNotebook";
import { buildAiAnalysisPrompt } from "../utilities/performanceTuningAiPrompt";
import { buildPerformanceTuningDiagnosticGroups } from "../utilities/performanceTuningDiagnosticFormatter";
import { buildPlanTableMappingRows, formatPlanTree } from "../utilities/performanceTuningPlanFormatter";
import { BasePanel } from "./BasePanel";

// "What would be sent" preview for getPerformanceTuningContext()'s result
// (推奨着手順 step 9a; diagnostic display per
// misc/design/performance-tuning-context-implementation-plan.ja.md §4.4/§10 Phase 5), plus
// Step 10's "Analyze with AI" flow
// (misc/design/performance-tuning-structured-ai-analysis-plan.ja.md §6). No
// literal masking (matches the design's §9.2 policy). Diagnostic
// grouping/copy is computed once here (buildPerformanceTuningDiagnosticGroups())
// rather than in the Vue component, so it stays unit-testable with the rest
// of this extension's vitest suite instead of needing a separate webview-ui
// test setup.
export class PerformanceTuningPreviewPanel extends BasePanel {
  public static currentPanel: PerformanceTuningPreviewPanel | undefined;

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

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    PerformanceTuningPreviewPanel.currentPanel = new PerformanceTuningPreviewPanel(
      panel,
      extensionUri
    );
  }

  public static render(extensionUri: Uri, context: PerformanceTuningContext) {
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
    this.context = context;
    this.lastAnalysis = undefined;

    // Computed here (not in the webview) so the number shown always matches
    // what RDSBaseDriver.enforcePayloadBudget() itself measured the result
    // against.
    const contextJson = JSON.stringify(context, null, 2);
    const payloadBytes = Buffer.byteLength(JSON.stringify(context), "utf8");

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
    const planTableMappingRows = buildPlanTableMappingRows(context.planTableMappings);

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
          planTableMappingRows,
          sqlHtml,
          jsonHtml,
          payloadBytes,
          maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
          languageModels,
          languageModelId: defaultLanguageModelId,
          translateResponse: defaultTranslateResponse(env.language),
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

        const prompt = buildAiAnalysisPrompt(context, { translateResponse, language: env.language });
        const messages = [
          LanguageModelChatMessage.Assistant(prompt.assistant),
          LanguageModelChatMessage.User(prompt.user),
        ];

        progress.report({ message: `Sending context to ${model.family}...` });

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
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
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
    PerformanceTuningPreviewPanel.currentPanel = undefined;
  }
}
