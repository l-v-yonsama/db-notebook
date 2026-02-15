import * as vscode from "vscode";

const HELP_ITEMS = [
  {
    name: "Read Me",
    uri: "https://l-v-yonsama.github.io/db-notebook/",
    iconFile: "info.svg",
  },
  {
    name: "Examples",
    uri: "https://l-v-yonsama.github.io/db-notebook/docs/examples/databaseNotebook.html",
    iconFile: "info.svg",
  },
];

export class HelpProvider implements vscode.TreeDataProvider<HelpItem> {
  constructor(private readonly extensionUri: vscode.Uri) {}

  getTreeItem(element: HelpItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HelpItem): HelpItem[] {
    if (element) {
      return [];
    } else {
      return HELP_ITEMS.map((item) => {
        return new HelpItem(
          this.extensionUri,
          item.name,
          item.uri,
          item.iconFile
        );
      });
    }
  }
}

export class HelpItem extends vscode.TreeItem {
  constructor(
    private readonly extensionUri: vscode.Uri,
    public readonly label: string,
    public readonly uri: string,
    private readonly iconFile: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${this.label}`;

    this.iconPath = {
      dark: vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "dark",
        this.iconFile
      ),
      light: vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "light",
        this.iconFile
      ),
    };
  }

  handleClick() {
    vscode.env.openExternal(vscode.Uri.parse(this.uri));
  }
}