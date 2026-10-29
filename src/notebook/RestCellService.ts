import axios, { AxiosResponse } from "axios";
import { AxiosHarTracker } from "axios-har-tracker";
import type { Entry, Header, QueryString } from "har-format";
import { STATUS_CODES } from "http";
import {
  ExtensionContext,
  NotebookCell,
  NotebookCellExecution,
  NotebookCellOutput,
  NotebookCellOutputItem,
  workspace,
} from "vscode";
import type { NodeRunAxiosEvent } from "../shared/RunResultMetadata";
import { toNodeRunAxiosEvent } from "../utilities/httpUtil";
import { getRestCellMetadata, isRestCell, REST_METHODS, REST_RESPONSE_MIME } from "./restCell";
import { resolveRestJsonBody, resolveRestUrlTemplate } from "./restVariables";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type RestResponseView = {
  version: 1;
  cellId: string;
  outcome: "success" | "error" | "timeout" | "cancelled";
  elapsedMs: number;
  event?: NodeRunAxiosEvent;
  error?: string;
};

const asHarHeaders = (headers: Record<string, unknown>): Header[] =>
  Object.entries(headers).flatMap(([name, value]) =>
    value === undefined || value === null
      ? []
      : (Array.isArray(value) ? value : [value]).map((item) => ({ name, value: String(item) }))
  );

const headerValue = (headers: Record<string, unknown>, name: string): string | undefined => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value.join(", ") : value === undefined ? undefined : String(value);
};

const parseHeaders = (source: string): Record<string, string> => {
  let value: unknown;
  try {
    value = JSON.parse(source.trim() || "{}");
  } catch {
    throw new Error("Headers must be a JSON object with string values.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Headers must be a JSON object with string values.");
  }
  const headers = value as Record<string, unknown>;
  for (const [name, item] of Object.entries(headers)) {
    if (typeof item !== "string" || !name || /[\r\n]/.test(name) || /[\r\n]/.test(item)) {
      throw new Error(`Header "${name}" must have a single-line string value.`);
    }
    if (name.toLowerCase() === "content-type" && !/^application\/json(?:\s*;|\s*$)/i.test(item)) {
      throw new Error("REST JSON only supports application/json request bodies.");
    }
    if (item.includes("{{") || item.includes("}}")) {
      throw new Error(`Header "${name}" contains an unsupported variable placeholder.`);
    }
  }
  return headers as Record<string, string>;
};

const responseContent = (response: AxiosResponse<ArrayBuffer>, mimeType: string) => {
  const bytes = Buffer.from(response.data);
  const textResponse =
    /^text\//i.test(mimeType) || /(?:\+json|\/json|\+xml|\/xml|javascript)/i.test(mimeType);
  return {
    size: bytes.length,
    mimeType,
    text: textResponse ? bytes.toString("utf8") : bytes.toString("base64"),
    ...(textResponse ? {} : { encoding: "base64" as const }),
  };
};

const normalizeEntry = (
  raw: Entry,
  response: AxiosResponse<ArrayBuffer>,
  url: string,
  method: string,
  body: string | undefined,
  startedAt: number,
  elapsedMs: number
): Entry => {
  const requestHeaders = response.config.headers.toJSON() as Record<string, unknown>;
  const responseHeaders = { ...response.headers } as Record<string, unknown>;
  const mimeType = headerValue(responseHeaders, "content-type") ?? "application/octet-stream";
  const queryString: QueryString[] = [...new URL(url).searchParams].map(([name, value]) => ({
    name,
    value,
  }));
  const postData =
    body === undefined
      ? undefined
      : {
          mimeType: "application/json",
          text: body,
        };
  return {
    ...raw,
    startedDateTime: new Date(startedAt).toISOString(),
    time: elapsedMs,
    request: {
      method,
      url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: asHarHeaders(requestHeaders),
      queryString,
      headersSize: -1,
      bodySize: body === undefined ? 0 : Buffer.byteLength(body),
      ...(postData ? { postData } : {}),
    },
    response: {
      status: response.status,
      statusText: response.statusText || STATUS_CODES[response.status] || "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: asHarHeaders(responseHeaders),
      content: responseContent(response, mimeType),
      redirectURL: headerValue(responseHeaders, "location") ?? "",
      headersSize: -1,
      bodySize: Buffer.from(response.data).length,
    },
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, send: -1, wait: elapsedMs, receive: -1, ssl: -1 },
  };
};

