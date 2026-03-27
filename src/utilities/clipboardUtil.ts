import { env, window } from "vscode";

export const copyToClipboard = async (text: string): Promise<void> => {
  if (!env.clipboard) {
    window.showErrorMessage("Clipboard API is not available");
    return;
  }

  try {
    await env.clipboard.writeText(text);
    window.setStatusBarMessage("Copied to clipboard", 1000);
  } catch (err) {
    window.showErrorMessage(`Failed to copy to clipboard: ${err}`);
  }
};
