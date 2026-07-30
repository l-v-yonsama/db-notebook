import { randomBytes } from "crypto";
import { IncomingMessage } from "http";
import { ExtensionContext } from "vscode";

const TOKEN_SECRET_KEY = "databaseNotebook.mcpServerToken";

// SecretStorage is backed by the OS keychain (a single shared credential-store entry
// across every VS Code window, on macOS at least) and has no built-in timeout. If the
// OS ever wedges on it -- e.g. a permission prompt stuck behind another window/Space --
// the call hangs forever with nothing on screen to explain why, and since this runs
// while holding the MCP server's startup claim (see singleton.ts), every other window
// sits blocked behind it too. Bounding the wait turns that into a clear, actionable
// failure instead of an indefinite, unexplained hang.
const SECRETS_TIMEOUT_MS = 8000;

/**
 * Races `promise` against a timer, rejecting with `message` if `ms` elapses first.
 * Note this only stops *waiting*; it can't cancel whatever `promise` is doing
 * underneath.
 */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const TIMEOUT_MESSAGE =
  "Timed out waiting for VS Code's secure storage to respond. Try fully quitting VS Code (not just closing the window) and relaunching it, then try again.";

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Reuses the previously issued bearer token (stored in SecretStorage, same protection
 * level as DB connection passwords) so a `claude mcp add ...` registration made on one
 * day keeps authenticating on the next, instead of every VS Code restart silently
 * invalidating it. Call `regenerateToken` to deliberately rotate it.
 */
export async function getOrCreateToken(context: ExtensionContext): Promise<string> {
  const existing = await withTimeout(
    context.secrets.get(TOKEN_SECRET_KEY),
    SECRETS_TIMEOUT_MS,
    TIMEOUT_MESSAGE
  );
  if (existing) {
    return existing;
  }
  const token = generateToken();
  await withTimeout(
    context.secrets.store(TOKEN_SECRET_KEY, token),
    SECRETS_TIMEOUT_MS,
    TIMEOUT_MESSAGE
  );
  return token;
}

export async function regenerateToken(context: ExtensionContext): Promise<string> {
  const token = generateToken();
  await withTimeout(context.secrets.store(TOKEN_SECRET_KEY, token), SECRETS_TIMEOUT_MS, TIMEOUT_MESSAGE);
  return token;
}

export function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) {
    return false;
  }
  return header === `Bearer ${token}`;
}
