import * as os from "os";
import * as path from "path";
import { commands, env, ExtensionContext, Uri, window, workspace } from "vscode";
import { DOCS_BASE } from "../../treeData/help/HelpProvider";
import { existsUri } from "../../utilities/fsUtil";
import { log, logError } from "../../utilities/logger";
import { StateStorage } from "../../utilities/StateStorage";
import { getMcpServerConfig } from "../../utilities/configUtil";
import { getErrorMessage } from "../../utilities/errorUtil";
import { regenerateToken } from "./auth";
import { isRunningHere, McpServerHandle, startMcpServer, stopMcpServer } from "./server";

const PREFIX = "[mcpServer/activator]";

const MCP_SETUP_GUIDE_URL = `${DOCS_BASE}/docs/examples/mcpServerUsageGuide.html`;

/**
 * Dock-launched ChatGPT Desktop (Work mode)/Codex Desktop and the Codex CLI/IDE extension all
 * read the same `~/.codex/config.toml` -- unlike a shell `export`, it's visible to processes VS Code's
 * own environment never reaches. We only ever offer to open/inspect this file, never edit
 * it: rewriting someone else's TOML risks mangling formatting or an existing block, so the
 * user always pastes the copied snippet ("Codex setup") and saves by hand.
 */
function getCodexConfigUri(): Uri {
  return Uri.file(path.join(os.homedir(), ".codex", "config.toml"));
}

function getCodexConfigDirUri(): Uri {
  return Uri.file(path.join(os.homedir(), ".codex"));
}

function buildCodexConfigSnippet(handle: McpServerHandle): string {
  // Never log this -- it embeds handle.token, see the note in showConnectionInfo().
  return [
    "[mcp_servers.db_notebook]",
    `url = "${handle.url}"`,
    `http_headers = { Authorization = "Bearer ${handle.token}" }`,
  ].join("\n");
}

type ConnectionInfoReason = "started" | "regenerated";

/**
 * The regular "started"/"already running" info dialog only has room for a one-liner, which
 * doesn't leave space to explain that every already-registered MCP client is now broken --
 * so that explanation goes here instead, to the Output channel, which has room to be loud
 * about it. Never pass `handle.token` in -- only the URL, which isn't secret.
 */
function logTokenRegenerated(handle?: McpServerHandle): void {
  const divider = "=".repeat(72);
  log(`${PREFIX} ${divider}`);
  log(`${PREFIX} ⚠ MCP server token regenerated -- the PREVIOUS token no longer works.`);
  log(
    `${PREFIX} Every MCP client already registered with it (Claude Code, Codex, MCP Inspector, ...)`
  );
  log(`${PREFIX} will start getting 401 Unauthorized until it's reconfigured with the new token.`);
  if (handle) {
    log(`${PREFIX} URL (usually unchanged): ${handle.url}`);
  }
  log(`${PREFIX} Run "Show Connection Info" (or right-click the MCP Server tree item) to get the`);
  log(`${PREFIX} new token and update each client's registration.`);
  log(`${PREFIX} ${divider}`);
}

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
        stopMcpServer(context).catch((e: unknown) =>
          logError(`${PREFIX} error while stopping on deactivate: ${getErrorMessage(e)}`)
        );
      }
    },
  });

  if (getMcpServerConfig().autoStart) {
    start(context, stateStorage).catch((e: unknown) =>
      logError(`${PREFIX} autoStart failed: ${getErrorMessage(e)}`)
    );
  }
}