const makeOutput = (view: RestResponseView): NotebookCellOutput => {
  const status = view.event?.entry.response;
  const summary = status
    ? `Response · ${status.status} ${status.statusText} · ${(view.elapsedMs / 1000).toFixed(3)} sec`
    : `Response · ${view.outcome} · ${view.error ?? "No response"}`;
  return new NotebookCellOutput(
    [
      NotebookCellOutputItem.json(view, REST_RESPONSE_MIME),
      NotebookCellOutputItem.text(summary, "text/plain"),
    ],
    view.event ? { axiosEvent: view.event, status: "executed" } : { status: "error" }
  );
};

export class RestCellService {
  private readonly active = new Map<string, () => void>();

  constructor(context: ExtensionContext) {
    context.subscriptions.push(
      workspace.onDidCloseNotebookDocument((notebook) => {
        this.cancelNotebook(notebook.uri.toString());
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
    variables: Record<string, unknown>
  ): Promise<boolean> {
    if (!isRestCell(cell)) {
      return false;
    }
    const rest = getRestCellMetadata(cell).rest!;
    const startedAt = Date.now();
    const activeKey = `${cell.notebook.uri.toString()}#${cell.document.uri.toString()}`;
    const abort = new AbortController();
    const listener = execution.token.onCancellationRequested(() => abort.abort());
    this.active.get(activeKey)?.();
    const cancel = () => abort.abort();
    this.active.set(activeKey, cancel);
    let view: RestResponseView;
    try {
      if (!REST_METHODS.includes(rest.method!)) {
        throw new Error("Select a supported HTTP method.");
      }
      const url = resolveRestUrlTemplate(rest.url ?? "", variables);
      const body = resolveRestJsonBody(cell.document.getText(), variables);
      if (rest.method === "GET" && body !== undefined) {
        throw new Error("GET requests must have an empty body.");
      }
      const headers = parseHeaders(rest.headersJson ?? "{}");
      if (
        body !== undefined &&
        !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
      ) {
        headers["Content-Type"] = "application/json";
      }
      const timeout = rest.timeoutMs ?? 30000;
      if (!Number.isSafeInteger(timeout) || timeout < 0) {
        throw new Error("Timeout must be a non-negative integer in milliseconds.");
      }
      if (abort.signal.aborted) {
        throw new Error("Request cancelled.");
      }
      const client = axios.create({ validateStatus: () => true });
      const tracker = new AxiosHarTracker(client);
      const response = await client.request<ArrayBuffer>({
        method: rest.method,
        url,
        headers,
        ...(body === undefined ? {} : { data: body }),
        responseType: "arraybuffer",
        maxContentLength: MAX_RESPONSE_BYTES,
        timeout,
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        throw new Error("Request cancelled.");
      }
      const raw = tracker.getGeneratedHar().log.entries[0] as unknown as Entry | undefined;
      if (!raw) {
        throw new Error("HTTP response could not be captured.");
      }
      const elapsedMs = Date.now() - startedAt;
      const event = toNodeRunAxiosEvent(
        normalizeEntry(raw, response, url, rest.method!, body, startedAt, elapsedMs)
      );
      view = { version: 1, cellId: rest.id!, outcome: "success", elapsedMs, event };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const cancelled = abort.signal.aborted || axios.isCancel(error);
      const timeout = axios.isAxiosError(error) && error.code === "ECONNABORTED";
      view = {
        version: 1,
        cellId: rest.id!,
        outcome: cancelled ? "cancelled" : timeout ? "timeout" : "error",
        elapsedMs,
        error: cancelled
          ? "Request cancelled."
          : error instanceof Error
          ? error.message
          : String(error),
      };
    }
    try {
      if (abort.signal.aborted && view.outcome === "success") {
        view = {
          version: 1,
          cellId: rest.id!,
          outcome: "cancelled",
          elapsedMs: Date.now() - startedAt,
          error: "Request cancelled.",
        };
      }
      await execution.replaceOutput([makeOutput(view)]);
    } finally {
      listener.dispose();
      if (this.active.get(activeKey) === cancel) {
        this.active.delete(activeKey);
      }
    }
    return view.outcome === "success";
  }
}
