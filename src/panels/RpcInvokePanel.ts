import {
  DBType,
  RPCDriver,
  RpcMethod,
  RpcService,
  RpcStreamSession,
  UnaryResult,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { randomUUID } from "crypto";
import { Uri, ViewColumn, WebviewPanel, window } from "vscode";
import {
  ActionCommand,
  InvokeRpcActionCommand,
  StartRpcStreamActionCommand,
} from "../shared/ActionParams";
import { ComponentName } from "../shared/ComponentName";
import { RpcInvokePanelEventData } from "../shared/MessageEventData";
import { RpcInvokeRequest, RpcInvokeTarget } from "../shared/RpcInvokePanelParams";
import { ResourceTreeProvider } from "../treeData/resource/ResourceTreeProvider";
import { createDriver, removeDriver, workflow } from "../utilities/driverResolver";
import { createCodeHtmlString, createCodeHtmlStringSync } from "../utilities/highlighter";
import {
  buildRpcRequestTemplate,
  buildRpcResponseDescription,
} from "../utilities/rpcRequestTemplate";
import { StateStorage } from "../utilities/StateStorage";
import { RpcInvokeHistory } from "../types/RpcInvokeHistory";
import { RpcInvokeHistoryStore } from "../utilities/RpcInvokeHistoryStore";
import { log } from "../utilities/logger";
import { BasePanel } from "./BasePanel";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validMetadata = (value: unknown): value is Record<string, string | string[]> | undefined =>
  value === undefined ||
  (isObject(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        key.toLowerCase() !== "authorization" &&
        (typeof item === "string" ||
          (Array.isArray(item) && item.every((part) => typeof part === "string")))
    ));

export class RpcInvokePanel extends BasePanel {
  private static currentPanel: RpcInvokePanel | undefined;
  private static historyStore: RpcInvokeHistoryStore | undefined;

  static setHistoryStore(store: RpcInvokeHistoryStore | undefined): void {
    this.historyStore = store;
  }

  private static async recordHistory(history: Omit<RpcInvokeHistory, "id">): Promise<void> {
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
    restoredRequestJson?: string
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
    this.currentPanel.selectMethod(method, service, connectionName, restoredRequestJson);
  }

  getComponentName(): ComponentName {
    return "RpcInvokePanel";
  }

  protected preDispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    restoredRequestJson?: string
  ): void {
    if (this.startingStream || this.activeStream) {
      void this.post({
        command: "streamError",
        value: { streamError: { sessionId: this.streamSessionId, error: "Finish or cancel the active stream before selecting another method." } },
      });
      return;
    }
    this.selectionVersion += 1;
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
      ...(restoredRequestJson !== undefined && {
        restoredRequestJson,
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
    if (this.disposed) return Promise.resolve(false);
    return this.panel.webview.postMessage({ ...message, componentName: "RpcInvokePanel" });
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
      typeof params.requestJson !== "string" ||
      !validMetadata(params.metadata)
    ) {
      return { error: "Invalid RPC request or metadata." };
    }
    const current = this.tree.getLoadedRpcMethodContext(method);
    if (
      !current ||
      current.connection.name !== target.connectionName ||
      current.service.fullName !== target.service ||
      method.path !== target.path ||
      (streaming ? !method.requestStream && !method.responseStream : method.requestStream || method.responseStream)
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
    if (this.inProgress) {
      return;
    }
    const validated = this.validateRequest(params);
    if ("error" in validated) {
      await this.post({ command: "error", value: { error: validated.error } });
      return;
    }
    const version = this.selectionVersion;
    const path = this.target!.path;
    this.inProgress = true;
    let token: string | undefined;
    let history: Omit<RpcInvokeHistory, "id"> | undefined;
    let recorded = false;
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
      history = {
        connectionName: validated.request.connectionName,
        service: validated.request.service,
        method: validated.request.method,
        path,
        callKind: "unary",
        invokedAt: Date.now(),
        totalElapsedMs: 0,
        sentCount: 0,
        receivedCount: 0,
        outcome: "error",
        requestJson: validated.request.requestJson,
      };
      let sent = false;
      const { ok, message, result } = await workflow<RPCDriver, UnaryResult<unknown>>(
        setting,
        (driver) => {
          sent = true;
          return driver.invokeUnaryProtoJson({
            service: validated.request.service,
            method: validated.request.method,
            requestJson: validated.request.requestJson,
            metadata: validated.request.metadata,
          });
        },
        false
      );
      history.totalElapsedMs = Date.now() - history.invokedAt;
      history.sentCount = ok && result ? 1 : sent ? 1 : 0;
      history.receivedCount = ok && result ? 1 : 0;
      history.outcome = ok && result ? "success" : "error";
      if (ok && result) {
        history.grpcStatus = { code: result.status.code, name: result.status.name };
      }
      recorded = true;
      await RpcInvokePanel.recordHistory(history);
      if (version !== this.selectionVersion) {
        return;
      }
      if (!ok || !result) {
        throw new Error(message || "RPC invocation failed.");
      }
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
            status: token
              ? {
                  ...result.status,
                  details: result.status.details.split(token).join("[redacted]"),
                }
              : result.status,
            elapsedMs: result.elapsedMs,
            contentsHtml,
            headersHtml,
            trailersHtml,
          },
        },
      });
    } catch (error) {
      if (history && !recorded) {
        history.totalElapsedMs = Date.now() - history.invokedAt;
        await RpcInvokePanel.recordHistory(history);
      }
      if (version !== this.selectionVersion) {
        return;
      }
      const rawMessage = error instanceof Error ? error.message : String(error);
      await this.post({
        command: "error",
        value: { error: token ? rawMessage.split(token).join("[redacted]") : rawMessage },
      });
    } finally {
      if (version === this.selectionVersion) {
        this.inProgress = false;
      }
    }
  }

  private async startStream(params: StartRpcStreamActionCommand["params"]): Promise<void> {
    if (this.disposed || this.inProgress || this.startingStream || this.activeStream) return;
    const validated = this.validateRequest(params, true);
    if ("error" in validated) {
      await this.post({ command: "streamError", value: { streamError: { error: validated.error } } });
      return;
    }
    const version = this.selectionVersion;
    const requestStream = this.method?.requestStream === true;
    const abort = new AbortController();
    this.streamAbort = abort;
    this.startingStream = true;
    const sessionId = randomUUID();
    this.streamSessionId = sessionId;
    let token: string | undefined;
    let cleanup: (() => Promise<string | undefined>) | undefined;
    let handedOff = false;
    let history: Omit<RpcInvokeHistory, "id"> | undefined;
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
      token = setting.rpc?.authentication?.type === "bearer"
        ? setting.rpc.authentication.token
        : undefined;
      this.streamToken = token;
      const method = this.method!;
      history = {
        connectionName: validated.request.connectionName,
        service: validated.request.service,
        method: validated.request.method,
        path: this.target!.path,
        callKind: method.requestStream
          ? method.responseStream ? "bidiStreaming" : "clientStreaming"
          : "serverStreaming",
        invokedAt: Date.now(),
        totalElapsedMs: 0,
        sentCount: 0,
        receivedCount: 0,
        outcome: "error",
        ...(!requestStream && { requestJson: validated.request.requestJson }),
      };
      if (abort.signal.aborted) throw new Error("RPC stream start cancelled.");
      const driver = await createDriver<RPCDriver>(setting, false);
      cleanup = this.createStreamCleanup(driver);
      this.streamCleanup = cleanup;
      if (abort.signal.aborted) throw new Error("RPC stream start cancelled.");
      const connectError = await driver.connect();
      if (connectError) throw new Error(connectError);
      if (abort.signal.aborted) throw new Error("RPC stream start cancelled.");
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
        history.totalElapsedMs = Date.now() - history.invokedAt;
        await RpcInvokePanel.recordHistory(history);
      }
      if (!this.disposed && version === this.selectionVersion) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = `${raw}${cleanupError ? `; disconnect: ${cleanupError}` : ""}`;
        await this.post({
          command: "streamError",
          value: { streamError: { error: token ? message.split(token).join("[redacted]") : message } },
        });
      }
    } finally {
      this.startingStream = false;
      if (!handedOff) {
        await cleanup?.();
        if (this.streamCleanup === cleanup) this.streamCleanup = undefined;
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
    history: Omit<RpcInvokeHistory, "id">,
    token?: string
  ): Promise<void> {
    let eventError: unknown;
    const events = (async () => {
      for await (const event of session.events) {
        if (this.disposed || this.streamSessionId !== sessionId) continue;
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
      if (eventError) streamError = eventError;
    } catch (error) {
      streamError = error;
      session.cancel();
    } finally {
      cleanupError = await cleanup();
      if (this.activeStream === session) {
        this.activeStream = undefined;
        this.streamAbort = undefined;
      }
      if (this.streamCleanup === cleanup) this.streamCleanup = undefined;
    }
    history.totalElapsedMs = Date.now() - history.invokedAt;
    history.sentCount = completion?.sentCount ?? 0;
    history.receivedCount = completion?.receivedCount ?? 0;
    history.outcome = streamError ? "error" : completion?.outcome ?? "error";
    if (completion?.status) {
      history.grpcStatus = { code: completion.status.code, name: completion.status.name };
    }
    await RpcInvokePanel.recordHistory(history);
    if (!this.disposed && this.streamSessionId === sessionId) {
      const redact = (value: string): string => token
        ? value.split(token).join("[redacted]")
        : value;
      if (completion) {
        const safeCompletion = {
          ...completion,
          error: undefined,
          cleanupError: cleanupError ? redact(cleanupError) : undefined,
          status: completion.status
            ? { ...completion.status, details: redact(completion.status.details) }
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
          value: { streamError: { sessionId, error: redact(raw) } },
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
    if (!session || this.streamSessionId !== sessionId || !session.send) return;
    try {
      await session.send(requestJson);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      await this.post({
        command: "streamError",
        value: { streamError: { sessionId, error: this.streamToken ? raw.split(this.streamToken).join("[redacted]") : raw } },
      });
    }
  }

  private async finishStreamSending(sessionId: string): Promise<void> {
    const session = this.activeStream;
    if (!session || this.streamSessionId !== sessionId || !session.finishSending) return;
    try {
      await session.finishSending();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      await this.post({
        command: "streamError",
        value: { streamError: { sessionId, error: this.streamToken ? raw.split(this.streamToken).join("[redacted]") : raw } },
      });
    }
  }

  private cancelStream(sessionId: string): void {
    if (this.streamSessionId !== sessionId) return;
    if (this.activeStream) this.activeStream.cancel();
    else if (this.startingStream) this.streamAbort?.abort();
  }
}
