import { randomBytes } from "crypto";
import { IncomingMessage } from "http";
import { ExtensionContext } from "vscode";

const TOKEN_SECRET_KEY = "databaseNotebook.mcpServerToken";

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
  const existing = await context.secrets.get(TOKEN_SECRET_KEY);
  if (existing) {
    return existing;
  }
  const token = generateToken();
  await context.secrets.store(TOKEN_SECRET_KEY, token);
  return token;
}

export async function regenerateToken(context: ExtensionContext): Promise<string> {
  const token = generateToken();
  await context.secrets.store(TOKEN_SECRET_KEY, token);
  return token;
}

export function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) {
    return false;
  }
  return header === `Bearer ${token}`;
}
