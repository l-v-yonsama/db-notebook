import { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage } from "../../utilities/StateStorage";

export type McpConnectionResolution =
  | { ok: true; setting: ConnectionSetting }
  | { ok: false; message: string; availableConnectionNames?: string[] };

/**
 * Resolves a connection by name for use by an AI-facing tool, enforcing the
 * per-connection mcpEnabled opt-in. A connection that exists but is not
 * mcp-enabled is reported identically to one that doesn't exist at all, so
 * AI tools cannot discover connections the user has not explicitly allowed.
 */
export async function resolveMcpEnabledConnection(
  stateStorage: StateStorage,
  connectionName: string
): Promise<McpConnectionResolution> {
  const setting = await stateStorage.getConnectionSettingByName(connectionName);
  const availableConnectionNames = stateStorage
    .getConnectionSettingNames()
    .filter((name) => stateStorage.isMcpEnabledForConnection(name));

  if (!setting || !stateStorage.isMcpEnabledForConnection(connectionName)) {
    return {
      ok: false,
      message: buildNotFoundMessage(connectionName, availableConnectionNames),
      availableConnectionNames,
    };
  }
  return { ok: true, setting };
}

function buildNotFoundMessage(connectionName: string, availableConnectionNames: string[]): string {
  const base = `No connection named "${connectionName}" was found.`;
  const suggestions = suggestConnectionNames(connectionName, availableConnectionNames);
  if (suggestions.length === 0) {
    return base;
  }
  return `${base} Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`;
}

/**
 * Case-insensitive Levenshtein distance to the candidate pool -- matched against
 * `availableConnectionNames` (already mcp-enabled-filtered) only, never the full
 * connection list, so a typo can't be used to fish for a connection the user didn't
 * opt into AI access. Lowercasing before comparing means a pure case difference (the
 * reported "localMysql" vs "localMySQL" case) always scores distance 0 -- the
 * strongest possible match -- with no separate case-insensitive special case needed.
 */
export function suggestConnectionNames(connectionName: string, candidates: string[]): string[] {
  if (connectionName.trim().length === 0 || candidates.length === 0) {
    return [];
  }

  const input = connectionName.toLowerCase();
  const scored = candidates
    .map((name) => ({ name, distance: levenshteinDistance(input, name.toLowerCase()) }))
    .filter(({ name, distance }) => distance <= suggestionThreshold(name));

  if (scored.length === 0) {
    return [];
  }
  const minDistance = Math.min(...scored.map((s) => s.distance));
  return scored
    .filter((s) => s.distance === minDistance)
    .map((s) => s.name)
    .slice(0, 2);
}

// Anchored to the real candidate's length (not the typed input's), so a short garbage
// input can't coincidentally "match" an unrelated short name, and long names don't get
// unboundedly fuzzy either.
function suggestionThreshold(candidateName: string): number {
  return Math.max(1, Math.min(3, Math.floor(candidateName.length / 4)));
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(Math.min(previousRow[j] + 1, currentRow[j - 1] + 1, previousRow[j - 1] + cost));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}
