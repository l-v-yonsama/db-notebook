import {
  ConnectionEnvironment,
  ConnectionSetting,
  DBType,
  isRDSType,
  isReadOnlyEnforcementReliable,
} from "@l-v-yonsama/multi-platform-database-drivers";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { trackInvocation } from "../toolActivity/ToolInvocationTracker";
import { log } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "[lmTools/ListConnectionsTool]";

export type ListConnectionsToolInput = Record<string, never>;

type ConnectionListItem = {
  name: string;
  dbType: DBType;
  environment?: ConnectionEnvironment;
  comment?: string;
  detail?: string;
};

export class ListConnectionsTool implements LanguageModelTool<ListConnectionsToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<ListConnectionsToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const text = await trackInvocation("lmTools", "ListConnectionsTool", options.input, async () =>
      listConnectionsText(this.stateStorage)
    );
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

/**
 * Fetches, formats, and logs the connection list in one place, so every caller
 * (the Copilot Chat tool above, the MCP server's tool handler, ...) gets identical
 * behavior -- and identical logging -- without each caller repeating the same steps.
 */
export function listConnectionsText(stateStorage: StateStorage): string {
  log(`${PREFIX} invoked`);
  const connections = listMcpEnabledConnections(stateStorage);
  const text = formatConnectionListForModel(connections);
  log(`${PREFIX} result:[${text}]`);
  return text;
}

export function formatConnectionListForModel(connections: ConnectionListItem[]): string {
  return connections.length === 0
    ? "No connections are currently available to AI tools. The user needs to enable at least one connection for AI access in Database Notebook's connection settings."
    : connections
        .map((c) => {
          const attrs = [c.dbType, c.environment ? `env: ${c.environment}` : undefined, c.detail]
            .filter((it) => !!it)
            .join(", ");
          const suffix = c.comment ? ` — ${c.comment}` : "";
          return `- ${c.name} (${attrs})${suffix}`;
        })
        .join("\n");
}

export function listMcpEnabledConnections(stateStorage: StateStorage): ConnectionListItem[] {
  return stateStorage
    .getPasswordlessConnectionSettingList()
    .filter((it) => stateStorage.isMcpEnabledForConnection(it.name))
    .map((it) => ({
      name: it.name,
      dbType: it.dbType,
      environment: it.environment,
      comment: it.comment,
      detail: describeConnectionDetail(it),
    }));
}

function describeConnectionDetail(setting: ConnectionSetting): string | undefined {
  if (setting.dbType === DBType.Aws && setting.awsSetting?.services?.length) {
    return `services: ${setting.awsSetting.services.join(", ")}`;
  }
  if (setting.dbType === DBType.Mqtt && setting.mqttSetting?.protocol) {
    return `protocol: ${setting.mqttSetting.protocol}`;
  }
  if (isRDSType(setting.dbType) && setting.readOnly) {
    // SQL Server's readOnly is only a replica-routing hint, not an engine-enforced
    // guarantee (see isReadOnlyEnforcementReliable), so callers shouldn't treat it
    // the same as MySQL/Postgres/SQLite's enforced read-only session.
    return isReadOnlyEnforcementReliable(setting.dbType) ? "read-only" : "read-only (hint only, not enforced)";
  }
  return undefined;
}
