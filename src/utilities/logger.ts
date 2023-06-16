import { ExtensionContext, OutputChannel, window } from "vscode";

let channel: OutputChannel;

export function activateLogger(context: ExtensionContext, name: string) {
  channel = window.createOutputChannel(name);
  context.subscriptions.push(channel);
}

export function log(value: string) {
  if (channel) {
    try {
      channel.appendLine(value);
    } catch (e) {
      console.error("Error:logger.ts", e);
    }
  } else {
    console.log(value);
  }
}
