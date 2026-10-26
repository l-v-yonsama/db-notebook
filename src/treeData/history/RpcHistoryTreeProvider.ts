import dayjs from "dayjs";
import * as vscode from "vscode";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { isRestorableRpcHistory, RpcInvokeHistoryStore } from "../../utilities/RpcInvokeHistoryStore";
import { OPEN_RPC_HISTORY_IN_INVOKE_PANEL } from "../../constant";

export class RpcHistoryTreeProvider implements vscode.TreeDataProvider<RpcInvokeHistory> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: RpcInvokeHistoryStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(history: RpcInvokeHistory): vscode.TreeItem {
    const serviceName = history.service.split(".").at(-1) || history.service;
    const item = new vscode.TreeItem(
      `${serviceName}/${history.method}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = isRestorableRpcHistory(history)
      ? "rpcInvokeHistoryRestorable"
      : "rpcInvokeHistory";
    if (isRestorableRpcHistory(history)) {
      item.command = {
        command: OPEN_RPC_HISTORY_IN_INVOKE_PANEL,
        title: "Open in Invoke RPC",
        arguments: [history],
      };
    }
    const status = history.outcome === "success" ? "OK" :
      history.outcome === "error" ? "Failed" :
      history.outcome === "cancelled" ? "Cancelled" : "Timeout";
    const parts = [
      dayjs(history.invokedAt).format("MM/DD HH:mm"),
      history.connectionName,
      history.callKind,
      status,
      `${history.totalElapsedMs} ms`,
    ];
    if (history.callKind !== "unary") {
      parts.push(`sent ${history.sentCount} / received ${history.receivedCount}`);
    }
    if (history.grpcStatus) {
      parts.push(`${history.grpcStatus.name} (${history.grpcStatus.code})`);
    }
    item.description = parts.join(" ・ ");
    item.tooltip = `${history.path}\n${parts.join(" ・ ")}`;
    item.iconPath = history.outcome === "success"
      ? new vscode.ThemeIcon("pass")
      : new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    return item;
  }

  getChildren(): Promise<RpcInvokeHistory[]> {
    return this.store.list();
  }
}
