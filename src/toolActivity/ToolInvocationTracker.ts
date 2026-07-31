import { abbr } from "@l-v-yonsama/rdh";
import { randomUUID } from "crypto";
import { getErrorMessage } from "../utilities/errorUtil";

/**
 * In-memory record of tool invocations, independent of the "vscode" module by
 * design (see Phase 1 of misc/mcp-server-lmtools-tree-view-plan-2026-07-31.md) so
 * it can be unit-tested without the __tests__/mocks/vscode.ts shim. Deliberately
 * not persisted to context.globalState -- this is a volatile "what's happening /
 * what just happened" activity feed, not a durable user asset like SQL history.
 */

export type ToolSource = "lmTools" | "mcpServer";

export type ToolInvocationRecord = {
  id: string;
  source: ToolSource;
  toolName: string;
  startedAt: number;
  durationMs: number;
  status: "success" | "error";
  inputSummary: string;
  outputSummary: string;
};

const MAX_HISTORY_PER_SOURCE = 10;
const SUMMARY_MAX_LENGTH = 500;

type Disposable = { dispose: () => void };

/**
 * Minimal stand-in for vscode.EventEmitter so this module has no "vscode"
 * import (see file header).
 */
class SimpleEmitter<T> {
  private listeners: Array<(value: T) => void> = [];

  event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(value: T): void {
    this.listeners.forEach((listener) => listener(value));
  }
}

const history: Record<ToolSource, ToolInvocationRecord[]> = {
  lmTools: [],
  mcpServer: [],
};

const activeCount: Record<ToolSource, number> = {
  lmTools: 0,
  mcpServer: 0,
};

const activityEmitter = new SimpleEmitter<ToolSource>();

/** Fires whenever a source's active-invocation count or history changes (invocation start or end). */
export const onDidChangeActivity = activityEmitter.event;

export function getHistory(source: ToolSource): ToolInvocationRecord[] {
  return history[source].slice();
}

export function isActive(source: ToolSource): boolean {
  return activeCount[source] > 0;
}

function summarize(value: unknown): string {
  if (typeof value === "string") {
    return abbr(value, SUMMARY_MAX_LENGTH) ?? "";
  }
  if (value === undefined) {
    return "";
  }
  try {
    return abbr(JSON.stringify(value), SUMMARY_MAX_LENGTH) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Thin wrapper around an existing tool orchestrator call (e.g. `getSchemaText(...)`)
 * that records start/end into the in-memory FIFO history without changing the
 * orchestrator itself. Input/output summaries reuse the orchestrator's own
 * arguments and return value as-is (just truncated) -- those are already safe to
 * surface to the model/client, so this doesn't open a new PII exposure surface
 * (see RunQueryTool.ts's row-count-only logging for the existing convention).
 */
export async function trackInvocation<T>(
  source: ToolSource,
  toolName: string,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  activeCount[source]++;
  activityEmitter.fire(source);

  let status: ToolInvocationRecord["status"] = "success";
  let outputSummary = "";
  try {
    const result = await fn();
    outputSummary = summarize(result);
    return result;
  } catch (e) {
    status = "error";
    outputSummary = getErrorMessage(e);
    throw e;
  } finally {
    activeCount[source]--;

    const list = history[source];
    list.unshift({
      id: randomUUID(),
      source,
      toolName,
      startedAt,
      durationMs: Date.now() - startedAt,
      status,
      inputSummary: summarize(input),
      outputSummary,
    });
    if (list.length > MAX_HISTORY_PER_SOURCE) {
      list.splice(MAX_HISTORY_PER_SOURCE, list.length - MAX_HISTORY_PER_SOURCE);
    }

    activityEmitter.fire(source);
  }
}
