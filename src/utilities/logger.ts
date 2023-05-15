import { ExtensionContext, OutputChannel, window } from "vscode";

let channel: OutputChannel;

export function activateLogger(context: ExtensionContext, name: string) {
  channel = window.createOutputChannel(name);
  context.subscriptions.push(channel);
}

export function log(value: string) {
  if (channel) {
    channel.appendLine(value);
  } else {
    console.log(value);
  }
}
