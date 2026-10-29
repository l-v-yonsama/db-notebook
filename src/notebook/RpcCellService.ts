import {
  DBType,
  RPCDriver,
  RpcDatabase,
  RpcInvokeError,
  RpcMethod,
  RpcService,
  RpcStreamSession,
  buildRpcRequestTemplate,
  buildRpcResponseDescription,
  getRpcCallKind,
  parseRpcRequestMetadata,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellExecution,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookData,
  NotebookEdit,
  Range,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { NOTEBOOK_TYPE } from "../constant";
import type { RpcNotebookResult } from "../shared/RunResultMetadata";
import { createDriver, removeDriver } from "../utilities/driverResolver";
import { RPC_CAPTURE_BYTES, RPC_CAPTURE_LIMIT, redactRpcToken } from "../utilities/rpcExecution";
import { RpcInvokeHistoryAttempt, RpcInvokeHistoryStore } from "../utilities/RpcInvokeHistoryStore";
import { RpcHistoryRequestCapture } from "../utilities/RpcHistoryRequestCapture";
import { formatRpcStatus, formatRpcTransferSummary } from "../utilities/rpcResultSummary";
import { StateStorage } from "../utilities/StateStorage";
import { resolveJsonTemplate } from "./jsonVariables";
import {
  decodeRpcCellSource,
  getRpcCellMetadata,
  isRpcCell,
  isRpcCellMetadata,
  makeRpcCellData,
  RPC_RESPONSE_MIME,
  rpcCallKindLabels,
  rpcRequestTemplateBody,
  RpcCellMeta,
  RpcCellSource,
} from "./rpcCell";

type MethodChoice = { method: RpcMethod; service: RpcService; database: RpcDatabase };
const objectValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseRequest = (
  source: RpcCellSource,
  requestStream: boolean,
  variables: Record<string, unknown>
): {
  requestJson: string;
  requestJsons: string[];
  metadata: Record<string, string | string[]>;
} => {
  const { value: data, json, substituted } = resolveJsonTemplate(source.dataJson, variables);
  const metadata: unknown = source.metadataJson.trim() ? JSON.parse(source.metadataJson) : {};
  if (requestStream) {
    if (!Array.isArray(data) || !data.every(objectValue)) {
      throw new Error("Data must be a JSON array of request objects for client or bidi streaming.");
    }
  } else if (!objectValue(data)) {
    throw new Error("Data must be a JSON object for unary or server streaming.");
  }
  return {
    // Keep the original request text when no variable was replaced.
    requestJson: substituted ? json : source.dataJson,
    requestJsons: requestStream
      ? (data as Record<string, unknown>[]).map((item) => JSON.stringify(item))
      : [],
    metadata: parseRpcRequestMetadata(metadata),
  };
};

const responseOutput = (view: RpcNotebookResult): NotebookCellOutput =>
  new NotebookCellOutput([
    NotebookCellOutputItem.json(view, RPC_RESPONSE_MIME),
    NotebookCellOutputItem.text(
      `${view.outcome}${
        view.status ? ` · ${formatRpcStatus(view.status)}` : ""
      } · ${formatRpcTransferSummary(view.receivedCount, view.elapsedMs, view.sentCount)}`,
      "text/plain"
    ),
  ]);

/** Owns notebook RPC schema lookups and per-execution drivers. */
export class RpcCellService {
  private readonly active = new Map<string, () => void>();

  constructor(
    context: ExtensionContext,
    private readonly stateStorage: StateStorage,
    private readonly historyStore: RpcInvokeHistoryStore
  ) {
    context.subscriptions.push(
      workspace.onDidCloseNotebookDocument((notebook) => {
        this.cancelNotebook(notebook.uri.toString());
      })
    );
    context.subscriptions.push(
      workspace.onDidChangeNotebookDocument((event) => {
        if (event.notebook.notebookType !== NOTEBOOK_TYPE) {
          return;
        }
        for (const change of event.contentChanges) {
          for (const cell of change.removedCells) {
            if (isRpcCell(cell)) {
              this.active.get(
                `${event.notebook.uri.toString()}#${cell.document.uri.toString()}`
              )?.();
            }
          }
        }
      })
    );
    context.subscriptions.push({
      dispose: () => {
        for (const cancel of this.active.values()) {
          cancel();
        }
      },
    });
  }

  async insertCell(options: Parameters<typeof makeRpcCellData>[0] = {}): Promise<void> {
    const cell = makeRpcCellData(options);
    const editor = window.activeNotebookEditor;
    if (editor?.notebook.notebookType === NOTEBOOK_TYPE) {
      const edit = new WorkspaceEdit();
      edit.set(editor.notebook.uri, [NotebookEdit.insertCells(editor.selection.end, [cell])]);
      await workspace.applyEdit(edit);
    } else {
      const notebook = await workspace.openNotebookDocument(
        NOTEBOOK_TYPE,
        new NotebookData([cell])
      );
      await window.showNotebookDocument(notebook);
    }
  }

  async selectMethod(cell: NotebookCell): Promise<void> {
    if (!isRpcCell(cell)) {
      return;
    }
    const metadata = getRpcCellMetadata(cell);
    if (!metadata.connectionName) {
      await window.showInformationMessage("Select an RPC connection first.");
      return;
    }
    const choices = await this.loadMethods(metadata.connectionName);
    if (choices.length === 0) {
      await window.showInformationMessage("No RPC methods were found.");
      return;
    }
    const selected = await window.showQuickPick(
      choices.map((choice) => ({
        label: `${choice.service.fullName}/${choice.method.name}`,
        description: rpcCallKindLabels[getRpcCallKind(choice.method)],
        choice,
      })),
      { placeHolder: "Select an RPC method" }
    );
    if (!selected) {
      return;
    }
    const choice = selected.choice;
    const nextMeta: RpcCellMeta = {
      ...metadata,
      rpc: {
        ...metadata.rpc,
        service: choice.service.fullName,
        method: choice.method.name,
        path: choice.method.path,
        callKind: getRpcCallKind(choice.method),
      },
    };
    const edit = new WorkspaceEdit();
    edit.set(cell.notebook.uri, [NotebookEdit.updateCellMetadata(cell.index, nextMeta)]);
    await workspace.applyEdit(edit);
    const source = decodeRpcCellSource(cell.document.getText(), metadata);
    const template = buildRpcRequestTemplate(choice.method, choice.database.messageDefinitions);
    if (["{}", "[]"].includes(source.dataJson.trim())) {
      await this.writeSource(cell, {
        ...source,
        dataJson: rpcRequestTemplateBody(template.data, choice.method.requestStream),
      });
    }
  }

  private async loadMethods(connectionName: string, reload = false): Promise<MethodChoice[]> {
    const loaded = await this.stateStorage.loadResource(connectionName, reload, true);
    if (!loaded.ok || !loaded.result) {
      throw new Error(loaded.message || "RPC schema unavailable.");
    }
    const choices: MethodChoice[] = [];
    for (const resource of loaded.result.db) {
      if (!(resource instanceof RpcDatabase)) {
        continue;
      }
      for (const pkg of resource.children) {
        for (const service of pkg.children) {
          for (const method of service.children) {
            choices.push({ method, service, database: resource });
          }
        }
      }
    }
    return choices;
  }

  async getDescriptor(cell: NotebookCell, reload = false): Promise<string> {
    const descriptions = await this.getDescriptions(cell, reload);
    return [descriptions.request, descriptions.response].filter(Boolean).join("\n\n");
  }

  async getDescriptions(
    cell: NotebookCell,
    reload = false
  ): Promise<{ request: string; response: string }> {
    const metadata = getRpcCellMetadata(cell);
    if (!metadata.connectionName || !metadata.rpc.service || !metadata.rpc.method) {
      return {
        request: "Select an RPC connection and method to view the descriptor.",
        response: "",
      };
    }
    const target = await this.resolveMethod(cell, reload);
    const definitions = target.database.messageDefinitions;
    return {
      request: buildRpcRequestTemplate(target.method, definitions).description,
      response: buildRpcResponseDescription(target.method, definitions),
    };
  }

  async insertTemplate(cell: NotebookCell): Promise<void> {
    const target = await this.resolveMethod(cell);
    const metadata = getRpcCellMetadata(cell);
    const source = decodeRpcCellSource(cell.document.getText(), metadata);
    const template = buildRpcRequestTemplate(target.method, target.database.messageDefinitions);
    await this.writeSource(cell, {
      ...source,
      dataJson: rpcRequestTemplateBody(template.data, target.method.requestStream),
    });
  }

  private async writeSource(cell: NotebookCell, source: RpcCellSource): Promise<void> {
    const text = cell.document;
    const current = getRpcCellMetadata(cell);
    const sourceChanged = text.getText() !== source.dataJson;
    const metadataChanged =
      current.rpc.metadataJson !== source.metadataJson || !isRpcCellMetadata(cell.metadata);
    if (!sourceChanged && !metadataChanged) {
      return;
    }
    const edit = new WorkspaceEdit();
    if (sourceChanged) {
      edit.replace(
        text.uri,
        new Range(text.positionAt(0), text.positionAt(text.getText().length)),
        source.dataJson
      );
    }
    if (metadataChanged) {
      edit.set(cell.notebook.uri, [
        NotebookEdit.updateCellMetadata(cell.index, {
          ...current,
          rpc: { ...current.rpc, metadataJson: source.metadataJson },
        } satisfies RpcCellMeta),
      ]);
    }
    if (!(await workspace.applyEdit(edit))) {
      throw new Error("Could not update RPC cell input.");
    }
  }
  private async resolveMethod(cell: NotebookCell, reload = false): Promise<MethodChoice> {
    const metadata = getRpcCellMetadata(cell);
    if (!metadata.connectionName || !metadata.rpc.service || !metadata.rpc.method) {
      throw new Error("Select an RPC connection and method.");
    }
    const methods = await this.loadMethods(metadata.connectionName, reload);
    const found = methods.find(
      (item) =>
        item.service.fullName === metadata.rpc.service &&
        item.method.name === metadata.rpc.method &&
        item.method.path === metadata.rpc.path
    );
    if (!found) {
      throw new Error("RPC method changed. Reload the schema and select it again.");
    }
    return found;
  }

  cancelNotebook(notebookUri: string): void {
    for (const [key, cancel] of this.active) {
      if (key.startsWith(`${notebookUri}#`)) {
        cancel();
      }
    }
  }

  async execute(
    cell: NotebookCell,
    execution: NotebookCellExecution,
    variables: Record<string, unknown> = {}
  ): Promise<boolean> {
    const metadata = getRpcCellMetadata(cell);
    const activeKey = `${cell.notebook.uri.toString()}#${cell.document.uri.toString()}`;
    const started = Date.now();
    const history: RpcInvokeHistoryAttempt = {
      connectionName: metadata.connectionName ?? "",
      service: metadata.rpc.service ?? "",
      method: metadata.rpc.method ?? "",
      path: metadata.rpc.path ?? "",
      callKind: "unary",
      startedAt: started,
      requestCapture: new RpcHistoryRequestCapture(false),
      totalElapsedMs: 0,
      sentCount: 0,
      receivedCount: 0,
      outcome: "error",
    };
    let driver: RPCDriver | undefined;
    let token: string | undefined;
    let disconnectTask: Promise<void> | undefined;
    let connectInProgress = false;
    const disconnect = (): Promise<void> => {
      if (!driver) {
        return Promise.resolve();
      }
      if (!disconnectTask) {
        const ownedDriver = driver;
        disconnectTask = Promise.resolve(ownedDriver.disconnect())
          .then(() => undefined)
          .catch(() => undefined)
          .finally(() => removeDriver(ownedDriver));
      }
      return disconnectTask;
    };
    let session: RpcStreamSession | undefined;
    let streamSessionStarted = false;
    let streamResponse:
      | Pick<RpcNotebookResult, "messages" | "headers" | "droppedCount" | "receivedCount">
      | undefined;
    let unaryInvocationStarted = false;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      if (session) {
        session.cancel();
      } else if (!connectInProgress) {
        void disconnect();
      }
    };
    this.active.set(activeKey, cancel);
    const cancellation = execution.token.onCancellationRequested(cancel);
    let view: RpcNotebookResult = {
      version: 1,
      kind: "response",
      cellId: metadata.rpc.id,
      outcome: "running",
      elapsedMs: 0,
      receivedCount: 0,
    };
    let response = responseOutput(view);
    let responsePublished = false;
    const publishResponse = async (): Promise<void> => {
      const next = responseOutput(view);
      response = next;
      await execution.replaceOutput([response]);
      responsePublished = true;
    };
    try {
      if (cancelled) {
        throw new Error("RPC call cancelled.");
      }
      const source = decodeRpcCellSource(cell.document.getText(), metadata);
      const selected = await this.resolveMethod(cell);
      const request = parseRequest(source, selected.method.requestStream, variables);
      if (Object.keys(request.metadata).length > 0) {
        history.requestMetadata = request.metadata;
      }
      if (cancelled) {
        throw new Error("RPC call cancelled.");
      }
      history.callKind = getRpcCallKind(selected.method);
      history.requestCapture = new RpcHistoryRequestCapture(selected.method.requestStream);
      if (!selected.method.requestStream) {
        history.requestCapture.add(request.requestJson);
      }
      const setting = await this.stateStorage.getConnectionSettingByName(metadata.connectionName!);
      if (!setting || setting.dbType !== DBType.RPC) {
        throw new Error("RPC connection unavailable.");
      }
      token =
        setting.rpc?.authentication?.type === "bearer"
          ? setting.rpc.authentication.token
          : undefined;
      driver = await createDriver<RPCDriver>(setting, false);
      connectInProgress = true;
      let connectError: string;
      try {
        connectError = await driver.connect();
      } finally {
        connectInProgress = false;
      }
      if (connectError) {
        throw new Error(connectError);
      }
      if (cancelled) {
        throw new Error("RPC call cancelled.");
      }
      await publishResponse();
      if (!selected.method.requestStream && !selected.method.responseStream) {
        unaryInvocationStarted = true;
        const result = await driver.invokeUnaryProtoJson({
          service: selected.service.fullName,
          method: selected.method.name,
          requestJson: request.requestJson,
          metadata: request.metadata,
        });
        if (cancelled) {
          throw new Error("RPC call cancelled.");
        }
        history.sentCount = 1;
        history.receivedCount = 1;
        history.outcome = "success";
        history.grpcStatus = { code: result.status.code, name: result.status.name };
        view = {
          ...view,
          outcome: "success",
          status: history.grpcStatus,
          elapsedMs: result.elapsedMs,
          receivedCount: 1,
          contents: result.contents,
          headers: result.headers,
          trailers: result.trailers,
        };
      } else {
        session = driver.openProtoJsonStream({
          service: selected.service.fullName,
          method: selected.method.name,
          requestJson: selected.method.requestStream ? undefined : request.requestJson,
          metadata: request.metadata,
        });
        streamSessionStarted = true;
        history.sentCount = selected.method.requestStream ? 0 : 1;
        if (selected.method.requestStream) {
          view = { ...view, sentCount: 0 };
        }
        const messages: NonNullable<RpcNotebookResult["messages"]> = [];
        let headers: RpcNotebookResult["headers"];
        let droppedCount = 0;
        let size = 0;
        let lastRendered = 0;
        let eventError: unknown;
        const events = (async () => {
          for await (const event of session!.events) {
            if (event.type === "sent") {
              history.sentCount = event.index;
              if (selected.method.requestStream) {
                view = { ...view, sentCount: event.index };
              }
            }
            if (event.type === "headers") {
              headers = event.headers;
              streamResponse = { ...streamResponse, headers, receivedCount: history.receivedCount };
            }
            if (event.type === "received") {
              history.receivedCount = event.index;
              const bytes = Buffer.byteLength(JSON.stringify(event.contents), "utf8");
              messages.push({ index: event.index, at: event.at, contents: event.contents });
              size += bytes;
              while (messages.length > RPC_CAPTURE_LIMIT || size > RPC_CAPTURE_BYTES) {
                const removed = messages.shift()!;
                size -= Buffer.byteLength(JSON.stringify(removed.contents), "utf8");
                droppedCount++;
              }
              streamResponse = {
                messages,
                headers,
                droppedCount,
                receivedCount: event.index,
              };
              if (event.index === 1 || Date.now() - lastRendered >= 250) {
                await execution.replaceOutputItems(
                  responseOutput({
                    ...view,
                    ...streamResponse,
                    elapsedMs: Date.now() - started,
                  }).items,
                  response
                );
                lastRendered = Date.now();
              }
            }
          }
        })().catch((error) => {
          eventError = error;
          session?.cancel();
        });
        if (selected.method.requestStream) {
          try {
            if (!session.send || !session.finishSending) {
              throw new Error("RPC stream does not accept request messages.");
            }
            for (const requestJson of request.requestJsons) {
              if (cancelled) {
                throw new Error("RPC call cancelled.");
              }
              await session.send(requestJson);
              history.requestCapture.add(requestJson);
            }
            if (cancelled) {
              throw new Error("RPC call cancelled.");
            }
            await session.finishSending();
          } catch (error) {
            session.cancel();
            const completion = await session.completion;
            await events;
            history.sentCount = completion.sentCount;
            history.receivedCount = completion.receivedCount;
            throw error;
          }
        }
        const completion = await session.completion;
        await events;
        if (eventError) {
          throw eventError;
        }
        history.sentCount = completion.sentCount;
        history.receivedCount = completion.receivedCount;
        history.outcome = completion.outcome;
        if (completion.status) {
          history.grpcStatus = { code: completion.status.code, name: completion.status.name };
        }
        view = {
          ...view,
          outcome: completion.outcome,
          status: history.grpcStatus,
          elapsedMs: completion.elapsedMs,
          sentCount: selected.method.requestStream ? completion.sentCount : undefined,
          receivedCount: completion.receivedCount,
          messages,
          headers,
          trailers: completion.trailers,
          droppedCount,
          error: completion.error?.message,
        };
      }
      if (view.error) {
        view.error = redactRpcToken(view.error, token);
      }
      await execution.replaceOutputItems(responseOutput(view).items, response);
      return history.outcome === "success";
    } catch (error) {
      session?.cancel();
      history.outcome = cancelled
        ? "cancelled"
        : error instanceof RpcInvokeError && error.status?.code === 4
        ? "timeout"
        : "error";
      if (error instanceof RpcInvokeError && error.status) {
        history.grpcStatus = { code: error.status.code, name: error.status.name };
        if (history.callKind === "unary") {
          history.sentCount = 1;
        }
      }
      if (cancelled && unaryInvocationStarted) {
        history.sentCount = 1;
      }
      const raw = error instanceof Error ? error.message : String(error);
      view = {
        ...view,
        ...streamResponse,
        outcome: history.outcome,
        status: history.grpcStatus,
        elapsedMs: Date.now() - started,
        sentCount:
          streamSessionStarted && history.callKind !== "serverStreaming"
            ? history.sentCount
            : undefined,
        receivedCount: history.receivedCount,
        error: redactRpcToken(raw, token),
      };
      if (responsePublished) {
        await execution.replaceOutputItems(responseOutput(view).items, response);
      } else {
        await publishResponse();
      }
      return false;
    } finally {
      cancellation.dispose();
      this.active.delete(activeKey);
      history.totalElapsedMs = Date.now() - started;
      await disconnect();
      if (history.sentCount > 0 || streamSessionStarted) {
        try {
          await this.historyStore.add(history);
        } catch {
          /* History must not change execution. */
        }
      }
    }
  }
}