async function start(
  context: ExtensionContext,
  stateStorage: StateStorage,
  reason: ConnectionInfoReason = "started"
): Promise<void> {
  try {
    const handle = await startMcpServer(context, stateStorage);
    await showConnectionInfo(handle, reason);
  } catch (e) {
    const message = getErrorMessage(e);
    logError(`${PREFIX} failed to start: ${message}`);
    window.showErrorMessage(`Failed to start the Database Notebook MCP server: ${message}`);
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
  window.showInformationMessage("Database Notebook MCP server stopped.");
}

async function regenerate(context: ExtensionContext, stateStorage: StateStorage): Promise<void> {
  await regenerateToken(context);
  if (!isRunningHere()) {
    logTokenRegenerated();
    window.showInformationMessage(
      "Database Notebook MCP server token regenerated. It takes effect the next time the server starts " +
        "(if it's already running in another VS Code window, stop and start it there to apply the new token)."
    );
    return;
  }
  // Restart in place so the running server picks up the new token. This normally
  // rebinds to the same port (see server.ts's `bind`), so only the token -- not the
  // URL -- changes; existing `claude mcp add` registrations just need their header
  // value updated. `start()` logs the loud Output-channel announcement itself, from
  // inside `showConnectionInfo()`, once it has the post-restart handle/URL in hand.
  await stopMcpServer(context);
  await start(context, stateStorage, "regenerated");
}

export async function showConnectionInfo(
  handle: McpServerHandle,
  reason: ConnectionInfoReason = "started"
): Promise<void> {
  // Never pass `claudeCommand`, a Codex snippet, or `handle.token` to `log()` -- they carry
  // the Bearer token, which is otherwise only kept in SecretStorage. Logging it would leak
  // it to the Output panel and to any on-disk log files a user shares for support.
  const claudeCommand = `claude mcp add --transport http db-notebook ${handle.url} --header "Authorization: Bearer ${handle.token}"`;
  log(`${PREFIX} MCP connection info displayed. URL: ${handle.url}`);
  if (reason === "regenerated") {
    // The dialog below only has room for a one-liner -- this is the loud, unmissable
    // version, with the Output channel's extra room to actually explain the consequence.
    logTokenRegenerated(handle);
  }

  const prefix =
    reason === "regenerated"
      ? "Database Notebook MCP server token regenerated -- reconnect your MCP clients."
      : handle.startedHere
      ? "Database Notebook MCP server started."
      : "Database Notebook MCP server is already running (started by another VS Code window).";

  // Kept to 3 buttons -- VS Code's notification shrinks each button to fit them all on one
  // row, so a 5th button (the original "Copy claude mcp add command" /
  // "Copy Codex MCP config snippet" wording) truncated into unreadable "Co…" labels. Less
  // common actions move behind "More…" (a QuickPick, which has room for full labels).
  const action = await window.showInformationMessage(
    `${prefix} URL: ${handle.url}`,
    "Claude command",
    "Codex setup",
    "More…"
  );
  if (action === "Claude command") {
    await env.clipboard.writeText(claudeCommand);
    log(`${PREFIX} copied "claude mcp add" command to clipboard.`);
  } else if (action === "Codex setup") {
    await setUpCodexConfig(handle);
  } else if (action === "More…") {
    await showMoreActions(handle);
  }
}

async function showMoreActions(handle: McpServerHandle): Promise<void> {
  const action = await window.showQuickPick(["Copy URL", "Copy token", "Open MCP setup guide"], {
    placeHolder: "Database Notebook MCP server",
  });
  if (action === "Copy URL") {
    await env.clipboard.writeText(handle.url);
    log(`${PREFIX} copied URL to clipboard: ${handle.url}`);
  } else if (action === "Copy token") {
    await env.clipboard.writeText(handle.token);
    log(`${PREFIX} copied token to clipboard.`);
  } else if (action === "Open MCP setup guide") {
    await openMcpSetupGuide();
  }
}

/**
 * Opens `~/.codex/config.toml` in a normal VS Code editor tab and copies the
 * `[mcp_servers.db_notebook]` snippet to the clipboard in one step, so the user only has to
 * paste and save. Never writes to the file beyond creating it empty on first use -- see the
 * note above `getCodexConfigUri()`; the snippet itself is never written in automatically.
 */
async function setUpCodexConfig(handle: McpServerHandle): Promise<void> {
  const configUri = getCodexConfigUri();

  if (!(await existsUri(configUri))) {
    const choice = await window.showWarningMessage(
      `Codex config file not found: ${configUri.fsPath}`,
      "Create and open",
      "Open MCP setup guide"
    );
    if (choice === "Open MCP setup guide") {
      await openMcpSetupGuide();
      return;
    }
    if (choice !== "Create and open") {
      return;
    }
    // Re-check right before writing rather than trusting the check above: the warning
    // dialog just awaited can sit open for an arbitrary amount of time, during which
    // Codex itself (or the user, editing it by hand) may have created the file. Don't
    // blindly stomp whatever showed up in the meantime with an empty one.
    if (await existsUri(configUri)) {
      log(
        `${PREFIX} Codex config file appeared while the prompt was open; opening it as-is instead of overwriting it.`
      );
    } else {
      await workspace.fs.createDirectory(getCodexConfigDirUri());
      await workspace.fs.writeFile(configUri, new Uint8Array());
      log(`${PREFIX} created empty Codex config file: ${configUri.fsPath}`);
    }
  }

  const document = await workspace.openTextDocument(configUri);
  await window.showTextDocument(document);
  await env.clipboard.writeText(buildCodexConfigSnippet(handle));
  log(
    `${PREFIX} opened Codex config for editing and copied the MCP config snippet to clipboard: ${configUri.fsPath}`
  );

  const guideAction = await window.showInformationMessage(
    "The Codex MCP config snippet is on your clipboard -- paste it at the end of this file. " +
      "If a [mcp_servers.db_notebook] block already exists, replace it rather than adding a " +
      "second one, then restart Codex Desktop/CLI. Repeat this after regenerating the token.",
    "Open MCP setup guide"
  );
  if (guideAction === "Open MCP setup guide") {
    await openMcpSetupGuide();
  }
}

async function openMcpSetupGuide(): Promise<void> {
  await env.openExternal(Uri.parse(MCP_SETUP_GUIDE_URL));
}
