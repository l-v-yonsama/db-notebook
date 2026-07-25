import * as path from "path";
import { ExtensionContext } from "vscode";
import {
  mkdirsOnStorage,
  readResourceOnStorage,
  writeToResourceOnStorage,
} from "../utilities/fsUtil";

const PREFS_FILE_NAME = "mcp-server.prefs.json";

type PrefsContent = {
  port?: number;
};

function getPrefsFilePath(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, PREFS_FILE_NAME);
}

async function readPrefs(context: ExtensionContext): Promise<PrefsContent> {
  try {
    const text = await readResourceOnStorage(getPrefsFilePath(context));
    return JSON.parse(text) as PrefsContent;
  } catch {
    return {};
  }
}

/**
 * The port this machine last bound the MCP server to. Unlike the lock file (which only
 * exists while a server is actually alive), this survives stop/restart so a fresh start
 * can try to rebind the same port -- keeping previously-registered MCP client URLs
 * (e.g. `claude mcp add`) valid across VS Code restarts, as long as the port is still
 * free. `server.ts` falls back to a fresh OS-assigned port if it isn't.
 */
export async function getLastUsedPort(context: ExtensionContext): Promise<number | undefined> {
  const prefs = await readPrefs(context);
  return prefs.port;
}

export async function setLastUsedPort(context: ExtensionContext, port: number): Promise<void> {
  const prefsFilePath = getPrefsFilePath(context);
  await mkdirsOnStorage(path.dirname(prefsFilePath));
  await writeToResourceOnStorage(prefsFilePath, JSON.stringify({ port }));
}
