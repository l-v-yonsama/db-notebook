import * as http from "http";
import * as path from "path";
import { ExtensionContext } from "vscode";
import {
  deleteFileOnStorage,
  mkdirsOnStorage,
  readResourceOnStorage,
  writeToResourceOnStorage,
} from "../utilities/fsUtil";
import { log } from "../utilities/logger";

const PREFIX = "[mcpServer/singleton]";
const LOCK_FILE_NAME = "mcp-server.lock.json";
const HEALTH_CHECK_TIMEOUT_MS = 1000;
export const MCP_PATH = "/db-notebook-mcp";

type LockFileContent = {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
};

export type SingletonCheckResult =
  | { shouldStart: true }
  | { shouldStart: false; existing: { url: string; token: string } };

function getLockFilePath(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, LOCK_FILE_NAME);
}

async function readLockFile(lockFilePath: string): Promise<LockFileContent | undefined> {
  try {
    const text = await readResourceOnStorage(lockFilePath);
    return JSON.parse(text) as LockFileContent;
  } catch {
    return undefined;
  }
}

function isServerAlive(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: MCP_PATH,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      },
      (res) => {
        // Any HTTP response at all -- even a non-2xx one -- means something is
        // actually listening and speaking HTTP on this port right now.
        res.resume();
        resolve(true);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

/**
 * Connections live in `context.globalState`, which is shared by every open VS Code
 * window on this machine (see StateStorage.ts) -- so there is never a good reason for
 * more than one window to actually bind a port. Callers should use this before
 * starting a listener: if another window's server is already alive, reuse its
 * URL/token instead of starting a second one.
 */
export async function acquireOrDetect(context: ExtensionContext): Promise<SingletonCheckResult> {
  const lockFilePath = getLockFilePath(context);
  const existing = await readLockFile(lockFilePath);
  if (existing && (await isServerAlive(existing.port, existing.token))) {
    log(`${PREFIX} detected an already-running MCP server on port ${existing.port}`);
    return {
      shouldStart: false,
      existing: { url: `http://127.0.0.1:${existing.port}${MCP_PATH}`, token: existing.token },
    };
  }
  if (existing) {
    log(`${PREFIX} found a stale lock file (pid ${existing.pid}), removing it`);
    await removeLockFile(context);
  }
  return { shouldStart: true };
}

export async function writeLockFile(
  context: ExtensionContext,
  port: number,
  token: string
): Promise<void> {
  const lockFilePath = getLockFilePath(context);
  await mkdirsOnStorage(path.dirname(lockFilePath));
  const content: LockFileContent = {
    pid: process.pid,
    port,
    token,
    startedAt: new Date().toISOString(),
  };
  await writeToResourceOnStorage(lockFilePath, JSON.stringify(content));
}

export async function removeLockFile(context: ExtensionContext): Promise<void> {
  await deleteFileOnStorage(getLockFilePath(context));
}

/**
 * True if the lock file's pid matches this process, i.e. this window is the one
 * actually holding the listening socket (as opposed to having only detected
 * another window's already-running server).
 */
export async function ownsLock(context: ExtensionContext): Promise<boolean> {
  const existing = await readLockFile(getLockFilePath(context));
  return existing?.pid === process.pid;
}
