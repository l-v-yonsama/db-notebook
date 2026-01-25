import { ExtensionContext, LogOutputChannel, window } from "vscode";

let channel: LogOutputChannel | undefined;

// Create first.
export function activateLogger(context: ExtensionContext, name: string) {
  channel = window.createOutputChannel(name, { log: true });
}

// Dispose the last one
export function setupDisposeLogger(context: ExtensionContext) {
  if (!channel) {
    return;
  }

  // Replace the functionality, as it does not provide a way to know that it has been destroyed.
  const disposeChannel = channel.dispose;
  channel.dispose = () => {
    disposeChannel.apply(channel);
    channel = undefined;
  };

  context.subscriptions.push(channel);
}

export function show() {
  if (channel) {
    channel.show();
  }
}

export function log(...args: unknown[]) {
  if (channel) {
    try {
      const message = args
        .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
        .join(" ");
      channel.appendLine(message);
    } catch (e) {
      console.error("Error:logger.ts", e);
    }
  } else {
    console.log(...args);
  }
}
export function logError(...args: unknown[]) {
  if (channel) {
    try {
      const message = args
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(" ");
      channel.error(message);
    } catch (e) {
      console.error("Error:logger.ts", e);
    }
  } else {
    console.log(...args);
  }
}
