import {
  DBType,
  RPCDriver,
  parseRpcRequestMetadata,
  RpcMethod,
  RpcService,
  RpcStreamSession,
  RpcStreamEvent,
  RpcInvokeError,
  UnaryResult,
  buildRpcRequestTemplate,
  buildRpcResponseDescription,
  getRpcCallKind,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { randomUUID } from "crypto";
import dayjs from "dayjs";
import * as path from "path";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import {
  ActionCommand,
  InvokeRpcActionCommand,
  StartRpcStreamActionCommand,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { RpcInvokePanelEventData } from "../shared/MessageEventData";
import { RpcInvokeRequest, RpcInvokeRestoration, RpcInvokeTarget } from "../shared/RpcInvokePanelParams";
import { ResourceTreeProvider } from "../treeData/resource/ResourceTreeProvider";
import { createDriver, removeDriver, workflow } from "../utilities/driverResolver";
import { createCodeHtmlString, createCodeHtmlStringSync } from "../utilities/highlighter";
import { StateStorage } from "../utilities/StateStorage";
import { RpcInvokeHistoryAttempt, RpcInvokeHistoryStore } from "../utilities/RpcInvokeHistoryStore";
import { RpcHistoryRequestCapture } from "../utilities/RpcHistoryRequestCapture";
import { log } from "../utilities/logger";
import { createHtmlFromRpcResult } from "../utilities/html/htmlGenerator";
import { RPC_CAPTURE_BYTES, RPC_CAPTURE_LIMIT, redactRpcToken } from "../utilities/rpcExecution";
import type { RpcNotebookResult } from "../shared/RunResultMetadata";
import { BasePanel } from "./BasePanel";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export class RpcInvokePanel extends BasePanel {
  private static currentPanel: RpcInvokePanel | undefined;
  private static historyStore: RpcInvokeHistoryStore | undefined;

  static setHistoryStore(store: RpcInvokeHistoryStore | undefined): void {
    this.historyStore = store;
  }

  private static async recordHistory(history: RpcInvokeHistoryAttempt): Promise<void> {
    try {
      await this.historyStore?.add(history);
    } catch {
      log("[RpcInvokePanel] RPC history save failed");
    }
  }
  private method?: RpcMethod;
  private target?: RpcInvokeTarget;
  private selectionVersion = 0;
  private inProgress = false;
  private startingStream = false;
  private activeStream?: RpcStreamSession;
  private streamCleanup?: () => Promise<string | undefined>;
  private streamSessionId?: string;
  private streamAbort?: AbortController;
  private streamSequence = 0;
  private streamToken?: string;
  private disposed = false;
  private reportTarget?: RpcInvokeTarget;
  private reportRequestJson?: string;
  private reportMetadataJson = "{}";
  private reportResult?: RpcNotebookResult;
  private reportEvents: RpcStreamEvent[] = [];
  private reportHeaders?: Record<string, string[]>;
  private reportBytes = 0;
  private reportDroppedReceived = 0;
  private reportDroppedSent = 0;
  private streamRequestCapture?: RpcHistoryRequestCapture;
  private readonly pendingStreamSends = new Set<Promise<void>>();
  private streamSendQueue: Promise<void> = Promise.resolve();

  private constructor(
    panel: WebviewPanel,
    extensionUri: Uri,
    private readonly stateStorage: StateStorage,
    private readonly tree: ResourceTreeProvider
  ) {
    super(panel, extensionUri);
  }

  static render(
    extensionUri: Uri,
    stateStorage: StateStorage,
    tree: ResourceTreeProvider,
    method: RpcMethod,
    service: RpcService,
    connectionName: string,
    restoration?: RpcInvokeRestoration
  ): void {
    if (!this.currentPanel) {
      const panel = window.createWebviewPanel(
        "RpcInvokePanelViewType",
        "Invoke RPC",
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
      this.currentPanel = new RpcInvokePanel(panel, extensionUri, stateStorage, tree);
    } else {
      this.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    }
    this.currentPanel.selectMethod(method, service, connectionName, restoration);
  }

  getComponentName(): ComponentName {
    return "RpcInvokePanel";
  }

  protected preDispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearReport();
    this.streamAbort?.abort();
    if (this.activeStream) {
      this.activeStream.cancel();
      void this.streamCleanup?.();
    }
    RpcInvokePanel.currentPanel = undefined;
  }

  private createStreamCleanup(driver: RPCDriver): () => Promise<string | undefined> {
    let task: Promise<string | undefined> | undefined;
    return () => {
      if (!task) {
        task = (async () => {
          try {
            return (await driver.disconnect()) || undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          } finally {
            removeDriver(driver);
          }
        })();
      }
      return task;
    };
  }

  private selectMethod(
    method: RpcMethod,
    service: RpcService,
    connectionName: string,
    restoration?: RpcInvokeRestoration
  ): void {
    if (this.startingStream || this.activeStream) {
      void this.post({
        command: "streamError",
        value: {
          streamError: {
            sessionId: this.streamSessionId,
            error: "Finish or cancel the active stream before selecting another method.",
          },
        },
      });
      return;
    }
    this.selectionVersion += 1;
    this.clearReport();
    this.inProgress = false;
    this.method = method;
    const context = this.tree.getLoadedRpcMethodContext(method);
    const definitions = context?.database?.messageDefinitions ?? [];
    const requestView = buildRpcRequestTemplate(method, definitions);
    const responseDescription = buildRpcResponseDescription(method, definitions);
    this.target = {
      connectionName,
      service: service.fullName,
      method: method.name,
      path: method.path,
      inputType: method.inputType,
      outputType: method.outputType,
      discovery: service.discovery,
      requestStream: method.requestStream,
      responseStream: method.responseStream,
      requestTemplate: requestView.data,
      ...(restoration && {
        restoredRequestJson: restoration.requestJson,
        restoredMetadataJson: restoration.requestMetadata
          ? JSON.stringify(restoration.requestMetadata, null, 2)
          : undefined,
        autoInvoke: restoration.autoInvoke,
        restoreId: randomUUID(),
      }),
      requestDescription: requestView.description,
      responseDescription,
      requestDescriptionHtml: createCodeHtmlStringSync({
        code: requestView.description,
        lang: "protobuf",
      }),
      responseDescriptionHtml: createCodeHtmlStringSync({
        code: responseDescription,
        lang: "protobuf",
      }),
    };
    void this.post({ command: "initialize", value: { initialize: this.target } });
  }

  private post(message: Omit<RpcInvokePanelEventData, "componentName">): PromiseLike<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    return this.panel.webview.postMessage({ ...message, componentName: "RpcInvokePanel" });
  }

  private clearReport(): void {
    this.reportTarget = undefined;
    this.reportRequestJson = undefined;
    this.reportMetadataJson = "{}";
    this.reportResult = undefined;
    this.reportEvents = [];
    this.reportHeaders = undefined;
    this.reportBytes = 0;
    this.reportDroppedReceived = 0;
    this.reportDroppedSent = 0;
    void this.post({ command: "reportAvailable", value: { reportAvailable: false } });
  }

  private finishReport(result: RpcNotebookResult): void {
    this.reportResult = result;
    void this.post({ command: "reportAvailable", value: { reportAvailable: true } });
  }

  private retainReportEvent(event: RpcStreamEvent): void {
    if (event.type === "headers") {
      this.reportHeaders = event.headers;
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    this.reportEvents.push(event);
    this.reportBytes += bytes;
    while (this.reportEvents.length > RPC_CAPTURE_LIMIT || this.reportBytes > RPC_CAPTURE_BYTES) {
      const removed = this.reportEvents.shift()!;
      this.reportBytes -= Buffer.byteLength(JSON.stringify(removed), "utf8");
      if (removed.type === "sent") {
        this.reportDroppedSent++;
      } else {
        this.reportDroppedReceived++;
      }
    }
  }

  private async outputHtml(): Promise<void> {
    const target = this.reportTarget;
    const result = this.reportResult;
    if (!target || !result || this.startingStream || this.activeStream) {
      return;
    }
    const requestJson = target.requestStream
      ? JSON.stringify(
          this.reportEvents.filter((event) => event.type === "sent").map((event) => event.contents),
          null,
          2
        )
      : this.reportRequestJson ?? "{}";
    const selectionVersion = this.selectionVersion;
    const previousFolder = await this.stateStorage.getPreviousSaveFolder();
    const baseUri = previousFolder ? Uri.file(previousFolder) : Uri.file("./");
    const filename = `${dayjs().format("MMDD_HHmm")}_${target.method}.html`;
    const uri = await window.showSaveDialog({
      defaultUri: Uri.joinPath(baseUri, filename),
      filters: { "*": ["html"] },
    });
    if (!uri || selectionVersion !== this.selectionVersion || result !== this.reportResult) {
      return;
    }
    await this.stateStorage.setPreviousSaveFolder(path.dirname(uri.fsPath));
    const message = await createHtmlFromRpcResult(
      target,
      requestJson,
      result,
      uri.fsPath,
      this.reportDroppedSent,
      this.reportMetadataJson
    );
    if (message) {
      window.showErrorMessage(message);
    } else {
      window.showInformationMessage(uri.fsPath);
    }
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    if (message.command === "cancel") {
      this.dispose();
      return;
    }
    if (message.command === "ready") {
      if (this.target) {
        await this.post({ command: "initialize", value: { initialize: this.target } });
      }
      await this.post({
        command: "reportAvailable",
        value: { reportAvailable: !!this.reportResult },
      });
      if (this.streamSessionId) {
        if (this.activeStream) {
          await this.post({
            command: "streamStarted",
            value: {
              streamStarted: { sessionId: this.streamSessionId, kind: this.activeStream.kind },
            },
          });
        } else if (this.startingStream) {
          await this.post({
            command: "streamConnecting",
            value: { streamConnecting: { sessionId: this.streamSessionId } },
          });
        }
      }
      return;
    }
    if (message.command === "invokeRpc") {
      await this.invoke(message.params);
    } else if (message.command === "startRpcStream") {
      await this.startStream(message.params);
    } else if (message.command === "sendRpcStreamMessage") {
      await this.sendStreamMessage(message.params.sessionId, message.params.requestJson);
    } else if (message.command === "finishRpcStreamSending") {
      await this.finishStreamSending(message.params.sessionId);
    } else if (message.command === "cancelRpcStream") {
      this.cancelStream(message.params.sessionId);
    } else if (message.command === "outputRpcHtml") {
      await this.outputHtml();
    }
  }

  private validateRequest(
    params: InvokeRpcActionCommand["params"],
    streaming = false
  ): { error: string } | { request: RpcInvokeRequest } {
    const target = this.target;
    const method = this.method;
    if (!target || !method) {
      return { error: "Select an RPC method." };
    }
    if (
      !isObject(params) ||
      params.connectionName !== target.connectionName ||
      params.service !== target.service ||
      params.method !== target.method ||
      typeof params.requestJson !== "string"
    ) {
      return { error: "Invalid RPC request or metadata." };
    }
    try {
      parseRpcRequestMetadata(params.metadata);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    const current = this.tree.getLoadedRpcMethodContext(method);
    if (
      !current ||
      current.connection.name !== target.connectionName ||
      current.service.fullName !== target.service ||
      method.path !== target.path ||
      (streaming
        ? !method.requestStream && !method.responseStream
        : method.requestStream || method.responseStream)
    ) {
      return { error: "The RPC schema has changed. Reload the tree and select the method again." };
    }
    if (!method.requestStream) {
      try {
        if (!isObject(JSON.parse(params.requestJson))) {
          return { error: "RPC request must be a JSON object." };
        }
      } catch {
        return { error: "RPC request must be valid JSON." };
      }
    }
    return { request: params };
  }

  private async invoke(params: InvokeRpcActionCommand["params"]): Promise<void> {
    if (this.inProgress || this.startingStream || this.activeStream) {
      return;
    }
    this.clearReport();
    const validated = this.validateRequest(params);
    if ("error" in validated) {
      await this.post({ command: "error", value: { error: validated.error } });
      return;
    }
    const version = this.selectionVersion;
    const path = this.target!.path;
    this.reportTarget = this.target;
    this.reportRequestJson = validated.request.requestJson;
    this.reportMetadataJson = JSON.stringify(validated.request.metadata ?? {}, null, 2);
    this.inProgress = true;
    let token: string | undefined;
    let history: RpcInvokeHistoryAttempt | undefined;
    let recorded = false;
    let invokeError: RpcInvokeError | undefined;
    try {
      const setting = await this.stateStorage.getConnectionSettingByName(
        validated.request.connectionName
      );
      if (!setting || setting.dbType !== DBType.RPC) {
        throw new Error("The RPC connection setting could not be found.");
      }
      token =
        setting.rpc?.authentication?.type === "bearer"
          ? setting.rpc.authentication.token
          : undefined;
      const requestCapture = new RpcHistoryRequestCapture(false);
      requestCapture.add(validated.request.requestJson);
      history = {
        connectionName: validated.request.connectionName,
        service: validated.request.service,
        method: validated.request.method,
        path,
        callKind: "unary",
        startedAt: Date.now(),
        totalElapsedMs: 0,
        sentCount: 0,
        receivedCount: 0,
        outcome: "error",
        requestCapture,
        ...(validated.request.metadata && Object.keys(validated.request.metadata).length > 0 && {
          requestMetadata: validated.request.metadata,
        }),
      };
      let sent = false;
      const { ok, message, result } = await workflow<RPCDriver, UnaryResult<unknown>>(
        setting,
        async (driver) => {
          sent = true;
          try {
            return await driver.invokeUnaryProtoJson({
              service: validated.request.service,
              method: validated.request.method,
              requestJson: validated.request.requestJson,
              metadata: validated.request.metadata,
            });
          } catch (error) {
            if (error instanceof RpcInvokeError) {
              invokeError = error;
            }
            throw error;
          }
        },
        false
      );
      history.totalElapsedMs = Date.now() - history.startedAt;
      history.sentCount = ok && result ? 1 : sent ? 1 : 0;
      history.receivedCount = ok && result ? 1 : 0;
      history.outcome = ok && result ? "success" : invokeError?.status?.code === 4 ? "timeout" : "error";
      if (ok && result) {
        history.grpcStatus = { code: result.status.code, name: result.status.name };
      } else if (invokeError?.status) {
        history.grpcStatus = { code: invokeError.status.code, name: invokeError.status.name };
      }
      recorded = true;
      await RpcInvokePanel.recordHistory(history);
      if (version !== this.selectionVersion) {
        return;
      }
      if (!ok || !result) {
        throw invokeError ?? new Error(message || "RPC invocation failed.");
      }
      this.finishReport({
        version: 1,
        kind: "response",
        cellId: randomUUID(),
        outcome: "success",
        status: { code: result.status.code, name: result.status.name },
        elapsedMs: result.elapsedMs,
        sentCount: 1,
        receivedCount: 1,
        contents: result.contents,
        headers: result.headers,
        trailers: result.trailers,
      });
      const [contentsHtml, headersHtml, trailersHtml] = await Promise.all([
        createCodeHtmlString({ code: JSON.stringify(result.contents, null, 2), lang: "json" }),
        result.headers
          ? createCodeHtmlString({ code: JSON.stringify(result.headers, null, 2), lang: "json" })
          : undefined,
        result.trailers
          ? createCodeHtmlString({ code: JSON.stringify(result.trailers, null, 2), lang: "json" })
          : undefined,
      ]);
      if (version !== this.selectionVersion) {
        return;
      }
      await this.post({
        command: "result",
        value: {
          result: {
            status: { ...result.status, details: redactRpcToken(result.status.details, token) },
            elapsedMs: result.elapsedMs,
            contentsHtml,
            headersHtml,
            trailersHtml,
          },
        },
      });
    } catch (error) {
      if (history && !recorded) {
        history.totalElapsedMs = Date.now() - history.startedAt;
        await RpcInvokePanel.recordHistory(history);
      }
      if (version !== this.selectionVersion) {
        return;
      }
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (history?.sentCount && !this.reportResult) {
        const status = error instanceof RpcInvokeError ? error.status : undefined;
        this.finishReport({
          version: 1,
          kind: "response",
          cellId: randomUUID(),
          outcome: status?.code === 4 ? "timeout" : "error",
          status: status ? { code: status.code, name: status.name } : undefined,
          elapsedMs: Date.now() - history.startedAt,
          receivedCount: 0,
          error: redactRpcToken(rawMessage, token),
        });
      }
      await this.post({
        command: "error",
        value: { error: redactRpcToken(rawMessage, token) },
      });
    } finally {
      if (version === this.selectionVersion) {
        this.inProgress = false;
      }
    }
  }

  private async startStream(params: StartRpcStreamActionCommand["params"]): Promise<void> {
    if (this.disposed || this.inProgress || this.startingStream || this.activeStream) {
      return;
    }
    this.clearReport();
    const validated = this.validateRequest(params, true);
    if ("error" in validated) {
      await this.post({
        command: "streamError",
        value: { streamError: { error: validated.error } },
      });
      return;
    }
    const version = this.selectionVersion;
    this.reportTarget = this.target;
    this.reportMetadataJson = JSON.stringify(validated.request.metadata ?? {}, null, 2);
    if (!this.method?.requestStream) {
      this.reportRequestJson = validated.request.requestJson;
    }
    const requestStream = this.method?.requestStream === true;
    const abort = new AbortController();
    this.streamAbort = abort;
    this.startingStream = true;
    const sessionId = randomUUID();
    this.streamSessionId = sessionId;
    let token: string | undefined;
    let cleanup: (() => Promise<string | undefined>) | undefined;
    let handedOff = false;
    let history: RpcInvokeHistoryAttempt | undefined;
    try {
      await this.post({
        command: "streamConnecting",
        value: { streamConnecting: { sessionId } },
      });
      const setting = await this.stateStorage.getConnectionSettingByName(
        validated.request.connectionName
      );
      if (!setting || setting.dbType !== DBType.RPC) {
        throw new Error("The RPC connection setting could not be found.");
      }
      token =
        setting.rpc?.authentication?.type === "bearer"
          ? setting.rpc.authentication.token
          : undefined;
      this.streamToken = token;
      const method = this.method!;
      const requestCapture = new RpcHistoryRequestCapture(requestStream);
      if (!requestStream) {
        requestCapture.add(validated.request.requestJson);
      }
      history = {
        connectionName: validated.request.connectionName,
        service: validated.request.service,
        method: validated.request.method,
        path: this.target!.path,
        callKind: getRpcCallKind(method),
        startedAt: Date.now(),
        totalElapsedMs: 0,
        sentCount: 0,
        receivedCount: 0,
        outcome: "error",
        requestCapture,
        ...(validated.request.metadata && Object.keys(validated.request.metadata).length > 0 && {
          requestMetadata: validated.request.metadata,
        }),
      };
      if (abort.signal.aborted) {
        throw new Error("RPC stream start cancelled.");
      }
      const driver = await createDriver<RPCDriver>(setting, false);
      cleanup = this.createStreamCleanup(driver);
      this.streamCleanup = cleanup;
      if (abort.signal.aborted) {
        throw new Error("RPC stream start cancelled.");
      }
      const connectError = await driver.connect();
      if (connectError) {
        throw new Error(connectError);
      }
      if (abort.signal.aborted) {
        throw new Error("RPC stream start cancelled.");
      }
      const session = driver.openProtoJsonStream({
        service: validated.request.service,
        method: validated.request.method,
        requestJson: requestStream ? undefined : validated.request.requestJson,
        metadata: validated.request.metadata,
      });
      if (this.disposed || abort.signal.aborted || version !== this.selectionVersion) {
        session.cancel();
        throw new Error("RPC stream start cancelled.");
      }
      this.activeStream = session;
      this.streamRequestCapture = requestCapture;
      this.streamSendQueue = Promise.resolve();
      history.sentCount = requestStream ? 0 : 1;
      this.streamSequence = 0;
      this.startingStream = false;
      await this.post({
        command: "streamStarted",
        value: { streamStarted: { sessionId, kind: session.kind } },
      });
      handedOff = true;
      void this.watchStream(session, sessionId, cleanup, history, token);
    } catch (error) {
      if (this.activeStream) {
        this.activeStream.cancel();
        this.activeStream = undefined;
      }
      const cleanupError = await cleanup?.();
      if (history) {
        history.outcome = abort.signal.aborted ? "cancelled" : "error";
        history.totalElapsedMs = Date.now() - history.startedAt;
        await RpcInvokePanel.recordHistory(history);
      }
      this.streamRequestCapture = undefined;
      if (!this.disposed && version === this.selectionVersion) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = `${raw}${cleanupError ? `; disconnect: ${cleanupError}` : ""}`;
        await this.post({
          command: "streamError",
          value: { streamError: { error: redactRpcToken(message, token) } },
        });
      }
    } finally {
      this.startingStream = false;
      if (!handedOff) {
        await cleanup?.();
        if (this.streamCleanup === cleanup) {
          this.streamCleanup = undefined;
        }
        this.streamAbort = undefined;
        this.streamSessionId = undefined;
        this.streamToken = undefined;
      }
    }
  }

  private async watchStream(
    session: RpcStreamSession,
    sessionId: string,
    cleanup: () => Promise<string | undefined>,
    history: RpcInvokeHistoryAttempt,
    token?: string
  ): Promise<void> {
    let eventError: unknown;
    const events = (async () => {
      for await (const event of session.events) {
        if (this.disposed || this.streamSessionId !== sessionId) {
          continue;
        }
        this.retainReportEvent(event);
        this.streamSequence += 1;
        await this.post({
          command: "streamEvent",
          value: { streamEvent: { sessionId, sequence: this.streamSequence, event } },
        });
      }
    })().catch(async (error) => {
      eventError = error;
      session.cancel();
    });
    let completion: Awaited<RpcStreamSession["completion"]> | undefined;
    let streamError: unknown;
    let cleanupError: string | undefined;
    try {
      completion = await session.completion;
      await events;
      if (eventError) {
        streamError = eventError;
      }
    } catch (error) {
      streamError = error;
      session.cancel();
    } finally {
      cleanupError = await cleanup();
      if (this.activeStream === session) {
        this.activeStream = undefined;
        this.streamAbort = undefined;
      }
      if (this.streamCleanup === cleanup) {
        this.streamCleanup = undefined;
      }
    }
    history.totalElapsedMs = Date.now() - history.startedAt;
    history.sentCount =
      completion?.sentCount ??
      Math.max(
        history.sentCount,
        ...this.reportEvents.filter((event) => event.type === "sent").map((event) => event.index)
      );
    history.receivedCount =
      completion?.receivedCount ??
      Math.max(
        history.receivedCount,
        ...this.reportEvents
          .filter((event) => event.type === "received")
          .map((event) => event.index)
      );
    history.outcome = streamError ? "error" : completion?.outcome ?? "error";
    if (completion?.status) {
      history.grpcStatus = { code: completion.status.code, name: completion.status.name };
    }
    await Promise.allSettled([...this.pendingStreamSends]);
    await RpcInvokePanel.recordHistory(history);
    if (this.streamSessionId === sessionId) {
      this.streamRequestCapture = undefined;
    }
    if (!this.disposed && this.streamSessionId === sessionId && this.reportTarget) {
      const received = this.reportEvents.filter(
        (event): event is Extract<RpcStreamEvent, { type: "received" }> => event.type === "received"
      );
      const issue = streamError ?? completion?.error;
      const rawError =
        issue instanceof Error ? issue.message : issue ? String(issue) : cleanupError;
      this.finishReport({
        version: 1,
        kind: "response",
        cellId: randomUUID(),
        outcome: history.outcome,
        status: history.grpcStatus,
        elapsedMs: completion?.elapsedMs ?? history.totalElapsedMs,
        sentCount: history.sentCount,
        receivedCount: history.receivedCount,
        messages: received.map((event) => ({
          index: event.index,
          at: event.at,
          contents: event.contents,
        })),
        headers: this.reportHeaders,
        trailers: completion?.trailers,
        droppedCount: this.reportDroppedReceived,
        error: rawError ? redactRpcToken(rawError, token) : undefined,
      });
    }
    if (!this.disposed && this.streamSessionId === sessionId) {
      if (completion) {
        const safeCompletion = {
          ...completion,
          error: undefined,
          cleanupError: cleanupError ? redactRpcToken(cleanupError, token) : undefined,
          status: completion.status
            ? { ...completion.status, details: redactRpcToken(completion.status.details, token) }
            : undefined,
        };
        await this.post({
          command: "streamCompleted",
          value: { streamCompleted: { sessionId, completion: safeCompletion } },
        });
      }
      const issue = streamError ?? completion?.error;
      if (issue || cleanupError) {
        const raw = issue instanceof Error ? issue.message : issue ? String(issue) : cleanupError!;
        await this.post({
          command: "streamError",
          value: { streamError: { sessionId, error: redactRpcToken(raw, token) } },
        });
      }
    }
    if (this.streamSessionId === sessionId && !this.activeStream) {
      this.streamSessionId = undefined;
      this.streamToken = undefined;
    }
  }

  private async sendStreamMessage(sessionId: string, requestJson: string): Promise<void> {
    const session = this.activeStream;
    if (!session || this.streamSessionId !== sessionId || !session.send) {
      return;
    }
    const sendTask = this.streamSendQueue.then(async () => {
      await session.send!(requestJson);
      if (this.streamSessionId === sessionId) {
        this.streamRequestCapture?.add(requestJson);
      }
    });
    this.streamSendQueue = sendTask.catch(() => undefined);
    this.pendingStreamSends.add(sendTask);
    try {
      await sendTask;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      await this.post({
        command: "streamError",
        value: { streamError: { sessionId, error: redactRpcToken(raw, this.streamToken) } },
      });
    } finally {
      this.pendingStreamSends.delete(sendTask);
    }
  }

  private async finishStreamSending(sessionId: string): Promise<void> {
    const session = this.activeStream;
    if (!session || this.streamSessionId !== sessionId || !session.finishSending) {
      return;
    }
    try {
      await Promise.allSettled([...this.pendingStreamSends]);
      await session.finishSending();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      await this.post({
        command: "streamError",
        value: { streamError: { sessionId, error: redactRpcToken(raw, this.streamToken) } },
      });
    }
  }

  private cancelStream(sessionId: string): void {
    if (this.streamSessionId !== sessionId) {
      return;
    }
    if (this.activeStream) {
      this.activeStream.cancel();
    } else if (this.startingStream) {
      this.streamAbort?.abort();
    }
  }
}
