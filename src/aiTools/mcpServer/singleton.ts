import { sleep } from "@l-v-yonsama/rdh";
import * as http from "http";
import * as path from "path";
import { ExtensionContext } from "vscode";
import {
  createFileExclusiveOnStorage,
  deleteFileOnStorage,
  mkdirsOnStorage,
  readResourceOnStorage,
  writeToResourceOnStorage,
} from "../../utilities/fsUtil";
import { log } from "../../utilities/logger";

const PREFIX = "[mcpServer/singleton]";
const LOCK_FILE_NAME = "mcp-server.lock.json";
const CLAIM_FILE_NAME = "mcp-server.lock.claim";
const HEALTH_CHECK_TIMEOUT_MS = 1000;
const CLAIM_RETRY_COUNT = 10;
const CLAIM_RETRY_DELAY_MS = 100;
// A real bind()+writeLockFile() completes in well under a second; a claim left
// around longer than this means its owner crashed before releasing it.
const CLAIM_STALE_MS = 10_000;
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

function getClaimFilePath(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, CLAIM_FILE_NAME);
}

/**
 * True unless we can positively confirm `pid` is gone (ESRCH). Signal 0 doesn't
 * actually send a signal, just probes whether the process exists; an EPERM (exists,
 * but owned by someone else) is treated as "alive" since we can't prove otherwise.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
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
 * Read-only status check: is a real MCP server currently listening, per the lock file
 * and a live health check? Unlike `acquireOrDetect` below, this never claims the
 * startup slot or otherwise mutates state, so it's safe to call as often as needed
 * (e.g. on every tree view refresh) -- callers that only want to *display* status
 * (rather than actually start the server) must use this, not `acquireOrDetect`, or
 * they'll silently claim-and-abandon the startup slot on every call.
 */
export async function detectRunningServer(
  context: ExtensionContext
): Promise<{ url: string; token: string } | undefined> {
  const existing = await readLockFile(getLockFilePath(context));
  if (existing && (await isServerAlive(existing.port, existing.token))) {
    return { url: `http://127.0.0.1:${existing.port}${MCP_PATH}`, token: existing.token };
  }
  return undefined;
}

/**
 * Only call this when you actually intend to start the server: `shouldStart: true`
 * means *this call* just claimed the startup slot, and the caller is now responsible
 * for releasing it (`releaseStartupSlot`, in a `finally`) once bind/writeLockFile is
 * done. For a read-only status check (e.g. rendering a tree view), use
 * `detectRunningServer` instead -- a caller that never releases the slot (because it
 * only wanted to look, not start) will make every other window's call to this
 * function see the slot as held and fail with a false "another window is starting"
 * until the claim ages out.
 *
 * Connections live in `context.globalState`, which is shared by every open VS Code
 * window on this machine (see StateStorage.ts) -- so there is never a good reason for
 * more than one window to actually bind a port. Callers should use this before
 * starting a listener: if another window's server is already alive, reuse its
 * URL/token instead of starting a second one.
 *
 * Reading the lock file and deciding it's missing/stale is not atomic across
 * processes, so two windows calling this at the same moment could otherwise both
 * conclude `shouldStart: true` and both bind a port. `claimStartupSlot` below is what
 * actually serializes this: only one caller can hold the claim file at a time, and
 * whoever holds it is the only one allowed to remove a stale lock or return
 * `shouldStart: true`. Losers wait and re-check rather than proceeding blind.
 */
export async function acquireOrDetect(context: ExtensionContext): Promise<SingletonCheckResult> {
  const lockFilePath = getLockFilePath(context);

  for (let attempt = 0; attempt < CLAIM_RETRY_COUNT; attempt++) {
    const existing = await readLockFile(lockFilePath);
    if (existing && (await isServerAlive(existing.port, existing.token))) {
      log(`${PREFIX} detected an already-running MCP server on port ${existing.port}`);
      return {
        shouldStart: false,
        existing: { url: `http://127.0.0.1:${existing.port}${MCP_PATH}`, token: existing.token },
      };
    }

    if (await claimStartupSlot(context)) {
      // We now hold the claim exclusively, so no other window can be mid-write --
      // safe to clear a stale lock left behind by a crashed process.
      if (existing) {
        log(`${PREFIX} found a stale lock file (pid ${existing.pid}), removing it`);
        await removeLockFile(context);
      }
      return { shouldStart: true };
    }

    log(
      `${PREFIX} another window is starting the MCP server, waiting... (${attempt + 1}/${CLAIM_RETRY_COUNT})`
    );
    await sleep(CLAIM_RETRY_DELAY_MS);
  }

  throw new Error(
    "Another VS Code window appears to be starting the Database Notebook MCP server right now. Try again in a moment."
  );
}

type ClaimFileContent = {
  pid: number;
  claimedAt: number;
};

/**
 * Claims exclusive ownership of the startup sequence (bind -> writeLockFile) via an
 * atomic file create, so it doubles as a cross-process mutex. Callers must release it
 * via `releaseStartupSlot` (in a `finally`) once they're done binding, whether that
 * succeeded or failed -- otherwise every other window's `acquireOrDetect` would wait
 * out its retries and then refuse to start.
 */
async function claimStartupSlot(context: ExtensionContext): Promise<boolean> {
  const claimFilePath = getClaimFilePath(context);
  await mkdirsOnStorage(path.dirname(claimFilePath));
  const mine: ClaimFileContent = { pid: process.pid, claimedAt: Date.now() };
  if (await createFileExclusiveOnStorage(claimFilePath, JSON.stringify(mine))) {
    return true;
  }

  // Someone else holds the claim. Its owning process (e.g. a previous Extension
  // Development Host, killed by stopping a debug session rather than a graceful
  // deactivate) may already be gone, which the elapsed-time check alone can't see for
  // up to CLAIM_STALE_MS -- checking pid liveness lets a genuinely abandoned claim be
  // stolen immediately instead of forcing every retry (and every other window) to sit
  // out a fixed timeout. The elapsed-time check remains as a fallback for cases where
  // the pid can't be probed conclusively.
  try {
    const holder = JSON.parse(await readResourceOnStorage(claimFilePath)) as Partial<ClaimFileContent>;
    const abandoned =
      typeof holder.pid !== "number" ||
      !isProcessAlive(holder.pid) ||
      (typeof holder.claimedAt === "number" && Date.now() - holder.claimedAt > CLAIM_STALE_MS);
    if (abandoned) {
      log(`${PREFIX} found an abandoned startup claim (pid ${holder.pid}), stealing it`);
      await deleteFileOnStorage(claimFilePath);
      return await createFileExclusiveOnStorage(claimFilePath, JSON.stringify(mine));
    }
  } catch {
    // The claim vanished between our failed create and this read (its owner just
    // released it) -- fine, the next loop iteration in acquireOrDetect will retry.
  }
  return false;
}

export async function releaseStartupSlot(context: ExtensionContext): Promise<void> {
  await deleteFileOnStorage(getClaimFilePath(context));
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
