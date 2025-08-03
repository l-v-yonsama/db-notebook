import { window } from "vscode";
import { logError } from "./logger";

export const showWindowErrorMessage = async (o: unknown): Promise<void> => {
  let message = "";
  if (o instanceof Error) {
    message = o.message;
  } else {
    message = "" + o;
  }
  logError(message);
  await window.showErrorMessage(message);
};
