import dayjs from "dayjs";
import * as vscode from "vscode";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { isRestorableRpcHistory } from "../../utilities/RpcInvokeHistoryStore";
import { formatRpcStatus, formatRpcTransferSummary } from "../../utilities/rpcResultSummary";

const REQUEST_PREVIEW_MAX_CHARS = 4096;

export class RpcHistoryItem extends vscode.TreeItem {
  constructor(history: RpcInvokeHistory) {
    const serviceName = history.service.split(".").at(-1) || history.service;
    super(
      `${serviceName}/${history.method}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.contextValue = isRestorableRpcHistory(history)
      ? "rpcInvokeHistoryRestorable"
      : history.callKind === "unary" || history.callKind === "serverStreaming"
        ? "rpcInvokeHistoryPanelOnly"
        : history.requestJson !== undefined
          ? "rpcInvokeHistoryNotebookOnly"
          : "rpcInvokeHistory";
    const status = history.outcome === "success" ? "OK" :
      history.outcome === "error" ? "Failed" :
      history.outcome === "cancelled" ? "Cancelled" : "Timeout";
    const parts = [
      dayjs(Math.max(history.executedAt, history.lastErrorAt ?? 0)).format("MM/DD HH:mm"),
      history.connectionName,
      "RPC",
      history.callKind,
      status,
      ...(history.executionCount > 1 ? [`×${history.executionCount}`] : []),
      formatRpcTransferSummary(
        history.receivedCount,
        history.totalElapsedMs,
        history.callKind === "unary" ? undefined : history.sentCount
      ),
    ];
    if (history.grpcStatus) {
      parts.push(formatRpcStatus(history.grpcStatus));
    }
    if (history.lastErrorAt) {
      parts.push(`Last retry ${history.lastErrorOutcome ?? "error"}`);
    }
    this.description = parts.join(" ・ ");
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(history.path);
    tooltip.appendMarkdown("\n\n");
    tooltip.appendText(parts.join(" ・ "));
    if (history.requestJson) {
      let formatted = history.requestJson;
      try {
        formatted = JSON.stringify(JSON.parse(formatted), null, 2);
      } catch {
        // An older or externally modified history may contain invalid JSON.
      }
      const truncated = formatted.length > REQUEST_PREVIEW_MAX_CHARS;
      tooltip.appendMarkdown("\n\n**Request**");
      tooltip.appendCodeblock(
        truncated ? formatted.slice(0, REQUEST_PREVIEW_MAX_CHARS) : formatted,
        "json"
      );
      if (truncated) {
        tooltip.appendMarkdown("\n\nPreview truncated.");
      }
    } else {
      tooltip.appendMarkdown("\n\nRequest Data was not saved because it exceeded 64 KiB.");
    }
    this.tooltip = tooltip;
    this.iconPath = history.lastErrorAt
      ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"))
      : history.outcome === "success"
      ? new vscode.ThemeIcon("pass")
      : new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
  }
}
