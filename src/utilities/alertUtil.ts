import { window } from "vscode";

export const showWindowErrorMessage = async (o: unknown): Promise<void> => {
  let message = "";
  if (o instanceof Error) {
    message = o.message;
  } else {
    message = "" + o;
  }
  await window.showErrorMessage(message);
};
