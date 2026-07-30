import { commands, env, ExtensionContext, window } from "vscode";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { getMcpServerConfig } from "../utilities/configUtil";
import { regenerateToken } from "./auth";
import { isRunningHere, McpServerHandle, startMcpServer, stopMcpServer } from "./server";

const PREFIX = "[mcpServer/activator]";
const RUNNING_CONTEXT_KEY = "databaseNotebook.mcpServerRunning";

export function activateMcpServer(context: ExtensionContext, stateStorage: StateStorage): void {
  context.subscriptions.push(
    commands.registerCommand("database-notebook.start-mcp-server", async () => {
      await start(context, stateStorage);
    })
  );
  context.subscriptions.push(
    commands.registerCommand("database-notebook.stop-mcp-server", async () => {
      await stop(context);
    })
  );
  context.subscriptions.push(
    commands.registerCommand("database-notebook.regenerate-mcp-token", async () => {
      await regenerate(context, stateStorage);
    })
  );
  context.subscriptions.push(
    commands.registerCommand("database-notebook.show-mcp-connection-info", async () => {
      // `start()` already no-ops into re-showing the existing server's info instead of
      // rebinding when one is already running (see startMcpServer's acquireOrDetect) --
      // reused as-is so there's a discoverable way to re-open the copy-URL/token dialog
      // after VS Code's notification auto-dismisses.
      await start(context, stateStorage);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (isRunningHere()) {
        stopMcpServer(context).catch((e) => logError(`${PREFIX} error while stopping on deactivate: ${e?.message ?? e}`));
      }
    },
  });

  if (getMcpServerConfig().autoStart) {
    start(context, stateStorage).catch((e) => logError(`${PREFIX} autoStart failed: ${e?.message ?? e}`));
  }
}

async function start(context: ExtensionContext, stateStorage: StateStorage): Promise<void> {
  try {
    const handle = await startMcpServer(context, stateStorage);
    await commands.executeCommand("setContext", RUNNING_CONTEXT_KEY, true);
    await showConnectionInfo(handle);
  } catch (e: any) {
    logError(`${PREFIX} failed to start: ${e?.message ?? e}`);
    window.showErrorMessage(`Failed to start the Database Notebook MCP server: ${e?.message ?? e}`);
  }
}

async function stop(context: ExtensionContext): Promise<void> {
  if (!isRunningHere()) {
    window.showInformationMessage(
      "The Database Notebook MCP server isn't running in this window (it may be running in another VS Code window)."
    );
    return;
  }
  await stopMcpServer(context);
  await commands.executeCommand("setContext", RUNNING_CONTEXT_KEY, false);
  window.showInformationMessage("Database Notebook MCP server stopped.");
}

async function regenerate(context: ExtensionContext, stateStorage: StateStorage): Promise<void> {
  await regenerateToken(context);
  if (!isRunningHere()) {
    window.showInformationMessage(
      "Database Notebook MCP server token regenerated. It takes effect the next time the server starts " +
        "(if it's already running in another VS Code window, stop and start it there to apply the new token)."
    );
    return;
  }
  // Restart in place so the running server picks up the new token. This normally
  // rebinds to the same port (see server.ts's `bind`), so only the token -- not the
  // URL -- changes; existing `claude mcp add` registrations just need their header
  // value updated.
  await stopMcpServer(context);
  await start(context, stateStorage);
}

export async function showConnectionInfo(handle: McpServerHandle): Promise<void> {
  // Never pass `claudeCommand` or `handle.token` to `log()` -- they carry the Bearer
  // token, which is otherwise only kept in SecretStorage. Logging it would leak it to
  // the Output panel and to any on-disk log files a user shares for support.
  const claudeCommand = `claude mcp add --transport http db-notebook ${handle.url} --header "Authorization: Bearer ${handle.token}"`;
  log(`${PREFIX} MCP connection info displayed. URL: ${handle.url}`);

  const prefix = handle.startedHere
    ? "Database Notebook MCP server started."
    : "Database Notebook MCP server is already running (started by another VS Code window).";

  const action = await window.showInformationMessage(
    `${prefix} URL: ${handle.url}`,
    "Copy claude mcp add command",
    "Copy URL",
    "Copy token"
  );
  if (action === "Copy claude mcp add command") {
    await env.clipboard.writeText(claudeCommand);
    log(`${PREFIX} copied "claude mcp add" command to clipboard.`);
  } else if (action === "Copy URL") {
    await env.clipboard.writeText(handle.url);
    log(`${PREFIX} copied URL to clipboard: ${handle.url}`);
  } else if (action === "Copy token") {
    await env.clipboard.writeText(handle.token);
    log(`${PREFIX} copied token to clipboard.`);
  }
}
