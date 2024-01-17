import { ExtensionContext, StatusBarAlignment, StatusBarItem, window } from "vscode";
import { EXTENSION_NAME } from "./constant";

let statusBarItem: StatusBarItem;

export const activateStatusBar = (context: ExtensionContext) => {
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);
  statusBarItem.name = EXTENSION_NAME;
};

export const showStatusMessage = (text: string): void => {
  if (statusBarItem) {
    statusBarItem.text = text;
    statusBarItem.show();
  }
};

export const hideStatusMessage = (): void => {
  statusBarItem?.hide();
};
