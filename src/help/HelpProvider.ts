import * as vscode from "vscode";
import * as path from "path";
import { mediaDir } from "../constant";

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
  constructor() {}

  getTreeItem(element: HelpItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HelpItem): HelpItem[] {
    if (element) {
      return [];
    } else {
      return HELP_ITEMS.map((item) => {
        return new HelpItem(item.name, item.uri, item.iconFile);
      });
    }
  }
}

export class HelpItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: string,
    private iconFile: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${this.label}`;
  }

  handleClick() {
    vscode.env.openExternal(vscode.Uri.parse(this.uri));
  }

  iconPath = {
    dark: path.join(mediaDir, "dark", this.iconFile),
    light: path.join(mediaDir, "light", this.iconFile),
  };
}
