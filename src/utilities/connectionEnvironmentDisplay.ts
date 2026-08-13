import { ConnectionEnvironment } from "@l-v-yonsama/multi-platform-database-drivers";

/**
 * Single source of truth for how a connection's `environment` (local / development / test /
 * staging / production) is represented across the UI and AI/MCP surfaces (Resource Tree,
 * notebook cell status bar, MdhView result tabs, AI confirmation dialogs, AI tool output).
 *
 * Every helper here takes `ConnectionEnvironment | undefined` and returns `undefined` when
 * unset -- callers must render nothing in that case rather than guessing an environment.
 */

/** Per-environment badge letter + ThemeColor id, used by the Resource Tree's file decoration. */
export const CONNECTION_ENVIRONMENT_BADGE: Record<
  ConnectionEnvironment,
  { badge: string; color?: string }
> = {
  local: { badge: "L" },
  development: { badge: "D", color: "charts.blue" },
  test: { badge: "T", color: "charts.purple" },
  staging: { badge: "S", color: "charts.orange" },
  production: { badge: "P", color: "charts.red" },
};

/** "Production" -- capitalized first letter only. Used by the Resource Tree's own tooltip. */
export function formatConnectionEnvironmentCapitalized(
  environment: ConnectionEnvironment | undefined
): string | undefined {
  if (!environment) {
    return undefined;
  }
  return `${environment[0].toUpperCase()}${environment.slice(1)}`;
}

/**
 * "PRODUCTION" -- all caps. Used everywhere else (notebook cell status bar, MdhView result
 * tabs, AI confirmation dialogs, AI tool output) so the same environment reads the same way
 * across every surface.
 */
export function formatConnectionEnvironmentLabel(
  environment: ConnectionEnvironment | undefined
): string | undefined {
  if (!environment) {
    return undefined;
  }
  return environment.toUpperCase();
}

/** Only `production` gets a visual "pay attention" marker; every other environment is plain text. */
export function isHighAttentionEnvironment(environment: ConnectionEnvironment | undefined): boolean {
  return environment === "production";
}
