import * as vscode from "vscode";

const DOCS_BASE = "https://l-v-yonsama.github.io/db-notebook";

const HELP_ITEMS = [
  {
    name: "Read Me",
    uri: `${DOCS_BASE}/`,
    icon: "book",
  },
  {
    name: "Database Notebook Examples",
    uri: `${DOCS_BASE}/docs/examples/databaseNotebook.html`,
    icon: "notebook",
  },
  {
    name: "Chart Examples",
    uri: `${DOCS_BASE}/docs/examples/databaseNotebookChart.html`,
    icon: "graph",
  },
  {
    name: "JavaScript Cell Examples",
    uri: `${DOCS_BASE}/docs/examples/databaseNotebookJs.html`,
    icon: "code",
  },
  {
    name: "MQTT Examples",
    uri: `${DOCS_BASE}/docs/examples/databaseNotebookMQTT.html`,
    icon: "radio-tower",
  },
  {
    name: "Variable Sharing Examples",
    uri: `${DOCS_BASE}/docs/examples/databaseNotebookVariableSharing.html`,
    icon: "replace-all",
  },
  {
    name: "Log Parser Usage Guide",
    uri: `${DOCS_BASE}/docs/examples/log_parser_usage_guide.html`,
    icon: "output",
  },
  {
    name: "Entra ID Authentication Guide",
    uri: `${DOCS_BASE}/docs/examples/entraIdAuthentication.html`,
    icon: "key",
  },
  {
    name: "AI Tools Usage Guide (Copilot Chat)",
    uri: `${DOCS_BASE}/docs/examples/lmToolsUsageGuide.html`,
    icon: "comment-discussion",
  },
  {
    name: "MCP Server Usage Guide",
    uri: `${DOCS_BASE}/docs/examples/mcpServerUsageGuide.html`,
    icon: "server-process",
  },
];

export class HelpProvider implements vscode.TreeDataProvider<HelpItem> {
  getTreeItem(element: HelpItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HelpItem): HelpItem[] {
    if (element) {
      return [];
    } else {
      return HELP_ITEMS.map((item) => new HelpItem(item.name, item.uri, item.icon));
    }
  }
}

export class HelpItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: string,
    icon: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.tooltip = this.uri;
    this.iconPath = new vscode.ThemeIcon(icon);
  }

  handleClick() {
    vscode.env.openExternal(vscode.Uri.parse(this.uri));
  }
}