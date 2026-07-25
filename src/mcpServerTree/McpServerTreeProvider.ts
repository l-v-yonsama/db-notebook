import * as vscode from "vscode";
import { acquireOrDetect } from "../mcpServer/singleton";

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
    // Goes through the same detection used by the start flow (lock file + a live health
    // check), not the cheaper `isRunningHere()`, so this reflects reality even when
    // another VS Code window is the one actually running the server.
    const detection = await acquireOrDetect(this.context);
    const item = new vscode.TreeItem(detection.shouldStart ? "Stopped" : "Running");
    if (!detection.shouldStart) {
      item.description = detection.existing.url;
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
    } else {
      item.iconPath = new vscode.ThemeIcon("circle-outline");
    }
    return [item];
  }
}
