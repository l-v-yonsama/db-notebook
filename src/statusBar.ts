import { ExtensionContext, StatusBarAlignment, StatusBarItem, window } from "vscode";
import { EXTENSION_NAME, OPEN_OUTPUT_CHANNEL } from "./constant";

let statusBarItem: StatusBarItem;

const SHORT_NAME = '$(database)DBN';

export const activateStatusBar = (context: ExtensionContext) => {
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBarItem.name = EXTENSION_NAME;
  statusBarItem.text = SHORT_NAME;
  statusBarItem.tooltip = `${EXTENSION_NAME} extension is active`;
  statusBarItem.command = OPEN_OUTPUT_CHANNEL;
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
};

export const showStatusMessage = (
  message: string,
  level: "info" | "warning" | "error" = "info"
): void => {
  if (!statusBarItem) {
    return;
  }

  const prefix = `🗄️ ${EXTENSION_NAME}`;

  switch (level) {
    case "info":
      statusBarItem.text = `${SHORT_NAME} $(info)`;
      statusBarItem.tooltip = message;
      break;

    case "warning":
      statusBarItem.text = `${SHORT_NAME} $(warning)`;
      statusBarItem.tooltip = `Warning: ${message}`;
      break;

    case "error":
      statusBarItem.text = `${SHORT_NAME} $(error)`;
      statusBarItem.tooltip = `Error: ${message}`;
      break;
  }

  statusBarItem.show();
};

export const hideStatusMessage = (): void => {
  statusBarItem?.hide();
};
