import * as vscode from "vscode";
import { detectRunningServer } from "../mcpServer/singleton";

export class McpServerTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    // Read-only status check (lock file + a live health check), so this reflects
    // reality even when another VS Code window is the one actually running the
    // server. Deliberately NOT `acquireOrDetect`: that claims the startup slot as a
    // side effect, and this runs on every refresh (including right after start/stop
    // fires `onDidChangeRunningState`) -- using it here would silently claim and
    // never release the slot, starving real `startMcpServer` calls.
    const running = await detectRunningServer(this.context);
    const item = new vscode.TreeItem(running ? "Running" : "Stopped");
    if (running) {
      item.description = running.url;
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
    } else {
      item.iconPath = new vscode.ThemeIcon("circle-outline");
    }
    return [item];
  }
}
