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
    _options: LanguageModelToolInvocationOptions<ListConnectionsToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    log(`${PREFIX} invoked`);
    const connections = listMcpEnabledConnections(this.stateStorage);
    const text =
      connections.length === 0
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
    log(`${PREFIX} result:[${text}]`);
    return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
  }
}

function listMcpEnabledConnections(stateStorage: StateStorage): ConnectionListItem[] {
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
